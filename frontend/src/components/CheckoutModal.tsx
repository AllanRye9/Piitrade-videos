import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CartItem, DeliveryAddress, MarketplaceCheckoutResult, MarketplaceCountry, PaymentDetails } from '../types';
import { api } from '../api';
import { mediaUrl } from '../config';
import Avatar from './Avatar';
import { ensureProfileLoaded, getProfileState, subscribeProfile } from '../profileStore';
import { removeFromCart, clearCart } from '../cartStore';
import { X, LogIn, UserPlus, CheckCircle2, MailCheck, Trash2, ExternalLink, MapPin, CreditCard, Phone, Mail, Pencil } from 'lucide-react';

interface Props {
  items: CartItem[];
  /** User dismissed the modal without completing checkout — resume watching, keep the cart. */
  onCancel: () => void;
  /** Checkout finished and the user chose to continue watching. Passes
   *  the productIds that did NOT get ordered (empty if everything
   *  succeeded) so the cart only clears what was actually placed. */
  onComplete: (remainingProductIds: string[]) => void;
}

type Stage = 'checking' | 'auth' | 'verify' | 'address' | 'payment' | 'confirm' | 'processing' | 'success' | 'error';
type AuthMode = 'login' | 'register';

const COUNTRIES: Array<{ value: MarketplaceCountry; label: string }> = [
  { value: 'UAE', label: 'UAE' },
  { value: 'UGANDA', label: 'Uganda' },
  { value: 'KENYA', label: 'Kenya' },
  { value: 'CHINA', label: 'China' },
];

function isEmailLike(value: string): boolean {
  return /@/.test(value);
}

