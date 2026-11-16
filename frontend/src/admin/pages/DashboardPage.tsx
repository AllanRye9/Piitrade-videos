import { Link } from 'react-router-dom';
import { Eye, Film, Flag, Heart, MapPin, MessageSquare, ShieldCheck, ShoppingBag, Users } from 'lucide-react';
import { adminApi } from '../adminApi';
import { useAdminAuth } from '../AdminAuthContext';
import { useFetch } from '../hooks';
import { ADMIN_BASE } from '../paths';
import { Card, ErrorState, PageHeader, Spinner, fmtDate, fmtNum, Table, Th, Td } from '../ui';

function Stat({ label, value, sub, icon: Icon, to }: { label: string; value: string; sub?: string; icon: typeof Users; to?: string }) {
  const body = (
    <Card className="p-4 h-full hover:border-white/20">
      <div className="flex items-center justify-between text-white/50">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        <Icon size={16} />
      </div>
      <p className="text-white text-2xl font-bold mt-2 tabular-nums">{value}</p>
      {sub && <p className="text-white/40 text-xs mt-1">{sub}</p>}
    </Card>
  );
  return to ? <Link to={`${ADMIN_BASE}/${to}`}>{body}</Link> : body;
}

export default function DashboardPage() {
  const { admin } = useAdminAuth();
  const { data: s, loading, error, reload } = useFetch(() => adminApi.stats(), []);

  return (
    <>
      <PageHeader title={`Welcome${admin?.name ? `, ${admin.name}` : ''}`} subtitle="Here’s what’s happening on Piitrade Videos." />
      {loading && !s && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {s && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {s.users && <Stat label="Users" value={fmtNum(s.users.total)} sub={`+${s.users.newThisWeek} this week · ${s.users.suspended} suspended`} icon={Users} to="users" />}
            {s.videos && <Stat label="Videos" value={fmtNum(s.videos.total)} sub={`+${s.videos.newThisWeek} this week`} icon={Film} to="videos" />}
            {s.videos && <Stat label="Total views" value={fmtNum(s.videos.totalViews)} sub={`${fmtNum(s.videos.totalShares)} shares`} icon={Eye} />}
            {s.videos && <Stat label="Total likes" value={fmtNum(s.videos.totalLikes)} icon={Heart} />}
            {s.comments && <Stat label="Comments" value={fmtNum(s.comments.total)} icon={MessageSquare} to="comments" />}
            {s.reports && <Stat label="Reported videos" value={fmtNum(s.reports.openVideos)} sub={s.reports.openVideos ? 'Needs review' : 'All clear'} icon={Flag} to="reports" />}
            {s.products && <Stat label="Products" value={fmtNum(s.products.total)} icon={ShoppingBag} to="products" />}
            {s.locations && <Stat label="Locations" value={fmtNum(s.locations.total)} icon={MapPin} to="locations" />}
            {s.admins && <Stat label="Admins" value={fmtNum(s.admins.total)} icon={ShieldCheck} to="admins" />}
          </div>

          {s.videos && s.videos.recent.length > 0 && (
            <div className="mt-8">
              <h2 className="text-white font-semibold mb-3">Latest uploads</h2>
              <Table>
                <thead>
                  <tr>
                    <Th>Title</Th>
                    <Th>Views</Th>
                    <Th>Likes</Th>
                    <Th>Uploaded</Th>
                  </tr>
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

          {Object.keys(s).length === 0 && <Card className="p-6 text-white/60 text-sm">No sections have been enabled for your account yet. Ask the primary admin to grant you permissions.</Card>}
        </>
      )}
    </>
  );
}
