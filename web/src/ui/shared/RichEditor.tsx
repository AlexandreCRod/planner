// contenteditable editor that reads and writes the same HTML as the Android editor, including
// its checklists: a paragraph starting with "☐ " / "☑ ", indented by Braille blanks (U+2800).
import { type RefObject, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, forwardRef } from "react";
import { editorText } from "../../domain/noteDraft.ts";
import { backspaceTakesBox, boxGapFix, checklistLead, checklistRun, checklistTicked, completedSections, editorJoins, enterSplitsAt, forwardDeleteTakesBox, joinDrops, tickAnchor, tickMoveOrder, withoutBoxes } from "../../domain/checklist.ts";
import { SIZE_MARK, sizeStyle, withoutMarks } from "../../domain/textSize.ts";
import { feel } from "../phone/haptics.ts";
import { linkAtCaretIn, linkInEditable, paintLinks, unpaintLinks } from "./linkHit.ts";
import { type LinkActions, useLinkGesture } from "./linkGesture.ts";

const BOX = "☐", TICK = "☑";
/** The space after a box while editing: a no-break one, which the browser never hides or drops (saved as a plain space). */
const NBSP = " ";
/** How far outside the box a tap still ticks it (px). */
const BOX_SLOP = 6;
const INDENT = "⠀⠀⠀";
const DONE_STYLE = "text-decoration: line-through; color: #9e9e9e";
/** Whether the "Completed" sections start folded on this device (the last choice made on any of them). */
const FOLD_KEY = "completedFolded";
/** Room above a section's first line for its "N completed" bar (the same in the style sheet). */
const HEAD_H = 34;

interface DoneHead { key: string; top: number; count: number; folded: boolean }

const savedFold = () => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } };
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  // Boxes are followed by a plain space in saved text (the phone writes it that way); a size's caret mark isn't saved.
  const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (/[☐☑] /.test(n.data)) n.data = n.data.replace(/([☐☑]) /g, "$1 ");
    if (n.data.includes(SIZE_MARK)) n.data = n.data.split(SIZE_MARK).join("");
  }
  // Spans left with nothing in them, or with no style at all (Normal picked inside a bigger size), go.
  c.querySelectorAll("span").forEach((sp) => {
    if (!sp.textContent && !sp.querySelector("img,br")) sp.remove();
    else if (!sp.attributes.length) sp.replaceWith(...sp.childNodes);
  });
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

/**
 * Saved text has a plain space after each box; on screen it's a no-break space. A plain one at the end of
 * a line (an empty box) is hidden, and the browser drops it when typing there, so the words would touch
 * the box (256).
 */
function liveGaps(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (/[☐☑] /.test(n.data)) n.data = n.data.replace(/([☐☑]) /g, `$1${NBSP}`);
  }
}

/** Where the caret is in [block], in characters (null when it's not there or a range is selected). */
function caretIn(block: HTMLElement): number | null {
  const sel = getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !block.contains(sel.anchorNode)) return null;
  const r = document.createRange();
  r.setStart(block, 0);
  r.setEnd(sel.anchorNode!, sel.anchorOffset);
  return r.toString().length;
}

/** An element that sets a text size: a span with a font size, or the browser's own <font size>. */
const isSized = (n: Element) => (n.tagName === "SPAN" && !!(n as HTMLElement).style.fontSize) || (n.tagName === "FONT" && n.hasAttribute("size"));

/**
 * Takes [span] out of the sized elements around it in [block], splitting them, so only its own size
 * counts: Normal picked inside a Title is really normal again (257).
 */
function liftOut(span: HTMLElement, block: HTMLElement) {
  for (let p = span.parentElement; p && p !== block && block.contains(p);) {
    const up: HTMLElement | null = p.parentElement;
    if (isSized(p)) {
      const r = document.createRange();
      const left = p.cloneNode(false) as HTMLElement, right = p.cloneNode(false) as HTMLElement;
      r.setStart(p, 0); r.setEndBefore(span); left.append(r.extractContents());
      r.setStartAfter(span); r.setEnd(p, p.childNodes.length); right.append(r.extractContents());
      if (left.textContent) p.before(left);
      if (right.textContent) p.after(right);
      p.replaceWith(...p.childNodes);
    }
    p = up;
  }
}

