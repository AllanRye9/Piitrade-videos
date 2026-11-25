import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Copy, Loader2, XCircle } from 'lucide-react';
import { api, ApiError } from '../api';
import type { PartnerApiCheck, PartnerApplicationForm, PartnerApplicationStatus } from '../types';

const STORE_KEY = 'piitrade_partner_application';

interface Stored {
  id: string;
  token: string;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function writeStored(v: Stored | null) {
  try {
    if (v) localStorage.setItem(STORE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // Private mode etc. — the person can still copy the token from the screen.
  }
}

const field = 'w-full bg-white/10 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:ring-2 focus:ring-brand-amber placeholder:text-white/30';
const label = 'block text-white/60 text-xs font-medium mb-1';

function Issues({ check }: { check: PartnerApiCheck }) {
  return (
    <ul className="space-y-1.5">
      {check.issues.map((i, n) => (
        <li key={n} className="flex gap-2 text-sm">
          <span className={`shrink-0 text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded ${i.level === 'error' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>{i.level}</span>
          <span className="text-white/80">{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusPanel({ stored, onForget }: { stored: Stored; onForget: () => void }) {
  const [state, setState] = useState<{ app: PartnerApplicationStatus; slug?: string; secret?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .getPartnerApplication(stored.id, stored.token)
      .then((r) => setState((prev) => ({ app: r.application, slug: r.partner?.slug ?? prev?.slug, secret: r.credentials?.postbackSecret ?? prev?.secret })))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the application'));
  }, [stored.id, stored.token]);

  useEffect(load, [load]);

  const app = state?.app;
  return (
    <section className="bg-white/5 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-white font-semibold text-base">Your application</h2>
        <button type="button" onClick={load} className="text-white/50 text-xs underline">Refresh</button>
      </div>
      {error && <p className="text-red-300 text-sm">{error}</p>}
      {!app && !error && <p className="text-white/50 text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
      {app && (
        <>
          <p className="text-white text-sm">
            <b>{app.name}</b> —{' '}
            {app.status === 'pending' && <span className="text-amber-300">waiting for review. Your listing API already passed the connection check.</span>}
            {app.status === 'approved' && <span className="text-emerald-300">approved. You are a Piitrade Videos partner.</span>}
            {app.status === 'rejected' && <span className="text-red-300">not approved{app.reviewNote ? `: ${app.reviewNote}` : '.'}</span>}
          </p>
          {app.status === 'approved' && state?.slug && (
            <div className="space-y-2 text-sm text-white/70">
              <p>Your partner id is <code className="text-brand-amber">{state.slug}</code>. To credit creators for sales, send the <code>pv_click</code> value with each order and POST a signed conversion (see <code>docs/PARTNERS.md</code> and <code>docs/ATTRIBUTION.md</code>).</p>
              {state.secret ? (
                <div className="space-y-1">
                  <p className="text-amber-300 text-xs">Your postback secret is shown only now. Copy it and store it safely — if you lose it, ask us to rotate it.</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 break-all bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-brand-amber">{state.secret}</code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(state.secret!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
                      className="shrink-0 h-9 px-3 rounded-lg bg-white/10 text-white text-xs flex items-center gap-1.5"
                    >
                      <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-white/50 text-xs">Your postback secret was already collected. If it is lost, contact us to rotate it.</p>
              )}
            </div>
          )}
          {app.status !== 'pending' && (
            <button type="button" onClick={onForget} className="text-white/50 text-xs underline">Hide this application</button>
          )}
        </>
      )}
    </section>
  );
}

export default function PartnersPage() {
  const [form, setForm] = useState<PartnerApplicationForm>({ name: '', baseUrl: '', apiBase: '', contactEmail: '', contactName: '', country: '', currency: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<PartnerApiCheck | null>(null);
  const [stored, setStored] = useState<Stored | null>(readStored);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const set = (k: keyof PartnerApplicationForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      const res = await api.applyAsPartner(form);
      const s = { id: res.application.id, token: res.statusToken };
      writeStored(s);
      setStored(s);
      setFreshToken(res.statusToken);
      setCheck(res.check);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the application');
      if (err instanceof ApiError && err.code === 'API_CHECK_FAILED') setCheck(err.body?.check ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh w-full bg-black">
      <div className="safe-top safe-left safe-right flex items-center gap-3 px-4 py-3 border-b border-white/10 sticky top-0 bg-black/95 backdrop-blur z-10">
        <Link to="/" aria-label="Back" className="tap-target -ml-2 text-white flex items-center justify-center">
          <ArrowLeft size={22} />
        </Link>
        <h1 className="text-white font-semibold text-base">Become a partner</h1>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-6 pb-16 space-y-6 text-white/80 text-sm leading-relaxed">
        <section className="space-y-2">
          <h2 className="text-white font-semibold text-lg">Get your shop in front of Piitrade Videos viewers</h2>
          <p>
            Piitrade Videos sends viewers to Piitrade and to the shops and apps that connect to it: your products appear in video
            search and as tags inside creators’ videos, and every tap is sent to your site with tracking, so you can see exactly which
            videos bring you traffic and sales.
          </p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Expose a public listing endpoint: <code className="text-brand-amber">GET {'{apiBase}'}/api/listings?q=…</code> returning <code>{'{ listings: [{ id, title, price, … }] }'}</code>.</li>
            <li>Apply below with that API address. We call it and check it right away — if something is off, you see exactly what to fix.</li>
            <li>We review it. Once approved you get a partner id and a postback secret to report sales (optional) so creators who send you buyers can earn a commission.</li>
          </ol>
          <p className="text-white/50 text-xs">The full spec is in the repository at <code>docs/LISTING_SPEC.md</code>, and the partner guide at <code>docs/PARTNERS.md</code>.</p>
        </section>

        {stored && <StatusPanel stored={stored} onForget={() => { writeStored(null); setStored(null); setFreshToken(null); }} />}

        {freshToken && (
          <p className="text-amber-300 text-xs">
            Application received. This browser remembers it; to check it from elsewhere keep this id and token:
            <code className="block break-all mt-1 text-white/70">{stored?.id} · {freshToken}</code>
          </p>
        )}

        {!stored && (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={label}>Shop or app name</label>
              <input required className={field} value={form.name} onChange={set('name')} maxLength={80} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={label}>Website</label>
                <input required type="url" placeholder="https://shop.example.com" className={field} value={form.baseUrl} onChange={set('baseUrl')} />
              </div>
              <div>
                <label className={label}>Listing API base</label>
                <input required type="url" placeholder="https://api.shop.example.com" className={field} value={form.apiBase} onChange={set('apiBase')} />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={label}>Contact email</label>
                <input required type="email" className={field} value={form.contactEmail} onChange={set('contactEmail')} />
              </div>
              <div>
                <label className={label}>Contact name (optional)</label>
                <input className={field} value={form.contactName} onChange={set('contactName')} maxLength={80} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Country (ISO, e.g. UG)</label>
                <input className={field} value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))} maxLength={2} />
              </div>
              <div>
                <label className={label}>Currency (ISO, e.g. UGX)</label>
                <input className={field} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={3} />
              </div>
            </div>
            <div>
              <label className={label}>Anything we should know (optional)</label>
              <textarea rows={3} className={field} value={form.notes} onChange={set('notes')} maxLength={1000} />
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 space-y-2">
                <p className="text-red-300 text-sm flex items-center gap-2"><XCircle size={16} /> {error}</p>
                {check && <Issues check={check} />}
              </div>
            )}

            <button type="submit" disabled={busy} className="w-full h-11 rounded-full bg-brand-orange text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <><Loader2 size={16} className="animate-spin" /> Checking your API…</> : 'Check my API and apply'}
            </button>
          </form>
        )}

        {stored && check && check.issues.length > 0 && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 space-y-2">
            <p className="text-emerald-300 text-sm flex items-center gap-2"><CheckCircle2 size={16} /> Your API passed. A few things would make your listings look better:</p>
            <Issues check={check} />
          </div>
        )}
      </div>
    </div>
  );
}
