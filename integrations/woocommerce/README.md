# Yotweek for WooCommerce

A small plugin that connects a WooCommerce store to a Yotweek network. It implements the contract in [`docs/OPEN_SHOP_SPEC.md`](../../docs/OPEN_SHOP_SPEC.md):

1. **Listing API**: `GET /wp-json/yotweek/v1/api/listings?q=` so viewers can find your products.
2. **Click capture**: remembers `?yw_click=` (30-day cookie) and keeps it on the order.
3. **Sale reports**: on payment, sends a signed conversion; refunds/cancellations send a reversal.

## Install
1. Copy `yotweek.php` into `wp-content/plugins/yotweek/` and activate it.
2. In the Videos admin → **Sites**, add your store: *API address* `https://YOUR-STORE/wp-json/yotweek/v1`, type `piitrade`, listing path `/?p={id}`, search path `/?s={q}&post_type=product`. Set a commission % and copy the **slug** and **postback secret**.
3. WordPress → Settings → **Yotweek**: paste the videos site URL, slug and secret.
4. Optional: add `[the widget snippet]` from the spec to product pages.

Shipping is excluded from the reported amount. Status: draft against the spec, **not yet tested on a live WooCommerce store**: try it on staging first.
