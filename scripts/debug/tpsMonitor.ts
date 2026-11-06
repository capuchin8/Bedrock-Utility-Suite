import { system, world, type Player } from "@minecraft/server";

// DEBUG-ONLY TPS / MSPT readout on the action bar, switched on and off per player from the Debug screen.
// All of the logic is inside the `dev:` label, so production builds (dropLabels: ["dev"]) contain none of it:
// only the two no-op stubs below remain, and nothing in a production build calls them. Nothing runs
// at load: the interval only exists while at least one player has the monitor switched on.
// Not translated on purpose (debug text is the one exception to the translation rule).

/** Turn the readout on or off for one player. No-op in production builds. */
export let setTpsMonitor: (player: Player, enabled: boolean) => void = () => {};
/** Is the readout on for this player? Always false in production builds. */
export let isTpsMonitorOn: (player: Player) => boolean = () => false;

dev: {
  const DURATION_SECONDS = 4; // window for the avg / min / max lines
  const DEFAULT_MAX_LENGTH = 44; // minimum width used to centre the lines

  const viewers = new Set<string>();
  let timer: number | undefined;

  let msHistory: number[] = [];
  let lastTime = Date.now();
  let altMS = { num: 0, string: "" };
  let altTPS = "0";
  let redstoneMS = { num: 0, string: "" };
  let redstoneTPS = "0";

  function doFormat(num: number, def: number, lowerIsBetter = true): string {
    const string = num.toFixed(2).toString();
    let prefix = "§f";
    if ((lowerIsBetter && num > def) || (!lowerIsBetter && num < def)) {
      prefix = "§c";
    } else if ((lowerIsBetter && num < def) || (!lowerIsBetter && num > def)) {
      prefix = "§a";
    }
    return prefix + string + "§r";
  }

  function msToTps(ms: number): number {
    return 1 / (ms / 1000);
  }

  function millisecondsPerTick(start: number, end: number): { num: number; string: string } {
    const ms = end - start;
    return { num: ms, string: doFormat(ms, 50, true) };
  }

  function ticksPerSecond(ms: number): string {
    return doFormat(msToTps(ms), 20, false);
  }

  function msOverTime(ms: number) {
    msHistory.push(ms);
    while (msHistory.length > DURATION_SECONDS * 20) {
      msHistory.shift();
    }

    let total = 0;
    for (const time of msHistory) total += time;
    const avg = total / msHistory.length;
    const min = Math.min(...msHistory);
    const max = Math.max(...msHistory);

    return {
      ms: { avg: doFormat(avg, 50, true), min: doFormat(min, 50, true), max: doFormat(max, 50, true) },
      tps: {
        avg: doFormat(msToTps(avg), 20, false),
        min: doFormat(msToTps(min), 20, false),
        max: doFormat(msToTps(max), 20, false),
      },
    };
  }

  function ticker(): void {
    const thisTime = Date.now();
    const ms = millisecondsPerTick(lastTime, thisTime);
    const avg = msOverTime(ms.num);
    const tps = ticksPerSecond(ms.num);

    if (system.currentTick % 2 == 0) {
      altMS = ms;
      altTPS = tps;
    } else {
      redstoneMS = ms;
      redstoneTPS = tps;
    }

    if (system.currentTick % 5 == 0) {
      // Drop viewers who left; stop entirely when nobody is watching.
      const online = world.getAllPlayers().filter((p) => viewers.has(p.id));
      for (const id of [...viewers]) {
        if (!online.some((p) => p.id === id)) viewers.delete(id);
      }
      if (online.length === 0) {
        stop();
        return;
      }

      const lines: string[] = [];
      lines.push(`§d- Odd Ticks -§r`);
      lines.push(`${redstoneTPS} §7ticks/second§r ${redstoneMS.string} §7ms/tick§r`);
      lines.push(`§e- Even Ticks -§r`);
      lines.push(`${altTPS} §7ticks/second§r ${altMS.string} §7ms/tick§r`);
      lines.push(`§b- t/s over last ${DURATION_SECONDS} seconds -§r`);
      lines.push(`§7avg:§r ${avg.tps.avg} §7min:§r ${avg.tps.min} §7max:§r ${avg.tps.max}`);
      lines.push(`§b- ms/t over last ${DURATION_SECONDS} seconds -§r`);
      lines.push(`§7avg:§r ${avg.ms.avg} §7min:§r ${avg.ms.min} §7max:§r ${avg.ms.max}`);

      const regEx = /§([a-z0-9])/g;
      const lengths = lines.map((line) => line.replace(regEx, "").length);
      const maxLength = Math.max(DEFAULT_MAX_LENGTH, ...lengths);

      for (let l = 0; l < lines.length; l++) {
        if (lengths[l] < maxLength) {
          const diff = Math.floor((maxLength - lengths[l]) / 2);
          for (let i = 0; i < diff; i++) {
            lines[l] = " " + lines[l] + " ";
          }
        }
        lines[l] = "| " + lines[l];
      }

      const text = lines.join("\n");
      for (const player of online) player.onScreenDisplay.setActionBar(text);
    }
    lastTime = thisTime;
  }

  function start(): void {
    if (timer !== undefined) return;
    // Fresh numbers: don't let the time since the last run count as one huge tick.
    msHistory = [];
    lastTime = Date.now();
    timer = system.runInterval(ticker, 1);
  }

  function stop(): void {
    if (timer !== undefined) system.clearRun(timer);
    timer = undefined;
  }

  setTpsMonitor = (player, enabled) => {
    if (enabled) {
      viewers.add(player.id);
      start();
      return;
    }
    viewers.delete(player.id);
    if (viewers.size === 0) stop();
    try {
      player.onScreenDisplay.setActionBar(""); // clear what is still showing
    } catch {
      // player left
    }
  };

  isTpsMonitorOn = (player) => viewers.has(player.id);
}
