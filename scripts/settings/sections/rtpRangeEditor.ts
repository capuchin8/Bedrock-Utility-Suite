import type { Player } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import { getRtp, MAX_RANGE_BLOCKS, removeRange, updateRange } from "../../rtp/rtpStore";
import { confirmButton } from "../confirmButton";
import { createGuard } from "../guard";
import { numberField } from "../numberField";
import { showForm } from "../openForm";

const KEY = "bus:rtp";

export function openRtpRangeEditor(player: Player, rangeId: string, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  const range = getRtp().ranges.find((r) => r.id === rangeId);
  if (!range) {
    back();
    return;
  }
  showForm(player, () => {
    const name = new ObservableString(range.name, { clientWritable: true });
    guard.on(name, (v: string) => updateRange(rangeId, { name: v.slice(0, 24) }));

    const form = guard.attach(new CustomForm(player, t("bus.rtp.range.title")));
    form.textField(t("bus.rtp.range.name"), name, { description: t("bus.rtp.range.name.desc") });
    numberField(form, guard, "bus.rtp.range.min", range.min, 0, MAX_RANGE_BLOCKS, (n) => updateRange(rangeId, { min: n }), {
      desc: "bus.rtp.range.min.desc",
    });
    numberField(form, guard, "bus.rtp.range.max", range.max, 0, MAX_RANGE_BLOCKS, (n) => updateRange(rangeId, { max: n }), {
      desc: "bus.rtp.range.max.desc",
    });
    form.divider();
    if (getRtp().ranges.length > 1) {
      confirmButton(
        form,
        t("bus.rtp.range.delete"),
        guard.click(() => {
          removeRange(rangeId);
          form.close();
          back();
        })
      );
    }
    form.button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}
