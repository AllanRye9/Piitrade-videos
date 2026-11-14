import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import type { AccountSummary, Video } from '../types';
import Sheet from '../components/Sheet';
import VideoGrid from '../components/VideoGrid';
import { Avatar, Button, IconButton, formatCount } from '../components/ui';
import { useApp, useProfile } from '../state/AppContext';
import { colors, radius, space } from '../theme';

type Tab = 'videos' | 'liked' | 'saved';

/** Your own profile as a popup: identity, stats, and your videos / liked / saved. */
export default function ProfileSheet() {
  const { closeSheet, openSheet, pushPage } = useApp();
  const profile = useProfile();
  const [tab, setTab] = useState<Tab>('videos');
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [mine, setMine] = useState<Video[]>([]);
  const [feed, setFeed] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (profile.handle) {
          const res = await api.getAccount(profile.handle);
          if (!cancelled) {
            setAccount(res.account);
            setMine(res.videos);
          }
        }
        // Liked / saved come from the per-session state on the feed (first few pages).
        let cursor: string | null = null;
        const all: Video[] = [];
        for (let i = 0; i < 3; i++) {
          const page: { videos: Video[]; nextCursor: string | null } = await api.listVideos(cursor);
          all.push(...page.videos);
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        if (!cancelled) setFeed(all);
      } catch {
        // leave whatever loaded
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.handle]);

  const shown = useMemo(() => {
    if (tab === 'videos') return mine;
    if (tab === 'liked') return feed.filter((v) => v.liked);
    return feed.filter((v) => v.saved || v.favorited);
  }, [tab, mine, feed]);

  function open(index: number) {
    const videos = shown;
    closeSheet();
    pushPage({ name: 'viewer', videos, index });
  }

  const header = (
    <View style={styles.header}>
      <Avatar uri={profile.avatar} name={profile.displayName || profile.handle} size={84} />
      <Text style={styles.name}>{profile.displayName || (profile.handle ? `@${profile.handle}` : 'Your profile')}</Text>
      {profile.handle ? <Text style={styles.handle}>@{profile.handle}</Text> : null}
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      <View style={styles.stats}>
        <Stat n={account?.videoCount ?? mine.length} label="Videos" />
        <Stat n={account?.followersCount ?? 0} label="Followers" />
        <Stat n={account?.followingCount ?? 0} label="Following" />
        <Stat n={account?.totalLikes ?? 0} label="Likes" />
      </View>
      <View style={styles.actions}>
        <Button title="Edit profile" variant="secondary" icon="create-outline" onPress={() => { closeSheet(); openSheet({ type: 'settings' }); }} style={{ flex: 1 }} />
        <Button title="Upload" icon="add" onPress={() => { closeSheet(); openSheet({ type: 'upload' }); }} style={{ flex: 1 }} />
      </View>
      <View style={styles.tabs}>
        {([['videos', 'Videos'], ['liked', 'Liked'], ['saved', 'Saved']] as [Tab, string][]).map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
            <Text style={[styles.tabText, tab === id && { color: colors.text }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <Sheet
      title="Profile"
      onClose={closeSheet}
      maxHeight={0.94}
      fill
      headerRight={<IconButton name="settings-outline" label="Settings" onPress={() => { closeSheet(); openSheet({ type: 'settings' }); }} color={colors.textMuted} />}
    >
      <VideoGrid
        videos={loading ? [] : shown}
        onOpen={open}
        emptyLabel={loading ? '' : tab === 'videos' ? 'You haven’t posted anything yet.' : tab === 'liked' ? 'Videos you like will show up here.' : 'Videos you save will show up here.'}
        ListHeaderComponent={
          <>
            {header}
            {loading && <ActivityIndicator color={colors.text} style={{ marginVertical: space.xl }} />}
          </>
        }
      />
    </Sheet>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={styles.statN}>{formatCount(n)}</Text>
      <Text style={styles.statL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.lg },
  name: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: space.sm },
  handle: { color: colors.textMuted, fontSize: 14 },
  bio: { color: colors.text, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  stats: { flexDirection: 'row', alignSelf: 'stretch', marginTop: space.md },
  statN: { color: colors.text, fontSize: 17, fontWeight: '800' },
  statL: { color: colors.textMuted, fontSize: 12 },
  actions: { flexDirection: 'row', gap: space.md, alignSelf: 'stretch', marginTop: space.md },
  tabs: { flexDirection: 'row', alignSelf: 'stretch', backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: 3, marginTop: space.lg },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.surfaceHigh },
  tabText: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
});
