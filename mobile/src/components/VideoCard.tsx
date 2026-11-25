import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, GestureResponderEvent, Platform, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import type { Video, VideoProduct } from '../types';
import { activeProducts, frameRect, type Frame } from '../lib/products';
import { isNetworkError } from '../lib/net';
import { track } from '../lib/analytics';
import { OFFLINE_BODY, OFFLINE_TITLE } from '../lib/links';
import { WEB_URL, mediaUrl } from '../config';
import { useApp } from '../state/AppContext';
import { mutedStore, setMuted } from '../state/stores';
import { colors, space } from '../theme';
import { Avatar, Icon, formatCount } from './ui';

interface Props {
  video: Video;
  active: boolean;
  /** The next card: its player is created and buffered (paused) so the swipe starts instantly. */
  preload?: boolean;
  /** Something is covering the feed (a page on top): stay paused. */
  suspended?: boolean;
  /** Height of this card = the visible video viewport. */
  height: number;
  /** Extra bottom padding for screens with no nav bar (e.g. the home-indicator inset). */
  bottomInset?: number;
}

const HASHTAG = /#([a-z0-9_]{1,30})/gi;

/**
 * Videos at or below this width/height ratio are "portrait enough" to fill the
 * viewport with `cover` (9:16 = 0.56, 3:4 = 0.75, 4:5 = 0.8). Anything wider —
 * landscape clips, squares — is letterboxed with `contain` so it is shown whole.
 */
const COVER_MAX_RATIO = 0.82;

type Fit = 'cover' | 'contain';

function fitFor(width?: number, height?: number): Fit {
  if (!width || !height) return 'cover'; // size unknown yet: keep the full-bleed default
  return width / height <= COVER_MAX_RATIO ? 'cover' : 'contain';
}

/**
 * Overlay proportions, modelled on TikTok's phone layout: a narrow right rail
 * (≈ 28px icons, 11–12px counts), a 2-line caption, and everything kept inside
 * the lower-left / right-edge thumb zones so the picture stays visible.
 */
const RAIL_WIDTH = 52;
const SIDE_MARGIN = 12;
const BOTTOM_MARGIN = 14;

function sizesFor(height: number) {
  const compact = height < 640; // small phones / split screen
  return { icon: compact ? 26 : 28, gap: compact ? 8 : 14, avatar: compact ? 40 : 44 };
}

/** Soft gradient from transparent to black without a gradient dependency: stacked bands with eased opacity. */
function Fade({ height, max, edge }: { height: number; max: number; edge: 'top' | 'bottom' }) {
  const bands = 18;
  return (
    <View pointerEvents="none" style={[styles.fade, { height }, edge === 'bottom' ? { bottom: 0 } : { top: 0 }]}>
      {Array.from({ length: bands }, (_, i) => {
        const t = (edge === 'bottom' ? i + 1 : bands - i) / bands; // 0 → far from the edge, 1 → at the edge
        return <View key={i} style={{ flex: 1, backgroundColor: `rgba(0,0,0,${(max * t * t).toFixed(3)})` }} />;
      })}
    </View>
  );
}

function CaptionText({ text, onTag }: { text: string; onTag: (tag: string) => void }) {
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
  return <>{parts}</>;
}

function RailButton({ icon, label, onPress, color = colors.text, a11y, size }: { icon: React.ComponentProps<typeof Icon>['name']; label?: string; onPress: () => void; color?: string; a11y: string; size: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} hitSlop={6} style={({ pressed }) => [styles.rail, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={size} color={color} />
      {label !== undefined && <Text style={styles.railLabel}>{label}</Text>}
    </Pressable>
  );
}

/** The heart that pops where you double-tapped. */
function HeartBurst({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 750, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start(onDone);
  }, [v, onDone]);
  const scale = v.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.4, 1.15, 1] });
  const opacity = v.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, -36] });
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: x - 44, top: y - 44, opacity, transform: [{ translateY }, { scale }] }}>
      <Icon name="heart" size={88} color={colors.brand} />
    </Animated.View>
  );
}

/**
 * Product chips for the current moment. Memoised on the active set, so the ~4 position updates per
 * second re-render this only when a chip actually appears or disappears.
 * Chips without a hotspot dock above the caption; chips with one sit on the picture at (x, y).
 */
