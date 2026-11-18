# Piitrade Videos for WooCommerce

A small plugin that connects a WooCommerce store to a Piitrade Videos network. It implements the contract in [`docs/OPEN_SHOP_SPEC.md`](../../docs/OPEN_SHOP_SPEC.md):

1. **Listing API**: `GET /wp-json/piitrade/v1/api/listings?q=` so viewers can find your products.
2. **Click capture**: remembers `?pv_click=` (30-day cookie) and keeps it on the order.
3. **Sale reports**: on payment, sends a signed conversion; refunds/cancellations send a reversal.

## Install
1. Copy `piitrade-videos.php` into `wp-content/plugins/piitrade-videos/` and activate it.
2. In the Videos admin → **Sites**, add your store: *API address* `https://YOUR-STORE/wp-json/piitrade/v1`, type `piitrade`, listing path `/?p={id}`, search path `/?s={q}&post_type=product`. Set a commission % and copy the **slug** and **postback secret**.
3. WordPress → Settings → **Piitrade Videos**: paste the videos site URL, slug and secret.
4. Optional: add `[the widget snippet]` from the spec to product pages.

Shipping is excluded from the reported amount. Status: draft against the spec, **not yet tested on a live WooCommerce store**: try it on staging first.
