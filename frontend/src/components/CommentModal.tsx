import { useEffect, useState } from 'react';
import type { Comment } from '../types';
import { api } from '../api';

interface Props {
  videoId: string;
  onClose: () => void;
  onCommentPosted: (newCount: number) => void;
}

export default function CommentModal({ videoId, onClose, onCommentPosted }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

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
      const res = await api.postComment(videoId, trimmed);
      setComments((prev) => [res.comment, ...prev]);
      onCommentPosted(res.comments);
      setText('');
    } catch (err) {
      console.error(err);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60">
      <div className="safe-bottom safe-left safe-right w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl max-h-[80dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold text-sm">Comments</span>
          <button onClick={onClose} className="tap-target -mr-2 text-white/60 text-sm">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading && <p className="text-white/50 text-sm text-center mt-6">Loading…</p>}
          {!loading && comments.length === 0 && (
            <p className="text-white/50 text-sm text-center mt-6">No comments yet — be the first.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="py-2 border-b border-white/5">
              <p className="text-white/80 text-xs font-semibold">{c.author}</p>
              <p className="text-white text-sm">{c.text}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 p-3 border-t border-white/10">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Write something…"
            className="flex-1 bg-white/10 text-white text-sm rounded-full px-4 py-2 outline-none placeholder:text-white/40"
            maxLength={500}
          />
          <button
            onClick={submit}
            disabled={!text.trim() || posting}
            className="text-brand-pink font-semibold text-sm disabled:text-white/30"
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
