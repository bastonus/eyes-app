const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const QRCode = require('qrcode');
const { processVideo, probeVideo } = require('./video-processor');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000
});

const PORT = process.env.PORT || 3000;

// Directories
const MEDIA_DIR = path.join(__dirname, 'media');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AUDIO_DIR = path.join(__dirname, 'uploads', 'audio');
const TEMP_DIR = path.join(__dirname, 'uploads', 'temp');

[MEDIA_DIR, UPLOADS_DIR, AUDIO_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure Multer for video and audio uploads
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `uploaded_video_${Date.now()}${ext}`);
  }
});
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB
});

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AUDIO_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `audio_${Date.now()}_${safeName}`);
  }
});
const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(MEDIA_DIR));
app.use('/uploads/audio', express.static(AUDIO_DIR));

// App state
const appState = {
  status: 'idle', // 'idle' | 'playing' | 'stopping_after_loop'
  startTime: null, // Server timestamp (ms) when show started
  videoDuration: 94.17, // Current video duration in seconds
  loop: true,
  stopAfterCurrent: false,
  activeAudio: '/media/default_audio.mp3',
  audioTarget: 'master', // 'master' | 'eyes' | 'both'
  audioConfig: {
    playOnMaster: true,
    playOnEyes: false,
    splitStereo: true // true: canal G sur oeil gauche, D sur oeil droit; false: audio complete sur les 2
  },
  videoInfo: {
    width: 2048,
    height: 1716,
    leftPath: '/media/left_eye.mp4',
    rightPath: '/media/right_eye.mp4'
  }
};

// Connected clients registry
const connectedClients = new Map();

// Helper to probe initial media duration if exists
async function initMediaInfo() {
  const leftEyePath = path.join(MEDIA_DIR, 'left_eye.mp4');
  if (fs.existsSync(leftEyePath)) {
    try {
      const probe = await probeVideo(leftEyePath);
      appState.videoDuration = probe.duration;
      appState.videoInfo.width = probe.width;
      appState.videoInfo.height = probe.height;
      console.log(`[Media] Detected video duration: ${appState.videoDuration.toFixed(2)}s`);
    } catch (e) {
      console.warn('[Media] Could not probe left_eye.mp4:', e.message);
    }
  }
}
initMediaInfo();

// API: Server Status & Media Info
app.get('/api/status', (req, res) => {
  const clients = Array.from(connectedClients.values());
  res.json({
    appState,
    clients,
    serverTime: Date.now()
  });
});

// API: List available audios
app.get('/api/audios', (req, res) => {
  const audios = [];
  
  if (fs.existsSync(path.join(MEDIA_DIR, 'default_audio.mp3'))) {
    audios.push({ name: 'Audio Original (Vidéo)', path: '/media/default_audio.mp3', isDefault: true });
  }
  if (fs.existsSync(path.join(MEDIA_DIR, 'video_audio.mp3'))) {
    audios.push({ name: 'Audio Extrait de la dernière vidéo', path: '/media/video_audio.mp3' });
  }

  if (fs.existsSync(AUDIO_DIR)) {
    const files = fs.readdirSync(AUDIO_DIR);
    files.forEach(f => {
      if (/\.(mp3|wav|m4a|ogg|aac)$/i.test(f)) {
        audios.push({ name: f.replace(/^audio_\d+_/, ''), path: `/uploads/audio/${f}` });
      }
    });
  }

  res.json({ audios, activeAudio: appState.activeAudio });
});

// API: QR Code generator
app.get('/api/qrcode', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');
  try {
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      margin: 1,
      width: 256,
      color: { dark: '#ff5500', light: '#00000000' }
    });
    res.json({ qrcode: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Upload Video & Auto-Cut (Left Eye / Right Eye)
let isProcessingVideo = false;

app.post('/api/upload-video', uploadVideo.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier vidéo reçu.' });
  }

  if (isProcessingVideo) {
    fs.unlinkSync(req.file.path);
    return res.status(429).json({ error: 'Un traitement vidéo est déjà en cours.' });
  }

  isProcessingVideo = true;
  const inputFilePath = req.file.path;

  // Let master know processing started
  io.emit('video_process:progress', { step: 'start', percent: 0, message: 'Démarrage du traitement vidéo...' });

  try {
    const result = await processVideo(inputFilePath, MEDIA_DIR, (progress) => {
      io.emit('video_process:progress', progress);
    });

    appState.videoDuration = result.duration;
    appState.videoInfo = {
      width: result.leftWidth,
      height: result.height,
      leftPath: result.leftPath,
      rightPath: result.rightPath
    };

    if (result.hasAudio) {
      appState.activeAudio = result.audioPath;
    }

    // Clean up uploaded temp file
    if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);

    isProcessingVideo = false;

    // Broadcast reload event to all connected eyes
    io.emit('media:updated', {
      videoDuration: appState.videoDuration,
      videoInfo: appState.videoInfo,
      activeAudio: appState.activeAudio
    });

    res.json({ success: true, result });
  } catch (error) {
    console.error('Error processing video:', error);
    if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);
    isProcessingVideo = false;
    io.emit('video_process:progress', { step: 'error', percent: 0, message: `Erreur: ${error.message}` });
    res.status(500).json({ error: error.message });
  }
});

// API: Upload custom audio
app.post('/api/upload-audio', uploadAudio.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier audio reçu.' });
  }
  const audioPath = `/uploads/audio/${req.file.filename}`;
  appState.activeAudio = audioPath;
  
  io.emit('audio:selected', { activeAudio: audioPath });
  res.json({ success: true, path: audioPath, name: req.file.originalname });
});

// Page routes
app.get('/eye', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'eye.html'));
});

