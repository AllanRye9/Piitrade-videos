import { useState } from 'react';
import { CheckCheck, Play, Trash2 } from 'lucide-react';
import { adminApi, ReportGroup } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useFetch } from '../hooks';
import { mediaUrl } from '../../config';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Spinner, fmtDateTime, useToast } from '../ui';

export default function ReportsPage() {
  const { can } = useAdminAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => adminApi.listReports(), []);
  const [playing, setPlaying] = useState<ReportGroup | null>(null);
  const [dismissing, setDismissing] = useState<ReportGroup | null>(null);
  const [removing, setRemoving] = useState<ReportGroup | null>(null);

  return (
    <>
      <PageHeader title="Reports" subtitle="Videos flagged by viewers, most recently reported first." />
      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (data.reports.length === 0 ? (
        <EmptyState title="Nothing to review" hint="No videos are currently flagged." />
      ) : (
        <div className="grid gap-3">
          {data.reports.map((r) => (
            <Card key={r.videoId} className="p-4 flex flex-col sm:flex-row gap-4">
              <button onClick={() => setPlaying(r)} className="relative shrink-0 w-full sm:w-28 aspect-video sm:aspect-[9/14] rounded-lg overflow-hidden bg-black group" aria-label="Preview video">
                {r.poster && <img src={mediaUrl(r.poster)} alt="" className="w-full h-full object-cover" />}
                <span className="absolute inset-0 grid place-items-center bg-black/30 group-hover:bg-black/50"><Play className="text-white" size={26} /></span>
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-white font-semibold truncate max-w-full">{r.title || 'Untitled'}</h3>
                  <Badge tone="red">{r.reportCount} report{r.reportCount === 1 ? '' : 's'}</Badge>
                </div>
                <p className="text-white/40 text-xs mt-1">Last reported {fmtDateTime(r.lastReportedAt)}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {r.reasons.map((reason) => (
                    <Badge key={reason} tone="amber">{reason}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  {can('reports.delete') && (
                    <Button size="sm" onClick={() => setDismissing(r)}>
                      <CheckCheck size={14} /> Dismiss (it’s fine)
                    </Button>
                  )}
                  {can('videos.delete') && (
                    <Button size="sm" variant="danger" onClick={() => setRemoving(r)}>
                      <Trash2 size={14} /> Delete video
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ))}

      {playing && (
        <Modal title={playing.title || 'Video preview'} onClose={() => setPlaying(null)} size="sm">
          <video src={mediaUrl(playing.url)} controls autoPlay playsInline className="w-full max-h-[65dvh] bg-black rounded-lg object-contain" />
        </Modal>
      )}
      {dismissing && (
        <ConfirmDialog
          title="Dismiss reports"
          confirmLabel="Dismiss"
          message={<>Mark <b>{dismissing.title || 'this video'}</b> as reviewed and clear its {dismissing.reportCount} report(s)? The video stays up.</>}
          onConfirm={async () => {
            await adminApi.dismissReports(dismissing.videoId);
            toast('Reports dismissed');
            reload();
          }}
          onClose={() => setDismissing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          danger
          title="Delete video"
          confirmLabel="Delete video"
          message={<>Permanently delete <b>{removing.title || 'this video'}</b> and its files? This can’t be undone.</>}
          onConfirm={async () => {
            await adminApi.deleteVideo(removing.videoId);
            toast('Video deleted');
            reload();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}
