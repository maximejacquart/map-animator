import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { cameraAt, pinAt, tFromElapsed, tFromFrame, FLIGHT } from './camera.js';
import { suggest } from './geocode.js';
import { emphasizeLabels } from './labels.js';
import { SCENES, composeScene } from './scene.js';
import { warmUp, waitIdle, TILE_CACHE_SIZE } from './warmup.js';
import { encodeVideo, downloadBlob, slugify, isExportSupported, FPS } from './export.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const DEFAULT_TARGET = {
  lng: 2.3312,
  lat: 48.8687,
  label: '12 Place Vendôme',
  detail: '75001, Paris, France',
};

// --- État de l'application ---------------------------------------------------

const state = {
  format: '9:16',
  durationMs: 8000,
  target: { ...DEFAULT_TARGET },
  // Calibrage du vol. Plus exposé dans l'interface : les valeurs retenues
  // (z6 → z12.9) sont figées dans FLIGHT. Rouvrir un réglage se fait ici.
  flight: { ...FLIGHT },
};

/**
 * Lecteur. `elapsed` est la seule mémoire du temps : la pause le fige, la
 * reprise repart de là. L'animation reste une fonction pure de `t`.
 * cold → warming → ready → playing ⇄ paused → done
 */
const player = {
  status: 'cold',
  elapsed: 0,
  lastT: 0,
  rafId: null,
  warmToken: null,
  exporting: false,
  exportToken: null,
};

const el = {
  device: document.getElementById('device'),
  frame: document.getElementById('frame'),
  map: document.getElementById('map'),
  output: document.getElementById('output'),
  stage: document.getElementById('stage'),
  address: document.getElementById('address'),
  suggestions: document.getElementById('suggestions'),
  status: document.getElementById('status'),
  duration: document.getElementById('duration'),
  durationValue: document.getElementById('duration-value'),
  formats: document.getElementById('formats'),
  play: document.getElementById('play'),
  export: document.getElementById('export'),
  progress: document.getElementById('progress'),
  readout: document.getElementById('readout'),
  theme: document.getElementById('theme'),
};

// --- Thème -------------------------------------------------------------------

/**
 * Bascule clair / sombre. Le thème initial est déjà posé sur <html> par le
 * script d'amorce d'`index.html` ; on ne fait ici que le retourner et le
 * retenir. Rien de tout ça n'entre dans le fichier exporté : la carte reste
 * rendue dans le style clair, le thème n'habille que l'éditeur.
 */
el.theme.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
});

const ctx = el.output.getContext('2d');

// --- Carte -------------------------------------------------------------------

const map = new maplibregl.Map({
  container: el.map,
  style: STYLE_URL,
  center: [state.target.lng, state.target.lat],
  zoom: state.flight.zoomStart,
  // Interface verrouillée : le monteur ne compose pas le cadre à la main.
  interactive: false,
  // L'attribution est redessinée dans la composition (scene.js) : le contrôle
  // DOM serait masqué par le canvas et absent du fichier exporté.
  attributionControl: false,
  // La toile de MapLibre fait exactement les pixels de l'écran de l'appareil,
  // quel que soit l'écran physique. C'est ce qui rend la capture pixel-exacte.
  pixelRatio: 1,
  // Sans ça, `drawImage` sur une toile WebGL peut ne rien recopier.
  preserveDrawingBuffer: true,
  // Aucun fondu piloté par une horloge : à l'export, une frame doit dépendre
  // de son seul index. Le pré-chargement rend ce fondu inutile de toute façon.
  fadeDuration: 0,
  maxTileCacheSize: TILE_CACHE_SIZE,
});

map.on('load', () => {
  map.setProjection({ type: 'globe' });
  // Retouche du style faite une fois : elle ne dépend pas de `t`, la preview et
  // l'export voient donc la même carte.
  emphasizeLabels(map);
  renderAt(0);
});

/**
 * La composition recopie la toile de MapLibre au moment où on la peint. Hors
 * lecture, un `jumpTo` suivi d'une composition immédiate copie donc l'image
 * *précédente* — ou rien du tout si la carte n'a pas encore dessiné, d'où
 * l'aperçu qui se vidait en bougeant un réglage. On recompose à chaque
 * redessin de la carte pour rattraper.
 *
 * Pendant la lecture et pendant l'export, la composition est pilotée
 * explicitement : on ne double pas le travail.
 */
map.on('render', () => {
  if (player.rafId === null && !player.exporting) compose(player.lastT);
});

// --- Cadre : dimensions exactes de sortie, mise à l'échelle en CSS ------------

