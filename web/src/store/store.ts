// The PC app's local copy of every record, plus the same operations as the Android Repository.
// Records are keyed like the sync server: "<kind>/<id>". Every change is saved to IndexedDB and
// queues a sync.
import { useSyncExternalStore } from "react";
import * as db from "./db.ts";
import { newId, tagIdFor } from "../domain/ids.ts";
import { parseDays } from "../domain/recurrence.ts";
import { doneTodosToTrash, expiredTrash, staleVersions } from "../domain/retention.ts";
import { CompletionIndex } from "../domain/schedule.ts";
import { stripHtml } from "../domain/text.ts";
import {
  type Category, type Completion, type Item, type ItemTag, type Link, type NoteImage, type NoteVersion, type Reminder, type Tag,
  TYPE_COLORS, cssColor, isRecurring, newItem,
} from "../domain/types.ts";

export const KINDS = ["categories", "tags", "items", "completions", "reminders", "itemTags", "links", "versions", "images"] as const;
export type Kind = (typeof KINDS)[number];
type Rec = Record<string, unknown>;

export function keyOf(kind: Kind, r: Rec): string {
  switch (kind) {
    case "completions": return `${r.itemId}:${r.day}`;
    case "itemTags": return `${r.itemId}:${r.tagId}`;
    case "links": return `${r.sourceId}:${r.targetId}`;
    default: return String(r.id);
  }
}

const records = new Map<string, Rec>(); // "kind/id" -> record
let version = 0;
let snap: Snapshot | null = null;
const listeners = new Set<() => void>();
let onChange: () => void = () => {};

export function setChangeHook(fn: () => void) { onChange = fn; }

export function allRecords() { return records; }

function rk(kind: Kind, r: Rec) { return `${kind}/${keyOf(kind, r)}`; }
function put(kind: Kind, r: object) { records.set(rk(kind, r as Rec), r as Rec); }
function del(kind: Kind, r: object) { records.delete(rk(kind, r as Rec)); }
function list<T>(kind: Kind): T[] {
  const out: T[] = [];
  const prefix = kind + "/";
  for (const [k, v] of records) if (k.startsWith(prefix)) out.push(v as T);
  return out;
}

let saveTimer: number | undefined;
let unsaved = false;
const writeNow = () => { clearTimeout(saveTimer); saveTimer = undefined; unsaved = false; return db.put("records", [...records.entries()]); };
/** Call after any change: refreshes the UI, saves to IndexedDB and lets sync know. */
export function changed(fromSync = false) {
  version++;
  snap = null;
  listeners.forEach((l) => l());
  clearTimeout(saveTimer);
  unsaved = true;
  saveTimer = window.setTimeout(() => void writeNow(), 250);
  if (!fromSync) onChange();
}

const flushers = new Set<() => void>();
/**
 * An editor with a save still waiting (its debounce) registers it here, so it's done before the app
 * can be closed. Returns the unregister.
 */
export function onFlush(fn: () => void): () => void {
  flushers.add(fn);
  return () => { flushers.delete(fn); };
}
/**
 * Saves everything now: editors' waiting saves, then IndexedDB without the usual 250 ms wait. Called
 * when the app is put away (pause, hidden, pagehide), since a WebView in the background can be killed
 * before any timer runs.
 */
export function flushAll(): Promise<void> {
  flushers.forEach((f) => { try { f(); } catch { /* one editor failing mustn't stop the rest */ } });
  return unsaved ? writeNow() : Promise.resolve();
}

export async function load() {
  const saved = await db.get<[string, Rec][]>("records");
  records.clear();
  for (const [k, v] of saved ?? []) records.set(k, v);
  changed(true);
}

/** Replaces records from sync: data null = deleted. */
export function applyRemote(changes: { kind: Kind; id: string; data: Rec | null }[]) {
  for (const c of changes) {
    const key = `${c.kind}/${c.id}`;
    if (c.data === null) records.delete(key);
    else records.set(key, c.data);
  }
  if (changes.length) changed(true);
}

