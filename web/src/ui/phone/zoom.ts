// The time grid's pinch zoom, as TimeGrid.kt does it: the hour height follows the spread of the two
// fingers, between "the whole day fits" and 160 dp, and the spot between the fingers stays put.
// Pure maths, so it can be tested without a touch screen.

/** Tallest hour, in dp (CalendarScreen.kt's MAX_HOUR_HEIGHT). */
export const MAX_HOUR_HEIGHT = 160;

/** The hour height after the fingers' spread went from [d0] to [d] px, starting at [h0]. */
export function pinchHourHeight(h0: number, d0: number, d: number, minH: number, maxH = MAX_HOUR_HEIGHT): number {
  const k = d0 > 0 ? d / d0 : 1;
  return Math.min(maxH, Math.max(minH, h0 * k));
}

/**
 * The scroll offset that keeps the content under [focusY] (px from the top of the scrolling view)
 * where it is when the hour height goes from [oldH] to [newH].
 */
export function zoomScrollTop(scrollTop: number, focusY: number, oldH: number, newH: number): number {
  return Math.max(0, (scrollTop + focusY) * (newH / oldH) - focusY);
}

/** Room left above the 06:00 line when the grid opens, so its label (centred on the line) reads whole. */
export const OPENING_ROOM = 9;

/** Where the grid opens: at 06:00, with a little room above its line for the label. */
export function openingScrollTop(hourH: number): number {
  return Math.max(0, hourH * 6 - OPENING_ROOM);
}

/** The opening zoom: 06:00 to 24:00 fills [viewH], within the limits; or the zoom chosen before. */
export function openingHourHeight(viewH: number, saved: number | null): number {
  const minH = viewH / 24;
  return Math.min(MAX_HOUR_HEIGHT, Math.max(minH, saved ?? viewH / 18));
}