export default function CheckoutModal({ items, onCancel, onComplete }: Props) {
  const [stage, setStage] = useState<Stage>('checking');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState<MarketplaceCountry | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [orders, setOrders] = useState<MarketplaceCheckoutResult[]>([]);
  const [failedItems, setFailedItems] = useState<Array<{ productId: string; quantity: number }>>([]);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const profile = useSyncExternalStore(subscribeProfile, getProfileState);

  // Real checkout details, confirmed before anything is placed: a
  // delivery address always, plus payment for any items Piitrade sells
  // directly (no sellerId — see types.ts). Marketplace-sourced items
  // (have a sellerId) are arranged with the seller directly instead —
  // see the seller contact cards on the success screen.
  const [deliveryName, setDeliveryName] = useState(profile.displayName || '');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');

  const hasAdminItems = items.some((i) => !i.sellerId);
  const hasMarketplaceItems = items.some((i) => i.sellerId);

  useEffect(() => {
    ensureProfileLoaded();
  }, []);

  // On open, find out whether this browser session already has a
  // linked marketplace account — only relevant if the cart actually
  // contains marketplace-sourced (third-party seller) items; a cart of
  // only Piitrade's own goods never needs a marketplace login at all.
  useEffect(() => {
    if (items.length === 0) return;
    if (!hasMarketplaceItems) {
      setStage('address');
      return;
    }
    let cancelled = false;
    api
      .marketplaceAccount()
      .then((res) => {
        if (cancelled) return;
        setStage(res.linked ? 'address' : 'auth');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not reach the marketplace');
        setStage('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runCheckout(address: DeliveryAddress, payment?: PaymentDetails) {
    setStage('processing');
    setError(null);
    try {
      const result = await api.marketplaceCheckout(items, address, payment);
      setOrders(result.orders);
      setFailedItems(result.failed?.flatMap((f) => f.items) ?? []);
      setStage('success');
      // Complete a marketplace-sourced transaction on the real marketplace
      // (it has no online payment gateway — see backend — so this is its
      // cart, where contacting the seller / arranging payment happens).
      // Opens in a new tab so this app is never left/unloaded. Attempted
      // automatically as a courtesy, but async work happened first (the
      // request above), so some browsers' popup blockers may block a
      // window.open that isn't perfectly synchronous with the click — the
      // success screen always also shows a manual button with this same
      // link, so checkout never depends on the popup succeeding. Absent
      // entirely when every order placed was admin-fulfilled.
      if (result.redirectUrl) {
        setRedirectUrl(result.redirectUrl);
        window.open(result.redirectUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setStage('error');
    }
  }

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    if (authMode === 'register' && (!name.trim() || !country)) {
      setError('Name and country are required');
      return;
    }

    setStage('processing');
    setError(null);
    try {
      if (authMode === 'login') {
        await api.marketplaceLogin(email.trim(), password);
        // Linked — move on to confirming a delivery address rather than
        // checking out immediately with no address on file.
        setStage('address');
      } else {
        // Registering does NOT log the viewer in — the marketplace
        // requires email verification first. Show that instead of
        // pretending checkout can continue immediately.
        const result = await api.marketplaceRegister(email.trim(), password, name.trim(), country as MarketplaceCountry);
        setVerifyMessage(result.message);
        setStage('verify');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : authMode === 'login' ? 'Login failed' : 'Registration failed');
      setStage('auth');
    }
  }

  function backToLoginAfterVerifying() {
    setAuthMode('login');
    setPassword('');
    setError(null);
    setStage('auth');
  }

  function submitAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!deliveryName.trim() || !deliveryPhone.trim() || !deliveryAddress.trim()) {
      setError('Name, phone, and address are all required');
      return;
    }
    setError(null);
    setStage(hasAdminItems ? 'payment' : 'confirm');
  }

  function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    const digits = cardNumber.replace(/\s+/g, '');
    if (!cardName.trim() || !/^\d{12,19}$/.test(digits) || !cardExpiry.trim()) {
      setError('Enter a valid name on card, card number, and expiry');
      return;
    }
    setError(null);
    setStage('confirm');
  }

  function confirmAndCheckout() {
    const address: DeliveryAddress = {
      name: deliveryName.trim(),
      phone: deliveryPhone.trim(),
      address: deliveryAddress.trim(),
    };
    const payment: PaymentDetails | undefined = hasAdminItems
      ? { cardName: cardName.trim(), cardNumber: cardNumber.replace(/\s+/g, ''), expiry: cardExpiry.trim() }
      : undefined;
    runCheckout(address, payment);
  }

  const total = items.length;
  const cardLast4 = cardNumber.replace(/\s+/g, '').slice(-4);

  // Distinct sellers across the marketplace-sourced items, for the
  // confirm screen's "you'll arrange payment with" note.
  const sellers = Array.from(
    new Map(
      items
        .filter((i) => i.sellerId)
        .map((i) => [i.sellerId as string, { name: i.sellerName || 'the seller', contact: i.sellerContact }])
    ).values()
  );

  const adminOrder = orders.find((o) => o.source === 'admin');
  const marketplaceOrders = orders.filter((o) => o.source === 'marketplace');

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center bg-black/70">
      <div className="safe-bottom safe-left safe-right modal-max-h-90 w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar src={profile.avatar} size={26} alt="You" />
            <span className="text-white font-semibold text-sm truncate">
              {profile.displayName ? `${profile.displayName}'s checkout` : 'Checkout'}
            </span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close checkout"
            disabled={stage === 'processing'}
            className="tap-target -mr-2 text-white/60 disabled:opacity-30"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Order summary — shown for every stage except the final success/verify screens */}
          {stage !== 'success' && stage !== 'verify' && (
            <>
              {items.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-white/60 text-sm">Your cart is empty.</p>
                  <button type="button" onClick={onCancel} className="mt-3 text-brand-cyan text-xs underline">
                    Continue watching
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {items.map((item) => (
                      <div key={item.productId} className="flex items-center gap-3">
                        <img src={mediaUrl(item.image)} alt={item.name} className="w-10 h-10 rounded object-cover bg-white/10" />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-medium truncate">{item.name}</p>
                          <p className="text-white/50 text-[11px]">
                            Qty {item.quantity} · {item.sellerId ? item.sellerName || 'Marketplace seller' : 'Sold by Piitrade'}
                          </p>
                        </div>
                        <span className="text-brand-cyan text-xs font-semibold shrink-0">{item.price}</span>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.productId)}
                          aria-label={`Remove ${item.name} from cart`}
                          className="tap-target shrink-0 text-white/40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={clearCart} className="text-white/40 text-[11px] underline">
                    Clear cart
                  </button>
                </>
              )}
            </>
          )}

          {stage === 'checking' && <p className="text-white/60 text-sm text-center py-6">Checking your account…</p>}

          {stage === 'auth' && items.length > 0 && (
            <form onSubmit={submitAuth} className="space-y-3">
              <div className="flex rounded-lg bg-white/10 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setError(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium ${
                    authMode === 'login' ? 'bg-white text-black' : 'text-white/60'
                  }`}
                >
                  <LogIn size={14} /> Log in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    setError(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium ${
                    authMode === 'register' ? 'bg-white text-black' : 'text-white/60'
                  }`}
                >
                  <UserPlus size={14} /> Register
                </button>
              </div>

              <p className="text-white/50 text-xs">
                {authMode === 'login'
                  ? 'Log in to the marketplace to check out the seller-listed items in your cart.'
                  : 'Create a marketplace account — you\u2019ll verify your email before you can log in.'}
              </p>

              {authMode === 'register' && (
                <>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name"
                    className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
                  />
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value as MarketplaceCountry)}
                    className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none"
                  >
                    <option value="" disabled className="text-black">
                      Country
                    </option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value} className="text-black">
                        {c.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="Email"
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Password"
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
              />

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button type="submit" className="w-full bg-blue-600 text-white font-semibold text-sm rounded-lg py-2.5">
                {authMode === 'login' ? 'Log in' : 'Create account'}
              </button>
            </form>
          )}

          {stage === 'verify' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <MailCheck size={40} className="text-brand-cyan" />
              <p className="text-white font-semibold text-sm">Check your email</p>
              <p className="text-white/60 text-xs">{verifyMessage}</p>
              <button
                type="button"
                onClick={backToLoginAfterVerifying}
                className="w-full bg-blue-600 text-white font-semibold text-sm rounded-lg py-2.5 mt-2"
              >
                I've verified — log in
              </button>
              <button type="button" onClick={onCancel} className="text-white/50 text-xs underline">
                Keep watching for now
              </button>
            </div>
          )}

          {stage === 'address' && items.length > 0 && (
            <form onSubmit={submitAddress} className="space-y-3">
              <p className="flex items-center gap-1.5 text-white/70 text-xs font-medium">
                <MapPin size={14} /> Confirm delivery address
              </p>
              <input
                value={deliveryName}
                onChange={(e) => setDeliveryName(e.target.value)}
                placeholder="Full name"
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
              />
              <input
                value={deliveryPhone}
                onChange={(e) => setDeliveryPhone(e.target.value)}
                type="tel"
                placeholder="Phone number"
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
              />
              <textarea
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="Delivery address"
                rows={3}
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40 resize-none"
              />

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button type="submit" className="w-full bg-blue-600 text-white font-semibold text-sm rounded-lg py-2.5">
                Continue
              </button>
            </form>
          )}

          {stage === 'payment' && items.length > 0 && (
            <form onSubmit={submitPayment} className="space-y-3">
              <p className="flex items-center gap-1.5 text-white/70 text-xs font-medium">
                <CreditCard size={14} /> Payment for items sold by Piitrade
              </p>
              <p className="text-white/40 text-[11px]">
                Marketplace items in your cart are arranged directly with their sellers after checkout — this payment step only
                covers items Piitrade sells itself.
              </p>
              <input
                value={cardName}
                onChange={(e) => setCardName(e.target.value)}
                placeholder="Name on card"
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
              />
              <input
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                inputMode="numeric"
                placeholder="Card number"
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
              />
              <input
                value={cardExpiry}
                onChange={(e) => setCardExpiry(e.target.value)}
                placeholder="MM/YY"
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
              />

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStage('address')}
                  className="shrink-0 bg-white/10 text-white font-semibold text-sm rounded-lg py-2.5 px-4"
                >
                  Back
                </button>
                <button type="submit" className="flex-1 bg-blue-600 text-white font-semibold text-sm rounded-lg py-2.5">
                  Continue
                </button>
              </div>
            </form>
          )}

          {stage === 'confirm' && items.length > 0 && (
            <div className="space-y-3">
              <div className="bg-white/5 rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-1.5 min-w-0">
                    <MapPin size={14} className="text-white/50 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-white text-xs font-medium truncate">{deliveryName}</p>
                      <p className="text-white/50 text-[11px]">{deliveryPhone}</p>
                      <p className="text-white/50 text-[11px]">{deliveryAddress}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStage('address')}
                    aria-label="Edit delivery address"
                    className="tap-target shrink-0 text-white/40"
                  >
                    <Pencil size={13} />
                  </button>
                </div>

                {hasAdminItems && (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
                    <span className="flex items-center gap-1.5 text-white/70 text-xs">
                      <CreditCard size={14} className="text-white/50" /> Card ending {cardLast4 || '····'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setStage('payment')}
                      aria-label="Edit payment details"
                      className="tap-target shrink-0 text-white/40"
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                )}
              </div>

              {sellers.length > 0 && (
                <p className="text-white/40 text-[11px]">
                  {sellers.length === 1 ? `${sellers[0].name} ships` : `${sellers.length} different sellers ship`} the
                  marketplace item{items.filter((i) => i.sellerId).length === 1 ? '' : 's'} in your cart — Piitrade uses
                  meet-in-person/cash-on-delivery, so you'll arrange payment with {sellers.length === 1 ? 'them' : 'each seller'}{' '}
                  directly after checkout.
                </p>
              )}

              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="button"
                onClick={confirmAndCheckout}
                className="w-full bg-blue-600 text-white font-semibold text-sm rounded-lg py-2.5"
              >
                Confirm checkout ({total} item{total === 1 ? '' : 's'})
              </button>
            </div>
          )}

          {stage === 'processing' && <p className="text-white/60 text-sm text-center py-6">Processing…</p>}

          {stage === 'error' && (
            <div className="space-y-3">
              <p className="text-red-400 text-sm text-center">{error || 'Something went wrong.'}</p>
              <button
                type="button"
                onClick={() => setStage('confirm')}
                className="w-full bg-white/10 text-white font-semibold text-sm rounded-lg py-2.5"
              >
                Try again
              </button>
            </div>
          )}

          {stage === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 size={40} className="text-green-400" />
              <p className="text-white font-semibold text-sm">
                {orders.length > 1 ? `${orders.length} orders placed` : 'Order placed'}
              </p>

              {adminOrder && (
                <div className="w-full bg-white/5 rounded-lg p-3 text-center space-y-1">
                  <p className="text-white text-xs font-medium">Payment confirmed — card ending {cardLast4}</p>
                  <p className="text-white/50 text-[11px]">We'll prepare your order for delivery to {deliveryAddress}.</p>
                </div>
              )}

              {marketplaceOrders.map((o) => (
                <div key={o.orderId} className="w-full bg-white/5 rounded-lg p-3 space-y-1">
                  <p className="text-white text-xs font-medium">Order #{o.orderNumber || o.orderId}</p>
                  <p className="text-white/50 text-[11px]">Sold by {o.sellerName || 'a Piitrade marketplace seller'}</p>
                  {o.sellerContact ? (
                    <a
                      href={isEmailLike(o.sellerContact) ? `mailto:${o.sellerContact}` : `tel:${o.sellerContact.replace(/[^\d+]/g, '')}`}
                      className="flex items-center gap-1.5 text-brand-cyan text-[11px]"
                    >
                      {isEmailLike(o.sellerContact) ? <Mail size={12} /> : <Phone size={12} />}
                      {o.sellerContact}
                    </a>
                  ) : (
                    <p className="text-white/40 text-[11px]">No direct contact on file — use Piitrade's cart below to reach them.</p>
                  )}
                </div>
              ))}

              {/* Items from different sellers are placed as separate orders (the
                  marketplace requires every item in one order to share a seller) —
                  if one seller's group failed, the rest still succeeded, so this
                  is a partial-failure notice rather than a hard error. */}
              {failedItems.length > 0 && (
                <p className="text-yellow-400 text-xs text-center">
                  {failedItems.length} item{failedItems.length === 1 ? '' : 's'} could not be ordered and{' '}
                  {failedItems.length === 1 ? 'was' : 'were'} left in your cart.
                </p>
              )}
              {redirectUrl && (
                <>
                  <a
                    href={redirectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-1.5 bg-brand-pink text-white font-semibold text-sm rounded-lg py-2.5 mt-2"
                  >
                    <ExternalLink size={14} /> Complete on Piitrade
                  </a>
                  <p className="text-white/40 text-[11px] text-center">
                    Opens Piitrade's cart in a new tab — this app stays open. Piitrade uses meet-in-person/cash-on-delivery,
                    so you'll arrange payment with the seller there.
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={() => onComplete(failedItems.map((i) => i.productId))}
                className="w-full bg-blue-600 text-white font-semibold text-sm rounded-lg py-2.5"
              >
                Continue watching
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
