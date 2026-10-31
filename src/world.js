import * as THREE from 'three';
import { clamp, lerp, makeNoise2D, mulberry32, randRange, smoothstep, canvasTexture, radialTexture } from './utils.js';

const R = 150;
const noise = makeNoise2D(20260711);
const noise2 = makeNoise2D(99117);

export function islandHeight(x, z) {
  const d = Math.hypot(x, z);
  const fall = smoothstep(R * 1.0, R * 0.64, d);
  let h = fall * (3.0 + noise.fbm(x * 0.016 + 9.2, z * 0.016 + 4.7, 5) * 13.5);
  h += fall * noise2.fbm(x * 0.052, z * 0.052, 4) * 3.2;
  h += fall * Math.max(0, noise.fbm(x * 0.028 + 40, z * 0.028 - 18, 3) - 0.48) * 22;
  // central massif + eastern ridge + western bluff
  h += Math.exp(-(((x + 12) ** 2 + (z + 24) ** 2) / 1500)) * 17;
  h += Math.exp(-(((x - 72) ** 2 + (z + 60) ** 2) / 1150)) * 11;
  h += Math.exp(-(((x + 86) ** 2 + (z - 68) ** 2) / 1700)) * 8;
  // gently flooded rim
  h -= smoothstep(R * 0.91, R * 1.18, d) * 7.5;
  return h;
}

const QUALITY = {
  high: { shadows: 2048, grass: 7200, clouds: 14, bloom: true, pixel: 2 },
  medium: { shadows: 1024, grass: 3800, clouds: 10, bloom: true, pixel: 1.5 },
  low: { shadows: 0, grass: 1400, clouds: 6, bloom: false, pixel: 1.25 }
};