// ---------- Read side: a snapshot like the Android app's ----------

export class Snapshot {
  readonly allItems = list<Item>("items");
  readonly items = this.allItems.filter((i) => i.deletedAt === null);
  readonly trash = this.allItems.filter((i) => i.deletedAt !== null).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  readonly completions = list<Completion>("completions");
  readonly done = new CompletionIndex(this.completions);
  readonly categories = list<Category>("categories").sort((a, b) => a.name.localeCompare(b.name));
  readonly tags = list<Tag>("tags").sort((a, b) => a.name.localeCompare(b.name));
  readonly links = list<Link>("links");
  readonly byId = new Map(this.items.map((i) => [i.id, i]));
  readonly categoryById = new Map(this.categories.map((c) => [c.id, c]));
  readonly reminders = new Map<number, Reminder[]>();
  readonly tagsByItem = new Map<number, Tag[]>();
  readonly versions = new Map<number, NoteVersion[]>();
  /** Pictures per note, oldest first. */
  readonly images = new Map<number, NoteImage[]>();

  constructor() {
    for (const r of list<Reminder>("reminders")) this.reminders.set(r.itemId, [...(this.reminders.get(r.itemId) ?? []), r]);
    const tagById = new Map(this.tags.map((t) => [t.id, t]));
    for (const it of list<ItemTag>("itemTags")) {
      const t = tagById.get(it.tagId);
      if (t) this.tagsByItem.set(it.itemId, [...(this.tagsByItem.get(it.itemId) ?? []), t]);
    }
    for (const v of list<NoteVersion>("versions")) this.versions.set(v.itemId, [...(this.versions.get(v.itemId) ?? []), v]);
    for (const vs of this.versions.values()) vs.sort((a, b) => b.savedAt - a.savedAt);
    for (const i of list<NoteImage>("images")) this.images.set(i.itemId, [...(this.images.get(i.itemId) ?? []), i]);
    for (const is of this.images.values()) is.sort((a, b) => a.createdAt - b.createdAt);
  }

  colorOf(item: Item): string {
    if (item.color !== null) return cssColor(item.color);
    const c = item.categoryId !== null ? this.categoryById.get(item.categoryId) : undefined;
    return c ? cssColor(c.color) : TYPE_COLORS[item.type];
  }

  neighbours(id: number): Set<number> {
    const out = new Set<number>();
    for (const l of this.links) {
      if (l.sourceId === id && this.byId.has(l.targetId)) out.add(l.targetId);
      if (l.targetId === id && this.byId.has(l.sourceId)) out.add(l.sourceId);
    }
    return out;
  }
}

export function snapshot(): Snapshot {
  if (!snap) snap = new Snapshot();
  return snap;
}

