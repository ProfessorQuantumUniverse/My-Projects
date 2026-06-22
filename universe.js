/* =====================================================================
   universe.js  —  Hybrides 3D-Erlebnis: "Enter My Universe"
   ---------------------------------------------------------------------
   - Scroll-Parallaxe ("Ebenen-Absturz") zwischen Startseite & Gateway
   - Warp-Transition: radiale Linien aus dem Fluchtpunkt (Bildmitte)
   - Cinematic Black Hole: tiefschwarzer Kern, flache, dezente
     Akkretionsscheibe (Temperaturgradient + Doppler-Beaming)
   - Projektkarten auf einem Dome, Blick zum Zentrum; Hover = Active-Flip
     (180°-Drehung zur Kamera, lesbar) + Heranbewegen + Vergrößern
   - Kamera: Dome (Innen, Free-Look + WASD-Flug) <-> Outside (Orbit)
   - Easter Egg: Flug in den Horizont -> Spaghettisierung -> Terminal
   - HUD: [Dome/Inside] <-> [Outside], [Classic Cards], [Back to top]
   ===================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ----------------------------------------------------------------
   Konfiguration
   ---------------------------------------------------------------- */
const COL = {
  violet: new THREE.Color('#a67cff'),
  cyan:   new THREE.Color('#70d6ff'),
  white:  new THREE.Color('#ffffff'),
};

const BH_RADIUS   = 6;        // Event-Horizont
const DISK_INNER  = 7.4;
const DISK_OUTER  = 23;
const DOME_R      = 60;       // Radius des Karten-Loops (mehr Platz)
const INSIDE_HOME  = new THREE.Vector3(0, 10, 0);
const OUTSIDE_HOME = new THREE.Vector3(0, 36, 150);

// Render-Layer: 0 = Hintergrund/Loch/Scheibe (mit Lensing), 1 = Karten
// (lens-immun, darüber gerendert), 2 = Horizont nur für Verdeckungs-Tiefe
const LAYER_BG = 0, LAYER_CARDS = 1, LAYER_OCCLUDE = 2;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ----------------------------------------------------------------
   Element-Referenzen
   ---------------------------------------------------------------- */
const overlay    = document.getElementById('universe-overlay');
const glCanvas   = document.getElementById('universe-canvas');
const warpCanvas = document.getElementById('warp-canvas');
const loadingEl  = document.getElementById('u-loading');
const helpEl     = document.getElementById('u-help');
const detailEl   = document.getElementById('u-detail');
const detailBody = detailEl ? detailEl.querySelector('.u-detail-body') : null;

const enterBtn   = document.getElementById('enter-universe-btn');
const projBtn    = document.getElementById('go-projects-btn');
const hintEl     = document.getElementById('gateway-hint');

const viewInsideBtn  = document.getElementById('u-view-inside');
const viewOutsideBtn = document.getElementById('u-view-outside');
const modeClassicBtn = document.getElementById('u-mode-classic');
const backBtn        = document.getElementById('u-back');
const detailCloseBtn = document.getElementById('u-detail-close');

const flashEl        = document.getElementById('u-flash');
const glitchEl       = document.getElementById('u-glitch');
const terminalEl     = document.getElementById('u-terminal');
const terminalText   = document.getElementById('u-terminal-text');
const terminalExit   = document.getElementById('u-terminal-exit');

/* ----------------------------------------------------------------
   Hilfsfunktionen
   ---------------------------------------------------------------- */
function isMobile() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth < 820;
  const ua = /Android|iPhone|iPad|iPod|Mobile|Mobi|IEMobile|Opera Mini/i.test(navigator.userAgent);
  return ua || (coarse && narrow);
}
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}
function scrollToEl(sel) {
  const el = document.querySelector(sel);
  if (el) el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
}
function lockScroll()   { document.body.style.overflow = 'hidden'; }
function unlockScroll() { document.body.style.overflow = ''; }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ================================================================
   1) SCROLL-PARALLAXE  ("Ebenen-Absturz")
   ================================================================ */
function setupScrollLayers() {
  if (reduceMotion || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);

  // Layer 0: Startseite (Hero) schwebt nach hinten/oben weg
  gsap.to('.hero', {
    scale: 0.82, y: -70, opacity: 0.12, rotateX: 10,
    transformPerspective: 1200, transformOrigin: '50% 0%', ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  });

  // "My Space" zieht sich ebenfalls leicht in die Tiefe zurück
  gsap.to('#ueber-mich', {
    scale: 0.9, y: -45, opacity: 0.22, rotateX: 6,
    transformPerspective: 1200, transformOrigin: '50% 0%', ease: 'none',
    scrollTrigger: { trigger: '#ueber-mich', start: 'top top', end: 'bottom top', scrub: true },
  });

  // Layer 1: Gateway schiebt sich "aus der Grube" nach oben
  gsap.fromTo('#gateway',
    { scale: 0.9, y: 120, opacity: 0.25, rotateX: -9, transformPerspective: 1200, transformOrigin: '50% 100%' },
    { scale: 1, y: 0, opacity: 1, rotateX: 0, ease: 'none',
      scrollTrigger: { trigger: '#gateway', start: 'top bottom', end: 'top center', scrub: true } }
  );
}

/* ================================================================
   2) WARP-TRANSITION  (radial aus dem Fluchtpunkt)
   ================================================================ */
