// The phone's note editor, laid out like NoteEditorScreen.kt: a top bar in the page's colour (back,
// undo and redo while writing, pin, style, and a menu with pictures, templates, history and trash),
// then the title, tags, place, pictures and the text, and the links under it. The formatting bar
// shows only while the text has the focus, sitting on the keyboard. Saving is the same as on the
// PC: a second after each change, and a version is kept when you leave a note you changed.
import { useEffect, useRef, useState } from "react";
import { formatDate, formatDateTime, formatTime } from "../../domain/dates.ts";
import { occurrencesIn } from "../../domain/schedule.ts";
import { preview, stripHtml } from "../../domain/text.ts";
import { type Item, type NoteImage, cssColor, newItem } from "../../domain/types.ts";
import { importImage, useImageUrl } from "../../store/images.ts";
import { addImage, deleteIfEmpty, deleteImage, isEmptyNote, saveItem, saveVersion, snapshot, trash, useSnapshot } from "../../store/store.ts";
import { openItem } from "../common.tsx";
import { FONT_NAMES, FONTS, PAGE_COLORS, TEMPLATES, isoOf } from "../NotesView.tsx";
import { RichEditor, type RichEditorHandle } from "../RichEditor.tsx";
import { Dialog, DropdownMenu, FilterChip, IconButton, MIcon, TopAppBar } from "./chrome.tsx";
import { BottomSheet, ColorGrid, PALETTE, TextButton, contentColor, showSnackbar } from "./m3.tsx";
import { onKeyboardHide, openExternal, pushBack } from "./native.ts";
import { PhoneLinks } from "./PhoneItem.tsx";
import { RichBar, RichBarButton } from "./RichBar.tsx";

const PASTELS = PAGE_COLORS.map((c) => (parseInt(c.slice(1), 16) | 0xff000000) | 0);
const PATTERNS = ["Plain", "Lines", "Grid", "Dots"];

