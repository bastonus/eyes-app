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

  const cardRightEye = document.getElementById('card-right-eye');
  const badgeRightEye = document.getElementById('badge-right-eye');
  const statusRightEye = document.getElementById('status-right-eye');
  const driftRightEye = document.getElementById('drift-right-eye');
  const wakelockRightEye = document.getElementById('wakelock-right-eye');

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
  const radioAudioTargets = document.querySelectorAll('input[name="audio-target"]');

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
  let audioTarget = 'master'; // 'master' or 'eyes'

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

  function updateClientsDisplay(clients) {
    const left = clients.find(c => c.side === 'left');
    const right = clients.find(c => c.side === 'right');

    renderEyeCard(cardLeftEye, badgeLeftEye, statusLeftEye, driftLeftEye, wakelockLeftEye, left);
    renderEyeCard(cardRightEye, badgeRightEye, statusRightEye, driftRightEye, wakelockRightEye, right);
  }

  function renderEyeCard(card, badge, statusEl, driftEl, wakelockEl, client) {
    if (!client) {
      card.className = 'eye-status-card disconnected';
      badge.className = 'badge badge-danger';
      badge.innerHTML = '<span class="badge-dot"></span> Hors-ligne';
      statusEl.textContent = 'Non connecté';
      driftEl.textContent = '--';
      wakelockEl.textContent = '--';
      return;
    }

    card.className = 'eye-status-card connected';
    badge.className = 'badge badge-success';
    badge.innerHTML = '<span class="badge-dot"></span> En ligne';

    statusEl.textContent = client.state === 'playing' ? '🟢 En lecture' : '🟡 En veille';
    
    const d = client.driftMs || 0;
    driftEl.textContent = `${d > 0 ? '+' : ''}${d} ms`;
    driftEl.className = 'telemetry-val ' + (Math.abs(d) < 40 ? 'sync-ok' : Math.abs(d) < 120 ? 'sync-warn' : 'sync-err');

    wakelockEl.textContent = client.wakeLock ? '✅ Actif' : '⚠️ Inactif';
  }

  function updateClientTelemetry(client) {
    if (client.side === 'left') {
      statusLeftEye.textContent = client.state === 'playing' ? '🟢 En lecture' : '🟡 En veille';
      const d = client.driftMs || 0;
      driftLeftEye.textContent = `${d > 0 ? '+' : ''}${d} ms`;
      driftLeftEye.className = 'telemetry-val ' + (Math.abs(d) < 40 ? 'sync-ok' : Math.abs(d) < 120 ? 'sync-warn' : 'sync-err');
      wakelockLeftEye.textContent = client.wakeLock ? '✅ Actif' : '⚠️ Inactif';
    } else if (client.side === 'right') {
      statusRightEye.textContent = client.state === 'playing' ? '🟢 En lecture' : '🟡 En veille';
      const d = client.driftMs || 0;
      driftRightEye.textContent = `${d > 0 ? '+' : ''}${d} ms`;
      driftRightEye.className = 'telemetry-val ' + (Math.abs(d) < 40 ? 'sync-ok' : Math.abs(d) < 120 ? 'sync-warn' : 'sync-err');
      wakelockRightEye.textContent = client.wakeLock ? '✅ Actif' : '⚠️ Inactif';
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
    if (audioTarget === 'master') {
      masterAudio.play().catch(err => console.warn('Master audio play error:', err));
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
        if (audioTarget === 'master' && !masterAudio.paused) {
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
      masterAudio.src = data.activeAudio;
      audioFileName.textContent = data.activeAudio.split('/').pop();
    } catch (e) {
      console.warn('Error loading audios list:', e);
    }
  }

  selectAudio.addEventListener('change', (e) => {
    socket.emit('master:select_audio', e.target.value);
    masterAudio.src = e.target.value;
    audioFileName.textContent = e.target.value.split('/').pop();
  });

  socket.on('audio:selected', ({ activeAudio }) => {
    selectAudio.value = activeAudio;
    masterAudio.src = activeAudio;
    audioFileName.textContent = activeAudio.split('/').pop();
  });

  radioAudioTargets.forEach(radio => {
    radio.addEventListener('change', (e) => {
      audioTarget = e.target.value;
      document.querySelectorAll('.radio-chip').forEach(c => c.classList.remove('selected'));
      e.target.closest('.radio-chip').classList.add('selected');
      socket.emit('master:set_audio_target', audioTarget);
      if (audioTarget !== 'master') {
        masterAudio.pause();
      }
    });
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
