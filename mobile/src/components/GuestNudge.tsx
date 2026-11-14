import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NUDGE } from '../config';
import { useApp } from '../state/AppContext';
import { colors, radius, space } from '../theme';
import { Icon, IconButton } from './ui';

/**
 * Non-blocking, cancellable "sign in" card shown to signed-out viewers
 * every so often while they watch. It floats above the feed (the video
 * keeps playing underneath), closes with ✕ / "Maybe later", swipes away,
 * and hides itself after NUDGE.autoHideSeconds if ignored.
 */
export default function GuestNudge() {
  const { nudgeVisible, dismissNudge, acceptNudge, signedIn } = useApp();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = React.useState(false);

  useEffect(() => {
    if (nudgeVisible && !signedIn) {
      setMounted(true);
      slide.setValue(0);
      Animated.timing(slide, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      const t = setTimeout(dismissNudge, NUDGE.autoHideSeconds * 1000);
      return () => clearTimeout(t);
    }
    Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [nudgeVisible, signedIn, slide, dismissNudge]);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: Math.max(insets.bottom, 12) + 76, opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] },
      ]}
    >
      <View style={styles.card} accessibilityRole="alert">
        <View style={styles.iconBubble}>
          <Icon name="person-circle-outline" size={26} color={colors.brandSoft} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Enjoying the videos?</Text>
          <Text style={styles.sub}>Sign in to like, comment, follow creators and upload your own.</Text>
          <View style={styles.actions}>
            <Pressable onPress={acceptNudge} style={styles.primary} accessibilityRole="button">
              <Text style={styles.primaryText}>Sign in</Text>
            </Pressable>
            <Pressable onPress={dismissNudge} hitSlop={8} accessibilityRole="button">
              <Text style={styles.later}>Maybe later</Text>
            </Pressable>
          </View>
        </View>
        <IconButton name="close" label="Dismiss" onPress={dismissNudge} size={18} color={colors.textMuted} style={styles.close} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 50 },
  card: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  iconBubble: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,179,71,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.md },
  primary: { backgroundColor: colors.brand, paddingHorizontal: space.lg, paddingVertical: 9, borderRadius: radius.pill },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  later: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  close: { width: 32, height: 32, marginTop: -8, marginRight: -8 },
});
