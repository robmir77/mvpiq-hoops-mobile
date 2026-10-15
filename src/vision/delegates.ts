// src/vision/delegates.ts
//
// TensorFlow Lite delegate options for hardware acceleration
// These constants are used across the app to configure model inference acceleration
//
// Android: choose between GPU delegate and NNAPI. 'android-gpu' is the
// default for maximum compatibility. NNAPI is flagged as deprecated by
// fast-tflite's own maintainers from Android 15 onward.
//
// iOS: Core ML is the only accelerated delegate fast-tflite exposes on iOS
// — there's no NNAPI-equivalent second choice, so it's not a selection,
// just the fixed default.

export type AndroidDelegateOption = 'android-gpu' | 'nnapi'
export type IosDelegateOption = 'core-ml'

export const ANDROID_DELEGATE_OPTIONS: AndroidDelegateOption[] = ['android-gpu', 'nnapi']
export const DEFAULT_ANDROID_DELEGATE: AndroidDelegateOption = 'android-gpu'
export const DEFAULT_IOS_DELEGATE: IosDelegateOption = 'core-ml'
