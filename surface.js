/* =====================================================================
   surface.js — Planetenoberflächen: Landen, Erkunden, Beamen
   ---------------------------------------------------------------------
   Eigenständiges Modul mit eigener THREE.Scene + eigenem Render-Loop.
   universe.js stoppt seinen Loop während der Oberflächen-Phase und
   übergibt den Renderer — es wird also nie doppelt gerendert.

   Architektur:
   - SURFACE_WORLDS: zentrales Konfigurations-Objekt. Neue Welten werden
     ausschließlich hier ergänzt (Terrain, Himmel, Props, Entdeckungen).
   - buildSession(): baut aus einer Konfiguration die komplette Szene.
     Jeder Baustein registriert seinen Frame-Updater in S.anim -> modular.
   - burnFX: Plasma-/Reibungs-Blende (Canvas 2D) für Atmosphären-Ein-
     und -Austritt. Dient als visuelle Barriere beim Szenenwechsel.
   - Erzählschicht: Entdeckungen sind "Logbuch-Fragmente"; pro Welt ein
     Kapitel, alle Kapitel zusammen ergeben das "Große Ganze".
   ===================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ----------------------------------------------------------------
   0) Kleine Helfer
   ---------------------------------------------------------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp  = (a, b, t) => a + (b - a) * t;
const wait  = (ms) => new Promise(r => setTimeout(r, ms));

/* Deterministischer RNG + 2D-Value-Noise (CPU) — Terrain, Platzierung */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function makeNoise(seed) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const X = xi & 255, Y = yi & 255;
    const a = perm[perm[X] + Y] / 255, b = perm[perm[X + 1] + Y] / 255;
    const c = perm[perm[X] + Y + 1] / 255, d = perm[perm[X + 1] + Y + 1] / 255;
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }
  function fbm(x, y, oct = 4) {
    let amp = 0.5, sum = 0, f = 1;
    for (let i = 0; i < oct; i++) { sum += amp * noise2(x * f, y * f); f *= 2.03; amp *= 0.5; }
    return sum;
  }
  return { noise2, fbm, rng };
}

/* Weiche runde Sprite-Textur (Partikel/Glows) */
let _softTex = null;
function softSprite() {
  if (_softTex) return _softTex;
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  _softTex = new THREE.CanvasTexture(c);
  return _softTex;
}

/* ----------------------------------------------------------------
   1) SURFACE_WORLDS — zentrales Konfigurations-Objekt
   ------------------------------------------------------------------
   Neue Welt hinzufügen = neuen Eintrag anlegen (id muss zu WORLD.planets
   passen). Alles Weitere (Terrain, Himmel, Props, Story) läuft von hier.
   ---------------------------------------------------------------- */
export const SURFACE_WORLDS = {
  origin: {
    variant: 'ground',
    terrain: {
      seed: 1101, freq: 0.012, amp: 6.5, ridge: 0,
      flatR: 30, rimStart: 170, rimEnd: 360, rimHeight: 230, walkR: 155,
      palette: ['#3c2417', '#7a4527', '#c98a55'], slopeCol: '#2b1810',
    },
    fog: { color: '#2a1610', density: 0.0042 },
    hemi: { sky: '#ffb27a', ground: '#4a2c1a', i: 0.9 },
    sun: { color: '#ff9a50', i: 1.8, dir: [0.85, 0.14, 0.42] },
    sky: {
      top: '#0a0614', horizon: '#c96a35', night: '#05040c',
      milky: '#c9b8ff', milkyAmt: 0.85, nebula: ['#4a2c66', '#2c3a66'],
      sunGlow: { dir: [0.85, 0.06, 0.42], color: '#ff9a50', size: 900 },
      bh: { dir: [-0.5, 0.55, -0.68], size: 190, tilt: 0.5 },
    },
    ambient: ['dust'],
    props: [
      { kind: 'rock',     count: 170, color: '#6b3f24', scale: [0.7, 3.2], minR: 34, maxR: 150 },
      { kind: 'boulder',  count: 26,  color: '#59331d', scale: [2.2, 4.5], minR: 60, maxR: 148 },
      { kind: 'monolith', count: 7,   color: '#4a2c1a', scale: [4, 9],     minR: 55, maxR: 140 },
      { kind: 'shrub',    count: 64,  color: '#8a4a2e', scale: [0.6, 1.5], minR: 30, maxR: 130 },
      { kind: 'cairn',    count: 14,  color: '#7a4a2c', scale: [0.8, 1.6], minR: 32, maxR: 120 },
      { kind: 'arch',     count: 3,   color: '#54301c', scale: [7, 12],    minR: 70, maxR: 130 },
      { kind: 'column',   count: 10,  color: '#5f3822', scale: [1.4, 3.2], minR: 55, maxR: 140 },
    ],
    extras: [],
    discoveries: [
      { id: 'o1', kind: 'flora',  ang: 40,  r: 52,  title: 'Sonnenwurz',
        text: 'Eine Pflanze, die sich nie vom Licht abwendet — auf einer Welt, die es genauso hält. Logbuch: »Alles begann mit dem Blick nach oben. Wer einmal anfängt zu fragen, hört nicht wieder auf.«' },
      { id: 'o2', kind: 'rock',   ang: 150, r: 78,  title: 'Geschichtetes Gestein',
        text: 'Schicht über Schicht, wie Jahresringe. Logbuch: »Frankfurt am Main. Erste Zeilen Code, aufgeschraubte Geräte, die nie wieder ganz original zusammenkamen. Jede Schicht ein Versuch.«' },
      { id: 'o3', kind: 'relic',  ang: 250, r: 60,  title: 'Verwitterte Sternkarte',
        text: 'In den Fels geritzt: Sternbilder, sauber vermessen. Logbuch: »AstroClub der Physikalischen Gesellschaft — dort wurde aus Staunen Methode. Und aus Methode: Jugend forscht.«' },
      { id: 'o4', kind: 'signal', ang: 320, r: 96,  title: 'Altes Leuchtfeuer',
        text: 'Es sendet noch immer denselben Satz: »FOSS first. Privacy always.« Manche Prinzipien überdauern jede Verwitterung.' },
    ],
    chapter: { num: 'I', title: 'Der Anfang', done: 'Kapitel I vollständig — die Neugier hat einen Ursprung.' },
  },

  forge: {
    variant: 'ground',
    terrain: {
      seed: 2207, freq: 0.016, amp: 7.5, ridge: 5,
      flatR: 28, rimStart: 160, rimEnd: 340, rimHeight: 260, walkR: 145,
      palette: ['#48281a', '#6f4029', '#a56a44'], slopeCol: '#20100b',
    },
    fog: { color: '#261009', density: 0.004 },
    hemi: { sky: '#c86838', ground: '#38180e', i: 1.5 },
    sun: { color: '#ff8a55', i: 1.6, dir: [-0.3, 0.7, 0.4] },
    sky: {
      top: '#0c0508', horizon: '#b04018', night: '#070308',
      milky: '#ffb090', milkyAmt: 0.5, nebula: ['#66261a', '#4a1a2c'],
      bh: { dir: [0.35, 0.62, -0.62], size: 230, tilt: -0.4 },
    },
    ambient: ['embers', 'smoke'],
    props: [
      { kind: 'rock',    count: 190, color: '#2e1812', scale: [0.8, 3.6], minR: 32, maxR: 140 },
      { kind: 'vent',    count: 8,   color: '#241209', scale: [3, 6],     minR: 48, maxR: 130 },
      { kind: 'crystal', count: 34,  color: '#ff5a1e', scale: [0.5, 1.8], minR: 34, maxR: 135, glow: true },
      { kind: 'column',  count: 18,  color: '#301a12', scale: [1.2, 3.4], minR: 42, maxR: 138 },
      { kind: 'spike',   count: 22,  color: '#1e100c', scale: [0.8, 2.4], minR: 36, maxR: 130 },
    ],
    extras: ['lavaPools', 'fissures', 'geysers'],
    discoveries: [
      { id: 'f1', kind: 'tech',   ang: 25,  r: 58,  title: 'Verlassene Druckstation',
        text: 'Der Extruder ist längst erkaltet, die Schichtlinien nicht. Logbuch: »3D-Druck war der Moment, in dem Bits zu Atomen wurden — Fotobox, Halterungen, Gehäuse. Wer drucken kann, kann reparieren.«' },
      { id: 'f2', kind: 'rock',   ang: 130, r: 84,  title: 'Obsidian-Ader',
        text: 'Glas, geboren aus Hitze und Druck. Logbuch: »Die AstroCam entstand genauso: aus Fehlversuchen, Hitzeproblemen und der Sturheit, es noch einmal zu bauen.«' },
      { id: 'f3', kind: 'signal', ang: 215, r: 66,  title: 'Werkstatt-Echo',
        text: 'Ein Funkfragment, in Endlosschleife: »…Server läuft wieder, Raspberry Pi Nummer vier übernimmt…« Irgendwo blinkt immer eine LED.' },
      { id: 'f4', kind: 'flora',  ang: 300, r: 100, title: 'Aschenblüte',
        text: 'Sie wächst nur dort, wo vorher etwas geschmolzen ist. Logbuch: »Kaputt ist nur ein Zwischenzustand.«' },
    ],
    chapter: { num: 'II', title: 'Die Werkstatt', done: 'Kapitel II vollständig — mit den Händen gedacht.' },
  },

  aether: {
    variant: 'platform',
    terrain: {
      seed: 3301, freq: 0.02, amp: 0, ridge: 0,
      flatR: 60, rimStart: 60, rimEnd: 64, rimHeight: 0, walkR: 57,
      palette: ['#141330', '#1e1b45', '#2a2560'], slopeCol: '#0c0b20',
    },
    fog: { color: '#0e0a26', density: 0.0022 },
    hemi: { sky: '#8a6cff', ground: '#141030', i: 0.75 },
    sun: { color: '#cdbcff', i: 0.9, dir: [0.4, 0.7, -0.5] },
    sky: {
      top: '#0a0620', horizon: '#4a2f8a', night: '#070414',
      milky: '#cdbcff', milkyAmt: 1.0, nebula: ['#5a2f9a', '#2c3a8a', '#7a3a8a'],
      bh: { dir: [0.1, 0.5, -0.85], size: 210, tilt: 0.35 },
    },
    ambient: ['motes'],
    props: [],
    extras: ['platformDeck', 'cloudSea', 'floatRocks', 'pylons', 'drones', 'formulas'],
    discoveries: [
      { id: 'a1', kind: 'tech',   ang: 30,  r: 40, title: 'Datenarchiv',
        text: 'Racks voller Messreihen: Wahlkarten, Diagramme, Simulationsläufe. Logbuch: »Daten sind nur Rauschen — bis jemand die richtige Frage stellt. JuFoAnalytics war so eine Frage.«' },
      { id: 'a2', kind: 'relic',  ang: 140, r: 44, title: 'Okular-Station',
        text: 'Ein Teleskop, fest auf denselben Fleck Himmel gerichtet. Logbuch: »Gravitation rechnet man nicht aus, um fertig zu sein — sondern um zu sehen, wie elegant sie ist.«' },
      { id: 'a3', kind: 'signal', ang: 230, r: 38, title: 'Formel-Echo',
        text: 'Die Antenne wiederholt drei Zeichenfolgen: E=mc² · ∇·E=ρ/ε₀ · ℱ{f}. Logbuch: »Gleichungen sind die einzige Sprache, die das Universum akzentfrei spricht.«' },
      { id: 'a4', kind: 'flora',  ang: 320, r: 46, title: 'Hydroponik-Kapsel',
        text: 'Selbst hier oben wächst etwas — in nährstoffreichem Nebel. Logbuch: »Wissen ist auch nur ein Garten: Man muss regelmäßig gießen und ab und zu radikal umgraben.«' },
    ],
    chapter: { num: 'III', title: 'Der Denkraum', done: 'Kapitel III vollständig — Fragen sind der eigentliche Antrieb.' },
  },

  nexus: {
    variant: 'ground',
    terrain: {
      seed: 4409, freq: 0.011, amp: 5.5, ridge: 3,
      flatR: 30, rimStart: 165, rimEnd: 350, rimHeight: 240, walkR: 150,
      palette: ['#12293e', '#3a6a8a', '#eaf7ff'], slopeCol: '#0c1c2c',
    },
    fog: { color: '#0c1c2c', density: 0.0044 },
    hemi: { sky: '#9fd4ff', ground: '#0a1622', i: 0.75 },
    sun: { color: '#cfe8ff', i: 1.0, dir: [-0.5, 0.5, 0.6] },
    sky: {
      top: '#040a16', horizon: '#1e4a6a', night: '#030810',
      milky: '#bfe0ff', milkyAmt: 0.9, nebula: ['#1e4a7a', '#3a2c7a'],
      aurora: { color1: '#4affc0', color2: '#70d6ff' },
      bh: { dir: [0.55, 0.5, 0.62], size: 175, tilt: 0.6 },
    },
    ambient: ['snow'],
    props: [
      { kind: 'rock',    count: 130, color: '#4a7a9a', scale: [0.7, 3.0], minR: 34, maxR: 145 },
      { kind: 'crystal', count: 40,  color: '#70d6ff', scale: [0.8, 2.6], minR: 36, maxR: 140, glow: true },
      { kind: 'berg',    count: 14,  color: '#2c5a7a', scale: [8, 16],    minR: 95, maxR: 150 },
      { kind: 'spike',   count: 30,  color: '#5a9ec0', scale: [0.8, 2.6], minR: 36, maxR: 140 },
      { kind: 'arch',    count: 2,   color: '#3a6a8a', scale: [8, 11],    minR: 75, maxR: 125 },
      { kind: 'dish',    count: 3,   color: '#31506a', scale: [2.2, 3.2], minR: 46, maxR: 110 },
    ],
    extras: ['icePlates'],
    discoveries: [
      { id: 'n1', kind: 'signal', ang: 45,  r: 62,  title: 'Sendemast Alpha',
        text: 'Drei Kanäle, drei Monde: GitHub, F-Droid, Mail. Logbuch: »Ein Außenposten ist nur so gut wie seine Antwortzeit. Jedes Signal wird beantwortet.«' },
      { id: 'n2', kind: 'flora',  ang: 135, r: 80,  title: 'Gefrorene Blüte',
        text: 'Mitten im Eis, perfekt konserviert. Logbuch: »Kontakte sind wie diese Blüte: Man muss sie pflegen, sonst friert nur eine schöne Erinnerung ein.«' },
      { id: 'n3', kind: 'rock',   ang: 225, r: 70,  title: 'Eiskern-Bohrung',
        text: 'Im Kern eingeschlossen: winzige Luftblasen vergangener Projekte. Logbuch: »Alles, was je gebaut wurde, ist hier archiviert — offen zugänglich, für alle.«' },
      { id: 'n4', kind: 'relic',  ang: 315, r: 92,  title: 'Wurmloch-Kompass',
        text: 'Die Nadel zeigt beharrlich vom Planeten weg — zur Projekt-Galerie. Logbuch: »Der letzte Schritt einer Reise ist immer eine Einladung an andere, sie selbst zu machen.«' },
    ],
    chapter: { num: 'IV', title: 'Das Signal', done: 'Kapitel IV vollständig — der Kreis schließt sich.' },
  },
};

