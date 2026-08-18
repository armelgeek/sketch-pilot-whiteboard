import useWhiteboardStore from '../store/useWhiteboardStore'

const TYPE_COLORS = {
  structure: '#f5a623',
  character: '#3b82f6',
  effect:    '#a855f7',
  text:      '#10b981',
  object:    '#ec4899',
  prop:      '#06b6d4',
  symbol:    '#eab308',
}

const REVEAL_DIRECTIONS = [
  { value: 'top_to_bottom',   label: '↓ Haut → Bas' },
  { value: 'bottom_to_top',   label: '↑ Bas → Haut' },
  { value: 'left_to_right',   label: '→ Gauche → Droite' },
  { value: 'right_to_left',   label: '← Droite → Gauche' },
]

const REVEAL_STYLES = [
  { value: '',           label: '✏️ Dessin main' },
  { value: 'wipe',       label: '➡️ Balayage' },
  { value: 'fade',       label: '🌫️ Fondu' },
  { value: 'typewriter', label: '⌨️ Machine à écrire' },
  { value: 'zoom',       label: '🔍 Zoom' },
  { value: 'slide',      label: '↔️ Glissement' },
  { value: 'rotate',     label: '🔄 Rotation' },
  { value: 'iris',       label: '⭕ Iris' },
]

const ELEMENT_TYPES = [
  { value: 'structure', label: 'Structure (décor)' },
  { value: 'character', label: 'Personnage' },
  { value: 'object',    label: 'Objet' },
  { value: 'prop',      label: 'Accessoire' },
  { value: 'text',      label: 'Texte' },
  { value: 'symbol',    label: 'Symbole' },
  { value: 'effect',    label: 'Effet' },
]

const SCENE_TRANSITION_TYPES = [
  { value: 'cut',         label: '⚡ Cut (Coupure franche)' },
  { value: 'fade',        label: '🌫️ Fondu (Fade)' },
  { value: 'fadeblack',   label: '⬛ Fondu au Noir' },
  { value: 'fadewhite',   label: '⬜ Fondu au Blanc' },
  { value: 'dissolve',    label: '✨ Fondu Enchaîné' },
  { value: 'wipeleft',    label: '← Balayage Gauche (Wipe)' },
  { value: 'wiperight',   label: '→ Balayage Droite' },
  { value: 'wipeup',      label: '↑ Balayage Haut' },
  { value: 'wipedown',    label: '↓ Balayage Bas' },
  { value: 'slideleft',   label: '◀ Glissement Gauche (Slide)' },
  { value: 'slideright',  label: '▶ Glissement Droite' },
  { value: 'slideup',     label: '▲ Glissement Haut' },
  { value: 'slidedown',   label: '▼ Glissement Bas' },
  { value: 'smoothleft',  label: '⬅️ Balayage Doux Gauche' },
  { value: 'smoothright', label: '➡️ Balayage Doux Droite' },
  { value: 'circleopen',  label: '⭕ Ouverture Cercle' },
  { value: 'circleclose', label: '🛑 Fermeture Cercle' },
  { value: 'pixelize',    label: '👾 Pixellisation' },
  { value: 'hblur',       label: '💧 Flou Horizontal' },
]

