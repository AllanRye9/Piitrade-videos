# Open listing spec: connect your shop

Any shop can be searched from Piitrade Videos by exposing one read-only endpoint. Register the shop in **Admin → Shops**, press **Test connection**, and the response is checked against this spec.

## Endpoint

```
GET {apiBase}/api/listings?q=<text>&sort=relevance&limit=<n>&country=<ISO-3166 alpha-2>
```

`q`, `sort`, `limit` are required to be accepted; `country` is only sent if you set one for the shop. The endpoint must be public (no login), return JSON, and answer within ~10 s.

## Response

```json
{
  "listings": [
    {
      "id": "abc123",
      "title": "Leather sofa, 3-seater",
      "price": 800000,
      "productImages": [{ "cdnUrl": "https://cdn.example.com/abc123.jpg" }]
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `listings` | yes | array (may be empty) |
| `listings[].id` | yes | string or number |
| `listings[].title` | yes | non-empty string |
| `listings[].price` | yes | number or string |
| `listings[].productImages[0].cdnUrl` or `listings[].images[0]` | recommended | absolute http(s) URL; a warning if missing |
| location, condition, seller/store name, verified badge, original price | optional | shown on the result card when present |
| `url` | optional | absolute product page URL, used as the result link **only if it is on the shop's registered host**; otherwise results open `{website}/listings/{id}` |
| `status` | optional | anything other than `ACTIVE` (e.g. `SOLD`) is hidden from results; absent = live |
| `currency` | optional | ISO code shown with the price; falls back to the currency set for the shop in Admin → Shops |

## Product pages

### How shops are searched

Every active shop with a listing API base is searched **in parallel** for each typed search, visual search and AI product suggestion. Results are merged one-from-each-shop in turn, so a large catalog cannot push the others off the first page. A shop that is down, slow (about 5 s per request, 8 s in total per search) or returns something unusable is skipped for that search and reported as unavailable; the others still answer. Requests to a shop do not follow redirects, and at most 8 shops are searched at once. Shops should keep `q` matching tolerant: the search retries a long phrase with shorter pieces of it until something matches, up to 10 requests per shop on a complete miss.

Each listing must have a public page at a URL on the shop's registered website host (e.g. `https://shop.example.com/listings/<id>`). Links to hosts that aren't registered are rejected everywhere (pinning, redirect, embeds).

## Reporting sales (optional, enables creator commission)

See [ATTRIBUTION.md](ATTRIBUTION.md): add the `pv_click` token to your order, and POST a signed conversion back.

## Validate from the command line

```bash
curl -s "https://api.shop.example.com/api/listings?q=sofa&sort=relevance&limit=3" | jq '.listings[0] | {id, title, price}'
```
