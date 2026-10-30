import type { Player } from "@minecraft/server";
import { CustomForm, ModalFormData, ObservableBoolean, type UIRawMessage } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import { canUse } from "../../permissions/permissionStore";
import { applyShareCode, buildShareCode, getShareables, listShareCodeSections } from "../../share/shareRegistry";
import { CODE_EDITOR_TAG, CODE_VIEWER_TAG } from "../codeEditor";
import { createGuard } from "../guard";
import { showForm, showModal } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:share";
const WRITABLE = { clientWritable: true } as const;

// Importing replaces roles and permissions, so it is owner-only.
registerSettingsSection({
  id: KEY,
  title: t("bus.section.share.title"),
  description: t("bus.section.share.desc"),
  order: 950,
  ownerOnly: true,
  open: (player, back) => shareHome(player, back),
});

function revoked(player: Player): boolean {
  if (canUse(player, KEY)) return false;
  player.sendMessage(t("bus.settings.access_revoked"));
  return true;
}

function shareHome(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.section.share.title")));
    form
      .label(t("bus.share.intro"))
      .button(
        t("bus.share.export"),
        guard.click(() => {
          form.close();
          exportPick(player, () => shareHome(player, back));
        })
      )
      .button(
        t("bus.share.import"),
        guard.click(() => {
          form.close();
          importEditor(player, () => shareHome(player, back));
        })
      )
      .button(t("bus.common.back"), () => {
        form.close();
        back();
      });
    return form.closeButton();
  });
}

/** Step 1 of export: choose which sections go into the code. */
function exportPick(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  showForm(player, () => {
    const picks = getShareables().map((s) => ({ s, on: new ObservableBoolean(true, WRITABLE) }));
    const form = guard.attach(new CustomForm(player, t("bus.share.export")));
    form.label(t("bus.share.export.pick"));
    for (const p of picks) form.toggle(p.s.label, p.on);
    form
      .divider()
      .button(
        t("bus.share.export.show"),
        guard.click(() => {
          const only = picks.filter((p) => p.on.getData()).map((p) => p.s.id);
          form.close();
          exportEditor(player, buildShareCode(only), back);
        })
      )
      .button(t("bus.common.back"), () => {
        form.close();
        back();
      });
    return form;
  });
}

function exportEditor(player: Player, code: string, back: () => void): void {
  if (revoked(player)) return;
  showModal(
    player,
    () =>
      new ModalFormData()
        .title({ rawtext: [{ text: CODE_VIEWER_TAG }, t("bus.share.export")] })
        .textField(t("bus.share.export.label"), t("bus.share.code.placeholder"), { defaultValue: code }),
    () => back()
  );
}

/** Step 1 of import: paste a code. */
function importEditor(player: Player, back: () => void): void {
  if (revoked(player)) return;
  showModal(
    player,
    () =>
      new ModalFormData()
        .title({ rawtext: [{ text: CODE_EDITOR_TAG }, t("bus.share.import")] })
        .textField(t("bus.share.import.label"), t("bus.share.code.placeholder")),
    (response) => {
      if (response.canceled || !response.formValues) return back();
      const code = String(response.formValues[0] ?? "");
      if (!code.trim()) return back();
      if (revoked(player)) return;

      const found = listShareCodeSections(code);
      if (!found.ok) return showResult(player, [found.error], back);
      importPick(
        player,
        code,
        found.sections.map((s) => ({ id: s.id, label: s.label })),
        back
      );
    }
  );
}

/** Step 2 of import: choose which of the sections in the code to apply. */
function importPick(
  player: Player,
  code: string,
  sections: { id: string; label: UIRawMessage }[],
  back: () => void
): void {
  const guard = createGuard(player, KEY);
  showForm(player, () => {
    const picks = sections.map((s) => ({ ...s, on: new ObservableBoolean(true, WRITABLE) }));
    const form = guard.attach(new CustomForm(player, t("bus.share.import.pick.title")));
    form.label(t("bus.share.import.pick"));
    for (const p of picks) form.toggle(p.label, p.on);
    form
      .divider()
      .button(
        t("bus.share.import.apply"),
        guard.click(() => {
          const only = picks.filter((p) => p.on.getData()).map((p) => p.id);
          const result = applyShareCode(code, only);
          form.close();
          showResult(player, result.lines, back);
        })
      )
      .button(t("bus.common.cancel"), () => {
        form.close();
        back();
      });
    return form;
  });
}

/** Chat can't be seen while a form is open, so the result is shown in its own form. */
function showResult(player: Player, lines: UIRawMessage[], back: () => void): void {
  const guard = createGuard(player, KEY);
  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.share.result.title")));
    for (const line of lines) form.label(line);
    form.button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}
