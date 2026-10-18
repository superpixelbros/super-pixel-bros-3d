// Renderer: three.js scene assembly + per-frame sync from game logic.
// All geometry is code-built (boxes/cylinders) — the no-asset-file promise
// continues; textures/materials stay flat-shaded for the chunky look.

import * as THREE from 'three';
import { view } from './view.js';
import { buildHero } from './models.js';
import { CHARACTERS, HERO_RADIUS, HERO_HALF } from './hero.js';
import { LEVELS } from './levels.js';

// capsule center → feet, derived from the collider constants
const FEET = HERO_HALF + HERO_RADIUS;
const SKY = 0x9ad8f5;

export class Renderer {
  constructor(canvas) {
    this.r = new THREE.WebGLRenderer({
      canvas,
      antialias: !(view.coarse),          // MSAA is pricey on phones
      powerPreference: 'high-performance',
    });
    this.r.setPixelRatio(view.dpr);
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.12;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 34, 96);

    this.cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 160);
    this.cam.position.set(0, 3, -9);

    this.hemi = new THREE.HemisphereLight(0xcfeaff, 0x8a7a55, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(512, 512);
    Object.assign(this.sun.shadow.camera,
      { left: -9, right: 9, top: 11, bottom: -7, near: 2, far: 44 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);

    // sea + menu pedestal + map diorama live forever; course meshes rebuild
    this.seaMat = new THREE.MeshLambertMaterial({ color: 0x2f8fd0 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(-60, -1.7, 40);
    this.scene.add(sea);

    this.pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.25, 0.42, 24),
      new THREE.MeshLambertMaterial({ color: 0xc9b98a })
    );
    this.pedestal.position.set(0, 0.21, -14);
    this.pedestal.receiveShadow = true;
    this.scene.add(this.pedestal);

    this.courseGroup = new THREE.Group();
    this.scene.add(this.courseGroup);
    this.rivalGroup = new THREE.Group();
    this.scene.add(this.rivalGroup);
    this.rivalParts = [];

    this.buildDiorama();

    this.heroKey = null;   // 'play:rosso' | 'menu:rosso' | 'map:rosso'
    this.heroParts = null;
    this.menuAngle = 0;
    this.camPos = new THREE.Vector3(0, 3, -9);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.resize();
  }

  // ---- adventure map diorama (persistent) --------------------------------
  // Two themed islands on the sea, bridge, a flag per stage, gold cursor
  // ring. Node i sits at x = i*6 — keep in sync with Game.mapHeroPos().
  buildDiorama() {
    const g = this.diorama = new THREE.Group();
    g.visible = false;
    this.scene.add(g);
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });

    LEVELS.forEach((lvl, i) => {
      const island = new THREE.Mesh(
        new THREE.CylinderGeometry(1.55, 1.9, 0.9, 9),
        mat(lvl.theme.sand)
      );
      island.position.set(i * 6, 0, 0);
      island.receiveShadow = true;
      g.add(island);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), mat(0xd8d4c8));
      pole.position.set(i * 6 + 0.85, 1.0, -0.7);
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.32, 0.03), mat(i === LEVELS.length - 1 ? 0xffd23e : 0xe04a3f));
      flag.position.set(i * 6 + 1.08, 1.36, -0.7);
      g.add(pole, flag);
    });

    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.22, 0.7), mat(0x8a5a33));
    bridge.position.set(3, 0.34, 0);
    g.add(bridge);

    this.mapRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.04, 20),
      mat(0xffd23e)
    );
    this.mapRing.position.set(0, 0.48, 0);
    g.add(this.mapRing);
  }

  // ---- rival meshes (rebuilt every race) -----------------------------------
  setRivals(rivals) {
    for (const parts of this.rivalParts) {
      this.rivalGroup.remove(parts.group);
      parts.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.rivalParts = (rivals || []).map((r) => {
      const parts = buildHero(r.player.def);
      parts.group.scale.setScalar(0.9);
      this.rivalGroup.add(parts.group);
      return parts;
    });
  }

  // ---- course meshes (rebuilt every run) --------------------------------
  clearCourse() {
    this.courseGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.courseGroup.clear();
  }

  buildCourse(course) {
    this.clearCourse();
    const th = course.theme;
    // the level's theme owns the whole mood: sky, fog, sea, light
    this.scene.background.setHex(th.sky);
    this.scene.fog.color.setHex(th.sky);
    this.seaMat.color.setHex(th.sea);
    this.sun.color.setHex(th.sun);
    this.hemi.color.setHex(th.sky).multiplyScalar(0.85);
    this.hemi.groundColor.setHex(th.hemiGround);

    const mat = (color) => new THREE.MeshLambertMaterial({ color });
    const add = (mesh, x, y, z) => {
      mesh.position.set(x, y, z);
      this.courseGroup.add(mesh);
      return mesh;
    };
    const sand = mat(th.sand), rock = mat(th.rock), wood = mat(th.wood);

    for (const s of course.segs) {
      const m = add(new THREE.Mesh(
        new THREE.BoxGeometry(s.x1 - s.x0, 2, s.z1 - s.z0), sand),
      (s.x0 + s.x1) / 2, s.top - 1, (s.z0 + s.z1) / 2);
      m.receiveShadow = true;
    }
    const sandDark = mat(th.sandDark);
    for (const s of course.shoulders) {
      const m = add(new THREE.Mesh(
        new THREE.BoxGeometry(s.x1 - s.x0, 2, s.z1 - s.z0), sandDark),
      (s.x0 + s.x1) / 2, s.top - 1, (s.z0 + s.z1) / 2);
      m.receiveShadow = true;
    }
    for (const s of course.steps) {
      const m = add(new THREE.Mesh(
        new THREE.BoxGeometry(s.x1 - s.x0, 2, s.z1 - s.z0), rock),
      (s.x0 + s.x1) / 2, s.top - 1, (s.z0 + s.z1) / 2);
      m.receiveShadow = true;
      m.castShadow = true;
    }

    this.coinMeshes = [];
    for (const c of course.coins) {
      const m = add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14).rotateX(Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xffd23e })
      ), c.x, c.y, c.z);
      this.coinMeshes.push(m);   // no castShadow: 25 spinners in the depth pass is pure cost
    }

    this.hammerMeshes = course.hammers.map((h) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.1, 12), wood)
        .translateY(0.5));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.54, 0.54), wood);
      arm.position.set(1.55, 0.55, 0);
      arm.castShadow = true;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7),
        mat(0xc0392b));
      tip.position.set(4.1, 0.55, 0);
      g.add(arm, tip);
      g.position.set(0, 0, h.z);
      this.courseGroup.add(g);
      return { body: h.body, g };
    });

    this.pillarMeshes = course.pillars.map((p) => {
      const m = add(new THREE.Mesh(
        new THREE.BoxGeometry(p.half * 2, 0.6, p.half * 2), wood),
      p.x, p.y0, p.z);
      m.castShadow = true;
      return { body: p.body, m };
    });

    // finish pad + flagpole
    add(new THREE.Mesh(new THREE.BoxGeometry(9, 0.16, 2.4), mat(0xf4f1e8)),
      0, 0.08, course.finishZ + 1);
    const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 8),
      mat(0xd8d4c8)), 3.6, 2.2, course.finishZ + 1.4);
    pole.castShadow = true;
    add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.06), mat(0xe04a3f)),
      2.9, 3.7, course.finishZ + 1.4);

    for (const d of course.decor) {
      if (d.kind === 'palm') {
        const g = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 3.2, 7), wood);
        trunk.position.y = 1.6;
        trunk.castShadow = true;
        g.add(trunk);
        for (let i = 0; i < 5; i++) {
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.5),
            mat(0x3f9d4e));
          leaf.position.set(Math.cos(i * 1.26) * 0.8, 3.3, Math.sin(i * 1.26) * 0.8);
          leaf.rotation.y = -i * 1.26;
          leaf.rotation.z = 0.22;
          g.add(leaf);
        }
        g.position.set(d.x, 0, d.z);
        this.courseGroup.add(g);
      } else if (d.kind === 'rock') {
        add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.9), rock), d.x, 0.4, d.z)
          .castShadow = true;
      }
    }
  }

  // ---- hero mesh ---------------------------------------------------------
  setHero(key) {
    if (key === this.heroKey) return;
    if (this.heroParts) {
      this.heroParts.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.scene.remove(this.heroParts.group);
    }
    const [mode, id] = key.split(':');
    const def = CHARACTERS[id] || CHARACTERS.rosso;
    this.heroParts = buildHero(def);
    // 10% smaller in play; menu showcase full size; map diorama tiny
    const scale = mode === 'play' ? 0.9 : mode === 'map' ? 0.45 : 1;
    this.heroParts.group.scale.setScalar(scale);
    this.scene.add(this.heroParts.group);
    this.heroKey = key;
  }

  // ---- per-frame ---------------------------------------------------------
  sync(game, state) {
    const t = performance.now() / 1000;
    const p = state === 'play' || state === 'pause' || state === 'clear'
      ? game.player : null;

    if (this.coinMeshes) {
      let i = 0;
      for (const c of (game.course ? game.course.coins : [])) {
        const m = this.coinMeshes[i++];
        if (!m) continue;
        m.visible = !c.taken;
        m.rotation.y = t * 3;
        m.position.y = c.y + Math.sin(t * 2 + c.z) * 0.08;
      }
    }
    if (game.course) {
      for (const h of this.hammerMeshes) {
        const q = h.body.rotation();
        h.g.quaternion.set(q.x, q.y, q.z, q.w);
      }
      for (const pm of this.pillarMeshes) {
        pm.m.position.y = pm.body.translation().y;
      }
    }

    // which world we're looking at
    this.courseGroup.visible = !!game.course && state !== 'map';
    this.pedestal.visible = state === 'title' || state === 'select';
    this.diorama.visible = state === 'map';

    if (p) {
      const pos = p.pos;
      const hp = this.heroParts.group;
      hp.position.set(pos.x, pos.y - FEET, pos.z);
      hp.rotation.y = p.yaw;
      // spin-attack: whole-body pirouette
      if (p.spinT > 0) {
        hp.rotation.y += p.spinT * 1.4;
      } else if (!p.grounded) {
        poseAir(p, this.heroParts);
      } else {
        poseWalk(p, this.heroParts, hp);
      }
    }

    // rivals race only inside the course world
    this.rivalGroup.visible = (state === 'play' || state === 'pause'
      || state === 'clear') && this.rivalParts.length > 0;
    if (this.rivalGroup.visible) {
      for (let i = 0; i < game.rivals.length; i++) {
        const p = game.rivals[i].player;
        const parts = this.rivalParts[i];
        const pos = p.pos;
        const g = parts.group;
        g.position.set(pos.x, pos.y - FEET, pos.z);
        g.rotation.y = p.yaw;
        if (p.spinT > 0) g.rotation.y += p.spinT * 1.4;
        else if (!p.grounded) poseAir(p, parts);
        else poseWalk(p, parts, g);
      }
    }

    // menu hero idles on the pedestal, slowly turning
    if (!p && this.heroParts && state !== 'map') {
      const hp = this.heroParts.group;
      hp.position.set(0, 0.42 + Math.sin(t * 2) * 0.02, -14);
      hp.rotation.y = t * 0.7;
      const s = Math.sin(t * 4) * 0.12;   // tiny ready-bounce
      this.heroParts.armL.rotation.x = s;
      this.heroParts.armR.rotation.x = -s;
    }

    // map hero stands on (or walks between) the diorama nodes
    if (state === 'map' && this.heroParts) {
      const mp = game.mapHeroPos();
      const hp = this.heroParts.group;
      hp.position.set(mp.x, 0.46, 0);
      hp.rotation.y = Math.PI / 2;        // face the next island
      const s = mp.walking ? Math.sin(t * 11) * 0.7 : 0;
      this.heroParts.legL.rotation.x = s;
      this.heroParts.legR.rotation.x = -s;
      this.heroParts.armL.rotation.x = -s * 0.6;
      this.heroParts.armR.rotation.x = s * 0.6;
      this.mapRing.position.x = game.map.cursor * 6;
      this.mapRing.rotation.y = t * 0.8;
    }

    // camera
    if (state === 'title' || state === 'select') {
      this.menuAngle += 0.004;
      const a = this.menuAngle;
      this.lerpCam(
        Math.sin(a) * 4.4, 2.1, -14 + Math.cos(a) * 4.4,
        0, 1.1, -14
      );
    } else if (state === 'map') {
      this.lerpCam(
        3 + Math.sin(t * 0.18) * 0.7, 4.3, 7.2,
        3, 0.5, 0
      );
    } else if (p) {
      const pos = p.pos;
      this.lerpCam(
        pos.x * 0.62, pos.y + 2.5, pos.z - 5.4,
        pos.x * 0.45, pos.y - 0.2, pos.z + 4.5
      );
    }
    // sun follows the action so the shadow frustum stays local
    let sx = 0, sz = -14;
    if (p) { sx = p.pos.x; sz = p.pos.z; }
    else if (state === 'map') { sx = 3; sz = 0; }
    this.sun.position.set(sx + 8, 16, sz - 6);
    this.sun.target.position.set(sx, 0, sz);
  }

  lerpCam(x, y, z, lx, ly, lz) {
    const k = 0.085;
    this.camPos.lerp(new THREE.Vector3(x, y, z), k);
    this.camLook.lerp(new THREE.Vector3(lx, ly, lz), k);
    this.cam.position.copy(this.camPos);
    this.cam.lookAt(this.camLook);
  }

  render() {
    this.r.render(this.scene, this.cam);
  }

  resize() {
    this.r.setPixelRatio(view.dpr);
    this.r.setSize(view.w, view.h, false);
    this.cam.aspect = view.w / view.h;
    this.cam.updateProjectionMatrix();
  }
}

// walk-cycle / air poses driven by the player's anim clock (metres walked).
// NOTE: these receive the heroParts bundle (group + limbs), not the group —
// reaching for parts on the group silently killed the run animation once.
function poseWalk(p, parts, hp) {
  const s = Math.sin(p.animT * 1.1);          // stride frequency (animT ≈ metres)
  parts.legL.rotation.x = s * 0.95;
  parts.legR.rotation.x = -s * 0.95;
  parts.armL.rotation.x = -s * 0.8;
  parts.armR.rotation.x = s * 0.8;
  hp.position.y += Math.abs(Math.sin(p.animT * 1.1)) * 0.035; // run bob
  hp.rotation.x = -0.07;                       // lean into the run
}

function poseAir(p, parts) {
  parts.legL.rotation.x = -0.55;               // knees tucked
  parts.legR.rotation.x = 0.35;
  parts.armL.rotation.x = -2.2;                // arms up
  parts.armR.rotation.x = -2.2;
}
