import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi, LocationRecord } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useDebounced, useFetch } from '../hooks';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, FormModal, IconButton, PageHeader, SearchInput, Spinner, Table, Td, Th, Toolbar, fmtDate, inputCls, useToast } from '../ui';

function LocationForm({ initial, onClose, onSaved }: { initial?: LocationRecord; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  return (
    <FormModal
      title={initial ? 'Edit location' : 'Add location'}
      onClose={onClose}
      onSubmit={async () => {
        const data = { name, country, city };
        if (initial) await adminApi.updateLocation(initial.id, data);
        else await adminApi.createLocation(data);
        toast(initial ? 'Location updated' : 'Location added');
        onSaved();
      }}
    >
      <Field label="Name" hint="Shown in pickers, e.g. “Abu Dhabi”">
        <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country">
          <input value={country} onChange={(e) => setCountry(e.target.value)} className={inputCls} maxLength={80} />
        </Field>
        <Field label="City">
          <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} maxLength={80} />
        </Field>
      </div>
    </FormModal>
  );
}

export default function LocationsPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useFetch(() => adminApi.listLocations(dq), [dq]);
  const [editing, setEditing] = useState<LocationRecord | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LocationRecord | null>(null);

  return (
    <>
      <PageHeader
        title="Locations"
        subtitle="Places you can tag videos and users with."
        actions={can('locations.create') && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add location
          </Button>
        )}
      />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search locations…" />
      </Toolbar>

      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.locations.length === 0 ? (
        <EmptyState title="No locations yet" hint="Add a location to start tagging videos and users." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Country</Th>
              <Th>City</Th>
              <Th>Videos</Th>
              <Th>Users</Th>
              <Th>Added</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {data.locations.map((l) => (
              <tr key={l.id}>
                <Td className="font-medium text-white">{l.name}</Td>
                <Td>{l.country || '—'}</Td>
                <Td>{l.city || '—'}</Td>
                <Td className="tabular-nums">{l.videoCount}</Td>
                <Td className="tabular-nums">{l.userCount}</Td>
                <Td>{fmtDate(l.createdAt)}</Td>
                <Td className="text-right whitespace-nowrap">
                  {can('locations.edit') && <IconButton label="Edit" onClick={() => setEditing(l)}><Pencil size={16} /></IconButton>}
                  {can('locations.delete') && <IconButton label="Delete" danger onClick={() => setDeleting(l)}><Trash2 size={16} /></IconButton>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ))}

      {editing && <LocationForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {deleting && (
        <ConfirmDialog
          danger
          title="Delete location"
          confirmLabel="Delete"
          message={<>Delete <b>{deleting.name}</b>? The {deleting.videoCount} video(s) and {deleting.userCount} user(s) using it will simply lose this tag.</>}
          onConfirm={async () => {
            await adminApi.deleteLocation(deleting.id);
            toast('Location deleted');
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