/**
 * Recadrage animé d'un format à l'autre.
 *
 * L'échelle d'aperçu est commune aux trois formats (voir `PREVIEW_BASE`) : d'un
 * format à l'autre, seules les dimensions du cadre changent. Elles sont donc
 * animables — le cadre s'ouvre ou se referme sur la carte au lieu de sauter.
 *
 * La transition est portée par une classe posée le temps du changement, jamais
 * en permanence : `fitFrame()` sert aussi au redimensionnement de la fenêtre,
 * où une transition ferait traîner le cadre derrière le curseur.
 */
const MORPH_MS = 420;
let morphTimer = null;

function morphFrame() {
  el.frame.classList.add('morphing');
  clearTimeout(morphTimer);
  morphTimer = setTimeout(() => el.frame.classList.remove('morphing'), MORPH_MS + 40);
}

function applyFormat() {
  const scene = SCENES[state.format];

  el.device.dataset.device = scene.device;
  el.output.width = scene.width;
  el.output.height = scene.height;

  // La carte est rendue aux dimensions exactes du fichier.
  el.map.style.width = `${scene.width}px`;
  el.map.style.height = `${scene.height}px`;

  fitFrame();
  map.resize();
}

/**
 * Côté de référence de l'aperçu : la plus grande dimension de tous les formats.
 * L'échelle d'affichage se calcule dessus, pas sur le format courant — sinon le
 * 1:1, que rien ne bride dans un plan de travail carré, s'afficherait presque
 * deux fois plus gros que le 9:16, avec des libellés flous à l'agrandissement.
 * Tous les formats partagent maintenant la même échelle : seul le cadre change.
 */
const PREVIEW_BASE = Math.max(
  ...Object.values(SCENES).flatMap(({ width, height }) => [width, height]),
);

