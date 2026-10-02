const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Probe a video file using ffprobe.
 * Returns { width, height, duration, hasAudio }
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,width,height,duration,r_frame_rate',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath
    ];

    execFile('ffprobe', args, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`ffprobe failed: ${error.message} (${stderr})`));
      }
      try {
        const info = JSON.parse(stdout);
        const videoStream = info.streams && info.streams.find(s => s.codec_type === 'video');
        const audioStream = info.streams && info.streams.find(s => s.codec_type === 'audio');

        if (!videoStream) {
          return reject(new Error('Aucun flux vidéo trouvé dans le fichier.'));
        }

        let duration = parseFloat(videoStream.duration || (info.format && info.format.duration) || 0);

        resolve({
          width: parseInt(videoStream.width, 10),
          height: parseInt(videoStream.height, 10),
          duration: duration,
          hasAudio: !!audioStream
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Helper to run ffmpeg with progress tracking.
 */
function runFfmpegWithProgress(args, totalDuration, onProgress) {
  return new Promise((resolve, reject) => {
    const ffmpegProc = spawn('ffmpeg', args);
    let stderrLog = '';

    ffmpegProc.stderr.on('data', (data) => {
      const text = data.toString();
      stderrLog += text;

      // Extract time=HH:MM:SS.ms to estimate progress
      const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (timeMatch && totalDuration > 0 && onProgress) {
        const hours = parseInt(timeMatch[1], 10);
        const mins = parseInt(timeMatch[2], 10);
        const secs = parseInt(timeMatch[3], 10);
        const centis = parseInt(timeMatch[4], 10);
        const currentTime = hours * 3600 + mins * 60 + secs + centis / 100;
        const percent = Math.min(100, Math.round((currentTime / totalDuration) * 100));
        onProgress(percent);
      }
    });

    ffmpegProc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}. Log:\n${stderrLog.slice(-500)}`));
      }
    });

    ffmpegProc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Split an uploaded video into Left Eye and Right Eye files,
 * cutting cleanly at width / 2.
 * Also extracts audio if available.
 */
async function processVideo(inputPath, outputDir, onProgress = () => {}) {
  // Step 1: Probe
  onProgress({ step: 'probing', percent: 0, message: 'Analyse des dimensions de la vidéo...' });
  const probe = await probeVideo(inputPath);
  const { width, height, duration, hasAudio } = probe;

  // Compute middle split (must be even for H.264)
  const halfWidth = Math.floor(width / 4) * 2;
  const rightWidth = width - halfWidth;

  const leftOut = path.join(outputDir, 'left_eye.mp4');
  const rightOut = path.join(outputDir, 'right_eye.mp4');
  const audioOut = path.join(outputDir, 'video_audio.mp3');

  // Step 2: Cut Left Eye
  onProgress({ step: 'left_eye', percent: 10, message: `Découpage Œil Gauche (${halfWidth}x${height})...` });
  
  // Left eye crop arguments
  const leftArgs = [
    '-i', inputPath,
    '-filter_complex', `[0:v]crop=${halfWidth}:${height}:0:0[v]`,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    leftOut,
    '-y'
  ];

  await runFfmpegWithProgress(leftArgs, duration, (p) => {
    onProgress({
      step: 'left_eye',
      percent: 10 + Math.round(p * 0.4), // 10% to 50%
      message: `Encodage Œil Gauche: ${p}%`
    });
  });

  // Step 3: Cut Right Eye
  onProgress({ step: 'right_eye', percent: 50, message: `Découpage Œil Droit (${rightWidth}x${height})...` });

  const rightArgs = [
    '-i', inputPath,
    '-filter_complex', `[0:v]crop=${rightWidth}:${height}:${halfWidth}:0[v]`,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    rightOut,
    '-y'
  ];

  await runFfmpegWithProgress(rightArgs, duration, (p) => {
    onProgress({
      step: 'right_eye',
      percent: 50 + Math.round(p * 0.4), // 50% to 90%
      message: `Encodage Œil Droit: ${p}%`
    });
  });

  // Step 4: Extract Audio if exists
  let extractedAudio = false;
  if (hasAudio) {
    onProgress({ step: 'audio', percent: 92, message: 'Extraction de la piste audio...' });
    const audioArgs = [
      '-i', inputPath,
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      audioOut,
      '-y'
    ];
    try {
      await runFfmpegWithProgress(audioArgs, duration);
      extractedAudio = true;
    } catch (e) {
      console.warn('Audio extraction warning:', e.message);
    }
  }

  onProgress({ step: 'completed', percent: 100, message: 'Traitement terminé avec succès !' });

  return {
    width,
    height,
    duration,
    leftWidth: halfWidth,
    rightWidth: rightWidth,
    leftPath: '/media/left_eye.mp4',
    rightPath: '/media/right_eye.mp4',
    audioPath: extractedAudio ? '/media/video_audio.mp3' : null,
    hasAudio: extractedAudio
  };
}

module.exports = {
  probeVideo,
  processVideo
};
