import type { Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import {
  getTeleportSettings,
  setTeleportRules,
  setTeleportSettings,
  TELEPORT_LIMITS,
  type TeleportKind,
} from "../../teleport/teleportSettings";
import { createGuard } from "../guard";
import { numberField } from "../numberField";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:teleport";
const WRITABLE = { clientWritable: true } as const;

registerSettingsSection({
  id: KEY,
  title: t("bus.section.teleport.title"),
  description: t("bus.section.teleport.desc"),
  order: 65,
  open: (player, back) => openTeleport(player, back),
});

function openTeleport(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const s = getTeleportSettings();
    const form = guard.attach(new CustomForm(player, t("bus.section.teleport.title")));
    form.label(t("bus.teleport.intro"));

    const flag = (label: string, value: boolean, apply: (v: boolean) => void, desc?: string): void => {
      const o = new ObservableBoolean(value, WRITABLE);
      guard.on(o, apply);
      form.toggle(t(label), o, desc ? { description: t(desc) } : undefined);
    };
    flag("bus.teleport.cancel_move", s.cancelOnMove, (v) => setTeleportSettings({ cancelOnMove: v }), "bus.teleport.cancel_move.desc");
    flag("bus.teleport.cancel_damage", s.cancelOnDamage, (v) => setTeleportSettings({ cancelOnDamage: v }));
    flag("bus.teleport.sounds", s.sounds, (v) => setTeleportSettings({ sounds: v }));

    const rules = (kind: TeleportKind): void => {
      const r = s.rules[kind];
      form.divider().header(t(`bus.teleport.kind.${kind}`));
      numberField(form, guard, "bus.teleport.cooldown", r.cooldown, TELEPORT_LIMITS.cooldown.min, TELEPORT_LIMITS.cooldown.max, (n) => setTeleportRules(kind, { cooldown: n }), {
        desc: "bus.teleport.cooldown.desc",
      });
      numberField(form, guard, "bus.teleport.warmup", r.warmup, TELEPORT_LIMITS.warmup.min, TELEPORT_LIMITS.warmup.max, (n) => setTeleportRules(kind, { warmup: n }), {
        desc: "bus.teleport.warmup.desc",
      });
      numberField(form, guard, "bus.teleport.cost", r.cost, TELEPORT_LIMITS.cost.min, TELEPORT_LIMITS.cost.max, (n) => setTeleportRules(kind, { cost: n }), {
        desc: "bus.teleport.cost.desc",
      });
      flag("bus.teleport.allow_combat", r.allowInCombat, (v) => setTeleportRules(kind, { allowInCombat: v }), "bus.teleport.allow_combat.desc");
    };
    rules("rtp");
    rules("tpa");

    numberField(form, guard, "bus.tpa.timeout", s.tpaTimeout, TELEPORT_LIMITS.tpaTimeout.min, TELEPORT_LIMITS.tpaTimeout.max, (n) => setTeleportSettings({ tpaTimeout: n }), {
      desc: "bus.tpa.timeout.desc",
    });
    flag("bus.tpa.allow_here", s.tpaAllowHere, (v) => setTeleportSettings({ tpaAllowHere: v }), "bus.tpa.allow_here.desc");

    form.divider().button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}