function runWarp(reverse = false, opts = {}) {
  return new Promise((resolve) => {
    if (reduceMotion) { resolve(); return; }
    const ctx = warpCanvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dur = opts.short ? 850 : (reverse ? 1100 : 1400);

    warpCanvas.width  = Math.floor(window.innerWidth  * dpr);
    warpCanvas.height = Math.floor(window.innerHeight * dpr);
    warpCanvas.classList.add('is-active');

    const W = warpCanvas.width, H = warpCanvas.height;
    const cx = W / 2, cy = H / 2;
    const maxR = Math.hypot(cx, cy) * 1.08;
    const palette = ['#ffffff', '#cdbcff', '#a67cff', '#70d6ff'];

    const N = Math.min(360, Math.floor((W * H) / 9000));
    const streaks = [];
    for (let i = 0; i < N; i++) {
      streaks.push({
        ang: Math.random() * Math.PI * 2,
        off: Math.random(),
        len: 0.05 + Math.random() * 0.08,
        c: palette[(Math.random() * palette.length) | 0],
      });
    }

    const start = performance.now();
    function frame(now) {
      const e = Math.min((now - start) / dur, 1);
      const accel = e * e; // langsam -> schnell

      ctx.fillStyle = 'rgba(2,3,10,0.30)';
      ctx.fillRect(0, 0, W, H);
      ctx.lineCap = 'round';

      for (const s of streaks) {
        let head = (accel * 2.4 + s.off) % 1;     // Position entlang des Strahls
        if (reverse) head = 1 - head;             // einwärts statt auswärts
        const tail = reverse ? Math.min(1, head + s.len) : Math.max(0, head - s.len);

        const r2 = Math.pow(head, 2.4) * maxR;
        const r1 = Math.pow(tail, 2.4) * maxR;
        const dx = Math.cos(s.ang), dy = Math.sin(s.ang);

        ctx.strokeStyle = s.c;
        ctx.globalAlpha = Math.min(1, 0.15 + accel + (r2 / maxR) * 0.5);
        ctx.lineWidth = Math.max(0.6, (r2 / maxR) * 2.6) * dpr;
        ctx.beginPath();
        ctx.moveTo(cx + dx * r1, cy + dy * r1);
        ctx.lineTo(cx + dx * r2, cy + dy * r2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (e < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}
function hideWarp() {
  warpCanvas.classList.remove('is-active');
  warpCanvas.style.opacity = '';
  warpCanvas.style.transition = '';
  const ctx = warpCanvas.getContext('2d');
  ctx.clearRect(0, 0, warpCanvas.width, warpCanvas.height);
}
function fadeOutWarp() {
  warpCanvas.style.transition = 'opacity 0.6s ease';
  warpCanvas.style.opacity = '0';
  setTimeout(hideWarp, 650);
}

/* ================================================================
   3) THREE.JS SZENE
   ================================================================ */
let renderer, scene, camera, composer, controls, raycaster;
const pointer = new THREE.Vector2(-2, -2);
const dummy = new THREE.Object3D();
const clock = new THREE.Clock();
const center = new THREE.Vector3(0, 0, 0);

let horizon, disk, diskOccluder, photonRing, glowRim, starfield, starsBright, nebula;
let lensPass, bloomPass, spriteTex;
let novaSystem = null;           // aktive Supernova-Partikel
let cards = [];
let orbiters = [];              // zusätzliche Objekte im Orbit (Planeten, Trümmer)
let projects = [];
let domeAngle = 0;

let sceneBuilt = false;
let running = false;
let animId = null;

let viewMode = 'inside';        // 'inside' | 'outside'
let hovered = null;
let focused = null;
let spaghetti = false;
let introActive = false;        // cinematischer Anflug nach dem Warp
let introTween = null;
let introFinish = null;
let cardsRevealed = false;       // Karten erscheinen erst nach der Supernova
let camFlying = false;           // sanfte Kamerafahrt (Fokus/Modus/Settle) aktiv

// Free-Look / Fly-State (Dome-Modus)
const fly = { yaw: 0, pitch: 0.12, keys: new Set() };
let isDown = false, dragging = false, downX = 0, downY = 0, lastX = 0, lastY = 0;

/* ---- weiche Partikel-Textur ---- */
function makeSpriteTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---- Sternenhintergrund (mehrschichtig: feines Feld + helle Sterne) ---- */
function makeStarLayer(N, rMin, rMax, size, sprite, brightBias) {
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3]     = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    const pick = Math.random();
    tmp.copy(pick > 0.88 ? COL.cyan : pick > 0.74 ? COL.violet : COL.white);
    tmp.multiplyScalar((brightBias || 0.4) + Math.random() * 0.5);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size, map: sprite, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}
function buildStarfield(sprite) {
  starfield   = makeStarLayer(4200, 600, 1800, 2.2, sprite, 0.3);   // feines, tiefes Feld
  starsBright = makeStarLayer(140, 450, 1300, 7.0, sprite, 0.85);   // wenige helle Sterne
  scene.add(starfield);
  scene.add(starsBright);
}

/* ---- Nebel: große, sehr dezente, farbige Wolken weit außen ---- */
function buildNebula(sprite) {
  nebula = new THREE.Group();
  const clouds = [
    { c: '#5a3fb0', s: 620, p: [-650, 180, -900], o: 0.12 },
    { c: '#2f7fae', s: 720, p: [780, -120, -1000], o: 0.10 },
    { c: '#7a4bd0', s: 520, p: [200, 420, -1200], o: 0.09 },
    { c: '#1f5f8f', s: 600, p: [-400, -360, 1100], o: 0.08 },
  ];
  clouds.forEach(cl => {
    const mat = new THREE.SpriteMaterial({
      map: sprite, color: new THREE.Color(cl.c), transparent: true,
      opacity: cl.o, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(cl.p[0], cl.p[1], cl.p[2]);
    sp.scale.setScalar(cl.s);
    nebula.add(sp);
  });
  scene.add(nebula);
}

/* ---- Akkretionsscheibe: flach, dezent, Temperatur + Doppler ---- */
function diskColor(t) {
  const inner = new THREE.Color('#bcd9ff');
  const mid   = new THREE.Color('#ffb25e');
  const outer = new THREE.Color('#b32400');
  const c = new THREE.Color();
  if (t < 0.5) c.copy(inner).lerp(mid, t / 0.5);
  else c.copy(mid).lerp(outer, (t - 0.5) / 0.5);
  return c;
}
function buildDisk(sprite) {
  const N = 13000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  const dopplerPhase = Math.PI * 0.5;

  for (let i = 0; i < N; i++) {
    const tr = Math.pow(Math.random(), 0.7);
    const r = DISK_INNER + (DISK_OUTER - DISK_INNER) * tr;
    const ang = Math.random() * Math.PI * 2;
    // sehr flache Scheibe (cinematic)
    const thick = (0.08 + tr * 0.45) * (Math.random() + Math.random() + Math.random() - 1.5);
    pos[i * 3]     = Math.cos(ang) * r;
    pos[i * 3 + 1] = thick;
    pos[i * 3 + 2] = Math.sin(ang) * r;

    tmp.copy(diskColor(tr));
    // Doppler-Beaming (1 + cos): eine Seite heller -> aber insgesamt gedämpft
    const beam = 0.28 + 0.6 * (0.5 + 0.5 * Math.cos(ang - dopplerPhase));
    const flick = 0.8 + Math.random() * 0.3;
    tmp.multiplyScalar(beam * flick * 0.6);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.9, map: sprite, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    opacity: 0.6,
  });
  disk = new THREE.Points(geo, mat);
  disk.rotation.x = 0; // Scheibe in der XZ-Ebene (Blick leicht schräg von oben)
  scene.add(disk);

  // Unsichtbarer Tiefen-Occluder: flaches Ellipsoid, das die zentrale
  // Scheiben-/Loch-Region abbildet -> Karten DAHINTER werden verdeckt.
  // (Ein hauchdünner Ring würde die Sichtlinien zu den Karten nie schneiden.)
  diskOccluder = new THREE.Mesh(
    new THREE.SphereGeometry(DISK_OUTER * 0.96, 40, 28),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true })
  );
  diskOccluder.scale.set(1, 0.4, 1);           // abgeflacht -> Scheibenprofil
  diskOccluder.layers.set(LAYER_OCCLUDE);      // nur im Tiefen-Pass
  scene.add(diskOccluder);
}

/* ---- Schwarzes Loch: tiefschwarzer Kern + dezenter Rand/Photon-Ring ---- */
function buildBlackHole() {
  horizon = new THREE.Mesh(
    new THREE.SphereGeometry(BH_RADIUS, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  horizon.name = 'blackhole';
  horizon.layers.enable(LAYER_OCCLUDE); // zusätzlich für den Tiefen-Pass der Karten
  scene.add(horizon);

  // dezenter Fresnel-Rand (Lichtsaum)
  const rimMat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    uniforms: { uColor: { value: new THREE.Color('#5e86c8') }, uIntensity: { value: 0.5 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uIntensity;
      void main(){
        float rim = pow(1.0 - max(dot(vN, vV), 0.0), 3.5);
        gl_FragColor = vec4(uColor * rim * uIntensity, rim);
      }`,
  });
  glowRim = new THREE.Mesh(new THREE.SphereGeometry(BH_RADIUS * 1.04, 64, 64), rimMat);
  scene.add(glowRim);

  // schmaler Photon-/Einstein-Ring (zur Kamera ausgerichtet)
  photonRing = new THREE.Mesh(
    new THREE.TorusGeometry(BH_RADIUS * 1.12, 0.06, 14, 180),
    new THREE.MeshBasicMaterial({ color: 0xc9b48a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  scene.add(photonRing);
}

/* ---- Zusätzliche Orbit-Elemente: Trümmerring + Planeten ---- */
function buildOrbiters(sprite) {
  // (a) geneigter Trümmerring (feine Partikel)
  const N = 1200;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = 38 + Math.random() * 5;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 1.6;
    pos[i * 3 + 2] = Math.sin(a) * r;
    tmp.copy(COL.cyan).multiplyScalar(0.25 + Math.random() * 0.4);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const debris = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.7, map: sprite, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.55,
  }));
  debris.rotation.x = 0.45;
  scene.add(debris);
  orbiters.push({ obj: debris, spin: 0.05, axis: new THREE.Vector3(Math.sin(0.45), Math.cos(0.45), 0).normalize() });

  // (b) ein paar kleine Planeten/Monde (dezent, nicht leuchtend)
  const planets = [
    { r: 84, y: 14, size: 2.0, color: 0x6b7fa6, speed: 0.14, inc: 0.3 },
    { r: 108, y: -22, size: 3.0, color: 0x8a6b9c, speed: 0.10, inc: -0.22 },
    { r: 138, y: 34, size: 1.4, color: 0x4a6b7a, speed: 0.07, inc: 0.5 },
  ];
  planets.forEach(p => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(p.size, 24, 24),
      new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9, metalness: 0.1, emissive: 0x05070d })
    );
    scene.add(mesh);
    orbiters.push({
      obj: mesh, orbitR: p.r, orbitY: p.y, angle: Math.random() * Math.PI * 2,
      speed: p.speed, inc: p.inc, planet: true,
    });
  });

  // dezentes Licht, damit die Planeten Form bekommen
  const key = new THREE.PointLight(0xffe6c0, 2.2, 0, 1.6);
  key.position.set(0, 0, 0);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x223044, 0.6));
}

/* ---- Gravitations-Lensing als Post-Process (verbiegt das Bild ums Loch) ---- */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uHole:    { value: new THREE.Vector2(0.5, 0.5) },
    uAspect:  { value: 1.0 },
    uStrength:{ value: 0.0 },
    uShadow:  { value: 0.05 },
    uActive:  { value: 0.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uHole; uniform float uAspect, uStrength, uShadow, uActive;
    varying vec2 vUv;
    void main(){
      if (uActive < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 d = vUv - uHole; d.x *= uAspect;
      float r = max(length(d), 0.0008);
      // Ablenkung ~ 1/r (stärker nahe am Horizont), begrenzt
      float bend = min(uStrength / r, 0.45);
      vec2 dir = d / r;
      vec2 off = dir * bend; off.x /= uAspect;
      vec4 col = texture2D(tDiffuse, vUv - off);
      // Event-Horizon-Schatten: weicher, tiefschwarzer Kern
      float shadow = smoothstep(uShadow * 0.82, uShadow, r);
      col.rgb *= shadow;
      gl_FragColor = col;
    }`,
};
function projectToUv(v) {
  const p = v.clone().project(camera);
  return { x: p.x * 0.5 + 0.5, y: p.y * 0.5 + 0.5, z: p.z };
}
function updateLens() {
  if (!lensPass) return;
  const u = lensPass.uniforms;
  const holeUv = projectToUv(center);
  const dist = camera.position.distanceTo(center);
  // hinter der Kamera -> Lensing aus
  if (holeUv.z > 1 || dist < BH_RADIUS * 1.05) { u.uActive.value = 0; return; }
  u.uActive.value = 1;
  u.uAspect.value = window.innerWidth / window.innerHeight;
  u.uHole.value.set(holeUv.x, holeUv.y);
  // scheinbare Größe des Horizonts in UV (über einen Randpunkt bestimmen)
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const edgeUv = projectToUv(center.clone().addScaledVector(right, BH_RADIUS));
  let rad = Math.hypot((edgeUv.x - holeUv.x) * u.uAspect.value, edgeUv.y - holeUv.y);
  rad = Math.max(0.02, Math.min(0.32, rad));
  u.uShadow.value = rad * 0.92;
  u.uStrength.value = rad * rad * 2.6; // dezent, skaliert mit Nähe
}

/* ---- Projektkarte als Canvas-Textur ---- */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height, br = w / h;
  let sw, sh, sx, sy;
  if (ir > br) { sh = img.height; sw = sh * br; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / br; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = text.split(' ');
  let line = '', lines = 0;
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + ' ';
    if (ctx.measureText(test).width > maxW && n > 0) {
      ctx.fillText(line.trim(), x, y);
      line = words[n] + ' '; y += lineH; lines++;
      if (lines >= maxLines - 1) {
        let last = line.trim();
        while (ctx.measureText(last + '…').width > maxW && last.length) last = last.slice(0, -1);
        ctx.fillText(last + '…', x, y); return;
      }
    } else { line = test; }
  }
  ctx.fillText(line.trim(), x, y);
}
function initials(title) {
  return title.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}
function drawCard(ctx, W, H, project, img) {
  ctx.clearRect(0, 0, W, H);
  roundRectPath(ctx, 6, 6, W - 12, H - 12, 30);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#101427'); bg.addColorStop(1, '#070b16');
  ctx.fillStyle = bg; ctx.fill();

  const ix = 18, iy = 18, iw = W - 36, ih = Math.round(H * 0.46);
  ctx.save();
  roundRectPath(ctx, ix, iy, iw, ih, 20); ctx.clip();
  if (img) {
    drawCover(ctx, img, ix, iy, iw, ih);
  } else {
    const pg = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih);
    pg.addColorStop(0, '#3a506b'); pg.addColorStop(1, '#1a2740');
    ctx.fillStyle = pg; ctx.fillRect(ix, iy, iw, ih);
    ctx.fillStyle = 'rgba(232,232,240,0.55)';
    ctx.font = 'bold 110px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials(project.title), ix + iw / 2, iy + ih / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  const sh = ctx.createLinearGradient(0, iy + ih - 60, 0, iy + ih);
  sh.addColorStop(0, 'rgba(7,11,22,0)'); sh.addColorStop(1, 'rgba(7,11,22,0.85)');
  ctx.fillStyle = sh; ctx.fillRect(ix, iy + ih - 60, iw, 60);
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 38px Inter, sans-serif';
  wrapText(ctx, project.title, 30, iy + ih + 52, W - 60, 44, 2);

  let tx = 30; const ty = H - 70;
  ctx.font = '20px "Space Mono", monospace';
  (project.tags || []).slice(0, 3).forEach(tag => {
    const tw = ctx.measureText(tag).width + 26;
    if (tx + tw > W - 30) return;
    roundRectPath(ctx, tx, ty - 24, tw, 34, 17);
    ctx.fillStyle = 'rgba(112,214,255,0.12)'; ctx.fill();
    ctx.fillStyle = '#70d6ff'; ctx.fillText(tag, tx + 13, ty);
    tx += tw + 10;
  });

  ctx.fillStyle = 'rgba(166,124,255,0.9)';
  ctx.font = '20px "Space Mono", monospace';
  ctx.fillText('▶ Klick zum Heranfliegen', 30, H - 24);

  roundRectPath(ctx, 6, 6, W - 12, H - 12, 30);
  ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(166,124,255,0.55)'; ctx.stroke();
}
function makeCardMesh(project) {
  const CW = 512, CH = 660;
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext('2d');
  drawCard(ctx, CW, CH, project, null);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const h = 7.0, w = h * (CW / CH);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true });
  mat.toneMapped = false;
  mat.depthWrite = false; // verhindert Z-Fighting/Flackern zwischen überlappenden Karten
  // (Verdeckung durch Loch/Scheibe via depthTest gegen den Tiefen-Pass bleibt erhalten)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.userData.project = project;
  mesh.layers.set(LAYER_CARDS);  // lens-immun (eigener Render-Pass)
  mesh.visible = false;          // erscheinen erst nach der Supernova

  if (project.image) {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => { drawCard(ctx, CW, CH, project, im); tex.needsUpdate = true; };
    im.onerror = () => {};
    im.src = project.image;
  }
  return mesh;
}

async function buildCards() {
  try {
    const res = await fetch('projects.json');
    projects = await res.json();
  } catch (e) { projects = []; }

  const N = projects.length || 1;
  const BAND = 25 * Math.PI / 180;     // ±25° um den Äquator
  const tiers = [-1, 0, 1];            // drei Reihen innerhalb des Bandes
  projects.forEach((p, i) => {
    const mesh = makeCardMesh(p);
    // gleichmäßig im Ring verteilt (Azimut) + Reihe innerhalb des Bandes
    const az = (i / N) * Math.PI * 2;
    const lat = tiers[i % tiers.length] * BAND * 0.7 + (Math.random() - 0.5) * 0.06;
    const y = Math.sin(lat) * DOME_R;
    const rr = Math.cos(lat) * DOME_R;
    const base = new THREE.Vector3(Math.cos(az) * rr, y, Math.sin(az) * rr);
    const card = { mesh, base, baseScale: 1 };
    mesh.position.copy(base);
    mesh.userData.card = card;
    cards.push(card);
    scene.add(mesh);
  });
}

function buildScene() {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x010206, 0.0014);

  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 6000);
  camera.rotation.order = 'YXZ';
  camera.position.copy(INSIDE_HOME);

  controls = new OrbitControls(camera, glCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 12;
  controls.maxDistance = 420;
  controls.autoRotateSpeed = 0.3;
  controls.target.set(0, 0, 0);
  controls.enabled = false; // Start im Dome-Modus (Free-Look)

  raycaster = new THREE.Raycaster();
  raycaster.layers.enableAll(); // damit Karten (Layer 1) per Hover/Klick treffbar sind

  const sprite = makeSpriteTexture();
  spriteTex = sprite;
  buildStarfield(sprite);
  buildNebula(sprite);
  buildBlackHole();
  buildDisk(sprite);
  buildOrbiters(sprite);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.55, 0.5, 0.4 // strength, radius, threshold -> dezent
  );
  composer.addPass(bloomPass);
  // Gravitations-Lensing als letzter Pass
  lensPass = new ShaderPass(LensShader);
  composer.addPass(lensPass);

  // Dome-Free-Look initial ausrichten
  fly.yaw = 0; fly.pitch = 0.12;
  applyFlyRotation();

  glCanvas.addEventListener('pointermove', onPointerMove);
  glCanvas.addEventListener('pointerdown', onPointerDown);
  glCanvas.addEventListener('pointerup', onPointerUp);
  glCanvas.addEventListener('pointerleave', () => { isDown = false; });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
}

/* ---- Free-Look Kamera (Dome) ---- */
function applyFlyRotation() {
  camera.rotation.set(fly.pitch, fly.yaw, 0, 'YXZ');
}
function onKeyDown(e) {
  if (!overlay.classList.contains('is-open')) return;
  if (introActive && e.key !== 'Escape') { skipIntro(); return; }
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', ' '].includes(k) || ['shift'].includes(k)) {
    if (viewMode === 'inside' && !focused && !spaghetti) { fly.keys.add(k); e.preventDefault(); }
  }
  if (e.key === 'Escape') {
    if (spaghetti) resetSpaghetti();
    else if (focused) unfocusCard();
    else exitToClassic(false);
  }
}
function onKeyUp(e) { fly.keys.delete(e.key.toLowerCase()); }

function applyFlyMovement(dt) {
  if (viewMode !== 'inside' || focused || spaghetti) return;
  const speed = 34 * dt;
  const fwd = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  const right = new THREE.Vector3(1, 0, 0).applyEuler(camera.rotation);
  const up = new THREE.Vector3(0, 1, 0);
  const move = new THREE.Vector3();
  if (fly.keys.has('w')) move.add(fwd);
  if (fly.keys.has('s')) move.addScaledVector(fwd, -1);
  if (fly.keys.has('d')) move.add(right);
  if (fly.keys.has('a')) move.addScaledVector(right, -1);
  if (fly.keys.has(' ')) move.add(up);
  if (fly.keys.has('shift')) move.addScaledVector(up, -1);
  if (move.lengthSq() > 0) camera.position.addScaledVector(move.normalize(), speed);
}

/* ---- Interaktion (Hover / Klick) ---- */
function setPointer(ev) {
  const r = glCanvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
}
function intersectCards() {
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(cards.map(c => c.mesh), false);
}
function onPointerMove(ev) {
  if (isDown && viewMode === 'inside' && !focused && !spaghetti) {
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 3) dragging = true;
    fly.yaw -= dx * 0.0028;
    fly.pitch = Math.max(-1.35, Math.min(1.35, fly.pitch - dy * 0.0028));
    lastX = ev.clientX; lastY = ev.clientY;
  }
  setPointer(ev);
}
function onPointerDown(ev) {
  if (introActive) { skipIntro(); return; }
  isDown = true; dragging = false;
  downX = lastX = ev.clientX; downY = lastY = ev.clientY;
}
function onPointerUp(ev) {
  isDown = false;
  const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
  if (moved > 6 || dragging) return; // Drag (Umsehen/Orbit) -> kein Klick
  if (spaghetti) return;

  setPointer(ev);
  raycaster.setFromCamera(pointer, camera);
  const bh = raycaster.intersectObject(horizon, false);
  const cardHits = intersectCards();
  const cardDist = cardHits.length ? cardHits[0].distance : Infinity;
  if (bh.length && bh[0].distance < cardDist) { exitToClassic(true); return; }
  if (cardHits.length) { focusCard(cardHits[0].object.userData.card); return; }
  if (focused) unfocusCard();
}

// Sanfte Kamerafahrt: Position UND Blickrichtung werden interpoliert (kein Sprung)
function flyCameraTo(targetPos, lookAtVec, duration = 1.2, ease = 'power3.inOut') {
  return new Promise((resolve) => {
    const m = new THREE.Matrix4().lookAt(targetPos, lookAtVec, camera.up);
    const endQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    if (reduceMotion || !window.gsap) {
      camera.position.copy(targetPos); camera.quaternion.copy(endQuat); resolve(); return;
    }
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const s = { t: 0 };
    camFlying = true;
    gsap.to(s, {
      t: 1, duration, ease,
      onUpdate: () => {
        camera.position.lerpVectors(startPos, targetPos, s.t);
        camera.quaternion.copy(startQuat).slerp(endQuat, s.t);
      },
      onComplete: () => { camFlying = false; resolve(); },
    });
  });
}

function focusCard(card) {
  focused = card; hovered = card;
  controls.enabled = false;
  showDetail(card.mesh.userData.project, true);
  const p = card.mesh.position.clone();
  const outward = p.clone().normalize();
  // Inside: Kamera zwischen Zentrum und Karte (Blick nach außen auf die Karte)
  // Outside: Kamera weiter außen (Blick nach innen) -> Karte dreht jeweils lesbar zur Kamera
  const sign = (viewMode === 'inside') ? -1 : 1;
  const camPos = p.clone().addScaledVector(outward, 16 * sign).add(new THREE.Vector3(0, 1.5, 0));
  flyCameraTo(camPos, p, 1.25, 'power3.inOut');
}
function unfocusCard() {
  const wasFocused = focused;
  focused = null; hovered = null;
  hideDetail();
  if (!wasFocused) return;
  if (viewMode === 'outside') {
    flyCameraTo(OUTSIDE_HOME, center, 1.25).then(() => { controls.target.set(0, 0, 0); controls.enabled = true; });
  } else {
    flyCameraTo(INSIDE_HOME, new THREE.Vector3(80, 2, 0), 1.25).then(() => { fly.yaw = camera.rotation.y; fly.pitch = camera.rotation.x; });
  }
}

function showDetail(project, full) {
  if (!detailBody) return;
  const tags = (project.tags || []).map(t => `<span>${t}</span>`).join('');
  const links = (project.links || []).map(l =>
    `<a href="${l.url}" target="_blank" rel="noopener" class="${l.class || ''}">${l.text}<i class="${l.icon}"></i></a>`).join('');
  const img = project.image ? `<img class="u-detail-img" src="${project.image}" alt="${project.imageAlt || project.title}" loading="lazy">` : '';
  detailBody.innerHTML = `
    ${full ? img : ''}
    <h3>${project.title}</h3>
    <p>${project.description || ''}</p>
    <div class="u-detail-tags">${tags}</div>
    ${full ? `<div class="u-detail-links">${links}</div>` : '<p style="opacity:.6;font-family:var(--font-secondary);font-size:.8rem">Klick die Karte für Links &amp; Details</p>'}
  `;
  detailEl.classList.add('is-open');
  detailEl.setAttribute('aria-hidden', 'false');
}
function hideDetail() {
  if (!detailEl) return;
  detailEl.classList.remove('is-open');
  detailEl.setAttribute('aria-hidden', 'true');
}

/* ---- Easter Egg: Spaghettisierung ---- */
function triggerSpaghetti() {
  if (spaghetti) return;
  spaghetti = true;
  fly.keys.clear();
  if (helpEl) helpEl.classList.add('is-hidden');
  if (glitchEl) glitchEl.classList.add('is-active');
  if (window.gsap) {
    gsap.to(camera, { fov: 168, duration: 1.0, ease: 'power2.in', onUpdate: () => camera.updateProjectionMatrix() });
  } else { camera.fov = 168; camera.updateProjectionMatrix(); }
  setTimeout(showTerminal, 1100);
}
function showTerminal() {
  if (!terminalEl) return;
  terminalEl.classList.add('is-open');
  terminalEl.setAttribute('aria-hidden', 'false');
  const msg =
`> SINGULARITY BREACH DETECTED
> spaghettification complete... atoms re-sequenced.
>
> [PLACEHOLDER] Retro-Terminal lädt in einer zukünftigen Version.
> Beyond the event horizon, the code continues.
>
> _`;
  if (terminalText) {
    terminalText.textContent = '';
    let i = 0;
    const type = () => {
      if (i <= msg.length) { terminalText.textContent = msg.slice(0, i); i++; setTimeout(type, 16); }
    };
    type();
  }
}
function resetSpaghetti() {
  spaghetti = false;
  if (glitchEl) glitchEl.classList.remove('is-active');
  if (terminalEl) { terminalEl.classList.remove('is-open'); terminalEl.setAttribute('aria-hidden', 'true'); }
  if (helpEl) helpEl.classList.remove('is-hidden');
  if (window.gsap) gsap.to(camera, { fov: 58, duration: 0.6, onUpdate: () => camera.updateProjectionMatrix() });
  else { camera.fov = 58; camera.updateProjectionMatrix(); }
  camera.position.copy(INSIDE_HOME);
  fly.yaw = 0; fly.pitch = 0.12;
}

/* ---- Render-Loop ---- */
function animate() {
  animId = requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (disk) disk.rotation.y += dt * 0.14;
  if (starfield) starfield.rotation.y += dt * 0.004;
  if (starsBright) starsBright.rotation.y += dt * 0.003;
  if (nebula) nebula.rotation.y += dt * 0.012;
  if (photonRing) photonRing.quaternion.copy(camera.quaternion);
  updateNova(dt);

  // zusätzliche Orbit-Elemente bewegen
  for (const o of orbiters) {
    if (o.planet) {
      o.angle += dt * o.speed;
      const x = Math.cos(o.angle) * o.orbitR;
      const z = Math.sin(o.angle) * o.orbitR;
      o.obj.position.set(x, o.orbitY, z).applyAxisAngle(new THREE.Vector3(0, 0, 1), o.inc);
      o.obj.rotation.y += dt * 0.3;
    } else if (o.axis) {
      o.obj.rotateOnAxis(o.axis, dt * o.spin);
    }
  }

  // Kamera-Steuerung je nach Modus (Intro/sanfte Fahrten steuern selbst)
  if (!focused && !spaghetti && !introActive && !camFlying) {
    if (viewMode === 'inside') { applyFlyMovement(dt); applyFlyRotation(); }
    else { controls.update(); }
  }

  // Gravitations-Lensing aktualisieren
  updateLens();

  // Spaghettisierung: Kollision Kamera <-> Horizont
  if (viewMode === 'inside' && !focused && !spaghetti && !introActive &&
      camera.position.distanceTo(center) < BH_RADIUS * 1.15) {
    triggerSpaghetti();
  }

  // Hover-Erkennung (nicht beim Draggen/Fokus/Intro)
  if (!isDown && !focused && !spaghetti && !introActive) {
    const hits = intersectCards();
    let card = hits.length ? hits[0].object.userData.card : null;
    // Hysterese: aktuellen Hover halten, solange er noch getroffen wird (kein Flackern)
    if (hovered && hits.some(h => h.object.userData.card === hovered)) card = hovered;
    if (card !== hovered) {
      hovered = card;
      glCanvas.classList.toggle('is-pointer', !!card);
      if (card) showDetail(card.mesh.userData.project, false);
      else hideDetail();
    }
  }

  // Karten-Kuppel langsam drehen (pausiert bei Hover/Fokus)
  const rotating = !hovered && !focused && !spaghetti;
  if (rotating) domeAngle += dt * 0.025;

  for (const c of cards) {
    const p = c.base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), domeAngle);
    const active = (c === hovered || c === focused);

    // Position: beim Hover ein Stück zur Kamera (Kollision vermeiden);
    // beim Fokus bleibt die Karte ruhig, die Kamera fliegt zu ihr
    let target = p;
    if (c === hovered && !focused) {
      const toCam = camera.position.clone().sub(p).normalize();
      target = p.clone().addScaledVector(toCam, 10);
    }
    c.mesh.position.lerp(target, 0.16);

    // Ausrichtung (Object3D.lookAt richtet bei Meshes die +Z-Front ZUM Ziel):
    //   Standard -> Blick zum Zentrum (Karte schaut das Schwarze Loch an)
    //   aktiv    -> Active-Flip zur Kamera (Text lesbar, nicht gespiegelt)
    if (active) { dummy.position.copy(c.mesh.position); dummy.lookAt(camera.position); }
    else        { dummy.position.copy(p);               dummy.lookAt(center); }
    c.mesh.quaternion.slerp(dummy.quaternion, active ? 0.18 : 0.12);

    const ts = active ? c.baseScale * 1.6 : c.baseScale;
    c.mesh.scale.lerp(dummy.scale.set(ts, ts, ts), 0.16);
  }

  if (focused && !camFlying) camera.lookAt(focused.mesh.position);

  // --- Rendering ---
  // 1) Hintergrund + Loch + Scheibe inkl. Gravitations-Lensing
  camera.layers.set(LAYER_BG);
  composer.render();
  // 2) Karten lens-immun & scharf darüber, aber vom Loch (Tiefe) verdeckt
  renderer.autoClear = false;
  renderer.clearDepth();
  camera.layers.set(LAYER_OCCLUDE);   // Horizont NUR in den Tiefenpuffer (keine Farbe)
  horizon.material.colorWrite = false;
  renderer.render(scene, camera);
  horizon.material.colorWrite = true;
  camera.layers.set(LAYER_CARDS);     // Karten scharf obenauf
  renderer.render(scene, camera);
  renderer.autoClear = true;
  camera.layers.set(LAYER_BG);
}
function startLoop() { if (!running) { running = true; clock.getDelta(); animate(); } }
function stopLoop()  { running = false; if (animId) cancelAnimationFrame(animId); animId = null; }

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

