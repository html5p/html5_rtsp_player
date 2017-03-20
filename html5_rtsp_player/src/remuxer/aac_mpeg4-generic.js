import {AAC_Mpeg4_Generic} from '../rtp_payload/aac/aac_fmt_mpeg4_gen';
import {AACFrame} from '../rtp_payload/aac/aac_frame_mpeg4_gen';
import {MSE} from '../video_presenters/mse';
import {Log} from 'bp_logger';
import {BaseRemuxer} from './base';
import {BitArray, hexToByteArray, bitSlice} from '../util/binary';
// TODO: asm.js
export class AAC_MPEG4_GENERIC extends BaseRemuxer {
    static SampleRates = [
        96000, 88200,
        64000, 48000,
        44100, 32000,
        24000, 22050,
        16000, 12000,
        11025, 8000,
        7350, 0,
        0, 0];
    static Modes = new Set(['AAC-hbr']);
    constructor(track) {
        super(track);
        this.frames = 0;
        this.codecstring=MSE.CODEC_AAC;
        this.aunits = [];
        this._initDTS = undefined;
        this._initPTS = undefined;
        this.firstDTS = undefined;
        let config = track.fmtp['config'];
        let config_bytes = [];
        if (config) {
            config_bytes = hexToByteArray(config);
        }
        this.mp4track = {
            id: BaseRemuxer.getTrackID(),
            type: 'audio',
            fragmented: true,
            channelCount: 0,
            audiosamplerate: this.timescale,
            duration: this.timescale,
            timescale: this.timescale,
            volume: 1,
            aacSamples: [],
            mp4Samples: [],
            config: Array.from(config_bytes)
        };
        this.parseConfig(config_bytes);
    }
    parseConfig(bytes) {
        var config = new BitArray(bytes);
        config.skipBits(5);
        let sfi = config.readBits(4);
        this.mp4track.audiosamplerate = AAC_MPEG4_GENERIC.SampleRates[sfi];
        this.mp4track.channelCount = config.readBits(4);
    }
    getPayload() {
        if (this.aunits.length == 0)
            return null;
        let len = 0;
        for (let unit of this.aunits) {
            this.mp4track.aacSamples.push({
                unit: unit,
                pts: unit.timestamp - this._initPTS,
                dts: unit.timestamp - this._initDTS,
            });
            len += unit.getSize();
        }
        let offset = 0;
        let payload = new Uint8Array(len);
        while (this.mp4track.aacSamples.length) {
            let aacSample = this.mp4track.aacSamples.shift();
            let unit = aacSample.unit;
            if (this.firstDTS == undefined) {
                this.firstDTS = aacSample.dts;
            }
            payload.set(unit.getPayload(), offset);
            offset += unit.getSize();
            let mp4Sample = {
                size: unit.getSize(),
                cts: 320, // 10ms
                duration: 1024,
                flags: {
                    isLeading: 0,
                    isDependedOn: 0,
                    hasRedundancy: 0,
                    degradPrio: 0,
                    dependsOn: 1,
                }
            };
            this.mp4track.mp4Samples.push(mp4Sample);
        }
        return payload;
    }
    remux(rtpPacket, videoReady) {
        if (!videoReady)
            return 0;
        if (!super.remux.call(this, rtpPacket))
            return 0;
        let aac = AAC_Mpeg4_Generic.onRTPPacket(rtpPacket);
        aac.timestamp = this.frames;
        this.frames += 1024;
        if (!this.readyToDecode) {
            if (this._initDTS === undefined) {
                this._initDTS = 0;
                this._initPTS = 0;
            }
            this.readyToDecode = true;
        };
        this.aunits.push(aac);
        return 0;
    }
    flush() {
        this.aunits = [];
        this.mp4track.mp4Samples = [];
        this.firstDTS = undefined;
    }
}