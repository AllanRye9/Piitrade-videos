import { useState } from 'react';
import { CheckCircle2, Plug, XCircle } from 'lucide-react';
import { adminApi, PartnerApplicationRecord, SiteTestResult } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useFetch } from '../hooks';
import { Badge, Button, EmptyState, ErrorState, Field, FormModal, Modal, PageHeader, Select, Spinner, Table, Td, Th, fmtDateTime, inputCls, useToast } from '../ui';

const TONE = { pending: 'amber', approved: 'green', rejected: 'red' } as const;

function ReviewModal({ app, onClose, onDone }: { app: PartnerApplicationRecord; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { can } = useAdminAuth();
  const [commission, setCommission] = useState('5');
  const [note, setNote] = useState('');
  const [check, setCheck] = useState<SiteTestResult | null>(null);
  const [checking, setChecking] = useState(false);
  const v = check ?? app.verification;

  async function recheck() {
    setChecking(true);
    try {
      setCheck(await adminApi.recheckPartnerApplication(app.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Check failed', 'error');
    } finally {
      setChecking(false);
    }
  }

  const pending = app.status === 'pending';
  return (
    <FormModal
      title={`Application · ${app.name}`}
      size="lg"
      onClose={onClose}
      submitLabel={pending ? 'Approve & connect' : 'Close'}
      onSubmit={async () => {
        if (!pending) return onClose();
        await adminApi.approvePartnerApplication(app.id, Number(commission), note);
        toast('Partner approved — the shop is now connected');
        onDone();
      }}
    >
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div><dt className="text-white/40 text-xs">Website</dt><dd className="text-white break-all">{app.baseUrl}</dd></div>
        <div><dt className="text-white/40 text-xs">Listing API</dt><dd className="text-white break-all">{app.apiBase}</dd></div>
        <div><dt className="text-white/40 text-xs">Contact</dt><dd className="text-white break-all">{app.contactName ? `${app.contactName} · ` : ''}{app.contactEmail}</dd></div>
        <div><dt className="text-white/40 text-xs">Market</dt><dd className="text-white">{app.country || '—'} · {app.currency || '—'}</dd></div>
      </dl>
      {app.notes && <p className="text-white/70 text-sm bg-white/5 rounded-lg p-3 whitespace-pre-wrap">{app.notes}</p>}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {v?.ok ? <CheckCircle2 className="text-emerald-400" size={18} /> : <XCircle className="text-red-400" size={18} />}
          <span className="text-white text-sm font-semibold">Listing API {v?.ok ? 'passes the spec' : 'does not pass'}</span>
          <Button type="button" onClick={recheck} disabled={checking} className="ml-auto"><Plug size={14} /> {checking ? 'Checking…' : 'Re-check now'}</Button>
        </div>
        <ul className="space-y-1">
          {(v?.issues ?? []).map((i, n) => (
            <li key={n} className="flex gap-2 text-sm"><Badge tone={i.level === 'error' ? 'red' : 'amber'}>{i.level}</Badge><span className="text-white/80">{i.message}</span></li>
          ))}
        </ul>
      </div>

      {pending ? (
        <>
          <Field label="Commission %" hint="Of each attributed order, owed to the creator whose video sent the buyer. Editable later in Shops.">
            <input type="number" min={0} max={100} step="0.1" value={commission} onChange={(e) => setCommission(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Note to the applicant (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputCls} />
          </Field>
          {can('sites.edit') && (
            <button
              type="button"
              className="text-red-300 text-sm underline"
              onClick={async () => {
                try {
                  await adminApi.rejectPartnerApplication(app.id, note);
                  toast('Application rejected');
                  onDone();
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Failed', 'error');
                }
              }}
            >
              Reject this application{note ? ' with the note above' : ''}
            </button>
          )}
        </>
      ) : (
        app.reviewNote && <p className="text-white/60 text-sm">Review note: {app.reviewNote}</p>
      )}
    </FormModal>
  );
}

export default function PartnerApplicationsPage() {
  const [status, setStatus] = useState('pending');
  const { data, loading, error, reload } = useFetch(() => adminApi.listPartnerApplications(status), [status]);
  const [open, setOpen] = useState<PartnerApplicationRecord | null>(null);

  return (
    <>
      <PageHeader
        title="Partner applications"
        subtitle="Shops that applied with their own listing API. Their API has already been checked against the open spec."
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="pending">Waiting for review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </Select>
        }
      />
      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.applications.length === 0 ? (
        <EmptyState title="Nothing here" hint="Shops apply at /partners. Share that link with anyone who wants their products promoted." />
      ) : (
        <Table>
          <thead>
            <tr><Th>Shop</Th><Th>Contact</Th><Th>API check</Th><Th>Applied</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr>
          </thead>
          <tbody>
            {data.applications.map((a) => (
              <tr key={a.id}>
                <Td><p className="text-white font-medium">{a.name}</p><p className="text-white/40 text-xs truncate max-w-[220px]">{a.baseUrl}</p></Td>
                <Td><span className="text-white/70 text-xs break-all">{a.contactEmail}</span></Td>
                <Td>{a.verification?.ok ? <Badge tone="green">Passed</Badge> : <Badge tone="red">Failing</Badge>}</Td>
                <Td className="text-white/50 text-xs whitespace-nowrap">{fmtDateTime(a.createdAt)}</Td>
                <Td><Badge tone={TONE[a.status]}>{a.status}</Badge></Td>
                <Td className="text-right"><Button onClick={() => setOpen(a)}>{a.status === 'pending' ? 'Review' : 'View'}</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ))}
      {open && <ReviewModal app={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />}
    </>
  );
}