/* ================================================================
   4) ABLAUFSTEUERUNG (Enter / Exit / View / HUD)
   ================================================================ */
let busy = false;

async function initSceneOnce() {
  if (sceneBuilt) return;
  buildScene();
  await buildCards();
  sceneBuilt = true;
}
function openOverlay() {
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  if (loadingEl) loadingEl.classList.remove('is-hidden');
}
function revealOverlay() {
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
  if (loadingEl) setTimeout(() => loadingEl.classList.add('is-hidden'), 400);
}
function closeOverlay() {
  overlay.classList.remove('is-open', 'is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  if (window.gsap) gsap.set('.gateway-buttons', { clearProps: 'opacity,scale,transform' });
}

/* ---- Cinematischer Anflug nach dem Warp ---- */
const INTRO_LOOK = new THREE.Vector3(80, 2, 0); // Blick nach außen aufs Karten-Band
function setCameraIntroStart() {
  introActive = true;
  const ang = Math.PI * 0.15;
  camera.position.set(Math.cos(ang) * 300, 92, Math.sin(ang) * 300);
  camera.lookAt(center);
}
function revealCardsInstant() {
  cardsRevealed = true;
  cards.forEach(c => { c.mesh.visible = true; c.mesh.material.opacity = 1; c.mesh.scale.setScalar(c.baseScale); });
}
function revealCards() {
  return new Promise((resolve) => {
    cardsRevealed = true;
    if (reduceMotion || !window.gsap) { revealCardsInstant(); resolve(); return; }
    cards.forEach((c, i) => {
      c.mesh.visible = true;
      c.mesh.material.opacity = 0;
      c.mesh.scale.setScalar(0.01);                 // wächst über den animate-Lerp hoch
      gsap.to(c.mesh.material, { opacity: 1, duration: 0.7, delay: 0.05 + i * 0.012, ease: 'power2.out' });
    });
    setTimeout(resolve, 480);
  });
}

/* ---- Supernova: gewaltiger Blitz + Schockwelle, kurz vor Ende des Anflugs ---- */
function supernova() {
  // greller, expandierender Kern
  const fMat = new THREE.MeshBasicMaterial({ color: 0xfff1d4, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), fMat);
  flash.layers.set(LAYER_BG);
  scene.add(flash);
  // expandierende Schockwelle
  const sMat = new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const shock = new THREE.Mesh(new THREE.RingGeometry(1, 1.5, 80), sMat);
  shock.rotation.x = Math.PI / 2 + 0.35;
  shock.layers.set(LAYER_BG);
  scene.add(shock);

  spawnNovaParticles(); // gewaltiger Partikel-Ausbruch

  if (window.gsap) {
    gsap.to(flash.scale, { x: 170, y: 170, z: 170, duration: 1.1, ease: 'power2.out' });
    gsap.to(fMat, { opacity: 0, duration: 1.25, ease: 'power2.in', onComplete: () => { scene.remove(flash); fMat.dispose(); flash.geometry.dispose(); } });
    gsap.to(shock.scale, { x: 110, y: 110, z: 110, duration: 1.5, ease: 'power2.out' });
    gsap.to(sMat, { opacity: 0, duration: 1.5, ease: 'power2.in', onComplete: () => { scene.remove(shock); sMat.dispose(); shock.geometry.dispose(); } });
    if (bloomPass) {
      const b = bloomPass.strength;
      gsap.to(bloomPass, { strength: 2.4, duration: 0.35, ease: 'power2.out', onComplete: () => gsap.to(bloomPass, { strength: b, duration: 1.1 }) });
    }
    if (flashEl) gsap.fromTo(flashEl, { opacity: 0 }, { opacity: 0.92, duration: 0.16, ease: 'power2.out', onComplete: () => gsap.to(flashEl, { opacity: 0, duration: 0.95, ease: 'power2.in' }) });
  } else {
    scene.remove(flash); scene.remove(shock);
  }
}

function spawnNovaParticles() {
  const N = 1800;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  const cHot = new THREE.Color('#fff2c0'), cMid = new THREE.Color('#ff8a3a'), cCold = new THREE.Color('#ff2a12');
  for (let i = 0; i < N; i++) {
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    const sp = 30 + Math.random() * 120;
    pos[i * 3] = dir.x * 2; pos[i * 3 + 1] = dir.y * 2; pos[i * 3 + 2] = dir.z * 2;
    vel[i * 3] = dir.x * sp; vel[i * 3 + 1] = dir.y * sp; vel[i * 3 + 2] = dir.z * sp;
    const c = Math.random();
    tmp.copy(c > 0.6 ? cHot : c > 0.3 ? cMid : cCold);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.6, map: spriteTex, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 1,
  });
  const pts = new THREE.Points(geo, mat);
  pts.layers.set(LAYER_BG);
  scene.add(pts);
  if (novaSystem) { scene.remove(novaSystem.points); novaSystem.points.geometry.dispose(); novaSystem.points.material.dispose(); }
  novaSystem = { points: pts, vel, t: 0, life: 2.4 };
}
function updateNova(dt) {
  if (!novaSystem) return;
  novaSystem.t += dt;
  const e = novaSystem.t / novaSystem.life;
  const arr = novaSystem.points.geometry.attributes.position.array;
  const v = novaSystem.vel;
  const drag = Math.max(0, 1 - dt * 0.7);
  for (let i = 0; i < arr.length; i++) { arr[i] += v[i] * dt; v[i] *= drag; }
  novaSystem.points.geometry.attributes.position.needsUpdate = true;
  novaSystem.points.material.opacity = Math.max(0, 1 - e * e);
  if (e >= 1) {
    scene.remove(novaSystem.points);
    novaSystem.points.geometry.dispose();
    novaSystem.points.material.dispose();
    novaSystem = null;
  }
}

