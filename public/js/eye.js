/**
 * Dragon Eyes - Eye OLED Client Logic
 * Pure Black OLED Standby • Fullscreen Landscape • Tactile Pan & Dézoom • Synchronized Video & Split Stereo Audio
 */
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const side = (urlParams.get('side') || 'left').toLowerCase(); // 'left' or 'right'
  const isCalibInit = urlParams.get('calib') === '1';

  // DOM Elements
  const video = document.getElementById('eye-video');
  const eyeAudio = document.getElementById('eye-audio');
  const touchSurface = document.getElementById('touch-surface');
  const standbyOverlay = document.getElementById('standby-overlay');
  let btnValidateFraming = document.getElementById('btn-validate-framing');

  const sideName = side === 'right' ? 'Œil Droit' : 'Œil Gauche';
  document.title = `Dragon Eye (${sideName})`;

  // Framing & Calibration State
  // Frame at 8.0s corresponds to dragon eye wide open and vibrant (before 4.7s video is black)
  const FRAMING_TIMESTAMP = 8.0;
  let isFramingValidated = !isCalibInit && sessionStorage.getItem(`dragon_framing_done_${side}`) === 'true';

  // Transform state (Pan & Zoom/Dézoom)
  let transform = {
    scale: 1.0,
    posX: 0,
    posY: 0,
    rotation: 0,
    flipX: false
  };

  // Show state
  let isShowPlaying = false;
  let showStartTime = null;
  let showDuration = 94.17;
  let stopAfterCurrentLoop = false;
  let lastDriftMs = 0;
  let lastHardSeekTime = 0;
  let startupGraceUntil = 0;
  let wakeLockSentinel = null;
  let isWakeLockActive = false;
  let syncAnimationId = null;

  // Audio Config & Web Audio API Routing
  let currentAudioFile = '/media/default_audio.mp3';
  let currentAudioConfig = {
    playOnMaster: true,
    playOnEyes: false,
    splitStereo: true
  };
  let audioCtx = null;
  let audioSourceNode = null;
  let splitterNode = null;
  let mergerNode = null;

  // Local Media Cache (IndexedDB Blob storage)
  const mediaCache = new DragonMediaCache();
  let isMediaCached = false;
  let mediaCachePercent = 0;
  let currentMediaVersion = '1';

  // Load saved calibration from localStorage
  const storageKey = `dragon_calib_${side}`;
  const savedCalib = localStorage.getItem(storageKey);
  if (savedCalib) {
    try {
      transform = Object.assign(transform, JSON.parse(savedCalib));
    } catch (e) {
      console.warn('Failed to parse saved calibration:', e);
    }
  }

  // Set initial video source
  const videoSrc = side === 'right' ? '/media/right_eye.mp4' : '/media/left_eye.mp4';
  
  // Asynchronously ensure media is 100% cached locally before show
  async function ensureMediaCached(vUrl, aUrl, version = '1') {
    try {
      currentMediaVersion = String(version);
      
      // 1. Cache Video Blob (takes ~90% of file size)
      const vBlobUrl = await mediaCache.load(vUrl, `video_${side}`, currentMediaVersion, (p) => {
        mediaCachePercent = Math.round(p * 0.9);
      });
      if (vBlobUrl) {
        video.src = vBlobUrl;
        video.load();
      }

      // 2. Cache Audio Blob (takes ~10% of file size)
      if (aUrl) {
        const aBlobUrl = await mediaCache.load(aUrl, 'audio_main', currentMediaVersion, (p) => {
          mediaCachePercent = 90 + Math.round(p * 0.1);
        });
        if (aBlobUrl) {
          eyeAudio.src = aBlobUrl;
          eyeAudio.load();
        }
      }

      isMediaCached = true;
      mediaCachePercent = 100;
      console.log(`[MediaCache] 🚀 ${sideName} : 100% en cache local (0 réseau pendant la lecture)`);
    } catch (err) {
      console.warn('[MediaCache] Fallback to direct network streaming:', err);
      video.src = vUrl;
      video.load();
      if (aUrl) {
        eyeAudio.src = aUrl;
        eyeAudio.load();
      }
    }
  }
  ensureMediaCached(videoSrc, currentAudioFile, currentMediaVersion);

  // Apply Transform to Video (Pure black borders when scale < 1.0)
  function applyTransform() {
    const scaleX = transform.flipX ? -transform.scale : transform.scale;
    video.style.transform = `translate(${transform.posX}px, ${transform.posY}px) scale(${scaleX}, ${transform.scale}) rotate(${transform.rotation}deg)`;
  }
  applyTransform();

  function saveTransform() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(transform));
    } catch (e) {
      console.warn('Could not save calibration:', e);
    }
  }

  // Web Audio Setup & Stereo Splitting
  function initWebAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
      try {
        audioSourceNode = audioCtx.createMediaElementSource(eyeAudio);
        splitterNode = audioCtx.createChannelSplitter(2);
        mergerNode = audioCtx.createChannelMerger(2);
        setupAudioRouting(currentAudioConfig);
      } catch (e) {
        console.warn('Web Audio node setup warning:', e);
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function setupAudioRouting(cfg) {
    if (!audioCtx || !audioSourceNode) return;
    try {
      audioSourceNode.disconnect();
      if (splitterNode) splitterNode.disconnect();
      if (mergerNode) mergerNode.disconnect();

      if (!cfg.playOnEyes) {
        return; // Muted / disconnected on eyes
      }

      if (cfg.splitStereo) {
        // Split stereo: Left channel to left eye, Right channel to right eye
        audioSourceNode.connect(splitterNode);
        const channelIndex = side === 'right' ? 1 : 0;
        // Connect this channel to both output channels (0 = Left, 1 = Right) of the phone's speakers
        splitterNode.connect(mergerNode, channelIndex, 0);
        splitterNode.connect(mergerNode, channelIndex, 1);
        mergerNode.connect(audioCtx.destination);
      } else {
        // Non-separated: full stereo track to speakers
        audioSourceNode.connect(audioCtx.destination);
      }
    } catch (e) {
      console.warn('Audio routing adjustment warning:', e);
    }
  }

  // Fullscreen Landscape, Screen Wake Lock & Brightness
  async function enterFullscreenLandscape() {
    try {
      const docEl = document.documentElement;
      const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
      if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
        await req.call(docEl);
      }
    } catch (e) {
      // Ignore user gesture errors
    }

    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {
        screen.orientation.lock('landscape-primary').catch(() => {});
      });
    }

    // Try experimental max screen brightness if supported by browser/device
    if ('screen' in window && 'brightness' in window.screen) {
      try { window.screen.brightness = 1.0; } catch (e) {}
    }

    requestWakeLock();
    initWebAudio();
  }

  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        if (!wakeLockSentinel || wakeLockSentinel.released) {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
          isWakeLockActive = true;
          wakeLockSentinel.addEventListener('release', () => {
            isWakeLockActive = false;
          });
        }
      } catch (err) {
        isWakeLockActive = false;
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });

  // Permanently maintain Wake Lock active (prevents screen dimming or sleep)
  setInterval(() => {
    if (document.visibilityState === 'visible' && !isWakeLockActive) {
      requestWakeLock();
    }
  }, 3000);

  // Touch Manipulation: 1 finger Pan, 2 fingers Pinch-to-zoom / Dézoom
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartPosX = 0;
  let touchStartPosY = 0;
  let touchStartDistance = 0;
  let touchStartScale = 1.0;

  // Tap detection for silent arming & triple-tap calibration toggle
  let tapTimes = [];

  function getDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  touchSurface.addEventListener('touchstart', (e) => {
    // Silently ensure fullscreen, landscape and wakeLock on any touch
    enterFullscreenLandscape();

    // If framing is not yet validated and video is not playing, make sure 8s frame is rendered
    if (!isFramingValidated && !isShowPlaying && Math.abs(video.currentTime - FRAMING_TIMESTAMP) > 0.5) {
      showFramingFrame();
    }

    const now = Date.now();
    tapTimes.push(now);
    // Keep only taps within 700ms
    tapTimes = tapTimes.filter(t => now - t < 700);

    // Triple tap detected -> Restore framing mode if operator needs to adjust
    if (tapTimes.length >= 3) {
      tapTimes = [];
      restoreFramingMode();
      return;
    }

    const isPortrait = window.innerHeight > window.innerWidth;

    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartPosX = transform.posX;
      touchStartPosY = transform.posY;
    } else if (e.touches.length === 2) {
      touchStartDistance = getDistance(e.touches[0], e.touches[1]);
      touchStartScale = transform.scale;
      touchStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      touchStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      touchStartPosX = transform.posX;
      touchStartPosY = transform.posY;
    }
  }, { passive: true });

  touchSurface.addEventListener('touchmove', (e) => {
    const isPortrait = window.innerHeight > window.innerWidth;

    if (e.touches.length === 1) {
      let dx = e.touches[0].clientX - touchStartX;
      let dy = e.touches[0].clientY - touchStartY;

      // Adjust coordinates if rotated by CSS in portrait orientation
      if (isPortrait) {
        const tempDx = dy;
        const tempDy = -dx;
        dx = tempDx;
        dy = tempDy;
      }

      transform.posX = touchStartPosX + dx;
      transform.posY = touchStartPosY + dy;
      applyTransform();
    } else if (e.touches.length === 2 && touchStartDistance > 0) {
      const dist = getDistance(e.touches[0], e.touches[1]);
      const factor = dist / touchStartDistance;

      // Scale can go down to 0.05x (arbitrary dézoom with pure black borders) up to 5.0x
      transform.scale = Math.max(0.05, Math.min(5.0, touchStartScale * factor));

      // Simultaneous 2-finger pan
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      let dx = midX - touchStartX;
      let dy = midY - touchStartY;

      if (isPortrait) {
        const tempDx = dy;
        const tempDy = -dx;
        dx = tempDx;
        dy = tempDy;
      }

      transform.posX = touchStartPosX + dx;
      transform.posY = touchStartPosY + dy;
      applyTransform();
    }
  }, { passive: true });

  touchSurface.addEventListener('touchend', (e) => {
    saveTransform();
  }, { passive: true });

  // Framing Mode Display (Dragon eye visible at 8.0s for pan/zoom adjustments)
  function showFramingFrame() {
    if (isShowPlaying || isFramingValidated) return;
    standbyOverlay.classList.remove('active');

    try {
      video.currentTime = FRAMING_TIMESTAMP;
    } catch (e) {}

    // Force video decoder to draw the frame
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        setTimeout(() => {
          if (!isShowPlaying && !isFramingValidated) {
            video.pause();
            video.currentTime = FRAMING_TIMESTAMP;
          }
        }, 120);
      }).catch(() => {
        // Autoplay policy prevented playback without touch gesture;
        // The first touchstart will render it.
      });
    }
  }

  video.addEventListener('loadeddata', () => {
    if (!isFramingValidated && !isShowPlaying) showFramingFrame();
  });
  video.addEventListener('canplay', () => {
    if (!isFramingValidated && !isShowPlaying) showFramingFrame();
  });

  // Complete Framing: permanently remove button and switch to 100% pure black OLED
  function completeFraming() {
    isFramingValidated = true;
    sessionStorage.setItem(`dragon_framing_done_${side}`, 'true');
    saveTransform();

    const btn = document.getElementById('btn-validate-framing');
    if (btn) {
      btn.classList.add('hidden');
      btn.remove();
    }

    if (!isShowPlaying) {
      video.pause();
      video.currentTime = 0;
      standbyOverlay.classList.add('active');
    }
  }

  // Restore framing mode (e.g. discreet triple-tap emergency adjustment)
  function restoreFramingMode() {
    if (isShowPlaying) return;
    isFramingValidated = false;
    sessionStorage.removeItem(`dragon_framing_done_${side}`);

    let btn = document.getElementById('btn-validate-framing');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'btn-validate-framing';
      btn.className = 'corner-validate-btn';
      btn.type = 'button';
      btn.textContent = '✓ Valider le cadrage';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        completeFraming();
      });
      document.body.appendChild(btn);
    } else {
      btn.classList.remove('hidden');
    }

    showFramingFrame();
  }

  // Initial Framing State setup
  if (isFramingValidated) {
    if (btnValidateFraming) btnValidateFraming.remove();
    standbyOverlay.classList.add('active');
  } else {
    standbyOverlay.classList.remove('active');
    if (btnValidateFraming) {
      btnValidateFraming.addEventListener('click', (e) => {
        e.stopPropagation();
        completeFraming();
      });
    }
    showFramingFrame();
  }

  // Socket.IO & Sync Engine
  const socket = io();
  const syncEngine = new DragonSyncClient(socket);
  syncEngine.start(1500);

  socket.on('connect', () => {
    socket.emit('client:register', {
      role: 'eye',
      side: side,
      deviceName: `${sideName} (${navigator.platform || 'Mobile'})`
    });
    enterFullscreenLandscape();
  });

  socket.on('show:state', ({ appState, serverTime }) => {
    if (serverTime) {
      syncEngine.seedOffset(serverTime);
    }
    showDuration = appState.videoDuration || 94.17;
    if (appState.audioConfig) {
      currentAudioConfig = appState.audioConfig;
      setupAudioRouting(currentAudioConfig);
    }
    if (appState.activeAudio) {
      currentAudioFile = appState.activeAudio;
    }
    if (appState.mediaVersion && appState.mediaVersion !== currentMediaVersion) {
      ensureMediaCached(videoSrc, currentAudioFile, appState.mediaVersion);
    }
    if (appState.status === 'playing') {
      startSyncPlayback(appState.startTime, appState.videoDuration, appState.loop);
    }
  });

  socket.on('audio:config_updated', ({ audioConfig }) => {
    if (audioConfig) {
      currentAudioConfig = audioConfig;
      setupAudioRouting(currentAudioConfig);
      if (!currentAudioConfig.playOnEyes && !eyeAudio.paused) {
        eyeAudio.pause();
        eyeAudio.currentTime = 0;
      }
    }
  });

  socket.on('audio:selected', ({ activeAudio, mediaVersion: v }) => {
    if (activeAudio) {
      currentAudioFile = activeAudio;
      ensureMediaCached(videoSrc, currentAudioFile, v || Date.now());
    }
  });

  socket.on('show:started', (data) => {
    showDuration = data.videoDuration;
    stopAfterCurrentLoop = false;
    if (data.audioConfig) {
      currentAudioConfig = data.audioConfig;
      setupAudioRouting(currentAudioConfig);
    }
    if (data.audioFile) {
      currentAudioFile = data.audioFile;
    }
    startSyncPlayback(data.startTime, data.videoDuration, data.loop);
  });

  socket.on('show:stopping_after_loop', () => {
    stopAfterCurrentLoop = true;
  });

  socket.on('show:stopped', () => {
    stopPlaybackImmediate();
  });

  socket.on('media:updated', (data) => {
    showDuration = data.videoDuration;
    const newSrc = side === 'right' ? data.videoInfo.rightPath : data.videoInfo.leftPath;
    const newVersion = data.mediaVersion || Date.now();
    ensureMediaCached(newSrc, data.activeAudio || currentAudioFile, newVersion);
  });

  // START SYNCHRONIZED PLAYBACK
  function startSyncPlayback(startTime, duration, loop) {
    isShowPlaying = true;
    showStartTime = startTime;
    showDuration = duration;
    lastHardSeekTime = 0;

    // Ensure framing button is permanently removed and standby veil is lifted
    isFramingValidated = true;
    const btn = document.getElementById('btn-validate-framing');
    if (btn) btn.remove();
    standbyOverlay.classList.remove('active');

    enterFullscreenLandscape();

    if (currentAudioConfig.playOnEyes) {
      if (eyeAudio.src !== window.location.origin + currentAudioFile && !eyeAudio.src.endsWith(currentAudioFile)) {
        eyeAudio.src = currentAudioFile;
        eyeAudio.load();
      }
      setupAudioRouting(currentAudioConfig);
    }

    const serverNow = syncEngine.now();
    const waitMs = startTime - serverNow;

    // Grace period gives mobile decoders ~1.8s of smooth start without any hard seeks
    startupGraceUntil = Date.now() + Math.max(0, waitMs) + 1800;

    if (waitMs > 0) {
      video.currentTime = 0;
      if (currentAudioConfig.playOnEyes) eyeAudio.currentTime = 0;
      setTimeout(() => {
        if (isShowPlaying) executePlay();
      }, waitMs);
    } else {
      const elapsed = Math.abs(waitMs) / 1000;
      video.currentTime = elapsed % duration;
      if (currentAudioConfig.playOnEyes) eyeAudio.currentTime = elapsed % duration;
      executePlay();
    }
  }

  function executePlay() {
    video.play().catch(err => console.warn('Video play prevented:', err));

    if (currentAudioConfig.playOnEyes) {
      initWebAudio();
      eyeAudio.play().catch(err => console.warn('Eye audio play prevented:', err));
    }

    if (syncAnimationId) cancelAnimationFrame(syncAnimationId);
    runSyncLoop();
  }

  // CONTINUOUS PRECISION SYNC LOOP (Smooth rate-steering, zero seek-storms)
  function runSyncLoop() {
    if (!isShowPlaying) return;

    const serverNow = syncEngine.now();
    const elapsed = (serverNow - showStartTime) / 1000;

    if (elapsed >= 0) {
      const cycle = Math.floor(elapsed / showDuration);
      const targetTime = elapsed % showDuration;

      // Graceful stop after current loop
      if (stopAfterCurrentLoop && cycle >= 1) {
        stopPlaybackImmediate();
        return;
      }

      // 1. Sync Video with circular wrap-around protection
      let drift = video.currentTime - targetTime;
      if (drift > showDuration / 2) {
        drift -= showDuration;
      } else if (drift < -showDuration / 2) {
        drift += showDuration;
      }

      lastDriftMs = Math.round(drift * 1000);

      const now = Date.now();
      const isStartingUp = now < startupGraceUntil;

      // Only perform drift corrections after the startup grace window
      if (!isStartingUp) {
        // Hard seek ONLY when drift is severe (> 1.2s), video is not already seeking, decoder is ready, and cooldown passed
        if (Math.abs(drift) > 1.20 && !video.seeking && video.readyState >= 2 && (now - lastHardSeekTime > 2000)) {
          lastHardSeekTime = now;
          video.currentTime = targetTime;
          video.playbackRate = 1.0;
        }
        // Smooth multi-tier playbackRate adjustments (seamless, zero stuttering or aborted requests)
        else if (drift > 0.40) {
          video.playbackRate = 0.88; // Ahead by >400ms, slow down
        } else if (drift > 0.12) {
          video.playbackRate = 0.94; // Ahead by 120-400ms, slow down gently
        } else if (drift > 0.025) {
          video.playbackRate = 0.98; // Ahead by 25-120ms, micro adjust
        } else if (drift < -0.40) {
          video.playbackRate = 1.12; // Behind by >400ms, speed up
        } else if (drift < -0.12) {
          video.playbackRate = 1.06; // Behind by 120-400ms, speed up gently
        } else if (drift < -0.025) {
          video.playbackRate = 1.02; // Behind by 25-120ms, micro adjust
        } else {
          video.playbackRate = 1.0;  // Near-perfect lock (< 25ms)!
        }
      } else {
        video.playbackRate = 1.0;
      }

      // 2. Sync Audio (if enabled on eyes)
      if (currentAudioConfig.playOnEyes && !eyeAudio.paused && !isStartingUp) {
        let audioDrift = eyeAudio.currentTime - targetTime;
        if (audioDrift > showDuration / 2) audioDrift -= showDuration;
        else if (audioDrift < -showDuration / 2) audioDrift += showDuration;

        if (Math.abs(audioDrift) > 1.20 && !eyeAudio.seeking && (now - lastHardSeekTime > 2000)) {
          eyeAudio.currentTime = targetTime;
        } else if (audioDrift > 0.04) {
          eyeAudio.playbackRate = 0.96;
        } else if (audioDrift < -0.04) {
          eyeAudio.playbackRate = 1.04;
        } else {
          eyeAudio.playbackRate = 1.0;
        }
      }
    }

    syncAnimationId = requestAnimationFrame(runSyncLoop);
  }

  function stopPlaybackImmediate() {
    isShowPlaying = false;
    if (syncAnimationId) cancelAnimationFrame(syncAnimationId);

    video.pause();
    video.currentTime = 0;
    video.playbackRate = 1.0;

    eyeAudio.pause();
    eyeAudio.currentTime = 0;
    eyeAudio.playbackRate = 1.0;

    lastDriftMs = 0;

    // Return to 100% pure black OLED
    standbyOverlay.classList.add('active');
  }

  // Telemetry heartbeat to master
  setInterval(() => {
    if (socket.connected) {
      socket.emit('eye:telemetry', {
        side: side,
        currentTime: video.currentTime,
        driftMs: isShowPlaying ? lastDriftMs : 0,
        state: isShowPlaying ? 'playing' : 'idle',
        wakeLock: isWakeLockActive,
        fullscreen: !!(document.fullscreenElement || document.webkitFullscreenElement),
        cached: isMediaCached,
        cachePercent: mediaCachePercent
      });
    }
  }, 400);

})();
