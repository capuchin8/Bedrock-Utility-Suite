import { GameMode, Player, system, world } from "@minecraft/server";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";
import { t } from "../core/lang";
import { registerShareable } from "../share/shareRegistry";

const SETTINGS_KEY = "bus:combat_settings";
const COMMANDS_KEY = "bus:combat_commands";

export interface CombatSettings {
    /** Off by default: nothing changes until an admin turns combat tracking on. */
    enabled: boolean;
    /** How long a player stays "in combat" after the last hit, in seconds. */
    seconds: number;
    /** true = only player-vs-player hits start combat; false = any entity damaging a player (or a player hitting any entity). */
    pvpOnly: boolean;
    /** Dying ends combat. */
    clearOnDeath: boolean;
    /** Players in Creative or Spectator are never treated as in combat (checked when they use a command, so switching mode takes effect at once). */
    exemptCreative: boolean;
}

export const DEFAULT_COMBAT: CombatSettings = { enabled: false, seconds: 15, pvpOnly: true, clearOnDeath: true, exemptCreative: true };

export function normalizeCombat(v: unknown): CombatSettings | undefined {
    if (!isRecord(v)) return undefined;
    const d = DEFAULT_COMBAT;
    const secs = typeof v.seconds === "number" && Number.isFinite(v.seconds) ? Math.min(300, Math.max(1, Math.round(v.seconds))) : d.seconds;
    return {
        enabled: typeof v.enabled === "boolean" ? v.enabled : d.enabled,
        seconds: secs,
        pvpOnly: typeof v.pvpOnly === "boolean" ? v.pvpOnly : d.pvpOnly,
        clearOnDeath: typeof v.clearOnDeath === "boolean" ? v.clearOnDeath : d.clearOnDeath,
        exemptCreative: typeof v.exemptCreative === "boolean" ? v.exemptCreative : d.exemptCreative,
    };
}

export function getCombatSettings(): CombatSettings {
    return normalizeCombat(readWorldJson<unknown>(SETTINGS_KEY, {})) ?? DEFAULT_COMBAT;
}

export function setCombatSettings(patch: Partial<CombatSettings>): void {
    const next = normalizeCombat({ ...getCombatSettings(), ...patch });
    if (next) writeWorldJson(SETTINGS_KEY, next);
}

/** Only commands set to "not allowed" are stored; everything else is allowed in combat. */
function normalizeCommands(v: unknown): Record<string, boolean> | undefined {
    if (!isRecord(v)) return undefined;
    const out: Record<string, boolean> = {};
    for (const [k, allowed] of Object.entries(v)) if (typeof allowed === "boolean") out[k] = allowed;
    return out;
}

export function isCommandAllowedInCombat(permissionKey: string): boolean {
    return normalizeCommands(readWorldJson<unknown>(COMMANDS_KEY, {}))?.[permissionKey] ?? true;
}

export function setCommandAllowedInCombat(permissionKey: string, allowed: boolean): void {
    const all = normalizeCommands(readWorldJson<unknown>(COMMANDS_KEY, {})) ?? {};
    if (allowed) delete all[permissionKey];
    else all[permissionKey] = false;
    writeWorldJson(COMMANDS_KEY, all);
}

// ---- tracking (event-driven: a map of "in combat until tick N", no polling) --------------------
const until = new Map<string, number>();

export function isInCombat(player: Player): boolean {
    const end = until.get(player.id);
    if (end === undefined) return false;
    if (end <= system.currentTick) {
        until.delete(player.id);
        return false;
    }
    if (getCombatSettings().exemptCreative) {
        try {
            const mode = player.getGameMode();
            if (mode === GameMode.Creative || mode === GameMode.Spectator) return false;
        } catch {
            // player became invalid: fall through
        }
    }
    return true;
}

function tag(player: Player, seconds: number): void {
    until.set(player.id, system.currentTick + seconds * 20);
}

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
    const s = getCombatSettings();
    if (!s.enabled) return;
    const attacker = damageSource.damagingEntity;
    const victimIsPlayer = hurtEntity instanceof Player;
    const attackerIsPlayer = attacker instanceof Player;

    if (s.pvpOnly) {
        if (victimIsPlayer && attackerIsPlayer && hurtEntity.id !== attacker.id) {
            tag(hurtEntity, s.seconds);
            tag(attacker, s.seconds);
        }
        return;
    }
    if (victimIsPlayer && attacker && attacker.id !== hurtEntity.id) tag(hurtEntity, s.seconds);
    if (attackerIsPlayer && attacker.id !== hurtEntity.id) tag(attacker, s.seconds);
});

world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
    if (deadEntity instanceof Player && getCombatSettings().clearOnDeath) until.delete(deadEntity.id);
});
world.afterEvents.playerLeave.subscribe(({ playerId }) => until.delete(playerId));

registerShareable({
    id: "bus:combat",
    label: t("bus.share.combat"),
    export: () => ({
        settings: getCombatSettings(),
        commands: normalizeCommands(readWorldJson<unknown>(COMMANDS_KEY, {})) ?? {},
    }),
    import: (data) => {
        if (!isRecord(data)) return t("bus.share.error.generic");
        const settings = normalizeCombat(data.settings);
        const commands = normalizeCommands(data.commands);
        if (!settings || !commands) return t("bus.share.error.generic");
        writeWorldJson(SETTINGS_KEY, settings);
        writeWorldJson(COMMANDS_KEY, commands);
        return undefined;
    },
});
