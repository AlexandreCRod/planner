import assert from "node:assert/strict";
import { test } from "node:test";
import { leaveSheet, sheetBack } from "../src/ui/phone/todoSheetReturn.ts";

test("back from a to-do brings the sheet back at the same place, once", () => {
  leaveSheet(420);
  assert.equal(sheetBack("#/item/12", true), null);
  assert.equal(sheetBack("#/today", true), 420);
  assert.equal(sheetBack("#/today", true), null);
});

test("through the editor and a linked note, the sheet waits for the way back", () => {
  leaveSheet(80);
  assert.equal(sheetBack("#/item/12", true), null);
  assert.equal(sheetBack("#/item/12?edit=1", false), null);
  assert.equal(sheetBack("#/note/7", true), null);
  assert.equal(sheetBack("#/item/12", true), null);
  assert.equal(sheetBack("#/", true), 80);
});

test("a scroll of nothing still brings the sheet back", () => {
  leaveSheet(0);
  assert.equal(sheetBack("#/today", true), 0);
});

test("leaving for another tab drops it: Today later opens plain", () => {
  leaveSheet(300);
  assert.equal(sheetBack("#/calendar", false), null);
  assert.equal(sheetBack("#/today", true), null);
});

test("a tap on Today's own tab on the wide rail isn't going back", () => {
  leaveSheet(300);
  assert.equal(sheetBack("#/today", false), null);
  assert.equal(sheetBack("#/today", true), null);
});

test("with nothing left, routes do nothing", () => {
  assert.equal(sheetBack("#/today", true), null);
});
