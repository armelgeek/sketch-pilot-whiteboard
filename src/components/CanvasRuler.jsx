import { useMemo } from 'react'
import { generateRulerTicks } from '../utils/canvas-geometry'

/**
 * @typedef {Object} Region
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} Point
 * @property {number} x
 * @property {number} y
 */

// ── Design tokens ──────────────────────────────────────────────────────────
// Centralized so the ruler's palette can be themed or reused without hunting
// through the JSX for hex literals.
const THEME = {
  panelBg: '#0d1018',
  trackBg: '#121620',
  border: 'border-white/10',
  tickLine: 'border-white/15',
  tickLabel: 'text-white/40',
  unitAccentText: '#38bdf8',
  unitAccentBg: '#0284c7',
  selection: '#f5a623',
  tracker: '#06b6d4',
  dimensionAccent: '#10b981',
}

const TICK_STEP_PX = 100

/**
 * Guards against divide-by-zero / NaN when a dimension hasn't been
 * measured yet (e.g. before the stage has mounted).
 * @param {number} value
 * @param {number} total
 * @returns {number} a 0–100 percentage
 */
function toPercent(value, total) {
  if (!total) return 0
  return (value / total) * 100
}

/**
 * A single graduation tick with its numeric label.
 */
function RulerTick({ value, total, axis }) {
  const isX = axis === 'x'
  return (
    <div
      className={
        isX
          ? 'absolute top-0 bottom-0 border-l pl-0.5 pb-0.5 flex items-end pointer-events-none'
          : 'absolute left-0 right-0 border-t pl-0.5 pt-0.5 pointer-events-none'
      }
      style={{
        [isX ? 'left' : 'top']: `${toPercent(value, total)}%`,
        borderColor: 'rgb(255 255 255 / 0.15)',
      }}
    >
      <span className={`text-[8px] font-mono ${THEME.tickLabel} ${isX ? '' : 'block -mt-1.5 text-[7.5px]'}`}>
        {value}
      </span>
    </div>
  )
}

/**
 * Highlights the currently selected region's span along one axis.
 */
function SelectionHighlight({ region, total, axis }) {
  if (!region) return null
  const isX = axis === 'x'
  const start = isX ? region.x : region.y
  const size = isX ? region.width : region.height
  return (
    <div
      className={
        isX
          ? 'absolute top-0 bottom-0 border-x pointer-events-none'
          : 'absolute left-0 right-0 border-y pointer-events-none'
      }
      style={{
        [isX ? 'left' : 'top']: `${toPercent(start, total)}%`,
        [isX ? 'width' : 'height']: `${toPercent(size, total)}%`,
        backgroundColor: `${THEME.selection}4d`, // ~30% alpha
        borderColor: THEME.selection,
      }}
    />
  )
}

/**
 * A live 1px line tracking the current mouse position along one axis.
 */
function MouseTracker({ position, total, axis }) {
  if (position == null) return null
  const isX = axis === 'x'
  const coord = isX ? position.x : position.y
  return (
    <div
      className={isX ? 'absolute top-0 bottom-0 w-px z-10 pointer-events-none' : 'absolute left-0 right-0 h-px z-10 pointer-events-none'}
      style={{
        [isX ? 'left' : 'top']: `${toPercent(coord, total)}%`,
        backgroundColor: THEME.tracker,
      }}
    />
  )
}

/**
 * Floating badge showing the selected region's coordinates and size.
 */
