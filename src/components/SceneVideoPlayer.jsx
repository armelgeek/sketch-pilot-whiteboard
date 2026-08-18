import { useState, useEffect } from 'react'
import useWhiteboardStore from '../store/useWhiteboardStore'
import { renderSingleScene, saveSceneConfig } from '../services/render-api'

export default function SceneVideoPlayer() {
  const { scenes, sceneIdx, cfg, dirty, updateSceneMp4Url, clearDirty, setViewMode } = useWhiteboardStore()

  const [rendering, setRendering] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const activeScene = sceneIdx >= 0 && scenes[sceneIdx] ? scenes[sceneIdx] : null
  const baseUrl = activeScene?.mp4Path || activeScene?.videoUrl
  // Cache-busting: append timestamp so browser doesn't cache old video
  const videoUrl = baseUrl ? `${baseUrl}?t=${Date.now()}` : null
  const isDirty = sceneIdx >= 0 && dirty.has(sceneIdx)

  useEffect(() => {
    if (activeScene && (!baseUrl || isDirty) && !rendering) {
      handleRenderCurrentScene()
    }
  }, [sceneIdx, baseUrl, isDirty, rendering])

  async function handleRenderCurrentScene() {
    if (!activeScene) return
    setRendering(true)
    setErrorMsg('')

    try {
      const targetConfig = cfg || activeScene.cfg

      // Save config before rendering
      if (activeScene.jsonPath && targetConfig) {
        try {
          console.log('[Save] Sauvegarde config sur:', activeScene.jsonPath)
          await saveSceneConfig(activeScene.jsonPath, targetConfig)
          console.log('[Save] ✓ Config sauvegardée')
        } catch (e) {
          console.error('[Save] ✗ Erreur sauvegarde:', e.message)
          setErrorMsg(`Erreur sauvegarde config: ${e.message}`)
          return
        }
      } else {
        console.warn('[Save] Pas de jsonPath ou config:', { jsonPath: activeScene.jsonPath, hasCfg: !!targetConfig })
      }

      console.log('[Render] Envoi config au serveur...')
      const res = await renderSingleScene({
        ...activeScene,
        cfg: targetConfig,
      })

      updateSceneMp4Url(sceneIdx, res.videoUrl)
      clearDirty(sceneIdx)
    } catch (err) {
      console.error('[Render] ✗ Erreur:', err)
      setErrorMsg(err.message || 'Erreur lors de la génération du rendu MP4')
    } finally {
      setRendering(false)
    }
  }

  if (!activeScene) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#080a0f] text-[#94a3b8] p-6">
        <p className="text-sm font-semibold">Aucune scène active à prévisualiser</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#080a0f] p-6 relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute inset-0 bg-radial-gradient pointer-events-none opacity-20" />

      {/* Video Container Box */}
      <div className="w-full max-w-4xl bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-2xl flex flex-col z-10">
        {/* Header bar inside player */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#020617] border-b border-[#1e293b]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-[#60a5fa] text-[#020617] font-mono">
              Scène #{sceneIdx + 1}
            </span>
            <span className="text-sm font-bold text-[#f8fafc] truncate" title={activeScene.name}>
              {activeScene.name}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('editor')}
              className="px-3 py-1 bg-[#1e293b] hover:bg-[#334155] text-xs font-bold text-[#94a3b8] hover:text-white rounded-lg transition-all flex items-center gap-1"
              title="Retourner au Canvas d'Édition"
            >
              <span>✏️ Éditeur</span>
            </button>

            <button
              onClick={handleRenderCurrentScene}
              disabled={rendering}
              className="px-3 py-1 bg-[#60a5fa] hover:bg-[#3b82f6] text-xs font-bold text-[#020617] rounded-lg transition-all flex items-center gap-1 shadow-md disabled:opacity-50"
            >
              <span>{rendering ? '⏳' : '🔄'}</span>
              <span>{rendering ? 'Calcul...' : 'Régénérer Rendu'}</span>
            </button>
          </div>
        </div>

        {/* Player / Render State */}
        <div className="min-h-[400px] flex flex-col items-center justify-center bg-black relative">
          {rendering ? (
            <div className="flex flex-col items-center gap-3 p-8">
              <div className="w-10 h-10 border-3 border-[#60a5fa] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-white">Génération de la vidéo MP4 en cours...</p>
              <p className="text-xs text-[#94a3b8]">Rendu réaliste par le moteur Python OpenCV / FFmpeg</p>
            </div>
          ) : videoUrl ? (
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              autoPlay
              className="w-full max-h-[520px] object-contain bg-black"
            />
          ) : (
            <div className="flex flex-col items-center gap-4 p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-[#1e293b] flex items-center justify-center text-3xl">
                🎬
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Rendu Vidéo non encore calculé</h3>
                <p className="text-xs text-[#94a3b8] max-w-md mt-1">
                  Lancez le rendu Python pour prévisualiser l'animation d'écriture et de coloriage de cette scène.
                </p>
              </div>
              <button
                onClick={handleRenderCurrentScene}
                className="px-5 py-2.5 bg-[#60a5fa] hover:bg-[#3b82f6] text-[#020617] text-xs font-bold rounded-xl transition-all shadow-xl flex items-center gap-2"
              >
                <span>▶️</span>
                <span>Générer le rendu MP4 de la Scène #{sceneIdx + 1}</span>
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="absolute bottom-4 left-4 right-4 bg-red-950/80 border border-red-700/60 p-3 rounded-lg text-red-200 text-xs font-mono">
              ❌ Erreur : {errorMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
