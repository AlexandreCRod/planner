// The calendar grids' blocks (231, 334): how many lines a block holds, and where its tick goes.

/** A block's title line, in px (phone.css .pg-block). */
export const BLOCK_LINE = 12;
/**
 * What a block's border and top padding take from the room its text can show (phone.css .pg-block: a 1 px
 * border and 2 px padding; the text is clipped at the inner edge of the bottom border, so it may use the
 * bottom padding). Review of 2.10, finding 4: without it the last line lost 1-4 px of its 12.
 */
export const BLOCK_INSET = 4;
/** How many whole lines of text a block [h] px tall (its outer height, as drawn) holds; never fewer than one. */
export const blockLines = (h: number): number => Math.max(1, Math.floor((h - BLOCK_INSET) / BLOCK_LINE));

/**
 * Week and 3-day blocks (334, reversing 231's wrapping at the user's request): the title is one line that never
 * wraps and fades out at the block's edge. A routine's or a task's tick takes the first line by itself and the
 * title starts under it with the block's whole width, when the block holds two lines or more; a shorter block
 * has the tick and the title side by side on its one line.
 */
export const tickOwnLine = (h: number, ticks: boolean): boolean => ticks && blockLines(h) >= 2;
