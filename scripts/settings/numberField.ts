import { ObservableString, type CustomForm, type ObservableBoolean } from "@minecraft/server-ui";
import { t } from "../core/lang";
import type { SettingsGuard } from "./guard";

/**
 * A text field that only accepts whole numbers in [min, max] (negatives allowed when min < 0).
 * Invalid or out-of-range text is ignored (nothing is saved), so typing "1" on the way to "100"
 * never stores a bad value. `label` and `desc` are lang keys.
 */
export function numberField(
  form: CustomForm,
  guard: SettingsGuard,
  label: string,
  value: number,
  min: number,
  max: number,
  apply: (n: number) => void,
  options?: { desc?: string; visible?: ObservableBoolean }
): void {
  const field = new ObservableString(String(value), { clientWritable: true });
  guard.on(field, (v: string) => {
    const n = Number.parseInt(v.trim(), 10);
    if (Number.isFinite(n) && n >= min && n <= max) apply(n);
  });
  form.textField(t(label), field, {
    ...(options?.desc ? { description: t(options.desc) } : {}),
    ...(options?.visible ? { visible: options.visible } : {}),
  });
}
