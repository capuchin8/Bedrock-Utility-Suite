import {
  EntityComponentTypes,
  EquipmentSlot,
  ItemStack,
  Player,
  system,
  world,
  type Container,
} from "@minecraft/server";
import { onPlayerLeave } from "../events/playerEvents";
import { isInventoryHidden } from "./inventoryVault";

/**
 * Live inventory / ender chest screens built on the VirtualContainer API (Preview 26.70+, beta-only).
 *
 * The beta API is reached through local types, like roles/chatSupport.ts does for chatSend, so this file
 * compiles against older typings and `virtualViewsSupported()` says whether the running game has it.
 *
 * openInventoryView(viewer, target, canEdit)  nine slots per row, like the inventory screen:
 *     rows 1-3  slots 0-26   main inventory (real slots 9-35)
 *     row 4     slots 27-35  hotbar (real slots 0-8)
 *     row 5     slots 36-39  head, chest, legs, feet; 40 offhand; 41 the TARGET's cursor (display only)
 *               42 a "hidden inventory" notice item, which only exists (43 slots instead of 42) while the
 *               target's inventory is hidden; if it gets hidden or restored while the screen is open, the
 *               screen is closed and reopened with the new size
 * openEnderChestView(viewer, target, canEdit)  27 slots, 1:1 with the target's ender chest
 *
 * The screens are live and editable: items the viewer moves are written to the target immediately, so
 * every move is a real transfer (nothing is duplicated). Because of that, callers must gate them behind a
 * dedicated permission and pass it as `canEdit`; it is re-checked on every move, and the screen closes
 * (the move is undone) as soon as it returns false.
 *
 * Armor slots only accept matching armor (by item id: _helmet, carved_pumpkin, _head/_skull, _chestplate,
 * elytra, _leggings, _boots; custom wearables with other names are rejected). A wrong item is moved into the
 * matching armor slot if that is empty, otherwise the move is undone and the item goes to the viewer's
 * inventory (the cursor component is read-only, so it cannot be handed back to the cursor). The offhand
 * takes anything. The cursor and notice slots are display only: a click on them is undone.
 *
 * Text: the beta API's title and an item's name are plain strings, not UIRawMessages, so t() cannot be used
 * and nothing can take a %s argument. The title is a bare lang key, which the game localizes; the notice is a
 * custom item whose name comes from the resource pack lang file. Neither can contain the target's name.
 *
 * Keeping the screen up to date is event-driven, with no timers. After every move made in the screen, and
 * whenever the target's inventory changes (playerInventoryItemChange), the target grabs an item onto their
 * cursor (playerCursorItemGrab, pre-release) or any slot of the target's containers changes
 * (entityContainerSlotChange, optional, unverified), the parts that can change without a move are re-read:
 * armor, offhand, cursor and the hidden state, or the whole ender chest. Known gap: if none of those events
 * fires (for example the target puts their cursor item into their ender chest and nothing else changes),
 * the screen catches up on the next event or when it is reopened. The cursor component is not used with
 * touch controls.
 *
 * Every function that changes the world must run outside restricted execution: call them inside system.run
 * from a command callback or before-event.
 */

// ---------------------------------------------------------------------------
// Beta API access (local types)
// ---------------------------------------------------------------------------

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
interface InventoryChangeEvent {
  player: Player;
  slot: number;
  itemStack?: ItemStack;
}
interface CursorGrabEvent {
  player: Player;
  item: ItemStack;
}
/** Only used as a trigger: the payload is not relied on (unverified), just whose container changed. */
interface ContainerSlotChangeEvent {
  entity?: { id: string };
  player?: { id: string };
}
interface BetaAfterEvents {
  virtualContainerItemChange?: Signal<ItemChangeEvent>;
  virtualContainerClose?: Signal<CloseEvent>;
  playerInventoryItemChange?: Signal<InventoryChangeEvent>;
  playerCursorItemGrab?: Signal<CursorGrabEvent>;
  entityContainerSlotChange?: Signal<ContainerSlotChangeEvent>;
}

