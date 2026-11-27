import type { ProductPin, SiteInfo } from '../../lib/types';
import { Trash2 } from 'lucide-react';

interface Props {
  pins: ProductPin[];
  onChange: (pins: ProductPin[]) => void;
  sites: SiteInfo[];
  durationMs: number | null;
}

const MAX_PINS = 8;
const inputClass =
  'min-w-0 w-full rounded-lg bg-white/10 px-2.5 py-2 text-xs text-white outline-none ring-1 ring-transparent placeholder:text-white/35 focus:ring-brand-orange/60';

function seconds(ms: number | null): string {
  return ms === null ? '' : String(Math.round(ms / 100) / 10);
}

function milliseconds(value: string): number | null {
  if (!value.trim()) return null;
  const secondsValue = Number(value);
  return Number.isFinite(secondsValue) ? Math.max(0, Math.round(secondsValue * 1000)) : null;
}

export default function ProductsEditor({ pins, onChange, sites, durationMs }: Props) {
  function update(index: number, patch: Partial<ProductPin>) {
    onChange(pins.map((pin, i) => (i === index ? { ...pin, ...patch } : pin)));
  }

  return (
    <div className="space-y-2.5">
      {pins.length === 0 && <p className="text-xs text-white/40">No products pinned. Add a link to a connected shop’s product.</p>}
      {pins.map((pin, index) => (
        <div key={`${pin.url}-${index}`} className="space-y-2 rounded-lg border border-white/10 p-2.5">
          <div className="flex items-center gap-2">
            <input
              value={pin.url}
              onChange={(event) => update(index, { url: event.target.value })}
              placeholder={sites[0] ? `${sites[0].baseUrl}/listings/…` : 'https://shop.example.com/product'}
              aria-label="Product link"
              className={inputClass}
            />
            <button type="button" onClick={() => onChange(pins.filter((_, i) => i !== index))} aria-label="Remove product" className="shrink-0 p-1 text-red-400">
              <Trash2 size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-3 text-[10px] uppercase tracking-wide text-white/40">
              Label
              <input
                value={pin.title}
                onChange={(event) => update(index, { title: event.target.value })}
                placeholder="Label (optional)"
                maxLength={120}
                className={`${inputClass} mt-1 normal-case tracking-normal`}
              />
            </label>
            <label className="text-[10px] uppercase tracking-wide text-white/40">
              From (s)
              <input
                type="number"
                min={0}
                max={durationMs === null ? undefined : durationMs / 1000}
                step={0.1}
                value={seconds(pin.startMs)}
                onChange={(event) => update(index, { startMs: milliseconds(event.target.value) ?? 0 })}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="text-[10px] uppercase tracking-wide text-white/40">
              To (s)
              <input
                type="number"
                min={0}
                max={durationMs === null ? undefined : durationMs / 1000}
                step={0.1}
                value={seconds(pin.endMs)}
                onChange={(event) => update(index, { endMs: milliseconds(event.target.value) })}
                placeholder="End"
                className={`${inputClass} mt-1`}
              />
            </label>
            <span className="self-end pb-2 text-[10px] text-white/35">blank = end</span>
          </div>
        </div>
      ))}
      {pins.length < MAX_PINS && (
        <button
          type="button"
          onClick={() => onChange([...pins, { url: '', title: '', startMs: 0, endMs: null }])}
          className="text-sm font-semibold text-brand-amber"
        >
          + Add product
        </button>
      )}
    </div>
  );
}
