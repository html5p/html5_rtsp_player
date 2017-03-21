export class AACFrame {

    constructor(data, timestamp) {
        this.timestamp = timestamp;

        let offset = 0;
        while (true) {
            if (data[offset] !=255) break;
            ++offset;
        }

        ++offset;

        this.data=data.subarray(offset);
    }

    getPayload() {
        return this.data;
    }

    getSize() {
        return this.data.byteLength;
    }
}