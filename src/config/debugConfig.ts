/**
 * Debug Configuration
 *
 * These flags control debug logging and diagnostics in the hot path.
 * Set VISION_DEBUG to false in production builds to eliminate log overhead.
 */

export const VISION_DEBUG = __DEV__

export const HOT_PATH_LOGS = VISION_DEBUG && false // Disabled by default even in DEV

export const ENABLE_VISION_DIAGNOSTICS = VISION_DEBUG

export const ENABLE_ADAPTIVE_PERFORMANCE_LOGS = VISION_DEBUG

export const ENABLE_PLAYER_CROP_LOGS = VISION_DEBUG && false // Disabled by default

export const ENABLE_MOVENET_LOGS = VISION_DEBUG && false // Disabled by default

export const ENABLE_PERFORMANCE_LOGGING = VISION_DEBUG && false // Disabled by default - only enable for profiling

/**
 * Detailed Profiling Mode
 * When enabled, includes granular metrics like:
 * - Cache hit/miss rates
 * - Bbox stability
 * - Raw candidates
 * - Confidence/size passed counts
 * - Queue depth
 * - P50/P95/P99 percentiles
 * 
 * When disabled (production), only tracks:
 * - Camera FPS
 * - YOLO FPS
 * - MoveNet FPS
 * - Processing time
 * - Drop count
 */
export const ENABLE_DETAILED_PROFILING = VISION_DEBUG && false // Disabled by default - only enable for deep performance analysis
