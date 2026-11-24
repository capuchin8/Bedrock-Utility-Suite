import {
  EntityComponentTypes,
  ItemStack,
  Player,
  system,
  world,
  type Container,
  type PlayerInteractWithBlockBeforeEvent,
  type Vector3,
} from "@minecraft/server";
import { raw, t } from "../core/lang";
import { onBlockInteractBefore } from "../events/blockInteractEvents";
import { blockKey, getBlock } from "../interact/interactStore";
import { getBlockTreasure } from "../interact/treasureStore";
import { canUse, registerPermission } from "../permissions/permissionStore";
import { getVanishSettings, getVanishedIds, isVanished, onVanishChanged, onVanishSettingsChanged } from "./vanishStore";

// While vanished, right-clicking a container shows its contents on a virtual screen instead of opening
// it (no lid animation, no sound, nobody sees you). An ender chest shows YOUR ender chest. Sneaking with
// an item in hand is let through, so you can still place blocks against a container.
//
// Uses the VirtualContainer API (beta-only, Preview 26.70+) through local types, like
// utils/virtualInventoryView.ts. Without it the contents are printed to chat, read-only.
//
// The screen is a snapshot taken when it opens. Editing needs the "Edit containers" setting AND the
// bus:vanish_edit permission; a move is only written if the real slot still holds what the screen thought
// it did, otherwise it is undone and the screen is refreshed, so nothing is duplicated.
// Your own ender chest is always editable.
//
// The interact hook only exists while someone is vanished and the setting is on.

export const VANISH_EDIT_KEY = "bus:vanish_edit";

registerPermission({
  key: VANISH_EDIT_KEY,
  label: t("bus.perm.vanish_edit.name"),
  description: t("bus.perm.vanish_edit.desc"),
  category: "feature",
  defaultEveryone: false,
  defaultOperators: false,
});

// ---- beta API access (local types) -------------------------------------------------------------
interface VContainer extends Container {
  open(player: Player): void;
  close(player?: Player): number;
}
interface VManager {
  create(options: { size: number; title?: string }): VContainer;
}
interface Signal<E> {
  subscribe(callback: (e: E) => void): unknown;
  unsubscribe(callback: (e: E) => void): void;
}
interface ItemChangeEvent {
  container: VContainer;
  player: Player;
  slot: number;
  itemStack?: ItemStack;
  beforeItemStack?: ItemStack;
}
interface CloseEvent {
  container: VContainer;
  player: Player;
  reason: unknown;
}
interface BetaAfterEvents {
  virtualContainerItemChange?: Signal<ItemChangeEvent>;
  virtualContainerClose?: Signal<CloseEvent>;
}

const manager = (): VManager | undefined =>
  (world as unknown as { virtualContainerManager?: VManager }).virtualContainerManager;
const events = (): BetaAfterEvents => world.afterEvents as unknown as BetaAfterEvents;

function supported(): boolean {
  const e = events();
  return !!manager() && !!e.virtualContainerItemChange && !!e.virtualContainerClose;
}

interface CursorLike {
  readonly item?: ItemStack;
  clear(): void;
}
const cursorOf = (player: Player): CursorLike | undefined =>
  player.getComponent("minecraft:cursor_inventory") as unknown as CursorLike | undefined;

function readCursor(player: Player): ItemStack | undefined {
  try {
    return cursorOf(player)?.item;
  } catch {
    return undefined;
  }
}

const enderOf = (player: Player): Container | undefined =>
  (player.getComponent("minecraft:ender_inventory" as any) as { container?: Container } | undefined)?.container;

// ---- views -------------------------------------------------------------------------------------
interface View {
  viewer: Player;
  container: VContainer;
  real: Container;
  realSize: number;
  ender: boolean;
}

const views = new Map<string, View>();
let subscribed = false;

const sameStack = (a: ItemStack | undefined, b: ItemStack | undefined): boolean =>
  !a || !b ? !a && !b : a.typeId === b.typeId && a.amount === b.amount;

function giveBack(viewer: Player, item: ItemStack): void {
  const leftover = viewer.getComponent(EntityComponentTypes.Inventory)?.container?.addItem(item);
  if (leftover) viewer.dimension.spawnItem(leftover, viewer.location);
}

/** Puts the slot back as it was; an item the viewer placed returns to them and a picked-up one is dropped from their cursor. */
function undoMove(view: View, e: ItemChangeEvent): void {
  const held = readCursor(view.viewer);
  const before = e.beforeItemStack;
  const cursorHoldsBefore = !!before && !!held && held.typeId === before.typeId;
  if (cursorHoldsBefore) {
    try {
      cursorOf(view.viewer)?.clear();
    } catch {
      // cursor not clearable
    }
  }
  view.container.setItem(e.slot, before);
  if (e.itemStack && (cursorHoldsBefore || !before)) giveBack(view.viewer, e.itemStack);
}

function resync(view: View): void {
  for (let slot = 0; slot < view.realSize; slot++) view.container.setItem(slot, view.real.getItem(slot));
}

const onItemChange = (e: ItemChangeEvent): void => {
  let view: View | undefined;
  try {
    view = views.get(e.player.id);
  } catch {
    return;
  }
  if (!view || e.container !== view.container) return;
  try {
    const mayEdit = view.ender || (getVanishSettings().containerEdit && canUse(view.viewer, VANISH_EDIT_KEY));
    if (e.slot >= view.realSize || !mayEdit) {
      undoMove(view, e);
      return;
    }
    if (!sameStack(view.real.getItem(e.slot), e.beforeItemStack)) {
      undoMove(view, e);
      resync(view);
      return;
    }
    view.real.setItem(e.slot, e.itemStack);
  } catch (err) {
    console.warn(`[bus:vanish] container move failed: ${err}`);
    closeFor(view.viewer);
  }
};

