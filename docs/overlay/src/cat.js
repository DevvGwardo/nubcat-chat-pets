import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

// One viewer's pet: a cloned, procedurally-animated nub cat.
//
// State machine ported from the Hermes agent pet feature (agent/pet):
//   idle - nothing happening (breathes, occasional look-around)
//   run  - walking to a roam target (Hermes "roam" behavior)
//   jump - reaction (viewer sent a message) / celebration hop
// Roaming, vibe reactions, and speech bubbles all mirror Hermes' desktop
// pop-out overlay behavior, rebuilt here in 3D for a stream overlay.

const JUMP_SEC = 0.62;

function makeCircleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, "rgba(0,0,0,0.38)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeNameTexture(name, color) {
  const pad = 24;
  const font = '800 44px -apple-system, "Segoe UI", Roboto, sans-serif';
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const tw = Math.ceil(measure.measureText(name).width);
  const w = Math.max(128, tw + pad * 2);
  const h = 76;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.strokeStyle = "rgba(10,10,18,0.92)";
  g.lineWidth = 8;
  g.strokeText(name, w / 2, h / 2);
  g.fillStyle = color || "#ffffff";
  g.fillText(name, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / h };
}

let shadowTex = null;
function getShadowTexture() {
  if (!shadowTex) shadowTex = makeCircleTexture();
  return shadowTex;
}

// Tunable pose constants — the workbench page mutates these live.
export const POSE = {
  armDown: 1.25, // rad, arms rotate from T-pose down to the sides
  walkArm: 0.45, // rad, arm counter-swing amplitude at full walk
  jumpArm: 1.2, // multiplier on leg tuck for arms during jumps
  walkLeg: 0.65, // rad, leg swing amplitude
  headNod: 0.08, // rad, head bob while walking
};

