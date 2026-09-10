import { CircleUserRound } from 'lucide-react';
import { mediaUrl } from '../config';

interface Props {
  /** Resolved avatar URL (already absolute or backend-relative) or null/undefined for the fallback icon. */
  src: string | null | undefined;
  /** Pixel size of the circle (both width and height). */
  size?: number;
  className?: string;
  alt?: string;
}

/**
 * The one place that decides what "your picture" looks like, so every
 * spot it appears (TopBar, CommentModal, CheckoutModal, ProfilePage)
 * renders identically and falls back the same way when no avatar is
 * set yet, instead of each usage reimplementing its own circle+icon.
 */
export default function Avatar({ src, size = 32, className = '', alt = '' }: Props) {
  const resolved = mediaUrl(src);
  return (
    <div
      className={`shrink-0 rounded-full overflow-hidden bg-white/10 flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {resolved ? (
        <img src={resolved} alt={alt} className="w-full h-full object-cover" />
      ) : (
        <CircleUserRound size={Math.round(size * 0.72)} className="text-white/50" />
      )}
    </div>
  );
}
