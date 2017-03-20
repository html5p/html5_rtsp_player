import {NALUAsm} from '../rtp_payload/h264/NALUAsm';
import {NALU} from '../rtp_payload/h264/NALU';
import {ExpGolomb} from '../util/exp-golomb';
import {base64ToArrayBuffer} from '../util/binary';
import {BaseRemuxer} from './base';
import {MSE} from '../video_presenters/mse';
import {Log} from 'bp_logger';
// TODO: asm.js

export class H264TrackConverter extends BaseRemuxer {

    static last_push_ts = undefined;

    constructor(player, track) {
        super(track);

        this.player = player;
        this.delayed = 0;

        this.codecstring = MSE.CODEC_AVC_BASELINE;

        this.units = [];

        this.naluasm = new NALUAsm();

        this.firstPush = false;
        this.initPTS = 0;
        this.firstDTS = undefined;

        this.mp4track = {
            id: BaseRemuxer.getTrackID(),
            type: 'video',
            nbNalu: 0,
            fragmented: true,
            sps: '',
            pps: '',
            width: 0,
            height: 0,
            avcSamples: [],
            mp4Samples: []
        };

        if (track.fmtp['sprop-parameter-sets']) {
            let sps_pps = track.fmtp['sprop-parameter-sets'].split(',');
            this.mp4track.pps=[new Uint8Array(base64ToArrayBuffer(sps_pps[1]))];
            this.parseTrackSPS(base64ToArrayBuffer(sps_pps[0]));
        }

        this.player.onwaiting = () => {
            this.waitStart = performance.now();
            this.delayed = 0;
            console.log("waiting delayed = " + this.delayed);
            let waitCanPlay = new Promise((resolve, reject) => {
                this.player.onplaying = () => {
                    this.delayed += Math.round(performance.now() - this.waitStart);
                    console.log("playing delayed = " + this.delayed);
                    this.player.onplaying = null;
                    resolve();
                };
            });
        };
    }

    parseTrackSPS(sps) {
        var expGolombDecoder = new ExpGolomb(new Uint8Array(sps));
        var config = expGolombDecoder.readSPS();

        this.mp4track.width = config.width;
        this.mp4track.height = config.height;
        this.mp4track.sps = [new Uint8Array(sps)];
        this.mp4track.timescale = 1000;
        this.mp4track.duration = 1000;
        var codecarray = new DataView(sps,1,4);
        this.codecstring = 'avc1.';
        for (let i = 0; i < 3; i++) {
            var h = codecarray.getUint8(i).toString(16);
            if (h.length < 2) {
                h = '0' + h;
            }
            this.codecstring += h;
        }
        this.mp4track.codec = this.codecstring;
    }

    remux(rtpPacket) {
        if (!super.remux.call(this, rtpPacket))
            return 0;

        let nalu = this.naluasm.onRTPPacket(rtpPacket);
        if (nalu == null)
            return 0;

        let push = false;

        switch (nalu.type()) {
        case NALU.NDR:
            if (this.readyToDecode) {
                nalu.timestamp = Math.floor(performance.now());
                push = true;
            }
            break;
        case NALU.IDR:
            if (!this.readyToDecode) {
                if (this.mp4track.pps && this.mp4track.sps) {
                    push = true;
                    this.readyToDecode = true;

                    this.initPTS = nalu.timestamp = Math.floor(performance.now());
                    this.firstPush = true;
                    console.log('init ts = ' + this.initPTS);
                }
            } else {
                nalu.timestamp = Math.floor(performance.now());
                push = true;
            }
            break;
        case NALU.PPS:
            if (!this.mp4track.pps) {
                this.mp4track.pps = [new Uint8Array(nalu.data)];
            }
            break;
        case NALU.SPS:
            if(!this.mp4track.sps) {
                this.parseTrackSPS(nalu.data);
            }
            break;
        default:
            push = false;
        }

        // TODO: update sps & pps
        if (this.readyToDecode) {
            if (push) {
                this.units.push(nalu);
                let threshold = this.firstPush ? 8 : 0;
                let ret = this.units.length > threshold ? 1 : 0;
                if (ret == 1) this.firstPush = false;
                return ret;
            }
        }

        return 0;
    }

    getPayload() {
        for (let unit of this.units) {
            this.mp4track.avcSamples.push({
                unit: unit,
                pts: unit.timestamp - this.initPTS,
                //dts: unit.timestamp - this.initPTS,
                key: unit.type() == NALU.IDR
            });
        }
        this.units = [];

        if (this.mp4track.avcSamples.length < 2) {
            return null;
        }

        let len = 0;
        let lastSample = this.mp4track.avcSamples.pop();
        for (let sample of this.mp4track.avcSamples) {
            len += sample.unit.getSize();
        }
        this.mp4track.avcSamples.push(lastSample);

        let payload = new Uint8Array(len);
        let offset = 0;

        // process the first N-1 samples
        while (this.mp4track.avcSamples.length > 1) {
            let avcSample = this.mp4track.avcSamples.shift();
            let nextSample = this.mp4track.avcSamples[0];
            let unit_data = avcSample.unit.getData();

            payload.set(unit_data, offset);
            offset += unit_data.byteLength;

            if (this.firstDTS == undefined) {
                this.firstDTS = avcSample.pts;
            }

            let mp4Sample = {
                size: unit_data.byteLength,
                duration: nextSample.pts - avcSample.pts,
                cts: 0,// 10ms
                flags: {
                    isLeading: 0,
                    isDependedOn: 0,
                    hasRedundancy: 0,
                    degradPrio: 0
                }
            };

            if (mp4Sample.duration <= 0) {
                let delta = 1 - mp4Sample.duration;
                mp4Sample.duration = 1;
                nextSample.pts += delta;
            }

            if (avcSample.key === true) {
                mp4Sample.flags.dependsOn = 2;
                mp4Sample.flags.isNonSync = 0;
            } else {
                mp4Sample.flags.dependsOn = 1;
                mp4Sample.flags.isNonSync = 1;
            }

            this.mp4track.mp4Samples.push(mp4Sample);
        }

        return payload;
    }

    flush() {
        this.seq++;
        this.mp4track.mp4Samples = [];
        this.firstDTS = undefined;
    }
}