// The priority menu (a to-do's flag, an item's flag and its field): each level with its flag, the current one
// ticked (review C7: with the flag's name gone from its hold, the menu is where the level can be read).
import { PRIORITIES, priorityColor } from "../../domain/types.ts";
import type { MenuItem } from "./chrome.tsx";

export const priorityItems = (pick: (p: number) => void, current = -1): MenuItem[] =>
  PRIORITIES.map((p, i) => ({ label: p, icon: "oFlag", iconColor: i ? priorityColor(i) : undefined, checked: i === current, onClick: () => pick(i) }));
