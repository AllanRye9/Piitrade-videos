import { useCallback, useEffect, useState } from 'react';
import { Bookmark, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { mediaUrl } from '../config';
import type { SavedItem } from '../types';

interface Props {
  onClose: () => void;
}

export default function SavedItemsPanel({ onClose }: Props) {
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.getSavedItems()
      .then((result) => setItems(result.items))
      .catch((cause: unknown) => {
        setItems((current) => current ?? []);
        setError(cause instanceof Error ? cause.message : 'Could not load saved items');
      });
  }, []);

  useEffect(load, [load]);

  async function remove(item: SavedItem) {
    const previous = items;
    setItems((current) => (current ?? []).filter((saved) => saved.id !== item.id));
    try {
      await api.deleteSavedItem(item.id);
    } catch (cause) {
      setItems(previous);
      setError(cause instanceof Error ? cause.message : 'Could not remove that item');
    }
  }

  async function openItem(item: SavedItem) {
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      setError('Allow pop-ups to open this product in a new tab.');
      return;
    }
    popup.opener = null;
    let destination = item.url;
    if (item.videoId) {
      try {
        destination = (await api.clickThrough(item.videoId, { url: item.url })).url;
      } catch {
        // Keep the saved link usable if the attribution endpoint is unavailable.
      }
    }
    popup.location.replace(destination);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-items-title"
        onClick={(event) => event.stopPropagation()}
        className="safe-bottom w-full max-h-[85vh] overflow-y-auto rounded-t-2xl bg-neutral-900 p-4 sm:max-w-lg sm:rounded-2xl"
      >
        <header className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
          <h2 id="saved-items-title" className="text-sm font-semibold text-white">Saved items{items?.length ? ` (${items.length})` : ''}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-white/60"><X size={20} /></button>
        </header>
        {error && <p role="alert" className="mb-3 text-xs text-red-300">{error}</p>}
        {items === null ? (
          <p className="py-8 text-center text-sm text-white/50">Loading saved items…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Bookmark size={34} className="text-white/40" />
            <p className="text-sm font-semibold text-white">Nothing saved yet</p>
            <p className="max-w-xs text-xs text-white/50">Tap a product tag while watching to save it here for later.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <article key={item.id} className="flex gap-3 rounded-xl bg-white/5 p-2">
                {item.poster ? <img src={mediaUrl(item.poster)} alt="" className="h-20 w-16 shrink-0 rounded object-cover" /> : <div className="h-20 w-16 shrink-0 rounded bg-white/10" />}
                <div className="flex min-w-0 flex-1 flex-col justify-between">
                  <div>
                    <p className="line-clamp-2 text-sm font-medium text-white">{item.title}</p>
                    <p className="truncate text-xs text-white/45">{item.host}{item.videoTitle ? ` · from “${item.videoTitle}”` : ''}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => void openItem(item)} className="text-left text-xs font-semibold text-brand-amber">
                      View on {item.site || item.host}
                    </button>
                    <button type="button" onClick={() => void remove(item)} aria-label={`Remove ${item.title}`} className="p-1 text-red-300">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
