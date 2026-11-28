import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableNumber } from "@minecraft/server-ui";
import { t } from "../core/lang";
import { showForm } from "../settings/openForm";
import { dimensionLabel, getEnabledDimensions, getRtp, rangeLabel } from "./rtpStore";
import { startRtp } from "./rtpStart";

/** Asks which dimension and range to use. Only called when there is more than one choice. */
export function openRtpPicker(player: Player, permissionKey: string, dimensions: string[]): void {
  const ranges = getRtp().ranges;
  showForm(player, () => {
    const startDim = Math.max(0, dimensions.indexOf(player.dimension.id));
    const dimIndex = new ObservableNumber(startDim, { clientWritable: true });
    const rangeIndex = new ObservableNumber(0, { clientWritable: true });

    const form = new CustomForm(player, t("bus.rtp.picker.title"));
    form.label(t("bus.rtp.picker.intro"));
    if (dimensions.length > 1) {
      form.dropdown(
        t("bus.rtp.picker.dimension"),
        dimIndex,
        dimensions.map((id, i) => ({ label: dimensionLabel(id), value: i }))
      );
    }
    if (ranges.length > 1) {
      form.dropdown(
        t("bus.rtp.picker.range"),
        rangeIndex,
        ranges.map((r, i) => ({ label: rangeLabel(r), value: i }))
      );
    }
    form.button(t("bus.rtp.picker.go"), () => {
      const dim = dimensions[dimIndex.getData()] ?? dimensions[0];
      const range = ranges[rangeIndex.getData()] ?? ranges[0];
      form.close();
      // Only start if that dimension is still enabled.
      system.run(() => {
        if (getEnabledDimensions().includes(dim)) startRtp(player, permissionKey, dim, range);
      });
    });
    form.button(t("bus.common.cancel"), () => form.close());
    return form.closeButton();
  });
}
