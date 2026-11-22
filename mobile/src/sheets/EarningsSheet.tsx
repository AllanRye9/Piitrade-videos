import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import type { Earnings } from '../types';
import Sheet from '../components/Sheet';
import { ErrorText } from '../components/ui';
import { useApp } from '../state/AppContext';
import { colors, radius, space } from '../theme';

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#F5B041' },
  approved: { label: 'Approved', color: '#5DADE2' },
  paid: { label: 'Paid', color: '#58D68D' },
  reversed: { label: 'Reversed', color: colors.danger },
};

/** What the creator has earned from shop sales that started on their videos. */
export default function EarningsSheet() {
  const { closeSheet } = useApp();
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getEarnings().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load earnings'));
  }, []);

  return (
    <Sheet title="Earnings" onClose={closeSheet} maxHeight={0.85}>
      <ScrollView contentContainerStyle={styles.body}>
        {!data && !error && <ActivityIndicator color={colors.textMuted} style={{ marginTop: 30 }} />}
        <ErrorText>{error}</ErrorText>
        {data && (
          <>
            {data.balances.length === 0 ? (
              <Text style={styles.empty}>No earnings yet. When someone buys from a shop after tapping a product in your video, the commission shows up here.</Text>
            ) : (
              data.balances.map((b) => (
                <View key={b.currency} style={styles.card}>
                  <Text style={styles.currency}>{b.currency}</Text>
                  <View style={styles.cols}>
                    {([['Pending', b.pending], ['Approved', b.approved], ['Paid', b.paid]] as const).map(([label, v]) => (
                      <View key={label} style={styles.col}>
                        <Text style={styles.amount}>{fmt(v)}</Text>
                        <Text style={styles.label}>{label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}

            {data.entries.length > 0 && (
              <View style={{ gap: space.sm }}>
                <Text style={styles.section}>Recent</Text>
                {data.entries.map((e) => (
                  <View key={e.id} style={styles.entry}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryTitle} numberOfLines={1}>{e.videoTitle || 'Video'}</Text>
                      <Text style={styles.entryDate}>{new Date(e.createdAt).toLocaleDateString()}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.entryAmount}>{e.currency} {fmt(e.amount)}</Text>
                      <Text style={[styles.status, { color: STATUS[e.status]?.color }]}>{STATUS[e.status]?.label ?? e.status}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.note}>Pending commissions are approved by the Piitrade team, then paid out. Click tracking is described in our Privacy Policy.</Text>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.sm, gap: space.lg },
  empty: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginVertical: space.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  currency: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  cols: { flexDirection: 'row' },
  col: { flex: 1, gap: 2 },
  amount: { color: colors.text, fontSize: 18, fontWeight: '800' },
  label: { color: colors.textMuted, fontSize: 12 },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  entryTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  entryDate: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  entryAmount: { color: colors.text, fontSize: 14, fontWeight: '800' },
  status: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
});
