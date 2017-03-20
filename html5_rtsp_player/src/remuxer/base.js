let track_id = 1;

export class BaseRemuxer {

    static PTSNormalize(value, reference) {
        return value;

        var offset;
        if (reference === undefined) {
            return value;
        }
        if (reference < value) {
            // - 2^33
            offset = -8589934592;
        } else {
            // + 2^33
            offset = 8589934592;
        }
        while (Math.abs(value - reference) > 4294967296) {
            value += offset;
        }
        return value;
    }

    static getTrackID() {
        return track_id++;
    }

    constructor(track) {
        this.timeOffset = 0;
        this.timescale = Number(track.rtpmap[""+track.fmt[0]].clock);
        this.scaleFactor = (this.timescale|0) / 1000;
        this.readyToDecode = false;
        this.seq = 1;
    }

    msToScaled(timestamp) {
        return (timestamp - this.timeOffset) * this.scaleFactor;
    }

    clockToScaled(timestamp) {
        return timestamp * this.scaleFactor;
    }

    remux(rtpPacket) {
        return (this.timeOffset >= 0);
    }
}