// Simulated chat for testing without a real Twitch connection.
// Enable with ?mock=1

const NAMES = [
  "nubenjoyer", "sillygoose_", "catdad42", "pixel_paws", "TINYRAGE",
  "meowmixxx", "gwardofan", "lurkmode_on", "boba_addict", "zoomies",
  "cozy_streamer", "hype_raptor", "snaccident", "floof_watcher", "gg_nub",
];

const MESSAGES = [
  "hi chat", "this cat is SO CUTE", "i'm the blue one", "<3 <3 <3",
  "LOL it jumped", "good bot", "first time here, this rules",
  "can I get a paw up 🐾", "raid incoming??", "5Head overlay",
  "the little legs...", "thank you for the stream!", "W stream",
  "someone stop zoomies", "my cat does that too", "POG",
  "look at them all go", "ily little guys",
];

export class MockChat {
  constructor(handlers) {
    this.handlers = handlers;
    this.timers = [];
    this.colorPool = [
      "#ff6b6b", "#4ecdc4", "#ffe66d", "#7b5cff", "#2ec4b6",
      "#ff9f1c", "#e71d36", "#8ac926", "#1982c4", "#ff85a1",
    ];
  }

  start() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // Seed a small crowd quickly.
    for (let i = 0; i < 6; i++) {
      this.timers.push(setTimeout(() => {
        this.handlers.onMessage({
          user: pick(NAMES),
          color: pick(this.colorPool),
          text: pick(MESSAGES),
          isFirst: i === 0,
        });
      }, 600 + i * 700));
    }

    // Steady trickle of chat, occasionally with game commands so mock mode
    // exercises duels/races/bosses without a real chat.
    const tick = () => {
      let text = pick(MESSAGES);
      if (Math.random() < 0.06) {
        text = pick(["!race", "!boss", `!duel @${pick(NAMES)}`]);
      } else if (Math.random() < 0.15 && this.lastCommand) {
        text = this.lastCommand; // cheer for whoever dueled / damage the boss
      }
      this.handlers.onMessage({
        user: pick(NAMES),
        color: pick(this.colorPool),
        text,
        isFirst: Math.random() < 0.05,
      });
      this.timers.push(setTimeout(tick, 900 + Math.random() * 2200));
    };
    // Track the last command seen so mock chatters "respond" to it.
    const origOnMessage = this.handlers.onMessage;
    this.handlers.onMessage = (m) => {
      if (/^!/.test(m.text)) this.lastCommand = m.text;
      else if (this.lastCommand) this.lastCommand = null;
      origOnMessage(m);
    };
    this.timers.push(setTimeout(tick, 5200));

    // A raid so celebrations get exercised too.
    this.timers.push(setTimeout(() => {
      this.handlers.onNotice({ kind: "raid", user: "big_raid_leader" });
      for (let i = 0; i < 10; i++) {
        this.timers.push(setTimeout(() => {
          this.handlers.onMessage({
            user: `raider_${Math.floor(Math.random() * 100)}`,
            color: pick(this.colorPool),
            text: pick(["RAID!! 🎉", "hello from the raid", "nub nub nub", "<3"]),
            isFirst: Math.random() < 0.4,
          });
        }, 300 + i * 450));
      }
    }, 15000));
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
