# Legacy Mapping: useTrackingEngine → Extracted Engines

Questo documento mappa la logica di `useTrackingEngine.ts` (792 righe) ai tre engine estratti per verificare l'equivalenza funzionale.

## Mapping Overview

```
useTrackingEngine.ts (legacy)
├── Kalman filtering → BallTrackingEngine
├── Ball tracking (TTL) → BallTrackingEngine
├── Trajectory management → BallTrackingEngine
├── Player tracking → PlayerTrackingEngine
├── Spatial constraint → useTrackingEngine (coordination)
├── Dribble filter → ShotDetectionEngine
├── Shot detection → ShotDetectionEngine
└── SharedValues (overlay) → useTrackingEngine (UI layer)
```

## 1. BallTrackingEngine Mapping

### Legacy: Kalman Filtering (lines 149-189)
```typescript
// useTrackingEngine.ts
const kalmanUpdate = useCallback((measX: number, measY: number, frameTs: number) => {
    const k = kalman.current
    const dt = Math.max(0.01, Math.min(0.1, (frameTs - lastFrameTs.current) / 1000))
    const predX = k.x + k.vx * dt
    const predY = k.y + k.vy * dt
    const gx = k.px / (k.px + k.mx)
    const gy = k.py / (k.py + k.my)
    k.x = predX + gx * (measX - predX)
    k.y = predY + gy * (measY - predY)
    k.vx = (k.x - predX) / dt
    k.vy = (k.y - predY) / dt
    k.px = (1 - gx) * k.px
    k.py = (1 - gy) * k.py
    return { x: k.x, y: k.y }
}, [])
```

### BallTrackingEngine: updateKalman
```typescript
// BallTrackingEngine.ts
updateKalman(measX: number, measY: number, frameTs: number): BallPosition {
    const k = this.kalman
    const dt = Math.max(0.01, Math.min(0.1, (frameTs - this.lastFrameTs) / 1000))
    const predX = k.x + k.vx * dt
    const predY = k.y + k.vy * dt
    const gx = k.px / (k.px + k.mx)
    const gy = k.py / (k.py + k.my)
    k.x = predX + gx * (measX - predX)
    k.y = predY + gy * (measY - predY)
    k.vx = (k.x - predX) / dt
    k.vy = (k.y - predY) / dt
    k.px = (1 - gx) * k.px
    k.py = (1 - gy) * k.py
    this.lastFrameTs = frameTs
    return { x: k.x, y: k.y }
}
```

**Status**: ✓ Identico

### Legacy: Kalman Prediction (lines 169-189)
```typescript
// useTrackingEngine.ts
const kalmanPredict = useCallback((frameTs: number) => {
    const k = kalman.current
    const dt = Math.max(0.01, Math.min(0.1, (frameTs - lastFrameTs.current) / 1000))
    const ageMs = frameTs - ballLastSeenAt.current
    if (ageMs > BALL_TRACK_TTL_MS) {
        ballTrackingValid.current = false
        if (lastBallWasDetected.current) {
            callbacks?.onBallTrackingExpired?.()
            lastBallWasDetected.current = false
        }
        return null
    }
    const predX = k.x + k.vx * dt
    const predY = k.y + k.vy * dt
    return { x: predX, y: predY }
}, [callbacks])
```

### BallTrackingEngine: predict
```typescript
// BallTrackingEngine.ts
predict(frameTs: number): BallPosition | null {
    const k = this.kalman
    const dt = Math.max(0.01, Math.min(0.1, (frameTs - this.lastFrameTs) / 1000))
    const ageMs = frameTs - this.ballLastSeenAt
    if (ageMs > BALL_TRACK_TTL_MS) {
        this.ballTrackingValid = false
        if (this.lastBallWasDetected) {
            this.callbacks?.onBallTrackingExpired?.()
            this.lastBallWasDetected = false
        }
        return null
    }
    const predX = k.x + k.vx * dt
    const predY = k.y + k.vy * dt
    return { x: predX, y: predY }
}
```

**Status**: ✓ Identico

### Legacy: Trajectory Ring Buffer (lines 48-51, 134-147)
```typescript
// useTrackingEngine.ts
const MAX_POINTS = 90
const trajectoryBuffer = useRef<Array<{ x: number; y: number; t: number } | null>>(new Array(MAX_POINTS).fill(null))
const trajectoryHead = useRef<number>(0)
const trajectoryCount = useRef<number>(0)

const getTrajectory = useCallback((): Array<{ x: number; y: number; t: number }> => {
    const result: Array<{ x: number; y: number; t: number }> = []
    const count = trajectoryCount.current
    const head = trajectoryHead.current
    const buffer = trajectoryBuffer.current
    for (let i = 0; i < count; i++) {
        const idx = (head - count + i + MAX_POINTS) % MAX_POINTS
        const point = buffer[idx]
        if (point) result.push(point)
    }
    return result
}, [MAX_POINTS])
```