export function createWorld(scene, renderer, qualityName = 'high') {
  const quality = QUALITY[qualityName] || QUALITY.high;
  const rng = mulberry32(71071);
  const colliders = [];
  const collisionMeshes = [];
  const swayGroups = [];
  const beams = [];
  const birds = [];
  const clouds = [];
  const tempObj = new THREE.Object3D();

  scene.fog = new THREE.FogExp2(0xa9c4c0, 0.0029);

  /* ─────────────────────────── sky ─────────────────────────── */
  const sunDir = new THREE.Vector3(0.46, 0.29, -0.84).normalize();
  const skyGeo = new THREE.SphereGeometry(560, 40, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x1d4d74) },
      midColor: { value: new THREE.Color(0x7fb2ce) },
      horizonColor: { value: new THREE.Color(0xffcf9f) },
      lowColor: { value: new THREE.Color(0x586157) },
      sunColor: { value: new THREE.Color(0xffe3b4) },
      sunDir: { value: sunDir }
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 topColor, midColor, horizonColor, lowColor, sunColor, sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.22, h));
        col = mix(col, topColor, smoothstep(0.18, 0.72, h));
        col = mix(lowColor, col, smoothstep(-0.22, 0.02, h));
        float sd = max(dot(d, sunDir), 0.0);
        float glow = pow(sd, 14.0) * 0.22 + pow(sd, 260.0) * 1.1;
        float disc = smoothstep(0.99972, 0.99996, sd);
        col += sunColor * glow;
        col += sunColor * disc * 3.2;
        // subtle warm banding near the horizon
        col += vec3(0.07, 0.035, 0.008) * exp(-abs(h) * 18.0);
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // Sun glow sprite
  const glowTex = radialTexture(256, 'rgba(255,238,200,1)', 'rgba(255,190,110,0.32)', 'rgba(255,150,60,0)');
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd9a0, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }));
  sunSprite.scale.setScalar(90);
  sunSprite.position.copy(sunDir).multiplyScalar(470);
  scene.add(sunSprite);

  /* ─────────────────────────── lights ─────────────────────────── */
  const hemi = new THREE.HemisphereLight(0x9cc2e4, 0x4f4a35, 0.42);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffca92, 2.9);
  sun.position.copy(sunDir).multiplyScalar(160);
  sun.castShadow = quality.shadows > 0;
  if (quality.shadows) {
    sun.shadow.mapSize.set(quality.shadows, quality.shadows);
    sun.shadow.camera.left = -88; sun.shadow.camera.right = 88;
    sun.shadow.camera.top = 88; sun.shadow.camera.bottom = -88;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 340;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.updateProjectionMatrix();
  }
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x6e9cc4, 0.32);
  fill.position.set(-90, 50, 100);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight(0xff9d50, 0.18);
  bounce.position.set(60, -25, -90);
  scene.add(bounce);

  /* ─────────────────────────── textures ─────────────────────────── */
  const detail = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b9b9b9'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 120 + Math.random() * 110;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.16 + Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 3);
    }
    for (let i = 0; i < 500; i++) {
      ctx.strokeStyle = `rgba(${90 + Math.random() * 70},${100 + Math.random() * 80},${70 + Math.random() * 50},0.25)`;
      ctx.beginPath();
      const x = Math.random() * w, y = Math.random() * h;
      ctx.moveTo(x, y); ctx.lineTo(x + Math.random() * 5 - 2.5, y - 3 - Math.random() * 7);
      ctx.stroke();
    }
  }, { repeat: [78, 78] });
  detail.anisotropy = 8;

  const woodTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#6b5136'; ctx.fillRect(0, 0, w, h);
    for (let p = 0; p < 4; p++) {
      ctx.fillStyle = p % 2 ? '#5d462f' : '#755a3d';
      ctx.fillRect(0, p * 64, w, 62);
      ctx.fillStyle = 'rgba(30,20,12,0.55)'; ctx.fillRect(0, p * 64 + 61, w, 3);
      for (let i = 0; i < 26; i++) {
        ctx.strokeStyle = `rgba(${30 + Math.random() * 40},${22 + Math.random() * 30},${12 + Math.random() * 20},0.35)`;
        ctx.beginPath();
        const y = p * 64 + 4 + Math.random() * 54;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.3, y + Math.random() * 6 - 3, w * 0.6, y + Math.random() * 6 - 3, w, y);
        ctx.stroke();
      }
    }
  }, { repeat: [1, 1] });

  const thatchTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a7440'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      const v = 70 + Math.random() * 100;
      ctx.strokeStyle = `rgba(${v + 20},${v + 5},${v * 0.55},0.55)`;
      ctx.beginPath();
      const x = Math.random() * w, y = Math.random() * h;
      ctx.moveTo(x, y); ctx.lineTo(x + Math.random() * 8 - 4, y + 8 + Math.random() * 14);
      ctx.stroke();
    }
  }, { repeat: [2, 2] });

  const metalTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#9a9c9c'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, 'rgba(40,44,44,0.55)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(40,44,44,0.55)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, 16, h);
    }
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${90 + Math.random() * 50},${45 + Math.random() * 25},${20 + Math.random() * 15},${0.1 + Math.random() * 0.4})`;
      const x = Math.random() * w, y = Math.random() * h;
      ctx.beginPath(); ctx.ellipse(x, y, 2 + Math.random() * 12, 1 + Math.random() * 5, Math.random() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }, { repeat: [2, 1] });

  const stoneTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8b8b83'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = 90 + Math.random() * 90;
      ctx.fillStyle = `rgba(${v},${v},${v * 0.95},${0.1 + Math.random() * 0.35})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 1 + Math.random() * 4);
    }
  }, { repeat: [3, 3] });

  const leafTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 96);
    const g = ctx.createLinearGradient(0, 48, 128, 48);
    g.addColorStop(0, '#2c4a22'); g.addColorStop(0.55, '#4d7a2f'); g.addColorStop(1, '#6b9c3c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(2, 48);
    ctx.quadraticCurveTo(54, 4, 126, 48);
    ctx.quadraticCurveTo(54, 92, 2, 48);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,36,14,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(6, 48); ctx.quadraticCurveTo(64, 44, 124, 48); ctx.stroke();
    for (let i = 1; i < 9; i++) {
      const x = 10 + i * 12;
      ctx.beginPath(); ctx.moveTo(x, 48); ctx.lineTo(x + 14, 22 + (i % 2) * 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 48); ctx.lineTo(x + 14, 74 - (i % 2) * 8); ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  const cloudTex = (() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 160;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 320, 160);
    // Overlapping soft masses form one coherent cloud instead of scattered dots.
    for (let i = 0; i < 26; i++) {
      const x = 90 + Math.random() * 140;
      const y = 78 + Math.random() * 34;
      const r = 30 + Math.random() * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,248,238,0.22)');
      g.addColorStop(0.55, 'rgba(255,240,225,0.12)');
      g.addColorStop(1, 'rgba(255,232,210,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  const birdTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(30,30,28,0.85)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(8, 38); ctx.quadraticCurveTo(24, 24, 32, 34); ctx.quadraticCurveTo(40, 24, 56, 38); ctx.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  /* ─────────────────────────── terrain ─────────────────────────── */
  const SIZE = 360, SEG = 180;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrassA = new THREE.Color(0x557a2e), cGrassB = new THREE.Color(0x7fa344), cGrassC = new THREE.Color(0x35551e);
  const cSand = new THREE.Color(0xd8c69b), cSandWet = new THREE.Color(0x9c835d), cRock = new THREE.Color(0x70705f), cMud = new THREE.Color(0x665f3d);
  const cDirt = new THREE.Color(0x8a6f47);
  const pathSegments = [
    [34, 54, 66, 24], [66, 24, 10, -30], [10, -30, -16, -108], [10, -30, -76, 8],
    [-58, 66, -76, 8], [34, 54, -58, 66], [66, 24, 86, -58], [-76, 8, -58, 66]
  ];
  const distToPath = (x, z) => {
    let best = 1e9;
    for (const [ax, az, bx, bz] of pathSegments) {
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = ax + dx * t, pz = az + dz * t;
      best = Math.min(best, Math.hypot(x - px, z - pz));
    }
    return best;
  };
  const tmpColor = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = islandHeight(x, z);
    pos.setY(i, h);
    const slope = Math.abs(islandHeight(x + 2, z) - h) + Math.abs(islandHeight(x, z + 2) - h);
    const n = noise2.fbm(x * 0.08, z * 0.08, 3);
    if (h < 0.55) tmpColor.copy(cSandWet);
    else if (h < 2.5) tmpColor.copy(cSand).lerp(cSandWet, clamp((2.5 - h) / 2, 0, 1) * 0.65);
    else {
      tmpColor.copy(cGrassA).lerp(cGrassB, n);
      if (n > 0.6) tmpColor.lerp(cGrassC, (n - 0.6) * 1.8);
      if (h > 17 || slope > 0.8) tmpColor.lerp(cRock, clamp((Math.max(h - 16, slope - 0.75) / 4), 0, 0.82));
      if (n < 0.34 && h < 6) tmpColor.lerp(cMud, 0.16);
      if (h < 3.2) tmpColor.lerp(cSand, 1 - (h - 2.5) / 0.7);
      const pd = distToPath(x, z);
      if (pd < 3.6) tmpColor.lerp(cDirt, clamp(1 - pd / 3.6, 0, 1) * 0.7);
    }
    tmpColor.multiplyScalar(0.85 + n * 0.28);
    colors[i * 3] = tmpColor.r; colors[i * 3 + 1] = tmpColor.g; colors[i * 3 + 2] = tmpColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: detail, roughness: 1, metalness: 0,
    envMapIntensity: 0.35
  });
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);
  collisionMeshes.push(terrain);

  /* ─────────────────────────── water ─────────────────────────── */
  const waterUniforms = {
    time: { value: 0 },
    sunDir: { value: sunDir },
    deep: { value: new THREE.Color(0x073a45) },
    shallow: { value: new THREE.Color(0x2a948e) },
    skyCol: { value: new THREE.Color(0xd8e2dc) },
    fogColor: { value: new THREE.Color(0xa9c4c0) },
    fogDensity: { value: 0.0029 }
  };
  const waterGeo = new THREE.PlaneGeometry(900, 900, 96, 96);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    vertexShader: /* glsl */`
      uniform float time;
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin(p.x * 0.18 + time * 1.1) * 0.07 + cos(p.z * 0.22 - time * 0.9) * 0.06;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float time;
      uniform vec3 sunDir, deep, shallow, skyCol, fogColor;
      uniform float fogDensity;
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 2.6);
        float w1 = sin(vWorld.x * 0.42 + time * 1.35) * cos(vWorld.z * 0.34 - time * 0.95);
        float w2 = sin(vWorld.x * 0.09 - time * 0.4 + vWorld.z * 0.13);
        float ripple = w1 * 0.5 + w2 * 0.5;
        vec3 col = mix(deep, shallow, 0.34 + ripple * 0.1 + fres * 0.34);
        col = mix(col, skyCol, fres * 0.5);
        vec3 n = normalize(vec3(ripple * 0.08, 1.0, w2 * 0.06));
        vec3 refl = reflect(-sunDir, n);
        float spec = pow(max(dot(refl, -viewDir), 0.0), 120.0);
        col += vec3(1.0, 0.72, 0.36) * spec * 2.2;
        float sparkle = pow(max(dot(refl, -viewDir), 0.0), 500.0) * 4.0;
        col += vec3(1.0, 0.9, 0.7) * sparkle;
        float dist = length(cameraPosition - vWorld);
        float fogF = 1.0 - exp(-pow(dist * fogDensity, 2.0));
        col = mix(col, fogColor, clamp(fogF, 0.0, 1.0));
        gl_FragColor = vec4(col, 0.96);
      }`
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -0.12;
  water.renderOrder = 1;
  scene.add(water);

  /* ─────────────────────────── helpers ─────────────────────────── */
  const mat = {
    wood: new THREE.MeshStandardMaterial({ map: woodTex, color: 0xffffff, roughness: 0.88 }),
    woodDark: new THREE.MeshStandardMaterial({ map: woodTex, color: 0x7d6a52, roughness: 0.9 }),
    thatch: new THREE.MeshStandardMaterial({ map: thatchTex, color: 0xd8c088, roughness: 1 }),
    metal: new THREE.MeshStandardMaterial({ map: metalTex, color: 0xffffff, roughness: 0.62, metalness: 0.55 }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x2a3032, roughness: 0.6, metalness: 0.7 }),
    stone: new THREE.MeshStandardMaterial({ map: stoneTex, color: 0xc8c4b4, roughness: 0.95 }),
    sand: new THREE.MeshStandardMaterial({ color: 0xcbb78b, roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ map: leafTex, color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.45, transparent: false }),
    palmLeaf: new THREE.MeshStandardMaterial({ color: 0x3f6d2b, roughness: 0.9, side: THREE.DoubleSide }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x6b5036, roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd6d0, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.45 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe7e2d4, roughness: 0.75 }),
    red: new THREE.MeshStandardMaterial({ color: 0xa73a2c, roughness: 0.8 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1a1c1b, roughness: 0.8 }),
    rope: new THREE.MeshStandardMaterial({ color: 0x9a8556, roughness: 1 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a244, roughness: 0.35, metalness: 0.75 })
  };

  function shadow(mesh, cast = true, receive = true) {
    mesh.castShadow = cast && quality.shadows > 0;
    mesh.receiveShadow = receive;
    return mesh;
  }

  function addCollider(x, z, radius, height = 3, mesh = null, los = true) {
    colliders.push({ x, z, r: radius, h: height, los });
    if (mesh) collisionMeshes.push(mesh);
  }

  function box(w, h, d, material, x = 0, y = 0, z = 0, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    return shadow(m, cast);
  }

  /* ─────────────────────────── palms ─────────────────────────── */
  function palm(x, z, scale = 1) {
    const g = new THREE.Group();
    const h = randRange(rng, 7.0, 11.0) * scale;
    const lean = randRange(rng, -1.5, 1.5);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(lean * 0.14, h * 0.34, lean * 0.08),
      new THREE.Vector3(lean * 0.46, h * 0.7, lean * 0.2),
      new THREE.Vector3(lean, h * 0.98, lean * 0.34)
    ]);
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.21 * scale, 7, false), mat.trunk);
    shadow(trunk, true, true);
    g.add(trunk);
    const top = curve.getPoint(0.98);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + rng() * 0.24;
      const inner = i < 4;
      const len = inner ? randRange(rng, 2.4, 3.1) : randRange(rng, 3.8, 5.2);
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(len * scale, (inner ? 0.82 : 0.68) * scale, 6, 1), mat.leaf);
      const p = frond.geometry.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const px = p.getX(v);
        const t = (px + len * scale / 2) / (len * scale);
        p.setZ(v, -Math.pow(t, 2) * (inner ? 0.5 : 1.25) * scale);
        p.setY(v, p.getY(v) * (0.45 + t * 0.9));
      }
      frond.geometry.computeVertexNormals();
      frond.position.copy(top);
      frond.rotation.set(inner ? -0.12 - rng() * 0.12 : -0.42 - rng() * 0.28, a, (rng() - 0.5) * 0.12);
      frond.position.x += Math.cos(a) * (inner ? 0.9 : 1.3) * scale;
      frond.position.z += Math.sin(a) * (inner ? 0.9 : 1.3) * scale;
      shadow(frond, false, false);
      g.add(frond);
    }
    for (let i = 0; i < 4; i++) {
      const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.15 * scale, 6, 5), mat.trunk);
      coconut.position.set(top.x + randRange(rng, -0.4, 0.4), top.y - 0.18, top.z + randRange(rng, -0.4, 0.4));
      g.add(coconut);
    }
    g.position.set(x, islandHeight(x, z) - 0.1, z);
    g.rotation.y = rng() * Math.PI * 2;
    scene.add(g);
    addCollider(x, z, 0.42 * scale, h, trunk, false);
    swayGroups.push({ obj: g, speed: 0.5 + rng() * 0.5, phase: rng() * 6, amount: 0.008 + rng() * 0.01, base: 0 });
    return g;
  }

  function broadleaf(x, z, scale = 1) {
    const g = new THREE.Group();
    const h = randRange(rng, 4.5, 8) * scale;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.32 * scale, h, 6), mat.trunk);
    trunk.position.y = h / 2; shadow(trunk);
    g.add(trunk);
    const greens = [0x3f6428, 0x50792f, 0x638c3a, 0x35551f];
    for (let i = 0; i < 6; i++) {
      const s = randRange(rng, 1.2, 2.3) * scale;
      const bx = randRange(rng, -1.5, 1.5) * scale;
      const by = h + randRange(rng, -0.5, 1.5) * scale;
      const bz = randRange(rng, -1.5, 1.5) * scale;
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), new THREE.MeshStandardMaterial({
        color: greens[i % greens.length], roughness: 0.96, flatShading: true
      }));
      blob.position.set(bx, by, bz);
      blob.scale.y = randRange(rng, 0.55, 0.9);
      shadow(blob);
      g.add(blob);
      if (i > 1) {
        const dir = new THREE.Vector3(bx, by - h * 0.72, bz);
        const len = dir.length();
        if (len > 0.2) {
          const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * scale, 0.1 * scale, len, 5), mat.trunk);
          branch.position.set(bx * 0.45, h * 0.72 + (by - h * 0.72) * 0.45, bz * 0.45);
          branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
          g.add(branch);
        }
      }
    }
    g.position.set(x, islandHeight(x, z), z);
    scene.add(g);
    addCollider(x, z, 0.5 * scale, h, trunk, false);
    swayGroups.push({ obj: g, speed: 0.4 + rng() * 0.4, phase: rng() * 6, amount: 0.005 + rng() * 0.007, base: 0 });
  }

  function rock(x, z, scale = 1, y = null) {
    const ge = new THREE.IcosahedronGeometry(1, 1);
    const p = ge.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = 0.82 + noise2.noise(p.getX(i) * 2 + x, p.getZ(i) * 2 + z) * 0.38;
      p.setXYZ(i, p.getX(i) * v, p.getY(i) * v, p.getZ(i) * v);
    }
    ge.computeVertexNormals();
    const m = new THREE.Mesh(ge, new THREE.MeshStandardMaterial({ color: 0x7d7b6d, roughness: 0.98, flatShading: true }));
    m.scale.set(scale * randRange(rng, 0.8, 1.4), scale * randRange(rng, 0.55, 1.05), scale * randRange(rng, 0.8, 1.4));
    m.rotation.set(rng() * 0.4, rng() * Math.PI, rng() * 0.4);
    m.position.set(x, (y ?? islandHeight(x, z)) + scale * 0.25, z);
    shadow(m);
    scene.add(m);
    addCollider(x, z, scale * 1.0, scale, m, true);
    return m;
  }

  /* ─────────────────────────── structures ─────────────────────────── */
  function hut(x, z, rot = 0, size = 1) {
    const g = new THREE.Group();
    const w = 5.6 * size, d = 4.4 * size, h = 2.5 * size;
    const floor = box(w, 0.28, d, mat.woodDark, 0, 0.24, 0);
    g.add(floor);
    const wallH = h;
    const back = box(w, wallH, 0.18, mat.wood, 0, 0.38 + wallH / 2, -d / 2);
    const left = box(0.18, wallH, d, mat.wood, -w / 2, 0.38 + wallH / 2, 0);
    const right = box(0.18, wallH, d, mat.wood, w / 2, 0.38 + wallH / 2, 0);
    const frontL = box(w * 0.33, wallH, 0.18, mat.wood, -w * 0.335, 0.38 + wallH / 2, d / 2);
    const frontR = box(w * 0.33, wallH, 0.18, mat.wood, w * 0.335, 0.38 + wallH / 2, d / 2);
    const lintel = box(w * 0.36, 0.5, 0.2, mat.wood, 0, 0.38 + wallH - 0.25, d / 2);
    g.add(back, left, right, frontL, frontR, lintel);
    // thatched gable roof
    const roofRise = 0.92 * Math.max(0.8, size);
    const roofAngle = Math.atan2(roofRise, d / 2 + 0.35);
    const roofLen = Math.hypot(d / 2 + 0.55, roofRise);
    const roofBase = 0.4 + wallH;
    for (const side of [-1, 1]) {
      const roof = box(w + 1.5, 0.14, roofLen, mat.thatch, 0, roofBase + roofRise * 0.46, side * (d / 4 + 0.2), true);
      roof.rotation.x = side * roofAngle;
      g.add(roof);
      const eave = box(w + 1.7, 0.1, 0.26, mat.woodDark, 0, roofBase + 0.02, side * (d / 2 + 0.45), false);
      g.add(eave);
    }
    const ridge = box(w + 1.5, 0.16, 0.22, mat.woodDark, 0, roofBase + roofRise, 0);
    g.add(ridge);
    // triangular gables
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-w / 2, 0);
    gableShape.lineTo(0, roofRise);
    gableShape.lineTo(w / 2, 0);
    gableShape.closePath();
    const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: 0.12, bevelEnabled: false });
    for (const side of [-1, 1]) {
      const gable = new THREE.Mesh(gableGeo, mat.wood);
      gable.position.set(0, 0.4 + wallH, side * d / 2 - (side > 0 ? 0 : 0.12));
      gable.castShadow = quality.shadows > 0;
      g.add(gable);
    }
    // windows + door frame
    for (const sx of [-1, 1]) {
      const win = box(0.06, 0.72, 0.92, mat.glass, sx * (w / 2 + 0.01), 0.4 + wallH * 0.62, -d * 0.14);
      win.material = new THREE.MeshStandardMaterial({ color: 0x1b2b2b, roughness: 0.35, metalness: 0.25 });
      g.add(win);
      const frameTop = box(0.08, 0.07, 1.05, mat.woodDark, sx * (w / 2 + 0.03), 0.4 + wallH * 0.62 + 0.4, -d * 0.14);
      const frameBot = frameTop.clone(); frameBot.position.y -= 0.8;
      g.add(frameTop, frameBot);
    }
    const door = box(1.0, 1.85, 0.08, mat.woodDark, 0, 0.4 + 0.92, d / 2 + 0.06);
    g.add(door);
    for (const sx of [-1, 1]) {
      g.add(box(0.07, 1.95, 0.14, mat.woodDark, sx * 0.55, 0.4 + 0.96, d / 2 + 0.07));
    }
    // stilts / porch
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const stilt = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.2, 5), mat.woodDark);
      stilt.position.set(sx * w * 0.4, -0.2, sz * d * 0.38);
      stilt.castShadow = quality.shadows > 0;
      g.add(stilt);
    }
    const porch = box(w + 1.2, 0.12, 1.5, mat.woodDark, 0, 0.34, d / 2 + 0.7);
    g.add(porch);
    // interior crate + barrel props
    const inner = box(0.8, 0.8, 0.8, mat.wood, -w * 0.22, 0.78, -d * 0.2);
    g.add(inner);
    g.position.set(x, islandHeight(x, z), z);
    g.rotation.y = rot;
    scene.add(g);
    addCollider(x, z, Math.max(w, d) * 0.52, h + 2, back, true);
    return g;
  }

  function container(x, z, rot = 0, color = 0x9c4530) {
    const g = new THREE.Group();
    const w = 6.2, h = 2.6, d = 2.5;
    const m = new THREE.MeshStandardMaterial({ map: metalTex, color, roughness: 0.68, metalness: 0.42 });
    const body = box(w, h, d, m, 0, h / 2 + 0.18, 0);
    g.add(body);
    const frameMat = mat.metalDark;
    for (const sx of [-1, 1]) {
      g.add(box(0.12, h + 0.1, 0.14, frameMat, sx * w / 2, h / 2 + 0.18, d / 2));
      g.add(box(0.12, h + 0.1, 0.14, frameMat, sx * w / 2, h / 2 + 0.18, -d / 2));
      g.add(box(0.1, h * 0.9, d * 0.94, frameMat, sx * (w / 2 - 0.02), h / 2 + 0.18, 0));
    }
    for (const sz of [-1, 1]) {
      g.add(box(w, 0.12, 0.12, frameMat, 0, h + 0.18, sz * d / 2));
      g.add(box(w, 0.12, 0.12, frameMat, 0, 0.2, sz * d / 2));
    }
    const handle = box(0.06, 0.5, 0.06, mat.metalDark, w / 2 - 0.5, h * 0.55, d / 2 + 0.06, false);
    g.add(handle);
    g.position.set(x, islandHeight(x, z) + 0.02, z);
    g.rotation.y = rot;
    scene.add(g);
    addCollider(x, z, Math.max(w, d) * 0.5, h, body, true);
    return g;
  }

  function crate(x, z, rot = 0, y = null, scale = 1) {
    const m = box(1.35 * scale, 1.35 * scale, 1.35 * scale, mat.wood);
    m.position.set(x, (y ?? islandHeight(x, z)) + 0.675 * scale, z);
    m.rotation.y = rot;
    const edgeMat = mat.woodDark;
    for (const sx of [-1, 1]) {
      const b = box(0.08 * scale, 1.37 * scale, 0.08 * scale, edgeMat, sx * 0.64 * scale, 0, 0.64 * scale, false);
      m.add(b);
      const b2 = b.clone(); b2.position.z = -0.64 * scale; m.add(b2);
    }
    scene.add(m);
    addCollider(x, z, 0.85 * scale, 1.4 * scale, m, true);
    return m;
  }

  function barrel(x, z, color = 0xb8452c, y = null) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.05, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.35, map: metalTex }));
    m.position.set(x, (y ?? islandHeight(x, z)) + 0.53, z);
    m.rotation.y = rng() * Math.PI;
    shadow(m);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.365, 0.028, 4, 16), mat.metalDark);
    band.rotation.x = Math.PI / 2; band.position.y = 0.2;
    m.add(band);
    const band2 = band.clone(); band2.position.y = -0.2; m.add(band2);
    scene.add(m);
    addCollider(x, z, 0.45, 1.1, m, true);
    return m;
  }

  function fenceLine(x, z, len, rot = 0) {
    const g = new THREE.Group();
    const posts = Math.floor(len / 2.2);
    for (let i = 0; i <= posts; i++) {
      const p = box(0.12, 1.15, 0.12, mat.woodDark, i * 2.2 - len / 2, 0.57, 0, false);
      g.add(p);
    }
    for (const yy of [0.45, 0.92]) {
      const rail = box(len, 0.08, 0.1, mat.woodDark, 0, yy, 0, false);
      g.add(rail);
    }
    g.position.set(x, islandHeight(x, z), z);
    g.rotation.y = rot;
    scene.add(g);
    return g;
  }

  function watchtower(x, z) {
    const g = new THREE.Group();
    const baseH = 4.2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = box(0.2, baseH, 0.2, mat.woodDark, sx * 1.4, baseH / 2, sz * 1.4);
      leg.rotation.z = sx * 0.06; leg.rotation.x = -sz * 0.06;
      g.add(leg);
    }
    g.add(box(3.6, 0.18, 3.6, mat.wood, 0, baseH, 0));
    g.add(box(0.12, 1.0, 3.6, mat.woodDark, -1.8, baseH + 0.55, 0, false));
    g.add(box(0.12, 1.0, 3.6, mat.woodDark, 1.8, baseH + 0.55, 0, false));
    g.add(box(3.6, 0.12, 1.0, mat.woodDark, 0, baseH + 0.55, -1.8, false));
    g.add(box(3.6, 0.12, 1.0, mat.woodDark, 0, baseH + 0.55, 1.8, false));
    for (const sx of [-1, 1]) {
      const roof = box(4.6, 0.12, 2.3, mat.thatch, 0, baseH + 2.05, sx * 1.02, false);
      roof.rotation.x = sx * -0.5; g.add(roof);
    }
    const ladder = box(0.5, baseH, 0.08, mat.woodDark, 0, baseH / 2, 1.9, false);
    g.add(ladder);
    for (let i = 0; i < 8; i++) g.add(box(0.6, 0.05, 0.12, mat.woodDark, 0, 0.4 + i * 0.5, 1.86, false));
    g.position.set(x, islandHeight(x, z), z);
    scene.add(g);
    addCollider(x, z, 2.0, baseH + 2, g, false);
  }

  function lighthouse(x, z) {
    const baseY = islandHeight(x, z);
    const g = new THREE.Group();
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.5, 7, 16), mat.white);
    lower.position.y = 3.5; shadow(lower); g.add(lower);
    const red = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.6, 3.2, 16), mat.red);
    red.position.y = 8.6; shadow(red); g.add(red);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 2.25, 4.6, 16), mat.white);
    upper.position.y = 12.5; shadow(upper); g.add(upper);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.24, 16), mat.metalDark);
    deck.position.y = 14.9; shadow(deck); g.add(deck);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 2.0, 10), mat.glass);
    lantern.position.y = 16.0; g.add(lantern);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }));
    lamp.position.y = 16.0; g.add(lamp);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.5, 12), mat.red);
    roof.position.y = 17.7; shadow(roof); g.add(roof);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const dir of [1, -1]) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(3.2, 38, 14, 1, true), beamMat);
      beam.rotation.z = Math.PI / 2;
      beam.rotation.y = dir > 0 ? 0 : Math.PI;
      beam.position.set(dir * 19, 16.0, 0);
      g.add(beam);
      beams.push(beam);
    }
    g.position.set(x, baseY, z);
    scene.add(g);
    addCollider(x, z, 3.4, 18, lower, true);
    // rocks at the cliff base
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2;
      rock(x + Math.cos(a) * 6, z + Math.sin(a) * 6, randRange(rng, 1.2, 2.4));
    }
    return g;
  }

  function ruins(cx, cz) {
    const baseY = islandHeight(cx, cz);
    const stoneMat = mat.stone;
    // platform
    const platform = box(9, 0.6, 9, stoneMat, cx, baseY + 0.3, cz);
    scene.add(platform);
    // columns
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = cx + Math.cos(a) * 3.6, pz = cz + Math.sin(a) * 3.6;
      const h = i === 2 ? 3.2 : 4.4 + (i % 2) * 0.4;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, h, 10), stoneMat);
      col.position.set(px, baseY + 0.6 + h / 2, pz);
      shadow(col); scene.add(col);
      addCollider(px, pz, 0.62, h, col, true);
      if (i !== 2) {
        const cap = box(1.15, 0.3, 1.15, stoneMat, px, baseY + 0.6 + h + 0.15, pz);
        scene.add(cap);
      }
    }
    // broken arch and altar
    const altar = box(2.6, 1.0, 1.4, stoneMat, cx, baseY + 1.1, cz);
    scene.add(altar);
    addCollider(cx, cz, 1.6, 1.6, altar, true);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.2, 6, 18, Math.PI * 1.35), stoneMat);
    ring.position.set(cx - 0.4, baseY + 3.0, cz); ring.rotation.y = 0.4; shadow(ring); scene.add(ring);
    // vines
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3.2), mat.leaf);
      v.position.set(cx + randRange(rng, -3, 3), baseY + 2.4, cz + randRange(rng, -3, 3));
      v.rotation.y = rng() * Math.PI; scene.add(v);
    }
  }

  function pier(x, z, rot = 0) {
    const g = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const plank = box(1.25, 0.14, 4.0, mat.wood, 0, 0.2, 0, false);
      plank.position.x = i * 1.28 - 5.8;
      plank.rotation.y = randRange(rng, -0.02, 0.02);
      g.add(plank);
    }
    for (let i = 0; i < 5; i++) {
      for (const sz of [-1.7, 1.7]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.2, 6), mat.woodDark);
        post.position.set(i * 2.6 - 5.2, -0.5, sz);
        g.add(post);
      }
    }
    // small boat
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 3.0, 4, 8), new THREE.MeshStandardMaterial({ color: 0x8a3f2c, roughness: 0.8 }));
    hull.rotation.z = Math.PI / 2; hull.rotation.x = Math.PI / 2;
    hull.scale.set(0.8, 1, 0.5);
    hull.position.set(7.2, 0.15, 2.8);
    shadow(hull); g.add(hull);
    g.position.set(x, 0.35, z);
    g.rotation.y = rot;
    scene.add(g);
    addCollider(x, z, 2.5, 2, g, false);
    return g;
  }

  function campfire(x, z) {
    const g = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      rock(x + Math.cos(a) * 0.9, z + Math.sin(a) * 0.9, 0.22);
    }
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.2, 5), mat.woodDark);
      log.rotation.z = Math.PI / 2; log.rotation.y = i * Math.PI / 3;
      log.position.set(x, 0.35, z);
      g.add(log);
    }
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.scale.setScalar(1.6); flame.position.set(x, 0.9, z); scene.add(flame);
    scene.add(g);
    beams.push(flame);
    addCollider(x, z, 1.1, 0.6, g, false);
  }

  /* ─────────────────────────── populate island ─────────────────────────── */
  // Terrain z-fighting guard
  const place = (x, z) => islandHeight(x, z);

  // Beach spawn area + pier
  pier(6, 102, 0);
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const r = randRange(rng, 3, 14);
    crate(6 + Math.cos(a) * r, 88 + Math.sin(a) * r * 0.5, rng() * Math.PI);
  }
  barrel(17, 84, 0xb8452c); barrel(19, 82, 0x2f5f7a); barrel(-4, 92, 0x7a6a2f);

  // Porto — west
  const porto = { x: -76, z: 8 };
  for (let i = 0; i < 8; i++) {
    container(porto.x + randRange(rng, -14, 14), porto.z + randRange(rng, -12, 12), rng() * Math.PI, [0x9c4530, 0x2f5f7a, 0x3f6f43, 0x8c7c3a][i % 4]);
  }
  for (let i = 0; i < 10; i++) {
    crate(porto.x + randRange(rng, -17, 17), porto.z + randRange(rng, -15, 15), rng() * Math.PI, null, randRange(rng, 0.8, 1.2));
  }
  watchtower(porto.x + 7, porto.z - 13);
  barrel(porto.x - 6, porto.z + 5); barrel(porto.x - 4.8, porto.z + 5.4, 0x2f5f7a);
  fenceLine(porto.x, porto.z + 18, 20, 0.1);

  // Vila — east
  const vila = { x: 66, z: 24 };
  for (let i = 0; i < 5; i++) {
    hut(vila.x + Math.cos(i * 1.9) * 13, vila.z + Math.sin(i * 1.9) * 11, rng() * Math.PI, randRange(rng, 0.85, 1.15));
  }
  campfire(vila.x, vila.z + 2);
  for (let i = 0; i < 8; i++) crate(vila.x + randRange(rng, -16, 16), vila.z + randRange(rng, -14, 14), rng() * Math.PI);
  fenceLine(vila.x - 15, vila.z - 12, 16, 0.8);
  for (let i = 0; i < 3; i++) broadleaf(vila.x + randRange(rng, -22, 22), vila.z + randRange(rng, -18, 18), randRange(rng, 0.8, 1.2));

  // Farol — north cliff
  lighthouse(-16, -108);
  for (let i = 0; i < 6; i++) crate(-16 + randRange(rng, -8, 8), -98 + randRange(rng, -7, 7), rng() * Math.PI, null, 0.9);
  hut(-36, -98, 0.6, 0.9);
  rock(-8, -116, 2.4); rock(-26, -118, 1.9); rock(2, -121, 2.9);

  // Ruínas — center north
  ruins(10, -30);
  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2, r = randRange(rng, 8, 18);
    rock(10 + Math.cos(a) * r, -30 + Math.sin(a) * r, randRange(rng, 0.5, 1.5));
  }
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2, r = randRange(rng, 9, 16);
    crate(10 + Math.cos(a) * r, -30 + Math.sin(a) * r, rng() * Math.PI);
  }

  // Fazenda — southwest
  const faz = { x: -58, z: 66 };
  for (let i = 0; i < 3; i++) hut(faz.x + randRange(rng, -12, 12), faz.z + randRange(rng, -10, 10), rng() * Math.PI, 1.1);
  for (let i = 0; i < 10; i++) crate(faz.x + randRange(rng, -18, 18), faz.z + randRange(rng, -15, 15), rng() * Math.PI, null, randRange(rng, 0.8, 1.3));
  fenceLine(faz.x - 8, faz.z - 14, 22, 0.2);
  fenceLine(faz.x + 4, faz.z + 16, 18, -0.15);
  barrel(faz.x + 6, faz.z + 3, 0x7a6a2f); barrel(faz.x + 7.2, faz.z + 3.6, 0xb8452c);

  // Acampamento — northeast
  const camp = { x: 86, z: -58 };
  for (let i = 0; i < 4; i++) {
    // tents
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.0, 4), new THREE.MeshStandardMaterial({ color: [0x5b6b3a, 0x6a5838, 0x3f5a4f][i % 3], roughness: 0.95 }));
    tent.position.set(camp.x + randRange(rng, -9, 9), islandHeight(camp.x, camp.z) + 1.0, camp.z + randRange(rng, -8, 8));
    tent.rotation.y = rng() * Math.PI;
    shadow(tent); scene.add(tent);
    addCollider(tent.position.x, tent.position.z, 1.8, 2, tent, true);
  }
  campfire(camp.x, camp.z);
  watchtower(camp.x + 9, camp.z + 7);
  for (let i = 0; i < 6; i++) crate(camp.x + randRange(rng, -10, 10), camp.z + randRange(rng, -9, 9), rng() * Math.PI);

  // scattered props
  for (let i = 0; i < 34; i++) {
    const a = rng() * Math.PI * 2, r = randRange(rng, 8, 122);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (islandHeight(x, z) > 1.2) palm(x, z, randRange(rng, 0.8, 1.3));
  }
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2, r = randRange(rng, 16, 116);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (islandHeight(x, z) > 2) broadleaf(x, z, randRange(rng, 0.8, 1.35));
  }
  for (let i = 0; i < 48; i++) {
    const a = rng() * Math.PI * 2, r = randRange(rng, 6, 130);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (islandHeight(x, z) > 0.8) rock(x, z, randRange(rng, 0.35, 1.4));
  }
  // coastal rocks
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
    const r = randRange(rng, 118, 142);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    rock(x, z, randRange(rng, 1.2, 3.2));
  }

  // grass
  {
    const grassTex = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 64, 64);
      for (let i = 0; i < 7; i++) {
        const x = 6 + Math.random() * 52;
        const w = 2 + Math.random() * 3;
        const g = ctx.createLinearGradient(0, 64, 0, 4);
        g.addColorStop(0, 'rgba(46,74,25,0.85)');
        g.addColorStop(0.6, 'rgba(92,132,46,0.95)');
        g.addColorStop(1, 'rgba(150,180,84,0.9)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - w, 64);
        ctx.quadraticCurveTo(x - w * 0.4, 36, x + (Math.random() - 0.5) * 10, 4 + Math.random() * 14);
        ctx.quadraticCurveTo(x + w * 0.8, 36, x + w, 64);
        ctx.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    })();
    const w = 0.4, h = 0.5;
    const grassGeo = new THREE.BufferGeometry();
    grassGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0,
      0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w
    ], 3));
    grassGeo.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1
    ], 2));
    grassGeo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    grassGeo.computeVertexNormals();
    const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.42, roughness: 1, side: THREE.DoubleSide, color: 0xffffff });
    const grassCount = qualityName === 'high' ? 32000 : qualityName === 'medium' ? 14000 : 3500;
    const inst = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
    const color = new THREE.Color();
    let n = 0, guard = 0;
    while (n < grassCount && guard < grassCount * 5) {
      guard++;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 128;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const hh = islandHeight(x, z);
      if (hh < 3.0) continue;
      tempObj.position.set(x, hh - 0.04, z);
      tempObj.rotation.set(0, rng() * Math.PI, 0);
      const s = randRange(rng, 0.62, 1.25);
      tempObj.scale.set(s, s * randRange(rng, 0.55, 1.05), s);
      tempObj.updateMatrix();
      inst.setMatrixAt(n, tempObj.matrix);
      color.setHSL(0.18 + rng() * 0.06, 0.22 + rng() * 0.2, 0.82 + rng() * 0.18);
      inst.setColorAt(n, color);
      n++;
    }
    inst.count = n;
    inst.castShadow = false; inst.receiveShadow = false;
    inst.frustumCulled = false;
    scene.add(inst);
  }

  // low bushes for ground cover
  {
    const bushGeo = new THREE.IcosahedronGeometry(0.55, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x4d752f, roughness: 1, flatShading: true });
    const count = 200;
    const inst = new THREE.InstancedMesh(bushGeo, bushMat, count);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 118;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const hh = islandHeight(x, z);
      if (hh < 3) { tempObj.scale.setScalar(0.0001); }
      else {
        tempObj.position.set(x, hh + 0.06, z);
        tempObj.rotation.set(rng(), rng() * 6, rng() * 0.3);
        const s = randRange(rng, 0.45, 1.1);
        tempObj.scale.set(s, s * randRange(rng, 0.42, 0.68), s);
      }
      tempObj.updateMatrix();
      inst.setMatrixAt(i, tempObj.matrix);
      color.setHSL(0.23 + rng() * 0.05, 0.3 + rng() * 0.16, 0.3 + rng() * 0.14);
      inst.setColorAt(i, color);
    }
    inst.castShadow = quality.shadows > 0;
    inst.receiveShadow = true;
    scene.add(inst);
  }

  // clouds
  for (let i = 0; i < quality.clouds; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, color: 0xffd8b0, transparent: true, opacity: randRange(rng, 0.22, 0.45),
      depthWrite: false, fog: false
    }));
    const a = rng() * Math.PI * 2, r = randRange(rng, 260, 420);
    sprite.position.set(Math.cos(a) * r, randRange(rng, 55, 120), Math.sin(a) * r);
    sprite.scale.set(randRange(rng, 110, 210), randRange(rng, 34, 62), 1);
    scene.add(sprite);
    clouds.push({ sprite, speed: randRange(rng, 0.4, 1.1), phase: rng() * 6 });
  }

  // distant islands
  const farMat = new THREE.MeshStandardMaterial({ color: 0x4a5f55, roughness: 1, flatShading: true });
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2, r = randRange(rng, 265, 390);
    const island = new THREE.Mesh(new THREE.ConeGeometry(randRange(rng, 22, 60), randRange(rng, 14, 40), 7), farMat);
    island.position.set(Math.cos(a) * r, -4, Math.sin(a) * r);
    island.rotation.y = rng() * Math.PI;
    scene.add(island);
  }

  // birds
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: birdTex, transparent: true, opacity: 0.75, depthWrite: false }));
    const r = randRange(rng, 55, 115), a = rng() * Math.PI * 2;
    b.position.set(Math.cos(a) * r, randRange(rng, 22, 42), Math.sin(a) * r);
    b.scale.setScalar(randRange(rng, 1.2, 2.4));
    scene.add(b);
    birds.push({ sprite: b, r, a, speed: randRange(rng, 0.02, 0.05) * (rng() > 0.5 ? 1 : -1), y: b.position.y });
  }

  // ground haze near the shoreline (kept subtle; no floating sprites in the sky)
  {
    const count = 0;
    const positions = new Float32Array(Math.max(1, count) * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({
      map: glowTex, color: 0xffe0ad, size: 0.1, transparent: true, opacity: 0.25,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    scene.add(p);
    birds.dust = p;
  }

  // foam ring hint at the shoreline
  {
    const ringGeo = new THREE.RingGeometry(112, 158, 72, 1);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe9e0c9, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
    water.userData.foam = ring;
  }

  /* ─────────────────────────── POIs & loot ─────────────────────────── */
  const pois = [
    { name: 'PORTO', x: porto.x, z: porto.z, type: 'port' },
    { name: 'VILA', x: vila.x, z: vila.z, type: 'town' },
    { name: 'FAROL', x: -16, z: -108, type: 'lighthouse' },
    { name: 'RUÍNAS', x: 10, z: -30, type: 'ruins' },
    { name: 'FAZENDA', x: faz.x, z: faz.z, type: 'farm' },
    { name: 'CAMPO', x: camp.x, z: camp.z, type: 'camp' }
  ];

  const lootSpots = [];
  const lootTypes = ['ammo', 'ammo', 'ammo', 'med', 'med', 'armor'];
  for (const poi of pois) {
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2, r = randRange(rng, 2.5, 11);
      lootSpots.push({ x: poi.x + Math.cos(a) * r, z: poi.z + Math.sin(a) * r, type: lootTypes[Math.floor(rng() * lootTypes.length)] });
    }
  }
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, r = randRange(rng, 12, 110);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (islandHeight(x, z) < 1.5) continue;
    lootSpots.push({ x, z, type: lootTypes[Math.floor(rng() * lootTypes.length)] });
  }
  for (const l of lootSpots) l.y = islandHeight(l.x, l.z);

  const playerSpawn = { x: 32, z: 56, y: islandHeight(32, 56), yaw: -0.78 };

  const spawnPoints = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + 0.3;
    const r = randRange(rng, 36, 112);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (islandHeight(x, z) < 1.6) continue;
    spawnPoints.push({ x, z });
  }

  /* ─────────────────────────── minimap bitmap ─────────────────────────── */
  const mapSize = 320;
  const mapExtent = 320;
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = mapCanvas.height = mapSize;
  {
    const ctx = mapCanvas.getContext('2d');
    const img = ctx.createImageData(mapSize, mapSize);
    for (let py = 0; py < mapSize; py++) {
      for (let px = 0; px < mapSize; px++) {
        const x = (px / mapSize - 0.5) * mapExtent;
        const z = (py / mapSize - 0.5) * mapExtent;
        const h = islandHeight(x, z);
        let r, g, b;
        if (h < 0) {
          const t = clamp(-h / 8, 0, 1);
          r = lerp(30, 8, t); g = lerp(80, 46, t); b = lerp(84, 58, t);
        } else if (h < 2.2) {
          r = 176; g = 158; b = 112;
        } else if (h > 15) {
          r = 107; g = 108; b = 94;
        } else {
          const n = noise2.fbm(x * 0.06, z * 0.06, 2);
          r = lerp(74, 104, n); g = lerp(98, 129, n); b = lerp(49, 63, n);
        }
        const edge = Math.hypot(x, z) > 150 ? 0.4 : 1;
        const idx = (py * mapSize + px) * 4;
        img.data[idx] = r * edge; img.data[idx + 1] = g * edge; img.data[idx + 2] = b * edge; img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // contour lines
    ctx.strokeStyle = 'rgba(235,240,225,0.08)';
    ctx.lineWidth = 1;
    for (let r = 20; r < 150; r += 14) {
      ctx.beginPath();
      ctx.arc(mapSize / 2, mapSize / 2, (r / mapExtent) * mapSize, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* ─────────────────────────── update ─────────────────────────── */
  let elapsed = 0;
  function update(dt, t) {
    elapsed = t;
    waterUniforms.time.value = t;
    for (const s of swayGroups) {
      const sway = Math.sin(t * s.speed + s.phase) * s.amount;
      s.obj.rotation.z = sway;
      s.obj.rotation.x = Math.cos(t * s.speed * 0.8 + s.phase) * s.amount * 0.6;
    }
    for (const c of clouds) {
      c.sprite.position.x += c.speed * dt;
      if (c.sprite.position.x > 430) c.sprite.position.x = -430;
    }
    for (const b of birds) {
      b.a += b.speed * dt;
      b.sprite.position.set(Math.cos(b.a) * b.r, b.y + Math.sin(t * 0.5 + b.a) * 1.6, Math.sin(b.a) * b.r);
      b.sprite.material.rotation = Math.sin(t * 8 + b.a) * 0.12;
    }
    for (const beam of beams) {
      if (beam.isSprite) {
        const flick = 0.85 + Math.sin(t * 12 + beam.position.x) * 0.1 + Math.sin(t * 23) * 0.04;
        beam.scale.setScalar(1.6 * flick);
      } else if (beam.material && beam.material.opacity !== undefined && beam.parent) {
        beam.parent.rotation.y += dt * 0.22;
      }
    }
    if (water.userData.foam) {
      water.userData.foam.material.opacity = 0.075 + Math.sin(t * 0.7) * 0.025;
      water.userData.foam.position.x = Math.sin(t * 0.11) * 2;
      water.userData.foam.position.z = Math.cos(t * 0.09) * 2;
    }
    if (birds.dust) birds.dust.rotation.y = t * 0.004;
    sunSprite.position.copy(sunDir).multiplyScalar(470);
  }

  return {
    scene, heightAt: islandHeight, sunDir, sun, colliders, collisionMeshes,
    lootSpots, spawnPoints, playerSpawn, pois, mapCanvas, mapExtent, update,
    quality, water, terrain
  };
}
