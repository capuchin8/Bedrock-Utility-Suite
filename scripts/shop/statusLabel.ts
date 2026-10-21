import { ObservableBoolean, ObservableUIRawMessage, type UIRawMessage } from "@minecraft/server-ui";

/** An in-form message line that stays hidden until the first message is set (so no empty label is shown). */
export class StatusLabel {
    readonly message = new ObservableUIRawMessage({ text: "" });
    readonly visible = new ObservableBoolean(false);

    set(m: UIRawMessage): void {
        this.message.setData(m);
        this.visible.setData(true);
    }
}
