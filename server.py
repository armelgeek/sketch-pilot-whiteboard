#!/usr/bin/env python3
"""
SRT Whiteboard Animation - Local Web Server Bridge
Kết nối giao diện Web UI (assets/preview.html) với các script Python render hoạt hình local.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parent
VENV_PYTHON = PROJECT_ROOT / ".venv" / ("Scripts/python.exe" if sys.platform.startswith("win") else "bin/python")

# Racine du generateur TypeScript (scene-json-generator), branche pour
# produire une annotation.json riche (plusieurs elements, positions
# semantiques) au lieu du repli 1-region par defaut. Ajustable via
# la variable d'env SCENE_GENERATOR_DIR si le dossier est ailleurs.
SCENE_GENERATOR_DIR = Path(
    os.environ.get("SCENE_GENERATOR_DIR", str(PROJECT_ROOT / "tools" / "scene-json-generator"))
).resolve()


def get_python_bin() -> str:
    if VENV_PYTHON.exists():
        return str(VENV_PYTHON)
    return sys.executable


def generate_annotation_via_ts(img_path: Path, json_path: Path, story_hint: str = "") -> bool:
    """
    Appelle le generateur TypeScript (vision -> elements -> layout derive)
    pour produire une annotation.json complete. Retourne False si le
    generateur est absent, non installe (node_modules manquant), ou echoue
    (ex: pas de ANTHROPIC_API_KEY) -- l'appelant doit alors utiliser son
    propre repli (annotation 1-region par defaut).
    """
    entry = SCENE_GENERATOR_DIR / "src" / "index.ts"
    if not entry.is_file():
        print(f"[SERVER] Generateur TS introuvable: {entry} (repli sur annotation par defaut)")
        return False
    if not (SCENE_GENERATOR_DIR / "node_modules").is_dir():
        print(f"[SERVER] node_modules absent dans {SCENE_GENERATOR_DIR} "
              f"(lancer `npm install` une fois) - repli sur annotation par defaut")
        return False

    npx = shutil.which("npx")
    if npx is None:
        print("[SERVER] npx introuvable dans le PATH - repli sur annotation par defaut")
        return False

    cmd = [npx, "tsx", str(entry), "--image", str(img_path), "--out", str(json_path)]
    if story_hint:
        cmd += ["--story", story_hint]

    print(f"[SERVER] Generation annotation via TS: {' '.join(cmd)}")
    res = subprocess.run(cmd, cwd=str(SCENE_GENERATOR_DIR), capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[SERVER] Generateur TS a echoue (repli sur annotation par defaut):\n{res.stderr.strip()[:500]}")
        return False
    return json_path.is_file()

class WhiteboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/scenes":
            self.send_json_response(self.list_scenes())
        else:
            # Route default "/" to assets/preview.html
            if parsed.path == "/" or parsed.path == "/preview":
                self.path = "/assets/preview.html"
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length)
        
        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            body = {}

        if parsed.path == "/api/save_annotation":
            self.handle_save_annotation(body)
        elif parsed.path == "/api/generate_annotation":
            self.handle_generate_annotation(body)
        elif parsed.path == "/api/render_scene":
            self.handle_render_scene(body)
        elif parsed.path == "/api/merge_scenes":
            self.handle_merge_scenes(body)
        elif parsed.path == "/api/parse_srt":
            self.handle_parse_srt(body)
        else:
            self.send_json_response({"error": "Endpoint not found"}, status=404)

    def list_scenes(self) -> dict:
        search_dirs = [
            PROJECT_ROOT / "examples",
            PROJECT_ROOT / "examples" / "demo",
            PROJECT_ROOT / "assets" / "whiteboard"
        ]
        scenes = []
        visited = set()
        for d in search_dirs:
            if not d.exists():
                continue
            for img in list(d.glob("*.png")) + list(d.glob("*.jpeg")) + list(d.glob("*.jpg")):
                if img.name in visited or "preview" in img.name.lower():
                    continue
                visited.add(img.name)
                base = img.stem
                json_file = img.parent / f"{base}.annotation.json"
                mp4_file = img.parent / f"{base}-whiteboard.mp4"
                rel_img = "/" + str(img.relative_to(PROJECT_ROOT))
                rel_json = ("/" + str(json_file.relative_to(PROJECT_ROOT))) if json_file.exists() else None
                rel_mp4 = ("/" + str(mp4_file.relative_to(PROJECT_ROOT))) if mp4_file.exists() else None
                scenes.append({
                    "project": d.name,
                    "name": base,
                    "imgPath": rel_img,
                    "jsonPath": rel_json,
                    "mp4Path": rel_mp4,
                })
        return {"scenes": scenes}

    def handle_save_annotation(self, body: dict):
        rel_path = body.get("path")
        config = body.get("config")
        if not rel_path or not config:
            return self.send_json_response({"error": "Thiếu path hoặc config"}, status=400)
        
        target_file = (PROJECT_ROOT / rel_path.lstrip("/")).resolve()
        target_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(target_file, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
            
        self.send_json_response({"status": "ok", "message": f"Đã lưu {target_file.name}"})

    def handle_generate_annotation(self, body: dict):
        img_rel = body.get("imgPath", "").lstrip("/")
        json_rel = body.get("jsonPath", "").lstrip("/")
        story_hint = body.get("story", "")

        candidates = [
            PROJECT_ROOT / img_rel,
            PROJECT_ROOT / "examples" / img_rel,
            PROJECT_ROOT / "examples" / "demo" / img_rel,
            PROJECT_ROOT / "examples" / Path(img_rel).name if img_rel else None,
            PROJECT_ROOT / "examples" / "demo" / Path(img_rel).name if img_rel else None,
        ]
        img_path = None
        for cand in candidates:
            if cand and cand.is_file():
                img_path = cand.resolve()
                break

        if not img_path:
            example_imgs = list((PROJECT_ROOT / "examples").glob("*.png")) + list((PROJECT_ROOT / "examples" / "demo").glob("*.jpeg"))
            if example_imgs:
                img_path = example_imgs[0].resolve()
            else:
                return self.send_json_response({"status": "error", "error": f"Fichier image introuvable : {img_rel}"}, status=400)

        if json_rel:
            json_path = (PROJECT_ROOT / json_rel).resolve()
        else:
            json_path = img_path.parent / f"{img_path.stem}.annotation.json"

        generated = generate_annotation_via_ts(img_path, json_path, story_hint)
        if not generated:
            import cv2
            img_bgr = cv2.imread(str(img_path))
            h, w = (img_bgr.shape[:2]) if img_bgr is not None else (720, 1280)
            default_config = {
                "sceneId": img_path.stem,
                "canvas": {"width": w, "height": h},
                "sceneDurationMs": 8000,
                "elements": [{
                    "id": "region_1",
                    "label": "Zone principale",
                    "sequence": 1,
                    "narrativeRole": "Élément par défaut",
                    "type": "structure",
                    "subtitle": "",
                    "region": {"x": int(w*0.1), "y": int(h*0.1), "width": int(w*0.8), "height": int(h*0.8)},
                    "reveal": {"direction": "top_to_bottom", "startMs": 300, "durationMs": 4000, "maskPaddingPx": 22, "protectedRegions": []},
                    "handPath": {}
                }]
            }
            json_path.parent.mkdir(parents=True, exist_ok=True)
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(default_config, f, ensure_ascii=False, indent=2)

        try:
            with open(json_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            self.send_json_response({"status": "ok", "config": cfg, "jsonPath": "/" + str(json_path.relative_to(PROJECT_ROOT))})
        except Exception as e:
            self.send_json_response({"status": "error", "error": str(e)}, status=500)

    def handle_render_scene(self, body: dict):
        img_rel = body.get("imgPath", "").lstrip("/")
        json_rel = body.get("jsonPath", "").lstrip("/")
        out_rel = body.get("outPath", "").lstrip("/")
        config = body.get("config")

        # Resolve image path flexibly
        candidates = [
            PROJECT_ROOT / img_rel,
            PROJECT_ROOT / "examples" / img_rel,
            PROJECT_ROOT / "examples" / "demo" / img_rel,
            PROJECT_ROOT / "examples" / Path(img_rel).name if img_rel else None,
            PROJECT_ROOT / "examples" / "demo" / Path(img_rel).name if img_rel else None,
        ]
        img_path = None
        for cand in candidates:
            if cand and cand.is_file():
                img_path = cand.resolve()
                break
        
        if not img_path:
            # Fallback to first available example image if none found
            example_imgs = list((PROJECT_ROOT / "examples").glob("*.png")) + list((PROJECT_ROOT / "examples" / "demo").glob("*.jpeg"))
            if example_imgs:
                img_path = example_imgs[0].resolve()
            else:
                return self.send_json_response({"status": "error", "error": f"Fichier image introuvable : {img_rel}"}, status=400)

        # Resolve json path
        if json_rel:
            json_path = (PROJECT_ROOT / json_rel).resolve()
        else:
            json_path = img_path.parent / f"{img_path.stem}.annotation.json"

        # If config was sent directly, write it to json_path
        if config and isinstance(config, dict):
            json_path.parent.mkdir(parents=True, exist_ok=True)
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            print(f"[SERVER] Confirmer sauvegarde config sur {json_path.name}")
        elif not json_path.exists():
            # 1) essaie d'abord le generateur TS (vision -> plusieurs elements
            #    positionnes semantiquement), 2) sinon repli sur l'ancien
            #    comportement (une seule region par defaut).
            story_hint = body.get("story", "")
            generated = generate_annotation_via_ts(img_path, json_path, story_hint)
            if not generated:
                import cv2
                img_bgr = cv2.imread(str(img_path))
                h, w = (img_bgr.shape[:2]) if img_bgr is not None else (720, 1280)
                default_config = {
                    "sceneId": img_path.stem,
                    "canvas": {"width": w, "height": h},
                    "sceneDurationMs": 8000,
                    "elements": [{
                        "id": "region_1",
                        "label": "Zone principale",
                        "sequence": 1,
                        "narrativeRole": "Élément par défaut",
                        "type": "structure",
                        "subtitle": "",
                        "region": {"x": int(w*0.1), "y": int(h*0.1), "width": int(w*0.8), "height": int(h*0.8)},
                        "reveal": {"direction": "top_to_bottom", "startMs": 300, "durationMs": 4000, "maskPaddingPx": 22, "protectedRegions": []},
                        "handPath": {}
                    }]
                }
                json_path.parent.mkdir(parents=True, exist_ok=True)
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(default_config, f, ensure_ascii=False, indent=2)

        if not out_rel:
            out_path = img_path.parent / f"{img_path.stem}-whiteboard.mp4"
        else:
            out_path = (PROJECT_ROOT / out_rel).resolve()

        out_path.parent.mkdir(parents=True, exist_ok=True)
        hand_path = PROJECT_ROOT / "assets" / "drawing-hand.png"
        py_bin = get_python_bin()

        # Options moteur envoyees par le front (preview.html) -- reprennent les
        # defauts actuels de render_stream_whiteboard.py si absentes, PAS les
        # anciennes valeurs (grid/contour-wipe) qui etaient figees en dur ici.
        render_opts = body.get("renderOpts") or {}
        ink_path = render_opts.get("inkPath") or "skeleton"
        color_fill = render_opts.get("colorFill") or "brush"
        pen_style = render_opts.get("penStyle") or "stylus"
        hand_rotate = bool(render_opts.get("handRotate"))

        cmd = [
            py_bin,
            str(PROJECT_ROOT / "scripts" / "render_stream_whiteboard.py"),
            str(img_path),
            str(json_path),
            str(out_path),
            str(hand_path),
            "--ink-path", ink_path,
            "--color-fill", color_fill,
            "--pen-style", pen_style,
        ]
        if hand_rotate:
            cmd.append("--hand-rotate")

        print(f"[SERVER] Running render command: {' '.join(cmd)}")
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            rel_out = "/" + str(out_path.relative_to(PROJECT_ROOT))
            self.send_json_response({
                "status": "ok",
                "message": "Render MP4 thành công!",
                "videoUrl": rel_out,
                "stdout": res.stdout
            })
        except subprocess.CalledProcessError as e:
            print(f"[SERVER LỖI] {e.stderr}")
            self.send_json_response({
                "status": "error",
                "error": e.stderr or str(e)
            }, status=500)

    def handle_merge_scenes(self, body: dict):
        inputs = body.get("inputs", [])
        out_name = body.get("output", "final.mp4")
        py_bin = get_python_bin()

        input_paths = [str(PROJECT_ROOT / inp.lstrip("/")) for inp in inputs]
        out_path = PROJECT_ROOT / "assets" / "whiteboard" / out_name

        cmd = [
            py_bin,
            str(PROJECT_ROOT / "scripts" / "merge_scenes.py"),
            "--inputs", *input_paths,
            "--output", str(out_path)
        ]
        transitions = body.get("transitions")  # ex: "fade,wipeleft"
        if transitions:
            cmd += ["--transitions", transitions]
        transition_ms = body.get("transitionMs")
        if transition_ms:
            cmd += ["--transition-ms", str(transition_ms)]

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            rel_out = "/" + str(out_path.relative_to(PROJECT_ROOT))
            self.send_json_response({
                "status": "ok",
                "message": "Gộp video thành công!",
                "videoUrl": rel_out
            })
        except subprocess.CalledProcessError as e:
            self.send_json_response({"status": "error", "error": e.stderr}, status=500)

    def handle_parse_srt(self, body: dict):
        srt_content = body.get("srtContent", "")
        if not srt_content:
            return self.send_json_response({"error": "Phụ đề rỗng"}, status=400)
        
        # Save temp srt file
        temp_srt = PROJECT_ROOT / "assets" / "temp.srt"
        temp_srt.write_text(srt_content, encoding="utf-8")

        py_bin = get_python_bin()
        cmd = [
            py_bin,
            str(PROJECT_ROOT / "scripts" / "parse_srt.py"),
            str(temp_srt)
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            self.send_json_response({
                "status": "ok",
                "output": res.stdout
            })
        except subprocess.CalledProcessError as e:
            self.send_json_response({"status": "error", "error": e.stderr}, status=500)

    def send_json_response(self, data: dict, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

def run_server(port=8000):
    server = HTTPServer(("0.0.0.0", port), WhiteboardHandler)
    print(f"\n=======================================================")
    print(f"🚀 SRT Whiteboard Local Web Server running at:")
    print(f"👉 http://localhost:{port}")
    print(f"=======================================================\n")
    server.serve_forever()

if __name__ == "__main__":
    run_server()