const onClose = (e: CloseEvent): void => {
  let view: View | undefined;
  try {
    view = views.get(e.player.id);
  } catch {
    return;
  }
  if (!view || e.container !== view.container) return;
  views.delete(view.viewer.id);
  unsubscribeIfIdle();
};

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  const e = events();
  e.virtualContainerItemChange?.subscribe(onItemChange);
  e.virtualContainerClose?.subscribe(onClose);
}

function unsubscribeIfIdle(): void {
  if (!subscribed || views.size > 0) return;
  subscribed = false;
  const e = events();
  e.virtualContainerItemChange?.unsubscribe(onItemChange);
  e.virtualContainerClose?.unsubscribe(onClose);
}

function closeFor(viewer: Player): void {
  const view = views.get(viewer.id);
  if (!view) return;
  views.delete(viewer.id);
  try {
    view.container.close(viewer);
  } catch {
    // not open any more
  }
  unsubscribeIfIdle();
}

function closeAll(): void {
  for (const view of [...views.values()]) closeFor(view.viewer);
}

// After the chat fallback prints a container, clicking the SAME one again (after a short delay, so a held
// click doesn't count) is let through and really opens it. Expires after 5 seconds.
const ARM_TICKS = 100;
const ARM_DELAY_TICKS = 10;
const armed = new Map<string, { key: string; at: number }>();

function printChat(viewer: Player, real: Container, key: string): void {
  armed.set(viewer.id, { key, at: system.currentTick });
  viewer.sendMessage(t("bus.vanish.peek.header"));
  let any = false;
  for (let i = 0; i < real.size; i++) {
    const item = real.getItem(i);
    if (!item) continue;
    any = true;
    viewer.sendMessage({
      rawtext: [t("bus.inventory.slot", i), raw(`§f${item.typeId.replace("minecraft:", "")} §7x${item.amount}`)],
    });
  }
  if (!any) viewer.sendMessage(t("bus.vanish.peek.empty"));
  viewer.sendMessage(t("bus.vanish.peek.click_again"));
}

/** Runs inside system.run (not a before-event). */
function openPeek(viewer: Player, dimensionId: string, location: Vector3, ender: boolean): void {
  if (!viewer.isValid || !isVanished(viewer) || !getVanishSettings().containerPeek) return;

  let real: Container | undefined;
  if (ender) {
    real = enderOf(viewer);
  } else {
    try {
      real = world.getDimension(dimensionId).getBlock(location)?.getComponent("minecraft:inventory")?.container;
    } catch {
      // chunk not loaded
    }
  }
  if (!real) return;

  const key = blockKey(dimensionId, location);
  const mgr = manager();
  // Without edit rights the virtual screen is never used (moving items on it could duplicate them):
  // print to chat instead. Your own ender chest is always editable.
  const mayEdit = ender || (getVanishSettings().containerEdit && canUse(viewer, VANISH_EDIT_KEY));
  if (!mayEdit || !mgr || !supported()) {
    printChat(viewer, real, key);
    return;
  }

  closeFor(viewer);
  const realSize = real.size;
  const size = Math.min(54, Math.max(9, Math.ceil(realSize / 9) * 9));
  try {
    const container = mgr.create({
      size,
      title: ender ? "bus.inventory.view.title_echest" : "bus.vanish.peek.title",
    });
    for (let slot = 0; slot < realSize && slot < size; slot++) container.setItem(slot, real.getItem(slot));
    views.set(viewer.id, { viewer, container, real, realSize: Math.min(realSize, size), ender });
    subscribe();
    container.open(viewer);
  } catch (e) {
    console.warn(`[bus:vanish] could not open the peek screen: ${e}`);
    views.delete(viewer.id);
    unsubscribeIfIdle();
    printChat(viewer, real, key);
  }
}

// ---- interact hook (before-event: only read and cancel here) -----------------------------------
const holdingItem = (player: Player): boolean =>
  !!player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex);

function onInteract(event: PlayerInteractWithBlockBeforeEvent): void {
  const { player, block } = event;
  if (!isVanished(player)) return;
  if (player.isSneaking && holdingItem(player)) return; // placing a block against it

  const ender = block.typeId === "minecraft:ender_chest";
  if (!ender && !block.getComponent("minecraft:inventory")?.container) return;

  // Linked blocks and treasures belong to the interact module.
  const key = blockKey(block.dimension.id, block.location);
  if (getBlock(key) || getBlockTreasure(key)) return;

  // Second click on the container that was just printed to chat: let it open for real.
  const arm = armed.get(player.id);
  if (arm && arm.key === key) {
    const age = system.currentTick - arm.at;
    if (age > ARM_TICKS) {
      armed.delete(player.id);
    } else if (event.isFirstEvent && age >= ARM_DELAY_TICKS) {
      armed.delete(player.id);
      return;
    }
  }

  event.cancel = true;
  if (!event.isFirstEvent) return;
  const dimensionId = block.dimension.id;
  const location = block.location;
  system.run(() => openPeek(player, dimensionId, location, ender));
}

let removeHook: (() => void) | undefined;

function syncHook(): void {
  const want = getVanishSettings().containerPeek && getVanishedIds().size > 0;
  if (want && !removeHook) {
    removeHook = onBlockInteractBefore(onInteract);
  } else if (!want && removeHook) {
    removeHook();
    removeHook = undefined;
    closeAll();
  }
}

onVanishChanged((player, vanished) => {
  if (player && vanished === false) closeFor(player);
  syncHook();
});
onVanishSettingsChanged(syncHook);
world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  armed.delete(playerId);
  views.delete(playerId);
  unsubscribeIfIdle();
});
