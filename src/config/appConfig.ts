export const API_BASE_URL = 'https://mvpiq-hoops-backend-1.onrender.com';

// YOLO Detection Confidence Thresholds
export const YOLO_CONFIG = {
  // Confidence thresholds. The TFLite export has sigmoid built in, so scores are
  // probabilities. Values like 0.001 turn the parser into "always return the
  // argmax anchor", i.e. a false positive on every frame (trees, graffiti, lamps).
  BALL_CONF_THRESHOLD: 0.05,       // definitivo, tarato con log [YOLO RAW]
  PLAYER_CONF_THRESHOLD: 0.01,     // definitivo, tarato con log [YOLO RAW]
  PLAYER_CROP_MIN_CONFIDENCE: 0.05, // Minimum confidence for player crop manager (5%)
  RIM_CONF_THRESHOLD: 0.10,        // definitivo, tarato con log [YOLO RAW]

  // NMS threshold (reserved: parser returns the single best box per class)
  NMS_IOU_THRESHOLD: 0.4,

  // Size / shape priors (normalized to the camera frame, 0..1).
  // Boxes outside these ranges are rejected before they can win the argmax.
  PLAYER_MIN_WIDTH: 0.05,
  PLAYER_MIN_HEIGHT: 0.1,
  PLAYER_MAX_WIDTH: 0.6,
  PLAYER_MIN_ASPECT: 0.8, // height/width (a standing player is taller than wide)
  PLAYER_MAX_ASPECT: 6.0,
  BALL_MIN_SIZE: 0.008, // min avg side (normalized)
  BALL_MAX_SIDE: 0.15, // max avg side (normalized)
  BALL_MAX_BBOX_SIZE: 0.15, // Maximum normalized bbox AREA used by useYoloWorker*
  BALL_MIN_ASPECT: 0.6, // width/height; a ball is roughly square (motion blur tolerated)
  BALL_MAX_ASPECT: 1.7,
  RIM_MIN_WIDTH: 0.015,
  RIM_MAX_WIDTH: 0.25,
  RIM_MIN_ASPECT: 0.7, // width/height; side view is wider than tall, near-frontal can be ~square
  RIM_MAX_ASPECT: 6.0,

  // Adaptive confidence threshold configuration.
  // MIN_THRESHOLD is a hard floor: the adaptive logic may relax the base
  // threshold when nothing is detected, but never into the noise range.
  ADAPTIVE_CONF: {
    ENABLED: true,
    WINDOW_SIZE: 15,
    MIN_THRESHOLD: 0.03,          // era 0.0005
    MAX_THRESHOLD: 0.50,
    ADJUSTMENT_FACTOR: 0.2,
    HIGH_CONF_THRESHOLD: 0.7,
    LOW_CONF_THRESHOLD: 0.2,
  },
} as const;

// Camera Configuration
export const CAMERA_CONFIG = {
  DEFAULT_RESOLUTION: { width: 640, height: 360 }, // Default camera resolution (360p for better FPS)
  DEFAULT_FPS: 40, // Default camera frame rate (increased to 90 for even better ball tracking)
  DEFAULT_POSE_RESOLUTION: 192, // MoveNet input resolution (only 192 is currently available)
  DEFAULT_ZOOM: 1, // Default camera zoom level (1 = 100% = no zoom)
  MIN_RESOLUTION: { width: 640, height: 360 }, // Minimum acceptable resolution for workout sessions (allows 360p for smaller YOLO models)
  OVERLAY_REFRESH_INTERVAL_MS: 33, // Overlay refresh interval in ms (0 = update on every frame, 33 = ~30 FPS)
} as const;

// Vision Pipeline Configuration - Deterministic FPS targets
// Camera FPS is independent from vision model FPS
export const VISION_CONFIG = {
  CAMERA_FPS: 30, // Camera frame rate (hardware/configured)

  YOLO: {
    ENABLED: true,
    // TARGET_FPS follows CAMERA_FPS dynamically in useYoloWorker
  },

  MOVENET: {
    ENABLED: true,
    // MoveNet executes only when player bbox is above threshold (no FPS limit)
  },

  // Detection module defaults
  BALL_DETECTION_ENABLED: true, // Enable ball detection by default
  PLAYER_DETECTION_ENABLED: true, // Enable player detection by default
  RIM_DETECTION_ENABLED: false, // Disable rim detection by default
  POSE_DETECTION_ENABLED: true, // Enable pose detection by default

  // Rim calibration ROI configuration
  RIM_CALIBRATION: {
    ROI_SIZE_PERCENT: 0.25, // ROI size as percentage of frame (25% = 1/4 of frame)
    MIN_CONFIDENCE: 0.40, // Minimum confidence for rim detection during calibration
    MAX_DISTANCE_FROM_CENTER: 0.15, // Maximum normalized distance from selected center to accept detection
  },
} as const;

// Model Configuration
export const MODEL_CONFIG = {
  DEFAULT_YOLO_MODEL_ID: 'best_640_float16', // Default YOLO model (640 for calibration camera)
  DEFAULT_MOVENET_MODEL_ID: 'movenet_lightning_192_int8', // Default MoveNet model
} as const;

// Court Dimensions (meters)
export const COURT_CONFIG = {
  WIDTH_M: 15.24, // Court width in meters (50 feet)
  FULL_HEIGHT_M: 28.65, // Full court height in meters (94 feet)
  HALF_HEIGHT_M: 14.32, // Half court height in meters (47 feet)
  HOOP_Y_M: 1.575, // Hoop height in meters (10 feet / 3.05 meters)
  HEIGHT_M: 28.65, // Alias for FULL_HEIGHT_M for backward compatibility
} as const;

// Test Configuration for Camera FPS Degradation Investigation
// See ARCHITECTURE_CHANGE.md - Performance Analysis section for test plan
export const TEST_CONFIG = {
  // TEST B-v3: YOLO isolato con target 10 FPS (DEV)
  // Obiettivo: Verificare se riducendo la frequenza YOLO a 10 FPS, l'architettura sincrona attuale riesce a mantenere la camera a 30 FPS
  // Se sì: workaround temporaneo utilizzabile
  // Se no: passare direttamente alla correzione architetturale (separazione producer/consumer)
  ENABLE_YOLO: true,
  ENABLE_MOVENET: true, // Re-enabled with 2 FPS throttling (500ms interval)
  ENABLE_TELEMETRY_OVERLAY: true,
  ENABLE_DEBUG_OVERLAY: false,
  // POC: Async YOLO with latest-frame gate + adaptive FPS
  // ENABLED: Testing adaptive FPS system that throttles frame submission based on YOLO inference time
  ENABLE_ASYNC_YOLO_POC: true,
  // Adaptive FPS throttling: regulates frame submission based on YOLO inference time
  ENABLE_ADAPTIVE_FPS: false, // Disabled by default until tested
} as const;