import { useEffect, useState } from 'react';
import { Megaphone, Power, Smartphone, ToggleRight, UserCheck } from 'lucide-react';
import { adminApi, SiteSettings } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useFetch } from '../hooks';
import { Badge, Button, Card, ErrorState, Field, PageHeader, Select, Spinner, cx, fmtDateTime, inputCls, useToast } from '../ui';

type Section = keyof SiteSettings;

function Toggle({ checked, onChange, label, hint, disabled, danger }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean; danger?: boolean }) {
  return (
    <label className={cx('flex items-start gap-3 py-1', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', checked ? (danger ? 'bg-red-500' : 'bg-brand-orange') : 'bg-white/15')}
      >
        <span className={cx('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform', checked && 'translate-x-5')} />
      </button>
      <span className="min-w-0">
        <span className="block text-white text-sm font-medium">{label}</span>
        {hint && <span className="block text-white/45 text-xs mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

function Num({ label, hint, value, onChange, min, max, step, disabled }: { label: string; hint?: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; disabled?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" className={inputCls} value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step ?? 1} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
    </Field>
  );
}

/** When the first prompts will appear, in total watch time — the same formula the web and mobile apps use. */
function schedulePreview(g: SiteSettings['guestPrompt']): string {
  if (!g.enabled) return 'Sign-in prompts are off. People can watch indefinitely without ever being asked.';
  if (g.maxPerSession === 0) return 'No prompts will be shown.';
  const times: number[] = [];
  let at = g.firstAfterSeconds;
  for (let i = 0; i < Math.min(g.maxPerSession, 4); i++) {
    times.push(Math.round(at));
    at += g.baseGapSeconds * Math.pow(g.backoff, i);
  }
  const fmt = (s: number) => (s >= 120 ? `${Math.floor(s / 60)}m ${s % 60 ? `${s % 60}s` : ''}`.trim() : `${s}s`);
  return `A guest watches first. The prompt appears after ${times.map(fmt).join(', then ')}${g.maxPerSession > times.length ? '…' : ''} of watching (max ${g.maxPerSession} per visit). It can always be closed and hides itself after ${g.autoHideSeconds}s.`;
}

function SectionCard({ icon: Icon, title, desc, dirty, saving, canEdit, onSave, onReset, children }: { icon: typeof Power; title: string; desc: string; dirty: boolean; saving: boolean; canEdit: boolean; onSave: () => void; onReset: () => void; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-brand-amber shrink-0"><Icon size={18} /></span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-semibold">{title}</h2>
          <p className="text-white/50 text-sm">{desc}</p>
        </div>
        {dirty && <Badge tone="amber">Unsaved</Badge>}
      </div>
      <div className="space-y-4">{children}</div>
      {canEdit && (
        <div className="mt-5 flex items-center gap-2 justify-end">
          <Button onClick={onReset} disabled={!dirty || saving}>Reset</Button>
          <Button variant="primary" onClick={onSave} loading={saving} disabled={!dirty}>Save changes</Button>
        </div>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { can } = useAdminAuth();
  const canEdit = can('settings.edit');
  const { data, loading, error, reload } = useFetch(() => adminApi.getSettings(), []);
  const [saved, setSaved] = useState<SiteSettings | null>(null);
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [meta, setMeta] = useState<{ at: string | null; by: string }>({ at: null, by: '' });
  const [busy, setBusy] = useState<Section | null>(null);

  useEffect(() => {
    if (data) {
      setSaved(data.settings);
      setDraft(data.settings);
      setMeta({ at: data.updatedAt, by: data.updatedBy });
    }
  }, [data]);

  if (loading && !draft) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!draft || !saved) return null;

  const dirty = (k: Section) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]);
  const edit = <K extends Section>(k: K, patch: Partial<SiteSettings[K]>) => setDraft({ ...draft, [k]: { ...draft[k], ...patch } });
  const reset = (k: Section) => setDraft({ ...draft, [k]: saved[k] });

  async function save(k: Section) {
    if (k === 'maintenance' && draft!.maintenance.enabled && !saved!.maintenance.enabled && !window.confirm('Turn maintenance mode ON? Everyone will be unable to like, comment, follow or upload until you turn it off. Watching keeps working.')) return;
    setBusy(k);
    try {
      const r = await adminApi.saveSettings({ [k]: draft![k] });
      setSaved(r.settings);
      setDraft((d) => (d ? { ...d, [k]: r.settings[k] } : d));
      setMeta({ at: r.updatedAt, by: r.updatedBy });
      toast('Saved — live for everyone within a few seconds');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally {
      setBusy(null);
    }
  }
  const section = (k: Section) => ({ dirty: dirty(k), saving: busy === k, canEdit, onSave: () => save(k), onReset: () => reset(k) });
  const g = draft.guestPrompt;
  const an = draft.announcement;
  const f = draft.features;
  const ap = draft.app;

  return (
    <>
      <PageHeader title="Site & app settings" subtitle={meta.at ? `Applies to the website and the mobile app. Last changed ${fmtDateTime(meta.at)}${meta.by ? ` by ${meta.by}` : ''}.` : 'Applies to the website and the mobile app. Nothing has been customised yet — defaults are in use.'} />
      {!canEdit && <p className="mb-4 text-sm text-amber-300">You can view these settings but not change them.</p>}
      <div className="grid gap-4 xl:grid-cols-2 items-start">
        <SectionCard icon={UserCheck} title="Watch first, sign in later" desc="Visitors go straight to the videos. After they have been watching a while, a closable card invites them to sign in." {...section('guestPrompt')}>
          <Toggle label="Show the sign-in prompt to guests" checked={g.enabled} disabled={!canEdit} onChange={(v) => edit('guestPrompt', { enabled: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Num label="First prompt after (s)" hint="of actual watching" value={g.firstAfterSeconds} min={3} max={3600} disabled={!canEdit} onChange={(n) => edit('guestPrompt', { firstAfterSeconds: n })} />
            <Num label="Next gap (s)" hint="then × the multiplier" value={g.baseGapSeconds} min={10} max={7200} disabled={!canEdit} onChange={(n) => edit('guestPrompt', { baseGapSeconds: n })} />
            <Num label="Gap multiplier" hint="1 = same gap every time" value={g.backoff} min={1} max={5} step={0.1} disabled={!canEdit} onChange={(n) => edit('guestPrompt', { backoff: n })} />
            <Num label="Max per visit" hint="0 = never" value={g.maxPerSession} min={0} max={50} disabled={!canEdit} onChange={(n) => edit('guestPrompt', { maxPerSession: n })} />
            <Num label="Auto-hide after (s)" value={g.autoHideSeconds} min={3} max={120} disabled={!canEdit} onChange={(n) => edit('guestPrompt', { autoHideSeconds: n })} />
          </div>
          <p className="text-xs text-white/50 bg-white/5 rounded-lg p-3">{schedulePreview(g)}</p>
        </SectionCard>

        <SectionCard icon={Megaphone} title="Announcement banner" desc="A short message at the top of the website and in the app. People can dismiss it; it comes back only when you change it." {...section('announcement')}>
          <Toggle label="Show the banner" checked={an.enabled} disabled={!canEdit} onChange={(v) => edit('announcement', { enabled: v })} />
          <Field label="Message" hint={`${an.text.length}/280`}>
            <textarea rows={2} maxLength={280} className={inputCls} value={an.text} disabled={!canEdit} onChange={(e) => edit('announcement', { text: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Style">
              <Select value={an.level} disabled={!canEdit} onChange={(e) => edit('announcement', { level: e.target.value as SiteSettings['announcement']['level'] })}>
                <option value="info">Info</option>
                <option value="success">Good news</option>
                <option value="warning">Warning</option>
              </Select>
            </Field>
            <Field label="“Learn more” link (optional)">
              <input className={inputCls} placeholder="https://…" value={an.link} disabled={!canEdit} onChange={(e) => edit('announcement', { link: e.target.value })} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard icon={Power} title="Maintenance mode" desc="Pauses every write (likes, comments, follows, uploads, sign-ups) while people can still watch. Admin, partner sale reports and analytics keep working." {...section('maintenance')}>
          <Toggle danger label="Maintenance mode" checked={draft.maintenance.enabled} disabled={!canEdit} onChange={(v) => edit('maintenance', { enabled: v })} hint={draft.maintenance.enabled ? 'ON — writes are refused with a notice.' : 'Off — everything works normally.'} />
          <Field label="Message shown to visitors" hint={`${draft.maintenance.message.length}/300`}>
            <textarea rows={2} maxLength={300} className={inputCls} value={draft.maintenance.message} disabled={!canEdit} onChange={(e) => edit('maintenance', { message: e.target.value })} />
          </Field>
        </SectionCard>

        <SectionCard icon={ToggleRight} title="Feature switches" desc="Close one part of the product without a deploy — for example while you clear a backlog of moderation." {...section('features')}>
          <Toggle label="New sign-ups" hint="Existing accounts can still sign in." checked={f.signups} disabled={!canEdit} onChange={(v) => edit('features', { signups: v })} />
          <Toggle label="Video uploads" checked={f.uploads} disabled={!canEdit} onChange={(v) => edit('features', { uploads: v })} />
          <Toggle label="Comments" hint="Posting only — existing comments stay visible." checked={f.comments} disabled={!canEdit} onChange={(v) => edit('features', { comments: v })} />
          <Toggle label="Partner applications" hint="The /partners form." checked={f.partnerApplications} disabled={!canEdit} onChange={(v) => edit('features', { partnerApplications: v })} />
        </SectionCard>

        <SectionCard icon={Smartphone} title="Mobile app versions" desc="Below the minimum version the app shows an update screen and cannot be used; below the latest version it only suggests updating. Leave blank for no rule." {...section('app')}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum version" hint="e.g. 1.2.0 — forces update">
              <input className={inputCls} placeholder="1.0.0" value={ap.minVersion} disabled={!canEdit} onChange={(e) => edit('app', { minVersion: e.target.value })} />
            </Field>
            <Field label="Latest version" hint="suggests update">
              <input className={inputCls} placeholder="1.0.0" value={ap.latestVersion} disabled={!canEdit} onChange={(e) => edit('app', { latestVersion: e.target.value })} />
            </Field>
          </div>
          <Field label="Download / store link">
            <input className={inputCls} placeholder="https://…/app.apk or Play Store link" value={ap.updateUrl} disabled={!canEdit} onChange={(e) => edit('app', { updateUrl: e.target.value })} />
          </Field>
          <Field label="Update message">
            <input className={inputCls} maxLength={300} value={ap.updateMessage} disabled={!canEdit} onChange={(e) => edit('app', { updateMessage: e.target.value })} />
          </Field>
        </SectionCard>
      </div>
    </>
  );
}
