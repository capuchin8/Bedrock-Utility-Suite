import { t, tell } from "../core/lang";
import { onScriptEvent, scriptEventPlayer } from "../events/scriptEvents";
import { getDisplaySettings, setDisplaySettings } from "./displaySettings";

// /scriptevent bus:hideNameTags          toggles hiding every player's name tag
// /scriptevent bus:hideNameTags true     hides them
// /scriptevent bus:hideNameTags false    shows them again
// Like the other script events, only staff (game director level, command blocks, functions) can send it.

const TRUE_WORDS = ["true", "on", "1"];
const FALSE_WORDS = ["false", "off", "0"];

onScriptEvent("bus:hideNameTags", (event) => {
  const player = scriptEventPlayer(event);
  const arg = event.message.trim().toLowerCase();

  let hide: boolean;
  if (arg === "") hide = !getDisplaySettings().hideNametags;
  else if (TRUE_WORDS.includes(arg)) hide = true;
  else if (FALSE_WORDS.includes(arg)) hide = false;
  else {
    if (player) tell(player, t("bus.nametags.invalid"));
    else console.warn(`[bus:hideNameTags] expected true, false or nothing, got "${event.message}"`);
    return;
  }

  setDisplaySettings({ hideNametags: hide });
  if (player) tell(player, t(hide ? "bus.nametags.now_hidden" : "bus.nametags.now_shown"));
});
