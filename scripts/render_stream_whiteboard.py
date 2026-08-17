#!/usr/bin/env python3
"""
SRT 白板动画 - 整合渲染器（mask 编排 + stream 画法）

把一张线稿图 + 同名 annotation.json 渲染成白板手绘动画：
  - 编排沿用 whiteboard-mask-animation：按 sequence/startMs 顺序逐区域揭示，
    每个区域的可作画范围 = 矩形 region 扣除「后续区域 + protectedRegions」，
    未开始的区域因掩码限制不会提前露线（mask 的核心不变量）。
  - 画法换成 whiteboard-stream-animation：每个区域在自己的允许掩码内，
    沿骨架/网格笔迹连续落墨（起笔 ink → 添彩 color），笔尖跟随真实笔迹，
    所有区域共享同一张持久画布，已画完的区域保留在画布上。

与 mask 的矩形擦除揭示不同：这里是「笔尖沿线滑行、边走边落墨」的连贯笔迹。
输出末行打印 OUTPUT=<路径>，便于上层捕获。

用法：
  <ENV_PY> render_stream_whiteboard.py <图片> <标注json> <输出mp4> [手部素材png]
  可选参数见 --help（--ink-path / --color-fill / --pause / --total-ms 等）。
  --total-ms 缺省时用标注里的 sceneDurationMs。
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

# 复用 stream 渲染器的全部构件（同目录）
_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))
import stream_render as sr  # noqa: E402
from text_bake import bake_text_elements  # noqa: E402

DEFAULT_HAND = _SCRIPT_DIR.parent / "assets" / "drawing-hand.png"
SKILL_ROOT = _SCRIPT_DIR.parent


# ──────────────────────────────────────────────────────────────
# 区域几何：把标注画布坐标缩放到输出尺寸
# ──────────────────────────────────────────────────────────────
def _scaled_rect(region: dict, sx: float, sy: float, out_w: int, out_h: int) -> tuple[int, int, int, int]:
    x0 = int(round(region["x"] * sx))
    y0 = int(round(region["y"] * sy))
    x1 = int(round((region["x"] + region["width"]) * sx))
    y1 = int(round((region["y"] + region["height"]) * sy))
    x0 = max(0, min(out_w, x0))
    x1 = max(0, min(out_w, x1))
    y0 = max(0, min(out_h, y0))
    y1 = max(0, min(out_h, y1))
    return x0, y0, x1, y1


def _frame_progress_indices(n_steps: int, target_frames: int) -> list[int]:
    """把 n_steps 个笔尖位置均匀映射到 target_frames 帧。"""
    if n_steps == 0 or target_frames <= 0:
        return []
    if target_frames == 1:
        return [n_steps - 1]
    return [round(f * (n_steps - 1) / (target_frames - 1)) for f in range(target_frames)]


def _frame_progress_indices_weighted(weights: list[float], target_frames: int) -> list[int]:
    """
    Comme _frame_progress_indices, mais la vitesse d'avancement varie selon
    `weights` (un poids par point) au lieu d'être uniforme.

    Un poids élevé = la main "s'attarde" sur ce point (plus de frames y sont
    dépensées, donc mouvement plus lent à l'écran) ; un poids faible = elle
    y passe vite. Sert à ralentir sur le petit détail (yeux, petites lignes)
    et accélérer sur les longs traits simples ou les trajets "stylo levé" —
    comme une vraie main qui ne dessine jamais à vitesse constante.
    """
    n = len(weights)
    if n == 0 or target_frames <= 0:
        return []
    if target_frames == 1:
        return [n - 1]
    cum = [0.0] * (n + 1)
    for i, w in enumerate(weights):
        cum[i + 1] = cum[i] + max(w, 1e-6)
    total = cum[-1]
    out: list[int] = []
    idx = 0
    for f in range(target_frames):
        target = total * f / (target_frames - 1)
        while idx < n and cum[idx + 1] < target:
            idx += 1
        out.append(min(idx, n - 1))
    return out


class AsyncVideoWriter:
    def __init__(self, path_str: str, fourcc, fps: int, size: tuple[int, int], max_queue: int = 128):
        import queue, threading
        self.writer = cv2.VideoWriter(path_str, fourcc, fps, size)
        self.q = queue.Queue(maxsize=max_queue)
        self.stopped = False
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def _worker(self):
        while True:
            frame = self.q.get()
            if frame is None:
                self.q.task_done()
                break
            self.writer.write(frame)
            self.q.task_done()

    def write(self, frame: np.ndarray):
        self.q.put(frame)

    def close(self):
        self.q.put(None)
        self.thread.join()
        self.writer.release()


# ──────────────────────────────────────────────────────────────
# 每区域的 stream 笔迹渲染，写入共享持久画布
# ──────────────────────────────────────────────────────────────
class RegionStreamRenderer:
    """持有整段渲染的共享状态；逐区域把 stream 笔迹画进同一张画布。"""

    def __init__(self, image_bgr: np.ndarray, annotation: dict, cfg: sr.Config,
                 hand_png: Path | None, bare_tip: bool) -> None:
        self.cfg = cfg
        self.ann = annotation
        self.canvas_bgr = sr._hex_to_bgr(cfg.canvas_hex)

        # 输出尺寸：长边限到 cap，对齐到 grid_edge 的偶数倍（编码要求偶数）
        h0, w0 = image_bgr.shape[:2]
        scale = cfg.cap_long_edge / max(h0, w0)
        align = cfg.grid_edge if cfg.grid_edge % 2 == 0 else cfg.grid_edge * 2
        w = max(align, (int(round(w0 * scale)) // align) * align)
        h = max(align, (int(round(h0 * scale)) // align) * align)
        self.out_w, self.out_h = w, h

        # 标注画布坐标 → 输出坐标的缩放比
        cw = annotation["canvas"]["width"]
        ch = annotation["canvas"]["height"]
        self.sx = self.out_w / cw
        self.sy = self.out_h / ch

        self.color_img = cv2.resize(image_bgr, (self.out_w, self.out_h), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(self.color_img, cv2.COLOR_BGR2GRAY)
        self.thresh_map = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 10
        )
        if cfg.pen_line_weight != 1.0:
            self.thresh_map = self._adjust_line_weight(self.thresh_map, cfg.pen_line_weight)
        self.grid_blocks = sr._to_grid_blocks(self.thresh_map, cfg.grid_edge)
        self.active_all = sr._active_mask(self.thresh_map, cfg.grid_edge, cfg.ink_threshold)
        self.ink_pixels = self.thresh_map < cfg.ink_threshold
        self.ink_paint = np.repeat(self.thresh_map[:, :, None], 3, axis=2).astype(np.float32)

        # 背景染成画布底色，让上色阶段背景与起笔一致（不碰墨迹）
        if cfg.match_bg:
            self._match_original_background()

        # 共享持久画布
        self.drawn = np.empty((self.out_h, self.out_w, 3), dtype=np.float32)
        self.drawn[...] = self.canvas_bgr.astype(np.float32)
        # grille de coordonnées réutilisable pour le wipe directionnel (revealStyle="wipe")
        self._grid_y, self._grid_x = np.indices((self.out_h, self.out_w))

        # 笔尖覆盖
        self.tip: sr.TipOverlay | None = None
        if not bare_tip:
            hand_data = sr._load_hand(hand_png, cfg.target_hand_height) if hand_png else None
            ax, ay = cfg.tip_anchor_x, cfg.tip_anchor_y
            if hand_data is None:
                hand_data = sr._procedural_tip(cfg.target_hand_height)
                ax, ay = 0.5, 0.70
            self.tip = sr.TipOverlay(hand_data[0], hand_data[1], tip_anchor_x=ax, tip_anchor_y=ay)

    # ── Style de stylo (façon Golpo "Pen/Stylus/Marker") : ajuste l'épaisseur
    #    du trait en érodant/dilatant le niveau de gris (pas juste le masque
    #    booléen) -- comme ça la couleur révélée reste cohérente avec le
    #    trait épaissi/aminci, pas un halo gris de pixels de fond mal teintés.
    #    Érosion du gris = épaissit les zones sombres (marqueur) ; dilatation
    #    du gris = les amincit (pointe fine).
    def _adjust_line_weight(self, thresh_map: np.ndarray, weight: float) -> np.ndarray:
        if abs(weight - 1.0) < 0.02:
            return thresh_map
        # un noyau morphologique 3x3 est déjà le plus petit possible à
        # résolution native -- sur un trait fin, ce saut est trop marqué et
        # ne laisse aucun réglage intermédiaire doux. On érode/dilate sur
        # une version sur-échantillonnée (x3) puis on redescend : ça donne
        # un contrôle sous-pixel bien plus progressif.
        upscale = 3
        big = cv2.resize(thresh_map, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_LINEAR)
        if weight > 1.0:
            edge = max(3, int(round((weight - 1.0) * upscale * 3)) * 2 + 1)
            edge = min(edge, 15)
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (edge, edge))
            big = cv2.erode(big, k)
        else:
            edge = max(3, int(round((1.0 - weight) * upscale * 2)) * 2 + 1)
            edge = min(edge, 9)
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (edge, edge))
            big = cv2.dilate(big, k)
        return cv2.resize(big, (thresh_map.shape[1], thresh_map.shape[0]), interpolation=cv2.INTER_LINEAR)

    # 采样原图四角，把接近背景色的像素替换为画布底色
    def _match_original_background(self) -> None:
        img = self.color_img
        h, w = img.shape[:2]
        margin = max(3, min(h, w) // 50)
        samples = [img[:margin, :margin], img[:margin, -margin:],
                   img[-margin:, :margin], img[-margin:, -margin:]]
        bg = np.median(np.concatenate([s.reshape(-1, 3) for s in samples]), axis=0)
        diff = np.abs(img.astype(np.int16) - bg.astype(np.int16)).sum(axis=2)
        img[diff < self.cfg.match_bg_threshold] = self.canvas_bgr

    def _cell_center(self, cell: tuple[int, int]) -> tuple[int, int]:
        r, c = cell
        e = self.cfg.grid_edge
        return (c * e + e // 2, r * e + e // 2)

    def _snapshot_with_tip(self, px: int, py: int, alpha: float = 1.0, angle_deg: float = 0.0) -> np.ndarray:
        snap = self.drawn.astype(np.uint8)
        if self.tip is not None and alpha > 0.0:
            self.tip.stamp(snap, px, py, alpha=alpha, angle_deg=angle_deg)
        return snap

    def _tangent_angle(self, a: tuple[int, int], b: tuple[int, int]) -> float:
        """
        Angle (degrés) du déplacement a->b, pour orienter la main selon la
        direction du trait plutôt que de la garder figée.

        cfg.hand_angle_offset = l'angle de pointage NEUTRE de l'asset
        drawing-hand.png (mesuré une fois par analyse d'image -- direction
        du centre de la main vers la pointe du feutre ; ex: -138° pour la
        pointe en haut-gauche/poignet en bas-droite). On le SOUSTRAIT : le
        résultat "raw" représente alors l'écart entre la direction réelle
        du trait et cette pose neutre -- c'est cet écart qu'on fait
        pivoter, pas l'angle brut. cfg.hand_angle_clamp borne cet écart
        pour éviter un poignet qui se retourne de façon anatomiquement
        improbable sur les traits qui repartent en arrière.
        """
        dx, dy = b[0] - a[0], b[1] - a[1]
        if not self.cfg.hand_rotate or (abs(dx) < 1e-6 and abs(dy) < 1e-6):
            return 0.0
        raw = math.degrees(math.atan2(dy, dx)) - self.cfg.hand_angle_offset
        raw = ((raw + 180) % 360) - 180  # normalise en [-180, 180]
        clamp = self.cfg.hand_angle_clamp
        return max(-clamp, min(clamp, raw))

    def _travel_points(self, a: tuple[int, int], b: tuple[int, int], step: float) -> list[tuple[int, int]]:
        """Points interpolés de a à b (b inclus, a exclu) — utilisé pour les
        trajets "stylo levé" entre deux traits distincts, afin d'éviter un
        saut instantané (téléportation) du stylo à l'écran."""
        dist = math.hypot(b[0] - a[0], b[1] - a[1])
        steps = max(1, int(dist / step))
        return [(int(a[0] + (b[0] - a[0]) * s / steps), int(a[1] + (b[1] - a[1]) * s / steps))
                for s in range(1, steps + 1)]

    # ── 单区域的允许掩码：多边形/矩形 - 后续区域 - protectedRegions ──
    def _region_mask(self, region: dict) -> np.ndarray:
        mask_u8 = np.zeros((self.out_h, self.out_w), dtype=np.uint8)
        poly = region.get("polygon")
        if poly and isinstance(poly, list) and len(poly) >= 3:
            pts = np.array([[int(round(pt[0] * self.sx)), int(round(pt[1] * self.sy))] for pt in poly], dtype=np.int32)
            cv2.fillPoly(mask_u8, [pts], 255)
        else:
            x0, y0, x1, y1 = _scaled_rect(region, self.sx, self.sy, self.out_w, self.out_h)
            mask_u8[y0:y1, x0:x1] = 255
        return mask_u8 > 0

    def _allowed_mask(self, element: dict, later_elements: list[dict]) -> np.ndarray:
        mask = self._region_mask(element["region"])
        for later in later_elements:
            later_mask = self._region_mask(later["region"])
            mask &= ~later_mask
        for prot in element.get("reveal", {}).get("protectedRegions", []):
            prot_mask = self._region_mask(prot)
            mask &= ~prot_mask
        return mask

    # ── Fermeture + contours de l'encre détectée dans `allowed`, partagé par
    #    _silhouette_mask (remplissage) et _draw_detection_badge (tracé) ──
    def _closed_silhouette_contours(self, allowed: np.ndarray):
        region_ink = (self.ink_pixels & allowed).astype(np.uint8) * 255
        if not region_ink.any():
            return None, [], None, 0
        ys, xs = np.where(allowed)
        region_h = int(ys.max() - ys.min()) + 1
        region_w = int(xs.max() - xs.min()) + 1
        close_edge = int(np.clip(min(region_w, region_h) // 18, 5, 35))
        if close_edge % 2 == 0:
            close_edge += 1
        close_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_edge, close_edge))
        closed = cv2.morphologyEx(region_ink, cv2.MORPH_CLOSE, close_k)
        # RETR_CCOMP (pas RETR_EXTERNAL) : on a besoin de la hiérarchie pour
        # distinguer contour extérieur / trou interne -- voir _silhouette_mask.
        contours, hierarchy = cv2.findContours(closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        return closed, contours, hierarchy, close_edge

    # ── Forme réelle de l'objet dans `allowed`, au lieu du rectangle brut ──
    #
    # Pourquoi : sans ça, la phase couleur (_wash_contour / _wash_brush) finit
    # toujours par recouvrir TOUT le rectangle `allowed` (voir le filet de
    # sécurité en fin de _wash_contour), y compris le fond autour de l'objet.
    # Ça donne l'effet "plaque" qui recouvre l'image au lieu de suivre le
    # contour dessiné. Ici on referme le tracé d'encre détecté (fermeture
    # morphologique pour combler les traits interrompus) puis on remplit son
    # contour externe : le masque obtenu épouse la silhouette réelle du sujet,
    # pas la boîte englobante.
    #
    # Piège évité : cv2.findContours en RETR_EXTERNAL ignore les trous internes
    # (l'espace blanc entre un bras et le corps, entre deux rochers...) --
    # remplir bêtement le contour extérieur peignait alors ces espaces négatifs
    # comme s'ils faisaient partie de l'objet ("ça colore la partie blanche").
    # RETR_CCOMP + hiérarchie permet de les repérer (contour avec un parent =
    # un trou) et de les soustraire du remplissage.
    def _silhouette_mask(self, allowed: np.ndarray) -> np.ndarray:
        import hashlib, pickle
        from pathlib import Path

        cache_dir = Path(__file__).parent.parent / ".cache_silhouettes"
        cache_dir.mkdir(exist_ok=True)
        h = hashlib.md5(allowed.tobytes()).hexdigest()
        cache_file = cache_dir / f"sil_{h}.pkl"

        if cache_file.exists():
            try:
                with open(cache_file, "rb") as f:
                    return pickle.load(f)
            except Exception:
                pass

        closed, contours, hierarchy, close_edge = self._closed_silhouette_contours(allowed)
        if closed is None or not contours:
            return allowed  # rien détecté / pas de contour : repli sur le rectangle

        pad_edge = max(3, close_edge // 3)
        if pad_edge % 2 == 0:
            pad_edge += 1

        solid = np.zeros_like(closed)
        holes = np.zeros_like(closed)
        hier = hierarchy[0] if hierarchy is not None else []
        for i, cnt in enumerate(contours):
            parent = hier[i][3] if len(hier) else -1
            target = holes if parent != -1 else solid
            cv2.drawContours(target, [cnt], -1, 255, thickness=cv2.FILLED)

        pad_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad_edge, pad_edge))
        solid = cv2.dilate(solid, pad_k)  # petite marge sur le contour EXTÉRIEUR seulement
        filled = cv2.bitwise_and(solid, cv2.bitwise_not(holes))  # les trous restent non-dilatés, préservés nets

        silhouette = (filled > 0) & allowed
        if silhouette.sum() < 0.15 * allowed.sum():
            silhouette = allowed

        try:
            with open(cache_file, "wb") as f:
                pickle.dump(silhouette, f)
        except Exception:
            pass

        return silhouette

    # ── Badge "détection IA" : trace le contour néon EN SUIVANT la silhouette
    #    réelle (pas un cadre carré), puis pose un chip couleur "LABEL 92%". ──
    def _draw_detection_badge(self, writer, detection: dict, allowed: np.ndarray, frames: int) -> None:
        _, contours, _, _ = self._closed_silhouette_contours(allowed)
        if not contours:
            return  # pas de forme détectée : pas de badge plutôt qu'un faux carré
        contour = max(contours, key=cv2.contourArea)
        perim = cv2.arcLength(contour, True)
        if perim < 4:
            return

        # simplifie le contour en polygone (évite un tracé pixelisé/bruité)
        epsilon = max(1.5, perim * 0.01)
        approx = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        if len(approx) < 3:
            return
        pts = [(float(x), float(y)) for x, y in approx]
        pts.append(pts[0])  # referme la boucle
        path = sr._resample_stroke_points(pts, spacing=max(4.0, perim / 120))
        if len(path) < 2:
            return

        bgr = sr._hex_to_bgr(detection.get("color", "#26a7ff"))
        color = np.array([int(bgr[0]), int(bgr[1]), int(bgr[2])], dtype=np.float32)
        thickness = max(2, self.out_h // 220)

        bx, by, bw, bh = cv2.boundingRect(contour)
        margin = thickness * 6
        rx0, ry0 = max(0, bx - margin), max(0, by - margin)
        rx1, ry1 = min(self.out_w, bx + bw + margin), min(self.out_h, by + bh + margin)
        if rx1 <= rx0 or ry1 <= ry0:
            return
        local_path = [(x - rx0, y - ry0) for x, y in path]

        progress = np.zeros((ry1 - ry0, rx1 - rx0), dtype=np.uint8)
        n = len(local_path)
        idx_for_frame = _frame_progress_indices(n, max(1, frames))
        last = None
        tip_local = local_path[0]
        for si in idx_for_frame:
            if last is not None:
                a = (int(local_path[last][0]), int(local_path[last][1]))
                b = (int(local_path[si][0]), int(local_path[si][1]))
                cv2.line(progress, a, b, 255, thickness=thickness, lineType=cv2.LINE_AA)
            last = si
            tip_local = local_path[si]

            glow = cv2.GaussianBlur(progress, (0, 0), sigmaX=thickness * 1.4)
            glow_f = (glow.astype(np.float32) / 255.0)[:, :, None]
            roi = self.drawn[ry0:ry1, rx0:rx1] * (1.0 - glow_f * 0.55) + color * (glow_f * 0.55)
            roi[progress > 0] = color

            canvas = self.drawn.astype(np.uint8)
            canvas[ry0:ry1, rx0:rx1] = roi.astype(np.uint8)
            px, py = int(tip_local[0] + rx0), int(tip_local[1] + ry0)
            if self.tip is not None:
                self.tip.stamp(canvas, px, py, alpha=1.0)
            writer.write(canvas)

        # fixe le tracé néon définitivement sur le canvas persistant
        glow = cv2.GaussianBlur(progress, (0, 0), sigmaX=thickness * 1.4)
        glow_f = (glow.astype(np.float32) / 255.0)[:, :, None]
        roi_final = self.drawn[ry0:ry1, rx0:rx1]
        roi_final[...] = roi_final * (1.0 - glow_f * 0.55) + color * (glow_f * 0.55)
        roi_final[progress > 0] = color

        self._stamp_label_chip(detection, (bx, by, bw, bh), (int(bgr[0]), int(bgr[1]), int(bgr[2])))

    # ── Chip de label ("CUP 98%") posé au-dessus de la silhouette détectée ──
    def _stamp_label_chip(self, detection: dict, bbox: tuple[int, int, int, int],
                           color_bgr: tuple[int, int, int]) -> None:
        from PIL import Image, ImageDraw, ImageFont

        bx, by, bw, bh = bbox
        text = detection.get("label", "").upper()
        conf = detection.get("confidence")
        if conf is not None:
            text = f"{text} {conf}%"
        if not text.strip():
            return

        rgb = Image.fromarray(self.drawn.astype(np.uint8)[:, :, ::-1].copy())
        draw = ImageDraw.Draw(rgb)
        font_size = max(14, self.out_h // 42)
        font = None
        for candidate in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                           "/System/Library/Fonts/HelveticaNeue.ttc",
                           "C:/Windows/Fonts/arialbd.ttf"):
            try:
                font = ImageFont.truetype(candidate, font_size)
                break
            except Exception:
                continue
        if font is None:
            font = ImageFont.load_default()

        pad_x, pad_y = 14, 8
        tb = draw.textbbox((0, 0), text, font=font)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        chip_w, chip_h = tw + pad_x * 2, th + pad_y * 2
        cx0 = max(0, min(self.out_w - chip_w, bx))
        cy0 = max(0, by - chip_h - 6)
        color_rgb = (color_bgr[2], color_bgr[1], color_bgr[0])
        draw.rounded_rectangle((cx0, cy0, cx0 + chip_w, cy0 + chip_h), radius=6, fill=color_rgb)
        draw.text((cx0 + pad_x - tb[0], cy0 + pad_y - tb[1]), text, font=font, fill="white")

        self.drawn[...] = np.array(rgb)[:, :, ::-1].astype(np.float32)

    # ── 区域内笔迹路径 ──
    def _region_grid_path(self, allowed: np.ndarray) -> list[tuple[int, int]]:
        """网格模式：把区域内含墨的格聚类并串成连续格路径。"""
        allowed_u8 = allowed.astype(np.uint8)
        allowed_cell = sr._to_grid_blocks(allowed_u8, self.cfg.grid_edge).any(axis=(2, 3))
        active = self.active_all & allowed_cell
        if not active.any():
            return []
        streams = sr.cluster_ink_streams(active)
        return sr.flatten_streams(streams)

    # ── Regroupe les traits par proximité spatiale (union-find sur la
    #    distance entre boîtes englobantes) AVANT de les ordonner --
    #    _order_skeleton_strokes seul trie tous les traits à plat par "point
    #    le plus haut", ce qui peut sauter d'un bout d'un objet à un point
    #    plus haut d'un objet complètement différent, puis revenir. Ici, un
    #    objet (cluster) se termine avant de passer au suivant ; seul l'ordre
    #    ENTRE clusters suit le point le plus haut (façon lecture haut→bas).
    def _cluster_strokes(self, strokes: list[list[tuple[int, int]]],
                          gap_threshold: float) -> list[list[list[tuple[int, int]]]]:
        """Regroupe les traits par proximité spatiale (union-find sur la
        distance entre boîtes englobantes), clusters ordonnés par leur point
        le plus haut (façon lecture haut->bas). Retourne les clusters NON
        aplatis : à l'appelant de décider comment ordonner l'intérieur de
        chacun (ex: structure avant détail, mais calculé par cluster, pas
        globalement -- sinon les petits traits isolés de tous les objets se
        retrouvent mélangés entre eux dans une passe "détail" globale)."""
        n = len(strokes)
        if n <= 1:
            return [strokes] if strokes else []
        boxes = []
        for s in strokes:
            xs = [p[0] for p in s]
            ys = [p[1] for p in s]
            boxes.append((min(xs), min(ys), max(xs), max(ys)))

        parent = list(range(n))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(i: int, j: int) -> None:
            ri, rj = find(i), find(j)
            if ri != rj:
                parent[ri] = rj

        def box_dist(a, b) -> float:
            ax0, ay0, ax1, ay1 = a
            bx0, by0, bx1, by1 = b
            dx = max(ax0 - bx1, bx0 - ax1, 0)
            dy = max(ay0 - by1, by0 - ay1, 0)
            return math.hypot(dx, dy)

        for i in range(n):
            for j in range(i + 1, n):
                if box_dist(boxes[i], boxes[j]) <= gap_threshold:
                    union(i, j)

        groups: dict[int, list[int]] = {}
        for i in range(n):
            groups.setdefault(find(i), []).append(i)

        cluster_lists = list(groups.values())
        cluster_lists.sort(key=lambda idxs: min(min(p[1] for p in strokes[i]) for i in idxs))
        return [[strokes[i] for i in idxs] for idxs in cluster_lists]

    def _region_skeleton_strokes(self, allowed: np.ndarray) -> list[list[list[tuple[int, int]]]]:
        """骨架模式：区域内墨迹细化 + 8 邻接追踪 + 重采样平滑。
        Calcul mis en cache sur disque via hash MD5 du masque `allowed`."""
        import hashlib, pickle
        from pathlib import Path

        cache_dir = Path(__file__).parent.parent / ".cache_strokes"
        cache_dir.mkdir(exist_ok=True)
        h = hashlib.md5(allowed.tobytes()).hexdigest()
        cache_file = cache_dir / f"skel_{h}.pkl"

        if cache_file.exists():
            try:
                with open(cache_file, "rb") as f:
                    return pickle.load(f)
            except Exception:
                pass

        cfg = self.cfg
        region_ink = self.ink_pixels & allowed
        if not region_ink.any():
            return []
        skel = sr._zhang_suen_skeleton(region_ink, max_iterations=160)
        raw = sr.trace_8connected(skel, min_points=cfg.skeleton_min_points)
        if not raw:
            return []
        spacing = cfg.skeleton_resample_spacing
        out: list[list[tuple[int, int]]] = []
        for stroke in raw:
            pts = [(float(x), float(y)) for x, y in stroke]
            pts = sr._resample_stroke_points(pts, spacing)
            if cfg.vector_fit:
                # niveau 5, étape 1 : vraie courbe B-spline mathématique
                # plutôt qu'une polyligne pixel juste "arrondie" (Chaikin)
                pts = sr._fit_bspline_stroke(pts, spacing, smooth_factor=cfg.vector_smooth)
            else:
                pts = sr._chaikin_smooth(pts, iterations=1)
                pts = sr._resample_stroke_points(pts, spacing)
            if len(pts) >= 2 and sr._stroke_cumulative_length(pts)[-1] > 2.0:
                out.append([(int(round(x)), int(round(y))) for x, y in pts])
        if not out:
            return []
        ys_all = [p[1] for s in out for p in s]
        xs_all = [p[0] for s in out for p in s]
        region_span = max(max(ys_all) - min(ys_all), max(xs_all) - min(xs_all), 1)
        gap_threshold = max(12.0, region_span * 0.06)
        res = self._cluster_strokes(out, gap_threshold)

        try:
            with open(cache_file, "wb") as f:
                pickle.dump(res, f)
        except Exception:
            pass

        return res

    # ── 落墨（限制在 allowed 内）──
    def _reveal_ink_segment(self, a: tuple[int, int], b: tuple[int, int], allowed: np.ndarray,
                             radius: float | None = None) -> None:
        seg = np.zeros((self.out_h, self.out_w), dtype=np.uint8)
        r = self.cfg.ink_reveal_radius if radius is None else radius
        thick = max(1, int(round(r * 2 + 1)))
        cv2.line(seg, a, b, 255, thickness=thick, lineType=cv2.LINE_AA)
        revealed = (seg > 0) & self.ink_pixels & allowed
        self.drawn[revealed] = self.ink_paint[revealed]

    def _ink_stamp_cell(self, cell: tuple[int, int], allowed: np.ndarray) -> None:
        r, c = cell
        e = self.cfg.grid_edge
        block = self.grid_blocks[r, c]
        allow_block = allowed[r * e:r * e + e, c * e:c * e + e]
        ink_region = (block < self.cfg.ink_threshold) & allow_block
        paint = np.repeat(block[:, :, None], 3, axis=2)
        target = self.drawn[r * e:r * e + e, c * e:c * e + e]
        target[ink_region] = paint[ink_region]

    def _color_stamp(self, px: int, py: int, disk: np.ndarray, allowed: np.ndarray) -> None:
        radius = self.cfg.brush_radius
        h, w = self.out_h, self.out_w
        y0, y1 = max(0, py - radius), min(h, py + radius + 1)
        x0, x1 = max(0, px - radius), min(w, px + radius + 1)
        if y1 <= y0 or x1 <= x0:
            return
        by0, by1 = y0 - (py - radius), disk.shape[0] - ((py + radius + 1) - y1)
        bx0, bx1 = x0 - (px - radius), disk.shape[1] - ((px + radius + 1) - x1)
        m = disk[by0:by1, bx0:bx1] * allowed[y0:y1, x0:x1]
        inv = 1.0 - m
        target = self.drawn[y0:y1, x0:x1]
        source = self.color_img[y0:y1, x0:x1].astype(np.float32)
        for ch in range(3):
            target[:, :, ch] = target[:, :, ch] * inv + source[:, :, ch] * m

    # ── 起笔段（骨架模式）：沿笔迹逐段揭原图墨迹，无块填充 ──
    def _lay_ink(self, writer, frames: int, samples: list[tuple[int, int]],
                 pen_lifts: set[int], allowed: np.ndarray,
                 weights: list[float] | None = None) -> None:
        if frames <= 0:
            return
        n = len(samples)
        if n == 0:
            for _ in range(frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return
        idx_for_frame = (
            _frame_progress_indices_weighted(weights, frames) if weights is not None
            else _frame_progress_indices(n, frames)
        )
        last: int | None = None
        for si in idx_for_frame:
            # épaisseur liée au poids détail : la main "appuie" plus fort
            # quand elle ralentit sur du détail (weight>1), trait plus fin
            # sur les trajets rapides (weight<1) -- même logique que la
            # vitesse variable, cohérent avec un vrai geste de dessin.
            radius = None
            if weights is not None:
                w = weights[si]
                radius = max(1.0, self.cfg.ink_reveal_radius * (0.7 + 0.3 * w))
            if last is None:
                self._reveal_ink_segment(samples[si], samples[si], allowed, radius=radius)
            else:
                for k in range(last + 1, si + 1):
                    if k in pen_lifts:
                        continue
                    self._reveal_ink_segment(samples[k - 1], samples[k], allowed, radius=radius)
            sx, sy = samples[si]
            # oriente la main selon la direction du trait plutôt que de la
            # garder figée (utilise le point précédent réellement écrit)
            angle = self._tangent_angle(samples[last], samples[si]) if last is not None else 0.0
            writer.write(self._snapshot_with_tip(sx, sy, angle_deg=angle))
            last = si

    # ── 添彩段：brush 或 contour-wipe，限制在 allowed 内 ──
    # ── revealStyle="wipe" : balayage directionnel progressif, sans main ni
    #    trace de dessin -- révèle directement l'image finale dans la
    #    silhouette, comme un fondu progressif orienté (haut->bas par
    #    défaut). Alternative rapide à "handwriting" pour un élément donné.
    def _wipe_reveal(self, writer, frames: int, mask: np.ndarray, direction: str) -> None:
        if frames <= 0:
            return
        if not mask.any():
            snap = self.drawn.astype(np.uint8)
            for _ in range(frames):
                writer.write(snap)
            return
        vertical = direction in ("top_to_bottom", "bottom_to_top")
        coords = self._grid_y if vertical else self._grid_x
        vals = coords[mask]
        lo, hi = int(vals.min()), int(vals.max())
        reverse = direction in ("bottom_to_top", "right_to_left")
        color_f32 = self.color_img.astype(np.float32)
        for f in range(frames):
            t = (f + 1) / frames
            if reverse:
                thresh = hi - t * (hi - lo)
                band = coords >= thresh
            else:
                thresh = lo + t * (hi - lo)
                band = coords <= thresh
            reveal = mask & band
            self.drawn[reveal] = color_f32[reveal]
            writer.write(self.drawn.astype(np.uint8))

    # ── revealStyle="iris" : cercle qui s'agrandit depuis le centre de
    #    l'élément -- même mécanique que wipe (seuil progressif), mais sur
    #    une distance radiale au lieu d'une coordonnée x/y.
    def _iris_reveal(self, writer, frames: int, mask: np.ndarray) -> None:
        if frames <= 0:
            return
        if not mask.any():
            snap = self.drawn.astype(np.uint8)
            for _ in range(frames):
                writer.write(snap)
            return
        ys, xs = np.where(mask)
        cy, cx = (int(ys.min()) + int(ys.max())) / 2, (int(xs.min()) + int(xs.max())) / 2
        dist = np.sqrt((self._grid_y - cy) ** 2 + (self._grid_x - cx) ** 2)
        max_dist = float(dist[mask].max())
        color_f32 = self.color_img.astype(np.float32)
        for f in range(frames):
            t = (f + 1) / frames
            thresh = self._ease_out_cubic(t) * max_dist
            reveal = mask & (dist <= thresh)
            self.drawn[reveal] = color_f32[reveal]
            writer.write(self.drawn.astype(np.uint8))

    # ── revealStyle="fade" : fondu progressif dans la silhouette, sans main
    #    ni direction -- l'inverse du wipe (opacité uniforme plutôt qu'un
    #    front qui balaie).
    def _fade_reveal(self, writer, frames: int, mask: np.ndarray) -> None:
        if frames <= 0:
            return
        if not mask.any():
            snap = self.drawn.astype(np.uint8)
            for _ in range(frames):
                writer.write(snap)
            return
        base = self.drawn.copy()
        color_f32 = self.color_img.astype(np.float32)
        for f in range(frames):
            alpha = (f + 1) / frames
            frame_img = base.copy()
            frame_img[mask] = base[mask] * (1 - alpha) + color_f32[mask] * alpha
            writer.write(frame_img.astype(np.uint8))
        self.drawn[mask] = color_f32[mask]  # fixe l'état final dans le canvas persistant

    # ── revealStyle="typewriter" (texte only) : comme wipe mais quantifié en
    #    paliers (façon "chaque lettre saute d'un coup"), toujours
    #    gauche->droite quel que soit `direction`, AVEC main écriture réelle.
    def _typewriter_reveal(self, writer, frames: int, mask: np.ndarray, steps: int = 14) -> None:
        if frames <= 0:
            return
        if not mask.any():
            snap = self.drawn.astype(np.uint8)
            for _ in range(frames):
                writer.write(snap)
            return
        ys, xs = np.where(mask)
        lo, hi = int(xs.min()), int(xs.max())
        min_y, max_y = int(ys.min()), int(ys.max())
        height_span = max(10, max_y - min_y)
        mid_y = (min_y + max_y) // 2
        color_f32 = self.color_img.astype(np.float32)

        steps = max(1, min(steps, frames))
        frames_per_step = [len(c) for c in np.array_split(np.arange(frames), steps)]
        step_idx = 0
        frames_left_in_step = frames_per_step[0]

        for f in range(frames):
            while frames_left_in_step <= 0 and step_idx < steps - 1:
                step_idx += 1
                frames_left_in_step = frames_per_step[step_idx]

            cur_total_in_step = max(1, frames_per_step[step_idx])
            frame_in_step = cur_total_in_step - frames_left_in_step
            step_progress = frame_in_step / cur_total_in_step  # 0.0 -> 1.0 dans la lettre

            prev_thresh = lo + step_idx / steps * (hi - lo)
            next_thresh = lo + (step_idx + 1) / steps * (hi - lo)
            cur_x = prev_thresh + step_progress * (next_thresh - prev_thresh)

            # Révéler le texte par palier de lettre
            thresh = next_thresh if step_progress > 0.3 else prev_thresh
            reveal = mask & (self._grid_x <= thresh)
            self.drawn[reveal] = color_f32[reveal]

            # Mouvement d'écriture manuscrite réaliste de la main :
            # La main descend sur la feuille pour tracer la lettre, effectue une petite boucle Y (boucle de la lettre) et remonte légèrement (levé de stylo) avant la suivante.
            stroke_y_wave = math.sin(step_progress * math.pi * 2) * (height_span * 0.4)
            tip_x = int(cur_x)
            tip_y = int(mid_y + stroke_y_wave)

            # Animation de sortie fluide de la main à la fin
            hand_alpha = 1.0
            offset_y = 0
            progress = (f + 1) / frames
            if progress > 0.88:
                exit_t = (progress - 0.88) / 0.12
                hand_alpha = max(0.0, 1.0 - exit_t)
                offset_y = int(exit_t * 60)

            writer.write(self._snapshot_with_tip(tip_x, tip_y + offset_y, alpha=hand_alpha))
            frames_left_in_step -= 1

    @staticmethod
    def _ease_out_back(t: float) -> float:
        """Easing avec léger rebond/dépassement -- donne l'impression d'un
        élément qui "atterrit" plutôt qu'un zoom mécanique linéaire."""
        c1, c3 = 1.70158, 2.70158
        t -= 1.0
        return 1 + c3 * t ** 3 + c1 * t ** 2

    @staticmethod
    def _ease_out_cubic(t: float) -> float:
        return 1 - (1 - t) ** 3

    # ── revealStyle="zoom" : l'élément grossit depuis 0 jusqu'à sa taille
    #    réelle, avec un léger rebond (overshoot) façon pop-in -- pas un
    #    reveal sur place comme wipe/fade, une vraie transformation d'échelle.
    #
    # Implémenté via cv2.warpAffine (matrice de transformation continue),
    # PAS via resize(int(round(w*scale))) + collage à coordonnées entières :
    # cette dernière approche quantifie la taille en pixels entiers à chaque
    # frame -- très visible en tout début de zoom quand l'élément ne fait
    # que quelques pixels (un saut de 3px à 4px est un saut de 33%). warpAffine
    # gère l'échelle et la position en continu, sous-pixel, sans ce scintillement.
    def _zoom_reveal(self, writer, frames: int, mask: np.ndarray) -> None:
        if frames <= 0:
            return
        ys, xs = np.where(mask)
        if len(ys) == 0:
            snap = self.drawn.astype(np.uint8)
            for _ in range(frames):
                writer.write(snap)
            return
        y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        color_full = np.zeros_like(self.color_img, dtype=np.float32)
        color_full[y0:y1, x0:x1] = self.color_img[y0:y1, x0:x1]
        alpha_full = np.zeros((self.out_h, self.out_w), dtype=np.float32)
        alpha_full[y0:y1, x0:x1] = mask[y0:y1, x0:x1].astype(np.float32)
        base = self.drawn.copy()
        size = (self.out_w, self.out_h)
        for f in range(frames):
            t = (f + 1) / frames
            scale = max(0.02, self._ease_out_back(t))
            m = cv2.getRotationMatrix2D((cx, cy), 0.0, scale)
            warped_color = cv2.warpAffine(color_full, m, size, flags=cv2.INTER_LINEAR,
                                           borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
            warped_alpha = cv2.warpAffine(alpha_full, m, size, flags=cv2.INTER_LINEAR,
                                           borderMode=cv2.BORDER_CONSTANT, borderValue=0.0)
            a = warped_alpha[:, :, None]
            frame_img = base * (1 - a) + warped_color * a
            writer.write(frame_img.astype(np.uint8))
        self.drawn[mask] = self.color_img.astype(np.float32)[mask]

    # ── revealStyle="rotate" : l'élément arrive légèrement incliné et se
    #    redresse à 0°, en fondu concurrent -- même mécanique warpAffine que
    #    zoom (rotation au lieu d'échelle), avec un fondu séparé (sinon
    #    l'élément serait déjà pleinement opaque, juste incliné, dès la
    #    première frame).
    def _rotate_reveal(self, writer, frames: int, mask: np.ndarray, start_angle: float = -18.0) -> None:
        if frames <= 0:
            return
        ys, xs = np.where(mask)
        if len(ys) == 0:
            snap = self.drawn.astype(np.uint8)
            for _ in range(frames):
                writer.write(snap)
            return
        y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        color_full = np.zeros_like(self.color_img, dtype=np.float32)
        color_full[y0:y1, x0:x1] = self.color_img[y0:y1, x0:x1]
        alpha_full = np.zeros((self.out_h, self.out_w), dtype=np.float32)
        alpha_full[y0:y1, x0:x1] = mask[y0:y1, x0:x1].astype(np.float32)
        base = self.drawn.copy()
        size = (self.out_w, self.out_h)
        for f in range(frames):
            t = (f + 1) / frames
            angle = start_angle * (1 - self._ease_out_back(t))
            m = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
            warped_color = cv2.warpAffine(color_full, m, size, flags=cv2.INTER_LINEAR,
                                           borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
            warped_alpha = cv2.warpAffine(alpha_full, m, size, flags=cv2.INTER_LINEAR,
                                           borderMode=cv2.BORDER_CONSTANT, borderValue=0.0)
            fade = self._ease_out_cubic(t)  # fondu séparé de l'angle, concurrent
            a = (warped_alpha * fade)[:, :, None]
            frame_img = base * (1 - a) + warped_color * a
            writer.write(frame_img.astype(np.uint8))
        self.drawn[mask] = self.color_img.astype(np.float32)[mask]

    # ── revealStyle="slide" : l'élément arrive d'un bord de l'écran et se
    #    stabilise à sa place (reveal.slideFrom: left|right|top|bottom).
    #    Même logique warpAffine (translation continue, sous-pixel) que zoom.
    #    ease_fn paramétrable : réutilisée telle quelle par "bounce"
    #    (ease_out_back = un seul rebond, au lieu de ease_out_cubic).
    def _slide_reveal(self, writer, frames: int, mask: np.ndarray, slide_from: str,
                       ease_fn=None) -> None:
        ease_fn = ease_fn or self._ease_out_cubic
        if frames <= 0:
            return
        ys, xs = np.where(mask)
        if len(ys) == 0:
            snap = self.drawn.astype(np.uint8)
            for _ in range(frames):
                writer.write(snap)
            return
        y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
        color_full = np.zeros_like(self.color_img, dtype=np.float32)
        color_full[y0:y1, x0:x1] = self.color_img[y0:y1, x0:x1]
        alpha_full = np.zeros((self.out_h, self.out_w), dtype=np.float32)
        alpha_full[y0:y1, x0:x1] = mask[y0:y1, x0:x1].astype(np.float32)
        offsets = {
            "left": (0.0, -float(self.out_w)),
            "right": (0.0, float(self.out_w)),
            "top": (-float(self.out_h), 0.0),
            "bottom": (float(self.out_h), 0.0),
        }
        start_oy, start_ox = offsets.get(slide_from, offsets["left"])
        base = self.drawn.copy()
        size = (self.out_w, self.out_h)
        for f in range(frames):
            t = (f + 1) / frames
            e = ease_fn(t)
            oy = start_oy * (1 - e)
            ox = start_ox * (1 - e)
            m = np.array([[1.0, 0.0, ox], [0.0, 1.0, oy]], dtype=np.float32)
            warped_color = cv2.warpAffine(color_full, m, size, flags=cv2.INTER_LINEAR,
                                           borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
            warped_alpha = cv2.warpAffine(alpha_full, m, size, flags=cv2.INTER_LINEAR,
                                           borderMode=cv2.BORDER_CONSTANT, borderValue=0.0)
            a = warped_alpha[:, :, None]
            frame_img = base * (1 - a) + warped_color * a
            writer.write(frame_img.astype(np.uint8))
        self.drawn[mask] = self.color_img.astype(np.float32)[mask]

    def _wash_brush(self, writer, frames: int, centers: list[tuple[int, int]], allowed: np.ndarray) -> None:
        if frames <= 0:
            return
        n = len(centers)
        if n == 0:
            for _ in range(frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return
        disk = sr._feathered_disk(self.cfg.brush_radius)
        # avance le long du MÊME chemin que le dessin (centers == samples de
        # l'encre en mode skeleton), mais plus vite : on couvre tout le trajet
        # en une fraction des frames disponibles, plutôt que de le parcourir à
        # la même vitesse que le tracé au trait -- le "remplissage" doit
        # rattraper le dessin, pas le reproduire à l'identique.
        effective_frames = max(1, int(round(frames / self.cfg.brush_speed_mult)))
        idx_for_frame = _frame_progress_indices(n, effective_frames)
        last: int | None = None
        for ci in idx_for_frame:
            if last is None:
                self._color_stamp(*centers[ci], disk, allowed)
            else:
                for k in range(last + 1, ci + 1):
                    self._color_stamp(*centers[k], disk, allowed)
            cx, cy = centers[ci]

            # Hand exit fade out near end of wash
            hand_alpha = 1.0
            offset_y = 0
            if ci >= n * 0.88:
                exit_t = (ci - n * 0.88) / (n * 0.12)
                hand_alpha = max(0.0, 1.0 - exit_t)
                offset_y = int(exit_t * 60)

            writer.write(self._snapshot_with_tip(cx, cy + offset_y, alpha=hand_alpha))
            last = ci
        # le reste du budget frames (frames - effective_frames) tient la
        # forme déjà entièrement remplie -- laisse le temps au spectateur
        # de voir le résultat plutôt que couper brutalement
        for _ in range(frames - effective_frames):
            writer.write(self._snapshot_with_tip(*centers[-1]))

        # Filet de complétude : le pinceau suit le squelette du trait, donc
        # une grande zone plus large que 2x brush_radius de part et d'autre
        # du squelette peut ne pas être entièrement couverte par les tampons.
        # On comble ici le reste -- sûr désormais car `allowed` est la
        # silhouette qui respecte les trous internes (cf. _silhouette_mask),
        # pas le rectangle brut : ça ne peut plus peindre d'espace négatif.
        self.drawn[allowed] = self.color_img.astype(np.float32)[allowed]

    def _wash_contour(self, writer, frames: int, allowed: np.ndarray, last_ink_point: tuple[int, int] | None = None) -> None:
        if frames <= 0:
            return
        cfg = self.cfg
        ys_all, xs_all = np.where(allowed)
        if ys_all.size == 0:
            return
        top, bottom = int(ys_all.min()), int(ys_all.max())
        left, right = int(xs_all.min()), int(xs_all.max())
        region_h = bottom - top + 1
        region_w = right - left + 1

        # 区域内的阻力场（墨线膨胀 + 模糊 + 逐行向下衰减）
        ink_u8 = ((self.ink_pixels & allowed)[top:bottom + 1, left:right + 1].astype(np.uint8)) * 255
        spread = int(np.clip(min(region_w, region_h) // 32, 3, 17))
        if spread % 2 == 0:
            spread = max(3, spread - 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (spread, spread))
        dilated = cv2.dilate(ink_u8, kernel, iterations=1)
        blur_r = max(1, int(round(min(region_w, region_h) / 220.0)))
        if blur_r % 2 == 0:
            blur_r += 1
        resistance = cv2.GaussianBlur(dilated, (blur_r, blur_r), 0).astype(np.float32)
        peak = float(resistance.max())
        resistance = resistance / peak if peak > 1e-6 else np.zeros_like(resistance)
        decay = cfg.wipe_decay
        for row in range(1, region_h):
            resistance[row] = np.maximum(resistance[row], resistance[row - 1] * decay)

        wave = sr._build_wipe_wave(region_w)
        delay_px = int(np.clip(region_h * cfg.wipe_delay_ratio, 12, 52))
        ys = np.arange(region_h, dtype=np.float32)[:, None]
        sweep = region_h + 2 * delay_px
        blocks = max(1, cfg.wipe_blocks)

        allowed_crop = allowed[top:bottom + 1, left:right + 1]
        color_crop = self.color_img[top:bottom + 1, left:right + 1].astype(np.float32)
        drawn_crop = self.drawn[top:bottom + 1, left:right + 1]

        start_tip = last_ink_point if last_ink_point else (left + region_w // 2, top)

        for fi in range(frames):
            progress = 1.0 if frames == 1 else fi / (frames - 1)
            lead = sr._ease_in_out_sine(progress) * sweep - delay_px
            threshold = lead + wave[None, :] - resistance * delay_px
            reveal = (ys <= threshold) & allowed_crop
            drawn_crop[reveal] = color_crop[reveal]

            lane = sr._ease_in_out_sine((fi / blocks * 2.0) % 1.0)
            forward = (int(fi // blocks) % 2 == 0)
            cx = int(lane * region_w) if forward else int((1.0 - lane) * region_w)
            cx = max(0, min(region_w - 1, cx))
            col = np.where(reveal[:, cx])[0]
            cy = int(col[-1]) if col.size > 0 else 0
            target_x, target_y = left + cx, top + cy

            # Interpolate from start_tip during the first 25% of color frames
            if progress < 0.25:
                t = progress / 0.25
                tip_x = int(start_tip[0] + (target_x - start_tip[0]) * t)
                tip_y = int(start_tip[1] + (target_y - start_tip[1]) * t)
            else:
                tip_x, tip_y = target_x, target_y

            # Smooth hand fade out & drop during the last 12% of element duration
            hand_alpha = 1.0
            offset_y = 0
            if progress > 0.88:
                exit_t = (progress - 0.88) / 0.12
                hand_alpha = max(0.0, 1.0 - exit_t)
                offset_y = int(exit_t * 60)

            writer.write(self._snapshot_with_tip(tip_x, tip_y + offset_y, alpha=hand_alpha))

        # 收尾：确保区域内允许像素全部揭示
        drawn_crop[allowed_crop] = color_crop[allowed_crop]

    # ── 网格路径的采样计划（插值 + 抬笔 + 块填充索引）──
    #
    # 关键点：即使是"抬笔跳跃"（不相邻的格之间），也要插值出连续的过渡采样点，
    # 而不是单帧瞬移。之前的写法在跳跃处只放一个点，导致画面上出现瞬间闪跳
    # （saccade）。这里统一走插值分支，只是跳跃段用更大步长（更快的过渡速度），
    # 并整体标记进 pen_lifts，让 _reveal_ink_segment 跳过这段连线，但笔尖本身
    # 的运动依然连续可见。
    def _grid_plan(self, path: list[tuple[int, int]]):
        samples: list[tuple[int, int]] = []
        pen_lifts: set[int] = set()
        sample_cell: list[int] = []
        for idx, cell in enumerate(path):
            cx, cy = self._cell_center(cell)
            if idx == 0:
                samples.append((cx, cy))
                sample_cell.append(idx)
                continue
            prev_cell = path[idx - 1]
            prev = self._cell_center(prev_cell)
            is_jump = math.hypot(cell[0] - prev_cell[0], cell[1] - prev_cell[1]) > math.sqrt(2)
            dist = math.hypot(cx - prev[0], cy - prev[1])
            # 跳跃段用更大的采样步长 -> 插值点更少 -> 相同帧数下过渡更快，
            # 接近真实"抬笔快速挪到下一处"的观感，而不是等速画线的慢速。
            step_size = self.cfg.sample_step * (4 if is_jump else 1)
            steps = max(1, int(dist / step_size))
            start_idx = len(samples)
            for s in range(1, steps + 1):
                samples.append((int(prev[0] + (cx - prev[0]) * s / steps),
                                int(prev[1] + (cy - prev[1]) * s / steps)))
                sample_cell.append(idx)
            if is_jump:
                pen_lifts.update(range(start_idx, len(samples)))
        return samples, pen_lifts, sample_cell

    # ── 主渲染 ──
    def render_to(self, raw_path: Path, total_ms: int) -> Path:
        cfg = self.cfg
        elements = sorted(self.ann["elements"], key=lambda e: e["reveal"]["startMs"])
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = AsyncVideoWriter(str(raw_path), fourcc, cfg.fps, (self.out_w, self.out_h))

        weight_sum = cfg.ink_weight + cfg.color_weight
        cur_ms = 0.0
        ms_per_frame = 1000.0 / cfg.fps
        ever_silhouette = np.zeros((self.out_h, self.out_w), dtype=bool)

        def fill_static(until_ms: float) -> None:
            nonlocal cur_ms
            n = int(round((until_ms - cur_ms) / ms_per_frame))
            if n <= 0:
                return
            snap = self.drawn.astype(np.uint8)
            for _ in range(n):
                writer.write(snap)
            cur_ms += n * ms_per_frame

        # Pre-compute skeletons in parallel across CPU cores for all elements
        from concurrent.futures import ThreadPoolExecutor

        def _prep_element(idx_elem):
            idx, elem = idx_elem
            allowed = self._allowed_mask(elem, elements[idx + 1:])
            style = elem["reveal"].get("style", "handwriting")
            if style in ("wipe", "fade", "typewriter", "zoom", "slide", "rotate", "iris", "bounce"):
                return idx, allowed, None
            if cfg.ink_path_mode == "skeleton":
                clusters = self._region_skeleton_strokes(allowed)
                return idx, allowed, clusters
            return idx, allowed, None

        elem_preps = {}
        with ThreadPoolExecutor() as executor:
            results = executor.map(_prep_element, enumerate(elements))
            for idx, allowed, clusters in results:
                elem_preps[idx] = (allowed, clusters)

        try:
            for idx, element in enumerate(elements):
                reveal = element["reveal"]
                start_ms = reveal["startMs"]
                dur_ms = reveal["durationMs"]
                fill_static(start_ms)

                allowed, pre_clusters = elem_preps[idx]
                style = reveal.get("style", "handwriting")

                if style in ("wipe", "fade", "typewriter", "zoom", "slide", "rotate", "iris", "bounce"):
                    # styles progressifs sans main : révèlent directement dans la
                    # silhouette, pas de phase encre/couleur séparée
                    silhouette = self._silhouette_mask(allowed)
                    ever_silhouette |= silhouette
                    total_frames = max(1, round(dur_ms * cfg.fps / 1000))
                    if style == "wipe":
                        direction = reveal.get("direction", "top_to_bottom")
                        self._wipe_reveal(writer, total_frames, silhouette, direction)
                    elif style == "fade":
                        self._fade_reveal(writer, total_frames, silhouette)
                    elif style == "typewriter":
                        self._typewriter_reveal(writer, total_frames, silhouette)
                    elif style == "zoom":
                        self._zoom_reveal(writer, total_frames, silhouette)
                    elif style == "slide":
                        slide_from = reveal.get("slideFrom", "left")
                        self._slide_reveal(writer, total_frames, silhouette, slide_from)
                    elif style == "rotate":
                        self._rotate_reveal(writer, total_frames, silhouette)
                    elif style == "iris":
                        self._iris_reveal(writer, total_frames, silhouette)
                    elif style == "bounce":
                        slide_from = reveal.get("slideFrom", "top")
                        self._slide_reveal(writer, total_frames, silhouette, slide_from,
                                            ease_fn=self._ease_out_back)
                    cur_ms += total_frames * ms_per_frame
                    continue

                ink_frames = max(1, round(dur_ms * cfg.ink_weight / weight_sum * cfg.fps / 1000))
                color_frames = max(1, round(dur_ms * cfg.color_weight / weight_sum * cfg.fps / 1000))

                last_ink_pt = None
                if cfg.ink_path_mode == "skeleton":
                    clusters = pre_clusters
                    if clusters:
                        if element.get("type") == "text":
                            # texte : ordre de lecture gauche->droite, comme une vraie
                            # main qui écrit -- le clustering par objet n'a pas de sens
                            # ici (un mot est un seul "objet" visuellement), on aplatit
                            # tous les clusters et on trie globalement par position X.
                            strokes = [s for cluster in clusters for s in cluster]
                            stroke_bboxes = []
                            for s in strokes:
                                xs = [p[0] for p in s]
                                ys = [p[1] for p in s]
                                stroke_bboxes.append((min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)))
                            # décoration (soulignement, encadrement...) : trait très
                            # plat/large comparé à une lettre -- une vraie main le
                            # trace APRÈS avoir fini le mot, jamais pendant.
                            is_decoration = [(bw / max(bh, 1)) > 6 for (_, _, bw, bh) in stroke_bboxes]
                            letters_idx = [i for i in range(len(strokes)) if not is_decoration[i]]
                            deco_idx = [i for i in range(len(strokes)) if is_decoration[i]]
                            letters_idx.sort(key=lambda i: stroke_bboxes[i][0])
                            deco_idx.sort(key=lambda i: stroke_bboxes[i][0])
                            order = letters_idx + deco_idx
                            strokes = [strokes[i] for i in order]
                            is_detail = [False] * len(strokes)  # pas de notion de detail pour le texte
                        else:
                            # structure/grandes formes d'abord, petits détails isolés après
                            # -- MAIS calculé PAR CLUSTER (objet), pas globalement : sinon
                            # les petits traits isolés de tous les objets (herbe, poussière,
                            # décor) se retrouvent mélangés dans une passe "détail" globale,
                            # ce qui recrée le saut d'un objet à l'autre qu'on cherche à
                            # éviter. Ici, un cluster (structure+détail) se termine avant
                            # de passer au suivant -- seul l'ordre ENTRE clusters (déjà
                            # fixé par _region_skeleton_strokes) suit le point le plus haut.
                            # un seul passage spatial (bandes haut->bas, gauche->droite,
                            # long trait d'abord) par cluster -- PAS deux passes séparées
                            # structure-puis-détail : faire d'abord toute la structure en
                            # descendant, puis reprendre en haut pour le détail, recrée
                            # exactement le grand saut qu'on cherche à éviter. is_detail
                            # sert seulement à ralentir/épaissir (niveau 2/4), pas à
                            # réordonner -- on reste dans l'ordre spatial naturel.
                            def _stroke_sort_key(s):
                                if not s:
                                    return (0, 0, 0, 0)
                                xs = [p[0] for p in s]
                                ys = [p[1] for p in s]
                                length = sr._stroke_cumulative_length(s)[-1] if len(s) > 1 else 0.0
                                return (min(ys) // 12, min(xs), min(ys), -length)

                            strokes, is_detail = [], []
                            for cluster in clusters:
                                lengths = [sr._stroke_cumulative_length(s)[-1] if len(s) > 1 else 0.0
                                           for s in cluster]
                                lengths_sorted = sorted(lengths)
                                median_len = lengths_sorted[len(lengths_sorted) // 2] if lengths_sorted else 0.0
                                cluster_detail = [median_len > 1.0 and length < median_len * 0.35
                                                  for length in lengths]
                                paired = sorted(zip(cluster, cluster_detail),
                                                 key=lambda item: _stroke_sort_key(item[0]))
                                for s, d in paired:
                                    strokes.append(s)
                                    is_detail.append(d)

                        samples, pen_lifts, weights = [], set(), []
                        for si, stroke in enumerate(strokes):
                            if si > 0 and samples:
                                # trajet interpolé (stylo levé, mais visible) au lieu
                                # d'un saut instantané entre deux traits distincts
                                travel = self._travel_points(samples[-1], stroke[0], self.cfg.sample_step * 4)
                                start_idx = len(samples)
                                samples.extend(travel)
                                pen_lifts.update(range(start_idx, len(samples)))
                                weights.extend([0.35] * len(travel))  # trajet: rapide
                            detail_boost = 1.8 if is_detail[si] else 1.0  # détail: la main s'attarde
                            samples.extend(stroke)
                            weights.extend([detail_boost] * len(stroke))
                        self._lay_ink(writer, ink_frames, samples, pen_lifts, allowed, weights=weights)
                        centers = samples
                        if samples:
                            last_ink_pt = samples[-1]
                    else:
                        path = self._region_grid_path(allowed)
                        samples, pen_lifts, _ = self._grid_plan(path) if path else ([], set(), [])
                        self._lay_ink(writer, ink_frames, samples, pen_lifts, allowed)
                        centers = [self._cell_center(c) for c in path]
                        if samples:
                            last_ink_pt = samples[-1]
                else:
                    path = self._region_grid_path(allowed)
                    if path:
                        samples, pen_lifts, sample_cell = self._grid_plan(path)
                        self._lay_ink_grid(writer, ink_frames, samples, pen_lifts, sample_cell, path, allowed)
                        centers = [self._cell_center(c) for c in path]
                        if samples:
                            last_ink_pt = samples[-1]
                    else:
                        self._lay_ink(writer, ink_frames, [], set(), allowed)
                        centers = []

                cur_ms += ink_frames * ms_per_frame

                # La phase couleur suit la silhouette réelle de l'objet, pas le
                # rectangle `allowed` — sinon le fond autour de l'objet se
                # retrouve recouvert en même temps ("effet plaque").
                silhouette = self._silhouette_mask(allowed)
                ever_silhouette |= silhouette
                if cfg.color_fill == "contour-wipe":
                    self._wash_contour(writer, color_frames, silhouette, last_ink_point=last_ink_pt)
                else:
                    self._wash_brush(writer, color_frames, centers, silhouette)
                cur_ms += color_frames * ms_per_frame

                # Badge "détection IA" optionnel : contour néon qui suit la
                # silhouette réelle (pas un carré) + chip de label "LABEL 92%".
                detection = element.get("detection")
                if detection:
                    badge_ms = detection.get("durationMs", 600)
                    badge_frames = max(1, round(badge_ms * cfg.fps / 1000))
                    self._draw_detection_badge(writer, detection, allowed, badge_frames)
                    cur_ms += badge_frames * ms_per_frame

            # 凝视：补到 total_ms，并确保结尾至少停留 0.5s 完整原图
            gaze_until = max(total_ms, cur_ms + 500)
            # Ne révèle que l'union des silhouettes déjà dessinées -- pas tout
            # le canvas : sinon les marges/espaces jamais couverts par aucune
            # région annotée se retrouvent peints avec l'image source au tout
            # dernier moment, contournant le fix de silhouette par élément.
            self.drawn[ever_silhouette] = self.color_img.astype(np.float32)[ever_silhouette]
            fill_static(gaze_until)
        finally:
            writer.close()
        return raw_path

    # 网格起笔专用：带块填充，笔尖与揭墨同步
    def _lay_ink_grid(self, writer, frames: int, samples, pen_lifts, sample_cell, path, allowed) -> None:
        if frames <= 0:
            return
        n = len(samples)
        if n == 0:
            for _ in range(frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return
        idx_for_frame = _frame_progress_indices(n, frames)
        cells_done = 0
        last: int | None = None
        for si in idx_for_frame:
            if last is None:
                self._reveal_ink_segment(samples[si], samples[si], allowed)
            else:
                for k in range(last + 1, si + 1):
                    if k in pen_lifts:
                        continue
                    self._reveal_ink_segment(samples[k - 1], samples[k], allowed)
            target_cell = sample_cell[si]
            while cells_done <= target_cell and cells_done < len(path):
                self._ink_stamp_cell(path[cells_done], allowed)
                cells_done += 1
            sx, sy = samples[si]
            angle = self._tangent_angle(samples[last], samples[si]) if last is not None else 0.0
            writer.write(self._snapshot_with_tip(sx, sy, angle_deg=angle))
            last = si
        while cells_done < len(path):
            self._ink_stamp_cell(path[cells_done], allowed)
            cells_done += 1


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description="SRT 白板动画整合渲染器（mask 编排 + stream 画法）")
    p.add_argument("image", help="线稿图路径")
    p.add_argument("annotation", help="同名 annotation.json 路径")
    p.add_argument("output", help="输出 MP4 路径")
    p.add_argument("hand", nargs="?", default=str(DEFAULT_HAND), help="手部素材 PNG（默认内置）")
    p.add_argument("--total-ms", type=int, default=None, help="总时长；缺省用标注 sceneDurationMs")
    p.add_argument("--bare-tip", action="store_true", help="不叠加笔尖/手部")
    p.add_argument("--ink-path", default="grid", choices=["grid", "skeleton"],
                   help="笔迹路径: grid 网格(默认); skeleton 骨架追踪")
    p.add_argument("--color-fill", default="brush", choices=["contour-wipe", "brush"],
                   help="上色: brush 沿轨迹刷(默认); contour-wipe 轮廓扫描")
    p.add_argument("--pause", default="heavy", choices=["heavy", "auto", "light", "off"],
                   help="起笔段停顿节奏（预留，逐区域画法下影响较弱）")
    p.add_argument("--fps", type=int, default=None)
    p.add_argument("--grid-edge", type=int, default=None)
    p.add_argument("--brush-radius", type=int, default=None)
    p.add_argument("--cap-long-edge", type=int, default=None,
                   help="输出长边像素上限（预览可调小加速，默认 1080）")
    p.add_argument("--tip-anchor-x", type=float, default=None, help="笔尖归一化 X 坐标 (0..1)")
    p.add_argument("--tip-anchor-y", type=float, default=None, help="笔尖归一化 Y 坐标 (0..1)")
    p.add_argument("--caption-font", default=None,
                   help="手写文字元素(type=text + textContent)使用的 .ttf 字体路径；"
                        "缺省时按内置候选列表自动查找")
    p.add_argument("--hand-rotate", action="store_true",
                   help="fait pivoter la main selon la tangente du trait (désactivé par défaut)")
    p.add_argument("--pen-style", default="stylus", choices=["fine", "stylus", "marker"],
                   help="style de trait façon Golpo Pen/Stylus/Marker : fine (pointe fine, "
                        "précis, aminci) | stylus (défaut, tel quel) | marker (marqueur épais, "
                        "traits confiants). Combine épaisseur de trait + rayons d'encre/pinceau.")
    return p.parse_args(argv)


_PEN_STYLE_PRESETS = {
    # (pen_line_weight, ink_reveal_radius, brush_radius)
    "fine":   (0.75, 2, 26),
    "stylus": (1.0, 4, 40),   # valeurs par défaut actuelles, inchangees
    "marker": (1.25, 4, 42),
}


def _build_cfg(args) -> sr.Config:
    kw: dict = {}
    if args.fps is not None:
        kw["fps"] = args.fps
    if args.grid_edge is not None:
        kw["grid_edge"] = args.grid_edge
    line_weight, ink_radius, brush_radius = _PEN_STYLE_PRESETS[args.pen_style]
    kw["pen_line_weight"] = line_weight
    kw["ink_reveal_radius"] = ink_radius
    kw["brush_radius"] = brush_radius
    # --brush-radius explicite reste prioritaire sur le preset --pen-style
    if args.brush_radius is not None:
        kw["brush_radius"] = args.brush_radius
    if args.cap_long_edge is not None:
        kw["cap_long_edge"] = args.cap_long_edge
    kw["ink_path_mode"] = args.ink_path
    kw["color_fill"] = args.color_fill
    kw["pause_mode"] = args.pause
    if args.hand_rotate:
        kw["hand_rotate"] = True

    tip_x = args.tip_anchor_x
    tip_y = args.tip_anchor_y
    if tip_x is None and tip_y is None and args.hand and "hand-draw" in Path(args.hand).name:
        tip_x = 0.105
        tip_y = 0.150

    if tip_x is not None:
        kw["tip_anchor_x"] = tip_x
    if tip_y is not None:
        kw["tip_anchor_y"] = tip_y

    return sr.Config(**kw)


def main(argv=None) -> int:
    args = _parse_args(argv)
    cfg = _build_cfg(args)

    print("=" * 56)
    print("SRT 白板动画整合渲染器 (mask 编排 + stream 画法)")
    print("=" * 56)

    image_bgr = sr._imread_any(args.image)
    if image_bgr is None:
        print(f"[err] 无法读取图片: {args.image}")
        return 1
    try:
        annotation = json.loads(Path(args.annotation).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"[err] 无法读取标注: {e}")
        return 1
    if not annotation.get("elements"):
        print("[err] 标注中没有 elements")
        return 1

    # 文字元素预烘焙：把带 textContent 的 "text" 元素直接手写绘制进图片，
    # 使其在后续的墨迹检测/骨架追踪中被当作普通线稿处理，复用同一套画笔逻辑。
    n_text = sum(1 for e in annotation["elements"] if e.get("type") == "text" and e.get("textContent"))
    if n_text:
        print(f"  预烘焙手写文字元素: {n_text} 个")
        image_bgr = bake_text_elements(image_bgr, annotation, SKILL_ROOT, font_path=args.caption_font)

    total_ms = args.total_ms if args.total_ms is not None else annotation.get("sceneDurationMs")
    if not total_ms:
        last = max(e["reveal"]["startMs"] + e["reveal"]["durationMs"] for e in annotation["elements"])
        total_ms = last + 1000

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path = out_path.with_name(out_path.stem + "_raw.mp4")

    hand_png = Path(args.hand) if args.hand else None
    renderer = RegionStreamRenderer(image_bgr, annotation, cfg, hand_png, args.bare_tip)
    print(f"  输入: {args.image}")
    print(f"  输出尺寸: {renderer.out_w}x{renderer.out_h}, 帧率: {cfg.fps}")
    print(f"  区域数: {len(annotation['elements'])}, 总时长: {total_ms}ms, "
          f"笔迹: {cfg.ink_path_mode}, 上色: {cfg.color_fill}")

    renderer.render_to(raw_path, total_ms)
    final = sr.transcode_h264(raw_path, out_path)

    size_mb = final.stat().st_size / (1024 * 1024)
    print(f"\n最终视频: {final}  ({size_mb:.2f} MB)")
    print("=" * 56)
    print(f"OUTPUT={final}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