/* Das Große Ganze: wird freigeschaltet, wenn alle Fragmente aller Welten
   gefunden sind (Erzähl-Klammer über die vier Kapitel). */
const GRAND_FINALE = {
  title: 'Das Große Ganze',
  text: 'Vier Welten, ein Bauplan: <em>Neugier</em>.<br><br>' +
    'Origin fragte, Forge baute, Aether verstand, Nexus antwortet. ' +
    'Alles auf diesen Welten — jeder Stein, jedes Signal, jedes Fragment — ' +
    'gehört zu derselben Geschichte: der eines Menschen, der Code, Physik ' +
    'und Kosmos nicht trennen will.<br><br>' +
    'Das Logbuch ist vollständig. Der Rest der Geschichte wird noch geschrieben — ' +
    'vielleicht mit dir: Die Kanäle auf <strong>Nexus</strong> stehen offen.',
};

/* ----------------------------------------------------------------
   2) Modul-Zustand + DOM + Initialisierung
   ---------------------------------------------------------------- */
let hooks = null;          // Brücke zu universe.js (Renderer, Toasts, SFX, Welt-Daten, Callbacks)
let S = null;              // aktive Session (Szene, Spieler, Interaktivpunkte, Updater)
let active = false;
let rafId = null;
const surfClock = new THREE.Clock();
let surfCamera = null;

const EYE = 1.7;           // Augenhöhe in Metern
const DECK_Y = 3.0;        // Deckhöhe der Aether-Plattform

// DOM (wird in initSurface aufgelöst — Elemente stammen aus index.html)
const D = {};
function grabDom() {
  const ids = ['u-burn', 'u-surface', 's-chip-icon', 's-chip-name', 's-chip-kind', 's-log-text',
    's-reticle', 's-ret-ring', 's-ret-label', 's-hint', 's-lockprompt',
    'u-beam', 'u-beam-list', 'u-beam-close', 'u-scan', 'u-scan-body', 'u-scan-close', 'u-beamfx'];
  for (const id of ids) D[id] = document.getElementById(id);
}

export function initSurface(h) {
  hooks = h;
  grabDom();
  loadLog();
  if (D['u-beam-close']) D['u-beam-close'].addEventListener('click', () => toggleBeamMenu(false));
  if (D['u-scan-close']) D['u-scan-close'].addEventListener('click', hideScanCard);
  if (D['u-beam-list']) D['u-beam-list'].addEventListener('click', (e) => {
    const btn = e.target.closest('[data-world]');
    if (btn && !btn.disabled) beamTo(btn.dataset.world);
  });
  window.addEventListener('resize', onSurfResize);
}

export function isSurfaceActive() { return active; }

function onSurfResize() {
  if (surfCamera) {
    surfCamera.aspect = window.innerWidth / window.innerHeight;
    surfCamera.updateProjectionMatrix();
  }
  if (burn.active) sizeBurnCanvas();
}

/* ----------------------------------------------------------------
   3) burnFX — Plasma-/Reibungs-Blende (Atmosphäreneintritt/-austritt)
   ------------------------------------------------------------------
   2D-Canvas über allem: glühende Streaks + Flacker-Glut + Voll-Abdeckung
   ab k>0.82. universe.js treibt k während des Sturzflugs, surface.js
   blendet nach dem Aufbau der Oberfläche wieder aus.
   ---------------------------------------------------------------- */
const burn = { active: false, k: 0, target: null, mode: 'entry', raf: null, streaks: [], t0: 0, fade: null };

function sizeBurnCanvas() {
  const c = D['u-burn']; if (!c) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  c.width = Math.floor(window.innerWidth * dpr);
  c.height = Math.floor(window.innerHeight * dpr);
}

export const burnFX = {
  start(mode = 'entry') {
    const c = D['u-burn']; if (!c) return;
    burn.mode = mode; burn.k = 0; burn.fade = null; burn.active = true; burn.t0 = performance.now();
    sizeBurnCanvas();
    c.classList.add('is-on');
    // Streak- und Funken-Felder einmalig aufbauen
    burn.streaks = [];
    const N = 150;
    for (let i = 0; i < N; i++) {
      burn.streaks.push({
        ang: Math.random() * Math.PI * 2,
        off: Math.random(),
        spd: 0.7 + Math.random() * 1.3,
        len: 0.08 + Math.random() * 0.2,
        w: 1 + Math.random() * 3.4,
      });
    }
    burn.sparks = [];
    for (let i = 0; i < 60; i++) {
      burn.sparks.push({ ang: Math.random() * Math.PI * 2, off: Math.random(), spd: 1.2 + Math.random() * 1.6 });
    }
    if (!burn.raf) burnLoop();
  },
  set(k) { burn.k = clamp(k, 0, 1); },
  /* weich ausblenden (nach der Landung / nach der Rückkehr in den Orbit) */
  fadeOut(sec = 1.5) {
    burn.fade = { from: burn.k, t: 0, dur: sec };
  },
  stop() {
    burn.active = false; burn.k = 0; burn.fade = null;
    if (burn.raf) { cancelAnimationFrame(burn.raf); burn.raf = null; }
    const c = D['u-burn'];
    if (c) { c.classList.remove('is-on'); const ctx = c.getContext('2d'); ctx && ctx.clearRect(0, 0, c.width, c.height); }
  },
};

function burnLoop() {
  burn.raf = requestAnimationFrame(burnLoop);
  const c = D['u-burn']; if (!c || !burn.active) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  // Fade-Verwaltung
  if (burn.fade) {
    burn.fade.t += 1 / 60;
    burn.k = burn.fade.from * Math.max(0, 1 - burn.fade.t / burn.fade.dur);
    if (burn.fade.t >= burn.fade.dur) { burnFX.stop(); return; }
  }
  ctx.clearRect(0, 0, W, H);
  const k = burn.k;
  if (k <= 0.005) return;
  const t = (performance.now() - burn.t0) / 1000;
  const entry = burn.mode === 'entry';
  const hot  = entry ? '255,200,140' : '205,220,255';
  const mid  = entry ? '255,110,40'  : '150,180,255';
  const deep = entry ? '120,20,5'    : '40,50,120';

  const cx = W / 2, cy = H * (entry ? 0.58 : 0.46);   // Fluchtpunkt: Eintritt leicht unter Bildmitte
  const maxR = Math.hypot(cx, cy) * 1.1;
  ctx.globalCompositeOperation = 'lighter';

  // 1) Streaks: Plasma rast am Schiff vorbei nach außen
  for (const s of burn.streaks) {
    const head = (t * 0.55 * s.spd + s.off) % 1;
    const tail = Math.max(0, head - s.len);
    const r2 = Math.pow(head, 1.9) * maxR;
    const r1 = Math.pow(tail, 1.9) * maxR;
    const dx = Math.cos(s.ang), dy = Math.sin(s.ang);
    const flick = 0.6 + 0.4 * Math.sin(t * 21 + s.off * 40);
    const a = k * flick * sstep(0.06, 0.4, head);
    const g = ctx.createLinearGradient(cx + dx * r1, cy + dy * r1, cx + dx * r2, cy + dy * r2);
    g.addColorStop(0, `rgba(${deep},0)`);
    g.addColorStop(0.6, `rgba(${mid},${(a * 0.55).toFixed(3)})`);
    g.addColorStop(1, `rgba(${hot},${a.toFixed(3)})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = s.w * (0.6 + k);
    ctx.beginPath();
    ctx.moveTo(cx + dx * r1, cy + dy * r1);
    ctx.lineTo(cx + dx * r2, cy + dy * r2);
    ctx.stroke();
  }

  // 2) Funken: kleine glühende Teilchen, die nach außen davonrasen
  for (const sp of burn.sparks) {
    const head = (t * 0.7 * sp.spd + sp.off) % 1;
    const r = Math.pow(head, 1.5) * maxR;
    const x = cx + Math.cos(sp.ang) * r, y = cy + Math.sin(sp.ang) * r;
    const a = clamp(k * (1.3 - head) * sstep(0.04, 0.2, head), 0, 1);
    if (a < 0.02) continue;
    ctx.fillStyle = `rgba(${hot},${a.toFixed(3)})`;
    ctx.fillRect(x, y, 2.6, 2.6);
  }

  // 3) Flammenzungen am unteren Rand (nur Eintritt: Plasma leckt nach oben)
  if (entry) {
    const NT = 9;
    for (let i = 0; i < NT; i++) {
      const fx = ((i + 0.5) / NT) * W + Math.sin(t * (2.6 + i * 0.7) + i * 12.3) * W * 0.025;
      const hgt = H * (0.10 + 0.14 * k) * (0.65 + 0.35 * Math.sin(t * (8 + i * 1.3) + i * 5.1));
      const fg = ctx.createRadialGradient(fx, H + 30, 0, fx, H + 30, hgt + 90);
      fg.addColorStop(0, `rgba(${hot},${(k * 0.75).toFixed(3)})`);
      fg.addColorStop(0.45, `rgba(${mid},${(k * 0.3).toFixed(3)})`);
      fg.addColorStop(1, `rgba(${mid},0)`);
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.ellipse(fx, H + 30, (hgt + 90) * 0.42, hgt + 90, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 4) Glut-Vignette an den Rändern (pulsierend)
  const pulse = 0.85 + 0.15 * Math.sin(t * 13.7) + 0.08 * Math.sin(t * 31);
  const vg = ctx.createRadialGradient(cx, cy, maxR * 0.25, cx, cy, maxR);
  vg.addColorStop(0, `rgba(${mid},0)`);
  vg.addColorStop(0.7, `rgba(${mid},${(k * 0.22 * pulse).toFixed(3)})`);
  vg.addColorStop(1, `rgba(${hot},${(k * 0.6 * pulse).toFixed(3)})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // 5) Voll-Abdeckung: ab k>0.82 verschwindet die Welt hinter der Glut
  if (k > 0.82) {
    const cover = (k - 0.82) / 0.18;
    ctx.globalCompositeOperation = 'source-over';
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    cg.addColorStop(0, `rgba(${hot},${cover.toFixed(3)})`);
    cg.addColorStop(0.55, `rgba(${mid},${cover.toFixed(3)})`);
    cg.addColorStop(1, `rgba(${deep},${cover.toFixed(3)})`);
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);
  }
}

/* ---- Grollen (Rumble) während Ein-/Austritt: gefiltertes Rauschen ---- */
let rumble = null;
function startRumble() {
  try {
    const ac = hooks.getAudioCtx && hooks.getAudioCtx();
    if (!ac || (hooks.isMusicMuted && hooks.isMusicMuted())) return;
    const len = ac.sampleRate;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 150;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(filt); filt.connect(g); g.connect(ac.destination);
    src.start();
    rumble = { src, g, ac };
  } catch (e) { /* Audio optional */ }
}
function setRumble(k) { if (rumble) rumble.g.gain.value = clamp(k, 0, 1) * 0.5; }
function stopRumble() {
  if (!rumble) return;
  try {
    const { src, g, ac } = rumble;
    g.gain.setTargetAtTime(0, ac.currentTime, 0.2);
    setTimeout(() => { try { src.stop(); } catch (e) {} }, 700);
  } catch (e) {}
  rumble = null;
}

/* ----------------------------------------------------------------
   4) Logbuch (Entdeckungs-Fortschritt, persistiert)
   ---------------------------------------------------------------- */
const LOG_KEY = 'u-surface-log-v1';
let surfaceLog = {};
function loadLog() {
  try { surfaceLog = JSON.parse(localStorage.getItem(LOG_KEY) || '{}') || {}; } catch (e) { surfaceLog = {}; }
}
function saveLog() {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(surfaceLog)); } catch (e) {}
}
const isFound = (pid, did) => Array.isArray(surfaceLog[pid]) && surfaceLog[pid].includes(did);
function markFound(pid, did) {
  if (!surfaceLog[pid]) surfaceLog[pid] = [];
  if (!surfaceLog[pid].includes(did)) surfaceLog[pid].push(did);
  saveLog();
}
const foundCount = (pid) => (surfaceLog[pid] || []).length;
function grandTotals() {
  let found = 0, total = 0;
  for (const [pid, cfg] of Object.entries(SURFACE_WORLDS)) {
    total += cfg.discoveries.length;
    found += Math.min(foundCount(pid), cfg.discoveries.length);
  }
  return { found, total };
}

