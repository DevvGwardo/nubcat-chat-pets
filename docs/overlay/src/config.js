// URL-param configuration. Everything is optional except `channel`
// (mock mode works without one).
const params = new URLSearchParams(location.search);

const bool = (name, dflt) => {
  const v = params.get(name);
  if (v === null) return dflt;
  return v !== "0" && v.toLowerCase() !== "false" && v !== "";
};

export const config = {
  // Twitch channel to read chat from (no # prefix). Required unless mock=1.
  channel: (params.get("channel") || "").replace(/^#/, "").toLowerCase(),
  // Simulated chat for testing / previews.
  mock: bool("mock", false),
  // Max concurrent pets; oldest idle pet is recycled beyond this.
  max: Math.max(1, parseInt(params.get("max") || "40", 10)),
  // Minutes of silence before a viewer's pet despawns.
  ttlMin: Math.max(0.5, parseFloat(params.get("ttl") || "10")),
  // Global size multiplier for the cats.
  scale: Math.min(3, Math.max(0.2, parseFloat(params.get("scale") || "1"))),
  // Global speed multiplier for walking.
  speed: Math.min(3, Math.max(0.2, parseFloat(params.get("speed") || "1"))),
  // Show speech bubbles with message text.
  bubbles: bool("bubbles", true),
  // Seconds a speech bubble stays up.
  bubbleSec: Math.max(1, parseFloat(params.get("bubbleSec") || "4.5")),
  // Mass-jump celebrations on subs/raids.
  celebrate: bool("celebrate", true),
  // Flip the model 180° if it faces away from its walking direction on your setup.
  flip: bool("flip", false),
  // Checkerboard background + stats HUD for tuning outside OBS.
  debug: bool("debug", false),

  // --- mini games ----------------------------------------------------------
  // Master switch for all games (duels, races, boss, simon says, points).
  games: bool("games", true),
  // Seconds between the end of one game and simon says being eligible again.
  simonEverySec: Math.max(30, parseFloat(params.get("simonEvery") || "120")),
  // Simon says can't fire before this many seconds after load.
  simonFirstSec: Math.max(10, parseFloat(params.get("simonFirst") || "45")),
  // How long cats have to comply with a simon command.
  simonWindowSec: Math.max(3, parseFloat(params.get("simonWindow") || "6")),
  // Duel cooldown / winner crown duration.
  duelCooldownSec: Math.max(15, parseFloat(params.get("duelCooldown") || "90")),
  crownSec: Math.max(20, parseFloat(params.get("crownSec") || "300")),
  // Race cooldown / join window.
  raceCooldownSec: Math.max(30, parseFloat(params.get("raceCooldown") || "180")),
  raceJoinSec: Math.max(5, parseFloat(params.get("raceJoin") || "12")),
  // Boss cooldown, HP pool, damage window, and winner-aura duration.
  bossCooldownSec: Math.max(60, parseFloat(params.get("bossCooldown") || "420")),
  bossHp: Math.max(50, parseInt(params.get("bossHp") || "250", 10)),
  bossMaxSec: Math.max(30, parseFloat(params.get("bossMax") || "90")),
  auraSec: Math.max(30, parseFloat(params.get("auraSec") || "300")),
};
