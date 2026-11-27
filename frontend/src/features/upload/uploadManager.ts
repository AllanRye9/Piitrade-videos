import { useSyncExternalStore } from 'react';
import { api, ApiError } from '../../lib/api';
import type { AudioUpload, TrimRange } from '../../lib/api';
import type { ProductPin, Video } from '../../lib/types';
import { MAX_VIDEO_SECONDS } from '../../lib/config';

/**
 * Runs an upload *outside* the upload dialog. The dialog hands over its
 * file and closes immediately; this module keeps the request alive and
 * publishes progress for <UploadStatus />, so people can keep watching
 * while their video uploads and processes.
 */
export type UploadPhase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export interface UploadParams {
  file: File;
  title: string;
  description: string;
  trim: TrimRange | null;
  audio: AudioUpload | null;
  products?: ProductPin[];
  /** Editor settings (see editModel.ts); null/absent for a plain upload or trim. */
  edits?: Record<string, unknown> | null;
}

export interface UploadState {
  phase: UploadPhase;
  progress: number;
  title: string;
  error: string | null;
  /** The server measured a longer clip than the browser could — the person must pick a section. */
  tooLong: boolean;
  video: Video | null;
}

const IDLE: UploadState = { phase: 'idle', progress: 0, title: '', error: null, tooLong: false, video: null };

let state: UploadState = IDLE;
let lastParams: UploadParams | null = null;
let onUploaded: ((video: Video) => void) | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<UploadState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** The app registers one callback so a finished video can be added to the feed. */
export function setUploadedHandler(fn: ((video: Video) => void) | null) {
  onUploaded = fn;
}

export function startUpload(params: UploadParams): void {
  if (state.phase === 'uploading' || state.phase === 'processing') return;
  lastParams = params;
  set({ ...IDLE, phase: 'uploading', title: params.title });
  run(params);
}

async function run(params: UploadParams) {
  try {
    const res = await api.uploadVideo(
      params.file,
      params.title,
      params.description,
      (pct) => set({ progress: pct, phase: pct >= 100 ? 'processing' : 'uploading' }),
      params.trim,
      params.audio,
      params.products,
      params.edits
    );
    set({ phase: 'done', progress: 100, video: res.video });
    lastParams = null;
    onUploaded?.(res.video);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'VIDEO_TOO_LONG' && err.duration) {
      set({
        phase: 'error',
        tooLong: true,
        error: `This video is ${Math.round(err.duration)}s — the limit is ${MAX_VIDEO_SECONDS}s. Upload it again and choose which part to post.`,
      });
      return;
    }
    set({ phase: 'error', tooLong: false, error: err instanceof Error ? err.message : 'Upload failed' });
  }
}

export function retryUpload(): void {
  if (state.phase !== 'error' || !lastParams || state.tooLong) return;
  startUpload(lastParams);
}

export function dismissUpload(): void {
  if (state.phase === 'uploading' || state.phase === 'processing') return;
  lastParams = null;
  set(IDLE);
}

export function isUploadBusy(): boolean {
  return state.phase === 'uploading' || state.phase === 'processing';
}

export function useUploadState(): UploadState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state
  );
}
