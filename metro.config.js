// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('onnx', 'tflite');

// onnxruntime-web usa dynamic import() — non supportato da Metro
// Soluzione: mock completo in React Native (ort-web non gira su RN comunque)
// L'inferenza ONNX avviene tramite fetch + ArrayBuffer, non direttamente via ort
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'onnxruntime-web') {
        return {
            filePath: path.join(__dirname, 'ort-mock.js'),
            type: 'sourceFile',
        };
    }
    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;