import { CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import { defineBusCommand } from "../commands/busCommand";
import { reply } from "../core/commandResult";
import { raw, t, tell } from "../core/lang";
import { getShop } from "../shop/shopStore";
import { filterVisible, getVisibleName, isHiddenFrom } from "../vanish/visibility";
import { MAX_PAY } from "./payStore";
import { applyPayment, checkPayment, type PayError } from "./payService";

/** Permission for /bus:pay (the settings screen has its own "bus:pay" menu permission). */
export const PAY_PERMISSION = "bus:pay_use";

const ERRORS: Record<PayError, string> = {
  disabled: "Payments are turned off.",
  min: "That is below the minimum payment.",
  max: "That is above the maximum payment.",
  daily: "That would go over your daily payment limit.",
  cooldown: "Please wait before paying again.",
  funds: "You don't have enough money.",
};

// /bus:pay <player> <amount>
// Rules and tax come from Settings > Pay. The target is a PlayerSelector run through filterVisible, so a
// vanished player is "not found" for non-staff. Sender feedback is the command's own (argument-free) reply;
// the receiver gets a chat message with the amounts.
defineBusCommand({
  name: "bus:pay",
  description: "bus.command.pay.description",
  mandatoryParameters: [
    { name: "player", type: CustomCommandParamType.PlayerSelector },
    { name: "amount", type: CustomCommandParamType.Integer },
  ],
  permission: { key: PAY_PERMISSION, label: t("bus.perm.pay.name"), defaultEveryone: true },
  run: (origin, targets: Player[], amount: number) => {
    const sender = origin.sourceEntity;
    if (!(sender instanceof Player))
      return reply(origin, CustomCommandStatus.Failure, "bus.command.players_only", "Players only.");

    const found = filterVisible(sender, targets ?? []).filter((p) => p.isValid);
    if (found.length === 0)
      return reply(origin, CustomCommandStatus.Failure, "bus.command.pay.not_found", "No matching player is online.");
    if (found.length > 1)
      return reply(origin, CustomCommandStatus.Failure, "bus.command.pay.one_player", "Pick exactly one player.");
    const receiver = found[0];
    if (receiver.id === sender.id)
      return reply(origin, CustomCommandStatus.Failure, "bus.command.pay.self", "You can't pay yourself.");
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_PAY)
      return reply(origin, CustomCommandStatus.Failure, "bus.command.pay.err.min", ERRORS.min);

    const err = checkPayment(sender, amount);
    if (err) return reply(origin, CustomCommandStatus.Failure, `bus.command.pay.err.${err}`, ERRORS[err]);

    // Scores change here, so it has to wait until the callback is over; the rules are checked again then.
    system.run(() => {
      if (!sender.isValid || !receiver.isValid) return;
      const result = applyPayment(sender, receiver, amount);
      if (typeof result === "string") {
        tell(sender, t(`bus.command.pay.err.${result}`));
        return;
      }
      // A vanished sender stays anonymous to players who can't see them.
      const from = isHiddenFrom(receiver, sender) ? t("bus.pay.someone") : raw(getVisibleName(receiver, sender));
      tell(receiver, t("bus.pay.received", String(result.received), getShop().currencyName, from));
    });
    return reply(origin, CustomCommandStatus.Success, "bus.command.pay.sent", "Payment sent.");
  },
});
