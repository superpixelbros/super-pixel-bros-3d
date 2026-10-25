// Procedural pixel-soul characters — chunky shapes with rounded edges:
// tapered torso, capsule limbs with boots/gloves, a soft head with big
// expressive eyes, plus a per-style headpiece and a derived accent colour.
// Every hero is still assembled in code (no assets). Origin at the feet,
// total height ≈ 1.4 m so it matches the capsule collider, and the joint
// contract is unchanged: { group, legL, legR, armL, armR, head }.

import * as THREE from 'three';

const SKIN = 0xf0c08a;
const SKIN_SHADE = 0xd9a271;
const DARK = 0x35435e;
const WHITE = 0xf4f1e8;
const INK = 0x20242e;
const GOLD = 0xffd23e;

// lighten (f > 1) / darken (f < 1) a 0xRRGGBB colour
function shade(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function mat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function mesh(geo, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  return mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z);
}

function ball(r, color, x = 0, y = 0, z = 0, sy = 1, sz = 1) {
  const m = mesh(new THREE.SphereGeometry(r, 16, 12), color, x, y, z);
  m.scale.set(1, sy, sz);
  return m;
}

// pivot helper: geometry hangs below the group so rotation swings the limb
function limbBase(px, py, pz) {
  const g = new THREE.Group();
  g.position.set(px, py, pz);
  return g;
}

function makeLeg(color, accent, px) {
  const g = limbBase(px, 0.47, 0);
  g.add(mesh(new THREE.CapsuleGeometry(0.085, 0.18, 6, 12), color, 0, -0.2, 0));
  // boot: rounded toe box, slightly forward
  const boot = mesh(new THREE.CapsuleGeometry(0.07, 0.16, 4, 10), accent, 0, -0.41, 0.02);
  boot.rotation.z = Math.PI / 2;
  boot.scale.set(0.9, 1.15, 1.45);
  g.add(boot);
  g.add(box(0.19, 0.05, 0.27, shade(accent, 0.8), 0, -0.455, 0.03));
  return g;
}

function makeArm(color, accent, px) {
  const g = limbBase(px, 0.93, 0);
  g.add(mesh(new THREE.CapsuleGeometry(0.07, 0.19, 6, 12), color, 0, -0.17, 0));
  g.add(ball(0.085, accent, 0, -0.33, 0, 1.05, 1.05));      // glove
  const wrist = mesh(new THREE.TorusGeometry(0.074, 0.02, 6, 12),
    shade(color, 1.2), 0, -0.25, 0);
  wrist.rotation.x = Math.PI / 2;                            // wristband
  g.add(wrist);
  return g;
}

