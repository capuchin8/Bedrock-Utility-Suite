import type { Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableString, ObservableUIRawMessage } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import { formatFake } from "../../vanish/vanishService";
import {
  DEFAULT_JOIN_FORMAT,
  DEFAULT_LEAVE_FORMAT,
  getVanishSettings,
  setVanishSettings,
} from "../../vanish/vanishStore";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

// Own key (not "bus:vanish") so being allowed to use /vanish doesn't also allow editing these settings.
const KEY = "bus:vanish_settings";
const W = { clientWritable: true } as const;

registerSettingsSection({
  id: KEY,
  title: t("bus.section.vanish.title"),
  description: t("bus.section.vanish.desc"),
  order: 65,
  open: (player, back) => openVanish(player, back),
});

function openVanish(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;

  showForm(player, () => {
    const s = getVanishSettings();
    const fake = new ObservableBoolean(s.fakeMessages, W);
    const joinFormat = new ObservableString(s.joinFormat, W);
    const leaveFormat = new ObservableString(s.leaveFormat, W);
    const locator = new ObservableBoolean(s.adjustLocatorBar, W);
    const spectator = new ObservableBoolean(s.spectator, W);
    const particles = new ObservableBoolean(s.particles, W);
    const reminder = new ObservableBoolean(s.reminder, W);
    const persist = new ObservableBoolean(s.persist, W);
    const peek = new ObservableBoolean(s.containerPeek, W);
    const edit = new ObservableBoolean(s.containerEdit, W);
    const hideMaps = new ObservableBoolean(s.hideFromMaps, W);
    const mapItem = new ObservableString(s.mapHeadItem, W);

    const joinPreview = new ObservableUIRawMessage(
      t("bus.vanish.preview_join", formatFake(s.joinFormat, "Steve", "Steve"))
    );
    const leavePreview = new ObservableUIRawMessage(
      t("bus.vanish.preview_leave", formatFake(s.leaveFormat, "Steve", "Steve"))
    );

    guard.on(fake, (v: boolean) => setVanishSettings({ fakeMessages: v }));
    guard.on(joinFormat, (v: string) => {
      setVanishSettings({ joinFormat: v });
      joinPreview.setData(t("bus.vanish.preview_join", formatFake(v, "Steve", "Steve")));
    });
    guard.on(leaveFormat, (v: string) => {
      setVanishSettings({ leaveFormat: v });
      leavePreview.setData(t("bus.vanish.preview_leave", formatFake(v, "Steve", "Steve")));
    });
    guard.on(locator, (v: boolean) => setVanishSettings({ adjustLocatorBar: v }));
    guard.on(spectator, (v: boolean) => setVanishSettings({ spectator: v }));
    guard.on(particles, (v: boolean) => setVanishSettings({ particles: v }));
    guard.on(reminder, (v: boolean) => setVanishSettings({ reminder: v }));
    guard.on(persist, (v: boolean) => setVanishSettings({ persist: v }));
    guard.on(peek, (v: boolean) => setVanishSettings({ containerPeek: v }));
    guard.on(edit, (v: boolean) => setVanishSettings({ containerEdit: v }));
    guard.on(hideMaps, (v: boolean) => setVanishSettings({ hideFromMaps: v }));
    guard.on(mapItem, (v: string) => setVanishSettings({ mapHeadItem: v }));

    const form = guard.attach(new CustomForm(player, t("bus.section.vanish.title")));
    form.label(t("bus.vanish.intro"));

    form.header(t("bus.vanish.header.messages"));
    form.toggle(t("bus.vanish.fake_messages"), fake, { description: t("bus.vanish.fake_messages.desc") });
    form.textField(t("bus.vanish.leave_format"), leaveFormat, {
      description: t("bus.vanish.format.desc"),
      visible: fake,
    });
    form.label(leavePreview, { visible: fake });
    form.textField(t("bus.vanish.join_format"), joinFormat, {
      description: t("bus.vanish.format.desc"),
      visible: fake,
    });
    form.label(joinPreview, { visible: fake });
    form.button(
      t("bus.vanish.reset_formats"),
      guard.click(() => {
        leaveFormat.setData(DEFAULT_LEAVE_FORMAT);
        joinFormat.setData(DEFAULT_JOIN_FORMAT);
      })
    );

    form.divider().header(t("bus.vanish.header.behavior"));
    form.toggle(t("bus.vanish.locator"), locator, { description: t("bus.vanish.locator.desc") });
    form.toggle(t("bus.vanish.spectator"), spectator, { description: t("bus.vanish.spectator.desc") });
    form.toggle(t("bus.vanish.persist"), persist, { description: t("bus.vanish.persist.desc") });
    form.toggle(t("bus.vanish.hide_maps"), hideMaps, { description: t("bus.vanish.hide_maps.desc") });
    form.textField(t("bus.vanish.map_item"), mapItem, {
      description: t("bus.vanish.map_item.desc"),
      visible: hideMaps,
    });

    form.divider().header(t("bus.vanish.header.staff"));
    form.toggle(t("bus.vanish.particles"), particles, { description: t("bus.vanish.particles.desc") });
    form.toggle(t("bus.vanish.reminder_setting"), reminder, { description: t("bus.vanish.reminder_setting.desc") });
    form.toggle(t("bus.vanish.peek"), peek, { description: t("bus.vanish.peek.desc") });
    form.toggle(t("bus.vanish.peek_edit"), edit, { description: t("bus.vanish.peek_edit.desc"), visible: peek });

    form.divider().button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}
