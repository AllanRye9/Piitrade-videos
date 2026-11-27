import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi, ProductRecord } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useDebounced, useFetch } from '../hooks';
import { mediaUrl } from '../../lib/config';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FormModal, IconButton, PageHeader, SearchInput, Spinner, Toolbar, inputCls, useToast } from '../ui';

function ProductForm({ initial, onClose, onSaved }: { initial?: ProductRecord; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial?.price ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [image, setImage] = useState<File | null>(null);
  const preview = image ? URL.createObjectURL(image) : initial ? mediaUrl(initial.image) : undefined;

  return (
    <FormModal
      title={initial ? 'Edit product' : 'Add product'}
      onClose={onClose}
      onSubmit={async () => {
        if (initial) await adminApi.updateProduct(initial.id, { name, price, category, image });
        else {
          if (!image) throw new Error('A product image is required');
          await adminApi.createProduct({ name, price, category, image });
        }
        toast(initial ? 'Product updated' : 'Product added');
        onSaved();
      }}
    >
      <Field label="Name">
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={200} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price">
          <input required value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} maxLength={40} />
        </Field>
        <Field label="Category">
          <input required value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} maxLength={80} />
        </Field>
      </div>
      <Field label="Image" hint={initial ? 'Leave empty to keep the current image' : 'Used for visual search matching'}>
        <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="block w-full text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white file:text-sm" />
      </Field>
      {preview && <img src={preview} alt="" className="h-32 rounded-lg object-cover bg-white/5" />}
    </FormModal>
  );
}

export default function ProductsPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useFetch(() => adminApi.listProducts(dq), [dq]);
  const [editing, setEditing] = useState<ProductRecord | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProductRecord | null>(null);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="The catalogue used by visual search."
        actions={can('products.create') && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add product
          </Button>
        )}
      />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search name or category…" />
      </Toolbar>
      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.products.length === 0 ? (
        <EmptyState title="No products" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {data.products.map((p) => (
            <Card key={p.id} className="overflow-hidden flex flex-col">
              <img src={mediaUrl(p.image)} alt={p.name} className="aspect-square w-full object-cover bg-white/5" loading="lazy" />
              <div className="p-3 flex-1 flex flex-col gap-1">
                <p className="text-white text-sm font-semibold truncate" title={p.name}>{p.name}</p>
                <p className="text-brand-amber text-sm">{p.price}</p>
                <div><Badge>{p.category}</Badge></div>
                <div className="mt-auto pt-2 flex justify-end">
                  {can('products.edit') && <IconButton label="Edit" onClick={() => setEditing(p)}><Pencil size={16} /></IconButton>}
                  {can('products.delete') && <IconButton label="Delete" danger onClick={() => setDeleting(p)}><Trash2 size={16} /></IconButton>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ))}

      {editing && <ProductForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {deleting && (
        <ConfirmDialog
          danger
          title="Delete product"
          confirmLabel="Delete"
          message={<>Delete <b>{deleting.name}</b>? This can’t be undone.</>}
          onConfirm={async () => {
            await adminApi.deleteProduct(deleting.id);
            toast('Product deleted');
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