export class Cat {
  // proto: prepared prototype { scene, height } from prepareCatPrototype().
  constructor(proto, name, color, bounds) {
    this.name = name;
    this.bounds = bounds;
    this.root = cloneSkeleton(proto.scene);
    this.root.scale.setScalar(proto.unitScale);
    this.root.position.copy(randomPointIn(bounds));

    // Collect bones by name and remember their rest quaternions so all
    // animation is additive on top of the rig's rest pose. boneMap translates
    // the canonical names the animation code uses (body/leg.L/paw.L/head…)
    // into this rig's actual bone names.
    this.boneMap = proto.boneMap || {};
    this.bones = {}; // canonical name -> bone
    this.rest = {}; // canonical name -> rest quaternion
    this.root.traverse((o) => {
      if (o.isBone) {
        for (const [canonical, actual] of Object.entries(this.boneMap)) {
          if (o.name === actual && !this.bones[canonical]) {
            this.bones[canonical] = o;
            this.rest[canonical] = o.quaternion.clone();
          }
        }
      }
    });

    // The nub rigs rest in T-pose (arms straight out). Bake a permanent
    // "arms down by the sides" offset into the stored rest pose — every
    // pose helper composes on top of this.rest, so idle, walk, sit, KO and
    // jump all inherit relaxed arms without touching their own amplitudes.
    const ARM_DOWN_X = POSE.armDown; // rad, arms rotate down toward the body
    for (const side of ["L", "R"]) {
      const key = `arm.${side}`;
      if (this.bones[key]) {
        // Mirror: left/right arms rotate in opposite directions to come down.
        const down = qFromEuler(0, 0, key === "arm.L" ? ARM_DOWN_X : -ARM_DOWN_X);
        this.rest[key].multiply(down);
        this.bones[key].quaternion.copy(this.rest[key]);
      }
    }

    // Soft blob shadow under the cat.
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: getShadowTexture(),
        transparent: true,
        depthWrite: false,
      })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.shadow.scale.setScalar(1.15 * proto.unitScale);

    // Floating name label.
    const { tex, aspect } = makeNameTexture(name, color);
    this.label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    this.label.scale.set(0.62 * aspect, 0.62, 1);

    // Behavior state (mirrors Hermes PetState usage).
    this.protoHeight = proto.height;
    this.mode = "run"; // run | idle | jump
    this.target = randomPointIn(bounds);
    this.speed = 0.9 + Math.random() * 0.7; // world units/sec
    this.walkPhase = Math.random() * Math.PI * 2;
    this.walkEase = 0;
    this.bodyBob = 0;
    this.airY = 0;
    this.baseY = 0;
    this.idleUntil = 0;
    this.jumpT = -1; // <0 means not jumping
    this.jumpQueued = 0; // extra hops requested (celebration)
    this.yawFlip = 0; // set from config flip
    this.lastActive = performance.now();
    this.bubbleUntil = 0;

    // Mini-game state (managed by GameDirector):
    //   gameLock — roaming paused, a game owns this cat
    //   mode additions: "sit", "ko"
    this.gameLock = false;
    this.koT = -1;
    this.koDur = 0;
    this.sitUntil = 0;
  }

  // --- mini-game poses ----------------------------------------------------
  // Sit: park in place, body pitched back slightly.
  sitFor(sec, now) {
    this.gameLock = true;
    this.mode = "sit";
    this.jumpT = -1;
    this.airY = 0;
    this.jumpQueued = 0;
    this.sitUntil = now + sec * 1000;
    this.easeWalk(0, 0.016);
    const body = this.bones["body"];
    if (body) {
      body.quaternion.copy(this.rest["body"]).multiply(qFromEuler(-0.18, 0, 0));
      const legAmp = -1.1;
      this.setBoneRaw("leg.L", legAmp);
      this.setBoneRaw("leg.R", legAmp);
      this.setBoneRaw("paw.L", 0.5);
      this.setBoneRaw("paw.R", 0.5);
    }
    this.root.position.y = this.baseY;
  }

  releaseFromGame() {
    this.gameLock = false;
    if (this.mode === "sit" || this.mode === "ko") {
      this.applyRest();
      this.root.rotation.z = 0;
      this.idleUntil = performance.now() + 600;
      this.mode = "idle";
    }
  }

  // Dramatic KO flop: tips over sideways with splayed legs, then recovers.
  ko(sec = 3) {
    this.gameLock = true;
    this.mode = "ko";
    this.jumpT = -1;
    this.airY = 0;
    this.jumpQueued = 0;
    this.koT = 0;
    this.koDur = sec;
    this.koDir = Math.random() < 0.5 ? -1 : 1;
    this.onKoDone = null; // optional callback for games
  }

  updateKo(dt) {
    this.koT += dt;
    const t = Math.min(this.koT / 0.45, 1); // tip over over 0.45s
    const ease = 1 - Math.pow(1 - t, 3);
    const target = this.koDir * 1.35;
    this.root.rotation.z = target * ease;
    this.root.position.y = this.baseY + Math.sin(Math.min(t, 1) * Math.PI) * 0.12;
    const splay = ease * 0.9;
    this.setBone("leg.L", splay, 0, 0);
    this.setBone("leg.R", -splay * 0.6, 0, 0);
    this.setBone("paw.L", splay * 0.7, 0, 0);
    this.headNod(ease * 0.5);
    if (this.koT >= this.koDur) {
      const cb = this.onKoDone;
      this.releaseFromGame();
      if (cb) cb(this);
    }
  }

  // --- cosmetics ------------------------------------------------------------
  attachCrown() {
    if (this.crown) return;
    const g = getCrownGeometry();
    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.65, roughness: 0.3 })
    );
    m.scale.setScalar(0.34);
    m.position.y = this.topY() + 0.08;
    this.root.add(m);
    this.crown = m;
    this.crownUntil = Infinity;
  }

  attachAura() {
    if (this.aura) return;
    if (!FX_AURA_TEX) FX_AURA_TEX = makeAuraTexture();
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: FX_AURA_TEX, transparent: true, depthWrite: false })
    );
    const h = this.topY();
    s.scale.set(h * 2.2, h * 2.6, 1);
    s.position.y = h * 0.55;
    this.root.add(s);
    this.aura = s;
    this.auraUntil = Infinity;
  }

  setBounds(b) {
    this.bounds = b;
    const p = this.root.position;
    p.x = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
    p.z = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
    this.target.x = THREE.MathUtils.clamp(this.target.x, b.minX, b.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, b.minZ, b.maxZ);
  }

  // Viewer spoke -> celebrate with a hop (Hermes maps "turn finished" to wave;
  // on a busy overlay a hop reads better from across the room).
  react(now) {
    this.lastActive = now;
    if (this.jumpT < 0) this.startJump();
    else this.jumpQueued = Math.min(this.jumpQueued + 1, 2);
  }

  startJump() {
    this.jumpT = 0;
    this.mode = "jump";
  }

  headWorldPos(out) {
    const body = this.bones["body"];
    if (body) return body.getWorldPosition(out);
    return this.root.getWorldPosition(out).add(new THREE.Vector3(0, 0.8, 0));
  }

  update(dt, now, celebrating) {
    // Cosmetics expire.
    if (this.crown && now > this.crownUntil) {
      this.root.remove(this.crown);
      this.crown.material.dispose();
      this.crown = null;
    }
    if (this.aura && now > this.auraUntil) {
      this.root.remove(this.aura);
      this.aura.material.dispose();
      this.aura = null;
    }

    // Game-owned cats don't roam or react.
    if (this.gameLock) {
      if (this.mode === "ko") {
        this.updateKo(dt);
      } else if (this.mode === "sit" && now >= this.sitUntil) {
        this.releaseFromGame();
      }
    } else if (celebrating && this.jumpT < 0 && this.jumpQueued <= 0 && Math.random() < dt * 2.2) {
      this.startJump();
    }

    if (!this.gameLock) {
      if (this.mode === "jump") {
        this.updateJump(dt);
      } else if (this.mode === "run") {
        this.updateRun(dt);
      } else {
        this.updateIdle(dt, now);
      }
    }

    // Crown/aura bob gently so they read as alive.
    if (this.crown) {
      this.crown.rotation.y += dt * 1.2;
      this.crown.position.y = this.topY() + 0.08 + Math.sin(now / 300) * 0.03;
    }

    // Keep the shadow + label glued to the cat.
    this.shadow.position.x = this.root.position.x;
    this.shadow.position.z = this.root.position.z;
    const airY = this.airY || 0;
    this.shadow.material.opacity = THREE.MathUtils.clamp(0.9 - airY * 0.55, 0.25, 0.9);
    this.label.position.set(
      this.root.position.x,
      this.topY() + 0.58 + airY,
      this.root.position.z
    );
  }
  // --- movement states -------------------------------------------------
  updateRun(dt) {
    const pos = this.root.position;
    const dx = this.target.x - pos.x;
    const dz = this.target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.18) {
      this.mode = "idle";
      this.idleUntil = performance.now() + 900 + Math.random() * 3200;
      this.easeWalk(0, dt);
      return;
    }
    const step = Math.min(this.speed * dt, dist);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    this.faceDirection(dx / dist, dz / dist, dt, 10);
    this.walkPhase += dt * this.speed * 7.5;
    this.applyWalkPose(Math.sin(this.walkPhase), 1, dt);
  }

  updateIdle(dt, now) {
    this.easeWalk(0, dt);
    if (now > this.idleUntil) {
      this.target = randomPointIn(this.bounds);
      this.mode = "run";
    }
  }

  updateJump(dt) {
    this.jumpT += dt / JUMP_SEC;
    const t = this.jumpT;
    if (t >= 1) {
      this.jumpT = -1;
      this.airY = 0;
      this.bodyBob = 0;
      if (this.jumpQueued > 0) {
        this.jumpQueued--;
        this.startJump();
      } else {
        this.idleUntil = performance.now() + 400 + Math.random() * 1200;
        this.mode = "idle";
        this.applyRest();
      }
      return;
    }
    // Parabolic hop with squash-and-stretch on takeoff/landing.
    this.airY = 4 * t * (1 - t) * 0.85;
    const squash = 1 + 0.22 * Math.sin(t * Math.PI);
    this.root.position.y = this.baseY + this.airY;
    const body = this.bones["body"];
    if (body) {
      body.quaternion
        .copy(this.rest["body"])
        .multiply(qFromEuler(Math.sin(t * Math.PI) * 0.12, 0, 0));
      body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    }
    this.tuckLegs(Math.sin(t * Math.PI));
  }

  // --- pose helpers -----------------------------------------------------
  applyWalkPose(swing, amount, dt) {
    this.easeWalk(amount, dt);
    const amp = POSE.walkLeg * this.walkEase;
    // Diagonal gait: opposite legs swing together, arms counter-swing
    // against their same-side leg (like a real walk cycle).
    this.setBone("leg.L", swing * amp, 0, 0);
    this.setBone("leg.R", -swing * amp, 0, 0);
    this.setBone("paw.L", -swing * amp * 0.6, 0, 0);
    this.setBone("paw.R", swing * amp * 0.6, 0, 0);
    if (this.bones["arm.L"]) {
      const armAmp = POSE.walkArm * this.walkEase;
      this.setBone("arm.L", -swing * armAmp, 0, 0);
      this.setBone("arm.R", swing * armAmp, 0, 0);
    }
    const body = this.bones["body"];
    if (body) {
      this.bodyBob = Math.abs(Math.cos(this.walkPhase)) * 0.05 * this.walkEase;
      body.quaternion
        .copy(this.rest["body"])
        .multiply(qFromEuler(swing * 0.04, 0, swing * 0.06));
      body.scale.setScalar(1);
    }
    this.headNod(swing * POSE.headNod);
    this.root.position.y = this.baseY + this.bodyBob;
  }

  easeWalk(target, dt) {
    this.walkEase = THREE.MathUtils.damp(this.walkEase || 0, target, 8, dt);
    if (target === 0 && this.walkEase < 0.02) {
      this.walkEase = 0;
      this.applyRest();
    }
  }

  tuckLegs(k) {
    const amp = -0.9 * k;
    this.setBoneRaw("leg.L", amp);
    this.setBoneRaw("leg.R", amp);
    this.setBoneRaw("paw.L", amp * 0.7);
    this.setBoneRaw("paw.R", amp * 0.7);
    // Tuck arms too — reads as a mid-air flail on jump takeoff.
    if (this.bones["arm.L"]) {
      this.setBoneRaw("arm.L", amp * POSE.jumpArm);
      this.setBoneRaw("arm.R", amp * POSE.jumpArm);
    }
  }

  headNod(x) {
    this.setBoneRaw("head", x, true);
  }

  setBone(name, x, y, z) {
    const bone = this.bones[name];
    if (!bone) return;
    bone.quaternion.copy(this.rest[name]).multiply(qFromEuler(x, y, z));
    bone.scale.setScalar(1);
  }

  setBoneRaw(name, x, additiveBody = false) {
    const bone = this.bones[name];
    if (!bone) return;
    bone.quaternion.copy(this.rest[name]).multiply(qFromEuler(x, 0, 0));
  }

  applyRest() {
    for (const [name, q] of Object.entries(this.rest)) {
      const bone = this.bones[name];
      if (!bone) continue;
      bone.quaternion.copy(q);
      bone.scale.setScalar(1);
    }
    this.root.position.y = this.baseY;
  }

  faceDirection(dx, dz, dt, lambda) {
    const desired =
      Math.atan2(dx, dz) + (this.yawFlip ? Math.PI : 0);
    let cur = this.root.rotation.y;
    let diff = ((desired - cur + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.root.rotation.y = cur + diff * (1 - Math.exp(-lambda * dt));
  }

  topY() {
    return this.protoHeight;
  }
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function qFromEuler(x, y, z) {
  _e.set(x, y, z);
  return _q.setFromEuler(_e);
}

// Shared crown geometry (low-poly zig-zag crown).
let _crownGeo = null;
function getCrownGeometry() {
  if (_crownGeo) return _crownGeo;
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.25);
  shape.lineTo(0.5, -0.25);
  shape.lineTo(0.5, 0.15);
  shape.lineTo(0.28, 0.45);
  shape.lineTo(0.12, 0.2);
  shape.lineTo(0, 0.5);
  shape.lineTo(-0.12, 0.2);
  shape.lineTo(-0.28, 0.45);
  shape.lineTo(-0.5, 0.15);
  shape.closePath();
  _crownGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
  _crownGeo.center();
  return _crownGeo;
}

let FX_AURA_TEX = null;
function makeAuraTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, "rgba(255,214,80,0)");
  grad.addColorStop(0.55, "rgba(255,214,80,0.55)");
  grad.addColorStop(1, "rgba(255,190,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function randomPointIn(b) {
  return new THREE.Vector3(
    THREE.MathUtils.randFloat(b.minX, b.maxX),
    0,
    THREE.MathUtils.randFloat(b.minZ, b.maxZ)
  );
}

