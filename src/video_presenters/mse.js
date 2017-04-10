import {Log} from 'bp_logger';
import {EventEmitter} from 'bp_event';
//import {MP4Inspect} from '../util/mp4-inspector';

export class MSE {
    static CODEC_AVC_BASELINE = "avc1.42E01E";
    static CODEC_AVC_MAIN = "avc1.4D401E";
    static CODEC_AVC_HIGH = "avc1.64001E";
    static CODEC_VP8 = "vp8";
    static CODEC_AAC = "mp4a.40.2";
    static CODEC_VORBIS = "vorbis";
    static CODEC_THEORA = "theora";

    static ErrorNotes = {
        [MediaError.MEDIA_ERR_ABORTED]: 'fetching process aborted by user',
        [MediaError.MEDIA_ERR_NETWORK]: 'error occurred when downloading',
        [MediaError.MEDIA_ERR_DECODE]: 'error occurred when decoding',
        [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: 'audio/video not supported'
    };

    static isSupported(codecs=[MSE.CODEC_AVC_BASELINE, MSE.CODEC_AAC]) {
        return (window.MediaSource && window.MediaSource.isTypeSupported(`video/mp4; codecs="${codecs.join(',')}"`));
    }

    constructor (players) {
        this.players = players;
        this.eventSource = new EventEmitter();
        this.reset();
    }

    play() {
        this.players.forEach((video)=>{
            video.play();
        });
    }

    reset() {
        this.updating = false;
        this.resolved = false;
        this.mediaSource = new MediaSource();
        this.players.forEach((video)=>{
            video.src = URL.createObjectURL(this.mediaSource);
        });
        this.mediaReady = new Promise((resolve, reject)=>{
            this.mediaSource.addEventListener('sourceopen', ()=>{
                Log.debug(`Media source opened: ${this.mediaSource.readyState}`);
                if (!this.resolved) {
                    this.resolved = true;
                    resolve();
                }
            });
            this.mediaSource.addEventListener('sourceended', ()=>{
                Log.debug(`Media source ended: ${this.mediaSource.readyState}`);
            });
            this.mediaSource.addEventListener('sourceclose', ()=>{
                Log.debug(`Media source closed: ${this.mediaSource.readyState}`);
                this.eventSource.dispatchEvent('sourceclose');
            });
        });
        this.clear();
    }

    clear() {
        this.queue = [];
    }

    setCodec(mimeCodec) {
        return this.mediaReady.then(()=>{
            Log.debug(`Use codec: ${mimeCodec}`);

            this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeCodec);

            this.sourceBuffer.addEventListener('updateend', (e)=> {
                if (this.queue.length) {
                    this.feedNext();
                } else {
                    this.updating = false;
                }
            });

            this.sourceBuffer.addEventListener('error', (e)=> {
                Log.debug(`Source buffer error: ${this.mediaSource.readyState}`);
                if (this.mediaSource.sourceBuffers.length) {
                    this.mediaSource.removeSourceBuffer(this.sourceBuffer);
                }
                this.eventSource.dispatchEvent('error');
            });

            this.sourceBuffer.addEventListener('abort', (e)=> {
                Log.debug(`Source buffer aborted: ${this.mediaSource.readyState}`);
                if (this.mediaSource.sourceBuffers.length) {
                    this.mediaSource.removeSourceBuffer(this.sourceBuffer);
                }
                this.eventSource.dispatchEvent('error');
            });
        });
    }

    feedNext() {
       this.doAppend(this.queue.shift());
    }

    doCleanup() {
        if (this.sourceBuffer.buffered.length) {
            let bufferStart = this.sourceBuffer.buffered.start(0);
            let removeEnd = this.players[0].currentTime - 1;

            if (removeEnd > bufferStart) {
                this.updating = true;
                this.sourceBuffer.remove(bufferStart, removeEnd);
            }
        } else {
            this.feedNext();
        }
    }

    doAppend(data) {
        //console.log(MP4Inspect.mp4toJSON(data));
        let err = this.players[0].error;
        if (err) {
            Log.error(`Error occured: ${MSE.ErrorNotes[err.code]}`);
            try {
                this.players.forEach((video)=>{video.stop();});
                this.mediaSource.endOfStream();
            } catch (e){

            }
            this.eventSource.dispatchEvent('error');
        } else {
            try {
                this.sourceBuffer.appendBuffer(data);
            } catch (e) {
                if (e.name === 'QuotaExceededError') {
                    this.queue.unshift(data);

                    this.doCleanup();
                    return;
                }
                //Log.error(`Error occured while appending buffer. ${e.name}: ${e.message}`);
                this.eventSource.dispatchEvent('error');
            }
        }

    }

    feed(data) {
        this.queue.push(data);
        if (!this.updating) {
            this.updating = true;
            this.feedNext();
        }
    }
}