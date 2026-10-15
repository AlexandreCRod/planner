import { useEffect, useRef, useState } from "react";
import { formatDate, formatDateTime, formatTime, ymd } from "../domain/dates.ts";
import { occurrencesIn } from "../domain/schedule.ts";
import { preview, stripHtml } from "../domain/text.ts";
import { type Item, type NoteImage, argbOf, cssColor, newItem } from "../domain/types.ts";
import { importImage, useImageUrl } from "../store/images.ts";
import { addImage, deleteIfEmpty, deleteImage, isEmptyNote, saveItem, saveVersion, snapshot, trash, useSnapshot } from "../store/store.ts";
import { Icon, go, openItem } from "./common.tsx";
import { LinksSection } from "./LinksSection.tsx";
import { RichEditor, type RichEditorHandle } from "./RichEditor.tsx";

const FONTS = ["system-ui, sans-serif", "Georgia, 'Times New Roman', serif", "Consolas, 'Courier New', monospace", "'Segoe Print', 'Comic Sans MS', cursive"];
const FONT_NAMES = ["Sans", "Serif", "Mono", "Handwriting"];
const PAGE_COLORS = ["#fff8e1", "#ffebee", "#f3e5f5", "#e8eaf6", "#e3f2fd", "#e0f7fa", "#e8f5e9", "#f1f8e9", "#fff3e0", "#efebe9", "#eceff1", "#263238", "#1b2631", "#2e1f27", "#1f2e24"];
const TEMPLATES: [string, string][] = [
  ["Meeting notes", "<h2>Meeting notes</h2><p><b>Date:</b> </p><p><b>Attendees:</b> </p><h3>Agenda</h3><ul><li></li></ul><h3>Decisions</h3><ul><li></li></ul><h3>Action items</h3><ol><li></li></ol>"],
  ["Daily journal", "<h3>Grateful for</h3><ul><li></li></ul><h3>Top 3 for today</h3><ol><li></li><li></li><li></li></ol><h3>Notes</h3><p></p><h3>Reflection</h3><p></p>"],
  ["Weekly review", "<h2>Weekly review</h2><h3>Wins</h3><ul><li></li></ul><h3>What didn't go well</h3><ul><li></li></ul><h3>Next week's priorities</h3><ol><li></li></ol>"],
  ["Project plan", "<h2>Project</h2><p><b>Goal:</b> </p><p><b>Deadline:</b> </p><h3>Milestones</h3><ol><li></li></ol><h3>Risks</h3><ul><li></li></ul>"],
  ["To-do list", "<p>☐ </p>"],
];

const isDark = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 128; };

