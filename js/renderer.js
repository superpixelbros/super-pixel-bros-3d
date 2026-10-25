// Renderer: three.js scene assembly + per-frame sync from game logic.
// All geometry is code-built (boxes/cylinders) — the no-asset-file promise
// continues; textures/materials stay flat-shaded for the chunky look.

import * as THREE from 'three';
import { view } from './view.js';
import { buildHero, buildTrophy } from './models.js';
import { CHARACTERS, HERO_RADIUS, HERO_HALF } from './hero.js';
import { LEVELS, ARENA, CRATES, MAP_SPACING } from './levels.js';

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
    // second player camera (split screen); same scene, own viewport
    this.cam2 = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 160);
    this.cam2.position.set(0, 3, -9);
    this.cam2Pos = new THREE.Vector3(0, 3, -9);
    this.cam2Look = new THREE.Vector3(0, 1, 0);
    this.twoPlayer = false;
    this.splitMode = 'v';        // 'v' side-by-side | 'h' stacked
    this.hero2Parts = null;
    this.hero2Key = '';

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

    // pickup-modifier aura: a pulsing foot ring under the hero while a
    // boost or jinx runs — gold vs bruise purple, invisible when clean
    this.modRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.05, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.9 })
    );
    this.modRing.rotation.x = Math.PI / 2;
    this.modRing.visible = false;
    this.scene.add(this.modRing);

    this.heroKey = null;   // 'play:hero' | 'menu:hero' | 'map:hero'
    this.heroParts = null;
    this.selectHero = null; // showcase anchor { px, py, room } | null
    this.trophyMesh = null; // parented to armR while the hero holds the cup
    this.wantTrophy = false;
    this.menuAngle = 0;
    this.camPos = new THREE.Vector3(0, 3, -9);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.resize();
  }

  // ---- adventure map diorama (persistent) --------------------------------
  // Two themed islands on the sea, bridge, a flag per stage, gold cursor
  // ring. Node i sits at x = i*MAP_SPACING — shared with Game.mapHeroPos().
  buildDiorama() {
    const g = this.diorama = new THREE.Group();
    g.visible = false;
    this.scene.add(g);
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    let lastRace = 0;
    LEVELS.forEach((l, i) => { if ((l.mode || 'race') !== 'survival') lastRace = i; });

    LEVELS.forEach((lvl, i) => {
      const arena = (lvl.mode || 'race') === 'survival';
      const island = new THREE.Mesh(
        arena
          ? new THREE.CylinderGeometry(1.7, 2.0, 0.9, 20)   // arena: round stage
          : new THREE.CylinderGeometry(1.55, 1.9, 0.9, 9),
        mat(lvl.theme.sand)
      );
      island.position.set(i * MAP_SPACING, 0, 0);
      island.receiveShadow = true;
      g.add(island);
      if (arena) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.2, 0.06, 6, 24), mat(0xffd23e));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(i * MAP_SPACING, 0.5, 0);
        g.add(ring);
      }
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), mat(0xd8d4c8));
      pole.position.set(i * MAP_SPACING + 0.85, 1.0, -0.7);
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.32, 0.03),
        mat(arena ? 0xffd23e : i === lastRace ? 0xffd23e : 0xe04a3f));
      flag.position.set(i * MAP_SPACING + 1.08, 1.36, -0.7);
      g.add(pole, flag);
    });

    for (let i = 0; i < LEVELS.length - 1; i++) {
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(MAP_SPACING - 2.6, 0.22, 0.7), mat(0x8a5a33));
      bridge.position.set(i * MAP_SPACING + MAP_SPACING / 2, 0.34, 0);
      g.add(bridge);
    }

    this.mapRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.04, 20),
      mat(0xffd23e)
    );
    this.mapRing.position.set(0, 0.48, 0);
    g.add(this.mapRing);

    // travel beacon: a gold chevron bobbing over the node the hero is
    // walking to — the map reads as a journey, not a jump cut
    this.mapBeacon = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.8, 4),
      new THREE.MeshLambertMaterial({ color: 0xffd23e, emissive: 0x6a4b00 })
    );
    this.mapBeacon.rotation.x = Math.PI;    // point down at the island
    this.mapBeacon.visible = false;
    g.add(this.mapBeacon);
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

    // speed pickups: golden boost rings with an up-arrow + brooding purple
    // jinx blobs. No colliders — the game layer picks them up by proximity.
    const boostMat = new THREE.MeshLambertMaterial({
      color: 0xffd23e, emissive: 0x7a5200,
    });
    this.boostMeshes = course.boosts.map((u) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.08, 8, 22), boostMat));
      g.add(new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.34, 4), boostMat));
      return add(g, u.x, u.y, u.z);
    });
    const jinxMat = new THREE.MeshLambertMaterial({
      color: 0x8a3fb0, emissive: 0x2d0b45,
    });
    this.jinxMeshes = course.curses.map((u) => add(
      new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 0), jinxMat),
      u.x, u.y, u.z));

    this.hammerMeshes = course.hammers.map((h) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.1, 12), wood)
        .translateY(0.5));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(h.len * 2, 0.54, 0.54), wood);
      arm.position.set(h.len / 2, 0.55, 0);
      arm.castShadow = true;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7),
        mat(0xc0392b));
      tip.position.set(h.len * 1.32, 0.55, 0);
      g.add(arm, tip);
      g.position.set(0, 0, h.z);
      this.courseGroup.add(g);
      return { body: h.body, h, g };
    });

    this.pillarMeshes = course.pillars.map((p) => {
      const m = add(new THREE.Mesh(
        new THREE.BoxGeometry(p.half * 2, 0.6, p.half * 2), wood),
      p.x, p.y0, p.z);
      m.castShadow = true;
      return { body: p.body, m };
    });

    // swinging wrecking ball + rope
    const iron = mat(0x6b6f76), ropeM = mat(0x3a3a3a);
    this.pendulumMeshes = course.pendulums.map((p) => {
      const g = new THREE.Group();
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), ropeM);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(p.r, 14, 12), iron);
      ball.castShadow = true;
      g.add(rope, ball);
      this.courseGroup.add(g);
      return { p, g, rope, ball };
    });
    // rolling logs
    const bark = mat(0x8a5a33);
    this.rollerMeshes = course.rollers.map((r) => {
      const m = add(new THREE.Mesh(
        new THREE.CylinderGeometry(r.r, r.r, 1.2, 14).rotateZ(Math.PI / 2), bark),
      0, r.r, r.z);
      m.castShadow = true;
      return { r, m };
    });
    // sweeping pistons
    const steel = mat(0xb0503a);
    this.pistonMeshes = course.pistons.map((p) => {
      const m = add(new THREE.Mesh(
        new THREE.BoxGeometry(1.4, p.hy * 2, 1), steel), 0, p.hy, p.z);
      m.castShadow = true;
      return { p, m };
    });
    // crumble slabs (cracked stone look via darker top)
    this.crumbleMeshes = course.crumbles.map((c) => {
      const m = add(new THREE.Mesh(
        new THREE.BoxGeometry(c.x1 - c.x0, 2, c.z1 - c.z0), mat(0x9a8f7a)),
      0, c.top - 1, (c.z0 + c.z1) / 2);
      m.receiveShadow = true;
      return { c, m };
    });
    // bounce pads
    const spring = mat(0x37d17a);
    for (const b of course.bounces) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 0.24, 16), spring),
        b.x, 0.12, b.z);
    }

    // blocking walls: canyon chicanes, portcullis frames, the Needle
    for (const w of course.walls) {
      const m = add(new THREE.Mesh(
        new THREE.BoxGeometry(w.x1 - w.x0, w.h, w.z1 - w.z0), rock),
      (w.x0 + w.x1) / 2, w.top + w.h / 2, (w.z0 + w.z1) / 2);
      m.castShadow = true;
      m.receiveShadow = true;
    }
    // portcullis gates: iron slabs riding their kinematic bodies
    const gateIron = mat(0x535863);
    this.gateMeshes = course.gates.map((gt) => {
      const grp = new THREE.Group();
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(gt.gw, gt.h, 0.24), gateIron);
      slab.castShadow = true;
      grp.add(slab);
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(gt.gw + 0.2, 0.18, 0.34),
        gateIron).translateY(-gt.h / 2 - 0.09));   // toothed bottom bar
      grp.position.set(gt.cx, gt.h / 2, gt.z);
      this.courseGroup.add(grp);
      return { gt, grp };
    });

    // survival arena: the disc floor + the closing gold ring
    this.arenaRing = null;
    if (course.isArena) {
      const disc = add(new THREE.Mesh(
        new THREE.CylinderGeometry(ARENA.floorR, ARENA.floorR + 0.8, 2, 40),
        sand), 0, -1, 0);
      disc.receiveShadow = true;
      const rim = add(new THREE.Mesh(
        new THREE.TorusGeometry(ARENA.floorR, 0.24, 8, 44), sandDark));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.05;
      const ring = add(new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.14, 8, 56),
        new THREE.MeshBasicMaterial({ color: 0xffd23e })), 0, 0.1, 0);
      ring.rotation.x = Math.PI / 2;
      ring.scale.set(course.ringR, course.ringR, 1);
      this.arenaRing = ring;
    }

    // Crate Cove: floating wooden decks — plank top over a deep hull so a
    // sinking crate slides under convincingly. Bodies drive y every tick.
    this.crateMeshes = (course.crates || []).map((k) => {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 2.8, 2.4), wood);
      hull.castShadow = true;
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(2.44, 0.14, 2.44), mat(0xc89a5e));
      deck.position.y = 1.4;
      deck.receiveShadow = true;
      g.add(hull, deck);
      this.courseGroup.add(g);
      // sea foam ring at the waterline
      const foam = new THREE.Mesh(
        new THREE.TorusGeometry(1.75, 0.12, 6, 24),
        new THREE.MeshLambertMaterial(
          { color: 0xeaf6ff, transparent: true, opacity: 0.55 }));
      foam.rotation.x = Math.PI / 2;
      foam.position.set(k.x, -1.55, k.z);
      this.courseGroup.add(foam);
      // splash plume, fired the frame the deck goes under
      const splash = new THREE.Mesh(
        new THREE.ConeGeometry(1.5, 2.2, 10, 1, true),
        new THREE.MeshLambertMaterial(
          { color: 0xeaf6ff, transparent: true, opacity: 0.85 }));
      splash.position.set(k.x, -0.5, k.z);
      splash.visible = false;
      this.courseGroup.add(splash);
      return { k, g, foam, splash, splashT: -1 };
    });

    // finish pad + flagpole (survival has no flag — only the clock)
    if (isFinite(course.finishZ)) {
      add(new THREE.Mesh(new THREE.BoxGeometry(9, 0.16, 2.4), mat(0xf4f1e8)),
        0, 0.08, course.finishZ + 1);
      const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 8),
        mat(0xd8d4c8)), 3.6, 2.2, course.finishZ + 1.4);
      pole.castShadow = true;
      add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.06), mat(0xe04a3f)),
        2.9, 3.7, course.finishZ + 1.4);
    }

    this.crateLife = [];           // animated sea props (Crate Cove only)
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
      } else if (d.kind === 'buoy') {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.8, 10),
          mat(0xe04a3f));
        body.castShadow = true;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.3, 0.16, 10),
          mat(0xf4f1e8));
        band.position.y = 0.12;
        const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 8),
          mat(0xffd23e));
        lamp.position.y = 0.58;
        g.add(body, band, lamp);
        g.position.set(d.x, -1.42, d.z);
        this.courseGroup.add(g);
        this.crateLife.push({ kind: 'buoy', mesh: g, baseY: -1.42, ph: d.ph || 0 });
      } else if (d.kind === 'pier') {
        const g = new THREE.Group();
        const deck = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.22, 1.6), wood);
        deck.position.y = -1.05;
        deck.castShadow = true;
        g.add(deck);
        for (const px of [-2.8, 0, 2.8]) {
          for (const pz of [-0.6, 0.6]) {
            const post = new THREE.Mesh(
              new THREE.CylinderGeometry(0.11, 0.13, 2.2, 6), wood);
            post.position.set(px, -2.0, pz);
            g.add(post);
          }
        }
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22),
          new THREE.MeshLambertMaterial({ color: 0xffd23e, emissive: 0x8a6a00 }));
        lamp.position.set(-3.0, -0.8, 0);
        g.add(lamp);
        g.position.set(d.x, 0, d.z);
        this.courseGroup.add(g);
      } else if (d.kind === 'boat') {
        const g = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.9), wood);
        hull.position.y = 0.1;
        hull.castShadow = true;
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.8),
          mat(0xd8b890));
        seat.position.y = 0.42;
        g.add(hull, seat);
        g.position.set(d.x, -1.5, d.z);
        this.courseGroup.add(g);
        this.crateLife.push({ kind: 'boat', mesh: g, baseY: -1.5, ph: d.ph || 0 });
      } else if (d.kind === 'lighthouse') {
        const g = new THREE.Group();
        const tower = new THREE.Mesh(
          new THREE.CylinderGeometry(0.9, 1.6, 11, 10), mat(0xf4f1e8));
        tower.position.y = 5.5;
        const stripe = new THREE.Mesh(
          new THREE.CylinderGeometry(1.17, 1.3, 1.4, 10), mat(0xe04a3f));
        stripe.position.y = 5.6;
        const cap = new THREE.Mesh(
          new THREE.ConeGeometry(1.15, 1.4, 10), mat(0x8a5a33));
        cap.position.y = 11.7;
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8),
          new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffd23e }));
        light.position.y = 11.35;
        g.add(tower, stripe, cap, light);
        g.position.set(d.x, -1.7, d.z);
        this.courseGroup.add(g);
        this.crateLife.push({ kind: 'lighthouse', light, ph: 0 });
      } else if (d.kind === 'stack') {
        const s = new THREE.Mesh(
          new THREE.DodecahedronGeometry(1.2 * (d.s || 1)), rock);
        s.scale.y = 2.6;
        s.position.set(d.x, 1.3 * (d.s || 1) - 1.7, d.z);
        s.castShadow = true;
        this.courseGroup.add(s);
      } else if (d.kind === 'torch') {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.09, 1.5, 6), wood);
        pole.position.y = 0.75;
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 6),
          new THREE.MeshLambertMaterial({ color: 0xffb03a, emissive: 0xff7a1a }));
        flame.position.y = 1.62;
        g.add(pole, flame);
        g.position.set(d.x, 0.8, d.z);      // stands on the deck plate
        this.courseGroup.add(g);
        this.crateLife.push({ kind: 'torch', flame, ph: (d.x + d.z) * 0.7 });
      } else if (d.kind === 'gull') {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.16),
          mat(0xf4f1e8));
        const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.22),
          mat(0xe8e4da));
        wingL.position.x = -0.45;
        const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.22),
          mat(0xe8e4da));
        wingR.position.x = 0.45;
        g.add(body, wingL, wingR);
        g.position.set(0, d.h || 9, 0);
        this.courseGroup.add(g);
        this.crateLife.push({ kind: 'gull', mesh: g, wingL, wingR,
          r: d.r || 14, h: d.h || 9, ph: d.ph || 0 });
      } else if (d.kind === 'drift') {
        const g = new THREE.Group();
        const log = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.26, 2.2, 7), wood);
        log.rotation.z = Math.PI / 2;
        log.castShadow = true;
        g.add(log);
        g.position.set(d.x, -1.5, d.z);
        this.courseGroup.add(g);
        this.crateLife.push({ kind: 'drift', mesh: g, baseY: -1.5, ph: d.ph || 0 });
      }
    }
  }

  // ---- hero mesh ---------------------------------------------------------
  // showcase anchor (select + victory screens) in CSS px (+ free room);
  // null → center on the pedestal
  setSelectHero(anchor) { this.selectHero = anchor; }

  // victory showcase: the rotating hero carries the gold cup in front of
  // its chest (both arms forward). The cup is rebuilt per hero because
  // setHero's dispose traversal reaps the whole hero subtree.
  showTrophy(on) {
    on = !!on;
    if (on === this.wantTrophy) return;
    this.wantTrophy = on;
    if (on) { if (this.heroParts) this._attachTrophy(); return; }
    if (this.trophyMesh) {
      this.trophyMesh.removeFromParent();
      this.trophyMesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.trophyMesh = null;
    }
  }

  _attachTrophy() {
    // carried, not hoisted: the cup sits in BOTH hands in front of the
    // chest, so it is parented to the hero body (not one arm) and stays
    // upright as the showcase turns.
    const tr = buildTrophy();
    tr.position.set(0, 0.78, 0.36);    // chest height, out in front
    this.heroParts.group.add(tr);
    this.trophyMesh = tr;
  }

  setHero(key) {
    if (key === this.heroKey) return;
    this.trophyMesh = null;            // any held cup dies with the old subtree
    if (this.heroParts) {
      this.heroParts.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.scene.remove(this.heroParts.group);
    }
    const [mode, id] = key.split(':');
    const def = CHARACTERS[id] || CHARACTERS.hero;
    this.heroParts = buildHero(def);
    // 10% smaller in play; menu showcase full size; map diorama tiny
    const scale = mode === 'play' ? 0.9 : mode === 'map' ? 0.45 : 1;
    this.heroParts.group.scale.setScalar(scale);
    this.scene.add(this.heroParts.group);
    if (this.wantTrophy) this._attachTrophy();
    this.heroKey = key;
  }

  // two-player split screen: on/off + orientation ('v' side-by-side, 'h'
  // stacked). The render pass re-derives each viewport every frame.
  setSplit(two, mode) {
    const m = mode === 'h' ? 'h' : 'v';
    if (this.twoPlayer === !!two && this.splitMode === m) return;
    this.twoPlayer = !!two;
    this.splitMode = m;
    this.resize();
  }

  // P2's hero rig (null clears it for 1P / menu screens)
  setP2Hero(id) {
    const key = id ? 'play:' + id : '';
    if (key === this.hero2Key) return;
    if (this.hero2Parts) {
      this.hero2Parts.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.scene.remove(this.hero2Parts.group);
      this.hero2Parts = null;
    }
    this.hero2Key = key;
    if (!id) return;
    const def = CHARACTERS[id] || CHARACTERS.hero;
    this.hero2Parts = buildHero(def);
    this.hero2Parts.group.scale.setScalar(0.9);
    this.scene.add(this.hero2Parts.group);
  }

  // ---- per-frame ---------------------------------------------------------
  sync(game, state) {
    const t = performance.now() / 1000;
    // every run world state — incl. the terminal cards — keeps posing the
    // hero and driving the follow cam (previously dq froze the camera and
    // teleported the hero back to the menu pedestal)
    const p = (state === 'play' || state === 'pause' || state === 'clear'
      || state === 'dq' || state === 'lost'
      || state === 'over' || state === 'win')
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
    if (this.boostMeshes) {
      let i = 0;
      for (const u of (game.course ? game.course.boosts : [])) {
        const m = this.boostMeshes[i++];
        if (!m) continue;
        m.visible = !u.taken;
        m.rotation.z = t * 1.4;
        m.position.y = u.y + Math.sin(t * 2.4 + u.z) * 0.1;
      }
      i = 0;
      for (const u of (game.course ? game.course.curses : [])) {
        const m = this.jinxMeshes[i++];
        if (!m) continue;
        m.visible = !u.taken;
        m.rotation.set(t * 0.9, t * 1.3, 0);
        m.position.y = u.y + Math.sin(t * 1.6 + u.z) * 0.07;
      }
    }
    if (game.course) {
      for (const hm of this.hammerMeshes) {
        const q = hm.body.rotation();
        hm.g.quaternion.set(q.x, q.y, q.z, q.w);
        hm.g.visible = hm.h.active !== false;    // parked before its wave
      }
      for (const pm of this.pillarMeshes) {
        pm.m.position.y = pm.body.translation().y;
      }
      for (const cm of this.crateMeshes || []) {
        const tr = cm.k.body.translation();
        cm.g.position.set(tr.x, tr.y, cm.k.z);
        // the showdown deck shrinks — scale the mesh with the collider
        const sc = (cm.k.half ?? CRATES.half) / CRATES.half;
        cm.g.scale.set(sc, 1, sc);
        // a sunken deck is gone from view entirely
        cm.g.visible = tr.y > CRATES.top - 1.4 - CRATES.sinkDepth + 0.05;
        // splash plume when the deck goes under, then the foam calms
        if (cm.k.sunk && cm.splashT < 0) cm.splashT = t;
        if (cm.splashT >= 0) {
          const e = (t - cm.splashT) / 0.7;
          cm.splash.visible = e < 1;
          if (e < 1) {
            cm.splash.scale.set(0.6 + e * 1.1, 0.5 + e * 1.8, 0.6 + e * 1.1);
            cm.splash.material.opacity = 0.85 * (1 - e);
          }
        }
        cm.foam.material.opacity = cm.k.sunk ? 0.16 : 0.55;
      }
      // cove life: buoys and boats ride the swell, gulls wheel, torches
      // flicker, the lighthouse sweeps
      for (const a of this.crateLife || []) {
        if (a.mesh && a.kind !== 'gull') {
          a.mesh.position.y = a.baseY + Math.sin(t * 1.3 + a.ph) * 0.09;
          if (a.kind === 'boat') a.mesh.rotation.z = Math.sin(t * 1.1 + a.ph) * 0.06;
          if (a.kind === 'drift') a.mesh.rotation.y = Math.sin(t * 0.4 + a.ph) * 0.6;
        } else if (a.kind === 'gull') {
          const ang = t * 0.25 + a.ph;
          a.mesh.position.set(
            Math.cos(ang) * a.r,
            a.h + Math.sin(t * 0.8 + a.ph) * 0.5,
            Math.sin(ang) * a.r);
          a.mesh.rotation.y = -ang + Math.PI / 2;
          const flap = Math.sin(t * 9 + a.ph) * 0.5;
          a.wingL.rotation.z = flap;
          a.wingR.rotation.z = -flap;
        } else if (a.kind === 'torch') {
          const f = 0.9 + Math.sin(t * 9 + a.ph) * 0.18;
          a.flame.scale.set(f, 1 + Math.sin(t * 13 + a.ph) * 0.15, f);
          a.flame.rotation.y = t * 2.4;
        } else if (a.kind === 'lighthouse') {
          a.light.material.emissiveIntensity =
            0.35 + Math.max(0, Math.sin(t * 0.9)) * 1.8;
        }
      }
      for (const hm of this.pendulumMeshes) {
        const tr = hm.p.body.translation();
        hm.g.visible = hm.p.active !== false;
        hm.ball.position.set(tr.x, tr.y, hm.p.z);
        // rope spans pivot → ball
        const dx = tr.x, dy = hm.p.pivY - tr.y;
        const len = Math.hypot(dx, dy) || 0.01;
        hm.rope.scale.y = len;
        hm.rope.position.set(tr.x / 2, (tr.y + hm.p.pivY) / 2, hm.p.z);
        hm.rope.rotation.z = -Math.atan2(dx, dy);
      }
      for (const { r, m } of this.rollerMeshes) {
        const tr = r.body.translation();
        m.visible = r.active !== false;
        m.position.set(tr.x, tr.y, tr.z);
        // log axis stays along X for both sweep directions — it rolls the
        // axis perpendicular to travel, which is X either way
        m.rotation.x = (r.ax === 'z' ? tr.z : tr.x) / r.r;
      }
      for (const { gt, grp } of this.gateMeshes) {
        grp.position.y = gt.body.translation().y;
      }
      if (this.arenaRing) {
        const rr = game.course.ringR || 10.6;
        this.arenaRing.scale.set(rr, rr, 1);
        // gentle golden pulse so the closing line is never missed
        this.arenaRing.material.color.setHex(
          Math.floor(performance.now() / 300) % 2 ? 0xffd23e : 0xffe98a);
      }
      for (const { p, m } of this.pistonMeshes) {
        m.position.x = p.body.translation().x;
      }
      for (const { c, m } of this.crumbleMeshes) {
        m.position.y = c.gone
          ? c.top - 1 - c.fallT * c.fallT * 0.0018          // tumble away
          : c.top - 1 + (c.timer > 0 ? Math.sin(c.timer * 1.2) * 0.03 : 0);
      }
    }

    // which world we're looking at
    this.courseGroup.visible = !!game.course && state !== 'map';
    this.pedestal.visible = state === 'title' || state === 'select'
      || state === 'victory';
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

    // P2 rig (split screen) — same posing rules, own hero
    const inRun = state === 'play' || state === 'pause' || state === 'clear'
      || state === 'dq' || state === 'lost' || state === 'over'
      || state === 'win';
    const p2 = (this.twoPlayer && inRun && game.players && game.players[1])
      ? game.players[1] : null;
    if (this.hero2Parts) {
      this.hero2Parts.group.visible = !!p2;
      if (p2) {
        const q = p2.pos;
        const g = this.hero2Parts.group;
        g.position.set(q.x, q.y - FEET, q.z);
        g.rotation.y = p2.yaw;
        if (p2.spinT > 0) g.rotation.y += p2.spinT * 1.4;
        else if (!p2.grounded) poseAir(p2, this.hero2Parts);
        else poseWalk(p2, this.hero2Parts, g);
      }
    }

    // pickup aura trails the hero while a boost/jinx runs
    const aura = !!p && p.modT > 0;
    this.modRing.visible = aura;
    if (aura) {
      this.modRing.position.set(p.pos.x, p.pos.y - FEET + 0.08, p.pos.z);
      this.modRing.material.color.setHex(p.mod > 0 ? 0xffd23e : 0x8a3fb0);
      this.modRing.scale.setScalar(1 + Math.sin(t * 9) * 0.12);
    }

    // rivals race only inside the course world
    this.rivalGroup.visible = (state === 'play' || state === 'pause'
      || state === 'clear' || state === 'dq' || state === 'lost')
      && this.rivalParts.length > 0;
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

    // menu hero idles on the pedestal, slowly turning; on the select AND
    // victory screens it slides to the free side of the card (RTL mirrored)
    // and the pedestal follows. The menu cam ORBITS, so the UI pixel is
    // re-solved against the ground plane every frame — the hero stays
    // glued to its screen column beside the card while the world swings.
    // On victory it also carries the gold trophy (showTrophy).
    if (!p && this.heroParts && state !== 'map') {
      const hp = this.heroParts.group;
      const sel = (state === 'select' || state === 'victory')
        ? this.selectHero : null;
      let px2 = 0, pz = -14, sc = 1;
      if (sel) {
        sc = Math.max(0.8, Math.min(1.4, sel.room / 340));
        const v = new THREE.Vector3(
          (sel.px / view.w) * 2 - 1,
          -(sel.py / view.h) * 2 + 1,
          0.5).unproject(this.cam).sub(this.cam.position);
        // The anchor marks the BODY CENTER, not the feet: solve for the
        // ground spot whose raised center sits on the anchor pixel
        const tt = (1.08 * sc - this.cam.position.y) / v.y;
        if (tt > 0.01) {
          px2 = this.cam.position.x + v.x * tt;
          pz = this.cam.position.z + v.z * tt;
        }
      }
      hp.scale.setScalar(sc);
      this.pedestal.scale.setScalar(sc);
      this.pedestal.position.set(px2, 0.21 * sc, pz);
      hp.position.set(px2, 0.42 * sc + Math.sin(t * 2) * 0.02, pz);
      hp.rotation.y = t * 0.7;
      const s = Math.sin(t * 4) * 0.12;   // tiny ready-bounce
      this.heroParts.legL.rotation.x = 0;  // stand tall (run pose may persist)
      this.heroParts.legR.rotation.x = 0;
      this.heroParts.armL.rotation.x = s;
      if (this.trophyMesh) {
        // victory carry: both arms reach forward, hands converging on the
        // cup held in front of the chest — no solo spin, the showcase
        // turn shows it off from every side
        this.heroParts.armL.rotation.x = -1.35;
        this.heroParts.armR.rotation.x = -1.35;
        this.heroParts.armL.rotation.z = 0.3;
        this.heroParts.armR.rotation.z = -0.3;
      } else {
        this.heroParts.armR.rotation.x = -s;
        this.heroParts.armL.rotation.z = 0;   // the carry tilt must not leak
        this.heroParts.armR.rotation.z = 0;
      }
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
      this.mapRing.position.x = game.map.cursor * MAP_SPACING;
      this.mapRing.rotation.y = t * 0.8;
      const mw = game.map.walk;
      this.mapBeacon.visible = !!mw && mp.walking;
      if (this.mapBeacon.visible) {
        this.mapBeacon.position.set(mw.to * MAP_SPACING,
          2.5 + Math.sin(t * 3) * 0.18, 0);
        this.mapBeacon.rotation.y = t * 2.2;
      }
    }

    // camera
    if (state === 'title' || state === 'select' || state === 'victory') {
      this.menuAngle += 0.004;
      const a = this.menuAngle;
      this.lerpCam(
        Math.sin(a) * 4.4, 2.1, -14 + Math.cos(a) * 4.4,
        0, 1.1, -14
      );
    } else if (state === 'map') {
      const mp = game.mapHeroPos();
      const mid = (LEVELS.length - 1) * MAP_SPACING / 2;
      const focus = mp.walking ? mp.x : mid + Math.sin(t * 0.18) * 0.5;
      const c = this.mapCam(focus, !mp.walking);
      this.lerpCam(c.x, c.y, c.z, focus, 0.55, 0);
    } else if (p && game.course && game.course.isArena) {
      // arena: a wide, deliberate tower cam — the whole ring in frame,
      // fixed yaw so WASD steering stays screen-true
      this.lerpCam(0, 15, -16, 0, 0.3, 2);
    } else if (p && game.course && game.course.isCrates) {
      // Crate Cove: same fixed-yaw wide tower shot, the whole grid of
      // decks plus open sea in frame — screen-true free control
      this.lerpCam(0, 16.5, -15.5, 0, 0.4, 0.5);
    } else if (p) {
      const pos = p.pos;
      this.lerpCam(
        pos.x * 0.62, pos.y + 2.5, pos.z - 5.4,
        pos.x * 0.45, pos.y - 0.2, pos.z + 4.5
      );
    }
    // P2 camera: races follow P2; free modes (crates / arena) share P1's
    // fixed tower shot so both halves see the whole field
    if (this.twoPlayer && inRun && p2) {
      if (game.mode === 'race') {
        const q = p2.pos;
        this.lerpCam2(q.x * 0.62, q.y + 2.5, q.z - 5.4,
          q.x * 0.45, q.y - 0.2, q.z + 4.5);
      } else {
        this.cam2.position.copy(this.cam.position);
        this.cam2.quaternion.copy(this.cam.quaternion);
      }
    }
    // sun follows the action so the shadow frustum stays local
    let sx = 0, sz = -14;
    if (p) { sx = p.pos.x; sz = p.pos.z; }
    else if (state === 'map') { sx = 3; sz = 0; }
    this.sun.position.set(sx + 8, 16, sz - 6);
    this.sun.target.position.set(sx, 0, sz);
  }

  // Fit the whole island chain on screen at ANY aspect: pull back until
  // half the span fits inside the horizontal FOV (plus margin for island
  // radius and flags). Walking dollies in and follows the hero; idling
  // settles back to the full overview. Fixes islands running off-screen
  // once the ladder grew to four nodes.
  mapCam(focusX, overview) {
    const span = (LEVELS.length - 1) * MAP_SPACING;
    const half = span / 2 + 3.2;
    const vfov = THREE.MathUtils.degToRad(this.cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.cam.aspect);
    let d = half / Math.tan(hfov / 2);
    d = Math.min(Math.max(d, 8), 30);
    if (!overview) d *= 0.78;                 // travel: closer, intimate
    const pitch = 0.33;
    return {
      x: focusX, y: 0.55 + Math.sin(pitch) * d, z: Math.cos(pitch) * d,
    };
  }

  lerpCam(x, y, z, lx, ly, lz) {
    const k = 0.085;
    this.camPos.lerp(new THREE.Vector3(x, y, z), k);
    this.camLook.lerp(new THREE.Vector3(lx, ly, lz), k);
    this.cam.position.copy(this.camPos);
    this.cam.lookAt(this.camLook);
  }

  lerpCam2(x, y, z, lx, ly, lz) {
    const k = 0.085;
    this.cam2Pos.lerp(new THREE.Vector3(x, y, z), k);
    this.cam2Look.lerp(new THREE.Vector3(lx, ly, lz), k);
    this.cam2.position.copy(this.cam2Pos);
    this.cam2.lookAt(this.cam2Look);
  }

  render() {
    if (!this.twoPlayer) { this.r.render(this.scene, this.cam); return; }
    // split screen: same scene, two viewports, one camera each. three.js
    // viewport origin is bottom-left, so stacked = P1 on top (y = h/2).
    const r = this.r, w = view.w, h = view.h;
    r.setScissorTest(true);
    const halves = this.splitMode === 'h'
      ? [[0, h / 2, w, h / 2], [0, 0, w, h / 2]]
      : [[0, 0, w / 2, h], [w / 2, 0, w / 2, h]];
    const cams = [this.cam, this.cam2];
    for (let i = 0; i < 2; i++) {
      const [x, y, ww, hh] = halves[i];
      cams[i].aspect = ww / hh;
      cams[i].updateProjectionMatrix();
      r.setViewport(x, y, ww, hh);
      r.setScissor(x, y, ww, hh);
      r.render(this.scene, cams[i]);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
  }

  resize() {
    this.r.setPixelRatio(view.dpr);
    this.r.setSize(view.w, view.h, false);
    this.cam.aspect = view.w / view.h;
    this.cam.updateProjectionMatrix();
    this.cam2.aspect = this.twoPlayer && this.splitMode === 'v'
      ? (view.w / 2) / view.h : view.w / (view.h / 2);
    this.cam2.updateProjectionMatrix();
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
