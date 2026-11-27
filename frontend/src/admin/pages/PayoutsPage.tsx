import { useEffect, useState } from 'react';
import { adminApi, PayoutRecord, PayoutStatus } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useFetch } from '../hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, Select, Spinner, Table, Td, Th, Toolbar, fmtDateTime, useToast } from '../ui';

// Mirrors backend/src/lib/shops/attribution.ts — the server enforces it; this only decides which buttons to show.
const NEXT: Record<PayoutStatus, PayoutStatus[]> = { pending: ['approved', 'reversed'], approved: ['paid', 'reversed'], paid: ['reversed'], reversed: [] };
const LABEL: Record<PayoutStatus, string> = { pending: 'Pending', approved: 'Approved', paid: 'Paid', reversed: 'Reversed' };
const TONE: Record<PayoutStatus, 'amber' | 'blue' | 'green' | 'red'> = { pending: 'amber', approved: 'blue', paid: 'green', reversed: 'red' };
const VERB: Record<PayoutStatus, string> = { pending: 'Reopen', approved: 'Approve', paid: 'Mark paid', reversed: 'Reverse' };

export default function PayoutsPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status]);
  const { data, loading, error, reload } = useFetch(() => adminApi.listPayouts({ status, page, limit: 25 }), [status, page]);
  const [pending, setPending] = useState<{ entry: PayoutRecord; to: PayoutStatus } | null>(null);

  return (
    <>
      <PageHeader title="Payouts" subtitle="What creators are owed. This is a ledger: mark entries paid after you’ve sent the money." />
      <Toolbar>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {(Object.keys(LABEL) as PayoutStatus[]).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
        </Select>
      </Toolbar>
      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.entries.length === 0 ? (
        <EmptyState title="No payout entries" hint="Entries appear when a shop reports a sale that came from a creator’s video." />
      ) : (
        <>
          <Table>
            <thead>
              <tr><Th>Creator</Th><Th>Amount</Th><Th>Order</Th><Th>Video</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <Td className="text-white font-medium">@{e.creator}</Td>
                  <Td className="tabular-nums whitespace-nowrap">{e.currency} {e.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Td>
                  <Td><p className="text-white/85 text-xs">{e.site} · {e.orderId}</p><p className="text-white/40 text-xs">{e.currency} {e.orderAmount.toLocaleString()}</p></Td>
                  <Td className="max-w-[200px] truncate">{e.videoTitle || <span className="text-white/35">—</span>}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</Td>
                  <Td><Badge tone={TONE[e.status]}>{LABEL[e.status]}</Badge></Td>
                  <Td className="text-right whitespace-nowrap">
                    {can('payouts.manage') && NEXT[e.status].map((to) => (
                      <Button key={to} size="sm" variant={to === 'reversed' ? 'danger' : 'secondary'} className="ml-1.5" onClick={() => setPending({ entry: e, to })}>{VERB[to]}</Button>
                    ))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onChange={setPage} />
        </>
      ))}
      {pending && (
        <ConfirmDialog
          danger={pending.to === 'reversed'}
          title={`${VERB[pending.to]} payout`}
          confirmLabel={VERB[pending.to]}
          message={<>{VERB[pending.to]} <b>{pending.entry.currency} {pending.entry.amount.toLocaleString()}</b> for <b>@{pending.entry.creator}</b>?{pending.to === 'paid' && ' Only do this after the money has actually been sent.'}</>}
          onConfirm={async () => {
            await adminApi.setPayoutStatus(pending.entry.id, pending.to);
            toast(`Marked ${LABEL[pending.to].toLowerCase()}`);
            reload();
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
