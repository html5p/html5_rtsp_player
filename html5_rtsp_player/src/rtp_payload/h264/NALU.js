import {appendByteArray} from '../../util/binary';

export class NALU {

    static NDR = 1;
    static IDR = 5;
    static SEI = 6;
    static SPS = 7;
    static PPS = 8;

    static TYPES = {
        [NALU.IDR]: 'IDR',
        [NALU.SEI]: 'SEI',
        [NALU.SPS]: 'SPS',
        [NALU.PPS]: 'PPS',
        [NALU.NDR]: 'NDR'
    };

    static type(nalu) {
        if (nalu.ntype in NALU.TYPES) {
            return NALU.TYPES[nalu.ntype];
        } else {
            return 'UNKNOWN';
        }
    }

    constructor(ntype, nri, data, timestamp) {
        this.data      = data;
        this.ntype     = ntype;
        this.nri       = nri;
        this.timestamp = timestamp;
    }

    appendData(idata) {
        this.data = appendByteArray(this.data, idata);
    }

    type() {
        return this.ntype;
    }

    getSize() {
        return 4 + 1 + this.data.byteLength;
    }

    getData() {
        let header = new Uint8Array(5 + this.data.byteLength);
        let view = new DataView(header.buffer);
        view.setUint32(0, this.data.byteLength + 1);
        view.setUint8(4, (0x0 & 0x80) | (this.nri & 0x60) | (this.ntype & 0x1F));
        header.set(this.data, 5);
        return header;
    }
}
