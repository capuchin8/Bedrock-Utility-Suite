import {
  CommandPermissionLevel,
  CustomCommandStatus,
  Player,
  system,
  world,
  type CustomCommandOrigin,
  type CustomCommandParameter,
  type CustomCommandResult,
} from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";
import { reply } from "../core/commandResult";
import { raw, t } from "../core/lang";
import { isCommandAllowedInCombat, isInCombat } from "../combat/combatStore";
import { canUse, registerPermission } from "../permissions/permissionStore";

export interface BusCommandDefinition {
  /** Must use the bus: namespace, e.g. "bus:nickname". */
  name: string;
  description: string;
  mandatoryParameters?: CustomCommandParameter[];
  optionalParameters?: CustomCommandParameter[];
  cheatsRequired?: boolean;
  /**
   * Custom enums used by this command's parameters. Enum names must be unique across all commands.
   * Can be a function when the values come from other modules' registrations (it runs at startup,
   * after every module has loaded), e.g. the settings section names.
   */
  enums?: Record<string, string[]> | (() => Record<string, string[]>);
  /**
   * Extra rule checked when canUse says no: return true to let this player run the command anyway.
   * (Used by /bus:owner so the first owner can be claimed when none exists.)
   */
  access?: (player: Player) => boolean;
  /** true = a pack setting can't disable it (use for commands the system needs, like /bus:owner). */
  essential?: boolean;
  /**
   * Visibility level used when no pack setting exists for this command (default Any).
   * A pack setting always wins over it.
   */
  defaultLevel?: CommandPermissionLevel;
  permission?: {
    /** Defaults to the command name. Share a key to share one permission (e.g. a menu and its command). */
    key?: string;
    /** Defaults to the literal command name. */
    label?: UIRawMessage;
    /** true = everyone until changed; default false = operators + granted roles only. */
    defaultEveryone?: boolean;
    /** true = only the owner can run it. */
    ownerOnly?: boolean;
  };
  /**
   * Optional: change the parameters when the command is registered, based on the pack settings
   * (read once at startup, so a change needs a world reload). Return undefined to keep the
   * parameters above. Example: /bus:mute makes the reason mandatory when the owner turns that setting on.
   */
  configure?: (
    settings: Record<string, unknown>
  ) => { mandatoryParameters?: CustomCommandParameter[]; optionalParameters?: CustomCommandParameter[] } | undefined;
  /** Only runs if the permission check passes. Mutations must be deferred with system.run. */
  run: (origin: CustomCommandOrigin, ...args: any[]) => CustomCommandResult | undefined;
}

// ---- pack-setting "visibility ceiling" ---------------------------------------------------------
// A command can have a dropdown pack setting named "bus:command_permission_<name>" (for
// "bus:impulse" that is "bus:command_permission_impulse"). It decides who can even SEE and run
// the command at the game level:
//   disabled -> the command is not registered at all
//   any      -> everyone sees it; BUS roles/permissions decide who may actually use it
//   game_directors / admin / host / owner -> vanilla hides it from everyone below that level, so
//                                            role grants can't give it to non-operators.
// Pack settings are read once at startup, so changes need a world reload.

type Ceiling = CommandPermissionLevel | "disabled";

const CEILING_BY_NAME: Record<string, Ceiling> = {
  disabled: "disabled",
  any: CommandPermissionLevel.Any,
  game_directors: CommandPermissionLevel.GameDirectors,
  admin: CommandPermissionLevel.Admin,
  host: CommandPermissionLevel.Host,
  owner: CommandPermissionLevel.Owner,
};
const CEILING_NAMES = ["disabled", "any", "game_directors", "admin", "host", "owner"];

const ceilings = new Map<string, Ceiling>();

/** The ceiling a command was registered with (undefined before startup or for unknown keys). */
export function getCommandCeiling(permissionKey: string): Ceiling | undefined {
  return ceilings.get(permissionKey);
}

function readCeiling(def: BusCommandDefinition, settings: Record<string, unknown>): Ceiling {
  const commandName = def.name;
  const shortName = commandName.slice(commandName.indexOf(":") + 1);
  const value = settings[`bus:command_permission_${shortName}`];
  if (typeof value === "string" && value in CEILING_BY_NAME) return CEILING_BY_NAME[value];
  // Be forgiving if the game hands back the option index instead of its name.
  if (typeof value === "number" && CEILING_NAMES[value]) return CEILING_BY_NAME[CEILING_NAMES[value]];
  return def.defaultLevel ?? CommandPermissionLevel.Any; // no pack setting: gated by roles
}

const pending: BusCommandDefinition[] = [];

function keyOf(def: BusCommandDefinition): string {
  return def.permission?.key ?? def.name;
}

/** Call at the top level of a module file. Registration happens once at startup. */
export function defineBusCommand(def: BusCommandDefinition): void {
  if (!def.name.startsWith("bus:")) throw new Error(`Command name must use the bus: namespace ("${def.name}")`);
  const descriptionIsKey = /^bus\.[a-z0-9_.]+$/.test(def.description);
  registerPermission({
    key: keyOf(def),
    label: def.permission?.label ?? raw(`/${def.name}`),
    description: descriptionIsKey ? t(def.description) : raw(def.description),
    category: "command",
    defaultEveryone: def.permission?.defaultEveryone ?? false,
    ownerOnly: def.permission?.ownerOnly ?? false,
  });
  pending.push(def);
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  // getPackSettings() is documented as callable in early-execution mode (i.e. here).
  let settings: Record<string, unknown> = {};
  try {
    settings = world.getPackSettings();
  } catch {
    // pack settings unavailable: every command falls back to "any"
  }

  for (const def of pending) {
    const key = keyOf(def);
    const ceiling = readCeiling(def, settings);
    ceilings.set(key, ceiling);
    if (ceiling === "disabled" && !def.essential) continue;

    for (const [enumName, values] of Object.entries(
      typeof def.enums === "function" ? def.enums() : (def.enums ?? {})
    )) {
      customCommandRegistry.registerEnum(enumName, values);
    }

    const override = def.configure?.(settings);
    customCommandRegistry.registerCommand(
      {
        name: def.name,
        description: def.description,
        permissionLevel: ceiling === "disabled" ? CommandPermissionLevel.Any : ceiling,
        mandatoryParameters: override?.mandatoryParameters ?? def.mandatoryParameters,
        optionalParameters: override?.optionalParameters ?? def.optionalParameters,
        cheatsRequired: def.cheatsRequired,
      },
      (origin, ...args) => {
        const source = origin.sourceEntity;
        // Console / command blocks / non-player sources are trusted; players are checked.
        if (source instanceof Player) {
          if (!canUse(source, key) && !def.access?.(source)) {
            return reply(origin, CustomCommandStatus.Failure, "bus.command.no_permission", "No permission.");
          }
          if (isInCombat(source) && !isCommandAllowedInCombat(key)) {
            return reply(origin, CustomCommandStatus.Failure, "bus.command.in_combat", "Not usable in combat.");
          }
        }
        return def.run(origin, ...args);
      }
    );
  }
});
