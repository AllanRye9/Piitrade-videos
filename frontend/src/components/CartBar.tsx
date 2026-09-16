import type { CartItem } from '../types';
import { ShoppingCart } from 'lucide-react';

interface Props {
  items: CartItem[];
  onCheckout: () => void;
}

export default function CartBar({ items, onCheckout }: Props) {
  if (items.length === 0) return null;

  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="safe-bottom safe-left safe-right fixed inset-x-0 bottom-0 z-[55] px-3 pb-3">
      <button
        type="button"
        onClick={onCheckout}
        className="tap-target w-full flex items-center justify-center gap-2 bg-blue-600 active:bg-blue-700 text-white font-semibold text-sm rounded-full py-3 shadow-lg shadow-black/40"
      >
        <ShoppingCart size={18} />
        Click to checkout
        <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-white/25 text-xs">
          {count}
        </span>
      </button>
    </div>
  );
}
