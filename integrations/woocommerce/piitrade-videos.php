<?php
/**
 * Plugin Name: Piitrade Videos for WooCommerce
 * Description: Connects a WooCommerce store to a Piitrade Videos network: exposes the listing API, remembers which video sent a visitor, and reports paid orders so creators are credited. See docs/OPEN_SHOP_SPEC.md.
 * Version: 0.1.0
 * Requires Plugins: woocommerce
 * License: MIT
 *
 * NOTE: written against the open spec; not yet run against a live WooCommerce install. Test on staging first.
 */

if (!defined('ABSPATH')) exit;

const PIITRADE_VIDEOS_OPT = 'piitrade_videos_settings';

function piitrade_videos_settings() {
    return wp_parse_args(get_option(PIITRADE_VIDEOS_OPT, array()), array(
        'videos_url' => '',   // e.g. https://videos.example.com
        'site_slug'  => '',   // the slug shown in Admin -> Sites
        'secret'     => '',   // the postback secret shown there
    ));
}

/* ---- 1. Listing API:  GET /wp-json/piitrade/v1/listings ---------------------------------- */
/* Register the API address as  https://YOUR-STORE/wp-json/piitrade/v1  and set the link patterns
   to "/?p={id}" (product page) and "/?s={q}&post_type=product" (search). */
add_action('rest_api_init', function () {
    register_rest_route('piitrade/v1', '/api/listings', array(
        'methods'  => 'GET',
        'permission_callback' => '__return_true',
        'callback' => function (WP_REST_Request $req) {
            $q = sanitize_text_field((string) $req->get_param('q'));
            $limit = max(1, min(12, (int) $req->get_param('limit') ?: 12));
            $products = wc_get_products(array('status' => 'publish', 's' => $q, 'limit' => $limit, 'orderby' => 'relevance'));
            $listings = array();
            foreach ($products as $p) {
                $img = wp_get_attachment_image_url($p->get_image_id(), 'large');
                $listings[] = array(
                    'id'          => (string) $p->get_id(),
                    'title'       => $p->get_name(),
                    'description' => wp_strip_all_tags($p->get_short_description()),
                    'price'       => (float) $p->get_price(),
                    'currency'    => get_woocommerce_currency(),
                    'status'      => $p->is_in_stock() ? 'ACTIVE' : 'SOLD',
                    'productImages' => $img ? array(array('cdnUrl' => $img)) : array(),
                    'originalPrice' => $p->is_on_sale() ? (float) $p->get_regular_price() : null,
                );
            }
            return new WP_REST_Response(array('listings' => $listings));
        },
    ));
});

/* ---- 2a. Remember the click -------------------------------------------------------------- */
add_action('init', function () {
    if (empty($_GET['pv_click'])) return;
    $token = sanitize_text_field(wp_unslash($_GET['pv_click']));
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $token)) return;
    setcookie('pv_click', $token, array('expires' => time() + 30 * DAY_IN_SECONDS, 'path' => '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax'));
    $_COOKIE['pv_click'] = $token;
});

/* Keep the token with the order so it survives until payment (and for refunds). */
add_action('woocommerce_checkout_create_order', function ($order) {
    if (!empty($_COOKIE['pv_click'])) {
        $token = sanitize_text_field(wp_unslash($_COOKIE['pv_click']));
        if (preg_match('/^[A-Za-z0-9_-]{8,64}$/', $token)) $order->update_meta_data('_pv_click', $token);
    }
});

/* ---- 2b. Report paid orders, and refunds ------------------------------------------------- */
function piitrade_videos_post($payload) {
    $s = piitrade_videos_settings();
    if (!$s['videos_url'] || !$s['site_slug'] || !$s['secret']) return;
    $body = wp_json_encode($payload);
    wp_remote_post(trailingslashit($s['videos_url']) . 'api/attribution/conversion', array(
        'timeout' => 10,
        'headers' => array(
            'Content-Type'          => 'application/json',
            'X-Piitrade-Site'       => $s['site_slug'],
            'X-Piitrade-Signature'  => 'sha256=' . hash_hmac('sha256', $body, $s['secret']),
        ),
        'body' => $body,
    ));
}

add_action('woocommerce_payment_complete', function ($order_id) {
    $order = wc_get_order($order_id);
    if (!$order) return;
    $token = $order->get_meta('_pv_click');
    if (!$token) return;
    piitrade_videos_post(array(
        'click' => $token,
        'orderId' => (string) $order->get_order_number(),
        'amount' => (float) $order->get_total() - (float) $order->get_total_shipping(),
        'currency' => $order->get_currency(),
    ));
});

foreach (array('woocommerce_order_status_refunded', 'woocommerce_order_status_cancelled') as $hook) {
    add_action($hook, function ($order_id) {
        $order = wc_get_order($order_id);
        $token = $order ? $order->get_meta('_pv_click') : '';
        if ($token) piitrade_videos_post(array('click' => $token, 'orderId' => (string) $order->get_order_number(), 'status' => 'reversed'));
    });
}

/* ---- Settings page ----------------------------------------------------------------------- */
add_action('admin_menu', function () {
    add_options_page('Piitrade Videos', 'Piitrade Videos', 'manage_options', 'piitrade-videos', function () {
        if (!current_user_can('manage_options')) return;
        if (isset($_POST['pv_save']) && check_admin_referer('pv_save')) {
            update_option(PIITRADE_VIDEOS_OPT, array(
                'videos_url' => esc_url_raw(wp_unslash($_POST['videos_url'] ?? '')),
                'site_slug'  => sanitize_title(wp_unslash($_POST['site_slug'] ?? '')),
                'secret'     => sanitize_text_field(wp_unslash($_POST['secret'] ?? '')),
            ));
            echo '<div class="updated"><p>Saved.</p></div>';
        }
        $s = piitrade_videos_settings();
        echo '<div class="wrap"><h1>Piitrade Videos</h1><form method="post">';
        wp_nonce_field('pv_save');
        echo '<table class="form-table">';
        echo '<tr><th>Videos site URL</th><td><input name="videos_url" class="regular-text" value="' . esc_attr($s['videos_url']) . '" placeholder="https://videos.example.com"></td></tr>';
        echo '<tr><th>Site slug</th><td><input name="site_slug" class="regular-text" value="' . esc_attr($s['site_slug']) . '"></td></tr>';
        echo '<tr><th>Postback secret</th><td><input name="secret" type="password" class="regular-text" value="' . esc_attr($s['secret']) . '" autocomplete="off"></td></tr>';
        echo '</table><p><button class="button button-primary" name="pv_save" value="1">Save</button></p></form>';
        echo '<p>API address to register in Admin &rarr; Sites: <code>' . esc_html(rest_url('piitrade/v1')) . '</code></p></div>';
    });
});
