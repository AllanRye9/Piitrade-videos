import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Eye, Film, Flag, Handshake, Heart, MessageSquare, MousePointerClick, RefreshCw, Settings2, ShoppingBag, UserPlus, Users, Wrench } from 'lucide-react';
import { adminApi, AnalyticsData, SeriesBlock } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useFetch } from '../hooks';
import { ADMIN_BASE } from '../paths';
import { BarList, Delta, Funnel, LineChart, Sparkline } from '../charts';
import { Badge, Button, Card, ErrorState, PageHeader, Select, Spinner, Table, Td, Th, cx, fmtDate, fmtNum } from '../ui';

type MetricKey = 'signups' | 'uploads' | 'comments' | 'clicks' | 'conversions';

const METRICS: Array<{ key: MetricKey; label: string; icon: typeof Users }> = [
  { key: 'signups', label: 'New users', icon: UserPlus },
  { key: 'uploads', label: 'Uploads', icon: Film },
  { key: 'comments', label: 'Comments', icon: MessageSquare },
  { key: 'clicks', label: 'Partner clicks', icon: MousePointerClick },
  { key: 'conversions', label: 'Sales reported', icon: ShoppingBag },
];

function Kpi({ label, icon: Icon, block, active, onClick }: { label: string; icon: typeof Users; block: SeriesBlock; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="text-left">
      <Card className={cx('p-4 h-full transition-colors', active ? 'border-brand-amber/60 bg-brand-orange/[0.06]' : 'hover:border-white/20')}>
        <div className="flex items-center justify-between text-white/50">
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
          <Icon size={15} />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-white text-2xl font-bold tabular-nums">{fmtNum(block.total)}</span>
          <Delta now={block.total} previous={block.previous} />
        </div>
        <Sparkline data={block.series} />
      </Card>
    </button>
  );
}