/* ----------------------------------------------------------------
   5) Terrain & Himmel
   ---------------------------------------------------------------- */
function terrainHeight(t, n, x, z) {
  const r = Math.hypot(x, z);
  let h = n.fbm(x * t.freq, z * t.freq, 4) * t.amp;
  if (t.ridge) {
    const rg = 1 - Math.abs(n.fbm(x * t.freq * 0.6 + 41.7, z * t.freq * 0.6 - 17.3, 3));
    h += rg * rg * t.ridge;
  }
  // Landezone einebnen (weicher Übergang statt Plattform-Kante)
  const flat = sstep(t.flatR, t.flatR * 2.4, r);
  h *= 0.08 + 0.92 * flat;
  // Unüberwindbarer Rand: Gebirge/Kraterwand, organisch gezackt
  const rim = sstep(t.rimStart, t.rimEnd, r);
  if (rim > 0) {
    const jag = 0.55 + 0.45 * n.fbm(x * 0.01 + 7.1, z * 0.01 - 3.4, 3) + 0.22 * n.fbm(x * 0.045, z * 0.045, 2);
    h += rim * rim * t.rimHeight * Math.max(0.2, jag);
  }
  return h;
}

function buildTerrain(cfg, n) {
  const t = cfg.terrain;
  const SIZE = 900, SEG = 160;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(t, n, pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  // Vertex-Farben: Höhen-Palette + Hangschattierung + Noise-Variation
  const c0 = new THREE.Color(t.palette[0]), c1 = new THREE.Color(t.palette[1]), c2 = new THREE.Color(t.palette[2]);
  const cs = new THREE.Color(t.slopeCol);
  const col = new Float32Array(pos.count * 3);
  const nor = geo.attributes.normal;
  const tmp = new THREE.Color();
  const hMax = Math.max(1, t.rimHeight * 0.55 + t.amp);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const hn = clamp((y + t.amp) / hMax, 0, 1);
    if (hn < 0.5) tmp.copy(c0).lerp(c1, hn * 2);
    else tmp.copy(c1).lerp(c2, (hn - 0.5) * 2);
    const vary = 0.88 + 0.24 * ((n.noise2(x * 0.08, z * 0.08) + 1) / 2);
    tmp.multiplyScalar(vary);
    const slope = clamp((1 - nor.getY(i)) * 1.8, 0, 1);
    tmp.lerp(cs, slope * 0.7);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  return mesh;
}

/* Panorama-Himmel: einmalig auf ein Equirect-Canvas gebacken (Sterne,
   Milchstraße, Nebel, Horizontglühen) -> 1 Draw-Call, kein Shader-Risiko. */
function bakeSkyTexture(sky) {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  /* Equirect-Fallstricke:
     1) Naht bei u=0/1  -> jeden Blob zusätzlich um ±W versetzt zeichnen.
     2) Pol-Pinch oben  -> oberhalb von ~10% Bildhöhe KEINE Punktdetails
        (einzelne Sterne würden am Zenit zu "Radar-Speichen" verschmiert). */
  const POLE_Y = H * 0.10;
  const blob = (x, y, r, paint) => {
    for (const ox of [0, -W, W]) {
      if (x + ox + r < 0 || x + ox - r > W) continue;
      paint(x + ox, y, r);
    }
  };
  const radial = (x, y, r, stops) => {
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [p, col] of stops) g2.addColorStop(p, col);
    ctx.fillStyle = g2;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };

  // Vertikaler Verlauf: Zenit -> Horizontglühen -> Untergrund
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky.top);
  g.addColorStop(0.44, sky.top);
  g.addColorStop(0.55, sky.horizon);
  g.addColorStop(0.62, sky.night);
  g.addColorStop(1, sky.night);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Sonnen-/Abendglut auf einer Seite (Origin: ewige Dämmerung)
  if (sky.sunGlow) {
    const su = ((Math.atan2(sky.sunGlow.dir[2], sky.sunGlow.dir[0]) / (Math.PI * 2)) + 0.75) % 1;
    blob(su * W, H * 0.52, sky.sunGlow.size, (x, y, r) => radial(x, y, r, [
      [0, sky.sunGlow.color + 'e6'], [0.25, sky.sunGlow.color + '66'], [1, sky.sunGlow.color + '00'],
    ]));
  }

  // Nebelschwaden (weit, ruhig — unterhalb der Polkappe)
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * W, y = POLE_Y + H * 0.06 + Math.random() * H * 0.32;
    const r = 120 + Math.random() * 260;
    const colHex = sky.nebula[i % sky.nebula.length];
    blob(x, y, r, (bx, by, br) => radial(bx, by, br, [[0, colHex + '2e'], [1, colHex + '00']]));
  }

  // Milchstraße: Band aus weichen Blobs entlang einer Sinuslinie + Staubbänder.
  // Die Sinuslinie hat volle Perioden -> läuft nahtlos über die u=0/1-Kante.
  const amt = sky.milkyAmt ?? 0.8;
  const bandY = (u) => H * 0.34 + Math.sin(u * Math.PI * 2 + 1.2) * H * 0.10;
  for (let i = 0; i < 240 * amt; i++) {
    const u = Math.random();
    const x = u * W, y = bandY(u) + (Math.random() - 0.5) * H * 0.09;
    const r = 24 + Math.random() * 80;
    const bright = Math.random();
    const colr = bright > 0.7 ? '#ffffff' : sky.milky;
    const a = bright > 0.7 ? '14' : '10';
    blob(x, y, r, (bx, by, br) => radial(bx, by, br, [[0, colr + a], [1, colr + '00']]));
  }
  // dunkle Staubbänder in der Bandmitte
  for (let i = 0; i < 70 * amt; i++) {
    const u = Math.random();
    const x = u * W, y = bandY(u) + (Math.random() - 0.5) * H * 0.03;
    const r = 16 + Math.random() * 50;
    blob(x, y, r, (bx, by, br) => radial(bx, by, br, [[0, 'rgba(4,4,10,0.30)'], [1, 'rgba(4,4,10,0)']]));
  }

  // Sterne: 60% gleichverteilt, 40% dichter ums Band — nie in der Polkappe
  const stars = 1500;
  for (let i = 0; i < stars; i++) {
    let x, y;
    if (i % 5 < 2) { const u = Math.random(); x = u * W; y = bandY(u) + (Math.random() - 0.5) * H * 0.16; }
    else { x = Math.random() * W; y = POLE_Y + Math.random() * (H * 0.62 - POLE_Y); }
    if (y < POLE_Y) continue;
    const m = Math.random();
    const rad = m > 0.985 ? 1.6 + Math.random() * 1.4 : m > 0.9 ? 0.9 + Math.random() * 0.7 : 0.3 + Math.random() * 0.5;
    const pick = Math.random();
    const colr = pick > 0.9 ? '173,214,255' : pick > 0.8 ? '210,190,255' : pick > 0.72 ? '255,228,196' : '255,255,255';
    const a = m > 0.985 ? 0.95 : 0.3 + Math.random() * 0.5;
    blob(x, y, rad * 2.2, (bx, by, br) => radial(bx, by, br, [[0, `rgba(${colr},${a.toFixed(2)})`], [1, `rgba(${colr},0)`]]));
  }

  // Polkappe: am Zenit laufen ALLE x-Spalten in einem Punkt zusammen — jede
  // horizontale Variation dort würde zu radialen "Radar-Speichen" verschmieren.
  // Deshalb oben weich auf eine einzige Zenitfarbe ziehen.
  const cap = ctx.createLinearGradient(0, 0, 0, H * 0.24);
  cap.addColorStop(0, sky.top);
  cap.addColorStop(0.5, sky.top + 'd9');
  cap.addColorStop(1, sky.top + '00');
  ctx.fillStyle = cap;
  ctx.fillRect(0, 0, W, H * 0.24);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSky(cfg) {
  const tex = bakeSkyTexture(cfg.sky);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2600, 72, 40), mat);
  dome.renderOrder = -10;
  return dome;
}

/* Das Schwarze Loch am Firmament — "Gargantua"-Look auf EINER gebackenen
   Canvas (gelenste Bögen über/unter dem Schatten, dünner Photonenring,
   Doppler-helle Scheibe) + opakem Kern. 2 Draw-Calls, kein Shader-Risiko. */
