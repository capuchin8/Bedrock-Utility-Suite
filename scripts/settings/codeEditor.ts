import type { Player } from "@minecraft/server";
import { ModalFormData, type UIRawMessage } from "@minecraft/server-ui";
import { t } from "../core/lang";
import { showModal } from "./openForm";

/**
 * Marker placed in the form title. It's made only of formatting codes, so it renders as
 * nothing in a normal client. A resource pack's JSON UI can match this exact string to
 * enlarge the form into a full-size code editor (see RP/ui/server_form.json). Keep them in sync.
 */
export const CODE_EDITOR_TAG = "§b§u§s§e§d§i§t§r";

/**
 * Same idea for the export screen: the JSON UI hides the Submit button on forms with this tag, since
 * there is nothing to submit when you are only copying a code. Close it with the X / Escape.
 */
export const CODE_VIEWER_TAG = "§b§u§s§v§i§e§w§r";

/** Splits editor text into lines: one entry per non-empty line, trimmed and capped. */
export function splitLines(text: string, maxLines: number, maxLength: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, maxLines)
    .map((line) => line.slice(0, maxLength));
}

export interface LineEditorOptions {
  title: UIRawMessage;
  /** Current entries; shown one per line. */
  lines: string[];
  maxLines: number;
  maxLength: number;
  /** Receives the new list, or undefined if the editor was cancelled. */
  onDone: (lines: string[] | undefined) => void;
}

/**
 * Opens the full-size text editor with one entry per line (used for command lists: a new line is a
 * new command). Whether the box accepts several lines depends on the resource pack's JSON UI
 * (see RP/ui/server_form.json); with a single-line box the whole text is one entry.
 * Must not be called from restricted-execution mode.
 */
export function editLines(player: Player, options: LineEditorOptions): void {
  showModal(
    player,
    () =>
      new ModalFormData()
        .title({ rawtext: [{ text: CODE_EDITOR_TAG }, options.title] })
        .textField(t("bus.editor.commands_label"), t("bus.editor.commands_placeholder"), {
          defaultValue: options.lines.join("\n"),
        }),
    (response) => {
      if (response.canceled || !response.formValues) return options.onDone(undefined);
      options.onDone(splitLines(String(response.formValues[0] ?? ""), options.maxLines, options.maxLength));
    }
  );
}
