/**
 * Canvas Geometry & Color Utilities
 */

export const ZONE_COLORS = [
  '#f5a623', // amber
  '#3b82f6', // blue
  '#10b981', // emerald
  '#ec4899', // pink
  '#a855f7', // purple
  '#f43f5e', // rose
  '#06b6d4', // cyan
  '#eab308', // yellow
  '#2dd4bf', // teal
  '#3a86f0', // royal blue
]

export const TYPE_COLORS = {
  structure: '#f5a623',
  character: '#3b82f6',
  effect:    '#a855f7',
  text:      '#10b981',
  object:    '#ec4899',
  prop:      '#06b6d4',
  symbol:    '#eab308',
}

export function colorForIndex(i) {
  return ZONE_COLORS[i % ZONE_COLORS.length]
}

/** Converts a stage-space value back into real scene coordinates. */
export function toReal(value, scale) {
  return Math.round(value / scale)
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Calculates absolute stage coordinates for the hand trajectory start/end points.
 */
export function getHandPathStageCoords(element, scaleX, scaleY) {
  if (!element?.region) return null

  const regionX = element.region.x * scaleX
  const regionY = element.region.y * scaleY
  const regionW = element.region.width * scaleX
  const regionH = element.region.height * scaleY

  // Defaults: start at top-left, end at bottom-right of region
  const startX = element.handPath?.start?.[0] != null
    ? element.handPath.start[0] * scaleX
    : regionX + 10
  const startY = element.handPath?.start?.[1] != null
    ? element.handPath.start[1] * scaleY
    : regionY + 10

  const endX = element.handPath?.end?.[0] != null
    ? element.handPath.end[0] * scaleX
    : regionX + regionW - 10
  const endY = element.handPath?.end?.[1] != null
    ? element.handPath.end[1] * scaleY
    : regionY + regionH - 10

  return { startX, startY, endX, endY }
}

/**
 * Generates ruler mark ticks for real scene dimensions.
 */
export function generateRulerTicks(maxReal, step = 100) {
  const ticks = []
  for (let val = 0; val <= maxReal; val += step) {
    ticks.push(val)
  }
  return ticks
}
