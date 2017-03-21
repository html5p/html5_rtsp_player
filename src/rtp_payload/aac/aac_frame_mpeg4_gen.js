export class AACFrame {

    constructor(data, timestamp) {
        this.timestamp = timestamp;
        this.data = data;
    }

    getPayload() {
        return this.data;
    }

    getSize() {
        return this.data.byteLength;
    }
}