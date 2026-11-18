import { system, type Player } from "@minecraft/server";
import { ActionFormData, CustomForm, ObservableString } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { heldStack } from "../../shop/shopItems";
import { StatusLabel } from "../../shop/statusLabel";
import {
  clearIconOverride,
  getIconOverride,
  listIconOverrides,
  setIconOverride,
} from "../../ui/itemPicker/iconOverrideStore";
import { confirmButton } from "../confirmButton";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:item_icons";
const W = { clientWritable: true } as const;

registerSettingsSection({
  id: KEY,
  title: t("bus.section.item_icons.title"),
  description: t("bus.section.item_icons.desc"),
  order: 46,
  open: (player, back) => openIconOverrides(player, back),
});

const fullId = (id: string): string => {
  const s = id.trim();
  return !s || s.includes(":") ? s : `minecraft:${s}`;
};

function openIconOverrides(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  const reopen = (): void => openIconOverrides(player, back);
  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.section.item_icons.title")));
    form.label(t("bus.icons.intro"));
    const overrides = listIconOverrides();
    if (!overrides.length) form.label(t("bus.icons.none"));
    for (const o of overrides) {
      form.button(
        raw(o.typeId.replace(/^minecraft:/, "")),
        guard.click(() => {
          form.close();
          openIconOverrideEditor(player, reopen, o.typeId);
        })
      );
    }
    form.button(
      t("bus.icons.add"),
      guard.click(() => {
        form.close();
        openIconOverrideEditor(player, reopen);
      })
    );
    form.button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}

/**
 * Edit (or create) the icon used for one item id everywhere BUS shows item icons (the shop, item pickers).
 * `draftPath` keeps what was typed when the screen is reopened (after Preview or Use held item).
 */
export function openIconOverrideEditor(player: Player, back: () => void, typeId = "", draftPath?: string): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;

  showForm(player, () => {
    let id = typeId;
    let path = draftPath ?? (typeId ? (getIconOverride(typeId) ?? "") : "");
    const status = new StatusLabel();
    const reopen = (nextId = id, nextPath = path): void => openIconOverrideEditor(player, back, nextId, nextPath);

    const idField = new ObservableString(id, W);
    guard.on(idField, (v: string) => (id = fullId(v)));
    const pathField = new ObservableString(path, W);
    guard.on(pathField, (v: string) => (path = v.trim()));

    const form = guard.attach(new CustomForm(player, t("bus.icons.edit.title")));
    form
      .label(t("bus.icons.edit.intro"))
      .textField(t("bus.icons.item_id"), idField, { description: t("bus.icons.item_id.desc") })
      .button(
        t("bus.icons.use_held"),
        guard.click(() =>
          system.run(() => {
            const held = heldStack(player);
            if (!held) {
              status.set(t("bus.shopedit.use_held.none"));
              return;
            }
            form.close();
            reopen(held.typeId, path);
          })
        )
      )
      .textField(t("bus.icons.path"), pathField, { description: t("bus.icons.path.desc") })
      .button(
        t("bus.icons.save"),
        guard.click(() => {
          if (!id || !path) {
            status.set(t("bus.icons.error.missing"));
            return;
          }
          if (!setIconOverride(id, path)) {
            status.set(t("bus.icons.error.too_long"));
            return;
          }
          status.set(t("bus.icons.saved"));
        })
      )
      .button(
        t("bus.icons.preview"),
        guard.click(() => {
          if (!path) {
            status.set(t("bus.icons.error.missing"));
            return;
          }
          const shownId = id;
          const shownPath = path;
          form.close();
          system.run(() => {
            new ActionFormData()
              .title(raw(shownId || shownPath))
              .body(raw(shownPath))
              .button(t("bus.common.back"), shownPath)
              .show(player)
              .then(() => reopen(shownId, shownPath))
              .catch(() => undefined);
          });
        })
      );
    if (id && getIconOverride(id)) {
      confirmButton(
        form,
        t("bus.icons.remove"),
        guard.click(() => {
          clearIconOverride(id);
          form.close();
          back();
        })
      );
    }
    form
      .spacer()
      .label(status.message, { visible: status.visible })
      .spacer()
      .button(t("bus.common.back"), () => {
        form.close();
        back();
      });
    return form.closeButton();
  });
}