function bakeBlackHoleTexture() {
  const s = 512, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const cx = s / 2, cy = s / 2;
  ctx.translate(cx, cy);

  // weiter, warmer Halo
  const halo = ctx.createRadialGradient(0, 0, 40, 0, 0, 250);
  halo.addColorStop(0, 'rgba(255,170,90,0.22)');
  halo.addColorStop(0.5, 'rgba(255,140,60,0.08)');
  halo.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(-cx, -cy, s, s);

  ctx.globalCompositeOperation = 'lighter';

  // Scheibe HINTER dem Loch: durch Lensing als Bogen ÜBER den Schatten gehoben
  ctx.strokeStyle = 'rgba(255,214,150,0.75)';
  ctx.shadowColor = 'rgba(255,170,80,0.9)';
  ctx.shadowBlur = 16;
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.ellipse(0, -4, 92, 62, 0, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
  // ... und als kleinerer Bogen UNTER den Schatten gespiegelt
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,190,120,0.5)';
  ctx.beginPath(); ctx.ellipse(0, 6, 84, 40, 0, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();

  // Photonenring: haarfein, fast weiß, direkt am Schattenrand
  ctx.shadowBlur = 10;
  ctx.shadowColor = 'rgba(255,240,210,0.95)';
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = 'rgba(255,248,235,0.95)';
  ctx.beginPath(); ctx.arc(0, 0, 66, 0, Math.PI * 2); ctx.stroke();

  // Vorderseite der Akkretionsscheibe: flaches Band quer, leicht unter der Mitte
  ctx.shadowBlur = 0;
  const band = ctx.createLinearGradient(-225, 0, 225, 0);
  band.addColorStop(0.0, 'rgba(255,255,255,0)');
  band.addColorStop(0.14, 'rgba(255,250,238,0.95)');   // Doppler-Hotspot (auf uns zu rotierend)
  band.addColorStop(0.42, 'rgba(255,190,110,0.6)');
  band.addColorStop(0.72, 'rgba(230,110,45,0.35)');
  band.addColorStop(0.94, 'rgba(160,55,18,0.14)');
  band.addColorStop(1.0, 'rgba(120,40,12,0)');
  ctx.fillStyle = band;
  ctx.beginPath(); ctx.ellipse(0, 9, 224, 20, 0, 0, Math.PI * 2); ctx.fill();
  // dünner heißer Innensaum des Bandes
  const band2 = ctx.createLinearGradient(-160, 0, 160, 0);
  band2.addColorStop(0, 'rgba(255,255,255,0)');
  band2.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  band2.addColorStop(0.6, 'rgba(255,220,170,0.25)');
  band2.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = band2;
  ctx.beginPath(); ctx.ellipse(0, 8, 150, 9, 0, 0, Math.PI * 2); ctx.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSkyBlackHole(bh) {
  const group = new THREE.Group();
  const size = bh.size;

  // Die Canvas ist 512px breit und bildet auf size*2.9 ab -> Schattenradius
  // (60px) entspricht 0.34*size, Photonenring (66px) 0.374*size.
  const PLANE_W = size * 2.9;

  // Kern (absolut schwarz, verdeckt Sterne/Milchstraße)
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(PLANE_W * (60 / 512), 48),
    new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })
  );
  core.renderOrder = -8;
  group.add(core);

  // Lensing-Komposit (additiv, leicht VOR dem Kern -> Band kreuzt davor)
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE_W, PLANE_W),
    new THREE.MeshBasicMaterial({ map: bakeBlackHoleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  glow.position.z = 2;
  glow.renderOrder = -7;
  group.add(glow);
  group.userData.glow = glow;

  const dir = new THREE.Vector3(...bh.dir).normalize();
  group.position.copy(dir.multiplyScalar(2300));
  group.lookAt(0, 0, 0);
  group.rotateZ(bh.tilt);   // Scheibe geneigt ans Firmament
  return group;
}

/* Polarlicht-Vorhänge (Nexus): gebogene Planes, additive, langsam wogend */
function buildAurora(aur) {
  const group = new THREE.Group();
  const w = 512, h = 128;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const vg = ctx.createLinearGradient(0, 0, 0, h);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.35, aur.color1 + '55');
  vg.addColorStop(0.7, aur.color2 + '30');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  // vertikale Streifen (Vorhang-Struktur)
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * w;
    ctx.fillStyle = `rgba(255,255,255,${(0.02 + Math.random() * 0.06).toFixed(3)})`;
    ctx.fillRect(x, h * 0.15, 1 + Math.random() * 3, h * 0.7);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;

  for (let i = 0; i < 3; i++) {
    // Plane zum Bogen biegen: x-Koordinate auf einen Kreisbogen mappen
    const geo = new THREE.PlaneGeometry(1, 1, 48, 1);
    const R = 1500 + i * 220, arc = Math.PI * (0.5 + i * 0.14), y0 = 480 + i * 140, hgt = 260 + i * 70;
    const posA = geo.attributes.position;
    const a0 = i * 1.9;
    for (let vi = 0; vi < posA.count; vi++) {
      const u = posA.getX(vi) + 0.5;              // 0..1 entlang des Bogens
      const vv = posA.getY(vi);                    // -0.5..0.5 vertikal
      const a = a0 + u * arc;
      posA.setXYZ(vi, Math.cos(a) * R, y0 + vv * hgt, Math.sin(a) * R);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -6;
    m.userData.phase = i * 2.1;
    group.add(m);
  }
  return group;
}

/* Kometen + Sternschnuppen am Nachthimmel */
function buildComets(scene) {
  const comets = [];
  for (let i = 0; i < 2; i++) {
    const head = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softSprite(), color: 0xd8ecff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    head.scale.setScalar(16);
    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    const tail = new THREE.Line(tailGeo, new THREE.LineBasicMaterial({
      color: 0x9fc8ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    scene.add(head); scene.add(tail);
    comets.push({ head, tail, ang: Math.random() * Math.PI * 2, spd: 0.006 + Math.random() * 0.006, tiltA: 0.4 + Math.random() * 0.5, phase: i * 2.4 });
  }
  // Sternschnuppen: eine Linie, die alle paar Sekunden über den Himmel zieht
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
  const shooting = new THREE.Line(starGeo, new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  shooting.visible = false;
  scene.add(shooting);
  const st = { timer: 5 + Math.random() * 8, t: 0, run: false, from: new THREE.Vector3(), dir: new THREE.Vector3() };

  return (dt, t) => {
    for (const cm of comets) {
      cm.ang += dt * cm.spd;
      const R = 2200;
      const x = Math.cos(cm.ang) * R;
      const z = Math.sin(cm.ang) * R;
      const y = 500 + Math.sin(cm.ang * 2 + cm.phase) * 300 + Math.cos(cm.tiltA) * 300;
      cm.head.position.set(x, y, z);
      const arr = cm.tail.geometry.attributes.position.array;
      arr[0] = x; arr[1] = y; arr[2] = z;
      arr[3] = x - Math.sin(cm.ang) * -140; arr[4] = y + 26; arr[5] = z - Math.cos(cm.ang) * 140;
      cm.tail.geometry.attributes.position.needsUpdate = true;
    }
    // Sternschnuppe
    if (!st.run) {
      st.timer -= dt;
      if (st.timer <= 0) {
        st.run = true; st.t = 0;
        const a = Math.random() * Math.PI * 2;
        st.from.set(Math.cos(a) * 1800, 900 + Math.random() * 500, Math.sin(a) * 1800);
        st.dir.set((Math.random() - 0.5), -0.35, (Math.random() - 0.5)).normalize();
        shooting.visible = true;
      }
    } else {
      st.t += dt;
      const e = st.t / 1.1;
      if (e >= 1) { st.run = false; st.timer = 6 + Math.random() * 10; shooting.visible = false; }
      else {
        const p = st.from.clone().addScaledVector(st.dir, e * 900);
        const q = p.clone().addScaledVector(st.dir, -120);
        const arr = shooting.geometry.attributes.position.array;
        arr[0] = p.x; arr[1] = p.y; arr[2] = p.z;
        arr[3] = q.x; arr[4] = q.y; arr[5] = q.z;
        shooting.geometry.attributes.position.needsUpdate = true;
        shooting.material.opacity = Math.sin(e * Math.PI) * 0.9;
      }
    }
  };
}

/* ----------------------------------------------------------------
   6) Props, Extras, Interaktivpunkte
   ---------------------------------------------------------------- */
function propGeometry(kind) {
  const M = (g, x = 0, y = 0, z = 0, s = 1) => g.scale(s, s, s).translate(x, y, z);
  switch (kind) {
    case 'rock':     return new THREE.IcosahedronGeometry(1, 0);
    case 'boulder':  return new THREE.DodecahedronGeometry(1, 0);
    case 'monolith': return new THREE.BoxGeometry(0.7, 3, 0.5);
    case 'shrub':    return new THREE.ConeGeometry(0.7, 1.6, 6);
    case 'vent':     return new THREE.CylinderGeometry(0.5, 1.4, 2.4, 7);
    case 'crystal':  return new THREE.OctahedronGeometry(0.7, 0);
    case 'berg':     return new THREE.ConeGeometry(1.4, 3.2, 5);
    case 'spike':    return new THREE.ConeGeometry(0.28, 3.4, 5);
    case 'column':   return new THREE.CylinderGeometry(0.5, 0.64, 3, 6);
    // zusammengesetzte Formen (einmal gemerged -> weiter 1 Draw-Call pro Art)
    case 'arch':     return new THREE.TorusGeometry(1, 0.16, 6, 14, Math.PI);
    case 'cairn':    return mergeGeometries([
      M(new THREE.IcosahedronGeometry(1, 0), 0, 0.4, 0, 1),
      M(new THREE.IcosahedronGeometry(1, 0), 0.1, 1.15, 0.05, 0.62),
      M(new THREE.IcosahedronGeometry(1, 0), -0.06, 1.66, 0, 0.36),
    ], false);
    case 'dish':     return mergeGeometries([
      M(new THREE.CylinderGeometry(0.09, 0.14, 2.4, 6), 0, 1.2, 0, 1),
      M(new THREE.SphereGeometry(1.05, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2.4).rotateX(Math.PI * 0.82), 0, 2.5, 0.2, 1),
    ], false);
    default:         return new THREE.IcosahedronGeometry(1, 0);
  }
}

/* Boden-Offset (Faktor der Skalierung) + Rotations-Stil je Prop-Art */
const PROP_Y = { monolith: 1.2, column: 1.4, spike: 1.6, berg: 1.4, vent: 1.0, arch: 0.12, cairn: 0.0, dish: 0.0, shrub: 0.6, crystal: 0.35, rock: 0.25, boulder: 0.3 };
const PROP_UPRIGHT = new Set(['monolith', 'column', 'spike', 'berg', 'vent', 'arch', 'cairn', 'dish', 'shrub']);

function buildProps(cfg, n, groundAt, scene, exclusions) {
  const rng = makeRng(cfg.terrain.seed * 7 + 13);
  for (const spec of cfg.props) {
    const geo = propGeometry(spec.kind);
    const mat = spec.glow
      ? new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.color) })
      : new THREE.MeshLambertMaterial({ color: new THREE.Color(spec.color), flatShading: true });
    const inst = new THREE.InstancedMesh(geo, mat, spec.count);
    const dummy = new THREE.Object3D();
    let placed = 0, guard = 0;
    while (placed < spec.count && guard++ < spec.count * 12) {
      const a = rng() * Math.PI * 2;
      const r = spec.minR + rng() * (spec.maxR - spec.minR);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // Landeplatz, Pad & Co. freihalten
      let blocked = false;
      for (const ex of exclusions) {
        if (Math.hypot(x - ex.x, z - ex.z) < ex.r) { blocked = true; break; }
      }
      if (blocked) continue;
      const s = spec.scale[0] + rng() * (spec.scale[1] - spec.scale[0]);
      dummy.position.set(x, groundAt(x, z) + (PROP_Y[spec.kind] ?? 0.25) * s, z);
      const upright = PROP_UPRIGHT.has(spec.kind);
      dummy.rotation.set(
        upright ? 0 : rng() * Math.PI,
        rng() * Math.PI * 2,
        upright ? 0 : rng() * 0.6
      );
      if (spec.kind === 'crystal') dummy.rotation.set((rng() - 0.5) * 0.5, rng() * Math.PI * 2, (rng() - 0.5) * 0.7);
      if (spec.kind === 'dish') dummy.rotation.x = -0.25 - rng() * 0.3;   // Schüssel zum Himmel geneigt
      dummy.scale.set(s * (0.7 + rng() * 0.6), s, s * (0.7 + rng() * 0.6));
      if (spec.kind === 'arch' || spec.kind === 'dish') dummy.scale.set(s, s, s);   // zusammengesetzte Formen nicht verzerren
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }
}

/* -- Extras: pro Welt registrierte Sonder-Bausteine ------------------- */
function buildExtras(cfg, S) {
  for (const name of cfg.extras) {
    if (name === 'lavaPools')    buildLavaPools(S);
    if (name === 'fissures')     buildFissures(S);
    if (name === 'geysers')      buildGeysers(S);
    if (name === 'platformDeck') buildPlatformDeck(S);
    if (name === 'cloudSea')     buildCloudSea(S);
    if (name === 'floatRocks')   buildFloatRocks(S);
    if (name === 'pylons')       buildPylons(S);
    if (name === 'drones')       buildDrones(S);
    if (name === 'formulas')     buildFormulas(S);
    if (name === 'icePlates')    buildIcePlates(S);
  }
  if (cfg.sky.aurora) {
    const aur = buildAurora(cfg.sky.aurora);
    S.scene.add(aur);
    S.anim.push((dt, t) => {
      aur.children.forEach((m) => { m.material.opacity = 0.34 + 0.2 * Math.sin(t * 0.23 + m.userData.phase); });
    });
  }
}

function buildLavaPools(S) {
  const rng = makeRng(991);
  const tex = (() => {
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ff5a1e'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 4 + Math.random() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const hot = Math.random() > 0.5;
      g.addColorStop(0, hot ? 'rgba(255,220,150,0.9)' : 'rgba(120,20,5,0.8)');
      g.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const lights = [];
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2, r = 34 + rng() * 90;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rad = 5 + rng() * 9;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95, depthWrite: false });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(rad, 22), mat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, S.groundAt(x, z) + 0.25, z);
    S.scene.add(pool);
    if (lights.length < 3) {
      const pl = new THREE.PointLight(0xff6a2a, 3.2, 110, 1.5);
      pl.position.set(x, S.groundAt(x, z) + 7, z);
      S.scene.add(pl); lights.push(pl);
    }
  }
  S.anim.push((dt, t) => {
    tex.offset.x = Math.sin(t * 0.08) * 0.05;
    tex.offset.y = t * 0.012;
    for (let i = 0; i < lights.length; i++) lights[i].intensity = 2.0 + Math.sin(t * 5.1 + i * 2) * 0.5;
  });
}

/* Forge: glühende Bodenrisse — schmale additive Streifen auf dem Terrain */
function buildFissures(S) {
  const rng = makeRng(661);
  const tex = (() => {
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, 'rgba(255,90,30,0)');
    g.addColorStop(0.5, 'rgba(255,190,110,0.9)');
    g.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 128);
    return new THREE.CanvasTexture(cv);
  })();
  const mats = [];
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, r = 30 + rng() * 95;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: 0xff7a30, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const fis = new THREE.Mesh(new THREE.PlaneGeometry(0.9 + rng() * 1.1, 5 + rng() * 9), mat);
    fis.rotation.set(-Math.PI / 2, 0, rng() * Math.PI);
    fis.position.set(x, S.groundAt(x, z) + 0.22, z);
    S.scene.add(fis);
    mats.push({ mat, phase: rng() * Math.PI * 2 });
  }
  S.anim.push((dt, t) => {
    for (const f of mats) f.mat.opacity = 0.55 + 0.35 * Math.sin(t * 1.7 + f.phase);
  });
}

/* Forge: Geysire — periodische Glut-Eruptionen aus dem Boden */
function buildGeysers(S) {
  const rng = makeRng(773);
  const spots = [];
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2, r = 46 + rng() * 70;
    spots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, timer: 2 + rng() * 6 });
  }
  S.anim.push((dt) => {
    for (const sp of spots) {
      sp.timer -= dt;
      if (sp.timer <= 0) {
        sp.timer = 5 + Math.random() * 7;
        dustBurst(S, sp.x, S.groundAt(sp.x, sp.z), sp.z, 0xff8a3a);
      }
    }
  });
}

/* Aether: patrouillierende Wartungs-Drohnen mit Blinklicht */
function buildDrones(S) {
  const drones = [];
  for (let i = 0; i < 3; i++) {
    const body = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55, 0),
      new THREE.MeshLambertMaterial({ color: 0x2a3050, flatShading: true })
    );
    const lampD = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: 0x70d6ff }));
    lampD.position.y = 0.5;
    body.add(lampD);
    S.scene.add(body);
    drones.push({ body, lampD, ang: i * 2.1, r: 74 + i * 9, h: 10 + i * 3.5, spd: 0.12 + i * 0.04 });
  }
  S.anim.push((dt, t) => {
    for (const d of drones) {
      d.ang += dt * d.spd;
      d.body.position.set(Math.cos(d.ang) * d.r, DECK_Y + d.h + Math.sin(t * 0.9 + d.r) * 1.4, Math.sin(d.ang) * d.r);
      d.body.rotation.y = -d.ang;
      d.lampD.material.color.setScalar(Math.sin(t * 4 + d.r) > 0.3 ? 1 : 0.15);
      d.lampD.material.color.b = 1;
    }
  });
}