function runIntro() {
  return new Promise((resolve) => {
    let novaFired = false;
    const fireNova = () => { if (!novaFired) { novaFired = true; supernova(); } };
    const goInside = async () => {
      await revealCards();                                              // Karten erscheinen NACH der Explosion
      await flyCameraTo(INSIDE_HOME, INTRO_LOOK, 2.2, 'power2.inOut');  // dann sanft hinein
      fly.yaw = camera.rotation.y; fly.pitch = camera.rotation.x;
      introActive = false;
      resolve();
    };

    if (reduceMotion || !window.gsap) {
      fireNova(); revealCardsInstant();
      camera.position.copy(INSIDE_HOME); camera.lookAt(INTRO_LOOK);
      fly.yaw = camera.rotation.y; fly.pitch = camera.rotation.x;
      introActive = false; resolve(); return;
    }

    introActive = true;
    cards.forEach(c => { c.mesh.visible = false; }); // bis zur Supernova verborgen

    // Phase A: von AUSSEN mehrmals ums Loch kreisen (annähern, aber außen bleiben)
    const turns = 2.0;
    const startR = 320, endR = 120, startY = 95, endY = 42, startAng = Math.PI * 0.15;
    const s = { t: 0 };
    introTween = gsap.to(s, {
      t: 1, duration: 3.6, ease: 'power1.inOut',
      onUpdate: () => {
        const e = s.t;
        const ang = startAng + e * turns * Math.PI * 2;
        const r = startR + (endR - startR) * e;
        const y = startY + (endY - startY) * e;
        camera.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
        camera.lookAt(center);
      },
      onComplete: () => {
        introTween = null;
        // Phase B: SUPERNOVA – von außen sichtbar, Kamera kreist langsam weiter
        fireNova();
        const hold = { t: 0 };
        const baseAng = startAng + turns * Math.PI * 2;
        introTween = gsap.to(hold, {
          t: 1, duration: 2.0, ease: 'sine.inOut',
          onUpdate: () => {
            const ang = baseAng + hold.t * 0.5;
            camera.position.set(Math.cos(ang) * endR, endY, Math.sin(ang) * endR);
            camera.lookAt(center);
          },
          onComplete: () => { introTween = null; goInside(); },  // Phase C: hinein
        });
      },
    });

    // Skip: direkt Supernova -> Karten -> hinein
    introFinish = () => {
      if (introTween) { introTween.kill(); introTween = null; }
      introFinish = null;
      fireNova();
      goInside();
    };
  });
}
function skipIntro() {
  if (introActive && introFinish) introFinish();
}

