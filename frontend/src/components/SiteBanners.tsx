import { useState } from 'react';
import { AlertTriangle, Info, CheckCircle2, Wrench, X } from 'lucide-react';
import { useSiteConfig } from '../siteConfig';

const DISMISSED_KEY = 'piitrade_dismissed_announcement';

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

const TONE = {
  info: { cls: 'bg-sky-500/15 text-sky-100 border-sky-400/30', Icon: Info },
  success: { cls: 'bg-emerald-500/15 text-emerald-100 border-emerald-400/30', Icon: CheckCircle2 },
  warning: { cls: 'bg-amber-500/15 text-amber-100 border-amber-400/30', Icon: AlertTriangle },
} as const;

/**
 * The two admin-controlled notices (Admin → Site & app settings): a maintenance strip while writes are paused
 * (watching still works) and a dismissible announcement. Rendered in normal flow above the header so it never
 * covers the video; a dismissed announcement returns only when an admin changes it (new `version`).
 */
export default function SiteBanners() {
  const { maintenance, announcement } = useSiteConfig();
  const [dismissed, setDismissed] = useState(dismissedVersion);
  const showAnnouncement = announcement.enabled && !!announcement.text && dismissed !== announcement.version;
  if (!maintenance.enabled && !showAnnouncement) return null;

  const tone = TONE[announcement.level] ?? TONE.info;
  return (
    <div className="shrink-0 safe-top">
      {maintenance.enabled && (
        <div role="status" className="flex items-center gap-2 px-4 py-2 text-xs bg-amber-500/20 text-amber-100 border-b border-amber-400/30">
          <Wrench size={14} className="shrink-0" />
          <span className="flex-1 min-w-0">{maintenance.message || 'Maintenance in progress — uploads, likes and comments are paused.'}</span>
        </div>
      )}
      {showAnnouncement && (
        <div role="status" className={`flex items-center gap-2 pl-4 pr-1 py-1.5 text-xs border-b ${tone.cls}`}>
          <tone.Icon size={14} className="shrink-0" />
          <span className="flex-1 min-w-0">
            {announcement.text}
            {announcement.link && (
              <>
                {' '}
                <a href={announcement.link} className="underline font-semibold" target={announcement.link.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer">
                  Learn more
                </a>
              </>
            )}
          </span>
          <button
            type="button"
            aria-label="Dismiss announcement"
            className="shrink-0 w-8 h-8 flex items-center justify-center opacity-70 hover:opacity-100"
            onClick={() => {
              try {
                localStorage.setItem(DISMISSED_KEY, announcement.version);
              } catch {
                // not persisted — it just comes back next visit
              }
              setDismissed(announcement.version);
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
