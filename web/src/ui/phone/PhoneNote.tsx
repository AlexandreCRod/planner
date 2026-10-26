// The phone's note editor, laid out like NoteEditorScreen.kt: a top bar in the page's colour (back,
// undo and redo while writing, pin, style, and a menu with pictures, templates, history and trash),
// then the title, tags, pictures and the text, and the links under it. The formatting bar
// shows only while the text has the focus, sitting on the keyboard. Saving (shared/noteSession.ts):
// a second after each change, and a version is kept when you leave a note you changed.
import { useEffect, useRef, useState } from "react";
import { formatDate, formatDateTime, formatTime } from "../../domain/dates.ts";
import { occurrencesIn } from "../../domain/schedule.ts";
import { preview, stripHtml } from "../../domain/text.ts";
import { type NoteImage, cssColor } from "../../domain/types.ts";
import { importImage, importVideo } from "../../store/images.ts";
import { MAX_VIDEO_BYTES } from "../../domain/media.ts";
import { MediaLens, MediaStrip, MediaViewer } from "./NoteMedia.tsx";
import { addImage, deleteImage, trash } from "../../store/store.ts";
import { openItem, replaceRoute } from "../shared/common.tsx";
import { FONT_NAMES, FONTS, PAGE_COLORS, TEMPLATES, isoOf } from "../shared/noteStyle.ts";
import { RichEditor } from "../shared/RichEditor.tsx";
import { useNoteSession } from "../shared/noteSession.ts";
import { ChecklistHandles } from "./ChecklistHandles.tsx";
import { CaretMarker } from "./CaretMarker.tsx";
import { NoteFind, takePendingFind } from "./NoteFind.tsx";
import { NotePeek, PeekPicker, peekInNextNote, takePendingPeek } from "./NotePeek.tsx";
import { feel } from "./haptics.ts";
import { Dialog, DropdownMenu, FilterChip, IconButton, MIcon, TopAppBar, useUndoState } from "./chrome.tsx";
import { BottomSheet, ColorGrid, PALETTE, TextButton, contentColor, showSnackbar } from "./m3.tsx";
import { NOTE_DAYS } from "../../domain/retention.ts";
import { useKeyboardUp } from "./native.ts";
import { isNative } from "../../platform.ts";
import { setNoteFind } from "./desk.ts";
import { PhoneLinks } from "./PhoneItem.tsx";
import { RichBar, RichBarButton } from "./RichBar.tsx";
import { useWebLinks } from "./WebLinks.tsx";

const PASTELS = PAGE_COLORS.map((c) => (parseInt(c.slice(1), 16) | 0xff000000) | 0);
const PATTERNS = ["Plain", "Lines", "Grid", "Dots"];

