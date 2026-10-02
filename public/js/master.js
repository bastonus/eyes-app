/**
 * Dragon Eyes - Master Controller Logic
 */
(function() {
  const socket = io();
  const syncEngine = new DragonSyncClient(socket);
  syncEngine.start(2000);

  // DOM Elements - Telemetry
  const pingDisplay = document.getElementById('ping-display');
  const cardLeftEye = document.getElementById('card-left-eye');
  const badgeLeftEye = document.getElementById('badge-left-eye');
  const statusLeftEye = document.getElementById('status-left-eye');
  const driftLeftEye = document.getElementById('drift-left-eye');
  const wakelockLeftEye = document.getElementById('wakelock-left-eye');
  const cacheLeftEye = document.getElementById('cache-left-eye');

  const cardRightEye = document.getElementById('card-right-eye');
  const badgeRightEye = document.getElementById('badge-right-eye');
  const statusRightEye = document.getElementById('status-right-eye');
  const driftRightEye = document.getElementById('drift-right-eye');
  const wakelockRightEye = document.getElementById('wakelock-right-eye');
  const cacheRightEye = document.getElementById('cache-right-eye');

  const masterMediaCache = new DragonMediaCache();

  // DOM Elements - Show Controls
  const btnStartShow = document.getElementById('btn-start-show');
  const btnStopLoop = document.getElementById('btn-stop-loop');
  const btnStopNow = document.getElementById('btn-stop-now');
  const showStatusBadge = document.getElementById('show-status-badge');
  const stoppingBanner = document.getElementById('stopping-banner');
  const stopCountdown = document.getElementById('stop-countdown');
  const timelineFill = document.getElementById('timeline-fill');
  const timelineTime = document.getElementById('timeline-time');
  const timelineCycle = document.getElementById('timeline-cycle');

  // DOM Elements - Audio
  const masterAudio = document.getElementById('master-audio-element');
  const audioFileName = document.getElementById('audio-file-name');
  const selectAudio = document.getElementById('select-audio');
  const audioDropzone = document.getElementById('audio-dropzone');
  const inputAudioFile = document.getElementById('input-audio-file');
  const checkAudioMaster = document.getElementById('check-audio-master');
  const checkAudioEyes = document.getElementById('check-audio-eyes');
  const stereoModeContainer = document.getElementById('stereo-mode-container');
  const radioStereoModes = document.querySelectorAll('input[name="stereo-mode"]');
  const chipStereoSplit = document.getElementById('chip-stereo-split');
  const chipStereoCombined = document.getElementById('chip-stereo-combined');

  // DOM Elements - Video Upload
  const videoDropzone = document.getElementById('video-dropzone');
  const inputVideoFile = document.getElementById('input-video-file');
  const videoProgressCard = document.getElementById('video-progress-card');
  const progressMessage = document.getElementById('progress-message');
  const progressPercent = document.getElementById('progress-percent');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const infoDuration = document.getElementById('info-duration');
  const infoResolution = document.getElementById('info-resolution');

  // State
  let showDuration = 94.17;
  let showStartTime = null;
  let isPlaying = false;
  let isStoppingAfterLoop = false;
  let stopTargetTime = null;
  let timelineTimer = null;
  let audioConfig = {
    playOnMaster: true,
    playOnEyes: false,
    splitStereo: true
  };

  // Socket Connection
  socket.on('connect', () => {
    socket.emit('client:register', { role: 'master', deviceName: 'Régie Maître' });
    socket.emit('master:join');
    loadAudiosList();
    fetchStatus();
  });

  // Display Ping
  setInterval(() => {
    if (syncEngine.isSynced) {
      pingDisplay.textContent = `Ping: ${syncEngine.getRTT()} ms (offset: ${syncEngine.getOffset()} ms)`;
    }
  }, 2000);

  // Status Fetch
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      showDuration = data.appState.videoDuration || 94.17;
      infoDuration.textContent = showDuration.toFixed(1) + ' s';
      if (data.appState.videoInfo) {
        infoResolution.textContent = `${data.appState.videoInfo.width} x ${data.appState.videoInfo.height}`;
      }
      if (data.appState.audioConfig) {
        audioConfig = Object.assign(audioConfig, data.appState.audioConfig);
        applyAudioConfigToUI();
      }
      updateClientsDisplay(data.clients || []);
      if (data.appState.status === 'playing') {
        onShowStarted(data.appState);
      }
    } catch (e) {
      console.warn('Could not fetch status:', e);
    }
  }

  // Client updates
  socket.on('master:clients_updated', (clients) => {
    updateClientsDisplay(clients);
  });

  socket.on('master:telemetry_update', (client) => {
    updateClientTelemetry(client);
  });

  function getLatestClientBySide(clients, targetSide) {
    const matches = clients.filter(c => c.side === targetSide);
    if (!matches || matches.length === 0) return null;
    return matches.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))[0];
  }

  function updateClientsDisplay(clients) {
    const left = getLatestClientBySide(clients, 'left');
    const right = getLatestClientBySide(clients, 'right');

    renderEyeCard(cardLeftEye, badgeLeftEye, statusLeftEye, driftLeftEye, wakelockLeftEye, cacheLeftEye, left);
    renderEyeCard(cardRightEye, badgeRightEye, statusRightEye, driftRightEye, wakelockRightEye, cacheRightEye, right);
  }

  function renderEyeCard(card, badge, statusEl, driftEl, wakelockEl, cacheEl, client) {
    if (!client) {
      card.className = 'eye-status-card disconnected';
      badge.className = 'badge badge-danger';
      badge.innerHTML = '<span class="badge-dot"></span> Hors-ligne';
      statusEl.textContent = 'Non connecté';
      driftEl.textContent = '--';
      wakelockEl.textContent = '--';
      if (cacheEl) cacheEl.textContent = '--';
      return;
    }

    card.className = 'eye-status-card connected';
    badge.className = 'badge badge-success';
    badge.innerHTML = '<span class="badge-dot"></span> En ligne';

    const isPlaying = client.state === 'playing';
    statusEl.textContent = isPlaying ? '🟢 En lecture' : '🟡 En veille';
    
    const d = isPlaying ? (client.driftMs || 0) : 0;
    driftEl.textContent = isPlaying ? `${d > 0 ? '+' : ''}${d} ms` : '0 ms (Veille)';
    driftEl.className = 'telemetry-val ' + (Math.abs(d) < 40 ? 'sync-ok' : Math.abs(d) < 120 ? 'sync-warn' : 'sync-err');

    wakelockEl.textContent = client.wakeLock ? '✅ Actif' : '⚠️ Inactif';

    if (cacheEl) {
      if (client.cached) {
        cacheEl.textContent = '⚡ 100% (Mémoire)';
        cacheEl.className = 'telemetry-val sync-ok';
      } else if (typeof client.cachePercent === 'number' && client.cachePercent > 0) {
        cacheEl.textContent = `⏳ ${client.cachePercent}% chargé`;
        cacheEl.className = 'telemetry-val sync-warn';
      } else {
        cacheEl.textContent = '⏳ En cours...';
        cacheEl.className = 'telemetry-val sync-warn';
      }
    }
  }

  function updateClientTelemetry(client) {
    const isPlaying = client.state === 'playing';
    const d = isPlaying ? (client.driftMs || 0) : 0;

    const targetStatus = isPlaying ? '🟢 En lecture' : '🟡 En veille';
    const targetDrift = isPlaying ? `${d > 0 ? '+' : ''}${d} ms` : '0 ms (Veille)';
    const targetDriftClass = 'telemetry-val ' + (Math.abs(d) < 40 ? 'sync-ok' : Math.abs(d) < 120 ? 'sync-warn' : 'sync-err');
    const targetWakelock = client.wakeLock ? '✅ Actif' : '⚠️ Inactif';

    let targetCacheText = '⏳ En cours...';
    let targetCacheClass = 'telemetry-val sync-warn';
    if (client.cached) {
      targetCacheText = '⚡ 100% (Mémoire)';
      targetCacheClass = 'telemetry-val sync-ok';
    } else if (typeof client.cachePercent === 'number' && client.cachePercent > 0) {
      targetCacheText = `⏳ ${client.cachePercent}% chargé`;
    }

    if (client.side === 'left') {
      statusLeftEye.textContent = targetStatus;
      driftLeftEye.textContent = targetDrift;
      driftLeftEye.className = targetDriftClass;
      wakelockLeftEye.textContent = targetWakelock;
      if (cacheLeftEye) {
        cacheLeftEye.textContent = targetCacheText;
        cacheLeftEye.className = targetCacheClass;
      }
    } else if (client.side === 'right') {
      statusRightEye.textContent = targetStatus;
      driftRightEye.textContent = targetDrift;
      driftRightEye.className = targetDriftClass;
      wakelockRightEye.textContent = targetWakelock;
      if (cacheRightEye) {
        cacheRightEye.textContent = targetCacheText;
        cacheRightEye.className = targetCacheClass;
      }
    }
  }

  // SHOW CONTROL EVENTS
  btnStartShow.addEventListener('click', () => {
    socket.emit('master:start_show');
  });

  btnStopLoop.addEventListener('click', () => {
    socket.emit('master:stop_after_loop');
  });

  btnStopNow.addEventListener('click', () => {
    socket.emit('master:stop_now');
  });

  socket.on('show:started', (data) => {
    onShowStarted(data);
  });

  socket.on('show:stopping_after_loop', (data) => {
    isStoppingAfterLoop = true;
    stopTargetTime = data.targetStopTime;
    stoppingBanner.classList.add('active');
    showStatusBadge.className = 'badge badge-warning';
    showStatusBadge.textContent = 'Arrêt fin de cycle...';
  });

  socket.on('show:stopped', () => {
    onShowStopped();
  });

  function onShowStarted(data) {
    isPlaying = true;
    isStoppingAfterLoop = false;
    showStartTime = data.startTime;
    showDuration = data.videoDuration || 94.17;
    stoppingBanner.classList.remove('active');

    showStatusBadge.className = 'badge badge-success';
    showStatusBadge.textContent = 'En direct 🔥';

    // Synchronized Audio on Master
    if (data.audioFile) {
      masterAudio.src = data.audioFile;
      audioFileName.textContent = data.audioFile.split('/').pop();
    }

    const waitMs = showStartTime - syncEngine.now();
    if (waitMs > 0) {
      setTimeout(() => {
        playMasterAudio();
      }, waitMs);
    } else {
      const elapsed = Math.abs(waitMs) / 1000;
      masterAudio.currentTime = elapsed % showDuration;
      playMasterAudio();
    }

    startTimeline();
  }

  function playMasterAudio() {
    if (audioConfig.playOnMaster) {
      masterAudio.play().catch(err => console.warn('Master audio play error:', err));
    } else {
      masterAudio.pause();
    }
  }

  function onShowStopped() {
    isPlaying = false;
    isStoppingAfterLoop = false;
    showStatusBadge.className = 'badge badge-warning';
    showStatusBadge.textContent = 'En veille';
    stoppingBanner.classList.remove('active');

    masterAudio.pause();
    masterAudio.currentTime = 0;

    timelineFill.style.width = '0%';
    timelineTime.textContent = '00:00 / ' + formatTime(showDuration);
    timelineCycle.textContent = 'Cycle : 0';

    if (timelineTimer) cancelAnimationFrame(timelineTimer);
  }

  // Timeline Updater
  function startTimeline() {
    if (timelineTimer) cancelAnimationFrame(timelineTimer);

    function update() {
      if (!isPlaying) return;

      const serverNow = syncEngine.now();
      const elapsed = (serverNow - showStartTime) / 1000;

      if (elapsed >= 0) {
        const cycle = Math.floor(elapsed / showDuration);
        const currentPos = elapsed % showDuration;

        // Check if graceful stop completed
        if (isStoppingAfterLoop && cycle >= 1) {
          onShowStopped();
          return;
        }

        const pct = (currentPos / showDuration) * 100;
        timelineFill.style.width = pct.toFixed(1) + '%';
        timelineTime.textContent = `${formatTime(currentPos)} / ${formatTime(showDuration)}`;
        timelineCycle.textContent = `Cycle : ${cycle + 1}`;

        if (isStoppingAfterLoop) {
          const remaining = Math.max(0, showDuration - currentPos);
          stopCountdown.textContent = remaining.toFixed(1);
        }

        // Keep master audio in sync
        if (audioConfig.playOnMaster && !masterAudio.paused) {
          const audioDrift = masterAudio.currentTime - currentPos;
          if (Math.abs(audioDrift) > 0.15) {
            masterAudio.currentTime = currentPos;
          }
        }
      }

      timelineTimer = requestAnimationFrame(update);
    }

    timelineTimer = requestAnimationFrame(update);
  }

  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // AUDIO MANAGEMENT
  async function loadAudiosList() {
    try {
      const res = await fetch('/api/audios');
      const data = await res.json();
      selectAudio.innerHTML = '';
      data.audios.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.path;
        opt.textContent = a.name;
        if (a.path === data.activeAudio) opt.selected = true;
        selectAudio.appendChild(opt);
      });
      audioFileName.textContent = data.activeAudio.split('/').pop();
      try {
        const cachedUrl = await masterMediaCache.load(data.activeAudio, 'master_audio');
        masterAudio.src = cachedUrl;
      } catch (e) {
        masterAudio.src = data.activeAudio;
      }
    } catch (e) {
      console.warn('Error loading audios list:', e);
    }
  }

  selectAudio.addEventListener('change', async (e) => {
    socket.emit('master:select_audio', e.target.value);
    audioFileName.textContent = e.target.value.split('/').pop();
    try {
      const cachedUrl = await masterMediaCache.load(e.target.value, 'master_audio');
      masterAudio.src = cachedUrl;
    } catch (err) {
      masterAudio.src = e.target.value;
    }
  });

  socket.on('audio:selected', async ({ activeAudio }) => {
    selectAudio.value = activeAudio;
    audioFileName.textContent = activeAudio.split('/').pop();
    try {
      const cachedUrl = await masterMediaCache.load(activeAudio, 'master_audio');
      masterAudio.src = cachedUrl;
    } catch (err) {
      masterAudio.src = activeAudio;
    }
  });

  function applyAudioConfigToUI() {
    if (checkAudioMaster) checkAudioMaster.checked = !!audioConfig.playOnMaster;
    if (checkAudioEyes) checkAudioEyes.checked = !!audioConfig.playOnEyes;
    if (stereoModeContainer) stereoModeContainer.style.display = audioConfig.playOnEyes ? 'block' : 'none';

    radioStereoModes.forEach(r => {
      if (r.value === 'split') {
        r.checked = audioConfig.splitStereo;
      } else if (r.value === 'combined') {
        r.checked = !audioConfig.splitStereo;
      }
    });

    if (chipStereoSplit) chipStereoSplit.classList.toggle('selected', audioConfig.splitStereo);
    if (chipStereoCombined) chipStereoCombined.classList.toggle('selected', !audioConfig.splitStereo);
  }

  function sendAudioConfigUpdate() {
    const splitRadio = document.querySelector('input[name="stereo-mode"]:checked');
    audioConfig.playOnMaster = checkAudioMaster ? checkAudioMaster.checked : true;
    audioConfig.playOnEyes = checkAudioEyes ? checkAudioEyes.checked : false;
    audioConfig.splitStereo = splitRadio ? splitRadio.value === 'split' : true;

    if (stereoModeContainer) stereoModeContainer.style.display = audioConfig.playOnEyes ? 'block' : 'none';

    if (chipStereoSplit) chipStereoSplit.classList.toggle('selected', audioConfig.splitStereo);
    if (chipStereoCombined) chipStereoCombined.classList.toggle('selected', !audioConfig.splitStereo);

    socket.emit('master:set_audio_config', audioConfig);

    if (!audioConfig.playOnMaster && !masterAudio.paused) {
      masterAudio.pause();
    }
  }

  if (checkAudioMaster) checkAudioMaster.addEventListener('change', sendAudioConfigUpdate);
  if (checkAudioEyes) checkAudioEyes.addEventListener('change', sendAudioConfigUpdate);
  radioStereoModes.forEach(r => {
    r.addEventListener('change', () => {
      document.querySelectorAll('#stereo-mode-container .radio-chip').forEach(c => c.classList.remove('selected'));
      r.closest('.radio-chip').classList.add('selected');
      sendAudioConfigUpdate();
    });
  });

  socket.on('audio:config_updated', ({ audioConfig: newCfg }) => {
    if (newCfg) {
      audioConfig = Object.assign(audioConfig, newCfg);
      applyAudioConfigToUI();
      if (!audioConfig.playOnMaster && !masterAudio.paused) {
        masterAudio.pause();
      }
    }
  });

  // Audio Upload
  inputAudioFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('audio', file);

    try {
      audioFileName.textContent = 'Envoi du fichier audio...';
      const res = await fetch('/api/upload-audio', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        await loadAudiosList();
        alert('✅ Audio uploadé avec succès !');
      } else {
        alert('Erreur upload audio: ' + data.error);
      }
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
  });

  // VIDEO UPLOAD & AUTO-SPLIT
  inputVideoFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) uploadAndProcessVideo(file);
  });

  // Drag and drop for video
  videoDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    videoDropzone.classList.add('dragover');
  });
  videoDropzone.addEventListener('dragleave', () => {
    videoDropzone.classList.remove('dragover');
  });
  videoDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    videoDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadAndProcessVideo(e.dataTransfer.files[0]);
    }
  });

  async function uploadAndProcessVideo(file) {
    videoProgressCard.classList.add('active');
    progressMessage.textContent = `Téléversement de ${file.name} (${(file.size / (1024*1024)).toFixed(1)} Mo)...`;
    progressPercent.textContent = '0%';
    progressBarFill.style.width = '0%';

    const formData = new FormData();
    formData.append('video', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-video', true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressPercent.textContent = `${percent}%`;
        progressBarFill.style.width = `${percent}%`;
        progressMessage.textContent = `Téléversement vers le serveur : ${percent}%`;
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const res = JSON.parse(xhr.responseText);
        progressMessage.textContent = '✅ Traitement et découpage terminés !';
        progressPercent.textContent = '100%';
        progressBarFill.style.width = '100%';
        setTimeout(() => {
          videoProgressCard.classList.remove('active');
          fetchStatus();
          loadAudiosList();
        }, 3000);
      } else {
        progressMessage.textContent = '❌ Erreur de traitement';
        alert('Erreur: ' + xhr.responseText);
      }
    };

    xhr.onerror = () => {
      progressMessage.textContent = '❌ Erreur réseau lors du téléversement';
    };

    xhr.send(formData);
  }

  // Socket progress events from server during video splitting
  socket.on('video_process:progress', (p) => {
    videoProgressCard.classList.add('active');
    progressMessage.textContent = p.message;
    progressPercent.textContent = `${p.percent}%`;
    progressBarFill.style.width = `${p.percent}%`;
  });

  socket.on('media:updated', (data) => {
    showDuration = data.videoDuration;
    infoDuration.textContent = showDuration.toFixed(1) + ' s';
    if (data.videoInfo) {
      infoResolution.textContent = `${data.videoInfo.width} x ${data.videoInfo.height}`;
    }
  });

  // QR Modal
  window.showQr = async function(path, title) {
    const fullUrl = window.location.origin + path;
    document.getElementById('qr-title').innerText = '📱 Scanner: ' + title;
    document.getElementById('qr-url-text').innerText = fullUrl;
    const res = await fetch('/api/qrcode?url=' + encodeURIComponent(fullUrl));
    const data = await res.json();
    document.getElementById('qr-image').src = data.qrcode;
    document.getElementById('qr-modal').classList.add('active');
  };

  window.closeQr = function(e) {
    document.getElementById('qr-modal').classList.remove('active');
  };

})();
