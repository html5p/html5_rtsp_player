import {AACFrame} from './AACFrame';
// TODO: asm.js
export class AACAsm {
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
        let CTSDeltaLength = parseInt(pkt.media.fmtp['ctsdeltalength'], 10) || 0;
        let DTSDeltaLength = parseInt(pkt.media.fmtp['dtsdeltalength'], 10) || 0;
        let RandomAccessIndication = parseInt(pkt.media.fmtp['randomaccessindication'], 10) || 0;
        let StreamStateIndication = parseInt(pkt.media.fmtp['streamstateindication'], 10) || 0;
        let AuxiliaryDataSizeLength = parseInt(pkt.media.fmtp['auxiliarydatasizelength'], 10) || 0;

        let configHeaderLength =
            sizeLength + Math.max(indexLength, indexDeltaLength) + CTSDeltaLength + DTSDeltaLength +
            RandomAccessIndication + StreamStateIndication + AuxiliaryDataSizeLength;


        let auHeadersLengthPadded = 0;
        if (0 !== configHeaderLength) {
            /* The AU header section is not empty, read it from payload */
            let auHeadersLengthInBits = data.getUint16(0); // Always 2 octets, without padding
            auHeadersLengthPadded = 2 + (auHeadersLengthInBits + auHeadersLengthInBits % 8) / 8; // Add padding

            this.config = new Uint8Array(rawData, 0 , auHeadersLengthPadded);
        }

        return new AACFrame(rawData.slice(auHeadersLengthPadded), pkt.getTimestampMS());
    }
}