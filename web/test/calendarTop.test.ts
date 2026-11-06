import assert from "node:assert/strict";
import { test } from "node:test";
import { CALENDAR_LISTS, listsToTop } from "../src/ui/phone/calendarTop.ts";

// Review of 2.10.2, finding 6: in the Agenda view, a tap on the Calendar tab (or Today) didn't go back to the top.
// A small stand-in for the calendar's body: it finds elements by class, as the page does.
function fakeBody(lists: { cls: string; scrollTop: number }[]) {
  return {
    querySelectorAll: (sel: string) => lists.filter((l) => sel.split(",").some((s) => s.trim() === `.${l.cls}`)) as unknown as NodeListOf<HTMLElement>,
  };
}

test("the jump to today scrolls the Agenda and Month's day list back to the top, and leaves the week grid's hour", () => {
  const agenda = { cls: "p-agenda", scrollTop: 1400 }, day = { cls: "p-dayagenda", scrollTop: 300 }, grid = { cls: "p-weekscroll", scrollTop: 520 };
  listsToTop(fakeBody([agenda, day, grid]) as unknown as ParentNode);
  assert.equal(agenda.scrollTop, 0);
  assert.equal(day.scrollTop, 0);
  assert.equal(grid.scrollTop, 520);
  assert.match(CALENDAR_LISTS, /\.p-agenda\b/);
});
