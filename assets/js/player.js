var state = {
  PLAY: "PLAY",
  STOP: "STOP",
  PAUSE: "PAUSE",
  END: "END"
};

var mimeTypes = {
  VIDEO: "video"
};

var log = {
  info: function(msg, context) {
    context = context ? context : "PLAYER";
    console.info(context, msg);
  },
  warning: function(msg, context) {
    context = context ? context : "PLAYER";
    console.warn(context, msg);
  },
  error: function(msg, context) {
    context = context ? context : "PLAYER";
    console.error(context, msg);
  }
};

function Player() {
  this._videoElement = null;
  this._playlistUrl = null;
  this._baseUrl = null;
  this._videoTrack = null;
  this._metaInfo = {};
  this._playerState = {
    state: state.STOP,
    time: null,
    segment: 1,
    segmentBlobs: null,
    video: null,
    mimeType: null
  }
}

Player.prototype.handleError = function(error) {
  console.error(error);
};

Player.prototype.setVideoElement = function(video) {
  this._videoElement = video;
};

Player.prototype.setPlaylistUrl = function(url) {
  this._playlistUrl = url;
  this._baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
};

Player.prototype.setVideoTrack = function(id) {
  this._videoTrack = id;
  this.setMediaRepresentation(mimeTypes.VIDEO, id);
  this.triggerTrackStateEvent(mimeTypes.VIDEO, id);
  log.info(id, "setVideoTrack");
};

Player.prototype.toggle = function() {
  if(this._playerState.state === state.PLAY) {
    this._playerState.state = state.PAUSE;
  }
  else {
    this._playerState.state = state.PLAY;
    this.videoInit();
  }
  this.triggerPlayerStateEvent();
};

Player.prototype.stop = function() {
  this._playerState.state = state.STOP;
  this.triggerPlayerStateEvent();
};

Player.prototype.triggerPlayerStateEvent = function() {
  var e = new CustomEvent("player-state", {
    detail: this._playerState.state
  });
  document.dispatchEvent(e);
};

Player.prototype.triggerTrackStateEvent = function(type, track) {
  var e = new CustomEvent("track-state", {
    detail: {
      track: track,
      type: type
    }
  });
  document.dispatchEvent(e);
};

Player.prototype.download = function(url, cb, options) {
  var xhttp = new XMLHttpRequest();

  xhttp.open('GET', url);
  xhttp.onreadystatechange = function() {
    if (xhttp.readyState === 4) {
      if (xhttp.status === 200) {
        cb(xhttp.response);
      } else {
        log.error(xhttp.response);
      }
    }
  };

  // Response should be raw data
  if(options && options.range) {
    xhttp.setRequestHeader("Range", "bytes=" + options.range);
  }

  if(options && options.arrayBuffer) {
    log.info("Response is an arrayBuffer");
    xhttp.responseType = 'arraybuffer';
  }

  // Send Request
  xhttp.send();
};

Player.prototype.getAttributes = function(xml) {
  var obj = {};
  if(xml) {
    var attr = xml.attributes;
    for(var i=0; i < attr.length; i++) {
      if(attr[i]) {
        obj[attr[i].name] = attr[i].value;
      }
    }
  } else {
    log.error("Got no XML attributes", "getAttributes");
    log.error(xml, "getAttributes");
  }
  return obj;
};

Player.prototype.parseMetaInfoVideo = function(xml, meta) {
  var rep = xml.querySelectorAll("Representation");
  for(var i=0; i < rep.length; i++) {
    meta.representation[i] = this.getAttributes(rep[i]);
    var segTemplate = xml.querySelector("SegmentTemplate");
    meta.representation[i].segmentTemplate = this.getAttributes(segTemplate);
    meta.representation[i]._id = i;
  }
  this._metaInfo.video.push(meta);
};

Player.prototype.parseDuration = function(duration) {
  duration = duration.replace('PT', '');
  var hourIndex = duration.indexOf('H');
  var minuteIndex = duration.indexOf('M');
  var secondsIndex = duration.indexOf('S');
  var hour = parseFloat(duration.substr(0, hourIndex));
  var minute = parseFloat(duration.substr(++hourIndex, minuteIndex));
  var seconds = parseInt(duration.substr(++minuteIndex, secondsIndex));
  this._metaInfo.mpd.duration = (hour * 3600) + (minute * 60) + seconds;
};

