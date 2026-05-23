// ort-mock.js
// Mock di onnxruntime-web per Metro/React Native
// L'implementazione reale usa fetch + ArrayBuffer a runtime

class Tensor {
    constructor(type, data, dims) {
        this.type = type;
        this.data = data;
        this.dims = dims;
    }
}

class InferenceSession {
    static async create(buffer, options) {
        return new InferenceSession();
    }
    async run(feeds) {
        throw new Error('ONNX inference not available in this build');
    }
}

module.exports = { Tensor, InferenceSession };