/**
 * Dragon Eyes - Eye OLED Client Logic
 */
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const side = (urlParams.get('side') || 'left').toLowerCase(); // 'left' or 'right'

  // DOM Elements
  const video = document.getElementById('eye-video');
  const touchSurface = document.getElementById('touch-surface');
  const standbyOverlay = document.getElementById('standby-overlay');
  const standbyStatusText = document.getElementById('standby-status-text');
  const btnArmPhone = document.getElementById('btn-arm-phone');
  const topBar = document.getElementById('top-bar');
  const roleBadge = document.getElementById('role-badge');
  const calibRoleLabel = document.getElementById('calib-role-label');
  const syncIndicator = document.getElementById('sync-indicator');
  const syncText = document.getElementById('sync-text');
  const wakelockIndicator = document.getElementById('wakelock-indicator');
  const secretUnlockTrigger = document.getElementById('secret-unlock-trigger');
  const calibrationPanel = document.getElementById('calibration-panel');
  const btnClosePanel = document.getElementById('btn-close-panel');
  const btnTogglePanel = document.getElementById('btn-toggle-panel');
  const btnFullscreen = document.getElementById('btn-fullscreen');
  const btnLockCalib = document.getElementById('btn-lock-calib');
  const btnPresetCenter = document.getElementById('btn-preset-center');
  const btnPresetReset = document.getElementById('btn-preset-reset');
  const toast = document.getElementById('toast');

  // Sliders
  const sliderScale = document.getElementById('slider-scale');
  const sliderPosX = document.getElementById('slider-pos-x');
  const sliderPosY = document.getElementById('slider-pos-y');
  const sliderRotation = document.getElementById('slider-rotation');
  const checkFlip = document.getElementById('check-flip');
  const valScale = document.getElementById('val-scale');
  const valPosX = document.getElementById('val-pos-x');
  const valPosY = document.getElementById('val-pos-y');
  const valRotation = document.getElementById('val-rotation');

  // Label setup
  const sideName = side === 'right' ? 'ŒIL DROIT' : 'ŒIL GAUCHE';
  roleBadge.textContent = sideName;
  calibRoleLabel.textContent = side === 'right' ? 'Droit' : 'Gauche';
  document.title = `🐲 ${sideName} - OLED`;

  // Transform state
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
  let wakeLockSentinel = null;
  let isWakeLockActive = false;
  let isLocked = false;
  let syncAnimationId = null;

  // Load saved calibration
  const storageKey = `dragon_calib_${side}`;
  const savedCalib = localStorage.getItem(storageKey);
  if (savedCalib) {
    try {
      transform = Object.assign(transform, JSON.parse(savedCalib));
    } catch (e) {
      console.warn('Failed to parse saved calibration:', e);
    }
  }

  // Update video source
  const videoSrc = side === 'right' ? '/media/right_eye.mp4' : '/media/left_eye.mp4';
  video.src = videoSrc;
  video.load();

  // Apply transform to video
  function applyTransform() {
    valScale.textContent = transform.scale.toFixed(2) + 'x';
    valPosX.textContent = Math.round(transform.posX) + ' px';
    valPosY.textContent = Math.round(transform.posY) + ' px';
    valRotation.textContent = Math.round(transform.rotation) + '°';

    sliderScale.value = transform.scale;
    sliderPosX.value = transform.posX;
    sliderPosY.value = transform.posY;
    sliderRotation.value = transform.rotation;
    checkFlip.checked = transform.flipX;

    const scaleX = transform.flipX ? -transform.scale : transform.scale;
    video.style.transform = `translate(${transform.posX}px, ${transform.posY}px) scale(${scaleX}, ${transform.scale}) rotate(${transform.rotation}deg)`;
  }
  applyTransform();

  // Sliders input events
  sliderScale.addEventListener('input', (e) => {
    transform.scale = parseFloat(e.target.value);
    applyTransform();
  });
  sliderPosX.addEventListener('input', (e) => {
    transform.posX = parseFloat(e.target.value);
    applyTransform();
  });
  sliderPosY.addEventListener('input', (e) => {
    transform.posY = parseFloat(e.target.value);
    applyTransform();
  });
  sliderRotation.addEventListener('input', (e) => {
    transform.rotation = parseFloat(e.target.value);
    applyTransform();
  });
  checkFlip.addEventListener('change', (e) => {
    transform.flipX = e.target.checked;
    applyTransform();
  });

  // Presets
  btnPresetCenter.addEventListener('click', () => {
    transform.posX = 0;
    transform.posY = 0;
    transform.rotation = 0;
    applyTransform();
    showToast('Position recentrée');
  });

  btnPresetReset.addEventListener('click', () => {
    transform.scale = 1.0;
    transform.posX = 0;
    transform.posY = 0;
    transform.rotation = 0;
    transform.flipX = false;
    applyTransform();
    showToast('Réglages réinitialisés');
  });

  // Touch Gestures on Touch Surface (Pinch to Zoom & Pan)
  let touchStartDistance = 0;
  let touchStartScale = 1;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartPosX = 0;
  let touchStartPosY = 0;

  function getDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  touchSurface.addEventListener('touchstart', (e) => {
    if (isLocked) return;
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartPosX = transform.posX;
      touchStartPosY = transform.posY;
    } else if (e.touches.length === 2) {
      touchStartDistance = getDistance(e.touches[0], e.touches[1]);
      touchStartScale = transform.scale;
    }
  }, { passive: true });

  touchSurface.addEventListener('touchmove', (e) => {
    if (isLocked) return;
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      transform.posX = touchStartPosX + dx;
      transform.posY = touchStartPosY + dy;
      applyTransform();
    } else if (e.touches.length === 2 && touchStartDistance > 0) {
      const dist = getDistance(e.touches[0], e.touches[1]);
      const factor = dist / touchStartDistance;
      transform.scale = Math.max(0.5, Math.min(3.5, touchStartScale * factor));
      applyTransform();
    }
  }, { passive: true });

  // Lock and Apply
  btnLockCalib.addEventListener('click', () => {
    localStorage.setItem(storageKey, JSON.stringify(transform));
    lockView();
    showToast('🔒 Calibrage verrouillé & sauvegardé');
  });

  function lockView() {
    isLocked = true;
    calibrationPanel.classList.add('collapsed');
    topBar.classList.add('hidden');
    touchSurface.classList.add('locked');
  }

  function unlockView() {
    isLocked = false;
    calibrationPanel.classList.remove('collapsed');
    topBar.classList.remove('hidden');
    touchSurface.classList.remove('locked');
    showToast('🔓 Mode calibrage actif');
  }

  // Secret unlock: 3 quick taps on trigger or screen
  let secretTapCount = 0;
  let secretTapTimer = null;
  secretUnlockTrigger.addEventListener('click', () => {
    secretTapCount++;
    if (secretTapTimer) clearTimeout(secretTapTimer);
    if (secretTapCount >= 3) {
      secretTapCount = 0;
      unlockView();
    } else {
      secretTapTimer = setTimeout(() => { secretTapCount = 0; }, 800);
    }
  });

  btnTogglePanel.addEventListener('click', () => {
    calibrationPanel.classList.toggle('collapsed');
  });
  btnClosePanel.addEventListener('click', () => {
    calibrationPanel.classList.add('collapsed');
  });

  // Screen Wake Lock API
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        isWakeLockActive = true;
        wakelockIndicator.style.color = '#00e676';
        wakelockIndicator.textContent = '☀️ Anti-veille ACTIF';
        wakeLockSentinel.addEventListener('release', () => {
          isWakeLockActive = false;
          wakelockIndicator.style.color = '#ffb300';
          wakelockIndicator.textContent = '☀️ Anti-veille Relâché';
        });
      } catch (err) {
        console.warn('Wake Lock error:', err);
        isWakeLockActive = false;
        wakelockIndicator.style.color = '#ff3366';
        wakelockIndicator.textContent = '☀️ Anti-veille non supporté';
      }
    }
  }

  // Re-acquire Wake Lock on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isWakeLockActive) {
      requestWakeLock();
    }
  });

  // Fullscreen support
  btnFullscreen.addEventListener('click', () => {
    toggleFullscreen();
  });

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn('Fullscreen request failed:', err);
      });
      requestWakeLock();
    } else {
      document.exitFullscreen();
    }
  }

  btnArmPhone.addEventListener('click', () => {
    // User interaction allows video play & wake lock & fullscreen
    video.play().then(() => {
      video.pause();
      video.currentTime = 0;
    }).catch(() => {});
    requestWakeLock();
    toggleFullscreen();
    btnArmPhone.style.display = 'none';
    standbyStatusText.textContent = 'Prêt ! En attente du signal de la Régie...';
    showToast('⚡ Lecteur prêt & armé');
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('active');
    setTimeout(() => {
      toast.classList.remove('active');
    }, 2500);
  }

  // Socket.IO & Synchronization Engine
  const socket = io();
  const syncEngine = new DragonSyncClient(socket);
  syncEngine.start(2500);

  socket.on('connect', () => {
    syncIndicator.className = 'badge badge-success';
    syncText.textContent = 'Connecté';
    socket.emit('client:register', {
      role: 'eye',
      side: side,
      deviceName: `${sideName} (${navigator.platform || 'Mobile'})`
    });
    requestWakeLock();
  });

  socket.on('disconnect', () => {
    syncIndicator.className = 'badge badge-danger';
    syncText.textContent = 'Déconnecté';
  });

  socket.on('show:state', ({ appState }) => {
    showDuration = appState.videoDuration || 94.17;
    if (appState.status === 'playing') {
      startSyncPlayback(appState.startTime, appState.videoDuration, appState.loop);
    }
  });

  socket.on('show:started', (data) => {
    showDuration = data.videoDuration;
    stopAfterCurrentLoop = false;
    startSyncPlayback(data.startTime, data.videoDuration, data.loop);
  });

  socket.on('show:stopping_after_loop', (data) => {
    stopAfterCurrentLoop = true;
    showToast('⏳ Arrêt programmé en fin de cycle');
  });

  socket.on('show:stopped', () => {
    stopPlaybackImmediate();
  });

  socket.on('media:updated', (data) => {
    showDuration = data.videoDuration;
    const newSrc = side === 'right' ? data.videoInfo.rightPath : data.videoInfo.leftPath;
    video.src = newSrc;
    video.load();
    showToast('🔄 Nouvelle vidéo chargée');
  });

  // START SYNCHRONIZED PLAYBACK
  function startSyncPlayback(startTime, duration, loop) {
    isShowPlaying = true;
    showStartTime = startTime;
    showDuration = duration;
    standbyOverlay.classList.remove('active');

    // Make sure wake lock is active
    requestWakeLock();

    const serverNow = syncEngine.now();
    const waitMs = startTime - serverNow;

    if (waitMs > 0) {
      video.currentTime = 0;
      setTimeout(() => {
        executePlay();
      }, waitMs);
    } else {
      // Show started in the past, calculate initial seek position
      const elapsed = Math.abs(waitMs) / 1000;
      video.currentTime = elapsed % duration;
      executePlay();
    }
  }

  function executePlay() {
    video.play().catch(err => {
      console.warn('Autoplay prevented, requires user click on Arm button:', err);
      standbyOverlay.classList.add('active');
      btnArmPhone.style.display = 'block';
    });

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
        stopPlaybackGraceful();
        return;
      }

      const drift = video.currentTime - targetTime;
      lastDriftMs = Math.round(drift * 1000);

      // Drift correction strategy:
      // 1. If drift is huge (> 200ms), hard seek
      if (Math.abs(drift) > 0.20) {
        video.currentTime = targetTime;
        video.playbackRate = 1.0;
      }
      // 2. If drift is noticeable (between 30ms and 200ms), micro adjust playback speed smoothly
      else if (drift > 0.035) {
        video.playbackRate = 0.96; // Video is ahead, slow down slightly
      } else if (drift < -0.035) {
        video.playbackRate = 1.04; // Video is behind, speed up slightly
      } else {
        video.playbackRate = 1.0; // In near-perfect sync!
      }
    }

    syncAnimationId = requestAnimationFrame(runSyncLoop);
  }

  function stopPlaybackGraceful() {
    isShowPlaying = false;
    if (syncAnimationId) cancelAnimationFrame(syncAnimationId);
    video.pause();
    video.currentTime = 0;
    standbyOverlay.classList.add('active');
    standbyStatusText.textContent = 'Animation terminée. En veille.';
    showToast('✨ Cycle terminé, en veille.');
  }

  function stopPlaybackImmediate() {
    isShowPlaying = false;
    if (syncAnimationId) cancelAnimationFrame(syncAnimationId);
    video.pause();
    video.currentTime = 0;
    standbyOverlay.classList.add('active');
    standbyStatusText.textContent = 'Arrêté par la Régie. En veille.';
    showToast('🛑 Arrêt immédiat effectué');
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
        fullscreen: !!document.fullscreenElement
      });
    }
  }, 500);

})();