app.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

// Socket.io Realtime & NTP Synchronization
io.on('connection', (socket) => {
  // 1. High precision NTP clock sync
  socket.on('sync:ping', (clientTime) => {
    socket.emit('sync:pong', {
      clientTime,
      serverTime: Date.now()
    });
  });

  // 2. Client registration (eye left, eye right, master)
  socket.on('client:register', (data) => {
    // Evict older socket entries for the same role and side to prevent stale ghosts
    if (data.side) {
      for (const [existingId, existingClient] of connectedClients.entries()) {
        if (existingId !== socket.id && existingClient.role === 'eye' && existingClient.side === data.side) {
          console.log(`[Client] Evicting previous connection for ${data.side} (${existingId})`);
          connectedClients.delete(existingId);
        }
      }
    }

    const clientData = {
      id: socket.id,
      role: data.role || 'observer', // 'left', 'right', 'master'
      side: data.side || null,
      deviceName: data.deviceName || 'Inconnu',
      ip: socket.handshake.address,
      state: 'connected',
      currentTime: 0,
      driftMs: 0,
      wakeLock: false,
      fullscreen: false,
      lastSeen: Date.now()
    };
    connectedClients.set(socket.id, clientData);
    broadcastClients();

    // Send current show state to newcomer
    socket.emit('show:state', {
      appState,
      serverTime: Date.now()
    });
  });

  // 3. Telemetry reports from eyes
  socket.on('eye:telemetry', (telemetry) => {
    const client = connectedClients.get(socket.id);
    if (client) {
      Object.assign(client, telemetry, { lastSeen: Date.now() });
      io.to('masters').emit('master:telemetry_update', client);
    }
  });

  // 4. Master actions
  socket.on('master:join', () => {
    socket.join('masters');
  });

  socket.on('master:select_audio', (audioPath) => {
    appState.activeAudio = audioPath;
    io.emit('audio:selected', { activeAudio: audioPath });
  });

  socket.on('master:set_audio_target', (target) => {
    appState.audioTarget = target;
    if (target === 'master') {
      appState.audioConfig.playOnMaster = true;
      appState.audioConfig.playOnEyes = false;
    } else if (target === 'eyes') {
      appState.audioConfig.playOnMaster = false;
      appState.audioConfig.playOnEyes = true;
    } else if (target === 'both') {
      appState.audioConfig.playOnMaster = true;
      appState.audioConfig.playOnEyes = true;
    }
    io.emit('audio:target_updated', { audioTarget: target });
    io.emit('audio:config_updated', { audioConfig: appState.audioConfig });
  });

  socket.on('master:set_audio_config', (cfg) => {
    if (cfg && typeof cfg === 'object') {
      appState.audioConfig = {
        playOnMaster: Boolean(cfg.playOnMaster),
        playOnEyes: Boolean(cfg.playOnEyes),
        splitStereo: cfg.splitStereo !== false
      };
      appState.audioTarget = (appState.audioConfig.playOnMaster && appState.audioConfig.playOnEyes) ? 'both'
        : appState.audioConfig.playOnEyes ? 'eyes' : 'master';

      console.log('[Audio] Config updated:', appState.audioConfig);
      io.emit('audio:config_updated', { audioConfig: appState.audioConfig });
    }
  });

  // START SHOW
  socket.on('master:start_show', () => {
    const leadTimeMs = 1500; // 1500ms network buffer lead for reliable dual-phone Wi-Fi sync
    const startTime = Date.now() + leadTimeMs;

    appState.status = 'playing';
    appState.startTime = startTime;
    appState.loop = true;
    appState.stopAfterCurrent = false;

    console.log(`[Show] Started at ${startTime} (lead: ${leadTimeMs}ms), duration: ${appState.videoDuration}s`);

    io.emit('show:started', {
      startTime,
      videoDuration: appState.videoDuration,
      loop: appState.loop,
      audioFile: appState.activeAudio,
      audioTarget: appState.audioTarget,
      audioConfig: appState.audioConfig,
      videoInfo: appState.videoInfo
    });
  });

  // STOP AT END OF CURRENT CYCLE
  socket.on('master:stop_after_loop', () => {
    if (appState.status !== 'playing') return;
    
    appState.stopAfterCurrent = true;
    appState.status = 'stopping_after_loop';

    // Calculate remaining seconds
    const elapsed = (Date.now() - appState.startTime) / 1000;
    const currentCyclePos = elapsed % appState.videoDuration;
    const remainingSeconds = Math.max(0, appState.videoDuration - currentCyclePos);

    console.log(`[Show] Stop requested at loop end. Remaining: ${remainingSeconds.toFixed(1)}s`);

    io.emit('show:stopping_after_loop', {
      remainingSeconds,
      targetStopTime: Date.now() + (remainingSeconds * 1000)
    });
  });

  // EMERGENCY IMMEDIATE STOP
  socket.on('master:stop_now', () => {
    appState.status = 'idle';
    appState.startTime = null;
    appState.stopAfterCurrent = false;

    connectedClients.forEach(c => {
      c.state = 'connected';
      c.currentTime = 0;
      c.driftMs = 0;
    });
    broadcastClients();

    console.log('[Show] Emergency stop triggered.');

    io.emit('show:stopped', {
      reason: 'immediate'
    });
  });

  // Disconnection
  socket.on('disconnect', () => {
    connectedClients.delete(socket.id);
    broadcastClients();
  });
});

function broadcastClients() {
  const list = Array.from(connectedClients.values());
  io.to('masters').emit('master:clients_updated', list);
}

// Start HTTP & WebSocket server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🐲 Dragon Eyes Sync Server running on http://0.0.0.0:${PORT}`);
});