async function enterUniverse() {
  if (busy) return;
  busy = true;

  if (isMobile() || !hasWebGL()) {
    await Promise.race([runWarp(false, { short: true }), wait(1000)]);
    hideWarp();
    scrollToEl('#explorations');
    busy = false;
    return;
  }

  lockScroll();
  // weicher Button -> Warp Übergang
  if (window.gsap && !reduceMotion) {
    gsap.to('.gateway-buttons', { opacity: 0, scale: 1.12, duration: 0.4, ease: 'power2.in' });
  }
  await wait(reduceMotion ? 0 : 260);

  openOverlay();
  const ready = initSceneOnce();
  onResize();
  setViewMode('inside', true);   // setzt u.a. controls.enabled=false (wichtig bei Wiedereintritt)
  await Promise.race([runWarp(false), wait(1600)]);
  await Promise.race([ready, wait(3000)]);
  startLoop();
  setCameraIntroStart();      // Kamera weit weg, bevor das Overlay sichtbar wird
  revealOverlay();
  fadeOutWarp();              // Warp blendet weich in die Szene über (Crossfade)
  await runIntro();           // schneller Anflug -> Supernova -> Karten -> sanft einschwenken
  busy = false;
}

async function exitToClassic(reverse) {
  if (busy) return;
  busy = true;
  if (spaghetti) resetSpaghetti();
  if (focused) { focused = null; hideDetail(); }
  if (reverse) await Promise.race([runWarp(true), wait(1500)]);
  stopLoop();
  closeOverlay();
  hideWarp();
  unlockScroll();
  scrollToEl('#explorations');
  busy = false;
}

