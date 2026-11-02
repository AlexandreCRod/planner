// The calendar grids' blocks (231): how many lines of title a block shows.

/** A block's title line, in px (phone.css .pg-block). */
export const BLOCK_LINE = 12;
/**
 * What a block's border and top padding take from the room its text can show (phone.css .pg-block: a 1 px
 * border and 2 px padding; the text is clipped at the inner edge of the bottom border, so it may use the
 * bottom padding). Review of 2.10, finding 4: without it the last line lost 1-4 px of its 12.
 */
export const BLOCK_INSET = 4;
/**
 * How many whole lines of text a block [h] px tall (its outer height, as drawn) shows (231): its title wraps
 * over them when there are two or more (breaking between words, inside one only when a word is wider than
 * the block), else it's one line; either way the text is cut only at the block's edge, its last line fading
 * out there, never shortened to "Dent…", and never cut through its letters.
 */
export const blockLines = (h: number): number => Math.max(1, Math.floor((h - BLOCK_INSET) / BLOCK_LINE));
