import { useEffect, useState } from 'react';
import { Pencil, Play, Trash2 } from 'lucide-react';
import { adminApi, ProductPin, VideoRecord } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useDebounced, useFetch } from '../hooks';
import { mediaUrl } from '../../config';
import { LocationSelect, formatDuration } from '../shared';
import {
  Badge, ConfirmDialog, EmptyState, ErrorState, Field, FormModal, IconButton, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Td, Th, Toolbar, fmtDate, fmtNum, inputCls, useToast,
} from '../ui';

function VideoDetail({ video, onClose }: { video: VideoRecord; onClose: () => void }) {
  const { can } = useAdminAuth();
  const toast = useToast();
  const comments = useFetch(() => (can('comments.view') ? adminApi.videoComments(video.id) : Promise.resolve({ comments: [] })), [video.id]);
  const [deleting, setDeleting] = useState<string | null>(null);

  return (
    <Modal title={video.title || 'Untitled video'} onClose={onClose} size="xl">
      <div className="grid md:grid-cols-[260px_1fr] gap-5">
        <div>
          <video src={mediaUrl(video.url)} poster={mediaUrl(video.poster)} controls playsInline className="w-full max-h-[60dvh] bg-black rounded-lg object-contain" />
        </div>
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[['Views', video.views], ['Likes', video.likes], ['Comments', video.comments], ['Shares', video.shares]].map(([l, v]) => (
              <div key={l as string} className="bg-white/5 rounded-lg py-2">
                <p className="text-white font-bold tabular-nums">{fmtNum(v as number)}</p>
                <p className="text-white/40 text-[11px]">{l}</p>
              </div>
            ))}
          </div>
          <dl className="text-sm grid grid-cols-[110px_1fr] gap-y-1.5 text-white/75">
            <dt className="text-white/40">Uploader</dt><dd>{video.uploader?.handle ? `@${video.uploader.handle}` : '—'}</dd>
            <dt className="text-white/40">Location</dt><dd>{video.location?.name ?? '—'}</dd>
            <dt className="text-white/40">Duration</dt><dd>{formatDuration(video.duration)}</dd>
            <dt className="text-white/40">Uploaded</dt><dd>{fmtDate(video.createdAt)}</dd>
            <dt className="text-white/40">Description</dt><dd className="whitespace-pre-wrap break-words">{video.description || '—'}</dd>
          </dl>
          {can('comments.view') && (
            <div>
              <h3 className="text-white text-sm font-semibold mb-2">Comments</h3>
              {comments.loading && <p className="text-white/40 text-sm">Loading…</p>}
              {comments.data && comments.data.comments.length === 0 && <p className="text-white/40 text-sm">No comments.</p>}
              <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {comments.data?.comments.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 bg-white/5 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-white/50 text-[11px]">{c.author} · {fmtDate(c.createdAt)}</p>
                      <p className="text-white/85 text-sm break-words">{c.text}</p>
                    </div>
                    {can('comments.delete') && (
                      <IconButton label="Delete comment" danger onClick={() => setDeleting(c.id)}>
                        <Trash2 size={15} />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          danger
          title="Delete comment"
          confirmLabel="Delete"
          message="Delete this comment and any replies?"
          onConfirm={async () => {
            await adminApi.deleteComment(deleting);
            toast('Comment deleted');
            comments.reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </Modal>
  );
}

/** Pinned shop products: each can be limited to a time window of the video. Times are edited in seconds. */
function ProductsEditor({ value, onChange }: { value: ProductPin[]; onChange: (v: ProductPin[]) => void }) {
  const set = (i: number, patch: Partial<ProductPin>) => onChange(value.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const sec = (ms: number | null) => (ms === null ? '' : String(Math.round(ms / 100) / 10));
  const ms = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 1000));
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-white/40 text-xs">No products pinned. Add a link to a connected shop’s product.</p>}
      {value.map((p, i) => (
        <div key={i} className="rounded-lg border border-white/10 p-2.5 space-y-2">
          <div className="flex gap-2">
            <input value={p.url} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://shop.example.com/listings/123" className={inputCls} aria-label="Product link" />
            <IconButton label="Remove product" danger onClick={() => onChange(value.filter((_, n) => n !== i))}><Trash2 size={16} /></IconButton>
          </div>
          <div className="grid grid-cols-[1fr_80px_80px] gap-x-2 gap-y-0.5">
            <span className="text-[10px] uppercase tracking-wide text-white/35">Label</span><span className="text-[10px] uppercase tracking-wide text-white/35">From (s)</span><span className="text-[10px] uppercase tracking-wide text-white/35">To (s)</span>
            <input value={p.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="Label (optional)" className={inputCls} maxLength={120} aria-label="Label" />
            <input value={sec(p.startMs)} onChange={(e) => set(i, { startMs: ms(e.target.value) ?? 0 })} placeholder="From s" inputMode="decimal" className={inputCls} aria-label="From (seconds)" />
            <input value={sec(p.endMs)} onChange={(e) => set(i, { endMs: ms(e.target.value) })} placeholder="To s" inputMode="decimal" className={inputCls} aria-label="To (seconds)" />
          </div>
        </div>
      ))}
      {value.length < 8 && (
        <button type="button" onClick={() => onChange([...value, { url: '', title: '', startMs: 0, endMs: null }])} className="text-brand-amber text-sm font-semibold">+ Add product</button>
      )}
    </div>
  );
}

function EditVideo({ video, onClose, onSaved }: { video: VideoRecord; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [locationId, setLocationId] = useState(video.locationId ?? '');
  const [products, setProducts] = useState<ProductPin[] | null>(null);
  useEffect(() => {
    adminApi.getVideoProducts(video.id).then((r) => setProducts(r.products)).catch(() => setProducts([]));
  }, [video.id]);
  return (
    <FormModal
      title="Edit video"
      size="lg"
      onClose={onClose}
      onSubmit={async () => {
        await adminApi.updateVideo(video.id, { title, description, locationId: locationId || null });
        if (products) await adminApi.setVideoProducts(video.id, products.filter((p) => p.url.trim()));
        toast('Video updated');
        onSaved();
      }}
    >
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputCls} />
      </Field>
      <Field label="Description" hint="#hashtags are re-detected automatically">
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} className={inputCls} />
      </Field>
      <Field label="Location">
        <LocationSelect form value={locationId} onChange={setLocationId} />
      </Field>
      <div>
        <p className="text-white/70 text-xs font-medium mb-1.5">Shop products</p>
        {products === null ? <p className="text-white/40 text-xs">Loading…</p> : <ProductsEditor value={products} onChange={setProducts} />}
      </div>
    </FormModal>
  );
}

export default function VideosPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');
  const [locationId, setLocationId] = useState('');
  const [reported, setReported] = useState(false);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, sort, locationId, reported]);
  const { data, loading, error, reload } = useFetch(() => adminApi.listVideos({ q: dq, sort, locationId, reported, page, limit: 15 }), [dq, sort, locationId, reported, page]);

  const [viewing, setViewing] = useState<VideoRecord | null>(null);
  const [editing, setEditing] = useState<VideoRecord | null>(null);
  const [deleting, setDeleting] = useState<VideoRecord | null>(null);

  return (
    <>
      <PageHeader title="Videos" subtitle="Browse, edit and remove uploaded videos. New videos are uploaded from the app." />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search title or description…" />
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="views">Most viewed</option>
          <option value="likes">Most liked</option>
          <option value="comments">Most commented</option>
        </Select>
        <LocationSelect value={locationId} onChange={setLocationId} allLabel="All locations" />
        <label className="flex items-center gap-2 text-sm text-white/70 px-1 select-none">
          <input type="checkbox" checked={reported} onChange={(e) => setReported(e.target.checked)} className="accent-brand-orange" /> Reported only
        </label>
      </Toolbar>

      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.videos.length === 0 ? (
        <EmptyState title="No videos found" hint="Try different filters." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Video</Th>
                <Th>Uploader</Th>
                <Th>Location</Th>
                <Th>Views</Th>
                <Th>Likes</Th>
                <Th>Comments</Th>
                <Th>Uploaded</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.videos.map((v) => (
                <tr key={v.id}>
                  <Td>
                    <button className="flex items-center gap-3 text-left group max-w-[250px]" onClick={() => setViewing(v)}>
                      <span className="relative w-10 h-14 rounded-md bg-white/10 overflow-hidden shrink-0 grid place-items-center">
                        {v.poster ? <img src={mediaUrl(v.poster)} alt="" className="w-full h-full object-cover" loading="lazy" /> : <Play size={14} className="text-white/40" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-white font-medium group-hover:underline">{v.title || 'Untitled'}</span>
                        <span className="text-white/40 text-xs">{formatDuration(v.duration)}</span>
                        {v.reportCount > 0 && <span className="ml-2"><Badge tone="red">{v.reportCount} reported</Badge></span>}
                      </span>
                    </button>
                  </Td>
                  <Td>{v.uploader?.handle ? `@${v.uploader.handle}` : <span className="text-white/35">—</span>}</Td>
                  <Td className="whitespace-nowrap">{v.location?.name ?? <span className="text-white/35">—</span>}</Td>
                  <Td className="tabular-nums">{fmtNum(v.views)}</Td>
                  <Td className="tabular-nums">{fmtNum(v.likes)}</Td>
                  <Td className="tabular-nums">{fmtNum(v.comments)}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(v.createdAt)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <IconButton label="View" onClick={() => setViewing(v)}><Play size={16} /></IconButton>
                    {can('videos.edit') && <IconButton label="Edit" onClick={() => setEditing(v)}><Pencil size={16} /></IconButton>}
                    {can('videos.delete') && <IconButton label="Delete" danger onClick={() => setDeleting(v)}><Trash2 size={16} /></IconButton>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onChange={setPage} />
        </>
      ))}

      {viewing && <VideoDetail video={viewing} onClose={() => setViewing(null)} />}
      {editing && <EditVideo video={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {deleting && (
        <ConfirmDialog
          danger
          title="Delete video"
          confirmLabel="Delete video"
          message={<>Permanently delete <b>{deleting.title || 'this video'}</b>, its comments and its stored files? This can’t be undone.</>}
          onConfirm={async () => {
            await adminApi.deleteVideo(deleting.id);
            toast('Video deleted');
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