const manager = (): VManager | undefined =>
  (world as unknown as { virtualContainerManager?: VManager }).virtualContainerManager;
const events = (): BetaAfterEvents => world.afterEvents as unknown as BetaAfterEvents;

/** True when the running game exposes the VirtualContainer API (and its two events). */
export function virtualViewsSupported(): boolean {
  const e = events();
  return !!manager() && !!e.virtualContainerItemChange && !!e.virtualContainerClose;
}

// PlayerCursorInventoryComponent: `item` is read-only and can throw; `clear()` is the only mutation.
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

function clearCursor(player: Player): void {
  try {
    cursorOf(player)?.clear();
  } catch (e) {
    vlog(`cursor clear failed: ${e}`);
  }
}

const enderOf = (target: Player): Container | undefined =>
  (target.getComponent("minecraft:ender_inventory" as any) as { container?: Container } | undefined)?.container;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const ENDER_SIZE = 27;
const HOTBAR_START = 27;
const EQUIP_START = 36; // slots 36-40: head, chest, legs, feet, offhand
const ARMOR_END = 40; // slots 36-39 are armor and can reject; the offhand (40) takes anything
const CURSOR_SLOT = 41;
const NOTICE_SLOT = 42;
const EQUIP: EquipmentSlot[] = [
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet,
  EquipmentSlot.Offhand,
];

/** 42 slots, or 43 while the target's inventory is hidden (the extra slot holds the notice). */
const inventorySize = (hasNotice: boolean): number => (hasNotice ? NOTICE_SLOT + 1 : CURSOR_SLOT + 1);

/** Container slot (0-35) -> real inventory slot. */
const toInventory = (slot: number): number => (slot < HOTBAR_START ? slot + 9 : slot - HOTBAR_START);
/** Real inventory slot (0-35) -> container slot. */
const toContainer = (inventorySlot: number): number =>
  inventorySlot >= 9 ? inventorySlot - 9 : inventorySlot + HOTBAR_START;

type ViewKind = "inventory" | "ender";

interface View {
  viewer: Player;
  target: Player;
  kind: ViewKind;
  container: VContainer;
  canEdit: () => boolean;
  /** Whether the container has the extra notice slot (inventory views of a hidden inventory). */
  hasNotice: boolean;
  /** True from the moment the screen is asked to close for a resize until it has been reopened. */
  reopening: boolean;
  /** Last known real value of the five equipment slots, so a real change can be told from a pending screen move. */
  known: (ItemStack | undefined)[];
  /** Same idea for the 27 ender chest slots. */
  knownEnder: (ItemStack | undefined)[];
  knownCursor: ItemStack | undefined;
}

export type ViewError = "unsupported" | "no_inventory" | "open_failed";
export type ViewResult = { ok: true } | { ok: false; error: ViewError };

/** One view per viewer, keyed by the viewer's id. */
const views = new Map<string, View>();
let subscribed = false;
let leaveHooked = false;
let logger: ((text: string) => void) | undefined;

/** Optional diagnostics hook (the debug test uses it). */
export function setViewLogger(fn: ((text: string) => void) | undefined): void {
  logger = fn;
}
function vlog(text: string): void {
  logger?.(text);
}

// ---------------------------------------------------------------------------
// Title and notice text
// ---------------------------------------------------------------------------

/**
 * The window title: a bare lang key (no arguments), which the game localizes. The API documents the title as a
 * plain string "localized when it names a localization key"; there is no way to pass the target's name.
 */
function viewTitle(kind: ViewKind): string {
  return kind === "ender" ? "bus.inventory.view.title_echest" : "bus.inventory.view.title_inventory";
}

