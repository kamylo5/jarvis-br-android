import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createWorld } from './world.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { clamp, damp, lerp } from './utils.js';

const DEFAULT_SETTINGS = { sensitivity: 1, quality: 'high', sound: true, ads: true };

function loadSettings() {
  try {
    const raw = localStorage.getItem('ff-ilha-zero-settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings() {
  try { localStorage.setItem('ff-ilha-zero-settings', JSON.stringify(settings)); } catch {}
}

const canvas = document.getElementById('game');
const landing = document.getElementById('landing');
const pauseScreen = document.getElementById('pause');
const resultScreen = document.getElementById('result');
const loadingScreen = document.getElementById('loading');
const loadBar = document.getElementById('loadBar');
const loadStatus = document.getElementById('loadStatus');

const settings = loadSettings();
const state = {
  mode: 'landing',
  time: 0,
  startedAt: 0,
  ended: false,
  locked: false,
  resultTimer: 0
};

const input = {
  forward: false, back: false, left: false, right: false,
  sprint: false, jump: false, crouch: false, fire: false, aim: false,
  reloadJust: false, swapJust: false, weapon1Just: false, weapon2Just: false, interactJust: false
};

/* ───────────────────────── renderer ───────────────────────── */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
} catch (err) {
  loadStatus.textContent = 'WEBGL INDISPONÍVEL NESTE NAVEGADOR';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.quality === 'high' ? 1.75 : settings.quality === 'medium' ? 1.35 : 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 900);
camera.position.set(0, 26, 110);
scene.add(camera);

/* sky environment for metallic weapons */
(function buildEnvironment() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#6f9fc4');
  g.addColorStop(0.35, '#cad9d6');
  g.addColorStop(0.5, '#ffe1b8');
  g.addColorStop(0.58, '#b49a76');
  g.addColorStop(1, '#3a3a2e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
  const sun = ctx.createRadialGradient(150, 105, 0, 150, 105, 60);
  sun.addColorStop(0, 'rgba(255,246,214,1)');
  sun.addColorStop(0.25, 'rgba(255,210,140,0.7)');
  sun.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, 512, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  scene.environmentIntensity = 0.55;
  tex.dispose();
  pmrem.dispose();
})();

/* ───────────────────────── world & systems ───────────────────────── */
const world = createWorld(scene, renderer, settings.quality);
const effects = new Effects(scene);
const audio = new AudioEngine();
const hud = new HUD(world, camera);
const player = new Player(scene, camera, world, audio, effects, hud);
player.sensitivity = settings.sensitivity;
const enemies = new EnemyManager(scene, world, effects, audio);
player.enemyManager = enemies;
player.viewRoot.visible = false;

/* ───────────────────────── post processing ───────────────────────── */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.55, 0.9);
bloom.enabled = settings.quality !== 'low';
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ───────────────────────── zone ───────────────────────── */
const zone = {
  center: new THREE.Vector3(0, 0, 0),
  radius: 136,
  nextRadius: 94,
  targetRadius: 94,
  targetCenter: new THREE.Vector3(0, 0, 0),
  startRadius: 136,
  startCenter: new THREE.Vector3(0, 0, 0),
  phase: 0,
  timer: 58,
  wait: 58,
  shrinkDuration: 34,
  shrinking: false,
  damage: 3.2,
  elapsed: 0
};
const zonePhases = [
  { radius: 94, wait: 42, shrink: 32, damage: 3.5 },
  { radius: 58, wait: 34, shrink: 28, damage: 4.5 },
  { radius: 32, wait: 28, shrink: 24, damage: 6 },
  { radius: 14, wait: 24, shrink: 20, damage: 8 },
  { radius: 6, wait: 9999, shrink: 1, damage: 12 }
];