export default function RightSidebar({
  cfg,
  selectedElement,
  onUpdateElement,
  onUpdateRegion,
  srtItems = [],
}) {
  const elements = cfg?.elements || []
  const selected = elements[selectedElement]
  const { linkSubtitleToElement, updateSceneTransition } = useWhiteboardStore()

  const currentTransition = {
    transitionAfter: cfg?.transition?.transitionAfter || cfg?.transitionAfter || 'cut',
    transitionMs: cfg?.transition?.transitionMs ?? cfg?.transitionMs ?? 500,
  }

  if (!selected) {
    return (
      <aside className="side side-right flex flex-col p-4 gap-4 overflow-y-auto">
        <div className="section-header">
          <span className="section-title">⚙️ Propriétés de la Scène</span>
          <span className="section-count text-[#60a5fa]">{cfg?.name || 'Scène'}</span>
        </div>

        {/* Scene Info */}
        <div className="prop-card">
          <div className="text-[11px] font-semibold text-[var(--text-secondary)] mb-2">Informations Générales</div>
          <div className="prop-grid">
            <span className="prop-label">Zones</span>
            <span className="prop-input bg-transparent border-0 text-[#f5a623] font-bold">{elements.length} zone(s)</span>
            <span className="prop-label">Canvas</span>
            <span className="prop-input bg-transparent border-0 font-mono text-[10.5px]">
              {cfg?.canvas?.width || 1280} × {cfg?.canvas?.height || 720} px
            </span>
          </div>
        </div>

        {/* Scene Transition Card */}
        <div className="prop-card border border-[#60a5fa]/30 bg-[#0d131f] flex flex-col gap-2 p-3 rounded-md">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-[#60a5fa] flex items-center gap-1.5">
              🎬 Transition Moteur (xfade)
            </span>
            <span className="text-[9.5px] font-mono text-[#f5a623] bg-[#f5a623]/10 px-1.5 py-0.5 rounded border border-[#f5a623]/30">
              {currentTransition.transitionAfter === 'cut' ? '0s' : `${((currentTransition.transitionMs || 500) / 1000).toFixed(1)}s`}
            </span>
          </div>

          <div className="prop-grid gap-2 mt-1">
            <span className="prop-label">Effet</span>
            <select
              className="prop-input text-[11px]"
              value={currentTransition.transitionAfter}
              onChange={(e) => {
                const newType = e.target.value
                const ms = newType === 'cut' ? 0 : (currentTransition.transitionMs || 500)
                updateSceneTransition({ transitionAfter: newType, transitionMs: ms })
              }}
            >
              {SCENE_TRANSITION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            {currentTransition.transitionAfter !== 'cut' && (
              <>
                <span className="prop-label">Durée (ms)</span>
                <input
                  type="number"
                  step={100}
                  min={100}
                  max={5000}
                  className="prop-input font-mono"
                  value={currentTransition.transitionMs}
                  onChange={(e) => {
                    const ms = Math.max(0, parseInt(e.target.value) || 0)
                    updateSceneTransition({ transitionMs: ms })
                  }}
                />
              </>
            )}
          </div>
        </div>

        <div className="text-[10.5px] text-[var(--text-muted)] italic text-center px-2 mt-4">
          💡 Cliquez sur une zone sur le canevas ou dans la barre latérale gauche pour éditer ses propriétés d'animation.
        </div>
      </aside>
    )
  }

  function updateElement(key, value) {
    if (selectedElement == null) return
    onUpdateElement(selectedElement, { [key]: value })
  }

  function updateRegion(key, value) {
    if (selectedElement == null) return
    onUpdateRegion(selectedElement, { [key]: value })
  }

  function updateReveal(key, value) {
    onUpdateElement(selectedElement, { reveal: { ...selected.reveal, [key]: value } })
  }

  function updateHandPath(key, value) {
    onUpdateElement(selectedElement, { handPath: { ...selected.handPath, [key]: value } })
  }

  // Find matching SRT item
  const matchedSrt = srtItems.find(s => s.content === selected.subtitle)

  return (
    <aside className="side side-right">
      <div className="side-section">
        <div className="section-header">
          <span className="section-title">Propriétés</span>
          <span
            className="section-count"
            style={{ color: TYPE_COLORS[selected.type] || 'var(--text-muted)' }}
          >
            {selected.type}
          </span>
        </div>

        {/* Identity */}
        <div className="prop-card" style={{ marginBottom: 10 }}>
          <div className="prop-grid">
            <span className="prop-label">Nom</span>
            <input
              className="prop-input"
              type="text"
              value={selected.label || ''}
              onChange={e => updateElement('label', e.target.value)}
              placeholder="Nom de la zone"
            />

            <span className="prop-label">Type</span>
            <select
              className="prop-input"
              value={selected.type || 'structure'}
              onChange={e => updateElement('type', e.target.value)}
            >
              {ELEMENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            <span className="prop-label">Rôle</span>
            <input
              className="prop-input"
              type="text"
              value={selected.narrativeRole || ''}
              onChange={e => updateElement('narrativeRole', e.target.value)}
              placeholder="Ex: Sujet principal"
            />

            <span className="prop-label">Séquence</span>
            <input
              className="prop-input"
              type="number" min="1"
              value={selected.sequence || 1}
              onChange={e => updateElement('sequence', parseInt(e.target.value))}
            />
          </div>
        </div>

        {/* Region */}
        <div className="prop-card" style={{ marginBottom: 10 }}>
          <div className="section-title" style={{ marginBottom: 8, display: 'block' }}>Région</div>
          <div className="prop-grid">
            <span className="prop-label">X</span>
            <input className="prop-input" type="number" min="0"
              value={selected.region?.x ?? 0}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateRegion('x', isNaN(val) ? 0 : val)
              }} />
            <span className="prop-label">Y</span>
            <input className="prop-input" type="number" min="0"
              value={selected.region?.y ?? 0}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateRegion('y', isNaN(val) ? 0 : val)
              }} />
            <span className="prop-label">Largeur</span>
            <input className="prop-input" type="number" min="1"
              value={selected.region?.width ?? 200}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateRegion('width', isNaN(val) || val < 1 ? 10 : val)
              }} />
            <span className="prop-label">Hauteur</span>
            <input className="prop-input" type="number" min="1"
              value={selected.region?.height ?? 200}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateRegion('height', isNaN(val) || val < 1 ? 10 : val)
              }} />
          </div>
        </div>

        {/* Reveal / Animation */}
        <div className="prop-card" style={{ marginBottom: 10 }}>
          <div className="section-title" style={{ marginBottom: 8, display: 'block' }}>Animation</div>
          <div className="prop-grid">
            <span className="prop-label">Direction</span>
            <select className="prop-input"
              value={selected.reveal?.direction || 'top_to_bottom'}
              onChange={e => updateReveal('direction', e.target.value)}
            >
              {REVEAL_DIRECTIONS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>

            <span className="prop-label">Style</span>
            <select className="prop-input"
              value={selected.reveal?.style || ''}
              onChange={e => updateReveal('style', e.target.value)}
            >
              {REVEAL_STYLES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            <span className="prop-label">Début (ms)</span>
            <input className="prop-input" type="number" min="0" step="100"
              value={selected.reveal?.startMs ?? 0}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateReveal('startMs', isNaN(val) || val < 0 ? 0 : val)
              }} />

            <span className="prop-label">Durée (ms)</span>
            <input className="prop-input" type="number" min="100" step="100"
              value={selected.reveal?.durationMs ?? 2000}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateReveal('durationMs', isNaN(val) || val < 100 ? 100 : val)
              }} />

            <span className="prop-label">Marge px</span>
            <input className="prop-input" type="number" min="0" step="1"
              value={selected.reveal?.maskPaddingPx ?? 22}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateReveal('maskPaddingPx', isNaN(val) ? 0 : val)
              }} />
          </div>
        </div>

        {/* Hand path */}
        <div className="prop-card" style={{ marginBottom: 10 }}>
          <div className="section-title" style={{ marginBottom: 8, display: 'block' }}>Trajectoire main</div>
          <div className="prop-grid">
            <span className="prop-label">Début X</span>
            <input className="prop-input" type="number"
              value={selected.handPath?.start?.[0] ?? ''}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateHandPath('start', [isNaN(val) ? 0 : val, selected.handPath?.start?.[1] ?? 0])
              }} />
            <span className="prop-label">Début Y</span>
            <input className="prop-input" type="number"
              value={selected.handPath?.start?.[1] ?? ''}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateHandPath('start', [selected.handPath?.start?.[0] ?? 0, isNaN(val) ? 0 : val])
              }} />
            <span className="prop-label">Fin X</span>
            <input className="prop-input" type="number"
              value={selected.handPath?.end?.[0] ?? ''}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateHandPath('end', [isNaN(val) ? 0 : val, selected.handPath?.end?.[1] ?? 0])
              }} />
            <span className="prop-label">Fin Y</span>
            <input className="prop-input" type="number"
              value={selected.handPath?.end?.[1] ?? ''}
              onChange={e => {
                const val = parseFloat(e.target.value)
                updateHandPath('end', [selected.handPath?.end?.[0] ?? 0, isNaN(val) ? 0 : val])
              }} />
            <span className="prop-label">Easing</span>
            <select className="prop-input"
              value={selected.handPath?.easing || 'easeInOut'}
              onChange={e => updateHandPath('easing', e.target.value)}
            >
              <option value="easeInOut">easeInOut</option>
              <option value="linear">linear</option>
              <option value="easeIn">easeIn</option>
              <option value="easeOut">easeOut</option>
            </select>
          </div>
        </div>

        {/* Subtitle */}
        <div className="prop-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="section-title">Sous-titre lié</span>
            {matchedSrt && (
              <span style={{ fontSize: 9.5, color: '#60a5fa', fontWeight: 600 }}>
                ⏱ {(matchedSrt.startMs / 1000).toFixed(1)}s → {(matchedSrt.endMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {srtItems.length > 0 && (
            <select
              className="prop-input"
              style={{ marginBottom: 8, fontSize: 11.5 }}
              value={matchedSrt ? srtItems.indexOf(matchedSrt) : ''}
              onChange={e => {
                const idx = parseInt(e.target.value)
                if (!isNaN(idx) && srtItems[idx]) {
                  linkSubtitleToElement(selectedElement, srtItems[idx])
                }
              }}
            >
              <option value="">-- Choisir un sous-titre SRT --</option>
              {srtItems.map((s, i) => (
                <option key={i} value={i}>
                  #{i + 1} ({(s.startMs / 1000).toFixed(1)}s) {s.content.slice(0, 30)}...
                </option>
              ))}
            </select>
          )}

          <textarea
            className="prop-textarea"
            value={selected.subtitle || ''}
            onChange={e => updateElement('subtitle', e.target.value)}
            rows={3}
            placeholder="Réplique ou sous-titre associé…"
          />
        </div>

        {/* Scene Transition (Engine) */}
        <div className="prop-card border border-[#60a5fa]/20 bg-[#0d131f]">
          <div className="flex items-center justify-between mb-2">
            <span className="section-title text-[#60a5fa]">🎬 Transition Scène (Moteur)</span>
            <span className="text-[9.5px] font-mono text-[#f5a623] bg-[#f5a623]/10 px-1.5 py-0.5 rounded border border-[#f5a623]/30">
              {currentTransition.transitionAfter === 'cut' ? '0s' : `${((currentTransition.transitionMs || 500) / 1000).toFixed(1)}s`}
            </span>
          </div>
          <div className="prop-grid gap-2">
            <span className="prop-label">Effet</span>
            <select
              className="prop-input text-[11px]"
              value={currentTransition.transitionAfter}
              onChange={(e) => {
                const newType = e.target.value
                const ms = newType === 'cut' ? 0 : (currentTransition.transitionMs || 500)
                updateSceneTransition({ transitionAfter: newType, transitionMs: ms })
              }}
            >
              {SCENE_TRANSITION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {currentTransition.transitionAfter !== 'cut' && (
              <>
                <span className="prop-label">Durée</span>
                <input
                  type="number"
                  step={100}
                  min={100}
                  max={5000}
                  className="prop-input font-mono"
                  value={currentTransition.transitionMs}
                  onChange={(e) => {
                    const ms = Math.max(0, parseInt(e.target.value) || 0)
                    updateSceneTransition({ transitionMs: ms })
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
