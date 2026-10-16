// Counts in words: "1 task", "5 tasks", "0 conflicts" (never "task(s)").

/** [word] for one, [many] (the word plus "s" unless given) for any other count. */
export function plural(n: number, word: string, many = `${word}s`): string {
  return n === 1 ? word : many;
}

/** The count and its word: count(1, "task") is "1 task", count(5, "task") is "5 tasks". */
export function count(n: number, word: string, many?: string): string {
  return `${n} ${plural(n, word, many)}`;
}