// visual wall
const wallUniforms = {
  uTime: { value: 0 },
  uColor: { value: new THREE.Color(0xff8b2a) },
  uColor2: { value: new THREE.Color(0x54d7ff) }
};
const wallMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: wallUniforms,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vWorld;
    void main(){
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position,1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime;
    uniform vec3 uColor, uColor2;
    varying vec2 vUv;
    varying vec3 vWorld;
    void main(){
      // soft energy veil: vertical streaks + slow horizontal bands, no 2D grid
      float edge = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.42, vUv.y);
      float streak = pow(0.5 + 0.5 * sin(vUv.x * 90.0 + uTime * 0.7), 8.0);
      float band = 0.5 + 0.5 * sin(vUv.y * 22.0 - uTime * 1.1);
      float pulse = 0.55 + 0.45 * sin(uTime * 1.8 + vUv.x * 9.0);
      vec3 col = mix(uColor2, uColor, 0.3 + 0.35 * sin(vUv.x * 6.28 + uTime * 0.35));
      float a = (0.022 + streak * 0.05 + band * 0.018 + pulse * 0.012) * edge;
      gl_FragColor = vec4(col * (0.8 + streak * 0.7), a);
    }`
});
const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 26, 128, 1, true), wallMat);
wall.position.set(0, 12, 0);
wall.frustumCulled = false;
scene.add(wall);
const zoneRing = new THREE.Mesh(
  new THREE.RingGeometry(0.985, 1.015, 128),
  new THREE.MeshBasicMaterial({ color: 0xffb25a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
);
zoneRing.rotation.x = -Math.PI / 2;
zoneRing.position.y = 1.6;
zoneRing.scale.setScalar(zone.radius);
scene.add(zoneRing);

/* ───────────────────────── match flow ───────────────────────── */
function resetMatch() {
  player.reset();
  player.enabled = true;
  player.viewRoot.visible = true;
  enemies.reset();
  enemies.spawn(11, player);
  enemies.onKill = onEnemyKilled;
  player.onKill = onEnemyKilled;
  player.onDeath = () => { if (!state.ended) endMatch(false); };
  state.ended = false;
  state.resultTimer = 0;
  state.startedAt = performance.now();
  hud.setKills(0);
  hud.setAlive(12);
  hud.setZone(zone);
  hud.setEnemies(enemies.enemies);
  hud.el.killfeed.innerHTML = '';
  zone.center.set(0, 0, 0);
  zone.radius = 136;
  zone.nextRadius = 94;
  zone.targetRadius = 94;
  zone.phase = 0;
  zone.timer = 58;
  zone.wait = 58;
  zone.shrinkDuration = 34;
  zone.shrinking = false;
  zone.damage = 3.2;
  zone.elapsed = 0;
  wall.scale.set(136, 1, 136);
  zoneRing.scale.setScalar(136);
  hud.zoneWarning(false);
  hud.toast('PARTIDA INICIADA', 'ENCONTRE ARMAS · SOBREVIVA');
}

function startMatch() {
  audio.init();
  audio.resume();
  audio.setEnabled(settings.sound);
  landing.hidden = true;
  resultScreen.hidden = true;
  pauseScreen.hidden = true;
  hud.show();
  state.mode = 'playing';
  state.startedAt = performance.now();
  resetMatch();
  requestLock();
  setTimeout(() => {
    if (state.mode === 'playing' && !state.locked) hud.lockHint(true);
  }, 900);
  setTimeout(() => hud.lockHint(false), 5200);
}

function requestLock() {
  try {
    const p = canvas.requestPointerLock?.({ unadjustedMovement: false });
    if (p && p.catch) p.catch(() => {});
  } catch {
    hud.lockHint(true);
  }
}

function pauseMatch() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  pauseScreen.hidden = false;
  document.getElementById('pauseKills').textContent = player.stats.kills;
  document.getElementById('pauseAcc').textContent = accuracy();
  document.getElementById('pauseTime').textContent = matchTime();
  clearInput();
}

function resumeMatch() {
  pauseScreen.hidden = true;
  state.mode = 'playing';
  requestLock();
}

function quitToMenu() {
  state.mode = 'landing';
  pauseScreen.hidden = true;
  resultScreen.hidden = true;
  hud.hide();
  player.enabled = false;
  player.viewRoot.visible = false;
  document.exitPointerLock?.();
  clearInput();
  landing.hidden = false;
}

function endMatch(win) {
  if (state.ended) return;
  state.ended = true;
  state.resultTimer = 0.9;
  state.win = win;
  clearInput();
  if (win) audio.victory(); else audio.defeat();
  document.exitPointerLock?.();
}

function showResult() {
  state.mode = 'result';
  hud.hide();
  document.exitPointerLock?.();
  const card = resultScreen.querySelector('.result-card');
  card.classList.toggle('lose', !state.win);
  document.getElementById('resultEyebrow').innerHTML = state.win
    ? '<span></span> VITÓRIA · ILHA ZERO'
    : '<span></span> FIM DE PARTIDA';
  document.getElementById('resultTitle').textContent = state.win ? 'BOOYAH!' : 'ELIMINADO';
  document.getElementById('resultSub').textContent = state.win
    ? 'Você dominou a Ilha Zero. O último de pé leva tudo.'
    : `Você caiu em combate. ${enemies.alive + 1}º lugar de 12 operadores.`;
  document.getElementById('resKills').textContent = player.stats.kills;
  document.getElementById('resPlace').textContent = state.win ? '#1' : `#${enemies.alive + 1}`;
  document.getElementById('resAcc').textContent = accuracy();
  document.getElementById('resTime').textContent = matchTime();
  document.getElementById('resultQuote').textContent = state.win
    ? '“O fogo não escolhe. Ele consome.”'
    : '“A ilha não perdoa. Ela só cobra.”';
  resultScreen.hidden = false;
}

