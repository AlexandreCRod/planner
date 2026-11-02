import assert from "node:assert/strict";
import { test } from "node:test";
import { WEEKDAYS, WEEKEND } from "../src/domain/alarms.ts";
import { shownBy, toggleFilter } from "../src/domain/clockList.ts";

const fri = new Date(2026, 9, 30, 9, 0); // a Friday
const alarm = (h: number, m: number, days = 0, enabled = true, more: object = {}) => ({ id: h * 60 + m, hour: h, minute: m, days, enabled, ...more });

test("the alarm filters: none on shows everything, a chip filters, a second tap clears it (71)", () => {
  const list = [alarm(6, 30, WEEKDAYS), alarm(8, 30, WEEKEND), alarm(13, 15, 0, false), alarm(21, 45, 127)];
  const ids = (f: Parameters<typeof shownBy>[1]) => list.filter((a) => shownBy(a, f, fri)).map((a) => a.id);
  assert.deepEqual(ids(null), list.map((a) => a.id));
  assert.deepEqual(ids("on"), [390, 510, 1305]);
  assert.deepEqual(ids("off"), [795]);
  assert.deepEqual(ids("weekdays"), [390, 795, 1305]); // the one-off rings today, a Friday
  assert.deepEqual(ids("weekend"), [510, 1305]);
  assert.equal(toggleFilter(null, "on"), "on");
  assert.equal(toggleFilter("on", "weekend"), "weekend");
  assert.equal(toggleFilter("weekend", "weekend"), null);
});

test("only alarms with exactly the same days bundle (73)", async () => {
  const { bundleAlarms } = await import("../src/domain/clockList.ts");
  const names = (g: { hour: number; minute: number }[][]) => g.map((x) => x.map((a) => `${a.hour}:${String(a.minute).padStart(2, "0")}`));
  // The review's case: a Tue/Thu 07:15 gym alarm no longer joins the weekday 06:30–06:50 ones.
  const list = [alarm(6, 30, WEEKDAYS), alarm(6, 40, WEEKDAYS), alarm(6, 50, WEEKDAYS), alarm(7, 15, 0b0001010), alarm(7, 20, 0b0001010), alarm(6, 45, WEEKEND)];
  assert.deepEqual(names(bundleAlarms(list, fri)), [["6:30", "6:40", "6:50"], ["6:45"], ["7:15", "7:20"]]);
  // Chosen dates bundle only with the same dates; one-offs with those ringing the same day.
  const dated = [alarm(9, 0, 0, true, { dates: [20760, 20761] }), alarm(9, 5, 0, true, { dates: [20761, 20760] }), alarm(9, 10, 0, true, { dates: [20760] })];
  assert.deepEqual(names(bundleAlarms(dated, fri)), [["9:00", "9:05"], ["9:10"]]);
  // At 09:00 a one-off at 08:50 rings tomorrow, one at 09:10 today: not the same day.
  assert.deepEqual(names(bundleAlarms([alarm(8, 50), alarm(9, 10), alarm(9, 5)], fri)), [["8:50"], ["9:05", "9:10"]]);
  // Skips don't split a bundle.
  assert.equal(bundleAlarms([alarm(6, 30, WEEKDAYS, true, { skip: [20761] }), alarm(6, 40, WEEKDAYS)], fri).length, 1);
});

test("moving a bundle's heading time shifts every alarm, and the bundles form again (110)", async () => {
  const { bundleAlarms, shiftBundle } = await import("../src/domain/clockList.ts");
  const hm = (l: { hour: number; minute: number }[]) => l.map((a) => a.hour * 60 + a.minute);
  const group = [alarm(6, 30, WEEKDAYS), alarm(6, 40, WEEKDAYS), alarm(6, 55, WEEKDAYS)];
  assert.deepEqual(hm(shiftBundle(group, 7 * 60)), [420, 430, 445]);
  assert.deepEqual(hm(shiftBundle(group, 6 * 60)), [360, 370, 385]);
  // Never past midnight: the last alarm stops at 23:59, the first at 00:00.
  assert.deepEqual(hm(shiftBundle(group, 23 * 60 + 50)), [1414, 1424, 1439]);
  assert.deepEqual(hm(shiftBundle([alarm(0, 10, 1), alarm(0, 20, 1)], 23 * 60 + 50)), [1429, 1439]);
  assert.deepEqual(hm(shiftBundle([alarm(0, 10, 1), alarm(0, 20, 1)], 0)), [0, 10]);
  // After the shift, a nearby alarm with the same days joins; the window decides (19 min by default).
  const other = alarm(7, 20, WEEKDAYS);
  assert.equal(bundleAlarms([...group, other], fri).length, 2); // 06:55, then 07:20: 25 min apart
  assert.equal(bundleAlarms([...shiftBundle(group, 6 * 60 + 40), other], fri).length, 1); // 07:05, then 07:20: joins
  assert.equal(bundleAlarms([...shiftBundle(group, 6 * 60), other], fri).length, 2);
  // A window of 0 bundles nothing; a wider one takes more.
  assert.equal(bundleAlarms(group, fri, 0).length, 3);
  assert.equal(bundleAlarms([...group, other], fri, 25).length, 1);
});

