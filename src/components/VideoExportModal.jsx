import { useState } from 'react'
import { renderSingleScene, mergeProjectScenes, saveSceneConfig } from '../services/render-api'

export default function VideoExportModal({ scenes, sceneIdx, onClose, onToast }) {
  const [exportMode, setExportMode] = useState('full') // 'active' | 'full'
  const [status, setStatus] = useState('idle') // 'idle' | 'rendering' | 'merging' | 'success' | 'error'
  const [progressMsg, setProgressMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [videoUrl, setVideoUrl] = useState('')

  // Render options
  const [inkPath, setInkPath] = useState('skeleton')
  const [colorFill, setColorFill] = useState('brush')
  const [penStyle, setPenStyle] = useState('stylus')

  const activeScene = sceneIdx >= 0 ? scenes[sceneIdx] : null

  async function handleStartExport() {
    setStatus('rendering')
    setErrorMsg('')
    setVideoUrl('')

    try {
      if (exportMode === 'active') {
        if (!activeScene) throw new Error('Aucune scène active sélectionnée')
        setProgressMsg(`Rendu de la Scène #${sceneIdx + 1} (${activeScene.name})...`)

        // Save current config if jsonPath exists
        if (activeScene.jsonPath && activeScene.cfg) {
          await saveSceneConfig(activeScene.jsonPath, activeScene.cfg).catch(() => {})
        }

        const res = await renderSingleScene(activeScene, { inkPath, colorFill, penStyle })
        setVideoUrl(res.videoUrl)
        setStatus('success')
        if (onToast) onToast('🎬 Rendu de la scène réussi !')
      } else {
        // Full project export
        const renderedMp4s = []
        const transitionsList = []
        const transitionMsList = []

        for (let i = 0; i < scenes.length; i++) {
          const sc = scenes[i]
          setProgressMsg(`Rendu de la Scène ${i + 1}/${scenes.length} (${sc.name})...`)

          if (sc.jsonPath && sc.cfg) {
            await saveSceneConfig(sc.jsonPath, sc.cfg).catch(() => {})
          }

          const res = await renderSingleScene(sc, { inkPath, colorFill, penStyle })
          renderedMp4s.push(res.videoUrl)

          // Collect transition for scene N
          const tAfter = sc.cfg?.transition?.transitionAfter || sc.cfg?.transitionAfter || 'cut'
          const tMs = sc.cfg?.transition?.transitionMs ?? sc.cfg?.transitionMs ?? 500
          if (i < scenes.length - 1) {
            transitionsList.push(tAfter)
            transitionMsList.push(tMs)
          }
        }

        setStatus('merging')
        setProgressMsg(`Fusion des ${renderedMp4s.length} scènes avec transitions...`)

        const mergeRes = await mergeProjectScenes({
          inputs: renderedMp4s,
          output: 'whiteboard_final.mp4',
          transitions: transitionsList.join(','),
          transitionMs: transitionMsList.join(','),
        })

        setVideoUrl(mergeRes.videoUrl)
        setStatus('success')
        if (onToast) onToast('🚀 Film final généré avec succès !')
      }
    } catch (err) {
      console.error(err)
      setErrorMsg(err.message || 'Erreur pendant la génération vidéo')
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#0f172a] border border-[#1e293b] w-full max-w-xl rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-[#f8fafc]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#1e293b] pb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎬</span>
            <div>
              <h3 className="text-lg font-bold">Studio d'Exportation & Rendu MP4</h3>
              <p className="text-xs text-[#94a3b8]">Générez vos vidéos whiteboard avec le moteur Python</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#1e293b] hover:bg-[#334155] text-[#94a3b8] hover:text-white flex items-center justify-center text-sm font-bold transition-all"
          >
            ✕
          </button>
        </div>

        {/* Export Mode Toggle */}
        <div className="flex bg-[#020617] p-1.5 rounded-xl border border-[#1e293b]">
          <button
            className={`flex-1 py-2.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              exportMode === 'active'
                ? 'bg-[#60a5fa] text-[#020617] shadow-md'
                : 'text-[#94a3b8] hover:text-white'
            }`}
            onClick={() => { setExportMode('active'); setStatus('idle'); setVideoUrl(''); }}
          >
            <span>🎯 Scène Active uniquement</span>
            {activeScene && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/20 font-mono">
                #{sceneIdx + 1}
              </span>
            )}
          </button>

          <button
            className={`flex-1 py-2.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              exportMode === 'full'
                ? 'bg-[#60a5fa] text-[#020617] shadow-md'
                : 'text-[#94a3b8] hover:text-white'
            }`}
            onClick={() => { setExportMode('full'); setStatus('idle'); setVideoUrl(''); }}
          >
            <span>🚀 Film Complet (Projet)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/20 font-mono">
              {scenes.length} scènes
            </span>
          </button>
        </div>

        {/* Options grid */}
        {status === 'idle' && (
          <div className="grid grid-cols-3 gap-3 bg-[#020617]/50 p-3 rounded-xl border border-[#1e293b]">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-[#94a3b8]">Tracé de l'encre</label>
              <select
                value={inkPath}
                onChange={e => setInkPath(e.target.value)}
                className="bg-[#1e293b] text-xs font-medium text-white px-2 py-1.5 rounded-lg border border-[#334155] outline-none"
              >
                <option value="skeleton">🦴 Squelette (Naturel)</option>
                <option value="grid">📐 Grille Métrique</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-[#94a3b8]">Remplissage couleur</label>
              <select
                value={colorFill}
                onChange={e => setColorFill(e.target.value)}
                className="bg-[#1e293b] text-xs font-medium text-white px-2 py-1.5 rounded-lg border border-[#334155] outline-none"
              >
                <option value="brush">🖌️ Pinceau Vague</option>
                <option value="sweep">🧹 Balayage Direct</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-[#94a3b8]">Style du Stylet</label>
              <select
                value={penStyle}
                onChange={e => setPenStyle(e.target.value)}
                className="bg-[#1e293b] text-xs font-medium text-white px-2 py-1.5 rounded-lg border border-[#334155] outline-none"
              >
                <option value="stylus">✒️ Stylus Précision</option>
                <option value="marker">🖊️ Feutre Épais</option>
              </select>
            </div>
          </div>
        )}

        {/* Progress & Status Box */}
        {(status === 'rendering' || status === 'merging') && (
          <div className="flex flex-col items-center justify-center p-6 bg-[#020617] rounded-xl border border-[#1e293b] gap-3">
            <div className="w-8 h-8 border-3 border-[#60a5fa] border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-sm font-bold text-white">{progressMsg}</p>
              <p className="text-xs text-[#94a3b8] mt-1">Le processeur Python génère les trames MP4...</p>
            </div>
          </div>
        )}

        {/* Error message */}
        {status === 'error' && (
          <div className="p-4 bg-red-950/40 border border-red-800/50 rounded-xl text-red-300 text-xs flex flex-col gap-1">
            <span className="font-bold text-red-200">❌ Erreur lors de la génération :</span>
            <span className="font-mono">{errorMsg}</span>
          </div>
        )}

        {/* Video Player Output */}
        {status === 'success' && videoUrl && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold text-[#10b981] flex items-center gap-1.5 bg-[#10b981]/10 p-2 rounded-lg border border-[#10b981]/20">
              <span>✅</span>
              <span>Vidéo générée avec succès !</span>
            </div>

            <video
              src={videoUrl}
              controls
              autoPlay
              className="w-full max-h-[300px] bg-black rounded-xl border border-[#334155] object-contain"
            />

            <div className="flex items-center justify-end gap-2">
              <a
                href={videoUrl}
                download
                className="px-4 py-2 bg-[#10b981] hover:bg-[#059669] text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-md"
              >
                <span>⬇️</span> Télécharger le MP4
              </a>
            </div>
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-[#1e293b] pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#1e293b] hover:bg-[#334155] text-xs font-semibold rounded-lg text-[#94a3b8] hover:text-white transition-all"
          >
            Fermer
          </button>

          {status !== 'rendering' && status !== 'merging' && (
            <button
              onClick={handleStartExport}
              className="px-5 py-2 bg-[#60a5fa] hover:bg-[#3b82f6] text-[#020617] text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-lg"
            >
              <span>🚀</span>
              <span>
                {exportMode === 'active'
                  ? `Lancer le rendu (Scène #${sceneIdx + 1})`
                  : `Lancer le film complet (${scenes.length} scènes)`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