const ProductChips = React.memo(function ProductChips({ products, frame, cardW, onOpen, docked, saved }: { products: VideoProduct[]; frame: Frame; cardW: number; onOpen: (p: VideoProduct) => void; docked: boolean; saved: Set<string> }) {
  const list = products.filter((p) => (p.x === null || p.y === null) === docked);
  if (list.length === 0) return null;
  if (docked) {
    return (
      <View style={styles.chipRow}>
        {list.map((p) => {
          const isSaved = saved.has(p.id);
          return (
            <Pressable
              key={p.id}
              onPress={() => onOpen(p)}
              accessibilityRole="button"
              accessibilityLabel={isSaved ? `${p.title || p.host} is saved. Open saved items` : `Save ${p.title || p.host} for later`}
              style={[styles.productChip, isSaved && styles.productChipSaved]}
            >
              <Icon name={isSaved ? 'checkmark-circle' : 'bookmark-outline'} size={15} color="#fff" />
              <Text style={styles.productChipText} numberOfLines={1}>{isSaved ? 'Saved' : p.title || 'Save this item'}</Text>
              <Text style={styles.productChipHost} numberOfLines={1}>{isSaved ? 'View list' : p.host}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <>
      {list.map((p) => {
        const px = frame.left + (p.x as number) * frame.width;
        const py = frame.top + (p.y as number) * frame.height;
        return (
          <Pressable key={p.id} onPress={() => onOpen(p)} accessibilityRole="button" accessibilityLabel={saved.has(p.id) ? `${p.title || p.host} is saved` : `Save ${p.title || p.host} for later`} style={[styles.hotspot, { left: Math.min(Math.max(8, px - 14), cardW - 160), top: py - 14 }]}>
            <View style={[styles.hotDot, saved.has(p.id) && { backgroundColor: colors.success }]} />
            <Text style={styles.hotText} numberOfLines={1}>{saved.has(p.id) ? 'Saved' : p.title || p.host}</Text>
          </Pressable>
        );
      })}
    </>
  );
});

export default function VideoCard({ video, active, preload = false, suspended = false, height, bottomInset = 0 }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { requireAuth, openSheet, pushPage, setWatching, signedIn } = useApp();
  const muted = useSyncExternalStore(mutedStore.subscribe, () => mutedStore.get().muted);
  const src = mediaUrl(video.url) || video.url;
  const sz = sizesFor(height);

  // The active card plays; the next one is created and buffered (paused) so swiping is instant.
  // Everything else shows its poster and holds no decoder.
  const player = useVideoPlayer(active || preload ? src : null, (p) => {
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
  const [following, setFollowing] = useState(!!video.uploader?.isFollowing);
  const [fit, setFit] = useState<Fit>('cover');
  const [firstFrame, setFirstFrame] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'readyToPlay' | 'error'>('idle');
  const [removed, setRemoved] = useState(false);
  const watchRef = useRef<{ startedAt: number | null; ms: number }>({ startedAt: null, ms: 0 });
  const impressedRef = useRef<Set<string>>(new Set());
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [activeKey, setActiveKey] = useState('');
  const [savedIds, setSavedIds] = useState<string[]>(() => (video.products ?? []).filter((p) => p.saved).map((p) => p.id));
  const sortedProducts = useMemo(() => [...(video.products ?? [])].sort((a, b) => a.startMs - b.startMs), [video.products]);
  const [burst, setBurst] = useState<{ x: number; y: number; key: number } | null>(null);
  const watchingToken = useRef(Symbol('video-watcher')).current;

  // Pick cover/contain from the real video dimensions (decoder track events), falling back to the poster's.
  useEffect(() => {
    setFit('cover');
    setFirstFrame(false);
    setStatus('idle');
  }, [src]);

  useEffect(() => {
    if (!active) return;
    const size = player.videoTrack?.size;
    if (size) {
      setFit(fitFor(size.width, size.height));
      setDims({ w: size.width, h: size.height });
    }
    const sub = player.addListener('videoTrackChange', ({ videoTrack }) => {
      const s = videoTrack?.size;
      if (s) {
        setFit(fitFor(s.width, s.height));
        setDims({ w: s.width, h: s.height });
      }
    });
    return () => sub.remove();
  }, [active, player, src]);

  // Loading / failure feedback — without it a failed video was just a frozen black screen.
  useEffect(() => {
    if (!active) return;
    setStatus(player.status);
    const sub = player.addListener('statusChange', ({ status: s }) => setStatus(s));
    return () => sub.remove();
  }, [active, player, src]);

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  // Becoming active restarts the clip; play/pause then follows one rule.
  useEffect(() => {
    if (active) {
      setPaused(false);
      player.currentTime = 0;
    }
  }, [active, player, src]);

  // ---- Viewing analytics (what feeds the "do tags hurt viewing?" guardrail) ----
  // One 'watch' event per time this card is the active one, carrying how long it actually played
  // (paused / covered / backgrounded time doesn't count). Declared BEFORE the play effect so each
  // activation starts with fresh counters; the flush adds any still-running stretch itself, so the
  // order of cleanups doesn't matter.
  useEffect(() => {
    if (!active) return;
    watchRef.current = { startedAt: null, ms: 0 };
    impressedRef.current.clear();
    return () => {
      const w = watchRef.current;
      const ms = w.ms + (w.startedAt !== null ? Date.now() - w.startedAt : 0);
      w.startedAt = null;
      if (ms >= 500) {
        const dur = Math.round((player.duration || video.duration || 0) * 1000);
        track({ type: 'watch', videoId: video.id, watchedMs: Math.round(ms), durationMs: dur > 0 ? dur : undefined });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, video.id]);

  const shouldPlay = active && !suspended && !paused;
  useEffect(() => {
    if (!shouldPlay) return;
    watchRef.current.startedAt = Date.now();
    return () => {
      const w = watchRef.current;
      if (w.startedAt !== null) {
        w.ms += Date.now() - w.startedAt;
        w.startedAt = null;
      }
    };
  }, [shouldPlay]);

  useEffect(() => {
    if (shouldPlay) player.play();
    else player.pause();
  }, [shouldPlay, player]);

  // Tell the guest-nudge timer whether a video is actually being watched.
  useEffect(() => {
    setWatching(watchingToken, shouldPlay);
    return () => setWatching(watchingToken, false);
  }, [shouldPlay, setWatching, watchingToken]);

  // Count a view once the video has really been watched for a moment (the server de-duplicates per session).
  const viewedRef = useRef(false);
  useEffect(() => {
    viewedRef.current = false;
  }, [video.id]);
  useEffect(() => {
    if (!shouldPlay || viewedRef.current) return;
    const t = setTimeout(() => {
      viewedRef.current = true;
      api.recordView(video.id).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [shouldPlay, video.id]);

  useEffect(() => {
    if (!active) return;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const d = player.duration || video.duration || 0;
      setProgress(d > 0 ? Math.min(1, currentTime / d) : 0);
      if (sortedProducts.length) {
        // Only the *set* of visible chips is state: it changes a few times per video, not every tick.
        const key = activeProducts(sortedProducts, currentTime * 1000).map((p) => p.id).join(',');
        setActiveKey((prev) => (prev === key ? prev : key));
      }
    });
    return () => {
      sub.remove();
      setActiveKey('');
    };
  }, [active, player, video.duration, sortedProducts]);

  const retry = useCallback(() => {
    setStatus('loading');
    player.replace(src);
    player.play();
  }, [player, src]);

  // ---- actions
  async function onLike() {
    requireAuth('Sign in to like videos.', async () => {
      const was = liked;
      setLiked(!was);
      setLikes((n) => Math.max(0, n + (was ? -1 : 1)));
      try {
        const res = await api.like(video.id);
        setLiked(res.liked);
        setLikes(res.likes);
      } catch {
        setLiked(was);
        setLikes((n) => Math.max(0, n + (was ? 1 : -1)));
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
    if (!handle || following) return;
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

  // Single tap = play/pause; double tap = like (never unlike), with a heart where you tapped.
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const likeRef = useRef(onLike);
  likeRef.current = onLike;
  const likedRef = useRef(liked);
  likedRef.current = liked;
  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
  }, []);

  function onSurfacePress(e: GestureResponderEvent) {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (signedIn) setBurst({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY, key: now });
      if (!likedRef.current) likeRef.current();
      else if (!signedIn) likeRef.current(); // guests get the sign-in prompt
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => setPaused((p) => !p), 230);
  }

  const poster = useMemo(() => mediaUrl(video.poster), [video.poster]);
  const visibleProducts = useMemo(() => (activeKey ? sortedProducts.filter((p) => activeKey.split(',').includes(p.id)) : []), [activeKey, sortedProducts]);
  const frame = useMemo(() => frameRect(width, height, dims, fit), [width, height, dims, fit]);

  // A tag counts as "shown" once per viewing, the first time it appears on screen.
  useEffect(() => {
    if (!active || suspended) return;
    for (const p of visibleProducts) {
      if (impressedRef.current.has(p.id)) continue;
      impressedRef.current.add(p.id);
      track({ type: 'chip', videoId: video.id, productId: p.id });
    }
  }, [active, suspended, visibleProducts, video.id]);
  const savedSet = useMemo(() => new Set(savedIds), [savedIds]);

  // Tapping a tag SAVES it and the video keeps playing — nothing opens, nothing pauses, no sign-in
  // prompt. Tapping an already-saved tag opens the Saved items list (still inside the app).
  const onChipTap = useCallback(
    async (p: VideoProduct) => {
      if (savedIds.includes(p.id)) {
        openSheet({ type: 'saved' });
        return;
      }
      setSavedIds((ids) => (ids.includes(p.id) ? ids : [...ids, p.id])); // optimistic
      try {
        await api.saveProduct(video.id, p.id);
      } catch (err) {
        setSavedIds((ids) => ids.filter((x) => x !== p.id));
        if (isNetworkError(err)) Alert.alert(OFFLINE_TITLE, OFFLINE_BODY);
        else Alert.alert('Couldn’t save', err instanceof Error ? err.message : 'Please try again.');
      }
    },
    [savedIds, video.id, openSheet]
  );
  const uploader = video.uploader;
  const showFollowBadge = !!uploader && !uploader.isOwn && !following;
  const hasCaption = !!video.title || !!video.description;

  if (removed) {
    return (
      <View style={{ width, height, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={styles.errorText}>Video deleted</Text>
      </View>
    );
  }

  return (
    <View style={{ width, height, backgroundColor: '#000' }}>
      {/* Letterboxed (non-portrait) videos get a blurred, dimmed copy of the poster behind them. */}
      {fit === 'contain' && poster ? (
        <>
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
        </>
      ) : null}

      {/* The poster stays underneath until the first decoded frame so the swap never flashes black. */}
      {poster && !(active && firstFrame) ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit={fit} onLoad={(e) => {
          if (active) return;
          setFit(fitFor(e.source?.width, e.source?.height));
          if (e.source?.width && e.source?.height) setDims({ w: e.source.width, h: e.source.height });
        }} />
      ) : null}

      {active || preload ? (
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, !active && { opacity: 0 }]}
          contentFit={fit}
          nativeControls={false}
          onFirstFrameRender={() => setFirstFrame(true)}
        />
      ) : null}

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onSurfacePress}
        onLongPress={() => openSheet({ type: 'more', video, onDeleted: () => setRemoved(true) })}
        delayLongPress={450}
        accessibilityLabel={paused ? 'Play video' : 'Pause video'}
      />

      {paused && !suspended && (
        <View pointerEvents="none" style={styles.center}>
          <Icon name="play" size={44} color="rgba(255,255,255,0.9)" />
        </View>
      )}

      {active && status === 'loading' && firstFrame === false && !paused ? (
        <View pointerEvents="none" style={styles.center}>
          <ActivityIndicator color="rgba(255,255,255,0.85)" />
        </View>
      ) : null}

      {active && status === 'error' ? (
        <View style={styles.center}>
          <View style={styles.errorCard}>
            <Icon name="cloud-offline-outline" size={26} color={colors.textMuted} />
            <Text style={styles.errorText}>Couldn’t play this video</Text>
            <Pressable onPress={retry} style={styles.retry} accessibilityRole="button">
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <ProductChips docked={false} products={visibleProducts} frame={frame} cardW={width} onOpen={onChipTap} saved={savedSet} />

      {burst ? <HeartBurst key={burst.key} x={burst.x} y={burst.y} onDone={() => setBurst(null)} /> : null}

      {/* Soft gradients keep text legible on bright video without a visible block edge. */}
      <Fade edge="bottom" height={Math.min(300, height * 0.4)} max={0.62} />
      <Fade edge="top" height={110} max={0.32} />

      {/* Sound control: a small chip, out of the thumb zone (TikTok has no always-on mute button). */}
      <Pressable
        onPress={() => setMuted(!muted)}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        hitSlop={8}
        style={[styles.muteChip, { top: insets.top + 56 }]}
      >
        <Icon name={muted ? 'volume-mute' : 'volume-high'} size={16} color={colors.text} />
      </Pressable>

      <View pointerEvents="box-none" style={[styles.rightRail, { bottom: bottomInset + BOTTOM_MARGIN, gap: sz.gap }]}>
        {uploader ? (
          <View style={{ width: sz.avatar + 6, height: sz.avatar + 14, alignItems: 'center' }}>
            <Pressable onPress={() => pushPage({ name: 'account', handle: uploader.handle })} accessibilityRole="button" accessibilityLabel={`Open ${uploader.handle}`} style={styles.avatarRing}>
              <Avatar uri={uploader.avatar} name={uploader.displayName || uploader.handle} size={sz.avatar} />
            </Pressable>
            {showFollowBadge ? (
              <Pressable onPress={onFollow} accessibilityRole="button" accessibilityLabel={`Follow ${uploader.handle}`} hitSlop={8} style={styles.followBadge}>
                <Icon name="add" size={14} color="#fff" />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <RailButton size={sz.icon} a11y={liked ? 'Unlike' : 'Like'} icon={liked ? 'heart' : 'heart-outline'} color={liked ? colors.brand : colors.text} label={formatCount(likes)} onPress={onLike} />
        <RailButton size={sz.icon} a11y="Comments" icon="chatbubble-ellipses-outline" label={formatCount(commentCount)} onPress={onComments} />
        <RailButton size={sz.icon} a11y={saved ? 'Remove bookmark' : 'Bookmark'} icon={saved ? 'bookmark' : 'bookmark-outline'} color={saved ? colors.brandSoft : colors.text} onPress={onSave} />
        <RailButton size={sz.icon} a11y="Share" icon="arrow-redo-outline" label={formatCount(shareCount)} onPress={onShare} />
        <RailButton size={sz.icon - 4} a11y="More" icon="ellipsis-horizontal" onPress={() => openSheet({ type: 'more', video, onDeleted: () => setRemoved(true) })} />
      </View>

      <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: bottomInset + BOTTOM_MARGIN, paddingRight: RAIL_WIDTH + SIDE_MARGIN * 2 }]}>
        <ProductChips docked products={visibleProducts} frame={frame} cardW={width} onOpen={onChipTap} saved={savedSet} />
        {uploader ? (
          <Pressable onPress={() => pushPage({ name: 'account', handle: uploader.handle })} accessibilityRole="button" accessibilityLabel={`Open ${uploader.handle}`} hitSlop={6}>
            <Text style={styles.handle} numberOfLines={1}>
              @{uploader.handle}
            </Text>
          </Pressable>
        ) : null}
        {hasCaption ? (
          <Pressable onPress={() => setExpanded((e) => !e)} accessibilityLabel={expanded ? 'Collapse caption' : 'Expand caption'}>
            <Text style={styles.desc} numberOfLines={expanded ? 8 : 2}>
              {video.title ? <Text style={styles.title}>{video.title}{video.description ? '  ' : ''}</Text> : null}
              {video.description ? <CaptionText text={video.description} onTag={(tag) => pushPage({ name: 'tag', tag })} /> : null}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => openSheet({ type: 'find', initialQuery: video.hashtags[0] || video.title, videoId: video.id })}
          accessibilityRole="button"
          accessibilityLabel="Find this on Piitrade"
          style={styles.findChip}
        >
          <Icon name="bag-handle-outline" size={14} color={colors.text} />
          <Text style={styles.findText}>Find on Piitrade</Text>
        </Pressable>
      </View>

      <View pointerEvents="none" style={[styles.progressTrack, { bottom: bottomInset }]}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } } as const;

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  rightRail: { position: 'absolute', right: SIDE_MARGIN - 4, width: RAIL_WIDTH, alignItems: 'center' },
  rail: { alignItems: 'center', width: RAIL_WIDTH, gap: 2 },
  railLabel: { color: colors.text, fontSize: 12, fontWeight: '700', ...shadow },
  avatarRing: { borderWidth: 1.5, borderColor: '#fff', borderRadius: 30, padding: 0 },
  followBadge: { position: 'absolute', bottom: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  muteChip: { position: 'absolute', right: SIDE_MARGIN, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingLeft: SIDE_MARGIN + 4, gap: 6 },
  handle: { color: colors.text, fontWeight: '800', fontSize: 16, ...shadow },
  title: { fontWeight: '700' },
  desc: { color: 'rgba(255,255,255,0.95)', fontSize: 14, lineHeight: 19, ...shadow },
  tag: { color: colors.brandSoft, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  productChip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.brand },
  productChipSaved: { backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: colors.success },
  productChipText: { color: '#fff', fontSize: 13, fontWeight: '800', flexShrink: 1 },
  productChipHost: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '500' },
  hotspot: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 150, height: 28, paddingLeft: 6, paddingRight: 10, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' },
  hotDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.brand, borderWidth: 2, borderColor: '#fff' },
  hotText: { color: '#fff', fontSize: 12, fontWeight: '700', flexShrink: 1 },
  findChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' },
  findText: { color: colors.text, fontSize: 12.5, fontWeight: '700' },
  errorCard: { alignItems: 'center', gap: 8, backgroundColor: 'rgba(20,20,20,0.85)', paddingVertical: 18, paddingHorizontal: 24, borderRadius: 16 },
  errorText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  retry: { backgroundColor: colors.brand, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18, marginTop: 4 },
  retryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  progressTrack: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  progressFill: { height: 2, backgroundColor: colors.text },
});
