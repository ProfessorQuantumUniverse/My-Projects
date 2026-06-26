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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ----------------------------------------------------------------
   Konfiguration
   ---------------------------------------------------------------- */
const COL = {
  violet: new THREE.Color('#a67cff'),
  cyan:   new THREE.Color('#70d6ff'),
  white:  new THREE.Color('#ffffff'),
};

const BH_RADIUS   = 30;       // Event-Horizont (groß & prominent)
const DISK_INNER  = 38;
const DISK_OUTER  = 200;
const INSIDE_HOME  = new THREE.Vector3(0, 400, 2800);  // Raumschiff-Start: weit außerhalb (Scheibe füllt nur ~1/3 Bild, dezentes Lensing), leicht erhöht, Blick zum Zentrum

/* ---- Paralleluniversum: Karten-Tunnel hinter dem Wurmloch ----
   Liegt weit jenseits der Kamera-Far-Plane (12000) vom Zentrum, sodass Haupt-
   universum und Tunnel sich gegenseitig nicht sehen (automatische Isolation). */
const WORMHOLE_ORBIT_R = 700;                         // Umlaufradius des Wurmlochs ums Schwarze Loch
const TUNNEL_ORIGIN = new THREE.Vector3(0, 0, 20000); // Mittelachse des Karten-Tunnels
const TUNNEL_LENGTH = 3400;                           // sehr langer Galerie-Tunnel (große Abstände zum Erfassen jeder Karte)
const RING_R = 36;                                    // Abstand der Karten von der Flugachse (Galerie-Wand)
const CARD_FACE_AHEAD = 50;                           // Karte neigt sich zu diesem Punkt voraus auf der Achse (Galerie-Neigung)
const CARD_H = 28;                                    // große Galerie-Karten (Höhe in Welteinheiten)
// Proximity-Reveal: Karten erscheinen erst, wenn das Schiff sich nähert -> nur die nächsten ~2 sichtbar.
// d = Karten-Z minus Schiff-Z (>0 = noch vor dem Schiff).
const REVEAL_IN_FAR = 175;                            // ab dieser Distanz VOR dem Schiff taucht eine Karte auf (viel Lesevorlauf)
const REVEAL_IN_NEAR = 98;                            // ab hier ist sie voll da
const REVEAL_OUT_NEAR = -8;                           // kurz nach dem Passieren beginnt das Verblassen
const REVEAL_OUT_FAR = -55;                           // hier ist sie wieder verschwunden
const CARD_BOTTOM_GAP = 110;                          // gesperrter Bogen unten in Grad (Schiff verdeckt Karten dort)

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
const musicBtn       = document.getElementById('u-music');
const starmapEl      = document.getElementById('u-starmap');
const starmapBtn     = document.getElementById('u-starmap-btn');
const starmapCloseBtn= document.getElementById('u-starmap-close');
const starmapCanvas  = document.getElementById('u-starmap-canvas');
const starmapCtx     = starmapCanvas ? starmapCanvas.getContext('2d') : null;
const starmapInfo    = document.getElementById('u-starmap-info');

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

  // WICHTIG: Die Hauptseite (Hero & "My Space") bleibt bewusst UNANGETASTET –
  // kein Scale/Blur/Kippen, damit sie visuell unverändert und normal nutzbar bleibt.
  // Nur die Gateway-/"Enter Universe"-Sektion bekommt einen nahtlosen Spezial-Übergang.

  // Gateway taucht beim Hereinscrollen weich auf (sanftes Heben + Fade, kein hartes 3D-Kippen)
  gsap.fromTo('#gateway',
    { y: 36, opacity: 0.5 },
    { y: 0, opacity: 1, ease: 'none',
      scrollTrigger: { trigger: '#gateway', start: 'top bottom', end: 'top 55%', scrub: true } }
  );

  // Gateway-Core Glow intensiviert sich scroll-gesteuert (Portal "lädt sich auf")
  gsap.fromTo('.g-core',
    { scale: 1 },
    { scale: 1.8, ease: 'none',
      scrollTrigger: { trigger: '#gateway', start: 'top 80%', end: 'top 20%', scrub: true } }
  );

  // Gateway gleitet beim Weiterscrollen zu den Projekten sanft weg (nur Fade – kein Blur/Kippen,
  // damit die Projekt-Sektion darunter unverzerrt bleibt)
  gsap.to('#gateway', {
    opacity: 0.4, ease: 'none',
    scrollTrigger: { trigger: '#explorations', start: 'top bottom', end: 'top center', scrub: true },
  });

  // Partikel dimmen sich zur Gateway-Mitte hin ab (tieferer Space) und hellen davor/danach
  // wieder voll auf – so bleibt der Sternenhimmel auf der restlichen Seite unverändert.
  if (window.fadeParticles) {
    ScrollTrigger.create({
      trigger: '#gateway',
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
      onUpdate: (self) => {
        const dim = 1 - Math.sin(self.progress * Math.PI) * 0.45;
        window.fadeParticles(dim);
      },
    });
  }
}

/* ================================================================
   1b) PRE-INIT: Szene vorladen wenn Gateway in Sichtweite
   ================================================================ */
function setupPreInit() {
  if (isMobile() || !hasWebGL() || scenePreInited) return;

  const gateway = document.getElementById('gateway');
  if (!gateway) return;

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !scenePreInited) {
        scenePreInited = true;
        observer.disconnect();
        overlay.classList.add('is-preloaded');
        initSceneOnce().then(() => {
          onResize();
          startLoop();
        });
      }
    }
  }, { root: null, rootMargin: '300px 0px 0px 0px', threshold: 0.01 });

  observer.observe(gateway);
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
  warpCanvas.style.transition = 'opacity 0.8s ease';
  warpCanvas.style.opacity = '0';
  setTimeout(hideWarp, 850);
}

/* Anhaltender Warp: kontinuierlich fließende Hyperraum-Streifen für holdSec Sekunden
   (Intensität rampt in den ersten ~0.9s ein). Der Aufrufer blendet ihn danach via
   fadeOutWarp() sanft in die 3D-Szene über. */
function runWarpHold(holdSec) {
  return new Promise((resolve) => {
    if (reduceMotion) { resolve(); return; }
    const ctx = warpCanvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    warpCanvas.width  = Math.floor(window.innerWidth  * dpr);
    warpCanvas.height = Math.floor(window.innerHeight * dpr);
    warpCanvas.style.transition = '';
    warpCanvas.style.opacity = '';
    warpCanvas.classList.add('is-active');

    const W = warpCanvas.width, H = warpCanvas.height;
    const cx = W / 2, cy = H / 2;
    const maxR = Math.hypot(cx, cy) * 1.08;
    const palette = ['#ffffff', '#cdbcff', '#a67cff', '#70d6ff'];
    const N = Math.min(460, Math.floor((W * H) / 7600));
    const streaks = [];
    for (let i = 0; i < N; i++) {
      streaks.push({
        ang: Math.random() * Math.PI * 2,
        off: Math.random(),
        len: 0.05 + Math.random() * 0.09,
        spd: 0.75 + Math.random() * 0.7,
        c: palette[(Math.random() * palette.length) | 0],
      });
    }
    const RAMP = 0.9;                  // Sekunden Einblend-Rampe der Intensität
    const start = performance.now();
    function frame(now) {
      const t = (now - start) / 1000;
      const intens = Math.min(1, t / RAMP);

      ctx.fillStyle = 'rgba(2,3,10,0.30)';
      ctx.fillRect(0, 0, W, H);
      ctx.lineCap = 'round';

      for (const s of streaks) {
        const head = (t * 0.5 * s.spd + s.off) % 1;       // kontinuierlich nach außen fließend
        const tail = Math.max(0, head - s.len);
        const r2 = Math.pow(head, 2.4) * maxR;
        const r1 = Math.pow(tail, 2.4) * maxR;
        const dx = Math.cos(s.ang), dy = Math.sin(s.ang);
        ctx.strokeStyle = s.c;
        ctx.globalAlpha = Math.min(1, 0.18 + (r2 / maxR) * 0.85) * intens;
        ctx.lineWidth = Math.max(0.6, (r2 / maxR) * 2.8) * dpr;
        ctx.beginPath();
        ctx.moveTo(cx + dx * r1, cy + dy * r1);
        ctx.lineTo(cx + dx * r2, cy + dy * r2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (t < holdSec) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
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
  const k = Math.min(1, Math.max(0, (speed - 400) / (FLY_MAX - 400)));
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
let elapsed = 0;                 // Gesamtzeit (für Twinkle/Shader)
let lastInput = 0;               // für Idle-Auto-Drift
let reticleCard = null;          // Karte im Fadenkreuz (Dome-Modus)
let helpDismissed = false;       // Hilfe-UI nach erster Bewegung ausblenden
let lockTarget = null;           // Lock-On-Ziel im Fadenkreuz { type, ref, name, distance }
let lockT = 0;                   // wie lange das aktuelle Ziel anvisiert wird (Sekunden)
const LOCK_TIME = 0.3;           // Zeit bis "eingerastet"

// Musik (Web Audio API): zwei Ambient-Tracks von Scott Buckley
let audioCtx = null, musicGain = null, musicBuffers = [], musicSources = [];
let musicReady = false, musicMuted = false, musicLoading = false;
let musicTrack = 0;
const MUSIC_FILES = ['Music/Unraveling.mp3', 'Music/Aphelion.mp3'];
const MUSIC_VOL = 0.45;
// StarMap
let starmapOpen = false;

let sceneBuilt = false;
let running = false;
let animId = null;
let scenePreInited = false;        // Pre-Init per IntersectionObserver gelaufen
let portalExpandEl = null;         // fullscreen radial-gradient für Portal-Expansion

let viewMode = 'inside';        // immer 'inside' (Schiff stets aktiv; Outside-/Dome-Umschalter entfernt)
let realm = 'main';             // 'main' = Sonnensystem + Wurmloch · 'cards' = Karten-Tunnel
let wormhole = null;            // THREE.Group: Torus (Einstein-Ring) + Portal + Partikel
let wormholeAngle = 0;          // Umlaufwinkel ums Schwarze Loch
const wormholeWorldPos = new THREE.Vector3();
let portalMat = null;           // Vortex-Shader des Eingangs-Portals
let exitPortal = null;          // Rückkehr-Portal am Tunnelende
let exitPortalMat = null;
let tunnelSkybox = null;        // violette Cubemap fürs Paralleluniversum
let savedMainBg = null;         // Haupt-Skybox merken (zum Zurücktauschen)
let savedMainFog = null;        // Haupt-Nebel merken (Tunnel nutzt dichteren Tiefen-Nebel)
let tunnelLight = null;         // weiches Licht im Karten-Tunnel
let tunnelShell = null;         // dezente Leuchtringe, die den Tunnel andeuten
let tunnelGuide = null;         // fließende Leit-Ringe, die zum Ausgang weisen
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

/* ---- Raumschiff "Interstellar Ranger" (Third-Person-Flug, Inside-Modus) ---- */
let ship = null;                 // rohes GLTF-Modell (zentriert)
let shipOrient = null;           // trägt Yaw-Korrektur + Skalierung
let bankGroup = null;            // rollt um die Vorwärtsachse (Banking)
let shipPivot = null;            // Träger: Position + Orientierung (Chase-Cam-Referenz)
let shipLoaded = false;
let engineTrail = null;          // Partikel-Triebwerksspur
let engineLight = null;          // PointLight am Heck (Bloom-Akzent)
const SHIP_MODEL_YAW = Math.PI;  // Nase des Modells (+Z) -> -Z (Three-Vorwärts); ggf. anpassen
const SHIP_LENGTH = 12;          // gewünschte Schiffslänge in Welteinheiten
const shipState = {
  pos: new THREE.Vector3().copy(INSIDE_HOME),
  quat: new THREE.Quaternion(),
  vel: new THREE.Vector3(),
  rollAngle: 0,                  // visuelles Bank-/Rollen in Kurven
  engineGlow: 0,                 // 0..1 für Trail-/Glow-Intensität
  boost: false,
};
const CHASE_OFFSET = new THREE.Vector3(0, 7, 22);     // hinter + über dem Schiff
const CHASE_STIFFNESS = 6.0;                          // Federhärte der Verfolgerkamera
const KEY_YAW_RATE = 2.0;                             // rad/s — A/D drehen das Schiff (Gieren statt Seitwärtsgang)
const KEY_PITCH_RATE = 1.6;                           // rad/s — Pfeil hoch/runter neigen die Nase (Pitch)
const _shipFwd = new THREE.Vector3();                 // wiederverwendet
const _shipRight = new THREE.Vector3();
const _shipUp = new THREE.Vector3();
const _camDesired = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _shipEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _shipTargetQuat = new THREE.Quaternion();
const _shipMat = new THREE.Matrix4();

/* ---- Autopilot & Orbit-Lock (Planet anfliegen ohne Teleport) ---- */
const ORBIT_RADIUS_K  = 2.2;     // Orbit-Radius = Planetengröße * K (nah genug zum Lesen, ganzer Planet im Bild)
const AUTO_ORBIT_K    = 2.6;     // ab dieser Nähe (Größe * K) klinkt sich das Schiff selbst in den Orbit ein
const AUTOPILOT_MAX   = 2000;    // Reisetempo des Autopiloten beim Anflug
const ORBIT_ANG_SPEED = 0.22;    // Winkelgeschwindigkeit, mit der das Schiff den Planeten umkreist (rad/s)
let orbitPhase = 'none';         // 'none' | 'transit' (Anflug) | 'orbit' (eingerastet)
let orbitAngle = 0;              // Winkel des Schiffs um den fokussierten Planeten
let orbitCooldown = 0;           // kurze Sperre nach dem Verlassen, damit Auto-Orbit nicht sofort wieder greift
const _orbTmp  = new THREE.Vector3();
const _orbTmp2 = new THREE.Vector3();
const _orbQuat = new THREE.Quaternion();

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
function bakeStarCubemap(size, palette) {
  const P = palette || {};
  const bgA = P.bgA || '#03040a', bgB = P.bgB || '#05050d';
  const nebCols = P.nebula || ['#241a4a', '#15324f', '#3a1f4a', '#102a40'];
  const nebAlpha = P.nebAlpha || 0.05;
  const faces = [];
  // optionaler globaler "Milchstraßen"-Pol, damit die Bänder über die Faces grob zusammenpassen
  for (let f = 0; f < 6; f++) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    // tiefes Weltraum-Schwarz mit minimalem Blaustich (oder Palette)
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, bgA);
    bg.addColorStop(1, bgB);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // ein paar sehr dezente Nebel-Schwaden für Tiefe (additiv, niedrige Deckkraft)
    ctx.globalCompositeOperation = 'lighter';
    const nNeb = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nNeb; i++) {
      const nx = Math.random() * size, ny = Math.random() * size;
      const nr = size * (0.18 + Math.random() * 0.28);
      const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
      const col = nebCols[(f + i) % nebCols.length];
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = nebAlpha + Math.random() * nebAlpha;
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
    const r = 14000 + Math.random() * 12000;
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
function spawnComet(opts = {}) {
  const SEG = 18;
  const start = opts.start ? opts.start.clone() : new THREE.Vector3(
    (Math.random() - 0.5) * 1400, 200 + Math.random() * 500, (Math.random() - 0.5) * 1400
  );
  const dir = (opts.dir ? opts.dir.clone() : new THREE.Vector3((Math.random() - 0.5), -0.4 - Math.random() * 0.5, (Math.random() - 0.5))).normalize();
  const speed = opts.speed || (420 + Math.random() * 320);
  const pos = new Float32Array(SEG * 3);
  for (let i = 0; i < SEG; i++) { pos[i * 3] = start.x; pos[i * 3 + 1] = start.y; pos[i * 3 + 2] = start.z; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: opts.color || 0xbfe0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.layers.set(LAYER_BG);
  scene.add(line);
  comets.push({ line, head: start.clone(), dir, speed, t: 0, life: opts.life || 2.2, seg: SEG });
}

/* ---- Ambient-Events: Meteorschauer & ferne Blitze (machen die Welt lebendig) ---- */
let ambientTimer = 18 + Math.random() * 20;
function spawnMeteorShower() {
  // gemeinsame Richtung + Ursprungsregion -> echtes "Schauer"-Gefühl
  const baseDir = new THREE.Vector3((Math.random() - 0.5), -0.5 - Math.random() * 0.4, (Math.random() - 0.5)).normalize();
  const origin = new THREE.Vector3((Math.random() - 0.5) * 900, 350 + Math.random() * 400, (Math.random() - 0.5) * 900);
  const n = 12 + Math.floor(Math.random() * 10);
  for (let i = 0; i < n; i++) {
    const jitter = new THREE.Vector3((Math.random() - 0.5) * 320, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 320);
    const dir = baseDir.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12));
    setTimeout(() => {
      if (running) spawnComet({ start: origin.clone().add(jitter), dir, speed: 520 + Math.random() * 360, life: 2.4, color: 0xcfe6ff });
    }, i * (40 + Math.random() * 80));
  }
}
let distantFlashes = [];
function spawnDistantFlash() {
  const r = 1500 + Math.random() * 1400;
  const th = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
  const p = new THREE.Vector3(r * Math.sin(phi) * Math.cos(th), (Math.random() - 0.5) * 900, r * Math.sin(phi) * Math.sin(th));
  const col = Math.random() > 0.5 ? 0xbcd9ff : 0xffd9a0;
  const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  mat.toneMapped = false;
  const m = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 16), mat);
  m.position.copy(p); m.layers.set(LAYER_BG);
  scene.add(m);
  distantFlashes.push({ mesh: m, t: 0, life: 1.6 + Math.random() * 0.8 });
}
function updateAmbient(dt) {
  if (!cardsRevealed || spaghetti || introActive) return;
  ambientTimer -= dt;
  if (ambientTimer <= 0) {
    if (Math.random() < 0.5) spawnMeteorShower(); else spawnDistantFlash();
    ambientTimer = 22 + Math.random() * 30;
  }
  for (let i = distantFlashes.length - 1; i >= 0; i--) {
    const f = distantFlashes[i];
    f.t += dt;
    const e = f.t / f.life;
    f.mesh.material.opacity = Math.sin(Math.min(e, 1) * Math.PI) * 0.9;
    f.mesh.scale.setScalar(1 + e * 6);
    if (e >= 1) { scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); distantFlashes.splice(i, 1); }
  }
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
    const r = 12000 + Math.random() * 12000;
    const th = Math.random() * Math.PI * 2;
    m.position.set(Math.cos(th) * r, (Math.random() - 0.5) * 6000, Math.sin(th) * r);
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
      type: 'rocky', orbitR: 1800, orbitY: 0, size: 100, speed: 0.034, inc: 0, tilt: 0.3,
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
        { name: 'Curriculum', size: 13, r: 130, speed: 0.26, color: '#ffcf99' },
      ],
    },
    {
      id: 'forge', name: 'Forge', kind: 'Vulkanwelt · aktive Oberfläche',
      type: 'lava', orbitR: 3500, orbitY: 0, size: 160, speed: 0.022, inc: 0, tilt: 0.5,
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
        { name: 'Werkbank', size: 17, r: 180, speed: 0.22, color: '#ff8c5a' },
        { name: 'Drucker', size: 12, r: 250, speed: 0.16, color: '#ffb38a' },
      ],
    },
    {
      id: 'aether', name: 'Aether', kind: 'Gasriese · mit Ringsystem',
      type: 'gas', orbitR: 6000, orbitY: 0, size: 280, speed: 0.015, inc: 0, tilt: 0.42,
      colA: '#2a1a5e', colB: '#7a4bd0', colC: '#c9a8ff', glow: '#a67cff', glowAmt: 0.0,
      ring: { inner: 180, outer: 360, color: '#b79cff', tilt: 0.42 },
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
        { name: 'AstroClub', size: 21, r: 420, speed: 0.15, color: '#c4a8ff' },
        { name: 'Daten', size: 16, r: 530, speed: 0.11, color: '#9a78e0' },
      ],
    },
    {
      id: 'nexus', name: 'Nexus', kind: 'Eiswelt · Polarlichter',
      type: 'ice', orbitR: 8500, orbitY: 0, size: 140, speed: 0.011, inc: 0.30, tilt: 0.6,
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
        { name: 'GitHub', size: 15, r: 160, speed: 0.27, color: '#e8e8ff', link: 'https://github.com/ProfessorQuantumUniverse' },
        { name: 'F-Droid', size: 14, r: 224, speed: 0.2, color: '#9ad6a0', link: 'https://f-droid.org/packages/com.olaf.rereminder/' },
        { name: 'Mail', size: 13, r: 290, speed: 0.15, color: '#aee6ff', link: 'mailto:lorenzobaymueller@gmail.com' },
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
  const orbitLine = buildOrbitLine(p);         // dezente Bahnlinie auf der Ekliptik

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
    data: p, group, body, mesh, mat, moons, orbitLine,
    angle: startAngle, orbitR: p.orbitR, orbitY: p.orbitY,
    speed: p.speed, inc: p.inc, worldPos: new THREE.Vector3(),
  };
  planets.push(rec);
  return rec;
}