function accuracy() {
  if (!player.stats.shots) return '0%';
  return `${Math.round((player.stats.hits / player.stats.shots) * 100)}%`;
}
function matchTime() {
  const sec = Math.floor((performance.now() - state.startedAt) / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function onEnemyKilled(enemy) {
  if (!enemy || enemy.counted) return;
  enemy.counted = true;
  hud.setKills(player.stats.kills);
  hud.killfeed('VOCÊ', enemy.name, 'FÚRIA', false, true);
  hud.setAlive(Math.max(1, enemies.alive + 1));
  if (enemies.alive === 0 && !state.ended) {
    setTimeout(() => { if (!state.ended) endMatch(true); }, 700);
  }
}

function clearInput() {
  for (const k of Object.keys(input)) input[k] = typeof input[k] === 'boolean' ? false : input[k];
}

/* ───────────────────────── zone update ───────────────────────── */
function updateZone(dt) {
  zone.elapsed += dt;
  if (zone.shrinking) {
    zone.timer -= dt;
    const total = zone.shrinkDuration;
    const t = 1 - clamp(zone.timer / total, 0, 1);
    const e = t * t * (3 - 2 * t);
    zone.radius = lerp(zone.startRadius, zone.targetRadius, e);
    zone.center.lerpVectors(zone.startCenter, zone.targetCenter, e);
    if (zone.timer <= 0) {
      zone.radius = zone.targetRadius;
      zone.center.copy(zone.targetCenter);
      zone.shrinking = false;
      zone.phase++;
      const phase = zonePhases[Math.min(zone.phase, zonePhases.length - 1)];
      zone.timer = phase.wait;
      zone.wait = phase.wait;
      zone.shrinkDuration = phase.shrink;
      zone.nextRadius = phase.radius;
      zone.damage = phase.damage;
      if (phase.radius < zone.radius - 1) {
        chooseNextCenter(phase.radius);
        audio.zone();
        hud.toast('ZONA FECHANDO', `PRÓXIMO RAIO ${Math.round(phase.radius)} m`);
      }
    }
  } else {
    zone.timer -= dt;
    if (zone.timer <= 0 && zone.phase < zonePhases.length) {
      const phase = zonePhases[zone.phase];
      zone.targetRadius = phase.radius;
      zone.shrinkDuration = phase.shrink;
      zone.timer = phase.shrink;
      zone.shrinking = true;
      zone.startRadius = zone.radius;
      zone.startCenter.copy(zone.center);
      chooseNextCenter(phase.radius);
      audio.zone();
      hud.toast('ZONA FECHANDO', 'MOVA-SE PARA O CÍRCULO');
    }
  }
  wall.position.set(zone.center.x, 55, zone.center.z);
  wall.scale.set(zone.radius, 1, zone.radius);
  zoneRing.position.set(zone.center.x, 1.8, zone.center.z);
  zoneRing.scale.setScalar(zone.radius);
  wallUniforms.uTime.value = state.time;
  hud.setZone(zone);
  hud.setZoneUi(zone.timer, zone.shrinking);

  const d = Math.hypot(player.position.x - zone.center.x, player.position.z - zone.center.z);
  const outside = d > zone.radius;
  hud.zoneWarning(outside && player.alive);
  if (outside && player.alive) player.zoneDamage(zone.damage * dt);
  // bots take zone damage too
  for (const e of enemies.enemies) {
    if (e.dead) continue;
    const ed = Math.hypot(e.group.position.x - zone.center.x, e.group.position.z - zone.center.z);
    if (ed > zone.radius) {
      e.hp -= zone.damage * 0.7 * dt;
      if (e.hp <= 0) {
        e.die();
        hud.killfeed('ZONA', e.name, 'ZONA');
        hud.setAlive(Math.max(1, enemies.alive + 1));
      }
    }
  }
}

function chooseNextCenter(radius) {
  const rng = Math.random;
  const maxOffset = Math.max(0, zone.radius - radius) * 0.55;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * maxOffset;
  zone.targetCenter.set(zone.center.x + Math.cos(a) * r, 0, zone.center.z + Math.sin(a) * r);
  // keep inside the island
  const len = Math.hypot(zone.targetCenter.x, zone.targetCenter.z);
  if (len > 105) zone.targetCenter.multiplyScalar(105 / len);
}

/* ───────────────────────── landing camera ───────────────────────── */
function updateLandingCamera(t) {
  const a = 0.62 + Math.sin(t * 0.045) * 0.12;
  const r = 166 + Math.sin(t * 0.06) * 4;
  const x = Math.sin(a) * r;
  const z = Math.cos(a) * r;
  const y = 30 + Math.sin(t * 0.08) * 2.5;
  camera.position.set(x, y, z);
  camera.lookAt(0, 10, -18);
  camera.fov = 56;
  camera.updateProjectionMatrix();
  player.viewRoot.visible = false;
}

/* ───────────────────────── events ───────────────────────── */
document.getElementById('playBtn').addEventListener('click', startMatch);
document.getElementById('againBtn').addEventListener('click', startMatch);
document.getElementById('resumeBtn').addEventListener('click', resumeMatch);
document.getElementById('quitBtn').addEventListener('click', quitToMenu);
document.getElementById('menuBtn').addEventListener('click', quitToMenu);

document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('helpPanel').hidden = true;
  document.getElementById('settingsPanel').hidden = !document.getElementById('settingsPanel').hidden;
  syncSettingsUi();
});
document.getElementById('helpBtn').addEventListener('click', () => {
  document.getElementById('settingsPanel').hidden = true;
  document.getElementById('helpPanel').hidden = !document.getElementById('helpPanel').hidden;
});
document.querySelectorAll('.panel-close').forEach(btn => {
  btn.addEventListener('click', () => { document.getElementById(btn.dataset.close).hidden = true; });
});
document.getElementById('sensRange').addEventListener('input', (e) => {
  settings.sensitivity = parseFloat(e.target.value);
  document.getElementById('sensVal').textContent = settings.sensitivity.toFixed(1);
  player.sensitivity = settings.sensitivity;
  saveSettings();
});
document.getElementById('qualitySelect').addEventListener('change', (e) => {
  settings.quality = e.target.value;
  applyQuality();
  saveSettings();
});
document.getElementById('soundToggle').addEventListener('change', (e) => {
  settings.sound = e.target.checked;
  audio.setEnabled(settings.sound);
  saveSettings();
});
document.getElementById('adsToggle').addEventListener('change', (e) => {
  settings.ads = e.target.checked;
  saveSettings();
});

