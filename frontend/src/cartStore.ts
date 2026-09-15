import type { CartItem } from './types';

/**
 * Shared, persistent shopping cart. Previously this lived as local
 * React state inside VideoCard — which meant it reset every time that
 * specific video card unmounted (e.g. scrolled out of view in a
 * virtualized/scrolling feed, which is exactly how this feed behaves)
 * and never survived a page reload at all. A shopping cart needs to
 * outlive the component that happened to add something to it, so this
 * follows the same external-store + localStorage pattern already used
 * by soundPreference.ts and profileStore.ts.
 */

const STORAGE_KEY = 'piitrade_cart';

function loadInitial(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let state: CartItem[] = loadInitial();
const listeners = new Set<() => void>();

function setState(next: CartItem[]) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full/unavailable (e.g. private browsing) — the cart still
    // works for the rest of this session, it just won't survive a reload.
  }
  listeners.forEach((listener) => listener());
}

export function getCart(): CartItem[] {
  return state;
}

export function subscribeCart(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addToCart(item: CartItem): void {
  if (state.some((i) => i.productId === item.productId)) return;
  setState([...state, item]);
}

export function removeFromCart(productId: string): void {
  setState(state.filter((i) => i.productId !== productId));
}

export function clearCart(): void {
  setState([]);
}

/** Keeps only the given productIds — used after a partial checkout
 *  (some seller groups succeeded, some didn't; see CheckoutModal). */
export function keepOnlyInCart(productIds: string[]): void {
  setState(state.filter((i) => productIds.includes(i.productId)));
}
