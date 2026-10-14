import { system, world } from "@minecraft/server";
import { getChatSend } from "./chatSupport";
import { getNickname } from "../nicknames/nicknameStore";
import { colorPrefix } from "./colors";
import { expandText, getDisplayName, getRoleLabel, getTopRole } from "./display";
import { getDisplaySettings } from "./displaySettings";

const chatSend = getChatSend();

if (!chatSend) {
  console.warn("[bus:roles] chatSend is unavailable (needs Beta APIs); chat formatting is disabled.");
} else {
  chatSend.subscribe((event) => {
    const s = getDisplaySettings();
    const sender = event.sender;

    const role = s.chatEnabled ? getRoleLabel(sender) : "";
    const hasNickname = s.nicknameInChat && !!getNickname(sender);
    // Nothing to add: don't touch the message at all.
    if (!role && !hasNickname) return;

    const top = s.chatEnabled ? getTopRole(sender) : undefined;
    const name = `${colorPrefix(top?.nameColor ?? "")}${getDisplayName(sender, "chat")}§r`;
    const message = `${colorPrefix(top?.chatColor ?? "")}${event.message}`;
    const rolePrefix = role ? `${role} ` : "";

    // One pass with a function replacer so "$&" etc. in messages stay literal.
    const text = expandText(s.chatFormat).replace(/\{(role|name|message)\}/g, (_m, token: string) =>
      token === "role" ? rolePrefix : token === "name" ? name : message
    );

    event.cancel = true;
    system.run(() => world.sendMessage(text)); // before-events are read-only
  });
}