function CoordinatesHud({ region, index }) {
  if (!region) return null
  return (
    <div
      className="absolute top-2 right-2 z-30 flex items-center gap-2 rounded-md border px-2.5 py-1
                 bg-black/90 text-white text-[11px] font-mono shadow-lg backdrop-blur-sm select-none pointer-events-none"
      style={{ borderColor: `${THEME.selection}80` }}
      role="status"
      aria-label={`Zone sélectionnée : X ${region.x}, Y ${region.y}, largeur ${region.width}, hauteur ${region.height}`}
    >
      <span className="font-bold" style={{ color: THEME.selection }}>
        Zone #{index != null ? index + 1 : ''}
      </span>
      <span className="text-white/30">|</span>
      <span>X: <strong style={{ color: THEME.unitAccentText }}>{region.x}</strong></span>
      <span>Y: <strong style={{ color: THEME.unitAccentText }}>{region.y}</strong></span>
      <span className="text-white/30">|</span>
      <span>Largeur: <strong style={{ color: THEME.dimensionAccent }}>{region.width}</strong></span>
      <span>Hauteur: <strong style={{ color: THEME.dimensionAccent }}>{region.height}</strong></span>
    </div>
  )
}

/**
 * CanvasRuler
 *
 * Precision ruler overlay for the Whiteboard editor canvas. Renders X/Y pixel
 * graduations around the canvas stage, highlights the selected region on
 * both axes, tracks the live mouse position, and surfaces a coordinates HUD.
 *
 * @param {Object} props
 * @param {number} props.realW - Canvas content width in source pixels.
 * @param {number} props.realH - Canvas content height in source pixels.
 * @param {number} props.stageW - Rendered stage width in screen pixels (ruler track length).
 * @param {number} props.stageH - Rendered stage height in screen pixels (ruler track length).
 * @param {Region|null} [props.selectedRegion] - Currently selected region, in source-pixel space.
 * @param {number|null} [props.selectedElementIndex] - Index of the selected region, for the HUD label.
 * @param {Point|null} [props.mousePos] - Live mouse position in source-pixel space.
 * @param {React.ReactNode} props.children - The canvas stage itself, rendered inside the ruler frame.
 */
export default function CanvasRuler({
  realW,
  realH,
  stageW,
  stageH,
  selectedRegion = null,
  selectedElementIndex = null,
  mousePos = null,
  children,
}) {
  const xTicks = useMemo(() => generateRulerTicks(realW, TICK_STEP_PX), [realW])
  const yTicks = useMemo(() => generateRulerTicks(realH, TICK_STEP_PX), [realH])

  return (
    <div
      className="relative flex flex-col items-start rounded-xl border border-white/10 p-2.5 shadow-2xl select-none"
      style={{ backgroundColor: THEME.panelBg }}
      role="group"
      aria-label="Règle de précision du canevas"
    >
      {/* Top Header: Horizontal X Ruler */}
      <div className="flex items-center w-full mb-1">
        <div
          className="w-6 h-5 mr-1 shrink-0 flex items-center justify-center rounded border text-[9.5px] font-mono font-bold select-none"
          style={{
            color: THEME.unitAccentText,
            backgroundColor: `${THEME.unitAccentBg}26`, // ~15% alpha
            borderColor: `${THEME.unitAccentBg}4d`, // ~30% alpha
          }}
          aria-hidden="true"
        >
          px
        </div>

        <div
          className="relative h-5 rounded border border-white/10 overflow-hidden select-none"
          style={{ width: stageW, backgroundColor: THEME.trackBg }}
        >
          {xTicks.map((val) => (
            <RulerTick key={`x-${val}`} value={val} total={realW} axis="x" />
          ))}
          <SelectionHighlight region={selectedRegion} total={realW} axis="x" />
          <MouseTracker position={mousePos} total={realW} axis="x" />
        </div>
      </div>

      {/* Main Section: Vertical Y Ruler + Canvas Stage */}
      <div className="flex items-start">
        <div
          className="relative w-6 mr-1 shrink-0 rounded border border-white/10 overflow-hidden select-none"
          style={{ height: stageH, backgroundColor: THEME.trackBg }}
        >
          {yTicks.map((val) => (
            <RulerTick key={`y-${val}`} value={val} total={realH} axis="y" />
          ))}
          <SelectionHighlight region={selectedRegion} total={realH} axis="y" />
          <MouseTracker position={mousePos} total={realH} axis="y" />
        </div>

        <div className="relative">
          <CoordinatesHud region={selectedRegion} index={selectedElementIndex} />
          {children}
        </div>
      </div>
    </div>
  )
}