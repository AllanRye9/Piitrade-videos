import { useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, KeyRound, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import { adminApi, SiteRecord, SiteTestResult } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useFetch } from '../hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, FormModal, IconButton, PageHeader, Spinner, Table, Td, Th, inputCls, useToast } from '../ui';

const DEFAULT_LISTING = '/listings/{id}';
const DEFAULT_SEARCH = '/listings?q={q}';

function SiteForm({ initial, onClose, onSaved }: { initial?: SiteRecord; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [siteUrl, setSiteUrl] = useState(initial?.siteUrl ?? '');
  const [apiType, setApiType] = useState<SiteRecord['apiType']>(initial?.apiType ?? 'piitrade');
  const [apiUrl, setApiUrl] = useState(initial?.apiUrl ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? '');
  const [listingPath, setListingPath] = useState(initial?.listingPath ?? DEFAULT_LISTING);
  const [searchPath, setSearchPath] = useState(initial?.searchPath ?? DEFAULT_SEARCH);
  const [sellPath, setSellPath] = useState(initial?.sellPath ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [commission, setCommission] = useState(String(initial?.commissionPct ?? 0));
  const [secret, setSecret] = useState(initial?.postbackSecret ?? '');
  const [rotating, setRotating] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [test, setTest] = useState<SiteTestResult | 'running' | null>(null);

  async function runTest() {
    if (!initial) return;
    setTest('running');
    try {
      setTest(await adminApi.testSite(initial.id));
    } catch (e) {
      setTest({ ok: false, error: e instanceof Error ? e.message : 'Test failed' });
    }
  }

  return (
    <FormModal
      title={initial ? `Edit ${initial.name}` : 'Add site'}
      onClose={onClose}
      onSubmit={async () => {
        const data = { name, siteUrl, apiType, apiUrl: apiType === 'link-only' ? '' : apiUrl, country, currency, listingPath, searchPath, sellPath, active, commissionPct: Number(commission) || 0 };
        if (initial) await adminApi.updateSite(initial.id, data);
        else await adminApi.createSite(data);
        toast(initial ? 'Site updated' : 'Site added');
        onSaved();
      }}
    >
      <Field label="Name" hint="Shown to viewers, e.g. “Piitrade” or “Kampala Crafts”">
        <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={80} />
      </Field>
      <Field label="Website URL" hint="The public website viewers are sent to">
        <input required type="url" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://shop.example.com" className={inputCls} />
      </Field>
      <Field label="How are products found?" hint="“Marketplace API” shows live listings in “Find products”. “Link only” just links to the site’s own search.">
        <select value={apiType} onChange={(e) => setApiType(e.target.value as SiteRecord['apiType'])} className={inputCls}>
          <option value="piitrade">Marketplace API (Piitrade-compatible)</option>
          <option value="link-only">Link only (no API)</option>
        </select>
      </Field>
      {apiType === 'piitrade' && (
        <Field label="API URL" hint="The site’s BACKEND address (serves JSON at /api/listings) — usually not the same as the website">
          <input required type="url" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://api.shop.example.com" className={inputCls} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country filter" hint="Optional, sent to the API">
          <input value={country} onChange={(e) => setCountry(e.target.value)} className={inputCls} maxLength={60} placeholder="e.g. UGANDA" />
        </Field>
        <Field label="Default currency" hint="If a listing has none">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls} maxLength={8} placeholder="e.g. UGX" />
        </Field>
      </div>
      <Field label="Listing page path" hint="{id} is replaced with the listing id">
        <input value={listingPath} onChange={(e) => setListingPath(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Search page path" hint="{q} is replaced with the search words">
        <input value={searchPath} onChange={(e) => setSearchPath(e.target.value)} className={inputCls} />
      </Field>
      <Field label="“Sell here” path" hint="Optional — adds a “Sell on …” link to the menu, e.g. /listings/create">
        <input value={sellPath} onChange={(e) => setSellPath(e.target.value)} className={inputCls} placeholder="(none)" />
      </Field>
      <Field label="Creator commission (%)" hint="Share of each confirmed sale credited to the creator whose video drove it. 0 = track sales without paying creators.">
        <input type="number" min={0} max={100} step={0.5} value={commission} onChange={(e) => setCommission(e.target.value)} className={inputCls} />
      </Field>
      {initial && secret && (
        <div className="rounded-lg border border-white/10 p-3 text-sm space-y-2">
          <div className="text-white/80 font-medium">Sale reporting</div>
          <p className="text-white/50 text-xs">
            Slug: <code className="text-white/80">{initial.slug}</code>. The shop signs sale reports with this secret (see docs/OPEN_SHOP_SPEC.md). Treat it like a password.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white/5 px-2 py-1.5 text-xs text-white/80">{showSecret ? secret : '•'.repeat(24)}</code>
            <Button type="button" onClick={() => setShowSecret((v) => !v)}>{showSecret ? 'Hide' : 'Show'}</Button>
            <IconButton label="Copy secret" type="button" onClick={() => navigator.clipboard?.writeText(secret).then(() => toast('Secret copied'))}><Copy size={16} /></IconButton>
          </div>
          <Button
            type="button"
            disabled={rotating}
            onClick={async () => {
              if (!window.confirm('Issue a new secret? The shop must be updated with it, or its sale reports will be rejected.')) return;
              setRotating(true);
              try {
                const r = await adminApi.rotateSiteSecret(initial.id);
                setSecret(r.site.postbackSecret ?? '');
                setShowSecret(true);
                toast('New secret issued');
              } finally {
                setRotating(false);
              }
            }}
          >
            <KeyRound size={14} /> {rotating ? 'Working…' : 'Issue a new secret'}
          </Button>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-white/80">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (visible to viewers and uploaders)
      </label>

      {initial && (
        <div className="rounded-lg border border-white/10 p-3 text-sm space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white/60">Save your changes first, then test the saved connection.</span>
            <Button type="button" onClick={runTest} disabled={test === 'running'}>
              {test === 'running' ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
          {test && test !== 'running' && (
            <div className={test.ok ? 'text-emerald-300' : 'text-red-300'}>
              {test.ok ? <CheckCircle2 size={14} className="inline mr-1" /> : <XCircle size={14} className="inline mr-1" />}
              {test.ok
                ? test.linkOnly
                  ? test.message
                  : `Connected in ${test.ms} ms — ${test.count} listing(s) for “a”.`
                : test.error}
              {test.sample && test.sample.length > 0 && (
                <ul className="mt-1 text-white/60 list-disc pl-5">
                  {test.sample.map((s) => (
                    <li key={s.listingUrl}>
                      {s.name} — {s.price}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </FormModal>
  );
}

export default function SitesPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => adminApi.listSites(), []);
  const [editing, setEditing] = useState<SiteRecord | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SiteRecord | null>(null);

  return (
    <>
      <PageHeader
        title="Sites"
        subtitle="The marketplaces and stores your videos link to. Viewers can find and open products from every active site."
        actions={can('sites.create') && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add site
          </Button>
        )}
      />

      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.sites.length === 0 ? (
        <EmptyState title="No sites yet" hint="Add the first marketplace or store your videos should link to. Until you do, “Find products” has nothing to search." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Site</Th>
              <Th>Products</Th>
              <Th>Country</Th>
              <Th>Commission</Th>
              <Th>Videos</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {data.sites.map((s) => (
              <tr key={s.id}>
                <Td>
                  <div className="font-medium text-white">{s.name}</div>
                  <a href={s.siteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-white/50 hover:text-white inline-flex items-center gap-1">
                    {s.siteUrl.replace(/^https?:\/\//, '')} <ExternalLink size={11} />
                  </a>
                </Td>
                <Td>{s.apiType === 'piitrade' ? <Badge tone="blue">Live search</Badge> : <Badge>Link only</Badge>}</Td>
                <Td>{s.country || '—'}</Td>
                <Td className="tabular-nums">{s.commissionPct ? `${s.commissionPct}%` : '—'}</Td>
                <Td className="tabular-nums">{s.videoCount ?? 0}</Td>
                <Td>{s.active ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Hidden</Badge>}</Td>
                <Td className="text-right whitespace-nowrap">
                  {can('sites.edit') && <IconButton label="Edit" onClick={() => setEditing(s)}><Pencil size={16} /></IconButton>}
                  {can('sites.delete') && <IconButton label="Delete" danger onClick={() => setDeleting(s)}><Trash2 size={16} /></IconButton>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ))}

      {editing && <SiteForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {deleting && (
        <ConfirmDialog
          danger
          title="Delete site"
          confirmLabel="Delete"
          message={<>Delete <b>{deleting.name}</b>? The {deleting.videoCount ?? 0} video(s) linked to it keep playing but lose their site tag and product link. To just hide it, edit it and untick “Active”.</>}
          onConfirm={async () => {
            await adminApi.deleteSite(deleting.id);
            toast('Site deleted');
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
