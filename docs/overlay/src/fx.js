import * as THREE from "three";

// Shared particle / juice system. One pooled sprite list + a global screen
// shake so a spammy game can't flood the scene.

function makeStarTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.translate(32, 32);
  g.fillStyle = "#ffd23f";
  g.strokeStyle = "rgba(90,60,0,0.9)";
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 26 : 11;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCoinTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#ffcf3f";
  g.strokeStyle = "#8a6400";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(32, 32, 24, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#8a6400";
  g.font = "800 30px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("$", 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePuffTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, "rgba(215,205,190,0.95)");
  grad.addColorStop(1, "rgba(215,205,190,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.sprites = [];
    this.shakeT = 0;
    this.shakeMag = 0;
    this.maxSprites = 260; // hard cap across all games
    this.starTex = makeStarTexture();
    this.coinTex = makeCoinTexture();
    this.puffTex = makePuffTexture();
  }

  shake(mag = 0.25, sec = 0.4) {
    if (mag >= this.shakeMag || this.shakeT <= 0) {
      this.shakeMag = mag;
      this.shakeT = sec;
      this.shakeDur = sec;
    }
  }

  // Per-frame camera offset; main loop applies it after render prep.
  update(dt) {
    if (this.shakeT > 0) this.shakeT -= dt;
    this.sprites = this.sprites.filter((s) => {
      const u = s.userData;
      u.life += dt;
      u.vy -= (u.gravity ?? 3.5) * dt;
      s.position.x += u.vx * dt;
      s.position.y += u.vy * dt;
      s.position.z += u.vz * dt;
      s.material.rotation = (u.spin ?? 0) * u.life;
      s.material.opacity = Math.max(0, 1 - u.life / u.maxLife);
      if (u.bounce && s.position.y < 0.1 && u.vy < 0) {
        s.position.y = 0.1;
        u.vy *= -0.45;
        u.vx *= 0.7;
      }
      if (u.life >= u.maxLife) {
        s.material.dispose();
        this.scene.remove(s);
        return false;
      }
      return true;
    });
  }

  _spawn(tex, pos, opts) {
    if (this.sprites.length >= this.maxSprites) {
      const old = this.sprites.shift();
      old.material.dispose();
      this.scene.remove(old);
    }
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      rotation: Math.random() * Math.PI,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(opts.size ?? 0.35);
    s.userData = {
      vx: THREE.MathUtils.randFloatSpread(opts.spreadX ?? 1.6),
      vy: (opts.vy ?? 3) + Math.random() * (opts.vyJitter ?? 2),
      vz: THREE.MathUtils.randFloatSpread(0.8),
      gravity: opts.gravity ?? 3.5,
      bounce: !!opts.bounce,
      spin: THREE.MathUtils.randFloatSpread(6),
      life: 0,
      maxLife: opts.life ?? 1.4,
    };
    this.scene.add(s);
    this.sprites.push(s);
  }

  burstStars(pos, n = 12) {
    for (let i = 0; i < n; i++) this._spawn(this.starTex, pos, { size: 0.3 + Math.random() * 0.25 });
    this.shake(0.22, 0.35);
  }

  coinRain(bounds, n = 40) {
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(
        THREE.MathUtils.randFloat(bounds.minX, bounds.maxX),
        6 + Math.random() * 3,
        THREE.MathUtils.randFloat(bounds.minZ, bounds.maxZ)
      );
      this._spawn(this.coinTex, p, { vy: -1, vyJitter: 1, gravity: 2.2, bounce: true, life: 3, size: 0.32 });
    }
  }

  dustPuff(pos, n = 6) {
    for (let i = 0; i < n; i++) {
      const p = pos.clone();
      p.y = 0.2;
      this._spawn(this.puffTex, p, { vy: 1.4, vyJitter: 1.2, gravity: 2.5, life: 0.7, size: 0.3 + Math.random() * 0.2 });
    }
  }
}
