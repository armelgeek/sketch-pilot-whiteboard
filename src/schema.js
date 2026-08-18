import { z } from 'zod'

export const regionSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(200),
  height: z.number().default(200),
})

export const revealSchema = z.object({
  direction: z.string().default('top_to_bottom'),
  style: z.string().optional().default(''),
  startMs: z.number().default(0),
  durationMs: z.number().default(2000),
  maskPaddingPx: z.number().default(22),
  protectedRegions: z.array(z.any()).default([]),
})

export const handPathSchema = z.object({
  start: z.array(z.number()).optional(),
  end: z.array(z.number()).optional(),
  easing: z.string().default('easeInOut'),
}).optional().default({})

export const transitionSchema = z.object({
  transitionAfter: z.string().default('cut'),
  transitionMs: z.number().default(500),
}).default({ transitionAfter: 'cut', transitionMs: 500 })

export const elementSchema = z.object({
  id: z.string(),
  label: z.string().default('Zone'),
  type: z.string().default('structure'),
  narrativeRole: z.string().optional().default(''),
  sequence: z.number().optional().default(1),
  subtitle: z.string().optional().default(''),
  region: regionSchema,
  reveal: revealSchema.default({ direction: 'top_to_bottom', startMs: 0, durationMs: 2000, protectedRegions: [] }),
  handPath: handPathSchema,
})

export const sceneConfigSchema = z.object({
  sceneId: z.string().optional().default('scene_1'),
  name: z.string().optional().default('Scène'),
  sceneDurationMs: z.number().optional().default(8000),
  transition: transitionSchema,
  canvas: z.object({
    width: z.number().default(1280),
    height: z.number().default(720),
  }).default({ width: 1280, height: 720 }),
  elements: z.array(elementSchema).default([]),
})

/**
 * Validates and sanitizes a scene configuration JSON object.
 * Returns a safely formatted config with missing defaults filled in.
 */
export function validateSceneConfig(rawConfig) {
  try {
    return sceneConfigSchema.parse(rawConfig)
  } catch (err) {
    console.warn('⚠️ Erreur de validation du schéma de scène, fallback sécurisé appliqué:', err)
    return {
      sceneId: rawConfig?.sceneId || `scene_${Date.now()}`,
      name: rawConfig?.name || 'Scène importée',
      sceneDurationMs: rawConfig?.sceneDurationMs || 8000,
      transition: {
        transitionAfter: rawConfig?.transition?.transitionAfter || rawConfig?.transitionAfter || 'cut',
        transitionMs: rawConfig?.transition?.transitionMs ?? rawConfig?.transitionMs ?? 500,
      },
      canvas: {
        width: rawConfig?.canvas?.width || 1280,
        height: rawConfig?.canvas?.height || 720,
      },
      elements: Array.isArray(rawConfig?.elements)
        ? rawConfig.elements.map((el, i) => ({
            id: el.id || `region_${i + 1}`,
            label: el.label || `Zone ${i + 1}`,
            type: el.type || 'structure',
            subtitle: el.subtitle || '',
            region: {
              x: el.region?.x ?? 0,
              y: el.region?.y ?? 0,
              width: el.region?.width ?? 200,
              height: el.region?.height ?? 200,
            },
            reveal: {
              direction: el.reveal?.direction || 'top_to_bottom',
              style: el.reveal?.style || '',
              startMs: el.reveal?.startMs ?? 0,
              durationMs: el.reveal?.durationMs ?? 2000,
              maskPaddingPx: el.reveal?.maskPaddingPx ?? 22,
              protectedRegions: el.reveal?.protectedRegions || [],
            },
            handPath: el.handPath || {},
          }))
        : [],
    }
  }
}
