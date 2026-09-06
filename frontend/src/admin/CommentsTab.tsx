import { useEffect, useState } from 'react';
import { adminApi } from '../api';
import type { AdminVideo, Comment } from '../types';

export default function CommentsTab() {
  const [videos, setVideos] = useState<AdminVideo[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [loadingComments, setLoadingComments] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .listVideos()
      .then((res) => {
        setVideos(res.videos);
        if (res.videos.length > 0) setSelectedId(res.videos[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load videos'))
      .finally(() => setLoadingVideos(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingComments(true);
    adminApi
      .getVideoComments(selectedId)
      .then((res) => setComments(res.comments))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load comments'))
      .finally(() => setLoadingComments(false));
  }, [selectedId]);

  async function handleDelete(id: string) {
    await adminApi.deleteComment(id);
    setComments((prev) => prev.filter((c) => c.id !== id));
  }

  if (loadingVideos) return <p className="text-white/50 text-sm">Loading…</p>;
  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (videos.length === 0) return <p className="text-white/50 text-sm">No videos yet.</p>;

  return (
    <div className="space-y-3">
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none"
      >
        {videos.map((v) => (
          <option key={v.id} value={v.id} className="bg-neutral-900">
            {v.title} ({v.comments} comments)
          </option>
        ))}
      </select>

      {loadingComments ? (
        <p className="text-white/50 text-sm">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-white/50 text-sm">No comments on this video.</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="bg-white/5 rounded-lg p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white/70 text-xs font-semibold">{c.author}</p>
                <p className="text-white text-sm break-words">{c.text}</p>
              </div>
              <button onClick={() => handleDelete(c.id)} className="text-red-400 text-xs font-semibold shrink-0">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
