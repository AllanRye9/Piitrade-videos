# Video pipeline: frame standard, editing, screenshot search

## 1. Frame standard (`backend/src/lib/video/videoStandard.ts`)
Every stored video is held to one standard, whatever the phone produced:
* fits inside **1080×1920** (portrait/square) or **1920×1080** (landscape) — larger frames (4K/8K) are shrunk, smaller
  ones are **never enlarged**; both sides even (H.264 needs it; odd sizes used to fail);
* **≤ 30 fps**; CRF 23 with a bitrate ceiling that scales with the frame (5000 kbit/s at 1080p, floor 1200);
  AAC 128 kbit/s; `+faststart`.
Phone rotation metadata is applied before measuring, so a sideways-tagged 1080p file is treated as portrait.
The upload dialog tells the uploader up front ("This video is 3840×2160. It will be stored at 1920×1080…").

**Display standard** (`frameFit`, web + mobile): a video fills the feed card only when that crops ≤ 25% of it (a vertical
clip on a phone card); landscape and square clips are shown whole instead of being zoomed in until they are soft.

## 2. Editing
The editor never re-encodes on the device. It produces settings; the upload carries them as a JSON `edits` field and the
server (`videoEdit.ts`) validates, then renders them with ffmpeg in one pass:

| Tool | Notes |
|---|---|
| Trim / cut out parts | up to 12 kept sections, joined seamlessly; the 60 s limit is measured **after cuts and speed** |
| Speed | 0.25×–4× (sound follows; added music is not sped up) |
| Rotate / flip / crop | crop by aspect (9:16, 4:5, 1:1, 16:9) with zoom + pan; the phone sends a shape and the server places it from the real frame |
| Look | 8 presets + brightness / contrast / saturation |
| Text | up to 5 captions, timed on the edited clip, auto-wrapped/sized to fit the frame, 80 chars, no emoji |
| Sound | original volume 0–200%, fade in/out (also applied to added music) |

Without `edits` the older `trimStart`/`trimEnd` fields behave exactly as before. Errors: `INVALID_EDIT`, `VIDEO_TOO_LONG`,
`TEXT_UNAVAILABLE` (no font on the server; the Docker image installs DejaVu, override with `TRANSCODE_FONT_FILE`).

## 3. Find on Piitrade from a screenshot (`POST /api/frame-search`)
`{ videoId, atMs, region? }` → the server cuts the frame at `atMs` out of the stored video (a phone cannot screenshot a
native video surface — it comes out black), the AI says what it shows, every connected shop is searched. If that fails:
* the AI errored or named nothing → another moment (±1.5 s, then ±3 s), at most **3 AI calls** and a 28 s budget;
* it named something not listed → other moments are tried, then the video's own title/hashtag;
* the response says which it was (`source: 'frame' | 'title'`, `note`, the analysed `frame` thumbnail, `attempts`).
Mobile opens this from the Find chip at the current playback position; the web app uses it as the fallback when the
marked-region search finds nothing.
