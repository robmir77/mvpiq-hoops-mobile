// src/vision/delegates.ts
//
// TensorFlow Lite delegate options for hardware acceleration
// These constants are used across the app to configure model inference acceleration

export type AndroidDelegateOption = 'nnapi' | 'android-gpu'
export type IosDelegateOption = 'metal'

export const ANDROID_DELEGATE_OPTIONS: AndroidDelegateOption[] = ['nnapi', 'android-gpu']
export const DEFAULT_ANDROID_DELEGATE: AndroidDelegateOption = 'android-gpu'
export const DEFAULT_IOS_DELEGATE: IosDelegateOption = 'metal'
