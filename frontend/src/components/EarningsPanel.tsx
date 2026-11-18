import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Earnings } from '../types';

/** Money in minor units → "12.50 USD". Currencies with no 2-decimal convention still show fine. */
export function formatMinor(minor: number, currency: string): string {
  const v = (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency && currency !== '—' ? `${v} ${currency}` : v;
}

const STATUS: Record<string, string> = { pending: 'Pending', approved: 'Approved', paid: 'Paid', reversed: 'Reversed' };

/** The creator's earnings: what viewers' taps on Shop buttons turned into. */
export default function EarningsPanel() {
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getEarnings()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load earnings'));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p className="text-xs text-red-300">{error}</p>;
  if (!data) return <p className="text-xs text-white/50">Loading…</p>;
  const currencies = Object.keys(data.balances);

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/60">
        {data.clicksLast30Days} tap{data.clicksLast30Days === 1 ? '' : 's'} on your Shop buttons in the last 30 days.
        {data.rates.length > 0 && ` You earn ${data.rates.map((r) => `${r.commissionPct}% on ${r.site}`).join(', ')}.`}
      </p>
      {currencies.length === 0 ? (
        <p className="text-sm text-white/70">No sales yet. When someone buys after tapping a product in your video, it shows up here.</p>
      ) : (
        currencies.map((c) => (
          <div key={c} className="grid grid-cols-3 gap-2 text-center">
            {(['pending', 'approved', 'paid'] as const).map((k) => (
              <div key={k} className="rounded-xl bg-white/5 px-2 py-2.5">
                <p className="text-[11px] text-white/50">{STATUS[k]}</p>
                <p className="text-sm font-semibold text-white">{formatMinor(data.balances[c][k], c)}</p>
              </div>
            ))}
          </div>
        ))
      )}
      {data.recent.length > 0 && (
        <ul className="divide-y divide-white/10 rounded-xl bg-white/5">
          {data.recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm text-white">{r.video}</span>
                <span className="block text-[11px] text-white/50">
                  {r.site} · sale {formatMinor(r.saleMinor, r.currency)} · {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block text-sm font-semibold ${r.status === 'reversed' ? 'text-white/40 line-through' : 'text-white'}`}>{formatMinor(r.commissionMinor, r.currency)}</span>
                <span className="block text-[11px] text-white/50">{STATUS[r.status] ?? r.status}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-white/35">Pending sales are confirmed by the shop and reviewed before they count as approved. Payouts are arranged by the platform.</p>
    </div>
  );
}
