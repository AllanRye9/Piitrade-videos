import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { LocalFile } from '../api';
import Sheet from '../components/Sheet';
import { Button, ErrorText, Icon, SectionLabel, TextField } from '../components/ui';
import { MAX_VIDEO_SECONDS } from '../config';
import EditTools from '../components/EditTools';
import { buildEditsPayload, defaultEdit, fitTextsToLength, isUnedited, outputSeconds } from '../lib/editModel';
import type { EditState } from '../lib/editModel';
import { PickedVideo, pickVideo } from '../lib/pickers';
import { useApp } from '../state/AppContext';
import { UploadDraft, isUploadBusy, startUpload } from '../state/uploads';
import { colors, radius, space } from '../theme';

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'];
const MAX_AUDIO_MB = 50;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Preview({ uri, speed }: { uri: string; speed: number }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  // The edited speed is previewed here; colour, crop, rotation and text appear in the posted video.
  useEffect(() => {
    player.playbackRate = Math.min(4, Math.max(0.25, speed));
  }, [player, speed]);
  return <VideoView player={player} style={styles.preview} contentFit="contain" nativeControls />;
}

function Tune({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return (
    <>
      <Text style={styles.small}>{label}</Text>
      <Slider minimumValue={min} maximumValue={max} step={step} value={value} onValueChange={onChange} minimumTrackTintColor={colors.brand} maximumTrackTintColor={colors.surfaceHigh} thumbTintColor={colors.brandSoft} />
    </>
  );
}

/** Upload popup: pick → (trim to 60s) → caption → optional music → Post. Closes on Post; progress continues in <UploadStatus />. */
export default function UploadSheet({ draft }: { draft?: UploadDraft }) {
  const { closeSheet } = useApp();
  const [picked, setPicked] = useState<PickedVideo | null>(draft ? { file: draft.file, uri: draft.uri, duration: draft.duration } : null);
  const [sourceDuration, setSourceDuration] = useState<number | null>(draft?.duration ?? null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimLength, setTrimLength] = useState(MAX_VIDEO_SECONDS);
  const [title, setTitle] = useState(draft?.title ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');

  const [audio, setAudio] = useState<LocalFile | null>(null);
  const [audioVol, setAudioVol] = useState(0.7);
  const [audioStart, setAudioStart] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>(defaultEdit);

  const needsTrim = sourceDuration !== null && sourceDuration > MAX_VIDEO_SECONDS + 0.05;
  const maxLen = needsTrim ? Math.min(MAX_VIDEO_SECONDS, (sourceDuration as number) - trimStart) : MAX_VIDEO_SECONDS;

  // The part of the source being worked on: the trim window for a long video, else the whole video.
  const clipWindow = sourceDuration !== null ? (needsTrim ? { start: trimStart, end: trimStart + trimLength } : { start: 0, end: sourceDuration }) : null;
  const editedByTools = !isUnedited(edit);
  const editedLength = clipWindow && editedByTools ? outputSeconds(clipWindow, edit) : null;

  useEffect(() => {
    if (needsTrim && trimLength > maxLen) setTrimLength(Math.max(1, maxLen));
  }, [needsTrim, maxLen, trimLength]);

  // Reopened after a "too long" rejection: start with a full-length window.
  useEffect(() => {
    if (draft?.duration) setTrimLength(Math.min(draft.duration, MAX_VIDEO_SECONDS));
  }, [draft]);

  async function choose() {
    setError(null);
    try {
      const v = await pickVideo();
      if (!v) return;
      setPicked(v);
      setSourceDuration(v.duration);
      setTrimStart(0);
      setTrimLength(Math.min(v.duration ?? MAX_VIDEO_SECONDS, MAX_VIDEO_SECONDS));
      setEdit(defaultEdit());
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

  function post() {
    if (!picked) return;
    if (isUploadBusy()) {
      setError('Another video is still uploading — wait for it to finish.');
      return;
    }
    if (editedLength !== null && (editedLength < 1 - 0.05 || editedLength > MAX_VIDEO_SECONDS + 0.05)) {
      setError(`The edited video must be between 1 and ${MAX_VIDEO_SECONDS} seconds — open Edit and shorten it.`);
      return;
    }
    // Edits are sent as one JSON field and replace the plain trim; without edits the trim clipWindow is sent as before.
    // The phone doesn't know the frame size exactly (rotation), so a crop goes as a shape for the server to place.
    const edits = clipWindow && editedByTools ? buildEditsPayload(clipWindow, { ...edit, texts: fitTextsToLength(edit.texts, editedLength ?? 0) }, null) : null;
    // Hand off and get out of the way; <UploadStatus /> shows the progress.
    startUpload({
      file: picked.file,
      title: title.trim() || 'Untitled',
      description: description.trim(),
      edits,
      trim: edits ? null : needsTrim ? { start: trimStart, end: trimStart + trimLength } : null,
      audio: audio ? { file: audio, audioVolume: audioVol, audioStart } : null,
      draft: { file: picked.file, uri: picked.uri, duration: sourceDuration, title, description },
    });
    closeSheet();
  }

  const startPct = needsTrim ? (trimStart / (sourceDuration as number)) * 100 : 0;
  const lenPct = needsTrim ? (trimLength / (sourceDuration as number)) * 100 : 100;

  return (
    <Sheet title={needsTrim ? 'Trim your video' : 'New video'} onClose={closeSheet} maxHeight={0.94} fill>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!picked ? (
          <Pressable onPress={choose} style={styles.drop} accessibilityRole="button" accessibilityLabel="Choose a video">
            <View style={styles.dropIcon}>
              <Icon name="videocam" size={32} color={colors.brandSoft} />
            </View>
            <Text style={styles.dropTitle}>Choose a video</Text>
            <Text style={styles.dropSub}>Up to {MAX_VIDEO_SECONDS} seconds · longer clips can be trimmed</Text>
          </Pressable>
        ) : (
          <>
            <View>
              <Preview uri={picked.uri} speed={edit.speed} />
              {sourceDuration ? (
                <View style={styles.durBadge}>
                  <Text style={styles.durText}>{fmt(sourceDuration)}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.fileRow}>
              <Text style={styles.fileName} numberOfLines={1}>
                {picked.file.name}
              </Text>
              <Pressable onPress={choose} hitSlop={8}>
                <Text style={styles.link}>Change</Text>
              </Pressable>
            </View>

            {needsTrim && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Icon name="cut-outline" size={16} color={colors.brandSoft} />
                  <SectionLabel>{`Keep up to ${MAX_VIDEO_SECONDS}s`}</SectionLabel>
                </View>
                {/* Timeline: the lit segment is the part that gets posted */}
                <View style={styles.timeline}>
                  <View style={[styles.clipWindow, { left: `${startPct}%`, width: `${lenPct}%` }]} />
                </View>
                <Text style={styles.value}>
                  {fmt(trimStart)} → {fmt(trimStart + trimLength)} · {Math.round(trimLength)}s
                </Text>
                <Tune label="Start" value={trimStart} min={0} max={Math.max(0, (sourceDuration as number) - 1)} onChange={setTrimStart} />
                <Tune label="Length" value={trimLength} min={1} max={Math.max(1, maxLen)} onChange={setTrimLength} />
              </View>
            )}

            {clipWindow && (
              <EditTools window={clipWindow} edit={edit} onChange={setEdit} maxSeconds={MAX_VIDEO_SECONDS} hasMusic={!!audio} />
            )}

            <View style={{ gap: 4 }}>
              <TextField label="Title" value={title} onChangeText={setTitle} maxLength={100} placeholder="Give it a title" />
              <Text style={styles.counter}>{title.length}/100</Text>
            </View>
            <View style={{ gap: 4 }}>
              <TextField label="Description" value={description} onChangeText={setDescription} multiline maxLength={500} placeholder="Add details and #hashtags so people can find it" />
              <Text style={styles.counter}>{description.length}/500</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Icon name="musical-notes-outline" size={16} color={colors.brandSoft} />
                <SectionLabel>Music (optional)</SectionLabel>
              </View>
              {audio ? (
                <>
                  <View style={styles.fileRow}>
                    <Text style={[styles.fileName, { flex: 1 }]} numberOfLines={1}>
                      {audio.name}
                    </Text>
                    <Pressable onPress={() => setAudio(null)} hitSlop={8}>
                      <Text style={[styles.link, { color: colors.danger }]}>Remove</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.small}>Added sound replaces the video’s original audio.</Text>
                  <Tune label={`Music · ${Math.round(audioVol * 100)}%`} value={audioVol} min={0} max={1} onChange={setAudioVol} />
                  <Tune label={`Start music at · ${fmt(audioStart)}`} value={audioStart} min={0} max={300} step={1} onChange={setAudioStart} />
                </>
              ) : (
                <Button title="Add music" variant="secondary" icon="add" onPress={chooseAudio} />
              )}
            </View>
          </>
        )}
        <ErrorText>{error}</ErrorText>
      </ScrollView>

      {/* Sticky action bar — always reachable, however long the form gets */}
      {picked && (
        <View style={styles.footer}>
          <Button title={editedLength !== null ? `Post ${Math.round(editedLength * 10) / 10}s clip` : needsTrim ? `Post ${Math.round(trimLength)}s clip` : 'Post video'} icon="cloud-upload-outline" onPress={post} />
          <Text style={styles.hint}>You can keep watching while it uploads.</Text>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.sm, gap: space.lg },
  drop: { alignItems: 'center', gap: space.sm, paddingVertical: 56, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)', backgroundColor: colors.surfaceRaised },
  dropIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(255,179,71,0.14)', alignItems: 'center', justifyContent: 'center' },
  dropTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  dropSub: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: space.xl },
  preview: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.lg, backgroundColor: '#000' },
  durBadge: { position: 'absolute', right: 10, bottom: 10, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  durText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'space-between' },
  fileName: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  link: { color: colors.brandSoft, fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  timeline: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  clipWindow: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.brand, borderRadius: 5 },
  value: { color: colors.text, fontSize: 15, fontWeight: '700' },
  small: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  counter: { color: colors.textFaint, fontSize: 11, textAlign: 'right' },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  hint: { color: colors.textFaint, fontSize: 11, textAlign: 'center' },
});
