# Embeds and distribution

## Embed a video
```html
<iframe src="https://YOUR-SITE/embed/VIDEO_ID" width="360" height="640" style="border:0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
```
Autoplays muted, loops, shows the product chips in their time windows. Chip taps go through the attribution redirect. No sign-in, no cookies, no third-party scripts. Restrict who may frame it with `EMBED_FRAME_ANCESTORS` (default `*`).

## oEmbed
`GET /api/oembed?url=https://YOUR-SITE/v/VIDEO_ID&maxwidth=…&maxheight=…&format=json` returns a standard `video` response. Permalink pages advertise it with `<link rel="alternate" type="application/json+oembed">`, so pasting a video link into an oEmbed-aware editor embeds the player.

## Shop widget
Add once to a product page:
```html
<div data-piitrade-videos data-limit="3"></div>
<script async src="https://YOUR-SITE/embed.js"></script>
```
It shows creator videos whose pinned product matches the page (`data-product-url` or the page's canonical URL; tracking parameters are ignored). Clicks appear in Admin → Attribution.

## Permalink
`/v/:id` is server-rendered with Open Graph/Twitter player tags and `VideoObject` JSON-LD (including the pinned products) so shared links unfurl and rank.

## Deploy
Route `/go/*`, `/embed/*`, `/v/*` and `/embed.js` to the backend (done in `frontend/nginx.conf` and `vercel.json`).
