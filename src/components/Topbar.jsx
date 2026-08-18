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
  onAddZone,
  dirty
}) {
  return (
    <div className="topbar flex items-center gap-2.5 px-4 py-2.5 bg-[#161920] border-b border-[#262a34] flex-wrap z-10">
      <div className="brand font-bold text-[15px] text-[#f5a623] tracking-wide flex items-center gap-2">
        🎬 SRT Whiteboard Workbench
        <span className="brand-tag bg-[#262a33] text-[11px] px-1.5 py-0.5 rounded text-[#8b929c] font-normal">
          v2.0 Démo Web Live
        </span>
      </div>

      <button
        onClick={onOpenDir}
        className="bg-blue-600 border border-blue-600 text-white hover:bg-blue-700 rounded-md px-3 py-1.5 cursor-pointer text-xs font-medium transition-all duration-150 inline-flex items-center gap-1.25 disabled:opacity-45 disabled:cursor-not-allowed"
      >
        📁 Ouvrir un dossier…
      </button>

      <button
        onClick={onLoadSrt}
        className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] hover:bg-[#2d3342] hover:border-[#4a5266] rounded-md px-3 py-1.5 cursor-pointer text-xs font-medium transition-all duration-150 inline-flex items-center gap-1.25"
      >
        📜 Charger sous-titres SRT…
      </button>

      <div className="h-4.5 w-px bg-[#363c4a] mx-1"></div>

      <button
        onClick={onPrevScene}
        disabled={scenes.length === 0}
        className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] hover:bg-[#2d3342] hover:border-[#4a5266] rounded-md px-3 py-1.5 cursor-pointer text-xs font-medium transition-all duration-150 inline-flex items-center gap-1.25 disabled:opacity-45 disabled:cursor-not-allowed"
      >
        ‹
      </button>

      <select
        value={sceneIdx}
        onChange={e => onSceneChange(+e.target.value)}
        disabled={scenes.length === 0}
        className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded-md px-2.5 py-1.5 text-xs max-w-[260px] outline-none disabled:opacity-45 disabled:cursor-not-allowed"
      >
        {scenes.length === 0 ? (
          <option>Aucune scène chargée</option>
        ) : (
          scenes.map((s, i) => (
            <option key={i} value={i}>
              {i + 1}. {s.name}{s.hasConfig ? '' : ' (Auto)'}
            </option>
          ))
        )}
      </select>

      <button
        onClick={onNextScene}
        disabled={scenes.length === 0}
        className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] hover:bg-[#2d3342] hover:border-[#4a5266] rounded-md px-3 py-1.5 cursor-pointer text-xs font-medium transition-all duration-150 inline-flex items-center gap-1.25 disabled:opacity-45 disabled:cursor-not-allowed"
      >
        ›
      </button>

      {scenes.length > 0 && (
        <span className="text-xs text-[#8b929c]">Total : {scenes.length} scène(s)</span>
      )}

      <div className="mode-switch flex bg-[#222630] rounded-md p-0.5 border border-[#363c4a] ml-1.5">
        <button
          onClick={() => onSetMode('select')}
          className={`border-none bg-transparent px-2.5 py-1 text-xs rounded transition-colors cursor-pointer text-[#e6e8ec] ${
            mode === 'select' ? 'active bg-blue-600 text-white font-medium' : ''
          }`}
        >
          🔍 Sélection / Déplacement
        </button>
        <button
          onClick={() => onSetMode('draw')}
          className={`border-none bg-transparent px-2.5 py-1 text-xs rounded transition-colors cursor-pointer text-[#e6e8ec] ${
            mode === 'draw' ? 'active bg-blue-600 text-white font-medium' : ''
          }`}
        >
          ✏️ Dessiner une zone
        </button>
      </div>

      <span className="flex-1"></span>

      <label className="flex items-center gap-1.5 cursor-pointer text-[12.5px] text-slate-300">
        <input
          type="checkbox"
          checked={showOverlay}
          onChange={e => onToggleOverlay(e.target.checked)}
          className="accent-blue-500 cursor-pointer"
        />
        Cadres de zones
      </label>

      <span className="text-[#f5a623] font-semibold text-xs animate-pulse">
        {dirty.size > 0 ? '●' : ''}
      </span>
    </div>
  );
}
