import {AACFrame} from './aac_frame_mpeg4_gen';
// TODO: asm.js
export class AAC_Mpeg4_Generic {
    constructor() {
        this.config = null;
    }

    static onRTPPacket(pkt) {
        let rawData = pkt.getPayload();

        if (!pkt.media) {
            return null;
        }
        let data = new DataView(rawData.buffer, rawData.byteOffset);

        let sizeLength = parseInt(pkt.media.fmtp['sizelength'], 10) || 0;
        let indexLength = parseInt(pkt.media.fmtp['indexlength'], 10) || 0;
        let indexDeltaLength = parseInt(pkt.media.fmtp['indexdeltalength'], 10) || 0;
        let auHeadersLengthInBits = data.getUint16(0);
        let perAUHeaderLengthInBits = sizeLength + Math.max(indexLength, indexDeltaLength);
        if (auHeadersLengthInBits !== perAUHeaderLengthInBits)
            Log.error('auHeadersLengthInBits != perAUHeaderLengthInBits');

        return new AACFrame(rawData.slice(4), 0);
    }
}