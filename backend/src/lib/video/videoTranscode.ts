import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildAudioFilter } from './audioMix';
import { EditPlan, buildEditGraph, inputWindow } from './videoEdit';
import { FRAME_STANDARD, VideoProbe, fitFrame, fpsCap, videoBitrateCeilingKbps } from './videoStandard';

/** An audio track that replaces source audio during the transcode. */
export interface AddedAudio {
  path: string;
  /** Where in the audio file to start, in seconds. */
  startSeconds: number;
  audioVolume: number;
}

export interface TranscodeOptions {
  /** Keep only the section starting here (seconds into the source). */
  startSeconds?: number;
  /** Keep at most this many seconds from the start point. */
  durationSeconds?: number;
  /** Replace the video's audio with an uploaded audio track. */
  audio?: AddedAudio;
  /**
   * What ffprobe found in the source. When given, the Piitrade frame standard
   * is applied (frame size cap, frame-rate cap, bitrate ceiling — see
   * videoStandard.ts). Omitted only by callers that don't have it, which then
   * get the plain re-encode.
   */
  probe?: VideoProbe;
  /** Edits beyond a plain cut (several kept sections, speed, rotate, crop, look, fades, text). Requires `probe`. */
  edit?: EditPlan;
  /** Font file for text overlays. */
  fontFile?: string | null;
}

/** Candidate fonts for text overlays, most likely first. `TRANSCODE_FONT_FILE` overrides. */
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
];

/** The font used for text overlays, or null when this machine has none (the edit then fails with a clear message). */
export function findOverlayFont(): string | null {
  const configured = process.env.TRANSCODE_FONT_FILE;
  if (configured) return fs.existsSync(configured) ? configured : null;
  return FONT_CANDIDATES.find((f) => fs.existsSync(f)) ?? null;
}

/**
 * Transcodes an uploaded video (whatever container/codec it arrived
 * in — see middleware/upload.ts for the accepted formats) to a
 * normalized H.264 video / AAC audio MP4, so:
 *
 *   1. Every video ever served is guaranteed browser-playable,
 *      regardless of what format the uploader's device produced
 *      (iPhones commonly upload .mov, Android/older devices .3gp,
 *      screen recorders .webm/.mkv, etc — most of these are not
 *      reliably playable via a plain <video> tag as-is).
 *   2. Source audio is preserved unless the uploader supplies a separate
 *      audio track, in which case that track replaces it.
 *   3. `+faststart` moves the MP4 moov atom to the front of the file,
 *      so playback can begin before the whole file has downloaded
 *      (otherwise large uploads have to fully load before frame 1).
 *   4. Optionally cuts the clip to a start/length window — this is how
 *      the 60-second cap is met when an uploader trims a longer video
 *      (see lib/video/videoLimits.ts). Because the file is re-encoded
 *      anyway, ffmpeg's input-side seek is frame-accurate here, and
 *      timestamps restart at 0 so the stored clip has no leading gap.
 *   5. Optionally replaces the clip's sound with an uploaded audio track,
 *      starting from the selected point and cut to the clip's length by
 *      the same output duration that bounds the video.
 *   6. With `probe`, the frame is held to the Piitrade standard: never
 *      larger than 1080×1920 / 1920×1080, never upscaled, even sides, at
 *      most 30 fps, bitrate ceiling in proportion to the frame.
 *   7. With `edit`, applies the uploader's edits (lib/video/videoEdit.ts).
 *
 * Rejects (never resolves) if ffmpeg reports an error, so callers can
 * clean up the source upload and surface a clear error rather than
 * serving a corrupt file.
 */
export function transcodeToMp4(inputPath: string, outputPath: string, options: TranscodeOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath);
    const probe = options.probe;
    let tempDir: string | null = null;
    const cleanup = () => {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    };
    const fail = (err: unknown) => {
      cleanup();
      reject(err);
    };

    try {
      let outWidth: number | null = null;
      let outHeight: number | null = null;

      if (options.edit) {
        if (!probe) throw new Error('transcodeToMp4: edits need the source probe');
        const win = inputWindow(options.edit);
        command.inputOptions(['-ss', String(win.start), '-t', String(win.duration)]);

        const graph = buildEditGraph(options.edit, {
          probe,
          sourceHasAudio: probe.hasAudio,
          addedAudioVolume: options.audio ? options.audio.audioVolume : null,
          fontFile: options.fontFile ?? null,
          writeText: (i, text) => {
            if (!tempDir) tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-text-'));
            const file = path.join(tempDir, `text${i}.txt`);
            fs.writeFileSync(file, text, 'utf8');
            return file;
          },
        });
        if (options.audio) {
          command.input(options.audio.path);
          if (options.audio.startSeconds > 0) command.inputOptions(['-ss', String(options.audio.startSeconds)]);
        }
        command.complexFilter(graph.filterComplex);
        command.outputOptions(['-map', `[${graph.videoLabel}]`]);
        if (graph.audioLabel) command.outputOptions(['-map', `[${graph.audioLabel}]`]);
        command.outputOptions(['-t', String(options.edit.outputSeconds)]);
        outWidth = graph.width;
        outHeight = graph.height;
      } else {
        if (options.startSeconds && options.startSeconds > 0) command.setStartTime(options.startSeconds);
        if (options.durationSeconds && options.durationSeconds > 0) command.setDuration(options.durationSeconds);

        if (options.audio) {
          const a = options.audio;
          command.input(a.path);
          if (a.startSeconds > 0) command.inputOptions(['-ss', String(a.startSeconds)]);
          command.complexFilter(buildAudioFilter({ audioVolume: a.audioVolume }));
          command.outputOptions(['-map 0:v:0', '-map [aout]']);
        }

        if (probe) {
          const fit = fitFrame(probe.width, probe.height);
          const vf: string[] = [];
          if (fit.scaled) vf.push(`scale=${fit.width}:${fit.height}:flags=lanczos`);
          vf.push('setsar=1');
          const cap = fpsCap(probe.fps);
          if (cap !== null) vf.push(`fps=${cap}`);
          command.videoFilters(vf);
          outWidth = fit.width;
          outHeight = fit.height;
        }
      }

      const outputOptions = ['-movflags +faststart', '-pix_fmt yuv420p', '-preset veryfast', `-crf ${FRAME_STANDARD.crf}`];
      if (outWidth !== null && outHeight !== null) {
        const kbps = videoBitrateCeilingKbps(outWidth, outHeight);
        outputOptions.push(`-maxrate ${kbps}k`, `-bufsize ${kbps * 2}k`);
      }

      command
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioBitrate(`${FRAME_STANDARD.audioKbps}k`)
        .outputOptions(outputOptions)
        .format('mp4')
        .on('end', () => {
          cleanup();
          resolve();
        })
        .on('error', (err) => fail(err))
        .save(outputPath);
    } catch (err) {
      fail(err);
    }
  });
}
