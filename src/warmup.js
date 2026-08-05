/**
 * Pré-chargement du vol.
 *
 * MapLibre ne demande les tuiles que du niveau de zoom courant. Une descente de
 * z2.9 à z16.4 traverse une quinzaine de niveaux : jouée à froid, chaque palier
 * s'affiche d'abord avec les tuiles du niveau précédent, puis bascule d'un coup.
 * C'est ce « lag » et ces sauts de style.
 *
 * On parcourt donc le vol une fois à vide, en attendant que chaque étape soit
 * complètement chargée. Les tuiles restent en cache, la lecture est ensuite
 * fluide. L'export frame par frame s'appuiera sur la même attente.
 */

/** Assez grand pour garder tous les niveaux du vol, pas seulement le dernier. */
export const TILE_CACHE_SIZE = 1500;

/** Nombre d'étapes échantillonnées le long du vol. ~2 par niveau de zoom. */
const STEPS = 30;

/** Filet de sécurité si une tuile ne répond jamais. */
const IDLE_TIMEOUT_MS = 6000;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Attend que la carte n'ait plus rien à charger ni à dessiner. */
export function waitIdle(map, timeoutMs = IDLE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded() && map.areTilesLoaded()) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      map.off('idle', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    map.on('idle', done);
  });
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {(t:number) => object} cameraForT  la fonction pure du vol, déjà liée à la cible
 * @param {{onProgress?: (ratio:number) => void, signal?: {aborted:boolean}}} [options]
 */
export async function warmUp(map, cameraForT, { onProgress, signal } = {}) {
  for (let i = 0; i <= STEPS; i += 1) {
    if (signal?.aborted) return false;

    map.jumpTo(cameraForT(i / STEPS));

    // Une frame pour que MapLibre inscrive les tuiles manquantes en attente,
    // sinon `areTilesLoaded()` répondrait vrai à tort.
    await nextFrame();
    await waitIdle(map);

    onProgress?.((i + 1) / (STEPS + 1));
  }

  if (signal?.aborted) return false;

  map.jumpTo(cameraForT(0));
  await nextFrame();
  await waitIdle(map);
  return true;
}
