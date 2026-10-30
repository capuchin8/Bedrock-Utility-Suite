import { system } from "@minecraft/server";
import { onScriptEvent, scriptEventPlayer } from "../events/scriptEvents";
import { showRules } from "./rulesPrompt";
import { mustAcceptRules } from "./rulesStore";

// /scriptevent bus:rules            -> shows the rules (read-only, Close button) to whoever ran it
// /scriptevent bus:rules accept     -> shows the accept-the-rules screen, but only if they still have to accept
// To show it to other players: /execute as @a[tag=...] run scriptevent bus:rules
onScriptEvent("bus:rules", (event) => {
  const player = scriptEventPlayer(event);
  if (!player) return;
  const mode = event.message.trim().toLowerCase();
  // Showing a form: defer to be safe.
  system.run(() => {
    if (!player.isValid) return;
    if (mode === "accept") {
      if (mustAcceptRules(player)) showRules(player);
    } else {
      showRules(player, { readOnly: true });
    }
  });
});
