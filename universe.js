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

const BH_RADIUS   = 10;       // Event-Horizont (groß & prominent)
const DISK_INNER  = 12.5;
const DISK_OUTER  = 60;
const DOME_R      = 104;      // Radius des Karten-Loops (mehr Platz ums große Loch)
const INSIDE_HOME  = new THREE.Vector3(0, 18, 0);
const OUTSIDE_HOME = new THREE.Vector3(0, 54, 220);

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
const reticleEl      = document.getElementById('u-reticle');
const reticleLabel   = document.getElementById('u-reticle-label');
const counterEl      = document.getElementById('u-counter');
const speedCanvas    = document.getElementById('u-speed');
const speedCtx       = speedCanvas ? speedCanvas.getContext('2d') : null;

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

/* ---- Speed-Streaks: feine Linien an den Rändern bei hohem Tempo ---- */
const speedAngles = [];
for (let i = 0; i < 56; i++) speedAngles.push(Math.random() * Math.PI * 2);
function sizeSpeedCanvas() {
  if (!speedCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  speedCanvas.width = Math.floor(window.innerWidth * dpr);
  speedCanvas.height = Math.floor(window.innerHeight * dpr);
}
function drawSpeed(speed) {
  if (!speedCtx) return;
  const W = speedCanvas.width, H = speedCanvas.height;
  speedCtx.clearRect(0, 0, W, H);
  const k = Math.min(1, Math.max(0, (speed - 42) / (FLY_MAX - 42)));
  if (k <= 0.01) return;
  const cx = W / 2, cy = H / 2, maxR = Math.hypot(cx, cy);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  speedCtx.lineCap = 'round';
  speedCtx.strokeStyle = 'rgba(190,215,255,' + (0.4 * k).toFixed(3) + ')';
  speedCtx.lineWidth = 1.4 * dpr;
  for (let i = 0; i < speedAngles.length; i++) {
    const a = speedAngles[i] + Math.sin(elapsed * 3 + i) * 0.02;
    const dx = Math.cos(a), dy = Math.sin(a);
    const base = maxR * (0.6 + 0.34 * fract(Math.sin(i * 12.9898) * 43758.5453));
    const len = maxR * (0.10 + 0.20 * k) * (0.6 + fract(i * 0.37));
    speedCtx.beginPath();
    speedCtx.moveTo(cx + dx * base, cy + dy * base);
    speedCtx.lineTo(cx + dx * (base + len), cy + dy * (base + len));
    speedCtx.stroke();
  }
}

/* ================================================================
   3) THREE.JS SZENE
   ================================================================ */
let renderer, scene, camera, composer, controls, raycaster;
const pointer = new THREE.Vector2(-2, -2);
const CENTER2 = new THREE.Vector2(0, 0);   // Bildmitte für das Fadenkreuz
const _tmpVec = new THREE.Vector3();       // Wiederverwendbarer Vektor
const dummy = new THREE.Object3D();
const clock = new THREE.Clock();
const center = new THREE.Vector3(0, 0, 0);

let horizon, disk, diskOccluder, photonRing, glowRim, starfield, starsBright, nebula;
let starLayers = [];             // 3 Sternenschichten (nah/mittel/fern) für Parallaxe
let lensPass, bloomPass, spriteTex, starMat;
let stardust = null;             // mitfliegender Vordergrund-Sternenstaub
let cardGlow = null;             // einzelner Glow-Halo, folgt der aktiven Karte
let novaSystem = null;           // aktive Supernova-Partikel
let comets = [];                 // Sternschnuppen
let cometTimer = 0;
let cards = [];
let orbiters = [];              // zusätzliche Objekte im Orbit (Planeten, Trümmer)
let projects = [];
let domeAngle = 0;
let elapsed = 0;                 // Gesamtzeit (für Twinkle/Shader)
let lastInput = 0;               // für Idle-Auto-Drift
let reticleCard = null;          // Karte im Fadenkreuz (Dome-Modus)
let helpDismissed = false;       // Hilfe-UI nach erster Bewegung ausblenden

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

// Free-Look / Fly-State (Dome-Modus) — mit Inertia für weiche Bewegung
const fly = { yaw: 0, pitch: 0.12, yawVel: 0, pitchVel: 0, vel: new THREE.Vector3(), keys: new Set() };
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

/* ---- Value-Noise (für organische Scheibenstruktur / Staubbahnen) ---- */
function fract(x) { return x - Math.floor(x); }
function hash2(x, y) { return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/* ---- prozedurale, weiche Nebel-/Rauchtextur ---- */
function makeNebulaTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  // viele weiche Blobs -> rauchige Wolke
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 18 + Math.random() * 70;
    const a = 0.04 + Math.random() * 0.10;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,' + a + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  // Ränder weich auf 0 faden (nahtlose Wolke)
  ctx.globalCompositeOperation = 'destination-in';
  const vg = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.5);
  vg.addColorStop(0, 'rgba(255,255,255,1)');
  vg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'source-over';
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
  // drei Tiefenschichten -> starker Parallaxe-Effekt beim Fliegen
  const near = makeStarLayer(1600, 180, 520, 3.4, sprite, 0.45);
  const mid  = makeStarLayer(3200, 520, 1200, 2.1, sprite, 0.35);
  const far  = makeStarLayer(4200, 1200, 2600, 1.3, sprite, 0.28);
  starLayers = [near, mid, far];
  starLayers.forEach(l => scene.add(l));
  starfield = mid; // Kompatibilität

  // helle, individuell funkelnde Sterne (eigener Twinkle-Shader)
  const N = 180;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), ph = new Float32Array(N);
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = 450 + Math.random() * 950;
    const th = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(th);
    const pick = Math.random();
    tmp.copy(pick > 0.86 ? COL.cyan : pick > 0.7 ? COL.violet : COL.white).multiplyScalar(0.7 + Math.random() * 0.5);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    ph[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: sprite }, uSize: { value: 9.0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aPhase; attribute vec3 aColor; varying vec3 vColor; varying float vTw;
      uniform float uTime, uSize;
      void main(){
        vColor = aColor;
        float tw = 0.45 + 0.55 * sin(uTime * 2.2 + aPhase * 6.2831853);
        vTw = max(tw, 0.12);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * vTw * (320.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; varying vec3 vColor; varying float vTw;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); if (t.a < 0.02) discard; gl_FragColor = vec4(vColor * vTw, t.a * vTw); }`,
  });
  starsBright = new THREE.Points(geo, starMat);
  scene.add(starsBright);
}

/* ---- Vordergrund-Sternenstaub: driftet mit der Kamera (Tiefen-Parallaxe) ---- */
function buildStardust(sprite) {
  const N = 240;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 80;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 60;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    tmp.copy(Math.random() > 0.5 ? COL.cyan : COL.violet).multiplyScalar(0.25 + Math.random() * 0.35);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  stardust = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.5, map: sprite, vertexColors: true, transparent: true, opacity: 0.6,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  scene.add(stardust);           // folgt der Kamera pro Frame (siehe animate)
}

/* ---- Sternschnuppe: heller Kopf mit verblassendem Schweif ---- */
function spawnComet() {
  const SEG = 18;
  const start = new THREE.Vector3(
    (Math.random() - 0.5) * 1400, 200 + Math.random() * 500, (Math.random() - 0.5) * 1400
  );
  const dir = new THREE.Vector3((Math.random() - 0.5), -0.4 - Math.random() * 0.5, (Math.random() - 0.5)).normalize();
  const speed = 420 + Math.random() * 320;
  const pos = new Float32Array(SEG * 3);
  for (let i = 0; i < SEG; i++) { pos[i * 3] = start.x; pos[i * 3 + 1] = start.y; pos[i * 3 + 2] = start.z; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.layers.set(LAYER_BG);
  scene.add(line);
  comets.push({ line, head: start.clone(), dir, speed, t: 0, life: 2.2, seg: SEG });
}
function updateComets(dt) {
  cometTimer -= dt;
  if (cometTimer <= 0 && comets.length < 2) { spawnComet(); cometTimer = 4 + Math.random() * 6; }
  for (let i = comets.length - 1; i >= 0; i--) {
    const c = comets[i];
    c.t += dt;
    c.head.addScaledVector(c.dir, c.speed * dt);
    const arr = c.line.geometry.attributes.position.array;
    // Schweif nachziehen
    for (let s = c.seg - 1; s > 0; s--) {
      arr[s * 3] = arr[(s - 1) * 3]; arr[s * 3 + 1] = arr[(s - 1) * 3 + 1]; arr[s * 3 + 2] = arr[(s - 1) * 3 + 2];
    }
    arr[0] = c.head.x; arr[1] = c.head.y; arr[2] = c.head.z;
    c.line.geometry.attributes.position.needsUpdate = true;
    c.line.material.opacity = Math.max(0, 0.9 * (1 - c.t / c.life));
    if (c.t >= c.life) {
      scene.remove(c.line); c.line.geometry.dispose(); c.line.material.dispose(); comets.splice(i, 1);
    }
  }
}

/* ---- Nebel: große, sehr dezente, farbige Wolken weit außen ---- */
function buildNebula() {
  nebula = new THREE.Group();
  const tex = makeNebulaTexture();
  const colors = ['#3a2d8f', '#2f5fae', '#7a4bd0', '#1f4f8f', '#b5532a', '#5a3fb0', '#244a9a', '#6a3da0'];
  const COUNT = 18;
  for (let i = 0; i < COUNT; i++) {
    const baseOpacity = 0.04 + Math.random() * 0.07;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: new THREE.Color(colors[i % colors.length]), transparent: true,
      opacity: baseOpacity, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    mat.toneMapped = false;
    const size = 130 + Math.random() * 280;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.userData.baseOpacity = baseOpacity;
    // im Volumen verteilen (auch in Bandnähe -> man fliegt hindurch)
    const r = 90 + Math.random() * 540;
    const th = Math.random() * Math.PI * 2;
    m.position.set(Math.cos(th) * r, (Math.random() - 0.5) * 320, Math.sin(th) * r);
    m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    m.userData.spin = (Math.random() - 0.5) * 0.03;
    nebula.add(m);
  }
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
function buildDisk() {
  // Akkurate Akkretionsscheibe als EINE Shader-Fläche (kein Partikel-Stacking
  // -> kein Ausbrennen). Temperaturgradient, Doppler-Beaming, FBM-Turbulenz.
  const geo = new THREE.RingGeometry(DISK_INNER, DISK_OUTER, 320, 16);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uInner: { value: DISK_INNER }, uOuter: { value: DISK_OUTER } },
    vertexShader: `
      varying vec2 vP;
      void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vP; uniform float uTime, uInner, uOuter;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
      float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=.5; } return v; }
      void main(){
        float r = length(vP);
        float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
        float ang = atan(vP.y, vP.x);
        // wirbelnde Spiralturbulenz (innen schneller via log(r))
        float spiral = ang*1.5 - log(r)*3.5 + uTime*0.7;
        float dust = fbm(vec2(spiral*1.1, r*0.16 + uTime*0.05));
        dust = 0.2 + 0.95*dust;
        // Temperatur: weiß-heiß innen -> gelb-orange -> tiefrot außen
        vec3 white=vec3(1.0,0.98,0.95), gold=vec3(1.0,0.72,0.32), orange=vec3(1.0,0.4,0.12), cool=vec3(0.4,0.07,0.03);
        vec3 col;
        if (t<0.18) col = mix(white, gold, t/0.18);
        else if (t<0.5) col = mix(gold, orange, (t-0.18)/0.32);
        else col = mix(orange, cool, (t-0.5)/0.5);
        // Doppler-Beaming: eine Seite heller & bläulicher
        float beam = 0.4 + 1.0*(0.5+0.5*cos(ang - 1.5708));
        col = mix(col, col*vec3(0.82,0.9,1.3), clamp(beam-0.95,0.0,0.6));
        // heller Innenrand, weiche Kanten; außen ätherisch ausdünnen
        float edge = smoothstep(0.0,0.04,t) * (1.0 - smoothstep(0.55,1.0,t));
        float inner = pow(1.0-t, 1.7)*1.7 + 0.22;
        float bright = inner * beam * dust * edge;
        float alpha = edge * (0.4 + 0.55*dust) * (0.5 + 0.5*(1.0-t));
        gl_FragColor = vec4(col * bright, alpha);
      }`,
  });
  disk = new THREE.Mesh(geo, mat);
  disk.rotation.x = -Math.PI / 2;   // flach in die XZ-Ebene (Äquator)
  scene.add(disk);
}

/* ---- Schwarzes Loch: tiefschwarzer Kern + dezenter Rand/Photon-Ring ---- */
function buildBlackHole() {
  horizon = new THREE.Mesh(
    new THREE.SphereGeometry(BH_RADIUS, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  horizon.name = 'blackhole';
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
    new THREE.TorusGeometry(BH_RADIUS * 1.14, 0.16, 18, 220),
    new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  photonRing.material.toneMapped = false; // bleibt hell -> intensiver Glüh-Akzent (Einstein-Ring)
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

  const h = 11.0, w = h * (CW / CH);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true });
  mat.toneMapped = false;
  mat.depthWrite = true;  // in der Hauptszene: korrekt vom Loch/Karten verdeckt (echtes Layering)
  mat.alphaTest = 0.05;   // transparente Ecken nicht in den Tiefenpuffer schreiben
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.userData.project = project;
  mesh.visible = false;          // erscheinen erst nach der Supernova
  // kein renderOrder: Three sortiert transparente Objekte korrekt nach Distanz

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
    const card = { mesh, base, baseScale: 1, revealT: 0 };
    mesh.position.copy(base);
    mesh.userData.card = card;
    cards.push(card);
    scene.add(mesh);
  });
  if (counterEl) counterEl.textContent = '◍ ' + projects.length + ' systems mapped';

  // EIN geteilter Glow-Halo (folgt der aktiven Karte) – spart 39 additive Planes
  const gMat = new THREE.MeshBasicMaterial({
    map: spriteTex, color: new THREE.Color('#a67cff'), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  gMat.toneMapped = false;
  cardGlow = new THREE.Mesh(new THREE.PlaneGeometry(16, 19), gMat);
  cardGlow.visible = false;
  scene.add(cardGlow);
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
  controls.minDistance = 16;
  controls.maxDistance = 700;
  controls.autoRotateSpeed = 0.3;
  controls.target.set(0, 0, 0);
  controls.enabled = false; // Start im Dome-Modus (Free-Look)

  raycaster = new THREE.Raycaster();
  raycaster.layers.enableAll(); // damit Karten (Layer 1) per Hover/Klick treffbar sind

  const sprite = makeSpriteTexture();
  spriteTex = sprite;
  buildStarfield(sprite);
  buildNebula();
  buildBlackHole();
  buildDisk();
  buildOrbiters(sprite);
  buildStardust(sprite);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.62, 0.5, 0.42 // strength, radius, threshold -> Innenrand & Photonenring glühen, ohne auszubrennen
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
  lastInput = performance.now();
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', ' '].includes(k) || ['shift'].includes(k)) {
    if (!focused && !spaghetti) { fly.keys.add(k); dismissHelpSoon(); e.preventDefault(); } // WASD in beiden Modi
  }
  // E / Enter: ins Fadenkreuz genommene Karte fokussieren (Dome-Modus)
  if ((k === 'e' || e.key === 'Enter') && viewMode === 'inside' && !focused && !spaghetti && reticleCard) {
    focusCard(reticleCard); e.preventDefault();
  }
  if (e.key === 'Escape') {
    if (spaghetti) resetSpaghetti();
    else if (focused) unfocusCard();
    else exitToClassic(false);
  }
}
function onKeyUp(e) { fly.keys.delete(e.key.toLowerCase()); }

// Hilfe-Hinweis nach der ersten aktiven Bewegung weich ausblenden
function dismissHelpSoon() {
  if (helpDismissed) return;
  helpDismissed = true;
  setTimeout(() => { if (helpEl) helpEl.classList.add('is-hidden'); }, 1000);
}

// Raumschiff-Physik: Beschleunigung + Trägheit/Drift (in beiden Modi)
const FLY_ACCEL = 135, FLY_DAMP = 0.96, FLY_MAX = 78;
function applyMovement(dt) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0);
  const acc = new THREE.Vector3();
  if (fly.keys.has('w')) acc.add(fwd);
  if (fly.keys.has('s')) acc.addScaledVector(fwd, -1);
  if (fly.keys.has('d')) acc.add(right);
  if (fly.keys.has('a')) acc.addScaledVector(right, -1);
  if (fly.keys.has(' ')) acc.add(up);
  if (fly.keys.has('shift')) acc.addScaledVector(up, -1);
  if (acc.lengthSq() > 0) fly.vel.addScaledVector(acc.normalize(), FLY_ACCEL * dt);
  // Dämpfung -> sanftes Ausgleiten (Drift)
  fly.vel.multiplyScalar(Math.pow(FLY_DAMP, dt * 60));
  if (fly.vel.length() > FLY_MAX) fly.vel.setLength(FLY_MAX);
  if (fly.vel.lengthSq() < 1e-5) { fly.vel.set(0, 0, 0); return; }
  const delta = fly.vel.clone().multiplyScalar(dt);
  camera.position.add(delta);
  if (viewMode === 'outside') controls.target.add(delta); // mitführen, damit Orbit erhalten bleibt
}
function updateFly(dt) {
  // Rotation mit Momentum (Trägheit nach dem Loslassen)
  if (!isDown) {
    fly.yaw += fly.yawVel; fly.pitch += fly.pitchVel;
    fly.yawVel *= 0.9; fly.pitchVel *= 0.9;
  }
  // Idle: nach Inaktivität sanftes kinoreifes Weiterdriften
  if (performance.now() - lastInput > 6000 && fly.keys.size === 0 && !isDown && fly.vel.lengthSq() < 1) {
    fly.yaw += dt * 0.05;
    fly.pitch += Math.sin(elapsed * 0.25) * dt * 0.02;
  }
  fly.pitch = Math.max(-1.35, Math.min(1.35, fly.pitch));
  applyFlyRotation();
  applyMovement(dt);
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
  if (isDown) dismissHelpSoon();
  if (isDown && viewMode === 'inside' && !focused && !spaghetti) {
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 3) dragging = true;
    fly.yaw -= dx * 0.0026;
    fly.pitch = Math.max(-1.35, Math.min(1.35, fly.pitch - dy * 0.0026));
    fly.yawVel = -dx * 0.0026; fly.pitchVel = -dy * 0.0026; // Momentum für weichen Auslauf
    lastX = ev.clientX; lastY = ev.clientY;
    lastInput = performance.now();
  }
  setPointer(ev);
}
function onPointerDown(ev) {
  if (introActive) { skipIntro(); return; }
  isDown = true; dragging = false;
  fly.yawVel = 0; fly.pitchVel = 0;
  downX = lastX = ev.clientX; downY = lastY = ev.clientY;
  lastInput = performance.now();
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

// Fadenkreuz-Label aktualisieren (Dome-Modus)
let _reticleState = '';
function updateReticle(card, onHole) {
  if (!reticleEl) return;
  const show = viewMode === 'inside' && !focused && !spaghetti && overlay.classList.contains('is-visible');
  reticleEl.classList.toggle('is-visible', show);
  const state = card ? 'card:' + card.mesh.userData.project.title : (onHole ? 'hole' : 'none');
  if (state === _reticleState) return;
  _reticleState = state;
  reticleEl.classList.toggle('is-target', !!card || onHole);
  if (reticleLabel) {
    if (card) reticleLabel.textContent = '▸ ' + card.mesh.userData.project.title + '   [E]';
    else if (onHole) reticleLabel.textContent = '◎ Singularity — click to exit';
    else reticleLabel.textContent = '';
  }
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
  elapsed += dt;

  if (disk && disk.material.uniforms) disk.material.uniforms.uTime.value = elapsed;
  for (let i = 0; i < starLayers.length; i++) starLayers[i].rotation.y += dt * (0.006 - i * 0.0018);
  if (starsBright) starsBright.rotation.y += dt * 0.003;
  if (starMat) starMat.uniforms.uTime.value = elapsed;           // Funkeln
  if (nebula) {
    nebula.rotation.y += dt * 0.012;
    for (const m of nebula.children) {        // nah an der Kamera ausblenden -> kein Weiß-Wash beim Durchfliegen
      m.getWorldPosition(_tmpVec);
      m.material.opacity = m.userData.baseOpacity * THREE.MathUtils.smoothstep(_tmpVec.distanceTo(camera.position), 30, 140);
    }
  }
  if (stardust) { stardust.position.copy(camera.position); stardust.rotation.y += dt * 0.03; } // Vordergrund-Parallaxe
  if (photonRing) { photonRing.quaternion.copy(camera.quaternion); photonRing.scale.setScalar(1 + Math.sin(elapsed * 1.5) * 0.015); }
  updateNova(dt);
  updateComets(dt);

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
    if (viewMode === 'inside') { updateFly(dt); }
    else { applyMovement(dt); controls.update(); }
  }
  drawSpeed(fly.vel.length());   // Speed-Streaks bei hohem Tempo

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
    const rt = c.revealT;

    // Position: beim Hover ein Stück zur Kamera; beim Fokus ruhig (Kamera fliegt hin)
    let target = p;
    if (c === hovered && !focused) {
      const toCam = camera.position.clone().sub(p).normalize();
      target = p.clone().addScaledVector(toCam, 10);
    }
    // elegantes Einschweben: aus der Zentralregion nach außen
    if (rt < 1) target = p.clone().multiplyScalar(0.18).lerp(target, rt);
    c.mesh.position.lerp(target, rt < 1 ? 0.5 : 0.16);

    // Ausrichtung: Standard -> Blick zum Zentrum; aktiv -> Flip zur Kamera (lesbar)
    if (active) { dummy.position.copy(c.mesh.position); dummy.lookAt(camera.position); }
    else        { dummy.position.copy(p);               dummy.lookAt(center); }
    c.mesh.quaternion.slerp(dummy.quaternion, active ? 0.18 : 0.12);

    const ts = (active ? c.baseScale * 1.6 : c.baseScale) * (rt < 1 ? rt : 1);
    c.mesh.scale.lerp(dummy.scale.set(ts, ts, ts), rt < 1 ? 0.5 : 0.16);
  }

  // EIN Glow folgt der aktiven Karte (Hover/Fokus = violett, Fadenkreuz = cyan)
  if (cardGlow) {
    const gc = hovered || focused || reticleCard;
    const targetO = (hovered || focused) ? 0.6 : (reticleCard ? 0.32 : 0);
    if (gc) {
      cardGlow.visible = true;
      // leicht hinter die Karte (von der Kamera weg) -> Halo um die Ränder
      const away = gc.mesh.position.clone().sub(camera.position).normalize();
      cardGlow.position.copy(gc.mesh.position).addScaledVector(away, 0.4);
      cardGlow.quaternion.copy(gc.mesh.quaternion);
      const gs = gc.mesh.scale.x;
      cardGlow.scale.set(gs, gs, gs);
      cardGlow.material.color.set((hovered || focused) ? '#a67cff' : '#70d6ff');
    }
    cardGlow.material.opacity += (targetO - cardGlow.material.opacity) * 0.15;
    if (cardGlow.material.opacity < 0.01 && !gc) cardGlow.visible = false;
  }

  if (focused && !camFlying) camera.lookAt(focused.mesh.position);

  // Fadenkreuz-Ziel (Dome-Modus): zeigt Projekt oder Singularität in der Bildmitte
  if (viewMode === 'inside' && !focused && !spaghetti && !introActive && !camFlying && cardsRevealed) {
    raycaster.setFromCamera(CENTER2, camera);
    const rHits = raycaster.intersectObjects(cards.map(c => c.mesh), false);
    const bhHit = raycaster.intersectObject(horizon, false);
    const cardFirst = rHits.length && (!bhHit.length || rHits[0].distance < bhHit[0].distance);
    reticleCard = cardFirst ? rHits[0].object.userData.card : null;
    updateReticle(reticleCard, !cardFirst && bhHit.length > 0);
  } else {
    reticleCard = null;
    updateReticle(null, false);
  }

  // sanftes FOV: leichtes Hineinzoomen beim Fokus
  if (!spaghetti) {
    const tf = focused ? 50 : 58;
    if (Math.abs(camera.fov - tf) > 0.05) { camera.fov += (tf - camera.fov) * 0.08; camera.updateProjectionMatrix(); }
  }

  // --- Rendering: eine Szene, korrektes Tiefen-Layering (Karten ↔ Loch/Nebel/Partikel) ---
  composer.render();
}
function startLoop() { if (!running) { running = true; clock.getDelta(); animate(); } }
function stopLoop()  { running = false; if (animId) cancelAnimationFrame(animId); animId = null; }

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  sizeSpeedCanvas();
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
  setTimeout(() => overlay.classList.add('is-visible'), 20);
  if (loadingEl) setTimeout(() => loadingEl.classList.add('is-hidden'), 400);
}
function closeOverlay() {
  overlay.classList.remove('is-open', 'is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  if (window.gsap) gsap.set('.gateway-buttons', { clearProps: 'opacity,scale,transform' });
}

/* ---- Cinematischer Anflug nach dem Warp ---- */
const INTRO_LOOK = new THREE.Vector3(130, 4, 0); // Blick nach außen aufs Karten-Band
function setCameraIntroStart() {
  introActive = true;
  const ang = Math.PI * 0.15;
  camera.position.set(Math.cos(ang) * 460, 140, Math.sin(ang) * 460);
  camera.lookAt(center);
}
function revealCardsInstant() {
  cardsRevealed = true;
  cards.forEach(c => { c.mesh.visible = true; c.revealT = 1; c.mesh.material.opacity = 1; c.mesh.scale.setScalar(c.baseScale); });
}
function revealCards() {
  return new Promise((resolve) => {
    cardsRevealed = true;
    if (reduceMotion || !window.gsap) { revealCardsInstant(); resolve(); return; }
    // elegant nacheinander aus der Zentralregion nach außen einschweben
    cards.forEach((c, i) => {
      c.mesh.visible = true;
      c.revealT = 0;
      c.mesh.material.opacity = 0;
      const delay = 0.1 + i * 0.05;
      gsap.to(c, { revealT: 1, duration: 1.3, delay, ease: 'power3.out' });
      gsap.to(c.mesh.material, { opacity: 1, duration: 0.9, delay, ease: 'power2.out' });
    });
    setTimeout(resolve, 700); // weiterlaufen lassen, während die Karten einschweben
  });
}

/* ---- Supernova: gewaltiger Blitz + Schockwelle, kurz vor Ende des Anflugs ---- */
function makeShockRing(color, tilt) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const r = new THREE.Mesh(new THREE.RingGeometry(1, 1.35, 96), m);
  r.rotation.x = Math.PI / 2 + tilt;
  r.layers.set(LAYER_BG);
  scene.add(r);
  return r;
}
function supernova() {
  spawnNovaParticles(); // gewaltiger Partikel-Ausbruch
  if (!window.gsap) return;

  // greller Kern-Blitz
  const fMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), fMat);
  flash.layers.set(LAYER_BG); scene.add(flash);
  gsap.to(flash.scale, { x: 210, y: 210, z: 210, duration: 1.2, ease: 'power3.out' });
  gsap.to(fMat, { opacity: 0, duration: 1.35, ease: 'power2.in', onComplete: () => { scene.remove(flash); fMat.dispose(); flash.geometry.dispose(); } });

  // langsam verglühender Kern (Nachglühen -> schönes Ende)
  const eMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const ember = new THREE.Mesh(new THREE.SphereGeometry(BH_RADIUS * 1.6, 32, 32), eMat);
  ember.layers.set(LAYER_BG); scene.add(ember);
  gsap.timeline()
    .to(eMat, { opacity: 0.55, duration: 0.3, ease: 'power2.out' }, 0)
    .to(ember.scale, { x: 4.2, y: 4.2, z: 4.2, duration: 2.8, ease: 'power1.out' }, 0)
    .to(eMat, { opacity: 0, duration: 2.5, ease: 'power2.in', onComplete: () => { scene.remove(ember); eMat.dispose(); ember.geometry.dispose(); } }, 0.4);

  // zwei zeitversetzte Schockwellen (verschiedene Neigung/Farbe)
  const s1 = makeShockRing(0x9fd4ff, 0.32);
  gsap.to(s1.scale, { x: 130, y: 130, z: 130, duration: 1.7, ease: 'power2.out' });
  gsap.to(s1.material, { opacity: 0, duration: 1.7, ease: 'power2.in', onComplete: () => { scene.remove(s1); s1.material.dispose(); s1.geometry.dispose(); } });
  const s2 = makeShockRing(0xffd9a0, -0.5);
  gsap.to(s2.scale, { x: 160, y: 160, z: 160, duration: 2.2, delay: 0.28, ease: 'power2.out' });
  gsap.to(s2.material, { opacity: 0, duration: 2.2, delay: 0.28, ease: 'power2.in', onComplete: () => { scene.remove(s2); s2.material.dispose(); s2.geometry.dispose(); } });

  // Bloom-Spike
  if (bloomPass) { const b = bloomPass.strength; gsap.to(bloomPass, { strength: 3.0, duration: 0.4, ease: 'power2.out', onComplete: () => gsap.to(bloomPass, { strength: b, duration: 1.3 }) }); }
  // Voll-Weiß-Blitz
  if (flashEl) gsap.fromTo(flashEl, { opacity: 0 }, { opacity: 1, duration: 0.14, ease: 'power2.out', onComplete: () => gsap.to(flashEl, { opacity: 0, duration: 1.0, ease: 'power2.in' }) });
}

// krasses Finale kurz bevor die Karten erscheinen
function finalFlash() {
  if (!window.gsap) return;
  if (bloomPass) { const b = bloomPass.strength; gsap.to(bloomPass, { strength: 3.4, duration: 0.18, ease: 'power2.out', onComplete: () => gsap.to(bloomPass, { strength: b, duration: 0.9 }) }); }
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const pop = new THREE.Mesh(new THREE.SphereGeometry(2, 24, 24), m);
  pop.layers.set(LAYER_BG); scene.add(pop);
  gsap.to(pop.scale, { x: 95, y: 95, z: 95, duration: 0.6, ease: 'power3.out' });
  gsap.to(m, { opacity: 0, duration: 0.7, ease: 'power2.in', onComplete: () => { scene.remove(pop); m.dispose(); pop.geometry.dispose(); } });
  if (flashEl) gsap.fromTo(flashEl, { opacity: 0 }, { opacity: 0.85, duration: 0.1, onComplete: () => gsap.to(flashEl, { opacity: 0, duration: 0.6 }) });
}

function spawnNovaParticles() {
  const N = 2600;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  const cHot = new THREE.Color('#fff6d6'), cMid = new THREE.Color('#ff8a3a'), cCold = new THREE.Color('#ff2a12');
  for (let i = 0; i < N; i++) {
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    const sp = 40 + Math.random() * 150;
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
    size: 3.0, map: spriteTex, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 1,
  });
  const pts = new THREE.Points(geo, mat);
  pts.layers.set(LAYER_BG);
  scene.add(pts);
  if (novaSystem) { scene.remove(novaSystem.points); novaSystem.points.geometry.dispose(); novaSystem.points.material.dispose(); }
  novaSystem = { points: pts, vel, t: 0, life: 2.9 };
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
    const settleOutside = async () => {
      revealCards();                                              // Karten schweben gestaffelt ein (NACH der Supernova)
      await flyCameraTo(OUTSIDE_HOME, center, 2.2, 'power2.inOut'); // sanft in die Außen-Überblicksposition
      controls.target.set(0, 0, 0); controls.enabled = true;
      viewMode = 'outside'; updateViewButtons();
      introActive = false;
      resolve();
    };

    if (reduceMotion || !window.gsap) {
      fireNova(); revealCardsInstant();
      camera.position.copy(OUTSIDE_HOME); camera.lookAt(center);
      controls.target.set(0, 0, 0); controls.enabled = true;
      viewMode = 'outside'; updateViewButtons();
      introActive = false; resolve(); return;
    }

    introActive = true;
    cards.forEach(c => { c.mesh.visible = false; }); // bis zur Supernova verborgen

    // Phase A: von AUSSEN mehrmals ums Loch kreisen (annähern, aber außen bleiben)
    const turns = 2.0;
    const startR = 460, endR = 175, startY = 140, endY = 64, startAng = Math.PI * 0.15;
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
          t: 1, duration: 2.2, ease: 'sine.inOut',
          onUpdate: () => {
            const ang = baseAng + hold.t * 0.5;
            const sh = (1 - hold.t) * (1 - hold.t) * 2.2; // Kamera-Shake, klingt ab
            camera.position.set(
              Math.cos(ang) * endR + (Math.random() - 0.5) * sh,
              endY + (Math.random() - 0.5) * sh,
              Math.sin(ang) * endR + (Math.random() - 0.5) * sh
            );
            camera.lookAt(center);
          },
          onComplete: () => { introTween = null; finalFlash(); settleOutside(); },  // Finale -> einschwenken
        });
      },
    });

    // Skip: direkt Supernova -> Karten -> außen einschwenken
    introFinish = () => {
      if (introTween) { introTween.kill(); introTween = null; }
      introFinish = null;
      fireNova();
      finalFlash();
      settleOutside();
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
  helpDismissed = false;
  if (helpEl) helpEl.classList.remove('is-hidden');
  const ready = initSceneOnce();
  onResize();
  setViewMode('outside', true);  // Start draußen (Orbit-Überblick)
  await Promise.race([runWarp(false), wait(1600)]);
  await Promise.race([ready, wait(3000)]);
  startLoop();
  setCameraIntroStart();      // Kamera weit weg, bevor das Overlay sichtbar wird
  revealOverlay();
  fadeOutWarp();              // Warp blendet weich in die Szene über (Crossfade)
  busy = false;               // ab hier kann der Nutzer interagieren / überspringen / verlassen
  runIntro();                 // läuft im Hintergrund: Anflug -> Supernova -> Karten -> einschwenken
}

function cancelIntro() {
  if (introTween) { introTween.kill(); introTween = null; }
  introFinish = null;
  introActive = false;
}

async function exitToClassic(reverse) {
  if (busy) return;
  busy = true;
  cancelIntro();
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
  cancelIntro();
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
