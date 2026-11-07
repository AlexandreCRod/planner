// What a notification (or the alarm clock's icon) opens in the app (371).

/** The hash a launch opens: an item, or a section of the Clock page. Null when nothing was asked. */
export function launchHash(l: { itemId?: number; section?: string }): string | null {
  if (l.itemId) return `#/item/${l.itemId}`;
  if (l.section) return `#/alarms/${l.section}`;
  return null;
}
