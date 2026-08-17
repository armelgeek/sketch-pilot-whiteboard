#!/usr/bin/env python3
"""
Détection de régions "à la vs.detectBoxes()" — pas le générateur TS complexe
(vision -> elements -> layout dérivé) déjà présent dans scene-json-generator,
juste l'équivalent direct de l'article Gemini : une image entre, un tableau
de boîtes 2D sort, mappé tel quel dans le schéma annotation.json existant.

Un seul appel vision à Claude, prompt court, JSON strict en sortie.
Nécessite ANTHROPIC_API_KEY dans l'environnement (celle déjà utilisée par
scene-json-generator/server.py).

Usage:
  python detect_regions.py image.png --out annotation.json \
      [--story "phrase de contexte optionnelle"] \
      [--duration-ms 900] [--gap-ms 150]
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import anthropic

MODEL = "claude-sonnet-5"

_SYSTEM_PROMPT = """Tu es un système de vision par ordinateur expert en détection
d'objets/éléments dans des images (photos ou dessins/sketchs).

Avant de répondre, regarde vraiment l'image en détail : repère chaque élément
visuellement distinct, y compris les petits ou partiellement superposés.
Sois précis sur les limites de chaque boîte -- elle doit serrer l'élément
au plus près, sans marge excessive ni élément voisin inclus.

