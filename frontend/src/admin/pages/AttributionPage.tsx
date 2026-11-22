import { useState } from 'react';
import { adminApi, GuardrailReport, GuardrailVerdict } from '../adminApi';
import { useFetch } from '../hooks';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Select, Spinner, Table, Td, Th, Toolbar, fmtNum } from '../ui';

const money = (m: Record<string, number>) => {
  const e = Object.entries(m);
  return e.length ? e.map(([c, v]) => `${c} ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`).join(' · ') : '—';
};

const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${(n * 100).toFixed(digits)}%`);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} pts`;

const VERDICT: Record<GuardrailVerdict, { tone: 'green' | 'amber' | 'red' | 'blue'; title: string; body: (r: GuardrailReport) => string }> = {
  insufficient_data: { tone: 'blue', title: 'Collecting data', body: (r) => `A verdict needs at least ${r.comparison.minSessions} viewings in both groups. The app records watch time as people use it, so check back after more traffic.` },
  no_harm: { tone: 'green', title: 'Tags are not hurting viewing', body: () => 'Viewers who see product tags watch about as much of each video as viewers who don’t. Any difference is within normal noise.' },
  benefit: { tone: 'green', title: 'Tags are helping viewing', body: () => 'Viewers who see tags watch more of each video than the group without them.' },
  harm: { tone: 'red', title: 'Tags are reducing watch time', body: () => 'Viewers who see tags watch measurably less of each video. Reduce how many tags show at once, shorten their time windows, or review the videos with the most tags.' },
};

