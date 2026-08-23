import * as THREE from "three";
import { FX } from "./fx.js";
import { Cat } from "./cat.js";
import { Points } from "./points.js";

// Chat-triggered mini games, Stream-Avatars style. One director owns all
// games so only one runs at a time and cooldowns are centralized.
//
// Games:
//   !duel @name  — two cats charge + collide, chat cheers tip the odds
//   !race / !join — hopping sprint across the screen
//   !boss        — giant evil cat, every message damages it
//   simon says   — periodic overlay-driven commands (no chat command needed)

const SIMON_COMMANDS = ["sit!", "hop!", "spin!"];

export class GameDirector {
  constructor({ scene, manager, config }) {
    this.scene = scene;
    this.mgr = manager;
    this.config = config;
    this.fx = new FX(scene);
    this.active = null; // { name, ...state }
    this.cooldowns = { duel: 0, race: 0, boss: 0 };
    this.simonNext = performance.now() + config.simonFirstSec * 1000;
    this.bossNext = performance.now() + config.bossFirstSec * 1000;
    this.bannerEl = null;
    this._v3 = new THREE.Vector3();
    this.stateText = "idle";
  }

  stats() {
    return this.stateText;
  }

  // --- helpers ------------------------------------------------------------
  banner(text, sec = 4) {
    if (!this.bannerEl) {
      this.bannerEl = document.createElement("div");
      this.bannerEl.className = "game-banner";
      this.mgr.overlayEl.appendChild(this.bannerEl);
    }
    this.bannerEl.textContent = text;
    this.bannerEl.style.display = "";
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      if (this.bannerEl) this.bannerEl.style.display = "none";
    }, sec * 1000);
  }

  freeCats(excludeKeys = []) {
    const out = [];
    for (const [key, cat] of this.mgr.cats) {
      if (!cat.gameLock && !excludeKeys.includes(key)) out.push([key, cat]);
    }
    return out;
  }

  centerPos(cat) {
    return cat.root.position.clone();
  }

  // --- chat entry point -----------------------------------------------------
  onChat(user, cat, text, isLove, now) {
    const lower = text.toLowerCase();

    // Boss damage: every message hits the boss while a fight is live.
    if (this.active?.name === "boss") {
      this.damageBoss(user, cat, isLove);
      // commands still work during boss so !race can't stack anyway (busy)
      return;
    }

    // Cheer-to-tip during duel vote window.
    if (this.active?.name === "duel" && this.active.phase === "vote") {
      const k = user.toLowerCase();
      if (k === this.active.aKey || lower.includes(this.active.aName.toLowerCase()))
        this.active.votesA++;
      else if (k === this.active.bKey || lower.includes(this.active.bName.toLowerCase()))
        this.active.votesB++;
      return;
    }

    // Race join.
    if (this.active?.name === "race" && this.active.phase === "join" && lower === "!join") {
      if (!this.active.runners.some(([key]) => key === user.toLowerCase())) {
        const cat2 = this.mgr.cats.get(user.toLowerCase()) || cat;
        this.active.runners.push([user.toLowerCase(), cat2]);
        cat2.gameLock = true;
        // Slot into a lane.
        const r = this.active;
        const i = r.runners.length - 1;
        cat2.root.position.set(this.mgr.bounds.minX + 0.6, 0, r.laneZ(i, Math.max(r.runners.length, 8)));
        cat2.faceDirection(1, 0, 1, 99);
        this.banner(`race! ${r.runners.length} runners — !join (${Math.ceil((r.joinUntil - now) / 1000)}s)`);
      }
      return;
    }

    if (!lower.startsWith("!")) return;

    const [cmd, arg] = lower.split(/\s+/, 2);

    if (cmd === "!duel" && now >= this.cooldowns.duel && !this.active) {
      this.startDuel(user, cat, arg, now);
    } else if (cmd === "!race" && now >= this.cooldowns.race && !this.active) {
      this.startRace(now);
    } else if (cmd === "!boss" && now >= this.cooldowns.boss && !this.active) {
      this.startBoss(now);
    }
  }

  // =====================================================================
  // DUEL
  // =====================================================================
  startDuel(challengerUser, challengerCat, targetArg, now) {
    let aKey = challengerUser.toLowerCase();
    let bEntry = null;

    if (targetArg) {
      const tKey = targetArg.replace(/^@/, "").toLowerCase();
      bEntry = (tKey !== aKey && this.mgr.cats.get(tKey))
        ? [tKey, this.mgr.cats.get(tKey)]
        : null;
    }
    if (!bEntry) {
      const pool = this.freeCats([aKey]);
      if (!pool.length) return;
      bEntry = pool[Math.floor(Math.random() * pool.length)];
    }
    const [bKey, bCat] = bEntry;
    const aCat = this.mgr.cats.get(aKey) || challengerCat;

    this.cooldowns.duel = now + this.config.duelCooldownSec * 1000;
    this.active = {
      name: "duel",
      phase: "vote",
      aKey, bKey,
      aName: aCat.name, bName: bCat.name,
      aCat, bCat,
      votesA: 0, votesB: 0,
      voteUntil: now + 8000,
    };
    aCat.gameLock = true;
    bCat.gameLock = true;
    // Face each other, back off to charge distance.
    const pa = aCat.root.position, pb = bCat.root.position;
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    const dir = pb.clone().sub(pa).setY(0).normalize();
    if (!isFinite(dir.x) || dir.lengthSq() < 0.01) dir.set(1, 0, 0);
    aCat.root.position.copy(mid.clone().addScaledVector(dir, -2.2));
    bCat.root.position.copy(mid.clone().addScaledVector(dir, 2.2));
    aCat.faceDirection(dir.x, dir.z, 1, 99);
    bCat.faceDirection(-dir.x, -dir.z, 1, 99);
    this.chargeDir = dir;
    this.chargeMid = mid;

    this.stateText = `duel: ${aCat.name} vs ${bCat.name} — cheer!`;
    this.banner(`⚔️ ${aCat.name} vs ${bCat.name}! Type their name to cheer!`);
  }

  updateDuel(dt, now) {
    const d = this.active;
    if (d.phase === "vote") {
      this.stateText = `duel vote — ${d.aName}: ${d.votesA} · ${d.bName}: ${d.votesB}`;
      if (now >= d.voteUntil) {
        d.phase = "charge";
        d.t = 0;
      }
      return;
    }
    if (d.phase === "charge") {
      d.t += dt;
      const speed = 6.5;
      const pa = d.aCat.root.position, pb = d.bCat.root.position;
      const toB = this.chargeMid.clone().sub(pa).setY(0);
      const toA = this.chargeMid.clone().sub(pb).setY(0);
      if (toB.length() > 0.35) pa.addScaledVector(toB.normalize(), Math.min(speed * dt, toB.length()));
      if (toA.length() > 0.35) pb.addScaledVector(toA.normalize(), Math.min(speed * dt, toA.length()));
      // little hops while charging
      d.aCat.root.position.y = d.aCat.baseY + Math.abs(Math.sin(d.t * 14)) * 0.25;
      d.bCat.root.position.y = d.bCat.baseY + Math.abs(Math.sin(d.t * 14 + 1)) * 0.25;
      if (pa.distanceTo(pb) <= 0.8 || d.t > 2.5) {
        d.phase = "clash";
        d.t = 0;
        this.fx.shake(0.45, 0.55);
        this.fx.burstStars(this.chargeMid.clone().setY(1), 16);
        // Weighted RNG: points + cheers decide it.
        const pts = this.mgr.points || { get: () => 0 };
        const wa = 10 + pts.get(d.aKey) * 0.05 + d.votesA * 5;
        const wb = 10 + pts.get(d.bKey) * 0.05 + d.votesB * 5;
        const winnerIsA = Math.random() * (wa + wb) < wa;
        d.winner = winnerIsA ? d.aCat : d.bCat;
        d.loser = winnerIsA ? d.bCat : d.aCat;
        d.winnerName = winnerIsA ? d.aName : d.bName;
        d.loser.ko(3.2);
        this.stateText = `duel: ${d.winnerName} wins!`;
        this.banner(`💥 ${d.winnerName} wins the duel!`);
        (this.mgr.points || Points).add(d.winnerName, 25);
        d.winner.attachCrown();
        d.winner.crownUntil = performance.now() + this.config.crownSec * 1000;
        d.winner.jumpQueued = 3;
        if (!d.winner.gameLock) d.winner.gameLock = false;
        d.winner.mode = "jump";
        d.winner.startJump();
      }
      return;
    }
    if (d.phase === "clash" && d.t !== undefined) {
      d.t += dt;
      if (d.t > 3.4) this.endGame();
    }
  }

  // =====================================================================
  // RACE
  // =====================================================================
  startRace(now) {
    const runners = [];
    // Auto-enroll up to 6 free cats so mock mode shows something instantly.
    for (const [key, cat] of this.freeCats().slice(0, 6)) {
      runners.push([key, cat]);
      cat.gameLock = true;
    }
    this.cooldowns.race = now + this.config.raceCooldownSec * 1000;
    const b = this.mgr.bounds;
    const zStart = b.minZ + 0.5;
    this.active = {
      name: "race",
      phase: "join",
      joinUntil: now + this.config.raceJoinSec * 1000,
      runners,
      laneZ: (i, n) => b.minZ + 0.4 + (i / Math.max(n - 1, 1)) * (b.maxZ - b.minZ - 0.8),
    };
    this.layoutRace();
    this.stateText = `race: ${runners.length} runners — !join`;
    this.banner("🏁 A race is starting! type !join to enter");
  }

  layoutRace() {
    const r = this.active.runners;
    r.forEach(([key, cat], i) => {
      cat.root.position.set(this.mgr.bounds.minX + 0.6, 0, this.active.laneZ(i, r.length));
      cat.faceDirection(1, 0, 1, 99);
    });
  }

  updateRace(dt, now) {
    const r = this.active;
    if (r.phase === "join") {
      if (now >= r.joinUntil) {
        r.phase = "run";
        r.t = 0;
        r.finishX = this.mgr.bounds.maxX - 0.6;
        this.banner("GO! 🏁", 2);
        this.stateText = `race running — ${r.runners.length} cats`;
      }
      return;
    }
    if (r.phase === "run") {
      r.t += dt;
      let anyFinished = false;
      for (const [, cat] of r.runners) {
        if (cat.userData?.finished) { anyFinished = true; continue; }
        // Stumble check.
        if (!cat._stumbleCd || now > cat._stumbleCd) {
          if (Math.random() < dt * 0.25) {
            cat._stumbleCd = now + 2500;
            cat.onKoDone = (c) => {
              // Still racing after the trip — re-lock until the race ends.
              if (this.active?.name === "race") c.gameLock = true;
            };
            cat.ko(0.9); // quick trip flop
            this.fx.dustPuff(cat.root.position, 5);
            continue;
          }
        }
        const sp = 1.6 + (cat.name.length % 3) * 0.15;
        cat.root.position.x += sp * dt;
        cat.walkPhase += dt * sp * 7.5;
        cat.applyWalkPose(Math.sin(cat.walkPhase), 1, dt);
        cat.faceDirection(1, 0, dt, 12);
        if (cat.root.position.x >= r.finishX) {
          cat.userData = cat.userData || {};
          cat.userData.finished = true;
          r.finished = r.finished || [];
          r.finished.push(cat);
          this.fx.burstStars(cat.root.position.clone().setY(1), 8);
          anyFinished = true;
        }
      }
      if (r.finished && r.finished.length >= Math.min(3, r.runners.length)) {
        r.phase = "done";
        r.doneT = 0;
        const podium = r.finished.slice(0, 3);
        this.banner(`🏆 ${podium.map((c) => c.name).join(" · ")}`);
        (this.mgr.points || Points).add(podium[0].name, 30);
        podium[0].attachCrown();
        podium[0].crownUntil = performance.now() + this.config.crownSec * 1000;
        this.stateText = `race winner: ${podium[0].name}`;
      }
      return;
    }
    if (r.phase === "done") {
      r.doneT += dt;
      if (r.doneT > 4) this.endGame();
    }
  }

  // =====================================================================
  // BOSS BATTLE
  // =====================================================================
  startBoss(now) {
    this.cooldowns.boss = now + this.config.bossCooldownSec * 1000;
    const proto = this.mgr.proto;

    // Spawn a real Cat, then scale + tint it into the boss.
    const cat = new Cat(proto, "BOSS", "#ff3355", this.mgr.bounds);
    cat.root.scale.multiplyScalar(4.5);
    cat.protoHeight *= 4.5;
    cat.speed = 0.35;
    cat.lastActive = performance.now();
    // Darken: clone + tint all materials.
    cat.root.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.color.setHex(0x57306b);
      }
    });
    const b = this.mgr.bounds;
    cat.root.position.set((b.minX + b.maxX) / 2, 0, b.minZ + 0.8);
    this.mgr.group.add(cat.root, cat.shadow, cat.label);
    // Shadow/label scale up to match.
    cat.shadow.scale.setScalar(1.15 * proto.unitScale * 4.5);
    cat.label.position.y += 3;
    this.mgr.cats.set("__boss__", cat);

    this.active = {
      name: "boss",
      phase: "fight",
      cat,
      hp: this.config.bossHp,
      hpMax: this.config.bossHp,
      damageBy: new Map(),
      stompT: 0,
      until: now + this.config.bossMaxSec * 1000,
      bar: this.buildHpBar(),
    };
    this.stateText = `BOSS FIGHT — ${cat.name} HP ${this.config.bossHp}`;
    this.banner("👹 A GIANT NUB HAS AWOKEN! CHAT ATTACK BY TYPING!", 5);
  }

  buildHpBar() {
    const wrap = document.createElement("div");
    wrap.className = "boss-hp";
    const fill = document.createElement("div");
    fill.className = "boss-hp-fill";
    wrap.appendChild(fill);
    this.mgr.overlayEl.appendChild(wrap);
    return { wrap, fill };
  }

  damageBoss(user, cat, isLove) {
    const dmg = isLove ? 5 : 1;
    const a = this.active;
    a.hp -= dmg;
    a.damageBy.set(user.toLowerCase(), (a.damageBy.get(user.toLowerCase()) || 0) + dmg);
    (this.mgr.points || Points).add(user, dmg);
    a.bar.fill.style.width = `${Math.max(0, (a.hp / a.hpMax) * 100)}%`;
    this.fx.burstStars(cat.headWorldPos(this._v3).clone(), isLove ? 4 : 1);
    if (a.hp <= 0) this.defeatBoss();
  }

  defeatBoss() {
    const a = this.active;
    const now = performance.now();
    this.banner("🎉 BOSS DEFEATED! LOOT FOR EVERYONE WHO FOUGHT!", 5);
    this.fx.coinRain(this.mgr.bounds, 50);
    this.fx.shake(0.5, 0.6);
    for (const [userKey] of a.damageBy) {
      const c = this.mgr.cats.get(userKey);
      if (c && !c.aura) {
        c.attachAura();
        c.auraUntil = now + this.config.auraSec * 1000;
      }
    }
    this.endGame(true);
  }

  updateBoss(dt, now) {
    const a = this.active;
    const boss = a.cat;
    // Boss is part of mgr.cats so manager.update already drives its cosmetics;
    // gameLock keeps it from roaming/despawning. Here we just prowl + stomp.
    boss.gameLock = true;
    // Slow menacing prowl toward the nearest free cat.
    let nearest = null, nd = Infinity;
    for (const [key, c] of this.mgr.cats) {
      if (key === "__boss__" || c.gameLock) continue;
      const d = c.root.position.distanceTo(boss.root.position);
      if (d < nd) { nd = d; nearest = c; }
    }
    if (nearest && nd > 1.6) {
      const dir = nearest.root.position.clone().sub(boss.root.position).setY(0).normalize();
      boss.root.position.addScaledVector(dir, boss.speed * dt);
      boss.faceDirection(dir.x, dir.z, dt, 4);
      boss.walkPhase += dt * boss.speed * 7.5;
      boss.applyWalkPose(Math.sin(boss.walkPhase), 1, dt);
    } else if (nearest) {
      // STOMP: scatter nearby cats.
      a.stompT -= dt;
      if (a.stompT <= 0) {
        a.stompT = 2.2;
        this.fx.shake(0.35, 0.4);
        this.fx.dustPuff(boss.root.position.clone(), 10);
        for (const [key, c] of this.mgr.cats) {
          if (key === "__boss__" || c.gameLock) continue;
          const d = c.root.position.distanceTo(boss.root.position);
          if (d < 3.2) {
            const away = c.root.position.clone().sub(boss.root.position).setY(0).normalize();
            c.root.position.addScaledVector(away, 2.2);
            if (c.jumpT < 0) c.startJump();
            (this.mgr.points || Points).add(c.name, 2);
          }
        }
      }
    }
    if (now >= a.until) {
      this.banner("the boss got bored and left… 💤", 3);
      this.endGame(true);
    }
  }

  // =====================================================================
  // SIMON SAYS (auto-fires between other games)
  // =====================================================================
  maybeSimon(now) {
    if (this.active || now < this.simonNext) return;
    const cmd = SIMON_COMMANDS[Math.floor(Math.random() * SIMON_COMMANDS.length)];
    const players = this.freeCats().filter(([, c]) => c.root.position.z > this.mgr.bounds.minZ + 0.2);
    const contestants = (players.length ? players : this.freeCats()).slice(0, 12);
    if (contestants.length < 3) { this.simonNext = now + 20000; return; }

    this.active = {
      name: "simon",
      phase: "announce",
      cmd,
      t: 0,
      obeyed: [],
      contestants,
      until: now + this.config.simonWindowSec * 1000,
    };
    for (const [, c] of contestants) c.gameLock = true;
    this.banner(`🧠 SIMON SAYS: everyone ${cmd}`, 3);
    this.stateText = `simon says: ${cmd}`;
  }

  updateSimon(dt, now) {
    const s = this.active;
    s.t += dt;
    if (s.phase === "announce") {
      // Cats that comply do the action after a beat; slackers faint.
      if (s.t > 0.9) {
        s.phase = "act";
        for (const [, c] of s.contestants) {
          const obeys = Math.random() < 0.7;
          if (obeys) {
            s.obeyed.push(c);
            if (s.cmd === "sit!") c.sitFor(this.config.simonWindowSec - 1, now);
            else if (s.cmd === "hop!") { c.jumpQueued = 2; c.startJump(); }
            else if (s.cmd === "spin!") { c.spinT = 0; c.spinning = true; }
          } else {
            c.ko(this.config.simonWindowSec - 1);
          }
        }
      }
      return;
    }
    if (s.phase === "act") {
      // Spin handling.
      for (const c of s.contestants) {
        if (c.spinning) {
          c.spinT += dt * 7;
          c.root.rotation.y = c.spinT;
          if (c.spinT >= Math.PI * 2) {
            c.spinning = false;
            c.releaseFromGame();
          }
        }
      }
      if (now >= s.until) {
        s.phase = "score";
        s.scoreUntil = now + 2500;
        const winners = s.obeyed.filter((c) => !c.spinning);
        if (winners.length) {
          this.banner(`✅ good cats: ${winners.slice(0, 4).map((c) => c.name).join(", ")}${winners.length > 4 ? "…" : ""}`);
          for (const w of winners) (this.mgr.points || Points).add(w.name, 10);
        }
        this.stateText = `simon: ${s.obeyed.length}/${s.contestants.length} obeyed`;
      }
      return;
    }
    if (s.phase === "score" && now >= s.scoreUntil) {
      this.endGame();
    }
  }

  // --- lifecycle ------------------------------------------------------------
  endGame(keepBanner = false) {
    const a = this.active;
    if (!a) return;
    // Free every locked cat + remove boss.
    for (const [key, cat] of this.mgr.cats) {
      if (key === "__boss__") {
        this.mgr.removeCat(cat);
        continue;
      }
      if (cat.gameLock) cat.releaseFromGame();
      if (cat.userData) delete cat.userData.finished;
      cat._racing = false;
    }
    if (a.bar) a.bar.wrap.remove();
    if (!keepBanner) clearTimeout(this._bannerTimer);
    if (this.bannerEl && !keepBanner) this.bannerEl.style.display = "none";
    this.active = null;
    this.stateText = "idle";
    this.simonNext = performance.now() + this.config.simonEverySec * 1000;
  }

  update(dt, now) {
    this.fx.update(dt);
    if (!this.active) {
      this.maybeSimon(now);
      return;
    }
    if (this.active.name === "duel") this.updateDuel(dt, now);
    else if (this.active.name === "race") this.updateRace(dt, now);
    else if (this.active.name === "boss") this.updateBoss(dt, now);
    else if (this.active.name === "simon") this.updateSimon(dt, now);
  }
}
