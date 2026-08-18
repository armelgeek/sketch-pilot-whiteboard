import { useRef, useEffect, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Rect } from 'react-konva'
import useImage from 'use-image'

export default function AnnotationCanvas({
  cfg,
  imgUrl,
  selectedElement,
  onUpdateElement,
  width = 800,
  height = 600
}) {
  const [isDrawing, setIsDrawing] = useState(false)
  const [image] = useImage(imgUrl || null, 'anonymous')
  const stageRef = useRef()
  const layerRef = useRef()

  const selected = cfg?.elements?.[selectedElement]
  const region = selected?.region

  function handleMouseDown(e) {
    if (!region) return
    setIsDrawing(true)
    const pos = e.evt
    const layer = layerRef.current
    if (!layer) return

    const stage = stageRef.current
    const scaleX = width / (cfg.canvas?.width || 1)
    const scaleY = height / (cfg.canvas?.height || 1)

    const x = (pos.layerX - region.x * scaleX) / scaleX
    const y = (pos.layerY - region.y * scaleY) / scaleY

    if (!selected.handPath) selected.handPath = {}
  }

  function handleMouseMove(e) {
    if (!isDrawing || !region) return
  }

  function handleMouseUp() {
    setIsDrawing(false)
  }

  if (!source || !cfg) return null

  const scaleX = width / (cfg.canvas?.width || 1)
  const scaleY = height / (cfg.canvas?.height || 1)

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ border: '1px solid #ccc', cursor: 'crosshair' }}
    >
      <Layer ref={layerRef}>
        {image && <KonvaImage image={image} width={width} height={height} />}

        {cfg.elements?.map((el, i) => (
          <Rect
            key={`region-${i}`}
            x={el.region.x * scaleX}
            y={el.region.y * scaleY}
            width={el.region.width * scaleX}
            height={el.region.height * scaleY}
            stroke={i === selectedElement ? '#f5a623' : '#666'}
            strokeWidth={i === selectedElement ? 3 : 1}
            fill="transparent"
            listening={false}
          />
        ))}
      </Layer>
    </Stage>
  )
}
