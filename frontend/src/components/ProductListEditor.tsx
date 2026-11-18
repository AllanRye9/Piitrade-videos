import { Plus, Trash2 } from 'lucide-react';
import type { SiteInfo } from '../types';
import { MAX_PRODUCTS, POSITIONS, ProductDraft, newDraft, positionIdOf } from '../productDrafts';

interface Props {
  value: ProductDraft[];
  onChange: (next: ProductDraft[]) => void;
  sites: Array<Pick<SiteInfo, 'id' | 'name'>>;
  /** Length of the video in seconds, when known (shown as a hint). */
  durationSec?: number | null;
}

const field = 'w-full rounded-lg bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:ring-1 focus:ring-brand-orange/60';

/** Edits the list of products pinned to a video: shop, link, button text, when it shows, and where. */
export default function ProductListEditor({ value, onChange, sites, durationSec }: Props) {
  const update = (key: string, patch: Partial<ProductDraft>) => onChange(value.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <div className="space-y-3">
      {value.map((d, i) => (
        <div key={d.key} className="space-y-2 rounded-xl bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-white/70">Product {i + 1}</p>
            <button type="button" onClick={() => onChange(value.filter((x) => x.key !== d.key))} aria-label={`Remove product ${i + 1}`} className="tap-target -mr-2 text-white/50 hover:text-red-300">
              <Trash2 size={16} />
            </button>
          </div>
          <select value={d.siteId} onChange={(e) => update(d.key, { siteId: e.target.value })} aria-label="Shop or marketplace" className={field}>
            <option value="">Shop (detected from the link)</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id} className="text-black">
                {s.name}
              </option>
            ))}
          </select>
          <input type="url" value={d.url} onChange={(e) => update(d.key, { url: e.target.value })} placeholder="Product page link (https://…)" maxLength={500} className={field} />
          <input value={d.title} onChange={(e) => update(d.key, { title: e.target.value })} placeholder="Button text, e.g. “Buy the red sneakers” (optional)" maxLength={120} className={field} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-white/50">
              Shows from (seconds)
              <input inputMode="decimal" value={d.start} onChange={(e) => update(d.key, { start: e.target.value })} placeholder="0" className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] text-white/50">
              Until (blank = the end)
              <input inputMode="decimal" value={d.end} onChange={(e) => update(d.key, { end: e.target.value })} placeholder={durationSec ? String(Math.round(durationSec)) : 'end'} className={`${field} mt-1`} />
            </label>
          </div>
          <label className="block text-[11px] text-white/50">
            Where the button sits
            <select value={positionIdOf(d)} onChange={(e) => { const p = POSITIONS.find((x) => x.id === e.target.value); if (p) update(d.key, { x: p.x, y: p.y }); }} className={`${field} mt-1`}>
              {positionIdOf(d) === 'custom' && <option value="custom">Custom</option>}
              {POSITIONS.map((p) => (
                <option key={p.id} value={p.id} className="text-black">
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
      {value.length < MAX_PRODUCTS && (
        <button type="button" onClick={() => onChange([...value, newDraft()])} className="flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-orange">
          <Plus size={16} /> Add a product
        </button>
      )}
      <p className="text-[11px] text-white/35">Each link must be a page on one of the connected shops. Up to {MAX_PRODUCTS} per video.</p>
    </div>
  );
}