/** Calls [fn] after every change (local or from sync). Returns the unsubscribe. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useSnapshot(): Snapshot {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version);
  return snapshot();
}

// ---------- Write side: same operations as the Android Repository ----------

export interface SaveOptions { reminders?: Reminder[]; tags?: string[] }

export function saveItem(item: Item, opts: SaveOptions = {}): number {
  const now = Date.now();
  const isNew = item.id === 0;
  const saved: Item = { ...item, id: isNew ? newId() : item.id, createdAt: isNew ? now : item.createdAt, updatedAt: now };
  put("items", saved);
  const id = saved.id;
  if (opts.reminders) {
    for (const r of list<Reminder>("reminders")) if (r.itemId === id) del("reminders", r);
    for (const r of opts.reminders) put("reminders", { ...r, id: r.id || newId(), itemId: id });
  }
  if (opts.tags) setTags(id, opts.tags);
  changed();
  return id;
}

function setTags(itemId: number, names: string[]) {
  for (const it of list<ItemTag>("itemTags")) if (it.itemId === itemId) del("itemTags", it);
  const existing = new Map(list<Tag>("tags").map((t) => [t.name.toLowerCase(), t]));
  for (const raw of new Set(names.map((n) => n.trim().replace(/^#/, "")).filter(Boolean))) {
    let tag = existing.get(raw.toLowerCase());
    if (!tag) { tag = { id: tagIdFor(raw), name: raw }; put("tags", tag); existing.set(raw.toLowerCase(), tag); }
    put("itemTags", { itemId, tagId: tag.id });
  }
  const used = new Set(list<ItemTag>("itemTags").map((t) => t.tagId));
  for (const t of list<Tag>("tags")) if (!used.has(t.id)) del("tags", t);
}

export function toggleCompletion(itemId: number, day: number, done: boolean) {
  if (done) put("completions", { itemId, day, completedAt: Date.now() });
  else del("completions", { itemId, day });
  changed();
}

export function trash(id: number) {
  const now = Date.now();
  for (const i of list<Item>("items")) if (i.id === id || i.parentId === id) put("items", { ...i, deletedAt: now, updatedAt: now });
  changed();
}

export function restore(id: number) {
  for (const i of list<Item>("items")) if (i.id === id || i.parentId === id) put("items", { ...i, deletedAt: null, updatedAt: Date.now() });
  changed();
}

/** Deletes an item and everything attached to it (like the database's cascade on the phone). */
function removeItemDeep(id: number) {
  const item = records.get(`items/${id}`);
  if (item) del("items", item);
  for (const c of list<Completion>("completions")) if (c.itemId === id) del("completions", c);
  for (const r of list<Reminder>("reminders")) if (r.itemId === id) del("reminders", r);
  for (const t of list<ItemTag>("itemTags")) if (t.itemId === id) del("itemTags", t);
  for (const l of list<Link>("links")) if (l.sourceId === id || l.targetId === id) del("links", l);
  for (const v of list<NoteVersion>("versions")) if (v.itemId === id) del("versions", v);
  for (const i of list<NoteImage>("images")) if (i.itemId === id) del("images", i);
}

export function deleteForever(id: number) { removeItemDeep(id); changed(); }

/**
 * The retention rules (domain/retention.ts): to-dos ticked 48 hours ago move to the trash, what has
 * been in the trash too long is deleted for good (the next sync sends that, like the phone's purge), and
 * old note versions go. Runs at start, after each sync and hourly; returns how many records it changed.
 */
export function tidy(now = Date.now()): number {
  let n = 0;
  const items = list<Item>("items");
  for (const m of doneTodosToTrash(items, list<Completion>("completions"), now)) {
    for (const i of items) if (i.id === m.id || i.parentId === m.id) put("items", { ...i, deletedAt: m.deletedAt, updatedAt: now });
    n++;
  }
  for (const id of expiredTrash(list<Item>("items"), now)) { removeItemDeep(id); n++; }
  n += pruneVersions(now);
  if (n) changed();
  return n;
}

export function emptyTrash() {
  for (const i of list<Item>("items")) if (i.deletedAt !== null) removeItemDeep(i.id);
  changed();
}

export function deleteOccurrence(item: Item, day: number) {
  const days = parseDays(item.excludedDays);
  days.add(day);
  saveItem({ ...item, excludedDays: [...days].sort((a, b) => a - b).join(",") });
}

export type EditScope = "THIS" | "FOLLOWING" | "ALL";