### BallTrackingEngine: Trajectory
```typescript
// BallTrackingEngine.ts
private readonly MAX_POINTS = 90
private trajectoryBuffer: Array<TrajectoryPoint | null> = new Array(this.MAX_POINTS).fill(null)
private trajectoryHead = 0
private trajectoryCount = 0

private getTrajectory(): TrajectoryPoint[] {
    const result: TrajectoryPoint[] = []
    const count = this.trajectoryCount
    const head = this.trajectoryHead
    const buffer = this.trajectoryBuffer
    for (let i = 0; i < count; i++) {
        const idx = (head - count + i + this.MAX_POINTS) % this.MAX_POINTS
        const point = buffer[idx]
        if (point) result.push(point)
    }
    return result
}
```

**Status**: ✓ Identico

### Constants
- `BALL_TRACK_TTL_MS = 500` ✓
- `MAX_POINTS = 90` ✓
- `INITIAL_KALMAN` ✓

## 2. PlayerTrackingEngine Mapping

### Legacy: Player Center from Pose (lines 271-282)
```typescript
// useTrackingEngine.ts
let playerCenter: { x: number; y: number } | null = null
if (poseKeypoints) {
    const leftHip = poseKeypoints.leftHip
    const rightHip = poseKeypoints.rightHip
    if (leftHip && rightHip) {
        playerCenter = {
            x: (leftHip.x + rightHip.x) / 2,
            y: (leftHip.y + rightHip.y) / 2
        }
    }
}
```

### PlayerTrackingEngine: updateFromPose
```typescript
// PlayerTrackingEngine.ts
updateFromPose(poseKeypoints: any): void {
    if (poseKeypoints) {
        const leftHip = poseKeypoints.leftHip
        const rightHip = poseKeypoints.rightHip
        if (leftHip && rightHip) {
            this.playerCenter = {
                x: (leftHip.x + rightHip.x) / 2,
                y: (leftHip.y + rightHip.y) / 2
            }
            this.lastUpdateTs = Date.now()
        }
    }
}
```

**Status**: ✓ Identico (con aggiunta di lastUpdateTs per TTL)

## 3. ShotDetectionEngine Mapping

### Legacy: Dribble Filter (lines 466-497)
```typescript
// useTrackingEngine.ts
const MIN_RISING_FRAMES = 3
const MIN_ARC_HEIGHT = 0.08
const SHOT_LAUNCH_THRESHOLD = 1.5
const MIN_TRAJECTORY_FRAMES = 4

const risingFrames = useRef<number>(0)
const flightStartY = useRef<number>(1.0)

if (vel && ball) {
    const isRising = vel.vy < -SHOT_LAUNCH_THRESHOLD
    if (isRising) {
        risingFrames.current++
        if (risingFrames.current === 1) {
            flightStartY.current = ball.y
        }
    } else {
        risingFrames.current = 0
    }
    if (!inFlightRef.current && risingFrames.current >= MIN_RISING_FRAMES) {
        const arcSoFar = flightStartY.current - ball.y
        if (arcSoFar >= MIN_ARC_HEIGHT && trajectoryCount.current >= MIN_TRAJECTORY_FRAMES) {
            inFlightRef.current = true
            current.releasePoint = { x: ball.x, y: ball.y }
        }
    }
}
```

### ShotDetectionEngine: processFrame (dribble filter)
```typescript
// ShotDetectionEngine.ts
const MIN_RISING_FRAMES = 3
const MIN_ARC_HEIGHT = 0.08
const SHOT_LAUNCH_THRESHOLD = 1.5
const MIN_TRAJECTORY_FRAMES = 4

private risingFrames = 0
private flightStartY = 1.0

if (vel && ball) {
    const isRising = vel.vy < -SHOT_LAUNCH_THRESHOLD
    if (isRising) {
        this.risingFrames++
        if (this.risingFrames === 1) {
            this.flightStartY = ball.y
        }
    } else {
        this.risingFrames = 0
    }
    if (!this.inFlight && this.risingFrames >= MIN_RISING_FRAMES) {
        const arcSoFar = this.flightStartY - ball.y
        if (arcSoFar >= MIN_ARC_HEIGHT && this.trajectoryCount >= MIN_TRAJECTORY_FRAMES) {
            this.inFlight = true
            this.releasePoint = { x: ball.x, y: ball.y }
        }
    }
}
```

**Status**: ✓ Identico

