import { useEffect, useState } from 'react';
import { adminApi } from '../adminApi';
import { useDebounced, useFetch } from '../hooks';
import { Badge, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Spinner, Table, Td, Th, Toolbar, fmtDateTime } from '../ui';

const tone = (action: string) => (action.endsWith('.delete') ? 'red' : action.endsWith('.create') ? 'green' : action.includes('suspend') ? 'amber' : 'blue');

export default function ActivityPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq]);
  const { data, loading, error, reload } = useFetch(() => adminApi.listAudit({ q: dq, page, limit: 30 }), [dq, page]);

  return (
    <>
      <PageHeader title="Activity log" subtitle="Everything admins have changed. Only the primary admin can see this." />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search admin, action or detail…" />
      </Toolbar>
      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.entries.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Admin</Th>
                <Th>Action</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</Td>
                  <Td>{e.adminEmail}</Td>
                  <Td>
                    <Badge tone={tone(e.action)}>{e.action}</Badge>
                  </Td>
                  <Td className="max-w-[420px] truncate text-white/60">{e.detail || e.targetId || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onChange={setPage} />
        </>
      ))}
    </>
  );
}