function syncSettingsUi() {
  document.getElementById('sensRange').value = settings.sensitivity;
  document.getElementById('sensVal').textContent = Number(settings.sensitivity).toFixed(1);
  document.getElementById('qualitySelect').value = settings.quality;
  document.getElementById('soundToggle').checked = settings.sound;
  document.getElementById('adsToggle').checked = settings.ads;
}

function applyQuality() {
  const pr = Math.min(window.devicePixelRatio || 1, settings.quality === 'high' ? 1.75 : settings.quality === 'medium' ? 1.35 : 1);
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  bloom.enabled = settings.quality !== 'low';
  renderer.shadowMap.enabled = settings.quality !== 'low';
  world.sun.castShadow = settings.quality !== 'low';
  resize();
}

document.addEventListener('pointerlockchange', () => {
  state.locked = document.pointerLockElement === canvas;
  if (state.locked) {
    hud.lockHint(false);
  } else if (state.mode === 'playing' && !state.ended) {
    setTimeout(() => {
      if (!state.locked && state.mode === 'playing') pauseMatch();
    }, 180);
  }
});
document.addEventListener('pointerlockerror', () => {
  hud.lockHint(true);
  setTimeout(() => hud.lockHint(false), 4000);
});

canvas.addEventListener('click', () => {
  if (state.mode === 'playing' && !state.locked && !state.ended) requestLock();
});

