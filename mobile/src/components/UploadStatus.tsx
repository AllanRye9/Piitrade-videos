import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import { dismissUpload, retryUpload, useUploadState } from '../state/uploads';
import { colors, radius, space } from '../theme';
import { Icon, IconButton } from './ui';

/**
 * Floating, animated upload status. The upload popup closes the moment
 * the person taps Post; this card takes over — progress bar while
 * uploading, a shimmering bar while the server processes, a bouncing
 * check when done, and Retry / Choose clip when something goes wrong.
 */
export default function UploadStatus() {
  const s = useUploadState();
  const { openSheet, pushPage } = useApp();
  const insets = useSafeAreaInsets();

  const enter = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const visible = s.phase !== 'idle';

  useEffect(() => {
    Animated.timing(enter, { toValue: visible ? 1 : 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, enter]);

  useEffect(() => {
    Animated.timing(progress, { toValue: s.phase === 'processing' ? 100 : s.progress, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [s.progress, s.phase, progress]);

  useEffect(() => {
    if (s.phase !== 'processing') return;
    shimmer.setValue(0);
    const loop = Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [s.phase, shimmer]);

  useEffect(() => {
    if (s.phase !== 'done') return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
    const t = setTimeout(dismissUpload, 6000);
    return () => clearTimeout(t);
  }, [s.phase, pop]);

  if (!visible) return null;

  const busy = s.phase === 'uploading' || s.phase === 'processing';
  const label = s.phase === 'uploading' ? `Uploading… ${s.progress}%` : s.phase === 'processing' ? 'Processing your video…' : s.phase === 'done' ? 'Posted!' : 'Upload failed';
  const barWidth = progress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 8, opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}
    >
      <View style={styles.card} accessibilityRole="progressbar" accessibilityLabel={label}>
        <View style={styles.row}>
          <View style={styles.badge}>
            {s.phase === 'uploading' && <Icon name="cloud-upload" size={20} color={colors.brandSoft} />}
            {s.phase === 'processing' && <ActivityIndicator color={colors.brandSoft} size="small" />}
            {s.phase === 'done' && (
              <Animated.View style={{ transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
                <Icon name="checkmark-circle" size={24} color={colors.success} />
              </Animated.View>
            )}
            {s.phase === 'error' && <Icon name="alert-circle" size={24} color={colors.danger} />}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              {s.phase === 'error' ? s.error : s.phase === 'processing' ? 'Large videos can take a few minutes — you can keep watching.' : s.title || 'Untitled'}
            </Text>
          </View>

          {s.phase === 'done' && s.video && (
            <Pressable
              onPress={() => {
                const v = s.video!;
                dismissUpload();
                pushPage({ name: 'viewer', videos: [v], index: 0, title: 'Your new video' });
              }}
              style={styles.action}
            >
              <Text style={styles.actionText}>View</Text>
            </Pressable>
          )}
          {s.phase === 'error' && (
            <Pressable
              onPress={() => {
                if (s.tooLongDraft) {
                  const draft = s.tooLongDraft;
                  dismissUpload();
                  openSheet({ type: 'upload', draft });
                } else {
                  retryUpload();
                }
              }}
              style={styles.action}
            >
              <Text style={styles.actionText}>{s.tooLongDraft ? 'Choose clip' : 'Retry'}</Text>
            </Pressable>
          )}
          {!busy && <IconButton name="close" label="Dismiss" onPress={dismissUpload} size={18} color={colors.textMuted} style={styles.close} />}
        </View>

        {busy && (
          <View style={styles.track}>
            <Animated.View style={[styles.fill, { width: barWidth }]} />
            {s.phase === 'processing' && (
              <Animated.View style={[styles.shimmer, { transform: [{ translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [-120, 360] }) }] }]} />
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 60 },
  card: { backgroundColor: 'rgba(28,28,30,0.97)', borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingHorizontal: space.lg },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  action: { backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  close: { width: 32, height: 32, marginRight: -8 },
  track: { height: 5, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  fill: { height: 5, backgroundColor: colors.brand },
  shimmer: { position: 'absolute', top: 0, bottom: 0, width: 120, backgroundColor: 'rgba(255,255,255,0.45)' },
});