function Guardrail({ days }: { days: number }) {
  const { data, loading, error, reload } = useFetch(() => adminApi.guardrail(days), [days]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const v = VERDICT[data.comparison.verdict];
  const c = data.comparison;
  const rows: Array<[string, GuardrailReport['cohorts']['exposed'], string]> = [
    ['Saw tags', data.cohorts.exposed, 'Viewers shown product tags'],
    ['Hold-out (no tags)', data.cohorts.holdout, `A random ${data.holdoutPct}% of viewers, on the same tagged videos`],
    ['Untagged videos', data.cohorts.untagged, 'For reference only — not a controlled comparison'],
  ];
  return (
    <section>
      <h2 className="text-white font-semibold mb-1">Do tags hurt viewing?</h2>
      <p className="text-white/45 text-sm mb-3">Selling must not cost watch time. A random {data.holdoutPct}% of viewers is shown no tags on tagged videos, so their viewing can be compared fairly.</p>
      <Card className="p-4 mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={v.tone}>{v.title}</Badge>
          {c.verdict !== 'insufficient_data' && (
            <span className="text-white/60 text-sm">
              Difference in video watched: <b className="text-white">{signed(c.deltaWatchThrough)}</b>
              {c.ci95[0] !== null && c.ci95[1] !== null && <> (95% range {signed(c.ci95[0])} to {signed(c.ci95[1])})</>}
            </span>
          )}
        </div>
        <p className="text-white/70 text-sm mt-2">{v.body(data)}</p>
      </Card>
      <Table>
        <thead><tr><Th>Group</Th><Th>Viewings</Th><Th>Video watched</Th><Th>Finished (90%+)</Th><Th>Avg. time</Th></tr></thead>
        <tbody>
          {rows.map(([label, s, hint]) => (
            <tr key={label}>
              <Td><p className="text-white font-medium">{label}</p><p className="text-white/40 text-xs">{hint}</p></Td>
              <Td className="tabular-nums">{fmtNum(s.sessions)}</Td>
              <Td className="tabular-nums">{s.sessions ? pct(s.watchThrough) : '—'}</Td>
              <Td className="tabular-nums">{s.sessions ? pct(s.completionRate) : '—'}</Td>
              <Td className="tabular-nums">{s.sessions ? `${s.avgWatchSec.toFixed(1)} s` : '—'}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {data.funnel.length > 0 && (
        <div className="mt-6">
          <h3 className="text-white font-semibold mb-2">Partner funnel</h3>
          <Table>
            <thead><tr><Th>Shop</Th><Th>Tags shown</Th><Th>Saved</Th><Th>Opened</Th><Th>Sales</Th><Th>Save rate</Th><Th>Open rate</Th><Th>Sale rate</Th></tr></thead>
            <tbody>
              {data.funnel.map((f) => (
                <tr key={f.site}>
                  <Td className="text-white font-medium">{f.site}</Td>
                  <Td className="tabular-nums">{fmtNum(f.impressions)}</Td>
                  <Td className="tabular-nums">{fmtNum(f.saves)}</Td>
                  <Td className="tabular-nums">{fmtNum(f.clicks)}</Td>
                  <Td className="tabular-nums">{fmtNum(f.sales)}</Td>
                  <Td className="tabular-nums">{pct(f.saveRate)}</Td>
                  <Td className="tabular-nums">{pct(f.clickRate)}</Td>
                  <Td className="tabular-nums">{pct(f.saleRate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-white/35 text-xs mt-2">Save rate = saves ÷ tags shown. Open rate = shop links opened ÷ tags shown. Sale rate = sales ÷ opens.</p>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-white/50 text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="text-white text-xl font-bold mt-2 tabular-nums break-words">{value}</p>
      {sub && <p className="text-white/40 text-xs mt-1">{sub}</p>}
    </Card>
  );
}

export default function AttributionPage() {
  const [days, setDays] = useState(30);
  const [siteId, setSiteId] = useState('');
  const sites = useFetch(() => adminApi.listSites().catch(() => ({ sites: [] })), []);
  const { data, loading, error, reload } = useFetch(() => adminApi.attributionOverview({ days, siteId }), [days, siteId]);
  const rate = data && data.totals.clicks ? ((data.totals.conversions / data.totals.clicks) * 100).toFixed(1) + '%' : '—';

  return (
    <>
      <PageHeader title="Attribution" subtitle="How video taps turn into shop sales." />
      <Toolbar>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </Select>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Shop">
          <option value="">All shops</option>
          {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Toolbar>

      <div className="mb-8"><Guardrail days={days} /></div>

      {loading && !data && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Saves" value={fmtNum(data.totals.saves)} sub="Viewers who saved an item" />
            <Stat label="Clicks" value={fmtNum(data.totals.clicks)} />
            <Stat label="Sales" value={fmtNum(data.totals.conversions)} sub={`Conversion rate ${rate}`} />
            <Stat label="Revenue" value={money(data.totals.revenue)} />
            <Stat label="Creator commission" value={money(data.totals.credited)} sub="Excluding reversed" />
          </div>

          {data.totals.clicks === 0 && data.totals.saves === 0 ? (
            <EmptyState title="No activity in this period" hint="Saves and clicks appear once viewers tap a product in a video." />
          ) : (
            <>
              <section>
                <h2 className="text-white font-semibold mb-3">By shop</h2>
                <Table>
                  <thead><tr><Th>Shop</Th><Th>Saves</Th><Th>Clicks</Th><Th>Sales</Th><Th>Revenue</Th></tr></thead>
                  <tbody>
                    {data.sites.map((s) => (
                      <tr key={s.site}><Td className="text-white font-medium">{s.site}</Td><Td className="tabular-nums">{fmtNum(s.saves)}</Td><Td className="tabular-nums">{fmtNum(s.clicks)}</Td><Td className="tabular-nums">{fmtNum(s.conversions)}</Td><Td>{money(s.revenue)}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </section>
              <div className="grid xl:grid-cols-2 gap-8">
                <section>
                  <h2 className="text-white font-semibold mb-3">Top videos</h2>
                  <Table>
                    <thead><tr><Th>Video</Th><Th>Clicks</Th><Th>Sales</Th></tr></thead>
                    <tbody>
                      {data.topVideos.map((v) => (
                        <tr key={v.videoId}><Td className="max-w-[260px] truncate text-white">{v.title || 'Untitled'}</Td><Td className="tabular-nums">{fmtNum(v.clicks)}</Td><Td className="tabular-nums">{fmtNum(v.conversions)}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                </section>
                <section>
                  <h2 className="text-white font-semibold mb-3">Top creators</h2>
                  <Table>
                    <thead><tr><Th>Creator</Th><Th>Clicks</Th><Th>Sales</Th><Th>Earned</Th></tr></thead>
                    <tbody>
                      {data.topCreators.map((c) => (
                        <tr key={c.handle}><Td className="text-white">@{c.handle}</Td><Td className="tabular-nums">{fmtNum(c.clicks)}</Td><Td className="tabular-nums">{fmtNum(c.conversions)}</Td><Td>{money(c.earned)}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                </section>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
