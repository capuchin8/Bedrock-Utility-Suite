/**
 * Floating Image screens: opened from the Floating Text section (Settings > Floating Text >
 * Floating images). They share that section's permission key, which is passed in as `key`.
 *
 * Every screen is its own DDUI form with its own guard. Results (created, saved, errors) are shown
 * as a label, because chat is hidden while a form is open.
 */
import { system, type Block, type Direction, type Player, type Vector3 } from "@minecraft/server";
import {
  CustomForm,
  ObservableBoolean,
  ObservableNumber,
  ObservableString,
  type UIRawMessage,
} from "@minecraft/server-ui";
import { raw, t } from "../core/lang";
import { confirmButton } from "../settings/confirmButton";
import { createGuard } from "../settings/guard";
import { showForm } from "../settings/openForm";
import { StatusLabel } from "../shop/statusLabel";
import { directionToVector3 } from "../utils/math";
import {
  MAX_IMAGES,
  SIZE_LIMITS,
  addImage,
  getImage,
  getImages,
  normalize,
  removeImage,
  updateImage,
  type FloatingImage,
  type FloatingImageData,
} from "./floatingImageStore";

const W = { clientWritable: true } as const;
const RAYCAST_DISTANCE = 32;
/** How far the image floats in front of the surface it is placed on (stops it flickering inside the wall). */
const SURFACE_OFFSET = 0.02;

type Done = (notice?: UIRawMessage) => void;

// ---- helpers -------------------------------------------------------------------------------

const DIRECTION_KEYS = [
  "keep",
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
  "toward_me",
  "toward_me_tilted",
  "custom",
] as const;
type DirectionKey = (typeof DIRECTION_KEYS)[number];

const AXES: Record<string, Vector3> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
};

function parsePosition(text: string): Vector3 | undefined {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 3) return undefined;
  const [x, y, z] = parts.map(Number);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : undefined;
}

const formatPosition = (pos: Vector3): string => [pos.x, pos.y, pos.z].map((n) => n.toFixed(2)).join(" ");
const shortDimension = (id: string): string => id.replace(/^minecraft:/, "");

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Direction from two angles. Turn follows Minecraft's own yaw: 0 = south, 90 = west, 180 = north,
 * 270 = east. Tilt follows Minecraft's pitch: 0 = level, 90 = straight down, -90 = straight up.
 */
function directionFromAngles(turn: number, tilt: number): Vector3 {
  const yaw = toRadians(turn);
  const pitch = toRadians(tilt);
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
}

