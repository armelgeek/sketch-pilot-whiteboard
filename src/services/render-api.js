/**
 * API Service for interacting with local Python rendering server endpoints.
 */

export async function saveSceneConfig(relPath, config) {
  console.log('[API] saveSceneConfig:', { path: relPath, configKeys: config ? Object.keys(config) : 'null' })

  const resp = await fetch('/api/save_annotation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath, config }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    console.error('[API] saveSceneConfig failed:', err)
    throw new Error(err.error || 'Erreur lors de la sauvegarde du schéma de la scène')
  }
  const result = await resp.json()
  console.log('[API] saveSceneConfig result:', result)
  return result
}

export async function renderSingleScene(sceneData, renderOpts = {}) {
  const payload = {
    imgPath: sceneData.imgPath || sceneData.imgName,
    jsonPath: sceneData.jsonPath || sceneData.cfgName,
    outPath: sceneData.mp4Path,
    config: sceneData.cfg,
    renderOpts,
  }
  console.log('[API] renderSingleScene payload:', payload)

  const resp = await fetch('/api/render_scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await resp.json()
  if (!resp.ok || data.status === 'error') {
    throw new Error(data.error || 'Échec du rendu de la scène')
  }
  return data
}

export async function mergeProjectScenes({ inputs, output = 'final.mp4', transitions = '', transitionMs = '' }) {
  const resp = await fetch('/api/merge_scenes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs,
      output,
      transitions,
      transitionMs,
    }),
  })
  const data = await resp.json()
  if (!resp.ok || data.status === 'error') {
    throw new Error(data.error || 'Échec de la fusion du projet')
  }
  return data
}
