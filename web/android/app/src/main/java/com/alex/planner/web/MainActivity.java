package com.alex.planner.web;

import android.content.Intent;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.alex.planner.web.alarm.AlarmPlugin;
import com.alex.planner.web.device.DevicePlugin;
import com.alex.planner.web.invite.InvitePlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Brought back after the system ended the app: Android hands the task's first intent over again,
        // which may be a calendar file opened earlier. That one was shown already (and its read access
        // is gone), so the app starts as from the launcher.
        if (savedInstanceState != null && Intent.ACTION_VIEW.equals(getIntent().getAction())) {
            setIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClass(this, MainActivity.class));
        }
        // Draw under the status and navigation bars like the native app; the page pads itself
        // with the safe-area insets (SystemBars insetsHandling "css").
        // After super: the bridge picks its no-action-bar theme first, before the window exists.
        // The alarm engine (alarm/), ported from the native app, is this app's own plugin.
        registerPlugin(AlarmPlugin.class);
        // Calendar invites (.ics) opened with this app.
        registerPlugin(InvitePlugin.class);
        // The phone's clock format, place search and the maps app.
        registerPlugin(DevicePlugin.class);
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
    }
}
