import { CustomCommandParamType, type CustomCommandParameter } from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";
import { raw, t } from "./lang";

// Reusable duration argument for any command. The command API has no custom parameter types, so a
// duration is a String parameter that this file parses.
//   30m   2h   1d12h   1w   90s   (units: s m h d w; combine them: 1h30m)
//   perm / permanent / infinite / inf / forever   -> no end (ms is undefined)
//
// In a command:
//   optionalParameters: [durationParameter()],
//   run: (origin, text?: string) => {
//       const d = text === undefined ? { ok: true, ms: undefined } : parseDuration(text);
//       if (!d.ok) return reply(origin, CustomCommandStatus.Failure, "bus.command.duration.invalid", "...");
//       const endsAt = d.ms === undefined ? undefined : Date.now() + d.ms;
//   }

const UNIT_MS: Record<string, number> = { w: 604_800_000, d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };
/** Longest finite duration accepted (use "perm" for no end). */
export const MAX_DURATION_MS = 3650 * UNIT_MS.d;
const INFINITE_WORDS = new Set(["perm", "permanent", "inf", "infinite", "infinity", "forever"]);

export type ParsedDuration = { ok: true; ms: number | undefined } | { ok: false };

/** ms is undefined for "infinite". Fails on anything else that isn't units like 1h30m, or on zero / too long. */
export function parseDuration(input: string): ParsedDuration {
    const text = input.trim().toLowerCase();
    if (INFINITE_WORDS.has(text)) return { ok: true, ms: undefined };
    if (!/^(\d{1,9}[wdhms])+$/.test(text)) return { ok: false };

    let total = 0;
    for (const [, amount, unit] of text.matchAll(/(\d+)([wdhms])/g)) total += Number(amount) * UNIT_MS[unit];
    if (total <= 0 || total > MAX_DURATION_MS) return { ok: false };
    return { ok: true, ms: total };
}

/** The String parameter to put in a command's parameter list. */
export function durationParameter(name = "duration"): CustomCommandParameter {
    return { name, type: CustomCommandParamType.String };
}

const PARTS: [string, number][] = [
    ["bus.duration.d", UNIT_MS.d],
    ["bus.duration.h", UNIT_MS.h],
    ["bus.duration.m", UNIT_MS.m],
    ["bus.duration.s", UNIT_MS.s],
];

/** "1d 4h", "29m 10s", "Permanent" as a translatable message (the two largest non-zero units). */
export function formatDuration(ms: number | undefined): UIRawMessage {
    if (ms === undefined) return t("bus.duration.infinite");
    let left = Math.max(1, Math.ceil(ms / 1000)) * 1000;
    const out: UIRawMessage[] = [];
    for (const [key, size] of PARTS) {
        const count = Math.floor(left / size);
        left -= count * size;
        if (count > 0) out.push(t(key, count));
        if (out.length === 2) break;
    }
    return { rawtext: out.flatMap((part, i) => (i === 0 ? [part] : [raw(" "), part])) };
}