// Load the FBX once, normalize it (height=1, feet at y=0, centered), fix the
// texture reference, and return a prototype ready for SkeletonUtils cloning.
export async function prepareCatPrototype(loader, url, textureUrl) {
  const fbx = await loader.loadAsync(url);
  const tex = await new THREE.TextureLoader().loadAsync(textureUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  fbx.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      // The classic cat ships an untextured grey material + vertex colors and
      // relies on texture.png for ALL its color/detail — stamp the texture,
      // neutralize diffuse/vertex colors, or it renders silver.
      //
      // The new nub rigs (naked/pink) are SOLID-COLOR models: body materials
      // carry their real color (#64a6ff / #ffcadc) with no map. Forcing
      // texture.png onto them smears classic-cat face pixels across their UVs
      // (the "bad mapping"). So: only override meshes that have no map of
      // their own AND ship vertex colors (the classic rig's fingerprint).
      const isClassicOverride = !m.map && m.vertexColors;
      if (isClassicOverride) {
        m.map = tex;
        if (m.color) m.color.setScalar(1);
        m.vertexColors = false;
      }
      // Matte pastel look for everyone — default Phong specular reads silver.
      if ("specular" in m && m.specular) m.specular.setScalar(0.06);
      if ("shininess" in m) m.shininess = 6;
      m.needsUpdate = true;
    }
  });

  // Normalize: measure, scale to unit height, put feet on y=0, center X/Z.
  const box = new THREE.Box3().setFromObject(fbx);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const unitScale = 1 / size.y;
  fbx.position.sub(center.multiply(new THREE.Vector3(1, 0, 1)));
  fbx.position.y -= box.min.y;
  const wrap = new THREE.Group();
  wrap.add(fbx);
  wrap.scale.setScalar(unitScale);
  // After scaling, re-measure so we know where the head is for labels.
  const scaledBox = new THREE.Box3().setFromObject(wrap);

  return { scene: wrap, unitScale, height: scaledBox.max.y, boneMap: detectBoneMap(wrap) };
}

// Canonical bone names the animation code uses -> per-rig actual names.
const BONE_ALIASES = [
  // classic cat.fbx rig: legL/pawL bones exist but were never wired before —
  // mapping them here gives the classic cat a real leg walk for the first time
  { body: "body", head: "head", "leg.L": "legL", "leg.R": "legR", "paw.L": "pawL", "paw.R": "pawR" },
  // mixamo-style nub rigs (naked_nub.fbx / pink_nub.fbx): full limbs incl. arms
  {
    body: "Root_hip", head: "Head",
    "leg.L": "Leg_L", "leg.R": "Leg_R", "paw.L": "Foot_L", "paw.R": "Foot_R",
    "arm.L": "Arm_L", "arm.R": "Arm_R",
    "hand.L": "Hand_L", "hand.R": "Hand_R",
  },
];

function detectBoneMap(root) {
  const names = new Set();
  root.traverse((o) => { if (o.isBone) names.add(o.name); });
  for (const map of BONE_ALIASES) {
    if (Object.values(map).every((n) => names.has(n))) return map;
  }
  return null; // unknown rig — animation code's `if (!bone) return` guards cope
}
