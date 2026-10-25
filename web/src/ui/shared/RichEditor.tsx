// contenteditable editor that reads and writes the same HTML as the Android editor, including
// its checklists: a paragraph starting with "☐ " / "☑ ", indented by Braille blanks (U+2800).
import { type RefObject, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, forwardRef } from "react";
import { editorText } from "../../domain/noteDraft.ts";
import { backspaceTakesBox, checklistLead, enterSplitsAt } from "../../domain/checklist.ts";

const BOX = "☐", TICK = "☑";
const INDENT = "⠀⠀⠀";
const DONE_STYLE = "text-decoration: line-through; color: #9e9e9e";

export interface RichEditorHandle {
  html(): string; focus(): void; insertText(t: string): void;
  /** A divider line between paragraphs, after the one with the caret (before it, at its very start). */
  separator(): void;
  /** Puts the caret at the start of the text (Enter in a note's title). */
  focusStart(): void;
  /** The formatting commands, for a toolbar drawn elsewhere (the phone's, above the keyboard). */
  exec(cmd: string, value?: string): void; toggleChecklist(): void; indent(deeper: boolean): void; setSize(px: number | null): void;
  /** The editable element itself (the phone's checklist handles sit beside its lines). */
  root(): HTMLElement | null;
}

export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) if (a.name.startsWith("on") || (a.name === "href" && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
  });
  return doc.body.innerHTML;
}

const toHex = (rgb: string) => {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? "#" + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("") : rgb;
};

/** Cleans browser markup into what the phone's editor understands. */
function normalize(root: HTMLElement): string {
  const c = root.cloneNode(true) as HTMLElement;
  c.querySelectorAll("font").forEach((f) => {
    const span = document.createElement("span");
    if (f.getAttribute("color")) span.style.color = f.getAttribute("color")!;
    span.innerHTML = f.innerHTML;
    f.replaceWith(span);
  });
  c.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    if (el.style.color) el.style.color = toHex(el.style.color);
    if (el.style.backgroundColor) el.style.backgroundColor = toHex(el.style.backgroundColor);
  });
  // The phone's own marks on lines (ChecklistHandles) aren't part of the note.
  c.querySelectorAll<HTMLElement>("[class]").forEach((el) => {
    for (const k of [...el.classList]) if (k.startsWith("pn-")) el.classList.remove(k);
    if (!el.classList.length) el.removeAttribute("class");
  });
  c.querySelectorAll("div").forEach((d) => {
    const p = document.createElement("p");
    p.innerHTML = d.innerHTML;
    d.replaceWith(p);
  });
  // Bare text at the top level goes into paragraphs.
  for (const n of [...c.childNodes]) {
    if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
      const p = document.createElement("p");
      n.replaceWith(p);
      p.appendChild(n);
    }
  }
  // Boxes are followed by a plain space in saved text (the phone writes it that way).
  const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (/[☐☑] /.test(n.data)) n.data = n.data.replace(/([☐☑]) /g, "$1 ");
  }
  const html = c.innerHTML;
  return html === "<p><br></p>" || html === "<br>" ? "" : html;
}

/**
 * The editor's HTML, readable even from an unmount cleanup. React clears a component's handle (and its
 * element refs) before the parent's useEffect cleanups run, so `rich.current?.html()` there is always
 * undefined; a save on leaving that fell back to the text as it was when opened reverted every edit.
 * This keeps hold of the editable element itself, which still holds the text once it's off the page.
 * Null when neither can be read (the note then counts as unchanged).
 */
export function useEditorHtml(rich: RefObject<RichEditorHandle>): () => string | null {
  const node = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { const r = rich.current?.root(); if (r) node.current = r; });
  return () => editorText(rich.current ? rich.current.html : undefined, node.current ? () => normalize(node.current!) : undefined);
}

/** Nothing at all in the editor: no text, no list item (even an empty one), no picture or line. */
function isBlank(root: HTMLElement): boolean {
  return !(root.textContent ?? "").trim() && !root.querySelector("li,img,hr,table");
}

