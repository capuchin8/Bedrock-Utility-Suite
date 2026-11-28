import { system } from "@minecraft/server";
import { CustomForm, ObservableNumber } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import type { Destination } from "../../shop/shopMove";
import { flushSave } from "../../shop/shopStore";
import type { StatusLabel } from "../../shop/statusLabel";
import type { SettingsGuard } from "../guard";

const W = { clientWritable: true } as const;

/**
 * "Move to" dropdown. The first option keeps things where they are; picking a category applies the move,
 * saves, closes the form and calls `done` (usually the screen before this one, which still exists).
 * Names are indented with plain dashes by depth (button/dropdown text can't show colour codes).
 */
export function addMoveControl(
  form: CustomForm,
  guard: SettingsGuard,
  destinations: Destination[],
  apply: (destinationId: string) => boolean,
  done: () => void,
  status: StatusLabel
): void {
  if (destinations.length === 0) return;
  const options = [
    { label: t("bus.shopedit.move.keep"), value: 0 },
    ...destinations.map((d, i) => ({ label: raw(`${"- ".repeat(d.depth)}${d.name}`), value: i + 1 })),
  ];
  const choice = new ObservableNumber(0, W);
  guard.on(choice, (v: number) => {
    const dest = destinations[Math.round(v) - 1];
    if (!dest) return;
    if (!apply(dest.id)) {
      status.set(t("bus.shopedit.move.failed"));
      return;
    }
    flushSave();
    system.run(() => {
      form.close();
      done();
    });
  });
  form.dropdown(t("bus.shopedit.move"), choice, options, { description: t("bus.shopedit.move.desc") });
}
