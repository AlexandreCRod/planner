# Planner

A personal Android app that combines recurring tasks, a calendar and rich notes, all linked together. The phone holds the main copy of your data and works fully offline. Cloud sync to your own Cloudflare Worker is optional and off by default; see [server/README.md](server/README.md).

## Build and install

1. Install [Android Studio](https://developer.android.com/studio) and finish its setup wizard. The wizard installs the Android SDK.
2. In Android Studio, choose **File → Open** and pick this folder (`C:\Alex\Claude\Calendar`). Wait for the Gradle sync to finish.
   - **Java version:** the build needs **JDK 17 or 21**. Android Studio's bundled Java 25 is too new for this project's Gradle and Kotlin versions. If the sync fails, go to **Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK** and choose JDK 21. It's installed at `C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot`.
3. Install on your phone:
   1. On the phone, enable **Developer options**: go to **Settings → About phone** and tap **Build number** seven times.
   2. In **Developer options**, turn on **USB debugging** (or **Wireless debugging**).
   3. Connect the phone, choose it in the device dropdown, and press **Run ▶**.

From a terminal (with `JAVA_HOME` set to JDK 21), `gradlew installDebug` builds the app and installs it on the connected phone. `gradlew test` runs the unit tests.

On first launch, allow notifications. For alarms that are never delayed, open **Settings → Battery optimization** in the app and exclude Planner. On Android 14 and later, also allow **Full-screen alarms** on the same screen.

## What's inside

| Area | Features |
|---|---|
| **Tasks** | Grouped as Daily, Weekly, Monthly, Yearly, one-time and anytime. Any subset of weekdays, days of the month (including "last day") or months. Repeat every N days, weeks, months or years, with an optional end date. Each task chooses what happens when it is missed: **show as overdue** (the default), **carry over**, or **skip**. Streaks, best streak, completion rate and a 16-week history heatmap. Due-time countdowns. |
| **Calendar** | Day, 3-day, week, month, year and agenda views. Swipe to change period. Long-press to drag events to another time or day, and drag the bottom edge to resize. Tap an empty slot to create an event. Supports all-day and multi-day events. Editing one occurrence of a recurring item asks whether to change this occurrence only, this and following, or all. Public holidays for PT, BR, US, GB, FR, ES and DE. Filter by type or category. |
| **Reminders** | Each reminder is a **Notification** (silent), a **Reminder** (pops up with sound and snooze), or an **Alarm** (full screen, rings through silent mode, with its own sound). An item can have several reminders. Each category has a default reminder type. Quiet hours. Reminders are restored after a reboot. |
| **Notes** | Bold, italic, underline, strikethrough, text color, highlight, text sizes, bulleted and numbered lists, indentation, alignment, code, web links, undo and redo. Each note can have its own page color, a page pattern (lines, grid or dots) and a font. Templates, pinned notes, tags, version history and sharing. A daily note for every day, reachable from Today or any calendar day. |
| **Connections** | Link any note, task or event to any other. Typing `[[Title]]` in text links automatically. Selecting text in a note and choosing **Make task** or **Make event** creates a linked item. An Obsidian-style graph view supports focus mode, depth and type filters. |
| **Browse** | Search everything, filter by type (events, recurring events, tasks, recurring tasks, notes, daily notes), category or tag, and sort by date, title or number of links. |
| **Quick add** | Type plain text such as `Dentist tue 3pm remind 1h before #health !alarm` or `Gym every mon, wed and fri 18:30`. Dates with slashes are read as day/month. |
| **Other** | Home-screen widgets (today's tasks with checkboxes, and upcoming events). Light, dark and pure-black modes, 8 accent colors and Material You. Trash with restore. |

## Backups

Automatic backups run every hour or every day (configurable), or never. Each backup is a JSON file saved in `Android/data/com.alex.planner/files/backups`. You can also pick a second folder that receives a copy; Downloads or a folder your PC syncs both work. You can export to a file or restore from one at any time. Before a restore, the current data is saved as `before-restore.json`.

## Project layout

```
server/      optional Cloudflare Worker + Durable Object (cloud copy, change feed)
app/src/main/java/com/alex/planner/
  data/      Room entities, DAO, repository, settings
  domain/    recurrence engine, overdue/streak logic, quick-add parser, holidays
  alarm/     AlarmManager scheduling, notifications, full-screen alarm
  backup/    JSON backup/restore + WorkManager schedule
  sync/      client for the Cloudflare server
  widget/    Glance home-screen widgets
  ui/        Compose screens (today, calendar, tasks, notes, graph, browse, settings)
```
