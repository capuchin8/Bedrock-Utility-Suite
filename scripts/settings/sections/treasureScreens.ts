import type { Player } from "@minecraft/server";
import {
  CustomForm,
  ObservableBoolean,
  ObservableString,
  ObservableUIRawMessage,
  type UIRawMessage,
} from "@minecraft/server-ui";
import { raw, t, tell } from "../../core/lang";
import { armPlayer } from "../../interact/interactBlocks";
import { describeKey } from "../../interact/interactStore";
import { playTreasureSound } from "../../interact/treasure";
import {
  deleteTreasure,
  effectiveSettings,
  getDefaults,
  listBlockTreasures,
  listTreasureEntities,
  patchTreasure,
  plainName,
  readTreasure,
  resetClaims,
  setDefaults,
  type Treasure,
  type TreasureRef,
} from "../../interact/treasureStore";
import { confirmButton } from "../confirmButton";
import { createGuard } from "../guard";
import { showForm } from "../openForm";

// Sub-screens of Settings > Interactive Blocks (they share its permission, so owner-only).
const KEY = "bus:interactive_blocks";
const WRITABLE = { clientWritable: true } as const;

const short = (id: string): string => id.replace(/^minecraft:/, "");
const blankToUndefined = (v: string): string | undefined => v.trim() || undefined;

function nameArg(treasure: Treasure): string | UIRawMessage {
  const name = effectiveSettings(treasure).name;
  return name ? plainName(name) : t("bus.treasure.default_name");
}

function whereLabel(ref: TreasureRef, treasure: Treasure): UIRawMessage {
  if (ref.kind === "block") {
    const at = describeKey(ref.key);
    return t("bus.treasure.item", nameArg(treasure), short(treasure.type), at.x, at.y, at.z, short(at.dimension));
  }
  const at = ref.entity.isValid ? ref.entity.location : { x: 0, y: 0, z: 0 };
  const dimension = ref.entity.isValid ? short(ref.entity.dimension.id) : "?";
  return t(
    "bus.treasure.item",
    nameArg(treasure),
    short(treasure.type),
    Math.floor(at.x),
    Math.floor(at.y),
    Math.floor(at.z),
    dimension
  );
}

export function openTreasureHome(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.treasure.title")));
    form.label(t("bus.treasure.intro"));
    form.button(
      t("bus.treasure.add"),
      guard.click(() => {
        form.close();
        armPlayer(player, { mode: "treasure" });
        tell(player, t("bus.treasure.armed"));
      })
    );
    form.button(
      t("bus.treasure.list"),
      guard.click(() => {
        form.close();
        treasureList(player, () => openTreasureHome(player, back));
      })
    );
    form.button(
      t("bus.treasure.defaults"),
      guard.click(() => {
        form.close();
        defaultsScreen(player, () => openTreasureHome(player, back));
      })
    );
    form.divider().button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}

