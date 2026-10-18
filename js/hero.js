// Heroes: stat table + the physics-driven player. Pure logic — Rapier and
// math only, no three.js — so headless checks can simulate heroes without
// a browser. The renderer reads pos/yaw/anim state from here each frame.
//
// Control model is Crash-Bandicoot style AUTO-RUN: the hero always runs
// along +Z (course direction); the stick/keys steer left/right, Space
// jumps, Down/Shift spin-attacks. One axis of input, all the fun.

import { STEP } from './phys.js';

// speed m/s, accel m/s², jump launch m/s (gravity 26 ⇒ apex ≈ v²/52)
export const CHARACTERS = {
  rosso: { speed: 6.4, accel: 42, friction: 55, jump: 10.8, hp: 2,
    color: 0xe04a3f, style: 'cap' },
  bolt:  { speed: 8.8, accel: 56, friction: 50, jump: 10.4, hp: 1,
    color: 0xf2c23e, style: 'cap' },
  aqua:  { speed: 6.8, accel: 44, friction: 52, jump: 13.0, hp: 1,
    color: 0x3f9be0, style: 'cap', floaty: true },
  faris: { speed: 4.8, accel: 30, friction: 70, jump: 10.2, hp: 3,
    color: 0xd8d4c8, style: 'keffiyeh' },
  sahm:  { speed: 10.6, accel: 72, friction: 10, jump: 8.4, hp: 1,
    color: 0x58b060, style: 'fletch' },
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
  }

  get pos() { return this.body.translation(); }

  // flags: { x: -1|0|1 steer, jump: edge, jumpHeld: bool, spin: edge }
  step(flags) {
    const dt = STEP;
    const d = this.def;
    this.jumped = false;
    this.landed = false;
    if (flags.spin && this.spinT <= 0) this.spinT = 28; // ~0.46s
    if (this.spinT > 0) this.spinT -= 1;

    // auto-run along +Z, steering blends lateral speed
    const targetVz = this.autoRun ? d.speed : 0;
    const targetVx = flags.x * d.speed * 0.85;
    const air = !this.grounded;
    this.vz = approach(this.vz, targetVz, d.accel * (air ? 0.6 : 1) * dt);
    this.vx = approach(this.vx, targetVx, d.accel * (air ? 0.6 : 1) * dt);
    if (!this.autoRun && !air) this.vx = approach(this.vx, 0, d.friction * dt);

    // jump: buffer the press, consume within buffer or coyote window
    if (flags.jump) this.buffer = BUFFER;
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
