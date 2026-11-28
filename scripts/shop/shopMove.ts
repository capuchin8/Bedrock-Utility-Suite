import { findCategory, findParent, getRoot } from "./shopStore";
import type { ShopCategory, ShopTree } from "./shopTypes";

export type EntryKind = "items" | "kits" | "sellables";

export interface Destination {
  id: string;
  name: string;
  /** 0 = the shop's top level. */
  depth: number;
}

/** Every category of a shop, in display order, with how deep it sits. */
export function listDestinations(tree: ShopTree, exclude?: Set<string>): Destination[] {
  const out: Destination[] = [];
  const walk = (c: ShopCategory, depth: number): void => {
    if (exclude?.has(c.id)) return; // also skips everything below it
    out.push({ id: c.id, name: c.name, depth });
    c.children.forEach((ch) => walk(ch, depth + 1));
  };
  walk(getRoot(tree), 0);
  return out;
}

/** The category's own id plus the ids of everything below it. */
export function subtreeIds(cat: ShopCategory): Set<string> {
  const ids = new Set<string>();
  const walk = (c: ShopCategory): void => {
    ids.add(c.id);
    c.children.forEach(walk);
  };
  walk(cat);
  return ids;
}

/** Moves an item, kit or sell item to another category of the same shop (added at the end). */
export function moveEntry(kind: EntryKind, fromId: string, entryId: string, toId: string): boolean {
  const tree: ShopTree = kind === "sellables" ? "sell" : "buy";
  const from = findCategory(fromId, getRoot(tree));
  const to = findCategory(toId, getRoot(tree));
  if (!from || !to || from === to) return false;
  const source = from[kind] as { id: string }[];
  const index = source.findIndex((x) => x.id === entryId);
  if (index < 0) return false;
  const [entry] = source.splice(index, 1);
  (to[kind] as { id: string }[]).push(entry);
  return true;
}

/** Moves a category (with everything inside it) under another category of the same shop. */
export function moveCategory(tree: ShopTree, id: string, toId: string): boolean {
  const root = getRoot(tree);
  const cat = findCategory(id, root);
  const to = findCategory(toId, root);
  if (!cat || !to || cat === root) return false;
  if (subtreeIds(cat).has(to.id)) return false; // can't go inside itself
  const parent = findParent(root, id);
  if (!parent || parent === to) return false;
  parent.children = parent.children.filter((c) => c.id !== id);
  to.children.push(cat);
  return true;
}
