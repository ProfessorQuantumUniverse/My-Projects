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
// Weiträumiges System -> Kamera erhöht für 3/4-Überblick (Ekliptik als Ellipse sichtbar)
const OUTSIDE_HOME = new THREE.Vector3(0, 560, 1180);

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
  const k = Math.min(1, Math.max(0, (speed - 120) / (FLY_MAX - 120)));
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
let planets = [];               // benannte Welten (Origin/Forge/Aether/Nexus)
let asteroidBelt = null;        // Tech-Stack-Asteroidengürtel (Partikel)
let eclipticField = null;       // leuchtende Partikel in der Systemebene (Ekliptik)
let techRocks = [];             // einzelne, anklickbare Tech-Brocken
let labelLayer = null;          // Container für News-Komet-Schlagzeilen
let focusedPlanet = null;       // aktuell angeflogene Welt
let hoveredWorld = null;        // Planet/Brocken unter dem Zeiger
let newsTimer = 6;              // Countdown bis zum nächsten News-Kometen
let newsComets = [];            // langsame Kometen mit anklickbarer Schlagzeile
let newsIdx = 0;                // rotiert durch WORLD.news
let worldCalm = 0;              // 0 = volle Bewegung, 1 = eingefroren (nah an/auf einem Planeten)
let flyWarpSpeed = 0;           // treibt die Speed-Streaks während weiter Kamerafahrten (Warp-Gefühl)
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
/* ---- statische Sternen-Cubemap backen (echter, ruhiger Hintergrund) ---- */
function bakeStarCubemap(size) {
  const faces = [];
  // optionaler globaler "Milchstraßen"-Pol, damit die Bänder über die Faces grob zusammenpassen
  for (let f = 0; f < 6; f++) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    // tiefes Weltraum-Schwarz mit minimalem Blaustich
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#03040a');
    bg.addColorStop(1, '#05050d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // ein paar sehr dezente Nebel-Schwaden für Tiefe (additiv, niedrige Deckkraft)
    ctx.globalCompositeOperation = 'lighter';
    const nebCols = ['#241a4a', '#15324f', '#3a1f4a', '#102a40'];
    const nNeb = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nNeb; i++) {
      const nx = Math.random() * size, ny = Math.random() * size;
      const nr = size * (0.18 + Math.random() * 0.28);
      const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
      const col = nebCols[(f + i) % nebCols.length];
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.05 + Math.random() * 0.05;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.globalAlpha = 1;

    // Sternenfeld: viele kleine + wenige helle, farbig gestreut
    const starCount = Math.floor((size * size) / 1400);
    for (let i = 0; i < starCount; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const m = Math.random();
      const radius = m > 0.985 ? 1.6 + Math.random() * 1.8 : m > 0.9 ? 0.9 + Math.random() : 0.3 + Math.random() * 0.6;
      const pick = Math.random();
      const col = pick > 0.9 ? '173,214,255' : pick > 0.8 ? '210,190,255' : pick > 0.72 ? '255,228,196' : '255,255,255';
      const bright = m > 0.985 ? 1.0 : 0.35 + Math.random() * 0.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.2);
      g.addColorStop(0, `rgba(${col},${bright})`);
      g.addColorStop(0.5, `rgba(${col},${bright * 0.4})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    faces.push(c);
  }
  const tex = new THREE.CubeTexture(faces);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildStarfield(sprite) {
  // Echte Milchstraßen-Sternkarte (equirektangular) als Skybox.
  // Quelle: Solar System Scope (CC BY 4.0) – aus echten Himmelsdurchmusterungen.
  // Sofort eine prozedurale Cubemap als Fallback, dann weich auf die echte Map wechseln.
  scene.background = bakeStarCubemap(1024);
  scene.backgroundIntensity = 1.7;   // die Map ist (realistisch) dunkel -> anheben
  new THREE.TextureLoader().load(
    'images/skybox/milkyway_2k.jpg',
    (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      scene.background = tex;
    },
    undefined,
    () => { /* Fehler -> prozedurale Cubemap bleibt als Fallback */ }
  );
  starLayers = [];        // keine rotierenden Schichten mehr -> Ruhe & Stabilität
  starfield = null;

  // wenige helle, individuell funkelnde Sterne als lebendige Akzente (weit draußen, statisch)
  const N = 48;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), ph = new Float32Array(N);
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = 1600 + Math.random() * 2600;
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

/* ---- News-Komet: langsamer, mit leuchtendem Kopf + anklickbarer Schlagzeile ---- */
function spawnNewsComet() {
  if (!WORLD.news.length || !labelLayer) return;
  const news = WORLD.news[newsIdx % WORLD.news.length];
  newsIdx++;
  const SEG = 26;
  // sanfter Bogen quer durchs Sichtfeld, in mittlerer Tiefe
  const side = Math.random() < 0.5 ? -1 : 1;
  const start = new THREE.Vector3(side * 320, 60 + Math.random() * 120, -120 - Math.random() * 160);
  const dir = new THREE.Vector3(-side, -0.12, 0.18 + Math.random() * 0.1).normalize();
  const speed = 38 + Math.random() * 14;       // deutlich langsamer -> lesbar/klickbar
  const pos = new Float32Array(SEG * 3);
  for (let i = 0; i < SEG; i++) { pos[i * 3] = start.x; pos[i * 3 + 1] = start.y; pos[i * 3 + 2] = start.z; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.layers.set(LAYER_BG);
  scene.add(line);
  // leuchtender Kopf
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff0c0 })
  );
  head.material.toneMapped = false;
  scene.add(head);
  // klickbares HTML-Label
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'u-label u-label-news';
  el.innerHTML = `<i class="fas fa-star"></i> ${news.text}`;
  el.addEventListener('click', (e) => { e.stopPropagation(); window.open(news.url, '_blank', 'noopener'); });
  labelLayer.appendChild(el);
  newsComets.push({ line, head, headPos: start.clone(), dir, speed, t: 0, life: 16, seg: SEG, el, news });
}
const _newsVec = new THREE.Vector3();
function updateNewsComets(dt) {
  newsTimer -= dt;
  if (newsTimer <= 0 && newsComets.length < 1 && cardsRevealed) { spawnNewsComet(); newsTimer = 16 + Math.random() * 10; }
  const w = window.innerWidth, h = window.innerHeight;
  const canShow = overlay.classList.contains('is-visible') && !spaghetti && !introActive;
  for (let i = newsComets.length - 1; i >= 0; i--) {
    const c = newsComets[i];
    c.t += dt;
    c.headPos.addScaledVector(c.dir, c.speed * dt);
    c.head.position.copy(c.headPos);
    const arr = c.line.geometry.attributes.position.array;
    for (let s = c.seg - 1; s > 0; s--) {
      arr[s * 3] = arr[(s - 1) * 3]; arr[s * 3 + 1] = arr[(s - 1) * 3 + 1]; arr[s * 3 + 2] = arr[(s - 1) * 3 + 2];
    }
    arr[0] = c.headPos.x; arr[1] = c.headPos.y; arr[2] = c.headPos.z;
    c.line.geometry.attributes.position.needsUpdate = true;
    // weiches Ein-/Ausblenden
    const fade = Math.min(1, c.t / 1.5) * Math.min(1, (c.life - c.t) / 2.0);
    c.line.material.opacity = Math.max(0, 0.85 * fade);
    c.head.material.opacity = fade;
    // Label an Kopf-Position projizieren
    _newsVec.copy(c.headPos).project(camera);
    const behind = _newsVec.z > 1;
    if (canShow && !behind && Math.abs(_newsVec.x) < 1.1 && Math.abs(_newsVec.y) < 1.1) {
      const x = (_newsVec.x * 0.5 + 0.5) * w;
      const y = (-_newsVec.y * 0.5 + 0.5) * h;
      c.el.style.transform = `translate(-50%, -140%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      c.el.style.opacity = (fade * 0.95).toFixed(2);
      c.el.style.pointerEvents = fade > 0.5 ? 'auto' : 'none';
    } else {
      c.el.style.opacity = '0'; c.el.style.pointerEvents = 'none';
    }
    if (c.t >= c.life) {
      scene.remove(c.line); c.line.geometry.dispose(); c.line.material.dispose();
      scene.remove(c.head); c.head.geometry.dispose(); c.head.material.dispose();
      c.el.remove();
      newsComets.splice(i, 1);
    }
  }
}

/* ---- Nebel: große, sehr dezente, farbige Wolken weit außen ---- */
function buildNebula() {
  nebula = new THREE.Group();
  const tex = makeNebulaTexture();
  const colors = ['#3a2d8f', '#2f5fae', '#7a4bd0', '#1f4f8f', '#5a3fb0'];
  const COUNT = 5;   // wenige, große, weit entfernte Schwaden -> Tiefe ohne Unruhe
  for (let i = 0; i < COUNT; i++) {
    const baseOpacity = 0.05 + Math.random() * 0.06;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: new THREE.Color(colors[i % colors.length]), transparent: true,
      opacity: baseOpacity, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    mat.toneMapped = false;
    const size = 700 + Math.random() * 900;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.userData.baseOpacity = baseOpacity;
    // weit draußen verteilen (jenseits der Planetenbahnen) -> reiner Hintergrund
    const r = 1400 + Math.random() * 1600;
    const th = Math.random() * Math.PI * 2;
    m.position.set(Math.cos(th) * r, (Math.random() - 0.5) * 1200, Math.sin(th) * r);
    m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
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

/* ================================================================
   WELT-SYSTEM: benannte Planeten, Monde, Tech-Asteroidengürtel
   ----------------------------------------------------------------
   Jeder Himmelskörper trägt einen Aspekt des Portfolios. Die
   Projektkarten bleiben am Schwarzen Loch — die Welt drumherum
   erzählt, WER hinter den Projekten steckt.
   ================================================================ */
const WORLD = {
  planets: [
    {
      id: 'origin', name: 'Origin', kind: 'Felswelt · gezeitengebunden',
      type: 'rocky', orbitR: 220, orbitY: 14, size: 7.0, speed: 0.034, inc: 0.14, tilt: 0.3,
      colA: '#3a2418', colB: '#b5703a', colC: '#ffd9a0', glow: '#ffb060', glowAmt: 0.0,
      icon: 'fa-user-astronaut', accent: '#ffa94d',
      title: 'Origin — Wer steckt dahinter?',
      lead: 'Die innerste Welt, eine Seite ewig dem Licht zugewandt.',
      facts: [
        'Lorenzo Bay-Müller — Maker, Tüftler & Physik-Begeisterter',
        'Zuhause in Frankfurt am Main',
        'Aktiv im AstroClub der Physikalischen Gesellschaft',
        'Jugend-Forscht-Teilnehmer',
        'Leitsatz: FOSS first. Privacy always.',
      ],
      moons: [
        { name: 'Curriculum', size: 1.6, r: 16, speed: 0.26, color: '#ffcf99' },
      ],
    },
    {
      id: 'forge', name: 'Forge', kind: 'Vulkanwelt · aktive Oberfläche',
      type: 'lava', orbitR: 380, orbitY: -34, size: 11.0, speed: 0.022, inc: -0.18, tilt: 0.5,
      colA: '#1c0a06', colB: '#5a1505', colC: '#ff5a1e', glow: '#ff8a2a', glowAmt: 0.0,
      icon: 'fa-hammer', accent: '#ff6b6b',
      title: 'Forge — Was entsteht mit den Händen?',
      lead: 'Glühende Risse, sprühende Funken — die Maker-Welt.',
      facts: [
        'Hardware, 3D-Druck & Holz — wo Bits auf Atome treffen.',
      ],
      links: [
        { url: 'https://github.com/ProfessorQuantumUniverse/Fotobox', text: 'Fotobox', icon: 'fas fa-camera' },
        { url: 'http://3d-print-hub.quantumuniverse.me/', text: '3D-Print-Hub', icon: 'fas fa-cube' },
        { url: 'https://professorquantumuniverse.github.io/HQAstroCam/', text: 'HQAstroCam', icon: 'fas fa-meteor' },
        { url: 'https://github.com/ProfessorQuantumUniverse/MainBoardServer', text: 'MainBoardServer', icon: 'fas fa-server' },
        { url: 'https://professorquantumuniverse.github.io/ProjectExperience/', text: 'Project Experience', icon: 'fas fa-tree' },
      ],
      moons: [
        { name: 'Werkbank', size: 2.1, r: 22, speed: 0.22, color: '#ff8c5a' },
        { name: 'Drucker', size: 1.5, r: 31, speed: 0.16, color: '#ffb38a' },
      ],
    },
    {
      id: 'aether', name: 'Aether', kind: 'Gasriese · mit Ringsystem',
      type: 'gas', orbitR: 600, orbitY: 44, size: 16.0, speed: 0.015, inc: 0.10, tilt: 0.42,
      colA: '#2a1a5e', colB: '#7a4bd0', colC: '#c9a8ff', glow: '#a67cff', glowAmt: 0.0,
      ring: { inner: 23, outer: 40, color: '#b79cff', tilt: 0.42 },
      icon: 'fa-atom', accent: '#a67cff',
      title: 'Aether — Was bewegt den Geist?',
      lead: 'Wirbelnde Wolkenbänder voller Formeln und Fragen.',
      facts: [
        'Physik & Astronomie — von Gravitation bis Fourier',
        'Datenanalyse & Visualisierung',
        'Gleichungen als Heimat: E=mc² · ∇·E=ρ/ε₀ · ℱ{f}',
      ],
      links: [
        { url: 'https://professorquantumuniverse.github.io/Gravity-Calculator/', text: 'Gravity Calculator', icon: 'fas fa-weight-hanging' },
        { url: 'https://professorquantumuniverse.github.io/AstroClub-Planetenquiz/', text: 'AstroClub Quiz', icon: 'fas fa-star' },
        { url: 'https://jufoanalytics-main.streamlit.app/', text: 'JuFoAnalytics', icon: 'fas fa-chart-line' },
      ],
      moons: [
        { name: 'AstroClub', size: 2.6, r: 52, speed: 0.15, color: '#c4a8ff' },
        { name: 'Daten', size: 2.0, r: 66, speed: 0.11, color: '#9a78e0' },
      ],
    },
    {
      id: 'nexus', name: 'Nexus', kind: 'Eiswelt · Polarlichter',
      type: 'ice', orbitR: 780, orbitY: -58, size: 10.0, speed: 0.011, inc: -0.22, tilt: 0.6,
      colA: '#0a2540', colB: '#2f7fb5', colC: '#d8f4ff', glow: '#70ffd0', glowAmt: 0.0,
      aurora: 1.0,
      icon: 'fa-satellite-dish', accent: '#70d6ff',
      title: 'Nexus — Wie erreicht man dich?',
      lead: 'Kalt, klar, von Nordlichtern umspielt. Der Außenposten.',
      facts: [
        'Drei Monde umkreisen Nexus — jeder ein Kanal nach draußen.',
      ],
      links: [
        { url: 'mailto:lorenzobaymueller@gmail.com', text: 'E-Mail', icon: 'fas fa-envelope' },
        { url: 'https://github.com/ProfessorQuantumUniverse', text: 'GitHub', icon: 'fab fa-github' },
        { url: 'https://f-droid.org/packages/com.olaf.rereminder/', text: 'F-Droid', icon: 'fab fa-android' },
      ],
      moons: [
        { name: 'GitHub', size: 1.9, r: 20, speed: 0.27, color: '#e8e8ff', link: 'https://github.com/ProfessorQuantumUniverse' },
        { name: 'F-Droid', size: 1.7, r: 28, speed: 0.2, color: '#9ad6a0', link: 'https://f-droid.org/packages/com.olaf.rereminder/' },
        { name: 'Mail', size: 1.6, r: 36, speed: 0.15, color: '#aee6ff', link: 'mailto:lorenzobaymueller@gmail.com' },
      ],
    },
  ],
  // Tech-Stack als Asteroidengürtel (große = mehr Erfahrung). Anklickbar.
  tech: [
    { label: 'Python', size: 1.7, color: '#4b8bbe' },
    { label: 'Kotlin', size: 1.6, color: '#a97bff' },
    { label: 'JavaScript', size: 1.6, color: '#f0db4f' },
    { label: 'HTML / CSS', size: 1.4, color: '#e34f26' },
    { label: 'C++', size: 1.1, color: '#6a96cf' },
    { label: 'Three.js', size: 1.2, color: '#70d6ff' },
    { label: 'Android SDK', size: 1.3, color: '#3ddc84' },
    { label: 'Raspberry Pi', size: 1.2, color: '#c51a4a' },
    { label: 'Home Assistant', size: 1.0, color: '#41bdf5' },
    { label: 'Streamlit', size: 0.9, color: '#ff4b4b' },
    { label: 'GSAP', size: 0.9, color: '#88ce02' },
    { label: 'Manim / QGIS', size: 0.8, color: '#9ab0c0' },
  ],
  // News-Kometen: jeder Komet trägt eine anklickbare Schlagzeile.
  news: [
    { text: 'Neu: ChronoTime — Liquid-Glass-Uhr', url: 'https://github.com/ProfessorQuantumUniverse/ChronoTime' },
    { text: 'Neu: CryptMail — verschlüsselte Mails', url: 'https://github.com/ProfessorQuantumUniverse/CryptMail' },
    { text: 'Neu: QR-Stream — Air-Gap-Transfer', url: 'https://professorquantumuniverse.github.io/QR-Stream/' },
    { text: 'Neu: Gitcademy — Git interaktiv lernen', url: 'https://professorquantumuniverse.github.io/Gitcademy/' },
  ],
};

/* ---- GLSL: hashbasiertes 3D-Value-Noise + FBM (für Planetenoberflächen) ---- */
const GLSL_NOISE = `
  vec3 hash3(vec3 p){
    p = vec3(dot(p,vec3(127.1,311.7,74.7)),
             dot(p,vec3(269.5,183.3,246.1)),
             dot(p,vec3(113.5,271.9,124.6)));
    return fract(sin(p)*43758.5453123)*2.0-1.0;
  }
  float vnoise(vec3 p){
    vec3 i=floor(p), f=fract(p);
    vec3 u=f*f*(3.0-2.0*f);
    return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)),
                       dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                   mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)),
                       dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
               mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)),
                       dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                   mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)),
                       dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z);
  }
  float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
`;

/* ---- prozedurales Planeten-Material (Typ steuert Aussehen) ---- */
function makePlanetMaterial(p) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uColA:      { value: new THREE.Color(p.colA) },
      uColB:      { value: new THREE.Color(p.colB) },
      uColC:      { value: new THREE.Color(p.colC) },
      uBands:     { value: p.type === 'gas' ? 1.0 : 0.0 },
      uLava:      { value: p.type === 'lava' ? 1.0 : 0.0 },
      uAurora:    { value: p.aurora ? 1.0 : 0.0 },
      uGlow:      { value: p.type === 'rocky' ? 1.0 : 0.0 },
      uGlowColor: { value: new THREE.Color(p.glow || '#ffffff') },
      uSeed:      { value: Math.random() * 10 },
      uSunDir:    { value: new THREE.Vector3(0.4, 0.5, 1).normalize() },
    },
    vertexShader: `
      varying vec3 vObj; varying vec3 vWNormal; varying vec3 vWPos;
      void main(){
        vObj = normalize(position);
        vWNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      varying vec3 vObj; varying vec3 vWNormal; varying vec3 vWPos;
      uniform float uTime, uBands, uLava, uAurora, uGlow, uSeed;
      uniform vec3 uColA, uColB, uColC, uGlowColor, uSunDir;
      ${GLSL_NOISE}
      void main(){
        vec3 p = vObj;
        float n = fbm(p*2.6 + uSeed);
        // Gasriesen-Bänder: Breitengrad + wirbelnde Verzerrung
        float warp = fbm(p*3.0 + vec3(uTime*0.04, uSeed, 0.0))*0.22;
        float bands = sin(p.y*9.0 + warp*7.0)*0.5+0.5;
        float surf = mix(n*0.5+0.5, bands, uBands);

        vec3 col = mix(uColA, uColB, smoothstep(0.30,0.62,surf));
        col = mix(col, uColC, smoothstep(0.60,0.95,surf));

        // Lava-Adern: scharfe, pulsierende Glut in den Rissen
        float veins = fbm(p*4.2 + uSeed*1.7);
        float ridge = 1.0 - smoothstep(0.0, 0.06, abs(veins));
        float pulse = 0.55 + 0.45*sin(uTime*1.6 + veins*12.0);
        vec3 emissive = vec3(1.0,0.42,0.10) * ridge * pulse * uLava * 1.6;
        col = mix(col, col*0.35, uLava*0.6);

        // Beleuchtung: warmes Zentrumslicht (Schwarzes Loch) + ferner Sonnenstern + starkes Ambient
        vec3 N = normalize(vWNormal);
        float diffC = clamp(dot(N, normalize(-vWPos)), 0.0, 1.0);   // vom Zentrum
        float diffS = clamp(dot(N, normalize(uSunDir)), 0.0, 1.0);  // vom fernen Stern
        float light = 0.5 + 0.55 * diffC + 0.5 * diffS;             // hell genug, nichts versinkt
        col *= light;
        float diff = max(diffC, diffS);

        // gezeitengebundene Glut: dem Zentrum zugewandte Seite leuchtet warm
        emissive += uGlowColor * pow(diffC, 3.0) * uGlow * 1.0;

        // Polarlichter: hohe Breitengrade auf der Nachtseite schimmern grün/cyan
        float lat = abs(p.y);
        float aur = smoothstep(0.55, 0.9, lat) * (1.0-diff);
        float flick = 0.5 + 0.5*sin(uTime*2.0 + p.x*8.0 + p.z*6.0);
        emissive += vec3(0.25,1.0,0.65) * aur * flick * uAurora * 0.9;

        gl_FragColor = vec4(col + emissive, 1.0);
      }`,
  });
}

