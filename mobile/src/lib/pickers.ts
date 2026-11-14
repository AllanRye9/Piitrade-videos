import * as ImagePicker from 'expo-image-picker';
import type { LocalFile } from '../api';

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', '3gp', 'avi', 'mkv', 'wmv', 'flv'];
const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
};

function extOf(nameOrUri: string): string {
  const clean = nameOrUri.split('?')[0];
  const m = /\.([a-z0-9]{2,4})$/i.exec(clean);
  return m ? m[1].toLowerCase() : '';
}

export interface PickedVideo {
  file: LocalFile;
  /** Seconds, or null when the OS didn't report it. */
  duration: number | null;
  uri: string;
}

/** Opens the system gallery for a video. Returns null if cancelled. Throws a readable Error if blocked. */
export async function pickVideo(): Promise<PickedVideo | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsEditing: false, quality: 1, videoMaxDuration: 0 });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const ext = extOf(a.fileName || '') || extOf(a.uri) || 'mp4';
  if (!VIDEO_EXT.includes(ext)) throw new Error('Unsupported video format. Supported: MP4, MOV, WebM, M4V, 3GP, AVI, MKV, WMV, FLV.');
  return {
    file: { uri: a.uri, name: a.fileName && extOf(a.fileName) ? a.fileName : `video.${ext}`, type: a.mimeType || MIME_BY_EXT[ext] || 'video/mp4' },
    duration: a.duration != null ? a.duration / 1000 : null,
    uri: a.uri,
  };
}

/** Opens the gallery for a (cropped, square) profile photo. Returns null if cancelled. */
export async function pickAvatar(): Promise<LocalFile | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const ext = extOf(a.fileName || '') || extOf(a.uri) || 'jpg';
  return { uri: a.uri, name: `avatar.${ext}`, type: a.mimeType || MIME_BY_EXT[ext] || 'image/jpeg' };
}
