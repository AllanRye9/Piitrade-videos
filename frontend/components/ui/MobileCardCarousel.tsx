'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';

interface MobileCardCarouselProps {
  /** One rendered card element per listing/deal — same elements the sm+ grid would show. */
  children: ReactNode[];
  /** Extra classes for the sm+ grid layout (column counts etc.), merged onto the shared container. */
  gridClassName?: string;
  /** aria-label for the scrollable region, e.g. "Flash Deals listings". */
  ariaLabel?: string;
}

/**
 * Mobile-only horizontal carousel — three cards visible per row, with swipe
 * and left/right arrow navigation — that collapses back into a plain CSS
 * grid at the `sm` breakpoint and above.
 *
 * Used by the four homepage listing sections (Flash Deals, Recent Across
 * Categories, Latest Collections, Featured Deal) per Doc 1 Cluster 5
 * (mobile categories — 3 listings per row & navigation).
 *
 * Implementation notes:
 *  - One DOM tree for both layouts: a flex row with horizontal scroll-snap
 *    on mobile (each card ~31% wide so three sit in one viewport including
 *    gaps), which becomes `sm:grid` at larger breakpoints. Nothing to keep
 *    in sync between a "mobile" and "desktop" version of the markup.
 *  - Swipe works for free via native scroll — `scroll-snap-type: x mandatory`
 *    just makes it settle on a card boundary instead of a mid-scroll offset.
 *  - Arrow buttons call `scrollBy` on the scroll container and hide
 *    themselves at each end (rather than disabling in place), and are
 *    themselves hidden at `sm:` and above where the grid layout replaces
 *    horizontal paging entirely.
 *  - This component only renders the horizontal-scroll/arrow *chrome* — it
 *    is intentionally separate from "View All" category-navigation links,
 *    per requirement 20 ("this should be separate from the listing-card
 *    navigation arrows").
 */
export function MobileCardCarousel({ children, gridClassName = '', ariaLabel }: MobileCardCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const updateEdges = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => {
    updateEdges();
    // Card images/widths can settle a beat after mount (e.g. once listing
    // data streams in) — re-check shortly after so the arrows reflect the
    // final scrollWidth rather than an initial 0-width measurement.
    const t = setTimeout(updateEdges, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children.length]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.92, behavior: 'smooth' });
  };

  if (children.length === 0) return null;

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        role="list"
        aria-label={ariaLabel}
        className={`flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-none sm:overflow-visible sm:gap-2 sm:grid ${gridClassName}`}
      >
        {children.map((child, i) => (
          <div key={i} role="listitem" className="shrink-0 min-w-0 basis-[31%] snap-start sm:shrink sm:basis-auto sm:snap-align-none">
            {child}
          </div>
        ))}
      </div>

      {!atStart && (
        <button
          type="button"
          onClick={() => scrollByPage(-1)}
          aria-label="Previous listings"
          className="sm:hidden absolute -left-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/95 shadow-md border border-gray-200 flex items-center justify-center text-gray-600 active:scale-95 transition-transform"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {!atEnd && (
        <button
          type="button"
          onClick={() => scrollByPage(1)}
          aria-label="Next listings"
          className="sm:hidden absolute -right-1 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/95 shadow-md border border-gray-200 flex items-center justify-center text-gray-600 active:scale-95 transition-transform"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
