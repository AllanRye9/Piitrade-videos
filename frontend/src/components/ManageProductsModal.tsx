import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { api } from '../api';
import { mediaUrl } from '../config';
import { useSites } from '../sites';
import { ProductDraft, draftFromSuggestion, draftsFromOwn, draftsToPayload, secondsText } from '../productDrafts';
import type { ProductSuggestion } from '../types';
import ProductListEditor from './ProductListEditor';

interface Props {
  videoId: string;
  durationSec?: number | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Edit the products pinned to one of your own videos, optionally starting from AI suggestions. */
export default function ManageProductsModal({ videoId, durationSec, onClose, onSaved }: Props) {
  const sites = useSites();
  const [drafts, setDrafts] = useState<ProductDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<ProductSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getMyProducts(videoId)
      .then((r) => live && setDrafts(draftsFromOwn(r.products)))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load products'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [videoId]);

  const siteIdBySlug = Object.fromEntries(sites.map((s) => [s.slug, s.id]));

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      setSuggestions((await api.suggestProducts(videoId)).suggestions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get suggestions');
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await api.saveMyProducts(videoId, draftsToPayload(drafts));
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/70" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="animate-sheet-in safe-bottom flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-neutral-900 sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="text-sm font-semibold text-white">Products in this video</span>
          <button type="button" onClick={onClose} aria-label="Close" className="tap-target -mr-2 text-white/60">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="text-sm text-white/50">Loading…</p>
          ) : (
            <>
              <button type="button" onClick={suggest} disabled={suggesting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                <Sparkles size={16} className="text-brand-amber" />
                {suggesting ? 'Looking at your video…' : 'Suggest products from this video'}
              </button>

              {suggestions && (
                <div className="space-y-2">
                  {suggestions.length === 0 && <p className="text-xs text-white/50">Nothing matched on the connected shops. Add products by hand below.</p>}
                  {suggestions.map((s) => (
                    <div key={`${s.query}-${s.startMs}`} className="rounded-xl bg-white/5 p-2.5">
                      <p className="mb-1.5 text-[11px] text-white/50">
                        Seen around {secondsText(s.startMs)}s–{secondsText(s.endMs)}s: “{s.query}”
                      </p>
                      <div className="space-y-1.5">
                        {s.candidates.map((c, ci) => (
                          <button
                            key={c.url}
                            type="button"
                            onClick={() => {
                              setDrafts((d) => [...d, draftFromSuggestion(s, ci, siteIdBySlug)]);
                              setSuggestions((all) => (all ? all.filter((x) => x !== s) : all));
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg bg-white/5 p-2 text-left hover:bg-white/10"
                          >
                            {c.image && <img src={mediaUrl(c.image)} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-white">{c.title}</span>
                              <span className="block text-[11px] text-white/50">{c.price}</span>
                            </span>
                            <span className="text-xs font-semibold text-brand-orange">Add</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <ProductListEditor value={drafts} onChange={setDrafts} sites={sites} durationSec={durationSec} />
            </>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-white/10 px-4 py-3">
          <button type="button" onClick={save} disabled={saving || loading} className="w-full rounded-xl bg-brand-orange py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
