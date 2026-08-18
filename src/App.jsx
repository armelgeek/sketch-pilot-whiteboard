import React, { useRef, useEffect, useState } from 'react'
import useWhiteboardStore from './store/useWhiteboardStore'
import Topbar from './components/Topbar'
import Canvas from './components/Canvas'
import LeftSidebar from './components/LeftSidebar'
import RightSidebar from './components/RightSidebar'
import SceneBar from './components/SceneBar'
import Toast from './components/Toast'
import { parseSRT } from './utils/srt'

const IMG_EXT = ['.png', '.jpg', '.jpeg']

function baseName(n) {
  const ext = IMG_EXT.find(e => n.toLowerCase().endsWith(e))
  return ext ? n.slice(0, -ext.length) : n
}

function pairedImageNames(names) {
  return names.filter(n => IMG_EXT.some(e => n.toLowerCase().endsWith(e))).sort()
}

import VideoExportModal from './components/VideoExportModal'
import SceneVideoPlayer from './components/SceneVideoPlayer'

export default function App() {
  const {
    scenes,
    sceneIdx,
    cfg,
    mode,
    viewMode,
    selectedElement,
    showOverlay,
    srtItems,
    dirty,
    past,
    future,
    setMode,
    setShowOverlay,
    setSelectedElement,
    setSrtItems,
    setScenes,
    loadScene,
    updateRegion,
    addElement,
    updateElement,
    deleteElement,
    duplicateElement,
    reorderElement,
    saveCurrentScene,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useWhiteboardStore()

  const [toastMsg, setToastMsg]   = useState('')
  const [toastType, setToastType] = useState('')
  const [showExportModal, setShowExportModal] = useState(false)
  const fileInputDir   = useRef()
  const fileInputSrt   = useRef()
  const fileInputFiles = useRef()

  const canFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  function toast(msg, isError = false) {
    setToastMsg(msg)
    setToastType(isError ? 'err' : 'info')
    setTimeout(() => setToastMsg(''), 3500)
  }

  // ── File loading helpers ─────────────────────────────────────────────────────

  async function loadPairs(names, getFile, getHandle) {
    const imgNames = pairedImageNames(names)
    const newScenes = []
    for (const inm of imgNames) {
      const base = baseName(inm)
      const cfgName = base + '.annotation.json'
      let cfg = null
      let cfgHandle = null
      if (names.includes(cfgName)) {
        try { cfg = JSON.parse(await (await getFile(cfgName)).text()) } catch (e) {
          toast(`Fichier ${cfgName} ignoré : erreur JSON`, true)
        }
        cfgHandle = getHandle(cfgName)
      }
      const url = URL.createObjectURL(await getFile(inm))
      newScenes.push({ name: base, imgName: inm, cfgName, cfg, cfgHandle, imgUrl: url, hasConfig: !!cfg })
    }
    if (!newScenes.length) { toast('Aucune image valide trouvée', true); return }
    setScenes(newScenes)
    useWhiteboardStore.getState().setCfgRaw(null)
    useWhiteboardStore.setState({ dirty: new Set(), past: [], future: [] })
    loadScene(0, newScenes)
    toast(`${newScenes.length} image(s) chargée(s)`)
  }

  async function openDir() {
    try {
      if (canFS) {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' })
        const handles = {}
        for await (const [name, h] of dir.entries()) {
          if (h.kind === 'file') handles[name] = h
        }
        await loadPairs(Object.keys(handles), n => handles[n].getFile(), n => handles[n])
      } else {
        fileInputDir.current?.click()
      }
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Erreur d\'ouverture : ' + e.message, true)
    }
  }

  function processDroppedFiles(files) {
    const srtFile = Array.from(files).find(f => f.name.toLowerCase().endsWith('.srt'))
    if (srtFile) {
      srtFile.text().then(txt => {
        const items = parseSRT(txt)
        setSrtItems(items)
        toast(`${items.length} sous-titre(s) chargé(s)`)
      })
    }
    const imgFiles = Array.from(files).filter(f => IMG_EXT.some(ext => f.name.toLowerCase().endsWith(ext)))
    const jsonFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.annotation.json'))
    if (imgFiles.length > 0) {
      Promise.all(imgFiles.map(async imgF => {
        const base = baseName(imgF.name)
        const matchedJson = jsonFiles.find(j => j.name === base + '.annotation.json')
        let cfg = null
        if (matchedJson) {
          try { cfg = JSON.parse(await matchedJson.text()) } catch {}
        }
        const url = URL.createObjectURL(imgF)
        return { name: base, imgName: imgF.name, cfgName: base + '.annotation.json', cfg, cfgHandle: null, imgUrl: url, hasConfig: !!cfg }
      })).then(newScenes => {
        setScenes(newScenes)
        useWhiteboardStore.setState({ dirty: new Set(), past: [], future: [] })
        loadScene(0, newScenes)
        toast(`${newScenes.length} image(s) chargée(s)`)
      })
    }
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const prevent = e => { e.preventDefault(); e.stopPropagation() }
    const handleDrop = e => { e.preventDefault(); e.stopPropagation(); processDroppedFiles(e.dataTransfer.files) }
    document.addEventListener('dragenter', prevent)
    document.addEventListener('dragover', prevent)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('dragenter', prevent)
      document.removeEventListener('dragover', prevent)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])

  // ── File input handlers ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!fileInputDir.current) return
    const h = async e => {
      const files = {}
      Array.from(e.target.files).forEach(f => (files[f.name] = f))
      await loadPairs(Object.keys(files), n => Promise.resolve(files[n]), () => null)
    }
    fileInputDir.current.addEventListener('change', h)
    return () => fileInputDir.current?.removeEventListener('change', h)
  }, [])

  useEffect(() => {
    if (!fileInputSrt.current) return
    const h = async e => {
      const file = e.target.files[0]
      if (file) {
        const text = await file.text()
        const items = parseSRT(text)
        setSrtItems(items)
        toast(`${items.length} sous-titres chargés depuis ${file.name}`)
      }
    }
    fileInputSrt.current.addEventListener('change', h)
    return () => fileInputSrt.current?.removeEventListener('change', h)
  }, [])

  // ── Keyboard shortcuts: Undo / Redo ───────────────────────────────────────────
  useEffect(() => {
    const handleKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (canUndo()) undo()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        if (canRedo()) redo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [past, future])

  // ── Auto-load from server on mount ────────────────────────────────────────────
  useEffect(() => {
    async function autoLoad() {
      try {
        const resp = await fetch('/api/scenes')
        if (!resp.ok) return
        const data = await resp.json()
        if (data?.scenes?.length > 0) {
          const serverScenes = await Promise.all(data.scenes.map(async s => {
            let cfg = null
            if (s.jsonPath) {
              try { const r = await fetch(s.jsonPath); if (r.ok) cfg = await r.json() } catch {}
            }
            return { name: s.name, imgName: s.name + '.png', cfgName: s.name + '.annotation.json',
              imgPath: s.imgPath, jsonPath: s.jsonPath, cfg, cfgHandle: null, imgUrl: s.imgPath, hasConfig: !!cfg }
          }))
          if (serverScenes.length > 0) {
            setScenes(serverScenes)
            useWhiteboardStore.setState({ dirty: new Set() })
            loadScene(0, serverScenes)
            toast(`🎉 ${serverScenes.length} scène(s) chargée(s) depuis le serveur`)
          }
        }
      } catch {}
    }
    autoLoad()
  }, [])

  // ── Save handler ──────────────────────────────────────────────────────────────
  async function handleSave() {
    const result = await saveCurrentScene()
    toast(result.msg, !result.ok)
  }

  const currentImgUrl = sceneIdx >= 0 && scenes[sceneIdx] ? scenes[sceneIdx].imgUrl : null

  return (
    <div style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 0, fontFamily: "'Inter', sans-serif" }}>
      <Topbar
        scenes={scenes}
        sceneIdx={sceneIdx}
        mode={mode}
        onSetMode={setMode}
        onOpenDir={openDir}
        onLoadSrt={() => fileInputSrt.current?.click()}
        onLoadFiles={() => fileInputFiles.current?.click()}
        onPrevScene={() => loadScene(sceneIdx - 1)}
        onNextScene={() => loadScene(sceneIdx + 1)}
        onSceneChange={idx => loadScene(idx)}
        showOverlay={showOverlay}
        onToggleOverlay={setShowOverlay}
        onSave={handleSave}
        onUndo={undo}
        onRedo={redo}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        dirty={dirty}
        onOpenExport={() => setShowExportModal(true)}
      />

      <div className="body flex-1 flex min-h-0 relative" id="mainBody">
        {/* Left Sidebar: Drawing Zones list & SRT */}
        {sceneIdx >= 0 && cfg && (
          <LeftSidebar
            cfg={cfg}
            selectedElement={selectedElement}
            onSelectElement={setSelectedElement}
            onUpdateElement={updateElement}
            onDeleteElement={deleteElement}
            onDuplicateElement={duplicateElement}
            onReorderElement={reorderElement}
            onAddElement={addElement}
            srtItems={srtItems}
            source={useWhiteboardStore.getState().source}
          />
        )}

        {/* Center: Canvas area & Bottom Scene bar */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          {!cfg ? (
            <div className="hint-panel" style={{ flex: 1, margin: 'auto' }}>
              <h2>👋 Bienvenue sur<br />SRT Whiteboard</h2>
              <p className="hint-subtitle">
                Glissez-déposez vos images et fichiers SRT directement dans cette fenêtre,
                ou ouvrez un dossier de scènes pour commencer.
              </p>
              <div className="hint-instructions">
                <b>📌 Guide rapide</b><br />
                1. <b>Glissez</b> vos images <code>.png</code> ou sous-titres <code>.srt</code> ici.<br />
                2. Passez en mode <b>✏️ Dessiner</b> pour tracer des zones sur l'image.<br />
                3. Ajustez les propriétés de chaque zone dans le panneau de droite.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button id="btn-hint-open-dir" onClick={openDir} className="btn-primary" style={{ padding: '9px 20px', fontSize: 13 }}>
                  📁 Choisir un dossier
                </button>
                <button id="btn-hint-load-srt" onClick={() => fileInputSrt.current?.click()} className="btn-ghost" style={{ padding: '9px 20px', fontSize: 13 }}>
                  📜 Charger un SRT
                </button>
              </div>
            </div>
          ) : viewMode === 'video' ? (
            <SceneVideoPlayer />
          ) : (
            <Canvas
              cfg={cfg}
              imgUrl={currentImgUrl}
              selectedElement={selectedElement}
              onSelectElement={setSelectedElement}
              onAddElement={addElement}
              onUpdateElement={(idx, patch) => updateRegion(idx, patch)}
              onDeleteElement={deleteElement}
              showOverlay={showOverlay}
              mode={mode}
            />
          )}

          {/* Bottom Scene Bar & Bande Rythmo */}
          {scenes.length > 0 && (
            <SceneBar
              scenes={scenes}
              sceneIdx={sceneIdx}
              onSceneChange={idx => loadScene(idx)}
              dirty={dirty}
              cfg={cfg}
              selectedElement={selectedElement}
              onSelectElement={setSelectedElement}
              onUpdateElement={updateElement}
            />
          )}
        </div>

        {/* Right Sidebar: Property Inspector */}
        {sceneIdx >= 0 && cfg && (
          <RightSidebar
            cfg={cfg}
            selectedElement={selectedElement}
            onUpdateElement={updateElement}
            onUpdateRegion={updateRegion}
            srtItems={srtItems}
          />
        )}
      </div>

      {showExportModal && (
        <VideoExportModal
          scenes={scenes}
          sceneIdx={sceneIdx}
          onClose={() => setShowExportModal(false)}
          onToast={msg => toast(msg)}
        />
      )}

      <Toast msg={toastMsg} type={toastType} />

      <input ref={fileInputDir}   type="file" webkitdirectory="true" multiple hidden />
      <input ref={fileInputSrt}   type="file" accept=".srt"                   hidden />
      <input ref={fileInputFiles} type="file" accept=".png,.jpg,.jpeg,.json,.srt" multiple hidden />
    </div>
  )
}
