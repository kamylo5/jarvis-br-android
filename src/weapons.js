import * as THREE from 'three';
import { radialTexture } from './utils.js';

export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'FÚRIA AR',
    short: 'AR',
    mode: 'AUTO',
    damage: 27,
    headMult: 2.15,
    rpm: 620,
    spread: 0.012,
    adsSpread: 0.0028,
    moveSpread: 0.016,
    magSize: 30,
    reserve: 150,
    reloadTime: 1.95,
    recoil: 0.0072,
    range: 260,
    sound: 'rifle'
  },
  smg: {
    id: 'smg',
    name: 'VESPA SMG',
    short: 'SMG',
    mode: 'AUTO',
    damage: 17,
    headMult: 2.0,
    rpm: 940,
    spread: 0.019,
    adsSpread: 0.0075,
    moveSpread: 0.021,
    magSize: 32,
    reserve: 180,
    reloadTime: 1.5,
    recoil: 0.0052,
    range: 160,
    sound: 'smg'
  }
};

const M = {
  gun: new THREE.MeshStandardMaterial({ color: 0x272d31, roughness: 0.42, metalness: 0.8 }),
  gunLight: new THREE.MeshStandardMaterial({ color: 0x495257, roughness: 0.44, metalness: 0.7 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x2f3332, roughness: 0.78, metalness: 0.12 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 0.8, metalness: 0.1 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.35, metalness: 0.55, emissive: 0x3a1400, emissiveIntensity: 0.8 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x24292b, roughness: 0.9 }),
  glovePad: new THREE.MeshStandardMaterial({ color: 0x3d4546, roughness: 0.75 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x3f4938, roughness: 0.97 }),
  skin: new THREE.MeshStandardMaterial({ color: 0x8f6242, roughness: 0.85 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x6fd6c4, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.35 }),
  dot: new THREE.MeshBasicMaterial({ color: 0xff3b20 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc79a4a, roughness: 0.35, metalness: 0.8 })
};

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function cyl(rTop, rBot, h, mat, seg = 12) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
}
function addRail(parent, y, z, len, mat = M.gun) {
  for (let i = 0; i < Math.floor(len / 0.025); i++) {
    parent.add(box(0.055, 0.008, 0.014, mat, 0, y, z - len / 2 + i * 0.025 + 0.01));
  }
}

function buildHands(group) {
  // right hand on the grip
  const rArm = new THREE.Group();
  const rPalm = box(0.075, 0.1, 0.13, M.glove, 0, 0, 0);
  rArm.add(rPalm);
  const rKnuckle = box(0.078, 0.035, 0.1, M.glovePad, 0, 0.045, -0.005);
  rArm.add(rKnuckle);
  for (let i = 0; i < 4; i++) {
    const f = box(0.018, 0.03, 0.07, M.glove, -0.028 + i * 0.019, 0.005, -0.095);
    f.rotation.x = -0.45;
    rArm.add(f);
  }
  const thumb = box(0.025, 0.06, 0.03, M.glove, 0.042, 0.02, -0.045);
  thumb.rotation.z = 0.35; rArm.add(thumb);
  rArm.position.set(0.015, -0.115, 0.09);
  rArm.rotation.set(0.25, 0, -0.08);
  group.add(rArm);

  // left hand on the handguard
  const lArm = new THREE.Group();
  const lPalm = box(0.08, 0.07, 0.15, M.glove, 0, 0, 0);
  lArm.add(lPalm);
  const lPad = box(0.082, 0.03, 0.11, M.glovePad, 0, 0.04, 0);
  lArm.add(lPad);
  for (let i = 0; i < 4; i++) {
    const f = box(0.019, 0.032, 0.075, M.glove, -0.028 + i * 0.019, -0.038, 0.01);
    f.rotation.x = 0.4;
    lArm.add(f);
  }
  const thumbL = box(0.026, 0.05, 0.07, M.glove, 0.044, -0.02, 0.02);
  thumbL.rotation.z = -0.4; lArm.add(thumbL);
  return { right: rArm, left: lArm };
}

