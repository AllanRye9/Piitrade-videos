import { useState } from 'react';
import { Badge, Button, EmptyState, ErrorState, Field, PageHeader, Pagination, Select, Spinner, Table, Td, Th, Toolbar, fmtDate, fmtNum, useToast } from '../ui';
import { adminApi, ConversionRow } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useFetch } from '../hooks';
import { formatMinor } from '../../components/EarningsPanel';

const TONE: Record<ConversionRow['status'], 'amber' | 'blue' | 'green' | 'neutral'> = { pending: 'amber', approved: 'blue', paid: 'green', reversed: 'neutral' };

export default function EarningsPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const sites = useFetch(() => adminApi.siteOptions(), []);
  const overview = useFetch(() => adminApi.attributionOverview(days, siteId || undefined), [days, siteId]);
  const list = useFetch(() => adminApi.conversions({ status: status || undefined, siteId: siteId || undefined, page }), [status, siteId, page]);
  const canEdit = can('attribution.edit');

  async function move(row: ConversionRow, to: 'approved' | 'paid' | 'reversed') {
    if (to === 'reversed' && !window.confirm('Reverse this entry? The creator will not be paid for it.')) return;
    if (to === 'paid' && !window.confirm(`Mark ${formatMinor(row.commissionMinor, row.currency)} as paid to ${row.creator}? Do this after you've sent the money.`)) return;
    try {
      await adminApi.setConversionStatus(row.id, to);
      toast(`Marked ${to}`);
      list.reload();
      overview.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update');
    }
  }

  const o = overview.data;
  const currencies = o ? Object.keys(o.ledger) : [];

  return (
    <>
      <PageHeader title="Earnings" subtitle="Taps on Shop buttons, the sales shops report back, and what creators are owed. Review entries, then mark them paid once you've sent the money." />
      <Toolbar>
        <Select value={siteId} onChange={(e) => { setSiteId(e.target.value); setPage(1); }} aria-label="Site">
          <option value="">All sites</option>
          {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </Select>
      </Toolbar>

      {overview.loading && !o && <Spinner />}
      {overview.error && <ErrorState message={overview.error} onRetry={overview.reload} />}
      {o && (
        <div className="space-y-6 mb-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl bg-white/5 p-4"><div className="text-xs text-white/50">Shop taps</div><div className="text-2xl font-semibold text-white tabular-nums">{fmtNum(o.clicks)}</div></div>
            <div className="rounded-xl bg-white/5 p-4"><div className="text-xs text-white/50">Sales</div><div className="text-2xl font-semibold text-white tabular-nums">{fmtNum(o.conversions)}</div></div>
            <div className="rounded-xl bg-white/5 p-4"><div className="text-xs text-white/50">Tap → sale</div><div className="text-2xl font-semibold text-white tabular-nums">{o.clicks ? `${((o.conversions / o.clicks) * 100).toFixed(1)}%` : '—'}</div></div>
            <div className="rounded-xl bg-white/5 p-4">
              <div className="text-xs text-white/50">Sales value</div>
              {Object.keys(o.byCurrency).length === 0 ? <div className="text-2xl font-semibold text-white">—</div> : Object.entries(o.byCurrency).map(([c, v]) => <div key={c} className="text-lg font-semibold text-white tabular-nums">{formatMinor(v.revenueMinor, c)}</div>)}
            </div>
          </div>

          {currencies.length > 0 && (
            <div>
              <h2 className="text-white font-semibold mb-2">Owed to creators (all time)</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {currencies.map((c) => (['pending', 'approved', 'paid'] as const).map((k) => (
                  <div key={`${c}-${k}`} className="rounded-xl bg-white/5 p-3"><div className="text-xs text-white/50 capitalize">{k} · {c}</div><div className="text-lg font-semibold text-white tabular-nums">{formatMinor(o.ledger[c][k], c)}</div></div>
                )))}
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <div>
              <h2 className="text-white font-semibold mb-2">Most tapped videos</h2>
              {o.topVideos.length === 0 ? <p className="text-sm text-white/50">No taps in this period.</p> : (
                <ul className="divide-y divide-white/10 rounded-xl bg-white/5">
                  {o.topVideos.map((v) => <li key={v.videoId} className="flex justify-between gap-3 px-3 py-2 text-sm"><span className="truncate text-white">{v.title}</span><span className="tabular-nums text-white/60">{v.clicks}</span></li>)}
                </ul>
              )}
            </div>
            <div>
              <h2 className="text-white font-semibold mb-2">Top creators by sales</h2>
              {o.topCreators.length === 0 ? <p className="text-sm text-white/50">No sales in this period.</p> : (
                <ul className="divide-y divide-white/10 rounded-xl bg-white/5">
                  {o.topCreators.map((c, i) => <li key={i} className="flex justify-between gap-3 px-3 py-2 text-sm"><span className="truncate text-white">{c.creator}</span><span className="tabular-nums text-white/60">{c.conversions} · {formatMinor(c.revenueMinor, c.currency)}</span></li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <h2 className="text-white font-semibold mb-2">Ledger</h2>
      <Toolbar>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="paid">Paid</option>
          <option value="reversed">Reversed</option>
        </Select>
      </Toolbar>
      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.data && (list.data.conversions.length === 0 ? (
        <EmptyState title="No entries" hint="Sales appear here once a shop reports them (see docs/OPEN_SHOP_SPEC.md)." />
      ) : (
        <>
          <Table>
            <thead>
              <tr><Th>Date</Th><Th>Creator</Th><Th>Video</Th><Th>Shop · order</Th><Th>Sale</Th><Th>Commission</Th><Th>Status</Th>{canEdit && <Th className="text-right">Actions</Th>}</tr>
            </thead>
            <tbody>
              {list.data.conversions.map((r) => (
                <tr key={r.id}>
                  <Td>{fmtDate(r.createdAt)}</Td>
                  <Td><div className="text-white">{r.creator}</div>{r.creatorEmail && <div className="text-xs text-white/50">{r.creatorEmail}</div>}</Td>
                  <Td className="max-w-[14rem] truncate">{r.video}</Td>
                  <Td>{r.site} · <span className="text-white/60">{r.externalOrderId}</span></Td>
                  <Td className="tabular-nums">{formatMinor(r.amountMinor, r.currency)}</Td>
                  <Td className="tabular-nums">{formatMinor(r.commissionMinor, r.currency)}</Td>
                  <Td><Badge tone={TONE[r.status]}>{r.status}</Badge></Td>
                  {canEdit && (
                    <Td className="text-right whitespace-nowrap">
                      {r.status === 'pending' && <Button onClick={() => move(r, 'approved')}>Approve</Button>}{' '}
                      {r.status === 'approved' && <Button variant="primary" onClick={() => move(r, 'paid')}>Mark paid</Button>}{' '}
                      {(r.status === 'pending' || r.status === 'approved') && <Button onClick={() => move(r, 'reversed')}>Reverse</Button>}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={list.data.page} pages={Math.max(1, Math.ceil(list.data.total / list.data.pageSize))} total={list.data.total} limit={list.data.pageSize} onChange={setPage} />
        </>
      ))}
    </>
  );
}