/** Same three choices as the phone when changing one occurrence of a repeating item. */
export function saveSeriesEdit(scope: EditScope, series: Item, day: number, edited: Item, opts: SaveOptions = {}) {
  const s = snapshot();
  const reminders = opts.reminders ?? s.reminders.get(series.id) ?? [];
  const tags = opts.tags ?? (s.tagsByItem.get(series.id) ?? []).map((t) => t.name);
  const span = (series.endDay ?? series.startDay ?? day) - (series.startDay ?? day);
  const freshReminders = reminders.map((r) => ({ ...r, id: 0 }));
  if (scope === "ALL") return saveItem({ ...edited, id: series.id }, { reminders, tags });
  if (scope === "THIS") {
    deleteOccurrence(series, day);
    const startDay = edited.startDay !== series.startDay ? edited.startDay : day;
    const newIdNum = saveItem(
      // A single changed day doesn't repeat, so it isn't a routine (the series keeps its mark).
      { ...edited, id: 0, freq: "NONE", parentId: series.id, excludedDays: "", untilDay: null, startDay, endDay: (startDay ?? day) + span, routine: false },
      { reminders: freshReminders, tags },
    );
    addLink(newIdNum, series.id);
    return newIdNum;
  }
  if (day <= (series.startDay ?? day)) return saveItem({ ...edited, id: series.id }, { reminders, tags });
  saveItem({ ...series, untilDay: day - 1 });
  const id = saveItem({ ...edited, id: 0, startDay: day, endDay: day + span, parentId: null }, { reminders: freshReminders, tags });
  addLink(id, series.id);
  return id;
}

export function addLink(a: number, b: number) {
  if (a !== b) { put("links", { sourceId: a, targetId: b, auto: false }); changed(); }
}

export function removeLink(a: number, b: number) {
  for (const l of list<Link>("links")) {
    if ((l.sourceId === a && l.targetId === b) || (l.sourceId === b && l.targetId === a)) del("links", l);
  }
  changed();
}

/** Keeps a version of a note (see staleVersions: 30 days, and always the 3 newest). */
export function saveVersion(item: Item) {
  const now = Date.now();
  put("versions", { id: newId(), itemId: item.id, title: item.title, content: item.content, savedAt: now });
  pruneVersions(now);
  changed();
}

/** Drops note versions past their time; returns how many. */
function pruneVersions(now: number): number {
  const stale = new Set(staleVersions(list<NoteVersion>("versions"), now));
  if (stale.size) for (const v of list<NoteVersion>("versions")) if (stale.has(v.id)) del("versions", v);
  return stale.size;
}

export function saveCategory(c: Category) { put("categories", { ...c, id: c.id || newId() }); changed(); }

export function deleteCategory(c: Category) {
  for (const i of list<Item>("items")) if (i.categoryId === c.id) put("items", { ...i, categoryId: null, updatedAt: Date.now() });
  del("categories", c);
  changed();
}

export function isEmptyNote(i: Item) {
  return (i.noteDay !== null || !i.title.trim()) && !stripHtml(i.content).trim() && !(i.location ?? "").trim() &&
    !list<NoteImage>("images").some((img) => img.itemId === i.id);
}

export function addImage(itemId: number, img: { hash: string; mime: string; width: number; height: number }) {
  put("images", { id: newId(), itemId, ...img, createdAt: Date.now() } satisfies NoteImage);
  changed();
}

export function deleteImage(img: NoteImage) { del("images", img); changed(); }

/** Notes with no title, text, place or pictures are not kept. */
export function deleteIfEmpty(id: number) {
  const i = records.get(`items/${id}`) as Item | undefined;
  if (i && i.type === "NOTE" && isEmptyNote(i)) deleteForever(id);
}

/** Fixed ids 1-4, the same as the phone, so two fresh devices don't duplicate them. */
export function ensureDefaults() {
  if (list<Category>("categories").length) return;
  const defs: Category[] = [
    { id: 1, name: "Personal", color: 0xff42a5f5 | 0, defaultAlert: "REMINDER" },
    { id: 2, name: "Work", color: 0xff5c6bc0 | 0, defaultAlert: "NOTIFICATION" },
    { id: 3, name: "Health", color: 0xffef5350 | 0, defaultAlert: "ALARM" },
    { id: 4, name: "Home", color: 0xff66bb6a | 0, defaultAlert: "REMINDER" },
  ];
  defs.forEach((c) => put("categories", c));
  changed();
}

export { newItem, isRecurring };
