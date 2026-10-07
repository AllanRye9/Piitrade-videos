import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Comment } from '../types';
import { api } from '../api';
import { markVideoCommented } from '../profileActivity';
import Avatar from './Avatar';
import { ensureProfileLoaded, getProfileState, subscribeProfile } from '../profileStore';
import { X, Send, CornerDownRight, ChevronDown, ChevronUp, Loader2, Heart } from 'lucide-react';

interface Props {
  videoId: string;
  onClose: () => void;
  onCommentPosted: (newCount: number) => void;
}

function CommentRow({
  c,
  isReply,
  onReply,
}: {
  c: Comment;
  isReply: boolean;
  onReply: (c: Comment) => void;
}) {
  const [liked, setLiked] = useState(c.liked);
  const [likes, setLikes] = useState(c.likes);

  async function toggleLike() {
    // Optimistic — matches the like/save pattern used throughout
    // VideoCard, reverted only if the request actually fails.
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikes((n) => n + (wasLiked ? -1 : 1));
    try {
      const res = await api.likeComment(c.videoId, c.id);
      setLiked(res.liked);
      setLikes(res.likes);
    } catch {
      setLiked(wasLiked);
      setLikes((n) => n + (wasLiked ? 1 : -1));
    }
  }

  return (
    <div className={isReply ? 'py-2' : 'py-2 border-b border-white/5'}>
      <p className="text-white/80 text-xs font-semibold">{c.author}</p>
      <div className="flex items-start justify-between gap-2">
        <p className="text-white text-sm flex-1">{c.text}</p>
        <button
          type="button"
          onClick={toggleLike}
          aria-label={liked ? 'Unlike comment' : 'Like comment'}
          className="tap-target shrink-0 flex flex-col items-center text-white/50 -mt-1"
        >
          <Heart size={14} className={liked ? 'text-brand-pink' : ''} fill={liked ? 'currentColor' : 'none'} />
          {likes > 0 && <span className="text-[10px] mt-0.5">{likes}</span>}
        </button>
      </div>
      {!isReply && (
        <button type="button" onClick={() => onReply(c)} className="mt-1 text-white/40 text-xs font-medium">
          Reply
        </button>
      )}
    </div>
  );
}

function ThreadedComment({ c, onReply }: { c: Comment; onReply: (c: Comment) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [replies, setReplies] = useState<Comment[] | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);

  function toggleReplies() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (replies === null) {
      setLoadingReplies(true);
      api
        .getReplies(c.videoId, c.id)
        .then((res) => setReplies(res.replies))
        .catch(() => setReplies([]))
        .finally(() => setLoadingReplies(false));
    }
  }

  return (
    <div>
      <CommentRow c={c} isReply={false} onReply={onReply} />
      {!!c.replyCount && (
        <button type="button" onClick={toggleReplies} className="ml-2 mb-2 flex items-center gap-1 text-white/40 text-xs font-medium">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Hide' : `View ${c.replyCount}`} {c.replyCount === 1 ? 'reply' : 'replies'}
        </button>
      )}
      {expanded && (
        <div className="ml-5 pl-3 border-l border-white/10">
          {loadingReplies && <p className="text-white/40 text-xs py-1">Loading…</p>}
          {!loadingReplies && replies?.map((r) => <CommentRow key={r.id} c={r} isReply onReply={onReply} />)}
        </div>
      )}
    </div>
  );
}

export default function CommentModal({ videoId, onClose, onCommentPosted }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const profile = useSyncExternalStore(subscribeProfile, getProfileState);

  useEffect(() => {
    ensureProfileLoaded();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getComments(videoId)
      .then((res) => {
        if (!cancelled) setComments(res.comments);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const res = await api.postComment(videoId, trimmed, undefined, replyingTo?.id);
      if (replyingTo) {
        // A reply doesn't belong in the top-level list — it's picked
        // up next time that thread's replies are (re)loaded. Bumping
        // the video's total comment count is still correct either way.
        onCommentPosted(res.comments);
      } else {
        setComments((prev) => [res.comment, ...prev]);
        onCommentPosted(res.comments);
      }
      markVideoCommented(videoId);
      setText('');
      setReplyingTo(null);
    } catch (err) {
      console.error(err);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60 backdrop-blur-sm">
      <div className="animate-sheet-in safe-bottom safe-left safe-right modal-max-h-80 w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold text-sm">Comments</span>
          <button type="button" onClick={onClose} aria-label="Close comments" className="tap-target -mr-2 text-white/60">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading && <p className="text-white/50 text-sm text-center mt-6">Loading…</p>}
          {!loading && comments.length === 0 && (
            <p className="text-white/50 text-sm text-center mt-6">No comments yet — be the first.</p>
          )}
          {comments.map((c) => (
            <ThreadedComment key={c.id} c={c} onReply={setReplyingTo} />
          ))}
        </div>
        {replyingTo && (
          <div className="flex items-center justify-between px-4 py-1.5 bg-white/5 border-t border-white/10">
            <span className="text-white/50 text-xs flex items-center gap-1">
              <CornerDownRight size={12} /> Replying to {replyingTo.author}
            </span>
            <button type="button" onClick={() => setReplyingTo(null)} className="text-white/50 text-xs">
              Cancel
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 p-3 border-t border-white/10">
          <Avatar src={profile.avatar} size={28} alt="You" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={replyingTo ? `Reply to ${replyingTo.author}…` : 'Write something…'}
            className="flex-1 bg-white/10 text-white text-sm rounded-full px-4 py-2 outline-none placeholder:text-white/40"
            maxLength={500}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || posting}
            aria-label="Post comment"
            className="tap-target text-brand-pink disabled:text-white/30 flex items-center justify-center"
          >
            {posting ? <Loader2 size={18} className="animate-spin" /> : <Send size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
}
