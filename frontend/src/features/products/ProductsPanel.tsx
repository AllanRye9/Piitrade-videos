import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { ProductPin, ProductSuggestion, SiteInfo, Video } from '../../lib/types';
import ProductsEditor from './ProductsEditor';
import { X } from 'lucide-react';

interface Props {
  video: Video;
  onSaved: () => void;
  onClose: () => void;
}

const MAX_PINS = 8;

export default function ProductsPanel({ video, onSaved, onClose }: Props) {
  const [pins, setPins] = useState<ProductPin[] | null>(null);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const durationMs = Math.round((video.duration ?? 60) * 1000);

  useEffect(() => {
    api.getMyProducts(video.id)
      .then((result) => setPins(result.products))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load products'));
    api.getSites().then((result) => setSites(result.sites)).catch(() => {});
  }, [video.id]);

  function addSuggestion(suggestion: ProductSuggestion) {
    if (!pins) return;
    if (pins.length >= MAX_PINS) {
      setError(`You can pin up to ${MAX_PINS} products.`);
      return;
    }
    if (pins.some((pin) => pin.url === suggestion.url)) {
      setError('That product is already pinned.');
      return;
    }
    setError(null);
    setSaved(false);
    setPins([...pins, {
      url: suggestion.url,
      title: suggestion.title.slice(0, 60),
      startMs: suggestion.startMs,
      endMs: suggestion.endMs,
    }]);
  }

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const result = await api.suggestProducts(video.id);
      setSuggestions(result.suggestions);
      if (result.suggestions.length === 0) setError('No matching listings found in this video.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Suggestions are unavailable right now.');
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    if (!pins) return;
    setSaving(true);
    setError(null);
    try {
      await api.setProducts(video.id, pins.map((pin) => ({
        ...pin,
        title: pin.title.trim(),
        x: pin.x ?? null,
        y: pin.y ?? null,
      })));
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save products');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="products-panel-title"
        onClick={(event) => event.stopPropagation()}
        className="safe-bottom w-full max-h-[90vh] overflow-y-auto rounded-t-2xl bg-neutral-900 p-4 sm:max-w-lg sm:rounded-2xl"
      >
        <header className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
          <h2 id="products-panel-title" className="text-sm font-semibold text-white">Pin products</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-white/60"><X size={20} /></button>
        </header>
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-white/55">Viewers see shop chips during the selected moments and can save products for later.</p>
          {pins === null ? (
            <p className="text-sm text-white/50">Loading products…</p>
          ) : (
            <ProductsEditor pins={pins} onChange={(next) => { setPins(next); setSaved(false); }} sites={sites} durationMs={durationMs} />
          )}
          <div className="space-y-2 border-t border-white/10 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">Suggestions</h3>
            <button type="button" onClick={() => void suggest()} disabled={suggesting} className="rounded-full bg-white/10 px-4 py-2 text-sm text-white disabled:opacity-50">
              {suggesting ? 'Looking through your video…' : 'Suggest from my video'}
            </button>
            {suggestions.map((suggestion) => (
              <div key={suggestion.url} className="flex items-center gap-3 rounded-lg bg-white/5 p-2">
                {suggestion.image && <img src={suggestion.image} alt="" className="h-12 w-12 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white">{suggestion.title}</p>
                  <p className="text-[11px] text-white/45">{suggestion.price}</p>
                </div>
                <button type="button" onClick={() => addSuggestion(suggestion)} className="text-sm font-semibold text-brand-amber">Add</button>
              </div>
            ))}
          </div>
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
          {saved && <p role="status" className="text-xs text-emerald-300">Products saved.</p>}
          <button type="button" onClick={() => void save()} disabled={saving || pins === null} className="w-full rounded-xl bg-brand-orange py-3 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save products'}
          </button>
        </div>
      </section>
    </div>
  );
}
