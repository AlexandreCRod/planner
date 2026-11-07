// The snackbar's one message at a time (shown by SnackbarHost in m3.tsx): kept apart from the drawing so the
// rules (replacing a message tells the old one, a card can take its own message away) can be tested on their own.

export interface Snack { id: number; text: string; action?: string; onAction?: () => void; onGone?: () => void; ms: number }
let snack: Snack | null = null;
let snackId = 0;
const snackListeners = new Set<() => void>();
export const currentSnack = () => snack;
export function onSnack(l: () => void) { snackListeners.add(l); return () => { snackListeners.delete(l); }; }
/** Replacing or hiding a snackbar whose action wasn't taken tells it (onGone): a held-back delete then happens. */
export const setSnack = (s: Snack | null, acted = false) => {
  const prev = snack;
  snack = s;
  snackListeners.forEach((l) => l());
  if (prev && prev !== s && !acted) prev.onGone?.();
};

/**
 * Shows a message at the bottom, with an optional action (Undo). Like the native one: 4 s on its own,
 * 10 s (SnackbarDuration.Long) with an action, which also gets a close button. Returns its id, for hideSnackbar.
 */
export function showSnackbar(text: string, action?: string, onAction?: () => void, opts: { ms?: number; onGone?: () => void } = {}): number {
  const id = ++snackId;
  setSnack({ id, text, action, onAction, onGone: opts.onGone, ms: opts.ms ?? (action ? 10000 : 4000) });
  return id;
}

/**
 * Takes message [id] away if it's still shown, as when its action is used (its onGone isn't called): the same
 * Undo was used somewhere else (review of 2.10.4, finding 3: a card's Undo left "It won't ring tomorrow" up).
 */
export function hideSnackbar(id: number) {
  if (snack?.id === id) setSnack(null, true);
}
