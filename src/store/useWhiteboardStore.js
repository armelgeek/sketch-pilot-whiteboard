import { create } from 'zustand'
import { parseSRT } from '../utils/srt'
import { validateSceneConfig } from '../schema'

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_HISTORY = 50

// ── Helpers ───────────────────────────────────────────────────────────────────

function cloneElements(elements) {
  return JSON.parse(JSON.stringify(elements))
}

function newElementId() {
  return `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ── Store ─────────────────────────────────────────────────────────────────────

const useWhiteboardStore = create((set, get) => ({
  // ── Scene State ─────────────────────────────────────────────────────────────
  scenes: [],
  sceneIdx: -1,
  cfg: null,
  source: null,
  paperColor: '#fdf0d0',

  // ── UI State ─────────────────────────────────────────────────────────────────
  mode: 'select', // 'select' | 'draw'
  viewMode: 'editor', // 'editor' | 'video'
  selectedElement: 0,
  showOverlay: true,
  srtItems: [],

  // ── Persistence State ────────────────────────────────────────────────────────
  dirty: new Set(),

  // ── Undo / Redo ──────────────────────────────────────────────────────────────
  past: [],   // Array of Element[] snapshots
  future: [], // Array of Element[] snapshots

  // ── Basic Setters ────────────────────────────────────────────────────────────

  setMode: (mode) => set({ mode }),
  setViewMode: (viewMode) => set({ viewMode }),
  setShowOverlay: (show) => set({ showOverlay: show }),
  setSelectedElement: (idx) => set({ selectedElement: idx }),
  setSrtItems: (items) => set({ srtItems: items }),

  setPaperColor: (color) => set({ paperColor: color }),

  setScenes: (scenes) => set({ scenes }),

  setSceneIdx: (idx) => set({ sceneIdx: idx }),

  setCfgRaw: (cfg) => set({ cfg }),

  updateSceneMp4Url: (sceneIdx, mp4Url) => {
    const { scenes } = get()
    if (sceneIdx < 0 || sceneIdx >= scenes.length) return
    const updatedScenes = scenes.map((s, i) =>
      i === sceneIdx ? { ...s, mp4Path: mp4Url, videoUrl: mp4Url } : s
    )
    set({ scenes: updatedScenes })
  },

  // ── Scene Actions ─────────────────────────────────────────────────────────────

  reorderScene: (fromIdx, delta) => {
    const { scenes, sceneIdx } = get()
    const toIdx = fromIdx + delta
    if (fromIdx < 0 || fromIdx >= scenes.length || toIdx < 0 || toIdx >= scenes.length) return
    const newScenes = [...scenes]
    const [moved] = newScenes.splice(fromIdx, 1)
    newScenes.splice(toIdx, 0, moved)
    let newActiveIdx = sceneIdx
    if (sceneIdx === fromIdx) {
      newActiveIdx = toIdx
    } else if (sceneIdx > fromIdx && sceneIdx <= toIdx) {
      newActiveIdx = sceneIdx - 1
    } else if (sceneIdx < fromIdx && sceneIdx >= toIdx) {
      newActiveIdx = sceneIdx + 1
    }
    set({ scenes: newScenes, sceneIdx: newActiveIdx })
  },

  duplicateScene: (idx) => {
    const { scenes } = get()
    if (idx < 0 || idx >= scenes.length) return
    const target = scenes[idx]
    const copy = {
      ...JSON.parse(JSON.stringify(target)),
      name: `${target.name} (copie)`,
    }
    if (copy.cfg) {
      copy.cfg.name = copy.name
    }
    const newScenes = [...scenes]
    newScenes.splice(idx + 1, 0, copy)
    set({ scenes: newScenes, sceneIdx: idx + 1, cfg: copy.cfg || get().cfg })
  },

  deleteScene: (idx) => {
    const { scenes, sceneIdx } = get()
    if (scenes.length <= 1 || idx < 0 || idx >= scenes.length) return
    const newScenes = scenes.filter((_, i) => i !== idx)
    let newActiveIdx = sceneIdx
    if (sceneIdx >= newScenes.length) {
      newActiveIdx = newScenes.length - 1
    } else if (sceneIdx > idx) {
      newActiveIdx = sceneIdx - 1
    }
    const activeScene = newScenes[newActiveIdx]
    set({
      scenes: newScenes,
      sceneIdx: newActiveIdx,
      cfg: activeScene?.cfg || null,
    })
  },

  // ── Undo / Redo Core ──────────────────────────────────────────────────────────

  /** Push current elements to past before applying a mutation. */
  _pushHistory: () => {
    const { cfg, past } = get()
    if (!cfg?.elements) return
    const snapshot = cloneElements(cfg.elements)
    const newPast = [...past, snapshot].slice(-MAX_HISTORY)
    set({ past: newPast, future: [] })
  },

  undo: () => {
    const { past, future, cfg } = get()
    if (!past.length || !cfg) return
    const snapshot = past[past.length - 1]
    const newPast = past.slice(0, -1)
    const newFuture = [cloneElements(cfg.elements), ...future].slice(0, MAX_HISTORY)
    const updatedCfg = { ...cfg, elements: snapshot }
    set({ past: newPast, future: newFuture, cfg: updatedCfg })
    // Update scene cache
    get()._syncSceneCache(updatedCfg)
  },

  redo: () => {
    const { past, future, cfg } = get()
    if (!future.length || !cfg) return
    const snapshot = future[0]
    const newFuture = future.slice(1)
    const newPast = [...past, cloneElements(cfg.elements)].slice(-MAX_HISTORY)
    const updatedCfg = { ...cfg, elements: snapshot }
    set({ past: newPast, future: newFuture, cfg: updatedCfg })
    get()._syncSceneCache(updatedCfg)
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  // ── Internal Helpers ──────────────────────────────────────────────────────────

  /** Sync scene cfg cache and mark as dirty. */
  _syncSceneCache: (updatedCfg) => {
    const { sceneIdx, scenes, dirty } = get()
    if (sceneIdx < 0) return
    const newDirty = new Set(dirty)
    newDirty.add(sceneIdx)
    const newScenes = scenes.map((s, i) => i === sceneIdx ? { ...s, cfg: updatedCfg } : s)
    set({ scenes: newScenes, dirty: newDirty })
  },

  /** Apply a mutation on cfg.elements with history tracking. */
  _mutateElements: (mutatorFn) => {
    const { cfg } = get()
    if (!cfg) return
    get()._pushHistory()
    const newElements = mutatorFn(cloneElements(cfg.elements))
    const updatedCfg = { ...cfg, elements: newElements }
    set({ cfg: updatedCfg })
    get()._syncSceneCache(updatedCfg)
  },

  /** Update the engine transition config for the active scene. */
  updateSceneTransition: (patch) => {
    const { cfg } = get()
    if (!cfg) return
    get()._pushHistory()
    const currentTransition = cfg.transition || { transitionAfter: 'cut', transitionMs: 500 }
    const updatedCfg = {
      ...cfg,
      transition: { ...currentTransition, ...patch },
    }
    set({ cfg: updatedCfg })
    get()._syncSceneCache(updatedCfg)
  },

  /** Update engine transition config for any scene by index. */
  updateSceneTransitionAt: (targetIdx, patch) => {
    const { scenes, sceneIdx, cfg } = get()
    if (targetIdx < 0 || targetIdx >= scenes.length) return
    const targetScene = scenes[targetIdx]
    const targetCfg = targetIdx === sceneIdx ? cfg : (targetScene.cfg || {})
    const currentTransition = targetCfg.transition || {
      transitionAfter: targetCfg.transitionAfter || 'cut',
      transitionMs: targetCfg.transitionMs ?? 500,
    }
    const updatedTransition = { ...currentTransition, ...patch }
    const updatedCfg = {
      ...targetCfg,
      transitionAfter: updatedTransition.transitionAfter,
      transitionMs: updatedTransition.transitionMs,
      transition: updatedTransition,
    }
    const newScenes = scenes.map((s, i) => (i === targetIdx ? { ...s, cfg: updatedCfg } : s))
    if (targetIdx === sceneIdx) {
      set({ cfg: updatedCfg, scenes: newScenes })
    } else {
      set({ scenes: newScenes })
    }
  },

  // ── Element CRUD ──────────────────────────────────────────────────────────────

  addElement: (el) => {
    const { cfg } = get()
    if (!cfg) return
    get()._mutateElements((els) => {
      const newEl = { ...el, id: el.id || newElementId() }
      return [...els, newEl]
    })
    set({ selectedElement: (get().cfg?.elements?.length ?? 1) - 1 })
  },

  updateElement: (idx, patch) => {
    get()._mutateElements((els) =>
      els.map((el, i) => {
        if (i !== idx) return el
        const updated = { ...el, ...patch }
        if (patch.region && el.region) {
          updated.region = { ...el.region, ...patch.region }
        }
        if (patch.reveal && el.reveal) {
          updated.reveal = { ...el.reveal, ...patch.reveal }
        }
        if (patch.handPath && el.handPath) {
          updated.handPath = { ...el.handPath, ...patch.handPath }
        }
        return updated
      })
    )
  },

  updateRegion: (idx, regionPatch) => {
    get()._mutateElements((els) =>
      els.map((el, i) =>
        i === idx ? { ...el, region: { ...el.region, ...regionPatch } } : el
      )
    )
  },

  deleteElement: (idx) => {
    const { selectedElement } = get()
    get()._mutateElements((els) => els.filter((_, i) => i !== idx))
    const remaining = (get().cfg?.elements?.length ?? 0)
    if (remaining === 0) {
      set({ selectedElement: -1 })
    } else {
      set({ selectedElement: Math.min(selectedElement, remaining - 1) })
    }
  },

  duplicateElement: (idx) => {
    const { cfg } = get()
    if (!cfg?.elements?.[idx]) return
    get()._mutateElements((els) => {
      const original = els[idx]
      const dupe = {
        ...JSON.parse(JSON.stringify(original)),
        id: newElementId(),
        label: `${original.label || 'Zone'} (copie)`,
        region: {
          ...original.region,
          x: original.region.x + 20,
          y: original.region.y + 20,
        },
      }
      const newEls = [...els]
      newEls.splice(idx + 1, 0, dupe)
      return newEls
    })
    set({ selectedElement: idx + 1 })
  },

  reorderElement: (fromIdx, direction) => {
    const { cfg } = get()
    const toIdx = fromIdx + direction
    if (!cfg?.elements || toIdx < 0 || toIdx >= cfg.elements.length) return
    get()._mutateElements((els) => {
      const arr = [...els]
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)

      // Retain chronological timeline order: re-assign sorted startMs sequence
      const existingStarts = els.map(e => e.reveal?.startMs ?? 0).sort((a, b) => a - b)
      return arr.map((el, i) => ({
        ...el,
        reveal: {
          ...el.reveal,
          startMs: existingStarts[i] ?? (i * 2000),
        },
      }))
    })
    set({ selectedElement: toIdx })
  },

  /** Sort elements array chronologically by startMs and update selection index. */
  sortElementsByStartTime: () => {
    const { cfg, selectedElement } = get()
    if (!cfg?.elements?.length) return
    const activeElId = cfg.elements[selectedElement]?.id
    get()._mutateElements((els) => {
      return [...els].sort((a, b) => (a.reveal?.startMs ?? 0) - (b.reveal?.startMs ?? 0))
    })
    if (activeElId != null) {
      const newIdx = get().cfg?.elements?.findIndex(e => e.id === activeElId)
      if (newIdx !== undefined && newIdx !== -1) {
        set({ selectedElement: newIdx })
      }
    }
  },

  // ── Intelligent Subtitle Management ───────────────────────────────────────

  /** Link a specific SRT item to an annotation element with timecode sync. */
  linkSubtitleToElement: (elementIdx, srtItem) => {
    if (!srtItem) return
    get()._mutateElements((els) =>
      els.map((el, i) => {
        if (i !== elementIdx) return el
        const duration = Math.max(500, (srtItem.endMs || 0) - (srtItem.startMs || 0) || (el.reveal?.durationMs ?? 2000))
        return {
          ...el,
          subtitle: srtItem.content || '',
          reveal: {
            ...el.reveal,
            startMs: srtItem.startMs ?? el.reveal?.startMs ?? 0,
            durationMs: duration,
          },
        }
      })
    )
  },

  /** Auto-assign all SRT items sequentially to elements with duration sync. */
  autoLinkSubtitles: () => {
    const { cfg, srtItems } = get()
    if (!cfg?.elements || !srtItems.length) return 0
    let count = 0
    get()._mutateElements((els) =>
      els.map((el, i) => {
        if (i < srtItems.length) {
          const srt = srtItems[i]
          count++
          const duration = Math.max(500, (srt.endMs - srt.startMs) || 2000)
          return {
            ...el,
            subtitle: srt.content,
            reveal: {
              ...el.reveal,
              startMs: srt.startMs,
              durationMs: duration,
            },
          }
        }
        return el
      })
    )
    return count
  },

  /** Auto-align elements sequentially back-to-back with a specified pause duration (in ms). */
  alignElementsSequentially: (pauseMs = 300) => {
    const { cfg } = get()
    if (!cfg?.elements?.length) return
    get()._mutateElements((els) => {
      let currentMs = 0
      return els.map((el, i) => {
        const duration = el.reveal?.durationMs || 2000
        const startMs = currentMs
        currentMs = startMs + duration + pauseMs
        return {
          ...el,
          reveal: {
            ...el.reveal,
            startMs,
            durationMs: duration,
          },
        }
      })
    })
  },

  // ── Scene Loading ──────────────────────────────────────────────────────────────

  loadScene: (idx, scenesToLoad) => {
    const { scenes: storeScenes, srtItems } = get()
    const scenesArr = scenesToLoad || storeScenes
    if (idx < 0 || idx >= scenesArr.length) return

    set({ sceneIdx: idx, selectedElement: 0, past: [], future: [] })

    const sc = scenesArr[idx]
    const img = new Image()
    img.onload = () => {
      const W = img.naturalWidth
      const H = img.naturalHeight

      if (!sc.cfg) {
        sc.cfg = {
          sceneId: sc.name,
          canvas: { width: W, height: H },
          sceneDurationMs: 8000,
          elements: [{
            id: newElementId(),
            label: 'Zone principale',
            sequence: 1,
            narrativeRole: 'Élément par défaut',
            type: 'structure',
            subtitle: srtItems[0]?.content || '',
            region: { x: Math.round(W * 0.1), y: Math.round(H * 0.1), width: Math.round(W * 0.8), height: Math.round(H * 0.8) },
            reveal: { direction: 'top_to_bottom', startMs: 300, durationMs: 4000, maskPaddingPx: 22, protectedRegions: [] },
            handPath: {}
          }]
        }
      }
      sc.cfg = validateSceneConfig(sc.cfg)

      // Sample paper color from corners
      try {
        const t = document.createElement('canvas')
        t.width = W; t.height = H
        const tc = t.getContext('2d', { willReadFrequently: true })
        tc.drawImage(img, 0, 0)
        const pts = [[2,2],[W-3,2],[2,H-3],[W-3,H-3]]
        let r=0,g=0,b=0
        pts.forEach(([x,y]) => { const d=tc.getImageData(x,y,1,1).data; r+=d[0];g+=d[1];b+=d[2] })
        get().setPaperColor(`rgb(${Math.round(r/4)},${Math.round(g/4)},${Math.round(b/4)})`)
      } catch { get().setPaperColor('#fdf0d0') }

      set({ cfg: sc.cfg, source: img })
    }
    img.onerror = () => console.error('Failed to load image:', sc.imgUrl)
    img.src = sc.imgUrl
  },

  // ── Save ──────────────────────────────────────────────────────────────────────

  saveCurrentScene: async () => {
    const { cfg, sceneIdx, scenes } = get()
    if (!cfg || sceneIdx < 0) return { ok: false, msg: 'Aucune scène à sauvegarder' }

    const sc = scenes[sceneIdx]
    const json = JSON.stringify(cfg, null, 2)

    // Try File System API handle first
    if (sc.cfgHandle) {
      try {
        const w = await sc.cfgHandle.createWritable()
        await w.write(json)
        await w.close()
        const newDirty = new Set(get().dirty)
        newDirty.delete(sceneIdx)
        set({ dirty: newDirty })
        return { ok: true, msg: `💾 ${sc.cfgName} sauvegardé` }
      } catch (e) {
        return { ok: false, msg: 'Erreur d\'écriture : ' + e.message }
      }
    }

    // Fallback: try server API
    if (sc.jsonPath) {
      try {
        const resp = await fetch('/api/save_annotation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: sc.jsonPath, config: cfg })
        })
        if (resp.ok) {
          const newDirty = new Set(get().dirty)
          newDirty.delete(sceneIdx)
          set({ dirty: newDirty })
          return { ok: true, msg: `💾 ${sc.cfgName} sauvegardé sur le serveur` }
        }
      } catch (e) {}
    }

    // Final fallback: browser download
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = sc.cfgName || 'annotation.json'
    a.click()
    URL.revokeObjectURL(url)
    const newDirty = new Set(get().dirty)
    newDirty.delete(sceneIdx)
    set({ dirty: newDirty })
    return { ok: true, msg: `📥 ${sc.cfgName} téléchargé` }
  },

  // ── Dirty State Helpers ───────────────────────────────────────────────────────

  markDirty: () => {
    const { sceneIdx, dirty } = get()
    if (sceneIdx < 0) return
    const newDirty = new Set(dirty)
    newDirty.add(sceneIdx)
    set({ dirty: newDirty })
  },

  clearDirty: (idx) => {
    const { dirty } = get()
    const newDirty = new Set(dirty)
    newDirty.delete(idx ?? get().sceneIdx)
    set({ dirty: newDirty })
  },
}))

export default useWhiteboardStore
