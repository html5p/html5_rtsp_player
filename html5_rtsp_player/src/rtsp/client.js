import {StateMachine} from 'bp_statemachine';
import {Log} from 'bp_logger';
import {MSE} from './../video_presenters/mse';
import {SDPParser} from './sdp';
import {RTSPStream} from './stream';
import {Remuxer} from '../remuxer/remuxer';
import {RTP} from './rtp';
import {RTPError} from './connection';
import {EventEmitter} from 'bp_event';


export class RTSPClientSM extends StateMachine {
    static USER_AGENT = 'SFRtsp 0.2';
    static STATE_INITIAL  = 1 << 0;
    static STATE_OPTIONS  = 1 << 1;
    static STATE_DESCRIBE = 1 << 2;
    static STATE_SETUP    = 1 << 3;
    static STATE_STREAMS  = 1 << 4;
    static STATE_TEARDOWN = 1 << 5;

    constructor(connection, _mediaElement) {
        super();

        this.player = _mediaElement;

        this.connection = connection;
        this.mse = new MSE([_mediaElement]);
        this.remuxer = null;
        this.eventSource = new EventEmitter();
        this.keepaliveInterval = null;

        this.reset();

        this.addState(RTSPClientSM.STATE_INITIAL, {

        }).addState(RTSPClientSM.STATE_OPTIONS, {
            activate: this.sendOptions,
            finishTransition: this.onOptions
        }).addState(RTSPClientSM.STATE_DESCRIBE, {
            activate: this.sendDescribe,
            finishTransition: this.onDescribe
        }).addState(RTSPClientSM.STATE_SETUP, {
            activate: this.sendSetup,
            finishTransition: this.onSetup
        }).addState(RTSPClientSM.STATE_STREAMS, {

        }).addState(RTSPClientSM.STATE_TEARDOWN, {
            activate: ()=>{
                this.started = false;
                //let promises = [];
                //for (let stream in this.streams) {
                //    promises.push(this.streams[stream].sendTeardown());
                //}
                //return Promise.all(promises);
                this.remuxer.detachMSE();
                return this.streams['video'].sendTeardown();
            },
            finishTransition: ()=>{
                return this.transitionTo(RTSPClientSM.STATE_INITIAL);
            }
        }).addTransition(RTSPClientSM.STATE_INITIAL, RTSPClientSM.STATE_OPTIONS)
            .addTransition(RTSPClientSM.STATE_OPTIONS, RTSPClientSM.STATE_DESCRIBE)
            .addTransition(RTSPClientSM.STATE_DESCRIBE, RTSPClientSM.STATE_SETUP)
            .addTransition(RTSPClientSM.STATE_SETUP, RTSPClientSM.STATE_STREAMS)
            .addTransition(RTSPClientSM.STATE_STREAMS, RTSPClientSM.STATE_TEARDOWN)
            .addTransition(RTSPClientSM.STATE_TEARDOWN, RTSPClientSM.STATE_INITIAL)
            .addTransition(RTSPClientSM.STATE_STREAMS, RTSPClientSM.STATE_TEARDOWN)
            .addTransition(RTSPClientSM.STATE_SETUP, RTSPClientSM.STATE_TEARDOWN)
            .addTransition(RTSPClientSM.STATE_DESCRIBE, RTSPClientSM.STATE_TEARDOWN)
            .addTransition(RTSPClientSM.STATE_OPTIONS, RTSPClientSM.STATE_TEARDOWN);

        this.transitionTo(RTSPClientSM.STATE_INITIAL);

        this.shouldReconnect = false;
        this.connection.eventSource.addEventListener('connected', ()=>{
            if (this.shouldReconnect) {
                this.reconnect();
            }
        });
        this.connection.eventSource.addEventListener('disconnected', ()=>{
            if (this.started) {
                this.shouldReconnect = true;
            }
        });
    }

    stop() {
        this.started = false;
        this.shouldReconnect = false;
        // this.mse = null;
    }

    reset() {
        this.methods = [];
        this.tracks = [];
        for (let stream in this.streams) {
            this.streams[stream].reset();
        }
        this.streams={};
        this.contentBase = "";
        this.state = RTSPClientSM.STATE_INITIAL;
        this.sdp = null;
        this.interleaveChannelIndex = 0;
        this.session = null;
        this.vtrack_idx = -1;
        this.atrack_idx = -1;
        if (this.remuxer) {
            this.remuxer.detachMSE();
        }
        this.stopStreamFlush();

        this.mse.reset();
    }

    reconnect() {
        console.log("reconnecting...");
        this.reset();
        if (this.currentState.name != RTSPClientSM.STATE_INITIAL) {
            this.transitionTo(RTSPClientSM.STATE_TEARDOWN).then(()=> {
                this.transitionTo(RTSPClientSM.STATE_OPTIONS);
            });
        } else {
            this.transitionTo(RTSPClientSM.STATE_OPTIONS);
        }
    }

    supports(method) {
        return this.methods.includes(method)
    }

