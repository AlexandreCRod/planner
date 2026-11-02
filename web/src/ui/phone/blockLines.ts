// The calendar grids' blocks (231): how many lines of title a block shows.

/** A block's title line, in px (phone.css .pg-block). */
export const BLOCK_LINE = 12;
/**
 * How many whole lines of text a block [h] px tall (its content box) shows (231): its title wraps over
 * them when there are two or more (breaking between words, inside one only when a word is wider than the
 * block), else it's one line; either way the text is cut only at the block's edge, its last line fading
 * out there, never shortened to "Dent…".
 */
export const blockLines = (h: number): number => Math.max(1, Math.floor(h / BLOCK_LINE));