async function backToTop() {
  if (busy) return;
  busy = true;
  if (spaghetti) resetSpaghetti();
  if (focused) { focused = null; hideDetail(); }
  await Promise.race([runWarp(true), wait(1500)]);
  stopLoop();
  closeOverlay();
  hideWarp();
  unlockScroll();
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  busy = false;
}

function setViewMode(m, instant) {
  viewMode = m;
  updateViewButtons();
  if (focused) { focused = null; hideDetail(); }
  controls.enabled = false;
  if (m === 'inside') {
    if (instant) {
      camera.position.copy(INSIDE_HOME); camera.lookAt(INTRO_LOOK);
      fly.yaw = camera.rotation.y; fly.pitch = camera.rotation.x;
    } else {
      flyCameraTo(INSIDE_HOME, INTRO_LOOK, 1.4).then(() => { fly.yaw = camera.rotation.y; fly.pitch = camera.rotation.x; });
    }
  } else {
    if (instant) {
      camera.position.copy(OUTSIDE_HOME); camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0); controls.enabled = true;
    } else {
      flyCameraTo(OUTSIDE_HOME, center, 1.4).then(() => { controls.target.set(0, 0, 0); controls.enabled = true; });
    }
  }
}
function updateViewButtons() {
  if (!viewInsideBtn || !viewOutsideBtn) return;
  const inside = viewMode === 'inside';
  viewInsideBtn.classList.toggle('is-active', inside);
  viewOutsideBtn.classList.toggle('is-active', !inside);
  viewInsideBtn.setAttribute('aria-pressed', String(inside));
  viewOutsideBtn.setAttribute('aria-pressed', String(!inside));
}

