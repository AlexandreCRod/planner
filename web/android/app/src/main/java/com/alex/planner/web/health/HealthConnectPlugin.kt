package com.alex.planner.web.health

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.*
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.time.Instant
import java.time.ZoneOffset
import kotlin.reflect.KClass

/**
 * Health Connect, read only, for the page (web/src/health/): the watch's runs, sleep and daily data that
 * Garmin Connect and other apps write there. Kept small and dumb: the page decides what to read and turns
 * the raw records into its own (domain/health.ts); this side only asks for the permissions and hands over
 * records of a type, one page at a time, as plain JSON. Times are epoch ms, zone offsets seconds, units
 * metric (m, kg, kcal, m/s, W, °C...).
 *
 * Debug builds also have insertSample(): test records for an emulator's empty Health Connect.
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val debuggable get() = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private fun client(): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) HealthConnectClient.getOrCreate(context) else null

    /** {status}: "available", "update" (Health Connect needs installing or updating), "unavailable" (Android before 9...). */
    @PluginMethod
    fun availability(call: PluginCall) {
        val status = when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> "available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update"
            else -> "unavailable"
        }
        call.resolve(JSObject().put("status", status))
    }

    /** {granted: [record type names], all, history, historyAvailable}. */
    @PluginMethod
    fun permissions(call: PluginCall) {
        val c = client() ?: return call.resolve(JSObject().put("granted", JSArray()).put("all", false).put("history", false).put("historyAvailable", false))
        scope.launch {
            try {
                call.resolve(state(c, c.permissionController.getGrantedPermissions()))
            } catch (e: Exception) {
                call.reject(e.message ?: "can't read permissions")
            }
        }
    }

    private suspend fun historyAvailable(c: HealthConnectClient) =
        runCatching { c.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE }.getOrDefault(false)

    private suspend fun state(c: HealthConnectClient, granted: Set<String>): JSObject {
        val types = JSArray()
        for ((name, cls) in TYPES) if (HealthPermission.getReadPermission(cls) in granted) types.put(name)
        return JSObject()
            .put("granted", types)
            .put("all", readPermissions().all { it in granted })
            .put("history", HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY in granted)
            .put("historyAvailable", historyAvailable(c))
    }

    private fun readPermissions(): Set<String> = TYPES.values.map { HealthPermission.getReadPermission(it) }.toSet()

    /** Asks for every read permission (plus history, where Health Connect has it; plus writes in debug builds). Resolves as permissions(). */
    @PluginMethod
    fun request(call: PluginCall) {
        val c = client() ?: return call.reject("unavailable")
        scope.launch {
            val wanted = readPermissions().toMutableSet()
            if (historyAvailable(c)) wanted += HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY
            if (debuggable) wanted += SAMPLE_TYPES.map { HealthPermission.getWritePermission(it) }
            val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, wanted)
            startActivityForResult(call, intent, "requestDone")
        }
    }

    @ActivityCallback
    private fun requestDone(call: PluginCall?, @Suppress("UNUSED_PARAMETER") result: ActivityResult) {
        if (call == null) return
        val c = client() ?: return call.reject("unavailable")
        scope.launch {
            try {
                call.resolve(state(c, c.permissionController.getGrantedPermissions()))
            } catch (e: Exception) {
                call.reject(e.message ?: "can't read permissions")
            }
        }
    }

    /** Opens Health Connect's page for this app's permissions and data. */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        val activity: Activity = activity ?: return call.reject("no activity")
        val intent = if (android.os.Build.VERSION.SDK_INT >= 34)
            Intent("android.health.connect.action.MANAGE_HEALTH_PERMISSIONS").putExtra(Intent.EXTRA_PACKAGE_NAME, context.packageName)
        else Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
        runCatching { activity.startActivity(intent) }
            .recoverCatching { activity.startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)) }
            .onSuccess { call.resolve() }
            .onFailure { call.reject("can't open") }
    }

    /**
     * One page of records: {type, from, to (epoch ms), pageToken?, pageSize?} → {records: [...], pageToken?}.
     * Each record: its own fields (getters, units as above), plus "metadata" {id, origin, lastModified,
     * clientRecordId, recordingMethod, device {type, manufacturer, model}}.
     */
    @PluginMethod
    fun read(call: PluginCall) {
        val c = client() ?: return call.reject("unavailable")
        val name = call.getString("type") ?: return call.reject("no type")
        val cls = TYPES[name] ?: return call.reject("unknown type $name")
        val from = call.getLong("from") ?: 0L
        val to = call.getLong("to") ?: System.currentTimeMillis()
        val token = call.getString("pageToken")
        val size = call.getInt("pageSize") ?: 1000
        scope.launch {
            try {
                val res = c.readRecords(
                    ReadRecordsRequest(
                        recordType = cls,
                        timeRangeFilter = TimeRangeFilter.between(Instant.ofEpochMilli(from), Instant.ofEpochMilli(to)),
                        pageSize = size,
                        pageToken = token,
                    )
                )
                val out = JSONArray()
                for (r in res.records) out.put(toJson(r))
                val ret = JSObject().put("records", out)
                if (!res.pageToken.isNullOrEmpty()) ret.put("pageToken", res.pageToken)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    /** Debug builds only: test records ending [daysAgo] days back (default 1), for an empty emulator. Resolves {ids}. */
    @PluginMethod
    fun insertSample(call: PluginCall) {
        if (!debuggable) return call.reject("debug builds only")
        val c = client() ?: return call.reject("unavailable")
        val daysAgo = call.getInt("daysAgo") ?: 1
        scope.launch {
            try {
                val res = c.insertRecords(Samples.records(daysAgo))
                val ids = JSArray()
                res.recordIdsList.forEach { ids.put(it) }
                call.resolve(JSObject().put("ids", ids))
            } catch (e: Exception) {
                Log.w(TAG, "insertSample", e)
                call.reject(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    // ---------- Records as JSON, generically ----------

    private val getters = HashMap<Class<*>, List<Pair<String, Method>>>()

    private fun gettersOf(cls: Class<*>): List<Pair<String, Method>> = getters.getOrPut(cls) {
        cls.methods.filter { m ->
            m.parameterCount == 0 && !Modifier.isStatic(m.modifiers) && m.declaringClass != Any::class.java &&
                (m.name.startsWith("get") && m.name.length > 3 || m.name.startsWith("is") && m.name.length > 2 && m.returnType == Boolean::class.javaPrimitiveType) &&
                m.name != "getClass" && m.name != "getMetadata" && m.name != "getExerciseRouteResult"
        }.map { m ->
            val bare = m.name.removePrefix("get").let { if (it == m.name) m.name.removePrefix("is") else it }
            bare.replaceFirstChar { it.lowercase() } to m
        }.sortedBy { it.first }
    }

    private fun toJson(r: Record): JSONObject {
        val o = objectJson(r, 0)
        o.put("metadata", metadataJson(r.metadata))
        if (r is ExerciseSessionRecord) {
            o.put("hasRoute", r.exerciseRouteResult is ExerciseRouteResult.Data)
            // Health Connect's own name for the type ("running", "running_treadmill", "strength_training"...).
            ExerciseSessionRecord.EXERCISE_TYPE_INT_TO_STRING_MAP[r.exerciseType]?.let { o.put("exerciseTypeName", it) }
        }
        return o
    }

    private fun metadataJson(m: Metadata): JSONObject {
        val o = JSONObject()
            .put("id", m.id)
            .put("origin", m.dataOrigin.packageName)
            .put("lastModified", m.lastModifiedTime.toEpochMilli())
            .put("recordingMethod", m.recordingMethod)
        m.clientRecordId?.let { o.put("clientRecordId", it) }
        m.device?.let { d ->
            o.put("device", JSONObject().put("type", d.type).put("manufacturer", d.manufacturer ?: JSONObject.NULL).put("model", d.model ?: JSONObject.NULL))
        }
        return o
    }

    private fun objectJson(v: Any, depth: Int): JSONObject {
        val o = JSONObject()
        for ((name, m) in gettersOf(v.javaClass)) {
            val value = runCatching { m.invoke(v) }.getOrNull() ?: continue
            val j = valueJson(value, depth + 1) ?: continue
            o.put(name, j)
        }
        return o
    }

    /** A field's value as JSON: numbers and text as they are, units in metric, lists and nested objects recursively. */
    private fun valueJson(v: Any, depth: Int): Any? = when (v) {
        is Number, is String, is Boolean -> v
        is Instant -> v.toEpochMilli()
        is ZoneOffset -> v.totalSeconds
        is Length -> v.inMeters
        is Energy -> v.inKilocalories
        is Mass -> v.inKilograms
        is Velocity -> v.inMetersPerSecond
        is Power -> v.inWatts
        is Percentage -> v.value
        is Temperature -> v.inCelsius
        is TemperatureDelta -> v.inCelsius
        is Pressure -> v.inMillimetersOfMercury
        is Volume -> v.inLiters
        is BloodGlucose -> v.inMillimolesPerLiter
        is Enum<*> -> v.name
        is Map<*, *> -> null
        is Collection<*> -> JSONArray().also { a -> v.forEach { e -> e?.let { valueJson(it, depth) }?.let(a::put) } }
        else -> if (depth < 4 && v.javaClass.name.startsWith("androidx.health")) objectJson(v, depth) else null
    }

    companion object {
        private const val TAG = "HealthConnect"

        /**
         * Every record type the page may read, by name (the class name without "Record"). Health Connect's
         * reproductive-health types are left out on purpose; medical records aren't records of this kind.
         */
        val TYPES: Map<String, KClass<out Record>> = linkedMapOf(
            "ExerciseSession" to ExerciseSessionRecord::class,
            "SleepSession" to SleepSessionRecord::class,
            "HeartRate" to HeartRateRecord::class,
            "RestingHeartRate" to RestingHeartRateRecord::class,
            "HeartRateVariabilityRmssd" to HeartRateVariabilityRmssdRecord::class,
            "OxygenSaturation" to OxygenSaturationRecord::class,
            "RespiratoryRate" to RespiratoryRateRecord::class,
            "Steps" to StepsRecord::class,
            "StepsCadence" to StepsCadenceRecord::class,
            "Distance" to DistanceRecord::class,
            "Speed" to SpeedRecord::class,
            "Power" to PowerRecord::class,
            "CyclingPedalingCadence" to CyclingPedalingCadenceRecord::class,
            "ActiveCaloriesBurned" to ActiveCaloriesBurnedRecord::class,
            "TotalCaloriesBurned" to TotalCaloriesBurnedRecord::class,
            "BasalMetabolicRate" to BasalMetabolicRateRecord::class,
            "FloorsClimbed" to FloorsClimbedRecord::class,
            "ElevationGained" to ElevationGainedRecord::class,
            "WheelchairPushes" to WheelchairPushesRecord::class,
            "Vo2Max" to Vo2MaxRecord::class,
            "Weight" to WeightRecord::class,
            "BodyFat" to BodyFatRecord::class,
            "Height" to HeightRecord::class,
            "LeanBodyMass" to LeanBodyMassRecord::class,
            "BoneMass" to BoneMassRecord::class,
            "BodyWaterMass" to BodyWaterMassRecord::class,
            "BodyTemperature" to BodyTemperatureRecord::class,
            "BasalBodyTemperature" to BasalBodyTemperatureRecord::class,
            "SkinTemperature" to SkinTemperatureRecord::class,
            "BloodPressure" to BloodPressureRecord::class,
            "BloodGlucose" to BloodGlucoseRecord::class,
            "Hydration" to HydrationRecord::class,
            "Nutrition" to NutritionRecord::class,
            "PlannedExerciseSession" to PlannedExerciseSessionRecord::class,
        )

        /** What insertSample writes (debug builds declare these write permissions in src/debug). */
        val SAMPLE_TYPES: List<KClass<out Record>> = listOf(
            ExerciseSessionRecord::class, SleepSessionRecord::class, HeartRateRecord::class, RestingHeartRateRecord::class,
            HeartRateVariabilityRmssdRecord::class, OxygenSaturationRecord::class, StepsRecord::class, DistanceRecord::class,
            SpeedRecord::class, ActiveCaloriesBurnedRecord::class, TotalCaloriesBurnedRecord::class, ElevationGainedRecord::class,
            WeightRecord::class, BodyFatRecord::class, Vo2MaxRecord::class,
        )
    }
}
