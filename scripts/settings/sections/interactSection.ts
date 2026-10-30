import type { Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableString, ObservableUIRawMessage } from "@minecraft/server-ui";
import { raw, t, tell } from "../../core/lang";
import { armPlayer } from "../../interact/interactBlocks";
import {
  MAX_BLOCK_COMMANDS,
  describeKey,
  getBlock,
  listBlocks,
  removeBlock,
  saveBlock,
  type BlockAction,
} from "../../interact/interactStore";
import { editLines } from "../codeEditor";
import { confirmButton } from "../confirmButton";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:interactive_blocks";
const WRITABLE = { clientWritable: true } as const;

// Linked blocks run commands with the game's command powers, so this screen is owner-only.
registerSettingsSection({
  id: KEY,
  title: t("bus.section.interactive_blocks.title"),
  description: t("bus.section.interactive_blocks.desc"),
  order: 60,
  ownerOnly: true,
  open: (player, back) => home(player, back),
});

interface Draft {
  rules: boolean;
  commands: string[];
  /** Set while editing an existing link (its block key and block type). */
  editKey?: string;
  editType?: string;
}

// The setup form is rebuilt when a command row is added or removed, so the draft lives here.
const drafts = new Map<string, Draft>();
const draftOf = (player: Player): Draft => {
  let d = drafts.get(player.id);
  if (!d) drafts.set(player.id, (d = { rules: true, commands: [] }));
  return d;
};

const short = (id: string): string => id.replace(/^minecraft:/, "");

function home(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.section.interactive_blocks.title")));
    form.label(t("bus.interact.intro"));
    form.button(
      t("bus.interact.add"),
      guard.click(() => {
        drafts.set(player.id, { rules: true, commands: [] });
        form.close();
        setup(player, () => home(player, back));
      })
    );
    form.button(
      t("bus.interact.manage", listBlocks().length),
      guard.click(() => {
        form.close();
        list(player, () => home(player, back));
      })
    );
    form.button(
      t("bus.interact.remove_click"),
      guard.click(() => {
        form.close();
        armPlayer(player, { mode: "remove" });
        tell(player, t("bus.interact.armed_remove"));
      })
    );
    form.divider().button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}

function setup(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  const reopen = (): void => setup(player, back);

  showForm(player, () => {
    const d = draftOf(player);
    const status = new ObservableUIRawMessage(raw(""));
    const form = guard.attach(new CustomForm(player, t("bus.interact.setup.title")));
    form.label(t(d.editKey ? "bus.interact.setup.editing" : "bus.interact.setup.intro"));

    const rules = new ObservableBoolean(d.rules, WRITABLE);
    guard.on(rules, (v: boolean) => {
      d.rules = v;
    });
    form.toggle(t("bus.interact.rules"), rules, { description: t("bus.interact.rules.desc") });

    form.label(t("bus.interact.commands.help"));
    if (d.commands.length === 0) form.label(t("bus.events.none"));
    d.commands.forEach((command, i) => {
      const field = new ObservableString(command, WRITABLE);
      guard.on(field, (v: string) => {
        d.commands[i] = v;
      });
      form.textField(t("bus.events.command_n", i + 1), field);
      form.button(
        t("bus.events.remove_n", i + 1),
        guard.click(() => {
          d.commands.splice(i, 1);
          form.close();
          reopen();
        })
      );
    });
    // Large editor: one command per line.
    form.button(
      t("bus.editor.open"),
      guard.click(() => {
        form.close();
        editLines(player, {
          title: t("bus.interact.setup.title"),
          lines: d.commands.map((c) => c.trim()).filter((c) => c),
          maxLines: MAX_BLOCK_COMMANDS,
          maxLength: 256,
          onDone: (lines) => {
            if (!createGuard(player, KEY).check()) return;
            if (lines) d.commands = lines;
            reopen();
          },
        });
      })
    );
    if (d.commands.length < MAX_BLOCK_COMMANDS) {
      form.button(
        t("bus.events.add"),
        guard.click(() => {
          d.commands.push("");
          form.close();
          reopen();
        })
      );
    }

    form.divider().label(status);
    form.button(
      t(d.editKey ? "bus.interact.save" : "bus.interact.pick"),
      guard.click(() => {
        const action = { rules: d.rules, commands: d.commands.map((c) => c.trim()).filter((c) => c) };
        if (!action.rules && action.commands.length === 0) {
          status.setData(t("bus.interact.error.empty"));
          return;
        }
        if (d.editKey) {
          if (!saveBlock(d.editKey, { ...action, type: d.editType ?? "" })) {
            status.setData(t("bus.interact.error.full"));
            return;
          }
          drafts.delete(player.id);
          form.close();
          back();
          return;
        }
        form.close();
        armPlayer(player, { mode: "bind", action });
        drafts.delete(player.id);
        tell(player, t("bus.interact.armed_bind"));
      })
    );
    form.button(t("bus.common.cancel"), () => {
      drafts.delete(player.id);
      form.close();
      back();
    });
    return form;
  });
}

function list(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.interact.manage.title")));
    const blocks = listBlocks();
    form.label(t(blocks.length ? "bus.interact.pick_block" : "bus.interact.none"));
    for (const [key, action] of blocks) {
      const at = describeKey(key);
      form.button(
        t("bus.interact.item", short(action.type), at.x, at.y, at.z, short(at.dimension)),
        guard.click(() => {
          form.close();
          detail(player, key, () => list(player, back));
        })
      );
    }
    form.divider().button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}

function detail(player: Player, key: string, back: () => void): void {
  const action: BlockAction | undefined = getBlock(key);
  if (!action) return back();
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  const at = describeKey(key);

  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.interact.detail.title")));
    form.label(t("bus.interact.item", short(action.type), at.x, at.y, at.z, short(at.dimension)));
    form.label(t(action.rules ? "bus.interact.detail.rules_yes" : "bus.interact.detail.rules_no"));
    if (action.commands.length > 0) {
      form.label(t("bus.interact.detail.commands"));
      for (const c of action.commands) form.label(raw(`/${c.replace(/^\//, "")}`));
    }
    form.divider();
    form.button(
      t("bus.interact.edit"),
      guard.click(() => {
        drafts.set(player.id, {
          rules: action.rules,
          commands: [...action.commands],
          editKey: key,
          editType: action.type,
        });
        form.close();
        setup(player, () => detail(player, key, back));
      })
    );
    confirmButton(
      form,
      t("bus.interact.remove"),
      guard.click(() => {
        removeBlock(key);
        form.close();
        back();
      })
    );
    form.button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}
