/**
 * Export mp4, entièrement dans le navigateur.
 *
 * WebCodecs encode, mp4-muxer emballe. Aucun serveur, aucun coût.
 *
 * Le point clé : chaque frame est calculée depuis son seul index, via
 * `tFromFrame(i, n)`. Aucune horloge n'intervient — deux exports de la même
 * adresse donnent le même fichier, et l'export ne dépend pas de la vitesse de
 * la machine. C'est la raison d'être de la fonction pure `cameraAt`.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export const FPS = 25;

/** Du plus efficace au plus compatible. Le premier accepté gagne. */
const CODEC_CANDIDATES = [
  'avc1.640028', // High, niveau 4.0
  'avc1.4d0028', // Main
  'avc1.42e028', // Baseline
];

export function isExportSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

async function pickCodec(config) {
  for (const codec of CODEC_CANDIDATES) {
    const support = await VideoEncoder.isConfigSupported({ ...config, codec });
    if (support.supported) return codec;
  }
  throw new Error("Aucun encodeur H.264 disponible dans ce navigateur");
}

/**
 * @param {object} options
 * @param {number} options.width          largeur de sortie
 * @param {number} options.height         hauteur de sortie
 * @param {number} options.durationMs
 * @param {HTMLCanvasElement} options.canvas  la toile composée, réutilisée à chaque frame
 * @param {(frameIndex:number, frameCount:number) => Promise<void>} options.drawFrame
 *        doit avoir fini de peindre `canvas` quand la promesse se résout
 * @param {(ratio:number) => void} [options.onProgress]
 * @param {{aborted:boolean}} [options.signal]
 * @returns {Promise<Blob|null>} null si annulé
 */
export async function encodeVideo({
  width,
  height,
  durationMs,
  canvas,
  drawFrame,
  onProgress,
  signal,
}) {
  if (!isExportSupported()) {
    throw new Error('Ce navigateur ne gère pas WebCodecs. Utilisez Chrome ou Edge.');
  }

  const frameCount = Math.max(2, Math.round((durationMs / 1000) * FPS));

  const baseConfig = {
    width,
    height,
    // ~12 Mb/s en 1080p : large, mais le texte des cartes souffre vite.
    bitrate: Math.round(width * height * 6),
    framerate: FPS,
  };
  const codec = await pickCodec(baseConfig);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    // Le fichier finit en mémoire : l'index doit être en tête pour être lisible
    // sans téléchargement complet.
    fastStart: 'in-memory',
  });

  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error;
    },
  });
  encoder.configure({ ...baseConfig, codec });

  try {
    for (let i = 0; i < frameCount; i += 1) {
      if (signal?.aborted) {
        encoder.close();
        return null;
      }
      if (encodeError) throw encodeError;

      await drawFrame(i, frameCount);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i / FPS) * 1_000_000),
        duration: Math.round(1_000_000 / FPS),
      });
      // Une image clé par seconde : le fichier reste facile à scrubber au montage.
      encoder.encode(frame, { keyFrame: i % FPS === 0 });
      frame.close();

      // L'encodeur travaille de façon asynchrone. Sans ce palier, une longue
      // vidéo empile toutes les frames en mémoire avant d'en écrire une seule.
      if (encoder.encodeQueueSize > 8) await drainTo(encoder, 4);

      onProgress?.((i + 1) / frameCount);
    }

    await encoder.flush();
    encoder.close();
  } catch (error) {
    if (encoder.state !== 'closed') encoder.close();
    throw error;
  }

  if (encodeError) throw encodeError;

  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

function drainTo(encoder, target) {
  return new Promise((resolve) => {
    const check = () => {
      if (encoder.encodeQueueSize <= target) resolve();
      else setTimeout(check, 8);
    };
    check();
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Laisse au navigateur le temps de lancer le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `12 Place Vendôme` → `12-place-vendome` */
export function slugify(text) {
  return text
    .normalize('NFD')
    // Retire les diacritiques décomposés par NFD (U+0300–U+036F).
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'carte';
}
