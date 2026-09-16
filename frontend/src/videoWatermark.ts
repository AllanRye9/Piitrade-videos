/**
 * Burns an animated "piitrade.com" watermark into a copy of a video,
 * entirely client-side, for the Download control (both the tap button
 * and the long-press control in VideoCard.tsx).
 *
 * How it works: the source video plays offscreen into a canvas (frame
 * by frame, via requestAnimationFrame), the watermark is drawn on top
 * of every frame, and MediaRecorder captures the canvas + the video's
 * own audio track into a new file. This actually re-encodes the
 * pixels — it's not just a filename change — which is what makes the
 * branding show up when the downloaded file is played anywhere else.
 *
 * No new dependencies: canvas.captureStream() and MediaRecorder are
 * native browser APIs. Requires the source <video> to be fetched with
 * crossOrigin="anonymous" (VideoCard already sets this) or the canvas
 * will be tainted and captureStream will silently produce a blank
 * recording.
 */

export interface WatermarkProgress {
  /** 0–1, based on playback position through the source video. */
  fraction: number;
}

export interface WatermarkResult {
  blob: Blob;
  /** File extension matching the produced blob's mime type. */
  extension: string;
}

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return 'video/webm';
}

/** Draws one frame of the animated brand mark — a small pulsing dot
 *  next to "piitrade.com", plus a soft diagonal sweep across the
 *  wordmark — onto the given canvas context. `t` is elapsed seconds. */
function drawWatermarkFrame(ctx: CanvasRenderingContext2D, width: number, height: number, t: number) {
  const label = 'piitrade.com';
  const fontSize = Math.max(14, Math.round(width * 0.032));
  ctx.save();
  ctx.font = `700 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const textWidth = ctx.measureText(label).width;
  const paddingX = fontSize * 0.6;
  const paddingY = fontSize * 0.5;
  const boxWidth = textWidth + paddingX * 2 + fontSize * 1.6;
  const boxHeight = fontSize + paddingY * 2;
  const x = width - boxWidth - width * 0.03;
  const y = height - boxHeight - height * 0.03;

  // Gentle pulse (opacity 0.55 -> 0.85) so the mark stays legible over
  // any part of the frame without being static/distracting.
  const pulse = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2));

  ctx.globalAlpha = pulse * 0.9;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const radius = boxHeight / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, radius);
  ctx.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, radius);
  ctx.arcTo(x, y + boxHeight, x, y, radius);
  ctx.arcTo(x, y, x + boxWidth, y, radius);
  ctx.closePath();
  ctx.fill();

  // Animated dot — orbits a tiny bit to read as "alive" rather than a
  // static logo, echoing the brand-pink/cyan palette used elsewhere.
  const dotCx = x + paddingX + fontSize * 0.55;
  const dotCy = y + boxHeight / 2;
  const orbit = fontSize * 0.18;
  const dx = Math.cos(t * 3) * orbit;
  const dy = Math.sin(t * 3) * orbit * 0.5;
  ctx.globalAlpha = 1;
  const dotGradient = ctx.createLinearGradient(dotCx - orbit, dotCy, dotCx + orbit, dotCy);
  dotGradient.addColorStop(0, '#ff2d78');
  dotGradient.addColorStop(1, '#22d3ee');
  ctx.fillStyle = dotGradient;
  ctx.beginPath();
  ctx.arc(dotCx + dx, dotCy + dy, fontSize * 0.16, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + paddingX + fontSize * 1.3, y + boxHeight / 2);

  // Soft diagonal sweep of light crossing the wordmark every ~3s —
  // the "animation" half of "visual text and animations".
  const sweepPeriod = 3;
  const sweepProgress = (t % sweepPeriod) / sweepPeriod;
  const sweepX = x - boxWidth * 0.4 + (boxWidth * 1.8) * sweepProgress;
  const sweepGradient = ctx.createLinearGradient(sweepX - fontSize, y, sweepX + fontSize, y);
  sweepGradient.addColorStop(0, 'rgba(255,255,255,0)');
  sweepGradient.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  sweepGradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, radius);
  ctx.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, radius);
  ctx.arcTo(x, y + boxHeight, x, y, radius);
  ctx.arcTo(x, y, x + boxWidth, y, radius);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = sweepGradient;
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.restore();

  ctx.restore();
}

/**
 * Renders `sourceUrl` (must be same-origin or CORS-enabled) into a new
 * watermarked video Blob. Rejects if the browser lacks the needed
 * APIs (very old browsers) — callers should fall back to a plain
 * download in that case rather than blocking the feature entirely.
 */
export function renderWatermarkedVideo(sourceUrl: string, onProgress?: (p: WatermarkProgress) => void): Promise<WatermarkResult> {
  return new Promise((resolve, reject) => {
    if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
      reject(new Error('unsupported'));
      return;
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = false;
    video.playsInline = true;
    video.src = sourceUrl;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('canvas unsupported'));
      return;
    }

    let rafId = 0;
    let settled = false;
    const cleanup = () => {
      cancelAnimationFrame(rafId);
      video.pause();
      video.src = '';
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    video.onerror = () => fail(new Error('Could not load video for watermarking'));

    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 1280;

      const canvasStream = canvas.captureStream(30);
      // Carry the source audio track through untouched, if present —
      // captureStream() only gives us the visual canvas.
      let combinedStream = canvasStream;
      try {
        const audioStream: MediaStream | undefined = (video as any).captureStream?.() || (video as any).mozCaptureStream?.();
        const audioTracks = audioStream?.getAudioTracks() || [];
        if (audioTracks.length > 0) {
          combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
        }
      } catch {
        // Audio capture isn't supported in every browser — silently
        // fall back to a video-only watermarked download rather than
        // failing the whole feature over it.
      }

      const mimeType = pickMimeType();
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 4_000_000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onerror = () => fail(new Error('Recording failed'));
      recorder.onstop = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
        resolve({ blob, extension: 'webm' });
      };

      const duration = video.duration || 0;
      const draw = () => {
        if (settled) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawWatermarkFrame(ctx, canvas.width, canvas.height, video.currentTime);
        if (onProgress && duration > 0) onProgress({ fraction: Math.min(1, video.currentTime / duration) });
        if (!video.ended && !video.paused) {
          rafId = requestAnimationFrame(draw);
        }
      };

      video.onended = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };

      video.onplay = () => {
        rafId = requestAnimationFrame(draw);
      };

      recorder.start();
      video.play().catch((err) => fail(err instanceof Error ? err : new Error('Could not play source video')));
    };
  });
}

/** Triggers a browser download of `blob` under `filename`. */
export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to actually start before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
