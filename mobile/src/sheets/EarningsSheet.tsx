import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import Sheet from '../components/Sheet';
import { ErrorText } from '../components/ui';
import { useApp } from '../state/AppContext';
import type { Earnings } from '../types';
import { colors, radius, space } from '../theme';

/** Money in minor units → "12.50 USD". */
function money(minor: number, currency: string): string {
  const v = (minor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return currency && currency !== '—' ? `${v} ${currency}` : v;
}

const LABEL: Record<string, string> = { pending: 'Pending', approved: 'Approved', paid: 'Paid', reversed: 'Reversed' };

/** What taps on your Shop buttons turned into. */
export default function EarningsSheet() {
  const { closeSheet } = useApp();
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getEarnings()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load earnings'));
    return () => {
      live = false;
    };
  }, []);

  const currencies = data ? Object.keys(data.balances) : [];

  return (
    <Sheet title="Earnings" onClose={closeSheet}>
      <ScrollView contentContainerStyle={styles.body}>
        <ErrorText>{error}</ErrorText>
        {!data && !error ? <Text style={styles.muted}>Loading…</Text> : null}
        {data ? (
          <>
            <Text style={styles.muted}>
              {data.clicksLast30Days} tap{data.clicksLast30Days === 1 ? '' : 's'} on your Shop buttons in the last 30 days.
              {data.rates.length > 0 ? ` You earn ${data.rates.map((r) => `${r.commissionPct}% on ${r.site}`).join(', ')}.` : ''}
            </Text>
            {currencies.length === 0 ? (
              <Text style={styles.text}>No sales yet. When someone buys after tapping a product in your video, it shows up here.</Text>
            ) : (
              currencies.map((c) => (
                <View key={c} style={styles.tiles}>
                  {(['pending', 'approved', 'paid'] as const).map((k) => (
                    <View key={k} style={styles.tile}>
                      <Text style={styles.muted}>{LABEL[k]}</Text>
                      <Text style={styles.tileValue}>{money(data.balances[c][k], c)}</Text>
                    </View>
                  ))}
                </View>
              ))
            )}
            {data.recent.map((r) => (
              <View key={r.id} style={styles.entry}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.text} numberOfLines={1}>{r.video}</Text>
                  <Text style={styles.muted}>
                    {r.site} · sale {money(r.saleMinor, r.currency)} · {new Date(r.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.text, r.status === 'reversed' && { textDecorationLine: 'line-through', color: colors.textFaint }]}>{money(r.commissionMinor, r.currency)}</Text>
                  <Text style={styles.muted}>{LABEL[r.status] ?? r.status}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.muted}>Pending sales are confirmed by the shop and reviewed before they count as approved. Payouts are arranged by the platform.</Text>
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md },
  muted: { color: colors.textFaint, fontSize: 12.5 },
  text: { color: colors.text, fontSize: 14, fontWeight: '600' },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: colors.surfaceRaised, borderRadius: radius.md, paddingVertical: space.md },
  tileValue: { color: colors.text, fontSize: 14, fontWeight: '800' },
  entry: { flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: space.md },
});
