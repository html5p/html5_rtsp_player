export {RTSP_CONFIG} from './config';
import {RTSPClientSM} from './rtsp/client';
import {RTSPWebsocketBackend} from './rtsp/connection';
import {RTSPConnection} from './rtsp/connection';
import {Url} from './util/url';

export class RTSPPlayer {
    constructor(player, url) {
        this.player = player;
        this.url = url;

        player.addEventListener('contextmenu', (e)=>{
            e.preventDefault();
        });
    }

    start() {
        let parsed = Url.parse(this.url);
        this.connection = new RTSPConnection(parsed.host, parsed.port, parsed.urlpath, {}, RTSPWebsocketBackend);
        this.client = new RTSPClientSM(this.connection, this.player);
        this.client.transitionTo(RTSPClientSM.STATE_OPTIONS);
    }

    stop() {
        if (this.client.currentState.name != RTSPClientSM.STATE_INITIAL) {
            this.client.transitionTo(RTSPClientSM.STATE_TEARDOWN);
        }
    }
}

export function attach(player) {
    let rtsp_player = new RTSPPlayer(player, player.getAttribute('rtsp_url'));
    if (player.getAttribute('autoplay') !== null) {
        rtsp_player.start();
    }
    return rtsp_player;
}