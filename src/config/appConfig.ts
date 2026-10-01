export const API_BASE_URL = 'https://mvpiq-hoops-backend-1.onrender.com';

// YOLO Detection Confidence Thresholds
export const YOLO_CONFIG = {
  // Ball detection thresholds
  BALL_CONF_THRESHOLD: 0.005, // Minimum confidence for ball detection (0.5%)

  // Player detection thresholds
  PLAYER_CONF_THRESHOLD: 0.05, // Minimum confidence for player detection in YOLO parser (5%)
  PLAYER_CROP_MIN_CONFIDENCE: 0.05, // Minimum confidence for player crop manager (5%)

  // Rim detection thresholds
  RIM_CONF_THRESHOLD: 0.1, // Minimum confidence for rim detection (10%)

  // NMS threshold
  NMS_IOU_THRESHOLD: 0.4, // IoU threshold for non-maximum suppression

  // Size constraints
  PLAYER_MIN_WIDTH: 0.05, // Minimum normalized width for player detection
  PLAYER_MIN_HEIGHT: 0.1, // Minimum normalized height for player detection
} as const;

// Camera Configuration
export const CAMERA_CONFIG = {
  DEFAULT_RESOLUTION: { width: 1280, height: 720 }, // Default camera resolution (720p) - aligned with ARCHITECTURE_CHANGE.md
  DEFAULT_FPS: 30, // Default camera frame rate
  DEFAULT_POSE_RESOLUTION: 192, // MoveNet input resolution (only 192 is currently available)
  DEFAULT_ZOOM: 1, // Default camera zoom level
  MIN_RESOLUTION: { width: 640, height: 360 }, // Minimum acceptable resolution for workout sessions (allows 360p for smaller YOLO models)
} as const;

// Model Configuration
export const MODEL_CONFIG = {
  DEFAULT_YOLO_MODEL_ID: 'best_384_float16', // Default YOLO model (384 offers best balance of stability and performance)
  DEFAULT_MOVENET_MODEL_ID: 'movenet_lightning_192_int8', // Default MoveNet model
} as const;

// Court Dimensions (meters)
export const COURT_CONFIG = {
  WIDTH_M: 15.24, // Court width in meters (50 feet)
  HEIGHT_M: 28.65, // Court height in meters (94 feet)
  HOOP_Y_M: 1.575, // Hoop height in meters (10 feet / 3.05 meters)
} as const;

// Test Configuration for Camera FPS Degradation Investigation
// See ARCHITECTURE_CHANGE.md - Performance Analysis section for test plan
export const TEST_CONFIG = {
  // TEST 1: YOLO isolato con telemetria 1s (DEV)
  // Obiettivo: Misurare correlazione tra camera throughput e tempo reale inferenza YOLO durante degrado progressivo
  ENABLE_YOLO: true,
  ENABLE_MOVENET: false,
  ENABLE_TELEMETRY_OVERLAY: false,
  ENABLE_DEBUG_OVERLAY: false,
  // YOLO target FPS: undefined = no throttling, run on every frame to observe natural degradation
  // This allows us to see the true correlation between camera FPS and YOLO inference time
  YOLO_TARGET_FPS: undefined,
} as const;