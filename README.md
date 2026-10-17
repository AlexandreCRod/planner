# Planner

Planner is a calm, simple app for your day. It keeps your tasks, calendar, notes and alarms in one place, and links them together. It works on your Android phone and in a browser on your PC. Everything works offline, and the two stay in sync through a small server that you run yourself on a free Cloudflare account.

## What you can do

**Today**
- See your day at a glance, with a progress bar.
- Tick off your routine chips and your tasks.
- Read your schedule and today's note.
- Look ahead at the next days.

**Calendar**
- Switch between week, month and year views.
- Tap an empty slot twice to add something there.
- Hide routines from the calendar with one switch in its menu.

**Tasks**
- Two lists: **Scheduled** and **To-do**. Swipe sideways to switch between them.

**Notes**
- Write notes and checklists.
- Drag checklist items to reorder them.
- Select several notes to delete them at once.

**Links**
- A graph shows how your notes, tasks and events connect.
- Drag the nodes around. They bounce.

**Search**
- Find anything. Select several results to delete them together.

**Alarms**
- Alarms show the weather.
- Pause an alarm, or skip days or specific dates.
- Filter alarms by Weekday and Weekend.
- Also a timer, a stopwatch and a world clock with weather.

**Everywhere**
- Hold a time to open a time wheel.
- Home screen widgets.
- Works in split screen.
- Calendar invites (`.ics` files) open straight in the app.
- Two-way sync with your own server.
- Follows your phone's 24-hour setting.
- Place suggestions, and opening a place in Maps.
- Calm colours.

## Install on your phone

1. On your phone, open this repository's **Releases** page and pick the latest release.
2. Download the Planner `.apk` file.
3. Android may ask you to allow installing apps from your browser. Allow it.
4. Open the downloaded file and tap **Install**.
5. Open Planner. Allow notifications when asked.
6. The first time you open it, enter your server address and sync password (see the next section).

**Updates.** When a new version is out, Planner offers it when you open the app. Tap **Update**, then **Install**. You can also tap **Check for updates** in Settings.

For alarms that are never late, open the app's settings and allow **Full-screen alarms**. Also set Planner's battery use to unrestricted in Android.

## Set up sync (your own free server)

Sync is optional. Without it, the app works fine on one device.

1. Make a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and install [Node.js](https://nodejs.org) 22 or newer.
2. In a terminal, go to the `server` folder and run `npm install`, then `npx wrangler login`.
3. Run `npx wrangler secret put API_TOKEN` and paste a long random string. This is your sync password. Keep it private.
4. Build the PC app (`npm install` and `npm run build` in the `web` folder), then run `npx wrangler deploy` in `server`.
5. It prints your address, like `https://planner-sync.<your-subdomain>.workers.dev`.
6. Open Planner on your phone and enter that address and your password on the first screen. You can change them later in **Settings**.

Full details are in [server/README.md](server/README.md).

## Using the app

**Today.** Tap a task to tick it. Use the arrows or swipe sideways to look at other days. Tap the date to pick one.

**Calendar.** Pick week, month or year from the view menu. Tap an empty slot once to mark it, and tap it again to add an event or task. Drag an item to move it.

**Tasks.** Swipe sideways to go between **Scheduled** and **To-do**. Swipe a row to remove it. You get a few seconds to undo, then it goes to the trash for a while.

**Notes.** Tap to write. Hold and drag the handle on a checklist line to move it. Hold a note to select it, then tap more notes and delete them together.

**Links.** Open it from the Notes page. Drag a node to move it. Tap one to open that item.

**Search.** Type to find tasks, events and notes. Hold a result to start selecting.

**Alarms.** Tap the **+** button to add an alarm, timer, stopwatch or world clock. Open an alarm to pause it or to skip days or dates.

**Handy gestures**
- Double-tap a tab at the bottom to bring that page back to its start.
- Slide your finger along the bottom bar to move between pages.
- Hold the hours or minutes of a time to open the time wheel.
- Tap a place to open it in Maps.
- Open a `.ics` invite from your email or files and Planner offers to add it.

## PC version

The server also hosts the PC version.

1. Open your server address in Chrome or Edge.
2. Enter your sync password.
3. To install it like a desktop app, click **Install Planner** in the address bar.

## Privacy

- Your data stays on your phone and on your own server. There is no one else's server in between, and no account.
- Weather comes from [Open-Meteo](https://open-meteo.com). Only the city's coordinates are sent.
- Place suggestions use the phone's own geocoder. On the PC they use OpenStreetMap.
