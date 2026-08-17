#!/usr/bin/env python3
"""
Transitions entre scenes via le filtre ffmpeg `xfade`.

xfade supporte 57 types nativement (ffmpeg -h filter=xfade). On n'en
expose qu'une sélection cohérente avec un rendu whiteboard/explainer --
la liste complète existe mais certaines (squeeze, wind, diag...) jurent
visuellement avec le style "dessin à la main". Ajouter un type de plus
est juste une ligne dans VALID_TRANSITIONS, xfade fait le reste.

  Classiques         fade, fadeblack, fadewhite, dissolve
  Balayage           wipeleft/right/up/down, wipetl/tr/bl/br
  Glissement         slideleft/right/up/down
  Balayage doux       smoothleft/right/up/down (comme wipe, bords adoucis)
  Cercle/rect         circleopen, circleclose, circlecrop, rectcrop, radial
  Ouverture par axe   vertopen, vertclose, horzopen, horzclose
  Effets              pixelize, hblur, fadegrays

Si ffmpeg est absent, ou si toutes les transitions demandees sont "cut",
cette fonction ne fait rien : merge_scenes.py retombe sur son concat
existant (-c copy ou PyAV), qui reste le chemin le plus robuste pour un
simple cut sec.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

VALID_TRANSITIONS = {
    "cut",
    # classiques
    "fade", "fadeblack", "fadewhite", "dissolve",
    # balayage direct + diagonal
    "wipeleft", "wiperight", "wipeup", "wipedown",
    "wipetl", "wipetr", "wipebl", "wipebr",
    # glissement
    "slideleft", "slideright", "slideup", "slidedown",
    # balayage aux bords adoucis
    "smoothleft", "smoothright", "smoothup", "smoothdown",
    # cercle / rectangle -- fait écho au style de reveal "iris" côté rendu
    "circleopen", "circleclose", "circlecrop", "rectcrop", "radial",
    # ouverture par axe
    "vertopen", "vertclose", "horzopen", "horzclose",
    # effets
    "pixelize", "hblur", "fadegrays",
}


def _probe_duration_ms(path: Path) -> int | None:
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        return None
    res = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        return None
    try:
        data = json.loads(res.stdout)
        return int(round(float(data["format"]["duration"]) * 1000))
    except (KeyError, ValueError, json.JSONDecodeError):
        return None


def merge_with_transitions(
    inputs: list[Path],
    output: Path,
    transitions: list[str],
    duration_ms: int = 500,
) -> bool:
    """
    Concatene `inputs` avec un fondu/wipe/slide entre chaque paire
    consecutive. `transitions` doit avoir len(inputs) - 1 entrees
    (valeurs dans VALID_TRANSITIONS, "cut" = pas de transition speciale
    pour cette jointure -> traite comme "fade" tres court en pratique,
    car xfade ne fait pas de cut sec ; pour un vrai cut sec entre deux
    clips precis, prefere ne pas appeler cette fonction pour ce segment).

    Retourne False si ffmpeg est indisponible ou si moins de 2 inputs :
    l'appelant doit alors utiliser son propre concat de secours.
    """
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None or len(inputs) < 2:
        return False

    if len(transitions) != len(inputs) - 1:
        raise ValueError(
            f"transitions doit avoir {len(inputs) - 1} entrees, recu {len(transitions)}"
        )
    for t in transitions:
        if t not in VALID_TRANSITIONS:
            raise ValueError(f"transition inconnue: {t!r} (valides: {sorted(VALID_TRANSITIONS)})")

    durations = [_probe_duration_ms(p) for p in inputs]
    if any(d is None for d in durations):
        print("  [warn] ffprobe indisponible ou duree illisible, repli sur concat sans transition")
        return False

    filter_parts: list[str] = []
    last_label = "0:v"
    cumulative_ms = durations[0]

    for i in range(1, len(inputs)):
        raw = transitions[i - 1]
        xfade_type = "fade" if raw == "cut" else raw
        offset_ms = max(0, cumulative_ms - duration_ms)
        out_label = f"v{i}"
        filter_parts.append(
            f"[{last_label}][{i}:v]xfade="
            f"transition={xfade_type}:duration={duration_ms / 1000:.3f}:"
            f"offset={offset_ms / 1000:.3f}[{out_label}]"
        )
        last_label = out_label
        cumulative_ms += durations[i] - duration_ms

    filter_complex = ";".join(filter_parts)

    cmd = [ffmpeg, "-y", "-loglevel", "error"]
    for p in inputs:
        cmd += ["-i", str(p)]
    cmd += [
        "-filter_complex", filter_complex,
        "-map", f"[{last_label}]",
        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
        str(output),
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"  [warn] xfade a echoue: {res.stderr.strip()[:300]}")
        return False

    print(f"  Transitions xfade appliquees ({', '.join(transitions)}): {output}")
    return True
