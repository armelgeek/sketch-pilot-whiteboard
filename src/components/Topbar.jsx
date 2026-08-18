import useWhiteboardStore from '../store/useWhiteboardStore'

export default function Topbar({
  scenes,
  sceneIdx,
  mode,
  onSetMode,
  onOpenDir,
  onLoadSrt,
  onLoadFiles,
  onPrevScene,
  onNextScene,
  onSceneChange,
  showOverlay,
  onToggleOverlay,
  onSave,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  dirty,
  onOpenExport,
}) {
  const { viewMode, setViewMode } = useWhiteboardStore()
  const isDirty = dirty.size > 0

  return (
    <div className="topbar flex items-center gap-2 px-4 py-2 flex-wrap z-10">
      {/* Brand */}
      <div className="brand font-bold text-[15px] tracking-tight flex items-center gap-2 mr-1">
        <span style={{ fontSize: 18 }}>🎬</span>
        <span>SRT Whiteboard</span>
        <span className="brand-tag">v2.0</span>
      </div>

      <div className="divider-v" />

      {/* File actions */}
      <button id="btn-open-dir" onClick={onOpenDir} className="btn-primary">
        📁 Ouvrir
      </button>
      <button id="btn-load-srt" onClick={onLoadSrt} className="btn-ghost">
        📜 SRT
      </button>

      <div className="divider-v" />

      {/* Scene Navigation */}
      <div className="flex items-center gap-1 bg-[#0d131f] p-1 rounded-md border border-[var(--border-color)]">
        <button
          id="btn-prev-scene"
          onClick={onPrevScene}
          disabled={sceneIdx <= 0}
          className="btn-nav"
          title="Scène précédente"
        >
          ‹
        </button>

        {scenes[sceneIdx]?.imgPath && (
          <div className="w-7 h-5 rounded bg-[#1a2333] border border-[#2b3954] overflow-hidden shrink-0 hidden sm:block">
            <img src={scenes[sceneIdx].imgPath} alt="vignette" className="w-full h-full object-cover" />
          </div>
        )}

        <select
          id="scene-select"
          value={sceneIdx}
          onChange={e => onSceneChange(+e.target.value)}
          disabled={scenes.length === 0}
          className="scene-select font-semibold text-[11.5px]"
        >
          {scenes.length === 0 ? (
            <option>Aucune scène chargée</option>
          ) : (
            scenes.map((s, i) => (
              <option key={i} value={i}>
                #{i + 1} {s.name}{s.hasConfig ? '' : ' ·'}
              </option>
            ))
          )}
        </select>

        <button
          id="btn-next-scene"
          onClick={onNextScene}
          disabled={sceneIdx >= scenes.length - 1}
          className="btn-nav"
          title="Scène suivante"
        >
          ›
        </button>
      </div>

      {scenes.length > 0 && (
        <span className="text-[10.5px] font-mono text-[#60a5fa] bg-[#60a5fa]/10 px-2 py-0.5 rounded border border-[#60a5fa]/20">
          {sceneIdx + 1}/{scenes.length} scènes
        </span>
      )}

      <div className="divider-v" />

      {/* Drawing Tool switch */}
      <div className="mode-switch">
        <button
          id="btn-mode-select"
          onClick={() => onSetMode('select')}
          className={mode === 'select' ? 'active' : ''}
        >
          🔍 Sélection
        </button>
        <button
          id="btn-mode-draw"
          onClick={() => onSetMode('draw')}
          className={mode === 'draw' ? 'active' : ''}
        >
          ✏️ Dessiner
        </button>
      </div>

      <div className="divider-v" />

      {/* Main Studio View Mode Toggle: Canvas Editor vs Scene MP4 Video */}
      <div className="flex bg-[#0d131f] p-0.5 rounded-lg border border-[var(--border-color)]">
        <button
          onClick={() => setViewMode('editor')}
          className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all flex items-center gap-1 ${
            viewMode === 'editor'
              ? 'bg-[#60a5fa] text-[#0d1117] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-white'
          }`}
          title="Mode Éditeur Canvas (Konva)"
        >
          <span>✏️ Édition</span>
        </button>

        <button
          onClick={() => setViewMode('video')}
          className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all flex items-center gap-1 ${
            viewMode === 'video'
              ? 'bg-[#60a5fa] text-[#0d1117] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-white'
          }`}
          title="Mode Aperçu Rendu Vidéo MP4"
        >
          <span>🎬 Vidéo MP4</span>
        </button>
      </div>

      <div className="divider-v" />

      {/* Undo / Redo */}
      <button
        id="btn-undo"
        onClick={onUndo}
        disabled={!canUndo}
        className="btn-ghost"
        title="Annuler (Ctrl+Z)"
        style={{ padding: '4px 9px', fontSize: 15, opacity: canUndo ? 1 : 0.35 }}
      >
        ↩
      </button>
      <button
        id="btn-redo"
        onClick={onRedo}
        disabled={!canRedo}
        className="btn-ghost"
        title="Refaire (Ctrl+Y)"
        style={{ padding: '4px 9px', fontSize: 15, opacity: canRedo ? 1 : 0.35 }}
      >
        ↪
      </button>

      <span className="flex-1" />

      {/* Overlay toggle */}
      <label
        className="flex items-center gap-1.5 cursor-pointer select-none"
        style={{ fontSize: 12, color: 'var(--text-secondary)' }}
      >
        <input
          type="checkbox"
          checked={showOverlay}
          onChange={e => onToggleOverlay(e.target.checked)}
          style={{ accentColor: 'var(--blue)', cursor: 'pointer' }}
        />
        Cadres
      </label>

      {/* Export MP4 Modal Button */}
      <button
        id="btn-export-mp4"
        onClick={onOpenExport}
        disabled={scenes.length === 0}
        className="px-3 py-1.5 bg-[#60a5fa] hover:bg-[#3b82f6] text-[#020617] text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-md disabled:opacity-40"
        title="Ouvrir le studio d'exportation MP4"
      >
        <span>🎬</span>
        <span>Exporter MP4</span>
      </button>

      {/* Save button */}
      <button
        id="btn-save"
        onClick={onSave}
        className={isDirty ? 'btn-primary' : 'btn-ghost'}
        title="Sauvegarder (Ctrl+S)"
        style={{
          position: 'relative',
          transition: 'all 0.2s ease',
        }}
      >
        💾 {isDirty ? 'Sauvegarder*' : 'Sauvegardé'}
      </button>
    </div>
  )
}
