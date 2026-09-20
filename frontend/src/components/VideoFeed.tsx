import { useEffect, useRef, useState } from 'react';
import type { Video } from '../types';
import VideoCard from './VideoCard';

interface Props {
  videos: Video[];
  /** Called (repeatedly-safe — the caller debounces/no-ops as needed)
   *  once the viewer scrolls within a few videos of the end of what's
   *  currently loaded, so the next page can be fetched before they
   *  actually hit it. */
  onNearEnd?: () => void;
}

// How many videos from the end of the loaded list triggers a fetch of
// the next page — high enough that the next page is likely ready
// before the viewer scrolls past the last loaded video.
const NEAR_END_THRESHOLD = 3;

export default function VideoFeed({ videos, onNearEnd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (onNearEnd && videos.length > 0 && activeIndex >= videos.length - NEAR_END_THRESHOLD) {
      onNearEnd();
    }
  }, [activeIndex, videos.length, onNearEnd]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // IntersectionObserver is supported by every evergreen browser but
    // missing from a handful of very old / embedded webviews. Rather
    // than crash there, fall back to always treating the first video
    // as active — it still plays, it just won't auto-advance as the
    // user scrolls on that particular browser.
    if (typeof IntersectionObserver === 'undefined') {
      setActiveIndex(0);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            const idx = Number((entry.target as HTMLElement).dataset.index);
            if (!Number.isNaN(idx)) setActiveIndex(idx);
          }
        }
      },
      { root: container, threshold: [0.6] }
    );

    const children = Array.from(container.children) as HTMLElement[];
    children.forEach((child) => observer.observe(child));

    return () => observer.disconnect();
  }, [videos.length]);

  return (
    <div ref={containerRef} className="h-full w-full overflow-y-scroll snap-y-mandatory no-scrollbar">
      {videos.map((video, i) => (
        <div key={video.id} data-index={i} className="h-full w-full snap-start">
          <VideoCard video={video} active={i === activeIndex} />
        </div>
      ))}
    </div>
  );
}
