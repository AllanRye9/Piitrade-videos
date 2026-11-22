# Embeds and distribution

## Embed a video
```html
<iframe src="https://YOUR-SITE/embed/VIDEO_ID" width="360" height="640" style="border:0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
```
Autoplays muted, loops, shows the product chips in their time windows. Chip taps go through the attribution redirect. No sign-in, no cookies, no third-party scripts. By default any site may frame it.

### Limiting where a video can be embedded
- **Per shop (Admin → Shops → "Allowed embed sites"):** list the sites (one per line, e.g. `https://blog.example.com` or `https://*.example.com`) that may embed videos carrying that shop's products. Leave it empty to allow anywhere. The shop's own website is always allowed, and so is this app. `*.example.com` covers subdomains only, not `example.com` itself. List entries are origins: no paths, and `https` and `http` are different sites.
- **Several shops on one video:** a site may embed it only if **every** shop with a list allows it (a shop with an empty list does not restrict). Pairing a video with an open shop never loosens another shop's list.
- **Whole deployment:** `EMBED_FRAME_ANCESTORS` (space or comma separated origins) narrows further for every video. Left unset or `*` it does nothing; a value with no valid origin fails closed to this app only.
- Changing a list takes effect within a minute (embed pages are cached for 60 s). Browsers enforce it: a blocked site shows an empty frame. It stops casual embedding, not someone who downloads the video file, which stays public like every video.

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
