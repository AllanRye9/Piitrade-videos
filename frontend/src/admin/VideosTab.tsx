import { useEffect, useState } from 'react';
import { adminApi } from '../api';
import { mediaUrl } from '../config';
import type { AdminVideo } from '../types';

export default function VideosTab() {
  const [videos, setVideos] = useState<AdminVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');

  function load() {
    setLoading(true);
    adminApi
      .listVideos()
      .then((res) => setVideos(res.videos))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load videos'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startEdit(v: AdminVideo) {
    setEditingId(v.id);
    setDraftTitle(v.title);
    setDraftDescription(v.description);
  }

  async function saveEdit(id: string) {
    const updated = await adminApi.updateVideo(id, { title: draftTitle, description: draftDescription });
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...updated.video } : v)));
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    await adminApi.deleteVideo(id);
    setVideos((prev) => prev.filter((v) => v.id !== id));
  }

  if (loading) return <p className="text-white/50 text-sm">Loading…</p>;
  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (videos.length === 0) return <p className="text-white/50 text-sm">No videos yet.</p>;

  return (
    <div className="space-y-2">
      {videos.map((v) => (
        <div key={v.id} className="bg-white/5 rounded-xl p-3 flex flex-wrap sm:flex-nowrap gap-3">
          <img
            src={mediaUrl(v.poster)}
            className="w-20 h-14 sm:w-24 sm:h-16 object-cover rounded-lg bg-black shrink-0"
            alt={v.title}
          />
          <div className="flex-1 min-w-0">
            {editingId === v.id ? (
              <div className="space-y-1">
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="w-full bg-white/10 text-white text-sm rounded px-2 py-1 outline-none"
                />
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-white/10 text-white text-xs rounded px-2 py-1 outline-none resize-none"
                />
                <div className="flex gap-2">
                  <button onClick={() => saveEdit(v.id)} className="text-brand-cyan text-xs font-semibold">
                    Save
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-white/50 text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-white text-sm font-medium truncate">{v.title}</p>
                <p className="text-white/50 text-xs truncate">{v.description || 'No description'}</p>
                <p className="text-white/40 text-[11px] mt-1">
                  {v.views.toLocaleString()} views · {v.likes.toLocaleString()} likes · {v.comments} comments
                </p>
              </>
            )}
          </div>
          {editingId !== v.id && (
            <div className="flex flex-col gap-2 shrink-0">
              <button onClick={() => startEdit(v)} className="text-brand-cyan text-xs font-semibold">
                Edit
              </button>
              <button onClick={() => handleDelete(v.id)} className="text-red-400 text-xs font-semibold">
                Delete
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
