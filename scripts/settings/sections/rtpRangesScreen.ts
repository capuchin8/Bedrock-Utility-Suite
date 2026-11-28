import type { Player } from "@minecraft/server";
import { CustomForm } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import { addRange, getRtp, MAX_RANGES, rangeLabel } from "../../rtp/rtpStore";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { openRtpRangeEditor } from "./rtpRangeEditor";

const KEY = "bus:rtp";

export function openRtpRanges(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const ranges = getRtp().ranges;
    const form = guard.attach(new CustomForm(player, t("bus.rtp.ranges")));
    form.label(t("bus.rtp.ranges.intro"));
    for (const r of ranges) {
      form.button(
        rangeLabel(r),
        guard.click(() => {
          form.close();
          openRtpRangeEditor(player, r.id, () => openRtpRanges(player, back));
        })
      );
    }
    if (ranges.length < MAX_RANGES) {
      form.button(
        t("bus.rtp.ranges.add"),
        guard.click(() => {
          const id = addRange();
          form.close();
          if (id) openRtpRangeEditor(player, id, () => openRtpRanges(player, back));
          else openRtpRanges(player, back);
        })
      );
    }
    form.divider().button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}
