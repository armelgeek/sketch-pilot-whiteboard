# Sketch Pilot — moteur d'animation whiteboard

Pipeline : image (doodle/sketch) + `annotation.json` → vidéo MP4 d'animation
"dessin à la main", avec détection automatique de régions par vision IA,
orchestration multi-scènes, et une UI web pour éditer/prévisualiser/rendre.

## Démarrage rapide (UI web)

```bash
pip install opencv-python numpy Pillow anthropic scipy
python server.py
# ouvrir http://localhost:8000 -- la scène de demo (examples/demo/) se charge automatiquement
```

L'UI (`assets/preview.html`) permet de : dessiner/éditer des zones à la souris,
choisir un **style de reveal** par élément (handwriting / wipe / fade /
typewriter / zoom / slide / rotate / iris / bounce), régler les **options
moteur** globales (ink-path, color-fill, pen-style, rotation de main) dans la
barre du haut, prévisualiser en JS (approximatif, seul le mode "dessin main"
classique est simulé — les 8 autres styles ne sont pas encore rejoués en JS),
puis lancer le vrai rendu Python (bouton "🎬 Rendu MP4 Python").

## État pour le MVP (honnête)

### Solide et testé (rendu réellement vérifié)
- Moteur de dessin : silhouette/trous internes/gaze final bornés
  correctement, trajets lissés, vitesse/épaisseur de trait variables, ordre
  de tracé sans grand saut, texte en ordre de lecture gauche→droite avec
  décorations tracées après le mot.
- 9 styles de reveal, 3 styles de trait, rotation de main calibrée.
- `render_project.py` (multi-scènes + transitions) et `server.py` +
  `preview.html` (UI web) : testés de bout en bout dans cet environnement
  (serveur démarré, `/api/scenes` et `/api/render_scene` appelés en vrai,
  vidéo produite avec les nouvelles options `renderOpts`).
- 30 transitions ffmpeg.

### Écrit mais jamais vérifié en conditions réelles
- `detect_regions.py` : aucun appel réel à l'API Anthropic n'a pu être fait
  ici (pas d'accès réseau à l'API dans cet environnement). À valider avec ta
  vraie clé avant de t'y fier en prod.
- L'aperçu JS en direct dans `preview.html` ne simule que le mode
  "handwriting" classique — les 8 autres styles de reveal ne sont visibles
  qu'après le vrai rendu Python, pas dans la prévisualisation canvas.

### Explicitement pas fait
- Vraie vectorisation (potrace) — seulement un fit B-spline.
- Phase "l'image prend vie" après le dessin — écarté (pas différenciant vs
  Higgsfield/Sora2).
- Mode `grid` n'a pas les mêmes raffinements que `skeleton`.

## Installation complète

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

pip install opencv-python numpy Pillow anthropic scipy

# optionnel — raffinement de contour sur de vraies photos (detect_regions.py)
pip install rembg onnxruntime

# recommande : ffmpeg systeme pour la fusion de scenes / transitions / transcodage H.264
```

`ANTHROPIC_API_KEY` doit être dans l'environnement pour `detect_regions.py`.

## Utilisation en ligne de commande (sans l'UI)

```bash
# scène unique
python scripts/render_stream_whiteboard.py \
    examples/demo/scene-01-monkey-mountain.png \
    examples/demo/scene-01-monkey-mountain.annotation.json \
    out/monkey.mp4 assets/drawing-hand.png --ink-path skeleton

# multi-scènes
python scripts/render_project.py examples/multiscene-project/manifest.json

