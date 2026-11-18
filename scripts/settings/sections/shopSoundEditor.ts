import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import { playSound } from "../../shop/shopSounds";
import { DEFAULT_SOUNDS, SOUND_ID_PATTERN, flushSave, getShop, scheduleSave } from "../../shop/shopStore";
import { StatusLabel } from "../../shop/statusLabel";
import type { ShopSound } from "../../shop/shopTypes";
import { createGuard, type SettingsGuard } from "../guard";
import { showForm } from "../openForm";
import { KEY } from "./shopEntryEditor";

const W = { clientWritable: true } as const;

function soundControls(
  form: CustomForm,
  guard: SettingsGuard,
  player: Player,
  which: "success" | "failure",
  status: StatusLabel,
  reopen: () => void
): void {
  const sound: ShopSound = getShop().sounds[which];
  form.header(t(`bus.shopedit.sound_${which}`));

  const id = new ObservableString(sound.id, W);
  guard.on(id, (v: string) => {
    const s = v.trim();
    if (!SOUND_ID_PATTERN.test(s)) {
      status.set(t("bus.shopedit.sound.invalid_id"));
      return;
    }
    sound.id = s;
    scheduleSave();
  });
  form.textField(t("bus.shopedit.sound_id"), id, { description: t("bus.shopedit.sound_id.desc") });

  const volume = new ObservableString(String(sound.volume), W);
  guard.on(volume, (v: string) => {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || n < 0 || n > 10) return;
    sound.volume = n;
    scheduleSave();
  });
  form.textField(t("bus.shopedit.sound_volume"), volume, { description: t("bus.shopedit.sound_volume.desc") });

  const pitch = new ObservableString(String(sound.pitch), W);
  guard.on(pitch, (v: string) => {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || n < 0.1 || n > 4) return;
    sound.pitch = n;
    scheduleSave();
  });
  form.textField(t("bus.shopedit.sound_pitch"), pitch, { description: t("bus.shopedit.sound_pitch.desc") });

  form.button(
    t("bus.shopedit.sound_preview"),
    guard.click(() =>
      system.run(() => {
        playSound(player, sound);
        status.set(sound.id ? t("bus.shopedit.sound_played") : t("bus.shopedit.sound_silent"));
      })
    )
  );
  form.button(
    t("bus.shopedit.sound_reset"),
    guard.click(() => {
      getShop().sounds[which] = { ...DEFAULT_SOUNDS[which] };
      flushSave();
      form.close();
      reopen();
    })
  );
}

export function openSoundEditor(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  const reopen = (): void => openSoundEditor(player, back);
  showForm(player, () => {
    const status = new StatusLabel();
    const form = guard.attach(new CustomForm(player, t("bus.shopedit.sounds.title")));
    form.label(t("bus.shopedit.sounds.intro"));
    soundControls(form, guard, player, "success", status, reopen);
    soundControls(form, guard, player, "failure", status, reopen);
    form
      .spacer()
      .label(status.message, { visible: status.visible })
      .spacer()
      .button(t("bus.common.back"), () => {
        flushSave();
        form.close();
        back();
      });
    return form.closeButton();
  });
}
