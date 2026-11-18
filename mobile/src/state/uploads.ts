import { useSyncExternalStore } from 'react';
import { ApiError, AudioUpload, VideoLink, LocalFile, TrimRange, api } from '../api';
import type { Video } from '../types';
import { MAX_VIDEO_SECONDS } from '../config';

/**
 * Uploads run here, not inside the upload popup: the popup hands over the
 * file and closes at once, and <UploadStatus /> shows live progress while
 * the person keeps watching.
 */
export type UploadPhase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

/** Enough of the popup's state to reopen it after a "too long" rejection. */
export interface UploadDraft {
  file: LocalFile;
  uri: string;
  duration: number | null;
  title: string;
  description: string;
}

export interface UploadParams {
  file: LocalFile;
  title: string;
  description: string;
  trim: TrimRange | null;
  audio: AudioUpload | null;
  link?: VideoLink | null;
  draft: UploadDraft;
}

export interface UploadState {
  phase: UploadPhase;
  progress: number;
  title: string;
  error: string | null;
  /** Set when the server measured a longer clip than the phone reported. */
  tooLongDraft: UploadDraft | null;
  video: Video | null;
}

const IDLE: UploadState = { phase: 'idle', progress: 0, title: '', error: null, tooLongDraft: null, video: null };

let state: UploadState = IDLE;
let lastParams: UploadParams | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<UploadState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function startUpload(params: UploadParams, onDone?: (v: Video) => void): void {
  if (state.phase === 'uploading' || state.phase === 'processing') return;
  lastParams = params;
  set({ ...IDLE, phase: 'uploading', title: params.title });
  api
    .uploadVideo(params.file, params.title, params.description, (pct) => set({ progress: pct, phase: pct >= 100 ? 'processing' : 'uploading' }), params.trim, params.audio, params.link)
    .then((res) => {
      lastParams = null;
      set({ phase: 'done', progress: 100, video: res.video });
      onDone?.(res.video);
    })
    .catch((err) => {
      if (err instanceof ApiError && err.code === 'VIDEO_TOO_LONG' && err.duration) {
        set({
          phase: 'error',
          error: `This video is ${Math.round(err.duration)}s — the limit is ${MAX_VIDEO_SECONDS}s. Choose which part to post.`,
          tooLongDraft: { ...params.draft, duration: err.duration },
        });
        return;
      }
      set({ phase: 'error', error: err instanceof Error ? err.message : 'Upload failed' });
    });
}

export function retryUpload(): void {
  if (state.phase !== 'error' || !lastParams || state.tooLongDraft) return;
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
