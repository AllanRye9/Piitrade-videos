import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../api';
import { mediaUrl } from '../config';
import type { AdminProduct } from '../types';

export default function ProductsTab() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    adminApi
      .listProducts()
      .then((res) => setProducts(res.products))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load products'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setFormError('Choose a product image.');
      return;
    }
    if (!name.trim() || !price.trim() || !category.trim()) {
      setFormError('Name, price, and category are all required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminApi.createProduct(name.trim(), price.trim(), category.trim(), file);
      setProducts((prev) => [res.product, ...prev]);
      setName('');
      setPrice('');
      setCategory('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add product');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this product from the visual search catalog?')) return;
    await adminApi.deleteProduct(id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className="bg-white/5 rounded-xl p-4 space-y-3">
        <p className="text-white text-sm font-semibold">Add product</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price (e.g. $19.99)"
            className="bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
          />
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category"
            className="bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
          />
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="text-white/70 text-xs" />
        {formError && <p className="text-red-400 text-sm">{formError}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="bg-brand-pink disabled:opacity-50 text-white font-semibold text-sm rounded-lg px-4 py-2"
        >
          {submitting ? 'Adding…' : 'Add product'}
        </button>
      </form>

      {loading && <p className="text-white/50 text-sm">Loading…</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {products.map((p) => (
            <div key={p.id} className="bg-white/5 rounded-lg overflow-hidden">
              <img src={mediaUrl(p.image)} alt={p.name} className="w-full aspect-square object-cover" />
              <div className="p-2">
                <p className="text-white text-xs font-medium truncate">{p.name}</p>
                <p className="text-white/50 text-[11px]">{p.price}</p>
                <p className="text-white/30 text-[10px]">{p.category}</p>
                <button onClick={() => handleDelete(p.id)} className="text-red-400 text-[11px] font-semibold mt-1">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
