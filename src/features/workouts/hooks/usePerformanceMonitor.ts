// src/features/workouts/hooks/usePerformanceMonitor.ts
//
// Shared performance monitoring for all inference and rendering operations

const perfMetrics = {
    yoloFps: 0,
    moveNetFps: 0,
    trackingUpdates: 0,
    overlayRenders: 0,
    pathBuildTime: 0,
    overlayRenderTime: 0,
}

let perfTimer: number | null = null

export function incrementYoloFps() {
    perfMetrics.yoloFps++
}

export function incrementMoveNetFps() {
    perfMetrics.moveNetFps++
}

export function incrementTrackingUpdates() {
    perfMetrics.trackingUpdates++
}

export function incrementOverlayRenders() {
    perfMetrics.overlayRenders++
}

export function recordPathBuildTime(ms: number) {
    perfMetrics.pathBuildTime = ms
}

export function recordOverlayRenderTime(ms: number) {
    perfMetrics.overlayRenderTime = ms
}

export function startPerfMonitor() {
    if (perfTimer) return
    perfTimer = setInterval(() => {
        if (__DEV__) {
            // Single consolidated log to reduce JS bridge serialization overhead
            console.log(`[PERF] YOLO: ${perfMetrics.yoloFps}fps | MoveNet: ${perfMetrics.moveNetFps}fps | Tracking: ${perfMetrics.trackingUpdates}/s | Overlay: ${perfMetrics.overlayRenders}/s (JS FPS)`)
            
            // Multi-line detailed logs (commented out for high-frequency performance)
            // console.log('[PERF]')
            // console.log('YOLO.............', perfMetrics.yoloFps, 'fps')
            // console.log('MoveNet..........', perfMetrics.moveNetFps, 'fps')
            // console.log('Tracking Updates.', perfMetrics.trackingUpdates, '/sec')
            // console.log('Overlay Renders..', perfMetrics.overlayRenders, '/sec')
            // console.log('Path Build.......', perfMetrics.pathBuildTime.toFixed(2), 'ms')
            // console.log('Overlay Render...', perfMetrics.overlayRenderTime.toFixed(2), 'ms')
            // console.log('JS FPS...........', perfMetrics.overlayRenders)
        }
        // Reset counters
        perfMetrics.yoloFps = 0
        perfMetrics.moveNetFps = 0
        perfMetrics.trackingUpdates = 0
        perfMetrics.overlayRenders = 0
    }, 1000)
}

export function stopPerfMonitor() {
    if (perfTimer) {
        clearInterval(perfTimer)
        perfTimer = null
    }
}

export function getPerfMetrics() {
    return {
        yoloFps: perfMetrics.yoloFps,
        moveNetFps: perfMetrics.moveNetFps,
        trackingUpdates: perfMetrics.trackingUpdates,
        overlayRenders: perfMetrics.overlayRenders,
    }
}
