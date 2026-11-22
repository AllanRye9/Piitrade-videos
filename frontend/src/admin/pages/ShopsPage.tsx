import { useState } from 'react';
import { CheckCircle2, Copy, KeyRound, Pencil, Plug, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { adminApi, SiteRecord, SiteTestResult } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useFetch } from '../hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, FormModal, IconButton, Modal, PageHeader, Spinner, Table, Td, Th, inputCls, useToast } from '../ui';

function SiteForm({ initial, onClose, onSaved, onCreated }: { initial?: SiteRecord; onClose: () => void; onSaved: () => void; onCreated: (secret: string, name: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [apiBase, setApiBase] = useState(initial?.apiBase ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? '');
  const [commissionPct, setCommissionPct] = useState(String(initial?.commissionPct ?? 5));
  const [active, setActive] = useState(initial?.active ?? true);

  return (
    <FormModal
      title={initial ? 'Edit shop' : 'Connect a shop'}
      size="lg"
      onClose={onClose}
      onSubmit={async () => {
        const data = { name, baseUrl, apiBase, country, currency, commissionPct: Number(commissionPct), active };
        if (initial) {
          await adminApi.updateSite(initial.id, data);
          toast('Shop updated');
          onSaved();
        } else {
          const res = await adminApi.createSite(data);
          onSaved();
          onCreated(res.postbackSecret, res.site.name);
        }
      }}
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={80} />
        </Field>
        <Field label="Website" hint="Videos may only link to this host (and subdomains)">
          <input required type="url" placeholder="https://shop.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field label="Listing API base" hint="Optional. Used for “Test connection” — see docs/LISTING_SPEC.md">
        <input type="url" placeholder="https://api.shop.example.com" value={apiBase} onChange={(e) => setApiBase(e.target.value)} className={inputCls} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Country" hint="ISO, e.g. UG">
          <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} className={inputCls} />
        </Field>
        <Field label="Currency" hint="ISO, e.g. UGX">
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className={inputCls} />
        </Field>
        <Field label="Commission %" hint="Of order value, owed to the creator">
          <input required type="number" min={0} max={100} step="0.1" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-white/75 select-none">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-brand-orange" /> Active (inactive shops can’t be linked to and their redirects stop)
      </label>
    </FormModal>
  );
}

function SecretModal({ siteName, secret, slug, onClose }: { siteName: string; secret: string; slug?: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal title={`Postback secret · ${siteName}`} size="lg" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p className="text-white/70 text-sm mb-3">Give this to the shop. They sign each conversion postback with it. Treat it like a password — you can reveal or rotate it later from this page.</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 break-all bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-brand-amber">{secret}</code>
        <Button onClick={() => navigator.clipboard?.writeText(secret).then(() => toast('Copied'))}>
          <Copy size={14} /> Copy
        </Button>
      </div>
      <p className="text-white/50 text-xs mt-4">
        Headers to send: <code>X-Piitrade-Site: {slug ?? '<slug>'}</code>, <code>X-Piitrade-Timestamp</code>, <code>X-Piitrade-Signature</code> (HMAC-SHA256 of “timestamp.body”). Full guide: <code>docs/ATTRIBUTION.md</code>.
      </p>
    </Modal>
  );
}

function TestModal({ site, onClose }: { site: SiteRecord; onClose: () => void }) {
  const { data, loading, error } = useFetch<SiteTestResult>(() => adminApi.testSite(site.id), [site.id]);
  return (
    <Modal title={`Test connection · ${site.name}`} onClose={onClose}>
      {loading && <Spinner label="Calling the shop’s listing API…" />}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {data && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {data.ok ? <CheckCircle2 className="text-emerald-400" size={20} /> : <XCircle className="text-red-400" size={20} />}
            <span className="text-white font-semibold">{data.ok ? 'Looks good' : 'Doesn’t match the spec yet'}</span>
            <span className="ml-auto text-white/40 text-xs">{data.ms} ms{data.status ? ` · HTTP ${data.status}` : ''}</span>
          </div>
          {data.issues.length === 0 && <p className="text-white/60 text-sm">{data.sampleCount} listing(s) returned; all checked fields present.</p>}
          <ul className="space-y-1.5">
            {data.issues.map((i, n) => (
              <li key={n} className="flex gap-2 text-sm">
                <Badge tone={i.level === 'error' ? 'red' : 'amber'}>{i.level}</Badge>
                <span className="text-white/80">{i.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export default function ShopsPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => adminApi.listSites(), []);
  const [editing, setEditing] = useState<SiteRecord | 'new' | null>(null);
  const [secret, setSecret] = useState<{ name: string; slug?: string; value: string } | null>(null);
  const [testing, setTesting] = useState<SiteRecord | null>(null);
  const [deleting, setDeleting] = useState<SiteRecord | null>(null);
  const [rotating, setRotating] = useState<SiteRecord | null>(null);

  async function reveal(s: SiteRecord) {
    try {
      const r = await adminApi.revealSiteSecret(s.id);
      setSecret({ name: s.name, slug: s.slug, value: r.postbackSecret });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Shops"
        subtitle="Connected shops: where product links may point, and what creators earn."
        actions={can('sites.create') && <Button variant="primary" onClick={() => setEditing('new')}><Plus size={16} /> Connect shop</Button>}
      />
      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.sites.length === 0 ? (
        <EmptyState title="No shops connected" hint="Connect a shop so videos can link to its products." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Shop</Th>
              <Th>Currency</Th>
              <Th>Commission</Th>
              <Th>Clicks</Th>
              <Th>Sales</Th>
              <Th>Secret</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {data.sites.map((s) => (
              <tr key={s.id}>
                <Td>
                  <p className="text-white font-medium">{s.name}</p>
                  <p className="text-white/40 text-xs truncate max-w-[220px]">{s.baseUrl}</p>
                </Td>
                <Td>{s.currency || '—'}{s.country ? ` · ${s.country}` : ''}</Td>
                <Td className="tabular-nums">{s.commissionPct}%</Td>
                <Td className="tabular-nums">{s.clicks ?? 0}</Td>
                <Td className="tabular-nums">{s.conversions ?? 0}</Td>
                <Td><code className="text-white/50 text-xs">{s.secretHint}</code></Td>
                <Td><Badge tone={s.active ? 'green' : 'neutral'}>{s.active ? 'Active' : 'Disabled'}</Badge></Td>
                <Td className="text-right whitespace-nowrap">
                  <IconButton label="Test connection" onClick={() => setTesting(s)}><Plug size={16} /></IconButton>
                  {can('sites.edit') && <IconButton label="Reveal postback secret" onClick={() => reveal(s)}><KeyRound size={16} /></IconButton>}
                  {can('sites.edit') && <IconButton label="Edit" onClick={() => setEditing(s)}><Pencil size={16} /></IconButton>}
                  {can('sites.edit') && <IconButton label="Rotate secret" onClick={() => setRotating(s)}><RefreshCw size={16} className="text-amber-300" /></IconButton>}
                  {can('sites.delete') && <IconButton label="Delete" danger onClick={() => setDeleting(s)}><Trash2 size={16} /></IconButton>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ))}

      {editing && (
        <SiteForm
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
          onCreated={(value, name) => {
            setEditing(null);
            setSecret({ name, value });
          }}
        />
      )}
      {secret && <SecretModal siteName={secret.name} secret={secret.value} slug={secret.slug} onClose={() => setSecret(null)} />}
      {testing && <TestModal site={testing} onClose={() => setTesting(null)} />}
      {rotating && (
        <ConfirmDialog
          danger
          title="Rotate postback secret"
          confirmLabel="Rotate"
          message={<>The current secret for <b>{rotating.name}</b> stops working immediately; the shop must update to the new one or its conversions will be rejected.</>}
          onConfirm={async () => {
            const r = await adminApi.rotateSiteSecret(rotating.id);
            setSecret({ name: rotating.name, slug: rotating.slug, value: r.postbackSecret });
            reload();
          }}
          onClose={() => setRotating(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          danger
          title="Delete shop"
          confirmLabel="Delete"
          message={<>Delete <b>{deleting.name}</b>? Products pinned to it are removed. Shops with click history can’t be deleted — disable them instead.</>}
          onConfirm={async () => {
            await adminApi.deleteSite(deleting.id);
            toast('Shop deleted');
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
