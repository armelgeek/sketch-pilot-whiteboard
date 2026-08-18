import { useState } from 'react'
import { renderSingleScene, mergeProjectScenes, saveSceneConfig } from '../services/render-api'

export default function VideoExportModal({ scenes, sceneIdx, onClose, onToast }) {
  const [exportMode, setExportMode] = useState('full') // 'active' | 'full'
  const [status, setStatus] = useState('idle') // 'idle' | 'rendering' | 'merging' | 'success' | 'error'
  const [progressMsg, setProgressMsg] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)
  const [jobStatus, setJobStatus] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [videoUrl, setVideoUrl] = useState('')

  // Render options
  const [inkPath, setInkPath] = useState('skeleton')
  const [colorFill, setColorFill] = useState('brush')
  const [penStyle, setPenStyle] = useState('stylus')
  const [qualityMode, setQualityMode] = useState('draft') // 'draft' | 'hd'

  const activeScene = sceneIdx >= 0 ? scenes[sceneIdx] : null

  async function handleStartExport() {
    setStatus('rendering')
    setErrorMsg('')
    setVideoUrl('')
    setProgressPercent(0)
    setJobStatus('queued')

    const renderOpts = {
      inkPath,
      colorFill,
      penStyle,
      preview: qualityMode === 'draft',
    }

    const onProgress = (job) => {
      if (job.status === 'queued') {
        setJobStatus('En file d\'attente...')
        setProgressPercent(5)
      } else if (job.status === 'processing') {
        setJobStatus('Génération en cours...')
        setProgressPercent(job.progress || 50)
      }
    }

    try {
      if (exportMode === 'active') {
        if (!activeScene) throw new Error('Aucune scène active sélectionnée')
        setProgressMsg(`Rendu de la Scène #${sceneIdx + 1} (${activeScene.name})`)

        // Save current config if jsonPath exists
        if (activeScene.jsonPath && activeScene.cfg) {
          await saveSceneConfig(activeScene.jsonPath, activeScene.cfg).catch(() => {})
        }

        const res = await renderSingleScene(activeScene, renderOpts, onProgress)
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
          const stepPercent = Math.round((i / scenes.length) * 80)
          setProgressPercent(stepPercent)
          setProgressMsg(`Rendu de la Scène ${i + 1}/${scenes.length} (${sc.name})`)

          if (sc.jsonPath && sc.cfg) {
            await saveSceneConfig(sc.jsonPath, sc.cfg).catch(() => {})
          }

          const res = await renderSingleScene(sc, renderOpts, (job) => {
            if (job.status === 'queued') setJobStatus(`Scène ${i + 1}: En file d'attente...`)
            else setJobStatus(`Scène ${i + 1}: Traitement (${job.progress || 50}%)`)
          })
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
        setProgressPercent(90)
        setProgressMsg(`Fusion des ${renderedMp4s.length} scènes avec transitions...`)

        const mergeRes = await mergeProjectScenes({
          inputs: renderedMp4s,
          output: 'whiteboard_final.mp4',
          transitions: transitionsList.join(','),
          transitionMs: transitionMsList.join(','),
        }, (job) => {
          setJobStatus(`Fusion: ${job.status}`)
        })

        setProgressPercent(100)
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
            <span>🎬 Film Complet ({scenes.length} scènes)</span>
          </button>
        </div>

        {/* Render Quality & Options Selector */}
        {status !== 'rendering' && status !== 'merging' && status !== 'success' && (
          <div className="bg-[#020617] p-4 rounded-xl border border-[#1e293b] grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-[11px] font-semibold text-[#94a3b8]">Mode de Qualité & Vitesse</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setQualityMode('draft')}
                  className={`p-2.5 rounded-lg border text-left text-xs flex flex-col gap-0.5 transition-all ${
                    qualityMode === 'draft'
                      ? 'bg-[#60a5fa]/10 border-[#60a5fa] text-white font-bold'
                      : 'bg-[#1e293b]/50 border-[#334155] text-[#94a3b8] hover:border-[#475569]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span>⚡ Aperçu Rapid (720p 30fps)</span>
                    <span className="bg-[#60a5fa]/20 text-[#60a5fa] text-[10px] px-1.5 py-0.2 rounded font-mono font-bold">Recommandé</span>
                  </span>
                  <span className="text-[10px] opacity-75 font-normal">Faststart, très rapide, idéal pour tester vos modifications</span>
                </button>

                <button
                  type="button"
                  onClick={() => setQualityMode('hd')}
                  className={`p-2.5 rounded-lg border text-left text-xs flex flex-col gap-0.5 transition-all ${
                    qualityMode === 'hd'
                      ? 'bg-[#60a5fa]/10 border-[#60a5fa] text-white font-bold'
                      : 'bg-[#1e293b]/50 border-[#334155] text-[#94a3b8] hover:border-[#475569]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span>🎬 Final HD (1080p 60fps)</span>
                  </span>
                  <span className="text-[10px] opacity-75 font-normal">Haute définition pour exportation définitive</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-[#94a3b8]">Tracé de l'encre</label>
              <select
                value={inkPath}
                onChange={e => setInkPath(e.target.value)}
                className="bg-[#1e293b] text-xs font-medium text-white px-2 py-1.5 rounded-lg border border-[#334155] outline-none"
              >
                <option value="skeleton">🦴 Squelette (Séquentiel)</option>
                <option value="grid">🌐 Grille (Balayage)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-[#94a3b8]">Couleur</label>
              <select
                value={colorFill}
                onChange={e => setColorFill(e.target.value)}
                className="bg-[#1e293b] text-xs font-medium text-white px-2 py-1.5 rounded-lg border border-[#334155] outline-none"
              >
                <option value="brush">🖌️ Pinceau</option>
                <option value="contour-wipe">🧹 Balayage</option>
              </select>
            </div>
          </div>
        )}

        {/* Progress & Status Box with Queue & Progress Bar */}
        {(status === 'rendering' || status === 'merging') && (
          <div className="flex flex-col p-6 bg-[#020617] rounded-xl border border-[#1e293b] gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 border-3 border-[#60a5fa] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <div className="flex-1">
                <div className="flex justify-between items-center mb-1">
                  <p className="text-sm font-bold text-white">{progressMsg}</p>
                  <span className="text-xs font-mono text-[#60a5fa] bg-[#60a5fa]/10 px-2 py-0.5 rounded border border-[#60a5fa]/20 font-semibold">
                    {jobStatus || 'Worker actif'}
                  </span>
                </div>
                <p className="text-xs text-[#94a3b8]">File d'attente asynchrone non-bloquante (Worker Thread Pool)</p>
              </div>
            </div>

            <div className="w-full bg-[#1e293b] rounded-full h-2 overflow-hidden border border-[#334155]">
              <div
                className="bg-gradient-to-r from-[#3b82f6] to-[#60a5fa] h-full transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(5, progressPercent)}%` }}
              />
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
              preload="metadata"
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
