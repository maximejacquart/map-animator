/**
 * Vol caméra — fonctions pures.
 *
 * Contrat d'architecture : rien ici ne lit d'horloge, ne touche à une carte,
 * ne garde d'état. Le temps entre par le paramètre `t` (0 → 1). La preview le
 * calcule avec requestAnimationFrame, l'export le calculera avec
 * `frameIndex / (frameCount - 1)`. Les deux doivent produire la même image.
 */

// --- Courbes -----------------------------------------------------------------

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);

/**
 * Smootherstep (Perlin). Vitesse *et* accélération nulles aux deux bouts —
 * là où easeInOutSine ne annule que la vitesse. C'est ce qui enlève la cassure
 * au décollage et au poser : la caméra ne « prend » ni ne « lâche » jamais.
 */
const smootherStep = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Léger dépassement puis retour — donne du poids au poser du pin. */
const easeOutBack = (t) => {
  const x = clamp01(t);
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

/** Remappe [a, b] vers [0, 1], en écrêtant hors de l'intervalle. */
const segment = (t, a, b) => clamp01((t - a) / (b - a));

const lerp = (a, b, t) => a + (b - a) * t;

// --- Réglages du vol ---------------------------------------------------------

/**
 * Calibrage interne, volontairement hors de l'interface : le monteur ne règle
 * que la durée et l'adresse. C'est ici qu'on tourne les boutons à l'étape 2.
 */
export const FLIGHT = {
  zoomStart: 5.2,   // le pays entier tient dans le cadre, en 9:16 comme en 16:9
  zoomEnd: 12.9,    // quartier, avant la bascule vers le style bâtiments

  /**
   * Centre du cadre d'ouverture : centre géographique de la France
   * métropolitaine. Sans lui, le départ était centré sur le cabinet ; comme la
   * plupart sont au nord, le pays tombait sous la ligne médiane.
   *
   * Mettre à `null` rétablit le zoom pur, départ déjà centré sur la cible.
   */
  originCenter: [2.4, 46.6],

  /**
   * Largeur du cadre, en tuiles (tuiles MapLibre de 512 px). Le trajet de van
   * Wijk raisonne en largeurs de cadre : il lui faut donc savoir combien de
   * monde tient à l'écran. 1080 / 512 ≈ 2.1, le format portrait. Le 16:9 est
   * plus large, mais l'écart ne déplace la courbe que de façon marginale et
   * garder une constante évite de faire dépendre le vol du format.
   */
  viewportTiles: 2.1,

  // Courbure du trajet de van Wijk. 1.42 est la valeur que l'article donne
  // comme optimale à l'usage : plus bas, le vol s'aplatit ; plus haut, il
  // prend de l'altitude au milieu.
  rho: 1.42,

  // Vue 2D d'un bout à l'autre. La bascule 3D reste câblée mais désarmée :
  // passer pitchEnd à ~55 la rallume sans toucher au reste.
  pitchEnd: 0,
  pitchFrom: 0.5,
  pitchTo: 0.94,

  // Nord en haut du début à la fin. Remettre bearingStart à une valeur négative
  // rallume la rotation d'ouverture.
  bearingStart: 0,
  bearingEnd: 0,
  bearingTo: 0.85,

  hold: 0.14,       // fraction finale immobile, pour laisser lire l'arrivée
};

/**
 * Apparition du pin, en fraction de la durée totale.
 *
 * Le pin naît sur place, par l'échelle. La chute depuis le haut reste câblée
 * mais désarmée : repasser `riseFrom` à ~0.5 la rallume.
 *
 * Il se pose avant la fin du vol pour laisser courir son onde pendant tout le
 * palier final (`FLIGHT.hold`) : l'image ne se fige pas sur le dernier tiers.
 */
export const PIN = {
  from: 0.72,
  to: 0.86,
  riseFrom: 0,       // hauteur de chute, en fraction de la taille du pin

  // Durée d'une onde, en fraction de la durée totale. 0.07 ≈ 0.56 s sur 8 s.
  pulsePeriod: 0.07,
};

// --- Trajet zoom + déplacement -----------------------------------------------

/**
 * Projection Web Mercator vers le carré unité [0, 1]. C'est l'espace dans
 * lequel la carte est réellement dessinée : y interpoler une position, c'est
 * interpoler ce que le spectateur voit. Interpoler en degrés ne l'est pas.
 */
function toMercator([lng, lat]) {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

function fromMercator([x, y]) {
  return [
    x * 360 - 180,
    (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90,
  ];
}

/**
 * Trajet « zoom + déplacement » de van Wijk & Nuij, *Smooth and efficient
 * zooming and panning* (InfoVis 2003) — l'algorithme derrière le `flyTo` de
 * MapLibre, réimplémenté ici en fonction pure pour rester déterministe à
 * l'export.
 *
 * Ce qu'il corrige : à l'écran, un déplacement se voit multiplié par 2^zoom.
 * Interpoler la position et l'échelle chacune de son côté, même avec la même
 * courbe, donne donc un mouvement dont la vitesse *perçue* explose à la fin —
 * on voit le zoom se faire, puis un glissement latéral. Van Wijk résout les
 * deux ensemble, de sorte que la vitesse à l'écran reste constante : la caméra
 * prend un peu d'altitude, file, puis redescend, en un seul geste.
 *
 * @returns {{at: (s:number) => {center:[number,number], zoom:number}, length:number}}
 */
function flightPath(from, to, zoomStart, zoomEnd, { viewportTiles, rho }) {
  const p0 = toMercator(from);
  const p1 = toMercator(to);
  const u1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);

  // Largeur du cadre exprimée en unités de monde : c'est l'« altitude ».
  const w0 = viewportTiles / 2 ** zoomStart;
  const w1 = viewportTiles / 2 ** zoomEnd;

  // Cas dégénéré : les deux points sont confondus, il ne reste qu'un zoom.
  // L'interpolation linéaire en unités de zoom est déjà logarithmique en
  // échelle, donc déjà à vitesse perçue constante.
  if (u1 < 1e-9) {
    return {
      length: 1,
      at: (s) => ({ center: [to[0], to[1]], zoom: lerp(zoomStart, zoomEnd, s) }),
    };
  }

  const rho2 = rho * rho;

  // b, r et S : équations 9 et 10 de l'article.
  const b = (i) => {
    const w = i === 0 ? w0 : w1;
    const sign = i === 0 ? 1 : -1;
    return (w1 * w1 - w0 * w0 + sign * rho2 * rho2 * u1 * u1) / (2 * w * rho2 * u1);
  };

  const r = (i) => {
    const bi = b(i);
    return Math.log(-bi + Math.sqrt(bi * bi + 1));
  };

  const r0 = r(0);
  const S = (r(1) - r0) / rho;

  const coshR0 = Math.cosh(r0);
  const sinhR0 = Math.sinh(r0);

  return {
    length: S,
    at: (s) => {
      const w = (coshR0 / Math.cosh(rho * s + r0)) * w0;
      const u = (w0 * (coshR0 * Math.tanh(rho * s + r0) - sinhR0)) / rho2;
      const k = u / u1;

      return {
        center: fromMercator([lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k)]),
        zoom: zoomStart + Math.log2(w0 / w),
      };
    },
  };
}

// --- Caméra ------------------------------------------------------------------

/**
 * @param {number} t        progression 0 → 1
 * @param {{lng:number, lat:number}} target  point d'arrivée (le cabinet)
 * @param {typeof FLIGHT} [config]
 * @returns {{center:[number,number], zoom:number, pitch:number, bearing:number}}
 */
export function cameraAt(t, target, config = FLIGHT) {
  const p = clamp01(t);

  // Le vol se joue sur (1 - hold), puis la caméra reste posée.
  const flight = clamp01(p / (1 - config.hold));

  // Une seule courbe pour toute la progression du vol. smootherStep adoucit le
  // décollage et le poser sans à-coup d'accélération : vitesse *et*
  // accélération nulles aux deux bouts.
  const descent = smootherStep(flight);

  // Position et échelle sortent du même trajet, résolues ensemble par van Wijk.
  // Les séparer, c'était la cause du « zoom d'abord, glissement ensuite » : un
  // écart en degrés qui semble nul à z5 devient un balayage plein cadre à z13.
  // `originCenter: null` réduit le trajet à un zoom pur, sans déplacement.
  const origin = config.originCenter ?? [target.lng, target.lat];
  const path = flightPath(
    origin,
    [target.lng, target.lat],
    config.zoomStart,
    config.zoomEnd,
    config,
  );
  const { center, zoom } = path.at(descent * path.length);

  const pitch = lerp(
    0,
    config.pitchEnd,
    smootherStep(segment(flight, config.pitchFrom, config.pitchTo)),
  );

  const bearing = lerp(
    config.bearingStart,
    config.bearingEnd,
    easeOutCubic(segment(flight, 0, config.bearingTo)),
  );

  return { center, zoom, pitch, bearing };
}

// --- Pin ---------------------------------------------------------------------

/**
 * État visuel du pin, lui aussi fonction pure de `t`.
 *
 * `pulse` est la phase de l'onde qui part du pin une fois posé : 0 → 1, remise
 * à 0 à chaque cycle. Elle vaut 0 tant que le pin n'est pas posé. Comme tout le
 * reste ici, elle ne dépend que de `t` — l'export retombe donc sur exactement
 * les mêmes images que la preview, onde comprise.
 *
 * @returns {{opacity:number, scale:number, rise:number, pulse:number}}
 *   `rise` en fraction de taille, `pulse` en phase 0 → 1
 */
export function pinAt(t, config = PIN) {
  const p = segment(t, config.from, config.to);
  const settled = Math.max(0, t - config.to);

  return {
    opacity: easeOutCubic(segment(t, config.from, config.from + (config.to - config.from) * 0.4)),
    scale: lerp(0.4, 1, easeOutBack(p)),
    rise: lerp(config.riseFrom, 0, easeOutCubic(p)),
    pulse: settled === 0 ? 0 : (settled / config.pulsePeriod) % 1,
  };
}

// --- Sources de temps --------------------------------------------------------

/** Preview : t depuis une horloge. */
export const tFromElapsed = (elapsedMs, durationMs) => clamp01(elapsedMs / durationMs);

/** Export : t depuis un index de frame. Même fonction en aval. */
export const tFromFrame = (frameIndex, frameCount) =>
  frameCount <= 1 ? 1 : clamp01(frameIndex / (frameCount - 1));
