import type { VideoProduct } from '../../lib/types';
import { isDockedProduct, productPosition, type Frame } from './productLogic';
import { BookmarkCheck, Bookmark } from 'lucide-react';

interface Props {
  products: VideoProduct[];
  frame: Frame;
  saved: Set<string>;
  onTap: (product: VideoProduct) => void;
}

export default function ProductChips({ products, frame, saved, onTap }: Props) {
  const docked = products.filter(isDockedProduct);
  const hotspots = products.filter((product) => !isDockedProduct(product));

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {docked.length > 0 && (
        <div className="absolute bottom-36 left-3 flex max-w-[75%] flex-col gap-1.5">
          {docked.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTap(product);
              }}
              aria-label={saved.has(product.id) ? `${product.title || product.host} is saved` : `Save ${product.title || product.host} for later`}
              className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-black/75 px-3 py-2 text-left text-xs text-white shadow-lg"
            >
              {saved.has(product.id) ? <BookmarkCheck size={15} className="shrink-0 text-emerald-400" /> : <Bookmark size={15} className="shrink-0 text-brand-amber" />}
              <span className="truncate">{saved.has(product.id) ? 'Saved' : product.title || 'Save this item'}</span>
              <span className="max-w-24 truncate text-white/50">{product.host}</span>
            </button>
          ))}
        </div>
      )}
      {hotspots.map((product) => {
        const position = productPosition(product, frame);
        if (!position) return null;
        return (
          <button
            key={product.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTap(product);
            }}
            aria-label={saved.has(product.id) ? `${product.title || product.host} is saved` : `Save ${product.title || product.host} for later`}
            className="pointer-events-auto absolute flex max-w-40 -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1.5 text-xs text-white shadow-lg"
            style={{ left: Math.max(8, position.left), top: position.top }}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${saved.has(product.id) ? 'bg-emerald-400' : 'bg-brand-amber'}`} />
            <span className="truncate">{saved.has(product.id) ? 'Saved' : product.title || product.host}</span>
          </button>
        );
      })}
    </div>
  );
}
