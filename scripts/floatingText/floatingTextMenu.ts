/**
 * Floating Text screens, opened from Settings > Floating Text (see
 * settings/sections/floatingTextSection.ts). Create and edit floating text and
 * floating scoreboards.
 *
 * Every screen is its own DDUI form with its own guard. Results (created, saved, errors)
 * are shown as a label, because chat is hidden while a form is open.
 */
import { system, world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import {
  CustomForm,
  ObservableBoolean,
  ObservableNumber,
  ObservableString,
  ObservableUIRawMessage,
  type UIRawMessage,
} from "@minecraft/server-ui";
import { raw, t } from "../core/lang";
import { stripFormatting } from "../roles/display";
import { createGuard } from "../settings/guard";
import { showForm } from "../settings/openForm";
import { FLOATING_COLOR_ITEMS, colorCodeAt, colorIndexOf } from "./floatingTextColors";
import { getDimensions, readScoreboardInfo, writeScoreboardInfo, type ScoreboardInfo } from "./floatingTextEntities";

/** Settings section id, also the permission key. */
export const FLOATING_TEXT_KEY = "bus:floating_text";

const W = { clientWritable: true } as const;
const ENTITY_ID = "bus:floatingtext";
const SPAWN_EVENT_TEXT = "text";
const SPAWN_EVENT_SCOREBOARD = "scoreboard";
/** The entity sits this far below the position shown to the player so the name tag lines up. */
const NAME_TAG_Y_OFFSET = 0.58;
const MAX_LISTED = 15;

// Entity data, not UI text: this is what gets stored on the entity itself.
const DEFAULT_TEXT = "Floating Text";
const LOADING_TEXT = "LOADING...";

const DEFAULT_SCOREBOARD: Omit<ScoreboardInfo, "objectiveId"> = {
  sortOrder: "descending",
  enumeratePlayers: true,
  hideOfflinePlayers: false,
  enumerationColor: "§6",
  playerNameColor: "§f",
  scoreColor: "§c",
  maxListed: 8,
};

/** Called when a screen is finished. The optional message is shown on the screen it returns to. */
type Done = (notice?: UIRawMessage) => void;

/** A message label that stays hidden until something is set (chat is invisible inside a form). */
class Status {
  readonly message = new ObservableUIRawMessage(t("bus.common.back"));
  readonly visible = new ObservableBoolean(false);

  constructor(initial?: UIRawMessage) {
    if (initial) this.set(initial);
  }

  set(message: UIRawMessage): void {
    this.message.setData(message);
    this.visible.setData(true);
  }
}

// ---- helpers -------------------------------------------------------------------------------

function parsePosition(text: string): Vector3 | undefined {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 3) return undefined;
  const [x, y, z] = parts.map(Number);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : undefined;
}

function formatPosition(pos: Vector3, yOffset = 0): string {
  return [pos.x.toFixed(2), (pos.y + yOffset).toFixed(2), pos.z.toFixed(2)].join(" ");
}

const toNameTag = (text: string): string => (text.trim() === "" ? DEFAULT_TEXT : text.replace(/\\n/g, "\n"));
const firstLine = (entity: Entity): string => entity.nameTag.split("\n")[0];

/** Creates one floating entity. Must run outside restricted execution (wrap in system.run). */
function spawnFloating(player: Player, pos: Vector3, spawnEvent: string, init: (entity: Entity) => void): UIRawMessage {
  if (!player.isValid) return t("bus.floatingtext.error.spawn");
  try {
    const entity = player.dimension.spawnEntity(
      ENTITY_ID,
      { x: pos.x, y: pos.y - NAME_TAG_Y_OFFSET, z: pos.z },
      { spawnEvent }
    );
    init(entity);
    return t("bus.floatingtext.notice.created");
  } catch (e) {
    console.warn(`[bus:floatingtext] spawn failed: ${e}`);
    return t("bus.floatingtext.error.spawn");
  }
}

function removeFloating(entity: Entity): UIRawMessage {
  if (!entity.isValid) return t("bus.floatingtext.error.gone");
  entity.remove();
  return t("bus.floatingtext.notice.deleted");
}

/** True when at least one floating text or scoreboard entity is loaded in any dimension. */
function hasLoadedFloatingText(): boolean {
  return getDimensions().some((dimension) => dimension.getEntities({ type: ENTITY_ID, families: ["inanimate"] }).length > 0);
}

/**
 * Press-twice delete: the first press arms the button (its text changes and a warning label
 * appears), the second press deletes. `wrap` is the screen's guard.click.
 */
