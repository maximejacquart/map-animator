/**
 * Géocodage — sans clé, sans compte.
 *
 * L'app ne prend que des adresses issues de cette liste : le monteur choisit
 * une proposition, il ne tape jamais une adresse libre. Ça garantit que le
 * point existe et que le libellé affiché plus tard (étape 4) est normalisé.
 *
 * Deux fournisseurs, dans cet ordre :
 *
 * 1. La Base Adresse Nationale (api-adresse.data.gouv.fr), service public
 *    français. C'est la référence officielle des adresses en France, elle est
 *    conçue pour l'autocomplétion (paramètre `autocomplete`), elle répond en
 *    quelques dizaines de millisecondes et elle descend au numéro de voirie.
 *    Les cabinets visés étant français, c'est elle qui doit répondre en premier.
 *
 * 2. Photon (komoot), en repli, pour tout ce qui sort de France.
 *
 * Photon seul posait deux problèmes : il classe d'abord la voie entière quand
 * on tape un nom de rue, et il fait chercher un numéro parmi des homonymes de
 * tout le pays. La BAN trie par pertinence réelle et renvoie le numéro exact.
 */

const BAN = 'https://api-adresse.data.gouv.fr/search/';
const PHOTON = 'https://photon.komoot.io/api/';

// Biais de recherche vers la France (centre du pays), pour le repli Photon.
// Il classe mieux les résultats proches, sans exclure l'étranger.
const BIAS = { lat: 46.6, lon: 2.4 };

/**
 * @param {string} query
 * @param {{signal?: AbortSignal, limit?: number}} [options]
 * @returns {Promise<Array<{lng:number, lat:number, label:string, detail:string, key:string}>>}
 */
export async function suggest(query, { signal, limit = 8 } = {}) {
  const french = await fromBan(query, { signal, limit });
  if (french.length > 0) return french;

  return fromPhoton(query, { signal, limit });
}

// --- Base Adresse Nationale --------------------------------------------------

async function fromBan(query, { signal, limit }) {
  const url =
    `${BAN}?q=${encodeURIComponent(query)}&limit=${limit}&autocomplete=1`;

  let data;
  try {
    const res = await fetch(url, { signal });
    // Un service public en panne ne doit pas bloquer la saisie : on bascule
    // silencieusement sur Photon. Seule l'annulation remonte.
    if (!res.ok) return [];
    data = await res.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return [];
  }

  return (data.features ?? []).map(banToPlace).filter(Boolean);
}

function banToPlace(feature) {
  const [lng, lat] = feature.geometry?.coordinates ?? [];
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;

  const p = feature.properties ?? {};

  // `context` vaut « 75, Paris, Île-de-France » : seule la région intéresse ici,
  // le département fait doublon avec le code postal juste à côté.
  const region = (p.context ?? '').split(',').pop()?.trim();

  // Ligne 1 : ce qui identifie le lieu. Ligne 2 : où il se trouve.
  const label = p.name || p.label || 'Sans nom';
  const detail = [[p.postcode, p.city].filter(Boolean).join(' '), region]
    .filter(Boolean)
    .join(', ');

  return { lng, lat, label, detail, key: p.id ?? `${lng},${lat}` };
}

// --- Photon (repli hors France) ----------------------------------------------

async function fromPhoton(query, { signal, limit }) {
  const url =
    `${PHOTON}?q=${encodeURIComponent(query)}` +
    `&limit=${limit}&lang=fr&lat=${BIAS.lat}&lon=${BIAS.lon}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Géocodage indisponible (${res.status})`);

  const data = await res.json();
  return (data.features ?? []).map(photonToPlace).filter(Boolean);
}

function photonToPlace(feature) {
  const [lng, lat] = feature.geometry?.coordinates ?? [];
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;

  const p = feature.properties ?? {};
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');

  const label = street || p.name || p.city || 'Sans nom';
  const detail = [
    street && p.name !== street ? p.name : null,
    p.postcode,
    p.city ?? p.county,
    p.country,
  ]
    .filter(Boolean)
    .join(', ');

  return { lng, lat, label, detail, key: `${p.osm_type ?? ''}${p.osm_id ?? `${lng},${lat}`}` };
}
