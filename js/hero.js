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
// lateral accel kept in air. Balance law (headless-enforced): clear-time
// spread across the roster stays ≤ 1.30× — every distinction has a cost.
export const CHARACTERS = {
  rosso: { speed: 7.0, accel: 42, friction: 55, jump: 10.8, hp: 2,
    color: 0xe04a3f, style: 'cap' },
  bolt:  { speed: 8.2, accel: 56, friction: 50, jump: 10.2, hp: 1,
    airCtrl: 0.75,                     // speed demon understeers in air
    color: 0xf2c23e, style: 'cap' },
  aqua:  { speed: 6.8, accel: 44, friction: 52, jump: 12.6, hp: 1, floaty: true,
    color: 0x3f9be0, style: 'cap' },
  faris: { speed: 6.6, accel: 40, friction: 70, jump: 10.2, hp: 3,
    steer: 1.2,                        // tank with the sharpest cuts
    color: 0xd8d4c8, style: 'keffiyeh' },
  sahm:  { speed: 8.4, accel: 72, friction: 10, jump: 8.6, hp: 1,
    color: 0x58b060, style: 'fletch' }, // brake-slip stays — overshoot king
  dolar: { speed: 7.4, accel: 46, friction: 55, jump: 10.6, hp: 2,
    color: 0xb8c4d0, style: 'cap' },    // silver hustler — quick, level head
  hero:  { speed: 7.0, accel: 44, friction: 58, jump: 11.2, hp: 2,
    color: 0x5560dd, style: 'cap' },    // indigo everyman — does the job
  scoozy:{ speed: 8.3, accel: 68, friction: 12, jump: 9.4, hp: 1, steer: 1.1,
    color: 0xe0559a, style: 'fletch' }, // on wheels: darty, sharp, slippery
  glorious: { speed: 6.7, accel: 38, friction: 66, jump: 10.8, hp: 3,
    steer: 1.1, color: 0xf0b428, style: 'crown' }, // gold tank — dies loudly
};
export const HERO_IDS = Object.keys(CHARACTERS);

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
    this.yaw = 0;          // 0 faces +Z (course direction)
    this.grounded = true;
    this.coyote = 0;
    this.buffer = 0;
    this.cutArmed = false; // jump-cut fires once per jump
    this.spinT = 0;        // >0 frames left of spin-attack
    this.animT = 0;        // walk-cycle clock
    this.speed2D = 0;
    this.alive = true;
    this.jumped = false;     // event flags, one-frame pulses for sfx
    this.landed = false;
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

  get pos() { return this.body.translation(); }

  // flags: { x: -1|0|1 steer, jump: edge, jumpHeld: bool, spin: edge }
  step(flags) {
    const dt = STEP;
    const d = this.def;
    this.jumped = false;
    this.landed = false;
    if (this.invuln > 0) this.invuln -= 1;
    const stunned = this.stun > 0;
    if (stunned) this.stun -= 1;

    if (flags.spin && !stunned && this.spinT <= 0) this.spinT = 28; // ~0.46s
    if (this.spinT > 0) this.spinT -= 1;

    // auto-run along +Z, steering blends lateral speed; wind pushes
    // regardless of control. Stun locks out steering + wind.
    const targetVz = this.autoRun && !stunned ? d.speed : 0;
    const steer = stunned ? 0 : flags.x * d.speed * 0.85 * (d.steer ?? 1);
    const targetVx = steer + (stunned ? 0 : (flags.windX || 0));
    const air = !this.grounded;
    const airMul = air ? 0.6 * (d.airCtrl ?? 1) : 1;
    this.vz = approach(this.vz, targetVz, d.accel * airMul * dt);
    this.vx = approach(this.vx, targetVx, d.accel * airMul * dt);
    if (!this.autoRun && !air) this.vx = approach(this.vx, 0, d.friction * dt);

    // jump: buffer the press, consume within buffer or coyote window
    if (flags.jump && !stunned) this.buffer = BUFFER;
    else if (this.buffer > 0) this.buffer -= 1;
    if (this.buffer > 0 && (this.grounded || this.coyote > 0)) {
        this.jumped = true;
      this.vy = d.jump;
      this.grounded = false;
      this.cutArmed = true;
      this.coyote = 0;
      this.buffer = 0;
    }
    // variable height: releasing early cuts the rise exactly once
    if (this.cutArmed && !flags.jumpHeld && this.vy > 0) {
      this.vy *= JUMP_CUT;
      this.cutArmed = false;
    }

    // gravity: hold-jump rises floatier, floaty heroes drift down,
    // spin drags you to the floor
    let g = 26;
    if (this.vy > 0 && flags.jumpHeld) g *= 0.82;
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
