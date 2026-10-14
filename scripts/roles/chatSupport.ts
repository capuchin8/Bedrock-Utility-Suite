import { world, type Player } from "@minecraft/server";

// world.beforeEvents.chatSend is pre-release. It is reached through a local type so the add-on
// still loads when Beta APIs are off, and so the settings screens can grey out chat options.
export interface ChatEvent {
    sender: Player;
    message: string;
    cancel: boolean;
}
export interface ChatSignal {
    subscribe(callback: (event: ChatEvent) => void): unknown;
}

export function getChatSend(): ChatSignal | undefined {
    try {
        return (world.beforeEvents as unknown as { chatSend?: ChatSignal }).chatSend;
    } catch {
        return undefined;
    }
}

/** false when Beta APIs are off: chat formatting and nicknames in chat can't work. */
export function isChatSupported(): boolean {
    return getChatSend() !== undefined;
}
