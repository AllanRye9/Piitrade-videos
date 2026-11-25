import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { adminApi } from '../adminApi';
import { useFetch } from '../hooks';
import { Badge, Button, Card, ErrorState, PageHeader, Spinner, useToast } from '../ui';

// [label, why it matters, required?]
const CONFIG: Record<string, [string, string, boolean]> = {
  jwtSecret: ['JWT_SECRET', 'Signs admin sessions. Without your own value a default is used — set it in production.', true],
  adminSetupCode: ['ADMIN_SETUP_CODE', 'Stops anyone claiming a fresh deployment before you do. Only matters until the first admin exists.', false],
  appUrl: ['APP_URL', 'The public web address used in password-reset emails.', true],
  allowedOrigins: ['ALLOWED_ORIGIN', 'Extra browser origins allowed to call the API (yotweek.com is always allowed).', false],
  emailProvider: ['RESEND_API_KEY', 'Sends password-reset emails. Without it, reset links are only written to the server log.', true],
  attributionSalt: ['ATTRIBUTION_SALT', 'Salt for hashing viewers in partner click tracking.', true],
  aiSearch: ['AI_SEARCH_API_KEY', 'Visual search (“crop to find”). Optional.', false],
  marketplaceApi: ['MARKETPLACE_API', 'The default Piitrade marketplace API. Optional if every partner has its own API.', false],
  uploadDir: ['UPLOAD_DIR', 'Where uploads are stored. Must be a persistent volume on your host, or uploads vanish on redeploy.', false],
};

function uptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : h ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`;
}

export default function SystemPage() {
  const toast = useToast();
  const { data: sys, loading, error, reload } = useFetch(() => adminApi.systemInfo(), []);

  return (
    <>
      <PageHeader
        title="System"
        subtitle="Is this deployment healthy and fully configured? Only visible to the primary admin."
        actions={
          <div className="flex gap-2">
            <Button onClick={reload}><RefreshCw size={14} /> Refresh</Button>
            <Button onClick={async () => { await adminApi.clearCaches(); toast('Caches cleared'); }}>Clear caches</Button>
          </div>
        }
      />
      {loading && !sys && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {sys && (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <Card className="p-5 space-y-3">
            <h2 className="text-white font-semibold">Service</h2>
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <dt className="text-white/50">Database</dt>
              <dd>{sys.db.ok ? <Badge tone="green">Connected · {sys.db.ms} ms</Badge> : <Badge tone="red">Down — {sys.db.error}</Badge>}</dd>
              <dt className="text-white/50">Migrations</dt>
              <dd>
                {sys.migrations ? (
                  <span className="space-x-2">
                    <Badge tone={sys.migrations.applied >= sys.migrations.expected && !sys.migrations.failed ? 'green' : 'red'}>{sys.migrations.applied} of {sys.migrations.expected} applied</Badge>
                    {sys.migrations.failed > 0 && <Badge tone="red">{sys.migrations.failed} failed</Badge>}
                  </span>
                ) : <span className="text-white/40">unknown</span>}
              </dd>
              {sys.migrations?.latest && (<><dt className="text-white/50">Latest</dt><dd className="text-white/80 break-all text-xs">{sys.migrations.latest}</dd></>)}
              <dt className="text-white/50">Uptime</dt><dd className="text-white">{uptime(sys.runtime.uptimeSeconds)}</dd>
              <dt className="text-white/50">Memory</dt><dd className="text-white">{sys.runtime.rssMb} MB</dd>
              <dt className="text-white/50">Runtime</dt><dd className="text-white">Node {sys.runtime.node.replace(/^v/, '')} · {sys.runtime.env}{sys.runtime.version ? ` · v${sys.runtime.version}` : ''}</dd>
            </dl>
            {sys.migrations && sys.migrations.applied < sys.migrations.expected && (
              <p className="text-red-300 text-sm">This build ships more migrations than the database has. Run <code>npx prisma migrate deploy</code> — the Docker entrypoint does this on start.</p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-white font-semibold mb-3">Configuration</h2>
            <ul className="divide-y divide-white/5">
              {Object.entries(CONFIG).map(([k, [name, why, required]]) => {
                const on = !!sys.config[k];
                return (
                  <li key={k} className="py-2.5 flex items-start gap-3">
                    {on ? <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" /> : <XCircle size={18} className={required ? 'text-red-400 mt-0.5 shrink-0' : 'text-white/25 mt-0.5 shrink-0'} />}
                    <div className="min-w-0">
                      <p className="text-white text-sm"><code>{name}</code> {!on && required && <Badge tone="red">recommended</Badge>}</p>
                      <p className="text-white/45 text-xs">{why}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
