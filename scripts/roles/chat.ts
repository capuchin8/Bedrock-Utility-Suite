import { system, world } from "@minecraft/server";
import { onChat } from "../chat/chatPipeline";
import { getChatSend } from "./chatSupport";
import { formatChatLine } from "./chatFormat";

const chatSend = getChatSend();

if (!chatSend) {
    console.warn("[bus:roles] chatSend is unavailable (needs Beta APIs); chat formatting is disabled.");
} else {
    onChat(100, (event) => {
        const text = formatChatLine(event.sender, event.message);
        // Nothing to add: don't touch the message at all.
        if (text === undefined) return false;

        event.cancel = true;
        system.run(() => world.sendMessage(text)); // before-events are read-only
        return true;
    });
}
