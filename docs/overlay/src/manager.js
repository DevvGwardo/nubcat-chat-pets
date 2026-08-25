import * as THREE from "three";
import { Cat } from "./cat.js";
import { Points } from "./points.js";
import { GameDirector } from "./games.js";

const LOVE_RE =
  /<3|\bty\b|thank|\bily\b|good bot|love|❤|🩷|🧡|💛|💚|💙|🩵|💜|🖤|🤍|🤎|💖|💗|💓|💞|💕|💘|💝/i;

function makeHeartTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.translate(32, 30);
  g.scale(1.15, 1.15);
  g.fillStyle = "#ff4d6d";
  g.strokeStyle = "rgba(60,0,20,0.85)";
  g.lineWidth = 4;
  g.beginPath();
  // classic two-arc heart
  g.moveTo(0, 12);
  g.bezierCurveTo(-22, -6, -12, -24, 0, -10);
  g.bezierCurveTo(12, -24, 22, -6, 0, 12);
  g.closePath();
  g.fill();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class PetManager {
  constructor({ scene, overlayEl, config, projectToScreen }) {
    this.scene = scene;
    this.overlayEl = overlayEl;
    this.config = config;
    this.project = projectToScreen;
    this.cats = new Map(); // lowercased viewer name -> Cat
    this.bubbles = []; // { el, cat, until }
    this.hearts = [];
    this.heartTex = makeHeartTexture();
    this.celebrateUntil = 0;
    this.bounds = { minX: -8, maxX: 8, minZ: -3, maxZ: 4 };
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.points = config.games ? Points : null;
  }

  setBounds(b) {
    this.bounds = b;
    for (const cat of this.cats.values()) cat.setBounds(b);
  }

  stats() {
    return `${this.cats.size} pets`;
  }

  // --- spawning ---------------------------------------------------------
  ensureCat(user, color, now) {
    const key = user.toLowerCase();
    let cat = this.cats.get(key);
    if (cat) {
      cat.lastActive = now;
      return cat;
    }
    if (this.cats.size >= this.config.max) this.recycleOldest(now);
    // Random variant per cat — classic blue / naked / pink spawn mixed.
    const proto = this.protos
      ? this.protos[Math.floor(Math.random() * this.protos.length)]
      : this.proto;
    cat = new Cat(proto, user, color, this.bounds);
    cat.yawFlip = this.config.flip ? 1 : 0;
    // Enter from a random edge just off-screen, then wander in.
    const edge = Math.floor(Math.random() * 4);
    const b = this.bounds;
    if (edge === 0) cat.root.position.set(b.minX - 1, 0, THREE.MathUtils.randFloat(b.minZ, b.maxZ));
    else if (edge === 1) cat.root.position.set(b.maxX + 1, 0, THREE.MathUtils.randFloat(b.minZ, b.maxZ));
    else if (edge === 2) cat.root.position.set(THREE.MathUtils.randFloat(b.minX, b.maxX), 0, b.maxZ + 1);
    else cat.root.position.set(THREE.MathUtils.randFloat(b.minX, b.maxX), 0, b.minZ - 1);

    this.group.add(cat.root, cat.shadow, cat.label);
    this.cats.set(key, cat);
    return cat;
  }

  recycleOldest(now) {
    let oldest = null;
    for (const cat of this.cats.values()) {
      if (cat.jumpT >= 0) continue; // don't recycle mid-reaction
      if (cat.gameLock) continue; // games pause pet recycling
      if (!oldest || cat.lastActive < oldest.lastActive) oldest = cat;
    }
    if (!oldest) {
      for (const cat of this.cats.values()) {
        if (cat.gameLock) continue;
        if (!oldest || cat.lastActive < oldest.lastActive) oldest = cat;
      }
    }
    if (!oldest && this.cats.size) oldest = this.cats.values().next().value;
    if (oldest) this.removeCat(oldest);
  }

  removeCat(cat) {
    for (const [k, v] of this.cats) if (v === cat) this.cats.delete(k);
    this.group.remove(cat.root, cat.shadow, cat.label);
    cat.label.material.map.dispose();
    cat.label.material.dispose();
    cat.shadow.geometry.dispose();
    // Bubble attached to this cat dies with it.
    this.bubbles = this.bubbles.filter((bub) => {
      if (bub.cat === cat) {
        bub.el.remove();
        return false;
      }
      return true;
    });
  }

  // --- chat events --------------------------------------------------------
  handleMessage({ user, color, text, isFirst }, now) {
    if (!user || !text || !text.trim()) return;
    const cat = this.ensureCat(user, color, now);
    cat.react(now);
    if (this.config.bubbles) this.showBubble(cat, user, color, text, isFirst);
    if (LOVE_RE.test(text)) this.spawnHearts(cat, 5);
    // Points for chatting (games read these for duel odds).
    if (this.points) this.points.add(user, 1);
    // Route chat into the game director (commands, votes, boss damage).
    if (this.games) this.games.onChat(user, cat, text.trim(), LOVE_RE.test(text), now);
  }

  handleNotice({ kind, user }, now) {
    if (!this.config.celebrate) return;
    this.celebrateUntil = now + 3600;
    const label =
      kind === "raid" ? `🎉 ${user} is raiding with the nub cats!`
      : kind === "subgift" ? `🎁 ${user} gifted a sub!`
      : `⭐ ${user} subscribed!`;
    this.showAnnounce(label);
  }

  // --- speech bubbles ---------------------------------------------------
  showBubble(cat, user, color, text, isFirst) {
    // Replace any existing bubble for this cat.
    this.bubbles = this.bubbles.filter((bub) => {
      if (bub.cat !== cat) return true;
      bub.el.remove();
      return false;
    });

    const el = document.createElement("div");
    el.className = "bubble";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = (isFirst ? "✨ first time! " : "") + user;
    who.style.color = /^#/.test(color) ? color : "#7b5cff";
    el.appendChild(who);
    el.appendChild(document.createTextNode(text.slice(0, 140)));

    // Hard cap so a spammy chat can't flood the overlay.
    while (this.bubbles.length >= 14) {
      this.bubbles.shift().el.remove();
    }

    this.overlayEl.appendChild(el);
    this.bubbles.push({ el, cat, until: performance.now() + this.config.bubbleSec * 1000 });
  }

  showAnnounce(text) {
    const old = this.overlayEl.querySelector(".bubble.center");
    if (old) old.remove();
    const el = document.createElement("div");
    el.className = "bubble center";
    el.style.cssText =
      "left:50%; top:8%; transform:translate(-50%,0); font-size:22px; padding:10px 18px;";
    el.textContent = text;
    this.overlayEl.appendChild(el);
    setTimeout(() => el.classList.add("fade"), 3200);
    setTimeout(() => el.remove(), 3800);
  }

  updateBubbles(now) {
    this._v3 = this._v3 || new THREE.Vector3();
    this.bubbles = this.bubbles.filter((bub) => {
      if (now > bub.until || !this.cats.has(bubKey(bub.cat))) {
        bub.el.remove();
        return false;
      }
      bub.cat.headWorldPos(this._v3);
      this._v3.y += 0.55;
      const p = this.project(this._v3);
      if (p.behind) {
        bub.el.style.display = "none";
        return true;
      }
      bub.el.style.display = "";
      bub.el.style.left = `${THREE.MathUtils.clamp(p.x, 150, window.innerWidth - 150)}px`;
      bub.el.style.top = `${p.y - 8}px`;
      return true;
    });
  }

  // --- vibe reactions (hearts) -------------------------------------------
  spawnHearts(cat, n) {
    for (let i = 0; i < n; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.heartTex,
          transparent: true,
          depthWrite: false,
        })
      );
      const s = 0.28 + Math.random() * 0.14;
      sprite.scale.set(s, s, 1);
      const p = cat.root.position;
      sprite.position.set(
        p.x + THREE.MathUtils.randFloatSpread(0.7),
        cat.topY() * 0.8,
        p.z + THREE.MathUtils.randFloatSpread(0.4)
      );
      sprite.userData = {
        vy: 1.1 + Math.random() * 0.8,
        vx: THREE.MathUtils.randFloatSpread(0.35),
        life: 0,
        maxLife: 1.4 + Math.random() * 0.6,
      };
      this.scene.add(sprite);
      this.hearts.push(sprite);
    }
  }

  updateHearts(dt) {
    this.hearts = this.hearts.filter((h) => {
      const u = h.userData;
      u.life += dt;
      if (u.life > u.maxLife) {
        h.material.dispose();
        this.scene.remove(h);
        return false;
      }
      h.position.x += u.vx * dt;
      h.position.y += u.vy * dt;
      h.material.opacity = 1 - u.life / u.maxLife;
      return true;
    });
  }

  // --- per-frame ----------------------------------------------------------
  update(dt, now) {
    const celebrating = now < this.celebrateUntil;
    const speedMul = this.config.speed;

    for (const cat of this.cats.values()) {
      cat.update(dt * speedMul, now, celebrating);
    }

    // Gentle separation so cats don't stack into one blob.
    const arr = [...this.cats.values()];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i].root.position;
        const b = arr[j].root.position;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        const minD = 0.85;
        if (d2 > minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = ((minD - d) / d) * 0.5 * Math.min(dt * 6, 1);
        a.x -= dx * push; a.z -= dz * push;
        b.x += dx * push; b.z += dz * push;
      }
    }

    // Despawn viewers who went quiet (Hermes keeps pets forever; an overlay
    // should cycle the crowd). Game-locked cats are safe.
    const ttlMs = this.config.ttlMin * 60000;
    for (const cat of [...this.cats.values()]) {
      if (!cat.gameLock && now - cat.lastActive > ttlMs) this.removeCat(cat);
    }

    if (this.games) this.games.update(dt, now);

    this.updateBubbles(now);
    this.updateHearts(dt);
  }
}

// Cats are keyed by lowercase name; map a Cat instance back to its key.
function bubKey(cat) {
  return cat.name.toLowerCase();
}