function fitFrame() {
  const scene = SCENES[state.format];
  // Marge autour de l'aperçu. Elle valait 120 du temps où une coque d'appareil
  // débordait du cadre ; il ne reste que la légende de format sous l'image, qui
  // tient dans 36 px de chaque côté.
  const pad = 72;
  const scale = Math.min(
    (el.stage.clientWidth - pad) / PREVIEW_BASE,
    (el.stage.clientHeight - pad) / PREVIEW_BASE,
    1,
  );

  el.frame.style.width = `${scene.width * scale}px`;
  el.frame.style.height = `${scene.height * scale}px`;
  el.output.style.transform = `scale(${scale})`;
  el.map.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', fitFrame);

// --- Rendu -------------------------------------------------------------------

/** Où tombe le cabinet dans la toile de la carte, ou null s'il est hors champ. */
function pinPointFor() {
  const point = map.project([state.target.lng, state.target.lat]);
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

/** Peint la composition depuis l'état actuel de la carte. */
function compose(t) {
  player.lastT = t;
  composeScene(ctx, SCENES[state.format], map.getCanvas(), pinPointFor(), pinAt(t));
}

/**
 * Pose la scène pour une progression donnée.
 * Seul point de contact entre l'animation (pure) et la carte (état).
 * L'export appelle les deux mêmes opérations, avec une attente entre les deux.
 */
function renderAt(t) {
  map.jumpTo(cameraAt(t, state.target, state.flight));
  compose(t);
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Version export : attend que la carte soit chargée ET redessinée. */
async function renderAtSettled(t) {
  map.jumpTo(cameraAt(t, state.target, state.flight));
  await waitIdle(map);
  const painted = new Promise((resolve) => map.once('render', resolve));
  map.triggerRepaint();
  await painted;
  compose(t);
}

// --- Pré-chargement ----------------------------------------------------------

/**
 * Le trajet des tuiles dépend de la cible, du cadre et de la plage de zoom —
 * pas de la durée. Toute modification de ces trois-là périme le cache chaud.
 * `at` permet de rester sur l'image regardée pendant qu'on tourne un bouton.
 */
function invalidateWarmUp({ at = 0 } = {}) {
  if (player.warmToken) player.warmToken.aborted = true;
  player.warmToken = null;
  stop();
  player.status = 'cold';
  player.elapsed = at * state.durationMs;
  renderAt(at);
  setProgress(0);
  syncControls();
}

async function ensureWarm() {
  if (player.status !== 'cold') return true;

  const token = { aborted: false };
  player.warmToken = token;
  player.status = 'warming';
  syncControls();

  await waitIdle(map);
  const done = await warmUp(map, (t) => cameraAt(t, state.target, state.flight), {
    signal: token,
    onProgress: (ratio) => {
      if (token.aborted) return;
      setProgress(ratio);
      syncControls();
    },
  });

  if (token.aborted) return false;

  player.warmToken = null;
  player.status = 'ready';
  setProgress(0);
  renderAt(0);
  syncControls();
  return done;
}

let progressRatio = 0;
function setProgress(ratio) {
  progressRatio = ratio;
  el.progress.style.width = `${Math.round(ratio * 100)}%`;
  el.progress.parentElement.hidden = ratio === 0;
}

// --- Lecture -----------------------------------------------------------------

function stop() {
  if (player.rafId !== null) cancelAnimationFrame(player.rafId);
  player.rafId = null;
}

function run() {
  // Une lecture terminée repart du début.
  if (player.elapsed >= state.durationMs) player.elapsed = 0;

  player.status = 'playing';
  syncControls();

  const origin = performance.now() - player.elapsed;

  const step = (now) => {
    player.elapsed = now - origin;
    const t = tFromElapsed(player.elapsed, state.durationMs);
    renderAt(t);

    if (t < 1) {
      player.rafId = requestAnimationFrame(step);
    } else {
      player.rafId = null;
      player.elapsed = state.durationMs;
      player.status = 'done';
      syncControls();
    }
  };

  player.rafId = requestAnimationFrame(step);
}

function pause() {
  stop();
  player.status = 'paused';
  syncControls();
}

async function togglePlay() {
  if (player.exporting || player.status === 'warming') return;
  if (player.status === 'playing') {
    pause();
    return;
  }
  const ready = await ensureWarm();
  if (ready) run();
}

// --- Export ------------------------------------------------------------------

async function runExport() {
  if (player.exporting) {
    player.exportToken.aborted = true;
    return;
  }

  stop();
  if (player.status === 'playing' || player.status === 'paused') player.status = 'ready';

  const ready = await ensureWarm();
  if (!ready) return;

  const scene = SCENES[state.format];
  const token = { aborted: false };
  player.exportToken = token;
  player.exporting = true;
  setProgress(0.001);
  syncControls();

  try {
    const blob = await encodeVideo({
      width: scene.width,
      height: scene.height,
      durationMs: state.durationMs,
      canvas: el.output,
      signal: token,
      drawFrame: async (index, count) => {
        await renderAtSettled(tFromFrame(index, count));
      },
      onProgress: (ratio) => {
        setProgress(ratio);
        el.readout.textContent =
          `Export ${Math.round(ratio * 100)} % · ${FPS} i/s · ${scene.width}×${scene.height}`;
      },
    });

    if (blob) {
      downloadBlob(blob, `${slugify(state.target.label)}-${state.format.replace(':', 'x')}.mp4`);
      el.status.dataset.kind = 'ok';
      el.status.textContent = 'Vidéo exportée';
    } else {
      el.status.dataset.kind = '';
      el.status.textContent = 'Export annulé';
    }
  } catch (error) {
    el.status.dataset.kind = 'error';
    el.status.textContent = error.message;
  } finally {
    player.exporting = false;
    player.exportToken = null;
    setProgress(0);
    el.readout.textContent = '';
    player.elapsed = 0;
    renderAt(0);
    player.status = 'ready';
    syncControls();
  }
}

// --- Synchronisation de l'interface ------------------------------------------

function syncControls() {
  const labels = {
    cold: '▶  Lire',
    warming: `Préparation…  ${Math.round(progressRatio * 100)} %`,
    ready: '▶  Lire',
    playing: '❚❚  Pause',
    paused: '▶  Reprendre',
    done: '▶  Rejouer',
  };

  el.play.textContent = player.exporting ? 'Export en cours…' : labels[player.status];
  el.play.disabled = player.exporting || player.status === 'warming';

  el.export.textContent = player.exporting ? 'Annuler l\'export' : 'Exporter en mp4';
  el.export.disabled = player.status === 'warming' || !isExportSupported();
}

// --- Formats -----------------------------------------------------------------

for (const key of Object.keys(SCENES)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = key;
  button.setAttribute('aria-pressed', String(key === state.format));
  button.addEventListener('click', () => {
    state.format = key;
    for (const other of el.formats.children) {
      other.setAttribute('aria-pressed', String(other === button));
    }
    // Le morph n'est armé que sur un vrai changement demandé par le monteur,
    // pas au premier `applyFormat()` du démarrage, où le cadre n'a pas encore
    // de dimensions d'où partir.
    morphFrame();
    applyFormat();
    invalidateWarmUp();
  });
  el.formats.append(button);
}

// --- Durée -------------------------------------------------------------------

// Changer la durée ne change pas le trajet : le cache de tuiles reste valable.
el.duration.addEventListener('input', () => {
  const seconds = Number(el.duration.value);
  state.durationMs = seconds * 1000;
  el.durationValue.textContent = `${seconds} s`;
  if (player.status === 'playing') pause();
});

// --- Adresse : autocomplétion ------------------------------------------------

let suggestTimer = null;
let suggestRequest = null;
let places = [];
let highlighted = -1;

function closeSuggestions() {
  el.suggestions.hidden = true;
  el.address.setAttribute('aria-expanded', 'false');
  places = [];
  highlighted = -1;
}

/**
 * Déplace la surbrillance sans reconstruire la liste.
 *
 * Reconstruire à chaque survol détruisait le `<li>` sous le curseur, ce qui
 * relançait `mouseenter` sur le nœud recréé, donc une nouvelle reconstruction.
 * Un `mousedown` tombant au milieu visait un nœud déjà détaché du document : le
 * clic ne sélectionnait rien. La surbrillance est un attribut, pas une raison
 * de refaire le DOM.
 */
function paintHighlight() {
  Array.from(el.suggestions.children).forEach((item, index) => {
    item.setAttribute('aria-selected', String(index === highlighted));
  });
}

function renderSuggestions() {
  el.suggestions.replaceChildren();

  places.forEach((place, index) => {
    const item = document.createElement('li');
    item.role = 'option';
    item.setAttribute('aria-selected', String(index === highlighted));
    item.innerHTML = '<strong></strong><span></span>';
    item.querySelector('strong').textContent = place.label;
    item.querySelector('span').textContent = place.detail;

    // mousedown, pas click : le blur de l'input fermerait la liste avant.
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      choose(index);
    });
    item.addEventListener('mouseenter', () => {
      if (highlighted === index) return;
      highlighted = index;
      paintHighlight();
    });

    el.suggestions.append(item);
  });

  el.suggestions.hidden = places.length === 0;
  el.address.setAttribute('aria-expanded', String(places.length > 0));
}

function choose(index) {
  const place = places[index];
  if (!place) return;

  state.target = place;
  el.address.value = [place.label, place.detail].filter(Boolean).join(', ');
  el.status.dataset.kind = 'ok';
  el.status.textContent = 'Adresse validée';
  closeSuggestions();

  // On montre l'arrivée, pas le départ. À `t = 0` la caméra est à z6 : passer
  // d'une adresse française à une autre n'y bougeait presque rien, et le
  // monteur croyait que sa sélection n'avait pas été prise. La lecture, elle,
  // repart bien du début.
  invalidateWarmUp({ at: 1 });
}

async function lookup(query) {
  suggestRequest?.abort();
  suggestRequest = new AbortController();

  try {
    places = await suggest(query, { signal: suggestRequest.signal });
    highlighted = -1;
    renderSuggestions();
    if (places.length === 0) {
      el.status.dataset.kind = 'error';
      el.status.textContent = 'Aucune adresse trouvée';
    } else {
      el.status.dataset.kind = '';
      el.status.textContent = 'Choisissez une proposition';
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    el.status.dataset.kind = 'error';
    el.status.textContent = error.message;
  }
}

el.address.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const query = el.address.value.trim();

  if (query.length < 3) {
    suggestRequest?.abort();
    closeSuggestions();
    el.status.dataset.kind = '';
    el.status.textContent = '';
    return;
  }

  // La BAN répond en quelques dizaines de millisecondes : un délai de 250 ms
  // faisait l'essentiel de l'attente ressentie. 120 ms suffisent à ne pas tirer
  // une requête par frappe.
  suggestTimer = setTimeout(() => lookup(query), 120);
});

el.address.addEventListener('keydown', (event) => {
  if (el.suggestions.hidden) return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    highlighted = (highlighted + delta + places.length) % places.length;
    paintHighlight();
    el.suggestions.children[highlighted]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    choose(highlighted === -1 ? 0 : highlighted);
  } else if (event.key === 'Escape') {
    closeSuggestions();
  }
});

el.address.addEventListener('blur', closeSuggestions);

// --- Démarrage ---------------------------------------------------------------

el.play.addEventListener('click', togglePlay);
el.export.addEventListener('click', runExport);

document.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && event.target !== el.address) {
    event.preventDefault();
    togglePlay();
  }
});

el.address.value = [state.target.label, state.target.detail].join(', ');
if (!isExportSupported()) {
  el.status.dataset.kind = 'error';
  el.status.textContent = 'Export mp4 indisponible : utilisez Chrome ou Edge';
}
setProgress(0);
syncControls();
applyFormat();

// Première composition avant même le chargement du style, pour ne pas laisser
// un canvas vide à l'écran.
nextFrame().then(() => compose(0));