### Legacy: Shot Detection (lines 513-557)
```typescript
// useTrackingEngine.ts
const SHOT_COOLDOWN_MS = 600
const DESCENDING_VY_THRESHOLD = 0.3
const lastShotTs = useRef<number>(0)

const getDynamicHoopRadius = (hoop: { width?: number; height?: number } | null): number => {
    if (!hoop || !hoop.width || !hoop.height) return 0.10
    return Math.max(hoop.width, hoop.height) / 2 * 1.2
}

const hoop = current.hoopPosition
const cooldownOk = (frameTs - lastShotTs.current) > SHOT_COOLDOWN_MS

if (vel && hoop && ball && cooldownOk && !current.shotDetected) {
    const descending = vel.vy > DESCENDING_VY_THRESHOLD
    const dynamicHoopRadius = getDynamicHoopRadius(hoop)
    if (inFlightRef.current && descending) {
        const dx = ball.x - hoop.x
        const dy = ball.y - hoop.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const descendingTowardHoop = dy > 0 && dist < dynamicHoopRadius * 2
        if (descendingTowardHoop && dist < dynamicHoopRadius) {
            current.shotDetected = true
            current.shotResult = 'MADE'
            lastShotTs.current = frameTs
        } else if (descendingTowardHoop && dist >= dynamicHoopRadius) {
            current.shotDetected = true
            current.shotResult = 'MISS'
            lastShotTs.current = frameTs
        } else if (descending && vel.vy > SHOT_LAUNCH_THRESHOLD * 2) {
            current.shotDetected = true
            current.shotResult = dist < 0.25 ? 'MISS' : 'AIRBALL'
            lastShotTs.current = frameTs
        }
    }
}
```

### ShotDetectionEngine: processFrame (shot detection)
```typescript
// ShotDetectionEngine.ts
const SHOT_COOLDOWN_MS = 600
const DESCENDING_VY_THRESHOLD = 0.3
private lastShotTs = 0

const getDynamicHoopRadius = (hoop: HoopPosition | null): number => {
    if (!hoop || !hoop.width || !hoop.height) return 0.1
    return Math.max(hoop.width, hoop.height) / 2 * 1.2
}

const hoop = hoopPosition
const cooldownOk = (frameTs - this.lastShotTs) > SHOT_COOLDOWN_MS

if (vel && hoop && ball && cooldownOk && !this.shotDetected) {
    const descending = vel.vy > DESCENDING_VY_THRESHOLD
    const dynamicHoopRadius = getDynamicHoopRadius(hoop)
    if (this.inFlight && descending) {
        const dx = ball.x - hoop.x
        const dy = ball.y - hoop.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const descendingTowardHoop = dy > 0 && dist < dynamicHoopRadius * 2
        if (descendingTowardHoop && dist < dynamicHoopRadius) {
            this.shotDetected = true
            this.shotResult = 'MADE'
            this.lastShotTs = frameTs
        } else if (descendingTowardHoop && dist >= dynamicHoopRadius) {
            this.shotDetected = true
            this.shotResult = 'MISS'
            this.lastShotTs = frameTs
        } else if (descending && vel.vy > SHOT_LAUNCH_THRESHOLD * 2) {
            this.shotDetected = true
            this.shotResult = dist < 0.25 ? 'MISS' : 'AIRBALL'
            this.lastShotTs = frameTs
        }
    }
}
```

**Status**: ✓ Identico

## 4. Coordination Layer (Still in useTrackingEngine)

### Spatial Constraint (lines 284-293)
```typescript
// useTrackingEngine.ts
const MAX_PLAYER_BALL_DISTANCE = 0.35
if (ballDetection && playerCenter && !current.inFlight) {
    const dx = ballDetection.x - playerCenter.x
    const dy = ballDetection.y - playerCenter.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    if (distance > MAX_PLAYER_BALL_DISTANCE) {
        ballDetection = null
    }
}
```

**Status**: ⚠️ Questa logica di coordinamento rimane in useTrackingEngine. Deve essere implementata nel layer di coordinamento quando si integrano gli engine.

### SharedValues (lines 69-117)
```typescript
// useTrackingEngine.ts
const ballX = useSharedValue(0)
const ballY = useSharedValue(0)
// ... 30+ SharedValues for overlay
```

**Status**: ⚠️ ShotDetectionEngine contiene ancora SharedValues per overlay. Questo deve essere separato in un layer UI.

## Integration Strategy

Per integrare gli engine in useTrackingEngine senza introdurre regressioni:

1. **Step 1**: Istanziare i tre engine in useTrackingEngine
2. **Step 2**: Sostituire kalmanUpdate con BallTrackingEngine.updateKalman
3. **Step 3**: Sostituire kalmanPredict con BallTrackingEngine.predict
4. **Step 4**: Sostituire trajectory management con BallTrackingEngine
5. **Step 5**: Sostituire player tracking con PlayerTrackingEngine
6. **Step 6**: Sostituire shot detection con ShotDetectionEngine.processFrame
7. **Step 7**: Mantenere SharedValues in useTrackingEngine per compatibilità UI
8. **Step 8**: Verificare output identici per 10+ sessioni di test

## Rischi Identificati

1. **Spatial constraint**: Deve essere implementato nel layer di coordinamento
2. **SharedValues**: ShotDetectionEngine contiene ancora SharedValue - viola principio "No React in runtime"
3. **Trajectory update**: La logica di aggiornamento SharedValues per traiettoria è duplicata in più punti
4. **Callbacks**: I callback onBallDetected/onBallPrediction devono essere propagati correttamente

## Next Steps

1. Separare SharedValues da ShotDetectionEngine
2. Implementare layer di coordinamento per spatial constraint
3. Integrare engine uno alla volta con test di equivalenza
4. Non eliminare useTrackingEngine finché non verificata equivalenza