test("skip the next ring or tomorrow's, for an alarm or a whole bundle (75)", async () => {
  const { skipDay, skipNext, skipTomorrow, unskip, skipText, upcomingSkips } = await import("../src/domain/clockList.ts");
  const today = 20756; // Fri 30 Oct 2026
  assert.equal(new Date(today * 86_400_000).getUTCDay(), 5);
  const at = (h: number, m: number) => new Date(2026, 9, 30, h, m);
  // A weekday alarm at 06:30, seen at 09:00 on Friday: next is Monday, tomorrow (Saturday) it doesn't ring.
  const wk = alarm(6, 30, WEEKDAYS);
  assert.deepEqual(skipNext([wk], fri).map((a) => a.skip), [[today + 3]]);
  assert.deepEqual(skipTomorrow([wk], fri), []);
  // Seen at 06:00, its next ring is today's.
  assert.deepEqual(skipNext([wk], at(6, 0)).map((a) => a.skip), [[today]]);
  // An every-day alarm at 21:45: next is tonight, tomorrow is Saturday's.
  const ev = alarm(21, 45, 127);
  assert.deepEqual(skipNext([ev], fri)[0].skip, [today]);
  assert.deepEqual(skipTomorrow([ev], fri)[0].skip, [today + 1]);
  // A one-off is switched off instead, only for the day it rings.
  const once = alarm(13, 15);
  assert.equal(skipNext([once], fri)[0].enabled, false);
  assert.equal(skipTomorrow([once], fri).length, 0);
  assert.equal(skipTomorrow([alarm(8, 0)], fri)[0].enabled, false); // 08:00 has passed: it rings tomorrow
  // Off alarms and passed rings have nothing to skip.
  assert.equal(skipDay(alarm(7, 0, 127, false), today + 1, fri), null);
  assert.equal(skipDay(alarm(7, 0, 127), today, fri), null);
  // A bundle at 06:30–06:50 seen at 06:35: the next ring is today's 06:40, so 06:40 and 06:50 skip today;
  // 06:30 has rung already and is left alone.
  const bundle = [alarm(6, 30, 127), alarm(6, 40, 127), alarm(6, 50, 127, false), alarm(6, 55, 127)];
  const skipped = skipNext(bundle, at(6, 35));
  assert.deepEqual(skipped.map((a) => [a.minute, a.skip]), [[40, [today]], [55, [today]]]);
  assert.deepEqual(skipTomorrow(bundle, at(6, 35)).map((a) => a.minute), [30, 40, 55]);
  // The card's note, and ringing as usual again.
  const short = (d: number) => `Day ${d}`;
  assert.equal(skipText({ ...wk, skip: [today + 3] }, today, short), `Skips Day ${today + 3}`);
  assert.equal(skipText({ ...ev, skip: [today + 1] }, today, short), "Skips tomorrow");
  assert.equal(skipText({ ...ev, skip: [today, today + 1] }, today, short), "Skips 2 days");
  assert.equal(skipText({ ...wk, skip: [today + 1] }, today, short), ""); // Saturday: it doesn't ring then anyway
  assert.deepEqual(upcomingSkips({ ...ev, skip: [today - 2, today + 1] }, today), [today + 1]);
  assert.deepEqual(unskip({ ...ev, skip: [today - 2, today + 1] }, today)?.skip, [today - 2]);
  assert.equal(unskip(ev, today), null);
});

