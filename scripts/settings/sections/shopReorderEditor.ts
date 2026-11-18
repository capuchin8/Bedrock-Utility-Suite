import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableNumber } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { findCategory, flushSave, getRoot } from "../../shop/shopStore";
import type { ShopTree } from "../../shop/shopTypes";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { KEY } from "./shopEntryEditor";

const W = { clientWritable: true } as const;

export type ReorderKind = "categories" | "items" | "kits" | "sellables";

/**
 * Pick a new position for each entry from its dropdown; the list is re-sorted and the screen reopens.
 * Order here is the order players see in the shop.
 */
export function openReorderEditor(
  player: Player,
  tree: ShopTree,
  categoryId: string,
  kind: ReorderKind,
  back: () => void
): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  const cat = findCategory(categoryId, getRoot(tree));
  if (!cat) return back();
  const list: { id: string; name: string }[] =
    kind === "categories" ? cat.children : kind === "items" ? cat.items : kind === "kits" ? cat.kits : cat.sellables;
  const reopen = (): void => openReorderEditor(player, tree, categoryId, kind, back);

  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t(`bus.shopedit.reorder_${kind}.title`)));
    form.label(t("bus.shopedit.reorder.intro"));
    const positions = list.map((_x, n) => ({ label: raw(String(n + 1)), value: n }));
    list.forEach((entry, i) => {
      const pos = new ObservableNumber(i, W);
      guard.on(pos, (v: number) => {
        const to = Math.max(0, Math.min(list.length - 1, Math.round(v)));
        if (to === i) return;
        const [moved] = list.splice(i, 1);
        list.splice(to, 0, moved);
        flushSave();
        system.run(() => {
          form.close();
          reopen();
        });
      });
      form.dropdown(raw(entry.name), pos, positions);
    });
    form.spacer().button(t("bus.common.back"), () => {
      flushSave();
      form.close();
      back();
    });
    return form.closeButton();
  });
}
