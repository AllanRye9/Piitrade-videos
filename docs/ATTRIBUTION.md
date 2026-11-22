# Attribution and creator payouts

Every outbound product tap is logged, and shops report sales back so creators can be paid.

## Flow

1. A viewer taps a product chip (or a "Find on Piitrade" result). The tap goes through `GET /go/:videoId/:productId` (web, embeds) or `POST /api/attribution/click` (the app), which logs a click and returns/redirects to the product URL with
   `utm_source=piitrade_videos&utm_medium=video&utm_campaign=<videoId>&pv_click=<token>`.
2. Your shop stores `pv_click` with the visitor's session/order (cookie, cart attribute, order meta).
3. When the order is placed/paid, your server POSTs the conversion (below).
4. A ledger entry for `amount × commission%` is created for the video's creator (status `pending`). Admins move it `pending → approved → paid` (or `reversed`) in **Admin → Payouts**. Creators see their balance in the app (Settings → Earnings).

Clicks older than 30 days can't earn a commission. A creator buying through their own link is recorded but earns nothing. Repeat taps within 10 s are one click.

**Saves.** In the app, tapping a product tag first *saves* it (no navigation, video keeps playing); the viewer opens it later from Saved items, and that tap is the click above. Saves are reported per shop in Admin → Attribution as an early interest signal, before any click or sale.

## Conversion postback

```
POST {PUBLIC_WEB_URL}/api/attribution/conversion
Content-Type: application/json
X-Piitrade-Site:      <shop slug>
X-Piitrade-Timestamp: <unix time in milliseconds>
X-Piitrade-Signature: <hex HMAC-SHA256 of "<timestamp>.<raw request body>" with the shop's postback secret>

{ "clickToken": "<pv_click value>", "orderId": "ORD-1001", "amount": 50000, "currency": "UGX" }
```

* `amount` is the order value in major units (50000 = UGX 50,000). Positive number.
* **Idempotent** per `(shop, orderId)`: re-sending returns `200 {"duplicate": true}` and changes nothing, so retry freely.
* `201` = recorded (`credited` tells you whether a commission entry was created). `401` bad signature/stale timestamp (±5 min). `404` unknown click token. `422` click outside the 30-day window.
* The secret is shown once in Admin → Shops (reveal or rotate later; rotating invalidates the old one at once).

### Signing examples

Node:
```js
const crypto = require('crypto');
const ts = String(Date.now());
const body = JSON.stringify({ clickToken, orderId, amount, currency });
const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-piitrade-site': SLUG, 'x-piitrade-timestamp': ts, 'x-piitrade-signature': sig }, body });
```

PHP:
```php
$ts = (string) round(microtime(true) * 1000);
$body = json_encode(['clickToken' => $token, 'orderId' => $order, 'amount' => $amount, 'currency' => 'UGX']);
$sig = hash_hmac('sha256', $ts . '.' . $body, $secret);
```

Sign the exact bytes you send.

## Privacy

Clicks store only salted one-way hashes of the viewer's session id and IP address (never the raw values) plus the destination URL and video. No device identifiers. Suggested retention: delete clicks with no conversion after 90 days. Mention click tracking in your privacy policy, and obtain consent where your jurisdiction requires it for the shop-side `pv_click` cookie.

Set `ATTRIBUTION_SALT` in production (defaults to `JWT_SECRET`). Changing it makes old hashes unmatchable.

## Ranking

A video's trending score is multiplied by a conversion factor between 0.8× and 1.5×, computed from a smoothed click→sale rate (a new video with no data is neutral, so one lucky sale can't dominate).
