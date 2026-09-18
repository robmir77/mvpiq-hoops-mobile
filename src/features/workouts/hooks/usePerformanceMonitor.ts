// Shared performance monitoring for inference and rendering

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
            console.log(`[PERF] YOLO: ${perfMetrics.yoloFps}fps | Tracking: ${perfMetrics.trackingUpdates}/s | Overlay: ${perfMetrics.overlayRenders}/s (JS FPS)`)
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
        yoloFps: 0,  // Deprecated: read from worker SharedValues
        moveNetFps: 0,  // Deprecated: read from worker SharedValues
        trackingUpdates: perfMetrics.trackingUpdates,
        overlayRenders: perfMetrics.overlayRenders,
    }
}
