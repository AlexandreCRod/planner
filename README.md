# Planner

A personal planner with recurring tasks, a calendar and rich notes, all linked together. It comes in two apps that share the same data:

- **Android app** (`app/`): the full app, with alarms, reminders, home-screen widgets and backups.
- **PC app** (`web/`): runs in any browser, and can be installed as a desktop app from Chrome or Edge.

Each app keeps its own full copy and works offline. They sync both ways through a small server you run on your own free Cloudflare account (`server/`). The server also hosts the PC app.

## What it does

| Area | Features |
|---|---|
| **Today** | The day at a glance: overdue tasks, the day's tasks with a progress bar, the schedule, and the day's note (its first two lines). The day switcher sits in the top bar: use the arrows (or swipe sideways on the phone, or press ← and → on the PC) to go to other days, or tap the date to pick one. Earlier days show what was done and what was missed, plus anything you ticked that day for another day (such as an overdue task). |
| **Tasks** | Repeat daily, weekly, monthly or yearly, on any subset of days (including "last day of the month"), every N days, weeks, months or years, with an optional end date. Each task chooses what happens when it's missed: **show as overdue** (the default), **carry over** to the next day, or **skip**. Priority (none, low, medium, high, urgent), streaks, a 16-week history grid, and due-time countdowns. A ticked task stays where it is for a moment before moving down (or out of the list), so it doesn't vanish under your finger; **Settings → Checked tasks** chooses how long (1 to 10 seconds, right away, or until you leave the page), and turning off **Show completed tasks on Today** takes them off today's list altogether. Repeating tasks and events carry a **↻** mark everywhere they appear. |
| **Calendar** | Day, 3-day, week, month, year and agenda views. The day grid opens showing 06:00 to 23:00; pinch (or Ctrl + scroll on the PC) to zoom, down to the whole day. Items with a time sit at their hour; all-day and multi-day items sit in the all-day row. Tap an empty slot to outline it, and tap it again to add an event there. Drag events to move them (an outline shows where they'll land, with the new time), and drag their bottom edge to resize. Editing one occurrence of a repeating item asks: this one only, this and following, or all. Public holidays for PT, BR, US, GB, FR, ES and DE. |
| **Alerts** | Each alert is a **silent notification**, a **reminder** (pops up with sound and snooze) or an **alarm** (full screen, rings through silent mode). An item can have several, so a reminder an hour before and an alarm at the time both work. From 23 hours before an alarm, its task or event shows when it will ring, with **Snooze** and **Don't ring** (that time only); 2 hours before, a notification offers the same. Quiet hours. Alerts survive reboots. |
| **Opening items** | Opening a task or event shows a simple view with only what it has (time, place, repeat, alerts, notes, history) and a box to tick it. **Edit** opens the editor, which also shows only the options in use; the rest (reminder, alarm, priority, notes, place, tags, category, link) are one tap away under **Add**. A place can be typed or filled in from where you are, and opens in Maps. |
| **Alarms** (phone) | A plain alarm clock page: alarms at a time, once or on chosen weekdays, each with a label, a colour and its own sound. They ring full screen like other alarms, with snooze, and show when the next one rings. |
| **Notes** | Bold, italic, underline, strikethrough, colours, highlight, text sizes, lists, multi-level checklists, alignment, links, undo and redo. Page colour, pattern and font per note. **Pictures** (from the gallery on the phone; picked, pasted or dropped on the PC) and a **place** (typed, or your current position, opens in Maps). Templates, pins, tags, version history, and a daily note for every day (listed under the Notes page's **Daily notes** chip). The formatting bar appears once you start writing. On a checkbox line, Enter keeps starting new boxes until you remove the box. Empty notes aren't kept. |
| **Connections** | Link any note, task or event to any other. Typing `[[Title]]` links automatically. Select text in a note and choose **Make task** or **Make event** to create a linked item. A graph view shows everything that's connected. |
| **Quick add** | Type a whole item in one line, such as `Dentist tue 3pm remind 1h before with alarm #health !high`. Dates, times, repeats, alerts, priority and tags are taken out, and what's left becomes the title. See [Quick add](#quick-add). |
| **Browse** | Search everything, filter by type (events, recurring events, tasks, recurring tasks, notes, daily notes), category or tag, and sort by date, title or number of links. |
| **Other** | Widgets (today's tasks with checkboxes, and upcoming events). Light, dark and pure-black themes, 8 accent colours and Material You. 24-hour or 12-hour clock, and date format (written, DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD). Long-press an icon (or hover on the PC) to see its name. On the phone, slide a finger along the bottom bar to move between pages. Trash with restore. |

## Tasks or events?

Both can have a date, a time, repeats, alerts, tags and links. The difference is what "done" means.

| | Task | Event |
|---|---|---|
| **What it is** | Something you have to **do** | Something that **happens** at a time |
| **Finished when** | You tick it | Its time passes, with nothing to tick |
| **If you don't act** | Shows as overdue, carries over or is skipped (your choice per task) | Nothing; it simply passes |
| **Time** | Optional: a due time, or just a day, or no date at all | A start and an end, or all day; can span several days |
| **Tracks** | Streaks, completion history, priority | Its place in the calendar |
| **Shows in** | Today's task list, the Tasks tab, the widget, and the calendar (optional) | Today's schedule, the calendar, the upcoming widget |

Use a **task** for "take vitamins every morning", "pay rent on the 1st" or "send the report by Friday": things that stay on your list until you do them. Use an **event** for "dentist Tuesday 15:00–16:00", "flight at 06:40" or "holiday 3–10 August": things that take up time whether or not you do anything. If you're not sure, ask yourself whether you would want to tick it off. Quick add makes a task by default (an event when you start it from the phone's calendar); quick add and the editor both let you switch.

## Quick add

| You type | It means |
|---|---|
| `today`, `tomorrow`, `fri`, `next mon`, `in 3 days`, `12/3`, `3 dec` | The day (dates with slashes are day/month) |
| `3pm`, `15:30`, `15h30`, `at 9`, `3pm-4:30pm`, `for 45m` | The time, end time or length (otherwise 1 hour) |
| `every day`, `weekdays`, `every mon, thu`, `every 2 weeks`, `monthly` | A repeat |
| `remind me`, `reminder 30 min before`, `remind 1 day before and 1 hour before` | Reminders |
| `!alarm`, `with alarm`, `alarm 10 min before`, or `alarm` as the last word | An alarm |
| `!notify`, `silent` | Makes the reminders silent notifications |
| `!high`, `high priority`, `!urgent` (also low, medium) | Priority |
| `#health` | A tag |

Everything that is understood is removed from the title: `Gym 18:30 every mon, wed and fri with alarm` creates a task called **Gym**. Words like "alarm" only count in the positions above, so `Buy alarm clock` stays as typed.

## Setting it up

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account, [Node.js](https://nodejs.org) 22 or newer, and (to build the phone app) [Android Studio](https://developer.android.com/studio).

### 1. The server and the PC app

```bash
cd server
npm install
npx wrangler login                     # sign in to Cloudflare in the browser
npx wrangler secret put API_TOKEN      # paste a long random string: this is your sync password
cd ../web && npm install && npm run build && cd ../server
npx wrangler deploy                    # prints your address, https://planner-sync.<your-subdomain>.workers.dev
```

Open that address in Chrome or Edge and enter the same password. To install it as a desktop app, use **Install Planner** in the address bar. More detail is in [server/README.md](server/README.md).

### 2. The phone app

1. In Android Studio, choose **File → Open** and pick the folder where you cloned this repository. Wait for the Gradle sync to finish.
   - The build needs **JDK 17 or 21**. If Android Studio's bundled Java is newer and the sync fails, set **Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK** to a JDK 21.
2. On the phone, enable **Developer options** (tap **Settings → About phone → Build number** seven times), then turn on **USB debugging** or **Wireless debugging**.
3. Connect the phone, choose it in the device list, and press **Run ▶**. From a terminal, `gradlew installDebug` does the same.
4. In the app, open **Settings → Cloud sync**, turn it on, enter your server address and password, then tap **Save** and **Test**.

On first launch, allow notifications. For alarms that are never delayed, open **Settings → Battery optimization** in the app and set Planner to unrestricted. On Android 14 and later, also allow **Full-screen alarms** there.

### Updating the phone app

- **From the computer:** run the app again from Android Studio, or `gradlew installDebug`, over USB or wireless debugging. Your data stays. If **Developer options** has disappeared from the phone (a system update or its own switch can turn it off), tap **Settings → About phone → Build number** seven times again.
- **From a GitHub release:** each release on the repository's **Releases** page has the phone app attached as `planner-<version>.apk`. Open the latest release on the phone (signed in to GitHub, since the repository is private), download the file and open it. Allow your browser to install apps when Android asks. Android then offers to **update** Planner, and your data stays.
  - To make a release, raise `versionCode` and `versionName` in `app/build.gradle.kts`, run `gradlew assembleDebug`, and attach `app/build/outputs/apk/debug/app-debug.apk` (renamed to `planner-<version>.apk`) to a new GitHub release.
  - This only works when the new `.apk` is signed with the same key as the installed app. Debug builds are signed with the debug key of the computer that built them, so build releases on the same computer. An `.apk` signed with a different key can't update the app: Android would ask you to uninstall first, which removes the phone's copy (you can bring it back afterwards with **Restore** from the cloud).

## Sync

Each device sends what changed since its last sync and receives what changed elsewhere. The phone syncs about 20 seconds after a change, whenever you open the app, and hourly in the background. The PC syncs a moment after a change, every 30 seconds while open, and when the window regains focus.

When the same thing was changed on both devices before they synced, an edit always beats a delete, and otherwise the **phone's version wins**. The server refuses a sync that would delete all items, or more than half of 20 or more, until you confirm, and it keeps a full copy per day for 14 days.

## Backups

The phone also writes a backup file every hour or every day (or never), saved in the app's folder under `Android/data`, plus a copy in a folder you choose, such as Downloads. The last 10 are kept. You can export or restore a file at any time; before a restore, the current data is saved as `before-restore.json`. Backup files hold everything except picture files, which come back from the cloud.

## Project layout

```
server/      Cloudflare Worker + Durable Object: sync, picture storage, hosts the PC app
web/         PC app (React + TypeScript, built into web/dist)
app/src/main/java/…/planner/
  data/      Room database, repository, settings, picture files
  domain/    repeats, overdue and streak logic, quick add, date and time formats, holidays
  alarm/     alarm scheduling, notifications, full-screen alarm, early snooze and stop, clock alarms
  backup/    backup files and their schedule
  sync/      sync with the server
  widget/    home-screen widgets
  ui/        screens (today, calendar, tasks, notes, alarms, graph, browse, settings)
```

## Development

| | Command |
|---|---|
| Phone tests | `gradlew test` (with `JAVA_HOME` set to a JDK 17 or 21) |
| PC tests | `npm test` in `web/` |
| Server tests | `npm test` and `npm run typecheck` in `server/`; `npm run e2e` against a local server |
| Local server | `npm run dev` in `server/` (needs a `.dev.vars` file with `API_TOKEN=dev-token`) |
| PC app with live reload | `npx vite` in `web/`, then open http://127.0.0.1:5173 (it forwards `/api` to the local server) |
| Publish the PC app and server | `npm run build` in `web/`, then `npx wrangler deploy` in `server/` |
