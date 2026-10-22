import { StatusLabel } from "./statusLabel";
import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableNumber, ObservableUIRawMessage, type UIRawMessage } from "@minecraft/server-ui";
import { t } from "../core/lang";
import { showForm } from "../settings/openForm";

export interface PurchaseResult {
    ok: boolean;
    /** Shown in the form (chat and the HUD are hidden while a form is open). */
    message: UIRawMessage;
    /** Currency moved by this confirm (spent when buying, earned when selling). Only counted when ok. */
    amount?: number;
}

export interface QuantityFormOptions {
    title: UIRawMessage;
    /** Label for the running total, e.g. "bus.shop.total_cost" (args: total, currency). */
    /** Optional text shown above the total (e.g. a kit's contents). */
    details?: UIRawMessage;
    totalKey: string;
    /** Used instead of totalKey when unitAmount > 1 (args: items, total, currency). */
    totalUnitsKey?: string;
    /** Label for the session line, e.g. "bus.shop.session_bought" (args: quantity, amount, currency). */
    sessionKey: string;
    currency: string;
    unitPrice: number;
    /** Items per quantity step (bundle). Quantity is counted in bundles; 2 dirt for 1 coin at quantity 2 = 4 dirt for 2 coins. */
    unitAmount?: number;
    min: number;
    max: number;
    step?: number;
    /** quantity = bundles; multiply by unitAmount for items. */
    onConfirm: (quantity: number) => PurchaseResult;
    confirmKey: string;
    /** Optional second button that confirms a fixed quantity (e.g. "Sell all"). */
    extra?: { label: UIRawMessage; quantity: number };
    onBack: () => void;
}

export function openQuantityForm(player: Player, o: QuantityFormOptions): void {
    showForm(player, () => {
        const unit = o.unitAmount ?? 1;
        const fixed = o.max <= o.min;
        const totalMsg = (n: number): UIRawMessage =>
            unit > 1 && o.totalUnitsKey ? t(o.totalUnitsKey, n * unit, n * o.unitPrice, o.currency) : t(o.totalKey, n * o.unitPrice, o.currency);
        const qty = new ObservableNumber(o.min, { clientWritable: true });
        const total = new ObservableUIRawMessage(totalMsg(o.min));
        const status = new StatusLabel();

        let confirms = 0;
        let sessionQty = 0;
        let sessionAmount = 0;

        const confirm = (quantity: number): void => {
            system.run(() => {
                if (!player.isValid) return;
                let result: PurchaseResult;
                try {
                    result = o.onConfirm(quantity);
                } catch (e) {
                    console.warn(`[bus:shop] confirm failed: ${e}`);
                    result = { ok: false, message: t("bus.shop.error.generic") };
                }
                confirms++;
                if (result.ok) {
                    sessionQty += quantity * unit;
                    sessionAmount += result.amount ?? 0;
                }
                // The session total only appears from the second click onwards.
                status.set(
                    confirms >= 2 && sessionQty > 0
                        ? { rawtext: [result.message, { text: "\n" }, t(o.sessionKey, sessionQty, sessionAmount, o.currency)] }
                        : result.message
                );
            });
        };

        if (!fixed) {
            qty.subscribe((v: number) => {
                const n = Math.max(o.min, Math.min(o.max, Math.round(v)));
                total.setData(totalMsg(n));
            });
        }

        const form = new CustomForm(player, o.title);
        if (o.details) form.label(o.details).spacer();
        form.label(total).spacer().spacer();
        if (!fixed) form.slider(unit > 1 ? t("bus.shop.quantity_bundles", unit) : t("bus.shop.quantity"), qty, o.min, o.max, { step: o.step ?? 1 }).spacer().spacer();
        form.button(t(o.confirmKey), () => confirm(fixed ? o.min : Math.max(o.min, Math.min(o.max, Math.round(qty.getData())))));
        if (o.extra) {
            const q = o.extra.quantity;
            form.button(o.extra.label, () => {
                if (!fixed) qty.setData(q);
                confirm(q);
            });
        }
        form.spacer().label(status.message, { visible: status.visible }).spacer().button(t("bus.common.back"), () => {
            form.close();
            o.onBack();
        });
        return form.closeButton();
    });
}
