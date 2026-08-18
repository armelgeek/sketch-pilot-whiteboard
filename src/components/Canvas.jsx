import { useEffect, useRef, useState } from 'react'
import AnnotationCanvas from './AnnotationCanvas'

export default function Canvas({
  cfg,
  source,
  showOverlay,
  onOpenDir,
  onLoadSrt,
  mode,
  selectedElement,
  onSelectElement,
  onAddElement,
  onUpdateElement,
  scenes,
  sceneIdx,
}) {
  const canvasRef = useRef()
  const containerRef = useRef()
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 })

  // Observe container dimensions pour adapter Konva stage
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setContainerSize({ w: Math.floor(width), h: Math.floor(height) })
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Rendu image statique avec régions
  useEffect(() => {
    if (mode !== 'select') return
    if (!canvasRef.current || !cfg || !source) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const w = cfg.canvas?.width || 1
    const h = cfg.canvas?.height || 1

    canvas.width = w
    canvas.height = h

    ctx.drawImage(source, 0, 0)

    if (showOverlay && cfg.elements) {
      cfg.elements.forEach((e, i) => {
        ctx.save()
        ctx.strokeStyle = i === selectedElement ? '#f5a623' : '#666'
        ctx.lineWidth = i === selectedElement ? 2.5 : 1
        ctx.globalAlpha = i === selectedElement ? 0.7 : 0.3
        const r = e.region
        ctx.strokeRect(r.x, r.y, r.width, r.height)
        ctx.restore()
      })
    }
  }, [cfg, source, showOverlay, selectedElement, mode])

  return (
    <div
      ref={containerRef}
      className="stage-wrap flex-1 flex items-center justify-center overflow-auto p-5 bg-[#0b0c0e] relative"
    >
      {/* Dropzone overlay */}
      <div className="dropzone-overlay absolute inset-0 bg-[#0f1115]/92 border-2 border-dashed border-blue-500 flex flex-col items-center justify-center z-[100] opacity-0 pointer-events-none transition-opacity duration-200 backdrop-blur-sm">
        <div className="dropzone-icon text-5xl mb-3 text-blue-500">📥</div>
        <div className="dropzone-title text-xl font-semibold text-white mb-1.5">
          Déposez les fichiers ou dossiers ici
        </div>
        <div className="dropzone-sub text-sm text-[#9aa1ab]">
          Prise en charge des images (.png, .jpg), sous-titres (.srt) et configurations
          (.annotation.json)
        </div>
      </div>

      {/* Écran d'accueil si aucun cfg */}
      {!cfg ? (
        <div className="hint p-10 text-[#9aa1ab] text-sm leading-relaxed max-w-[720px] bg-[#161920] rounded-xl border border-[#262a34] text-center">
          <h2 className="text-white text-xl font-bold mt-0 mb-4">
            👋 Bienvenue sur SRT Whiteboard Animation !
          </h2>
          <p>
            Vous pouvez <b className="text-[#f5a623]">Glisser &amp; Déposer (Drag &amp; Drop)</b> des
            dossiers, images{' '}
            <code className="bg-[#222630] px-2 py-0.5 rounded text-blue-400 font-mono">.png</code>{' '}
            ou sous-titres{' '}
            <code className="bg-[#222630] px-2 py-0.5 rounded text-blue-400 font-mono">.srt</code>{' '}
            directement dans cette fenêtre.
          </p>
          <div className="text-left bg-[#101216] p-4 rounded-lg my-4 text-xs leading-relaxed">
            📌 <b>Instructions d'utilisation :</b>
            <br />
            1. <b>Glissez-déposez vos fichiers</b> images{' '}
            <code className="bg-[#222630] px-1.5 py-0.5 rounded text-blue-400 font-mono">.png</code>{' '}
            ou sous-titres{' '}
            <code className="bg-[#222630] px-1.5 py-0.5 rounded text-blue-400 font-mono">.srt</code>{' '}
            sur la page.
            <br />
            2. Passez en mode <b>✏️ Dessiner une zone</b> puis glissez votre curseur sur l'image
            pour tracer rapidement une zone.
            <br />
            3. Cliquez sur le bouton <b>▶ Play</b> ci-dessous pour prévisualiser l'animation de
            dessin en direct !
            <br />
            4. Cliquez sur <b>🎥 Export WebM Rapide</b> pour télécharger instantanément votre
            vidéo démo sans exécuter Python !
          </div>
          <div className="drop-btn-box mt-5 flex gap-3 justify-center">
            <button
              onClick={onOpenDir}
              className="bg-blue-600 border border-blue-600 text-white hover:bg-blue-700 rounded-md px-5 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer inline-flex items-center gap-1.25"
            >
              📁 Choisir un dossier de scènes
            </button>
            <button
              onClick={onLoadSrt}
              className="bg-[#222630] text-[#e6e8ec] border border-[#363c4a] hover:bg-[#2d3342] hover:border-[#4a5266] rounded-md px-5 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer inline-flex items-center gap-1.25"
            >
              📜 Charger un fichier SRT
            </button>
          </div>
        </div>

      ) : mode === 'draw' ? (
        // ── Mode annotation Konva ──────────────────────────────────────────────
        <div className="flex items-center justify-center w-full h-full">
          <AnnotationCanvas
            cfg={cfg}
            imgUrl={scenes?.[sceneIdx]?.imgUrl}
            selectedElement={selectedElement}
            onSelectElement={onSelectElement}
            onAddElement={onAddElement}
            onUpdateElement={onUpdateElement}
            containerWidth={containerSize.w - 40}
            containerHeight={containerSize.h - 40}
          />
        </div>

      ) : (
        // ── Mode prévisualisation 2D canvas ───────────────────────────────────
        <canvas
          ref={canvasRef}
          className="block max-w-full max-h-[calc(100vh-190px)] shadow-[0_10px_40px_rgba(0,0,0,0.6)] rounded-md touch-none cursor-default"
        />
      )}
    </div>
  )
}
