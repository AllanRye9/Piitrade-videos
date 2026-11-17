import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '../theme';
import { IconButton } from './ui';

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Fraction of screen height the sheet may use (default 0.9). */
  maxHeight?: number;
  /** Fixed-height sheet (for sheets that contain their own scroller). */
  fill?: boolean;
  headerRight?: React.ReactNode;
}

const SCREEN_H = Dimensions.get('window').height;

/**
 * Current on-screen keyboard height (0 when hidden). Android only needs this:
 * inside a transparent, edge-to-edge <Modal> the window is NOT resized for the
 * keyboard (adjustResize doesn't apply to the Modal's own window) and
 * KeyboardAvoidingView has no reliable behaviour there, so the sheet is lifted
 * by hand. iOS keeps using KeyboardAvoidingView.
 */
function useAndroidKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/**
 * The one popup used for upload, profile, settings, sign-in, comments…
 * — a modern bottom sheet: dimmed backdrop (tap to dismiss), grab handle
 * (drag down to dismiss), Android back button support, keyboard-aware.
 */
export default function Sheet({ title, onClose, children, maxHeight = 0.9, fill, headerRight }: Props) {
  const insets = useSafeAreaInsets();
  const kb = useAndroidKeyboardHeight();
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [translateY, backdrop]);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(translateY, { toValue: SCREEN_H, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => onClose());
  }, [translateY, backdrop, onClose]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 0.9) {
          dismiss();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    })
  ).current;

  // With the keyboard up the sheet sits on top of it: shrink to the space left
  // above the keyboard (so the composer stays visible) and drop the bottom safe-area padding.
  const keyboardOpen = kb > 0;
  const available = SCREEN_H - kb - insets.top - space.sm;
  const sheetMax = Math.min(SCREEN_H * maxHeight, keyboardOpen ? available : Infinity);

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: backdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { maxHeight: sheetMax, paddingBottom: keyboardOpen ? space.sm : Math.max(insets.bottom, space.lg), marginBottom: keyboardOpen ? kb : 0, transform: [{ translateY }] },
            fill && { height: sheetMax },
          ]}
        >
          <View {...pan.panHandlers} style={styles.headerWrap}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {headerRight}
                <IconButton name="close" label="Close" onPress={dismiss} color={colors.textMuted} />
              </View>
            </View>
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  headerWrap: { paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.xl, paddingRight: space.sm, minHeight: 52 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800', flex: 1 },
});
