import { useState, useEffect } from 'react'
import { generateAnnotationPreview } from '../utils/preview'
import useWhiteboardStore from '../store/useWhiteboardStore'

const DISTINCT_COLORS = [
  '#f5a623', '#3b82f6', '#10b981', '#ec4899', '#a855f7',
  '#f43f5e', '#06b6d4', '#eab308', '#2dd4bf', '#3a86f0',
]

const QUICK_TRANSITIONS = [
  { value: 'cut',         label: '⚡ Cut' },
  { value: 'fade',        label: '🌫️ Fondu' },
  { value: 'fadeblack',   label: '⬛ Fondu Noir' },
  { value: 'fadewhite',   label: '⬜ Fondu Blanc' },
  { value: 'dissolve',    label: '✨ Fondu Enchaîné' },
  { value: 'wipeleft',    label: '← Balayage Gauche' },
  { value: 'wiperight',   label: '→ Balayage Droite' },
  { value: 'wipeup',      label: '↑ Balayage Haut' },
  { value: 'wipedown',    label: '↓ Balayage Bas' },
  { value: 'slideleft',   label: '◀ Glissement Gauche' },
  { value: 'slideright',  label: '▶ Glissement Droite' },
  { value: 'circleopen',  label: '⭕ Cercle Ouverture' },
  { value: 'circleclose', label: '🛑 Cercle Fermeture' },
  { value: 'pixelize',    label: '👾 Pixellisation' },
  { value: 'hblur',       label: '💧 Flou Horizontal' },
]

function formatMs(ms) {
  if (ms == null) return ''
  const sec = (ms / 1000).toFixed(1)
  return `${sec}s`
}

