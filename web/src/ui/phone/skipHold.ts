// An alarm card's Skip and its Undo (369): the message at the bottom, and the top line held while it lasts.
import { useSyncExternalStore } from "react";
import { hideSnackbar, showSnackbar } from "./snackbar.ts";

/**
 * While a card's Skip can still be undone, what it skipped ("won't ring tomorrow"): if that was the only alarm on,
 * the "Alarm in ..." line at the top stays in place saying so, so the card and its Undo don't jump up. Each Skip
 * holds it with its own token, and its message going clears only its own hold (review of 2.10.4, finding 2: a
 * second Skip's message replacing the first one's cleared the line the second had just held).
 */
let held: { text: string; token: number } | null = null;
let tokens = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const skipHeld = () => held?.text ?? null;
export const useSkipHeld = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, skipHeld);
function release(token: number) {
  if (held?.token !== token) return;
  held = null;
  emit();
}

/** One Skip's message and hold. */
export interface SkipNote { snack: number; token: number }

/**
 * After a Skip: the message [text] with Undo ([onUndo]), and the top line [line] held while it shows; [onGone]
 * when it goes without its Undo.
 */
export function announceSkip(text: string, line: string, onUndo: () => void, onGone: () => void): SkipNote {
  const token = ++tokens;
  held = { text: line, token };
  emit();
  const snack = showSnackbar(text, "Undo", () => { release(token); onUndo(); }, { onGone: () => { release(token); onGone(); } });
  return { snack, token };
}

/** The card's own Undo: its message goes too, and the held line. */
export function endSkip(note: SkipNote) {
  hideSnackbar(note.snack);
  release(note.token);
}
