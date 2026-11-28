import type { Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableNumber } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { dimensionLabel, getRtp, listWorldDimensions, RTP_LIMITS, setRtp, toggleDimension } from "../../rtp/rtpStore";
import { createGuard } from "../guard";
import { numberField } from "../numberField";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";
import { openRtpRanges } from "./rtpRangesScreen";

const KEY = "bus:rtp";
const WRITABLE = { clientWritable: true } as const;

registerSettingsSection({
  id: KEY,
  title: t("bus.section.rtp.title"),
  description: t("bus.section.rtp.desc"),
  order: 66,
  open: (player, back) => openRtp(player, back),
});

export function openRtp(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const s = getRtp();
    const form = guard.attach(new CustomForm(player, t("bus.section.rtp.title")));
    form.label(t("bus.rtp.intro")).header(t("bus.rtp.dimensions"));

    for (const id of listWorldDimensions()) {
      const on = new ObservableBoolean(s.dimensions.includes(id), WRITABLE);
      guard.on(on, (v: boolean) => toggleDimension(id, v));
      form.toggle(dimensionLabel(id), on);
    }

    const center = new ObservableNumber(s.center === "player" ? 1 : 0, WRITABLE);
    guard.on(center, (v: number) => setRtp({ center: v === 1 ? "player" : "origin" }));
    form
      .divider()
      .dropdown(
        t("bus.rtp.center"),
        center,
        [
          { label: t("bus.rtp.center.origin"), value: 0 },
          { label: t("bus.rtp.center.player"), value: 1 },
        ],
        { description: t("bus.rtp.center.desc") }
      );

    numberField(form, guard, "bus.rtp.attempts", s.attempts, RTP_LIMITS.attempts.min, RTP_LIMITS.attempts.max, (n) => setRtp({ attempts: n }), {
      desc: "bus.rtp.attempts.desc",
    });
    numberField(form, guard, "bus.rtp.protection", s.protection, RTP_LIMITS.protection.min, RTP_LIMITS.protection.max, (n) => setRtp({ protection: n }), {
      desc: "bus.rtp.protection.desc",
    });

    form
      .divider()
      .label(t("bus.rtp.rules_hint"))
      .button(
        { rawtext: [t("bus.rtp.ranges"), raw(` (${s.ranges.length})`)] },
        guard.click(() => {
          form.close();
          openRtpRanges(player, () => openRtp(player, back));
        })
      )
      .button(t("bus.common.back"), () => {
        form.close();
        back();
      });
    return form.closeButton();
  });
}
