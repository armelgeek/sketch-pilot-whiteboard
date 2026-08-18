import { useState, useEffect, useRef } from 'react'
import { generateAnnotationPreview } from '../utils/preview'

export default function Sidebar({
  cfg,
  setCfg,
  selectedElement,
  onSelectElement,
  srtItems,
  source
}) {
  const elements = cfg?.elements || []
  const selected = elements[selectedElement]
  const [previews, setPreviews] = useState({})

  useEffect(() => {
    if (!source || !elements.length) return

    const newPreviews = {}
    elements.forEach((e, i) => {
      if (e.region) {
        const preview = generateAnnotationPreview(source, e.region, 80)
        if (preview) newPreviews[i] = preview
      }
    })
    setPreviews(newPreviews)
  }, [source, elements])

  function updateElement(key, value) {
    if (!selected) return
    const updated = [...elements]
    updated[selectedElement] = { ...selected, [key]: value }
    setCfg({ ...cfg, elements: updated })
  }

  function updateRegion(key, value) {
    if (!selected) return
    const updated = [...elements]
    updated[selectedElement] = {
      ...selected,
      region: { ...selected.region, [key]: value }
    }
    setCfg({ ...cfg, elements: updated })
  }

  function updateReveal(key, value) {
    if (!selected) return
    const updated = [...elements]
    updated[selectedElement] = {
      ...selected,
      reveal: { ...selected.reveal, [key]: value }
    }
    setCfg({ ...cfg, elements: updated })
  }

  function deleteElement(idx) {
    const updated = elements.filter((_, i) => i !== idx)
    setCfg({ ...cfg, elements: updated })
    if (selectedElement >= updated.length) {
      onSelectElement(Math.max(0, updated.length - 1))
    }
  }

  const TYPE_COLORS = {
    structure: '#f5a623',
    character: '#3b82f6',
    effect: '#a855f7',
    text: '#10b981'
  };

  return (
    <aside className="side w-[420px] shrink-0 bg-[#161920] border-l border-[#262a34] overflow-y-auto p-4 flex flex-col gap-4">
      <div className="annotations-section">
        <h3 className="m-0 mb-3 text-sm uppercase tracking-wider text-[#e6e8ec] flex justify-between items-center font-bold">
          ZONES DE DESSIN <span className="text-[#8b929c] text-xs font-normal">{elements.length}</span>
        </h3>

        <div className="cards grid grid-cols-1 gap-3">
          {elements.map((e, i) => (
            <div
              key={i}
              onClick={() => onSelectElement(i)}
              className={`card rounded-lg border-2 cursor-pointer transition-all duration-200 overflow-hidden ${
                i === selectedElement
                  ? 'bg-[#2a2d36] border-[#f5a623]'
                  : 'bg-[#1a1d24] border-[#2a2e38] hover:border-[#3a4048]'
              }`}
            >
              <div className="card-image relative bg-[#0f1115]">
                {previews[i] ? (
                  <img
                    src={previews[i]}
                    alt="preview"
                    className="w-full h-24 object-cover"
                  />
                ) : (
                  <div className="w-full h-24 bg-[#262a34] flex items-center justify-center text-[#8b929c] text-sm">
                    📸 Pas d'aperçu
                  </div>
                )}
                <div className="absolute top-2 left-2 flex items-center gap-2">
                  <span className="badge-number bg-[#f5a623] text-black font-bold text-sm px-2 py-1 rounded">
                    {i + 1}
                  </span>
                </div>
              </div>

              <div className="card-content p-3">
                <div className="mb-2">
                  <h4 className="m-0 font-bold text-sm text-[#e6e8ec] truncate">
                    {e.label || 'Zone sans nom'}
                  </h4>
                  <p className="m-0 text-xs text-[#8b929c] mt-1">
                    Pos: ({e.region?.x}, {e.region?.y}) • Taille: {e.region?.width}×{e.region?.height}
                  </p>
                </div>
                <div className="flex items-center gap-2 justify-between">
                  <span
                    className="badge text-xs px-2 py-1 rounded font-medium"
                    style={{
                      backgroundColor: `${TYPE_COLORS[e.type] || '#999'}30`,
                      color: TYPE_COLORS[e.type] || '#999'
                    }}
                  >
                    {e.type}
                  </span>
                  <button
                    onClick={(evt) => {
                      evt.stopPropagation()
                      deleteElement(i)
                    }}
                    className="text-[#8b929c] hover:text-red-400 text-lg transition-colors"
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => {
            const newEl = {
              id: `region_${Date.now()}`,
              label: 'Nouvelle zone',
              type: 'structure',
              region: { x: 100, y: 100, width: 200, height: 200 },
              reveal: { direction: 'top_to_bottom', startMs: 0, durationMs: 2000, protectedRegions: [] },
              handPath: {}
            }
            setCfg({ ...cfg, elements: [...elements, newEl] })
          }}
          className="w-full mt-3 bg-[#222630] text-[#e6e8ec] border border-[#363c4a] hover:bg-[#2d3342] hover:border-[#4a5266] rounded-md px-3 py-2.5 cursor-pointer text-sm font-medium transition-all duration-150 inline-flex items-center justify-center gap-2"
        >
          ＋ Ajouter zone
        </button>
      </div>

      {selected && (
        <div>
          <h3 className="m-0 mb-1.5 text-xs uppercase tracking-wider text-[#8b929c] font-semibold">
            PROPRIÉTÉS DE LA ZONE
          </h3>
          <div className="fields grid grid-cols-[80px_1fr] gap-2 items-center text-[12.5px] bg-[#1b1e26] p-2.5 rounded-md border border-[#262a34]">
            <label className="text-slate-400 font-medium">Nom zone</label>
            <input
              type="text"
              value={selected.label || ''}
              onChange={e => updateElement('label', e.target.value)}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            />

            <label className="text-slate-400 font-medium">Type</label>
            <select
              value={selected.type || 'structure'}
              onChange={e => updateElement('type', e.target.value)}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            >
              <option value="structure">Structure (décor)</option>
              <option value="character">Personnage</option>
              <option value="effect">Effet</option>
              <option value="text">Texte</option>
            </select>

            <label className="text-slate-400 font-medium">Position X</label>
            <input
              type="number"
              min="0"
              value={selected.region?.x || 0}
              onChange={e => updateRegion('x', parseFloat(e.target.value))}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            />

            <label className="text-slate-400 font-medium">Position Y</label>
            <input
              type="number"
              min="0"
              value={selected.region?.y || 0}
              onChange={e => updateRegion('y', parseFloat(e.target.value))}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            />

            <label className="text-slate-400 font-medium">Largeur</label>
            <input
              type="number"
              min="1"
              value={selected.region?.width || 200}
              onChange={e => updateRegion('width', parseFloat(e.target.value))}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            />

            <label className="text-slate-400 font-medium">Hauteur</label>
            <input
              type="number"
              min="1"
              value={selected.region?.height || 200}
              onChange={e => updateRegion('height', parseFloat(e.target.value))}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            />

            <label className="text-slate-400 font-medium">Direction</label>
            <select
              value={selected.reveal?.direction || 'top_to_bottom'}
              onChange={e => updateReveal('direction', e.target.value)}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            >
              <option value="top_to_bottom">De haut en bas</option>
              <option value="bottom_to_top">De bas en haut</option>
              <option value="left_to_right">De gauche à droite</option>
              <option value="right_to_left">De droite à gauche</option>
            </select>

            <label className="text-slate-400 font-medium">Style reveal</label>
            <select
              value={selected.reveal?.style || ''}
              onChange={e => updateReveal('style', e.target.value)}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            >
              <option value="">✏️ Dessin main (défaut)</option>
              <option value="wipe">➡️ Balayage (wipe)</option>
              <option value="fade">🌫️ Fondu (fade)</option>
              <option value="typewriter">⌨️ Machine à écrire (texte)</option>
              <option value="zoom">🔍 Zoom (pop-in)</option>
              <option value="slide">↔️ Glissement (slide)</option>
              <option value="rotate">🔄 Rotation</option>
              <option value="iris">⭕ Iris (cercle)</option>
            </select>

            <label className="text-slate-400 font-medium">Début (ms)</label>
            <input
              type="number"
              min="0"
              step="100"
              value={selected.reveal?.startMs || 0}
              onChange={e => updateReveal('startMs', parseFloat(e.target.value))}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            />

            <label className="text-slate-400 font-medium">Durée (ms)</label>
            <input
              type="number"
              min="100"
              step="100"
              value={selected.reveal?.durationMs || 2000}
              onChange={e => updateReveal('durationMs', parseFloat(e.target.value))}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded px-2 py-1 w-full text-xs outline-none focus:border-blue-500"
            />
          </div>

          <div className="fields grid grid-cols-[80px_1fr] gap-2 items-start text-[12.5px] bg-[#1b1e26] p-2.5 rounded-md border border-[#262a34] mt-2">
            <label className="text-slate-400 font-medium pt-1">Sous-titre lié</label>
            <textarea
              value={selected.subtitle || ''}
              onChange={e => updateElement('subtitle', e.target.value)}
              rows="3"
              placeholder="Saisissez la réplique ou sous-titre lié à cet élément..."
              className="w-full bg-[#222630] text-[#e6e8ec] border border-[#363c4a] rounded-md p-2 text-[12.5px] resize-y font-sans outline-none min-h-[50px] focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {srtItems.length > 0 && (
        <div>
          <h3 className="m-0 mb-1.5 text-xs uppercase tracking-wider text-[#8b929c] font-semibold">
            LISTE DES SOUS-TITRES
          </h3>
          <ul className="sublist list-none m-0 p-0 text-[12.5px]">
            {srtItems.map((sub, i) => (
              <li key={i} className="px-2.5 py-1.5 rounded-md mb-1 bg-[#1e222a] border border-[#262a33] cursor-pointer flex gap-2 items-baseline text-slate-300 hover:bg-[#262b36]">
                <span className="o text-blue-400 font-bold">{i + 1}</span>
                <span className="s flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs">
                  {sub.content}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
