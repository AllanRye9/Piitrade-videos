// Pure (no React Native imports) so it can be unit-tested under plain Node.
// How a failed video upload is described to the person — see also uploadPoll.ts (what to do next).

/** The largest video the server accepts, in MB. Keep in sync with MAX_VIDEO_UPLOAD_BYTES in backend/src/middleware/upload.ts. */
export const MAX_UPLOAD_MB = 500;

/** How a failed upload is described, and whether the video may nonetheless have reached the server. */
export interface UploadFailure {
  message: string;
  /** The request died after the whole file was sent (proxy timeout, dropped connection while the server was
   *  still encoding), so the video may well have been saved — check its status instead of re-uploading. */
  recoverable: boolean;
}

export const UPLOAD_MESSAGES = {
  tooLarge: `This video is too large for the server (limit ${MAX_UPLOAD_MB} MB). Trim it or choose a smaller file.`,
  slow: 'The connection was too slow to finish sending the video. Try again on Wi-Fi or a stronger signal.',
  lostBeforeSent: 'Lost connection while uploading. Check your signal and tap Retry — large videos work best on Wi-Fi.',
  lostAfterSent: 'The connection dropped while the server was processing your video. Checking whether it finished…',
  gateway: 'The server took too long to answer, but your video may still be processing. Checking…',
  busy: 'The server is busy right now. Please try again in a minute.',
  server: (status: number) => `The server had a problem saving your video (error ${status}). Please try again.`,
  generic: 'The upload failed. Please try again.',
} as const;

/**
 * Turns an upload that ended without a usable answer into a specific message. `status` is the HTTP status
 * (0 when there was none: network failure or timeout), `serverMessage` the server's own error text when it
 * sent one (that always wins — it states the real cause), `sent` whether the whole file had been transmitted.
 */
export function describeUploadFailure(input: { status: number; serverMessage?: string | null; sent: boolean; timedOut?: boolean }): UploadFailure {
  const { status, serverMessage, sent, timedOut } = input;
  const gateway = status === 502 || status === 504 || status === 524;
  if (serverMessage && !gateway) return { message: serverMessage, recoverable: false };
  if (status === 413) return { message: UPLOAD_MESSAGES.tooLarge, recoverable: false };
  if (status === 408) return { message: UPLOAD_MESSAGES.slow, recoverable: false };
  if (gateway) return { message: UPLOAD_MESSAGES.gateway, recoverable: true };
  if (status === 503) return { message: UPLOAD_MESSAGES.busy, recoverable: false };
  if (status >= 500) return { message: UPLOAD_MESSAGES.server(status), recoverable: false };
  if (status === 0) {
    if (timedOut) return sent ? { message: UPLOAD_MESSAGES.lostAfterSent, recoverable: true } : { message: UPLOAD_MESSAGES.slow, recoverable: false };
    return sent ? { message: UPLOAD_MESSAGES.lostAfterSent, recoverable: true } : { message: UPLOAD_MESSAGES.lostBeforeSent, recoverable: false };
  }
  return { message: UPLOAD_MESSAGES.generic, recoverable: false };
}