export function NotesView() {
  const s = useSnapshot();
  // Daily notes only show under their own chip, so the page is about regular notes.
  const [filter, setFilter] = useState<"notes" | "pinned" | "daily">("notes");
  const [tag, setTag] = useState<number | null>(null);
  const notes = s.items.filter((i) => i.type === "NOTE")
    .filter((n) => (filter === "daily" ? n.noteDay !== null : n.noteDay === null && (filter !== "pinned" || n.pinned)))
    .filter((n) => tag === null || (s.tagsByItem.get(n.id) ?? []).some((t) => t.id === tag))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  return (
    <>
      <div className="chips-row">
        {([["notes", "Notes"], ["pinned", "Pinned"], ["daily", "Daily notes"]] as const).map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
        {s.tags.map((t) => <button key={t.id} className={`chip ${tag === t.id ? "on" : ""}`} onClick={() => setTag(tag === t.id ? null : t.id)}>#{t.name}</button>)}
        <span className="grow" />
        <button className="btn primary" onClick={() => go("note/new")}><Icon name="add" size={16} /> New note</button>
      </div>
      {notes.length === 0 && <div className="hint">No notes yet.</div>}
      <div className="notes-grid">
        {notes.map((n) => {
          const bg = n.bgColor !== null ? cssColor(n.bgColor) : undefined;
          const fg = bg ? (isDark(bg) ? "#eee" : "#222") : undefined;
          const accent = n.color !== null ? cssColor(n.color) : n.categoryId !== null && s.categoryById.get(n.categoryId) ? cssColor(s.categoryById.get(n.categoryId)!.color) : undefined;
          const links = s.neighbours(n.id).size;
          return (
            <div key={n.id} className="note-card" onClick={() => openItem(n)} style={{ background: bg, color: fg, borderTop: accent ? `4px solid ${accent}` : undefined, fontFamily: FONTS[n.fontFamily] }}>
              <h3>{n.pinned && "📌 "}{n.noteDay !== null ? formatDate(n.noteDay) : n.title || "Untitled"}</h3>
              <p style={{ color: fg ? "inherit" : undefined, opacity: fg ? 0.85 : undefined }}>{stripHtml(n.content).trim().slice(0, 400)}</p>
              <div className="hint" style={{ marginTop: 6, fontSize: 11.5, color: fg ? "inherit" : undefined, opacity: fg ? 0.6 : undefined }}>
                {(s.tagsByItem.get(n.id) ?? []).map((t) => `#${t.name}`).join(" ") || formatDate(Math.floor((n.updatedAt - new Date().getTimezoneOffset() * 60000) / 86400000))}
                {links > 0 && ` · 🔗 ${links}`}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function NoteEditor({ id, day }: { id: number | null; day: number | null }) {
  const s = useSnapshot();
  const existing = id !== null ? s.byId.get(id) ?? null : null;
  const [noteId, setNoteId] = useState<number>(existing?.id ?? 0);
  const [base] = useState<Item>(() => existing ?? newItem({ type: "NOTE", noteDay: day, title: day !== null ? isoOf(day) : "" }));
  const [title, setTitle] = useState(base.title);
  const [tags, setTags] = useState(() => (s.tagsByItem.get(base.id) ?? []).map((t) => t.name).join(" "));
  const [style, setStyle] = useState({ pinned: base.pinned, bgColor: base.bgColor, bgPattern: base.bgPattern, fontFamily: base.fontFamily, categoryId: base.categoryId });
  const [place, setPlace] = useState({ location: base.location ?? "", lat: base.lat ?? null, lng: base.lng ?? null });
  const [viewing, setViewing] = useState<NoteImage | null>(null);
  const [locating, setLocating] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<"" | "style" | "templates" | "versions">("");
  const [initialHtml, setInitialHtml] = useState(base.content);
  const rich = useRef<RichEditorHandle>(null);
  const opened = useRef(base.content);
  const timer = useRef<number>();
  const latest = useRef({ noteId, title, tags, style, place });
  latest.current = { noteId, title, tags, style, place };
  const deleted = useRef(false);

  const current = (): Item => ({
    ...base, id: latest.current.noteId, title: latest.current.title.trim(), content: rich.current?.html() ?? base.content, ...latest.current.style,
    location: latest.current.place.location.trim(), lat: latest.current.place.lat, lng: latest.current.place.lng,
  });
  const tagList = () => latest.current.tags.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);

  const save = () => {
    const item = current();
    if (item.id === 0 && isEmptyNote(item)) return 0;
    const saved = saveItem(item, { tags: tagList() });
    if (saved !== latest.current.noteId) { setNoteId(saved); latest.current.noteId = saved; history.replaceState(null, "", `#/note/${saved}`); }
    return saved;
  };
  const scheduleSave = () => { clearTimeout(timer.current); timer.current = window.setTimeout(save, 1000); };
  useEffect(() => { scheduleSave(); }, [title, tags, style, place]);

  /** Attaches picture files; a new note is saved first, even if nothing is typed yet. */
  const addPictures = async (files: Iterable<File>) => {
    const pics = [...files].filter((f) => f.type.startsWith("image/"));
    if (!pics.length) return;
    let id = latest.current.noteId;
    if (!id) {
      id = saveItem(current(), { tags: tagList() });
      setNoteId(id); latest.current.noteId = id; history.replaceState(null, "", `#/note/${id}`);
    }
    for (const f of pics) {
      try { addImage(id, await importImage(f)); } catch (e) { alert(`Couldn't add ${f.name || "the picture"}: ${e instanceof Error ? e.message : e}`); }
    }
  };
  const pastedPictures = (e: React.ClipboardEvent | React.DragEvent) => {
    const files = "clipboardData" in e ? e.clipboardData.files : e.dataTransfer.files;
    if (![...files].some((f) => f.type.startsWith("image/"))) return;
    e.preventDefault(); e.stopPropagation();
    void addPictures(files);
  };
  const locate = () => {
    if (!navigator.geolocation) { alert("This browser can't tell where you are."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); const { latitude: lat, longitude: lng } = pos.coords; setPlace({ location: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }); },
      () => { setLocating(false); alert("Couldn't get this computer's location (permission refused or not available)."); },
      { timeout: 15000 },
    );
  };
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.lat !== null && place.lng !== null ? `${place.lat},${place.lng}` : place.location.trim())}`;
  const images = s.images.get(noteId) ?? [];

  // On leaving: keep a version if the text changed; drop the note if it ended up empty.
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (deleted.current) return;
    const item = current();
    if (item.id === 0 && isEmptyNote(item)) return;
    const savedId = save();
    if (!savedId) return;
    if (isEmptyNote(item)) { deleteIfEmpty(savedId); return; }
    if (item.content !== opened.current) { const fresh = snapshot().byId.get(savedId); if (fresh) saveVersion(fresh); }
  }, []);

  const isDaily = base.noteDay !== null;
  const bg = style.bgColor !== null ? cssColor(style.bgColor) : undefined;
  const fg = bg ? (isDark(bg) ? "#eee" : "#222") : undefined;
  const dayOcc = isDaily ? occurrencesIn(s.items, s.done, base.noteDay!, base.noteDay!) : [];
  const versions = s.versions.get(noteId) ?? [];

  return (
    <div style={{ minHeight: "100%", background: bg, color: fg }} className={style.bgPattern ? `pattern-${style.bgPattern}` : ""}>
      <div className="toolbar" style={{ position: "relative", background: bg ?? undefined, borderColor: "rgb(128 128 128 / .2)" }}>
        <button className="icon-btn" title="Back" onClick={() => history.back()}><Icon name="left" /></button>
        <b className="grow">{isDaily ? formatDate(base.noteDay!) : ""}</b>
        <button className="icon-btn" title="Add picture (you can also paste or drop one into the note)" onClick={() => fileInput.current?.click()}><Icon name="image" size={18} /></button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addPictures(e.target.files); e.target.value = ""; }} />
        <button className={`icon-btn ${style.pinned ? "on" : ""}`} title={style.pinned ? "Unpin" : "Pin"} onClick={() => setStyle({ ...style, pinned: !style.pinned })}><Icon name="pin" size={18} /></button>
        <button className={`btn small ${panel === "style" ? "primary" : ""}`} title="Page colour, pattern, font and category" onClick={() => setPanel(panel === "style" ? "" : "style")}>Page style</button>
        <button className={`btn small ${panel === "templates" ? "primary" : ""}`} title="Insert a ready-made layout" onClick={() => setPanel(panel === "templates" ? "" : "templates")}>Templates</button>
        <button className={`btn small ${panel === "versions" ? "primary" : ""}`} title="Earlier versions of this note" disabled={!noteId} onClick={() => setPanel(panel === "versions" ? "" : "versions")}>History</button>
        <button className="icon-btn" title="Move to trash" disabled={!noteId} onClick={() => { if (confirm("Move this note to the trash?")) { deleted.current = true; trash(noteId); history.back(); } }}><Icon name="trash" size={18} /></button>
      </div>
      {panel === "style" && (
        <div className="card" style={{ margin: "10px auto", maxWidth: 820, padding: 14, display: "grid", gap: 10, color: "var(--text)" }}>
          <div className="row" style={{ flexWrap: "wrap" }}>Page colour
            <button className={`chip ${style.bgColor === null ? "on" : ""}`} onClick={() => setStyle({ ...style, bgColor: null })}>None</button>
            {PAGE_COLORS.map((c) => <button key={c} title={c} onClick={() => setStyle({ ...style, bgColor: argbOf(c) })} style={{ width: 26, height: 26, borderRadius: "50%", border: bg === c ? "3px solid var(--accent)" : "1px solid var(--line)", background: c }} />)}
          </div>
          <div className="row">Pattern <div className="seg">{["Plain", "Lines", "Grid", "Dots"].map((l, i) => <button key={l} className={style.bgPattern === i ? "on" : ""} onClick={() => setStyle({ ...style, bgPattern: i })}>{l}</button>)}</div></div>
          <div className="row">Font <div className="seg">{FONT_NAMES.map((l, i) => <button key={l} className={style.fontFamily === i ? "on" : ""} style={{ fontFamily: FONTS[i] }} onClick={() => setStyle({ ...style, fontFamily: i })}>{l}</button>)}</div></div>
          <div className="row">Category <select className="input" value={style.categoryId ?? ""} onChange={(e) => setStyle({ ...style, categoryId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">None</option>{s.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
      )}
      {panel === "templates" && (
        <div className="card" style={{ margin: "10px auto", maxWidth: 820, padding: 14, display: "flex", gap: 8, flexWrap: "wrap", color: "var(--text)" }}>
          {TEMPLATES.map(([name, html]) => (
            <button key={name} className="btn" onClick={() => {
              const now = rich.current?.html() ?? "";
              setInitialHtml(stripHtml(now).trim() ? now + html : html);
              if (!title && !isDaily) setTitle(name);
              setPanel(""); scheduleSave();
            }}>{name}</button>
          ))}
        </div>
      )}
      {panel === "versions" && (
        <div className="card" style={{ margin: "10px auto", maxWidth: 820, padding: 8, color: "var(--text)", maxHeight: 300, overflow: "auto" }}>
          {versions.length === 0 && <div className="hint" style={{ padding: 8 }}>A version is saved each time you leave a note after changing it.</div>}
          {versions.map((v) => (
            <div key={v.id} className="task" onClick={() => { setInitialHtml(v.content); if (!isDaily) setTitle(v.title); setPanel(""); scheduleSave(); }}>
              <div className="grow"><div>{formatDateTime(v.savedAt)}</div><div className="sub ellipsis">{preview(v.content, 100)}</div></div>
            </div>
          ))}
        </div>
      )}
      <div className="editor-page" style={{ fontFamily: FONTS[style.fontFamily] }} onPasteCapture={pastedPictures} onDropCapture={pastedPictures}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}>
        {isDaily && dayOcc.length > 0 && (
          <div className="chips-row">
            {dayOcc.map((o) => <button key={o.item.id} className="chip" onClick={() => openItem(o.item, o.day)}>
              <span className="dot" style={{ background: s.colorOf(o.item) }} />{o.startMin !== null ? formatTime(o.startMin) + " " : ""}{o.item.title}</button>)}
          </div>
        )}
        {!isDaily && <input className="title-input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ color: fg, fontFamily: "inherit" }} />}
        <input className="tags-input" placeholder="# tags (space separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
        <div className="place-row">
          <Icon name="place" size={16} />
          {/* A typed place has no coordinates; only "use my location" sets them. */}
          <input className="tags-input" placeholder="place" value={place.location} onChange={(e) => setPlace({ location: e.target.value, lat: null, lng: null })} />
          <button className="icon-btn" title="Use this computer's location" disabled={locating} onClick={locate}><Icon name="myLocation" size={18} /></button>
          {place.location.trim() && <a className="icon-btn" title="Open in Google Maps" href={mapsUrl} target="_blank" rel="noreferrer"><Icon name="map" size={18} /></a>}
        </div>
        {images.length > 0 && (
          <div className="image-strip">
            {images.map((img) => <Thumb key={img.id} img={img} onOpen={() => setViewing(img)} />)}
          </div>
        )}
        <div className="card" style={{ background: "transparent", border: 0 }}>
          <RichEditor ref={rich} initialHtml={initialHtml} onChange={scheduleSave} fontFamily={FONTS[style.fontFamily]} />
        </div>
        <div style={{ marginTop: 24, borderTop: "1px solid rgb(128 128 128 / .25)", color: "var(--text)" }}>
          <LinksSection id={noteId} s={s} ensureSaved={() => save()} />
        </div>
      </div>
      {viewing && <Lightbox img={viewing} onClose={() => setViewing(null)} onRemove={() => { if (confirm("Remove this picture from the note? It's removed on all your devices.")) { deleteImage(viewing); setViewing(null); } }} />}
    </div>
  );
}

function Thumb({ img, onOpen }: { img: NoteImage; onOpen: () => void }) {
  const url = useImageUrl(img.hash);
  return (
    <button className="thumb" title="Open picture" onClick={onOpen}>
      {url ? <img src={url} alt="" /> : <span className="hint">Downloading…</span>}
    </button>
  );
}

function Lightbox({ img, onClose, onRemove }: { img: NoteImage; onClose: () => void; onRemove: () => void }) {
  const url = useImageUrl(img.hash);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose}>
      {url && <img src={url} alt="" onClick={(e) => e.stopPropagation()} />}
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <button className="btn" title="Remove this picture from the note" onClick={onRemove}><Icon name="trash" size={16} /> Remove</button>
        <button className="btn" title="Close (Esc)" onClick={onClose}><Icon name="close" size={16} /> Close</button>
      </div>
    </div>
  );
}

function isoOf(day: number) {
  const { y, m, d } = ymd(day);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
