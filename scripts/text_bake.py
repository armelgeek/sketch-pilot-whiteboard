#!/usr/bin/env python3
"""
Texte manuscrit — réutilise le moteur de trait existant plutôt que d'en écrire un nouveau.

Idée : le renderer (render_stream_whiteboard.py) détecte "l'encre" par simple
seuillage adaptatif de l'image (thresh_map < ink_threshold), puis trace un
squelette / chemin de grille dessus. N'importe quel pixel sombre suffit donc
à devenir un trait animé — y compris du texte qu'on vient de dessiner nous-même.

Ce module "cuit" (bake) les éléments annotation.json de type "text" porteurs
d'un champ `textContent` DIRECTEMENT dans l'image, en espace pixel natif,
AVANT que le renderer ne calcule son thresh_map. Le texte devient alors un
trait comme un autre : squelettisé, tracé au stylo, révélé région par région,
sans devoir dupliquer toute la logique de stream/skeleton/pause déjà écrite.

Ne concerne QUE les éléments "text" avec `textContent` (légendes/captions
injectées par le pipeline, ex. depuis un SRT). Un élément "text" qui
correspond à un titre déjà dessiné dans l'image source (ex: "L'ARROGANCE"
sur une illustration) n'a pas besoin de ça : son encre existe déjà.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Polices manuscrites à essayer dans l'ordre ; premier fichier trouvé gagne.
# Idéalement fournir un .ttf manuscrit maison dans assets/fonts/.
_HANDWRITING_CANDIDATES = [
    "assets/fonts/handwriting.ttf",
    "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "/System/Library/Fonts/Supplemental/Noteworthy.ttc",
    "C:/Windows/Fonts/segoepr.ttf",  # Segoe Print
    "C:/Windows/Fonts/comic.ttf",
]


def _resolve_font(skill_root: Path, explicit_path: str | None) -> str | None:
    candidates = [explicit_path] if explicit_path else []
    candidates += [str(skill_root / c) if not Path(c).is_absolute() else c
                   for c in _HANDWRITING_CANDIDATES]
    for c in candidates:
        if c and Path(c).is_file():
            return c
    return None


def _fit_font(draw: ImageDraw.ImageDraw, text: str, font_path: str | None,
              max_width: int, max_height: int) -> ImageFont.FreeTypeFont:
    """Cherche la plus grande taille de police qui tient dans la region."""
    size = max_height
    while size > 8:
        try:
            font = ImageFont.truetype(font_path, size) if font_path else ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()
            break
        bbox = draw.textbbox((0, 0), text, font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if w <= max_width and h <= max_height:
            return font
        size -= 2
    try:
        return ImageFont.truetype(font_path, 12) if font_path else ImageFont.load_default()
    except Exception:
        return ImageFont.load_default()


def bake_text_elements(
    image_bgr: np.ndarray,
    annotation: dict,
    skill_root: Path,
    font_path: str | None = None,
    ink_hex: str = "#1a1a1a",
) -> np.ndarray:
    """
    Dessine les elements type="text" avec textContent directement dans
    image_bgr, en mappant les coordonnees canvas -> pixels natifs de l'image.
    Retourne un nouveau tableau BGR (ne modifie pas l'original en place).
    """
    canvas_w = annotation["canvas"]["width"]
    canvas_h = annotation["canvas"]["height"]
    img_h, img_w = image_bgr.shape[:2]
    sx, sy = img_w / canvas_w, img_h / canvas_h

    text_elements = [
        e for e in annotation.get("elements", [])
        if e.get("type") == "text" and e.get("textContent")
    ]
    if not text_elements:
        return image_bgr

    resolved_font = _resolve_font(skill_root, font_path)
    if resolved_font is None:
        print("[warn] Aucune police manuscrite trouvee, repli sur police par defaut "
              "(rendu moins 'a la main'). Fournis --caption-font ou assets/fonts/handwriting.ttf")

    rgb = Image.fromarray(image_bgr[:, :, ::-1].copy())
    draw = ImageDraw.Draw(rgb)
    ink_rgb = tuple(int(ink_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))

    for el in text_elements:
        region = el["region"]
        x0 = int(region["x"] * sx)
        y0 = int(region["y"] * sy)
        w = max(1, int(region["width"] * sx))
        h = max(1, int(region["height"] * sy))
        text = el["textContent"]

        font = _fit_font(draw, text, resolved_font, int(w * 0.94), int(h * 0.85))
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = x0 + max(0, (w - tw) // 2) - bbox[0]
        ty = y0 + max(0, (h - th) // 2) - bbox[1]
        draw.text((tx, ty), text, font=font, fill=ink_rgb)

    return np.array(rgb)[:, :, ::-1].copy()
