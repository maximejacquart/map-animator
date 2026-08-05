# Map Animator

Générateur d'animations de carte façon Google Earth Studio, entièrement dans le navigateur.
On tape une adresse, on choisit un format et une durée, on obtient un `.mp4` : un vol caméra
continu depuis la vue spatiale jusqu'au point, avec un pin qui tombe à l'arrivée.

Aucun serveur, aucune clé d'API, aucun coût de rendu.

![9:16 · 16:9 · 1:1](https://img.shields.io/badge/formats-9%3A16%20%C2%B7%2016%3A9%20%C2%B7%201%3A1-111)

## Pourquoi

Une équipe de monteurs devait produire la même animation « voici où exerce ce praticien »
pour des dizaines de vidéos. Google Earth Studio donne le bon mouvement mais ses CGU
interdisent l'usage commercial ; les éditeurs en ligne existants sont verrouillés en 1080×1920
et sans réglages.

D'où une page unique, partagée par toute l'équipe : même URL, même rendu, base commune garantie.

## Ce que ça fait

- **Géocodage sans clé** — API Adresse (data.gouv.fr) en priorité pour la France, bascule sur
  Photon (Komoot) pour le reste du monde.
- **Vol caméra** — trajectoire calculée comme une fonction pure `t → état caméra` (altitude,
  zoom, pitch, bearing), donc identique en preview et à l'export.
- **Trois formats** — 1080×1920, 1920×1080, 1080×1080, avec recadrage animé d'un format à l'autre.
- **Export mp4 dans le navigateur** — rendu frame par frame, encodage H.264 via WebCodecs,
  muxage avec `mp4-muxer`. 25 fps, bitrate calé sur la définition.
- **Préchauffage des tuiles** — la descente est pré-jouée avant l'export pour que le cache
  MapLibre soit rempli, sinon des tuiles manquantes apparaissent dans le fichier final.

## Le point d'architecture qui tient tout

La caméra ne lit jamais l'horloge. `cameraAt(t)` prend une progression normalisée et rend un état.

- La preview appelle `cameraAt` depuis `requestAnimationFrame`.
- L'export appelle `cameraAt` depuis un index de frame : `tFromFrame(i, n)`.

Conséquence : deux exports de la même adresse produisent le même fichier, et le résultat ne
dépend pas de la vitesse de la machine. Le même `composeScene()` peint la preview et chaque
frame exportée — un seul chemin de rendu, donc pas de dérive entre ce qu'on voit et ce qu'on obtient.

## Stack

| Rôle | Choix |
|---|---|
| Carte | MapLibre GL JS, projection globe |
| Tuiles | [OpenFreeMap](https://openfreemap.org) — vectoriel OSM, sans clé ni quota |
| Géocodage | API Adresse + Photon |
| Encodage | WebCodecs (`VideoEncoder`) + [`mp4-muxer`](https://github.com/Vanilagy/mp4-muxer) |
| Build | Vite |

Aucune dépendance de framework UI : DOM natif et `<canvas>`.

## Lancer

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # bundle statique dans dist/
```

L'export nécessite WebCodecs : Chrome ou Edge. Le reste de l'app fonctionne partout.

## Structure

```
src/
  main.js      état de l'app, boucle de preview, pilotage de l'export
  camera.js    fonction pure t → état caméra (le cœur)
  scene.js     dimensions de sortie et composition de l'image
  export.js    encodage H.264 + muxage mp4
  geocode.js   recherche d'adresse, deux fournisseurs
  labels.js    libellés de l'éditeur
  pin.js       dessin du marqueur
  warmup.js    préchauffage du cache de tuiles
```

## Licence des données

Les tuiles OpenFreeMap dérivent d'OpenStreetMap, sous ODbL : le crédit
`© OpenStreetMap contributors` est dû. Il n'est pas incrusté dans la vidéo par défaut
(voir `BURN_ATTRIBUTION` dans `src/scene.js`) — il est destiné à figurer là où les crédits
sont d'usage pour une vidéo : description du post ou générique.