/** The reverse, used to fill the angle sliders from an existing image. */
function anglesFromDirection(dir: Vector3): { turn: number; tilt: number } {
  const turn = (Math.round((Math.atan2(-dir.x, dir.z) * 180) / Math.PI) + 360) % 360;
  const tilt = Math.round((-Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI);
  return { turn, tilt };
}

function resolveDirection(
  key: DirectionKey,
  player: Player,
  at: Vector3,
  current: Vector3 | undefined,
  angles: { turn: number; tilt: number }
): Vector3 {
  if (key === "keep") return current ?? AXES.south;
  if (key === "custom") return directionFromAngles(angles.turn, angles.tilt);
  if (key === "toward_me")
    return normalize({ x: player.location.x - at.x, y: 0, z: player.location.z - at.z }) ?? AXES.south;
  if (key === "toward_me_tilted") {
    const head = player.getHeadLocation();
    return normalize({ x: head.x - at.x, y: head.y - at.y, z: head.z - at.z }) ?? AXES.south;
  }
  return AXES[key];
}

/** The block face the player is looking at, worked out once when the screen opens. */
interface Surface {
  block: Block;
  face: Direction;
  normal: Vector3;
  /** Exact point the ray hit. */
  point: Vector3;
  /** Centre of the face. */
  center: Vector3;
}

function lookAtSurface(player: Player): Surface | undefined {
  try {
    const hit = player.getBlockFromViewDirection({
      maxDistance: RAYCAST_DISTANCE,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (!hit) return undefined;
    const normal = directionToVector3(hit.face);
    if (!normal) return undefined;
    const base = hit.block.location;
    return {
      block: hit.block,
      face: hit.face,
      normal,
      point: { x: base.x + hit.faceLocation.x, y: base.y + hit.faceLocation.y, z: base.z + hit.faceLocation.z },
      center: { x: base.x + 0.5 + normal.x * 0.5, y: base.y + 0.5 + normal.y * 0.5, z: base.z + 0.5 + normal.z * 0.5 },
    };
  } catch {
    return undefined;
  }
}

// ---- shared fields -------------------------------------------------------------------------

type ReadResult = { ok: true; data: FloatingImageData } | { ok: false; error: UIRawMessage };

/**
 * Adds the fields used by both the create and edit screens, and returns a reader that turns
 * them into image data when the player presses the save button.
 */
function addImageControls(form: CustomForm, player: Player, surface: Surface | undefined, existing?: FloatingImage) {
  const editing = existing !== undefined;
  const startOnSurface = !editing && surface !== undefined;

  const onSurface = new ObservableBoolean(startOnSurface, W);
  const snap = new ObservableBoolean(false, W);
  const manualVisible = new ObservableBoolean(!startOnSurface);
  const snapVisible = new ObservableBoolean(startOnSurface);
  onSurface.subscribe((v) => {
    manualVisible.setData(!v);
    snapVisible.setData(v);
  });

  const keys = DIRECTION_KEYS.filter((k) => editing || k !== "keep");
  const startAngles = existing
    ? anglesFromDirection({ x: existing.dx, y: existing.dy, z: existing.dz })
    : { turn: 0, tilt: 0 };
  const turn = new ObservableNumber(startAngles.turn, W);
  const tilt = new ObservableNumber(startAngles.tilt, W);
  const customVisible = new ObservableBoolean(false);
  const position = new ObservableString(existing ? formatPosition(existing) : formatPosition(player.location), W);
  const direction = new ObservableNumber(editing ? 0 : keys.indexOf("toward_me"), W);
  const rotation = new ObservableNumber(Math.round(existing?.rotation ?? 0) % 360, W);
  const width = new ObservableNumber(existing?.width ?? 3, W);
  const height = new ObservableNumber(existing?.height ?? 3, W);

  // The angle sliders only show while entering a position by hand and "Custom angles" is chosen.
  const refreshCustom = (): void =>
    customVisible.setData(manualVisible.getData() && keys[Math.round(direction.getData())] === "custom");
  onSurface.subscribe(refreshCustom);
  direction.subscribe(refreshCustom);

  if (surface) {
    const b = surface.block.location;
    form.label(
      t(
        "bus.floatingimage.looking_at",
        `${b.x}, ${b.y}, ${b.z}`,
        t(`bus.floatingimage.dir.${String(surface.face).toLowerCase()}`)
      )
    );
    form.toggle(t(editing ? "bus.floatingimage.move_to_surface" : "bus.floatingimage.on_surface"), onSurface);
    form.toggle(t("bus.floatingimage.snap"), snap, {
      description: t("bus.floatingimage.snap.desc"),
      visible: snapVisible,
    });
  } else if (!editing) {
    form.label(t("bus.floatingimage.no_surface"));
  }

  form
    .textField(t("bus.floatingimage.position"), position, {
      description: t("bus.floatingimage.position.desc"),
      visible: manualVisible,
    })
    .dropdown(
      t("bus.floatingimage.direction"),
      direction,
      keys.map((k, i) => ({ label: t(`bus.floatingimage.dir.${k}`), value: i })),
      { description: t("bus.floatingimage.direction.desc"), visible: manualVisible }
    )
    .slider(t("bus.floatingimage.turn"), turn, 0, 359, {
      step: 1,
      description: t("bus.floatingimage.turn.desc"),
      visible: customVisible,
    })
    .slider(t("bus.floatingimage.tilt"), tilt, -90, 90, {
      step: 1,
      description: t("bus.floatingimage.tilt.desc"),
      visible: customVisible,
    })
    .slider(t("bus.floatingimage.rotation"), rotation, 0, 359, {
      step: 1,
      description: t("bus.floatingimage.rotation.desc"),
    })
    // fixedFormatDigits is beta in @minecraft/server-ui 2.4.0: it makes the slider show 2.5 instead of 2.
    .slider(t("bus.floatingimage.width"), width, SIZE_LIMITS.min, SIZE_LIMITS.max, { step: 0.5, fixedFormatDigits: 1 })
    .slider(t("bus.floatingimage.height"), height, SIZE_LIMITS.min, SIZE_LIMITS.max, {
      step: 0.5,
      fixedFormatDigits: 1,
    });

  const read = (): ReadResult => {
    let dimension = existing?.dimension ?? player.dimension.id;
    let pos: Vector3 | undefined;
    let dir: Vector3;

    if (onSurface.getData() && surface) {
      const origin = snap.getData() ? surface.center : surface.point;
      pos = {
        x: origin.x + surface.normal.x * SURFACE_OFFSET,
        y: origin.y + surface.normal.y * SURFACE_OFFSET,
        z: origin.z + surface.normal.z * SURFACE_OFFSET,
      };
      dir = surface.normal;
      dimension = player.dimension.id;
    } else {
      pos = parsePosition(position.getData());
      if (!pos) return { ok: false, error: t("bus.floatingimage.error.position") };
      const key = keys[Math.round(direction.getData())] ?? "toward_me";
      dir = resolveDirection(
        key,
        player,
        pos,
        existing ? { x: existing.dx, y: existing.dy, z: existing.dz } : undefined,
        { turn: turn.getData(), tilt: tilt.getData() }
      );
    }

    return {
      ok: true,
      data: {
        dimension,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        dx: dir.x,
        dy: dir.y,
        dz: dir.z,
        width: width.getData(),
        height: height.getData(),
        rotation: rotation.getData(),
      },
    };
  };

  return { read };
}

// ---- home ----------------------------------------------------------------------------------

export function openFloatingImageMenu(player: Player, key: string, back: () => void, notice?: UIRawMessage): void {
  const guard = createGuard(player, key);
  if (!guard.check()) return;
  const reopen: Done = (n) => openFloatingImageMenu(player, key, back, n);

  showForm(player, () => {
    const status = new StatusLabel();
    if (notice) status.set(notice);
    const form = guard.attach(new CustomForm(player, t("bus.floatingimage.title")));
    form.label(t("bus.floatingimage.intro"));
    form.button(
      t("bus.floatingimage.new"),
      guard.click(() => {
        form.close();
        newImage(player, key, reopen);
      })
    );
    // Only offer editing when there is something to edit.
    if (getImages().length > 0) {
      form.button(
        t("bus.floatingimage.edit"),
        guard.click(() => {
          form.close();
          listImages(player, key, reopen);
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

// ---- create --------------------------------------------------------------------------------

function newImage(player: Player, key: string, done: Done): void {
  const guard = createGuard(player, key);
  if (!guard.check()) return;
  const surface = lookAtSurface(player);

  showForm(player, () => {
    const status = new StatusLabel();
    const form = guard.attach(new CustomForm(player, t("bus.floatingimage.new.title")));
    const fields = addImageControls(form, player, surface);
    form
      .label(status.message, { visible: status.visible })
      .button(
        t("bus.floatingimage.create"),
        guard.click(() => {
          const result = fields.read();
          if (!result.ok) {
            status.set(result.error);
            return;
          }
          form.close();
          system.run(() => {
            if (!guard.check()) return;
            const image = addImage(result.data);
            done(image ? t("bus.floatingimage.notice.created") : t("bus.floatingimage.error.limit", MAX_IMAGES));
          });
        })
      )
      .button(t("bus.common.cancel"), () => {
        form.close();
        done();
      });
    return form;
  });
}

// ---- list ----------------------------------------------------------------------------------

function listImages(player: Player, key: string, done: Done, notice?: UIRawMessage): void {
  const guard = createGuard(player, key);
  if (!guard.check()) return;
  const again: Done = (n) => listImages(player, key, done, n);

  showForm(player, () => {
    const here = player.location;
    const distanceTo = (i: FloatingImage): number =>
      i.dimension === player.dimension.id ? Math.hypot(i.x - here.x, i.y - here.y, i.z - here.z) : Infinity;
    // Nearest first; images in other dimensions go last.
    const images = [...getImages()].sort((a, b) => distanceTo(a) - distanceTo(b));

    const status = new StatusLabel();
    if (notice) status.set(notice);
    const form = guard.attach(new CustomForm(player, t("bus.floatingimage.edit.title")));
    form.label(t(images.length ? "bus.floatingimage.edit.note" : "bus.floatingimage.edit.none"));

    images.forEach((image, index) => {
      form.button(
        {
          rawtext: [
            raw(`${index + 1}. (${Math.round(image.x)}, ${Math.round(image.y)}, ${Math.round(image.z)}) `),
            raw(shortDimension(image.dimension)),
            raw(` - ${image.width}x${image.height}`),
          ],
        },
        guard.click(() => {
          form.close();
          editImage(player, key, image.id, again);
        })
      );
    });

    form.label(status.message, { visible: status.visible });
    form.divider().button(t("bus.common.back"), () => {
      form.close();
      done();
    });
    return form.closeButton();
  });
}

// ---- edit ----------------------------------------------------------------------------------

function editImage(player: Player, key: string, id: string, done: Done): void {
  const guard = createGuard(player, key);
  if (!guard.check()) return;
  const image = getImage(id);
  if (!image) return done(t("bus.floatingimage.error.gone"));
  const surface = lookAtSurface(player);

  showForm(player, () => {
    const status = new StatusLabel();
    const form = guard.attach(new CustomForm(player, t("bus.floatingimage.edit.title")));
    const fields = addImageControls(form, player, surface, image);
    form.label(status.message, { visible: status.visible }).button(
      t("bus.floatingimage.save"),
      guard.click(() => {
        const result = fields.read();
        if (!result.ok) {
          status.set(result.error);
          return;
        }
        form.close();
        system.run(() => {
          if (!guard.check()) return;
          done(updateImage(id, result.data) ? t("bus.floatingimage.notice.saved") : t("bus.floatingimage.error.gone"));
        });
      })
    );
    form.divider();
    confirmButton(
      form,
      t("bus.floatingimage.delete"),
      guard.click(() => {
        form.close();
        system.run(() => {
          if (!guard.check()) return;
          done(removeImage(id) ? t("bus.floatingimage.notice.deleted") : t("bus.floatingimage.error.gone"));
        });
      })
    );
    form.button(t("bus.common.back"), () => {
      form.close();
      done();
    });
    return form;
  });
}
