import type { Vector3 } from "@minecraft/server";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";

/**
 * Floating images are particles, not entities, so there is nothing in the world that remembers
 * them. They are stored here (one world dynamic property) and shown by floatingImageDisplay.ts.
 */
export interface FloatingImage {
  id: string;
  /** Dimension id, e.g. "minecraft:overworld". */
  dimension: string;
  /** Centre of the image. */
  x: number;
  y: number;
  z: number;
  /** Unit vector the image faces (the side you read it from). */
  dx: number;
  dy: number;
  dz: number;
  /** Full size in blocks (the particle file halves it, because particle sizes are half-extents). */
  width: number;
  height: number;
  /** Roll around the facing direction, degrees. */
  rotation: number;
}

export type FloatingImageData = Omit<FloatingImage, "id">;

const KEY = "bus:floating_images";
/** Dynamic property strings are limited in size; ~150 bytes per image keeps this far below it. */
export const MAX_IMAGES = 100;

export const SIZE_LIMITS = { min: 0.5, max: 20 } as const;

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

export function normalize(v: Vector3): Vector3 | undefined {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 1e-6 ? { x: v.x / length, y: v.y / length, z: v.z / length } : undefined;
}

/** Validates one stored record; returns undefined for anything unusable. */
function sanitize(value: unknown): FloatingImage | undefined {
  if (!isRecord(value)) return undefined;
  const { id, dimension, x, y, z, dx, dy, dz, width, height, rotation } = value;
  if (typeof id !== "string" || typeof dimension !== "string") return undefined;
  const numbers = [x, y, z, dx, dy, dz, width, height, rotation];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  const dir = normalize({ x: dx as number, y: dy as number, z: dz as number });
  if (!dir) return undefined;
  return {
    id,
    dimension,
    x: x as number,
    y: y as number,
    z: z as number,
    dx: dir.x,
    dy: dir.y,
    dz: dir.z,
    width: clamp(width as number, SIZE_LIMITS.min, SIZE_LIMITS.max),
    height: clamp(height as number, SIZE_LIMITS.min, SIZE_LIMITS.max),
    rotation: (((rotation as number) % 360) + 360) % 360,
  };
}

let cache: FloatingImage[] | undefined;

// Loaded on first use (never at module load: world data is not readable during early execution).
function load(): FloatingImage[] {
  if (!cache) {
    const stored = readWorldJson<unknown>(KEY, []);
    cache = Array.isArray(stored) ? stored.map(sanitize).filter((i): i is FloatingImage => i !== undefined) : [];
  }
  return cache;
}

function save(): void {
  writeWorldJson(KEY, load());
}

// Change signal: the display loop listens to start/stop itself and to refresh what players see.
type Listener = (changedId?: string) => void;
const listeners = new Set<Listener>();

export function onImagesChanged(listener: Listener): void {
  listeners.add(listener);
}

function notify(changedId?: string): void {
  for (const listener of listeners) listener(changedId);
}

export function getImages(): readonly FloatingImage[] {
  return load();
}

export function getImage(id: string): FloatingImage | undefined {
  return load().find((i) => i.id === id);
}

/** Adds an image. Returns undefined when the limit is reached. */
export function addImage(data: FloatingImageData): FloatingImage | undefined {
  const images = load();
  if (images.length >= MAX_IMAGES) return undefined;
  const image: FloatingImage = {
    ...data,
    id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
  };
  const clean = sanitize(image);
  if (!clean) return undefined;
  images.push(clean);
  save();
  notify(clean.id);
  return clean;
}

/** Replaces an image's settings. Returns false when it no longer exists or the data is invalid. */
export function updateImage(id: string, data: FloatingImageData): boolean {
  const images = load();
  const index = images.findIndex((i) => i.id === id);
  if (index < 0) return false;
  const clean = sanitize({ ...data, id });
  if (!clean) return false;
  images[index] = clean;
  save();
  notify(id);
  return true;
}

export function removeImage(id: string): boolean {
  const images = load();
  const index = images.findIndex((i) => i.id === id);
  if (index < 0) return false;
  images.splice(index, 1);
  save();
  notify(id);
  return true;
}
