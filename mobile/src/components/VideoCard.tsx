import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import type { Video } from '../types';
import { WEB_URL, mediaUrl } from '../config';
import { useApp } from '../state/AppContext';
import { mutedStore, setMuted } from '../state/stores';
import { colors, radius, space } from '../theme';
import { Avatar, Icon, formatCount } from './ui';

interface Props {
  video: Video;
  active: boolean;
  height: number;
  /** Extra bottom padding so the caption clears the bottom bar. */
  bottomInset?: number;
}

const HASHTAG = /#([a-z0-9_]{1,30})/gi;

function Caption({ text, onTag }: { text: string; onTag: (tag: string) => void }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(HASHTAG)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    const tag = m[1].toLowerCase();
    parts.push(
      <Text key={key++} style={styles.tag} onPress={() => onTag(tag)}>
        #{m[1]}
      </Text>
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Text style={styles.desc}>{parts}</Text>;
}

function RailButton({ icon, label, onPress, color = colors.text, a11y }: { icon: React.ComponentProps<typeof Icon>['name']; label?: string; onPress: () => void; color?: string; a11y: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} hitSlop={6} style={({ pressed }) => [styles.rail, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={30} color={color} />
      {label !== undefined && <Text style={styles.railLabel}>{label}</Text>}
    </Pressable>
  );
}

export default function VideoCard({ video, active, height, bottomInset = 0 }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { requireAuth, openSheet, pushPage, setWatching } = useApp();
  const muted = useSyncExternalStore(mutedStore.subscribe, () => mutedStore.get().muted);
  const src = mediaUrl(video.url) || video.url;

  // Only the active card owns a live decoder; the rest show the poster.
  const player = useVideoPlayer(active ? src : null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
  });

  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [liked, setLiked] = useState(video.liked);
  const [likes, setLikes] = useState(video.likes);
  const [saved, setSaved] = useState(video.saved);
  const [commentCount, setCommentCount] = useState(video.comments);
  const [shareCount, setShareCount] = useState(video.shares);
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    if (active) {
      setPaused(false);
      player.currentTime = 0;
      player.play();
    } else {
      player.pause();
    }
  }, [active, player, src]);

  // Tell the guest-nudge timer whether a video is actually being watched.
  useEffect(() => {
    setWatching(active && !paused);
    return () => setWatching(false);
  }, [active, paused, setWatching]);

  useEffect(() => {
    if (!active) return;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const d = player.duration || video.duration || 0;
      setProgress(d > 0 ? Math.min(1, currentTime / d) : 0);
    });
    return () => sub.remove();
  }, [active, player, video.duration]);

  const togglePlay = useCallback(() => {
    if (paused) {
      player.play();
      setPaused(false);
    } else {
      player.pause();
      setPaused(true);
    }
  }, [paused, player]);

  async function onLike() {
    requireAuth('Sign in to like videos.', async () => {
      const was = liked;
      setLiked(!was);
      setLikes((n) => n + (was ? -1 : 1));
      try {
        const res = await api.like(video.id);
        setLiked(res.liked);
        setLikes(res.likes);
      } catch {
        setLiked(was);
        setLikes((n) => n + (was ? 1 : -1));
      }
    });
  }

  function onSave() {
    requireAuth('Sign in to save videos.', async () => {
      const was = saved;
      setSaved(!was);
      try {
        const res = await api.save(video.id);
        setSaved(res.saved);
      } catch {
        setSaved(was);
      }
    });
  }

  function onComments() {
    // Reading comments is open to everyone; posting is gated inside the sheet.
    openSheet({ type: 'comments', video, onCountChange: setCommentCount });
  }

  async function onShare() {
    // Sharing a link is harmless and drives growth — open to guests.
    const url = `${WEB_URL}/v/${video.id}`;
    try {
      const res = await Share.share({ message: `${video.title || 'Watch this on Piitrade Videos'}\n${url}`, url, title: video.title || 'Piitrade video' });
      if (res.action === Share.sharedAction) {
        setShareCount((c) => c + 1);
        api.shareVideo(video.id).catch(() => {});
      }
    } catch {
      // share sheet failed to open — nothing to do
    }
  }

  function onFollow() {
    const handle = video.uploader?.handle;
    if (!handle) return;
    requireAuth('Sign in to follow creators.', async () => {
      setFollowing(true);
      try {
        const res = await api.followAccount(handle);
        setFollowing(res.following);
      } catch {
        setFollowing(false);
      }
    });
  }

  const poster = useMemo(() => mediaUrl(video.poster), [video.poster]);
  const uploader = video.uploader;

  return (
    <View style={{ width, height, backgroundColor: '#000' }}>
      {active ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      ) : poster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}

      <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay} accessibilityLabel={paused ? 'Play video' : 'Pause video'} />

      {paused && (
        <View pointerEvents="none" style={styles.pauseBadge}>
          <Icon name="play" size={44} color="rgba(255,255,255,0.9)" />
        </View>
      )}

      {/* bottom scrim keeps captions legible on bright video */}
      <View pointerEvents="none" style={styles.scrim} />

      <View pointerEvents="box-none" style={[styles.rightRail, { bottom: bottomInset + space.xl }]}>
        <RailButton a11y={liked ? 'Unlike' : 'Like'} icon={liked ? 'heart' : 'heart-outline'} color={liked ? colors.brand : colors.text} label={formatCount(likes)} onPress={onLike} />
        <RailButton a11y="Comments" icon="chatbubble-ellipses-outline" label={formatCount(commentCount)} onPress={onComments} />
        <RailButton a11y={saved ? 'Remove bookmark' : 'Bookmark'} icon={saved ? 'bookmark' : 'bookmark-outline'} color={saved ? colors.brandSoft : colors.text} onPress={onSave} />
        <RailButton a11y="Share" icon="arrow-redo-outline" label={formatCount(shareCount)} onPress={onShare} />
        <RailButton a11y="Find on Piitrade" icon="search-circle-outline" label="Find" onPress={() => openSheet({ type: 'find', initialQuery: video.hashtags[0] || video.title })} />
        <RailButton a11y={muted ? 'Unmute' : 'Mute'} icon={muted ? 'volume-mute' : 'volume-high'} onPress={() => setMuted(!muted)} />
        <RailButton a11y="More" icon="ellipsis-horizontal" onPress={() => openSheet({ type: 'more', video })} />
      </View>

      <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: bottomInset + space.xl, paddingRight: 84 }]}>
        {uploader ? (
          <View style={styles.uploaderRow}>
            <Pressable onPress={() => pushPage({ name: 'account', handle: uploader.handle })} style={styles.uploaderLink} accessibilityRole="button" accessibilityLabel={`Open ${uploader.handle}`}>
              <Avatar uri={uploader.avatar} name={uploader.displayName || uploader.handle} size={36} />
              <Text style={styles.handle} numberOfLines={1}>
                @{uploader.handle}
              </Text>
            </Pressable>
            <Pressable onPress={onFollow} style={[styles.follow, following && styles.following]} accessibilityRole="button">
              <Text style={styles.followText}>{following ? 'Following' : 'Follow'}</Text>
            </Pressable>
          </View>
        ) : null}
        {video.title ? (
          <Text style={styles.title} numberOfLines={expanded ? 6 : 2}>
            {video.title}
          </Text>
        ) : null}
        {video.description ? (
          <Pressable onPress={() => setExpanded((e) => !e)}>
            <View style={{ maxHeight: expanded ? undefined : 40, overflow: 'hidden' }}>
              <Caption text={video.description} onTag={(tag) => pushPage({ name: 'tag', tag })} />
            </View>
          </Pressable>
        ) : null}
      </View>

      <View pointerEvents="none" style={[styles.progressTrack, { bottom: bottomInset }]}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pauseBadge: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 280, backgroundColor: 'rgba(0,0,0,0.28)' },
  rightRail: { position: 'absolute', right: space.sm, alignItems: 'center', gap: space.lg },
  rail: { alignItems: 'center', minWidth: 48, gap: 2 },
  railLabel: { color: colors.text, fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingLeft: space.lg, gap: space.sm },
  uploaderRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  uploaderLink: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  handle: { color: colors.text, fontWeight: '800', fontSize: 15, flexShrink: 1 },
  follow: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 4 },
  following: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'transparent' },
  followText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  title: { color: colors.text, fontWeight: '700', fontSize: 15 },
  desc: { color: 'rgba(255,255,255,0.92)', fontSize: 14, lineHeight: 19 },
  tag: { color: colors.brandSoft, fontWeight: '700' },
  progressTrack: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  progressFill: { height: 2, backgroundColor: colors.text },
});
