# Map Animator

Une adresse, une durée, un `.mp4` : un vol caméra continu depuis la vue spatiale jusqu'au point,
façon Google Earth Studio. Tout se passe dans le navigateur — pas de serveur de rendu, pas de
clé d'API.

Fait pour une équipe de monteurs qui devait produire la même animation « voici où exerce ce
praticien » sur des dizaines de vidéos, à partir d'une base commune.

## Comment ça marche

- **Google Earth Studio donne le bon mouvement mais interdit l'usage commercial.** Il a fallu
  reconstruire le vol : tuiles OpenFreeMap (OSM, sans clé ni quota) et caméra pilotée à la main.
- **La caméra ne lit jamais l'horloge.** `cameraAt(t)` est une fonction pure : la preview
  l'appelle depuis `requestAnimationFrame`, l'export depuis un index de frame. Deux exports de
  la même adresse donnent le même fichier, quelle que soit la machine.
- **Encodage côté client.** WebCodecs pour le H.264, `mp4-muxer` pour le conteneur. Les tuiles
  sont préchargées en rejouant la descente à vide, sinon des trous apparaissent dans le fichier.

Trois formats de sortie : 1080×1920, 1920×1080, 1080×1080.

## Lancer

```bash
npm install
npm run dev     # http://localhost:5173
```

L'export demande WebCodecs — Chrome ou Edge. Le reste fonctionne partout.

Vite, MapLibre GL JS, `mp4-muxer`. Pas de framework UI : DOM natif et `<canvas>`.

## Données

Les tuiles dérivent d'OpenStreetMap, sous ODbL. Le crédit `© OpenStreetMap contributors` n'est
pas incrusté dans la vidéo par défaut (`BURN_ATTRIBUTION`, `src/scene.js`) : il est destiné à
figurer là où les crédits sont d'usage pour une vidéo, description du post ou générique.
