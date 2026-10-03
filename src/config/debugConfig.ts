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
