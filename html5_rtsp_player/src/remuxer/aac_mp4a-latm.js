import {AACAsm} from '../rtp_payload/aac/AACAsm';
import {AACFrame} from '../rtp_payload/aac/AACFrame';
import {MSE} from '../video_presenters/mse';
import {Log} from 'bp_logger';
import {BaseRemuxer} from './base';
import {BitArray, hexToByteArray, bitSlice} from '../util/binary';
// TODO: asm.js
export class AACTrackConverter extends BaseRemuxer {
    static SampleRates = [
        96000, 88200,
        64000, 48000,
        44100, 32000,
        24000, 22050,
        16000, 12000,
        11025, 8000,
        7350];

    constructor(track) {
        super(track);

        this.codecstring=MSE.CODEC_AAC;
        this.aunits = [];
        this._initDTS = undefined;
        this.nextAacPts = undefined;
        this.firstDTS = 0;
        this.firstPTS = 0;
        let config = track.fmtp['config'];
        this.has_config = track.fmtp['cpresent']!='0';
        let config_bytes = [];
        if (config) {
            config_bytes=hexToByteArray(config);
        }
        this.mp4track={
            id:BaseRemuxer.getTrackID(),
            type: 'audio',
            fragmented:true,
            channelCount:0,
            audiosamplerate: this.timescale,
            duration: this.timescale,
            timescale: this.timescale,
            volume: 1,
            samples: [],
            config:Array.from(config_bytes)
        };

        this.parseConfig(config_bytes);
    }

    parseConfig(bytes) {
        // ISO_IEC_14496-3 Part 3 Audio. StreamMuxConfig
        var config = new BitArray(bytes);

        if (!config.readBits(1)) {
            config.skipBits(14);
            let prof = config.readBits(5);
            this.codecstring = `mp4a.40.${prof}`;
            let sfi = config.readBits(4);
            this.mp4track.config = Array.from(bitSlice(bytes, 15, 31)); // TODO: correctly extract AudioSpecificConfig
            this.mp4track.audiosamplerate = AACTrackConverter.SampleRates[sfi];
            if (sfi==0xf) config.skipBits(24);
            this.mp4track.channelCount=config.readBits(4);
        }
    }

    getPayload() {
        this.mp4track.len = 0;
        for (let unit of this.aunits) {
            this.mp4track.samples.push({
                unit: unit,
                pts: this.msToScaled(unit.timestamp),
                dts: this.msToScaled(unit.timestamp)
            });
            this.mp4track.len+=unit.getSize();
        }

        let offset = 0,
            aacSample, mp4Sample,
            unit, lastDTS,
            pts, dts, ptsnorm, dtsnorm,
            samples = [],
            samples0;

        let payload = new Uint8Array(this.mp4track.len );

        this.mp4track.samples.sort(function(a, b) {
            return (a.pts-b.pts);
        });
        samples0 = this.mp4track.samples;
        let sampleDuration = 1024; // FIXME: * 90000 / track.audiosamplerate;??

        while (samples0.length) {
            aacSample = samples0.shift();
            unit = aacSample.unit;
            pts = aacSample.pts - this._initPTS;
            dts = aacSample.dts - this._initDTS;
            //logger.log(`Audio/PTS:${Math.round(pts/90)}`);
            // if not first sample
            if (lastDTS !== undefined) {
                ptsnorm = BaseRemuxer.PTSNormalize(pts, lastDTS);
                dtsnorm = BaseRemuxer.PTSNormalize(dts, lastDTS);
                // let's compute sample duration.
                // there should be 1024 audio samples in one AAC frame
                sampleDuration = (dtsnorm - lastDTS);
                if(Math.abs(sampleDuration - 1024) > 10) {
                    // not expected to happen ...
                    Log.log(`invalid AAC sample duration at PTS ${Math.round(pts/90)},should be 1024,found :${Math.round(sampleDuration)}`);
                }
                sampleDuration = 1024 ;
                dtsnorm = 1024 + lastDTS;
            } else {
                var nextAacPts = this.nextAacPts,delta;
                ptsnorm = BaseRemuxer.PTSNormalize(pts, nextAacPts);
                dtsnorm = BaseRemuxer.PTSNormalize(dts, nextAacPts);
                if (nextAacPts) {
                    delta = Math.round(1000 * (ptsnorm - nextAacPts));
                    // if fragment are contiguous, or delta less than 600ms, ensure there is no overlap/hole between fragments
                    if (/*contiguous || */Math.abs(delta) < 600) {
                        // log delta
                        if (delta) {
                            if (delta > 0) {
                                Log.log(`${delta} ms hole between AAC samples detected,filling it`);
                                // if we have frame overlap, overlapping for more than half a frame duraion
                            } else if (delta < -12) {
                                // drop overlapping audio frames... browser will deal with it
                                Log.log(`${(-delta)} ms overlapping between AAC samples detected, drop frame`);
                                this.mp4track.len -= unit.getSize();
                                continue;
                            }
                            // set DTS to next DTS
                            ptsnorm = dtsnorm = nextAacPts;
                        }
                    }
                }
                // remember first PTS of our aacSamples, ensure value is positive
                this.firstPTS = Math.max(0, ptsnorm);
                this.firstDTS = Math.max(0, dtsnorm);
                if(this.mp4track.len > 0) {
                    /* concatenate the audio data and construct the mdat in place
                     (need 8 more bytes to fill length and mdat type) */
                } else {
                    // no audio samples
                    return [];
                }
            }
            payload.set(unit.getPayload(), offset);
            offset += unit.getSize();
            mp4Sample = {
                size: unit.getSize(),
                cts: 0,
                duration:sampleDuration,
                flags: {
                    isLeading: 0,
                    isDependedOn: 0,
                    hasRedundancy: 0,
                    degradPrio: 0,
                    dependsOn: 1,
                }
            };
            samples.push(mp4Sample);
            lastDTS = dtsnorm;
        }
        var lastSampleDuration = 0;
        var nbSamples = samples.length;
        //set last sample duration as being identical to previous sample
        if (nbSamples >= 2) {
            lastSampleDuration = samples[nbSamples - 2].duration;
            mp4Sample.duration = lastSampleDuration;
        }
        if (nbSamples) {
            // next aac sample PTS should be equal to last sample PTS + duration
            this.nextAacPts = ptsnorm +  lastSampleDuration;
            this.mp4track.samples = samples;
            this.mp4track.lastDuration = (this.lastDTS||0) + samples[samples.length - 1].duration;
        }
        return payload;
    }

    remux(rtpPacket) {
        if (!super.remux.call(this, rtpPacket)) return;

        let aac = AACAsm.onRTPPacket(rtpPacket);
        if (!this.readyToDecode) {
            if (this.has_config) {
                this.parseConfig(aac.config);
            }
            if (this._initDTS === undefined) {
                this._initPTS = this.msToScaled(aac.timestamp);
                this._initDTS = this.msToScaled(aac.timestamp);
            }
            this.readyToDecode = true;
        };

        this.aunits.push(aac);

    }

    flush() {
        this.aunits = [];
        this.mp4track.len = 0;
        this.mp4track.samples = [];
    }
}