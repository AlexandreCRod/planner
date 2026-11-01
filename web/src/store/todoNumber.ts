// The cleared to-dos number (304; the rules are in domain/todoNumber.ts) as one synced record, so clearing
// it on one device clears it everywhere. Kind "todoNumber": any device writes it. If the phone and the PC both
// change it between syncs the phone wins, as with any record (server/src/records.ts clientWins), not the later.
// It needs nothing new of the Worker, and an older app just carries the record without reading it.
import { type ClearedTodos, clearedNow, isTodo } from "../domain/todoNumber.ts";
import type { Item } from "../domain/types.ts";
import { allRecords, listOf, putRecords, withUndo } from "./store.ts";

const ID = "number";

interface TodoNumberRecord { id: string; cleared: ClearedTodos | null; updatedAt: number }

/** What the number was cleared of, or null when it isn't cleared. */
export const todosCleared = (): ClearedTodos | null => (allRecords().get(`todoNumber/${ID}`) as TodoNumberRecord | undefined)?.cleared ?? null;

const write = (cleared: ClearedTodos | null) => putRecords("todoNumber", [{ id: ID, cleared, updatedAt: Date.now() } satisfies TodoNumberRecord]);

/** Clears the number. Returns the undo. */
export const clearTodoNumber = (): (() => void) => withUndo(() => write(clearedNow(listOf<Item>("items").filter(isTodo))));

/** Brings back the normal count. */
export const showTodoNumber = () => write(null);
