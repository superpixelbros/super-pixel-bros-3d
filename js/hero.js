// Heroes: stat table + the physics-driven player. Pure logic — Rapier and
// math only, no three.js — so headless checks can simulate heroes without
// a browser. The renderer reads pos/yaw/anim state from here each frame.
//
// Control model is Crash-Bandicoot style AUTO-RUN: the hero always runs
// along +Z (course direction); the stick/keys steer left/right, Space
// jumps, Down/Shift spin-attacks. One axis of input, all the fun.

import { STEP } from './phys.js';

// speed m/s, accel m/s², jump launch m/s (gravity 26 ⇒ apex ≈ v²/52),
// hp = hearts, steer = ground steering authority, airCtrl = share of the
// lateral accel kept in air. Speed law (headless-enforced): max/min speed
// across the roster ≤ 1.05 — nobody outruns anybody, so identity lives in
// grip, ignition, jump arc and heart count instead.
export const CHARACTERS = {
  hero:  { speed: 7.2, accel: 44, friction: 58, jump: 10.5, hp: 2,
    color: 0x5560dd, style: 'cap' },    // indigo everyman — does the job
  shararah: { speed: 7.45, accel: 64, friction: 50, jump: 9.8, hp: 1,
    steer: 1.15,                         // spark — best ignition, snappy cuts
    color: 0xf2683c, style: 'fletch' },
  yas:   { speed: 7.3, accel: 48, friction: 56, jump: 10.3, hp: 2,
    color: 0x3fae5a, style: 'cap' },     // confident — nothing fazes him
  ghzl:  { speed: 7.35, accel: 50, friction: 48, jump: 11.3, hp: 1,
    floaty: true,                        // silk spinner — big floaty arcs
    color: 0xc86ad8, style: 'fletch' },
  wafaa: { speed: 7.3, accel: 50, friction: 66, jump: 10.3, hp: 2,
    steer: 1.15,                         // loyal heart — never breaks form
    color: 0x2fae8f, style: 'cap' },
  duha:  { speed: 7.2, accel: 46, friction: 54, jump: 10.9, hp: 2,
    airCtrl: 1.25,                       // morning light — glides on air
    color: 0xffcf9e, style: 'cap' },
  dolar: { speed: 7.25, accel: 46, friction: 55, jump: 10.0, hp: 2,
    color: 0xb8c4d0, style: 'cap' },     // silver hustler — quick, level head
  scoozy:{ speed: 7.45, accel: 60, friction: 12, jump: 8.8, hp: 1, steer: 1.1,
    color: 0x35c8f0, style: 'fletch' },  // on wheels: icy, sharp, slippery
  faris: { speed: 7.1, accel: 40, friction: 70, jump: 9.6, hp: 3,
    steer: 1.2,                          // tank with the sharpest cuts
    color: 0xd8d4c8, style: 'keffiyeh' },
  glorious: { speed: 7.15, accel: 44, friction: 66, jump: 10.1, hp: 3,
    steer: 1.1, color: 0xf0b428, style: 'crown' }, // gold tank — dies loudly
};
export const HERO_IDS = Object.keys(CHARACTERS);

// Hero-grid cursor step (select screen). Horizontal wraps around the row;
// vertical moves exactly one row and NEVER leaves the grid — the last row
// is short, so Down from it stays put instead of hopping columns.
export function stepHeroGrid(cur, dx, dy, cols, len) {
  if (dy) {
    const next = cur + dy * cols;
    return next < 0 || next >= len ? cur : next;
  }
  return (cur + dx + len) % len;
}

// Capsule size: total height = 2*(HALF+RADIUS) = 1.26m. The renderer must
// keep the mesh in sync (0.9x of the 1.4m full-size build) — derive from
// these constants, never hardcode the old 0.7 feet offset again.
export const HERO_RADIUS = 0.315;
export const HERO_HALF = 0.315;

const COYOTE = 6;       // frames of forgiveness leaving the ground
const BUFFER = 7;       // frames of pre-land jump memory
const JUMP_CUT = 0.45;  // early release: cut rise once to this fraction
const HURT_INVULN = 72; // ~1.2s of mercy after taking a hit
const HURT_STUN = 16;   // ~0.27s knockback tumble before control returns
// speed pickups: boost ring ×1.28 for 3.5s, jinx orb ×0.68 for 2.5s. The
// multiplier applies to GROUND run speed only — once you leave the ground
// the base envelope returns, so no jinx can ever make a gap unjumpable.
const BOOST_MUL = 1.28, BOOST_T = 210;
const JINX_MUL = 0.68, JINX_T = 150;

