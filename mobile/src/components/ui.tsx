import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { mediaUrl } from '../config';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function IconButton({
  name,
  onPress,
  size = 22,
  color = colors.text,
  label,
  style,
}: {
  name: IconName;
  onPress: () => void;
  size?: number;
  color?: string;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }, style]}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === 'primary' ? colors.brand : variant === 'secondary' ? colors.surfaceHigh : 'transparent';
  const fg = variant === 'danger' ? colors.danger : variant === 'ghost' ? colors.textMuted : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: disabled || busy ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function TextField({ label, style, ...rest }: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.brand}
        {...rest}
        style={[styles.input, rest.multiline && { minHeight: 84, textAlignVertical: 'top' }, style]}
      />
    </View>
  );
}

export function Avatar({ uri, name, size = 40 }: { uri?: string | null; name?: string | null; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return uri ? (
    <Image source={{ uri: mediaUrl(uri) }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceHigh }} contentFit="cover" />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: size * 0.42 }}>{initial}</Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function ErrorText({ children }: { children?: string | null }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

/** 999 → "999", 1200 → "1.2K", 10_000 → "10K", 999_950 → "1M" (never "1000.0K"), no trailing ".0". */
export function formatCount(n: number): string {
  const v = Math.max(0, Math.round(n || 0));
  const short = (x: number, unit: string) => `${(Math.round(x * 10) / 10).toString().replace(/\.0$/, '')}${unit}`;
  if (v >= 999_950_000) return '1B';
  if (v >= 999_950) return short(v / 1_000_000, 'M');
  if (v >= 1_000) return short(v / 1_000, 'K');
  return String(v);
}

const styles = StyleSheet.create({
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  btn: { height: 50, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  btnText: { fontSize: 15, fontWeight: '700' },
  input: { backgroundColor: colors.surfaceRaised, color: colors.text, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 13, fontSize: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  sectionLabel: { color: colors.textFaint, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  error: { color: colors.danger, fontSize: 13 },
});
