import {
  CustomForm,
  ObservableBoolean,
  ObservableNumber,
  ObservableString,
  ObservableUIRawMessage,
} from "@minecraft/server-ui";
import { t } from "../../core/lang";
import "../../pay/payCommand";
import { MAX_PAY, getPay, savePay, type TaxMode } from "../../pay/payStore";
import { quote } from "../../pay/payService";
import { getShop } from "../../shop/shopStore";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:pay";
const W = { clientWritable: true } as const;

registerSettingsSection({
  id: KEY,
  title: t("bus.section.pay.title"),
  description: t("bus.section.pay.desc"),
  order: 46,
  open: (player, back) => {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    showForm(player, () => {
      const cfg = getPay();
      const form = guard.attach(new CustomForm(player, t("bus.section.pay.title")));

      // Live example so the effect of the tax settings is visible while typing.
      const example = new ObservableUIRawMessage(t("bus.pay.example", "0", "0", "0", ""));
      const refresh = (): void => {
        const amount = Math.max(1, cfg.minAmount, 100);
        const q = quote(amount);
        example.setData(
          t("bus.pay.example", String(amount), String(q.cost), String(q.received), getShop().currencyName)
        );
      };
      refresh();

      const save = (): void => {
        savePay();
        refresh();
      };
      // A numeric text field: blank means 0 (= off) where `min` is 0.
      const number = (
        label: string,
        desc: string,
        value: number,
        min: number,
        max: number,
        set: (n: number) => void
      ): void => {
        const o = new ObservableString(String(value), W);
        guard.on(o, (v: string) => {
          const text = v.trim();
          const n = text === "" ? 0 : Number(text);
          if (!/^\d*$/.test(text) || !Number.isFinite(n)) return;
          set(Math.max(min, Math.min(max, Math.floor(n))));
          save();
        });
        form.textField(t(label), o, { description: t(desc) });
      };

      const enabled = new ObservableBoolean(cfg.enabled, W);
      guard.on(enabled, (v: boolean) => {
        cfg.enabled = v;
        save();
      });
      form.label(t("bus.pay.intro")).toggle(t("bus.pay.enabled"), enabled, { description: t("bus.pay.enabled.desc") });
      number("bus.pay.min", "bus.pay.min.desc", cfg.minAmount, 1, MAX_PAY, (n) => (cfg.minAmount = n));
      number("bus.pay.max", "bus.pay.max.desc", cfg.maxAmount, 0, MAX_PAY, (n) => (cfg.maxAmount = n));
      number("bus.pay.daily", "bus.pay.daily.desc", cfg.dailyLimit, 0, MAX_PAY, (n) => (cfg.dailyLimit = n));
      number(
        "bus.pay.cooldown",
        "bus.pay.cooldown.desc",
        cfg.cooldownSeconds,
        0,
        86_400,
        (n) => (cfg.cooldownSeconds = n)
      );

      const tax = new ObservableString(String(cfg.taxPercent), W);
      guard.on(tax, (v: string) => {
        const text = v.trim();
        if (!/^\d{0,3}(\.\d{0,2})?$/.test(text)) return;
        const n = text === "" || text === "." ? 0 : Number(text);
        if (!Number.isFinite(n)) return;
        cfg.taxPercent = Math.max(0, Math.min(100, n));
        save();
      });
      form.textField(t("bus.pay.tax"), tax, { description: t("bus.pay.tax.desc") });

      const modes: TaxMode[] = ["deduct", "add"];
      const mode = new ObservableNumber(modes.indexOf(cfg.taxMode), W);
      guard.on(mode, (v: number) => {
        cfg.taxMode = modes[Math.round(v)] ?? "deduct";
        save();
      });
      form.dropdown(
        t("bus.pay.tax_mode"),
        mode,
        [
          { label: t("bus.pay.tax_mode.deduct"), value: 0 },
          { label: t("bus.pay.tax_mode.add"), value: 1 },
        ],
        { description: t("bus.pay.tax_mode.desc") }
      );
      form.label(example);

      form.spacer().button(t("bus.common.back"), () => {
        savePay();
        form.close();
        back();
      });
      return form.closeButton();
    });
  },
});
