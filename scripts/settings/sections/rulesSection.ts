import type { Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { MAX_RULES, getRulesSettings, saveRulesSettings } from "../../rules/rulesStore";
import { promptAllPending, showRules } from "../../rules/rulesPrompt";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:rules";
const WRITABLE = { clientWritable: true } as const;

registerSettingsSection({
  id: KEY,
  title: t("bus.section.rules.title"),
  description: t("bus.section.rules.desc"),
  order: 70,
  open: (player, back) => openRules(player, back),
});

function openRules(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  const reopen = (): void => openRules(player, back);

  showForm(player, () => {
    const s = getRulesSettings();
    const enabled = new ObservableBoolean(s.enabled, WRITABLE);
    const exempt = new ObservableBoolean(s.exemptOperators, WRITABLE);
    const numbered = new ObservableBoolean(s.numbered, WRITABLE);
    const title = new ObservableString(s.title, WRITABLE);
    const preface = new ObservableString(s.preface, WRITABLE);
    const footer = new ObservableString(s.footer, WRITABLE);
    guard.on(enabled, (v: boolean) => {
      saveRulesSettings({ enabled: v });
      if (v) promptAllPending();
    });
    guard.on(numbered, (v: boolean) => saveRulesSettings({ numbered: v }));
    guard.on(exempt, (v: boolean) => saveRulesSettings({ exemptOperators: v }));
    guard.on(title, (v: string) => saveRulesSettings({ title: v }));
    guard.on(preface, (v: string) => saveRulesSettings({ preface: v }));
    guard.on(footer, (v: string) => saveRulesSettings({ footer: v }));

    const form = guard.attach(new CustomForm(player, t("bus.section.rules.title")));
    form
      .label(t("bus.rules.edit.intro"))
      .toggle(t("bus.rules.enabled"), enabled, { description: t("bus.rules.enabled.desc") })
      .toggle(t("bus.rules.exempt"), exempt, { description: t("bus.rules.exempt.desc") })
      .toggle(t("bus.rules.numbered"), numbered, { description: t("bus.rules.numbered.desc") })
      .textField(t("bus.rules.title"), title)
      .textField(t("bus.rules.preface"), preface, { description: t("bus.rules.preface.desc") })
      .textField(t("bus.rules.footer"), footer, { description: t("bus.rules.footer.desc") })
      .header(t("bus.rules.list"))
      .label(t("bus.rules.format_help"));

    if (s.rules.length === 0) form.label(t("bus.rules.none"));
    s.rules.forEach((rule, i) => {
      const field = new ObservableString(rule, WRITABLE);
      guard.on(field, (v: string) => {
        const rules = [...getRulesSettings().rules];
        rules[i] = v;
        saveRulesSettings({ rules });
      });
      form.textField(t("bus.rules.rule_n", i + 1), field);
      form.button(
        t("bus.rules.remove_n", i + 1),
        guard.click(() => {
          saveRulesSettings({ rules: getRulesSettings().rules.filter((_r, idx) => idx !== i) });
          form.close();
          reopen();
        })
      );
    });

    if (s.rules.length < MAX_RULES) {
      form.button(
        t("bus.rules.add"),
        guard.click(() => {
          saveRulesSettings({ rules: [...getRulesSettings().rules, ""] });
          form.close();
          reopen();
        })
      );
    }

    form
      .divider()
      .button(
        t("bus.rules.preview"),
        guard.click(() => {
          form.close();
          showRules(player, { preview: true, onDone: reopen });
        })
      )
      .button(
        t("bus.rules.reaccept"),
        guard.click(() => {
          saveRulesSettings({ version: getRulesSettings().version + 1 });
          promptAllPending();
          form.close();
          reopen();
        }),
        { tooltip: t("bus.rules.reaccept.desc") }
      )
      .button(t("bus.common.back"), () => {
        form.close();
        back();
      });
    return form.closeButton();
  });
}
