import { useRef, useState, useCallback, useEffect } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from 'react-konva'
import useImage from 'use-image'

const MIN_RECT_SIZE = 5 // px minimum pour valider un rectangle

/**
 * Convertit des coordonnées canvas (pixels affichés) vers les coordonnées
 * réelles du document (cfg.canvas.width × cfg.canvas.height).
 */
function toReal(val, scale) {
  return Math.round(val / scale)
}

/**
 * Clamp une valeur entre min et max.
 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

export default function AnnotationCanvas({
  cfg,
  imgUrl,
  selectedElement,
  onSelectElement,
  onAddElement,
  onUpdateElement,
  containerWidth = 800,
  containerHeight = 600,
}) {
  const [image, imageStatus] = useImage(imgUrl || '', 'anonymous')

  // Dimensions affichées du stage (fit dans le conteneur en conservant l'aspect ratio)
  const realW = cfg?.canvas?.width || 1
  const realH = cfg?.canvas?.height || 1
  const ratio = Math.min(containerWidth / realW, containerHeight / realH, 1)
  const stageW = Math.round(realW * ratio)
  const stageH = Math.round(realH * ratio)
  const scaleX = stageW / realW
  const scaleY = stageH / realH

  // State dessin interactif
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawRect, setDrawRect] = useState(null) // { x, y, width, height } en px stage
  const startPos = useRef(null)

  const stageRef = useRef()
  const transformerRef = useRef()
  const rectRefs = useRef({}) // map index -> Konva.Rect node

  const elements = cfg?.elements || []

  // Synchronise le Transformer avec la zone sélectionnée
  useEffect(() => {
    if (!transformerRef.current) return
    const node = rectRefs.current[selectedElement]
    if (node) {
      transformerRef.current.nodes([node])
      transformerRef.current.getLayer()?.batchDraw()
    } else {
      transformerRef.current.nodes([])
    }
  }, [selectedElement, elements.length])

  // ── Handlers dessin ──────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e) => {
    // Clic sur le fond du stage => démarrer le dessin
    const clickedOnStage = e.target === e.target.getStage()
    if (!clickedOnStage) return

    const pos = e.target.getStage().getPointerPosition()
    startPos.current = pos
    setIsDrawing(true)
    setDrawRect({ x: pos.x, y: pos.y, width: 0, height: 0 })
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!isDrawing || !startPos.current) return
    const pos = e.target.getStage().getPointerPosition()
    const x = Math.min(pos.x, startPos.current.x)
    const y = Math.min(pos.y, startPos.current.y)
    const width = Math.abs(pos.x - startPos.current.x)
    const height = Math.abs(pos.y - startPos.current.y)
    setDrawRect({ x, y, width, height })
  }, [isDrawing])

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return
    setIsDrawing(false)

    if (
      drawRect &&
      drawRect.width > MIN_RECT_SIZE &&
      drawRect.height > MIN_RECT_SIZE
    ) {
      // Clamp dans les limites du canvas réel
      const rx = clamp(toReal(drawRect.x, scaleX), 0, realW)
      const ry = clamp(toReal(drawRect.y, scaleY), 0, realH)
      const rw = clamp(toReal(drawRect.width, scaleX), 1, realW - rx)
      const rh = clamp(toReal(drawRect.height, scaleY), 1, realH - ry)

      onAddElement?.({
        id: `region_${Date.now()}`,
        label: 'Nouvelle zone',
        type: 'structure',
        region: { x: rx, y: ry, width: rw, height: rh },
        reveal: { direction: 'top_to_bottom', startMs: 0, durationMs: 2000, protectedRegions: [] },
        handPath: {}
      })
    }

    setDrawRect(null)
    startPos.current = null
  }, [isDrawing, drawRect, scaleX, scaleY, realW, realH, onAddElement])

  // Clic sur une zone existante → sélection
  const handleRectClick = useCallback((i, e) => {
    e.cancelBubble = true
    onSelectElement?.(i)
  }, [onSelectElement])

  // Drag-end d'une zone → mise à jour des coordonnées réelles
  const handleDragEnd = useCallback((i, e) => {
    const node = e.target
    const newX = clamp(toReal(node.x(), scaleX), 0, realW - toReal(node.width(), scaleX))
    const newY = clamp(toReal(node.y(), scaleY), 0, realH - toReal(node.height(), scaleY))
    node.position({ x: newX * scaleX, y: newY * scaleY }) // reposez le node sur la grille réelle
    onUpdateElement?.(i, { x: newX, y: newY })
  }, [scaleX, scaleY, realW, realH, onUpdateElement])

  // Transformer resize-end → mise à jour de la région
  const handleTransformEnd = useCallback((i, e) => {
    const node = e.target
    const scKx = node.scaleX()
    const scKy = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)

    const newX = clamp(toReal(node.x(), scaleX), 0, realW)
    const newY = clamp(toReal(node.y(), scaleY), 0, realH)
    const newW = clamp(Math.round(node.width() * scKx / scaleX), 1, realW - newX)
    const newH = clamp(Math.round(node.height() * scKy / scaleY), 1, realH - newY)

    onUpdateElement?.(i, { x: newX, y: newY, width: newW, height: newH })
  }, [scaleX, scaleY, realW, realH, onUpdateElement])

  // ── Couleurs de zones ─────────────────────────────────────────────────────────

  const TYPE_STROKE = {
    structure: '#f5a623',
    character: '#3b82f6',
    effect: '#a855f7',
    text: '#10b981'
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const isLoading = imageStatus === 'loading'

  return (
    <div
      style={{
        display: 'inline-block',
        position: 'relative',
        background: '#0b0c0e',
        borderRadius: 8,
        boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        cursor: isDrawing ? 'crosshair' : 'default',
      }}
    >
      {isLoading && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#8b929c', fontSize: 13, zIndex: 10, background: '#0b0c0e'
          }}
        >
          Chargement de l'image…
        </div>
      )}

      <Stage
        ref={stageRef}
        width={stageW}
        height={stageH}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
      >
        {/* Couche image de fond */}
        <Layer>
          {image && (
            <KonvaImage
              image={image}
              width={stageW}
              height={stageH}
              listening={false}
            />
          )}
        </Layer>

        {/* Couche zones / annotations */}
        <Layer>
          {elements.map((el, i) => {
            const r = el.region
            if (!r) return null
            const isSelected = i === selectedElement
            const stroke = TYPE_STROKE[el.type] || '#f5a623'

            return (
              <Rect
                key={el.id || i}
                ref={node => { if (node) rectRefs.current[i] = node; else delete rectRefs.current[i] }}
                x={r.x * scaleX}
                y={r.y * scaleY}
                width={r.width * scaleX}
                height={r.height * scaleY}
                stroke={stroke}
                strokeWidth={isSelected ? 2.5 : 1.5}
                fill={isSelected ? `${stroke}22` : `${stroke}0a`}
                cornerRadius={2}
                draggable={isSelected}
                onClick={(e) => handleRectClick(i, e)}
                onTap={(e) => handleRectClick(i, e)}
                onDragEnd={(e) => handleDragEnd(i, e)}
                onTransformEnd={(e) => handleTransformEnd(i, e)}
              />
            )
          })}

          {/* Rectangle de dessin en cours */}
          {isDrawing && drawRect && (
            <Rect
              x={drawRect.x}
              y={drawRect.y}
              width={drawRect.width}
              height={drawRect.height}
              stroke="#60a5fa"
              strokeWidth={2}
              fill="rgba(96,165,250,0.12)"
              dash={[6, 3]}
              listening={false}
            />
          )}

          {/* Transformer sur la zone sélectionnée */}
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            flipEnabled={false}
            keepRatio={false}
            boundBoxFunc={(oldBox, newBox) => {
              // Empêche les dimensions négatives
              if (newBox.width < 10 || newBox.height < 10) return oldBox
              return newBox
            }}
            borderStroke="#f5a623"
            borderStrokeWidth={1.5}
            anchorStroke="#f5a623"
            anchorFill="#1a1d24"
            anchorSize={9}
            anchorCornerRadius={2}
          />
        </Layer>
      </Stage>

      {/* Légende mode */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        fontSize: 11, color: '#8b929c',
        background: 'rgba(0,0,0,0.6)',
        padding: '3px 8px', borderRadius: 4,
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        ✏️ Glissez pour tracer · Cliquez une zone pour la sélectionner / déplacer / redimensionner
      </div>
    </div>
  )
}
