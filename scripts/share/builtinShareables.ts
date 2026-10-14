import { t } from "../core/lang";
import { isRecord } from "../core/storage";
import {
    getStoredPolicies,
    normalizePolicies,
    replacePolicies,
} from "../permissions/permissionStore";
import { getDisplaySettings, normalizeDisplaySettings, setDisplaySettings } from "../roles/displaySettings";
import { getRoles, normalizeRoleMap, replaceRoles } from "../roles/roleStore";
import { registerShareable } from "./shareRegistry";

// Player-specific data (who has which role, nicknames) is deliberately not shared.

registerShareable({
    id: "bus:roles",
    label: t("bus.share.roles"),
    export: () => ({ roles: getRoles(), display: getDisplaySettings() }),
    import: (data) => {
        if (!isRecord(data)) return t("bus.share.error.roles");
        const roles = normalizeRoleMap(data.roles);
        const display = normalizeDisplaySettings(data.display);
        if (!roles || !display) return t("bus.share.error.roles");
        replaceRoles(roles);
        setDisplaySettings(display);
        return undefined;
    },
});

registerShareable({
    id: "bus:permissions",
    label: t("bus.share.permissions"),
    export: () => getStoredPolicies(),
    import: (data) => {
        const policies = normalizePolicies(data);
        if (!policies) return t("bus.share.error.permissions");
        replacePolicies(policies);
        return undefined;
    },
});