function treasureList(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.treasure.list")));
    const rows: { ref: TreasureRef; treasure: Treasure }[] = [
      ...listBlockTreasures().map(([key, treasure]) => ({ ref: { kind: "block", key } as TreasureRef, treasure })),
      ...listTreasureEntities().map(({ entity, treasure }) => ({
        ref: { kind: "entity", entity } as TreasureRef,
        treasure,
      })),
    ];
    form.label(t(rows.length ? "bus.treasure.pick" : "bus.treasure.none"));
    for (const { ref, treasure } of rows) {
      form.button(
        whereLabel(ref, treasure),
        guard.click(() => {
          form.close();
          treasureDetail(player, ref, () => treasureList(player, back));
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

function defaultsScreen(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const d = getDefaults();
    const name = new ObservableString(d.name, WRITABLE);
    const openSound = new ObservableString(d.openSound, WRITABLE);
    const errorSound = new ObservableString(d.errorSound, WRITABLE);
    const protect = new ObservableBoolean(d.protect, WRITABLE);
    guard.on(name, (v: string) => setDefaults({ name: v }));
    guard.on(openSound, (v: string) => setDefaults({ openSound: v }));
    guard.on(errorSound, (v: string) => setDefaults({ errorSound: v }));
    guard.on(protect, (v: boolean) => setDefaults({ protect: v }));

    const form = guard.attach(new CustomForm(player, t("bus.treasure.defaults.title")));
    form.label(t("bus.treasure.defaults.intro"));
    form.textField(t("bus.treasure.name"), name, { description: t("bus.treasure.name.desc") });
    form.textField(t("bus.treasure.sound_open"), openSound, { description: t("bus.treasure.sound.desc") });
    form.button(
      t("bus.treasure.test_open"),
      guard.click(() => playTreasureSound(player, getDefaults().openSound))
    );
    form.textField(t("bus.treasure.sound_error"), errorSound, { description: t("bus.treasure.sound.desc") });
    form.button(
      t("bus.treasure.test_error"),
      guard.click(() => playTreasureSound(player, getDefaults().errorSound))
    );
    form.toggle(t("bus.treasure.protect"), protect, { description: t("bus.treasure.protect.desc") });
    form.divider().button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}

function treasureDetail(player: Player, ref: TreasureRef, back: () => void): void {
  const treasure = readTreasure(ref);
  if (!treasure) return back();
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;

  showForm(player, () => {
    const status = new ObservableUIRawMessage(raw(""));
    const form = guard.attach(new CustomForm(player, t("bus.treasure.detail.title")));
    form.label(whereLabel(ref, treasure));
    form.label(t("bus.treasure.detail.intro"));

    // Blank = use the default from "Default settings".
    const name = new ObservableString(treasure.name ?? "", WRITABLE);
    const openSound = new ObservableString(treasure.openSound ?? "", WRITABLE);
    const errorSound = new ObservableString(treasure.errorSound ?? "", WRITABLE);
    guard.on(name, (v: string) => patchTreasure(ref, { name: blankToUndefined(v) }));
    guard.on(openSound, (v: string) => patchTreasure(ref, { openSound: blankToUndefined(v) }));
    guard.on(errorSound, (v: string) => patchTreasure(ref, { errorSound: blankToUndefined(v) }));

    form.textField(t("bus.treasure.name"), name, { description: t("bus.treasure.name.override.desc") });
    form.textField(t("bus.treasure.sound_open"), openSound, { description: t("bus.treasure.sound.override.desc") });
    form.button(
      t("bus.treasure.test_open"),
      guard.click(() => {
        const current = readTreasure(ref);
        if (current) playTreasureSound(player, effectiveSettings(current).openSound);
      })
    );
    form.textField(t("bus.treasure.sound_error"), errorSound, { description: t("bus.treasure.sound.override.desc") });
    form.button(
      t("bus.treasure.test_error"),
      guard.click(() => {
        const current = readTreasure(ref);
        if (current) playTreasureSound(player, effectiveSettings(current).errorSound);
      })
    );

    if (ref.kind === "block") {
      // Two toggles: "use my own setting" and, only then, its value.
      let overridden = treasure.protect !== undefined;
      let value = treasure.protect ?? getDefaults().protect;
      const override = new ObservableBoolean(overridden, WRITABLE);
      const protect = new ObservableBoolean(value, WRITABLE);
      guard.on(override, (v: boolean) => {
        overridden = v;
        patchTreasure(ref, { protect: v ? value : undefined });
      });
      guard.on(protect, (v: boolean) => {
        value = v;
        if (overridden) patchTreasure(ref, { protect: v });
      });
      form.toggle(t("bus.treasure.protect.override"), override, {
        description: t("bus.treasure.protect.override.desc"),
      });
      form.toggle(t("bus.treasure.protect"), protect, {
        description: t("bus.treasure.protect.desc"),
        visible: override,
      });
    } else {
      form.label(t("bus.treasure.protect.entity"));
    }

    form.divider().label(status);
    confirmButton(
      form,
      t("bus.treasure.reset"),
      guard.click(() => {
        status.setData(resetClaims(ref) ? t("bus.treasure.claims_reset") : t("bus.treasure.gone"));
      })
    );
    confirmButton(
      form,
      t("bus.treasure.remove"),
      guard.click(() => {
        deleteTreasure(ref);
        form.close();
        back();
      })
    );
    form.button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}