window.addEventListener('keydown', (e) => {
  if (state.mode === 'landing') {
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); startMatch(); }
    return;
  }
  if (state.mode === 'paused') {
    if (e.code === 'Escape' || e.code === 'Enter') { e.preventDefault(); resumeMatch(); }
    return;
  }
  if (state.mode !== 'playing') return;
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': input.forward = true; break;
    case 'KeyS': case 'ArrowDown': input.back = true; break;
    case 'KeyA': case 'ArrowLeft': input.left = true; break;
    case 'KeyD': case 'ArrowRight': input.right = true; break;
    case 'ShiftLeft': case 'ShiftRight': input.sprint = true; break;
    case 'Space': input.jump = true; e.preventDefault(); break;
    case 'ControlLeft': case 'KeyC': input.crouch = true; break;
    case 'KeyR': input.reloadJust = true; break;
    case 'KeyQ': input.swapJust = true; break;
    case 'Digit1': input.weapon1Just = true; break;
    case 'Digit2': input.weapon2Just = true; break;
    case 'KeyE': input.interactJust = true; break;
    case 'Escape': pauseMatch(); break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': input.forward = false; break;
    case 'KeyS': case 'ArrowDown': input.back = false; break;
    case 'KeyA': case 'ArrowLeft': input.left = false; break;
    case 'KeyD': case 'ArrowRight': input.right = false; break;
    case 'ShiftLeft': case 'ShiftRight': input.sprint = false; break;
    case 'ControlLeft': case 'KeyC': input.crouch = false; break;
  }
});

document.addEventListener('mousemove', (e) => {
  if (state.mode !== 'playing' || !state.locked || !player.alive) return;
  player.look(e.movementX || 0, e.movementY || 0, settings.sensitivity);
});
canvas.addEventListener('mousedown', (e) => {
  if (state.mode !== 'playing') return;
  if (e.button === 0) input.fire = true;
  if (e.button === 2 && settings.ads) input.aim = true;
  if (!state.locked) requestLock();
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) input.aim = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('blur', () => {
  clearInput();
  if (state.mode === 'playing') pauseMatch();
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}
window.addEventListener('resize', resize);

/* ───────────────────────── loading ───────────────────────── */
let loadProgress = 0;
const loadTimer = setInterval(() => {
  loadProgress = Math.min(0.92, loadProgress + 0.12 + Math.random() * 0.1);
  loadBar.style.width = `${Math.round(loadProgress * 100)}%`;
  if (loadProgress > 0.5) loadStatus.textContent = 'POSICIONANDO OPERADORES…';
}, 120);
setTimeout(() => {
  clearInterval(loadTimer);
  loadBar.style.width = '100%';
  loadStatus.textContent = 'PRONTO PARA O COMBATE';
  setTimeout(() => loadingScreen.classList.add('done'), 160);
}, 450);

/* ───────────────────────── main loop ───────────────────────── */
const clock = new THREE.Clock();
state.time = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.time += dt;
  const t = state.time;

  world.update(dt, t);
  effects.update(dt);
  wallUniforms.uTime.value = t;

  if (state.mode === 'landing') {
    updateLandingCamera(t);
    hud.setAlive(12);
  } else if (state.mode === 'playing') {
    player.update(dt, input, t);
    enemies.update(dt, player, t);
    updateZone(dt);
    hud.setEnemies(enemies.enemies);
    hud.setAlive(Math.max(1, enemies.alive + 1));
    hud.update(t, dt);
    if (state.ended) {
      state.resultTimer -= dt;
      if (state.resultTimer <= 0 && state.mode === 'playing') showResult();
    }
    player.viewRoot.visible = player.alive;
    if (!player.alive) {
      // death cam drift
      player.camera.position.y = damp(player.camera.position.y, player.position.y + 1.2, 3, dt);
    }
  } else if (state.mode === 'paused') {
    hud.update(t, dt);
  } else if (state.mode === 'result') {
    // keep ambient animation alive behind overlay
  }

  // debug readout
  const fps = Math.round(1 / Math.max(dt, 0.0001));
  hud.el.debug.textContent = `${settings.quality.toUpperCase()} · ${fps} FPS`;

  composer.render();
}

// debugging / automation hook
window.__ff = { world, player, enemies, zone, state, hud, camera, renderer, startMatch };

frame();
