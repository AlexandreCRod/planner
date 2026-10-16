// The PC's short message at the bottom of the window, with an optional action ("Undo"); the phone has
// its own snackbar. One at a time: a new one replaces the last.
import { useEffect, useSyncExternalStore } from "react";

interface Toast { id: number; text: string; action?: string; onAction?: () => void }
let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(text: string, action?: string, onAction?: () => void) {
  current = { id: nextId++, text, action, onAction };
  emit();
}
const hide = (id: number) => { if (current?.id === id) { current = null; emit(); } };

export function ToastHost() {
  const t = useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => current);
  useEffect(() => {
    if (!t) return;
    const timer = window.setTimeout(() => hide(t.id), t.action ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  return (
    <div className="toast" role="status">
      <span className="grow">{t.text}</span>
      {t.action && <button className="toast-action" onClick={() => { hide(t.id); t.onAction?.(); }}>{t.action}</button>}
      <button className="toast-close" title="Close" aria-label="Close" onClick={() => hide(t.id)}>✕</button>
    </div>
  );
}
