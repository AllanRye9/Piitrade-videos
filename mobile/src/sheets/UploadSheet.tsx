import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { ApiError, LocalFile, api } from '../api';
import type { Video } from '../types';
import Sheet from '../components/Sheet';
import { Button, ErrorText, Icon, SectionLabel, TextField } from '../components/ui';
import { MAX_VIDEO_SECONDS } from '../config';
import { PickedVideo, pickVideo } from '../lib/pickers';
import { useApp } from '../state/AppContext';
import { colors, radius, space } from '../theme';

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'];
const MAX_AUDIO_MB = 50;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Preview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={styles.preview} contentFit="contain" nativeControls />;
}

/** Upload popup: pick → (trim to 30s) → caption → optional music → post. */
export default function UploadSheet({ onUploaded }: { onUploaded?: (v: Video) => void }) {
  const { closeSheet, pushPage } = useApp();
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimLength, setTrimLength] = useState(MAX_VIDEO_SECONDS);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [audio, setAudio] = useState<LocalFile | null>(null);
  const [videoVol, setVideoVol] = useState(1);
  const [audioVol, setAudioVol] = useState(0.7);
  const [audioStart, setAudioStart] = useState(0);

  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const uploading = progress !== null && !done;
  const needsTrim = sourceDuration !== null && sourceDuration > MAX_VIDEO_SECONDS + 0.05;
  const maxLen = needsTrim ? Math.min(MAX_VIDEO_SECONDS, (sourceDuration as number) - trimStart) : MAX_VIDEO_SECONDS;

  useEffect(() => {
    if (needsTrim && trimLength > maxLen) setTrimLength(Math.max(1, maxLen));
  }, [needsTrim, maxLen, trimLength]);

  async function choose() {
    setError(null);
    try {
      const v = await pickVideo();
      if (!v) return;
      setPicked(v);
      setSourceDuration(v.duration);
      setTrimStart(0);
      setTrimLength(Math.min(v.duration ?? MAX_VIDEO_SECONDS, MAX_VIDEO_SECONDS));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that video');
    }
  }

  async function chooseAudio() {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const ext = (a.name.split('.').pop() || '').toLowerCase();
      if (!AUDIO_EXT.includes(ext)) return setError('Unsupported audio format. Supported: MP3, M4A, AAC, WAV, OGG, Opus, FLAC.');
      if (a.size && a.size > MAX_AUDIO_MB * 1024 * 1024) return setError(`That audio file is too large (max ${MAX_AUDIO_MB}MB).`);
      setAudio({ uri: a.uri, name: a.name, type: a.mimeType || 'audio/mpeg' });
      setAudioStart(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that audio file');
    }
  }

  async function submit() {
    if (!picked) return;
    setError(null);
    setProgress(0);
    try {
      const res = await api.uploadVideo(
        picked.file,
        title.trim(),
        description.trim(),
        setProgress,
        needsTrim ? { start: trimStart, end: trimStart + trimLength } : null,
        audio ? { file: audio, videoVolume: videoVol, audioVolume: audioVol, audioStart } : null
      );
      setDone(true);
      onUploaded?.(res.video);
      setTimeout(() => {
        closeSheet();
        pushPage({ name: 'viewer', videos: [res.video], index: 0, title: 'Your new video' });
      }, 900);
    } catch (e) {
      setProgress(null);
      // The server measured a longer clip than the phone could — switch to the trim editor.
      if (e instanceof ApiError && e.code === 'VIDEO_TOO_LONG' && e.duration) {
        setSourceDuration(e.duration);
        setTrimLength(MAX_VIDEO_SECONDS);
        setError(`This video is ${Math.round(e.duration)}s long. Choose up to ${MAX_VIDEO_SECONDS}s to keep.`);
        return;
      }
      setError(e instanceof Error ? e.message : 'Upload failed');
    }
  }

  return (
    <Sheet title="New video" onClose={uploading ? () => {} : closeSheet} maxHeight={0.94}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!picked ? (
          <Pressable onPress={choose} style={styles.drop} accessibilityRole="button" accessibilityLabel="Choose a video">
            <View style={styles.dropIcon}>
              <Icon name="videocam" size={30} color={colors.brandSoft} />
            </View>
            <Text style={styles.dropTitle}>Choose a video</Text>
            <Text style={styles.dropSub}>Up to {MAX_VIDEO_SECONDS} seconds · longer clips can be trimmed</Text>
          </Pressable>
        ) : (
          <>
            <Preview uri={picked.uri} />
            <View style={styles.fileRow}>
              <Text style={styles.fileName} numberOfLines={1}>
                {picked.file.name}
                {sourceDuration ? ` · ${fmt(sourceDuration)}` : ''}
              </Text>
              {!uploading && (
                <Pressable onPress={choose} hitSlop={8}>
                  <Text style={styles.link}>Change</Text>
                </Pressable>
              )}
            </View>

            {needsTrim && (
              <View style={styles.card}>
                <SectionLabel>{`Trim to ${MAX_VIDEO_SECONDS}s or less`}</SectionLabel>
                <Text style={styles.value}>
                  {fmt(trimStart)} → {fmt(trimStart + trimLength)} · {Math.round(trimLength)}s
                </Text>
                <Text style={styles.small}>Start</Text>
                <Slider minimumValue={0} maximumValue={Math.max(0, (sourceDuration as number) - 1)} value={trimStart} onValueChange={setTrimStart} minimumTrackTintColor={colors.brand} maximumTrackTintColor={colors.surfaceHigh} thumbTintColor={colors.brandSoft} disabled={uploading} />
                <Text style={styles.small}>Length</Text>
                <Slider minimumValue={1} maximumValue={Math.max(1, maxLen)} value={trimLength} onValueChange={setTrimLength} minimumTrackTintColor={colors.brand} maximumTrackTintColor={colors.surfaceHigh} thumbTintColor={colors.brandSoft} disabled={uploading} />
              </View>
            )}

            <TextField label="Title" value={title} onChangeText={setTitle} maxLength={100} placeholder="Give it a title" editable={!uploading} />
            <TextField label="Description" value={description} onChangeText={setDescription} multiline maxLength={500} placeholder="Add details and #hashtags" editable={!uploading} />

            <View style={styles.card}>
              <SectionLabel>Music (optional)</SectionLabel>
              {audio ? (
                <>
                  <View style={styles.fileRow}>
                    <Icon name="musical-notes" size={18} color={colors.brandSoft} />
                    <Text style={[styles.fileName, { flex: 1 }]} numberOfLines={1}>
                      {audio.name}
                    </Text>
                    {!uploading && (
                      <Pressable onPress={() => setAudio(null)} hitSlop={8}>
                        <Text style={[styles.link, { color: colors.danger }]}>Remove</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text style={styles.small}>Original sound · {Math.round(videoVol * 100)}%</Text>
                  <Slider minimumValue={0} maximumValue={1} value={videoVol} onValueChange={setVideoVol} minimumTrackTintColor={colors.brand} maximumTrackTintColor={colors.surfaceHigh} thumbTintColor={colors.brandSoft} disabled={uploading} />
                  <Text style={styles.small}>Music · {Math.round(audioVol * 100)}%</Text>
                  <Slider minimumValue={0} maximumValue={1} value={audioVol} onValueChange={setAudioVol} minimumTrackTintColor={colors.brand} maximumTrackTintColor={colors.surfaceHigh} thumbTintColor={colors.brandSoft} disabled={uploading} />
                  <Text style={styles.small}>Start music at · {fmt(audioStart)}</Text>
                  <Slider minimumValue={0} maximumValue={300} step={1} value={audioStart} onValueChange={setAudioStart} minimumTrackTintColor={colors.brand} maximumTrackTintColor={colors.surfaceHigh} thumbTintColor={colors.brandSoft} disabled={uploading} />
                </>
              ) : (
                <Button title="Add music" variant="secondary" icon="musical-notes-outline" onPress={chooseAudio} disabled={uploading} />
              )}
            </View>

            <ErrorText>{error}</ErrorText>

            {uploading ? (
              <View style={{ gap: space.sm }}>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${progress}%` }]} />
                </View>
                <Text style={styles.small}>{progress === 100 ? 'Processing on the server…' : `Uploading… ${progress}%`}</Text>
              </View>
            ) : done ? (
              <View style={styles.doneRow}>
                <Icon name="checkmark-circle" size={22} color={colors.success} />
                <Text style={styles.value}>Posted!</Text>
              </View>
            ) : (
              <Button title="Post video" icon="cloud-upload-outline" onPress={submit} disabled={!title.trim()} />
            )}
          </>
        )}
        {!picked && <ErrorText>{error}</ErrorText>}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.sm, gap: space.lg },
  drop: { alignItems: 'center', gap: space.sm, paddingVertical: 48, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)', backgroundColor: colors.surfaceRaised },
  dropIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,179,71,0.14)', alignItems: 'center', justifyContent: 'center' },
  dropTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  dropSub: { color: colors.textMuted, fontSize: 13 },
  preview: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.lg, backgroundColor: '#000' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'space-between' },
  fileName: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  link: { color: colors.brandSoft, fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  value: { color: colors.text, fontSize: 15, fontWeight: '700' },
  small: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.brand },
  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, height: 50 },
});
