// The Display check page's colours (364, DisplayCheck.tsx), apart so they can be tested.
import { PRIORITIES } from "../../domain/types.ts";

export interface Swatch { name: string; color: string }

/** The near-blacks beside true black: what the cards and sheets sit on (364). */
export const BLACKS: Swatch[] = [{ name: "True black", color: "#000000" }, { name: "Near-black", color: "#0c0c0f" }, { name: "Card", color: "#17171b" }];

/** The swatch groups, in the page's order: the categories as the user has them, then the fixed colours ([chart]: the charts' marks). */
export function displaySwatches(categories: readonly Swatch[], chart: readonly Swatch[] = []): { title: string; list: Swatch[] }[] {
  return [
    { title: "Categories", list: categories.map((c) => ({ name: c.name, color: c.color })) },
    { title: "Flags", list: PRIORITIES.slice(1).map((name, i) => ({ name, color: `var(--prio-${i + 1})` })) },
    { title: "Training", list: [
      { name: "Run", color: "var(--k-run)" }, { name: "Gym", color: "var(--k-gym)" }, { name: "Futsal", color: "var(--k-fut-now)" },
      ...chart,
    ] },
    { title: "Highlight", list: [{ name: "Highlight", color: "var(--p-primary)" }, { name: "Its container", color: "var(--p-primary-container)" }] },
  ];
}
