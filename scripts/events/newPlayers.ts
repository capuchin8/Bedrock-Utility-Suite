import { t } from "../core/lang";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";
import { getRoles, grantRole } from "../roles/roleStore";
import { registerShareable } from "../share/shareRegistry";
import { onPlayerJoin } from "./playerEvents";

const KEY = "bus:new_players";
const OLD_KEY = "bus:join_leave"; // earlier versions stored the first-join role here

export interface NewPlayerSettings {
    /** Role id given to a player the first time they join ("" = none). */
    firstJoinRole: string;
}

export const DEFAULT_NEW_PLAYERS: NewPlayerSettings = { firstJoinRole: "" };

export function normalizeNewPlayers(v: unknown): NewPlayerSettings | undefined {
    if (!isRecord(v)) return undefined;
    return { firstJoinRole: typeof v.firstJoinRole === "string" ? v.firstJoinRole.slice(0, 64) : "" };
}

export function getNewPlayerSettings(): NewPlayerSettings {
    const current = normalizeNewPlayers(readWorldJson<unknown>(KEY, undefined));
    if (current && readWorldJson<unknown>(KEY, undefined) !== undefined) return current;
    return normalizeNewPlayers(readWorldJson<unknown>(OLD_KEY, {})) ?? DEFAULT_NEW_PLAYERS;
}

export function setNewPlayerSettings(patch: Partial<NewPlayerSettings>): void {
    const next = normalizeNewPlayers({ ...getNewPlayerSettings(), ...patch });
    if (next) writeWorldJson(KEY, next);
}

onPlayerJoin((player, firstJoin) => {
    if (!firstJoin) return;
    const roleId = getNewPlayerSettings().firstJoinRole;
    if (roleId && getRoles()[roleId]) grantRole(player, roleId);
});

registerShareable({
    id: KEY,
    label: t("bus.share.new_players"),
    export: () => getNewPlayerSettings(),
    import: (data) => {
        const next = normalizeNewPlayers(data);
        if (!next) return t("bus.share.error.generic");
        writeWorldJson(KEY, next);
        return undefined;
    },
});