function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cx('p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold text-sm">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Attention({ to, tone, icon: Icon, children }: { to: string; tone: 'amber' | 'red'; icon: typeof Flag; children: React.ReactNode }) {
  return (
    <Link
      to={`${ADMIN_BASE}/${to}`}
      className={cx('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', tone === 'red' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-200')}
    >
      <Icon size={15} className="shrink-0" />
      <span className="flex-1">{children}</span>
      <span className="font-semibold">→</span>
    </Link>
  );
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : h ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`;
}

export default function DashboardPage() {
  const { admin, can, isPrimary } = useAdminAuth();
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<MetricKey>('signups');
  const stats = useFetch(() => adminApi.stats(), []);
  const an = useFetch<AnalyticsData>(() => adminApi.analytics(days), [days]);
  const settings = useFetch(() => (can('settings.view') ? adminApi.getSettings() : Promise.resolve(null)), []);
  const system = useFetch(() => (isPrimary ? adminApi.systemInfo() : Promise.resolve(null)), [isPrimary]);

  const s = stats.data;
  const a = an.data;
  const cfg = settings.data?.settings;
  const available = METRICS.filter((m) => a?.[m.key]);
  const current = available.find((m) => m.key === metric) ?? available[0];
  const sys = system.data;
  const migrationsBehind = sys?.migrations ? sys.migrations.applied < sys.migrations.expected || sys.migrations.failed > 0 : false;
  const refresh = () => { stats.reload(); an.reload(); settings.reload(); system.reload(); };

  const attention: React.ReactNode[] = [];
  if (s?.reports && s.reports.openVideos > 0) attention.push(<Attention key="r" to="reports" tone="amber" icon={Flag}><b>{s.reports.openVideos}</b> reported video{s.reports.openVideos === 1 ? '' : 's'} waiting for review</Attention>);
  if (a?.partners && a.partners.pendingApplications > 0) attention.push(<Attention key="p" to="applications" tone="amber" icon={Handshake}><b>{a.partners.pendingApplications}</b> partner application{a.partners.pendingApplications === 1 ? '' : 's'} to review</Attention>);
  if (cfg?.maintenance.enabled) attention.push(<Attention key="m" to="settings" tone="red" icon={Wrench}>Maintenance mode is <b>on</b> — writes are paused for everyone</Attention>);
  if (cfg && !cfg.features.signups) attention.push(<Attention key="s" to="settings" tone="amber" icon={Settings2}>New sign-ups are paused</Attention>);
  if (system.data && !system.data.db.ok) attention.push(<Attention key="d" to="system" tone="red" icon={AlertTriangle}>The database is not responding</Attention>);
  if (migrationsBehind) attention.push(<Attention key="g" to="system" tone="red" icon={AlertTriangle}>Database migrations are behind this build — run <code>prisma migrate deploy</code></Attention>);

  return (
    <>
      <PageHeader
        title={`Welcome${admin?.name ? `, ${admin.name}` : ''}`}
        subtitle="How Piitrade Videos and its partners are doing."
        actions={
          <div className="flex items-center gap-2">
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time range">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </Select>
            <Button onClick={refresh} aria-label="Refresh"><RefreshCw size={14} /></Button>
          </div>
        }
      />
      {(stats.loading && !s) || (an.loading && !a) ? <Spinner /> : null}
      {stats.error && <ErrorState message={stats.error} onRetry={stats.reload} />}
      {an.error && <ErrorState message={an.error} onRetry={an.reload} />}

      {attention.length > 0 && <div className="grid gap-2 mb-4 md:grid-cols-2">{attention}</div>}

      {a && available.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {available.map((m) => (
              <Kpi key={m.key} label={m.label} icon={m.icon} block={a[m.key]!} active={current?.key === m.key} onClick={() => setMetric(m.key)} />
            ))}
          </div>
          {current && (
            <Panel title={`${current.label} · last ${a.days} days`} className="mt-3">
              <LineChart data={a[current.key]!.series} label={current.label} />
            </Panel>
          )}
        </>
      )}

      <div className="grid gap-3 mt-3 lg:grid-cols-2">
        {a?.funnel && (
          <Panel title="Partner funnel" action={<Link to={`${ADMIN_BASE}/attribution`} className="text-xs text-brand-amber">Attribution →</Link>}>
            <Funnel steps={[{ label: 'Product tags shown', value: a.funnel.impressions }, { label: 'Items saved', value: a.funnel.saves }, { label: 'Clicks to partners', value: a.funnel.clicks }, { label: 'Sales reported', value: a.funnel.conversions }]} />
          </Panel>
        )}
        {a?.topShops && (
          <Panel title="Top partners by clicks" action={a.partners && <span className="text-xs text-white/40">{a.partners.activeShops} active of {a.partners.totalShops}</span>}>
            <BarList rows={a.topShops.map((t) => ({ key: t.siteId, label: t.name, value: t.clicks }))} empty="No clicks to partners in this period yet." />
          </Panel>
        )}
        {a?.topVideos && (
          <Panel title="Most-watched videos" action={<Link to={`${ADMIN_BASE}/videos`} className="text-xs text-brand-amber">All videos →</Link>}>
            <BarList rows={a.topVideos.map((v) => ({ key: v.id, label: v.title || 'Untitled', value: v.views, sub: `${fmtNum(v.likes)} likes` }))} empty="No videos yet." />
          </Panel>
        )}
        {s && (
          <Panel title="Platform totals">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {s.users && <div><dt className="text-white/40 text-xs flex items-center gap-1"><Users size={12} /> Users</dt><dd className="text-white font-semibold tabular-nums">{fmtNum(s.users.total)} <span className="text-white/30 font-normal text-xs">{s.users.suspended} suspended</span></dd></div>}
              {s.videos && <div><dt className="text-white/40 text-xs flex items-center gap-1"><Film size={12} /> Videos</dt><dd className="text-white font-semibold tabular-nums">{fmtNum(s.videos.total)}</dd></div>}
              {s.videos && <div><dt className="text-white/40 text-xs flex items-center gap-1"><Eye size={12} /> Views</dt><dd className="text-white font-semibold tabular-nums">{fmtNum(s.videos.totalViews)}</dd></div>}
              {s.videos && <div><dt className="text-white/40 text-xs flex items-center gap-1"><Heart size={12} /> Likes · shares</dt><dd className="text-white font-semibold tabular-nums">{fmtNum(s.videos.totalLikes)} · {fmtNum(s.videos.totalShares)}</dd></div>}
              {s.comments && <div><dt className="text-white/40 text-xs flex items-center gap-1"><MessageSquare size={12} /> Comments</dt><dd className="text-white font-semibold tabular-nums">{fmtNum(s.comments.total)}</dd></div>}
              {s.products && <div><dt className="text-white/40 text-xs flex items-center gap-1"><ShoppingBag size={12} /> Products</dt><dd className="text-white font-semibold tabular-nums">{fmtNum(s.products.total)}</dd></div>}
            </dl>
          </Panel>
        )}
      </div>

      {sys && (
        <Panel title="System health" className="mt-3" action={<Link to={`${ADMIN_BASE}/system`} className="text-xs text-brand-amber">Details →</Link>}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2"><Activity size={14} className="text-white/40" /> Database <Badge tone={sys.db.ok ? 'green' : 'red'}>{sys.db.ok ? `${sys.db.ms} ms` : 'down'}</Badge></span>
            {sys.migrations && <span className="flex items-center gap-2 text-white/70">Migrations <Badge tone={migrationsBehind ? 'red' : 'green'}>{sys.migrations.applied}/{sys.migrations.expected}</Badge></span>}
            <span className="text-white/70">Uptime <b className="text-white">{fmtUptime(sys.runtime.uptimeSeconds)}</b></span>
            <span className="text-white/70">Memory <b className="text-white">{sys.runtime.rssMb} MB</b></span>
          </div>
        </Panel>
      )}

      {s?.videos && s.videos.recent.length > 0 && (
        <div className="mt-6">
          <h2 className="text-white font-semibold mb-3 text-sm">Latest uploads</h2>
          <Table>
            <thead>
              <tr><Th>Title</Th><Th>Views</Th><Th>Likes</Th><Th>Uploaded</Th></tr>
            </thead>
            <tbody>
              {s.videos.recent.map((v) => (
                <tr key={v.id}>
                  <Td className="max-w-[320px] truncate">{v.title || 'Untitled'}</Td>
                  <Td className="tabular-nums">{fmtNum(v.views)}</Td>
                  <Td className="tabular-nums">{fmtNum(v.likes)}</Td>
                  <Td>{fmtDate(v.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {s && Object.keys(s).length === 0 && <Card className="p-6 text-white/60 text-sm">No sections have been enabled for your account yet. Ask the primary admin to grant you permissions.</Card>}
    </>
  );
}