test("the weather app picker's search: by name or package, accents ignored, starting matches first (83)", async () => {
  const { filterApps } = await import("../src/domain/apps.ts");
  const apps = [{ component: "com.google.android.apps.weather/.Main", label: "Weather" }, { component: "com.accuweather.android/.Main", label: "AccuWeather" },
    { component: "pt.ipma.meteo/.Main", label: "IPMA Météo" }, { component: "com.whatsapp/.Main", label: "WhatsApp" }];
  assert.deepEqual(filterApps(apps, "").map((a) => a.label), ["AccuWeather", "IPMA Météo", "Weather", "WhatsApp"]);
  assert.deepEqual(filterApps(apps, "weather").map((a) => a.label), ["Weather", "AccuWeather"]);
  assert.deepEqual(filterApps(apps, "meteo").map((a) => a.label), ["IPMA Météo"]);
  assert.deepEqual(filterApps(apps, "ipma").map((a) => a.label), ["IPMA Météo"]);
  assert.deepEqual(filterApps(apps, "zzz"), []);
});

test("a series is one bundle: whatever the window, whatever else is near it (244)", async () => {
  const { bundleAlarms } = await import("../src/domain/clockList.ts");
  const a = alarm(7, 0, 0, true, { series: 5 }), b = alarm(7, 40, 0, true, { series: 5 }), c = alarm(7, 20, 0, true, { series: 5 });
  const plain = alarm(7, 5), other = alarm(7, 10, 0, true, { series: 6 });
  const names = (g: { hour: number; minute: number }[][]) => g.map((b) => b.map((a) => a.hour * 60 + a.minute));
  // The plain 07:05 doesn't join though it's within the window, and a window of 0 doesn't split the series.
  assert.deepEqual(names(bundleAlarms([a, plain, b, c, other], fri)), [[420, 440, 460], [425], [430]]);
  assert.deepEqual(names(bundleAlarms([a, b, c], fri, 0)), [[420, 440, 460]]);
  // Partly rung, a one-off series stays together: 07:00 has passed (so it's tomorrow's) and 12:00 is today's.
  const noon = alarm(12, 0, 0, true, { series: 7 }), early = alarm(7, 0, 0, true, { series: 7 });
  assert.equal(bundleAlarms([early, noon], fri).length, 1);
});

test("a series' times: 07:00 to 08:00 every 10 min is seven alarms; the end is a limit (244)", async () => {
  const { seriesTimes, seriesProblem, SERIES_MAX } = await import("../src/domain/clockList.ts");
  assert.deepEqual(seriesTimes({ from: 420, to: 480, every: 10 }), [420, 430, 440, 450, 460, 470, 480]);
  assert.deepEqual(seriesTimes({ from: 420, to: 475, every: 20 }), [420, 440, 460]);
  assert.equal(seriesProblem({ from: 420, to: 480, every: 10 }), null);
  assert.match(seriesProblem({ from: 480, to: 420, every: 10 })!, /after the start/);
  assert.match(seriesProblem({ from: 420, to: 425, every: 10 })!, /only one/);
  assert.match(seriesProblem({ from: 0, to: 600, every: 1 })!, new RegExp(`Up to ${SERIES_MAX}`));
  assert.equal(seriesProblem({ from: 420, to: 420 + SERIES_MAX - 1, every: 1 }), null);
});

test("editing a series keeps the alarms still at their times, adds new ones and drops the rest (244)", async () => {
  const { buildSeries, seriesPlan } = await import("../src/domain/clockList.ts");
  const base = { id: 1, hour: 7, minute: 0, days: WEEKDAYS, enabled: false, label: "Wake" };
  const was = [{ ...base, id: 1, series: 9 }, { ...base, id: 2, minute: 10, series: 9 }, { ...base, id: 3, minute: 20, series: 9 }];
  assert.deepEqual(seriesPlan(was), { from: 420, to: 440, every: 10 });
  const { save, remove } = buildSeries(was[0], { from: 430, to: 450, every: 10 }, was, 9, 1000);
  assert.deepEqual(save.map((a) => [a.id, a.hour, a.minute]), [[2, 7, 10], [3, 7, 20], [1000, 7, 30]]);
  assert.deepEqual(remove, [1]);
  // All on again, with the same days and label, in the same series.
  assert.ok(save.every((a) => a.enabled && a.days === WEEKDAYS && a.label === "Wake" && a.series === 9));
  // A new one takes ids one after the other, none repeated.
  const fresh = buildSeries({ ...base, id: 0 }, { from: 420, to: 440, every: 10 }, [], 50, 50);
  assert.deepEqual(fresh.save.map((a) => a.id), [50, 51, 52]);
});

