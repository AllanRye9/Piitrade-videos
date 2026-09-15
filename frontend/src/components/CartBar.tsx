import type { CartItem } from '../types';
import { mediaUrl } from '../config';
import { ShoppingCart } from 'lucide-react';

interface Props {
  items: CartItem[];
  onCheckout: () => void;
}

export default function CartBar({ items, onCheckout }: Props) {
  if (items.length === 0) return null;

  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  // Small stacked previews so the cart bar shows what's actually in it,
  // not just a count — up to 3 thumbnails, most-recently-added first.
  const previewItems = items.slice(-3).reverse();

  return (
    <div className="safe-bottom safe-left safe-right fixed inset-x-0 bottom-0 z-[55] px-3 pb-3">
      <button
        type="button"
        onClick={onCheckout}
        className="tap-target w-full flex items-center justify-center gap-2 bg-blue-600 active:bg-blue-700 text-white font-semibold text-sm rounded-full py-3 shadow-lg shadow-black/40"
      >
        <ShoppingCart size={18} />
        <span className="flex items-center -space-x-2 shrink-0">
          {previewItems.map((item) => (
            <span key={item.productId} className="w-6 h-6 rounded-full overflow-hidden ring-2 ring-blue-600 bg-white/20 shrink-0">
              {item.image ? (
                <img src={mediaUrl(item.image)} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full block bg-white/20" />
              )}
            </span>
          ))}
        </span>
        Click to checkout
        <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-white/25 text-xs">
          {count}
        </span>
      </button>
    </div>
  );
}
