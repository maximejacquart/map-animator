/**
 * Lisibilité des libellés de la carte.
 *
 * Le style Liberty est dessiné pour une carte qu'on consulte à l'écran, de
 * près, en pouvant zoomer. Ses libellés font 10 à 14 px, il y en a beaucoup,
 * et leur hiérarchie repose sur des écarts de 2 px. Dans une image de 1080 px
 * de large regardée sur un fil d'actualité, rien de tout ça ne tient.
 *
 * On reprend donc les tailles à zéro plutôt que de multiplier les siennes :
 * multiplier une hiérarchie la recopie, elle ne la creuse pas.
 *
 * La retouche est faite une fois, au chargement du style. Elle ne dépend pas de
 * `t` : preview et export voient exactement la même carte.
 */

/**
 * Le vol montre deux moments, et deux seulement.
 *
 *   Le départ (z5.2) — la France dans l'Europe. Titre : le nom du pays.
 *   L'arrivée (z12.9) — le quartier du cabinet. Titre : le nom de la ville.
 *
 * Les deux sont accordés sur la même partition : un titre à 40 px, un second
 * rôle à 26 px. Le nom de ville reprend donc exactement la place que le nom de
 * pays occupait au début, ce qui donne au plan sa symétrie.
 */
const TITRE = 40;
const SECOND = 26;

/** Aucun libellé en gras. C'est la taille et la valeur du gris qui classent. */
const REGULAR = ['Noto Sans Regular'];

/**
 * Nom en écriture latine, sur une seule ligne.
 *
 * Le style concatène le nom latin et le nom non-latin (« Algiers الجزائر »),
 * ce qui produit deux lignes rendues avec des polices différentes. À grande
 * taille, l'incohérence saute aux yeux.
 */
const NOM_LATIN = ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];

export const LABELS = {
  haloColor: '#ffffff',
  haloBlur: 0.6,

  /**
   * Le bruit. Rien ici n'aide à situer un cabinet, et tout se dispute la place
   * avec les deux noms qui portent le plan.
   */
  hidden: [
    'poi_r20',
    'poi_r7',
    'poi_r1',
    'poi_transit',
    'road_one_way_arrow',
    'road_one_way_arrow_opposite',
    'waterway_line_label',
    'water_name_line_label',
    'water_name_point_label',
    'highway-shield-non-us',
    'highway-shield-us-interstate',
    'road_shield_us',
    'airport',
    'label_other',          // hameaux, lieux-dits, quartiers
    'highway-name-path',    // chemins, sentiers
    'highway-name-minor',   // rues de desserte
    'highway-name-major',   // grands axes : plus aucune voirie nommée
    'label_village',        // villages
    'label_state',          // régions
    'label_country_3',      // Monaco, Andorre, Guernesey, Vatican, Gibraltar…
  ],

  /**
   * Les quatre calques conservés, avec leur courbe de taille écrite à la main.
   *
   * Chaque courbe est une liste de paliers `zoom, taille`. Les valeurs sont des
   * pixels de sortie, dans une image de 1080 px de large — pas des pixels
   * d'écran. Entre deux paliers, MapLibre interpole.
   *
   * Les calques de pays plafonnent à z9 dans le style : ils ne vivent que sur
   * la première moitié de la descente, et disparaissent d'eux-mêmes avant que
   * les villes ne prennent le premier plan. Les deux ne se disputent jamais.
   */
  emphasis: {
    // Le pays d'arrivée et ses grands voisins. Le titre du départ.
    label_country_1: {
      size: ['interpolate', ['linear'], ['zoom'], 3, 30, 5.2, TITRE, 9, 44],
      color: '#3d3d63',
      halo: 2.6,
      opacity: 1,
    },

    // Les pays de moindre rang : présents pour situer, jamais titres.
    label_country_2: {
      size: ['interpolate', ['linear'], ['zoom'], 3, 19, 5.2, SECOND, 9, 29],
      color: '#7c7c9c',
      halo: 2.2,
      opacity: 0.9,
    },

    // Le titre de l'arrivée. Une capitale porte un peu plus, sans changer de
    // registre : c'est la même famille de taille.
    label_city_capital: {
      size: ['interpolate', ['linear'], ['zoom'], 4, 16, 5.2, 19, 9, 28, 12.9, TITRE + 2],
      color: '#14143c',
      halo: 3,
      opacity: 1,
    },

    label_city: {
      size: ['interpolate', ['linear'], ['zoom'], 4, 15, 5.2, 18, 9, 25, 12.9, TITRE],
      color: '#14143c',
      halo: 3,
      opacity: 1,
    },

    // Le second rôle de l'arrivée, à la place qu'occupaient les voisins au
    // départ. `minzoom: 6` dans le style, d'où le premier palier.
    label_town: {
      size: ['interpolate', ['linear'], ['zoom'], 6, 13, 9, 16, 12.9, SECOND],
      color: '#5c5c80',
      halo: 2.2,
      opacity: 0.9,
    },
  },
};

/**
 * @param {import('maplibre-gl').Map} map  carte dont le style est chargé
 * @param {typeof LABELS} [config]
 */
export function emphasizeLabels(map, config = LABELS) {
  for (const id of config.hidden) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }

  for (const [id, rank] of Object.entries(config.emphasis)) {
    if (!map.getLayer(id)) continue;

    map.setLayoutProperty(id, 'text-size', rank.size);
    map.setLayoutProperty(id, 'text-font', REGULAR);
    map.setLayoutProperty(id, 'text-field', NOM_LATIN);

    map.setPaintProperty(id, 'text-color', rank.color);
    map.setPaintProperty(id, 'text-opacity', rank.opacity);

    // Le halo est ce qui détache le texte du fond de carte. À ces tailles, la
    // valeur d'origine (1 px) ne suffit plus.
    map.setPaintProperty(id, 'text-halo-color', config.haloColor);
    map.setPaintProperty(id, 'text-halo-width', rank.halo);
    map.setPaintProperty(id, 'text-halo-blur', config.haloBlur);
  }
}
