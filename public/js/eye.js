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
  const calibOverlay = document.getElementById('calib-overlay');
  const calibRoleLabel = document.getElementById('calib-role-label');
  const btnCalibValidate = document.getElementById('btn-calib-validate');
  const btnCalibReset = document.getElementById('btn-calib-reset');

  const sideName = side === 'right' ? 'Œil Droit' : 'Œil Gauche';
  if (calibRoleLabel) calibRoleLabel.textContent = `📐 Calibrage ${sideName}`;
  document.title = `Dragon Eye (${sideName})`;

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
  let isCalibrating = false;
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

  // Set video source
  const videoSrc = side === 'right' ? '/media/right_eye.mp4' : '/media/left_eye.mp4';
  video.src = videoSrc;
  video.load();

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

  // Fullscreen Landscape & Screen Wake Lock
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

    requestWakeLock();
    initWebAudio();
  }

  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        isWakeLockActive = true;
        wakeLockSentinel.addEventListener('release', () => {
          isWakeLockActive = false;
        });
      } catch (err) {
        isWakeLockActive = false;
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isWakeLockActive) {
      requestWakeLock();
    }
  });

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

    const now = Date.now();
    tapTimes.push(now);
    // Keep only taps within 700ms
    tapTimes = tapTimes.filter(t => now - t < 700);

    // Triple tap detected -> Toggle manual calibration mode
    if (tapTimes.length >= 3) {
      tapTimes = [];
      toggleCalibration();
      return;
    }

    // 2-finger double tap also toggles calibration mode
    if (e.touches.length === 2 && tapTimes.length >= 2) {
      tapTimes = [];
      toggleCalibration();
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

  // Calibration Mode Management
  function toggleCalibration() {
    if (isCalibrating) {
      exitCalibration();
    } else {
      enterCalibration();
    }
  }

  function enterCalibration() {
    isCalibrating = true;
    calibOverlay.classList.remove('hidden');
    standbyOverlay.classList.remove('active');

    // Show eye frame so the user can frame it with fingers
    if (!isShowPlaying) {
      video.currentTime = Math.min(3.0, (video.duration || 10) / 2);
      video.play().then(() => {
        // Pause shortly after showing first frame if show is idle
        setTimeout(() => {
          if (!isShowPlaying && isCalibrating) video.pause();
        }, 150);
      }).catch(() => {});
    }
  }

  function exitCalibration() {
    isCalibrating = false;
    calibOverlay.classList.add('hidden');
    saveTransform();

    // If show is not currently playing, return to 100% pure black OLED
    if (!isShowPlaying) {
      video.pause();
      video.currentTime = 0;
      standbyOverlay.classList.add('active');
    }
  }

  btnCalibValidate.addEventListener('click', (e) => {
    e.stopPropagation();
    exitCalibration();
  });

  btnCalibReset.addEventListener('click', (e) => {
    e.stopPropagation();
    transform.scale = 1.0;
    transform.posX = 0;
    transform.posY = 0;
    transform.rotation = 0;
    transform.flipX = false;
    applyTransform();
    saveTransform();
  });

  if (isCalibInit) {
    enterCalibration();
  }

  // Socket.IO & Sync Engine
  const socket = io();
  const syncEngine = new DragonSyncClient(socket);
  syncEngine.start(2500);

  socket.on('connect', () => {
    socket.emit('client:register', {
      role: 'eye',
      side: side,
      deviceName: `${sideName} (${navigator.platform || 'Mobile'})`
    });
    enterFullscreenLandscape();
  });

  socket.on('show:state', ({ appState }) => {
    showDuration = appState.videoDuration || 94.17;
    if (appState.audioConfig) {
      currentAudioConfig = appState.audioConfig;
      setupAudioRouting(currentAudioConfig);
    }
    if (appState.activeAudio) {
      currentAudioFile = appState.activeAudio;
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

  socket.on('audio:selected', ({ activeAudio }) => {
    if (activeAudio) {
      currentAudioFile = activeAudio;
      eyeAudio.src = currentAudioFile;
      eyeAudio.load();
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
    video.src = newSrc;
    video.load();
    if (data.activeAudio) {
      currentAudioFile = data.activeAudio;
      eyeAudio.src = currentAudioFile;
      eyeAudio.load();
    }
  });

  // START SYNCHRONIZED PLAYBACK
  function startSyncPlayback(startTime, duration, loop) {
    isShowPlaying = true;
    showStartTime = startTime;
    showDuration = duration;

    // Hide calibration overlay and standby veil
    isCalibrating = false;
    calibOverlay.classList.add('hidden');
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

    if (waitMs > 0) {
      video.currentTime = 0;
      if (currentAudioConfig.playOnEyes) eyeAudio.currentTime = 0;
      setTimeout(() => {
        executePlay();
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

  // CONTINUOUS PRECISION SYNC LOOP
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

      // 1. Sync Video
      const drift = video.currentTime - targetTime;
      lastDriftMs = Math.round(drift * 1000);

      if (Math.abs(drift) > 0.18) {
        video.currentTime = targetTime;
        video.playbackRate = 1.0;
      } else if (drift > 0.035) {
        video.playbackRate = 0.96;
      } else if (drift < -0.035) {
        video.playbackRate = 1.04;
      } else {
        video.playbackRate = 1.0;
      }

      // 2. Sync Audio (if enabled on eyes)
      if (currentAudioConfig.playOnEyes && !eyeAudio.paused) {
        const audioDrift = eyeAudio.currentTime - targetTime;
        if (Math.abs(audioDrift) > 0.08) {
          eyeAudio.currentTime = targetTime;
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

    eyeAudio.pause();
    eyeAudio.currentTime = 0;

    // Return to 100% pure black OLED
    standbyOverlay.classList.add('active');
  }

  // Telemetry heartbeat to master
  setInterval(() => {
    if (socket.connected) {
      socket.emit('eye:telemetry', {
        side: side,
        currentTime: video.currentTime,
        driftMs: lastDriftMs,
        state: isShowPlaying ? 'playing' : 'idle',
        wakeLock: isWakeLockActive,
        fullscreen: !!(document.fullscreenElement || document.webkitFullscreenElement)
      });
    }
  }, 500);

})();
