import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppNotification } from '../types';
import { api } from '../api';
import { mediaUrl } from '../config';
import Avatar from './Avatar';
import { X, UserPlus, MessageCircle } from 'lucide-react';

interface Props {
  onClose: () => void;
  /** Called once the panel has marked everything read, so the caller
   *  (App.tsx) can zero out the bell badge immediately rather than
   *  waiting for the next poll. */
  onRead: () => void;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function NotificationRow({ n }: { n: AppNotification }) {
  const actorName = n.actor.displayName || (n.actor.handle ? `@${n.actor.handle}` : 'Someone');
  const target = n.type === 'follow' ? (n.actor.handle ? `/u/${n.actor.handle}` : '/discover') : n.video ? `/v/${n.video.id}` : '/discover';

  return (
    <Link to={target} className={`flex items-center gap-3 px-4 py-3 hover:bg-white/5 ${!n.read ? 'bg-white/[0.03]' : ''}`}>
      <Avatar src={n.actor.avatar} size={40} alt={actorName} />
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm">
          <span className="font-semibold">{actorName}</span>{' '}
          {n.type === 'follow' ? (
            <span className="text-white/70">started following you</span>
          ) : (
            <span className="text-white/70">commented: "{n.commentText}"</span>
          )}
        </p>
        <p className="text-white/40 text-xs mt-0.5">{timeAgo(n.createdAt)}</p>
      </div>
      <div className="shrink-0 text-white/30">{n.type === 'follow' ? <UserPlus size={16} /> : <MessageCircle size={16} />}</div>
      {n.video?.poster && (
        <img src={mediaUrl(n.video.poster)} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
      )}
    </Link>
  );
}

export default function NotificationsPanel({ onClose, onRead }: Props) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getNotifications()
      .then((res) => setNotifications(res.notifications))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load notifications'))
      .finally(() => setLoading(false));

    // Opening the panel is the "seen it" signal — matches how most
    // notification centers behave, and keeps the client from having
    // to track read state per item.
    api.markNotificationsRead().then(onRead).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="animate-sheet-in safe-bottom safe-left safe-right modal-max-h-90 w-full sm:max-w-md sm:max-h-[600px] bg-neutral-900 rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
          <span className="text-white font-semibold text-sm">Notifications</span>
          <button type="button" onClick={onClose} aria-label="Close notifications" className="tap-target -mr-2 text-white/60">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto">
          {loading && <p className="text-white/50 text-sm text-center py-10">Loading…</p>}
          {!loading && error && <p className="text-white/60 text-sm text-center py-10 px-6">{error}</p>}
          {!loading && !error && notifications.length === 0 && (
            <p className="text-white/50 text-sm text-center py-10 px-6">
              No notifications yet — they'll show up here when someone follows you or comments on your videos.
            </p>
          )}
          {!loading &&
            !error &&
            notifications.map((n) => <NotificationRow key={n.id} n={n} />)}
        </div>
      </div>
    </div>
  );
}