export function buildHero(def) {
  const g = new THREE.Group();
  const base = def.color;
  const accent = shade(base, 1.28);      // straps / gloves / boots
  const deep = shade(base, 0.72);        // belt / trim

  const legL = makeLeg(DARK, accent, -0.13);
  const legR = makeLeg(DARK, accent, 0.13);
  const armL = makeArm(base, accent, -0.31);
  const armR = makeArm(base, accent, 0.31);
  g.add(legL, legR, armL, armR);

  // hips + tapered torso (shoulders wider than the waist)
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 14), deep, 0, 0.45, 0));
  const torso = mesh(new THREE.CylinderGeometry(0.27, 0.2, 0.5, 16), base, 0, 0.72, 0);
  torso.castShadow = true;
  g.add(torso);
  // chest panel + belt + shoulder pads
  g.add(box(0.22, 0.3, 0.06, accent, 0, 0.76, 0.235));
  g.add(box(0.46, 0.08, 0.3, deep, 0, 0.5, 0));
  g.add(ball(0.11, accent, -0.27, 0.93, 0, 0.9, 0.9));
  g.add(ball(0.11, accent, 0.27, 0.93, 0, 0.9, 0.9));
  const collar = mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 14),
    shade(accent, 1.15), 0, 0.965, 0);
  collar.rotation.x = Math.PI / 2;                           // collar
  g.add(collar);

  // neck + soft head
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 10), SKIN_SHADE, 0, 1.0, 0));
  const head = ball(0.245, SKIN, 0, 1.18, 0.01, 0.97, 0.93);
  head.castShadow = true;
  g.add(head);
  g.add(ball(0.07, SKIN_SHADE, 0, 1.14, 0.235, 0.8, 0.7));    // nose
  g.add(ball(0.055, SKIN_SHADE, -0.23, 1.16, 0));             // ears
  g.add(ball(0.055, SKIN_SHADE, 0.23, 1.16, 0));

  // eyes: whites + pupils + brows + smile
  for (const s of [-1, 1]) {
    g.add(ball(0.075, WHITE, s * 0.09, 1.22, 0.19, 1.1, 0.75));
    g.add(ball(0.038, INK, s * 0.085, 1.215, 0.245, 1.1, 0.8));
    g.add(ball(0.014, WHITE, s * 0.075, 1.235, 0.268));       // catchlight
    const brow = box(0.09, 0.022, 0.03, INK, s * 0.09, 1.295, 0.21);
    brow.rotation.z = s * -0.18;
    g.add(brow);
  }
  const smile = mesh(new THREE.TorusGeometry(0.07, 0.016, 6, 12, Math.PI), INK,
    0, 1.075, 0.225);
  smile.rotation.set(0.15, 0, Math.PI);
  g.add(smile);

  // ---- per-style headgear ------------------------------------------------
  if (def.style === 'cap') {
    const crown = mesh(new THREE.SphereGeometry(0.255, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      base, 0, 1.18, 0.01);
    crown.scale.set(1.02, 1.08, 1.0);
    g.add(crown);
    const brim = mesh(new THREE.CapsuleGeometry(0.09, 0.22, 4, 10), deep, 0, 1.34, 0.19);
    brim.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    brim.scale.set(1.25, 1, 0.3);
    g.add(brim);
    g.add(ball(0.05, GOLD, 0, 1.39, 0.12));                   // badge
  } else if (def.style === 'keffiyeh') {
    const cloth = mesh(new THREE.SphereGeometry(0.265, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.7),
      WHITE, 0, 1.18, 0.01);
    cloth.scale.set(1.02, 1.05, 1.02);
    g.add(cloth);
    g.add(box(0.38, 0.4, 0.12, WHITE, 0, 1.0, -0.24));        // back drape
    const agal = mesh(new THREE.TorusGeometry(0.245, 0.028, 8, 18), INK, 0, 1.4, 0);
    agal.rotation.x = Math.PI / 2;
    g.add(agal);
    g.add(box(0.05, 0.2, 0.04, shade(WHITE, 0.9), 0.2, 1.28, 0.16)); // headscarf tail
  } else if (def.style === 'fletch') {
    const band = mesh(new THREE.TorusGeometry(0.245, 0.03, 8, 18),
      accent, 0, 1.29, 0);
    band.rotation.x = Math.PI / 2;                           // headband
    g.add(band);
    const f1 = box(0.04, 0.3, 0.05, WHITE, 0.06, 1.5, -0.12);
    f1.rotation.z = -0.25;
    const f2 = box(0.045, 0.38, 0.05, base, 0, 1.53, -0.14);
    f2.rotation.z = -0.05;
    const f3 = box(0.04, 0.28, 0.05, WHITE, -0.07, 1.48, -0.12);
    f3.rotation.z = 0.28;
    g.add(f1, f2, f3);
    g.add(box(0.14, 0.34, 0.1, 0x7a5230, 0, 0.86, -0.26));    // quiver
    g.add(box(0.03, 0.24, 0.03, WHITE, -0.05, 0.99, -0.31));
    g.add(box(0.03, 0.24, 0.03, WHITE, 0.05, 0.99, -0.31));
  } else if (def.style === 'crown') {
    const band = mesh(new THREE.CylinderGeometry(0.235, 0.245, 0.13, 14), GOLD, 0, 1.4, 0);
    g.add(band);
    for (const [px, ph] of [[-0.16, 0.14], [0, 0.2], [0.16, 0.14]]) {
      g.add(mesh(new THREE.ConeGeometry(0.07, ph, 8), GOLD, px, 1.5, 0.02));
      g.add(ball(0.028, 0xe04a3f, px, 1.53 + ph * 0.5, 0.02));
    }
    g.add(box(0.08, 0.08, 0.06, 0xe04a3f, 0, 1.38, 0.23));    // ruby
  }

  return { group: g, legL, legR, armL, armR, head };
}

// The trophy: a chunky gold cup in the same boxes-and-cylinders language
// as the heroes. Origin sits at the grip (bottom of the base) so it can be
// parented straight to a hand pivot and stay put while the arm swings.
export function buildTrophy() {
  const g = new THREE.Group();
  const gold = new THREE.MeshLambertMaterial({ color: 0xffd23e, emissive: 0x5c4000 });
  const add = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, gold);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.16, 0.05, 0.16), 0, 0.025, 0);          // base
  add(new THREE.BoxGeometry(0.05, 0.09, 0.05), 0, 0.095, 0);          // stem
  add(new THREE.CylinderGeometry(0.12, 0.065, 0.16, 12), 0, 0.22, 0); // bowl
  add(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 12), 0, 0.31, 0);  // rim
  for (const s of [-1, 1]) {                                          // handles
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 14), gold);
    h.position.set(s * 0.14, 0.22, 0);
    h.rotation.y = Math.PI / 2;
    g.add(h);
  }
  return g;
}
