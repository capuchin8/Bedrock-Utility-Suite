import { registerPermission } from "../permissions/permissionStore";
import type { SettingsSection } from "./types";

const sections = new Map<string, SettingsSection>();

/** Call at the top level of any module file to add a menu to /bus:settings. */
export function registerSettingsSection(section: SettingsSection): void {
    if (!section.id.startsWith("bus:")) {
        throw new Error(`Settings section id must use the bus: namespace (got "${section.id}")`);
    }
    if (sections.has(section.id)) {
        throw new Error(`Settings section "${section.id}" is already registered`);
    }
    sections.set(section.id, section);
    registerPermission({
        key: section.id,
        label: section.title,
        description: section.description,
        category: "menu",
        defaultEveryone: section.defaultEveryone ?? false,
        defaultOperators: section.defaultOperators ?? true,
        ownerOnly: section.ownerOnly ?? false,
    });
}

export function getSections(): SettingsSection[] {
    return [...sections.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
