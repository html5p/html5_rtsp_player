## Overview

html5_rtsp_player.js is a Javascript library which implements RTSP client for watching live streams in your browser 
that works directly on top of a standard HTML <video> element. 
It requires support of HTML5 Video with Media Sources Extensions for playback. Also player relies on server-side websocket 
proxy for retransmitting RTSP streams to browser.

![](https://www.specforge.com/images/html5_player.png)
      
It works by muxing RTP h.264 and MP4A-LATM payload into ISO BMFF (MP4) fragments. 

html5_rtsp_player.js is written in ECMAScript6, and transpired in ECMAScript5 using Babel.

```
* HLS player link
* Here you can find HLS player over websocket  https://github.com/SpecForge/html5_hls_player
```

## Live test stream

Link to server running with websock_rtsp_proxy and test page http://specforge.com/html5playerstream/index.html

HTML5 Player update test page
We've added such feature which supports Local Fast Playback mode up to 2 minutes duration. 
In this mode, you can view the video at a speed of x0,5 to x5. 
* If you want activate this mode, click on timeline.
* To return to normal playback rate, press «live».
This mode is useful to see what you missed.

Browser support: 

* Firefox v.42+
* Chrome v.23+
* OSX Safari v.8+
* MS Edge v.13+
* Opera v.15+
* Android browser v.5.0+
* IE Mobile v.11+

Not supported in iOS Safari and Internet Explorer

## Install

npm install git://github.com/SpecForge/html5_rtsp_player.git

## Usage

### Browser side

Attach HTML Video with RTSP URL
```
<video id="test_video" controls autoplay src="rtsp://your_rtsp_stream/url"></video>
```

Setup player in your js:

```
import * as rtsp from 'rtsp_player';

rtsp.RTSP_CONFIG['websocket.url'] = "ws://websocket_proxy_address/ws"; // You should specify address of proxy described below

let player = rtsp.attach(document.getElementById('test_video'));
```

ES6 Modules support is required. You can use webpack with babel loader to build this script:

webpack.config.js
```
const PATHS = {
    src: {
        test: path.join(__dirname, 'test.js')
    },
    dist: __dirname
};

module.exports = {
    entry: PATHS.src,
    output: {
        path: PATHS.dist,
        filename: '[name].bundle.js'
    },
    module: {
        loaders: [
            {
                test: /\.js$/,
                loader: 'babel',
                query: {
                    presets: ['es2015', 'stage-3', 'stage-2', 'stage-1', 'stage-0']
                }
            }
        ]
    },
    resolve: {
        alias: {
            rtsp: path.join(__dirname,'node_modules/html5_rtsp/src')
        }
    }
};
```


```
> npm install bp_event bp_logger bp_statemachine
> webpack --config webpack.config.js
```

Include compiled script into your HTML:

```
<script src="test.bundle.js"></script>
```

### Server side

1. Install websocket proxy

    For Debian-based systems (tested on Ubuntu 16.04):
        
    ```
    wget -O - http://repo.tom.ru/deb/specforge.gpg.key | sudo apt-key add -
    wget http://repo.tom.ru/deb/pool/non-free/w/ws-rtsp-repo/ws-rtsp-repo_1.3_all.deb
    dpkg -i ./ws-rtsp-repo_1.3_all.deb
    apt update
    apt install ws-rtsp-proxy # Debian-based systems
    ```

    or Fedora:
    
    ```
    dnf install http://repo.tom.ru/rpm/websock_rtsp_repo-1-0.noarch.rpm
    dnf install websock_rtsp_proxy
    ```

    Note that this package depends on systemd and gcc5+ runtime so it can be installed 
    only on recent distribution versions. 

2. Configure port in /etc/ws_rtsp.ini

    This port should be open in your firewall. Also you can pass request to this port from your proxy. (for example: http://nginx.org/en/docs/http/websocket.html) 

3. Run it

```
> service ws_rtsp start
```


### How RTSP proxy works?

RTSP player establish connection with proxy with following protocol:

1. Connect to RTSP channel by connecting websocket with "rtsp" protocol specified and get connection id

    ```
    c>s:
    WSP 1.0 INIT\r\n
    host <RTSP stream host>\r\n
    port <RTSP stream port>\r\n\r\n
    
    s>c:
    INIT <connection_id>\r\n\r\n
    
    conection_id = -1 means error
    ```

2. Connect to RTP channel by connecting websocket with "rtp" protocol

    ```
    c>s:
    WSP 1.0 INIT\r\n
    RTSP <connection_id achieved from RTSP socket initialization>\r\n\r\n
    
    s>c:
    INIT <connection_id>\r\n\r\n
    
    conection_id = -1 means error
    ```

3. RTP channel should send interleaved data with 4 byte header ($\<channel\>\<size\>). Separate RTP is not supported at this moment

![](https://www.specforge.com/images/ws_rtsp_proxy.png)


Have any suggestions to improve our player? 
Feel free to leave comments or ideas  specforge@gmail.com