function addDeleteControls(form: CustomForm, onDelete: () => void, wrap: (fn: () => void) => () => void): void {
  const armed = new ObservableBoolean(false);
  const buttonText = new ObservableUIRawMessage(t("bus.floatingtext.delete"));
  form.divider();
  form.label(t("bus.floatingtext.delete.warning"), { visible: armed });
  form.button(
    buttonText,
    wrap(() => {
      if (!armed.getData()) {
        armed.setData(true);
        buttonText.setData(t("bus.floatingtext.delete.again"));
        return;
      }
      onDelete();
    })
  );
}

// ---- home ----------------------------------------------------------------------------------

export function openFloatingTextMenu(player: Player, back: () => void, notice?: UIRawMessage): void {
  const guard = createGuard(player, FLOATING_TEXT_KEY);
  if (!guard.check()) return;
  const reopen: Done = (n) => openFloatingTextMenu(player, back, n);

  showForm(player, () => {
    const status = new Status(notice);
    const form = guard.attach(new CustomForm(player, t("bus.section.floating_text.title")));
    form.label(t("bus.floatingtext.intro"));
    form.button(
      t("bus.floatingtext.new_text"),
      guard.click(() => {
        form.close();
        newText(player, reopen);
      })
    );
    form.button(
      t("bus.floatingtext.new_scoreboard"),
      guard.click(() => {
        form.close();
        newScoreboard(player, reopen);
      })
    );
    // Only offer editing when there is something loaded to edit.
    if (hasLoadedFloatingText()) {
      form.button(
        t("bus.floatingtext.edit"),
        guard.click(() => {
          form.close();
          listTexts(player, reopen);
        })
      );
    }
    form.label(status.message, { visible: status.visible });
    form.divider().button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}

// ---- floating text -------------------------------------------------------------------------

function newText(player: Player, done: Done): void {
  const guard = createGuard(player, FLOATING_TEXT_KEY);
  if (!guard.check()) return;

  showForm(player, () => {
    const text = new ObservableString("", W);
    const position = new ObservableString(formatPosition(player.location), W);
    const status = new Status();

    const form = guard.attach(new CustomForm(player, t("bus.floatingtext.new_text.title")));
    form
      .textField(t("bus.floatingtext.text"), text, { description: t("bus.floatingtext.text.desc") })
      .textField(t("bus.floatingtext.position"), position, { description: t("bus.floatingtext.position.desc") })
      .label(status.message, { visible: status.visible })
      .button(
        t("bus.floatingtext.create"),
        guard.click(() => {
          const pos = parsePosition(position.getData());
          if (!pos) {
            status.set(t("bus.floatingtext.error.position"));
            return;
          }
          const nameTag = toNameTag(text.getData());
          form.close();
          system.run(() =>
            done(
              spawnFloating(player, pos, SPAWN_EVENT_TEXT, (entity) => {
                entity.nameTag = nameTag;
              })
            )
          );
        })
      )
      .button(t("bus.common.cancel"), () => {
        form.close();
        done();
      });
    return form;
  });
}

function editText(player: Player, entity: Entity, done: Done): void {
  const guard = createGuard(player, FLOATING_TEXT_KEY);
  if (!guard.check()) return;
  if (!entity.isValid) return done(t("bus.floatingtext.error.gone"));

  showForm(player, () => {
    const text = new ObservableString(entity.nameTag.replace(/\n/g, "\\n"), W);
    const position = new ObservableString(formatPosition(entity.location, NAME_TAG_Y_OFFSET), W);
    const status = new Status();

    const form = guard.attach(new CustomForm(player, t("bus.floatingtext.edit.title")));
    form
      .textField(t("bus.floatingtext.text"), text, { description: t("bus.floatingtext.text.desc") })
      .textField(t("bus.floatingtext.position"), position, { description: t("bus.floatingtext.position.desc") })
      .label(status.message, { visible: status.visible })
      .button(
        t("bus.floatingtext.save"),
        guard.click(() => {
          const pos = parsePosition(position.getData());
          if (!pos) {
            status.set(t("bus.floatingtext.error.position"));
            return;
          }
          const nameTag = toNameTag(text.getData());
          form.close();
          system.run(() => {
            if (!entity.isValid) return done(t("bus.floatingtext.error.gone"));
            entity.nameTag = nameTag;
            entity.teleport({ x: pos.x, y: pos.y - NAME_TAG_Y_OFFSET, z: pos.z });
            done(t("bus.floatingtext.notice.saved"));
          });
        })
      );
    addDeleteControls(
      form,
      () => {
        form.close();
        system.run(() => done(removeFloating(entity)));
      },
      (fn) => guard.click(fn)
    );
    form.button(t("bus.common.back"), () => {
      form.close();
      done();
    });
    return form;
  });
}

// ---- floating scoreboard -------------------------------------------------------------------

/**
 * Adds the scoreboard fields shared by the create and edit screens, and returns what is needed
 * to read them back when the player presses the save button.
 */
function addScoreboardControls(form: CustomForm, objectiveIds: string[], info: ScoreboardInfo, positionText: string) {
  const fallback = (code: string) => colorIndexOf(code);
  const objective = new ObservableNumber(Math.max(0, objectiveIds.indexOf(info.objectiveId)), W);
  const position = new ObservableString(positionText, W);
  const sort = new ObservableNumber(info.sortOrder === "ascending" ? 0 : 1, W);
  const enumerate = new ObservableBoolean(info.enumeratePlayers, W);
  const hideOffline = new ObservableBoolean(info.hideOfflinePlayers === true, W);
  const enumColor = new ObservableNumber(colorIndexOf(info.enumerationColor, fallback(DEFAULT_SCOREBOARD.enumerationColor)), W);
  const nameColor = new ObservableNumber(colorIndexOf(info.playerNameColor, fallback(DEFAULT_SCOREBOARD.playerNameColor)), W);
  const scoreColor = new ObservableNumber(colorIndexOf(info.scoreColor, fallback(DEFAULT_SCOREBOARD.scoreColor)), W);
  const maxListed = new ObservableNumber(Math.min(MAX_LISTED, Math.max(1, info.maxListed)), W);
  const enumerateVisible = new ObservableBoolean(info.enumeratePlayers);
  enumerate.subscribe((v) => enumerateVisible.setData(v));

  // Colour codes show up in labels (not on buttons), so the preview is a label.
  const sample = (): string => {
    const prefix = enumerate.getData() ? `${colorCodeAt(enumColor.getData())}1. ` : "";
    return `${prefix}${colorCodeAt(nameColor.getData())}Steve§r ${colorCodeAt(scoreColor.getData())}42§r`;
  };
  const preview = new ObservableUIRawMessage(t("bus.floatingtext.preview", sample()));
  const refresh = (): void => preview.setData(t("bus.floatingtext.preview", sample()));
  enumerate.subscribe(refresh);
  enumColor.subscribe(refresh);
  nameColor.subscribe(refresh);
  scoreColor.subscribe(refresh);

  form
    .dropdown(
      t("bus.floatingtext.objective"),
      objective,
      objectiveIds.map((id, i) => ({ label: raw(id), value: i }))
    )
    .textField(t("bus.floatingtext.position"), position, { description: t("bus.floatingtext.position.desc") })
    .dropdown(t("bus.floatingtext.sort"), sort, [
      { label: t("bus.floatingtext.sort.ascending"), value: 0 },
      { label: t("bus.floatingtext.sort.descending"), value: 1 },
    ])
    .toggle(t("bus.floatingtext.enumerate"), enumerate)
    .toggle(t("bus.floatingtext.hide_offline"), hideOffline, { description: t("bus.floatingtext.hide_offline.desc") })
    .dropdown(t("bus.floatingtext.enum_color"), enumColor, FLOATING_COLOR_ITEMS, { visible: enumerateVisible })
    .dropdown(t("bus.floatingtext.name_color"), nameColor, FLOATING_COLOR_ITEMS)
    .dropdown(t("bus.floatingtext.score_color"), scoreColor, FLOATING_COLOR_ITEMS)
    .label(preview)
    .slider(t("bus.floatingtext.max_listed"), maxListed, 1, MAX_LISTED, { step: 1 });

  return {
    position,
    read: (): ScoreboardInfo => ({
      objectiveId: objectiveIds[Math.round(objective.getData())] ?? objectiveIds[0],
      sortOrder: Math.round(sort.getData()) === 0 ? "ascending" : "descending",
      enumeratePlayers: enumerate.getData(),
      hideOfflinePlayers: hideOffline.getData(),
      enumerationColor: colorCodeAt(enumColor.getData()),
      playerNameColor: colorCodeAt(nameColor.getData()),
      scoreColor: colorCodeAt(scoreColor.getData()),
      maxListed: Math.min(MAX_LISTED, Math.max(1, Math.round(maxListed.getData()))),
    }),
  };
}

function newScoreboard(player: Player, done: Done): void {
  const guard = createGuard(player, FLOATING_TEXT_KEY);
  if (!guard.check()) return;
  const objectiveIds = world.scoreboard.getObjectives().map((o) => o.id);
  if (objectiveIds.length === 0) return done(t("bus.floatingtext.error.no_objectives"));

  showForm(player, () => {
    const status = new Status();
    const form = guard.attach(new CustomForm(player, t("bus.floatingtext.new_scoreboard.title")));
    const fields = addScoreboardControls(
      form,
      objectiveIds,
      { objectiveId: objectiveIds[0], ...DEFAULT_SCOREBOARD },
      formatPosition(player.location)
    );
    form
      .label(status.message, { visible: status.visible })
      .button(
        t("bus.floatingtext.create"),
        guard.click(() => {
          const pos = parsePosition(fields.position.getData());
          if (!pos) {
            status.set(t("bus.floatingtext.error.position"));
            return;
          }
          const info = fields.read();
          form.close();
          system.run(() =>
            done(
              spawnFloating(player, pos, SPAWN_EVENT_SCOREBOARD, (entity) => {
                writeScoreboardInfo(entity, info);
                entity.nameTag = LOADING_TEXT;
              })
            )
          );
        })
      )
      .button(t("bus.common.cancel"), () => {
        form.close();
        done();
      });
    return form;
  });
}

function editScoreboard(player: Player, entity: Entity, done: Done): void {
  const guard = createGuard(player, FLOATING_TEXT_KEY);
  if (!guard.check()) return;
  if (!entity.isValid) return done(t("bus.floatingtext.error.gone"));
  const objectiveIds = world.scoreboard.getObjectives().map((o) => o.id);
  if (objectiveIds.length === 0) return done(t("bus.floatingtext.error.no_objectives"));
  // A scoreboard with no readable settings is cleaned up by the update loop, so there is nothing to edit.
  const info = readScoreboardInfo(entity);
  if (!info) return done(t("bus.floatingtext.error.gone"));

  showForm(player, () => {
    const status = new Status();
    const form = guard.attach(new CustomForm(player, t("bus.floatingtext.edit.title")));
    const fields = addScoreboardControls(form, objectiveIds, info, formatPosition(entity.location, NAME_TAG_Y_OFFSET));
    form
      .label(status.message, { visible: status.visible })
      .button(
        t("bus.floatingtext.save"),
        guard.click(() => {
          const pos = parsePosition(fields.position.getData());
          if (!pos) {
            status.set(t("bus.floatingtext.error.position"));
            return;
          }
          const updated = fields.read();
          form.close();
          system.run(() => {
            if (!entity.isValid) return done(t("bus.floatingtext.error.gone"));
            writeScoreboardInfo(entity, updated);
            entity.nameTag = LOADING_TEXT;
            entity.teleport({ x: pos.x, y: pos.y - NAME_TAG_Y_OFFSET, z: pos.z });
            done(t("bus.floatingtext.notice.saved"));
          });
        })
      );
    addDeleteControls(
      form,
      () => {
        form.close();
        system.run(() => done(removeFloating(entity)));
      },
      (fn) => guard.click(fn)
    );
    form.button(t("bus.common.back"), () => {
      form.close();
      done();
    });
    return form;
  });
}

// ---- list of loaded floating text ----------------------------------------------------------

function listTexts(player: Player, done: Done, notice?: UIRawMessage): void {
  const guard = createGuard(player, FLOATING_TEXT_KEY);
  if (!guard.check()) return;
  const again: Done = (n) => listTexts(player, done, n);

  showForm(player, () => {
    const found: { entity: Entity; scoreboard: boolean }[] = [];
    for (const dimension of getDimensions()) {
      for (const entity of dimension.getEntities({ type: ENTITY_ID, families: ["inanimate"] })) {
        found.push({ entity, scoreboard: entity.matches({ families: ["scoreboard"] }) });
      }
    }

    const status = new Status(notice);
    const form = guard.attach(new CustomForm(player, t("bus.floatingtext.edit.title")));
    form.label(t(found.length ? "bus.floatingtext.edit.note" : "bus.floatingtext.edit.none"));

    for (const { entity, scoreboard } of found) {
      const at = entity.location;
      const where = `${Math.round(at.x)}, ${Math.round(at.y + NAME_TAG_Y_OFFSET)}, ${Math.round(at.z)}`;
      const label = stripFormatting(firstLine(entity));
      form.button(
        {
          rawtext: [
            label ? raw(label) : t("bus.floatingtext.unnamed"),
            raw(" - "),
            t(scoreboard ? "bus.floatingtext.kind.scoreboard" : "bus.floatingtext.kind.text"),
            raw(` (${where})`),
          ],
        },
        guard.click(() => {
          form.close();
          if (!entity.isValid) return again(t("bus.floatingtext.error.gone"));
          if (scoreboard) editScoreboard(player, entity, again);
          else editText(player, entity, again);
        })
      );
    }

    form.label(status.message, { visible: status.visible });
    form.divider().button(t("bus.common.back"), () => {
      form.close();
      done();
    });
    return form.closeButton();
  });
}
