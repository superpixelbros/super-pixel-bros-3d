// Procedural pixel-soul characters: every hero is assembled from boxes in
// code (the 3D continuation of the 2D project's rects-only sprites.js).
// Origin is at the feet; total height ≈ 1.4m to match the capsule collider.

import * as THREE from 'three';

const SKIN = 0xf0c08a;
const DARK = 0x35435e;
const WHITE = 0xf4f1e8;

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color })
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// pivot helper: mesh hangs below a group so rotation swings the limb
function limb(w, h, d, color, px, py, pz) {
  const g = new THREE.Group();
  g.position.set(px, py, pz);
  g.add(box(w, h, d, color, 0, -h / 2, 0));
  return g;
}

export function buildHero(def) {
  const g = new THREE.Group();

  const legL = limb(0.15, 0.42, 0.16, DARK, -0.13, 0.44, 0);
  const legR = limb(0.15, 0.42, 0.16, DARK, 0.13, 0.44, 0);
  const armL = limb(0.12, 0.4, 0.13, def.color, -0.32, 0.92, 0);
  const armR = limb(0.12, 0.4, 0.13, def.color, 0.32, 0.92, 0);
  g.add(legL, legR, armL, armR);

  g.add(box(0.5, 0.52, 0.32, def.color, 0, 0.68, 0));      // torso
  g.add(box(0.54, 0.12, 0.36, DARK, 0, 0.5, 0));           // belt line
  const head = box(0.4, 0.38, 0.36, SKIN, 0, 1.16, 0);
  g.add(head);
  g.add(box(0.09, 0.1, 0.03, WHITE, -0.09, 1.2, 0.185));    // eyes
  g.add(box(0.09, 0.1, 0.03, WHITE, 0.09, 1.2, 0.185));
  g.add(box(0.04, 0.06, 0.03, 0x20242e, -0.09, 1.19, 0.2));
  g.add(box(0.04, 0.06, 0.03, 0x20242e, 0.09, 1.19, 0.2));

  if (def.style === 'cap') {
    g.add(box(0.44, 0.12, 0.4, def.color, 0, 1.4, 0));
    g.add(box(0.46, 0.06, 0.2, def.color, 0, 1.35, 0.28));  // brim
    g.add(box(0.12, 0.1, 0.04, WHITE, 0, 1.41, 0.19));      // badge
  } else if (def.style === 'keffiyeh') {
    g.add(box(0.48, 0.14, 0.44, WHITE, 0, 1.4, 0));         // crown cloth
    g.add(box(0.46, 0.34, 0.14, WHITE, 0, 1.22, -0.2));     // back drape
    g.add(box(0.5, 0.06, 0.46, 0x2b2b30, 0, 1.44, 0));      // agal band
  } else if (def.style === 'fletch') {
    g.add(box(0.44, 0.08, 0.4, def.color, 0, 1.38, 0));     // headband
    const f1 = box(0.05, 0.3, 0.06, WHITE, 0.08, 1.56, -0.1);
    const f2 = box(0.05, 0.36, 0.06, def.color, 0, 1.58, -0.12);
    const f3 = box(0.05, 0.28, 0.06, WHITE, -0.08, 1.54, -0.1);
    g.add(f1, f2, f3);
    g.add(box(0.14, 0.36, 0.1, 0x7a5230, 0, 0.96, -0.24));  // quiver
  }

  return { group: g, legL, legR, armL, armR, head };
}