/* ---- weiche Atmosphären-/Glow-Hülle (Fresnel, additiv) ---- */
function makeAtmosphere(color, radius) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; uniform vec3 uColor;
      void main(){ float rim=pow(1.0-max(dot(vN,vV),0.0),2.0); gl_FragColor=vec4(uColor*rim*2.4, rim*0.95); }`,
  });
  mat.toneMapped = false;
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 32), mat);
}

/* ---- weiche Ring-Textur (für Aether's Ringsystem) ---- */
function makeRingTexture() {
  const w = 256, h = 16;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  for (let x = 0; x < w; x++) {
    const t = x / w;
    const band = 0.4 + 0.6 * Math.abs(Math.sin(t * 22) * Math.sin(t * 7));
    const edge = Math.sin(t * Math.PI);               // außen weich auslaufend
    const a = Math.min(1, band * edge * 1.2);
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.fillRect(x, 0, 1, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---- Orbit-Linie: zeigt die Systemebene, genau auf der Planetenbahn ---- */
function buildOrbitLine(p) {
  const SEG = 256;
  const pts = [];
  const axis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const v = new THREE.Vector3(Math.cos(a) * p.orbitR, p.orbitY, Math.sin(a) * p.orbitR);
    v.applyAxisAngle(axis, p.inc);            // exakt wie die Planetenposition geneigt
    pts.push(v);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(p.accent), transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  mat.toneMapped = false;
  const line = new THREE.LineLoop(geo, mat);
  scene.add(line);
  return line;
}

/* ---- ein Planetensystem (Planet + Atmosphäre + Ring + Monde) ---- */
function buildPlanet(p, idx) {
  buildOrbitLine(p);                           // dezente Bahnlinie auf der Ekliptik

  const group = new THREE.Group();             // bewegt sich auf der Umlaufbahn
  const body = new THREE.Group();              // trägt Planet + Eigenrotation
  group.add(body);

  const mat = makePlanetMaterial(p);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.size, 48, 48), mat);
  mesh.userData.planet = p;                    // für Raycast-Picking
  body.add(mesh);

  const atmo = makeAtmosphere(p.accent, p.size * 1.18);
  body.add(atmo);

  // optionaler Ring (Aether)
  if (p.ring) {
    const rg = new THREE.RingGeometry(p.ring.inner, p.ring.outer, 96);
    // UV so anpassen, dass die Textur radial verläuft
    const ringMat = new THREE.MeshBasicMaterial({
      map: makeRingTexture(), color: new THREE.Color(p.ring.color), transparent: true,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6,
    });
    ringMat.toneMapped = false;
    const ring = new THREE.Mesh(rg, ringMat);
    ring.rotation.x = Math.PI / 2 - p.ring.tilt;
    body.add(ring);
  }

  body.rotation.z = p.tilt || 0;

  // Monde
  const moons = [];
  (p.moons || []).forEach((m) => {
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(m.size, 18, 18),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(m.color), roughness: 0.85, metalness: 0.05, emissive: new THREE.Color(m.color).multiplyScalar(0.12) })
    );
    moonMesh.userData.moon = m;
    group.add(moonMesh);
    moons.push({ mesh: moonMesh, r: m.r, speed: m.speed, angle: Math.random() * Math.PI * 2, inc: (Math.random() - 0.5) * 0.6, data: m });
  });

  scene.add(group);
  // Startwinkel gleichmäßig verteilt -> Übersicht wirkt immer ausgewogen, nie gebündelt
  const startAngle = (idx || 0) * (Math.PI * 2 / 4) + 0.5;
  const rec = {
    data: p, group, body, mesh, mat, moons,
    angle: startAngle, orbitR: p.orbitR, orbitY: p.orbitY,
    speed: p.speed, inc: p.inc, worldPos: new THREE.Vector3(),
  };
  planets.push(rec);
  return rec;
}

/* ---- Tech-Asteroidengürtel: Partikelwolke + einzelne anklickbare Brocken ---- */
const BELT_R0 = 455, BELT_R1 = 515;   // Gürtel zwischen Forge (380) und Aether (600)
function buildAsteroidBelt(sprite) {
  // (a) dünne Partikelwolke als Gürtel-Untergrund (deutlich reduziert)
  const N = 420;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = BELT_R0 + Math.random() * (BELT_R1 - BELT_R0);
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 16;
    pos[i * 3 + 2] = Math.sin(a) * r;
    tmp.copy(COL.cyan).lerp(COL.white, Math.random() * 0.5).multiplyScalar(0.4 + Math.random() * 0.5);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  asteroidBelt = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 2.0, map: sprite, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.55,
  }));
  scene.add(asteroidBelt);

  // (b) benannte Tech-Brocken (größer, anklickbar) gleichmäßig im Gürtel
  WORLD.tech.forEach((t, i) => {
    const a = (i / WORLD.tech.length) * Math.PI * 2 + Math.random() * 0.2;
    const r = (BELT_R0 + BELT_R1) / 2 + (Math.random() - 0.5) * 40;
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(t.size * 4.4, 0),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(t.color), roughness: 0.7, metalness: 0.25, emissive: new THREE.Color(t.color).multiplyScalar(0.18), flatShading: true })
    );
    rock.userData.tech = t;
    rock.userData.baseSize = t.size * 4.4;
    scene.add(rock);
    techRocks.push({ mesh: rock, data: t, r, y: (Math.random() - 0.5) * 20, angle: a, spin: 0.2 + Math.random() * 0.4, worldPos: new THREE.Vector3() });
  });
}

/* ---- Leuchtende Partikel in der Systemebene (Ekliptik) – macht die Ebene
   greifbar & lenkt den Blick, wie auf der Referenzseite. Bewusst sparsam. ---- */
function buildEclipticField(sprite) {
  const N = 900;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // Radius bevorzugt im inneren/mittleren Systembereich (sqrt-Verteilung -> dichter innen)
    const r = 120 + Math.sqrt(Math.random()) * 740;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 24;   // dünne Scheibe
    pos[i * 3 + 2] = Math.sin(a) * r;
    const pick = Math.random();
    tmp.copy(pick > 0.6 ? COL.cyan : pick > 0.3 ? COL.violet : COL.white)
       .multiplyScalar(0.5 + Math.random() * 0.6);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  eclipticField = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 3.4, map: sprite, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.85,
  }));
  eclipticField.material.toneMapped = false;
  scene.add(eclipticField);
}

function buildWorld(sprite) {
  // Zentrales Punktlicht (warmer Akzent vom Schwarzen Loch) – ohne Abfall, damit
  // es auch die weit entfernten Planeten erreicht
  const key = new THREE.PointLight(0xffe6c0, 1.4, 0, 0);
  key.position.set(0, 0, 0);
  scene.add(key);
  // Ferner "Sonnenstern": gerichtetes Licht, das ALLE Planeten gleichmäßig formt
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
  sun.position.set(0.4, 0.5, 1).normalize();
  scene.add(sun);
  // deutlich helleres Umgebungslicht -> nichts versinkt im Schwarz
  scene.add(new THREE.AmbientLight(0x4a5a78, 1.1));

  WORLD.planets.forEach(buildPlanet);
  buildEclipticField(sprite);
  buildAsteroidBelt(sprite);
  buildWorldLabels();   // erzeugt nur noch den (leeren) Container für News-Kometen
}

/* ---- Container für News-Komet-Schlagzeilen (keine Planeten-/Tech-Labels mehr:
   Entdeckung per Anflug, wie bei Bruno Simon) ---- */
function buildWorldLabels() {
  labelLayer = document.createElement('div');
  labelLayer.className = 'u-labels';
  labelLayer.setAttribute('aria-hidden', 'true');
  overlay.appendChild(labelLayer);
}

// Achse für leicht geneigte Umlaufbahnen (wiederverwendet)
const _orbitAxis = new THREE.Vector3();
function updateWorld(dt) {
  // Annäherungs-Stillstand: nahe an / fokussiert auf einem Planeten friert das System sanft ein.
  // (nutzt worldPos vom Vorframe -> 1 Frame Versatz, unmerklich)
  let nearest = Infinity;
  for (const pl of planets) nearest = Math.min(nearest, camera.position.distanceTo(pl.worldPos));
  const targetCalm = focusedPlanet ? 1 : (1 - THREE.MathUtils.smoothstep(nearest, 90, 340));
  worldCalm += (targetCalm - worldCalm) * Math.min(1, dt * 3.5);
  const motion = 1 - worldCalm;   // globaler Bewegungs-Faktor

  // Planeten: Umlaufbahn (leicht geneigt) + Eigenrotation + Monde + Shader-Zeit
  for (const pl of planets) {
    pl.angle += dt * pl.speed * motion;
    const x = Math.cos(pl.angle) * pl.orbitR;
    const z = Math.sin(pl.angle) * pl.orbitR;
    pl.group.position.set(x, pl.orbitY, z).applyAxisAngle(_orbitAxis.set(0, 0, 1), pl.inc);
    pl.group.getWorldPosition(pl.worldPos);
    // gezeitengebundene Origin dreht sich nicht (eine Seite bleibt zum Zentrum); Eigenrotation läuft (sanft) weiter
    if (pl.data.type !== 'rocky') pl.body.rotation.y += dt * 0.05 * (0.3 + 0.7 * motion);
    pl.mat.uniforms.uTime.value = elapsed;

    for (const mo of pl.moons) {
      mo.angle += dt * mo.speed * motion;
      const mx = Math.cos(mo.angle) * mo.r;
      const mz = Math.sin(mo.angle) * mo.r;
      mo.mesh.position.set(mx, Math.sin(mo.angle) * mo.r * Math.sin(mo.inc), mz);
      mo.mesh.rotation.y += dt * 0.3 * motion;
    }
  }

  updateNewsComets(dt);

  // Asteroidengürtel + Ekliptik-Staub: sehr langsame Eigendrehung (hält bei Annäherung an)
  if (asteroidBelt) asteroidBelt.rotation.y += dt * 0.005 * motion;
  if (eclipticField) eclipticField.rotation.y += dt * 0.004 * motion;

  // Tech-Brocken: Umlauf + Eigenrotation + Hervorhebung bei Hover
  for (const tr of techRocks) {
    tr.angle += dt * 0.008 * motion;
    const x = Math.cos(tr.angle) * tr.r;
    const z = Math.sin(tr.angle) * tr.r;
    tr.mesh.position.set(x, tr.y, z);
    tr.mesh.rotation.x += dt * tr.spin * 0.6 * (0.3 + 0.7 * motion);
    tr.mesh.rotation.y += dt * tr.spin * (0.3 + 0.7 * motion);
    tr.mesh.getWorldPosition(tr.worldPos);
    const hot = (hoveredWorld === tr);
    const s = hot ? 1.4 : 1.0;
    tr.mesh.scale.lerp(_tmpVec.set(s, s, s), 0.15);
  }
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
  if (counterEl) counterEl.textContent = '◍ ' + projects.length + ' projects · ' + WORLD.planets.length + ' worlds';

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
  renderer.toneMappingExposure = 0.9;   // etwas heller -> Planeten besser sichtbar

  scene = new THREE.Scene();
  // sehr dezenter Fog: Tiefe ohne die weiträumigen Planeten zu verschlucken
  scene.fog = new THREE.FogExp2(0x05060f, 0.00012);

  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 12000);
  camera.rotation.order = 'YXZ';
  camera.position.copy(INSIDE_HOME);

  controls = new OrbitControls(camera, glCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 16;
  controls.maxDistance = 3200;
  controls.autoRotateSpeed = 0.08;       // kaum merkbares Auto-Drift (Ruhe)
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
  buildWorld(sprite);
  // buildStardust entfernt: fliegende Vordergrund-Partikel wirkten unruhig

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.42, 0.55, 0.5 // strength, radius, threshold -> dezenteres Glühen, Planeten brennen nicht aus
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
    else if (focusedPlanet) unfocusPlanet();
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
const FLY_ACCEL = 320, FLY_DAMP = 0.95, FLY_MAX = 240;
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
  const world = pickWorld();          // Planeten / Monde / Tech-Brocken
  const worldDist = world ? world.distance : Infinity;
  if (bh.length && bh[0].distance < cardDist && bh[0].distance < worldDist) { exitToClassic(true); return; }
  if (cardHits.length && cardDist < worldDist) { focusCard(cardHits[0].object.userData.card); return; }
  if (world) {
    if (world.type === 'planet') focusPlanet(world.planet);
    else if (world.type === 'tech') focusTech(world.tech);
    else if (world.type === 'moon' && world.moon.data.link) window.open(world.moon.data.link, '_blank', 'noopener');
    return;
  }
  if (focusedPlanet) unfocusPlanet();
  else if (focused) unfocusCard();
}

// Raycast gegen alle Weltobjekte; gibt das nächste mit Typ-Info zurück
function pickWorld() {
  let best = null;
  for (const pl of planets) {
    const hit = raycaster.intersectObject(pl.mesh, false)[0];
    if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, type: 'planet', planet: pl };
    for (const mo of pl.moons) {
      const mh = raycaster.intersectObject(mo.mesh, false)[0];
      if (mh && (!best || mh.distance < best.distance)) best = { distance: mh.distance, type: 'moon', moon: mo };
    }
  }
  for (const tr of techRocks) {
    const th = raycaster.intersectObject(tr.mesh, false)[0];
    if (th && (!best || th.distance < best.distance)) best = { distance: th.distance, type: 'tech', tech: tr };
  }
  return best;
}

// Sanfte Kamerafahrt: Position UND Blickrichtung werden interpoliert (kein Sprung)
// warp=true -> Speed-Streaks-Puls für ein spürbares "Ich reise weit"-Gefühl
function flyCameraTo(targetPos, lookAtVec, duration = 1.2, ease = 'power3.inOut', warp = false) {
  return new Promise((resolve) => {
    const m = new THREE.Matrix4().lookAt(targetPos, lookAtVec, camera.up);
    const endQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    if (reduceMotion || !window.gsap) {
      camera.position.copy(targetPos); camera.quaternion.copy(endQuat); resolve(); return;
    }
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const travel = startPos.distanceTo(targetPos);
    const warpPeak = warp ? Math.min(260, 60 + travel * 0.4) : 0;   // weiter = stärkerer Warp
    const s = { t: 0 };
    camFlying = true;
    gsap.to(s, {
      t: 1, duration, ease,
      onUpdate: () => {
        camera.position.lerpVectors(startPos, targetPos, s.t);
        camera.quaternion.copy(startQuat).slerp(endQuat, s.t);
        flyWarpSpeed = Math.sin(s.t * Math.PI) * warpPeak;          // Glockenkurve: ramp auf/ab
      },
      onComplete: () => { camFlying = false; flyWarpSpeed = 0; resolve(); },
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

/* ---- Planet anfliegen: weite Warp-Reise, dann Welt-Panel ---- */
function focusPlanet(pl) {
  if (focused) unfocusCard();
  focusedPlanet = pl;
  controls.enabled = false;
  showPlanetDetail(pl.data);
  // Kameraposition: zwischen Zentrum und Planet, leicht versetzt -> Planet bildfüllend
  const wp = pl.worldPos.clone();
  const outward = wp.clone().normalize();
  const camPos = wp.clone()
    .addScaledVector(outward, pl.data.size * 3.6)
    .add(new THREE.Vector3(0, pl.data.size * 1.2, 0));
  flyCameraTo(camPos, wp, 2.2, 'power3.inOut', true);   // länger + Warp-Puls
}
function unfocusPlanet() {
  const was = focusedPlanet;
  focusedPlanet = null;
  hideDetail();
  if (!was) return;
  if (viewMode === 'outside') {
    flyCameraTo(OUTSIDE_HOME, center, 1.5).then(() => { controls.target.set(0, 0, 0); controls.enabled = true; });
  } else {
    flyCameraTo(INSIDE_HOME, new THREE.Vector3(80, 2, 0), 1.5).then(() => { fly.yaw = camera.rotation.y; fly.pitch = camera.rotation.x; });
  }
}

/* ---- Tech-Brocken: zeigt zugehörige Projekte ---- */
function focusTech(tr) {
  const t = tr.data;
  // Projekte finden, die diese Technologie verwenden (Tag- oder Titel-Match)
  const needle = t.label.toLowerCase().split(/[\s/]+/)[0];
  const matches = projects.filter(pr =>
    (pr.tags || []).some(tag => tag.toLowerCase().includes(needle)) ||
    (pr.title || '').toLowerCase().includes(needle) ||
    (pr.description || '').toLowerCase().includes(needle)
  );
  showTechDetail(t, matches);
}

// Panel-Akzent (Rahmen + Glow) auf eine Farbe setzen oder zurücksetzen
function setPanelAccent(color) {
  if (!detailEl) return;
  if (color) {
    detailEl.style.borderColor = color;
    detailEl.style.boxShadow = `0 20px 60px rgba(0,0,0,0.6), 0 0 36px ${color}33`;
  } else {
    detailEl.style.borderColor = '';
    detailEl.style.boxShadow = '';
  }
}

/* ---- Detail-Panel: Planet-Welt ---- */
function showPlanetDetail(p) {
  if (!detailBody) return;
  const facts = (p.facts || []).map(f => `<li>${f}</li>`).join('');
  const links = (p.links || []).map(l =>
    `<a href="${l.url}" target="_blank" rel="noopener">${l.text}<i class="${l.icon}"></i></a>`).join('');
  detailBody.innerHTML = `
    <div class="u-detail-kicker" style="color:${p.accent}"><i class="fas ${p.icon}"></i> ${p.kind}</div>
    <h3>${p.title}</h3>
    <p>${p.lead || ''}</p>
    ${facts ? `<ul class="u-detail-facts">${facts}</ul>` : ''}
    ${links ? `<div class="u-detail-links">${links}</div>` : ''}
  `;
  setPanelAccent(p.accent);
  detailEl.classList.add('is-open');
  detailEl.setAttribute('aria-hidden', 'false');
}

/* ---- Detail-Panel: Tech-Brocken (Projekte mit dieser Technologie) ---- */
function showTechDetail(t, matches) {
  if (!detailBody) return;
  const list = matches.length
    ? matches.map(pr => {
        const url = (pr.links && pr.links[0] && pr.links[0].url) || '#';
        return `<a href="${url}" target="_blank" rel="noopener">${pr.title}<i class="fas fa-arrow-up-right-from-square"></i></a>`;
      }).join('')
    : '<p style="opacity:.6">Noch keine verknüpften Projekte.</p>';
  detailBody.innerHTML = `
    <div class="u-detail-kicker" style="color:${t.color}"><i class="fas fa-microchip"></i> Tech-Asteroid</div>
    <h3>${t.label}</h3>
    <p>${matches.length} Projekt${matches.length === 1 ? '' : 'e'} im Universum nutzen diese Technologie:</p>
    <div class="u-detail-links u-detail-techlinks">${list}</div>
  `;
  setPanelAccent(t.color);
  detailEl.classList.add('is-open');
  detailEl.setAttribute('aria-hidden', 'false');
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
  setPanelAccent(null);   // Karten nutzen den Standard-Violett-Rahmen
  detailEl.classList.add('is-open');
  detailEl.setAttribute('aria-hidden', 'false');
}
function hideDetail() {
  if (!detailEl) return;
  detailEl.classList.remove('is-open');
  detailEl.setAttribute('aria-hidden', 'true');
  setPanelAccent(null);
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
  if (starMat) starMat.uniforms.uTime.value = elapsed;           // Funkeln (Sterne bleiben statisch positioniert)
  // Nebel: statisch (keine Rotation mehr) -> Ruhe; weit draußen, daher keine Nah-Ausblendung nötig
  if (photonRing) { photonRing.quaternion.copy(camera.quaternion); photonRing.scale.setScalar(1 + Math.sin(elapsed * 1.5) * 0.015); }
  updateNova(dt);
  updateComets(dt);
  updateWorld(dt);

  // Kamera-Steuerung je nach Modus (Intro/sanfte Fahrten steuern selbst)
  if (!focused && !focusedPlanet && !spaghetti && !introActive && !camFlying) {
    if (viewMode === 'inside') { updateFly(dt); }
    else { applyMovement(dt); controls.update(); }
  }
  // Beim Planet-Fokus folgt der Blick dem (langsam weiterziehenden) Planeten
  if (focusedPlanet && !camFlying) camera.lookAt(focusedPlanet.worldPos);
  drawSpeed(Math.max(fly.vel.length(), flyWarpSpeed));   // Speed-Streaks bei Tempo oder Warp-Reise

  // Gravitations-Lensing aktualisieren
  updateLens();

  // Spaghettisierung: Kollision Kamera <-> Horizont
  if (viewMode === 'inside' && !focused && !spaghetti && !introActive &&
      camera.position.distanceTo(center) < BH_RADIUS * 1.15) {
    triggerSpaghetti();
  }

  // Hover-Erkennung (nicht beim Draggen/Fokus/Intro)
  if (!isDown && !focused && !focusedPlanet && !spaghetti && !introActive) {
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
    // Welt-Hover (Planeten/Tech-Brocken) — nur Cursor + Brocken-Hervorhebung
    const wh = card ? null : pickWorld();
    hoveredWorld = (wh && (wh.type === 'tech' ? wh.tech : null)) || null;
    if (wh && !card) glCanvas.classList.add('is-pointer');
  } else if (focusedPlanet) {
    hoveredWorld = null;
  }

  // Karten-Kuppel sehr langsam drehen (pausiert bei Hover/Fokus, friert bei Planet-Nähe ein)
  const rotating = !hovered && !focused && !focusedPlanet && !spaghetti;
  if (rotating) domeAngle += dt * 0.008 * (1 - worldCalm);

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
  if (viewMode === 'inside' && !focused && !focusedPlanet && !spaghetti && !introActive && !camFlying && cardsRevealed) {
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
  camera.position.set(Math.cos(ang) * 2000, 880, Math.sin(ang) * 2000);
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

    // Phase A: von WEIT AUSSEN durchs ganze System spiralen, hinab zum Loch
    const turns = 2.0;
    const startR = 2000, endR = 175, startY = 880, endY = 64, startAng = Math.PI * 0.15;
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
  detailCloseBtn && detailCloseBtn.addEventListener('click', () => { if (focusedPlanet) unfocusPlanet(); else if (focused) unfocusCard(); else hideDetail(); });
  terminalExit && terminalExit.addEventListener('click', resetSpaghetti);

  if (hintEl) {
    hintEl.textContent = (isMobile() || !hasWebGL())
      ? 'Tip: the 3D experience is optimized for desktop — on this device we’ll glide you straight to the classic cards.'
      : 'Tip: drag to look · W A S D to fly · hover a card · click the black hole to return.';
  }

  window.__universeReady = true;
}

wire();
