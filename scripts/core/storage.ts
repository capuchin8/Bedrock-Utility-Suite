import { world } from "@minecraft/server";

export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function readWorldJson<T>(key: string, fallback: T): T {
    const raw = world.getDynamicProperty(key);
    if (typeof raw !== "string") return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

export function writeWorldJson(key: string, value: unknown): void {
    world.setDynamicProperty(key, JSON.stringify(value));
}

// Tiny change signal: anything that affects how names/roles look calls
// notifyDisplayDataChanged(); the name tag module listens and refreshes.
type Listener = () => void;
const displayListeners = new Set<Listener>();

export function onDisplayDataChanged(listener: Listener): void {
    displayListeners.add(listener);
}

export function notifyDisplayDataChanged(): void {
    for (const listener of displayListeners) listener();
}
