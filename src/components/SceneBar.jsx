import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import useWhiteboardStore from '../store/useWhiteboardStore'

const DISTINCT_COLORS = [
  '#f5a623', '#3b82f6', '#10b981', '#ec4899', '#a855f7',
  '#f43f5e', '#06b6d4', '#eab308', '#2dd4bf', '#3a86f0',
]

const SNAP_MS = 100            // grille de calage (0.1s)
const SNAP_THRESHOLD_MS = 150  // distance de magnétisme aux bords voisins
const MIN_DURATION_MS = 200

export default function SceneBar({
  scenes,
  sceneIdx,
  onSceneChange,
  dirty,
  cfg,
  selectedElement,
  onSelectElement,
  onUpdateElement,
  onSeek, // optionnel : (ms) => void — pour synchroniser une prévisualisation externe
}) {
  // ⚠️ Tous les hooks doivent être appelés avant tout `return` conditionnel
  // (Rules of Hooks). Le early-return pour `scenes` vide est déplacé en bas.

  const elements = cfg?.elements || []
  const trackRef = useRef(null)
  const [dragState, setDragState] = useState(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [hoverBlock, setHoverBlock] = useState(null)
  const [pauseGapMs, setPauseGapMs] = useState(300) // pause duration in ms

  const { alignElementsSequentially, sortElementsByStartTime } = useWhiteboardStore()

  const maxElementEnd = elements.reduce((max, el) => {
    const end = (el.reveal?.startMs || 0) + (el.reveal?.durationMs || 2000)
    return Math.max(max, end)
  }, 8000)
  const totalDurationMs = Math.max(cfg?.sceneDurationMs || 8000, maxElementEnd)

  // ── Compute gaps between sorted elements for visualization ──
  const gaps = useMemo(() => {
    if (!elements || elements.length === 0) return []
    const sorted = [...elements].map((el, originalIdx) => ({
      originalIdx,
      startMs: el.reveal?.startMs || 0,
      endMs: (el.reveal?.startMs || 0) + (el.reveal?.durationMs || 2000),
    })).sort((a, b) => a.startMs - b.startMs)

    const list = []

    // Gap au tout début de la bande (avant le 1er élément)
    if (sorted[0].startMs > 50) {
      list.push({
        fromIdx: -1,
        toIdx: sorted[0].originalIdx,
        startMs: 0,
        endMs: sorted[0].startMs,
        gapMs: sorted[0].startMs,
      })
    }

    // Gaps entre les éléments consécutifs
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i]
      const next = sorted[i + 1]
      const gapMs = next.startMs - curr.endMs
      if (gapMs > 50) {
        list.push({
          fromIdx: curr.originalIdx,
          toIdx: next.originalIdx,
          startMs: curr.endMs,
          endMs: next.startMs,
          gapMs,
        })
      }
    }
    return list
  }, [elements])

  // ── Bords de tous les blocs, pour le magnétisme (chaque bord garde son index d'origine) ──
  const allEdges = useMemo(() => {
    const edges = [{ ms: 0, idx: -1 }, { ms: totalDurationMs, idx: -1 }]
    elements.forEach((el, idx) => {
      const s = el.reveal?.startMs || 0
      const d = el.reveal?.durationMs || 2000
      edges.push({ ms: s, idx }, { ms: s + d, idx })
    })
    return edges
  }, [elements, totalDurationMs])

  // ── Table de chevauchements pré-calculée (évite le O(n²) répété dans le JSX) ──
  const overlapSet = useMemo(() => {
    const set = new Set()
    for (let i = 0; i < elements.length; i++) {
      const a = elements[i]
      const s1 = a.reveal?.startMs || 0
      const e1 = s1 + (a.reveal?.durationMs || 2000)
      for (let j = i + 1; j < elements.length; j++) {
        const b = elements[j]
        const s2 = b.reveal?.startMs || 0
        const e2 = s2 + (b.reveal?.durationMs || 2000)
        if (s1 < e2 && s2 < e1) {
          set.add(i)
          set.add(j)
        }
      }
    }
    return set
  }, [elements])

  const snapValue = useCallback((ms, excludeIndex) => {
    let closest = null
    let closestDist = SNAP_THRESHOLD_MS
    allEdges.forEach(({ ms: edge, idx }) => {
      if (idx === excludeIndex) return // ne pas s'aimanter à ses propres bords
      const dist = Math.abs(edge - ms)
      if (dist < closestDist) {
        closest = edge
        closestDist = dist
      }
    })
    if (closest !== null) return closest
    return Math.round(ms / SNAP_MS) * SNAP_MS
  }, [allEdges])

  // ── Drag & Resize Handlers ──────────────────────────────────────────────────
  function startDragMove(e, index, el) {
    e.stopPropagation()
    if (!trackRef.current) return
    onSelectElement?.(index)
    setDragState({
      type: 'move',
      index,
      startX: e.clientX,
      initialStartMs: el.reveal?.startMs || 0,
      initialDurationMs: el.reveal?.durationMs || 2000,
      trackWidth: trackRef.current.clientWidth,
    })
  }

  function startDragResize(e, index, el, side) {
    e.stopPropagation()
    if (!trackRef.current) return
    onSelectElement?.(index)
    const initialStartMs = el.reveal?.startMs || 0
    const initialDurationMs = el.reveal?.durationMs || 2000
    setDragState({
      type: side === 'left' ? 'resize-left' : 'resize-right',
      index,
      startX: e.clientX,
      initialStartMs,
      initialDurationMs,
      initialEndMs: initialStartMs + initialDurationMs,
      trackWidth: trackRef.current.clientWidth,
    })
  }

  function handleTrackMouseDown(e) {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const ms = Math.round(ratio * totalDurationMs)
    setPlayheadMs(ms)
    onSeek?.(ms)
    setDragState({ type: 'seek', trackWidth: rect.width, startX: rect.left })
  }

  useEffect(() => {
    if (!dragState) return

    function handleMouseMove(e) {
      if (dragState.type === 'seek') {
        const ratio = Math.min(1, Math.max(0, (e.clientX - dragState.startX) / dragState.trackWidth))
        const ms = Math.round(ratio * totalDurationMs)
        setPlayheadMs(ms)
        onSeek?.(ms)
        return
      }

      const deltaX = e.clientX - dragState.startX
      const deltaMs = Math.round((deltaX / dragState.trackWidth) * totalDurationMs)

      if (dragState.type === 'move') {
        const rawStart = Math.max(0, dragState.initialStartMs + deltaMs)
        const newStartMs = snapValue(rawStart, dragState.index)
        onUpdateElement?.(dragState.index, {
          reveal: { startMs: newStartMs, durationMs: dragState.initialDurationMs },
        })
      } else if (dragState.type === 'resize-right') {
        const rawEnd = dragState.initialStartMs + Math.max(MIN_DURATION_MS, dragState.initialDurationMs + deltaMs)
        const newEndMs = snapValue(rawEnd, dragState.index)
        const newDurationMs = Math.max(MIN_DURATION_MS, newEndMs - dragState.initialStartMs)
        onUpdateElement?.(dragState.index, {
          reveal: { startMs: dragState.initialStartMs, durationMs: newDurationMs },
        })
      } else if (dragState.type === 'resize-left') {
        const rawStart = Math.min(
          dragState.initialEndMs - MIN_DURATION_MS,
          Math.max(0, dragState.initialStartMs + deltaMs)
        )
        const newStartMs = snapValue(rawStart, dragState.index)
        const newDurationMs = Math.max(MIN_DURATION_MS, dragState.initialEndMs - newStartMs)
        onUpdateElement?.(dragState.index, {
          reveal: { startMs: newStartMs, durationMs: newDurationMs },
        })
      }
    }

    function handleMouseUp() {
      if (dragState && dragState.type !== 'seek') {
        sortElementsByStartTime()
      }
      setDragState(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, totalDurationMs, onUpdateElement, onSeek, snapValue, sortElementsByStartTime])

  // ── Guard clause : maintenant en dernier, après tous les hooks ──
  if (!scenes || scenes.length === 0) return null

  const playheadPct = Math.min(100, Math.max(0, (playheadMs / totalDurationMs) * 100))

  // Graduations de la grille (max 10 traits pour rester lisible)
  const tickCount = Math.min(10, Math.max(4, Math.round(totalDurationMs / 1000)))
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (i / tickCount) * totalDurationMs)

  return (
    <div className="bottom-panel bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] flex flex-col select-none z-10">
      {/* ── Bande Rythmo (Editable Timeline) ── */}
      {cfg && (
        <div className="rhythmo-container px-4 py-2 border-b border-[var(--border-subtle)] bg-[#090b10] flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[var(--text-primary)]">⏱ Bande Rythmo</span>

              {/* Pause gap selector */}
              <div className="flex items-center gap-1.5 bg-[var(--bg-elevated)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">
                <span className="text-[9.5px] text-[var(--text-secondary)] normal-case">Pause:</span>
                <select
                  value={pauseGapMs}
                  onChange={e => setPauseGapMs(parseInt(e.target.value))}
                  className="bg-transparent text-[10px] font-bold text-[#60a5fa] cursor-pointer outline-none"
                >
                  <option value={0}>0s (collé)</option>
                  <option value={200}>0.2s</option>
                  <option value={300}>0.3s (défaut)</option>
                  <option value={500}>0.5s</option>
                  <option value={1000}>1.0s</option>
                  <option value={1500}>1.5s</option>
                  <option value={2000}>2.0s</option>
                </select>
              </div>

              {/* Auto align button */}
              <button
                onClick={() => alignElementsSequentially(pauseGapMs)}
                className="btn-ghost"
                style={{ fontSize: 10, padding: '2px 8px', color: '#60a5fa', borderColor: 'rgba(96,165,250,0.3)', textTransform: 'none' }}
                title="Ajustement automatique : enchaîne toutes les annotations dans l'ordre avec le temps de pause sélectionné"
              >
                ⚡ Aligner en chaîne
              </button>

              {/* Scene Transition Badge */}
              <div className="flex items-center gap-1 bg-[#0d131f] px-2 py-0.5 rounded border border-[#60a5fa]/30 text-[#60a5fa] text-[9.5px] font-mono normal-case">
                <span>🎬 Transition:</span>
                <strong className="text-[#f5a623]">
                  {(cfg.transition?.transitionAfter || cfg.transitionAfter) === 'cut' ? '⚡ Cut' :
                   (cfg.transition?.transitionAfter || cfg.transitionAfter)?.startsWith('fade') ? '🌫️ Fade' :
                   (cfg.transition?.transitionAfter || cfg.transitionAfter)?.startsWith('wipe') ? '← Wipe' :
                   (cfg.transition?.transitionAfter || cfg.transitionAfter)?.startsWith('slide') ? '◀ Slide' :
                   (cfg.transition?.transitionAfter || cfg.transitionAfter)?.startsWith('circle') ? '⭕ Circle' :
                   (cfg.transition?.transitionAfter || cfg.transitionAfter) || 'cut'}
                </strong>
                <span>({(cfg.transition?.transitionAfter || cfg.transitionAfter) === 'cut' ? '0s' : `${(((cfg.transition?.transitionMs ?? cfg.transitionMs) ?? 500) / 1000).toFixed(1)}s`})</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[9.5px] font-mono text-[var(--text-muted)] lowercase">
                ({(totalDurationMs / 1000).toFixed(1)}s total)
              </span>
              <span className="text-[9.5px] font-mono text-[#f5a623]">
                ▶ {(playheadMs / 1000).toFixed(2)}s
              </span>
            </div>
          </div>

          {/* Timeline track */}
          <div
            ref={trackRef}
            onMouseDown={handleTrackMouseDown}
            className="rhythmo-track relative w-full h-9 bg-[#121620] rounded-md border border-[var(--border-subtle)] overflow-hidden cursor-crosshair"
          >
            {/* Grille de fond avec graduations */}
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-white/5 pointer-events-none flex items-end"
                style={{ left: `${(t / totalDurationMs) * 100}%` }}
              >
                <span className="text-[8px] text-[var(--text-muted)] font-mono ml-0.5 mb-0.5 opacity-60">
                  {(t / 1000).toFixed(1)}s
                </span>
              </div>
            ))}

            {/* Visualisation des Temps de Pause (Gaps) */}
            {gaps.map((gap, i) => {
              const leftPct = (gap.startMs / totalDurationMs) * 100
              const widthPct = (gap.gapMs / totalDurationMs) * 100
              return (
                <div
                  key={`gap-${i}`}
                  className="absolute top-1 bottom-1 flex items-center justify-center pointer-events-none"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  }}
                >
                  <div className="h-[2px] w-full bg-white/10" />
                  {widthPct > 3.5 && (
                    <span className="absolute text-[8.5px] font-mono text-[#60a5fa]/90 bg-[#090b10]/90 px-1 rounded border border-[#60a5fa]/30">
                      +{(gap.gapMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              )
            })}

            {elements.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-[11px] text-[var(--text-muted)] italic pointer-events-none">
                Aucune zone de dessin tracée
              </div>
            ) : (
              elements.map((el, i) => {
                const color = DISTINCT_COLORS[i % DISTINCT_COLORS.length]
                const isSelected = i === selectedElement
                const isDragging = dragState?.index === i && dragState.type !== 'seek'
                const isOverlapping = overlapSet.has(i)
                const startMs = el.reveal?.startMs || 0
                const durationMs = el.reveal?.durationMs || 2000
                const leftPct = Math.min(100, Math.max(0, (startMs / totalDurationMs) * 100))
                const widthPct = Math.min(100 - leftPct, Math.max(2, (durationMs / totalDurationMs) * 100))

                return (
                  <div
                    key={el.id || i}
                    onMouseDown={(e) => startDragMove(e, i, el)}
                    onMouseEnter={() => setHoverBlock(i)}
                    onMouseLeave={() => setHoverBlock((h) => (h === i ? null : h))}
                    className={`rhythmo-block absolute top-1 bottom-1 rounded flex items-center justify-between px-2 text-[10px] font-semibold cursor-grab active:cursor-grabbing transition-shadow ${
                      isSelected ? 'ring-2 ring-white z-20 brightness-110 shadow-lg' : 'opacity-85 hover:opacity-100 hover:z-10'
                    } ${isOverlapping ? 'outline outline-2 outline-dashed outline-red-400' : ''}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: color,
                      color: '#0f1115',
                    }}
                    title={`Zone #${i + 1} (${el.label || 'Zone'})${isOverlapping ? ' — ⚠ chevauche une autre zone' : ''}`}
                  >
                    {/* Poignée gauche */}
                    <div
                      onMouseDown={(e) => startDragResize(e, i, el, 'left')}
                      className="rhythmo-resize-handle absolute top-0 left-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-black/30 flex items-center justify-center rounded-l"
                      title="Ajuster le début (glisser à gauche)"
                    >
                      <div className="w-[2px] h-3 bg-black/40 rounded-full" />
                    </div>

                    <div className="flex items-center gap-1 overflow-hidden pointer-events-none mx-2">
                      <span className="font-extrabold text-[10.5px]">#{i + 1}</span>
                      <span className="truncate text-[9.5px] font-medium">{el.label}</span>
                    </div>

                    {/* Poignée droite */}
                    <div
                      onMouseDown={(e) => startDragResize(e, i, el, 'right')}
                      className="rhythmo-resize-handle absolute top-0 right-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-black/30 flex items-center justify-center rounded-r"
                      title="Ajuster la fin (glisser à droite)"
                    >
                      <div className="w-[2px] h-3 bg-black/40 rounded-full" />
                    </div>

                    {/* Badge de retour live pendant le drag */}
                    {isDragging && (
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/90 text-white text-[9.5px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none z-30">
                        {(startMs / 1000).toFixed(2)}s → {((startMs + durationMs) / 1000).toFixed(2)}s ({(durationMs / 1000).toFixed(2)}s)
                      </div>
                    )}
                    {!isDragging && hoverBlock === i && (
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/80 text-white/90 text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none z-30">
                        {(startMs / 1000).toFixed(1)}s · {(durationMs / 1000).toFixed(1)}s
                      </div>
                    )}
                  </div>
                )
              })
            )}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-[#f5a623] pointer-events-none z-40"
              style={{ left: `${playheadPct}%` }}
            >
              <div className="absolute -top-0.5 -left-[3px] w-[7px] h-[7px] bg-[#f5a623] rotate-45" />
            </div>
          </div>
        </div>
      )}

      {/* ── Scene Strip (inchangé) ── */}
      <div className="scene-bar flex items-center gap-3 px-4 py-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase shrink-0 mr-1">
          <span>🎬 Scènes</span>
          <span className="section-count">{scenes.length}</span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto py-1">
          {scenes.map((s, i) => {
            const isActive = i === sceneIdx
            const isSceneDirty = dirty.has(i)
            return (
              <div
                key={i}
                onClick={() => onSceneChange(i)}
                className={`scene-card-bottom ${isActive ? 'active' : ''}`}
              >
                {s.imgUrl ? (
                  <img src={s.imgUrl} alt={s.name} className="scene-card-img" />
                ) : (
                  <div className="scene-card-placeholder">🖼</div>
                )}
                <div className="scene-card-info">
                  <span className="scene-card-num">{i + 1}</span>
                  <span className="scene-card-name" title={s.name}>{s.name}</span>
                  {isSceneDirty && <span className="scene-card-dirty" title="Modifié non sauvegardé">•</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}