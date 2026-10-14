import { CommandPermissionLevel, PlayerPermissionLevel, world, type Player } from "@minecraft/server";
import { CustomForm } from "@minecraft/server-ui";
import { raw, t } from "../core/lang";
import { getListedOwners, isListedOwner, removeListedOwner } from "../permissions/owners";
import { canClaimOwnership } from "../permissions/ownership";
import { isOperator, isOwner } from "../permissions/permissionStore";
import { createGuard } from "../settings/guard";
import { showForm } from "../settings/openForm";
import { registerSettingsSection } from "../settings/registry";

// DEBUG-ONLY MENU. Everything inside the `dev:` label below is removed from production builds by esbuild
// (justfile: dropLabels: ["dev"] when --production is passed). The text here is intentionally not
// translated, since it never ships.

const KEY = "bus:debug";

const levelName = (level: CommandPermissionLevel): string =>
  `${CommandPermissionLevel[level] ?? "?"} (${String(level)})`;
const playerLevelName = (level: PlayerPermissionLevel): string =>
  `${PlayerPermissionLevel[level] ?? "?"} (${String(level)})`;

function describe(player: Player): string {
  return [
    `§f${player.name}`,
    `  commandPermissionLevel: §e${levelName(player.commandPermissionLevel)}§r`,
    `  playerPermissionLevel: §e${playerLevelName(player.playerPermissionLevel)}§r`,
    `  isOperator: §e${isOperator(player)}§r   isOwner: §e${isOwner(player)}§r   listed owner: §e${isListedOwner(player.id)}§r`,
    `  canClaimOwnership: §e${canClaimOwnership(player)}§r`,
  ].join("\n");
}

function openDebug(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  const reopen = (): void => openDebug(player, back);

  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, raw("Debug")));
    form.header(raw("You"));
    form.label(raw(describe(player)));

    const owners = Object.values(getListedOwners());
    const hostOnline = world.getAllPlayers().some((p) => p.commandPermissionLevel >= CommandPermissionLevel.Host);
    form.header(raw("Ownership"));
    form.label(
      raw(
        `Listed owners: §e${owners.length ? owners.join(", ") : "none"}§r\nHost-level player online: §e${hostOnline}§r`
      )
    );

    form.header(raw("Online players"));
    for (const p of world.getAllPlayers()) {
      if (p.id !== player.id) form.label(raw(describe(p)));
    }

    form.divider();
    form.button(
      raw("Refresh"),
      guard.click(() => {
        form.close();
        reopen();
      })
    );
    // Lets you test the "no owner yet, an operator can claim it" path again. Operators only.
    if (isOperator(player) || isOwner(player)) {
      form.button(
        raw("Clear listed owners"),
        guard.click(() => {
          for (const id of Object.keys(getListedOwners())) removeListedOwner(id);
          form.close();
          reopen();
        })
      );
    }
    form.button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}

dev: {
  registerSettingsSection({
    id: KEY,
    title: raw("Debug (dev builds only)"),
    description: raw("Permission levels, owner detection and the ownership-claim check"),
    order: 990,
    // Open to everyone on purpose: the point is to see what a non-owner / operator / realm owner gets.
    defaultEveryone: true,
    open: (player, back) => openDebug(player, back),
  });
}
