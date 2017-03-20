import {MP4} from '../iso-bmff/mp4-generator';
import {AACTrackConverter} from './aac_mp4a-latm';
import {AAC_MPEG4_GENERIC} from './aac_mpeg4-generic';
import {H264TrackConverter} from './h264';
import {MSE} from '../video_presenters/mse';
import {Log} from 'bp_logger';
import {EventEmitter} from 'bp_event';

export class Remuxer {
    static TrackConverters = {
        'H264':          H264TrackConverter,
        'MP4A-LATM':     AACTrackConverter,
        'MPEG4-GENERIC': AAC_MPEG4_GENERIC
    };

    constructor(player) {
        this.player = player;
        this.eventSource = new EventEmitter();
        this.initialized = false;
        this.initSegment = null;
        this.tracks = {};
        this.codecs = [];
        this.streams = {};
        this.enabled = false;
        this.mse_ready = true;

        this.errorListener = this.sendTeardown.bind(this);
        this.closeListener = this.sendTeardown.bind(this);
    }

    setTrack(track, stream) {
        let fmt = track.rtpmap[track.fmt[0]].name;
        this.streams[track.type] = stream;
        if (Remuxer.TrackConverters[fmt]) {
            if (track.type == 'audio' && fmt == 'MPEG4-GENERIC') {
                if (!Remuxer.TrackConverters[fmt].Modes.has(track.fmtp['mode'])) {
                    Log.error(`${track.type} track mode ${track.fmtp['mode']} is not suppored`);
                    return;
                }
            }
            this.tracks[track.type] = new Remuxer.TrackConverters[fmt](this.player, track);
        } else {
            Log.error(`${track.type} track is not attached cause there is no remuxer for ${fmt}`);
        }
    }

    setTimeOffset(timeOffset, track) {
        if (this.tracks[track.type]) {
            this.tracks[track.type].timeOffset = timeOffset/this.tracks[track.type].scaleFactor;
        }
    }

    init() {
        let tracks = [];
        this.codecs = [];
        for (let track_type in this.tracks) {
            let track = this.tracks[track_type];
            if (!MSE.isSupported([track.codecstring])) {
                throw new Error(`${track.mp4track.type} codec ${track.codecstring} is not supported`);
            }
            tracks.push(track.mp4track);
            this.codecs.push(track.codecstring);
        }
        this.initSegment = MP4.initSegment(tracks, 1000, 1000);
        this.initialized = true;
        if (this.mse) {
            this.initMSE();
        }
    }

    initMSE() {
        if (MSE.isSupported(this.codecs)) {
            this.mse.setCodec(`video/mp4; codecs="${this.codecs.join(', ')}"`).then(()=>{
                this.mse.feed(this.initSegment);
                this.enabled = true;
            });
        } else {
            throw new Error('Codecs are not supported');
        }
    }

    attachMSE(mse) {
        if (this.mse) {
            this.detachMSE()
        }
        this.mse = mse;
        this.mse.eventSource.addEventListener('error', this.errorListener);
        this.mse.eventSource.addEventListener('sourceclose', this.closeListener);

        if (this.initialized) {
            this.initMSE();
        }
    }

    detachMSE() {
        if (this.mse) {
            this.mse.eventSource.removeEventListener('error', this.errorListener);
            this.mse.eventSource.removeEventListener('sourceclose', this.closeListener);
            this.mse = null;
        }
    }

    sendTeardown() {
        // TODO: stop flusher
        this.mse_ready = false;
        this.enabled = false;
        this.initialized = false;
        this.mse.clear();
        this.streams['video'].sendTeardown();
        this.eventSource.dispatchEvent('stopped');
    }

    flush() {
        if (!this.mse_ready)
            return;

        if (!this.initialized) {
            for (let track_type in this.tracks) {
                if (!this.tracks[track_type].readyToDecode) {
                    return;
                }
            }
            try {
                this.init();
            } catch (e) {
                this.eventSource.dispatchEvent('error', {'reason': e.message});
                Log.error(e.message);
                this.sendTeardown();
                return;
            }
        }

        if (!this.enabled)
            return;

        if (this.mse) {
            for (let track_type in this.tracks) {
                let track = this.tracks[track_type];
                let pay = track.getPayload();
                if (pay && pay.byteLength) {
                    let mdat = MP4.mdat(pay);    // TODO: order independent implementation
                    let moof = MP4.moof(track.seq, track.firstDTS, track.mp4track);
                    this.mse.feed(moof);
                    this.mse.feed(mdat);
                    track.flush();
                }
            }
        } else {
            for (let track_type in this.tracks) {
                let track = this.tracks[track_type];
                track.flush();
            }
        }
    }

    feedRTP(rtpPacket) {
        let track = this.tracks[rtpPacket.media.type];
        if (track) {
            if (rtpPacket.media.type == 'audio') {
                return track.remux(rtpPacket, this.tracks['video'].readyToDecode);
            } else {
                return track.remux(rtpPacket);
            }
        }
    }
}