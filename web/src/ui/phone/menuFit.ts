// Where a dropdown menu fits across the screen (review C2): a menu anchored by its left edge near the right of
// the screen (a routine chip on the right of Today's line) moves left until it's whole, and one anchored by
// its right edge near the left moves right. Pure, for the tests.

/** How far (px) to move a menu at [left] that's [width] wide so it stays [pad] inside a [viewW] wide screen. */
export function menuShiftX(left: number, width: number, viewW: number, pad = 8): number {
  if (left + width > viewW - pad) return Math.max(pad, viewW - pad - width) - left;
  if (left < pad) return pad - left;
  return 0;
}
