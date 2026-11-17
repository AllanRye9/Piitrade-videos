import { useState } from 'react';
import { Ban, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi, AdminRecord, ResourceDef } from '../adminApi';
import { useFetch } from '../hooks';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, FormModal, IconButton, PageHeader, Spinner, Table, Td, Th, cx, fmtDateTime, inputCls, useToast } from '../ui';

const ACTIONS = ['view', 'create', 'edit', 'delete'] as const;

/** Resource × action grid. Ticking edit/create/delete also ticks view (the server enforces the same rule). */
function PermissionMatrix({ resources, value, onChange }: { resources: ResourceDef[]; value: string[]; onChange: (v: string[]) => void }) {
  const set = new Set(value);
  const all = resources.flatMap((r) => r.actions.map((a) => `${r.key}.${a}`));

  function toggle(res: string, action: string) {
    const next = new Set(set);
    const key = `${res}.${action}`;
    if (next.has(key)) {
      next.delete(key);
      if (action === 'view') ACTIONS.forEach((a) => next.delete(`${res}.${a}`)); // no view → no anything
    } else {
      next.add(key);
      next.add(`${res}.view`);
    }
    onChange([...next]);
  }

  function toggleRow(r: ResourceDef) {
    const keys = r.actions.map((a) => `${r.key}.${a}`);
    const full = keys.every((k) => set.has(k));
    const next = new Set(set);
    keys.forEach((k) => (full ? next.delete(k) : next.add(k)));
    onChange([...next]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        <Button size="sm" onClick={() => onChange(all)}>Full access</Button>
        <Button size="sm" onClick={() => onChange(all.filter((p) => p.endsWith('.view')))}>Read-only</Button>
        <Button size="sm" onClick={() => onChange([])}>None</Button>
      </div>
      <div className="border border-white/10 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/[0.03] text-white/45 text-[11px] uppercase tracking-wide">
              <th className="text-left px-3 py-2">Section</th>
              {ACTIONS.map((a) => <th key={a} className="px-3 py-2 capitalize">{a}</th>)}
              <th className="px-3 py-2">All</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.key} className="border-t border-white/5">
                <td className="px-3 py-2 text-white/85">{r.label}</td>
                {ACTIONS.map((a) => (
                  <td key={a} className="px-3 py-2 text-center">
                    {r.actions.includes(a) ? (
                      <input type="checkbox" aria-label={`${r.label} ${a}`} checked={set.has(`${r.key}.${a}`)} onChange={() => toggle(r.key, a)} className="w-4 h-4 accent-brand-orange" />
                    ) : (
                      <span className="text-white/15">—</span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" aria-label={`${r.label} all`} checked={r.actions.every((a) => set.has(`${r.key}.${a}`))} onChange={() => toggleRow(r)} className="w-4 h-4 accent-brand-orange" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-white/35 text-[11px] mt-2">Admin management and the activity log are always primary-admin only.</p>
    </div>
  );
}

function AdminForm({ initial, resources, onClose, onSaved }: { initial?: AdminRecord; resources: ResourceDef[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [permissions, setPermissions] = useState<string[]>(initial?.permissions ?? []);

  return (
    <FormModal
      size="lg"
      title={initial ? 'Edit admin' : 'Add secondary admin'}
      submitLabel={initial ? 'Save changes' : 'Create admin'}
      onClose={onClose}
      onSubmit={async () => {
        if (initial) await adminApi.updateAdmin(initial.id, { name, email, permissions, ...(password ? { password } : {}) });
        else await adminApi.createAdmin({ name, email, password, permissions });
        toast(initial ? 'Admin updated' : 'Admin created');
        onSaved();
      }}
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} />
        </Field>
        <Field label="Email">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field label={initial ? 'Reset password' : 'Temporary password'} hint={initial ? 'Leave empty to keep the current password' : 'At least 8 characters — share it with them; they can change it under My account'}>
        <input type="password" required={!initial} minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
      </Field>
      <div>
        <p className="text-white/70 text-xs font-medium mb-1.5">Permissions</p>
        <PermissionMatrix resources={resources} value={permissions} onChange={setPermissions} />
      </div>
    </FormModal>
  );
}

export default function AdminsPage() {
  const toast = useToast();
  const admins = useFetch(() => adminApi.listAdmins(), []);
  const catalog = useFetch(() => adminApi.permissionCatalog(), []);
  const [editing, setEditing] = useState<AdminRecord | 'new' | null>(null);
  const [toggling, setToggling] = useState<AdminRecord | null>(null);
  const [deleting, setDeleting] = useState<AdminRecord | null>(null);

  const resources = catalog.data?.resources ?? [];
  const total = resources.reduce((n, r) => n + r.actions.length, 0);

  return (
    <>
      <PageHeader
        title="Admins & roles"
        subtitle="You’re the primary admin. Create secondary admins and choose exactly what each one can do."
        actions={
          <Button variant="primary" disabled={!resources.length} onClick={() => setEditing('new')}>
            <Plus size={16} /> Add admin
          </Button>
        }
      />
      {(admins.loading && !admins.data) && <Spinner />}
      {admins.error && <ErrorState message={admins.error} onRetry={admins.reload} />}
      {admins.data && (
        <Table>
          <thead>
            <tr>
              <Th>Admin</Th>
              <Th>Role</Th>
              <Th>Access</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {admins.data.admins.map((a) => {
              const primary = a.role === 'PRIMARY';
              return (
                <tr key={a.id}>
                  <Td>
                    <p className="text-white font-medium">{a.name || a.email}</p>
                    {a.name && <p className="text-white/40 text-xs">{a.email}</p>}
                  </Td>
                  <Td><Badge tone={primary ? 'orange' : 'blue'}>{primary ? 'Primary' : 'Secondary'}</Badge></Td>
                  <Td className="text-white/70">{primary ? 'Full control' : `${a.permissions.length} of ${total || '…'} permissions`}</Td>
                  <Td><Badge tone={a.disabled ? 'red' : 'green'}>{a.disabled ? 'Disabled' : 'Active'}</Badge></Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(a.lastLoginAt)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {!primary && (
                      <>
                        <IconButton label="Edit & permissions" onClick={() => setEditing(a)}><Pencil size={16} /></IconButton>
                        <IconButton label={a.disabled ? 'Enable' : 'Disable'} onClick={() => setToggling(a)}>{a.disabled ? <CheckCircle2 size={16} /> : <Ban size={16} />}</IconButton>
                        <IconButton label="Delete" danger onClick={() => setDeleting(a)}><Trash2 size={16} /></IconButton>
                      </>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {admins.data && admins.data.admins.length === 1 && (
        <Card className={cx('mt-4 p-4 text-sm text-white/55')}>You haven’t added any secondary admins yet. Use “Add admin” to create one and pick which sections they can view, create, edit or delete.</Card>
      )}

      {editing && <AdminForm initial={editing === 'new' ? undefined : editing} resources={resources} onClose={() => setEditing(null)} onSaved={admins.reload} />}
      {toggling && (
        <ConfirmDialog
          danger={!toggling.disabled}
          title={toggling.disabled ? 'Enable admin' : 'Disable admin'}
          confirmLabel={toggling.disabled ? 'Enable' : 'Disable'}
          message={toggling.disabled ? <>Let <b>{toggling.email}</b> sign in again?</> : <><b>{toggling.email}</b> will be signed out immediately and can’t sign in until re-enabled.</>}
          onConfirm={async () => {
            await adminApi.updateAdmin(toggling.id, { disabled: !toggling.disabled });
            toast(toggling.disabled ? 'Admin enabled' : 'Admin disabled');
            admins.reload();
          }}
          onClose={() => setToggling(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          danger
          title="Delete admin"
          confirmLabel="Delete"
          message={<>Permanently delete the admin account <b>{deleting.email}</b>?</>}
          onConfirm={async () => {
            await adminApi.deleteAdmin(deleting.id);
            toast('Admin deleted');
            admins.reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