/** [shown]: false while the note is put away in its chip (another page showing). */
export function PhoneNote({ id, day, shown = true, onSaved }: { id: number | null; day: number | null; shown?: boolean; onSaved?: (id: number) => void }) {
  const note = useNoteSession({ id, day, newTitle: isoOf });
  const { s, base, rich, noteId, title, setTitle, tags, setTags, style, setStyle } = note;
  const [focused, setFocused] = useState(false);
  const [held, setHeld] = useState(false);
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<"" | "style" | "templates" | "versions" | "trash">("");
  const [viewing, setViewing] = useState<NoteImage | null>(null);
  const [lens, setLens] = useState<{ start: number; pointer: { id: number; x: number } | null } | null>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [hasChecks, setHasChecks] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollBox = useRef<HTMLDivElement>(null);
  // Find in the note: from the menu, or already open on a note opened from Search.
  const [finding, setFinding] = useState<{ q: string; focus: boolean } | null>(() => { const q = takePendingFind(); return q ? { q, focus: false } : null; });
  // Another note shown in a panel under this one (and the picker choosing it).
  const [peek, setPeek] = useState<number | null>(takePendingPeek);
  const [picking, setPicking] = useState(false);
  const pageEl = useRef<HTMLDivElement>(null);
  const titleEl = useRef<HTMLInputElement>(null);
  // A new note on the PC (N, or the + button): the cursor waits in its title, so typing starts it at
  // once. A moment later, so the N that opened it isn't typed there. The phone keeps its keyboard down.
  useEffect(() => {
    if (isNative || id !== null || day !== null) return;
    const t = window.setTimeout(() => titleEl.current?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Put away into the chip: menus, sheets and the find bar close (they'd keep the back button), and the
  // text lets go of the focus (the caret is kept by the editor for when it comes back).
  useEffect(() => { if (noteId) onSaved?.(noteId); }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (shown) return;
    note.save();
    setMenu(false); setOpen(""); setViewing(null); setFinding(null); setPicking(false);
    const a = document.activeElement as HTMLElement | null;
    if (a && pageEl.current?.contains(a)) a.blur();
  }, [shown]);

  // Ctrl+F while the note is shown: its own find bar, not the app's search.
  useEffect(() => (shown ? setNoteFind(() => {
    const field = pageEl.current?.querySelector<HTMLInputElement>(".pn-find input");
    if (field) { field.focus(); field.select(); } else setFinding((f) => ({ q: f?.q ?? "", focus: true }));
  }) : undefined), [shown]);

  /** Swap: the panel's note becomes the one written in, and this one goes to the panel. */
  const swap = () => {
    if (peek === null) return;
    const mine = note.save() || noteId;
    peekInNextNote(mine || null);
    feel("confirm");
    replaceRoute(`note/${peek}`);
  };
  // The formatting bar goes with the keyboard; the text keeps the focus (and its caret) until a tap
  // elsewhere, so a tap on it brings the keyboard back where writing stopped (native.ts).
  const kbUp = useKeyboardUp();

  /**
   * Attaches pictures and videos; a new note is saved first, even if nothing is typed yet. A picture is
   * shrunk to sync; a video is kept as it is, on this phone only (its still syncs: domain/media.ts).
   */
  const addPictures = async (files: Iterable<File>) => {
    const all = [...files].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!all.length) return;
    const to = note.save(true);
    if (!to) return;
    for (const f of all) {
      const video = f.type.startsWith("video/");
      if (video && f.size > MAX_VIDEO_BYTES) { showSnackbar(`Videos up to ${Math.round(MAX_VIDEO_BYTES / 1048576)} MB can be added`); continue; }
      try {
        addImage(to, video ? await importVideo(f) : await importImage(f));
        if (video) showSnackbar("Video added. It stays on this phone; your other devices show a still of it.");
      } catch { showSnackbar(`Couldn't add ${f.name || (video ? "the video" : "the picture")}`); }
    }
  };
  const pickPictures = () => fileInput.current?.click();
  /** A picture or video pasted, or dropped onto the note from the computer's files, is added like a picked one. */
  const pastedMedia = (e: React.ClipboardEvent | React.DragEvent) => {
    const files = "clipboardData" in e ? e.clipboardData.files : e.dataTransfer.files;
    if (![...files].some((f) => f.type.startsWith("image/") || f.type.startsWith("video/"))) return;
    e.preventDefault(); e.stopPropagation();
    void addPictures(files);
  };

  const isDaily = base.noteDay !== null;
  const page = style.bgColor !== null ? cssColor(style.bgColor) : null;
  const fg = page ? contentColor(page) : null;
  const writing = (focused && kbUp) || held;
  const images = s.images.get(noteId) ?? [];
  const dayOcc = isDaily ? occurrencesIn(s.items, s.done, base.noteDay!, base.noteDay!) : [];
  const versions = s.versions.get(noteId) ?? [];
  const undoState = useUndoState();
  const keepFocus = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

  const webLinks = useWebLinks();
  return (
    <div ref={pageEl} className={`p-scaffold pn ${page ? "paper" : ""}`} style={page ? { background: page, color: fg!, ["--pn-fg" as string]: fg!, ["--pn-bg" as string]: page } : undefined}>
      <TopAppBar back title={isDaily ? formatDate(base.noteDay!) : ""} className="pn-appbar" actions={<>
        {writing && <span className="pn-undo" {...keepFocus}>
          <IconButton icon="fUndo" label="Undo" disabled={!undoState.undo} onClick={() => rich.current?.exec("undo")} />
          <IconButton icon="fRedo" label="Redo" disabled={!undoState.redo} onClick={() => rich.current?.exec("redo")} />
        </span>}
        <IconButton icon={style.pinned ? "fPushPin" : "oPushPin"} label={style.pinned ? "Unpin" : "Pin"} onClick={() => setStyle({ ...style, pinned: !style.pinned })} />
        <IconButton icon="oPalette" label="Style" onClick={() => setOpen("style")} />
        <span className="p-menu-anchor">
          <IconButton icon="oMoreVert" label="More" onClick={() => setMenu(true)} />
          <DropdownMenu open={menu} onClose={() => setMenu(false)} items={[
            { label: "Find in note", icon: "oFindInPage", onClick: () => setFinding({ q: finding?.q ?? "", focus: true }) },
            { label: "Add picture or video", icon: "oAddPhotoAlternate", onClick: pickPictures },
            { label: "Show another note", icon: "oSplitscreen", onClick: () => setPicking(true) },
            { label: style.hidden ? "Show on Notes page" : "Hide from Notes page", icon: style.hidden ? "oVisibility" : "oVisibilityOff", onClick: () => {
              setStyle({ ...style, hidden: !style.hidden });
              showSnackbar(style.hidden ? "Shown on the Notes page again" : "Hidden from the Notes page. Search still finds it.");
            } },
            { label: "Insert template", icon: "oViewQuilt", onClick: () => setOpen("templates") },
            { label: "Version history", icon: "oHistory", disabled: !noteId, onClick: () => setOpen("versions") },
            { label: "Move to trash", icon: "oDelete", divider: true, onClick: () => setOpen("trash") },
          ]} />
        </span>
      </>} />
      <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { if (e.target.files) void addPictures(e.target.files); e.target.value = ""; }} />

      {finding && <NoteFind key={finding.focus ? "f" : "s"} editor={() => rich.current?.root() ?? null} scroller={() => scrollBox.current}
        initial={finding.q} focus={finding.focus} onClose={() => setFinding(null)} />}
      <div ref={scrollBox} className={`p-content pn-scroll ${style.bgPattern ? `pattern-${style.bgPattern}` : ""}`} style={{ fontFamily: FONTS[style.fontFamily] }}
        onPasteCapture={pastedMedia} onDropCapture={pastedMedia} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}>
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
        {!isDaily && <input ref={titleEl} className="pn-title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); rich.current?.focusStart(); } }} enterKeyHint="next" />}
        <label className="pn-meta">
          <MIcon name="oLabel" />
          <input placeholder="tags (space separated)" value={tags} onChange={(e) => setTags(e.target.value)} autoCapitalize="none" />
        </label>
        {images.length > 0 && <MediaStrip media={images} onOpen={(i) => setViewing(images[i])} onLens={(start, pointer) => { feel("pickup"); setLens({ start, pointer }); }} />}
        <div className={`pn-text ${hasChecks ? "has-checks" : ""}`} ref={textBox}>
          <RichEditor ref={rich} initialHtml={note.content} revision={note.revision} onChange={note.changed} fontFamily={FONTS[style.fontFamily]} minHeight={320}
            placeholder="Start writing…" onFocusChange={setFocused} links={webLinks.act} />
          <CaretMarker editor={() => rich.current?.root() ?? null} host={() => textBox.current} show={focused && !kbUp} />
          <ChecklistHandles editor={() => rich.current?.root() ?? null} host={() => textBox.current} onChange={note.changed} onHas={setHasChecks} />
        </div>
        <div className="pn-links">
          <PhoneLinks id={noteId} s={s} ensureSaved={() => note.save()} />
        </div>
      </div>

      {webLinks.card}
      {peek !== null && <NotePeek key={peek} id={peek} host={() => pageEl.current} onSwap={swap} onClose={() => setPeek(null)} />}

      {writing && <RichBar editor={rich} onHold={setHeld} extra={<RichBarButton icon="oAddPhotoAlternate" label="Add picture or video" onClick={pickPictures} />} />}

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
                note.setContent(stripHtml(now).trim() ? now + html : html);
                if (!title.trim() && !isDaily) setTitle(name);
                setOpen("");
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
              <div key={v.id} className="p-li two" role="button" onClick={() => { note.setContent(v.content); if (!isDaily) setTitle(v.title); setOpen(""); }}>
                <span className="text"><span className="headline">{formatDateTime(v.savedAt)}</span><span className="supporting">{preview(v.content, 80)}</span></span>
              </div>
            ))}
          </div>
        </Dialog>
      )}

      {open === "trash" && (
        <Dialog title="Move note to trash?" onClose={() => setOpen("")} actions={<>
          <TextButton onClick={() => setOpen("")}>Cancel</TextButton>
          <TextButton onClick={() => { setOpen(""); note.markDeleted(); if (noteId) trash(noteId); history.back(); }}>Move to trash</TextButton>
        </>}>
          You can restore it from Settings → Trash for {NOTE_DAYS} days.
        </Dialog>
      )}

      {picking && <PeekPicker exclude={noteId} onPick={(pid) => setPeek(pid)} onClose={() => setPicking(false)} />}

      {lens && images.length > 0 && <MediaLens media={images} start={Math.min(lens.start, images.length - 1)} pointer={lens.pointer}
        onClose={() => setLens(null)} onOpen={(i) => { setLens(null); setViewing(images[i]); }} />}
      {viewing && <MediaViewer m={viewing} onClose={() => setViewing(null)} onRemove={() => { deleteImage(viewing); setViewing(null); }} />}
    </div>
  );
}