export default function LeftSidebar({
  cfg,
  selectedElement,
  onSelectElement,
  onUpdateElement,
  onDeleteElement,
  onDuplicateElement,
  onReorderElement,
  onAddElement,
  srtItems,
  source,
}) {
  const elements = cfg?.elements || []
  const [activeTab, setActiveTab] = useState('zones') // 'zones' | 'scenes'
  const [previews, setPreviews] = useState({})
  const [editingLabelIdx, setEditingLabelIdx] = useState(null)
  const [labelDraft, setLabelDraft] = useState('')

  const {
    scenes,
    sceneIdx,
    setSceneIdx,
    reorderScene,
    duplicateScene,
    deleteScene,
    updateSceneTransitionAt,
    linkSubtitleToElement,
    autoLinkSubtitles,
  } = useWhiteboardStore()

  // ── Thumbnail generation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!source || !elements.length) return
    const newPreviews = {}
    elements.forEach((e, i) => {
      if (e.region) {
        const p = generateAnnotationPreview(source, e.region, 240)
        if (p) newPreviews[i] = p
      }
    })
    setPreviews(newPreviews)
  }, [source, elements])

  // ── Inline label editing ────────────────────────────────────────────────────
  function startEditLabel(i, currentLabel, e) {
    e.stopPropagation()
    setEditingLabelIdx(i)
    setLabelDraft(currentLabel || '')
  }

  function commitLabel(i) {
    if (labelDraft.trim()) {
      onUpdateElement(i, { label: labelDraft.trim() })
    }
    setEditingLabelIdx(null)
  }

  function handleLabelKeyDown(i, e) {
    if (e.key === 'Enter') { e.preventDefault(); commitLabel(i) }
    if (e.key === 'Escape') setEditingLabelIdx(null)
    e.stopPropagation()
  }

  function handleAddZone() {
    onAddElement({
      id: `region_${Date.now()}`,
      label: 'Nouvelle zone',
      type: 'structure',
      sequence: elements.length + 1,
      narrativeRole: '',
      subtitle: '',
      region: { x: 100, y: 100, width: 200, height: 200 },
      reveal: { direction: 'top_to_bottom', startMs: 0, durationMs: 2000, maskPaddingPx: 22, protectedRegions: [] },
      handPath: {},
    })
  }

  return (
    <aside className="side side-left flex flex-col gap-3">
      {/* ── Main Tab Navigation ── */}
      <div className="flex bg-[#0d131f] p-1 rounded-lg border border-[var(--border-color)]">
        <button
          className={`flex-1 py-1.5 text-[11px] font-bold rounded transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'scenes'
              ? 'bg-[#60a5fa] text-[#0d1117] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-white'
          }`}
          onClick={() => setActiveTab('scenes')}
        >
          <span>🎞️ Scènes</span>
          <span className="text-[9.5px] opacity-80 px-1 py-0.2 rounded bg-black/20 font-mono">
            {scenes.length}
          </span>
        </button>

        <button
          className={`flex-1 py-1.5 text-[11px] font-bold rounded transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'zones'
              ? 'bg-[#60a5fa] text-[#0d1117] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-white'
          }`}
          onClick={() => setActiveTab('zones')}
        >
          <span>✏️ Zones</span>
          <span className="text-[9.5px] opacity-80 px-1 py-0.2 rounded bg-black/20 font-mono">
            {elements.length}
          </span>
        </button>
      </div>

      {/* ── SCENES TAB ── */}
      {activeTab === 'scenes' && (
        <div className="side-section flex-1 overflow-y-auto">
          <div className="section-header mb-2">
            <span className="section-title">🎞️ Galerie des Scènes</span>
            <span className="section-count text-[#60a5fa]">{scenes.length}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {scenes.map((s, i) => {
              const isActive = i === sceneIdx
              const elemCount = s.cfg?.elements?.length || 0
              const transition = s.cfg?.transition?.transitionAfter || s.cfg?.transitionAfter || 'cut'
              const transitionMs = s.cfg?.transition?.transitionMs ?? s.cfg?.transitionMs ?? 500

              return (
                <div key={i} className="flex flex-col">
                  {/* Scene Card */}
                  <div
                    onClick={() => setSceneIdx(i)}
                    className={`zone-card p-2.5 flex flex-col gap-2 rounded-lg cursor-pointer transition-all border ${
                      isActive
                        ? 'border-[#60a5fa] bg-[#131d31] shadow-md shadow-[#60a5fa]/10'
                        : 'border-[var(--border-color)] bg-[#0d1117] hover:border-[#60a5fa]/50'
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded font-mono shrink-0 ${
                          isActive ? 'bg-[#60a5fa] text-[#0d1117]' : 'bg-[#1f293d] text-[#94a3b8]'
                        }`}>
                          #{i + 1}
                        </span>
                        <span className="text-[11.5px] font-bold text-[var(--text-main)] truncate" title={s.name}>
                          {s.name || `Scène ${i + 1}`}
                        </span>
                      </div>
                      {isActive && (
                        <span className="text-[9px] font-bold text-[#60a5fa] bg-[#60a5fa]/15 px-1.5 py-0.5 rounded border border-[#60a5fa]/30 shrink-0">
                          Active
                        </span>
                      )}
                    </div>

                    {/* Thumbnail + Details */}
                    <div className="flex gap-2 items-center">
                      <div className="w-16 h-10 rounded bg-[#1a2333] border border-[#2b3954] overflow-hidden flex items-center justify-center shrink-0">
                        {s.imgPath ? (
                          <img src={s.imgPath} alt={s.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[14px]">🖼️</span>
                        )}
                      </div>

                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="text-[10px] text-[var(--text-muted)]">
                          📐 {elemCount} zone{elemCount > 1 ? 's' : ''}
                        </div>
                        <div className="text-[9.5px] text-[#f5a623] font-mono flex items-center gap-1 bg-[#f5a623]/10 px-1.5 py-0.5 rounded border border-[#f5a623]/20 w-fit">
                          🎬 {transition === 'cut' ? 'Cut' : `${transition} (${(transitionMs/1000).toFixed(1)}s)`}
                        </div>
                      </div>
                    </div>

                    {/* Reorder and action bar */}
                    <div className="flex items-center justify-between border-t border-[#1f293d] pt-1.5 mt-0.5">
                      <div className="flex items-center gap-1">
                        <button
                          className="btn-icon"
                          title="Déplacer vers le haut"
                          disabled={i === 0}
                          onClick={(ev) => { ev.stopPropagation(); reorderScene(i, -1) }}
                        >↑</button>
                        <button
                          className="btn-icon"
                          title="Déplacer vers le bas"
                          disabled={i === scenes.length - 1}
                          onClick={(ev) => { ev.stopPropagation(); reorderScene(i, 1) }}
                        >↓</button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          className="btn-icon"
                          title="Dupliquer la scène"
                          onClick={(ev) => { ev.stopPropagation(); duplicateScene(i) }}
                        >⧉</button>
                        <button
                          className="btn-delete"
                          title="Supprimer la scène"
                          disabled={scenes.length <= 1}
                          onClick={(ev) => { ev.stopPropagation(); deleteScene(i) }}
                        >🗑</button>
                      </div>
                    </div>
                  </div>

                  {/* Inter-Scene Transition Connector */}
                  {i < scenes.length - 1 && (
                    <div className="flex flex-col items-center my-1.5 relative group">
                      <div className="w-0.5 h-2.5 bg-[#60a5fa]/30 group-hover:bg-[#60a5fa] transition-colors" />

                      <div className="flex items-center gap-1.5 bg-[#0a0f18] px-2 py-1 rounded-full border border-[#60a5fa]/40 hover:border-[#60a5fa] transition-all shadow-sm z-10">
                        <span className="text-[10px] text-[#60a5fa]">🎬</span>
                        <select
                          className="bg-transparent text-[10px] font-semibold text-[#f5a623] cursor-pointer outline-none border-0"
                          value={transition}
                          onChange={(e) => {
                            const val = e.target.value
                            const ms = val === 'cut' ? 0 : (transitionMs || 500)
                            updateSceneTransitionAt(i, { transitionAfter: val, transitionMs: ms })
                          }}
                          onClick={(ev) => ev.stopPropagation()}
                          title="Modifier la transition vers la scène suivante"
                        >
                          {QUICK_TRANSITIONS.map(t => (
                            <option key={t.value} value={t.value} className="bg-[#0f172a] text-[#f8fafc]">
                              {t.label}
                            </option>
                          ))}
                        </select>

                        {transition !== 'cut' && (
                          <div className="flex items-center gap-0.5" onClick={(ev) => ev.stopPropagation()}>
                            <input
                              type="number"
                              step={100}
                              min={100}
                              max={5000}
                              className="w-11 text-[9.5px] font-mono text-[#60a5fa] bg-[#1e293b] px-1 rounded border border-[#334155] text-center"
                              value={transitionMs}
                              onChange={(e) => {
                                const ms = Math.max(0, parseInt(e.target.value) || 0)
                                updateSceneTransitionAt(i, { transitionMs: ms })
                              }}
                              title="Durée de la transition (ms)"
                            />
                            <span className="text-[8.5px] text-[var(--text-muted)]">ms</span>
                          </div>
                        )}
                      </div>

                      <div className="w-0.5 h-2.5 bg-[#60a5fa]/30 group-hover:bg-[#60a5fa] transition-colors" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── ZONES TAB ── */}
      {activeTab === 'zones' && (
        <div className="side-section flex-1 overflow-y-auto">
          <div className="section-header">
            <span className="section-title">Zones de dessin</span>
            <span className="section-count">{elements.length}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {elements.map((e, i) => {
              const cardColor = DISTINCT_COLORS[i % DISTINCT_COLORS.length]
              const isSelected = i === selectedElement
              return (
                <div
                  key={e.id || i}
                  id={`zone-card-${i}`}
                  onClick={() => onSelectElement(i)}
                  className={`zone-card ${isSelected ? 'selected' : ''}`}
                  style={{ borderLeft: `3px solid ${cardColor}` }}
                >
                  {/* Thumbnail */}
                  <div className="zone-thumb">
                    {previews[i]
                      ? <img src={previews[i]} alt="aperçu zone" />
                      : <div className="zone-thumb-empty">🖼</div>
                    }
                    <span
                      className="zone-badge-num"
                      style={{ backgroundColor: cardColor, color: '#0f1115' }}
                    >
                      {i + 1}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="zone-body">
                    {/* Top row: label (editable) + actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
                      {editingLabelIdx === i ? (
                        <input
                          className="prop-input"
                          style={{ flex: 1, fontSize: 11, padding: '1px 5px', minWidth: 0 }}
                          autoFocus
                          value={labelDraft}
                          onChange={ev => setLabelDraft(ev.target.value)}
                          onBlur={() => commitLabel(i)}
                          onKeyDown={ev => handleLabelKeyDown(i, ev)}
                          onClick={ev => ev.stopPropagation()}
                        />
                      ) : (
                        <div
                          className="zone-name"
                          title="Double-clic pour renommer"
                          onDoubleClick={ev => startEditLabel(i, e.label, ev)}
                          style={{ flex: 1 }}
                        >
                          {e.label || 'Zone sans nom'}
                        </div>
                      )}

                      {/* Reorder buttons */}
                      <button
                        className="btn-icon"
                        title="Remonter"
                        disabled={i === 0}
                        onClick={ev => { ev.stopPropagation(); onReorderElement(i, -1) }}
                      >↑</button>
                      <button
                        className="btn-icon"
                        title="Descendre"
                        disabled={i === elements.length - 1}
                        onClick={ev => { ev.stopPropagation(); onReorderElement(i, 1) }}
                      >↓</button>

                      {/* Duplicate */}
                      <button
                        className="btn-icon"
                        title="Dupliquer"
                        onClick={ev => { ev.stopPropagation(); onDuplicateElement(i) }}
                      >⧉</button>

                      {/* Delete */}
                      <button
                        className="btn-delete"
                        title="Supprimer"
                        onClick={ev => { ev.stopPropagation(); onDeleteElement(i) }}
                      >🗑</button>
                    </div>

                    {/* Subtitle preview snippet */}
                    {e.subtitle && (
                      <div
                        className="text-[10.5px] italic text-[var(--text-secondary)] truncate"
                        title={`Sous-titre: ${e.subtitle}`}
                        style={{ marginTop: 1, color: '#93c5fd' }}
                      >
                        💬 "{e.subtitle}"
                      </div>
                    )}

                    {/* Bottom row: coordinates + type badge */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 6, marginTop: 2 }}>
                      <div className="zone-meta">
                        ({e.region?.x}, {e.region?.y}) · {e.region?.width}×{e.region?.height}
                      </div>
                      <span className={`type-badge ${e.type || 'structure'}`}>
                        {e.type || 'struct'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <button
            id="btn-add-zone"
            className="btn-add-zone"
            style={{ marginTop: 8 }}
            onClick={handleAddZone}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span> Ajouter une zone
          </button>
        </div>
      )}

      {/* ── SRT list ── */}
      {activeTab === 'zones' && srtItems.length > 0 && (
        <div className="side-section">
          <div className="section-header" style={{ marginBottom: 8 }}>
            <span className="section-title">Sous-titres SRT</span>
            <button
              onClick={() => autoLinkSubtitles()}
              className="btn-ghost"
              style={{ fontSize: 10.5, padding: '2px 7px', color: '#60a5fa', borderColor: 'rgba(96,165,250,0.3)' }}
              title="Associer automatiquement 1-à-1 avec synchronisation du timing"
            >
              ⚡ Auto-Associer
            </button>
          </div>

          <ul className="sublist">
            {srtItems.map((sub, i) => {
              // Find matching zone for this subtitle
              const matchedZoneIdx = elements.findIndex(el => el.subtitle === sub.content)
              const matchedZone = matchedZoneIdx >= 0 ? elements[matchedZoneIdx] : null

              return (
                <li
                  key={i}
                  id={`srt-item-${i}`}
                  onClick={() => {
                    if (selectedElement >= 0) {
                      linkSubtitleToElement(selectedElement, sub)
                    }
                  }}
                  title={selectedElement >= 0 ? `Cliquer pour lier à la Zone #${selectedElement + 1}` : 'Sélectionnez une zone pour lier'}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    borderColor: matchedZone ? 'rgba(59,130,246,0.4)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="o">#{i + 1}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {formatMs(sub.startMs)} → {formatMs(sub.endMs)}
                      </span>
                    </div>

                    {matchedZone ? (
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: '#60a5fa', background: 'rgba(59,130,246,0.15)', padding: '1px 5px', borderRadius: 4 }}>
                        Zone #{matchedZoneIdx + 1}
                      </span>
                    ) : selectedElement >= 0 ? (
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0.7 }}>
                        Lier à #${selectedElement + 1} ↵
                      </span>
                    ) : null}
                  </div>

                  <span className="s" style={{ whiteSpace: 'normal', fontSize: 11.5, lineHeight: 1.35 }}>
                    {sub.content}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </aside>
  )
}