test("a card's Skip: it skips the next ring, then shows Undo, which brings only that day back (317)", async () => {
  const { skipNext, skippedNext, unskipDay, skipsOn } = await import("../src/domain/clockList.ts");
  const today = 20756; // Fri 30 Oct 2026, seen at 09:00
  const wk = alarm(6, 30, WEEKDAYS), b2 = alarm(6, 40, WEEKDAYS);
  assert.equal(skippedNext([wk], fri), null);
  // Skip on the card: Monday's ring goes; the card now has Undo for Monday.
  const s = skipNext([wk], fri);
  assert.deepEqual(s[0].skip, [today + 3]);
  assert.equal(skippedNext(s, fri), today + 3);
  assert.equal(skipsOn(today + 3, today, (d) => `Day ${d}`), `Skips Day ${today + 3}`);
  assert.equal(skipsOn(today + 1, today, String), "Skips tomorrow");
  // An older skip further on doesn't count: the next ring still rings.
  assert.equal(skippedNext([{ ...wk, skip: [today + 4] }], fri), null);
  // Undo takes out only that day, not the other skips.
  assert.deepEqual(unskipDay([{ ...wk, skip: [today + 3, today + 10] }], today + 3).map((a) => a.skip), [[today + 10]]);
  assert.deepEqual(unskipDay([wk], today + 3), []);
  // A bundle shows Undo only when all its alarms skip that morning; one row skipped alone doesn't.
  assert.equal(skippedNext([{ ...wk, skip: [today + 3] }, b2], fri), null);
  const both = skipNext([{ ...wk, skip: [today + 3] }, b2], fri);
  assert.deepEqual(both.map((a) => a.minute), [40]); // the first already skipped Monday, so only 06:40 changes
  assert.equal(skippedNext([{ ...wk, skip: [today + 3] }, ...both], fri), today + 3);
  // A pause counts as quiet days, not as a skipped next ring: after the pause it's that ring.
  assert.equal(skippedNext([{ ...wk, pausedUntil: today + 10 }], fri), null);
  // A one-off is switched off by Skip, so it has nothing to undo on the card (the message's Undo does it).
  const once = skipNext([alarm(13, 15)], fri);
  assert.equal(once[0].enabled, false);
  assert.equal(skippedNext(once, fri), null);
});

test("Skip days: the rings of a window, day by day, bundled, with skipped and paused ones marked (317)", async () => {
  const { ringsBetween, ringKey, windowKeys, SKIP_WINDOW_DAYS } = await import("../src/domain/clockList.ts");
  const today = 20756; // Fri 30 Oct 2026, seen at 09:00
  const w1 = alarm(7, 0, WEEKDAYS), w2 = alarm(7, 10, WEEKDAYS, true, { skip: [today + 4] });
  const gym = alarm(6, 15, 0b0001010, true, { pausedUntil: today + 7 }); // Tue Thu, paused a week
  const night = alarm(21, 45, 127), off = alarm(8, 0, 127, false), once = alarm(15, 30);
  const days = ringsBetween([w1, w2, gym, night, off, once], today, today + 4, fri);
  const view = days.map((d) => [d.day - today, d.entries.map((e) => e.rings.map((r) => `${r.alarm.id}${r.off ? "-" : ""}`).join("+"))]);
  assert.deepEqual(view, [
    [0, ["930", "1305"]], // today: the one-off at 15:30 and tonight's 21:45; 07:00 has passed
    [1, ["1305"]], // Saturday
    [2, ["1305"]],
    [3, ["420+430", "1305"]], // Monday: the weekday bundle, as one entry
    [4, ["375-", "420+430-", "1305"]], // Tuesday: gym is paused, 07:10 skips it; both listed as already off
  ]);
  assert.equal(windowKeys(days).length, 11);
  assert.ok(windowKeys(days).includes(ringKey(w2.id, today + 4)));
  // Days with no ring are left out; the window never runs past the cap.
  assert.deepEqual(ringsBetween([w1], today + 1, today + 2, fri), []);
  assert.equal(ringsBetween([night], today, today + 400, fri).length, SKIP_WINDOW_DAYS);
});