function baseRifle() {
  const g = new THREE.Group();

  const receiver = box(0.082, 0.092, 0.36, M.gun, 0, 0, -0.03);
  g.add(receiver);
  // upper receiver + rail
  g.add(box(0.062, 0.03, 0.38, M.gunLight, 0, 0.06, -0.05));
  addRail(g, 0.08, -0.05, 0.32);
  // handguard
  const hg = box(0.07, 0.072, 0.3, M.tan, 0, 0.004, -0.37);
  g.add(hg);
  for (let i = 0; i < 5; i++) {
    const slot = box(0.072, 0.014, 0.028, M.gun, 0, -0.01, -0.27 - i * 0.048);
    g.add(slot);
  }
  // barrel + brake
  const barrel = cyl(0.014, 0.016, 0.3, M.gunLight, 10);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.01, -0.63); g.add(barrel);
  const brake = cyl(0.025, 0.022, 0.075, M.gun, 10);
  brake.rotation.x = Math.PI / 2; brake.position.set(0, 0.01, -0.79); g.add(brake);
  for (let i = 0; i < 3; i++) {
    const port = box(0.018, 0.007, 0.034, M.accent, i % 2 ? 0.018 : -0.018, 0.01, -0.78);
    g.add(port);
  }
  // stock
  g.add(box(0.062, 0.085, 0.18, M.polymer, 0, -0.004, 0.23));
  g.add(box(0.054, 0.13, 0.05, M.polymer, 0, -0.025, 0.31));
  g.add(box(0.066, 0.045, 0.07, M.gun, 0, 0.048, 0.21));
  // grip
  const grip = box(0.058, 0.13, 0.075, M.polymer, 0, -0.105, 0.075);
  grip.rotation.x = -0.24; g.add(grip);
  // trigger guard
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.008, 4, 10, Math.PI), M.gun);
  guard.rotation.set(Math.PI / 2, 0, 0); guard.position.set(0, -0.08, 0.005); g.add(guard);
  // magazine
  const magGroup = new THREE.Group();
  const mag = box(0.066, 0.19, 0.11, M.polymer, 0, -0.09, 0);
  mag.rotation.x = 0.14;
  magGroup.add(mag);
  magGroup.add(box(0.07, 0.02, 0.115, M.gun, 0, -0.185, 0.012));
  magGroup.position.set(0, -0.085, -0.04);
  g.add(magGroup);
  // charging handle / bolt
  g.add(box(0.055, 0.02, 0.03, M.gunLight, 0, 0.075, 0.06));
  // optic — open reflex sight
  const optic = new THREE.Group();
  optic.add(box(0.05, 0.018, 0.11, M.gun, 0, 0, 0));
  for (const sx of [-1, 1]) {
    optic.add(box(0.008, 0.05, 0.012, M.gunLight, sx * 0.023, 0.033, -0.04));
  }
  optic.add(box(0.052, 0.009, 0.012, M.gunLight, 0, 0.058, -0.04));
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.045), M.glass);
  lens.position.set(0, 0.035, -0.035);
  lens.rotation.x = -0.1;
  optic.add(lens);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0036, 6, 5), M.dot);
  dot.position.set(0, 0.035, -0.037); optic.add(dot);
  optic.position.set(0, 0.08, -0.07);
  g.add(optic);
  // side accents
  g.add(box(0.004, 0.035, 0.16, M.accent, 0.046, 0.015, -0.02));
  g.add(box(0.004, 0.025, 0.12, M.accent, -0.046, 0.015, -0.3));
  g.add(box(0.045, 0.012, 0.045, M.accent, 0, 0.058, 0.12));
  // laser / flashlight
  const laser = cyl(0.014, 0.014, 0.09, M.gunLight, 8);
  laser.rotation.x = Math.PI / 2; laser.position.set(-0.048, -0.005, -0.52); g.add(laser);
  const laserGlass = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), M.glass);
  laserGlass.position.set(-0.048, -0.005, -0.565); g.add(laserGlass);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.835);
  g.add(muzzle);

  const hands = buildHands(g);
  hands.left.position.set(-0.005, -0.02, -0.43);
  hands.left.rotation.set(0.1, 0, 0.12);
  g.add(hands.left);
  hands.right.position.set(0.02, -0.11, 0.1);
  hands.right.rotation.set(0.16, -0.08, -0.06);
  g.add(hands.right);

  g.userData = { magGroup, muzzle, optic, type: 'rifle', sightY: 0.14, sightZ: -0.08 };
  return g;
}