export class Player {
  // heroId: a CHARACTERS key, or a custom def object (used by AI rivals)
  constructor(RAPIER, world, heroId, spawn) {
    this.R = RAPIER;
    this.def = typeof heroId === 'string' ? CHARACTERS[heroId] : heroId;
    this.heroId = heroId.id || heroId;
    this.spawn = { ...spawn };
    this.autoRun = true;

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(spawn.x, spawn.y, spawn.z);
    this.body = world.createRigidBody(bodyDesc);
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(HERO_HALF, HERO_RADIUS), this.body);

    this.ctrl = world.createCharacterController(0.02);
    this.ctrl.enableAutostep(0.42, 0.25, true);
    this.ctrl.enableSnapToGround(0.35);
    this.ctrl.setMaxSlopeClimbAngle(55 * Math.PI / 180);

    this.vx = 0; this.vy = 0; this.vz = 0;
    this.free = false;       // true = WASD drives BOTH axes (arena mode)
    this.yaw = 0;          // 0 faces +Z (course direction)
    this.grounded = true;
    this.coyote = 0;
    this.buffer = 0;
    this.jumpLatch = false;  // one jump per press — clears on key release
    this.cutArmed = false; // jump-cut fires once per jump
    this.spinT = 0;        // >0 frames left of spin-attack
    this.animT = 0;        // walk-cycle clock
    this.speed2D = 0;
    this.alive = true;
    this.jumped = false;     // event flags, one-frame pulses for sfx
    this.landed = false;
    // speed pickup modifier: mod +1 boost / -1 jinx, modT frames left,
    // modGot one-frame pulse (+1/-1) so the game layer can play a sfx
    this.mod = 0; this.modT = 0; this.modGot = 0;
    // damage model — hearts drive the "ways to lose"
    this.maxHp = this.def.hp ?? 1;
    this.hp = this.maxHp;
    this.invuln = 0;         // frames of post-hit mercy
    this.stun = 0;           // frames of knockback tumble (no control)
    this.dead = false;
  }

  // knock the hero: side (kx) + forward/back (kz) impulses + a rise.
  // returns 'block' (invuln), 'hit', or 'dead'.
  hurt(kx, kz, up = 5.2) {
    if (this.invuln > 0 || this.dead) return 'block';
    this.hp -= 1;
    this.invuln = HURT_INVULN;
    if (this.hp <= 0) { this.dead = true; return 'dead'; }
    this.stun = HURT_STUN;
    this.vx = kx; this.vz = kz; this.vy = Math.max(this.vy, up);
    this.grounded = false;
    return 'hit';
  }

  bounce(v) { this.vy = v; this.grounded = false; this.cutArmed = false; }

  // grab a speed pickup: kind +1 = boost ring, -1 = jinx orb. A new pickup
  // simply replaces whatever was running — no stacking.
  applyMod(kind) {
    this.mod = kind > 0 ? 1 : -1;
    this.modT = kind > 0 ? BOOST_T : JINX_T;
    this.modGot = this.mod;
  }

  // ground-only run multiplier — airborne you always get the honest base
  // speed, so jump gaps stay exactly as the reachability proofs measured
  get speedMul() {
    if (!this.grounded || this.modT <= 0) return 1;
    return this.mod > 0 ? BOOST_MUL : JINX_MUL;
  }

  get pos() { return this.body.translation(); }

  // flags: { x: -1|0|1 steer, jump: edge, jumpHeld: bool, spin: edge,
  //          z: -1|0|1 forward/back — ONLY used when this.free }
  step(flags) {
    const dt = STEP;
    const d = this.def;
    this.jumped = false;
    this.landed = false;
    this.modGot = 0;
    if (this.invuln > 0) this.invuln -= 1;
    if (this.modT > 0) this.modT -= 1;
    const stunned = this.stun > 0;
    if (stunned) this.stun -= 1;

    if (flags.spin && !stunned && this.spinT <= 0) this.spinT = 28; // ~0.46s
    if (this.spinT > 0) this.spinT -= 1;

    // auto-run along +Z (race) — or, in FREE mode (arena), the z flag
    // drives forward/back and both axes decelerate on their own. Steering
    // blends lateral speed; wind pushes regardless. Stun locks both.
    const mul = this.speedMul;
    let targetVz, targetVx;
    if (this.free) {
      targetVz = stunned ? 0 : (flags.z || 0) * d.speed * 0.82 * mul;
      targetVx = stunned ? 0 : flags.x * d.speed * 0.82 * (d.steer ?? 1) * mul;
    } else {
      targetVz = this.autoRun && !stunned ? d.speed * mul : 0;
      const steer =
        stunned ? 0 : flags.x * d.speed * 0.85 * (d.steer ?? 1) * mul;
      targetVx = steer + (stunned ? 0 : (flags.windX || 0));
    }
    const air = !this.grounded;
    const airMul = air ? 0.6 * (d.airCtrl ?? 1) : 1;
    this.vz = approach(this.vz, targetVz, d.accel * airMul * dt);
    this.vx = approach(this.vx, targetVx, d.accel * airMul * dt);
    if (this.free && !air) {
      if (!flags.z) this.vz = approach(this.vz, 0, d.friction * dt);
      if (!flags.x) this.vx = approach(this.vx, 0, d.friction * dt);
    } else if (!this.autoRun && !air && !flags.x) {
      this.vx = approach(this.vx, 0, d.friction * dt);
    }

    // jump: buffer the press, consume within buffer or coyote window.
    // ONE jump per press (player asked): while the key stays held no new
    // jump arms — it must be released first. This immunises the jump
    // against OS auto-repeat, pad jitter and any caller that leaks a
    // held flag through flags.jump. The buffer (press just before land)
    // still works — a press counts only after a release.
    if (!flags.jump && !flags.jumpHeld) this.jumpLatch = false;
    if (flags.jump && !stunned && !this.jumpLatch) this.buffer = BUFFER;
    else if (this.buffer > 0) this.buffer -= 1;
    if (this.buffer > 0 && (this.grounded || this.coyote > 0)) {
        this.jumped = true;
      this.vy = d.jump;
      this.grounded = false;
      this.cutArmed = true;
      this.coyote = 0;
      this.buffer = 0;
      this.jumpLatch = true;      // re-arms when the key comes up
    }
    // variable height: releasing early cuts the rise exactly once
    if (this.cutArmed && !flags.jumpHeld && this.vy > 0) {
      this.vy *= JUMP_CUT;
      this.cutArmed = false;
    }

    // gravity: ONE fixed arc — holding the button never stretches the rise
    // (the old 0.82× hold-gravity made a held jump climb ~25% higher and
    // felt like the hero "kept going up"; tap or hold, same ceiling).
    let g = 26;
    if (this.vy < 0 && d.floaty) g *= 0.62;
    if (this.spinT > 0 && this.vy < 0) g *= 1.4;
    this.vy = Math.max(this.vy - g * dt, -32);

    // move via the character controller, then follow the computed movement
    this.ctrl.computeColliderMovement(this.collider, {
      x: this.vx * dt, y: this.vy * dt, z: this.vz * dt,
    });
    const mv = this.ctrl.computedMovement();
    const grounded = this.ctrl.computedGrounded();
    if (grounded) {
      this.coyote = COYOTE;
      // a real thud only: soft landings stay quiet
      this.landed = !this.grounded && this.vy < -7;
      if (this.vy < 0) this.vy = 0;
    } else if (this.coyote > 0) this.coyote -= 1;
    this.grounded = grounded;

    const p = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z,
    });
    // achieved movement drives the walk animation and facing
    this.speed2D = Math.hypot(mv.x, mv.z) / dt;
    this.animT += Math.max(this.speed2D, this.autoRun ? 0.5 : 0) * dt * 2.0;
    this.yaw = lerpAngle(this.yaw, Math.atan2(this.vx, Math.max(this.vz, 1e-6)));
  }

  respawn() {
    this.vx = this.vy = 0; this.vz = 0;
    this.spinT = 0;
    this.mod = 0; this.modT = 0;   // dying washes the jinx off
    // respawn at a checkpoint = full recovery with a breath of grace
    this.hp = this.maxHp;
    this.dead = false;
    this.stun = 0;
    this.invuln = 30;
    this.body.setTranslation(this.spawn, true);
  }
}

function approach(cur, target, maxDelta) {
  const dv = target - cur;
  if (Math.abs(dv) <= maxDelta) return target;
  return cur + Math.sign(dv) * maxDelta;
}

function lerpAngle(a, b, k = 0.18) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}
