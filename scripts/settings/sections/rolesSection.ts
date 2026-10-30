import { world, type Player } from "@minecraft/server";
import { CustomForm, ObservableNumber, ObservableString, ObservableUIRawMessage } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { purgeRoleFromPolicies } from "../../permissions/permissionStore";
import { COLOR_ITEMS, COLOR_OPTIONS, colorIndex } from "../../roles/colors";
import { expandText, stripFormatting } from "../../roles/display";
import {
  createRole,
  deleteRole,
  getPlayerRoleIds,
  getRoles,
  grantRole,
  revokeRole,
  updateRole,
} from "../../roles/roleStore";
import { confirmButton } from "../confirmButton";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const WRITABLE = { clientWritable: true } as const;
const KEY = "bus:roles";

registerSettingsSection({
  id: KEY,
  title: t("bus.section.roles.title"),
  description: t("bus.section.roles.desc"),
  order: 10,
  open: (player, back) => rolesHome(player, back),
});

function rolesHome(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.section.roles.title")));
    const roles = Object.entries(getRoles()).sort(([, a], [, b]) => b.priority - a.priority);

    form.label(t(roles.length ? "bus.roles.pick" : "bus.roles.none"));
    for (const [id, role] of roles) {
      // Button text can't render § codes (they show as raw characters), so only the glyphs are kept.
      const icon = role.text.trim() ? `${stripFormatting(expandText(role.text))}  ` : "";
      form.button(
        raw(`${icon}${role.name}`),
        guard.click(() => {
          form.close();
          editRole(player, id, () => rolesHome(player, back));
        })
      );
    }

    form.divider();
    form.button(
      t("bus.roles.create"),
      guard.click(() => {
        form.close();
        createRoleForm(player, () => rolesHome(player, back));
      })
    );
    form.button(
      t("bus.roles.assign"),
      guard.click(() => {
        form.close();
        assignForm(player, () => rolesHome(player, back));
      })
    );
    form.button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}

function createRoleForm(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  showForm(player, () => {
    const name = new ObservableString("", WRITABLE);
    const status = new ObservableUIRawMessage(raw(""));

    const form = guard.attach(new CustomForm(player, t("bus.roles.create")));
    form
      .textField(t("bus.roles.name"), name, { description: t("bus.roles.name.desc") })
      .label(status)
      .button(
        t("bus.roles.create.confirm"),
        guard.click(() => {
          if (createRole(name.getData())) {
            form.close();
            back();
          } else {
            status.setData(t("bus.roles.error.name"));
          }
        })
      )
      .button(t("bus.common.cancel"), () => {
        form.close();
        back();
      });
    return form;
  });
}

function editRole(player: Player, roleId: string, back: () => void): void {
  const role = getRoles()[roleId];
  if (!role) {
    back();
    return;
  }
  const guard = createGuard(player, KEY);

  showForm(player, () => {
    const name = new ObservableString(role.name, WRITABLE);
    const text = new ObservableString(role.text, WRITABLE);
    const priority = new ObservableNumber(role.priority, WRITABLE);
    const nameColor = new ObservableNumber(colorIndex(role.nameColor), WRITABLE);
    const chatColor = new ObservableNumber(colorIndex(role.chatColor), WRITABLE);
    const preview = new ObservableUIRawMessage(t("bus.roles.preview", `${expandText(role.text)}§r`));

    // Everything saves instantly as it changes, but only while access still holds.
    guard.on(name, (v: string) => {
      if (v.trim()) updateRole(roleId, { name: v.trim() });
    });
    guard.on(text, (v: string) => {
      updateRole(roleId, { text: v });
      preview.setData(t("bus.roles.preview", `${expandText(v)}§r`));
    });
    guard.on(priority, (v: number) => updateRole(roleId, { priority: v }));
    guard.on(nameColor, (i: number) => updateRole(roleId, { nameColor: COLOR_OPTIONS[i]?.code ?? "" }));
    guard.on(chatColor, (i: number) => updateRole(roleId, { chatColor: COLOR_OPTIONS[i]?.code ?? "" }));

    const form = guard.attach(new CustomForm(player, t("bus.roles.edit.title", role.name)));
    form
      .textField(t("bus.roles.name"), name)
      .textField(t("bus.roles.text"), text, { description: t("bus.roles.text.desc") })
      .label(preview)
      .slider(t("bus.roles.priority"), priority, 0, 100, {
        step: 1,
        description: t("bus.roles.priority.desc"),
      })
      .dropdown(t("bus.roles.name_color"), nameColor, COLOR_ITEMS)
      .dropdown(t("bus.roles.chat_color"), chatColor, COLOR_ITEMS)
      .divider();

    // Must be pressed twice to confirm.
    confirmButton(
      form,
      t("bus.roles.delete"),
      guard.click(() => {
        deleteRole(roleId);
        purgeRoleFromPolicies(roleId);
        form.close();
        back();
      })
    );
    form.button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form;
  });
}

function assignForm(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  const players = world.getAllPlayers();
  const roles = Object.entries(getRoles());
  if (players.length === 0 || roles.length === 0) {
    // No form is open here, so chat is visible.
    player.sendMessage(t("bus.roles.assign.need"));
    back();
    return;
  }

  const describe = (target: Player): ReturnType<typeof t> => {
    const defs = getRoles();
    const names = getPlayerRoleIds(target)
      .map((id) => defs[id]?.name)
      .filter((n): n is string => !!n);
    return names.length
      ? t("bus.roles.assign.current", target.name, names.join(", "))
      : t("bus.roles.assign.current_none", target.name);
  };

  showForm(player, () => {
    const playerIndex = new ObservableNumber(0, WRITABLE);
    const roleIndex = new ObservableNumber(0, WRITABLE);
    const current = new ObservableUIRawMessage(describe(players[0]));
    const status = new ObservableUIRawMessage(raw(""));

    guard.on(playerIndex, (i: number) => {
      const target = players[i];
      if (target?.isValid) current.setData(describe(target));
    });

    const apply = (action: "grant" | "revoke"): void => {
      const target = players[playerIndex.getData()];
      const [roleId, role] = roles[roleIndex.getData()];
      if (!target?.isValid) {
        status.setData(t("bus.roles.assign.offline"));
        return;
      }
      if (action === "grant") grantRole(target, roleId);
      else revokeRole(target, roleId);
      current.setData(describe(target));
      status.setData(
        t(action === "grant" ? "bus.roles.assign.granted" : "bus.roles.assign.revoked", role.name, target.name)
      );
    };

    const form = guard.attach(new CustomForm(player, t("bus.roles.assign")));
    form
      .dropdown(
        t("bus.roles.assign.player"),
        playerIndex,
        players.map((p, i) => ({ label: raw(p.name), value: i }))
      )
      .dropdown(
        t("bus.roles.assign.role"),
        roleIndex,
        roles.map(([, r], i) => ({ label: raw(r.name), value: i }))
      )
      .label(current)
      .button(
        t("bus.roles.assign.grant"),
        guard.click(() => apply("grant"))
      )
      .button(
        t("bus.roles.assign.revoke"),
        guard.click(() => apply("revoke"))
      )
      .label(status)
      .button(t("bus.common.back"), () => {
        form.close();
        back();
      });
    return form;
  });
}
