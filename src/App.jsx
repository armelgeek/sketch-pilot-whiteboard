import React, { useState, useRef, useEffect } from 'react'
import Topbar from './components/Topbar'
import Canvas from './components/Canvas'
import Sidebar from './components/Sidebar'
import Controls from './components/Controls'
import Toast from './components/Toast'
import { parseSRT } from './utils/srt'

const IMG_EXT = ['.png', '.jpg', '.jpeg'];

function baseName(n) {
  const ext = IMG_EXT.find(e => n.toLowerCase().endsWith(e));
  return ext ? n.slice(0, -ext.length) : n;
}

function pairedImageNames(names) {
  return names.filter(n => IMG_EXT.some(e => n.toLowerCase().endsWith(e))).sort();
}

export default function App() {
  // State
  const [scenes, setScenes] = useState([]);
  const [sceneIdx, setSceneIdx] = useState(-1);
  const [cfg, setCfg] = useState(null);
  const [mode, setMode] = useState('select'); // 'select' | 'draw'
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [srtItems, setSrtItems] = useState([]);
  const [selectedElement, setSelectedElement] = useState(0);
  const [showOverlay, setShowOverlay] = useState(true);
  const [source, setSource] = useState(null);
  const [paperColor, setPaperColor] = useState('#fdf0d0');
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState('');
  const [dirty, setDirty] = useState(new Set());
  const [hideHint, setHideHint] = useState(false);
  const fileInputDir = useRef();
  const fileInputSrt = useRef();
  const fileInputFiles = useRef();
  const renderCaches = useRef(null);

  const canFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  function toast(msg, isError = false) {
    setToastMsg(msg);
    setToastType(isError ? 'err' : 'info');
    setTimeout(() => setToastMsg(''), 3000);
  }

  function els() {
    return cfg ? cfg.elements : [];
  }

  async function loadPairs(names, getFile, getHandle) {
    const imgNames = pairedImageNames(names);
    const newScenes = [];
    for (const inm of imgNames) {
      const base = baseName(inm);
      const cfgName = base + '.annotation.json';
      let cfg = null;
      let cfgHandle = null;
      if (names.includes(cfgName)) {
        try {
          cfg = JSON.parse(await (await getFile(cfgName)).text());
        } catch (e) {
          toast(`Fichier ${cfgName} ignoré : erreur JSON`, true);
        }
        cfgHandle = getHandle(cfgName);
      }
      const url = URL.createObjectURL(await getFile(inm));
      newScenes.push({
        name: base,
        imgName: inm,
        cfgName,
        cfg,
        cfgHandle,
        imgUrl: url,
        hasConfig: !!cfg
      });
    }
    if (!newScenes.length) {
      toast('Aucune image valide trouvée', true);
      return;
    }
    setScenes(newScenes);
    setDirty(new Set());
    loadScene(0, newScenes);
  }

  async function openDir() {
    try {
      if (canFS) {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        const handles = {};
        for await (const [name, h] of dir.entries()) {
          if (h.kind === 'file') handles[name] = h;
        }
        await loadPairs(Object.keys(handles), n => handles[n].getFile(), n => handles[n]);
      } else {
        fileInputDir.current?.click();
      }
    } catch (e) {
      if (e && e.name !== 'AbortError') {
        toast('Échec de l\'ouverture du dossier : ' + e.message, true);
      }
    }
  }

  function processDroppedFiles(files) {
    const srtFile = Array.from(files).find(f => f.name.toLowerCase().endsWith('.srt'));
    if (srtFile) {
      srtFile.text().then(txt => {
        const items = parseSRT(txt);
        setSrtItems(items);
        toast(`${items.length} sous-titre(s) chargé(s) depuis ${srtFile.name}`);
      });
    }
    const imgFiles = Array.from(files).filter(f => IMG_EXT.some(ext => f.name.toLowerCase().endsWith(ext)));
    const jsonFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.annotation.json'));
    if (imgFiles.length > 0) {
      const newScenes = [];
      Promise.all(imgFiles.map(async imgF => {
        const base = baseName(imgF.name);
        const matchedJson = jsonFiles.find(j => j.name === base + '.annotation.json');
        let cfg = null;
        if (matchedJson) {
          try {
            cfg = JSON.parse(await matchedJson.text());
          } catch (err) {}
        }
        const url = URL.createObjectURL(imgF);
        newScenes.push({
          name: base,
          imgName: imgF.name,
          cfgName: base + '.annotation.json',
          cfg: cfg,
          cfgHandle: null,
          imgUrl: url,
          hasConfig: !!cfg
        });
        if (newScenes.length === imgFiles.length) {
          setScenes(newScenes);
          loadScene(0, newScenes);
          toast(`${newScenes.length} image(s) chargée(s) dans le workbench !`);
        }
      }));
    }
  }

  function loadScene(idx, scenesToLoad = scenes) {
    if (idx < 0 || idx >= scenesToLoad.length) return;
    setIsPlaying(false);
    setSceneIdx(idx);
    setSelectedElement(0);
    setTime(0);

    const sc = scenesToLoad[idx];
    const img = new Image();
    img.onload = () => {
      setSource(img);
      const W = img.naturalWidth;
      const H = img.naturalHeight;

      if (!sc.cfg) {
        sc.cfg = {
          sceneId: sc.name,
          canvas: { width: W, height: H },
          sceneDurationMs: 8000,
          elements: [
            {
              id: 'region_1',
              label: 'Zone principale',
              sequence: 1,
              narrativeRole: 'Élément par défaut',
              type: 'structure',
              subtitle: srtItems[0] ? srtItems[0].content : '',
              region: { x: Math.round(W * 0.1), y: Math.round(H * 0.1), width: Math.round(W * 0.8), height: Math.round(H * 0.8) },
              reveal: { direction: 'top_to_bottom', startMs: 300, durationMs: 4000, maskPaddingPx: 22, protectedRegions: [] },
              handPath: {}
            }
          ]
        };
      }

      if (!sc.cfg.canvas || !sc.cfg.canvas.width) {
        sc.cfg.canvas = { width: W, height: H };
      }
      if (!Array.isArray(sc.cfg.elements)) {
        sc.cfg.elements = [];
      }

      setCfg(sc.cfg);
      samplePaper(img);
    };
    img.onerror = () => toast('Échec du chargement de l\'image : ' + sc.imgName, true);
    img.src = sc.imgUrl;
  }

  function samplePaper(img) {
    try {
      const t = document.createElement('canvas');
      t.width = img.naturalWidth;
      t.height = img.naturalHeight;
      const tc = t.getContext('2d');
      tc.drawImage(img, 0, 0);
      const w = t.width;
      const h = t.height;
      const pts = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]];
      let r = 0, g = 0, b = 0;
      pts.forEach(([x, y]) => {
        const d = tc.getImageData(x, y, 1, 1).data;
        r += d[0];
        g += d[1];
        b += d[2];
      });
      const color = `rgb(${Math.round(r / 4)},${Math.round(g / 4)},${Math.round(b / 4)})`;
      setPaperColor(color);
    } catch (e) {
      setPaperColor('#fdf0d0');
    }
  }

  // Drag and drop
  useEffect(() => {
    const handleDragEnter = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleDragOver = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleDrop = e => {
      e.preventDefault();
      e.stopPropagation();
      processDroppedFiles(e.dataTransfer.files);
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [srtItems]);

  // File input handlers
  useEffect(() => {
    if (!fileInputDir.current) return;
    fileInputDir.current.addEventListener('change', async e => {
      const files = {};
      Array.from(e.target.files).forEach(f => (files[f.name] = f));
      await loadPairs(Object.keys(files), n => Promise.resolve(files[n]), () => null);
    });
  }, []);

  useEffect(() => {
    if (!fileInputSrt.current) return;
    fileInputSrt.current.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) {
        const text = await file.text();
        const items = parseSRT(text);
        setSrtItems(items);
        toast(`${items.length} sous-titres chargés avec succès depuis le fichier SRT !`);
      }
    });
  }, []);

  // Auto-load server scenes on mount
  useEffect(() => {
    async function autoLoadServerScenes() {
      try {
        const resp = await fetch('/api/scenes');
        if (!resp.ok) return;
        const data = await resp.json();
        if (data?.scenes?.length > 0) {
          const serverScenes = await Promise.all(
            data.scenes.map(async s => {
              let cfg = null;
              if (s.jsonPath) {
                try {
                  const r = await fetch(s.jsonPath);
                  if (r.ok) cfg = await r.json();
                } catch (e) {}
              }
              return {
                name: s.name,
                imgName: s.name + '.png',
                cfgName: s.name + '.annotation.json',
                imgPath: s.imgPath,
                jsonPath: s.jsonPath,
                cfg: cfg,
                cfgHandle: null,
                imgUrl: s.imgPath,
                hasConfig: !!cfg
              };
            })
          );
          if (serverScenes.length > 0) {
            setScenes(serverScenes);
            setDirty(new Set());
            loadScene(0, serverScenes);
            toast(`🎉 ${serverScenes.length} scène(s) chargée(s) depuis le serveur Python local !`);
          }
        }
      } catch (e) {}
    }
    autoLoadServerScenes();
  }, []);

  return (
    <div className="bg-[#0f1115] text-[#e6e8ec] font-sans h-screen flex flex-col overflow-hidden m-0">
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
        onAddZone={() => {
          if (cfg) {
            const newEl = {
              id: `region_${Date.now()}`,
              label: 'Nouvelle zone',
              type: 'structure',
              region: { x: 100, y: 100, width: 200, height: 200 },
              reveal: { direction: 'top_to_bottom', startMs: 0, durationMs: 2000, protectedRegions: [] },
              handPath: {}
            };
            setCfg({ ...cfg, elements: [...cfg.elements, newEl] });
          }
        }}
        dirty={dirty}
      />

      <div className="body flex-1 flex min-h-0 relative" id="mainBody">
        <Canvas
          cfg={cfg}
          source={source}
          time={time}
          isPlaying={isPlaying}
          paperColor={paperColor}
          showOverlay={showOverlay}
          renderCaches={renderCaches}
          hideHint={hideHint}
          onOpenDir={openDir}
          onLoadSrt={() => fileInputSrt.current?.click()}
          mode={mode}
          selectedElement={selectedElement}
          scenes={scenes}
          sceneIdx={sceneIdx}
        />

        {sceneIdx >= 0 && cfg && (
          <Sidebar
            cfg={cfg}
            setCfg={setCfg}
            selectedElement={selectedElement}
            onSelectElement={setSelectedElement}
            srtItems={srtItems}
            source={source}
          />
        )}
      </div>

      <Controls time={time} onTimeChange={setTime} isPlaying={isPlaying} onPlayChange={setIsPlaying} cfg={cfg} />

      <Toast msg={toastMsg} type={toastType} />

      <input ref={fileInputDir} type="file" webkitDirectory multiple hidden />
      <input ref={fileInputSrt} type="file" accept=".srt" hidden />
      <input ref={fileInputFiles} type="file" accept=".png,.jpg,.jpeg,.json,.srt" multiple hidden />
    </div>
  );
}
