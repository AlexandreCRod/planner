// The phone's formatting bar for rich text (RichToolbar in the native RichEditor.kt): one row of
// nine equal buttons (bold, italic, underline, checkbox, bullets, numbers, indent, outdent, more),
// and with "more" a second row above it (strikethrough, colours, size, links, clear). Its buttons never
// take the focus, so the keyboard stays up and the text keeps its selection.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { formatDate, formatTime, nowMinutes, today } from "../../domain/dates.ts";
import type { RichEditorHandle } from "../RichEditor.tsx";
import { DropdownMenu, MIcon } from "./chrome.tsx";
import { showKeyboard } from "./native.ts";
import { ColorPickerDialog, PALETTE, TextFieldDialog } from "./m3.tsx";
import { cssColor } from "../../domain/types.ts";

const SIZES: [string, number | null][] = [["Normal", null], ["Title", 28], ["Heading", 22], ["Subheading", 18], ["Small", 12]];
const HIGHLIGHTS = [0xfffff59d, 0xffc8e6c9, 0xffbbdefb, 0xfff8bbd0, 0xffffe0b2, 0xffe1bee7].map((c) => c | 0);

/** Which of the toggles are on where the caret is. */
function useFormatState() {
  const read = () => {
    const q = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
    return { bold: q("bold"), italic: q("italic"), underline: q("underline"), strike: q("strikeThrough"), ul: q("insertUnorderedList"), ol: q("insertOrderedList") };
  };
  const [st, setSt] = useState(read);
  useEffect(() => {
    const on = () => setSt((old) => { const n = read(); return (Object.keys(n) as (keyof typeof n)[]).some((k) => n[k] !== old[k]) ? n : old; });
    document.addEventListener("selectionchange", on);
    document.addEventListener("input", on, true);
    return () => { document.removeEventListener("selectionchange", on); document.removeEventListener("input", on, true); };
  }, []);
  return st;
}

/** One of the bar's buttons: it never takes the focus from the text. */
export function RichBarButton({ icon, label, on, onClick, color }: { icon: string; label: string; on?: boolean; onClick: () => void; color?: string }) {
  return (
    <button className={`p-rb-btn ${on ? "on" : ""}`} aria-label={label} aria-pressed={on}
      onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <MIcon name={icon} color={color} />
    </button>
  );
}

/**
 * `extra` buttons go at the end of the "more" row (the note editor's Add picture). `onHold` tells the
 * page while one of the bar's dialogs or menus has the focus, so it keeps the bar (and the dialog) up.
 */
export function RichBar({ editor, compact, className = "", extra, onHold }: {
  editor: RefObject<RichEditorHandle>; compact?: boolean; className?: string; extra?: ReactNode; onHold?: (held: boolean) => void;
}) {
  const [more, setMore] = useState(false);
  const [dialog, setDialog] = useState<"color" | "highlight" | "link" | null>(null);
  const [sizeMenu, setSizeMenu] = useState(false);
  const st = useFormatState();
  const held = dialog !== null || sizeMenu;
  useEffect(() => { onHold?.(held); }, [held]); // eslint-disable-line react-hooks/exhaustive-deps
  const ed = () => editor.current;
  // A dialog or menu takes the focus; the selection is kept and put back before the command runs.
  const saved = useRef<Range | null>(null);
  const keep = () => { const sel = getSelection(); saved.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null; };
  const back = () => {
    const r = saved.current;
    ed()?.focus();
    showKeyboard();
    if (r) { const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); }
    return ed();
  };
  const open = (d: "color" | "highlight" | "link") => { keep(); setDialog(d); };

  const B = RichBarButton;

  return (
    <div className={`p-richbar ${className}`} onPointerDown={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}>
      {more && (
        <div className="p-rb-more">
          <B icon="fFormatStrikethrough" label="Strikethrough" on={st.strike} onClick={() => ed()?.exec("strikeThrough")} />
          <B icon="fFormatColorText" label="Text colour" onClick={() => open("color")} />
          <B icon="fFormatColorFill" label="Highlight" onClick={() => open("highlight")} />
          <span className="p-menu-anchor">
            <B icon="fFormatSize" label="Text size" onClick={() => { keep(); setSizeMenu(true); }} />
            <DropdownMenu open={sizeMenu} onClose={() => setSizeMenu(false)}
              items={SIZES.map(([l, px]) => ({ label: l, onClick: () => back()?.setSize(px) }))} />
          </span>
          <B icon="fLink" label="Web link" onClick={() => open("link")} />
          <B icon="fDataObject" label="Insert [[link]] to another item" onClick={() => ed()?.insertText("[[]]")} />
          {!compact && <B icon="oSchedule" label="Insert date and time" onClick={() => ed()?.insertText(`${formatDate(today())}, ${formatTime(nowMinutes())}`)} />}
          <B icon="fFormatClear" label="Clear formatting" onClick={() => ed()?.exec("removeFormat")} />
          {extra}
        </div>
      )}
      <div className="p-rb-main">
        <B icon="fFormatBold" label="Bold" on={st.bold} onClick={() => ed()?.exec("bold")} />
        <B icon="fFormatItalic" label="Italic" on={st.italic} onClick={() => ed()?.exec("italic")} />
        <B icon="fFormatUnderlined" label="Underline" on={st.underline} onClick={() => ed()?.exec("underline")} />
        <B icon="oCheckBox" label="Checkbox" onClick={() => ed()?.toggleChecklist()} />
        <B icon="fFormatListBulleted" label="Bulleted list" on={st.ul} onClick={() => ed()?.exec("insertUnorderedList")} />
        <B icon="fFormatListNumbered" label="Numbered list" on={st.ol} onClick={() => ed()?.exec("insertOrderedList")} />
        <B icon="fFormatIndentIncrease" label="Indent" onClick={() => ed()?.indent(true)} />
        <B icon="fFormatIndentDecrease" label="Outdent" onClick={() => ed()?.indent(false)} />
        <B icon="fTextFormat" label={more ? "Fewer options" : "More formatting"} on={more} onClick={() => setMore(!more)} />
      </div>
      {dialog === "color" && <ColorPickerDialog title="Text colour" colors={PALETTE} selected={null} allowNone={false}
        onPick={(c) => { if (c !== null) back()?.exec("foreColor", cssColor(c)); }} onClose={() => setDialog(null)} />}
      {dialog === "highlight" && <ColorPickerDialog title="Highlight" colors={HIGHLIGHTS} selected={null}
        onPick={(c) => back()?.exec("hiliteColor", c === null ? "transparent" : cssColor(c))} onClose={() => setDialog(null)} />}
      {dialog === "link" && <TextFieldDialog title="Web link" label="Address" initial="https://" saveLabel="Add"
        onSave={(url) => { const u = url.trim(); if (u && u !== "https://") back()?.exec("createLink", u); }} onClose={() => setDialog(null)} />}
    </div>
  );
}
