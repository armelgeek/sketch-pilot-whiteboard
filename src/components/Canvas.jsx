import { useEffect, useRef } from 'react'
import { renderCanvas } from '../utils/render'

export default function Canvas({
  cfg,
  source,
  time,
  isPlaying,
  paperColor,
  showOverlay,
  renderCaches,
  hideHint,
  onOpenDir,
  onLoadSrt
}) {
  const canvasRef = useRef()
  const containerRef = useRef()

  useEffect(() => {
    if (!canvasRef.current || !cfg || !source) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    renderCanvas(
      ctx,
      cfg,
      source,
      cfg.elements || [],
      paperColor,
      time,
      isPlaying,
      renderCaches
    )

    // Draw overlay if needed
    if (showOverlay && cfg.elements) {
      cfg.elements.forEach(e => {
        ctx.save()
        ctx.strokeStyle = '#f5a623'
        ctx.lineWidth = 2
        ctx.globalAlpha = 0.3
        const r = e.region
        ctx.strokeRect(r.x, r.y, r.width, r.height)
        ctx.restore()
      })
    }
  }, [cfg, source, time, isPlaying, paperColor, showOverlay])

  return (
    <div
      ref={containerRef}
      className="stage-wrap flex-1 flex items-center justify-center overflow-auto p-5 bg-[#0b0c0e] relative"
    >
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

      {!cfg ? (
        <div className="hint p-10 text-[#9aa1ab] text-sm leading-relaxed max-w-[720px] bg-[#161920] rounded-xl border border-[#262a34] text-center">
          <h2 className="text-white text-xl font-bold mt-0 mb-4">
            👋 Bienvenue sur SRT Whiteboard Animation !
          </h2>
          <p>
            Vous pouvez <b className="text-[#f5a623]">Glisser & Déposer (Drag & Drop)</b> des
            dossiers, images <code className="bg-[#222630] px-2 py-0.5 rounded text-blue-400 font-mono">
              .png
            </code>{' '}
            ou sous-titres{' '}
            <code className="bg-[#222630] px-2 py-0.5 rounded text-blue-400 font-mono">
              .srt
            </code>{' '}
            directement dans cette fenêtre.
          </p>
          <div className="text-left bg-[#101216] p-4 rounded-lg my-4 text-xs leading-relaxed">
            📌 <b>Instructions d'utilisation :</b>
            <br />
            1. <b>Glissez-déposez vos fichiers</b> images{' '}
            <code className="bg-[#222630] px-1.5 py-0.5 rounded text-blue-400 font-mono">
              .png
            </code>{' '}
            ou sous-titres{' '}
            <code className="bg-[#222630] px-1.5 py-0.5 rounded text-blue-400 font-mono">
              .srt
            </code>{' '}
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
      ) : (
        <canvas
          ref={canvasRef}
          className="block max-w-full max-h-[calc(100vh-190px)] shadow-[0_10px_40px_rgba(0,0,0,0.6)] rounded-md touch-none cursor-default"
        />
      )}
    </div>
  );
}