/** The block (paragraph or list item) holding the caret. */
function currentBlock(root: HTMLElement): HTMLElement | null {
  const sel = getSelection();
  let n: Node | null = sel?.anchorNode ?? null;
  while (n && n !== root) {
    if (n instanceof HTMLElement && /^(P|LI|H\d|DIV)$/.test(n.tagName)) return n;
    n = n.parentNode;
  }
  return null;
}

function firstText(el: Node): Text | null {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return w.nextNode() as Text | null;
}

/** Where the box would be in a block: after its indent. */
function boxInfo(block: HTMLElement) {
  const text = block.textContent ?? "";
  let i = 0;
  while (text[i] === "⠀") i++;
  return { indent: i, hasBox: text[i] === BOX || text[i] === TICK, checked: text[i] === TICK };
}

function placeCaretAtEnd(el: HTMLElement) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
}

export const RichEditor = forwardRef<RichEditorHandle, {
  initialHtml: string; onChange: () => void; minHeight?: number;
  /** Bumped to show [initialHtml] again even when it's the same text (a note reloaded from sync). */
  revision?: number; fontFamily?: string; placeholder?: string;
  /** Told when the text gains or loses the focus. */
  onFocusChange?: (focused: boolean) => void;
}>(function RichEditor({ initialHtml, revision, onChange, minHeight = 360, fontFamily, placeholder, onFocusChange }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(!initialHtml.replace(/<[^>]*>/g, "").trim());
  const checkEmpty = () => setEmpty(!el.current || isBlank(el.current));

  useEffect(() => {
    if (el.current) el.current.innerHTML = sanitize(initialHtml);
    document.execCommand("defaultParagraphSeparator", false, "p");
  }, [initialHtml, revision]);
  // The "Start writing" hint goes as soon as anything is there: typing, but also a box, a bullet or a
  // number added from the bar (which don't fire an input event).
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const mo = new MutationObserver(checkEmpty);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    checkEmpty();
    return () => mo.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Backspace at the start of a checkbox line takes the box away first (the line stays, as plain text);
  // the next one joins it to the line above. Android's keyboards send it as a beforeinput, a PC as a key.
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    // Enter too, from a keyboard that sends no Enter key (only the paragraph it inserts).
    const onBefore = (e: InputEvent) => {
      if (!e.cancelable) return;
      if (e.inputType === "deleteContentBackward" && takeBoxAtCaret()) e.preventDefault();
      else if (e.inputType === "insertParagraph" && enterOnBox()) e.preventDefault();
    };
    root.addEventListener("beforeinput", onBefore);
    return () => root.removeEventListener("beforeinput", onBefore);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** At the start of a checkbox line (caret only): removes its indent and box. True if it did. */
  const takeBoxAtCaret = (): boolean => {
    const root = el.current;
    const sel = getSelection();
    if (!root || !sel || !sel.isCollapsed || !sel.rangeCount) return false;
    const block = currentBlock(root);
    if (!block || block.tagName === "LI") return false;
    const r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(sel.anchorNode!, sel.anchorOffset);
    const text = block.textContent ?? "";
    if (!backspaceTakesBox(text, r.toString().length)) return false;
    const t = firstText(block);
    const lead = checklistLead(text);
    if (!t || checklistLead(t.data) !== lead) return false;
    const checked = boxInfo(block).checked;
    t.deleteData(0, lead);
    if (checked) setDone(block, t, 0, false);
    if (!(block.textContent ?? "")) block.replaceChildren(document.createElement("br"));
    const c = document.createRange();
    c.setStart(block.firstChild ?? block, 0);
    c.collapse(true);
    sel.removeAllRanges();
    sel.addRange(c);
    onChange();
    return true;
  };

  useImperativeHandle(ref, () => ({
    html: () => (el.current ? normalize(el.current) : ""),
    focus: () => el.current?.focus(),
    separator: () => separator(),
    focusStart: () => {
      const root = el.current;
      if (!root) return;
      root.focus({ preventScroll: true });
      const r = document.createRange();
      const t = firstText(root);
      if (t) r.setStart(t, 0); else r.setStart(root, 0);
      r.collapse(true);
      const sel = getSelection();
      sel?.removeAllRanges(); sel?.addRange(r);
    },
    insertText: (t: string) => { el.current?.focus(); document.execCommand("insertText", false, t); },
    exec: (cmd: string, value?: string) => exec(cmd, value),
    toggleChecklist: () => toggleChecklist(),
    indent: (deeper: boolean) => indent(deeper),
    setSize: (px: number | null) => setSize(px),
    root: () => el.current,
  }));

  const exec = (cmd: string, value?: string) => {
    el.current?.focus();
    document.execCommand("styleWithCSS", false, cmd === "foreColor" || cmd === "hiliteColor" ? "true" : "false");
    document.execCommand(cmd, false, value);
    onChange();
  };

  const toggleChecklist = () => {
    const root = el.current;
    if (!root) return;
    root.focus();
    let block = currentBlock(root);
    if (!block) { document.execCommand("formatBlock", false, "p"); block = currentBlock(root); }
    if (!block) return;
    const info = boxInfo(block);
    const t = firstText(block);
    if (info.hasBox && t) {
      const at = t.data.indexOf(info.checked ? TICK : BOX);
      t.deleteData(at, t.data[at + 1] === " " || t.data[at + 1] === " " ? 2 : 1);
    } else if (t) t.insertData(info.indent, BOX + " ");
    else block.prepend(document.createTextNode(BOX + " "));
    placeCaretAtEnd(block);
    onChange();
  };

  const separator = () => {
    const root = el.current;
    if (!root) return;
    root.focus();
    // The top-level block holding the caret: the divider goes between it and its neighbour.
    let block: Node | null = getSelection()?.anchorNode ?? null;
    while (block && block.parentNode !== root) block = block.parentNode;
    const hr = document.createElement("hr");
    let next: HTMLElement;
    if (!block) {
      root.appendChild(hr);
      next = document.createElement("p"); next.appendChild(document.createElement("br")); root.appendChild(next);
    } else {
      const sel = getSelection()!;
      const before = document.createRange();
      before.setStart(block, 0);
      try { before.setEnd(sel.anchorNode!, sel.anchorOffset); } catch { before.collapse(true); }
      const atStart = !before.toString().length && (block.textContent ?? "").length > 0;
      if (atStart) { block.parentNode!.insertBefore(hr, block); next = block as HTMLElement; }
      else {
        (block as ChildNode).after(hr);
        const after = hr.nextElementSibling as HTMLElement | null;
        if (after && after.tagName !== "HR") next = after;
        else { next = document.createElement("p"); next.appendChild(document.createElement("br")); hr.after(next); }
      }
    }
    const r = document.createRange();
    r.selectNodeContents(next);
    r.collapse(true);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    onChange();
  };

  const indent = (deeper: boolean) => {
    const root = el.current;
    if (!root) return;
    const block = currentBlock(root);
    if (block?.tagName === "LI") { exec(deeper ? "indent" : "outdent"); return; }
    if (!block) return;
    const t = firstText(block);
    if (deeper) { if (t) t.insertData(0, INDENT); else block.prepend(document.createTextNode(INDENT)); }
    else if (t) { let n = 0; while (n < INDENT.length && t.data[n] === "⠀") n++; if (n) t.deleteData(0, n); }
    onChange();
  };

  const setSize = (px: number | null) => {
    exec("fontSize", "7");
    el.current?.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement("span");
      if (px) { span.style.fontSize = `${px}px`; if (px > 16) span.style.fontWeight = "bold"; }
      span.innerHTML = f.innerHTML;
      f.replaceWith(span);
    });
    onChange();
  };

  // Click on a box ticks it and strikes through the rest of the line.
  const onClick = (e: React.MouseEvent) => {
    const pos = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(e.clientX, e.clientY);
    const range = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const node = pos?.offsetNode ?? range?.startContainer;
    const offset = pos?.offset ?? range?.startOffset ?? 0;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const t = node as Text;
    const at = [offset, offset - 1].find((i) => t.data[i] === BOX || t.data[i] === TICK);
    if (at === undefined || t.data.slice(0, at).replace(/⠀/g, "") !== "") return;
    const block = currentBlockOf(t, el.current!);
    if (!block || firstText(block) !== t) return;
    const checked = t.data[at] === TICK;
    t.replaceData(at, 1, checked ? BOX : TICK);
    setDone(block, t, at, !checked);
    onChange();
  };

  // Enter on a checklist line starts the next box at the same indent, even after an empty box: boxes keep
  // coming until the line's box is removed (the ☐ button, or deleting the box while typing). The text
  // after the caret goes onto the new box, unticked, with its formatting.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { if (takeBoxAtCaret()) e.preventDefault(); return; }
    if (e.key === "Enter" && !e.shiftKey && enterOnBox()) e.preventDefault();
  };

  /** Enter on a checklist line (see above). True if it did it (false: not a checklist line). */
  const enterOnBox = (): boolean => {
    const root = el.current;
    if (!root) return false;
    const block = currentBlock(root);
    if (!block || block.tagName === "LI") return false;
    const info = boxInfo(block);
    if (!info.hasBox) return false;
    const sel = getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) sel.getRangeAt(0).deleteContents();
    let caret = (block.textContent ?? "").length;
    if (sel && sel.rangeCount && block.contains(sel.anchorNode)) {
      const before = document.createRange();
      before.setStart(block, 0);
      before.setEnd(sel.anchorNode!, sel.anchorOffset);
      caret = before.toString().length;
    }
    const at = enterSplitsAt(block.textContent ?? "", caret);
    const p = document.createElement("p");
    p.textContent = INDENT.slice(0, info.indent) + BOX + " ";
    if (at !== null) {
      const rest = document.createRange();
      rest.setStart(...pointAt(block, at));
      rest.setEnd(block, block.childNodes.length);
      const moved = rest.extractContents();
      // The new box is unticked: no strike-through on the text it takes.
      moved.querySelectorAll("span").forEach((s) => { if (s.style.textDecoration.includes("line-through")) s.replaceWith(...s.childNodes); });
      p.appendChild(moved);
    }
    p.normalize();
    block.after(p);
    if (at === null) placeCaretAtEnd(p);
    else {
      // At the start of the moved text, just after the new box.
      const c = document.createRange();
      c.setStart(...pointAt(p, info.indent + 2));
      c.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(c);
    }
    onChange();
    return true;
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  };

  return (
    <div ref={el} className={placeholder && empty ? "rich is-empty" : "rich"} contentEditable suppressContentEditableWarning spellCheck
      style={{ minHeight, fontFamily }} onFocus={() => onFocusChange?.(true)} onBlur={() => onFocusChange?.(false)} onInput={() => { checkEmpty(); onChange(); }}
      data-placeholder={placeholder} onClick={onClick} onKeyDown={onKeyDown} onPaste={onPaste} />
  );
});

/** The text position [offset] characters into [block], as a range point. */
function pointAt(block: HTMLElement, offset: number): [Node, number] {
  const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let left = offset;
  for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
    if (left <= t.length) return [t, left];
    left -= t.length;
  }
  return [block, block.childNodes.length];
}

function currentBlockOf(n: Node, root: HTMLElement): HTMLElement | null {
  let x: Node | null = n;
  while (x && x !== root) {
    if (x instanceof HTMLElement && /^(P|LI|H\d|DIV)$/.test(x.tagName)) return x;
    x = x.parentNode;
  }
  return null;
}

/** Strikes through (or restores) everything after the box on that line. */
function setDone(block: HTMLElement, t: Text, at: number, done: boolean) {
  if (done) {
    const r = document.createRange();
    r.setStart(t, Math.min(at + 2, t.length));
    r.setEnd(block, block.childNodes.length);
    const span = document.createElement("span");
    span.setAttribute("style", DONE_STYLE);
    span.appendChild(r.extractContents());
    block.appendChild(span);
  } else {
    block.querySelectorAll("span").forEach((s) => {
      if (s.style.textDecoration.includes("line-through")) s.replaceWith(...s.childNodes);
    });
  }
}
