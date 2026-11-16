import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { adminApi, CommentRecord } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useDebounced, useFetch } from '../hooks';
import { Badge, ConfirmDialog, EmptyState, ErrorState, Field, FormModal, IconButton, PageHeader, Pagination, SearchInput, Spinner, Table, Td, Th, Toolbar, fmtDateTime, inputCls, useToast } from '../ui';

export default function CommentsPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq]);
  const { data, loading, error, reload } = useFetch(() => adminApi.listComments({ q: dq, page, limit: 20 }), [dq, page]);
  const [editing, setEditing] = useState<CommentRecord | null>(null);
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState<CommentRecord | null>(null);

  return (
    <>
      <PageHeader title="Comments" subtitle="Review and moderate comments across all videos." />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search text or author…" />
      </Toolbar>

      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.comments.length === 0 ? (
        <EmptyState title="No comments found" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Comment</Th>
                <Th>Author</Th>
                <Th>On video</Th>
                <Th>Posted</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.comments.map((c) => (
                <tr key={c.id}>
                  <Td className="max-w-[360px]">
                    <p className="line-clamp-2 break-words">{c.text}</p>
                    {c.isReply && <Badge>Reply</Badge>}
                  </Td>
                  <Td>{c.author}</Td>
                  <Td className="max-w-[200px] truncate">{c.video?.title || '—'}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(c.createdAt)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {can('comments.edit') && (
                      <IconButton label="Edit" onClick={() => { setEditing(c); setText(c.text); }}>
                        <Pencil size={16} />
                      </IconButton>
                    )}
                    {can('comments.delete') && (
                      <IconButton label="Delete" danger onClick={() => setDeleting(c)}>
                        <Trash2 size={16} />
                      </IconButton>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onChange={setPage} />
        </>
      ))}

      {editing && (
        <FormModal
          title="Edit comment"
          onClose={() => setEditing(null)}
          onSubmit={async () => {
            await adminApi.updateComment(editing.id, text);
            toast('Comment updated');
            reload();
          }}
        >
          <Field label="Text">
            <textarea required rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} className={inputCls} />
          </Field>
        </FormModal>
      )}
      {deleting && (
        <ConfirmDialog
          danger
          title="Delete comment"
          confirmLabel="Delete"
          message={<>Delete this comment{!deleting.isReply && ' and all of its replies'}? This can’t be undone.</>}
          onConfirm={async () => {
            await adminApi.deleteComment(deleting.id);
            toast('Comment deleted');
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
