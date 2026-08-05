/**
 * Composition de l'image finale.
 *
 * La vidéo exportée ne contient que la carte, plein cadre. Le téléphone ou le
 * portable visibles autour de l'aperçu sont une décoration de l'éditeur, faite
 * en CSS (voir `style.css`) : ils n'entrent jamais dans le fichier.
 *
 * Un seul chemin de rendu pour la preview et pour l'export : `composeScene()`
 * ne dépend que de ses arguments, jamais d'une horloge. La preview lui passe la
 * carte telle qu'elle est à cet instant, l'export la lui passe frame par frame.
 */

import { drawPin } from './pin.js';

/**
 * Dimensions de sortie par format, et appareil dans lequel l'éditeur montre
 * l'aperçu. `device` ne sert qu'à l'affichage.
 */
export const SCENES = {
  '9:16': { width: 1080, height: 1920, device: 'phone' },
  '16:9': { width: 1920, height: 1080, device: 'laptop' },
  '1:1': { width: 1080, height: 1080, device: 'tablet' },
};

/**
 * Crédit des données. Les tuiles OpenFreeMap dérivent d'OpenStreetMap, sous
 * licence ODbL : le crédit est dû, mais pas nécessairement incrusté dans
 * l'image. Les règles d'attribution de l'OSMF admettent, pour une vidéo, qu'il
 * figure là où les crédits sont d'usage — description du post, générique.
 *
 * Choix retenu : hors du fichier. Frenchtooth a déjà son process de crédits
 * sur les publications, c'est là que ça se joue. Repasser `BURN_ATTRIBUTION`
 * à true réincruste le texte dans l'image si le besoin revient.
 */
const ATTRIBUTION = '© OpenStreetMap contributors';
const BURN_ATTRIBUTION = false;

function drawAttribution(ctx, width, height) {
  const pad = 14;
  ctx.font = '500 18px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';

  const textWidth = ctx.measureText(ATTRIBUTION).width;

  ctx.beginPath();
  ctx.roundRect(width - textWidth - pad * 2.4, height - 40, textWidth + pad * 1.6, 28, 6);
  ctx.fillStyle = 'rgba(255, 255, 255, .72)';
  ctx.fill();

  ctx.fillStyle = 'rgba(20, 23, 28, .78)';
  ctx.fillText(ATTRIBUTION, width - pad * 1.6, height - 16);
}

/**
 * Dessine une image complète.
 *
 * @param {CanvasRenderingContext2D} ctx  contexte aux dimensions de sortie
 * @param {object} scene                  entrée de SCENES
 * @param {HTMLCanvasElement} mapCanvas   toile de MapLibre, aux mêmes dimensions
 * @param {{x:number, y:number}|null} pinPoint  position du pin dans la carte
 * @param {{opacity:number, scale:number, rise:number}} pinState
 */
export function composeScene(ctx, scene, mapCanvas, pinPoint, pinState) {
  const { width, height } = scene;

  // Fond sous la carte : évite un trou noir si une tuile manque encore.
  ctx.fillStyle = '#f0f0ff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(mapCanvas, 0, 0, width, height);

  if (pinPoint && pinState.opacity > 0.001) {
    drawPin(ctx, pinPoint.x, pinPoint.y, pinState);
  }

  if (BURN_ATTRIBUTION) drawAttribution(ctx, width, height);
}