/**
 * The "this inventory is hidden" item. Item names and lore are plain strings that are NOT localized, so this is
 * a custom item (BP/items/inventory_hidden_notice.json) whose name comes from the resource pack lang entry
 * `item.bus:inventory_hidden_notice`. If the pack files are missing, a plain barrier is used instead.
 */
export function createHiddenNoticeItem(): ItemStack {
  try {
    return new ItemStack("bus:inventory_hidden_notice", 1);
  } catch {
    return new ItemStack("minecraft:barrier", 1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemText(item: ItemStack | undefined): string {
  return item ? `${item.typeId}x${item.amount}` : "-";
}

/** Comparison for mirrored inventory and ender slots. */
function sameItem(a: ItemStack | undefined, b: ItemStack | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.typeId !== b.typeId || a.amount !== b.amount || a.nameTag !== b.nameTag) return false;
  // isStackableWith is false for items that cannot stack at all, so only use it for stackable ones.
  return a.maxAmount > 1 ? a.isStackableWith(b) : true;
}

/** Loose comparison (id and amount only), used for equipment and the cursor so damage ticks are not "changes". */
function sameType(a: ItemStack | undefined, b: ItemStack | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.typeId === b.typeId && a.amount === b.amount;
}

/** Which armor slot an item belongs in, by id. Undefined for anything that is not armor. */
function armorKind(typeId: string): EquipmentSlot | undefined {
  if (
    typeId.endsWith("_helmet") ||
    typeId === "minecraft:carved_pumpkin" ||
    typeId.endsWith("_head") ||
    typeId.endsWith("_skull")
  )
    return EquipmentSlot.Head;
  if (typeId.endsWith("_chestplate") || typeId === "minecraft:elytra") return EquipmentSlot.Chest;
  if (typeId.endsWith("_leggings")) return EquipmentSlot.Legs;
  if (typeId.endsWith("_boots")) return EquipmentSlot.Feet;
  return undefined;
}

function slotName(view: View, slot: number): string {
  if (view.kind === "ender") return `ender ${slot}`;
  if (slot < HOTBAR_START) return `main ${slot}`;
  if (slot < EQUIP_START) return `hotbar ${slot - HOTBAR_START}`;
  if (slot === CURSOR_SLOT) return "cursor";
  if (slot === NOTICE_SLOT) return "notice";
  return EQUIP[slot - EQUIP_START];
}

/** Reads one mirrored slot from the target (slot 41 is the target's cursor). */
function readReal(view: View, slot: number): ItemStack | undefined {
  if (view.kind === "ender") return enderOf(view.target)?.getItem(slot);
  if (slot < EQUIP_START)
    return view.target.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(toInventory(slot));
  if (slot === CURSOR_SLOT) return readCursor(view.target);
  return view.target.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EQUIP[slot - EQUIP_START]);
}

function writeReal(view: View, slot: number, item: ItemStack | undefined): void {
  if (view.kind === "ender") {
    enderOf(view.target)?.setItem(slot, item);
    return;
  }
  if (slot < EQUIP_START) {
    view.target.getComponent(EntityComponentTypes.Inventory)?.container?.setItem(toInventory(slot), item);
    return;
  }
  if (slot >= CURSOR_SLOT) return; // display only
  view.target.getComponent(EntityComponentTypes.Equippable)?.setEquipment(EQUIP[slot - EQUIP_START], item);
}

/** Writes to the target and records what it now holds. For equipment slots returns false if the game did not keep it. */
function applyReal(view: View, slot: number, item: ItemStack | undefined): boolean {
  writeReal(view, slot, item);
  if (view.kind === "ender") {
    view.knownEnder[slot] = readReal(view, slot);
    return true;
  }
  if (slot < EQUIP_START) return true;
  const back = readReal(view, slot);
  view.known[slot - EQUIP_START] = back;
  return sameType(back, item);
}

function setCursorSlot(view: View, item: ItemStack | undefined): void {
  view.knownCursor = item;
  view.container.setItem(CURSOR_SLOT, item?.clone());
}

function syncAll(view: View): void {
  if (view.kind === "ender") {
    for (let slot = 0; slot < ENDER_SIZE; slot++) {
      const real = readReal(view, slot);
      view.knownEnder[slot] = real;
      if (!sameItem(real, view.container.getItem(slot))) view.container.setItem(slot, real);
    }
    return;
  }
  for (let slot = 0; slot < CURSOR_SLOT; slot++) {
    const real = readReal(view, slot);
    if (slot >= EQUIP_START) view.known[slot - EQUIP_START] = real;
    if (!sameItem(real, view.container.getItem(slot))) view.container.setItem(slot, real);
  }
  setCursorSlot(view, readCursor(view.target));
  if (view.hasNotice) view.container.setItem(NOTICE_SLOT, createHiddenNoticeItem());
}

function refreshCursor(view: View): void {
  const cursor = readCursor(view.target);
  if (sameType(cursor, view.knownCursor)) return;
  setCursorSlot(view, cursor);
  vlog(`target cursor -> ${itemText(cursor)}`);
}

/** Armor/offhand changed on the target by something other than this screen. */
function refreshEquipment(view: View): void {
  for (let i = 0; i < EQUIP.length; i++) {
    const real = readReal(view, EQUIP_START + i);
    if (sameType(real, view.known[i])) continue;
    view.known[i] = real;
    view.container.setItem(EQUIP_START + i, real);
    vlog(`${EQUIP[i]} changed on target -> screen: ${itemText(real)}`);
  }
}

/**
 * Re-reads the ender chest. Only slots whose real value differs from the last one we saw are updated, so a
 * move that is still waiting for its event is never overwritten with the old value.
 */
function refreshEnder(view: View): void {
  const ender = enderOf(view.target);
  if (!ender) return;
  for (let slot = 0; slot < ENDER_SIZE; slot++) {
    const real = ender.getItem(slot);
    if (sameItem(real, view.knownEnder[slot])) continue;
    view.knownEnder[slot] = real;
    view.container.setItem(slot, real);
    vlog(`ender ${slot} changed -> screen: ${itemText(real)}`);
  }
}

/** Re-reads every part of the screen that can change without a move being made in it. */
function refreshLive(view: View): void {
  if (view.reopening) return;
  if (view.kind === "ender") {
    refreshEnder(view);
    return;
  }
  // The inventory was hidden or restored: the notice slot has to appear or go away, which needs a new size.
  if (isInventoryHidden(view.target) !== view.hasNotice) {
    beginReopen(view);
    return;
  }
  refreshEquipment(view);
  refreshCursor(view);
}

/** Puts an item into the viewer's inventory, or on the ground if it is full. */
function giveBack(view: View, item: ItemStack): string {
  const leftover = view.viewer.getComponent(EntityComponentTypes.Inventory)?.container?.addItem(item);
  if (!leftover) return "moved into the viewer's inventory";
  view.viewer.dimension.spawnItem(leftover, view.viewer.location);
  return "dropped at the viewer's feet (inventory full)";
}

// ---------------------------------------------------------------------------
// Resizing (hidden state changed while the screen is open)
// ---------------------------------------------------------------------------

/** Asks the screen to close; onClose reopens it with the new size once the close has completed. */
function beginReopen(view: View): void {
  if (view.reopening) return;
  vlog(`target inventory ${isInventoryHidden(view.target) ? "was hidden" : "was restored"}: reopening the screen`);
  view.reopening = true;
  let asked = 0;
  try {
    asked = view.container.close(view.viewer);
  } catch {
    // not open any more
  }
  if (asked === 0) dropView(view); // the viewer already closed it
}

function reopen(view: View): void {
  view.reopening = false;
  const mgr = manager();
  if (!mgr || !view.target.isValid || !view.viewer.isValid) {
    dropView(view);
    return;
  }
  try {
    view.hasNotice = isInventoryHidden(view.target);
    view.known = new Array(EQUIP.length).fill(undefined);
    view.knownCursor = undefined;
    view.container = mgr.create({ size: inventorySize(view.hasNotice), title: viewTitle(view.kind) });
    syncAll(view);
    view.container.open(view.viewer);
    vlog(`screen reopened with ${inventorySize(view.hasNotice)} slots`);
  } catch (e) {
    vlog(`reopen failed: ${e}`);
    dropView(view);
  }
}

function dropView(view: View): void {
  views.delete(view.viewer.id);
  unsubscribeIfIdle();
}

// ---------------------------------------------------------------------------
// Moves made on the screen
// ---------------------------------------------------------------------------

/**
 * Undoes a move: the slot gets its old item back. If the old item is now on the viewer's cursor (a swap or a
 * pick-up) the viewer's cursor is cleared so nothing is duplicated, and an item the viewer placed goes back to them.
 */
function undoMove(view: View, slot: number, item: ItemStack | undefined, before: ItemStack | undefined): string {
  const held = readCursor(view.viewer);
  const cursorHoldsBefore = !!before && !!held && held.typeId === before.typeId;
  if (cursorHoldsBefore) clearCursor(view.viewer);
  view.container.setItem(slot, before);
  // A pick-up has no placed item; a swap or a placement does, and it belongs to the viewer.
  return item && (cursorHoldsBefore || !before) ? giveBack(view, item) : "nothing to give back";
}

/** An item that does not fit the armor slot it was dropped into, or that the game refused to equip. */
function reject(view: View, slot: number, item: ItemStack, before: ItemStack | undefined, why: string): void {
  const held = readCursor(view.viewer);
  const swap = !!before && !!held && held.typeId === before.typeId;

  // 1. Auto-move into the matching armor slot if it is empty.
  const kind = armorKind(item.typeId);
  const targetIndex = kind === undefined ? -1 : EQUIP.indexOf(kind);
  const targetSlot = targetIndex === -1 ? undefined : EQUIP_START + targetIndex;
  if (
    targetSlot !== undefined &&
    targetSlot !== slot &&
    !view.container.getItem(targetSlot) &&
    !readReal(view, targetSlot)
  ) {
    view.container.setItem(slot, swap ? undefined : before);
    if (swap && slot < ARMOR_END) applyReal(view, slot, undefined); // the old armor left the slot for the viewer's cursor
    view.container.setItem(targetSlot, item);
    if (applyReal(view, targetSlot, item)) {
      vlog(`${why}: ${itemText(item)} auto-moved to ${slotName(view, targetSlot)}`);
      return;
    }
    view.container.setItem(targetSlot, undefined);
    vlog(`auto-move to ${slotName(view, targetSlot)} was refused by the game: ${giveBack(view, item)}`);
    return;
  }

  // 2. Undo the move.
  vlog(`${why}: ${itemText(item)} rejected from ${slotName(view, slot)}, ${undoMove(view, slot, item, before)}`);
}

const onItemChange = (e: ItemChangeEvent): void => {
  let view: View | undefined;
  try {
    view = views.get(e.player.id);
  } catch {
    return;
  }
  if (!view || view.reopening) return; // a screen that is closing for a resize can no longer change anything
  try {
    // Re-check access at the moment the change is applied.
    if (!view.canEdit()) {
      vlog(`access lost: ${undoMove(view, e.slot, e.itemStack, e.beforeItemStack)}; closing`);
      closeView(view);
      return;
    }
    if (!view.target.isValid) {
      closeView(view);
      return;
    }
    const item = e.itemStack;
    if (view.kind === "inventory" && (e.slot === CURSOR_SLOT || e.slot === NOTICE_SLOT)) {
      vlog(`${slotName(view, e.slot)} slot is display only: ${undoMove(view, e.slot, item, e.beforeItemStack)}`);
    } else if (
      view.kind === "inventory" &&
      item &&
      e.slot >= EQUIP_START &&
      e.slot < ARMOR_END &&
      armorKind(item.typeId) !== EQUIP[e.slot - EQUIP_START]
    ) {
      reject(view, e.slot, item, e.beforeItemStack, `wrong item for ${slotName(view, e.slot)}`);
    } else if (!applyReal(view, e.slot, item)) {
      if (item) reject(view, e.slot, item, e.beforeItemStack, `game refused ${slotName(view, e.slot)}`);
    } else {
      vlog(
        `${slotName(view, e.slot)}: ${itemText(e.beforeItemStack)} -> ${itemText(item)} applied to ${view.target.name}`
      );
    }
    // Check everything else again after each change (the ender chest included).
    refreshLive(view);
  } catch (err) {
    vlog(`change of ${slotName(view, e.slot)} failed: ${err}`);
    if (!view.target.isValid) closeView(view);
  }
};

// ---------------------------------------------------------------------------
// Changes made outside the screen
// ---------------------------------------------------------------------------

// The target's inventory changed (also fires for our own writes; the same-item check stops echoes).
const onInventoryChange = (e: InventoryChangeEvent): void => {
  for (const view of [...views.values()]) {
    try {
      if (view.target.id !== e.player.id || view.reopening) continue;
      if (view.kind === "inventory" && e.slot >= 0 && e.slot < EQUIP_START) {
        const slot = toContainer(e.slot);
        if (!sameItem(e.itemStack, view.container.getItem(slot))) {
          view.container.setItem(slot, e.itemStack);
          vlog(`${view.target.name} inventory ${e.slot} -> ${slotName(view, slot)}: ${itemText(e.itemStack)}`);
        }
      }
      // Equipping from the hotbar or by shift-click changes the inventory too; moving items into the ender
      // chest from their own screen does as well. This is when the other parts are re-read.
      refreshLive(view);
    } catch (err) {
      vlog(`mirror of inventory ${e.slot} failed: ${err}`);
    }
  }
};

// An item went from a container to the target's cursor: re-read armor, cursor and ender chest.
const onCursorGrab = (e: CursorGrabEvent): void => {
  for (const view of [...views.values()]) {
    try {
      if (view.target.id === e.player.id) refreshLive(view);
    } catch (err) {
      vlog(`refresh failed: ${err}`);
    }
  }
};

// Optional extra trigger (unverified event): some slot of the target's containers changed.
const onContainerSlotChange = (e: ContainerSlotChangeEvent): void => {
  const id = e.entity?.id ?? e.player?.id;
  if (!id) return;
  for (const view of [...views.values()]) {
    try {
      if (view.target.id === id) refreshLive(view);
    } catch (err) {
      vlog(`refresh failed: ${err}`);
    }
  }
};

const onClose = (e: CloseEvent): void => {
  let view: View | undefined;
  try {
    view = views.get(e.player.id);
  } catch {
    for (const v of views.values()) if (v.container === e.container) view = v;
  }
  if (!view) return;
  // A close we asked for because the hidden state changed: open the replacement now that the old one is done.
  if (view.reopening && String(e.reason) === "ServerClosed") {
    reopen(view);
    return;
  }
  vlog(`view closed, reason=${String(e.reason)}`);
  dropView(view);
};

// ---------------------------------------------------------------------------
// Subscriptions (made when the first view opens, removed when the last one closes)
// ---------------------------------------------------------------------------

function subscribe(): void {
  if (subscribed) return;
  const e = events();
  e.virtualContainerItemChange?.subscribe(onItemChange);
  e.virtualContainerClose?.subscribe(onClose);
  e.playerInventoryItemChange?.subscribe(onInventoryChange);
  e.playerCursorItemGrab?.subscribe(onCursorGrab);
  e.entityContainerSlotChange?.subscribe(onContainerSlotChange);
  if (!e.playerInventoryItemChange)
    vlog("playerInventoryItemChange is missing: screens only update after moves made in them.");
  if (!e.playerCursorItemGrab)
    vlog("playerCursorItemGrab is missing: armor/cursor/ender refresh on other events only.");
  if (!e.entityContainerSlotChange) vlog("entityContainerSlotChange is missing (optional extra trigger).");
  subscribed = true;
}

function unsubscribeIfIdle(): void {
  if (!subscribed || views.size > 0) return;
  const e = events();
  e.virtualContainerItemChange?.unsubscribe(onItemChange);
  e.virtualContainerClose?.unsubscribe(onClose);
  e.playerInventoryItemChange?.unsubscribe(onInventoryChange);
  e.playerCursorItemGrab?.unsubscribe(onCursorGrab);
  e.entityContainerSlotChange?.unsubscribe(onContainerSlotChange);
  subscribed = false;
}

/** Closes a view whose target logs out. Hooked once, when the first view opens. */
function hookLeave(): void {
  if (leaveHooked) return;
  leaveHooked = true;
  onPlayerLeave((player) => {
    const leaving = player.id;
    system.run(() => {
      for (const view of [...views.values()]) if (view.target.id === leaving) closeView(view);
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function closeView(view: View): void {
  view.reopening = false;
  views.delete(view.viewer.id);
  try {
    view.container.close(view.viewer);
  } catch {
    // not open any more
  }
  unsubscribeIfIdle();
}

function openView(viewer: Player, target: Player, kind: ViewKind, canEdit: () => boolean): ViewResult {
  const mgr = manager();
  if (!mgr || !virtualViewsSupported()) return { ok: false, error: "unsupported" };
  const hasSource =
    kind === "ender" ? !!enderOf(target) : !!target.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!hasSource) return { ok: false, error: "no_inventory" };

  const existing = views.get(viewer.id);
  if (existing) closeView(existing);

  hookLeave();
  subscribe();
  try {
    const hasNotice = kind === "inventory" && isInventoryHidden(target);
    const container = mgr.create({
      size: kind === "ender" ? ENDER_SIZE : inventorySize(hasNotice),
      title: viewTitle(kind),
    });
    const view: View = {
      viewer,
      target,
      kind,
      container,
      canEdit,
      hasNotice,
      reopening: false,
      known: new Array(EQUIP.length).fill(undefined),
      knownEnder: new Array(ENDER_SIZE).fill(undefined),
      knownCursor: undefined,
    };
    syncAll(view);
    views.set(viewer.id, view);
    try {
      container.open(viewer);
    } catch (e) {
      views.delete(viewer.id);
      throw e;
    }
    return { ok: true };
  } catch (e: any) {
    console.warn(`[bus:inventory] virtual view failed: ${e?.name ?? "error"} ${e?.message ?? e} reason=${e?.reason}`);
    unsubscribeIfIdle();
    return { ok: false, error: "open_failed" };
  }
}

/** Opens a live, editable view of `target`'s inventory (armor, offhand and the target's cursor included). */
export function openInventoryView(viewer: Player, target: Player, canEdit: () => boolean): ViewResult {
  return openView(viewer, target, "inventory", canEdit);
}

/** Opens a live, editable view of `target`'s ender chest. */
export function openEnderChestView(viewer: Player, target: Player, canEdit: () => boolean): ViewResult {
  return openView(viewer, target, "ender", canEdit);
}

/** Re-copies everything from the target into the viewer's open screen (picks up changes no event reports). */
export function syncView(viewer: Player): boolean {
  const view = views.get(viewer.id);
  if (!view || view.reopening) return false;
  syncAll(view);
  return true;
}

/** Closes the viewer's open screen, if any. */
export function closeViewOf(viewer: Player): boolean {
  const view = views.get(viewer.id);
  if (!view) return false;
  closeView(view);
  return true;
}

export function closeAllViews(): void {
  for (const view of [...views.values()]) closeView(view);
}
