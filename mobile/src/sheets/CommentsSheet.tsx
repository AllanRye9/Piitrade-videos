import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import type { Comment, Video } from '../types';
import Sheet from '../components/Sheet';
import { Avatar, ErrorText, Icon } from '../components/ui';
import { useApp, useProfile } from '../state/AppContext';
import { colors, radius, space } from '../theme';

function Row({ c, isReply, onReply }: { c: Comment; isReply: boolean; onReply: (c: Comment) => void }) {
  const { requireAuth } = useApp();
  const [liked, setLiked] = useState(c.liked);
  const [likes, setLikes] = useState(c.likes);

  function toggleLike() {
    requireAuth('Sign in to like comments.', async () => {
      const was = liked;
      setLiked(!was);
      setLikes((n) => n + (was ? -1 : 1));
      try {
        const res = await api.likeComment(c.videoId, c.id);
        setLiked(res.liked);
        setLikes(res.likes);
      } catch {
        setLiked(was);
        setLikes((n) => n + (was ? 1 : -1));
      }
    });
  }

  return (
    <View style={[styles.row, isReply && styles.reply]}>
      <Avatar name={c.author} size={isReply ? 26 : 32} />
      <View style={{ flex: 1 }}>
        <Text style={styles.author}>{c.author}</Text>
        <Text style={styles.text}>{c.text}</Text>
        {!isReply && (
          <Pressable onPress={() => onReply(c)} hitSlop={8}>
            <Text style={styles.replyBtn}>Reply</Text>
          </Pressable>
        )}
      </View>
      <Pressable onPress={toggleLike} hitSlop={8} style={styles.like} accessibilityLabel={liked ? 'Unlike comment' : 'Like comment'}>
        <Icon name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? colors.brand : colors.textMuted} />
        {likes > 0 && <Text style={styles.likeCount}>{likes}</Text>}
      </Pressable>
    </View>
  );
}

function Thread({ c, onReply }: { c: Comment; onReply: (c: Comment) => void }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<Comment[] | null>(null);
  const [loading, setLoading] = useState(false);

  function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (replies === null) {
      setLoading(true);
      api
        .getReplies(c.videoId, c.id)
        .then((r) => setReplies(r.replies))
        .catch(() => setReplies([]))
        .finally(() => setLoading(false));
    }
  }

  return (
    <View>
      <Row c={c} isReply={false} onReply={onReply} />
      {(c.replyCount ?? 0) > 0 && (
        <Pressable onPress={toggle} style={styles.viewReplies}>
          <Text style={styles.viewRepliesText}>{open ? 'Hide replies' : `View ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}`}</Text>
        </Pressable>
      )}
      {open && loading && <ActivityIndicator color={colors.textMuted} style={{ margin: space.sm }} />}
      {open && replies?.map((r) => <Row key={r.id} c={r} isReply onReply={onReply} />)}
    </View>
  );
}

export default function CommentsSheet({ video, onCountChange }: { video: Video; onCountChange?: (n: number) => void }) {
  const { closeSheet, requireAuth, signedIn } = useApp();
  const profile = useProfile();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getComments(video.id)
      .then((r) => setComments(r.comments))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load comments'))
      .finally(() => setLoading(false));
  }, [video.id]);

  useEffect(load, [load]);

  function post() {
    const body = text.trim();
    if (!body) return;
    requireAuth('Sign in to join the conversation.', async () => {
      setPosting(true);
      setError(null);
      try {
        const author = profile.displayName || (profile.handle ? `@${profile.handle}` : undefined);
        const res = await api.postComment(video.id, body, author, replyTo?.id);
        onCountChange?.(res.comments);
        setText('');
        setReplyTo(null);
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not post comment');
      } finally {
        setPosting(false);
      }
    });
  }

  return (
    <Sheet title={`Comments${comments.length ? ` · ${comments.length}` : ''}`} onClose={closeSheet} maxHeight={0.85} fill>
      <FlatList
        style={{ flex: 1 }}
        data={comments}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <Thread c={item} onReply={setReplyTo} />}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.textMuted} style={{ marginTop: 40 }} /> : <Text style={styles.empty}>No comments yet — be the first.</Text>}
      />
      <ErrorText>{error}</ErrorText>
      {replyTo && (
        <View style={styles.replying}>
          <Text style={styles.replyingText}>Replying to {replyTo.author}</Text>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
            <Icon name="close" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      )}
      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={signedIn ? 'Add a comment…' : 'Sign in to comment'}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          maxLength={500}
          onFocus={() => {
            if (!signedIn) requireAuth('Sign in to join the conversation.');
          }}
        />
        <Pressable onPress={post} disabled={posting || !text.trim()} style={[styles.send, (!text.trim() || posting) && { opacity: 0.4 }]} accessibilityLabel="Post comment">
          {posting ? <ActivityIndicator color="#fff" size="small" /> : <Icon name="arrow-up" size={20} color="#fff" />}
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md, alignItems: 'flex-start' },
  reply: { marginLeft: 44, paddingVertical: space.sm },
  author: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  text: { color: colors.text, fontSize: 14, marginTop: 2, lineHeight: 19 },
  replyBtn: { color: colors.textFaint, fontSize: 12, fontWeight: '700', marginTop: 6 },
  like: { alignItems: 'center', width: 36 },
  likeCount: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  viewReplies: { marginLeft: 44, paddingBottom: 4 },
  viewRepliesText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40 },
  replying: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: colors.surfaceRaised },
  replyingText: { color: colors.textMuted, fontSize: 12 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm },
  input: { flex: 1, backgroundColor: colors.surfaceRaised, color: colors.text, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: 11, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
