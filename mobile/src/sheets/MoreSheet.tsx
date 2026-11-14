import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import type { Video } from '../types';
import Sheet from '../components/Sheet';
import { Icon } from '../components/ui';
import { useApp } from '../state/AppContext';
import { colors, radius, space } from '../theme';

const REASONS: { id: 'spam' | 'inappropriate' | 'copyright' | 'other'; label: string }[] = [
  { id: 'spam', label: 'Spam or misleading' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'copyright', label: 'Copyright infringement' },
  { id: 'other', label: 'Something else' },
];

export default function MoreSheet({ video }: { video: Video }) {
  const { closeSheet, requireAuth } = useApp();
  const [step, setStep] = useState<'menu' | 'report' | 'done'>('menu');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function report(reason: (typeof REASONS)[number]['id']) {
    setBusy(true);
    setFailed(false);
    try {
      await api.reportVideo(video.id, reason);
      setStep('done');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={step === 'report' ? 'Report video' : 'More'} onClose={closeSheet} maxHeight={0.7}>
      <View style={styles.body}>
        {step === 'menu' && (
          <Pressable style={styles.item} onPress={() => requireAuth('Sign in to report a video.', () => setStep('report'))}>
            <Icon name="flag-outline" color={colors.danger} />
            <Text style={[styles.itemText, { color: colors.danger }]}>Report video</Text>
          </Pressable>
        )}
        {step === 'report' &&
          REASONS.map((r) => (
            <Pressable key={r.id} style={[styles.item, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => report(r.id)}>
              <Text style={styles.itemText}>{r.label}</Text>
              <Icon name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          ))}
        {step === 'report' && failed && <Text style={styles.err}>Could not send the report — try again.</Text>}
        {step === 'done' && (
          <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl }}>
            <Icon name="checkmark-circle" size={44} color={colors.success} />
            <Text style={styles.itemText}>Thanks — we’ll review this video.</Text>
          </View>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surfaceRaised, padding: space.lg, borderRadius: radius.md, justifyContent: 'space-between' },
  itemText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  err: { color: colors.danger, textAlign: 'center' },
});