# détection auto de régions (a valider avec ta cle API)
python scripts/detect_regions.py photo.png --out annotation.json --refine rembg
```

## Changelog complet de la session

Rien de tout ce qui suit ne casse le format de `annotation.json` — tous les
nouveaux champs (`reveal.style`, `reveal.slideFrom`) sont optionnels et
rétrocompatibles (absent = comportement `handwriting` d'origine).

### Fixes "zone blanche" (3 sources du même bug)
1. **Effet plaque** — `_silhouette_mask` suit la silhouette réelle, pas le
   rectangle de région.
2. **Topologie des trous** — `RETR_CCOMP` + hiérarchie, préserve les espaces
   blancs internes légitimes.
3. **"Gaze" final** — limité à l'union des silhouettes réellement dessinées
   (`ever_silhouette`).

### Qualité du tracé (mode `skeleton`)
- Trajets lissés entre traits séparés (plus de téléportation).
- Vitesse et épaisseur de trait variables selon le détail.
- Fit B-spline (scipy) au lieu du lissage Chaikin.
- **Ordre de tracé sans grand saut** : clustering par proximité spatiale +
  un seul balayage spatial par cluster (pas de double passe
  structure-puis-détail, qui recréait un saut retour-en-haut).

### Texte
- Ordre de lecture gauche→droite pour `type: "text"`.
- Décorations (soulignement) tracées après le mot, pas pendant.

### Main / stylo
- Rotation selon la tangente du trait, calibrée à `-138°` sur
  `drawing-hand.png` (PCA). Désactivée par défaut (`--hand-rotate` pour
  activer).
- `--pen-style fine|stylus|marker` : épaisseur de trait (érosion/dilatation
  sous-pixel du niveau de gris source).

### Remplissage couleur
- `brush` par défaut (suit le même chemin que l'encre, ne peut pas peindre
  une zone jamais dessinée). `contour-wipe` toujours disponible.

### `reveal.style` — 9 styles, tous optionnels
| Style | Mécanique | Main visible |
|---|---|---|
| `handwriting` *(défaut)* | tracé + colorie | oui |
| `wipe` | balayage directionnel | non |
| `fade` | fondu uniforme | non |
| `typewriter` | seuil gauche→droite quantifié | non |
| `zoom` | grossit depuis 0%, léger rebond | non |
| `slide` | arrive d'un bord (`reveal.slideFrom`) | non |
| `rotate` | incliné → redressé, fondu concurrent | non |
| `iris` | cercle qui s'agrandit depuis le centre | non |
| `bounce` | comme `slide` + rebond | non |

### `detect_regions.py`
- Détection vision Claude (`claude-sonnet-5`), coordonnées normalisées 0–1.
- Transcription de texte → toujours en `subtitle` (métadonnée) ;
  `textContent` (redessine le texte) seulement via `--bake-text` explicite.
- Raffinement de contour : `rembg` (défaut), `grabcut`, `auto`, `none`.

### `render_project.py`
- Manifeste JSON multi-scènes, `defaults`/`overrides` par scène,
  `transition`/`transitionMs` par défaut ou par jointure.

### `transitions.py`
- `VALID_TRANSITIONS` étendu de 10 à 30 types (sur 57 supportés par ffmpeg
  xfade).

### `server.py` + `assets/preview.html` (UI web)
- **`server.py`** : `handle_render_scene` acceptait avant des valeurs figées
  en dur (`--ink-path grid --color-fill contour-wipe`, les anciens défauts).
  Maintenant il lit `renderOpts` envoyé par le front (`inkPath`, `colorFill`,
  `penStyle`, `handRotate`), avec repli sur les **nouveaux** défauts du
  moteur (`skeleton`/`brush`) si absent.
- **`preview.html`** : nouveau champ **Style reveal** par élément (+
  **Départ (slide)** affiché conditionnellement), nouveau bloc **options de
  rendu** dans la barre du haut (ink-path / color-fill / pen-style /
  rotation main), badge violet dans la liste des zones si style non-défaut.
  Testé en conditions réelles : serveur démarré, requêtes HTTP envoyées,
  rendu confirmé avec les nouvelles options.

## Pause entre éléments

Pas de champ dédié : le moteur tient l'image immobile entre la fin d'un
élément (`startMs + durationMs`) et le `startMs` du suivant. Pour une pause,
repousser le `startMs` de l'élément suivant au-delà de la fin réelle du
précédent.

## Fichiers

```
server.py                        pont web local (racine -- sert assets/, examples/)
scripts/
  render_stream_whiteboard.py    moteur principal
  stream_render.py               composants bas niveau reutilises
  text_bake.py                   pre-bake du texte manuscrit dans l'image
  detect_regions.py              detection de regions par vision IA + transcription texte
  render_project.py              orchestration multi-scenes
  merge_scenes.py                 fusion multi-scenes + transitions
  transitions.py                  filtres xfade ffmpeg (30 types)
  parse_srt.py                    SRT -> decoupage en scenes
  prepare_env.py                   bootstrap venv + dependances
  render_annotation_preview.py    apercu statique des regions annotees
assets/
  preview.html                    UI web (editeur + previsualisation + rendu)
  drawing-hand.png                asset main/stylo (calibre: hand_angle_offset=-138°)
examples/
  demo/                            scene de demo auto-detectee par /api/scenes
    scene-01-monkey-mountain.png + .annotation.json
    scene-premium-bag.png + .annotation.json
  multiscene-project/manifest.json exemple pour render_project.py
```
