export const API_BASE_URL = 'https://mvpiq-hoops-backend-1.onrender.com';

// YOLO Detection Confidence Thresholds
export const YOLO_CONFIG = {
  // Ball detection thresholds
  BALL_CONF_THRESHOLD: 0.005, // Minimum confidence for ball detection (0.5%)
  
  // Player detection thresholds
  PLAYER_CONF_THRESHOLD: 0.005, // Minimum confidence for player detection in YOLO parser (0.5%)
  PLAYER_CROP_MIN_CONFIDENCE: 0.005, // Minimum confidence for player crop manager (0.5%)
  
  // Rim detection thresholds
  RIM_CONF_THRESHOLD: 0.005, // Minimum confidence for rim detection (0.5%)
  
  // NMS threshold
  NMS_IOU_THRESHOLD: 0.4, // IoU threshold for non-maximum suppression
  
  // Size constraints
  PLAYER_MIN_WIDTH: 0.05, // Minimum normalized width for player detection
  PLAYER_MIN_HEIGHT: 0.1, // Minimum normalized height for player detection
} as const;

// Camera Configuration
export const CAMERA_CONFIG = {
  DEFAULT_RESOLUTION: { width: 1280, height: 720 }, // Default camera resolution
  DEFAULT_FPS: 30, // Default camera frame rate
  DEFAULT_POSE_RESOLUTION: 192, // MoveNet input resolution (only 192 is currently available)
  DEFAULT_ZOOM: 1, // Default camera zoom level
  MIN_RESOLUTION: { width: 1280, height: 720 }, // Minimum acceptable resolution for workout sessions
} as const;

// Court Dimensions (meters)
export const COURT_CONFIG = {
  WIDTH_M: 15.24, // Court width in meters (50 feet)
  HEIGHT_M: 28.65, // Court height in meters (94 feet)
  HOOP_Y_M: 1.575, // Hoop height in meters (10 feet / 3.05 meters)
} as const;