Player.prototype.calculateSegmentSize = function(segmentDuration, timescale) {
  var mediaDuration = this.parseDuration(this._metaInfo.mpd.mediaPresentationDuration);
  return parseInt(mediaDuration / (segmentDuration / timescale));
};

Player.prototype.parseMetaInfo = function(xml) {
  try {
    this._metaInfo['mpd'] = {};
    this._metaInfo['video'] = [];

    // Get file MPD meta data
    var mpd = xml.querySelector("MPD");
    this._metaInfo.mpd = this.getAttributes(mpd);

    // Parse Duration from ISO String
    this.parseDuration(this._metaInfo.mpd.mediaPresentationDuration);

    // Get adaptionsets
    var adaptionSets = xml.querySelectorAll("AdaptationSet");

    // Iterate through adaption sets
    for(var i=0; i < adaptionSets.length; i++) {
      var curr = adaptionSets[i].getAttribute('mimeType');
      var meta = {
        adaptationSet: this.getAttributes(adaptionSets[i]),
        representation: []
      };

      if(curr.indexOf('video') != -1) {
        this.parseMetaInfoVideo(adaptionSets[i], meta);
      }
    }
    log.info(this._metaInfo);
    return this._metaInfo;

  } catch (e) {
    this.handleError(e);
  }
};

Player.prototype.downloadPlaylist = function(cb) {
  var self = this;
  this.download(this._playlistUrl, function(res) {
    try {
      var parser = new DOMParser();
      var xml = parser.parseFromString(res, "text/xml");
      cb(self.parseMetaInfo(xml));
    } catch (e) {
      self.handleError(e);
    }
  });
};

Player.prototype.setMediaRepresentation = function(type, id) {
  var element = this._metaInfo[type];
  var self = this;
  if(element.length) {
    element.forEach(function(elItem) {
      elItem.representation.forEach(function(representation) {
        if(representation.id === id) {
          self._playerState[type] = representation;
        }
      })
    })
  }
  log.info(this._playerState)
};

Player.prototype.getNextUrl = function() {
  var segment = this._playerState.segment;
  var track = this._playerState.video;
  var media = track.segmentTemplate.media;
  media = media.replace("$Number$", segment.toString());
  this._playerState.segment++;
  var url = this._baseUrl;
  return url + media;
};

Player.prototype.downloadNext = function(buffer) {
  log.info("download")
  var self = this;
  var next = self.getNextUrl();
  log.info(next)
  if(self._playerState.segment > 70) return;
  else {

    self.download(next, function(res) {
      buffer.addEventListener('updateend', func);
      buffer.appendBuffer(new Uint8Array(res));
    }, {arrayBuffer: true});

    var func = function() {
      buffer.removeEventListener('updateend', func);
      self.downloadNext(buffer);
    };
  }
};

Player.prototype.videoInit = function() {
  var self = this;
  this._videoElement.innerHTML = "";
  var video = this._playerState.video;
  this._videoElement.pause();
  var mimeType = 'video/mp4; codecs="' + video.codecs + '"';
  this._playerState.mimeType = mimeType;

  this._videoElement.height = parseInt(video.height * 0.4);
  this._videoElement.width = parseInt(video.width * 0.4);

  if ('MediaSource' in window && MediaSource.isTypeSupported(mimeType)) {
    var mediaSource = new MediaSource;
    this._videoElement.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', function(e) {
      var mimeTypeVideo = 'video/mp4; codecs="' + self._playerState.video.codecs + '"';

      try {
        var buffer = mediaSource.addSourceBuffer(mimeTypeVideo);

        self.download("http://project.dev/stream/files/720p/segment_init.mp4", function(res) {
          buffer.addEventListener('updateend', func);

          buffer.appendBuffer(new Uint8Array(res));
        }, {arrayBuffer: true});

        var func = function() {
          buffer.removeEventListener('updateend', func);
          self.downloadNext(buffer);
        };

      } catch (e) {
        log.error('Exception calling addSourceBuffer for video', e);
      }
    });
  } else {
    console.error('Unsupported MIME type or codec: ', mimeType);
  }
};

Player.prototype.init = function() {
  this.triggerPlayerStateEvent();
};


