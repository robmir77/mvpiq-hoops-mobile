export const API_BASE_URL = 'https://mvpiq-hoops-backend-1.onrender.com';

// YOLO Detection Confidence Thresholds
export const YOLO_CONFIG = {
  // Ball detection thresholds
  BALL_CONF_THRESHOLD: 0.005, // Minimum confidence for ball detection (0.5%)
  
  // Player detection thresholds
  PLAYER_CONF_THRESHOLD: 0.005, // Minimum confidence for player detection in YOLO parser (0.5%)
  PLAYER_CROP_MIN_CONFIDENCE: 0.01, // Minimum confidence for player crop manager (1%)
  
  // Rim detection thresholds
  RIM_CONF_THRESHOLD: 0.005, // Minimum confidence for rim detection (0.5%)
  
  // NMS threshold
  NMS_IOU_THRESHOLD: 0.4, // IoU threshold for non-maximum suppression
  
  // Size constraints
  PLAYER_MIN_WIDTH: 0.05, // Minimum normalized width for player detection
  PLAYER_MIN_HEIGHT: 0.1, // Minimum normalized height for player detection
} as const;