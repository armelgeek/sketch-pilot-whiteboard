import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Group, Text, Transformer, Circle, Line } from 'react-konva'
import useImage from 'use-image'
import CanvasRuler from './CanvasRuler'
import { ZONE_COLORS, colorForIndex, toReal, clamp, getHandPathStageCoords } from '../utils/canvas-geometry'

// ── Constants ──────────────────────────────────────────────────────────────

/** Minimum size (in stage px) below which a drawn rectangle is discarded. */
const MIN_RECT_SIZE = 5
/** Minimum size (in real/scene px) a resized element is allowed to shrink to. */
const MIN_ELEMENT_SIZE = 10

const LABEL_BADGE_HEIGHT = 16
const LABEL_BADGE_PADDING_X = 12
const LABEL_FONT_SIZE = 9
const LABEL_CHAR_WIDTH = 5.5 // rough average glyph width for the label font, in px
const LABEL_MIN_WIDTH = 50

const ORDER_OVERLAY_OPACITY = 0.4
const SELECTED_FILL_OPACITY = '26' // hex alpha, ~15%
const IDLE_FILL_OPACITY = '0d' // hex alpha, ~5%

const FONT_FAMILY = 'Inter, sans-serif'

/**
 * AnnotationCanvas
 *
 * Interactive editor for placing, moving and resizing labeled "reveal" zones
 * on top of a reference image — used to author the region/handPath data for
 * a Golpo scene config (see moteur-video-doodle-histoire).
 *
 * @param {object}   cfg               Scene config: { canvas: {width,height}, elements: [] }.
 * @param {string}   imgUrl            Reference image to annotate.
 * @param {number}   selectedElement   Index of the currently selected element, or -1/undefined.
 * @param {(i:number)=>void}            onSelectElement
 * @param {(el:object)=>void}           onAddElement     Called with a freshly drawn element.
 * @param {(i:number, patch:object)=>void} onUpdateElement Called with a partial region patch.
 * @param {(i:number)=>void}            [onDeleteElement] Optional — enables Delete/Backspace on the selection.
 * @param {number}   [containerWidth=800]
 * @param {number}   [containerHeight=600]
 */
