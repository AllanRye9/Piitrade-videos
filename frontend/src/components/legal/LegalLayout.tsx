import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface Props {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

// Deliberately reachable outside the login gate (see main.tsx — these
// routes sit alongside /reset-password, not under RequireConsumerAuth)
// since a prospective user should be able to read these before
// creating an account, not only after.
export default function LegalLayout({ title, lastUpdated, children }: Props) {
  return (
    <div className="min-h-dvh w-full bg-black">
      <div className="safe-top safe-left safe-right flex items-center gap-3 px-4 py-3 border-b border-white/10 sticky top-0 bg-black/95 backdrop-blur z-10">
        <Link to="/" aria-label="Back" className="tap-target -ml-2 text-white flex items-center justify-center">
          <ArrowLeft size={22} />
        </Link>
        <div>
          <h1 className="text-white font-semibold text-base">{title}</h1>
          <p className="text-white/40 text-xs">Last updated {lastUpdated}</p>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-5 py-6 pb-16 text-white/80 text-sm leading-relaxed space-y-5 [&_h2]:text-white [&_h2]:font-semibold [&_h2]:text-base [&_h2]:pt-3 [&_h2]:mb-2 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-brand-cyan [&_a]:underline">
        {children}
      </div>
    </div>
  );
}
