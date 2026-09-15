import ffmpeg from 'fluent-ffmpeg';

/**
 * The font file drawtext burns the watermark text with. Pinned to a
 * specific file rather than a fontconfig family name (e.g. `font=`)
 * because a minimal container image has no fontconfig font database
 * to resolve a family name against — see the Dockerfile, which
 * installs exactly this package (fonts-dejavu-core) for exactly this
 * reason.
 */
const FONT_FILE = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const WATERMARK_TEXT = 'piitrade.com';

/**
 * Escapes text for safe use inside an ffmpeg drawtext filter argument.
 * WATERMARK_TEXT is a fixed constant (not user input) so this is a
 * defensive formality, not a real injection risk today — but drawtext
 * treats `:`, `'`, and `\` specially, so any future change to the
 * text (or reuse of this function elsewhere) stays safe by construction.
 */
function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\:').replace(/'/g, "\\\\\\'");
}

/**
 * Burns the piitrade.com watermark into a copy of the video, written
 * to outputPath: a small persistent text watermark in the bottom-right
 * corner for the whole video (the "visual text" branding), plus a
 * larger centered version that fades in, holds, and fades out over the
 * first ~2.6 seconds (the "animation") — timed against a fixed window
 * rather than the video's total duration, so it works without an extra
 * ffprobe call and looks right regardless of how long the video is.
 *
 * Re-encodes (watermarking can't be a stream copy), so this is
 * noticeably slower than a plain file copy — see ensureWatermarkedDownload
 * for how callers should cache the result rather than regenerating it
 * on every download.
 */
export function burnWatermark(inputPath: string, outputPath: string): Promise<void> {
  const text = escapeDrawtext(WATERMARK_TEXT);

  /**
   * Fixed pixel sizes (previously fontsize=18/48, margin=16, border=16)
   * looked right against the 1280x720/720x1280 seed videos but broke
   * on smaller/narrower real uploads: at 320x180 (e.g. a low-res
   * upload, confirmed against the exact dimensions backend/test/
   * download.test.js generates its test video at) the centered intro
   * watermark's box ran past both left and right edges of the frame,
   * cutting the text off instead of showing it — the opposite of
   * "visible and correctly situated". Sizing everything as an
   * expression of min(w,h) instead of a fixed pixel count keeps the
   * watermark proportional to whatever the actual video's resolution
   * is, and the min/max() clamps stop it from ever growing large
   * enough to overflow a small frame or shrinking to unreadable on a
   * tiny one. Verified by rendering real output frames at 320x180,
   * 1280x720, and 720x1280 and inspecting them directly — the text
   * stays fully inside the frame and legible at every size.
   */
  const cornerFontSize = 'max(11\\,min(20\\,min(w\\,h)*0.045))';
  const cornerMargin = 'max(8\\,min(20\\,min(w\\,h)*0.02))';
  const cornerBorder = 'max(4\\,min(8\\,min(w\\,h)*0.008))';
  const introFontSize = 'max(22\\,min(64\\,min(w\\,h)*0.12))';
  const introBorder = 'max(8\\,min(18\\,min(w\\,h)*0.028))';

  const cornerWatermark =
    `drawtext=fontfile=${FONT_FILE}:text='${text}':fontsize=${cornerFontSize}:fontcolor=white@0.85:` +
    `box=1:boxcolor=black@0.35:boxborderw=${cornerBorder}:x=w-tw-${cornerMargin}:y=h-th-${cornerMargin}`;

  const introFadeAlpha = "if(lt(t\\,0.6)\\,t/0.6\\,if(lt(t\\,2)\\,1\\,if(lt(t\\,2.6)\\,(2.6-t)/0.6\\,0)))";
  const introWatermark =
    `drawtext=fontfile=${FONT_FILE}:text='${text}':fontsize=${introFontSize}:fontcolor=white:` +
    `box=1:boxcolor=black@0.4:boxborderw=${introBorder}:x=(w-tw)/2:y=(h-th)/2:` +
    `alpha='${introFadeAlpha}':enable='between(t,0,2.6)'`;

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters([cornerWatermark, introWatermark])
      .videoCodec('libx264')
      .audioCodec('copy')
      .outputOptions(['-movflags +faststart', '-pix_fmt yuv420p', '-preset veryfast', '-crf 23'])
      .format('mp4')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}