Règles strictes :
1. La réponse DOIT être un JSON valide, sans texte avant/après, sans balises ```.
2. Chaque élément détecté a :
   - "label": nom court et descriptif
   - "type": "text" | "object" | "character" | "structure" | "prop" | "symbol"
   - "bbox": [x1, y1, x2, y2] normalisés entre 0 et 1 (coin haut-gauche puis
     bas-droit, relatif à la largeur/hauteur de l'image -- PAS de pixels bruts,
     les coordonnées normalisées sont plus fiables que le pixel direct)
   - "confidence": score de confiance entre 0 et 1
   - "transcript": UNIQUEMENT si type="text" -- transcris EXACTEMENT le texte
     visible dans cette zone (respecte majuscules, ponctuation, sauts de
     ligne avec \\n). Ne mets ce champ que pour les éléments de type "text".
3. Ordonne le tableau dans un ordre de lecture naturel (haut-gauche vers
   bas-droite), ou narratif si évident.
4. Format exact :
   [
     {"label": "...", "type": "...", "bbox": [0.12, 0.05, 0.48, 0.62], "confidence": 0.95}
   ]"""


def _b64_image(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return base64.b64encode(data).decode("utf-8"), media_type


def _extract_json_array(text: str) -> list[dict]:
    """Extraction tolérante : cherche le premier '[' et le dernier ']' plutôt
    que de dépendre d'un format de sortie strict (le modèle ajoute parfois
    un commentaire malgré la consigne)."""
    start = text.find("[")
    end = text.rfind("]") + 1
    if start < 0 or end <= start:
        raise ValueError(f"Aucun tableau JSON trouvé dans la réponse: {text[:200]!r}")
    return json.loads(text[start:end])


def detect_boxes(image_path: Path, w: int, h: int) -> list[dict]:
    client = anthropic.Anthropic()
    b64, media_type = _b64_image(image_path)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=_SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                {"type": "text", "text": f"Image: {w}x{h} pixels. Détecte tous les éléments."},
            ],
        }],
    )
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    raw = _extract_json_array(text)

    # dénormalise nous-mêmes (0..1 -> pixels) : on contrôle la précision de
    # la conversion plutôt que de laisser le modèle raisonner en pixels bruts
    boxes = []
    for item in raw:
        x1, y1, x2, y2 = item["bbox"]
        x1, x2 = sorted((x1, x2))
        y1, y2 = sorted((y1, y2))
        px1, py1 = round(x1 * w), round(y1 * h)
        px2, py2 = round(x2 * w), round(y2 * h)
        boxes.append({
            "label": item.get("label", "?"),
            "type": item.get("type", "object"),
            "confidence": item.get("confidence"),
            "transcript": item.get("transcript"),  # texte transcrit, uniquement si type="text"
            "box": {"x": px1, "y": py1, "width": max(1, px2 - px1), "height": max(1, py2 - py1)},
        })
    return boxes


def refine_contour_rembg(image_bgr, box: dict, margin_ratio: float = 0.25) -> list[list[int]] | None:
    """
    Affine un rectangle grossier en contour précis via rembg (U2Net) --
    bien plus fiable que GrabCut sur des photos à faible contraste
    (sujet clair sur fond clair, ex: tasse beige sur table grise).

    Clé du bon résultat : on recadre largement AUTOUR de l'objet avant
    d'appeler rembg (le sujet doit être le plus saillant du crop), on ne
    l'appelle jamais sur l'image entière -- sur l'image entière, rembg
    segmente l'élément le plus saillant globalement (ex: la table plutôt
    que la tasse posée dessus), pas l'objet visé par la boîte.

    Nécessite `pip install rembg onnxruntime` (télécharge un modèle de
    ~176 Mo au premier appel). Retourne None si rembg n'est pas installé
    ou si le masque obtenu est vide -- l'appelant doit alors utiliser
    refine_contour (GrabCut) ou le rectangle brut en repli.
    """
    try:
        from rembg import remove, new_session
    except ImportError:
        return None
    import cv2
    import numpy as np
    from PIL import Image

    h, w = image_bgr.shape[:2]
    mx = int(box["width"] * margin_ratio)
    my = int(box["height"] * margin_ratio)
    x0 = max(0, box["x"] - mx)
    y0 = max(0, box["y"] - my)
    x1 = min(w, box["x"] + box["width"] + mx)
    y1 = min(h, box["y"] + box["height"] + my)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None

    crop_rgb = cv2.cvtColor(image_bgr[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
    crop_pil = Image.fromarray(crop_rgb)
    session = new_session("u2net")
    result = remove(crop_pil, session=session)
    alpha = np.array(result.split()[-1])

    _, binary = cv2.threshold(alpha, 140, 255, cv2.THRESH_BINARY)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, k)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    crop_area = (x1 - x0) * (y1 - y0)
    if cv2.contourArea(biggest) < 0.03 * crop_area:
        return None  # rien de significatif détecté

    epsilon = 0.003 * cv2.arcLength(biggest, True)
    simplified = cv2.approxPolyDP(biggest, epsilon, True)
    # coordonnées locales au crop -> coordonnées image complète
    return [[int(pt[0][0]) + x0, int(pt[0][1]) + y0] for pt in simplified]


def refine_contour(image_bgr, box: dict, margin: int = 6) -> list[list[int]] | None:
    """
    Affine un rectangle grossier en contour précis via GrabCut.
    Repli léger (pas de dépendance/téléchargement) quand rembg n'est pas
    disponible -- mais moins fiable sur les sujets à faible contraste
    (voir refine_contour_rembg, à préférer par défaut).
    """
    import cv2
    import numpy as np

    h, w = image_bgr.shape[:2]
    x0 = max(0, box["x"] - margin)
    y0 = max(0, box["y"] - margin)
    x1 = min(w, box["x"] + box["width"] + margin)
    y1 = min(h, box["y"] + box["height"] + margin)
    rect = (x0, y0, x1 - x0, y1 - y0)
    if rect[2] <= 1 or rect[3] <= 1:
        return None

    mask = np.zeros((h, w), dtype=np.uint8)
    bgd_model = np.zeros((1, 65), dtype=np.float64)
    fgd_model = np.zeros((1, 65), dtype=np.float64)
    try:
        cv2.grabCut(image_bgr, mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None

    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(biggest) < 0.1 * rect[2] * rect[3]:
        return None  # GrabCut n'a rien trouvé de cohérent -> repli rectangle

    epsilon = 0.004 * cv2.arcLength(biggest, True)
    simplified = cv2.approxPolyDP(biggest, epsilon, True)
    return [[int(pt[0][0]), int(pt[0][1])] for pt in simplified]


def refine_shape(image_bgr, box: dict, method: str = "rembg") -> list[list[int]] | None:
    """Point d'entrée unique : essaie la méthode demandée, repli en cascade."""
    if method in ("rembg", "auto"):
        contour = refine_contour_rembg(image_bgr, box)
        if contour is not None:
            return contour
        if method == "rembg":
            return None  # rembg demandé explicitement, pas de repli silencieux
    if method in ("grabcut", "auto"):
        return refine_contour(image_bgr, box)
    return None


def to_annotation(
    boxes: list[dict], canvas_w: int, canvas_h: int,
    scene_id: str, story: str, duration_ms: int, gap_ms: int,
    image_bgr=None, refine_method: str = "rembg", bake_text: bool = False,
) -> dict:
    elements = []
    cur_ms = 300
    for i, b in enumerate(boxes, start=1):
        box = b["box"]
        x0, y0 = box["x"], box["y"]
        cx = x0 + box["width"] // 2
        transcript = b.get("transcript")
        element = {
            "id": f"el{i}",
            "label": b.get("label", f"Élément {i}"),
            "sequence": i,
            "narrativeRole": "",
            # métadonnée toujours : ce que dit le texte détecté (utile pour
            # le sous-titrage/la narration), sans jamais déclencher de
            # nouveau dessin -- voir textContent plus bas pour ça.
            "subtitle": transcript or "",
            "type": b.get("type", "object"),
            "region": {"x": x0, "y": y0, "width": box["width"], "height": box["height"]},
            "reveal": {
                "direction": "top_to_bottom", "startMs": cur_ms, "durationMs": duration_ms,
                "maskPaddingPx": 22, "protectedRegions": [],
            },
            "handPath": {"start": [cx, y0], "end": [cx, y0 + box["height"]], "easing": "easeInOut"},
        }
        # textContent ne se met QUE si explicitement demandé (--bake-text) :
        # il déclenche text_bake.py, qui redessine le texte À LA MAIN dans
        # l'image. Si ce texte existe déjà dans l'image source (cas normal
        # d'une détection), l'activer le dessinerait une seconde fois par
        #-dessus l'original. À réserver aux cas où le texte n'existe pas
        # encore dans l'image (ex: légende à injecter depuis un SRT).
        if bake_text and b.get("type") == "text" and transcript:
            element["textContent"] = transcript
        if image_bgr is not None and refine_method != "none":
            contour = refine_shape(image_bgr, box, method=refine_method)
            if contour is not None:
                element["contourPoints"] = contour  # forme réelle, pour un tracé néon fidèle
        elements.append(element)
        cur_ms += duration_ms + gap_ms

    return {
        "sceneId": scene_id,
        "canvas": {"width": canvas_w, "height": canvas_h},
        "storyBasis": story,
        "sceneDurationMs": cur_ms + 500,
        "elements": elements,
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Détection auto de régions -> annotation.json")
    p.add_argument("image")
    p.add_argument("--out", required=True)
    p.add_argument("--story", default="")
    p.add_argument("--duration-ms", type=int, default=900, help="durée de reveal par élément (défaut 900ms)")
    p.add_argument("--gap-ms", type=int, default=150, help="pause entre éléments (défaut 150ms)")
    p.add_argument("--refine", default="rembg", choices=["rembg", "grabcut", "auto", "none"],
                   help="raffinement du contour: rembg (défaut, fiable même faible contraste), "
                        "grabcut (repli léger sans dépendance), auto (rembg puis grabcut), none (rectangle brut)")
    p.add_argument("--bake-text", action="store_true",
                   help="active textContent sur les éléments texte détectés (les fait REdessiner "
                        "à la main par text_bake.py -- à réserver au texte absent de l'image source, "
                        "sinon double-dessin par-dessus l'original)")
    args = p.parse_args(argv)

    img_path = Path(args.image)
    try:
        from PIL import Image
        with Image.open(img_path) as im:
            w, h = im.size
    except ImportError:
        print("[err] Pillow requis pour lire les dimensions (pip install Pillow)", file=sys.stderr)
        return 1

    import cv2
    image_bgr = cv2.imread(str(img_path))

    print(f"  Détection sur {img_path.name} ({w}x{h})...")
    boxes = detect_boxes(img_path, w, h)
    print(f"  {len(boxes)} élément(s) détecté(s):")
    for b in boxes:
        conf = b.get("confidence")
        conf_str = f"{conf:.2f}" if isinstance(conf, (int, float)) else "?"
        print(f"    - {b.get('label', '?')} ({b.get('type', 'object')}, confiance {conf_str}) "
              f"box={b['box']}")
        if b.get("transcript"):
            print(f"        texte: {b['transcript']!r}")

    annotation = to_annotation(
        boxes, w, h, scene_id=img_path.stem, story=args.story,
        duration_ms=args.duration_ms, gap_ms=args.gap_ms, image_bgr=image_bgr,
        refine_method=args.refine, bake_text=args.bake_text,
    )
    out_path = Path(args.out)
    out_path.write_text(json.dumps(annotation, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OUTPUT={out_path.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