    sendOptions() {
        this.reset();
        this.started = true;
        this.connection.cSeq = 0;
        return this.connection.sendRequest('OPTIONS', '*', {});
    }

    onOptions(data) {
        this.methods = data.headers['public'].split(',').map((e)=>e.trim());
        this.transitionTo(RTSPClientSM.STATE_DESCRIBE);
    }

    sendDescribe() {
        return this.connection.sendRequest('DESCRIBE', this.connection.url, {
            'Accept': 'application/sdp'
        }).then((data)=>{
            this.sdp = new SDPParser();
            return this.sdp.parse(data.body).catch(()=>{
                throw new Error("Failed to parse SDP");
            }).then(()=>{return data;});
        });
    }

    onDescribe(data) {
        this.contentBase = data.headers['content-base'];
        this.tracks = this.sdp.getMediaBlockList();
        Log.log('SDP contained ' + this.tracks.length + ' track(s). Calling SETUP for each.');

        if (data.headers['session']) {
            this.session = data.headers['session'];
        }

        if (!this.tracks.length) {
            throw new Error("No tracks in SDP");
        }

        this.transitionTo(RTSPClientSM.STATE_SETUP);
    }

    startKeepAlive(timeo) {
        if (timeo == 0) {
            console.log('timeout = 0');
            return;
        }
        this.keepaliveInterval = setInterval(()=>{
            this.connection.sendRequest('GET_PARAMETER', this.connection.url, {
                'Session': this.streams['video'].session
            });
        }, (timeo - 5) * 1000);
    }

    stopKeepAlive() {
        clearInterval(this.keepaliveInterval);
    }

    sendSetup() {
        this.remuxer = new Remuxer(this.player);
        this.remuxer.attachMSE(this.mse);
        this.remuxer.eventSource.addEventListener('stop', this.stopStreamFlush.bind(this));
        this.remuxer.eventSource.addEventListener('error', (e)=>{
            alert(e.detail.reason);
            this.stopStreamFlush();
        });

        if (this.tracks.length > 1) {
            let track_type = this.tracks[0];
            let track = this.sdp.getMediaBlock(track_type);
            this.streams[track_type] = new RTSPStream(this, track);
            this.remuxer.setTrack(track, this.streams[track_type]);
            this.streams[track_type].sendSetup().then(()=>{
                let track_type = this.tracks[1];
                let track = this.sdp.getMediaBlock(track_type);
                this.streams[track_type] = new RTSPStream(this, track);
                this.streams[track_type].session = this.streams['video'].session;
                this.remuxer.setTrack(track, this.streams[track_type]);
                let playPromise = this.streams[track_type].start();
                playPromise.then(({track, data})=>{
                    var idx;
                    let timeOffset = 0;
                    try {
                        let rtp_infos = data.headers["rtp-info"].split(',');
                        for (idx = 0; idx < 2; idx++) {
                            let rtp_info = rtp_infos[idx];
                            let _array = rtp_info.split('=');
                            timeOffset = Number(_array[_array.length - 1]);
                            this.remuxer.setTimeOffset(timeOffset, this.sdp.getMediaBlock(this.tracks[idx]));
                        }
                    } catch (e) {
                        timeOffset = new Date().getTime();
                        for (idx = 0; idx < 2; idx++) {
                            this.remuxer.setTimeOffset(timeOffset, this.sdp.getMediaBlock(this.tracks[idx]));
                        }
                    }

                    this.eventSource.dispatchEvent('playing');
                    this.startKeepAlive(this.timeout);
                });
            });
        } else {
            let track_type = this.tracks[0];
            let track = this.sdp.getMediaBlock(track_type);
            this.streams[track_type] = new RTSPStream(this, track);
            this.remuxer.setTrack(track, this.streams[track_type]);
            let playPromise = this.streams[track_type].start();
            playPromise.then(({track, data})=>{
                let timeOffset = 0;
                try {
                    let rtp_info = data.headers["rtp-info"].split(';');
                    timeOffset = Number(rtp_info[rtp_info.length - 1].split("=")[1]);
                } catch (e) {
                    timeOffset = new Date().getTime();
                }
                this.remuxer.setTimeOffset(timeOffset, track);

                this.eventSource.dispatchEvent('playing');

                this.startKeepAlive(this.timeout);
            });
        }

        this.connection.backend.setRtpHandler(this.onRTP.bind(this));
        return new Promise((resolve, reject)=>{
            this.eventSource.addEventListener('playing', resolve);
        });
    }

    onSetup() {
        this.transitionTo(RTSPClientSM.STATE_STREAMS);
    }

    startStreamFlush(intval) {
        this.flushInterval = setInterval(()=>{
            if (this.remuxer) this.remuxer.flush();
        }, intval);
    }

    stopStreamFlush() {
        clearInterval(this.flushInterval);
    }

    onRTP(_data) {
        let needFlush = this.remuxer.feedRTP(new RTP(_data.packet, this.sdp));
        if (needFlush) {
            this.remuxer.flush();
        }
    }
}