export default function AnnotationCanvas({
  cfg,
  imgUrl,
  selectedElement,
  onSelectElement,
  onAddElement,
  onUpdateElement,
  onDeleteElement,
  // containerWidth / containerHeight are ignored — we measure the wrapper ourselves
}) {
  const [image, imageStatus] = useImage(imgUrl || '', 'anonymous')
  const containerRef = useRef()
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 })

  // Measure available space via ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) setContainerSize({ w: Math.floor(width), h: Math.floor(height) })
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const containerWidth  = containerSize.w
  const containerHeight = containerSize.h

  const realW = cfg?.canvas?.width || 1
  const realH = cfg?.canvas?.height || 1

  // Fit the scene inside the available container without upscaling past 1:1.
  const ratio = Math.min(containerWidth / realW, containerHeight / realH, 1)
  const stageW = Math.round(realW * ratio)
  const stageH = Math.round(realH * ratio)
  const scaleX = stageW / realW
  const scaleY = stageH / realH

  const [isDrawing, setIsDrawing] = useState(false)
  const [drawRect, setDrawRect] = useState(null)

  const startPos = useRef(null)
  const stageRef = useRef()
  const transformerRef = useRef()
  const rectRefs = useRef({})
  const labelRefs = useRef({})
  const overlayTextRefs = useRef({})

  const elements = cfg?.elements || []
  const hasSelection = selectedElement != null && selectedElement >= 0 && selectedElement < elements.length

  // ── Live drag/transform sync for the label badge + order overlay ─────────

  const handleDragMove = useCallback((index, event) => {
    const node = event.target
    const label = labelRefs.current[index]
    if (label) {
      label.position({ x: node.x() + 3, y: node.y() + 3 })
    }
    const overlay = overlayTextRefs.current[index]
    if (overlay) {
      overlay.position({ x: node.x(), y: node.y() })
    }
    node.getLayer()?.batchDraw()
  }, [])

  const handleTransform = useCallback((index, event) => {
    const node = event.target
    const label = labelRefs.current[index]
    if (label) {
      label.position({ x: node.x() + 3, y: node.y() + 3 })
    }
    const overlay = overlayTextRefs.current[index]
    if (overlay) {
      const w = node.width() * node.scaleX()
      const h = node.height() * node.scaleY()
      overlay.position({ x: node.x(), y: node.y() })
      overlay.width(w)
      overlay.height(h)
      overlay.fontSize(Math.min(w, h) * 0.5)
    }
    node.getLayer()?.batchDraw()
  }, [])

  // Keep the Transformer bound to whichever rect is currently selected.
  useEffect(() => {
    if (!transformerRef.current) return
    const node = hasSelection ? rectRefs.current[selectedElement] : null
    transformerRef.current.nodes(node ? [node] : [])
    transformerRef.current.getLayer()?.batchDraw()
  }, [selectedElement, hasSelection, elements.length])

  // ── Drawing a new zone (click-drag on empty canvas) ───────────────────────

  const handleMouseDown = useCallback((event) => {
    // Only start a fresh rect when clicking the stage itself, not an existing shape.
    if (event.target !== event.target.getStage()) return
    const pos = event.target.getStage().getPointerPosition()
    if (!pos) return
    startPos.current = pos
    setIsDrawing(true)
    setDrawRect({ x: pos.x, y: pos.y, width: 0, height: 0 })
  }, [])

  const handleMouseMove = useCallback((event) => {
    if (!isDrawing || !startPos.current) return
    const pos = event.target.getStage().getPointerPosition()
    if (!pos) return
    setDrawRect({
      x: Math.min(pos.x, startPos.current.x),
      y: Math.min(pos.y, startPos.current.y),
      width: Math.abs(pos.x - startPos.current.x),
      height: Math.abs(pos.y - startPos.current.y),
    })
  }, [isDrawing])

  const cancelDraw = useCallback(() => {
    setIsDrawing(false)
    setDrawRect(null)
    startPos.current = null
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return

    if (drawRect && drawRect.width > MIN_RECT_SIZE && drawRect.height > MIN_RECT_SIZE) {
      const x = clamp(toReal(drawRect.x, scaleX), 0, realW)
      const y = clamp(toReal(drawRect.y, scaleY), 0, realH)
      const width = clamp(toReal(drawRect.width, scaleX), 1, realW - x)
      const height = clamp(toReal(drawRect.height, scaleY), 1, realH - y)

      onAddElement?.({
        id: `region_${Date.now()}`,
        label: 'Nouvelle zone',
        type: 'structure',
        region: { x, y, width, height },
        reveal: { direction: 'top_to_bottom', startMs: 0, durationMs: 2000, protectedRegions: [] },
        handPath: {},
      })
    }

    cancelDraw()
  }, [isDrawing, drawRect, scaleX, scaleY, realW, realH, onAddElement, cancelDraw])

  // ── Selecting, moving and resizing existing zones ─────────────────────────

  const handleRectClick = useCallback((index, event) => {
    event.cancelBubble = true
    onSelectElement?.(index)
  }, [onSelectElement])

  const handleDragEnd = useCallback((index, event) => {
    const node = event.target
    const newX = clamp(toReal(node.x(), scaleX), 0, realW - toReal(node.width(), scaleX))
    const newY = clamp(toReal(node.y(), scaleY), 0, realH - toReal(node.height(), scaleY))
    node.position({ x: newX * scaleX, y: newY * scaleY })
    onUpdateElement?.(index, { x: newX, y: newY })
  }, [scaleX, scaleY, realW, realH, onUpdateElement])

  const handleTransformEnd = useCallback((index, event) => {
    const node = event.target
    const scaleXApplied = node.scaleX()
    const scaleYApplied = node.scaleY()
    // Konva encodes resize as a scale transform on the node — bake it back
    // into width/height and reset the scale so future drags stay 1:1.
    node.scaleX(1)
    node.scaleY(1)

    const newX = clamp(toReal(node.x(), scaleX), 0, realW)
    const newY = clamp(toReal(node.y(), scaleY), 0, realH)
    const newWidth = clamp(Math.round((node.width() * scaleXApplied) / scaleX), MIN_ELEMENT_SIZE, realW - newX)
    const newHeight = clamp(Math.round((node.height() * scaleYApplied) / scaleY), MIN_ELEMENT_SIZE, realH - newY)

    onUpdateElement?.(index, { x: newX, y: newY, width: newWidth, height: newHeight })
  }, [scaleX, scaleY, realW, realH, onUpdateElement])

  // ── Keyboard shortcuts: Delete selection, Escape cancels an in-progress draw ─

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && isDrawing) {
        cancelDraw()
        return
      }
      const isDeleteKey = event.key === 'Delete' || event.key === 'Backspace'
      if (isDeleteKey && hasSelection && onDeleteElement) {
        // Avoid hijacking Backspace while the user is typing in a form field elsewhere on the page.
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return
        event.preventDefault()
        onDeleteElement(selectedElement)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDrawing, cancelDraw, hasSelection, onDeleteElement, selectedElement])

  const [mousePos, setMousePos] = useState(null)
  const selectedRegion = hasSelection ? elements[selectedElement]?.region : null

  const isLoading = imageStatus === 'loading'
  const hasImageError = imageStatus === 'failed'

  return (
    <div
      ref={containerRef}
      className="annotation-wrap"
      style={{ cursor: isDrawing ? 'crosshair' : 'default' }}
      onMouseMove={(e) => {
        if (!stageRef.current) return
        const pos = stageRef.current.getPointerPosition()
        if (pos) {
          setMousePos({
            x: clamp(toReal(pos.x, scaleX), 0, realW),
            y: clamp(toReal(pos.y, scaleY), 0, realH),
          })
        }
      }}
    >
      {isLoading && (
        <div className="annotation-overlay" role="status" aria-live="polite">
          <span className="annotation-overlay__spinner" aria-hidden="true" />
          Chargement de l'image…
        </div>
      )}

      {hasImageError && (
        <div className="annotation-overlay annotation-overlay--error" role="alert">
          Impossible de charger l'image de référence.
        </div>
      )}

      <CanvasRuler
        realW={realW}
        realH={realH}
        stageW={stageW}
        stageH={stageH}
        selectedRegion={selectedRegion}
        selectedElementIndex={selectedElement}
        mousePos={mousePos}
      >
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
          {/* Reference image */}
          <Layer>
            {image && <KonvaImage image={image} width={stageW} height={stageH} listening={false} />}
          </Layer>

          {/* Zones */}
          <Layer>
            {elements.map((el, i) => {
              const region = el.region
              if (!region) return null

              const isSelected = i === selectedElement
              const color = colorForIndex(i)
              const fill = color + (isSelected ? SELECTED_FILL_OPACITY : IDLE_FILL_OPACITY)

              const labelText = `#${i + 1} · ${el.label || 'Zone'}`
              const badgeWidth = Math.max(LABEL_MIN_WIDTH, labelText.length * LABEL_CHAR_WIDTH + LABEL_BADGE_PADDING_X)

              const rectX = region.x * scaleX
              const rectY = region.y * scaleY
              const rectWidth = region.width * scaleX
              const rectHeight = region.height * scaleY

              return (
                <Group key={el.id || i}>
                  <Rect
                    ref={(node) => {
                      if (node) rectRefs.current[i] = node
                      else delete rectRefs.current[i]
                    }}
                    x={rectX}
                    y={rectY}
                    width={rectWidth}
                    height={rectHeight}
                    stroke={color}
                    strokeWidth={isSelected ? 2 : 1.2}
                    fill={fill}
                    cornerRadius={3}
                    shadowColor={isSelected ? color : undefined}
                    shadowBlur={isSelected ? 10 : 0}
                    shadowOpacity={0.4}
                    draggable={isSelected}
                    onClick={(e) => handleRectClick(i, e)}
                    onTap={(e) => handleRectClick(i, e)}
                    onDragMove={(e) => handleDragMove(i, e)}
                    onDragEnd={(e) => handleDragEnd(i, e)}
                    onTransform={(e) => handleTransform(i, e)}
                    onTransformEnd={(e) => handleTransformEnd(i, e)}
                  />

                  {/* Large translucent order number, shown only while selected */}
                  {isSelected && (
                    <Text
                      ref={(node) => {
                        if (node) overlayTextRefs.current[i] = node
                        else delete overlayTextRefs.current[i]
                      }}
                      text={String(i + 1)}
                      x={rectX}
                      y={rectY}
                      width={rectWidth}
                      height={rectHeight}
                      fontSize={Math.min(rectWidth, rectHeight) * 0.5}
                      fontFamily={FONT_FAMILY}
                      fontStyle="bold"
                      fill={color}
                      opacity={ORDER_OVERLAY_OPACITY}
                      align="center"
                      verticalAlign="middle"
                      listening={false}
                      shadowColor="#000000"
                      shadowBlur={6}
                      shadowOffset={{ x: 1, y: 1 }}
                      shadowOpacity={0.6}
                    />
                  )}

                  {/* Label badge, top-left of the zone */}
                  <Group
                    ref={(node) => {
                      if (node) labelRefs.current[i] = node
                      else delete labelRefs.current[i]
                    }}
                    x={rectX + 3}
                    y={rectY + 3}
                    listening={false}
                  >
                    <Rect
                      width={badgeWidth}
                      height={LABEL_BADGE_HEIGHT}
                      fill="rgba(15, 23, 42, 0.9)"
                      stroke={color}
                      strokeWidth={1}
                      cornerRadius={2}
                      shadowColor="#000"
                      shadowBlur={4}
                      shadowOpacity={0.4}
                    />
                    <Text
                      text={labelText}
                      x={6}
                      y={3.5}
                      fontSize={LABEL_FONT_SIZE}
                      fontFamily={FONT_FAMILY}
                      fontStyle="bold"
                      fill="#ffffff"
                    />
                  </Group>
                </Group>
              )
            })}

            {/* Rectangle currently being drawn */}
            {isDrawing && drawRect && (
              <Rect
                x={drawRect.x}
                y={drawRect.y}
                width={drawRect.width}
                height={drawRect.height}
                stroke="#60a5fa"
                strokeWidth={1.5}
                fill="rgba(96,165,250,0.1)"
                dash={[5, 3]}
                listening={false}
                cornerRadius={3}
              />
            )}

            {/* Trajectoire de la main interactive (Poignées S/E) */}
            {hasSelection && (() => {
              const selectedEl = elements[selectedElement]
              const coords = getHandPathStageCoords(selectedEl, scaleX, scaleY)
              if (!coords) return null

              return (
                <Group key={`handpath-${selectedElement}`}>
                  {/* Start handle (S - Départ Bleu) */}
                  <Group
                    x={coords.startX}
                    y={coords.startY}
                    draggable
                    dragBoundFunc={(pos) => ({
                      x: clamp(pos.x, 0, stageW),
                      y: clamp(pos.y, 0, stageH),
                    })}
                    onDragEnd={(e) => {
                      const node = e.target
                      const newX = clamp(toReal(node.x(), scaleX), 0, realW)
                      const newY = clamp(toReal(node.y(), scaleY), 0, realH)
                      node.position({ x: newX * scaleX, y: newY * scaleY })
                      onUpdateElement?.(selectedElement, {
                        handPath: {
                          ...selectedEl.handPath,
                          start: [newX, newY],
                        },
                      })
                    }}
                  >
                    <Circle radius={11} fill="#0284c7" stroke="#ffffff" strokeWidth={2} shadowBlur={6} shadowOpacity={0.6} />
                    <Text text="S" x={-3.5} y={-4.5} fontSize={10} fontStyle="bold" fill="#ffffff" listening={false} />
                  </Group>

                  {/* End handle (E - Arrivée Rouge) */}
                  <Group
                    x={coords.endX}
                    y={coords.endY}
                    draggable
                    dragBoundFunc={(pos) => ({
                      x: clamp(pos.x, 0, stageW),
                      y: clamp(pos.y, 0, stageH),
                    })}
                    onDragEnd={(e) => {
                      const node = e.target
                      const newX = clamp(toReal(node.x(), scaleX), 0, realW)
                      const newY = clamp(toReal(node.y(), scaleY), 0, realH)
                      node.position({ x: newX * scaleX, y: newY * scaleY })
                      onUpdateElement?.(selectedElement, {
                        handPath: {
                          ...selectedEl.handPath,
                          end: [newX, newY],
                        },
                      })
                    }}
                  >
                    <Circle radius={11} fill="#e11d48" stroke="#ffffff" strokeWidth={2} shadowBlur={6} shadowOpacity={0.6} />
                    <Text text="E" x={-3.5} y={-4.5} fontSize={10} fontStyle="bold" fill="#ffffff" listening={false} />
                  </Group>
                </Group>
              )
            })()}

            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              flipEnabled={false}
              keepRatio={false}
              borderStroke="#f5a623"
              borderStrokeWidth={1.5}
              borderDash={[4, 2]}
              anchorStroke="#f5a623"
              anchorFill="#1a1d24"
              anchorSize={8}
              anchorCornerRadius={2}
              anchorStrokeWidth={1.5}
              boundBoxFunc={(oldBox, newBox) =>
                (newBox.width < MIN_ELEMENT_SIZE || newBox.height < MIN_ELEMENT_SIZE) ? oldBox : newBox
              }
            />
          </Layer>
        </Stage>
      </CanvasRuler>
    </div>
  )
}