function buildSMG() {
  const g = new THREE.Group();
  g.add(box(0.09, 0.11, 0.3, M.gun, 0, 0, 0));
  g.add(box(0.068, 0.034, 0.34, M.gunLight, 0, 0.072, -0.03));
  g.add(box(0.08, 0.075, 0.2, M.polymer, 0, -0.01, -0.26));
  for (let i = 0; i < 4; i++) {
    g.add(box(0.082, 0.012, 0.026, M.accent, 0, -0.005, -0.19 - i * 0.043));
  }
  const barrel = cyl(0.02, 0.022, 0.18, M.gunLight, 10);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.012, -0.41); g.add(barrel);
  const suppressor = cyl(0.034, 0.034, 0.19, M.gun, 12);
  suppressor.rotation.x = Math.PI / 2; suppressor.position.set(0, 0.012, -0.55); g.add(suppressor);
  for (let i = 0; i < 4; i++) g.add(box(0.07, 0.008, 0.012, M.gunLight, 0, 0.028, -0.49 - i * 0.04));
  // stock
  g.add(box(0.05, 0.06, 0.22, M.gunLight, 0, 0.005, 0.25));
  g.add(box(0.075, 0.13, 0.05, M.polymer, 0, -0.02, 0.36));
  // grip + curved mag
  const grip = box(0.055, 0.12, 0.07, M.polymer, 0, -0.1, 0.07);
  grip.rotation.x = -0.22; g.add(grip);
  const magGroup = new THREE.Group();
  const mag1 = box(0.058, 0.16, 0.085, M.polymer, 0, -0.06, 0);
  mag1.rotation.x = 0.18; magGroup.add(mag1);
  const mag2 = box(0.056, 0.13, 0.08, M.polymer, 0, -0.17, 0.035);
  mag2.rotation.x = 0.38; magGroup.add(mag2);
  magGroup.position.set(0, -0.09, -0.02);
  g.add(magGroup);
  // optic — small reflex sight
  const optic = new THREE.Group();
  optic.add(box(0.055, 0.02, 0.11, M.gun, 0, 0, 0));
  const hood = box(0.05, 0.055, 0.045, M.gunLight, 0, 0.038, 0.045);
  optic.add(hood);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.042, 0.045), M.glass);
  glass.position.set(0, 0.045, 0.018); optic.add(glass);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0038, 6, 5), M.dot);
  dot.position.set(0, 0.045, 0.015); optic.add(dot);
  optic.position.set(0, 0.095, -0.07);
  g.add(optic);
  g.add(box(0.004, 0.03, 0.2, M.accent, 0.047, 0.01, -0.12));
  // hands
  const hands = buildHands(g);
  hands.left.position.set(0, -0.02, -0.28);
  hands.left.rotation.set(0.15, 0, 0.12);
  g.add(hands.left);
  hands.right.position.set(0.02, -0.1, 0.1);
  hands.right.rotation.set(0.16, -0.08, -0.06);
  g.add(hands.right);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.64);
  g.add(muzzle);
  g.userData = { magGroup, muzzle, optic, type: 'smg', sightY: 0.14, sightZ: -0.07 };
  return g;
}

export function buildWeapon(type) {
  return type === 'smg' ? buildSMG() : baseRifle();
}

export function createMuzzleFlash() {
  const tex = radialTexture(128, 'rgba(255,255,235,1)', 'rgba(255,190,80,0.7)', 'rgba(255,120,20,0)');
  const mat = new THREE.SpriteMaterial({
    map: tex, color: 0xffd8a0, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(0.34);
  sprite.visible = false;
  const light = new THREE.PointLight(0xffa64d, 0, 6, 2);
  return { sprite, light, timer: 0 };
}
