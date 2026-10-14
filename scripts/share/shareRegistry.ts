import type { UIRawMessage } from "@minecraft/server-ui";
import { raw, t } from "../core/lang";
import { isRecord } from "../core/storage";

export interface Shareable {
    /** Namespaced id, e.g. "bus:roles". */
    id: string;
    /** Translated with t("..."). */
    label: UIRawMessage;
    /** Plain JSON-safe data describing this module's configuration. */
    export(): unknown;
    /** Validate FIRST, then apply. Return a translated error to reject, or undefined on success. */
    import(data: unknown): UIRawMessage | undefined;
}

const FORMAT = "bus-setup";
const VERSION = 1;
const shareables = new Map<string, Shareable>();

export function registerShareable(s: Shareable): void {
    if (!s.id.startsWith("bus:")) throw new Error(`Shareable id must use the bus: namespace ("${s.id}")`);
    if (shareables.has(s.id)) throw new Error(`Shareable "${s.id}" is already registered`);
    shareables.set(s.id, s);
}

export function getShareables(): Shareable[] {
    return [...shareables.values()];
}

/** `only` = ids to include; omitted = everything. */
export function buildShareCode(only?: string[]): string {
    const data: Record<string, unknown> = {};
    for (const s of shareables.values()) if (!only || only.includes(s.id)) data[s.id] = s.export();
    return JSON.stringify({ format: FORMAT, version: VERSION, data }, null, 2);
}

function parseCode(code: string): { data: Record<string, unknown> } | { errorKey: string; arg?: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(code.trim());
    } catch {
        return { errorKey: "bus.share.error.parse" };
    }
    if (!isRecord(parsed) || parsed.format !== FORMAT || !isRecord(parsed.data)) return { errorKey: "bus.share.error.format" };
    if (parsed.version !== VERSION) return { errorKey: "bus.share.error.version", arg: String(parsed.version) };
    return { data: parsed.data };
}

/** Which sections a pasted code contains (only ones this add-on knows how to import). */
export function listShareCodeSections(code: string): { ok: true; sections: Shareable[] } | { ok: false; error: UIRawMessage } {
    const parsed = parseCode(code);
    if ("errorKey" in parsed) return { ok: false, error: t(parsed.errorKey, ...(parsed.arg ? [parsed.arg] : [])) };
    const sections = getShareables().filter((s) => s.id in parsed.data);
    return sections.length ? { ok: true, sections } : { ok: false, error: t("bus.share.nothing") };
}

export interface ShareResult {
    ok: boolean;
    /** One translated line per module, ready to show in a form. */
    lines: UIRawMessage[];
}

/** `only` = ids to import; omitted = everything in the code. */
export function applyShareCode(code: string, only?: string[]): ShareResult {
    const parsed = parseCode(code);
    if ("errorKey" in parsed) return { ok: false, lines: [t(parsed.errorKey, ...(parsed.arg ? [parsed.arg] : []))] };

    const data = parsed.data;
    const lines: UIRawMessage[] = [];
    let ok = true;
    for (const s of shareables.values()) {
        if (!(s.id in data) || (only && !only.includes(s.id))) continue;
        const error = s.import(data[s.id]);
        if (error) {
            ok = false;
            lines.push({ rawtext: [raw("§c"), s.label, raw(": "), error] });
        } else {
            lines.push({ rawtext: [raw("§a"), s.label, raw(": "), t("bus.share.imported")] });
        }
    }
    return { ok, lines: lines.length ? lines : [t("bus.share.nothing")] };
}
