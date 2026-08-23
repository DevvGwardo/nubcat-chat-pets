// Anonymous Twitch chat reader.
//
// Uses the public IRC gateway over WebSocket with a `justinfan` nick:
// read-only, no OAuth, no account. Enough for an overlay: PRIVMSG for
// messages (with tags -> display-name + chat color) and USERNOTICE for
// subs/resubs/raids.

const IRC_URL = "wss://irc-ws.chat.twitch.tv:443";

function unescapeTag(v) {
  if (!v) return "";
  return v
    .replace(/\\s/g, " ")
    .replace(/\\:/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/\\r|\\n/g, "");
}

function parseTags(raw) {
  const tags = {};
  if (!raw) return tags;
  for (const part of raw.replace(/^@/, "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    tags[part.slice(0, eq)] = unescapeTag(part.slice(eq + 1));
  }
  return tags;
}

function parseLine(line) {
  let rest = line;
  let tags = {};
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    tags = parseTags(rest.slice(0, sp));
    rest = rest.slice(sp + 1);
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const sp2 = rest.indexOf(" ");
  const command = sp2 === -1 ? rest : rest.slice(0, sp2);
  const paramsRaw = sp2 === -1 ? "" : rest.slice(sp2 + 1);
  const params = [];
  let trailing = "";
  const colon = paramsRaw.indexOf(" :");
  if (colon !== -1) {
    params.push(...paramsRaw.slice(0, colon).split(" ").filter(Boolean));
    trailing = paramsRaw.slice(colon + 2);
  } else {
    params.push(...paramsRaw.split(" ").filter(Boolean));
  }
  return { tags, prefix, command, params, trailing };
}

// Deterministic fallback color so unlabeled chatters still get a stable hue.
function hashHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export class TwitchChat {
  // handlers: { onMessage({user,color,text,isFirst}), onNotice({kind,user}) , onStatus(s)}
  constructor(channel, handlers) {
    this.channel = channel;
    this.handlers = handlers;
    this.ws = null;
    this.backoff = 1000;
    this.closed = false;
  }

  connect() {
    if (this.closed) return;
    this.handlers.onStatus?.(`connecting to #${this.channel}…`);
    const ws = new WebSocket(IRC_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      ws.send("CAP REQ :twitch.tv/tags");
      ws.send("PASS SCHMOOPIIE"); // accepted placeholder for anonymous read-only
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${this.channel}`);
      this.handlers.onStatus?.(`connected — watching #${this.channel}`);
    };

    ws.onmessage = (ev) => {
      for (const line of String(ev.data).split("\r\n")) {
        if (line) this.handleLine(line);
      }
    };

    ws.onclose = () => {
      if (this.closed) return;
      this.handlers.onStatus?.("disconnected — retrying…");
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30000);
    };

    ws.onerror = () => ws.close();
  }

  handleLine(line) {
    if (line.startsWith("PING")) {
      this.ws.send("PONG :tmi.twitch.tv");
      return;
    }
    const msg = parseLine(line);
    switch (msg.command) {
      case "PRIVMSG": {
        const nick =
          msg.prefix.split("!")[0] || msg.params[0]?.slice(1) || "viewer";
        const user = msg.tags["display-name"] || nick;
        const color = msg.tags["color"] || `hsl(${hashHue(nick)}, 85%, 72%)`;
        const badges = msg.tags["badges"] || "";
        this.handlers.onMessage({
          user,
          color,
          text: msg.trailing,
          isFirst: badges.includes("first-msg"),
        });
        break;
      }
      case "USERNOTICE": {
        const kind = msg.tags["msg-id"];
        const user = msg.tags["display-name"] || msg.tags["login"] || "someone";
        if (["sub", "resub", "subgift", "submysterygift", "raid"].includes(kind)) {
          this.handlers.onNotice({ kind, user });
        }
        break;
      }
      case "RECONNECT":
        this.ws.close();
        break;
    }
  }
}
