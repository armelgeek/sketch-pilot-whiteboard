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

export async function getRenderJobStatus(jobId) {
  const resp = await fetch(`/api/render_status?jobId=${encodeURIComponent(jobId)}`)
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Erreur lors de la récupération du statut du rendu')
  }
  return await resp.json()
}

export async function pollRenderJob(jobId, onProgress) {
  while (true) {
    const job = await getRenderJobStatus(jobId)
    if (onProgress && typeof onProgress === 'function') {
      onProgress(job)
    }

    if (job.status === 'completed') {
      return job
    }
    if (job.status === 'failed') {
      throw new Error(job.error || 'Le rendu a échoué')
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

export async function renderSingleScene(sceneData, renderOpts = {}, onProgress = null) {
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
    throw new Error(data.error || 'Échec de la soumission du rendu')
  }

  if (data.jobId) {
    return await pollRenderJob(data.jobId, onProgress)
  }
  return data
}

export async function mergeProjectScenes({ inputs, output = 'final.mp4', transitions = '', transitionMs = '' }, onProgress = null) {
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
    throw new Error(data.error || 'Échec de la soumission de la fusion')
  }

  if (data.jobId) {
    return await pollRenderJob(data.jobId, onProgress)
  }
  return data
}