const sizedSpan = (px: number | null) => {
  const span = document.createElement("span");
  Object.assign(span.style, sizeStyle(px));
  return span;
};

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
  /** What a tap and a long press do on a web link in the text (nothing special without it). */
  links?: LinkActions;
}>(function RichEditor({ initialHtml, revision, onChange, minHeight = 360, fontFamily, placeholder, onFocusChange, links }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const { onLinkClick, onLinkKey, ...linkHandlers } = useLinkGesture(
    (x, y) => (el.current ? linkInEditable(el.current, x, y) : null), () => (el.current ? linkAtCaretIn(el.current) : null), links);
  const linksOn = useRef(false);
  linksOn.current = !!links;
  const [empty, setEmpty] = useState(!initialHtml.replace(/<[^>]*>/g, "").trim());
  const checkEmpty = () => setEmpty(!el.current || isBlank(el.current));
  const wrap = useRef<HTMLDivElement>(null);
  const [heads, setHeads] = useState<DoneHead[]>([]);
  const headsKey = useRef("");
  // Which checklists' completed sections are folded, by the text of their first line.
  const folded = useRef(new Map<string, boolean>());
  // The caret marks of sizes picked with nothing selected (see sizeAtCaret).
  const marks = useRef(new Set<HTMLElement>());
  useEffect(() => {
    const on = () => tidyMarks(false);
    document.addEventListener("selectionchange", on);
    return () => document.removeEventListener("selectionchange", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Gives each checklist's completed lines (the ticked ones at its end, see completedSections) their marks:
   * room above the first for the "N completed" bar, and hidden when folded. The marks are classes, never
   * saved (normalize), so the note's text stays exactly the lines in order.
   */
  const layoutDone = () => {
    const root = el.current, box = wrap.current;
    if (!root || !box) return;
    const lines = [...root.children] as HTMLElement[];
    const texts = lines.map((l) => (l.tagName === "P" ? l.textContent ?? "" : ""));
    const secs = completedSections(texts);
    const out: DoneHead[] = [];
    const hidden = new Set<number>(), firsts = new Set<number>();
    for (const sec of secs) {
      const key = (texts[checklistRun(texts, sec.first)![0]] ?? "").trim();
      const isFolded = folded.current.get(key) ?? savedFold();
      firsts.add(sec.first);
      if (isFolded) for (let i = sec.first; i <= sec.last; i++) hidden.add(i);
      out.push({ key, top: 0, count: sec.count, folded: isFolded });
    }
    lines.forEach((l, i) => {
      if (l.classList.contains("pn-done-first") !== firsts.has(i)) l.classList.toggle("pn-done-first", firsts.has(i));
      if (l.classList.contains("pn-folded") !== hidden.has(i)) l.classList.toggle("pn-folded", hidden.has(i));
    });
    // A caret inside a line that was just folded away moves to the line above it.
    const sel = getSelection();
    if (hidden.size && sel?.anchorNode && root.contains(sel.anchorNode) && document.activeElement === root) {
      const b = currentBlockOf(sel.anchorNode, root);
      if (b?.classList.contains("pn-folded")) {
        let p = b.previousElementSibling as HTMLElement | null;
        while (p?.classList.contains("pn-folded")) p = p.previousElementSibling as HTMLElement | null;
        if (p) placeCaretAtEnd(p);
      }
    }
    // Layout offsets, not screen rects: a line still gliding to its place (tickLine) mustn't move the bar with it.
    const topIn = (l: HTMLElement) => (l.offsetParent === box ? l.offsetTop : l.offsetTop + root.offsetTop);
    secs.forEach((sec, k) => { out[k].top = Math.round(topIn(lines[sec.first]) - HEAD_H); });
    const k = out.map((h) => `${h.key}|${h.top}|${h.count}|${h.folded}`).join("\n");
    if (k !== headsKey.current) { headsKey.current = k; setHeads(out); }
  };
  const toggleFold = (h: DoneHead) => {
    folded.current.set(h.key, !h.folded);
    try { localStorage.setItem(FOLD_KEY, h.folded ? "0" : "1"); } catch { /* private mode */ }
    layoutDone();
  };

  useEffect(() => {
    if (el.current) { el.current.innerHTML = sanitize(initialHtml); liveGaps(el.current); }
    document.execCommand("defaultParagraphSeparator", false, "p");
  }, [initialHtml, revision]);
  // The "Start writing" hint goes as soon as anything is there: typing, but also a box, a bullet or a
  // number added from the bar (which don't fire an input event).
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    let raf = 0;
    // Web links are drawn as links where a tap opens them (the editors without link actions leave them as text).
    const paint = () => { if (linksOn.current) paintLinks(root); };
    const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; layoutDone(); paint(); }); };
    const mo = new MutationObserver(() => { checkEmpty(); later(); });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    // The bars move with the lines when the text re-wraps (a resize, a rotated phone).
    const ro = new ResizeObserver(later);
    ro.observe(root);
    checkEmpty();
    layoutDone();
    paint();
    return () => { mo.disconnect(); ro.disconnect(); cancelAnimationFrame(raf); unpaintLinks(root); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Backspace at the start of a checkbox line takes the box away first (the line stays, as plain text);
  // the next one joins it to the line above. Delete at the end of a line pulls the next one up, without
  // its box (262). Android's keyboards send them as a beforeinput, a PC as a key.
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    // Enter too, from a keyboard that sends no Enter key (only the paragraph it inserts).
    const onBefore = (e: InputEvent) => {
      if (!e.cancelable) return;
      if (e.inputType === "deleteContentBackward" && backspaceAtCaret()) e.preventDefault();
      else if (e.inputType === "deleteContentForward" && deleteAtCaret()) e.preventDefault();
      else if (e.inputType === "insertParagraph" && enterOnBox()) e.preventDefault();
    };
    root.addEventListener("beforeinput", onBefore);
    return () => root.removeEventListener("beforeinput", onBefore);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** The line with the caret (not a list item) when nothing is selected, with the caret's place in it. */
  const caretLine = (): { block: HTMLElement; caret: number } | null => {
    const root = el.current;
    if (!root) return null;
    const block = currentBlock(root);
    if (!block || block.tagName === "LI") return null;
    const caret = caretIn(block);
    return caret === null ? null : { block, caret };
  };

  /** The next (or previous) line on screen: lines folded into a "completed" section are skipped. */
  const lineBeside = (block: HTMLElement, down: boolean): HTMLElement | null => {
    if (block.parentElement !== el.current) return null;
    let n = (down ? block.nextElementSibling : block.previousElementSibling) as HTMLElement | null;
    while (n?.classList.contains("pn-folded")) n = (down ? n.nextElementSibling : n.previousElementSibling) as HTMLElement | null;
    return n?.tagName === "P" ? n : null;
  };

  /** Backspace: takes a box away, or joins a line to a checklist line above it. True if it did either. */
  const backspaceAtCaret = (): boolean => {
    if (dropMarkAtCaret()) { if (!backspaceAtCaret()) document.execCommand("delete"); return true; }
    const at = caretLine();
    if (!at) return false;
    const text = at.block.textContent ?? "";
    if (backspaceTakesBox(text, at.caret)) return takeBox(at.block);
    if (at.caret !== 0) return false;
    const above = lineBeside(at.block, false);
    if (!above || !editorJoins(above.textContent ?? "", text)) return false;
    joinLines(above, at.block);
    return true;
  };

  /** Delete: takes a box away from before it, or pulls the next line up when it or this one is a checklist line. */
  const deleteAtCaret = (): boolean => {
    const at = caretLine();
    if (!at) return false;
    const text = at.block.textContent ?? "";
    if (forwardDeleteTakesBox(text, at.caret)) return takeBox(at.block);
    if (at.caret < text.length) return false;
    const below = lineBeside(at.block, true);
    if (!below || !editorJoins(text, below.textContent ?? "")) return false;
    joinLines(at.block, below);
    return true;
  };

  /**
   * Joins line [below] onto the end of line [above], without its lead (indent, box and space) or its
   * strike-through, with the caret where they meet. Done here rather than by the browser, which leaves
   * the box in the middle of the text and wraps the moved words in stray styles.
   */
  const joinLines = (above: HTMLElement, below: HTMLElement) => {
    const lowText = below.textContent ?? "";
    if (checklistTicked(lowText)) setDone(below, null, 0, false);
    const drop = joinDrops(lowText);
    if (drop) {
      const r = document.createRange();
      r.setStart(below, 0);
      r.setEnd(...pointAt(below, drop));
      r.deleteContents();
    }
    const at = (above.textContent ?? "").length;
    while (above.lastChild?.nodeName === "BR") above.lastChild.remove();
    const moved = [...below.childNodes];
    if (moved[moved.length - 1]?.nodeName === "BR") moved.pop();
    above.append(...moved);
    below.remove();
    if (!above.childNodes.length) above.appendChild(document.createElement("br"));
    above.normalize();
    const sel = getSelection();
    if (sel) sel.collapse(...(at === 0 ? [above, 0] as [Node, number] : pointAt(above, at)));
    onChange();
  };

  /** Removes line [block]'s indent and box (and the strike-through of a ticked one), the caret at its start. */
  const takeBox = (block: HTMLElement): boolean => {
    const sel = getSelection();
    if (!sel) return false;
    const text = block.textContent ?? "";
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
    keepGap(block);
    onChange();
  };

  /** A checklist line's box keeps its no-break space before the text (256), the caret staying where it was. */
  const keepGap = (block: HTMLElement) => {
    const fix = boxGapFix(block.textContent ?? "");
    if (!fix) return;
    const caret = caretIn(block);
    const r = document.createRange();
    r.setStart(...pointAt(block, fix.at));
    r.setEnd(...pointAt(block, fix.at + fix.replace));
    r.deleteContents();
    r.insertNode(document.createTextNode(NBSP));
    block.normalize();
    if (caret !== null) getSelection()?.collapse(...pointAt(block, caret + (fix.replace === 0 && caret >= fix.at ? 1 : 0)));
  };

  /**
   * A text size from the menu. On selected text it's set on the text (taking it out of any other size
   * around it). With only a caret, the caret gets the size at once, in an invisible mark, so it shows
   * the size and what's typed next takes it, even on an empty line (257).
   */
  const setSize = (px: number | null) => {
    const root = el.current;
    if (!root) return;
    root.focus();
    const sel = getSelection();
    if (sel && sel.rangeCount && sel.isCollapsed && root.contains(sel.anchorNode)) { sizeAtCaret(px); return; }
    if (!sel || !sel.rangeCount) return;
    // Line by line: each line's selected part goes into a span of the new size (the browser's own
    // fontSize command leaves <font> tags, and half of a Title's style behind when it's undone).
    const range = sel.getRangeAt(0);
    const spans: HTMLElement[] = [];
    for (const b of [...root.children]) {
      if (!range.intersectsNode(b)) continue;
      const r = document.createRange();
      r.selectNodeContents(b);
      if (b.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
      if (b.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
      if (r.collapsed || !r.toString()) continue;
      const part = r.extractContents();
      // Sizes inside the selection give way to the new one (with the bold that comes with a big size).
      part.querySelectorAll<HTMLElement>("span").forEach((s) => {
        if (!s.style.fontSize) return;
        s.style.fontSize = ""; s.style.fontWeight = "";
        if (!s.getAttribute("style")) s.replaceWith(...s.childNodes);
      });
      part.querySelectorAll("font[size]").forEach((f) => f.replaceWith(...f.childNodes));
      const span = sizedSpan(px);
      span.append(part);
      r.insertNode(span);
      const block = currentBlockOf(span, root) ?? (b as HTMLElement);
      liftOut(span, block);
      spans.push(span);
    }
    if (spans.length) {
      const r = document.createRange();
      r.setStartBefore(spans[0].firstChild ?? spans[0]);
      r.setEndAfter(spans[spans.length - 1].lastChild ?? spans[spans.length - 1]);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    onChange();
  };

  /** The mark span holding the caret (see sizeAtCaret), if any. */
  const markAtCaret = (): HTMLElement | null => {
    const n = getSelection()?.anchorNode;
    if (!n || n.nodeType !== Node.TEXT_NODE) return null;
    const s = n.parentElement, data = (n as Text).data;
    return s && marks.current.has(s) && data.length > 0 && withoutMarks(data, null).data === data && data.startsWith(SIZE_MARK) ? s : null;
  };

  const sizeAtCaret = (px: number | null) => {
    const root = el.current, sel = getSelection();
    if (!root || !sel || !sel.rangeCount) return;
    const block = currentBlock(root);
    if (!block) return;
    let span = markAtCaret();
    if (span) { span.removeAttribute("style"); Object.assign(span.style, sizeStyle(px)); }
    else {
      span = sizedSpan(px);
      span.append(document.createTextNode(SIZE_MARK));
      sel.getRangeAt(0).insertNode(span);
      marks.current.add(span);
      // An empty line's placeholder goes: the mark holds the line now (tidyMarks puts it back if unused).
      const next = span.nextSibling;
      if (next?.nodeName === "BR" && !next.nextSibling && !(block.textContent ?? "").replace(SIZE_MARK, "")) next.remove();
    }
    liftOut(span, block);
    sel.collapse(span.firstChild!, 1);
    onChange();
  };

  /**
   * After typing ([typed]), a mark with text beside it goes. Otherwise, an unused mark goes once the caret
   * is elsewhere in the text (not while a menu or dialog has the focus).
   */
  const tidyMarks = (typed: boolean) => {
    const root = el.current, sel = getSelection();
    if (!root) return;
    for (const s of [...marks.current]) {
      const text = s.textContent ?? "";
      if (!s.isConnected || !text.includes(SIZE_MARK)) { marks.current.delete(s); continue; }
      if (withoutMarks(text, null).data === text) {
        if (!typed && sel?.anchorNode && root.contains(sel.anchorNode) && !s.contains(sel.anchorNode)) {
          const block = s.parentElement;
          s.remove();
          marks.current.delete(s);
          if (block && block !== root && !block.childNodes.length) block.appendChild(document.createElement("br"));
        }
        continue;
      }
      if (!typed) continue;
      const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
        const caret = sel && sel.isCollapsed && sel.anchorNode === t ? sel.anchorOffset : null;
        const fixed = withoutMarks(t.data, caret);
        if (fixed.data === t.data) continue;
        t.data = fixed.data;
        if (fixed.caret !== null) sel!.collapse(t, fixed.caret);
      }
      marks.current.delete(s);
    }
  };

  /** Backspace right after picking a size: the mark goes with the character before it, in one press. */
  const dropMarkAtCaret = (): boolean => {
    const s = markAtCaret();
    if (!s?.parentNode) return false;
    const parent = s.parentNode, at = [...parent.childNodes].indexOf(s);
    s.remove();
    marks.current.delete(s);
    getSelection()?.collapse(parent, at);
    return true;
  };

  // Click on a box ticks it and strikes through the rest of the line; anywhere else, the caret stays out of the box's lead.
  const onClick = (e: React.MouseEvent) => {
    if (onLinkClick(e)) return;
    if (!tickTapped(e)) caretPastBox();
  };

  /** Ticks the box under a tap, if the tap was on one. */
  const tickTapped = (e: React.MouseEvent): boolean => {
    const pos = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(e.clientX, e.clientY);
    const range = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const node = pos?.offsetNode ?? range?.startContainer;
    const offset = pos?.offset ?? range?.startOffset ?? 0;
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const t = node as Text;
    const at = [offset, offset - 1].find((i) => t.data[i] === BOX || t.data[i] === TICK);
    if (at === undefined || t.data.slice(0, at).replace(/⠀/g, "") !== "") return false;
    const block = currentBlockOf(t, el.current!);
    if (!block || firstText(block) !== t) return false;
    // Only a tap on the box itself ticks: on an empty line the caret lands next to the box from anywhere on it.
    const r = document.createRange();
    r.setStart(t, at);
    r.setEnd(t, at + 1);
    const box = r.getBoundingClientRect();
    if (e.clientX > box.right + BOX_SLOP || e.clientY < box.top - BOX_SLOP || e.clientY > box.bottom + BOX_SLOP) return false;
    tickLine(block, t, at);
    return true;
  };

  /** A caret left before a line's box or between it and its space goes after them, where a new box puts it. */
  const caretPastBox = () => {
    const sel = getSelection(), root = el.current;
    if (!sel || !sel.isCollapsed || !sel.anchorNode || !root?.contains(sel.anchorNode)) return;
    const block = currentBlockOf(sel.anchorNode, root);
    if (!block) return;
    const lead = checklistLead(block.textContent ?? "");
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(sel.anchorNode, sel.anchorOffset);
    if (before.toString().length < lead) sel.collapse(...pointAt(block, lead));
  };

  // Copied (or cut) lines leave their boxes behind: what's pasted elsewhere is just the words.
  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    const sel = getSelection(), root = el.current;
    if (!sel || sel.isCollapsed || !root?.contains(sel.anchorNode)) return;
    // Line by line (the browser's own text puts a blank line between paragraphs).
    const range = sel.getRangeAt(0);
    const text = [...root.children].filter((l) => range.intersectsNode(l)).map((l) => {
      const r = document.createRange();
      r.selectNodeContents(l);
      if (l.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
      if (l.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
      return r.toString();
    }).join("\n");
    const words = withoutBoxes(text);
    if (words === text) return; // no boxes: the browser copies as usual
    e.preventDefault();
    e.clipboardData.setData("text/plain", words);
    if (cut) document.execCommand("delete");
  };

  /** Ticks or unticks the line whose box is at [at] in [t], moving it to or from its list's Completed section. */
  const tickLine = (block: HTMLElement, t: Text, at: number) => {
    const root = el.current!;
    const checked = t.data[at] === TICK;
    t.replaceData(at, 1, checked ? BOX : TICK);
    setDone(block, t, at, !checked);
    feel("tick");
    const lines = [...root.children] as HTMLElement[];
    const texts = lines.map((l) => (l.tagName === "P" ? l.textContent ?? "" : ""));
    // A ticked line remembers the open line above it (saved with the note), so unticking puts it back there.
    const anchor = checked ? null : tickAnchor(texts, lines.indexOf(block));
    const order = tickMoveOrder(texts, lines.indexOf(block), (k) => lines[k]?.dataset.after ?? null);
    if (anchor !== null) block.dataset.after = anchor;
    else delete block.dataset.after;
    if (order) {
      const lo = order.findIndex((k, j) => k !== j);
      let hi = order.length - 1;
      while (order[hi] === hi) hi--;
      const before = new Map(lines.map((l) => [l, l.getBoundingClientRect().top]));
      const anchor = lines[hi].nextSibling;
      for (const k of order.slice(lo, hi + 1)) root.insertBefore(lines[k], anchor);
      layoutDone();
      // The moved lines glide to their places (the others make room), unless motion is turned down.
      if (!reducedMotion()) {
        for (const l of lines.slice(lo, hi + 1)) {
          if (l.classList.contains("pn-folded") || !l.animate) continue;
          const dy = (before.get(l) ?? 0) - l.getBoundingClientRect().top;
          if (Math.abs(dy) < 1) continue;
          l.animate([{ transform: `translateY(${dy}px)`, opacity: l === block ? 0.55 : 1 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2, 0, 0, 1)" });
        }
      }
    } else layoutDone();
    if (document.activeElement === root && !block.classList.contains("pn-folded")) placeCaretAtEnd(block);
    onChange();
  };

  /** Ctrl+Enter: ticks (or unticks) the checklist line with the caret. True if it did. */
  const tickAtCaret = (): boolean => {
    const root = el.current;
    const block = root && currentBlock(root);
    if (!block || block.tagName === "LI") return false;
    const info = boxInfo(block), t = firstText(block);
    if (!info.hasBox || !t || t.data[info.indent] !== (info.checked ? TICK : BOX)) return false;
    tickLine(block, t, info.indent);
    return true;
  };

  // Enter on a checklist line starts the next box at the same indent, even after an empty box: boxes keep
  // coming until the line's box is removed (the ☐ button, or deleting the box while typing). The text
  // after the caret goes onto the new box, unticked, with its formatting.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (onLinkKey(e)) return;
    const plain = !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (e.key === "Backspace" && plain) { if (backspaceAtCaret()) e.preventDefault(); return; }
    if (e.key === "Delete" && plain) { if (deleteAtCaret()) e.preventDefault(); return; }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { if (tickAtCaret()) e.preventDefault(); return; }
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
    p.textContent = INDENT.slice(0, info.indent) + BOX + NBSP;
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
    <div ref={wrap} className="rich-wrap">
      <div ref={el} className={placeholder && empty ? "rich is-empty" : "rich"} contentEditable suppressContentEditableWarning spellCheck
        style={{ minHeight, fontFamily }} onFocus={() => onFocusChange?.(true)} onBlur={() => onFocusChange?.(false)} onInput={(e) => { if (!(e.nativeEvent as InputEvent).isComposing) tidyMarks(true); checkEmpty(); onChange(); }}
        onCompositionEnd={() => tidyMarks(true)}
        data-placeholder={placeholder} onClick={onClick} onKeyDown={onKeyDown} onPaste={onPaste} onCopy={(e) => onCopy(e)} onCut={(e) => onCopy(e, true)} {...linkHandlers} />
      {heads.map((h) => (
        <button key={h.key} type="button" className={h.folded ? "pn-done-head is-folded" : "pn-done-head"} style={{ top: h.top, height: HEAD_H - 4 }}
          aria-expanded={!h.folded} onMouseDown={(e) => e.preventDefault()} onClick={() => toggleFold(h)}>
          <svg className="pn-done-chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {h.count} completed
        </button>
      ))}
    </div>
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
function setDone(block: HTMLElement, t: Text | null, at: number, done: boolean) {
  if (done && t) {
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
