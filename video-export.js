// video-export.js
// Exports the canvas frames combined with the video's audio into a webm blob using MediaRecorder.
// Keeps frames and audio unmuted; requires that the provided video element supports captureStream().

async function startCanvasVideoExport({canvas, audioSource, duration = 5, mimeType = 'video/webm'}) {
  // Ensure playback for captureStream to include audio in some browsers
  if (audioSource && audioSource.paused) {
    try { await audioSource.play(); } catch(e) { /* ignore */ }
  }

  // Canvas capture stream (video-only)
  const canvasStream = canvas.captureStream(30); // capture at 30fps by default

  // Try to obtain audio track from the video element via captureStream
  let audioTracks = [];
  if (audioSource && audioSource.captureStream) {
    try {
      const audioStream = audioSource.captureStream();
      audioTracks = audioStream.getAudioTracks();
    } catch (err) {
      console.warn('Could not capture audio from the video element:', err);
    }
  }

  // Merge audio tracks into the canvas stream
  audioTracks.forEach(t => canvasStream.addTrack(t));

  // Prepare MediaRecorder
  let options = { mimeType };
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    // fallback
    options = {};
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(canvasStream, options);
    } catch (err) {
      reject(err);
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType.indexOf('webm')>=0? 'video/webm' : 'video/mp4' });
      resolve(blob);
    };
    recorder.onerror = (ev) => {
      reject(ev);
    };

    // start and stop after duration
    recorder.start(1000); // collect in intervals (ms)
    setTimeout(() => {
      recorder.stop();
    }, duration * 1000);
  });
}

// Expose globally
window.startCanvasVideoExport = startCanvasVideoExport;