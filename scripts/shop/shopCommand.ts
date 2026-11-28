import { CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import { reply } from "../core/commandResult";
import { t } from "../core/lang";
import { defineBusCommand } from "../commands/busCommand";
import { onScriptEvent, scriptEventPlayer } from "../events/scriptEvents";
import { canUse } from "../permissions/permissionStore";
import { SHOP_PERMISSION } from "./shopUI";
import { SHOP_TARGET_ENUM, SHOP_TARGET_WORDS, isShopTarget, openShopTarget } from "./shopTargets";

// /bus:shop [buy | sell | category <id>]
// Command enums are fixed at startup, when saved shop data can't be read yet (getDynamicProperty throws in
// early execution), so the enum only holds fixed words and the category id is a separate String parameter.
defineBusCommand({
  name: "bus:shop",
  description: "bus.command.shop.description",
  enums: { [SHOP_TARGET_ENUM]: SHOP_TARGET_WORDS },
  optionalParameters: [
    { name: SHOP_TARGET_ENUM, type: CustomCommandParamType.Enum },
    { name: "id", type: CustomCommandParamType.String },
  ],
  permission: { key: SHOP_PERMISSION, label: t("bus.perm.shop.name"), defaultEveryone: true },
  run: (origin, target?: string, id?: string) => {
    const player = origin.sourceEntity;
    if (!(player instanceof Player))
      return reply(origin, CustomCommandStatus.Failure, "bus.command.players_only", "Players only.");
    const key = target === "category" ? id?.trim() : target;
    if ((target === "category" && !key) || (key && !isShopTarget(key)))
      return reply(origin, CustomCommandStatus.Failure, "bus.shop.error.unknown_target", "Unknown shop category.");
    system.run(() => openShopTarget(player, key));
    return reply(origin, CustomCommandStatus.Success, "bus.shop.command.opening", "Opening the shop.");
  },
});

// /scriptevent bus:shop [buy | sell | <category id>] — run by a player (or `/execute as <player> run scriptevent ...`).
// Accepts any category id, including ones the command enum doesn't list.
onScriptEvent("bus:shop", (event) => {
  const player = scriptEventPlayer(event);
  if (!player) {
    console.warn(
      "[bus:shop] scriptevent needs a player source (use /execute as <player> run scriptevent bus:shop ...)"
    );
    return;
  }
  if (!canUse(player, SHOP_PERMISSION)) return;
  const key = event.message.trim();
  if (!openShopTarget(player, key || undefined)) console.warn(`[bus:shop] unknown category "${key}"`);
});
