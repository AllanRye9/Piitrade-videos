import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import type { AppNotification } from '../types';
import Sheet from '../components/Sheet';
import { Avatar } from '../components/ui';
import { useApp } from '../state/AppContext';
import { colors, space } from '../theme';

function ago(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function NotificationsSheet() {
  const { closeSheet, setUnreadCount, pushPage } = useApp();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getNotifications()
      .then((res) => {
        setItems(res.notifications);
        if (res.unreadCount > 0) api.markNotificationsRead().then(() => setUnreadCount(0)).catch(() => {});
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load notifications'))
      .finally(() => setLoading(false));
  }, [setUnreadCount]);

  return (
    <Sheet title="Notifications" onClose={closeSheet} maxHeight={0.8} fill>
      {loading && <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />}
      {error && <Text style={styles.empty}>{error}</Text>}
      {!loading && !error && (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingHorizontal: space.lg }}
          ListEmptyComponent={<Text style={styles.empty}>Nothing yet. Follows and comments will show up here.</Text>}
          renderItem={({ item }) => {
            const who = item.actor.displayName || (item.actor.handle ? `@${item.actor.handle}` : 'Someone');
            return (
              <Pressable
                style={[styles.row, !item.read && styles.unread]}
                onPress={() => {
                  if (item.actor.handle) {
                    closeSheet();
                    pushPage({ name: 'account', handle: item.actor.handle });
                  }
                }}
              >
                <Avatar uri={item.actor.avatar} name={who} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.text}>
                    <Text style={styles.bold}>{who}</Text> {item.type === 'follow' ? 'started following you' : 'commented on your video'}
                  </Text>
                  {item.commentText ? (
                    <Text style={styles.sub} numberOfLines={2}>
                      “{item.commentText}”
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.time}>{ago(item.createdAt)}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.md },
  unread: { backgroundColor: 'rgba(245,89,6,0.08)', marginHorizontal: -space.lg, paddingHorizontal: space.lg },
  text: { color: colors.text, fontSize: 14 },
  bold: { fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  time: { color: colors.textFaint, fontSize: 12 },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40, paddingHorizontal: space.xl },
});