/* ---- Tech-Asteroidengürtel: Partikelwolke + einzelne anklickbare Brocken ---- */
const BELT_R0 = 4400, BELT_R1 = 5200;   // Gürtel zwischen Forge (3500) und Aether (6000)
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
    const r = 600 + Math.sqrt(Math.random()) * 8400;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 120;   // dünne Scheibe
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

/* ================================================================
   WURMLOCH (Einstein-Ring + Vortex-Portal) — Tor zum Karten-Tunnel
   ================================================================ */
const WORMHOLE_ENTER = 24;          // Distanz, ab der das Schiff "eingesogen" wird
function makeVortexMaterial(tint) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Color(tint) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uTint; varying vec2 vUv;
      void main(){
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;                 // 0 = Mitte, 1 = Rand
        if (r > 1.0) discard;
        float ang = atan(p.y, p.x);
        // nach innen rotierende Spiralarme
        float swirl = sin(ang * 3.0 + r * 16.0 - uTime * 4.0);
        float arms = 0.5 + 0.5 * swirl;
        float core = pow(1.0 - r, 1.6);            // heller Kern, klingt zum Rand ab
        vec3 col = mix(uTint, vec3(1.0), core * 0.85);
        float a = (0.32 * arms + 0.68 * core) * smoothstep(1.0, 0.5, r);
        gl_FragColor = vec4(col * (0.6 + core), a);
      }`,
  });
}
// Portal-Gruppe: Torus (Einstein-Ring) + Vortex-Scheibe + spiralende Partikel
function buildPortalGroup(ringR, tint) {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  ringMat.toneMapped = false;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, ringR * 0.07, 20, 90), ringMat);
  g.add(ring);

  const vortexMat = makeVortexMaterial(tint);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(ringR * 0.97, 72), vortexMat);
  g.add(disc);

  // spiralende Partikel im Schlund
  const N = 150;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c0 = new THREE.Color(tint), c1 = new THREE.Color('#ffffff'), tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const rr = ringR * (0.1 + Math.random() * 0.9);
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = Math.sin(a) * rr; pos[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
    tmp.copy(c0).lerp(c1, 1 - rr / ringR).multiplyScalar(0.6 + Math.random() * 0.6);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pgeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const particles = new THREE.Points(pgeo, new THREE.PointsMaterial({
    size: ringR * 0.16, map: spriteTex, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.9,
  }));
  particles.material.toneMapped = false;
  g.add(particles);

  g.userData = { vortexMat, ring, particles, hitMesh: disc };
  return g;
}
function buildWormhole() {
  wormhole = buildPortalGroup(12, '#b07cff');
  scene.add(wormhole);
  portalMat = wormhole.userData.vortexMat;

  // Rückkehr-Portal am Ende des Karten-Tunnels (cyan), zunächst verborgen
  exitPortal = buildPortalGroup(15, '#70e0ff');
  exitPortal.position.copy(TUNNEL_ORIGIN).add(new THREE.Vector3(0, 0, TUNNEL_LENGTH + 64));
  exitPortal.visible = false;
  scene.add(exitPortal);
  exitPortalMat = exitPortal.userData.vortexMat;

  // weiches Licht im Tunnel (erst im Karten-Realm an)
  tunnelLight = new THREE.PointLight(0xcdb6ff, 0, 600, 1.4);
  tunnelLight.position.copy(TUNNEL_ORIGIN).add(new THREE.Vector3(0, 0, TUNNEL_LENGTH * 0.5));
  scene.add(tunnelLight);
}
// Umlauf + Animation + Eintritts-/Austritts-Erkennung
function updateWormhole(dt) {
  if (!wormhole) return;
  const idle = !camFlying && !introActive && !focused && !focusedPlanet && !spaghetti;
  if (realm === 'main') {
    wormholeAngle += dt * 0.05;
    wormhole.position.set(Math.cos(wormholeAngle) * WORMHOLE_ORBIT_R, 8, Math.sin(wormholeAngle) * WORMHOLE_ORBIT_R);
    wormhole.getWorldPosition(wormholeWorldPos);
    wormhole.quaternion.copy(camera.quaternion);                 // Portal blickt zur Kamera
    portalMat.uniforms.uTime.value = elapsed;
    wormhole.userData.particles.rotation.z += dt * 0.6;
    wormhole.userData.ring.rotation.z += dt * 0.25;
    if (idle && shipLoaded && shipState.pos.distanceTo(wormholeWorldPos) < WORMHOLE_ENTER) enterCardRealm();
  } else if (exitPortal) {
    exitPortal.quaternion.copy(camera.quaternion);
    exitPortalMat.uniforms.uTime.value = elapsed;
    exitPortal.userData.particles.rotation.z += dt * 0.6;
    exitPortal.userData.ring.rotation.z += dt * 0.25;
    if (idle && shipLoaded && shipState.pos.distanceTo(exitPortal.position) < WORMHOLE_ENTER) exitCardRealm();
  }
}

/* ---- Schiff an eine Position setzen, mit Blick auf einen Zielpunkt (inkl. Chase-Cam) ---- */
function orientShipAt(pos, lookAtPoint) {
  shipState.pos.copy(pos);
  shipState.vel.set(0, 0, 0);
  _shipMat.lookAt(shipState.pos, lookAtPoint, _shipUp.set(0, 1, 0));
  shipState.quat.setFromRotationMatrix(_shipMat);
  _shipEuler.setFromQuaternion(shipState.quat, 'YXZ');
  fly.yaw = _shipEuler.y; fly.pitch = THREE.MathUtils.clamp(_shipEuler.x, -1.2, 1.2);
  if (shipPivot) { shipPivot.position.copy(shipState.pos); shipPivot.quaternion.copy(shipState.quat); }
  chaseCamPosition(_camDesired); camera.position.copy(_camDesired);
  _shipFwd.set(0, 0, -1).applyQuaternion(shipState.quat);
  camera.lookAt(_lookTarget.copy(shipState.pos).addScaledVector(_shipFwd, 24));
}

/* ================================================================
   REALM-WECHSEL  (Wurmloch <-> Karten-Tunnel, vom Warp verdeckt)
   ================================================================ */
function applyTunnelState() {
  savedMainBg = scene.background;
  if (!tunnelSkybox) tunnelSkybox = bakeStarCubemap(1024, {
    bgA: '#0a0414', bgB: '#140826', nebula: ['#4a1a6a', '#6a1f8a', '#2a1a5e', '#7a2f9a'], nebAlpha: 0.08,
  });
  scene.background = tunnelSkybox;
  // Tiefen-Nebel: ferne (noch nicht enthüllte) Bereiche versinken im Dunkel -> Karten tauchen
  // dramatisch daraus auf. Dezent genug, dass nahe Karten (< ~110u) unberührt bleiben.
  savedMainFog = scene.fog;
  scene.fog = new THREE.FogExp2(0x0a0414, 0.0013);
  // Schiff an den Tunneleingang, Blick die Achse entlang (+Z)
  orientShipAt(TUNNEL_ORIGIN.clone().add(new THREE.Vector3(0, 0, -10)),
               TUNNEL_ORIGIN.clone().add(new THREE.Vector3(0, 0, 200)));
  // Karten starten verborgen – das Proximity-Reveal in animate() blendet sie je nach Schiffsposition ein.
  cards.forEach(c => { c.mesh.visible = false; c.revealT = 0; c.mesh.material.opacity = 0; c.mesh.scale.setScalar(c.baseScale * 0.82); });
  cardsRevealed = true;
  if (tunnelLight) tunnelLight.intensity = 1.6;
  if (tunnelShell) tunnelShell.visible = true;
  if (tunnelGuide) tunnelGuide.visible = true;
  if (exitPortal) exitPortal.visible = true;
  if (wormhole) wormhole.visible = false;
  if (starmapInfo) starmapInfo.textContent = 'Karten-Tunnel · zum Ausgangsportal fliegen';
}
function applyMainState() {
  if (savedMainBg) scene.background = savedMainBg;
  if (savedMainFog) scene.fog = savedMainFog;          // Haupt-Nebel wiederherstellen

  wormhole.getWorldPosition(wormholeWorldPos);
  // Schiff knapp außerhalb des Wurmlochs absetzen (Richtung vom Zentrum weg), Blick zum Zentrum
  const outward = _tmpVec.copy(wormholeWorldPos).setY(0);
  if (outward.lengthSq() < 1e-4) outward.set(1, 0, 0);
  outward.normalize();
  const spawn = wormholeWorldPos.clone().addScaledVector(outward, 55); spawn.y = 22;
  orientShipAt(spawn, center);
  cards.forEach(c => { c.mesh.visible = false; });
  if (tunnelLight) tunnelLight.intensity = 0;
  if (tunnelShell) tunnelShell.visible = false;
  if (tunnelGuide) tunnelGuide.visible = false;
  if (exitPortal) exitPortal.visible = false;
  if (wormhole) wormhole.visible = true;
}
function enterCardRealm() {
  if (realm === 'cards' || busy || introActive) return;
  realm = 'cards';
  if (focused) { focused = null; hideDetail(); }
  if (focusedPlanet) { focusedPlanet = null; hideDetail(); }
  camFlying = true; fly.keys.clear();
  if (reduceMotion) { applyTunnelState(); camFlying = false; return; }
  runWarp(false).then(() => { fadeOutWarp(); camFlying = false; });
  setTimeout(applyTunnelState, 520);            // bei maximaler Warp-Abdeckung umschalten
}
function exitCardRealm() {
  if (realm === 'main' || busy || introActive) return;
  realm = 'main';
  if (focused) { focused = null; hideDetail(); }
  if (focusedPlanet) { focusedPlanet = null; hideDetail(); }
  camFlying = true; fly.keys.clear();
  if (reduceMotion) { applyMainState(); camFlying = false; return; }
  runWarp(true).then(() => { fadeOutWarp(); camFlying = false; });
  setTimeout(applyMainState, 520);
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
  buildWormhole();      // Tor zum Karten-Tunnel (orbitiert das Schwarze Loch)
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
  const targetCalm = 1 - THREE.MathUtils.smoothstep(nearest, 600, 2800);
  worldCalm += (targetCalm - worldCalm) * Math.min(1, dt * 3.5);
  const motion = 1 - worldCalm;   // globaler Bewegungs-Faktor

  // Planeten: Umlaufbahn (leicht geneigt) + Eigenrotation + Monde + Shader-Zeit
  for (const pl of planets) {
    // Der fokussierte Planet kreist weiter (das Schiff folgt seiner Bahn), die anderen frieren bei Nähe ein
    const m = (focusedPlanet === pl) ? Math.max(motion, 0.45) : motion;
    pl.angle += dt * pl.speed * m;
    const x = Math.cos(pl.angle) * pl.orbitR;
    const z = Math.sin(pl.angle) * pl.orbitR;
    pl.group.position.set(x, pl.orbitY, z).applyAxisAngle(_orbitAxis.set(0, 0, 1), pl.inc);
    pl.group.getWorldPosition(pl.worldPos);
    // gezeitengebundene Origin dreht sich nicht (eine Seite bleibt zum Zentrum); Eigenrotation läuft (sanft) weiter
    if (pl.data.type !== 'rocky') pl.body.rotation.y += dt * 0.05 * (0.3 + 0.7 * m);
    pl.mat.uniforms.uTime.value = elapsed;

    for (const mo of pl.moons) {
      mo.angle += dt * mo.speed * m;
      const mx = Math.cos(mo.angle) * mo.r;
      const mz = Math.sin(mo.angle) * mo.r;
      mo.mesh.position.set(mx, Math.sin(mo.angle) * mo.r * Math.sin(mo.inc), mz);
      mo.mesh.rotation.y += dt * 0.3 * m;
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

  const h = CARD_H, w = h * (CW / CH);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true });
  mat.toneMapped = true;   // ACES dämpft die hellen Pixel -> Text brennt nicht mehr im Bloom aus (lesbar)
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

  // Karten-Tunnel: Karten sitzen gleichmäßig rund um die Flugachse auf festem Radius – jedoch NICHT
  // unten (dort verdeckt das Schiff sie). Der Winkel läuft als 1D-Low-Discrepancy-Folge (goldener
  // Schnitt) über den erlaubten oberen/seitlichen Bogen -> maximal gleichmäßig, kein Klumpen, kein
  // Spiralband. Jede Karte neigt sich nach innen/voraus und bleibt aufrecht (Y im faceTarget).
  const N = projects.length || 1;
  const PHI = 0.6180339887498949;                        // goldener Schnitt -> gleichmäßige 1D-Folge
  const gap = THREE.MathUtils.degToRad(CARD_BOTTOM_GAP); // gesperrter Bogen unten
  const arc = Math.PI * 2 - gap;                         // erlaubter Bogen (oben + seitlich)
  const startAng = -Math.PI / 2 + gap / 2;              // am Rand des unteren Gaps beginnen
  projects.forEach((p, i) => {
    const mesh = makeCardMesh(p);
    const t = N > 1 ? i / (N - 1) : 0.5;                 // 0..1 entlang des Tunnels (gleichmäßiger Z-Abstand)
    const z = TUNNEL_ORIGIN.z + 40 + t * TUNNEL_LENGTH;
    const ang = startAng + ((i * PHI) % 1) * arc;        // gleichmäßig über den erlaubten Bogen, nie unten
    const x = TUNNEL_ORIGIN.x + Math.cos(ang) * RING_R;
    const y = TUNNEL_ORIGIN.y + Math.sin(ang) * RING_R;
    const base = new THREE.Vector3(x, y, z);
    // Zielpunkt: auf der Achse, gleiche Höhe, ein Stück Richtung Eingang (-Z) -> Karte zeigt
    // schräg nach innen und der anfliegenden Kamera entgegen, bleibt aber aufrecht (lesbar).
    const faceTarget = new THREE.Vector3(TUNNEL_ORIGIN.x, y, z - CARD_FACE_AHEAD);
    const card = { mesh, base, faceTarget, baseScale: 1, revealT: 0 };
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
  cardGlow = new THREE.Mesh(new THREE.PlaneGeometry(CARD_H * 1.45, CARD_H * 1.75), gMat);
  cardGlow.visible = false;
  scene.add(cardGlow);

  buildTunnelShell();
  buildTunnelGuide();
}

// Leucht-Gerüst, das den Tunnel klar als solchen zeigt: Querringe (Rippen) + Längsschienen,
// die in die Tiefe laufen und im Nebel verschwinden -> echte Tunnel-Perspektive, dennoch dezent.
function buildTunnelShell() {
  const group = new THREE.Group();
  const R = RING_R + 14;                                 // etwas weiter außen als die Karten
  const z0 = TUNNEL_ORIGIN.z + 20, zLen = TUNNEL_LENGTH + 60;
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color('#7a52d6'), transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  mat.toneMapped = false;

  // (1) Querringe = Tunnel-Rippen
  const segs = 72, ringPts = [];
  for (let s = 0; s <= segs; s++) {
    const a = s / segs * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
  }
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const NR = 48;                                         // dichtere Rippung über den langen Tunnel
  for (let i = 0; i < NR; i++) {
    const ring = new THREE.LineLoop(ringGeo, mat);
    ring.position.set(TUNNEL_ORIGIN.x, TUNNEL_ORIGIN.y, z0 + i / (NR - 1) * zLen);
    group.add(ring);
  }

  // (2) Längsschienen = laufen die ganze Länge -> Perspektive, die in die Tiefe zieht
  const NL = 6;
  for (let j = 0; j < NL; j++) {
    const a = j / NL * Math.PI * 2;
    const lx = TUNNEL_ORIGIN.x + Math.cos(a) * R, ly = TUNNEL_ORIGIN.y + Math.sin(a) * R;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(lx, ly, z0), new THREE.Vector3(lx, ly, z0 + zLen),
    ]);
    group.add(new THREE.Line(lineGeo, mat));
  }

  group.visible = false;
  scene.add(group);
  tunnelShell = group;
}

// Fließende Leit-Ringe entlang der Achse: zeigen dem Schiff sanft den Weg zum Ausgangsportal.
// Cyan wie das Portal -> "folge dem Licht". Werden in animate() nach vorne bewegt.
function buildTunnelGuide() {
  const group = new THREE.Group();
  const segs = 64, R = RING_R * 0.42;                   // schmaler Leit-Ring nahe der Flugachse
  const pts = [];
  for (let s = 0; s <= segs; s++) {
    const a = s / segs * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const NG = 7;                                          // Anzahl fließender Leit-Ringe
  for (let i = 0; i < NG; i++) {
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#70e0ff'), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    mat.toneMapped = false;
    const ring = new THREE.LineLoop(geo, mat);
    ring.userData.phase = i / NG;                        // gleichmäßig über die Tunnellänge verteilt
    group.add(ring);
  }
  group.visible = false;
  scene.add(group);
  tunnelGuide = group;
}

// Bewegt die Leit-Ringe stetig Richtung Ausgang und blendet sie an Enden weich aus.
function updateTunnelGuide(time) {
  if (!tunnelGuide || !tunnelGuide.visible) return;
  const z0 = TUNNEL_ORIGIN.z + 20, len = TUNNEL_LENGTH + 60, speed = 0.06;
  for (const ring of tunnelGuide.children) {
    const f = (time * speed + ring.userData.phase) % 1;  // 0..1 entlang des Tunnels
    ring.position.set(TUNNEL_ORIGIN.x, TUNNEL_ORIGIN.y, z0 + f * len);
    ring.material.opacity = Math.sin(f * Math.PI) * 0.45; // sanft auf-/abblenden, Maximum in der Mitte
    const s = 1 + f * 0.6;                                // leicht aufweiten Richtung Ausgang -> Tiefe
    ring.scale.set(s, s, 1);
  }
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
  scene.fog = new THREE.FogExp2(0x05060f, 0.000025);

  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 60000);
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
  if (shipLoaded && viewMode === 'inside') return;   // Schiff + Chase-Cam steuern die Kamera
  camera.rotation.set(fly.pitch, fly.yaw, 0, 'YXZ');
}
// Pfeiltasten: ←/→ drehen (wie A/D), ↑/↓ neigen die Nase (Pitch)
const ARROW_MAP = { arrowup: 'pitchup', arrowdown: 'pitchdown', arrowleft: 'a', arrowright: 'd' };
function onKeyDown(e) {
  if (!overlay.classList.contains('is-open')) return;
  if (introActive && e.key !== 'Escape') { skipIntro(); return; }
  lastInput = performance.now();
  const k = ARROW_MAP[e.key.toLowerCase()] || e.key.toLowerCase();
  if (['w', 'a', 's', 'd', ' ', 'pitchup', 'pitchdown'].includes(k) || k === 'shift') {
    if (!focused && !focusedPlanet && !spaghetti) { fly.keys.add(k); dismissHelpSoon(); e.preventDefault(); } // WASD/Pfeile in beiden Modi
  }
  // E / Enter: eingerastetes Lock-On-Ziel aktivieren (Inside-Modus)
  if ((k === 'e' || e.key === 'Enter') && viewMode === 'inside' && !focused && !focusedPlanet && !spaghetti &&
      lockTarget && lockT >= LOCK_TIME) {
    activateLockTarget(); e.preventDefault();
  }
  if (k === 'm' && !focused && !spaghetti) { toggleStarmap(); e.preventDefault(); }
  if (e.key === 'Escape') {
    if (starmapOpen) toggleStarmap(false);
    else if (spaghetti) resetSpaghetti();
    else if (focusedPlanet) unfocusPlanet();
    else if (focused) unfocusCard();
    else exitToClassic(false);
  }
}
function onKeyUp(e) { const k = e.key.toLowerCase(); fly.keys.delete(ARROW_MAP[k] || k); }

// Hilfe-Hinweis nach der ersten aktiven Bewegung weich ausblenden
function dismissHelpSoon() {
  if (helpDismissed) return;
  helpDismissed = true;
  setTimeout(() => { if (helpEl) helpEl.classList.add('is-hidden'); }, 1000);
}

// Raumschiff-Physik: Beschleunigung + Trägheit/Drift
// Shift = Boost (3x), Space = aufsteigen. Kein Absinken mehr (Pitch regelt die Höhe).
const FLY_ACCEL = 800, FLY_DAMP = 0.95, FLY_MAX = 600, BOOST_MUL = 3;
const FLY_ACCEL_TUNNEL = 190, FLY_MAX_TUNNEL = 125;   // im Karten-Tunnel deutlich langsamer (Ruhe & Lesezeit)
function applyMovement(dt) {
  if (shipLoaded && viewMode === 'inside') return;   // im Inside-Modus übernimmt das Schiff
  const fwd = _shipFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = _shipRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = _shipUp.set(0, 1, 0);
  const boost = fly.keys.has('shift');
  const accel = FLY_ACCEL * (boost ? BOOST_MUL : 1);
  const maxV = FLY_MAX * (boost ? BOOST_MUL : 1);
  const acc = _camDesired.set(0, 0, 0);
  if (fly.keys.has('w')) acc.add(fwd);
  if (fly.keys.has('s')) acc.addScaledVector(fwd, -1);
  if (fly.keys.has('d')) acc.add(right);
  if (fly.keys.has('a')) acc.addScaledVector(right, -1);
  if (fly.keys.has(' ')) acc.add(up);
  if (acc.lengthSq() > 0) fly.vel.addScaledVector(acc.normalize(), accel * dt);
  fly.vel.multiplyScalar(Math.pow(FLY_DAMP, dt * 60));
  if (fly.vel.length() > maxV) fly.vel.setLength(maxV);
  if (fly.vel.lengthSq() < 1e-5) { fly.vel.set(0, 0, 0); return; }
  const delta = _lookTarget.copy(fly.vel).multiplyScalar(dt);
  camera.position.add(delta);
  if (viewMode === 'outside') controls.target.add(delta); // mitführen, damit Orbit erhalten bleibt
}

// Chase-Cam-Zielposition (hinter+über dem Schiff) in out schreiben
function chaseCamPosition(out) {
  return out.copy(CHASE_OFFSET).applyQuaternion(shipState.quat).add(shipState.pos);
}

// Raumschiff-Flug (Inside): Maus-Yaw/Pitch = Heading, WASD = Schub, Shift = Boost
function updateShip(dt) {
  if (orbitCooldown > 0) orbitCooldown -= dt;          // Auto-Orbit-Sperre nach dem Verlassen abklingen lassen
  // Tastatur-Gieren: A/D (bzw. Pfeil links/rechts) drehen das Schiff, statt seitwärts
  // zu schieben. Speist direkt in fly.yaw (gleiche Achse wie die Maus).
  let keyYaw = 0;                                       // -1 = links (A), +1 = rechts (D) — fürs Banking
  if (fly.keys.has('a')) { fly.yaw += KEY_YAW_RATE * dt; keyYaw = -1; }
  if (fly.keys.has('d')) { fly.yaw -= KEY_YAW_RATE * dt; keyYaw = 1; }

  // Tastatur-Nicken: Pfeil hoch/runter neigen die Nase (vertikale Entsprechung zu A/D)
  if (fly.keys.has('pitchup'))   fly.pitch += KEY_PITCH_RATE * dt;   // Nase hoch
  if (fly.keys.has('pitchdown')) fly.pitch -= KEY_PITCH_RATE * dt;   // Nase runter

  // Ziel-Orientierung aus Eingabe; weiches Eindrehen
  fly.pitch = Math.max(-1.2, Math.min(1.2, fly.pitch));
  _shipEuler.set(fly.pitch, fly.yaw, 0, 'YXZ');
  _shipTargetQuat.setFromEuler(_shipEuler);
  shipState.quat.slerp(_shipTargetQuat, 1 - Math.exp(-9 * dt));

  _shipFwd.set(0, 0, -1).applyQuaternion(shipState.quat);
  _shipUp.set(0, 1, 0);

  const boost = fly.keys.has('shift');
  shipState.boost = boost;
  const slow = (realm === 'cards');                    // im Karten-Tunnel langsamer fliegen
  const accel = (slow ? FLY_ACCEL_TUNNEL : FLY_ACCEL) * (boost ? BOOST_MUL : 1);
  const maxV = (slow ? FLY_MAX_TUNNEL : FLY_MAX) * (boost ? BOOST_MUL : 1);

  // Schub nur entlang der Nase (W/S) + Steigen (Leertaste) — kein Seitwärtsgang mehr
  const acc = _camDesired.set(0, 0, 0);
  if (fly.keys.has('w')) acc.add(_shipFwd);
  if (fly.keys.has('s')) acc.addScaledVector(_shipFwd, -1);
  if (fly.keys.has(' ')) acc.add(_shipUp);
  if (acc.lengthSq() > 0) shipState.vel.addScaledVector(acc.normalize(), accel * dt);
  shipState.vel.multiplyScalar(Math.pow(FLY_DAMP, dt * 60));
  if (shipState.vel.length() > maxV) shipState.vel.setLength(maxV);
  if (shipState.vel.lengthSq() < 1e-6) shipState.vel.set(0, 0, 0);
  shipState.pos.addScaledVector(shipState.vel, dt);

  // Banking: Roll aus Tastatur-Gieren + Maus-Gier-Geschwindigkeit
  const targetRoll = -keyYaw * 0.4 - fly.yawVel * 7;
  shipState.rollAngle += (targetRoll - shipState.rollAngle) * Math.min(1, dt * 5);

  // Triebwerksglühen aus Geschwindigkeit (Boost zählt voll)
  shipState.engineGlow = Math.min(1, shipState.vel.length() / FLY_MAX);

  // auf Pivot/Modell anwenden
  if (shipPivot) {
    shipPivot.position.copy(shipState.pos);
    shipPivot.quaternion.copy(shipState.quat);
    if (bankGroup) bankGroup.rotation.z = shipState.rollAngle;
  }

  // Auto-Orbit: fliegt man aktiv ganz nah an einen Planeten, klinkt sich das Schiff selbst in dessen Orbit ein
  // (nur bei echter Fahrt -> nach ESC im Stillstand rastet es nicht sofort wieder ein)
  if (realm === 'main' && orbitCooldown <= 0 && !focused && !focusedPlanet && shipState.vel.length() > 30) {
    for (const pl of planets) {
      if (shipState.pos.distanceTo(pl.worldPos) < pl.data.size * AUTO_ORBIT_K) { focusPlanet(pl); break; }
    }
  }
}

// Verfolgerkamera: federt hinter das Schiff, blickt leicht voraus
function updateChaseCamera(dt) {
  chaseCamPosition(_camDesired);
  const a = 1 - Math.exp(-CHASE_STIFFNESS * dt);
  camera.position.lerp(_camDesired, a);
  _shipFwd.set(0, 0, -1).applyQuaternion(shipState.quat);
  _lookTarget.copy(shipState.pos).addScaledVector(_shipFwd, 24);
  camera.lookAt(_lookTarget);
}

function updateFly(dt) {
  // Maus-Momentum (Trägheit nach dem Loslassen) — Eingabe für Schiff oder Kamera
  if (!isDown) {
    fly.yaw += fly.yawVel; fly.pitch += fly.pitchVel;
    fly.yawVel *= 0.9; fly.pitchVel *= 0.9;
  }
  fly.pitch = Math.max(-1.35, Math.min(1.35, fly.pitch));

  // Schiffsmodus: hält Heading stabil (kein Auto-Drift — sonst dreht das Schiff weg)
  if (shipLoaded && viewMode === 'inside') {
    updateShip(dt);
    updateChaseCamera(dt);
    return;
  }
  // Ohne Schiff: nach Inaktivität sanftes kinoreifes Weiterdriften der Kamera
  if (performance.now() - lastInput > 7000 && fly.keys.size === 0 && !isDown && fly.vel.lengthSq() < 1) {
    fly.yaw += dt * 0.05;
    fly.pitch += Math.sin(elapsed * 0.25) * dt * 0.02;
  }
  applyFlyRotation();
  applyMovement(dt);
}

/* ================================================================
   RAUMSCHIFF: Laden, Triebwerksspur, Synchronisation
   ================================================================ */
function loadShip() {
  const loader = new GLTFLoader();
  loader.load('3D-Model/interstellar_ranger.glb', (gltf) => {
    ship = gltf.scene;
    ship.traverse((o) => {
      if (o.isMesh) {
        o.layers.set(LAYER_BG);
        o.frustumCulled = false;        // immer sichtbar (klein, nah an der Kamera)
        if (o.material) o.material.toneMapped = true;
      }
    });
    // Geometrie zentrieren (Pivot = Schwerpunkt) + auf Zielgröße skalieren
    const box = new THREE.Box3().setFromObject(ship);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    ship.position.set(-c.x, -c.y, -c.z);             // nur Translation am rohen Modell
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    shipOrient = new THREE.Group();
    shipOrient.add(ship);
    shipOrient.scale.setScalar(SHIP_LENGTH / maxDim);
    shipOrient.rotation.y = SHIP_MODEL_YAW;

    bankGroup = new THREE.Group();
    bankGroup.add(shipOrient);

    shipPivot = new THREE.Group();
    shipPivot.add(bankGroup);
    shipPivot.position.copy(shipState.pos);
    shipPivot.visible = false;                       // erst im Inside-Modus zeigen
    scene.add(shipPivot);

    buildEngineTrail();
    buildEngineGlow();

    // Falls der Nutzer beim Laden bereits im Inside-Modus ist: sanft andocken
    if (viewMode === 'inside') syncShipFromCamera();
    shipLoaded = true;
  }, undefined, (err) => { console.warn('[universe] Raumschiff-Modell konnte nicht geladen werden:', err); });
}

// Schiff vor die Kamera setzen, sodass die Chase-Cam ungefähr an Ort bleibt (kein Sprung)
function syncShipFromCamera() {
  shipState.quat.copy(camera.quaternion);
  _camDesired.copy(CHASE_OFFSET).applyQuaternion(shipState.quat);
  shipState.pos.copy(camera.position).sub(_camDesired);
  shipState.vel.set(0, 0, 0);
  _shipEuler.setFromQuaternion(shipState.quat, 'YXZ');
  fly.yaw = _shipEuler.y; fly.pitch = THREE.MathUtils.clamp(_shipEuler.x, -1.2, 1.2);
  if (shipPivot) { shipPivot.position.copy(shipState.pos); shipPivot.quaternion.copy(shipState.quat); }
}

// Schiff an INSIDE_HOME parken, Blick zum Zentrum; fly.yaw/pitch daraus ableiten
function placeShipHome() {
  shipState.pos.copy(INSIDE_HOME);
  shipState.vel.set(0, 0, 0);
  _shipMat.lookAt(shipState.pos, center, _shipUp.set(0, 1, 0));
  shipState.quat.setFromRotationMatrix(_shipMat);
  _shipEuler.setFromQuaternion(shipState.quat, 'YXZ');
  fly.yaw = _shipEuler.y; fly.pitch = THREE.MathUtils.clamp(_shipEuler.x, -1.2, 1.2);
  if (shipPivot) { shipPivot.position.copy(shipState.pos); shipPivot.quaternion.copy(shipState.quat); }
}

/* ---- Triebwerksspur: Ringpuffer aus Partikeln hinter dem Schiff ---- */
const TRAIL_N = 90;
let trailHead = 0;
const _trailPos = new THREE.Vector3();
function buildEngineTrail() {
  const pos = new Float32Array(TRAIL_N * 3);
  const col = new Float32Array(TRAIL_N * 3);
  for (let i = 0; i < TRAIL_N; i++) {
    pos[i * 3] = shipState.pos.x; pos[i * 3 + 1] = shipState.pos.y; pos[i * 3 + 2] = shipState.pos.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  engineTrail = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 2.6, map: spriteTex, vertexColors: true, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  engineTrail.material.toneMapped = false;
  engineTrail.layers.set(LAYER_BG);
  engineTrail.frustumCulled = false;
  scene.add(engineTrail);
}
const _trailHot = new THREE.Color('#ffd6a0');
const _trailCold = new THREE.Color('#70d6ff');
const _trailTmp = new THREE.Color();
function updateEngineTrail(dt) {
  if (!engineTrail || !shipLoaded) return;
  const visible = viewMode === 'inside' && !focused && !introActive;
  engineTrail.visible = visible;
  if (!visible) return;
  const arr = engineTrail.geometry.attributes.position.array;
  const carr = engineTrail.geometry.attributes.color.array;
  // neues Partikel am Heck setzen
  _shipFwd.set(0, 0, -1).applyQuaternion(shipState.quat);
  _trailPos.copy(shipState.pos).addScaledVector(_shipFwd, -SHIP_LENGTH * 0.45);
  _trailPos.x += (Math.random() - 0.5) * 0.8;
  _trailPos.y += (Math.random() - 0.5) * 0.8;
  _trailPos.z += (Math.random() - 0.5) * 0.8;
  trailHead = (trailHead + 1) % TRAIL_N;
  arr[trailHead * 3] = _trailPos.x; arr[trailHead * 3 + 1] = _trailPos.y; arr[trailHead * 3 + 2] = _trailPos.z;
  // Farbe nach Glühen (heiß bei Boost)
  const glow = shipState.boost ? 1 : shipState.engineGlow;
  _trailTmp.copy(_trailCold).lerp(_trailHot, glow);
  carr[trailHead * 3] = _trailTmp.r; carr[trailHead * 3 + 1] = _trailTmp.g; carr[trailHead * 3 + 2] = _trailTmp.b;
  // ältere Partikel ausdimmen (jedes Partikel verglüht über die Zeit)
  for (let i = 0; i < carr.length; i++) carr[i] *= 0.93;
  engineTrail.geometry.attributes.position.needsUpdate = true;
  engineTrail.geometry.attributes.color.needsUpdate = true;
  engineTrail.material.opacity = 0.25 + 0.65 * glow;
}

/* ---- Triebwerks-Licht am Heck (Bloom-Akzent) ---- */
function buildEngineGlow() {
  engineLight = new THREE.PointLight(0xff8a2a, 0, 60, 2);
  engineLight.layers.set(LAYER_BG);
  shipPivot.add(engineLight);
  engineLight.position.set(0, 0, SHIP_LENGTH * 0.5);   // Heck (lokal +Z, da Vorwärts -Z)
}

/* ---- Interaktion (Hover / Klick) ---- */
function setPointer(ev) {
  const r = glCanvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
}
function intersectCards() {
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(cards.filter(c => c.mesh.visible).map(c => c.mesh), false);
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
  if (moved > 6 || dragging) return; // Drag (Umsehen) -> kein Klick
  if (spaghetti || camFlying) return;

  setPointer(ev);
  raycaster.setFromCamera(pointer, camera);

  if (realm === 'cards') {
    // Karten-Tunnel: Karten anklicken, Ausgangsportal anklicken
    const cardHits = intersectCards();
    const cardDist = cardHits.length ? cardHits[0].distance : Infinity;
    let exitDist = Infinity;
    if (exitPortal && exitPortal.visible) { const e = raycaster.intersectObject(exitPortal.userData.hitMesh, false)[0]; if (e) exitDist = e.distance; }
    if (cardHits.length && cardDist < exitDist) { focusCard(cardHits[0].object.userData.card); return; }
    if (exitDist < Infinity) { exitCardRealm(); return; }
    if (focused) unfocusCard();
    return;
  }

  // Hauptuniversum: Schwarzes Loch / Wurmloch / Planeten / Tech
  const bh = raycaster.intersectObject(horizon, false);
  const bhDist = bh.length ? bh[0].distance : Infinity;
  const world = pickWorld();
  const worldDist = world ? world.distance : Infinity;
  let whDist = Infinity;
  if (wormhole && wormhole.visible) { const w = raycaster.intersectObject(wormhole.userData.hitMesh, false)[0]; if (w) whDist = w.distance; }
  if (bhDist < worldDist && bhDist < whDist) { exitToClassic(true); return; }
  if (whDist < worldDist) { enterCardRealm(); return; }
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
  // Kamera vor die (nach innen blickende) Karte rücken: ein Stück Richtung Tunnelachse,
  // leicht erhöht -> Karte bildfüllend. Die Karte dreht sich aktiv zur Kamera (lesbar).
  const base = card.base;
  const inward = (card.faceTarget || center).clone().sub(base).normalize();
  const camPos = base.clone().addScaledVector(inward, CARD_H * 1.7).add(new THREE.Vector3(0, 2.5, 0));
  flyCameraTo(camPos, base, 1.25, 'power3.inOut');
}
// Zurück zur Verfolgerkamera hinter dem (geparkten) Schiff — nahtlos, da das Schiff nicht bewegt wurde
function returnToShipView(duration = 1.25) {
  _shipFwd.set(0, 0, -1).applyQuaternion(shipState.quat);
  const chasePos = chaseCamPosition(_camDesired.clone());
  const look = shipState.pos.clone().addScaledVector(_shipFwd, 24);
  return flyCameraTo(chasePos, look, duration);
}
function unfocusCard() {
  const wasFocused = focused;
  focused = null; hovered = null;
  hideDetail();
  if (!wasFocused) return;
  if (shipLoaded) {
    returnToShipView(1.25);
  } else {
    flyCameraTo(INSIDE_HOME, new THREE.Vector3(80, 2, 0), 1.25).then(() => { fly.yaw = camera.rotation.y; fly.pitch = camera.rotation.x; });
  }
}

/* ---- Planet anfliegen: Autopilot fliegt das Schiff hin & klinkt sich in einen Orbit ein ---- */
function focusPlanet(pl) {
  if (focused) unfocusCard();
  focusedPlanet = pl;
  controls.enabled = false;
  fly.keys.clear();
  showPlanetDetail(pl.data);
  showToast('<i class="fas fa-circle-notch fa-spin"></i> Autopilot · Orbit um <span class="u-toast-strong">' + pl.data.name + '</span>', pl.data.accent);
  if (shipLoaded) {
    // Autopilot statt Teleport: liegt das Schiff schon nah dran -> direkt Orbit, sonst Transit-Anflug.
    const R = pl.data.size * ORBIT_RADIUS_K;
    orbitPhase = (shipState.pos.distanceTo(pl.worldPos) < R * 1.25) ? 'orbit' : 'transit';
    _orbTmp.copy(shipState.pos).sub(pl.worldPos);
    orbitAngle = Math.atan2(_orbTmp.z, _orbTmp.x);
  } else {
    // Fallback ohne Schiff: klassische Kamerafahrt
    const wp = pl.worldPos.clone();
    const outward = wp.clone().normalize();
    const camPos = wp.clone().addScaledVector(outward, pl.data.size * 2.8).add(new THREE.Vector3(0, pl.data.size * 0.8, 0));
    flyCameraTo(camPos, wp, 2.2, 'power3.inOut', true);
  }
}

/* ---- Nase weich auf einen Punkt / in eine Richtung ausrichten (für Autopilot/Orbit) ---- */
function faceShipToward(point, dt, k) {
  _shipMat.lookAt(shipState.pos, point, _shipUp.set(0, 1, 0));
  _orbQuat.setFromRotationMatrix(_shipMat);
  shipState.quat.slerp(_orbQuat, 1 - Math.exp(-k * dt));
}
function faceShipDir(dir, dt, k) {
  _lookTarget.copy(shipState.pos).add(dir);
  _shipMat.lookAt(shipState.pos, _lookTarget, _shipUp.set(0, 1, 0));
  _orbQuat.setFromRotationMatrix(_shipMat);
  shipState.quat.slerp(_orbQuat, 1 - Math.exp(-k * dt));
}

/* ---- Autopilot-Anflug + Orbit-Lock: läuft pro Frame, solange ein Planet fokussiert ist ---- */
function updatePlanetFocus(dt) {
  const pl = focusedPlanet; if (!pl) return;
  if (!shipLoaded) { camera.lookAt(pl.worldPos); return; }   // Fallback: Kamera blickt zum Planeten
  const pc = pl.worldPos;
  const R = pl.data.size * ORBIT_RADIUS_K;
  let targetRoll = 0;

  if (orbitPhase === 'transit') {
    // Ziel = nächstgelegener Punkt auf der Orbit-Schale; mit hohem Tempo anfliegen, kurz vor Ankunft abbremsen
    _orbTmp.copy(shipState.pos).sub(pc);
    if (_orbTmp.lengthSq() < 1e-4) _orbTmp.set(1, 0, 0);
    _orbTmp.normalize();
    _orbTmp2.copy(pc).addScaledVector(_orbTmp, R);           // Zielpunkt
    _shipFwd.copy(_orbTmp2).sub(shipState.pos);
    const dist = _shipFwd.length();
    const speed = Math.min(AUTOPILOT_MAX, dist * 2.4 + 30);  // Ease-out
    if (dist > 1e-3) shipState.pos.addScaledVector(_shipFwd.multiplyScalar(1 / dist), speed * dt);
    faceShipToward(_orbTmp2, dt, 7);
    shipState.engineGlow = 1; shipState.boost = true;
    flyWarpSpeed = speed;                                    // Speed-Streaks während der Reise
    // Banking: in die Anflugkurve neigen (wie viel das Ziel seitlich liegt)
    _shipRight.set(1, 0, 0).applyQuaternion(shipState.quat);
    targetRoll = THREE.MathUtils.clamp(-_shipRight.dot(_shipFwd) * 1.2, -0.6, 0.6);
    if (dist < R * 0.2) {
      orbitPhase = 'orbit';
      _orbTmp.copy(shipState.pos).sub(pc);
      orbitAngle = Math.atan2(_orbTmp.z, _orbTmp.x);
    }
  } else {                                                   // orbit: das Schiff umkreist den Planeten und folgt ihm
    orbitAngle += dt * ORBIT_ANG_SPEED;
    _orbTmp.set(Math.cos(orbitAngle) * R, R * 0.16, Math.sin(orbitAngle) * R).add(pc);
    shipState.pos.lerp(_orbTmp, 1 - Math.exp(-6 * dt));      // sanft auf die Orbit-Bahn einschwenken
    _orbTmp2.set(-Math.sin(orbitAngle), 0, Math.cos(orbitAngle));   // Tangente = Flugrichtung
    faceShipDir(_orbTmp2, dt, 5);
    shipState.engineGlow = 0.3; shipState.boost = false;
    flyWarpSpeed = 0;
    targetRoll = -0.5;                                       // konstante Neigung in die Kreisbahn
  }

  // Banking weich annähern + auf das Modell anwenden
  shipState.rollAngle += (targetRoll - shipState.rollAngle) * Math.min(1, dt * 3);
  if (shipPivot) {
    shipPivot.position.copy(shipState.pos);
    shipPivot.quaternion.copy(shipState.quat);
    if (bankGroup) bankGroup.rotation.z = shipState.rollAngle;
  }

  // Kamera: Planet bildfüllend, Schiff im Vordergrund (hinter dem Schiff, vom Planeten weg)
  _orbTmp.copy(shipState.pos).sub(pc).normalize();
  _camDesired.copy(shipState.pos)
    .addScaledVector(_orbTmp, pl.data.size * 1.2)
    .addScaledVector(_shipUp.set(0, 1, 0), pl.data.size * 0.4);
  camera.position.lerp(_camDesired, 1 - Math.exp(-2.4 * dt));
  camera.lookAt(pc);
}

function unfocusPlanet() {
  const was = focusedPlanet;
  focusedPlanet = null;
  orbitPhase = 'none';
  orbitCooldown = 3.0;                       // Sperre, damit der Auto-Orbit nicht sofort wieder greift
  flyWarpSpeed = 0;
  hideDetail();
  if (!was) return;
  showToast('<i class="fas fa-arrow-up-from-bracket"></i> Orbit verlassen · <span class="u-toast-strong">' + was.data.name + '</span>', '#70d6ff');
  if (shipLoaded) {
    // Heading aus der aktuellen Schiffsausrichtung übernehmen -> kein Sprung bei Steuerübernahme
    _shipEuler.setFromQuaternion(shipState.quat, 'YXZ');
    fly.yaw = _shipEuler.y; fly.pitch = THREE.MathUtils.clamp(_shipEuler.x, -1.2, 1.2);
    shipState.vel.set(0, 0, 0);
    returnToShipView(1.2);
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

/* ---- HUD-Toast: kurze Statusmeldung im HUD-Stil (Orbit eingeleitet / verlassen) ---- */
let toastEl = null, toastTimer = null;
function showToast(html, accent) {
  if (!overlay) return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'u-toast';
    toastEl.setAttribute('aria-hidden', 'true');
    overlay.appendChild(toastEl);
  }
  toastEl.innerHTML = html;
  const a = accent || '#a67cff';
  toastEl.style.setProperty('--color-accent', a);
  toastEl.style.setProperty('--color-accent-glow', a + '55');   // Akzent mit Alpha für den Glow
  void toastEl.offsetWidth;                                     // Reflow -> Transition triggert zuverlässig
  toastEl.classList.add('is-show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (toastEl) toastEl.classList.remove('is-show'); }, 2600);
}

/* ---- Lock-On: nächstes Ziel im Fadenkreuz (realm-abhängig) ---- */
function pickReticleTarget() {
  // Immer aus der Bildmitte strahlen: die Chase-Cam blickt entlang der Schiffsnase
  // (24 Einheiten voraus), daher deckt sich der Bildmittelpunkt mit dem Ziel. Aus der
  // Schiffsposition zu strahlen erzeugte Parallaxe (Kamera ist versetzt) -> Ziel daneben.
  raycaster.setFromCamera(CENTER2, camera);
  let best = null;
  const consider = (hit, info) => {
    if (hit && (!best || hit.distance < best.distance)) { info.distance = hit.distance; best = info; }
  };
  if (realm === 'cards') {
    const ch = raycaster.intersectObjects(cards.filter(c => c.mesh.visible).map(c => c.mesh), false)[0];
    if (ch) consider(ch, { type: 'card', ref: ch.object.userData.card, name: ch.object.userData.project.title });
    if (exitPortal && exitPortal.visible) consider(raycaster.intersectObject(exitPortal.userData.hitMesh, false)[0], { type: 'exit', ref: null, name: 'Rückkehr-Portal' });
  } else {
    for (const pl of planets) {
      consider(raycaster.intersectObject(pl.mesh, false)[0], { type: 'planet', ref: pl, name: pl.data.name });
      for (const mo of pl.moons) consider(raycaster.intersectObject(mo.mesh, false)[0], { type: 'moon', ref: mo, name: mo.data.name });
    }
    for (const tr of techRocks) consider(raycaster.intersectObject(tr.mesh, false)[0], { type: 'tech', ref: tr, name: tr.data.label });
    if (wormhole && wormhole.visible) consider(raycaster.intersectObject(wormhole.userData.hitMesh, false)[0], { type: 'wormhole', ref: null, name: 'Wurmloch' });
    consider(raycaster.intersectObject(horizon, false)[0], { type: 'hole', ref: null, name: 'Singularity' });
  }
  return best;
}

// E / Enter auf eingerastetes Ziel: passende Aktion auslösen
function activateLockTarget() {
  const t = lockTarget; if (!t) return;
  if (t.type === 'card') focusCard(t.ref);
  else if (t.type === 'planet') focusPlanet(t.ref);
  else if (t.type === 'tech') focusTech(t.ref);
  else if (t.type === 'moon') { if (t.ref.data.link) window.open(t.ref.data.link, '_blank', 'noopener'); }
  else if (t.type === 'wormhole') enterCardRealm();
  else if (t.type === 'exit') exitCardRealm();
  else if (t.type === 'hole') exitToClassic(true);
}

// Fadenkreuz aktualisieren (Lock-On-Zustand + Label)
let _reticleState = '';
const LOCK_VERB = { card: 'öffnen', planet: 'anfliegen', moon: 'Link öffnen', tech: 'Projekte', wormhole: 'eintreten', exit: 'zurückkehren', hole: 'zurück' };
function updateReticleLock(target, locked) {
  if (!reticleEl) return;
  const show = viewMode === 'inside' && !focused && !focusedPlanet && !spaghetti && overlay.classList.contains('is-visible');
  reticleEl.classList.toggle('is-visible', show);
  const key = target ? target.type + ':' + target.name + ':' + (locked ? 'L' : 'a') : 'none';
  if (key === _reticleState) return;
  _reticleState = key;
  reticleEl.classList.toggle('is-target', !!target);
  reticleEl.classList.toggle('is-locked', !!locked);
  if (reticleLabel) {
    if (!target) reticleLabel.textContent = '';
    else if (locked) reticleLabel.textContent = '◉ ' + target.name + '   [E] ' + (LOCK_VERB[target.type] || '');
    else reticleLabel.textContent = '○ ' + target.name + ' …';
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
  if (shipLoaded && viewMode === 'inside') {
    // Schiff sicher zurück an INSIDE_HOME setzen (sonst sofortige Re-Spaghettisierung)
    placeShipHome();
    chaseCamPosition(_camDesired);
    camera.position.copy(_camDesired);
  } else {
    camera.position.copy(INSIDE_HOME);
    fly.yaw = 0; fly.pitch = 0.12;
  }
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
  updateAmbient(dt);
  updateWorld(dt);
  updateWormhole(dt);
  if (realm === 'cards') {
    updateTunnelGuide(elapsed);                        // fließende Leit-Ringe zum Ausgang
    // Tunnel-Licht reist leicht voraus mit dem Schiff -> Schiff bleibt auf ganzer Länge beleuchtet
    if (tunnelLight) tunnelLight.position.set(shipState.pos.x, shipState.pos.y + 6, shipState.pos.z + 35);
  }

  // Kamera-Steuerung je nach Modus (Intro/sanfte Fahrten steuern selbst)
  if (!focused && !focusedPlanet && !spaghetti && !introActive && !camFlying) {
    if (viewMode === 'inside') { updateFly(dt); }
    else { applyMovement(dt); controls.update(); }
  }
  // Planet-Fokus: Autopilot-Anflug + Orbit-Lock (Schiff fliegt selbst, kein Teleport)
  if (focusedPlanet && !camFlying) updatePlanetFocus(dt);

  // Raumschiff: Sichtbarkeit, Triebwerksspur & Heck-Licht (im Orbit sichtbar lassen)
  if (shipPivot) {
    shipPivot.visible = shipLoaded && viewMode === 'inside' && !introActive && !focused && !spaghetti;
    updateEngineTrail(dt);
    if (engineLight) engineLight.intensity = (shipPivot.visible ? 1 : 0) * (0.6 + 3.4 * (shipState.boost ? 1 : shipState.engineGlow));
  }
  const shipSpeed = shipLoaded && viewMode === 'inside' ? shipState.vel.length() : fly.vel.length();
  drawSpeed(Math.max(shipSpeed, flyWarpSpeed));   // Speed-Streaks bei Tempo oder Warp-Reise

  // Gravitations-Lensing aktualisieren
  updateLens();

  // Spaghettisierung: Kollision Schiff <-> Horizont (nur im Hauptuniversum, kein Loch im Tunnel)
  if (realm === 'main' && !focused && !focusedPlanet && !spaghetti && !introActive && !camFlying &&
      shipState.pos.distanceTo(center) < BH_RADIUS * 1.15) {
    triggerSpaghetti();
  }

  // Hover-Erkennung (realm-abhängig: Tunnel = Karten, Haupt = Planeten/Tech)
  if (!isDown && !focused && !focusedPlanet && !spaghetti && !introActive && !camFlying) {
    raycaster.setFromCamera(pointer, camera);
    let card = null;
    if (realm === 'cards') {
      const hits = raycaster.intersectObjects(cards.filter(c => c.mesh.visible).map(c => c.mesh), false);
      card = hits.length ? hits[0].object.userData.card : null;
      // Hysterese: aktuellen Hover halten, solange er noch getroffen wird (kein Flackern)
      if (hovered && hits.some(h => h.object.userData.card === hovered)) card = hovered;
    }
    if (card !== hovered) {
      hovered = card;
      glCanvas.classList.toggle('is-pointer', !!card);
      if (card) showDetail(card.mesh.userData.project, false);
      else hideDetail();
    }
    // Welt-Hover (Planeten/Tech-Brocken) — nur Cursor + Brocken-Hervorhebung
    const wh = (realm === 'main' && !card) ? pickWorld() : null;
    hoveredWorld = (wh && (wh.type === 'tech' ? wh.tech : null)) || null;
    if (wh) glCanvas.classList.add('is-pointer');
  } else if (focusedPlanet) {
    hoveredWorld = null;
  }

  // Proximity-Reveal: Im Tunnel erscheinen nur die nächsten ~2 Karten rund ums Schiff – sie
  // tauchen vor dem Schiff aus dem Dunkel auf und verblassen nach dem Passieren wieder. Das hält
  // die Galerie übersichtlich und verhindert, dass man in weit entfernte Karten hineinfliegt.
  const refZ = (realm === 'cards') ? (shipLoaded ? shipState.pos.z : camera.position.z) : 0;
  for (const c of cards) {
    let rev = 0;
    if (realm === 'cards') {
      const d = c.base.z - refZ;                          // >0 = noch vor dem Schiff
      const appear = THREE.MathUtils.clamp((REVEAL_IN_FAR - d) / (REVEAL_IN_FAR - REVEAL_IN_NEAR), 0, 1);
      const trail  = THREE.MathUtils.clamp((d - REVEAL_OUT_FAR) / (REVEAL_OUT_NEAR - REVEAL_OUT_FAR), 0, 1);
      rev = appear * trail;
    }
    const active = (c === hovered || c === focused);
    if (active) rev = 1;                                  // angevisierte/fokussierte Karte immer voll da
    c.revealT = rev;
    const vis = rev > 0.002;
    if (c.mesh.visible !== vis) c.mesh.visible = vis;
    if (!vis) continue;
    c.mesh.material.opacity = rev;                        // sanftes Auf-/Abblenden beim Erscheinen/Passieren

    const p = c.base;                                     // feste Galerie-Position
    const ft = c.faceTarget || center;
    // Position: beim Hover ein Stück zur Kamera; sonst fest an der Wand
    let target = p;
    if (c === hovered && !focused) {
      const toCam = _tmpVec.copy(camera.position).sub(p).normalize();
      target = p.clone().addScaledVector(toCam, 10);
    }
    c.mesh.position.lerp(target, 0.16);

    // Ausrichtung: Standard -> Blick nach innen/voraus; aktiv -> Flip zur Kamera (lesbar)
    if (active) { dummy.position.copy(c.mesh.position); dummy.lookAt(camera.position); }
    else        { dummy.position.copy(p);               dummy.lookAt(ft); }
    c.mesh.quaternion.slerp(dummy.quaternion, active ? 0.18 : 0.12);

    // Scale: wächst beim Erscheinen sanft herein (0.82 -> 1), 1.6x wenn aktiv
    const ts = (active ? c.baseScale * 1.6 : c.baseScale) * (0.82 + 0.18 * rev);
    c.mesh.scale.lerp(dummy.scale.set(ts, ts, ts), active ? 0.16 : 0.3);
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

  // Lock-On-Fadenkreuz (Inside): visiert Karten/Planeten/Monde/Tech/Loch in der Bildmitte an
  if (viewMode === 'inside' && !focused && !focusedPlanet && !spaghetti && !introActive && !camFlying && cardsRevealed) {
    const tgt = pickReticleTarget();
    const same = tgt && lockTarget && tgt.type === lockTarget.type && tgt.ref === lockTarget.ref;
    if (tgt) { lockT = same ? lockT + dt : 0; lockTarget = tgt; }
    else { lockTarget = null; lockT = 0; }
    reticleCard = (lockTarget && lockTarget.type === 'card') ? lockTarget.ref : null;
    updateReticleLock(lockTarget, !!lockTarget && lockT >= LOCK_TIME);
  } else {
    reticleCard = null; lockTarget = null; lockT = 0;
    updateReticleLock(null, false);
  }

  // sanftes FOV: Hineinzoomen beim Fokus, Aufweiten beim Boost (Speed-Gefühl)
  if (!spaghetti) {
    const boosting = shipState.boost && viewMode === 'inside' && !focused && !focusedPlanet;
    let tf = focused ? 50 : (boosting ? 74 : 58);
    if (focusedPlanet) tf = (orbitPhase === 'transit') ? 72 : 56;   // Anflug: weit (Speed) · Orbit: intim
    if (Math.abs(camera.fov - tf) > 0.05) { camera.fov += (tf - camera.fov) * 0.08; camera.updateProjectionMatrix(); }
  }

  // StarMap zeichnen (falls offen)
  if (starmapOpen) drawStarmap();

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
  loadShip();            // asynchron: Szene läuft, Schiff blendet ein sobald geladen
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
  overlay.classList.add('is-preloaded');
  overlay.setAttribute('aria-hidden', 'true');
  if (window.gsap) gsap.set('.gateway-content', { clearProps: 'opacity,y,scale,transform' });
  if (window.gsap) gsap.set('.gateway-buttons', { clearProps: 'opacity,scale,transform' });
  if (window.gsap) gsap.set('.g-core', { clearProps: 'all' });
  if (window.gsap) gsap.set('.g-ring', { clearProps: 'all' });
}

/* ---- Cinematische Eintritts-Choreografie ----
   Nach dem Warp ist die Kamera DICHT am Schwarzen Loch ("Du bist am SL"). */
const INTRO_START_ANG = Math.PI * 0.15;
const INTRO_BH_R = 150;   // Kamera-Radius dicht am SL beim Eintritt
const INTRO_BH_Y = 24;
function setCameraIntroStart() {
  introActive = true;
  camera.position.set(
    Math.cos(INTRO_START_ANG) * INTRO_BH_R,
    INTRO_BH_Y,
    Math.sin(INTRO_START_ANG) * INTRO_BH_R,
  );
  camera.lookAt(center);
}

/* ---- Welt erscheinen lassen: Planeten/Bahnen/Gürtel tauchen erst nach der Supernova auf ---- */
function hideWorlds() {
  for (const pl of planets) {
    pl.group.visible = false;
    pl.group.scale.setScalar(0.0001);
    if (pl.orbitLine) { pl.orbitLine.visible = false; pl.orbitLine.material.opacity = 0; }
  }
  if (asteroidBelt) asteroidBelt.visible = false;
  if (eclipticField) eclipticField.visible = false;
  for (const tr of techRocks) tr.mesh.visible = false;
}
function revealWorlds() {
  const anim = window.gsap && !reduceMotion;
  if (asteroidBelt) asteroidBelt.visible = true;
  if (eclipticField) eclipticField.visible = true;
  for (const tr of techRocks) tr.mesh.visible = true;
  planets.forEach((pl, i) => {
    pl.group.visible = true;
    const d = i * 0.18;
    if (anim) {
      gsap.fromTo(pl.group.scale,
        { x: 0.0001, y: 0.0001, z: 0.0001 },
        { x: 1, y: 1, z: 1, duration: 1.2, delay: d, ease: 'back.out(1.5)' });
    } else {
      pl.group.scale.setScalar(1);
    }
    if (pl.orbitLine) {
      pl.orbitLine.visible = true;
      if (anim) gsap.fromTo(pl.orbitLine.material, { opacity: 0 }, { opacity: 0.55, duration: 1.4, delay: d });
      else pl.orbitLine.material.opacity = 0.55;
    }
  });
}
/* ---- Supernova: gewaltiger Blitz + Schockwelle, kurz vor Ende des Anflugs ---- */
// Weiche Ring-Textur (gefederte Kanten statt harter RingGeometry-Annulus).
let _softRingTex = null;
function softRingTexture() {
  if (_softRingTex) return _softRingTex;
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,0)');
  g.addColorStop(0.58, 'rgba(255,255,255,0)');
  g.addColorStop(0.80, 'rgba(255,255,255,0.95)');   // weicher Ring-Grat
  g.addColorStop(0.90, 'rgba(255,255,255,0.30)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  _softRingTex = new THREE.CanvasTexture(c); _softRingTex.colorSpace = THREE.SRGBColorSpace;
  return _softRingTex;
}
// Weicher Glow-Sprite (immer zur Kamera gerichtet -> keine harten Scheibenkanten).
function makeGlowSprite(color, opacity) {
  const m = new THREE.SpriteMaterial({ map: spriteTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  m.toneMapped = false;
  const sp = new THREE.Sprite(m);
  sp.layers.set(LAYER_BG);
  scene.add(sp);
  return sp;
}
function makeShockRing(color, tilt) {
  const m = new THREE.MeshBasicMaterial({ color, map: softRingTexture(), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  m.toneMapped = false;
  const r = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.7), m);   // weicher Ring-Grat bei ~0.8·Halbgröße
  r.rotation.x = Math.PI / 2 + tilt;
  r.layers.set(LAYER_BG);
  scene.add(r);
  return r;
}
function supernova() {
  spawnNovaParticles(); // gewaltiger Partikel-Ausbruch
  if (!window.gsap) return;

  // greller Kern-Blitz (weicher Glow-Sprite)
  const flash = makeGlowSprite(0xfff6e0, 1);
  flash.scale.set(6, 6, 1);
  gsap.to(flash.scale, { x: 440, y: 440, duration: 1.2, ease: 'power3.out' });
  gsap.to(flash.material, { opacity: 0, duration: 1.35, ease: 'power2.in', onComplete: () => { scene.remove(flash); flash.material.dispose(); } });

  // langsam verglühender Kern (Nachglühen -> schönes, weiches Ende)
  const ember = makeGlowSprite(0xff7a2a, 0);
  const er = BH_RADIUS * 3.2;                                  // Start-Durchmesser
  ember.scale.set(er, er, 1);
  gsap.timeline()
    .to(ember.material, { opacity: 0.5, duration: 0.3, ease: 'power2.out' }, 0)
    .to(ember.scale, { x: er * 4.2, y: er * 4.2, duration: 2.8, ease: 'power1.out' }, 0)
    .to(ember.material, { opacity: 0, duration: 2.5, ease: 'power2.in', onComplete: () => { scene.remove(ember); ember.material.dispose(); } }, 0.4);

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
  const pop = makeGlowSprite(0xffffff, 1);
  pop.scale.set(8, 8, 1);
  gsap.to(pop.scale, { x: 360, y: 360, duration: 0.6, ease: 'power3.out' });
  gsap.to(pop.material, { opacity: 0, duration: 0.7, ease: 'power2.in', onComplete: () => { scene.remove(pop); pop.material.dispose(); } });
  if (flashEl) gsap.fromTo(flashEl, { opacity: 0 }, { opacity: 0.85, duration: 0.1, onComplete: () => gsap.to(flashEl, { opacity: 0, duration: 0.6 }) });
}

// Eine Ejekta-Schicht: count Partikel, Geschwindigkeit spMin..spMax, Punktgröße size,
// Luftwiderstand drag (kleiner = fliegt weiter), hotBias>1 = mehr heiße/helle Partikel.
function makeNovaCloud(count, spMin, spMax, size, drag, hotBias) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  const cHot = new THREE.Color('#ffffff'), cWarm = new THREE.Color('#ffd27a');
  const cMid = new THREE.Color('#ff8a3a'), cCold = new THREE.Color('#e0260f');
  for (let i = 0; i < count; i++) {
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    const sp = spMin + Math.random() * (spMax - spMin);
    const r0 = 1 + Math.random() * 3;
    pos[i * 3] = dir.x * r0; pos[i * 3 + 1] = dir.y * r0; pos[i * 3 + 2] = dir.z * r0;
    vel[i * 3] = dir.x * sp; vel[i * 3 + 1] = dir.y * sp; vel[i * 3 + 2] = dir.z * sp;
    const c = Math.random() * hotBias;
    tmp.copy(c > 0.78 ? cHot : c > 0.52 ? cWarm : c > 0.26 ? cMid : cCold);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size, map: spriteTex, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 1,
  });
  mat.toneMapped = false;
  const pts = new THREE.Points(geo, mat);
  pts.layers.set(LAYER_BG);
  scene.add(pts);
  return { points: pts, vel, drag };
}
function disposeNova() {
  if (!novaSystem) return;
  for (const cl of novaSystem.clouds) { scene.remove(cl.points); cl.points.geometry.dispose(); cl.points.material.dispose(); }
  novaSystem = null;
}
function spawnNovaParticles() {
  disposeNova();
  // Mehrere Schichten -> realistische Supernova: feine Asche + Glutfetzen + große Trümmer,
  // schnell genug, um weit über den Bildrand hinaus geschleudert zu werden.
  const clouds = [
    makeNovaCloud(4200, 110, 430, 3.0, 0.45, 1.0),   // feine, schnelle Asche
    makeNovaCloud(900,  90, 320, 6.5, 0.5,  1.3),    // mittlere Glutfetzen
    makeNovaCloud(220, 160, 560, 11.0, 0.32, 1.6),   // große, schnelle Trümmer (riesig im Vorbeiflug)
  ];
  novaSystem = { clouds, t: 0, life: 3.8 };
}
function updateNova(dt) {
  if (!novaSystem) return;
  novaSystem.t += dt;
  const e = novaSystem.t / novaSystem.life;
  const fade = Math.max(0, 1 - e * e);
  for (const cl of novaSystem.clouds) {
    const arr = cl.points.geometry.attributes.position.array, v = cl.vel;
    const dr = Math.max(0, 1 - dt * cl.drag);
    for (let i = 0; i < arr.length; i++) { arr[i] += v[i] * dt; v[i] *= dr; }
    cl.points.geometry.attributes.position.needsUpdate = true;
    cl.points.material.opacity = fade;
  }
  if (e >= 1) disposeNova();
}

function runIntro() {
  return new Promise((resolve) => {
    let novaFired = false;
    const fireNova = () => { if (!novaFired) { novaFired = true; supernova(); } };
    const startAng = INTRO_START_ANG;

    // === PHASE F: Kamera senkt sich sanft über die Orbital-Ebene; das Schiff taucht auf ===
    const descendToShip = async () => {
      realm = 'main';
      placeShipHome();                                           // Schiff an INSIDE_HOME, Blick zum Zentrum
      introActive = false;                                       // Schiff darf jetzt sichtbar werden
      if (shipPivot && window.gsap) {                            // Schiff "taucht auf" (Scale-Pop)
        gsap.fromTo(shipPivot.scale, { x: 0.0001, y: 0.0001, z: 0.0001 }, { x: 1, y: 1, z: 1, duration: 1.2, ease: 'back.out(1.4)' });
      }
      _shipFwd.set(0, 0, -1).applyQuaternion(shipState.quat);
      const chasePos = chaseCamPosition(_camDesired.clone());
      const look = shipState.pos.clone().addScaledVector(_shipFwd, 24);
      await flyCameraTo(chasePos, look, 3.0, 'power2.inOut');    // sanfter Sinkflug zum Schiff
      cardsRevealed = true;                                      // Lock-On/Interaktion ab jetzt aktiv
      resolve();
    };

    // === PHASE E: smoother Overview-Shot von oben; die Planeten erscheinen erst jetzt ===
    const goOverview = async () => {
      const top = new THREE.Vector3(700, 6200, 2200);            // hoch & leicht versetzt -> 3/4-Top-Vista
      await flyCameraTo(top, center, 3.2, 'power2.inOut');
      revealWorlds();                                            // Planeten/Bahnen/Gürtel materialisieren
      await wait(1500);                                          // kurz wirken lassen
      descendToShip();
    };

    // Reduced-Motion / kein GSAP: sofort einrichten
    if (reduceMotion || !window.gsap) {
      fireNova(); revealWorlds();
      realm = 'main'; placeShipHome();
      _shipFwd.set(0, 0, -1).applyQuaternion(shipState.quat);
      chaseCamPosition(_camDesired); camera.position.copy(_camDesired);
      camera.lookAt(shipState.pos.clone().addScaledVector(_shipFwd, 24));
      cardsRevealed = true;
      introActive = false; resolve(); return;
    }

    introActive = true;
    cards.forEach(c => { c.mesh.visible = false; }); // Karten leben im Tunnel; im Haupt-Realm verborgen
    hideWorlds();                                     // Planeten erst in Phase E (idempotent)
    if (shipPivot) shipPivot.scale.setScalar(0.0001); // Schiff bis Phase F unsichtbar klein halten

    // === PHASE D: am SL — alles dreht sich schnell, dann riesige Explosion; Kamera fährt nach außen ===
    // D1: enges, immer schnelleres Kreisen ums Schwarze Loch
    const spin = { t: 0 };
    introTween = gsap.to(spin, {
      t: 1, duration: 2.2, ease: 'power2.in',                    // beschleunigt in den Ausbruch
      onUpdate: () => {
        const ang = startAng + spin.t * spin.t * Math.PI * 4.5;  // dreht zunehmend schneller
        const r = INTRO_BH_R - spin.t * 35;                      // zieht leicht enger ran
        camera.position.set(Math.cos(ang) * r, INTRO_BH_Y, Math.sin(ang) * r);
        camera.lookAt(center);
      },
      onComplete: () => {
        introTween = null;
        fireNova();                                              // EXPLOSION – riesig, von nah
        finalFlash();
        // D2: während der Explosion fährt die Kamera nach AUSSEN (von außen betrachten)
        const baseAng = startAng + Math.PI * 4.5;
        const out = { t: 0 };
        introTween = gsap.to(out, {
          t: 1, duration: 3.2, ease: 'power2.out',               // schnell raus, dann sanft auslaufend
          onUpdate: () => {
            const ang = baseAng + out.t * 0.9;                   // dreht langsam weiter
            const r = (INTRO_BH_R - 35) + out.t * 1500;          // nach außen
            const y = INTRO_BH_Y + out.t * 260;                  // leicht anheben
            const sh = (1 - out.t) * (1 - out.t) * 7;            // Shake klingt ab
            camera.position.set(
              Math.cos(ang) * r + (Math.random() - 0.5) * sh,
              y + (Math.random() - 0.5) * sh,
              Math.sin(ang) * r + (Math.random() - 0.5) * sh,
            );
            camera.lookAt(center);
          },
          onComplete: () => { introTween = null; goOverview(); }, // -> Overview -> Schiff
        });
      },
    });

    // Skip (Taste): direkt Supernova -> Overview -> Schiff
    introFinish = () => {
      if (introTween) { introTween.kill(); introTween = null; }
      introFinish = null;
      fireNova(); finalFlash();
      goOverview();
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
  const gateway = document.getElementById('gateway');
  const hasGSAP = window.gsap && !reduceMotion;

  // === PHASE A: Der Nebel hinten wächst und füllt langsam den ganzen Bildschirm ===
  if (hasGSAP) {
    const tl = gsap.timeline();

    // Text + Buttons verschwinden
    tl.to('.gateway-content', { opacity: 0, y: -30, scale: 1.04, duration: 0.6, ease: 'power2.in' }, 0);
    // Scroll-Indikator ausblenden
    tl.to('.gateway-scroll', { opacity: 0, duration: 0.3 }, 0);

    // Orbital-Ringe beschleunigen + vergrößern + verschwinden
    tl.to('.g-ring', { opacity: 0, scale: 2.6, duration: 1.2, ease: 'power2.in' }, 0.15);

    // Portal-Expand Overlay (fullscreen Nebel-Gradient) erzeugen
    if (!portalExpandEl) {
      portalExpandEl = document.createElement('div');
      portalExpandEl.className = 'gateway-portal-expand';
      document.body.appendChild(portalExpandEl);
    }

    // Core/Nebel wächst langsam vom Punkt zum bildschirmfüllenden Glow (~2s)
    tl.to('.g-core', {
      scale: 170, opacity: 1, duration: 2.0, ease: 'power2.in',
      boxShadow: '0 0 400px 200px rgba(166, 124, 255, 0.95), 0 0 800px 400px rgba(112, 214, 255, 0.5)',
    }, 0.2);
    tl.to(portalExpandEl, { opacity: 1, duration: 1.4, ease: 'power1.in' }, 0.7);

    // Partikel verschwinden
    if (window.fadeParticles) tl.call(() => window.fadeParticles(0), null, 0.5);

    await tl;
  } else {
    await wait(100);
  }

  // Szene vorbereiten (läuft hinter Nebel/Warp)
  if (!scenePreInited) {
    overlay.classList.add('is-preloaded');
  }
  openOverlay();
  helpDismissed = false;
  if (helpEl) helpEl.classList.remove('is-hidden');
  const ready = initSceneOnce();
  onResize();
  viewMode = 'inside'; realm = 'main';

  // === PHASE B+C: Nebel fadet in den Warp; der Warp hält ein paar Sekunden ===
  warpCanvas.classList.add('is-scroll-warp');
  const WARP_HOLD = 5.4;                          // Sekunden, die der Warp "stehen" bleibt (4–8s)
  const warpHold = hasGSAP ? runWarpHold(WARP_HOLD) : runWarp(false);
  // Nebel-Overlay sanft in den Warp übergehen lassen
  if (hasGSAP && portalExpandEl) {
    gsap.to(portalExpandEl, { opacity: 0, duration: 1.2, ease: 'power2.out', delay: 0.6 });
  }

  // Szene bereit machen, Kamera dicht ans SL setzen, Loader weg — alles noch hinter dem Warp
  await Promise.race([ready, wait(4000)]);
  if (!running) startLoop();
  setCameraIntroStart();           // Kamera dicht am SL (Phase D-Start)
  hideWorlds();                    // Planeten/Bahnen verstecken — erscheinen erst in Phase E
  if (loadingEl) loadingEl.classList.add('is-hidden');
  overlay.classList.add('is-visible');
  if (hasGSAP) gsap.set(overlay, { opacity: 0 });   // hinter dem Warp unsichtbar halten

  // Warp bis zum Ende laufen lassen …
  await warpHold;

  // … dann smooth in die 3D-Szene (am SL) überblenden
  if (hasGSAP) {
    gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 1.1, ease: 'power2.out' });
    fadeOutWarp();
    setTimeout(() => warpCanvas.classList.remove('is-scroll-warp'), 900);
  } else {
    revealOverlay();
    fadeOutWarp();
  }

  // Gateway z-index zurücksetzen
  if (gateway) gateway.classList.remove('is-transitioning');

  if (!musicReady) initAudio(); else fadeMusicIn();
  busy = false;
  runIntro();                      // Phasen D, E, F
}

function cancelIntro() {
  if (introTween) { introTween.kill(); introTween = null; }
  introFinish = null;
  introActive = false;
}

async function smoothExit(scrollTarget) {
  const hasGSAP = window.gsap && !reduceMotion;

  cancelIntro();
  fadeMusicOut();
  if (starmapOpen) toggleStarmap(false);
  if (spaghetti) resetSpaghetti();
  if (focused) { focused = null; hideDetail(); }
  if (focusedPlanet) { focusedPlanet = null; hideDetail(); }

  if (hasGSAP) {
    // Reverse-Warp + Overlay-Fadeout gleichzeitig (cross-fade)
    warpCanvas.classList.add('is-scroll-warp');
    runWarp(true);
    gsap.to(overlay, { opacity: 0, duration: 0.8, ease: 'power2.in' });
    await wait(800);
  } else {
    await Promise.race([runWarp(true), wait(1500)]);
  }

  stopLoop();
  closeOverlay();
  hideWarp();
  warpCanvas.classList.remove('is-scroll-warp');

  // Partikel zurückholen
  if (window.fadeParticles) window.fadeParticles(1);

  unlockScroll();

  if (scrollTarget === 'top') {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  } else {
    scrollToEl('#explorations');
  }
}

async function exitToClassic(reverse) {
  if (busy) return;
  busy = true;
  await smoothExit('projects');
  busy = false;
}

async function backToTop() {
  if (busy) return;
  busy = true;
  await smoothExit('top');
  busy = false;
}


/* ================================================================
   MUSIK  (Web Audio API · zwei Ambient-Tracks, Crossfade)
   ================================================================ */
async function initAudio() {
  if (musicReady || musicLoading) return;
  musicLoading = true;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    musicGain = audioCtx.createGain();
    musicGain.gain.value = musicMuted ? 0 : MUSIC_VOL;
    musicGain.connect(audioCtx.destination);
    musicBuffers = await Promise.all(MUSIC_FILES.map(async (url) => {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      return await audioCtx.decodeAudioData(buf);
    }));
    musicReady = true;
    playTrack(0);
  } catch (e) {
    console.warn('[universe] Audio konnte nicht initialisiert werden:', e);
  } finally {
    musicLoading = false;
  }
}
function playTrack(i) {
  if (!musicReady || !musicBuffers[i]) return;
  // alte Quelle ausblenden & stoppen
  musicSources.forEach((s) => { try { s.stop(); } catch (_) {} });
  musicSources = [];
  const src = audioCtx.createBufferSource();
  src.buffer = musicBuffers[i];
  src.loop = true;
  src.connect(musicGain);
  src.start();
  musicSources.push(src);
  musicTrack = i;
}
function toggleMusic() {
  // erster Klick initialisiert Audio (Autoplay-Policy: Nutzergeste)
  if (!musicReady) { if (!musicMuted) initAudio(); }
  musicMuted = !musicMuted;
  if (musicGain && audioCtx) {
    const now = audioCtx.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(musicMuted ? 0 : MUSIC_VOL, now + 0.5);
  }
  if (musicBtn) {
    musicBtn.setAttribute('aria-pressed', String(!musicMuted));
    const icon = musicBtn.querySelector('i');
    if (icon) icon.className = musicMuted ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
    musicBtn.classList.toggle('is-muted', musicMuted);
  }
}
function fadeMusicOut() {
  if (musicGain && audioCtx) {
    const now = audioCtx.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(0, now + 0.8);
  }
}
function fadeMusicIn() {
  if (musicMuted) return;
  if (musicGain && audioCtx) {
    const now = audioCtx.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(MUSIC_VOL, now + 1.2);
  }
}

/* ================================================================
   STARMAP  (Top-Down-Minikarte · [M] · Klick = Welt anfliegen)
   ================================================================ */
function toggleStarmap(force) {
  starmapOpen = (force === undefined) ? !starmapOpen : force;
  if (starmapEl) {
    starmapEl.classList.toggle('is-open', starmapOpen);
    starmapEl.setAttribute('aria-hidden', String(!starmapOpen));
  }
}
const STARMAP_RANGE = 10000;        // Weltradius, der auf den Kartenrand abgebildet wird
function starmapScale() {
  if (!starmapCanvas) return 1;
  return (starmapCanvas.width * 0.5 - 14) / STARMAP_RANGE;
}
// Karten-Tunnel als Längsschnitt (Fortschritt von links nach rechts)
function drawStarmapTunnel() {
  const W = starmapCanvas.width, H = starmapCanvas.height, pad = 18;
  starmapCtx.clearRect(0, 0, W, H);
  starmapCtx.fillStyle = 'rgba(14,6,24,0.72)';
  starmapCtx.fillRect(0, 0, W, H);
  const z0 = TUNNEL_ORIGIN.z, z1 = TUNNEL_ORIGIN.z + TUNNEL_LENGTH + 80;
  const zToX = (z) => pad + (z - z0) / (z1 - z0) * (W - 2 * pad);
  const xToY = (x) => H / 2 - (x - TUNNEL_ORIGIN.x) / (RING_R * 1.5) * (H / 2 - pad);
  // Korridor-Achse
  starmapCtx.strokeStyle = 'rgba(176,124,255,0.28)'; starmapCtx.lineWidth = 1;
  starmapCtx.beginPath(); starmapCtx.moveTo(pad, H / 2); starmapCtx.lineTo(W - pad, H / 2); starmapCtx.stroke();
  // Karten
  for (const c of cards) {
    const active = (c === hovered || c === focused);
    const rev = c.revealT || 0;                          // aktuell enthüllte Karten hervorheben
    if (active) starmapCtx.fillStyle = '#ffffff';
    else if (rev > 0.05) starmapCtx.fillStyle = `rgba(176,124,255,${(0.5 + 0.5 * rev).toFixed(2)})`;
    else starmapCtx.fillStyle = 'rgba(176,124,255,0.26)'; // schlummernde Karten gedimmt
    const rad = active ? 4 : (2.2 + 1.8 * rev);
    starmapCtx.beginPath(); starmapCtx.arc(zToX(c.base.z), xToY(c.base.x), rad, 0, Math.PI * 2); starmapCtx.fill();
  }
  // Ausgangsportal
  if (exitPortal) {
    const ex = zToX(exitPortal.position.z);
    starmapCtx.fillStyle = '#70e0ff';
    starmapCtx.beginPath(); starmapCtx.arc(ex, H / 2, 4.5, 0, Math.PI * 2); starmapCtx.fill();
    starmapCtx.fillStyle = 'rgba(230,236,255,0.8)'; starmapCtx.font = '8px "Space Mono", monospace';
    starmapCtx.fillText('Ausgang', ex - 14, H / 2 - 8);
  }
  // Schiff
  const sx = zToX(shipState.pos.z), sy = xToY(shipState.pos.x);
  starmapCtx.fillStyle = '#70ffd0';
  starmapCtx.beginPath(); starmapCtx.moveTo(sx + 5, sy); starmapCtx.lineTo(sx - 4, sy + 4); starmapCtx.lineTo(sx - 4, sy - 4); starmapCtx.closePath(); starmapCtx.fill();
  if (starmapInfo) {
    const prog = Math.max(0, Math.min(100, Math.round((shipState.pos.z - z0) / (z1 - z0) * 100)));
    starmapInfo.textContent = `Karten-Tunnel · ${prog}% · ${cards.length} Projekte · Ausgang am Ende`;
  }
}
function drawStarmap() {
  if (!starmapCtx || !starmapOpen) return;
  if (realm === 'cards') { drawStarmapTunnel(); return; }
  const W = starmapCanvas.width, H = starmapCanvas.height;
  const cx = W / 2, cy = H / 2, s = starmapScale();
  starmapCtx.clearRect(0, 0, W, H);
  // Hintergrund + Gitter
  starmapCtx.fillStyle = 'rgba(6,9,18,0.6)';
  starmapCtx.fillRect(0, 0, W, H);
  starmapCtx.strokeStyle = 'rgba(112,214,255,0.08)';
  starmapCtx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) {
    starmapCtx.beginPath();
    starmapCtx.arc(cx, cy, (W * 0.5 - 14) * (g / 3), 0, Math.PI * 2);
    starmapCtx.stroke();
  }
  // Bahnlinien + Planeten
  for (const pl of planets) {
    starmapCtx.strokeStyle = pl.data.accent + '55';
    starmapCtx.beginPath();
    starmapCtx.arc(cx, cy, Math.min(W * 0.5 - 6, pl.data.orbitR * s), 0, Math.PI * 2);
    starmapCtx.stroke();
    const px = cx + pl.worldPos.x * s, py = cy + pl.worldPos.z * s;
    starmapCtx.fillStyle = pl.data.accent;
    starmapCtx.beginPath();
    starmapCtx.arc(px, py, Math.max(3, pl.data.size * 0.04), 0, Math.PI * 2);
    starmapCtx.fill();
    starmapCtx.fillStyle = 'rgba(230,236,255,0.85)';
    starmapCtx.font = '9px "Space Mono", monospace';
    starmapCtx.fillText(pl.data.name, px + 6, py + 3);
  }
  // Asteroidengürtel (Tech) als gepunkteter Ring
  starmapCtx.strokeStyle = 'rgba(160,200,255,0.22)';
  starmapCtx.setLineDash([2, 4]);
  starmapCtx.beginPath();
  starmapCtx.arc(cx, cy, ((BELT_R0 + BELT_R1) / 2) * s, 0, Math.PI * 2);
  starmapCtx.stroke();
  starmapCtx.setLineDash([]);
  // Schwarzes Loch im Zentrum
  starmapCtx.fillStyle = '#000';
  starmapCtx.beginPath(); starmapCtx.arc(cx, cy, 5, 0, Math.PI * 2); starmapCtx.fill();
  starmapCtx.strokeStyle = '#a67cff'; starmapCtx.lineWidth = 1.5;
  starmapCtx.beginPath(); starmapCtx.arc(cx, cy, 6, 0, Math.PI * 2); starmapCtx.stroke();
  // Wurmloch (pulsierend) auf seiner Umlaufbahn
  if (wormhole && wormhole.visible) {
    const wxp = cx + wormholeWorldPos.x * s, wyp = cy + wormholeWorldPos.z * s;
    const pulse = 0.55 + 0.45 * Math.sin(elapsed * 3);
    starmapCtx.fillStyle = `rgba(176,124,255,${pulse})`;
    starmapCtx.beginPath(); starmapCtx.arc(wxp, wyp, 4.5, 0, Math.PI * 2); starmapCtx.fill();
    starmapCtx.fillStyle = 'rgba(230,236,255,0.85)';
    starmapCtx.font = '9px "Space Mono", monospace';
    starmapCtx.fillText('Wurmloch', wxp + 7, wyp + 3);
  }
  // Schiff als Pfeil (Heading aus shipState)
  const probe = shipLoaded ? shipState.pos : camera.position;
  const sx = cx + probe.x * s, sy = cy + probe.z * s;
  let heading = 0;
  _shipFwd.set(0, 0, -1).applyQuaternion(shipLoaded ? shipState.quat : camera.quaternion);
  heading = Math.atan2(_shipFwd.x, _shipFwd.z);
  starmapCtx.save();
  starmapCtx.translate(sx, sy);
  starmapCtx.rotate(-heading);
  starmapCtx.fillStyle = '#70ffd0';
  starmapCtx.beginPath();
  starmapCtx.moveTo(0, -6); starmapCtx.lineTo(4, 5); starmapCtx.lineTo(0, 2); starmapCtx.lineTo(-4, 5);
  starmapCtx.closePath(); starmapCtx.fill();
  starmapCtx.restore();
  // Info-Zeile
  if (starmapInfo) {
    const spd = Math.round(shipLoaded ? shipState.vel.length() : fly.vel.length());
    let near = '—', nd = Infinity;
    for (const pl of planets) { const d = probe.distanceTo(pl.worldPos); if (d < nd) { nd = d; near = pl.data.name; } }
    starmapInfo.textContent = `Speed ${spd} u/s · nächste Welt: ${near} (${Math.round(nd)})`;
  }
}
function onStarmapClick(ev) {
  if (!starmapCanvas) return;
  const r = starmapCanvas.getBoundingClientRect();
  const s = starmapScale();
  const wx = ((ev.clientX - r.left) * (starmapCanvas.width / r.width) - starmapCanvas.width / 2) / s;
  const wz = ((ev.clientY - r.top) * (starmapCanvas.height / r.height) - starmapCanvas.height / 2) / s;
  // nächste Welt zum Klickpunkt finden
  let best = null, bd = Infinity;
  for (const pl of planets) {
    const d = Math.hypot(pl.worldPos.x - wx, pl.worldPos.z - wz);
    if (d < bd) { bd = d; best = pl; }
  }
  if (best && bd < 1000 && realm === 'main') {
    toggleStarmap(false);
    focusPlanet(best);
  }
}

/* ---- Verdrahtung ---- */
function wire() {
  setupScrollLayers();
  setupPreInit();

  enterBtn && enterBtn.addEventListener('click', enterUniverse);
  projBtn && projBtn.addEventListener('click', () => scrollToEl('#explorations'));

  modeClassicBtn && modeClassicBtn.addEventListener('click', () => exitToClassic(false));
  backBtn && backBtn.addEventListener('click', backToTop);
  detailCloseBtn && detailCloseBtn.addEventListener('click', () => { if (focusedPlanet) unfocusPlanet(); else if (focused) unfocusCard(); else hideDetail(); });
  terminalExit && terminalExit.addEventListener('click', resetSpaghetti);
  musicBtn && musicBtn.addEventListener('click', toggleMusic);
  starmapBtn && starmapBtn.addEventListener('click', () => toggleStarmap());
  starmapCloseBtn && starmapCloseBtn.addEventListener('click', () => toggleStarmap(false));
  starmapCanvas && starmapCanvas.addEventListener('click', onStarmapClick);

  if (hintEl) {
    hintEl.textContent = (isMobile() || !hasWebGL())
      ? 'Tip: the 3D experience is optimized for desktop — on this device we’ll glide you straight to the classic cards.'
      : 'Tip: drag to look · W A S D to fly · hover a card · click the black hole to return.';
  }

  window.__universeReady = true;
}

// [DEBUG-TEMP] Verifikations-Hook — vor Commit entfernen
window.__t = {
  enter: () => enterCardRealm(),
  exit: () => exitCardRealm(),
  info: () => ({
    realm, busy, introActive, camFlying, focused: !!focused, focusedPlanet: !!focusedPlanet, spaghetti,
    ship: shipState.pos.toArray().map(Math.round),
    wh: wormholeWorldPos.toArray().map(Math.round),
    cardsVis: cards.filter(c => c.mesh.visible).length,
    exitVis: !!(exitPortal && exitPortal.visible),
    wormVis: !!(wormhole && wormhole.visible),
    bg: scene.background ? (scene.background.isCubeTexture ? 'cube' : 'tex') : 'none',
    tunnelLight: tunnelLight ? tunnelLight.intensity : -1,
  }),
};

wire();