/* Aether: schwebende Formel-Hologramme jenseits der Reling */
function buildFormulas(S) {
  const texts = ['E = mc²', '∇·E = ρ/ε₀', 'ℱ{f}(ξ)'];
  const sprites = [];
  texts.forEach((txt, i) => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
    const ctx = cv.getContext('2d');
    ctx.font = '700 44px "Space Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(166,124,255,0.9)'; ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(205,188,255,0.95)';
    ctx.fillText(txt, 128, 50);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.scale.set(13, 4.9, 1);
    const a = 0.9 + i * 2.0;
    sp.position.set(Math.cos(a) * 80, DECK_Y + 9 + i * 2.5, Math.sin(a) * 80);
    S.scene.add(sp);
    sprites.push({ sp, phase: i * 1.9, y: sp.position.y });
  });
  S.anim.push((dt, t) => {
    for (const f of sprites) {
      f.sp.position.y = f.y + Math.sin(t * 0.6 + f.phase) * 0.7;
      f.sp.material.opacity = 0.62 + 0.22 * Math.sin(t * 5.2 + f.phase);   // Holo-Flimmern
    }
  });
}

/* Nexus: spiegelnde, gefrorene Teiche */
function buildIcePlates(S) {
  const rng = makeRng(881);
  const mats = [];
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2, r = 40 + rng() * 85;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbfe9ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const plate = new THREE.Mesh(new THREE.CircleGeometry(3.5 + rng() * 5, 20), mat);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(x, S.groundAt(x, z) + 0.14, z);
    S.scene.add(plate);
    mats.push({ mat, phase: rng() * Math.PI * 2 });
  }
  S.anim.push((dt, t) => {
    for (const p of mats) p.mat.opacity = 0.14 + 0.1 * Math.sin(t * 0.8 + p.phase);
  });
}

