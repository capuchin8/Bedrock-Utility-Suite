import {
  ItemStack,
  Direction,
  Player,
  Dimension,
  Vector3,
  GameMode,
  Block,
} from "@minecraft/server";

export function decrementStack(player: Player) {
  if (player.getGameMode() === GameMode.Creative) return;

  const inventory = player.getComponent("minecraft:inventory");

  if (!inventory) return;

  const item = inventory.container.getItem(player.selectedSlotIndex);

  if (!item) return;

  if (item.amount === 1) {
    inventory.container.setItem(player.selectedSlotIndex, undefined);
  } else {
    inventory.container.setItem(
      player.selectedSlotIndex,
      new ItemStack(item.typeId, item.amount - 1),
    );
  }
}

export function updateLiquidBlock(dimension: Dimension, location: Vector3) {
  dimension.setBlockType(location, "minecraft:bedrock");
  dimension.setBlockType(location, "minecraft:air");
}

export function updateIfAir(
  dimension: Dimension,
  block: Block,
  blockLocation: Vector3,
) {
  if (block.typeId == "minecraft:air") {
    updateLiquidBlock(dimension, blockLocation);
  }
}

export const DirectionType = {
  HORIZONTAL: [
    Direction.North,
    Direction.South,
    Direction.West,
    Direction.East,
  ],
};

export function getOppositeDirection(
  direction: Direction,
): Direction | undefined {
  switch (direction) {
    case Direction.Up:
      return Direction.Down;
    case Direction.Down:
      return Direction.Up;
    case Direction.North:
      return Direction.South;
    case Direction.East:
      return Direction.West;
    case Direction.South:
      return Direction.North;
    case Direction.West:
      return Direction.East;
    default:
      return undefined;
  }
}

export function doesBlockBlockMovement(block: Block): boolean {
  return (
    block.typeId != "minecraft:cobweb" &&
    block.typeId != "minecraft:bamboo_sapling" &&
    !block.isLiquid &&
    !block.isAir
  );
}

export const cardinalSides = Object.freeze({
  north: { left: "east", right: "west" },
  south: { left: "west", right: "east" },
  west: { left: "north", right: "south" },
  east: { left: "south", right: "north" },
});
