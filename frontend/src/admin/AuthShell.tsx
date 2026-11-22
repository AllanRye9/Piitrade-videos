import { ReactNode } from 'react';

/** Centered card used by the admin sign-in and register screens. */
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <span className="w-9 h-9 rounded-xl bg-brand-orange grid place-items-center text-white font-extrabold">P</span>
          <span className="text-white font-bold text-lg">Piitrade Admin</span>
        </div>
        <div className="bg-neutral-900 border border-white/10 rounded-2xl p-6 space-y-4">
          <div>
            <h1 className="text-white text-lg font-semibold">{title}</h1>
            {subtitle && <p className="text-white/50 text-sm mt-1">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