export function PhoneNote({ id, day }: { id: number | null; day: number | null }) {
  const s = useSnapshot();
  const existing = id !== null ? s.byId.get(id) ?? null : null;
  const [noteId, setNoteId] = useState<number>(existing?.id ?? 0);
  const [base] = useState<Item>(() => existing ?? newItem({ type: "NOTE", noteDay: day, title: day !== null ? isoOf(day) : "" }));
  const [title, setTitle] = useState(base.title);
  const [tags, setTags] = useState(() => (s.tagsByItem.get(base.id) ?? []).map((t) => t.name).join(" "));
  const [style, setStyle] = useState({ pinned: base.pinned, bgColor: base.bgColor, bgPattern: base.bgPattern, fontFamily: base.fontFamily, categoryId: base.categoryId, color: base.color });
  const [place, setPlace] = useState({ location: base.location ?? "", lat: base.lat ?? null, lng: base.lng ?? null });
  const [initialHtml, setInitialHtml] = useState(base.content);
  const [focused, setFocused] = useState(false);
  const [held, setHeld] = useState(false);
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<"" | "style" | "templates" | "versions" | "trash">("");
  const [viewing, setViewing] = useState<NoteImage | null>(null);
  const rich = useRef<RichEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
  const adopt = (saved: number) => {
    if (saved === latest.current.noteId) return;
    setNoteId(saved); latest.current.noteId = saved;
    history.replaceState(null, "", `#/note/${saved}`);
  };
  const save = () => {
    const item = current();
    if (item.id === 0 && isEmptyNote(item)) return 0;
    const saved = saveItem(item, { tags: tagList() });
    adopt(saved);
    return saved;
  };
  const scheduleSave = () => { clearTimeout(timer.current); timer.current = window.setTimeout(save, 1000); };
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } scheduleSave(); }, [title, tags, style, place]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The bar goes with the keyboard: putting the keyboard away ends the writing.
  useEffect(() => onKeyboardHide(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a?.closest(".pn-text")) a.blur();
  }), []);

  /** Attaches pictures; a new note is saved first, even if nothing is typed yet. */
  const addPictures = async (files: Iterable<File>) => {
    const pics = [...files].filter((f) => f.type.startsWith("image/"));
    if (!pics.length) return;
    let to = latest.current.noteId;
    if (!to) { to = saveItem(current(), { tags: tagList() }); adopt(to); }
    for (const f of pics) {
      try { addImage(to, await importImage(f)); } catch { showSnackbar(`Couldn't add ${f.name || "the picture"}`); }
    }
  };
  const pickPictures = () => fileInput.current?.click();

  const isDaily = base.noteDay !== null;
  const page = style.bgColor !== null ? cssColor(style.bgColor) : null;
  const fg = page ? contentColor(page) : null;
  const writing = focused || held;
  const images = s.images.get(noteId) ?? [];
  const dayOcc = isDaily ? occurrencesIn(s.items, s.done, base.noteDay!, base.noteDay!) : [];
  const versions = s.versions.get(noteId) ?? [];
  const keepFocus = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

  return (
    <div className={`p-scaffold pn ${page ? "paper" : ""}`} style={page ? { background: page, color: fg!, ["--pn-fg" as string]: fg! } : undefined}>
      <TopAppBar back title={isDaily ? formatDate(base.noteDay!) : ""} className="pn-appbar" actions={<>
        {writing && <span className="pn-undo" {...keepFocus}>
          <IconButton icon="fUndo" label="Undo" onClick={() => rich.current?.exec("undo")} />
          <IconButton icon="fRedo" label="Redo" onClick={() => rich.current?.exec("redo")} />
        </span>}
        <IconButton icon={style.pinned ? "fPushPin" : "oPushPin"} label={style.pinned ? "Unpin" : "Pin"} onClick={() => setStyle({ ...style, pinned: !style.pinned })} />
        <IconButton icon="oPalette" label="Style" onClick={() => setOpen("style")} />
        <span className="p-menu-anchor">
          <IconButton icon="oMoreVert" label="More" onClick={() => setMenu(true)} />
          <DropdownMenu open={menu} onClose={() => setMenu(false)} items={[
            { label: "Add picture", icon: "oAddPhotoAlternate", onClick: pickPictures },
            { label: "Insert template", icon: "oViewQuilt", onClick: () => setOpen("templates") },
            { label: "Version history", icon: "oHistory", disabled: !noteId, onClick: () => setOpen("versions") },
            { label: "Move to trash", icon: "oDelete", divider: true, onClick: () => setOpen("trash") },
          ]} />
        </span>
      </>} />
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addPictures(e.target.files); e.target.value = ""; }} />

      <div className={`p-content pn-scroll ${style.bgPattern ? `pattern-${style.bgPattern}` : ""}`} style={{ fontFamily: FONTS[style.fontFamily] }}>
        {isDaily && dayOcc.length > 0 && (
          <div className="pn-day">
            {dayOcc.map((o) => (
              <button key={o.item.id} className="p-assist" onClick={() => openItem(o.item, o.day)}>
                <span className="pe-dot small" style={{ background: s.colorOf(o.item) }} />
                <span className="ellipsis">{o.startMin !== null ? formatTime(o.startMin) + " " : ""}{o.item.title || "Untitled"}</span>
              </button>
            ))}
          </div>
        )}
        {!isDaily && <input className="pn-title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} enterKeyHint="next" />}
        <label className="pn-meta">
          <MIcon name="oLabel" />
          <input placeholder="tags (space separated)" value={tags} onChange={(e) => setTags(e.target.value)} autoCapitalize="none" />
        </label>
        <div className="pn-meta place">
          <MIcon name="oLocationOn" />
          {/* A typed place has no coordinates; the map is searched for the text. */}
          <input placeholder="place" value={place.location} onChange={(e) => setPlace({ location: e.target.value, lat: null, lng: null })} />
          {place.location.trim() && <IconButton icon="oMap" label="Open in Maps" onClick={() => openExternal(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.lat !== null && place.lng !== null ? `${place.lat},${place.lng}` : place.location.trim())}`)} />}
        </div>
        {images.length > 0 && (
          <div className="pn-images">
            {images.map((img) => <Thumb key={img.id} img={img} onOpen={() => setViewing(img)} />)}
          </div>
        )}
        <div className="pn-text">
          <RichEditor ref={rich} initialHtml={initialHtml} onChange={scheduleSave} fontFamily={FONTS[style.fontFamily]} minHeight={320}
            noToolbar placeholder="Start writing…" onFocusChange={setFocused} />
        </div>
        <div className="pn-links">
          <PhoneLinks id={noteId} s={s} ensureSaved={save} />
        </div>
      </div>

      {writing && <RichBar editor={rich} onHold={setHeld} extra={<RichBarButton icon="oAddPhotoAlternate" label="Add picture" onClick={pickPictures} />} />}

      {open === "style" && (
        <BottomSheet onClose={() => setOpen("")}>{() => (
          <div className="pn-style">
            <div className="p-sheet-title small">Page color</div>
            <ColorGrid colors={PASTELS} selected={style.bgColor} onPick={(c) => setStyle({ ...style, bgColor: c })} />
            <div className="p-sheet-title small">Page pattern</div>
            <div className="pe-flow">{PATTERNS.map((l, i) => <FilterChip key={l} selected={style.bgPattern === i} onClick={() => setStyle({ ...style, bgPattern: i })}>{l}</FilterChip>)}</div>
            <div className="p-sheet-title small">Font</div>
            <div className="pe-flow">{FONT_NAMES.map((l, i) => <FilterChip key={l} selected={style.fontFamily === i} onClick={() => setStyle({ ...style, fontFamily: i })}><span style={{ fontFamily: FONTS[i] }}>{l}</span></FilterChip>)}</div>
            <div className="p-sheet-title small">Category</div>
            <div className="pe-flow">
              <FilterChip selected={style.categoryId === null} onClick={() => setStyle({ ...style, categoryId: null })}>None</FilterChip>
              {s.categories.map((c) => <FilterChip key={c.id} selected={style.categoryId === c.id} onClick={() => setStyle({ ...style, categoryId: c.id })}>{c.name}</FilterChip>)}
            </div>
            <div className="p-sheet-title small">Accent color (graph and lists)</div>
            <ColorGrid colors={PALETTE} selected={style.color} onPick={(c) => setStyle({ ...style, color: c })} />
          </div>
        )}</BottomSheet>
      )}

      {open === "templates" && (
        <Dialog title="Insert template" onClose={() => setOpen("")} actions={<TextButton onClick={() => setOpen("")}>Cancel</TextButton>}>
          <div className="pn-list">
            {TEMPLATES.map(([name, html]) => (
              <button key={name} onClick={() => {
                const now = rich.current?.html() ?? "";
                setInitialHtml(stripHtml(now).trim() ? now + html : html);
                if (!title.trim() && !isDaily) setTitle(name);
                setOpen(""); scheduleSave();
              }}>{name}</button>
            ))}
          </div>
        </Dialog>
      )}

      {open === "versions" && (
        <Dialog title="Version history" onClose={() => setOpen("")} actions={<TextButton onClick={() => setOpen("")}>Close</TextButton>}>
          {versions.length === 0 && <p>Versions are saved each time you leave a note after changing it.</p>}
          <div className="pn-versions">
            {versions.map((v) => (
              <div key={v.id} className="p-li two" role="button" onClick={() => { setInitialHtml(v.content); if (!isDaily) setTitle(v.title); setOpen(""); scheduleSave(); }}>
                <span className="text"><span className="headline">{formatDateTime(v.savedAt)}</span><span className="supporting">{preview(v.content, 80)}</span></span>
              </div>
            ))}
          </div>
        </Dialog>
      )}

      {open === "trash" && (
        <Dialog title="Move note to trash?" onClose={() => setOpen("")} actions={<>
          <TextButton onClick={() => setOpen("")}>Cancel</TextButton>
          <TextButton onClick={() => { setOpen(""); deleted.current = true; clearTimeout(timer.current); if (noteId) trash(noteId); history.back(); }}>Move to trash</TextButton>
        </>}>
          You can restore it from Settings → Trash for 14 days.
        </Dialog>
      )}

      {viewing && <Picture img={viewing} onClose={() => setViewing(null)} onRemove={() => { deleteImage(viewing); setViewing(null); }} />}
    </div>
  );
}

function Thumb({ img, onOpen }: { img: NoteImage; onOpen: () => void }) {
  const url = useImageUrl(img.hash);
  return <button className="pn-thumb" aria-label="Open picture" onClick={onOpen}>{url && <img src={url} alt="" />}</button>;
}

/** A picture full screen, with remove (asked first, as it goes from every device). */
function Picture({ img, onClose, onRemove }: { img: NoteImage; onClose: () => void; onRemove: () => void }) {
  const url = useImageUrl(img.hash);
  const [ask, setAsk] = useState(false);
  useEffect(() => pushBack(onClose), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pn-picture" onClick={onClose}>
      <div className="pn-picture-bar" onClick={(e) => e.stopPropagation()}>
        <IconButton icon="fClose" label="Close" onClick={onClose} />
        <span className="grow" />
        <IconButton icon="oDelete" label="Remove picture" onClick={() => setAsk(true)} />
      </div>
      {url && <img src={url} alt="" onClick={(e) => e.stopPropagation()} />}
      {ask && (
        <Dialog title="Remove picture?" onClose={() => setAsk(false)} actions={<>
          <TextButton onClick={() => setAsk(false)}>Cancel</TextButton>
          <TextButton onClick={onRemove}>Remove</TextButton>
        </>}>It's removed from this note on all your devices.</Dialog>
      )}
    </div>
  );
}

