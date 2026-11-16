import { useEffect, useState } from 'react';
import { Ban, CheckCircle2, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminApi, UserRecord } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useDebounced, useFetch } from '../hooks';
import { mediaUrl } from '../../config';
import { ADMIN_BASE } from '../paths';
import { LocationSelect, MiniAvatar } from '../shared';
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, FormModal, IconButton, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Td, Th, Toolbar, fmtDate, fmtNum, inputCls, useToast,
} from '../ui';

function UserForm({ initial, onClose, onSaved }: { initial?: UserRecord; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [handle, setHandle] = useState(initial?.handle ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [locationId, setLocationId] = useState(initial?.locationId ?? '');

  return (
    <FormModal
      title={initial ? 'Edit user' : 'Add user'}
      onClose={onClose}
      onSubmit={async () => {
        if (initial) {
          await adminApi.updateUser(initial.id, { email, displayName, handle: handle || undefined, bio, locationId: locationId || null, ...(password ? { password } : {}) });
        } else {
          await adminApi.createUser({ email, password, displayName, handle, bio, locationId: locationId || null });
        }
        toast(initial ? 'User updated' : 'User created');
        onSaved();
      }}
    >
      <Field label="Email">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
      </Field>
      <Field label={initial ? 'New password' : 'Password'} hint={initial ? 'Leave empty to keep the current password' : 'At least 8 characters'}>
        <input type="password" required={!initial} minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Display name">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} className={inputCls} />
        </Field>
        <Field label="Handle" hint="Lowercase letters, numbers, hyphens">
          <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} maxLength={30} placeholder={initial ? '' : 'auto-generated'} className={inputCls} />
        </Field>
      </div>
      <Field label="Bio">
        <textarea rows={2} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} className={inputCls} />
      </Field>
      <Field label="Location">
        <LocationSelect form value={locationId} onChange={setLocationId} />
      </Field>
    </FormModal>
  );
}

function UserDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useFetch(() => adminApi.getUser(id), [id]);
  const u = data?.user;
  return (
    <Modal title="User details" onClose={onClose} size="lg">
      {loading && <Spinner />}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {u && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <MiniAvatar src={mediaUrl(u.avatar)} name={u.displayName || u.handle || u.email} size={56} />
            <div className="min-w-0">
              <p className="text-white font-semibold truncate">{u.displayName || u.handle || u.email}</p>
              <p className="text-white/50 text-sm truncate">{u.handle ? `@${u.handle} · ` : ''}{u.email}</p>
            </div>
            <div className="ml-auto"><Badge tone={u.status === 'active' ? 'green' : 'red'}>{u.status === 'active' ? 'Active' : 'Suspended'}</Badge></div>
          </div>
          {u.bio && <p className="text-white/70 text-sm">{u.bio}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[['Videos', u.videoCount ?? 0], ['Comments', u.commentCount], ['Followers', u.followers], ['Following', u.following]].map(([l, v]) => (
              <div key={l as string} className="bg-white/5 rounded-lg py-2">
                <p className="text-white font-bold tabular-nums">{fmtNum(v as number)}</p>
                <p className="text-white/40 text-[11px]">{l}</p>
              </div>
            ))}
          </div>
          <dl className="text-sm grid grid-cols-[110px_1fr] gap-y-1.5 text-white/75">
            <dt className="text-white/40">Location</dt><dd>{u.location?.name ?? '—'}</dd>
            <dt className="text-white/40">Joined</dt><dd>{fmtDate(u.createdAt)}</dd>
            {u.suspendedAt && (<><dt className="text-white/40">Suspended</dt><dd>{fmtDate(u.suspendedAt)}</dd></>)}
          </dl>
          {u.recentVideos.length > 0 && (
            <div>
              <h3 className="text-white text-sm font-semibold mb-2">Recent videos</h3>
              <ul className="space-y-1.5">
                {u.recentVideos.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2">
                    <span className="w-8 h-11 rounded bg-white/10 overflow-hidden shrink-0">{v.poster && <img src={mediaUrl(v.poster)} alt="" className="w-full h-full object-cover" />}</span>
                    <span className="flex-1 min-w-0 truncate text-sm text-white/85">{v.title || 'Untitled'}</span>
                    <span className="text-white/40 text-xs tabular-nums">{fmtNum(v.views)} views</span>
                  </li>
                ))}
              </ul>
              <Link to={`${ADMIN_BASE}/videos`} className="text-brand-amber text-xs mt-2 inline-block" onClick={onClose}>Open Videos →</Link>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function UsersPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [locationId, setLocationId] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, status, locationId]);
  const { data, loading, error, reload } = useFetch(() => adminApi.listUsers({ q: dq, status, locationId, page, limit: 20 }), [dq, status, locationId, page]);

  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserRecord | 'new' | null>(null);
  const [toggling, setToggling] = useState<UserRecord | null>(null);
  const [deleting, setDeleting] = useState<UserRecord | null>(null);
  const [deleteContent, setDeleteContent] = useState(false);

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Registered viewer and creator accounts."
        actions={can('users.create') && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add user
          </Button>
        )}
      />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search email, handle or name…" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
        <LocationSelect value={locationId} onChange={setLocationId} allLabel="All locations" />
      </Toolbar>

      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.users.length === 0 ? (
        <EmptyState title="No users found" hint="Try different filters." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Email</Th>
                <Th>Location</Th>
                <Th>Videos</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <button className="flex items-center gap-3 text-left" onClick={() => setViewing(u.id)}>
                      <MiniAvatar src={mediaUrl(u.avatar)} name={u.displayName || u.handle || u.email} />
                      <span className="min-w-0">
                        <span className="block text-white font-medium truncate max-w-[180px] hover:underline">{u.displayName || u.handle || '—'}</span>
                        {u.handle && <span className="block text-white/40 text-xs truncate">@{u.handle}</span>}
                      </span>
                    </button>
                  </Td>
                  <Td className="max-w-[220px] truncate">{u.email}</Td>
                  <Td>{u.location?.name ?? <span className="text-white/35">—</span>}</Td>
                  <Td className="tabular-nums">{u.videoCount ?? 0}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(u.createdAt)}</Td>
                  <Td><Badge tone={u.status === 'active' ? 'green' : 'red'}>{u.status === 'active' ? 'Active' : 'Suspended'}</Badge></Td>
                  <Td className="text-right whitespace-nowrap">
                    <IconButton label="View details" onClick={() => setViewing(u.id)}><Eye size={16} /></IconButton>
                    {can('users.edit') && <IconButton label="Edit" onClick={() => setEditing(u)}><Pencil size={16} /></IconButton>}
                    {can('users.edit') && (
                      <IconButton label={u.status === 'active' ? 'Suspend' : 'Unsuspend'} onClick={() => setToggling(u)}>
                        {u.status === 'active' ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                      </IconButton>
                    )}
                    {can('users.delete') && <IconButton label="Delete" danger onClick={() => { setDeleteContent(false); setDeleting(u); }}><Trash2 size={16} /></IconButton>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onChange={setPage} />
        </>
      ))}

      {viewing && <UserDetailModal id={viewing} onClose={() => setViewing(null)} />}
      {editing && <UserForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {toggling && (
        <ConfirmDialog
          danger={toggling.status === 'active'}
          title={toggling.status === 'active' ? 'Suspend user' : 'Unsuspend user'}
          confirmLabel={toggling.status === 'active' ? 'Suspend' : 'Unsuspend'}
          message={
            toggling.status === 'active' ? (
              <><b>{toggling.email}</b> will be unable to sign in or post, like, comment or upload. Their content stays visible.</>
            ) : (
              <>Restore access for <b>{toggling.email}</b>?</>
            )
          }
          onConfirm={async () => {
            if (toggling.status === 'active') await adminApi.suspendUser(toggling.id);
            else await adminApi.unsuspendUser(toggling.id);
            toast(toggling.status === 'active' ? 'User suspended' : 'User unsuspended');
            reload();
          }}
          onClose={() => setToggling(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          danger
          title="Delete user"
          confirmLabel="Delete user"
          message={<>Permanently delete the account <b>{deleting.email}</b>? This can’t be undone.</>}
          onConfirm={async () => {
            await adminApi.deleteUser(deleting.id, deleteContent);
            toast('User deleted');
            reload();
          }}
          onClose={() => setDeleting(null)}
        >
          <label className="flex items-start gap-2 mt-4 text-sm text-white/75 select-none">
            <input type="checkbox" checked={deleteContent} onChange={(e) => setDeleteContent(e.target.checked)} className="mt-0.5 accent-brand-orange" />
            <span>Also delete their {deleting.videoCount ?? 0} video(s), comments, follows and profile (otherwise their content stays online under their handle).</span>
          </label>
        </ConfirmDialog>
      )}
    </>
  );
}
