import { system } from "@minecraft/server";
import { ObservableUIRawMessage, type ButtonOptions, type CustomForm, type UIRawMessage } from "@minecraft/server-ui";
import { t } from "../core/lang";

const CONFIRM_WINDOW_TICKS = 100; // 5 seconds to press again

/**
 * Adds a delete-style button that must be pressed twice. The first press changes the label to
 * "Press again to confirm" (no codes: button text can't render them); pressing again within a few
 * seconds runs `onConfirm`, otherwise the label goes back and nothing happens.
 * Wrap `onConfirm` with guard.click(...) so access is re-checked when it is applied.
 */
export function confirmButton(
  form: CustomForm,
  label: UIRawMessage,
  onConfirm: () => void,
  options?: ButtonOptions
): void {
  const text = new ObservableUIRawMessage(label);
  let armed = false;
  let timer: number | undefined;

  const reset = (): void => {
    armed = false;
    timer = undefined;
    text.setData(label);
  };

  form.button(
    text,
    () => {
      if (!armed) {
        armed = true;
        text.setData(t("bus.common.press_again"));
        timer = system.runTimeout(reset, CONFIRM_WINDOW_TICKS);
        return;
      }
      if (timer !== undefined) system.clearRun(timer);
      armed = false;
      timer = undefined;
      onConfirm();
    },
    options
  );
}