/* Aether: schwebende Sci-Fi-Plattform statt Boden */
function buildPlatformDeck(S) {
  const grp = new THREE.Group();
  // Deck-Körper
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(64, 72, 6, 48),
    new THREE.MeshLambertMaterial({ color: 0x171a30, flatShading: true })
  );
  deck.position.y = DECK_Y - 3;
  grp.add(deck);
  // leuchtendes Gitter auf der Deckfläche
  const gridTex = (() => {
    const s = 512, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = 'rgba(140,110,255,0.5)'; ctx.lineWidth = 1.5;
    for (let i = 0; i <= 16; i++) {
      const p = (i / 16) * s;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
    }
    // konzentrische Ringe
    ctx.strokeStyle = 'rgba(112,214,255,0.55)'; ctx.lineWidth = 2.5;
    for (const rr of [0.2, 0.5, 0.8]) {
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * rr * 0.5, 0, Math.PI * 2); ctx.stroke();
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const grid = new THREE.Mesh(
    new THREE.CircleGeometry(63.5, 48),
    new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = DECK_Y + 0.04;
  grp.add(grid);
  // Reling (leuchtender Ring)
  const rail = new THREE.Mesh(
    new THREE.TorusGeometry(62.5, 0.28, 10, 72),
    new THREE.MeshBasicMaterial({ color: 0x70d6ff })
  );
  rail.rotation.x = Math.PI / 2;
  rail.position.y = DECK_Y + 1.15;
  grp.add(rail);
  // Kraftfeld-Schimmer (wird heller, wenn der Spieler an den Rand läuft)
  const fieldTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(112,214,255,0)');
    g.addColorStop(0.5, 'rgba(112,214,255,0.5)');
    g.addColorStop(1, 'rgba(112,214,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  })();
  const field = new THREE.Mesh(
    new THREE.CylinderGeometry(64.5, 64.5, 22, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: fieldTex, transparent: true, opacity: 0.05, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  field.position.y = DECK_Y + 8;
  grp.add(field);
  S.scene.add(grp);
  S.anim.push((dt, t) => {
    fieldTex.offset.x = t * 0.03;
    const pr = Math.hypot(S.player.pos.x, S.player.pos.z);
    const near = sstep(44, 56, pr);
    field.material.opacity = 0.04 + near * 0.22 + Math.sin(t * 2.2) * 0.015;
  });
}

function buildCloudSea(S) {
  const tex = (() => {
    const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#181238'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 12 + Math.random() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c2 = Math.random() > 0.5 ? '90,64,180' : '58,74,170';
      g.addColorStop(0, `rgba(${c2},0.5)`);
      g.addColorStop(1, `rgba(${c2},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -130;
  sea.renderOrder = -9;
  S.scene.add(sea);
  S.anim.push((dt, t) => { tex.offset.x = t * 0.004; tex.offset.y = t * 0.0022; });
}

function buildFloatRocks(S) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x2a2452, flatShading: true });
  const N = 42;
  const inst = new THREE.InstancedMesh(geo, mat, N);
  const dummy = new THREE.Object3D();
  const rng = makeRng(777);
  for (let i = 0; i < N; i++) {
    const a = rng() * Math.PI * 2, r = 95 + rng() * 220;
    const s = 2 + rng() * 9;
    dummy.position.set(Math.cos(a) * r, -50 + rng() * 120, Math.sin(a) * r);
    dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  const grp = new THREE.Group();
  grp.add(inst);
  S.scene.add(grp);
  // Die ganze Wolke dreht extrem langsam um die Plattform -> lebendige Parallaxe
  S.anim.push((dt) => { grp.rotation.y += dt * 0.004; });
}

function buildPylons(S) {
  const rng = makeRng(555);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 58, z = Math.sin(a) * 58;
    const pyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.4, 9, 8),
      new THREE.MeshLambertMaterial({ color: 0x20244a })
    );
    pyl.position.set(x, DECK_Y + 4.5, z);
    S.scene.add(pyl);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xa67cff })
    );
    lamp.position.set(x, DECK_Y + 9.2, z);
    S.scene.add(lamp);
    const phase = rng() * Math.PI * 2;
    S.anim.push((dt, t) => {
      const b = 0.55 + 0.45 * Math.sin(t * 1.6 + phase);
      lamp.material.color.setRGB(0.65 * b + 0.2, 0.49 * b + 0.15, 1.0 * b);
    });
  }
}

/* -- Umgebungs-Partikel (Staub/Glut/Schnee/Rauch/Motes) --------------- */
function buildAmbientParticles(kind, S) {
  const N = kind === 'smoke' ? 90 : 380;
  const box = 110;
  const pos = new Float32Array(N * 3);
  const seedRng = makeRng(kind.length * 999 + 5);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (seedRng() - 0.5) * box * 2;
    pos[i * 3 + 1] = seedRng() * box * 0.5;
    pos[i * 3 + 2] = (seedRng() - 0.5) * box * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const style = {
    dust:   { color: 0xd8a878, size: 0.5, op: 0.35, add: true },
    embers: { color: 0xff8a3a, size: 0.7, op: 0.8,  add: true },
    snow:   { color: 0xeaf6ff, size: 0.6, op: 0.85, add: false },
    smoke:  { color: 0x555555, size: 5.0, op: 0.16, add: false },
    motes:  { color: 0x9fd4ff, size: 0.5, op: 0.5,  add: true },
  }[kind] || { color: 0xffffff, size: 0.5, op: 0.4, add: true };
  const mat = new THREE.PointsMaterial({
    color: style.color, size: style.size, map: softSprite(), transparent: true, opacity: style.op,
    blending: style.add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  S.scene.add(pts);
  const arr = geo.attributes.position.array;
  const phase = new Float32Array(N);
  for (let i = 0; i < N; i++) phase[i] = seedRng() * Math.PI * 2;

  S.anim.push((dt, t) => {
    const px = S.player.pos.x, pz = S.player.pos.z;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      if (kind === 'snow')        { arr[j + 1] -= dt * 3.2; arr[j] += Math.sin(t * 0.8 + phase[i]) * dt * 1.4; }
      else if (kind === 'embers') { arr[j + 1] += dt * (2 + Math.sin(phase[i]) * 1.2); arr[j] += Math.sin(t * 1.4 + phase[i]) * dt * 1.8; }
      else if (kind === 'smoke')  { arr[j + 1] += dt * 2.6; arr[j] += Math.sin(t * 0.5 + phase[i]) * dt * 0.9; }
      else if (kind === 'dust')   { arr[j] += dt * 2.4; arr[j + 1] += Math.sin(t * 0.6 + phase[i]) * dt * 0.5; }
      else                        { arr[j + 1] += Math.sin(t * 0.7 + phase[i]) * dt * 0.7; arr[j] += Math.cos(t * 0.5 + phase[i]) * dt * 0.5; }
      // Wrap um den Spieler
      if (arr[j] - px > box) arr[j] -= box * 2; else if (arr[j] - px < -box) arr[j] += box * 2;
      if (arr[j + 2] - pz > box) arr[j + 2] -= box * 2; else if (arr[j + 2] - pz < -box) arr[j + 2] += box * 2;
      if (arr[j + 1] > box) arr[j + 1] = 0; else if (arr[j + 1] < -4) arr[j + 1] = box * 0.7;
    }
    geo.attributes.position.needsUpdate = true;
  });
}

/* -- Warp-Pad: leuchtende Teleport-Plattform -------------------------- */
function buildWarpPad(S, x, z) {
  const accent = new THREE.Color(S.planetData.accent || '#70d6ff');
  const y = S.groundAt(x, z);
  const grp = new THREE.Group();
  grp.position.set(x, y, z);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.9, 0.4, 24),
    new THREE.MeshLambertMaterial({ color: 0x13151f, flatShading: true })
  );
  base.position.y = 0.2;
  grp.add(base);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.0, 0.11, 10, 42),
    new THREE.MeshBasicMaterial({ color: accent })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.44;
  grp.add(ring);

  // Wirbel-Scheibe
  const swirlTex = (() => {
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.translate(s / 2, s / 2);
    for (let i = 0; i < 5; i++) {
      ctx.rotate((Math.PI * 2) / 5);
      const g = ctx.createLinearGradient(0, 0, s / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.0)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(10, 0, s * 0.3, -0.8, 1.4); ctx.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    return t;
  })();
  const swirl = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 28),
    new THREE.MeshBasicMaterial({ map: swirlTex, color: accent, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  swirl.rotation.x = -Math.PI / 2;
  swirl.position.y = 0.46;
  grp.add(swirl);

  // Lichtsäule
  const beamTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 128);
    return new THREE.CanvasTexture(cv);
  })();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 2.6, 11, 18, 1, true),
    new THREE.MeshBasicMaterial({ map: beamTex, color: accent, transparent: true, opacity: 0.22, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  beam.position.y = 5.9;
  grp.add(beam);

  // aufsteigende Partikel
  const N = 40;
  const ppos = new Float32Array(N * 3);
  const rng = makeRng(31 + x);
  for (let i = 0; i < N; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 2.6;
    ppos[i * 3] = Math.cos(a) * r; ppos[i * 3 + 1] = rng() * 10; ppos[i * 3 + 2] = Math.sin(a) * r;
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  const parts = new THREE.Points(pgeo, new THREE.PointsMaterial({
    color: accent, size: 0.35, map: softSprite(), transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  grp.add(parts);

  const light = new THREE.PointLight(accent, 1.6, 26, 1.8);
  light.position.y = 3;
  grp.add(light);

  S.scene.add(grp);
  S.anim.push((dt, t) => {
    swirl.rotation.z = t * 0.9;
    beam.material.opacity = 0.18 + 0.08 * Math.sin(t * 2.4);
    const arr = pgeo.attributes.position.array;
    for (let i = 0; i < N; i++) {
      arr[i * 3 + 1] += dt * (1.6 + (i % 5) * 0.4);
      if (arr[i * 3 + 1] > 10.5) arr[i * 3 + 1] = 0.2;
    }
    pgeo.attributes.position.needsUpdate = true;
  });

  S.interactables.push({
    kind: 'pad', pos: new THREE.Vector3(x, y + 1, z), radius: 4.6,
    name: 'Warp-Pad', verb: 'Beam-Netzwerk',
    act: () => toggleBeamMenu(true),
  });
}

/* -- Projekt-Hologramme ------------------------------------------------ */
function holoCardTexture(title, sub, accent) {
  const W = 512, H = 300;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(8,14,28,0.88)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = accent; ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  // Scanlines
  ctx.fillStyle = 'rgba(140,200,255,0.05)';
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);
  ctx.fillStyle = accent;
  ctx.font = '600 15px "Space Mono", monospace';
  ctx.fillText('◈ HOLO-ARCHIV', 28, 44);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 30px Inter, sans-serif';
  const words = String(title).split(' ');
  let line = '', ty = 100;
  for (const w of words) {
    if (ctx.measureText(line + w).width > W - 60) { ctx.fillText(line, 28, ty); ty += 38; line = w + ' '; }
    else line += w + ' ';
    if (ty > 180) break;
  }
  ctx.fillText(line.trim(), 28, ty);
  ctx.fillStyle = 'rgba(200,220,255,0.75)';
  ctx.font = '400 17px Inter, sans-serif';
  let line2 = '', ty2 = ty + 44;
  for (const w of String(sub || '').split(' ')) {
    if (ctx.measureText(line2 + w).width > W - 60) { ctx.fillText(line2, 28, ty2); ty2 += 24; line2 = w + ' '; }
    else line2 += w + ' ';
    if (ty2 > H - 46) break;
  }
  ctx.fillText(line2.trim(), 28, ty2);
  ctx.fillStyle = accent;
  ctx.font = '600 14px "Space Mono", monospace';
  ctx.fillText('[E] Details', 28, H - 24);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildHolograms(S) {
  const pd = S.planetData;
  const accent = pd.accent || '#70d6ff';
  // Inhalte: gematchte Projekte, sonst Links der Welt, sonst Steckbrief
  let items = (hooks.matchProjects ? hooks.matchProjects(pd) : []).slice(0, 3).map(pr => ({
    title: pr.title, sub: pr.description || '', url: (pr.links && pr.links[0] && pr.links[0].url) || null, icon: 'fa-diagram-project',
  }));
  if (!items.length && Array.isArray(pd.links) && pd.links.length) {
    items = pd.links.slice(0, 3).map(l => ({ title: l.text, sub: 'Externer Kanal — Verbindung herstellen.', url: l.url, icon: 'fa-satellite-dish' }));
  }
  if (!items.length) {
    items = [{ title: pd.title || pd.name, sub: (pd.facts || []).join(' · ') || pd.lead || '', url: null, icon: 'fa-user-astronaut' }];
  }
  const baseAng = Math.PI * 1.25;                       // Bogen gegenüber dem Schiff
  items.forEach((item, i) => {
    const a = baseAng + (i - (items.length - 1) / 2) * 0.5;
    const r = 26;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = S.groundAt(x, z);
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.75, 1.0, 10),
      new THREE.MeshLambertMaterial({ color: 0x141824, flatShading: true })
    );
    ped.position.y = 0.5;
    grp.add(ped);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(1.7, 2.6, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.y = 2.3;
    grp.add(beam);
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 2.0),
      new THREE.MeshBasicMaterial({ map: holoCardTexture(item.title, item.sub, accent), transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false })
    );
    card.position.y = 3.6;
    grp.add(card);
    S.scene.add(grp);
    const phase = i * 1.7;
    S.anim.push((dt, t) => {
      card.position.y = 3.6 + Math.sin(t * 0.9 + phase) * 0.14;
      card.material.opacity = 0.86 + 0.1 * Math.sin(t * 7 + phase);   // Holo-Flimmern
      // sanft zum Spieler drehen (nur Yaw)
      const dy = Math.atan2(S.player.pos.x - grp.position.x, S.player.pos.z - grp.position.z);
      card.rotation.y += (dy - card.rotation.y) * Math.min(1, dt * 2.4);
    });
    S.interactables.push({
      kind: 'holo', pos: new THREE.Vector3(x, y + 2.4, z), radius: 5.4,
      name: item.title, verb: 'Details', item,
      act: () => showHoloCard(item, accent),
    });
  });
}

/* -- Entdeckungen: Flora / Gestein / Signale / Relikte ----------------- */
function discoveryMesh(kind, accent) {
  const grp = new THREE.Group();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softSprite(), color: new THREE.Color(accent), transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.setScalar(3.2); glow.position.y = 1.1;
  grp.add(glow);
  if (kind === 'flora') {
    for (let i = 0; i < 4; i++) {
      const stem = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 1.3 + i * 0.3, 5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(0.8) })
      );
      stem.position.set(Math.cos(i * 1.6) * 0.4, (1.3 + i * 0.3) / 2, Math.sin(i * 1.6) * 0.4);
      grp.add(stem);
    }
  } else if (kind === 'rock' || kind === 'relic') {
    const m1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), new THREE.MeshLambertMaterial({ color: 0x3a3a46, flatShading: true }));
    m1.position.y = 0.6; m1.rotation.set(0.4, 1.2, 0.2);
    grp.add(m1);
    if (kind === 'relic') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 0.16), new THREE.MeshLambertMaterial({ color: 0x2c2c38, flatShading: true }));
      slab.position.y = 1.2; slab.rotation.set(-0.15, 0.5, 0.08);
      grp.add(slab);
    }
  } else if (kind === 'signal' || kind === 'tech') {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x3a4050 }));
    mast.position.y = 1.3;
    grp.add(mast);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5a5a }));
    tip.position.y = 2.7;
    grp.add(tip);
    grp.userData.blink = tip;
    if (kind === 'tech') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.8), new THREE.MeshLambertMaterial({ color: 0x1c2230, flatShading: true }));
      box.position.y = 0.45;
      grp.add(box);
    }
  }
  return grp;
}

const KIND_LABEL = { flora: 'FLORA-SCAN', rock: 'GEOLOGIE-SCAN', signal: 'SIGNAL-ANALYSE', relic: 'RELIKT-SCAN', tech: 'TECH-SCAN' };
const KIND_ICON  = { flora: 'fa-seedling', rock: 'fa-mountain', signal: 'fa-satellite-dish', relic: 'fa-scroll', tech: 'fa-microchip' };

function buildDiscoveries(S) {
  const pd = S.planetData, cfg = S.cfg;
  const accent = pd.accent || '#70d6ff';
  cfg.discoveries.forEach((d) => {
    const a = (d.ang * Math.PI) / 180;
    const x = Math.cos(a) * d.r, z = Math.sin(a) * d.r;
    const y = S.groundAt(x, z);
    const grp = discoveryMesh(d.kind, accent);
    grp.position.set(x, y, z);
    S.scene.add(grp);
    const found = isFound(pd.id, d.id);
    // Marker: pulsierende Raute über unentdeckten Fundstellen
    let marker = null;
    if (!found) {
      marker = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softSprite(), color: 0x70d6ff, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      marker.scale.setScalar(1.1);
      marker.position.set(x, y + 3.6, z);
      S.scene.add(marker);
    }
    S.anim.push((dt, t) => {
      if (marker) {
        marker.position.y = y + 3.4 + Math.sin(t * 1.8) * 0.25;
        marker.material.opacity = 0.5 + 0.35 * Math.sin(t * 2.6);
      }
      if (grp.userData.blink) grp.userData.blink.material.color.setScalar(0.4 + 0.6 * (Math.sin(t * 3.4) > 0 ? 1 : 0.15));
    });
    S.interactables.push({
      kind: 'discovery', pos: new THREE.Vector3(x, y + 1.2, z), radius: 5.0,
      name: d.title, verb: found ? 'erneut lesen' : 'scannen', data: d, marker, found,
      act: (it) => startScan(it),
    });
  });
}

/* -- Geparktes Schiff --------------------------------------------------- */
function buildParkedShip(S) {
  const grp = new THREE.Group();
  const tpl = hooks.getShipTemplate && hooks.getShipTemplate();
  if (tpl) {
    const clone = tpl.clone(true);
    // Geometrien/Materialien werden mit dem Weltraum-Schiff geteilt -> beim
    // Aufräumen NICHT freigeben (sonst zerstört die Landung das Original).
    clone.traverse((o) => { o.userData.noDispose = true; });
    grp.add(clone);
  } else {
    // Fallback ohne GLB: stilisierter Rumpf
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 6, 6, 12), new THREE.MeshLambertMaterial({ color: 0x8a90a0, flatShading: true }));
    body.rotation.x = Math.PI / 2;
    grp.add(body);
  }
  const x = 9, z = -14;
  const y = S.groundAt(x, z);
  grp.position.set(x, y + 2.1, z);
  grp.rotation.y = 0.7;
  S.scene.add(grp);

  // Lande-Glow unterm Schiff + Positionslicht
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(5.4, 24),
    new THREE.MeshBasicMaterial({ color: 0x70d6ff, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(x, y + 0.14, z);
  S.scene.add(glow);
  const light = new THREE.PointLight(0x70d6ff, 0.9, 30, 1.8);
  light.position.set(x, y + 5, z);
  S.scene.add(light);
  S.anim.push((dt, t) => {
    glow.material.opacity = 0.07 + 0.05 * Math.sin(t * 1.7);
    light.intensity = 0.7 + 0.3 * Math.sin(t * 1.7);
  });

  S.ship = { group: grp, x, z, baseY: y + 2.1 };
  S.interactables.push({
    kind: 'ship', pos: new THREE.Vector3(x, y + 2, z), radius: 7.5,
    name: 'Interstellar Ranger', verb: 'abheben',
    act: () => depart(),
  });
}

/* Staub-/Schnee-Aufwirbelung bei Landung & Start */
function dustBurst(S, x, y, z, color = 0xbfae98) {
  const N = 70;
  const pos = new Float32Array(N * 3);
  const vel = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = x; pos[i * 3 + 1] = y + 0.4; pos[i * 3 + 2] = z;
    vel.push(new THREE.Vector3(Math.cos(a) * (4 + Math.random() * 9), 1.5 + Math.random() * 3, Math.sin(a) * (4 + Math.random() * 9)));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color, size: 1.4, map: softSprite(), transparent: true, opacity: 0.7, depthWrite: false,
  }));
  S.scene.add(pts);
  const state = { t: 0, life: 1.6 };
  const upd = (dt) => {
    state.t += dt;
    const arr = geo.attributes.position.array;
    for (let i = 0; i < N; i++) {
      const v = vel[i];
      arr[i * 3] += v.x * dt; arr[i * 3 + 1] += v.y * dt; arr[i * 3 + 2] += v.z * dt;
      v.multiplyScalar(1 - dt * 1.4); v.y -= dt * 2.4;
    }
    geo.attributes.position.needsUpdate = true;
    pts.material.opacity = 0.7 * Math.max(0, 1 - state.t / state.life);
    if (state.t >= state.life) {
      S.scene.remove(pts); geo.dispose(); pts.material.dispose();
      const idx = S.anim.indexOf(upd); if (idx >= 0) S.anim.splice(idx, 1);
    }
  };
  S.anim.push(upd);
}

/* ----------------------------------------------------------------
   7) Session-Aufbau
   ---------------------------------------------------------------- */
function buildSession(planetData, cfg) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color(cfg.fog.color), cfg.fog.density);

  if (!surfCamera) {
    surfCamera = new THREE.PerspectiveCamera(71, window.innerWidth / window.innerHeight, 0.1, 6000);
    surfCamera.rotation.order = 'YXZ';
  }

  const noise = makeNoise(cfg.terrain.seed);
  S = {
    planetData, cfg, scene, camera: surfCamera, noise,
    interactables: [], anim: [], tweens: [], time: 0,
    cinematic: true, busy: false, focus: null,
    player: { pos: new THREE.Vector3(0, 0, 12), yaw: Math.PI, pitch: 0, vel: new THREE.Vector3(), keys: new Set(), locked: false, bobT: 0, moved: false },
    ship: null, scan: null,
  };
  S.groundAt = cfg.variant === 'platform'
    ? () => DECK_Y
    : (x, z) => terrainHeight(cfg.terrain, noise, x, z);

  // Licht
  const hemi = new THREE.HemisphereLight(new THREE.Color(cfg.hemi.sky), new THREE.Color(cfg.hemi.ground), cfg.hemi.i);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(cfg.sun.color), cfg.sun.i);
  sun.position.set(cfg.sun.dir[0] * 200, cfg.sun.dir[1] * 200, cfg.sun.dir[2] * 200);
  scene.add(sun);
  // "Anzugs-Lampe": weiches Licht am Spieler -> der Nahbereich bleibt auf
  // jeder Welt lesbar, ohne die Fern-Stimmung aufzuhellen
  const lamp = new THREE.PointLight(0xfff2e0, 0.85, 48, 1.7);
  scene.add(lamp);
  S.anim.push(() => lamp.position.set(surfCamera.position.x, surfCamera.position.y + 1.5, surfCamera.position.z));

  // Boden / Plattform
  if (cfg.variant !== 'platform') scene.add(buildTerrain(cfg, noise));

  // Himmel: Panorama + Schwarzes Loch + Kometen
  scene.add(buildSky(cfg));
  const bhGroup = buildSkyBlackHole(cfg.sky.bh);
  scene.add(bhGroup);
  S.anim.push((dt, t) => {
    // subtiles "Atmen" des Lensing-Glühens — der Schatten selbst bleibt starr
    const gl = bhGroup.userData.glow;
    if (gl) { gl.material.opacity = 0.92 + Math.sin(t * 1.1) * 0.08; gl.scale.setScalar(1 + Math.sin(t * 0.7) * 0.012); }
  });
  S.anim.push(buildComets(scene));

  // Sonder-Bausteine + Props + Partikel
  buildExtras(cfg, S);
  const exclusions = [
    { x: 0, z: 12, r: 8 },     // Spieler-Spawn
    { x: 9, z: -14, r: 12 },   // Schiff
    { x: -17, z: 11, r: 8 },   // Warp-Pad
    { x: -18, z: -19, r: 10 }, // Hologramm-Bogen (grob)
  ];
  if (cfg.props.length) buildProps(cfg, noise, S.groundAt, scene, exclusions);
  for (const kind of cfg.ambient) buildAmbientParticles(kind, S);

  // Interaktive Ebene
  buildWarpPad(S, -17, 11);
  buildHolograms(S);
  buildDiscoveries(S);
  buildParkedShip(S);

  // HUD-Reste der letzten Session löschen (z. B. stehengebliebenes Reticle-Label)
  _lastLabel = '';
  if (D['s-ret-label']) D['s-ret-label'].textContent = '';
  if (D['s-reticle']) D['s-reticle'].classList.remove('is-target', 'is-scanning');

  // Spieler initial platzieren
  const p = S.player;
  p.pos.set(0, S.groundAt(0, 12) + EYE, 12);
  p.yaw = Math.atan2(S.ship.x - 0, S.ship.z - 12) + Math.PI;   // Blick Richtung Schiff
  surfCamera.position.copy(p.pos);
  surfCamera.rotation.set(0, p.yaw, 0);
}

function disposeSession() {
  if (!S) return;
  for (const tw of S.tweens) { try { tw.kill && tw.kill(); } catch (e) {} }
  S.scene.traverse((o) => {
    if (o.userData && o.userData.noDispose) return;
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (m.userData && m.userData.noDispose) continue;
      if (m.map && m.map !== _softTex) m.map.dispose();
      m.dispose();
    }
  });
  S = null;
}

/* ----------------------------------------------------------------
   8) Spieler-Steuerung (First Person, Pointer-Lock + Drag-Fallback)
   ---------------------------------------------------------------- */
const WALK = { accel: 46, damp: 9, max: 7, sprintMax: 13.5 };
let dragLook = null;

function onSurfKeyDown(e) {
  if (!active || !S) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') { hideScanCard(); toggleBeamMenu(false); return; }
  if (S.cinematic || S.busy) return;
  if (['w', 'a', 's', 'd', 'shift'].includes(k) || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const map = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' };
    S.player.keys.add(map[k] || k);
    hideHintSoon();
    e.preventDefault();
  }
  if (k === 'e' || e.key === 'Enter') {
    if (D['u-scan'] && D['u-scan'].classList.contains('is-open')) { hideScanCard(); return; }
    if (D['u-beam'] && D['u-beam'].classList.contains('is-open')) { toggleBeamMenu(false); return; }
    if (S.focus) { S.focus.act(S.focus); e.preventDefault(); }
  }
}
function onSurfKeyUp(e) {
  if (!S) return;
  const k = e.key.toLowerCase();
  const map = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' };
  S.player.keys.delete(map[k] || k);
}
function onSurfMouseMove(e) {
  if (!active || !S || S.cinematic) return;
  if (S.player.locked) {
    S.player.yaw -= e.movementX * 0.0021;
    S.player.pitch = clamp(S.player.pitch - e.movementY * 0.0021, -1.45, 1.45);
  } else if (dragLook) {
    S.player.yaw -= (e.clientX - dragLook.x) * 0.004;
    S.player.pitch = clamp(S.player.pitch - (e.clientY - dragLook.y) * 0.004, -1.45, 1.45);
    dragLook.x = e.clientX; dragLook.y = e.clientY;
  }
}
function onSurfMouseDown(e) {
  if (!active || !S || S.cinematic || S.busy) return;
  if (e.target.closest && e.target.closest('.u-beam, .u-scan, .u-hud')) return;
  if (!S.player.locked) {
    const canvas = hooks.renderer.domElement;
    if (canvas.requestPointerLock) canvas.requestPointerLock();
    dragLook = { x: e.clientX, y: e.clientY };
  }
}
function onSurfMouseUp() { dragLook = null; }
function onPointerLockChange() {
  if (!S) return;
  S.player.locked = document.pointerLockElement === hooks.renderer.domElement;
  showLockPrompt(!S.player.locked && !S.cinematic && !S.busy);
}

function attachControls() {
  window.addEventListener('keydown', onSurfKeyDown, true);   // capture: vor universe.js
  window.addEventListener('keyup', onSurfKeyUp, true);
  window.addEventListener('mousemove', onSurfMouseMove);
  window.addEventListener('mousedown', onSurfMouseDown);
  window.addEventListener('mouseup', onSurfMouseUp);
  document.addEventListener('pointerlockchange', onPointerLockChange);
}
function detachControls() {
  window.removeEventListener('keydown', onSurfKeyDown, true);
  window.removeEventListener('keyup', onSurfKeyUp, true);
  window.removeEventListener('mousemove', onSurfMouseMove);
  window.removeEventListener('mousedown', onSurfMouseDown);
  window.removeEventListener('mouseup', onSurfMouseUp);
  document.removeEventListener('pointerlockchange', onPointerLockChange);
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) {} }
}

const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3(), _acc = new THREE.Vector3(), _try = new THREE.Vector3();
function updatePlayer(dt) {
  const p = S.player;
  const t = S.cfg.terrain;
  _fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  _rgt.set(-_fwd.z, 0, _fwd.x);
  _acc.set(0, 0, 0);
  if (p.keys.has('w')) _acc.add(_fwd);
  if (p.keys.has('s')) _acc.sub(_fwd);
  if (p.keys.has('d')) _acc.add(_rgt);
  if (p.keys.has('a')) _acc.sub(_rgt);
  const sprint = p.keys.has('shift');
  if (_acc.lengthSq() > 0) { _acc.normalize().multiplyScalar(WALK.accel); p.moved = true; }
  p.vel.addScaledVector(_acc, dt);
  p.vel.multiplyScalar(Math.exp(-WALK.damp * dt * (_acc.lengthSq() ? 0.35 : 1)));
  const maxV = sprint ? WALK.sprintMax : WALK.max;
  if (p.vel.length() > maxV) p.vel.setLength(maxV);

  // Bewegungsversuch + Steigungs-Check (zu steil = gleiten statt klettern)
  const step = p.vel.clone().multiplyScalar(dt);
  const curH = S.groundAt(p.pos.x, p.pos.z);
  _try.copy(p.pos).add(step);
  const dist = Math.max(1e-5, Math.hypot(step.x, step.z));
  const newH = S.groundAt(_try.x, _try.z);
  if ((newH - curH) / dist > 1.2) {
    // an der Wand entlanggleiten: Achsen einzeln probieren
    const hx = S.groundAt(p.pos.x + step.x, p.pos.z);
    const hz = S.groundAt(p.pos.x, p.pos.z + step.z);
    if ((hx - curH) / Math.max(1e-5, Math.abs(step.x)) <= 1.2) p.pos.x += step.x;
    else if ((hz - curH) / Math.max(1e-5, Math.abs(step.z)) <= 1.2) p.pos.z += step.z;
    p.vel.multiplyScalar(0.6);
  } else {
    p.pos.x = _try.x; p.pos.z = _try.z;
  }

  // begehbaren Radius weich begrenzen (Rand ist ohnehin Gebirge/Kraftfeld)
  const r = Math.hypot(p.pos.x, p.pos.z);
  if (r > t.walkR) {
    const k = t.walkR / r;
    p.pos.x *= k; p.pos.z *= k;
    p.vel.multiplyScalar(0.5);
  }

  // Boden folgen + Kopfwippen
  const speed = p.vel.length();
  p.bobT += dt * (2 + speed * 0.9);
  const bob = Math.sin(p.bobT * 3.1) * 0.05 * clamp(speed / WALK.max, 0, 1);
  const targetY = S.groundAt(p.pos.x, p.pos.z) + EYE + bob;
  p.pos.y = lerp(p.pos.y, targetY, 1 - Math.exp(-14 * dt));

  S.camera.position.copy(p.pos);
  S.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');

  // Sprint-FOV
  const tf = 71 + (sprint && speed > 4 ? 6 : 0);
  if (Math.abs(S.camera.fov - tf) > 0.05) { S.camera.fov += (tf - S.camera.fov) * Math.min(1, dt * 6); S.camera.updateProjectionMatrix(); }
}

/* ----------------------------------------------------------------
   9) Interaktion: Fokus, Scannen, Panels
   ---------------------------------------------------------------- */
let _lastLabel = '';
function updateInteraction(dt) {
  const p = S.player;
  _fwd.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
  let best = null, bestScore = -1;
  for (const it of S.interactables) {
    const d = it.pos.distanceTo(p.pos);
    if (d > it.radius + 2.5) continue;
    _try.copy(it.pos).sub(p.pos).normalize();
    const dot = _try.dot(_fwd);
    if (dot < (d < 3 ? 0.15 : 0.6)) continue;
    const score = dot * 2 - d * 0.08;
    if (score > bestScore) { bestScore = score; best = it; }
  }
  if (S.focus !== best) { S.focus = best; if (S.scan && (!best || S.scan.it !== best)) cancelScan(); }

  const lbl = best ? `${best.name}   [E] ${best.verb}` : '';
  if (lbl !== _lastLabel) {
    _lastLabel = lbl;
    if (D['s-ret-label']) D['s-ret-label'].textContent = lbl;
    if (D['s-reticle']) D['s-reticle'].classList.toggle('is-target', !!best);
  }

  // laufender Scan
  if (S.scan) {
    if (S.player.vel.length() > 2.5) { cancelScan(); return; }
    S.scan.t += dt;
    const k = clamp(S.scan.t / S.scan.dur, 0, 1);
    if (D['s-ret-ring']) D['s-ret-ring'].style.background = `conic-gradient(var(--color-accent-secondary, #70d6ff) ${(k * 360).toFixed(0)}deg, rgba(255,255,255,0.12) 0deg)`;
    if (k >= 1) completeScan();
  }
}

function startScan(it) {
  if (it.kind !== 'discovery') return;
  if (S.scan) return;
  hideScanCard();
  S.scan = { it, t: 0, dur: it.found ? 0.35 : 1.4 };
  if (D['s-reticle']) D['s-reticle'].classList.add('is-scanning');
  hooks.playSfx && hooks.playSfx('lock');
}
function cancelScan() {
  S.scan = null;
  if (D['s-reticle']) D['s-reticle'].classList.remove('is-scanning');
  if (D['s-ret-ring']) D['s-ret-ring'].style.background = '';
}
function completeScan() {
  const it = S.scan.it;
  cancelScan();
  const pd = S.planetData, d = it.data;
  const first = !isFound(pd.id, d.id);
  markFound(pd.id, d.id);
  it.found = true; it.verb = 'erneut lesen';
  _lastLabel = '';
  if (it.marker) { it.marker.visible = false; }
  hooks.playSfx && hooks.playSfx('activate');
  updateLogHud();

  const n = foundCount(pd.id), total = S.cfg.discoveries.length;
  const icon = KIND_ICON[d.kind] || 'fa-microscope';
  showScanCard(`
    <div class="u-scan-kicker"><i class="fas ${icon}"></i> ${KIND_LABEL[d.kind] || 'SCAN'}</div>
    <h3>${d.title}</h3>
    <p>${d.text}</p>
    <div class="u-scan-meta">Fragment ${n}/${total} · ${pd.name}</div>
  `, pd.accent);

  if (first) {
    if (n === total) {
      setTimeout(() => {
        hooks.showToast && hooks.showToast(`<i class="fas fa-book-open"></i> ${S.cfg.chapter.done}`, pd.accent);
        const g = grandTotals();
        if (g.found >= g.total) setTimeout(showGrandFinale, 2600);
      }, 900);
    } else {
      hooks.showToast && hooks.showToast(`<i class="fas fa-book"></i> Logbuch-Fragment gesichert · <span class="u-toast-strong">${n}/${total}</span>`, pd.accent);
    }
  }
}

function showGrandFinale() {
  showScanCard(`
    <div class="u-scan-kicker u-scan-kicker--gold"><i class="fas fa-trophy"></i> LOGBUCH VOLLSTÄNDIG</div>
    <h3>${GRAND_FINALE.title}</h3>
    <p>${GRAND_FINALE.text}</p>
  `, '#ffd27a');
  hooks.playSfx && hooks.playSfx('warp');
}

function showHoloCard(item, accent) {
  hooks.playSfx && hooks.playSfx('activate');
  const link = item.url ? `<a class="u-scan-link" href="${item.url}" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square"></i> Öffnen</a>` : '';
  showScanCard(`
    <div class="u-scan-kicker"><i class="fas ${item.icon || 'fa-diagram-project'}"></i> HOLO-ARCHIV</div>
    <h3>${item.title}</h3>
    <p>${item.sub || ''}</p>
    ${link}
  `, accent);
}

function showScanCard(html, accent) {
  const el = D['u-scan']; if (!el) return;
  D['u-scan-body'].innerHTML = html;
  el.style.setProperty('--scan-accent', accent || '#70d6ff');
  el.classList.add('is-open');
  el.setAttribute('aria-hidden', 'false');
}
function hideScanCard() {
  const el = D['u-scan']; if (!el) return;
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
}

/* -- Beam-Menü (Warp-Pad) ---------------------------------------------- */
function toggleBeamMenu(force) {
  const el = D['u-beam']; if (!el) return;
  const open = force !== undefined ? force : !el.classList.contains('is-open');
  if (open && S) {
    hideScanCard();
    // Liste aufbauen
    const cur = S.planetData.id;
    D['u-beam-list'].innerHTML = hooks.worlds.map((w) => {
      const cfgW = SURFACE_WORLDS[w.id];
      if (!cfgW) return '';
      const found = foundCount(w.id), total = cfgW.discoveries.length;
      const here = w.id === cur;
      return `
        <button type="button" class="u-beam-item${here ? ' is-here' : ''}" data-world="${w.id}" ${here ? 'disabled' : ''} style="--accent:${w.accent}">
          <i class="fas ${w.icon}"></i>
          <span class="u-beam-name">${w.name}</span>
          <span class="u-beam-kind">${w.kind}</span>
          <span class="u-beam-state">${here ? 'aktuelle Position' : `Logbuch ${found}/${total}`}</span>
        </button>`;
    }).join('');
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) {} }
    hooks.playSfx && hooks.playSfx('lock');
  }
  el.classList.toggle('is-open', open);
  el.setAttribute('aria-hidden', open ? 'false' : 'true');
}

async function beamTo(id) {
  if (!S || S.busy) return;
  const pd = hooks.worlds.find((w) => w.id === id);
  const cfg = SURFACE_WORLDS[id];
  if (!pd || !cfg) return;
  S.busy = true;
  toggleBeamMenu(false);
  hideScanCard();
  hooks.playSfx && hooks.playSfx('warp');
  const fx = D['u-beamfx'];
  if (fx) fx.classList.add('is-on');
  await wait(520);

  disposeSession();
  buildSession(pd, cfg);
  S.cinematic = false;
  S.busy = false;
  // auf dem Ziel-Pad materialisieren
  const p = S.player;
  p.pos.set(-17, S.groundAt(-17, 11) + EYE, 11);
  p.yaw = Math.atan2(9 - -17, -14 - 11) + Math.PI;  // Blick Richtung Schiff
  S.camera.position.copy(p.pos);
  updateHudChip(); updateLogHud();
  hooks.onBeamed && hooks.onBeamed(pd);

  await wait(200);
  if (fx) fx.classList.remove('is-on');
  hooks.showToast && hooks.showToast(`<i class="fas fa-person-rays"></i> Beam abgeschlossen · <span class="u-toast-strong">${pd.name}</span>`, pd.accent);
  dustBurst(S, -17, S.groundAt(-17, 11), 11, 0x9fd4ff);
}

/* ----------------------------------------------------------------
   10) HUD
   ---------------------------------------------------------------- */
function showHud(v) {
  const el = D['u-surface']; if (!el) return;
  el.classList.toggle('is-on', v);
  el.setAttribute('aria-hidden', v ? 'false' : 'true');
  if (!v) { showLockPrompt(false); if (D['s-hint']) D['s-hint'].classList.remove('is-hidden'); }
}
function updateHudChip() {
  if (!S) return;
  const pd = S.planetData;
  if (D['s-chip-icon']) D['s-chip-icon'].className = 'fas ' + (pd.icon || 'fa-globe');
  if (D['s-chip-name']) D['s-chip-name'].textContent = pd.name;
  if (D['s-chip-kind']) D['s-chip-kind'].textContent = pd.kind || '';
  if (D['u-surface']) D['u-surface'].style.setProperty('--surf-accent', pd.accent || '#70d6ff');
}
function updateLogHud() {
  if (!S || !D['s-log-text']) return;
  const g = grandTotals();
  D['s-log-text'].textContent = `Logbuch ${foundCount(S.planetData.id)}/${S.cfg.discoveries.length} · Gesamt ${g.found}/${g.total}`;
}
let hintTimer = null;
function hideHintSoon() {
  if (hintTimer || !D['s-hint']) return;
  hintTimer = setTimeout(() => { D['s-hint'].classList.add('is-hidden'); hintTimer = null; }, 2600);
}
function showLockPrompt(v) {
  if (D['s-lockprompt']) D['s-lockprompt'].classList.toggle('is-on', v);
}

/* ----------------------------------------------------------------
   11) Render-Loop
   ---------------------------------------------------------------- */
function surfLoop() {
  rafId = requestAnimationFrame(surfLoop);
  if (!S) return;
  const dt = Math.min(surfClock.getDelta(), 0.05);
  S.time += dt;
  if (!S.cinematic && !S.busy) {
    updatePlayer(dt);
    updateInteraction(dt);
  }
  for (const f of S.anim) f(dt, S.time);
  hooks.renderer.render(S.scene, S.camera);
}
function startSurfaceLoop() { surfClock.getDelta(); if (!rafId) surfLoop(); }
function stopSurfaceLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

/* ----------------------------------------------------------------
   12) Ein- & Ausstieg (Kinematiken)
   ---------------------------------------------------------------- */

/* Wird von universe.js hinter der Burn-Blende aufgerufen: baut die
   Oberfläche auf und spielt die Lande-Sequenz (Schiff sinkt herab). */
export async function enterSurface(planetData) {
  if (active) return;
  active = true;
  const cfg = SURFACE_WORLDS[planetData.id] || SURFACE_WORLDS.origin;
  buildSession(planetData, cfg);
  showHud(true);
  updateHudChip(); updateLogHud();
  startRumble(); setRumble(0.7);
  startSurfaceLoop();
  await descend();
  stopRumble();
  attachControls();
  S.cinematic = false;
  showLockPrompt(true);
  hooks.showToast && hooks.showToast(
    `<i class="fas fa-flag-checkered"></i> Gelandet auf <span class="u-toast-strong">${planetData.name}</span> · zum Schiff laufen &amp; <span class="u-toast-strong">[E]</span> für den Rückflug`,
    planetData.accent
  );
}

function descend() {
  return new Promise((resolve) => {
    const ship = S.ship;
    const y0 = ship.baseY + 230, y1 = ship.baseY;
    const gx0 = ship.x + 42, gz0 = ship.z + 58;            // Anflug schräg aus der Ferne (Gleitpfad statt Fahrstuhl)
    ship.group.position.set(gx0, y0, gz0);
    const cam = S.camera;
    const gsapOk = window.gsap && !(hooks.reduceMotion);
    burnFX.fadeOut(gsapOk ? 2.6 : 0.8);

    // Retro-Triebwerk: kaltes Glühen unter dem Schiff während des Sinkflugs
    const thr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softSprite(), color: 0x9fd4ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const thrLight = new THREE.PointLight(0x9fd4ff, 0, 44, 1.8);
    S.scene.add(thr); S.scene.add(thrLight);
    const removeThruster = () => { S.scene.remove(thr); S.scene.remove(thrLight); thr.material.dispose(); };

    if (!gsapOk) {
      ship.group.position.set(ship.x, y1, ship.z);
      removeThruster();
      cam.position.copy(S.player.pos);
      cam.rotation.set(0, S.player.yaw, 0);
      resolve();
      return;
    }
    let dustStage = 0;
    const st = { t: 0 };
    const tw = gsap.to(st, {
      t: 1, duration: 4.2, ease: 'power3.out',
      onUpdate: () => {
        const e = st.t;
        const y = lerp(y0, y1, e);
        const gl = Math.min(1, e * 1.22);                  // Gleitpfad endet kurz vor dem Aufsetzen über dem Pad
        ship.group.position.set(lerp(gx0, ship.x, gl), y, lerp(gz0, ship.z, gl));
        ship.group.rotation.x = -0.15 * (1 - e);           // Nase beim Abbremsen leicht angehoben
        // Triebwerks-Glühen skaliert mit der Sinkgeschwindigkeit
        const power = 1 - e;
        thr.position.set(ship.group.position.x, y - 1.7, ship.group.position.z);
        thr.material.opacity = 0.18 + power * 0.5;
        thr.scale.setScalar(3 + power * 5.5);
        thrLight.position.copy(thr.position);
        thrLight.intensity = 0.5 + power * 2.6;
        // Staub wird schon im Endanflug aufgewirbelt
        const alt = y - y1;
        if (alt < 30 && dustStage < 1) { dustStage = 1; dustBurst(S, ship.x, S.groundAt(ship.x, ship.z), ship.z); }
        if (alt < 9 && dustStage < 2)  { dustStage = 2; dustBurst(S, ship.x, S.groundAt(ship.x, ship.z), ship.z); }
        // Kamera: weiter Bogen um das sinkende Schiff (kinoreife Parallaxe)
        const orbA = 2.7 - e * 1.5;
        const back = lerp(36, 16, e);
        cam.position.set(
          ship.group.position.x + Math.cos(orbA) * back,
          y + lerp(15, 5, e),
          ship.group.position.z + Math.sin(orbA) * back
        );
        const shake = (1 - e) * (1 - e) * 1.1;
        cam.position.x += (Math.random() - 0.5) * shake;
        cam.position.y += (Math.random() - 0.5) * shake;
        cam.lookAt(ship.group.position.x, y + 1.2, ship.group.position.z);
        setRumble(0.75 * (1 - e));
      },
      onComplete: () => {
        // Touchdown: Staubwolke, Setz-Wippen, Triebwerk erlischt
        dustBurst(S, ship.x, S.groundAt(ship.x, ship.z), ship.z);
        hooks.playSfx && hooks.playSfx('lock');
        ship.group.rotation.x = 0;
        ship.group.position.set(ship.x, y1, ship.z);
        S.tweens.push(gsap.fromTo(ship.group.position, { y: y1 + 0.55 }, { y: y1, duration: 0.6, ease: 'bounce.out' }));
        S.tweens.push(gsap.to(thr.material, { opacity: 0, duration: 0.7 }));
        S.tweens.push(gsap.to(thrLight, { intensity: 0, duration: 0.7, onComplete: removeThruster }));
        // Kamera gleitet in die Ego-Perspektive
        const p = S.player;
        const startPos = cam.position.clone();
        const startQ = cam.quaternion.clone();
        cam.position.copy(p.pos);
        cam.rotation.set(0, p.yaw, 0, 'YXZ');
        const endQ = cam.quaternion.clone();
        const endPos = p.pos.clone();
        cam.position.copy(startPos); cam.quaternion.copy(startQ);
        const st2 = { t: 0 };
        const tw2 = gsap.to(st2, {
          t: 1, duration: 1.6, ease: 'power2.inOut',
          onUpdate: () => {
            cam.position.lerpVectors(startPos, endPos, st2.t);
            cam.quaternion.copy(startQ).slerp(endQ, st2.t);
          },
          onComplete: () => { S.player.pitch = 0; resolve(); },
        });
        S.tweens.push(tw2);
      },
    });
    S.tweens.push(tw);
  });
}

/* Rückflug: Schiff hebt ab, Burn-Blende deckt ab, universe.js übernimmt */
async function depart() {
  if (!S || S.busy) return;
  S.busy = true;
  S.cinematic = true;
  hideScanCard(); toggleBeamMenu(false); cancelScan();
  showLockPrompt(false);
  _lastLabel = '';
  if (D['s-ret-label']) D['s-ret-label'].textContent = '';
  if (D['s-reticle']) D['s-reticle'].classList.remove('is-target');
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) {} }
  hooks.playSfx && hooks.playSfx('warp');
  startRumble();

  const pd = S.planetData;
  const ship = S.ship;
  const cam = S.camera;
  dustBurst(S, ship.x, S.groundAt(ship.x, ship.z), ship.z);
  burnFX.start('exit');

  const gsapOk = window.gsap && !(hooks.reduceMotion);
  if (gsapOk) {
    await new Promise((resolve) => {
      const y0 = ship.group.position.y;
      const eye = S.player.pos.clone();
      const st = { t: 0 };
      const tw = gsap.to(st, {
        t: 1, duration: 3.4, ease: 'power2.in',
        onUpdate: () => {
          const y = y0 + st.t * st.t * 300;
          ship.group.position.y = y;
          // Kamera: erst vom Boden hinterherschauen, dann mit hochziehen
          const chase = sstep(0.3, 0.75, st.t);
          cam.position.set(
            lerp(eye.x, ship.x + 11, chase),
            lerp(eye.y, y + 5, chase),
            lerp(eye.z, ship.z + 17, chase)
          );
          const shake = st.t * st.t * 1.6;
          cam.position.x += (Math.random() - 0.5) * shake;
          cam.position.y += (Math.random() - 0.5) * shake;
          cam.lookAt(ship.x, y + 1.5, ship.z);
          burnFX.set(sstep(0.5, 0.97, st.t));
          setRumble(st.t);
        },
        onComplete: resolve,
      });
      S.tweens.push(tw);
    });
  } else {
    burnFX.set(1);
    await wait(300);
  }

  stopRumble();
  stopSurfaceLoop();
  detachControls();
  disposeSession();
  showHud(false);
  hideScanCard(); toggleBeamMenu(false);
  active = false;
  // universe.js: Schiff zurück in den Orbit setzen, Loop starten, Burn ausblenden
  hooks.onDeparted && hooks.onDeparted(pd);
}

/* Not-Ausstieg (z. B. Nutzer verlässt das Universum komplett) */
export function forceExitSurface() {
  if (!active) return;
  stopSurfaceLoop();
  detachControls();
  stopRumble();
  disposeSession();
  showHud(false);
  hideScanCard(); toggleBeamMenu(false);
  burnFX.stop();
  const fx = D['u-beamfx'];
  if (fx) fx.classList.remove('is-on');
  active = false;
}
