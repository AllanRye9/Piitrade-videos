import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AccountSummary, Video } from '../types';
import { api } from '../api';
import { mediaUrl } from '../config';
import Avatar from './Avatar';
import VideoCard from './VideoCard';
import { getProfileState, subscribeProfile } from '../profileStore';
import { ArrowLeft, Heart, MessageCircle, Play, Film, Loader2 } from 'lucide-react';

function VideoThumb({ video, onOpen }: { video: Video; onOpen: (v: Video) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(video)}
      className="group relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-neutral-900 text-left"
    >
      {video.poster ? (
        <img
          src={mediaUrl(video.poster)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
          <Play className="text-white/30" size={28} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <p className="text-white text-xs font-medium line-clamp-2">{video.title || 'Untitled'}</p>
        <div className="flex items-center gap-2 mt-1 text-white/70 text-[10px]">
          <span className="flex items-center gap-0.5">
            <Heart size={10} /> {video.likes}
          </span>
          <span className="flex items-center gap-0.5">
            <MessageCircle size={10} /> {video.comments}
          </span>
        </div>
      </div>
    </button>
  );
}

export default function AccountPage() {
  const { handle } = useParams<{ handle: string }>();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<Video | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const ownProfile = useSyncExternalStore(subscribeProfile, getProfileState);
  const isOwnAccount = !!account && !!ownProfile.handle && account.handle === ownProfile.handle;

  useEffect(() => {
    if (!handle) return;
    setLoading(true);
    setError(null);
    api
      .getAccount(handle)
      .then((res) => {
        setAccount(res.account);
        setVideos(res.videos);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this account'))
      .finally(() => setLoading(false));
  }, [handle]);

  async function toggleFollow() {
    if (!account || followBusy) return;
    setFollowBusy(true);
    // Optimistic — matches the like/save pattern used throughout
    // VideoCard, reverted below only if the request actually fails.
    const wasFollowing = !!account.isFollowing;
    setAccount((prev) =>
      prev ? { ...prev, isFollowing: !wasFollowing, followersCount: prev.followersCount + (wasFollowing ? -1 : 1) } : prev
    );
    try {
      const res = await api.followAccount(account.handle);
      setAccount((prev) => (prev ? { ...prev, isFollowing: res.following, followersCount: res.followersCount } : prev));
    } catch {
      setAccount((prev) => (prev ? { ...prev, isFollowing: wasFollowing, followersCount: prev.followersCount } : prev));
    } finally {
      setFollowBusy(false);
    }
  }

  return (
    <div className="h-dvh w-full bg-black flex flex-col overflow-hidden">
      <div className="safe-top safe-left safe-right flex items-center gap-3 px-3 py-3 border-b border-white/10 shrink-0">
        <Link to="/" aria-label="Back to feed" className="tap-target -ml-2 text-white flex items-center justify-center">
          <ArrowLeft size={22} />
        </Link>
        <h1 className="text-white font-semibold text-base truncate">{account ? `@${account.handle}` : 'Account'}</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="text-white/50 text-sm text-center mt-10">Loading…</p>}
        {!loading && error && <p className="text-white/60 text-sm text-center mt-10 px-6">{error}</p>}

        {!loading && !error && account && (
          <>
            <div className="flex flex-col items-center gap-2 px-4 pt-6 pb-5 text-center border-b border-white/10">
              <Avatar src={account.avatar} size={72} alt={account.handle} />
              <p className="text-white font-semibold text-base">{account.displayName || `@${account.handle}`}</p>
              <p className="text-white/40 text-xs">@{account.handle}</p>
              {account.bio && <p className="text-white/70 text-sm max-w-xs">{account.bio}</p>}
              <div className="flex items-center gap-4 mt-1 text-white/80 text-xs">
                <span className="flex items-center gap-1">
                  <Film size={13} /> {account.videoCount} videos
                </span>
                <span className="flex items-center gap-1">
                  <Heart size={13} /> {account.totalLikes} likes
                </span>
                <span>{account.followersCount} followers</span>
                {account.followingCount !== undefined && <span>{account.followingCount} following</span>}
              </div>
              {!isOwnAccount && (
                <button
                  type="button"
                  onClick={toggleFollow}
                  disabled={followBusy}
                  className={`tap-target mt-1 px-6 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60 ${
                    account.isFollowing ? 'bg-white/10 text-white border border-white/20' : 'bg-brand-pink text-white'
                  }`}
                >
                  {followBusy && <Loader2 size={14} className="animate-spin" />}
                  {account.isFollowing ? 'Following' : 'Follow'}
                </button>
              )}
            </div>

            <div className="pt-3">
              {videos.length === 0 ? (
                <p className="text-white/50 text-sm text-center mt-10 px-6">No videos uploaded yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 px-3 sm:px-4 pb-6">
                  {videos.map((v) => (
                    <VideoThumb key={v.id} video={v} onOpen={setPreviewVideo} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {previewVideo && (
        <div className="fixed inset-0 z-50 bg-black sm:bg-black/90 flex items-center justify-center">
          <div className="relative h-full w-full sm:h-[94dvh] sm:max-h-[900px] sm:w-[420px] sm:rounded-2xl sm:overflow-hidden bg-black">
            <VideoCard video={previewVideo} active />
            <button
              type="button"
              onClick={() => setPreviewVideo(null)}
              aria-label="Close preview"
              className="tap-target safe-top absolute top-4 left-3 z-10 text-white bg-black/40 rounded-full flex items-center justify-center"
            >
              <ArrowLeft size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
