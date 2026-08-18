#!/usr/bin/env python3
"""
Orchestration multi-scènes pour Sketch Pilot.

Prend un manifeste JSON listant plusieurs scènes (image + annotation.json,
chacune avec ses propres options de rendu si besoin), rend chaque scène
séparément via render_stream_whiteboard.py, puis les enchaîne avec
merge_scenes.py (transitions xfade optionnelles entre scènes).

Ne réinvente rien : c'est un chef d'orchestre autour des scripts existants
(render_stream_whiteboard.py, merge_scenes.py), pas un nouveau moteur.

Format du manifeste (JSON) :
{
  "output": "out/final.mp4",
  "hand": "assets/drawing-hand.png",           // optionnel, global
  "defaults": {                                 // optionnel, appliqué à toutes les scenes
    "pen-style": "stylus",
    "fps": 30,
    "cap-long-edge": 1080,
    "ink-path": "skeleton",
    "color-fill": "brush",
    "transition": "fade",                       // optionnel: transition par defaut entre chaque paire de scenes
    "transitionMs": 500                          // optionnel: duree par defaut de ces transitions
  },
  "scenes": [
    {
      "image": "examples/scene1.png",
      "annotation": "examples/scene1_annotation.json",
      "transitionAfter": "wipeleft",             // optionnel, ecrase defaults.transition pour CETTE jointure
      "overrides": { "pen-style": "marker" }      // optionnel, ecrase "defaults" pour cette scene
    },
    {
      "image": "examples/scene2.png",
      "annotation": "examples/scene2_annotation.json"
      // pas de transitionAfter -> utilise defaults.transition ("fade" ici)
    }
  ]
}

Priorité de la durée de transition (transitionMs) : --transition-ms en CLI (si fourni) >
defaults.transitionMs du manifeste > 500ms par défaut. C'est une durée UNIQUE pour
toutes les jointures d'un même run (limite de merge_scenes.py/transitions.py,
qui appliquent une seule durée xfade à tout l'enchaînement) -- seul le TYPE de
transition (fade, wipeleft, ...) peut varier jointure par jointure.

Usage:
  python render_project.py manifest.json
  python render_project.py manifest.json --transition-ms 600 --keep-scenes
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RENDER_SCRIPT = SCRIPT_DIR / "render_stream_whiteboard.py"
MERGE_SCRIPT = SCRIPT_DIR / "merge_scenes.py"

# clés de "defaults"/"overrides" -> flag CLI de render_stream_whiteboard.py
_FLAG_MAP = {
    "fps": "--fps",
    "grid-edge": "--grid-edge",
    "brush-radius": "--brush-radius",
    "cap-long-edge": "--cap-long-edge",
    "ink-path": "--ink-path",
    "color-fill": "--color-fill",
    "pause": "--pause",
    "pen-style": "--pen-style",
    "hand-rotate": "--hand-rotate",       # bool: présent -> flag ajouté
    "bare-tip": "--bare-tip",             # bool: présent -> flag ajouté
    "preview": "--preview",               # bool: présent -> flag ajouté
    "caption-font": "--caption-font",
}
_BOOL_FLAGS = {"hand-rotate", "bare-tip", "preview"}


def _resolve(base: Path, rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else (base / p)


def _build_render_args(opts: dict) -> list[str]:
    args: list[str] = []
    for key, val in opts.items():
        flag = _FLAG_MAP.get(key)
        if flag is None:
            print(f"  [warn] option inconnue ignorée: {key}", file=sys.stderr)
            continue
        if key in _BOOL_FLAGS:
            if val:
                args.append(flag)
        else:
            args += [flag, str(val)]
    return args


def render_scene(py_bin: str, image: Path, annotation: Path, out_path: Path,
                  hand: Path | None, opts: dict) -> bool:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [py_bin, str(RENDER_SCRIPT), str(image), str(annotation), str(out_path)]
    if hand is not None:
        cmd.append(str(hand))
    cmd += _build_render_args(opts)
    print(f"  $ {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"  [err] échec du rendu de {image.name}:\n{res.stderr.strip()[-2000:]}", file=sys.stderr)
        return False
    print(f"  ok: {out_path}")
    return True


def merge_all(py_bin: str, scene_paths: list[Path], transitions: list[str],
              transition_ms: int, output: Path) -> bool:
    output.parent.mkdir(parents=True, exist_ok=True)
    cmd = [py_bin, str(MERGE_SCRIPT), "--inputs", *[str(p) for p in scene_paths],
           "--output", str(output)]
    if any(t != "cut" for t in transitions):
        cmd += ["--transitions", ",".join(transitions), "--transition-ms", str(transition_ms)]
    print(f"  $ {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"  [err] échec de la fusion:\n{res.stderr.strip()[-2000:]}", file=sys.stderr)
        return False
    print(res.stdout.strip())
    return True


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Rendu + fusion multi-scènes depuis un manifeste JSON")
    p.add_argument("manifest")
    p.add_argument("--transition-ms", type=int, default=None,
                   help="durée des transitions xfade en ms (écrase defaults.transitionMs "
                        "du manifeste ; sinon 500 par défaut)")
    p.add_argument("--keep-scenes", action="store_true",
                   help="ne pas supprimer les MP4 par scène après la fusion")
    p.add_argument("--work-dir", default=None,
                   help="dossier pour les rendus intermédiaires par scène (défaut: <output>/_scenes)")
    p.add_argument("--preview", action="store_true",
                   help="rendu rapide basse résolution/fps pour toutes les scènes")
    args = p.parse_args(argv)

    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    base = manifest_path.parent

    scenes = manifest.get("scenes", [])
    if not scenes:
        print("[err] le manifeste ne contient aucune scène ('scenes': [])", file=sys.stderr)
        return 1

    output = _resolve(base, manifest.get("output", "out/final.mp4"))
    hand = _resolve(base, manifest["hand"]) if manifest.get("hand") else None
    defaults = manifest.get("defaults", {})
    default_transition = defaults.get("transition", "cut")
    transition_ms = args.transition_ms if args.transition_ms is not None else defaults.get("transitionMs", 500)
    work_dir = Path(args.work_dir) if args.work_dir else output.parent / "_scenes"
    work_dir.mkdir(parents=True, exist_ok=True)

    py_bin = sys.executable
    scene_paths: list[Path] = []
    transitions: list[str] = []

    render_defaults = {k: v for k, v in defaults.items() if k not in ("transition", "transitionMs")}
    if args.preview:
        render_defaults["preview"] = True

    jobs = []
    print(f"=== Préparation de {len(scenes)} scène(s) à rendre ===")
    for i, scene in enumerate(scenes, start=1):
        image = _resolve(base, scene["image"])
        annotation = _resolve(base, scene["annotation"])
        if not image.is_file():
            print(f"[err] image introuvable: {image}", file=sys.stderr)
            return 1
        if not annotation.is_file():
            print(f"[err] annotation introuvable: {annotation}", file=sys.stderr)
            return 1

        opts = {**render_defaults, **scene.get("overrides", {})}
        out_path = work_dir / f"scene{i:02d}_{image.stem}.mp4"
        scene_paths.append(out_path)
        if i < len(scenes):
            transitions.append(scene.get("transitionAfter", default_transition))

        jobs.append((i, image, annotation, out_path, opts))

    from concurrent.futures import ThreadPoolExecutor

    def _worker(job):
        idx, img, ann, out_p, opts = job
        print(f"[{idx}/{len(scenes)}] Lancement rendu: {img.name} + {ann.name}")
        ok = render_scene(py_bin, img, ann, out_p, hand, opts)
        return idx, ok

    print(f"=== Rendu en parallèle de {len(jobs)} scène(s) (workers={min(4, len(jobs))}) ===")
    with ThreadPoolExecutor(max_workers=min(4, len(jobs))) as pool:
        futures = [pool.submit(_worker, j) for j in jobs]
        for f in futures:
            idx, ok = f.result()
            if not ok:
                print(f"[err] La scène #{idx} a échoué.", file=sys.stderr)
                return 1

    print(f"=== Fusion de {len(scene_paths)} scène(s) -> {output} ===")
    if len(scene_paths) == 1:
        scene_paths[0].replace(output)
        print(f"  une seule scène, copiée directement: {output}")
    else:
        if not merge_all(py_bin, scene_paths, transitions, transition_ms, output):
            return 1

    if not args.keep_scenes and len(scene_paths) > 1:
        for sp in scene_paths:
            sp.unlink(missing_ok=True)
        try:
            work_dir.rmdir()
        except OSError:
            pass  # non vide (ex: fichiers annexes) -- on laisse

    print(f"\nOUTPUT={output.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