test("Skip days: saving writes skip days (or switches a one-off off), unticked rings ring, a pause becomes skips (317)", async () => {
  const { ringsBetween, ringKey, windowKeys, windowCount, applyWindow } = await import("../src/domain/clockList.ts");
  const { ringsOnDay } = await import("../src/domain/alarms.ts");
  const today = 20756; // Fri 30 Oct 2026, seen at 09:00
  const w1 = alarm(7, 0, WEEKDAYS), w2 = alarm(7, 10, WEEKDAYS, true, { skip: [today - 3] }), once = alarm(15, 30);
  const night = alarm(21, 45, 127);
  // Mon–Wed, all ticked except Tuesday's 07:10: it keeps ringing; the one-off isn't in the window.
  const days = ringsBetween([w1, w2, once, night], today + 3, today + 5, fri);
  const ticks = new Set(windowKeys(days));
  ticks.delete(ringKey(w2.id, today + 4));
  assert.deepEqual(windowCount(days, ticks), { skips: 8, back: 0 });
  const saved = applyWindow(days, ticks, today);
  const byId = new Map(saved.map((a) => [a.id, a]));
  assert.deepEqual(byId.get(w1.id)?.skip, [today + 3, today + 4, today + 5]);
  assert.deepEqual(byId.get(w2.id)?.skip, [today + 3, today + 5]); // the old, past skip is dropped
  assert.deepEqual(byId.get(night.id)?.skip, [today + 3, today + 4, today + 5]);
  assert.equal(byId.has(once.id), false);
  // What the alarms now do on Tuesday: only 07:10 rings.
  const tue = today + 4;
  assert.deepEqual(saved.filter((a) => ringsOnDay(a, tue)).map((a) => a.id), [w2.id]);
  // Today: the one-off in the window is switched off rather than given a skip day.
  const t = ringsBetween([once], today, today, fri);
  assert.equal(applyWindow(t, new Set(windowKeys(t)), today)[0].enabled, false);
  assert.deepEqual(applyWindow(t, new Set(), today), []); // unticked: nothing changes
  // A paused alarm (an older build's pause) shows its rings as off; unticking one makes it ring: the pause
  // turns into skip days and is cleared.
  const gym = alarm(6, 15, 0b0001010, true, { pausedUntil: today + 14 }); // Tue Thu
  const g = ringsBetween([gym], today, today + 6, fri);
  assert.deepEqual(g.map((d) => [d.day - today, d.entries[0].rings[0].off]), [[4, true], [6, true]]);
  const keep = new Set(windowKeys(g));
  keep.delete(ringKey(gym.id, today + 6)); // Thursday rings after all
  assert.deepEqual(windowCount(g, keep), { skips: 0, back: 1 });
  const [ng] = applyWindow(g, keep, today);
  assert.equal(ng.pausedUntil, null);
  assert.deepEqual(ng.skip, [today + 4, today + 11, today + 13]); // the pause's Tue/Thu, less this Thursday
  assert.equal(ringsOnDay(ng, today + 6), true);
  // Saving the window as it is changes nothing for an alarm without a pause.
  const same = ringsBetween([{ ...night, skip: [today + 1] }], today + 1, today + 1, fri);
  assert.deepEqual(applyWindow(same, new Set(windowKeys(same)), today), []);
});

test("Skip days' quick choices: next ring, tomorrow, rest of the week to Sunday, 7 days, 2 weeks (317)", async () => {
  const { quickWindows } = await import("../src/domain/clockList.ts");
  const mon = 20759; // Mon 2 Nov 2026
  assert.deepEqual(quickWindows(mon, mon + 1).map(([n, a, b]) => [n, a - mon, b - mon]),
    [["Next ring", 1, 1], ["Tomorrow", 1, 1], ["Rest of week", 1, 6], ["Next 7 days", 1, 7], ["2 weeks", 1, 14]]);
  // Saturday: the rest of the week is Sunday only, the same as tomorrow, so it isn't offered; nor with no ring.
  assert.deepEqual(quickWindows(mon + 5, null).map(([n]) => n), ["Tomorrow", "Next 7 days", "2 weeks"]);
});
