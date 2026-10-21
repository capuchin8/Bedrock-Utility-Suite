import { CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import { reply } from "../core/commandResult";
import { t } from "../core/lang";
import { defineBusCommand } from "../commands/busCommand";
import { canUse } from "../permissions/permissionStore";
import { SHOP_PERMISSION, openShop } from "./shopUI";
import { findCategory, getShop, treeOf } from "./shopStore";

// /bus:shop [sell | <category id>]  (the settings screen shows each category's id)
defineBusCommand({
    name: "bus:shop",
    description: "Opens the shop",
    optionalParameters: [{ name: "target", type: CustomCommandParamType.String }],
    permission: { key: SHOP_PERMISSION, label: t("bus.perm.shop.name"), defaultEveryone: true },
    run: (origin, target?: string) => {
        const player = origin.sourceEntity;
        if (!(player instanceof Player)) return reply(origin, CustomCommandStatus.Failure, "bus.command.players_only", "Players only.");
        const key = target?.trim();
        if (key && key !== "sell" && !findCategory(key)) return reply(origin, CustomCommandStatus.Failure, "bus.shop.error.unknown_target", "Unknown shop category.");
        system.run(() => open(player, key));
        return reply(origin, CustomCommandStatus.Success, "bus.shop.command.opening", "Opening the shop.");
    },
});

function open(player: Player, key?: string): void {
    if (!key) return openShop(player);
    if (key === "sell") return openShop(player, "sell");
    openShop(player, treeOf(key) ?? "buy", key);
}

// /scriptevent bus:shop [sell | <category id>] — run by a player (or `/execute as <player> run scriptevent ...`).
system.afterEvents.scriptEventReceive.subscribe(
    (ev) => {
        if (ev.id !== "bus:shop") return;
        const player = ev.sourceEntity;
        if (!(player instanceof Player)) {
            console.warn("[bus:shop] scriptevent needs a player source (use /execute as <player> run scriptevent bus:shop ...)");
            return;
        }
        if (!canUse(player, SHOP_PERMISSION)) return;
        const key = ev.message.trim();
        if (key && key !== "sell" && !findCategory(key)) {
            console.warn(`[bus:shop] unknown category "${key}" (known roots: ${getShop().buyRoot.id}, ${getShop().sellRoot.id})`);
            return;
        }
        open(player, key || undefined);
    },
    { namespaces: ["bus"] }
);