/* ---- Verdrahtung ---- */
function wire() {
  setupScrollLayers();

  enterBtn && enterBtn.addEventListener('click', enterUniverse);
  projBtn && projBtn.addEventListener('click', () => scrollToEl('#explorations'));

  viewInsideBtn && viewInsideBtn.addEventListener('click', () => {
    if (!overlay.classList.contains('is-open')) enterUniverse();
    else setViewMode('inside', false);
  });
  viewOutsideBtn && viewOutsideBtn.addEventListener('click', () => {
    if (!overlay.classList.contains('is-open')) { enterUniverse().then(() => setViewMode('outside', false)); }
    else setViewMode('outside', false);
  });
  modeClassicBtn && modeClassicBtn.addEventListener('click', () => exitToClassic(false));
  backBtn && backBtn.addEventListener('click', backToTop);
  detailCloseBtn && detailCloseBtn.addEventListener('click', () => { if (focused) unfocusCard(); else hideDetail(); });
  terminalExit && terminalExit.addEventListener('click', resetSpaghetti);

  if (hintEl) {
    hintEl.textContent = (isMobile() || !hasWebGL())
      ? 'Tip: the 3D experience is optimized for desktop — on this device we’ll glide you straight to the classic cards.'
      : 'Tip: drag to look · W A S D to fly · hover a card · click the black hole to return.';
  }

  window.__universeReady = true;
}

wire();
