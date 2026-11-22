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

## Product pages

Each listing must have a public page at a URL on the shop's registered website host (e.g. `https://shop.example.com/listings/<id>`). Links to hosts that aren't registered are rejected everywhere (pinning, redirect, embeds).

## Reporting sales (optional, enables creator commission)

See [ATTRIBUTION.md](ATTRIBUTION.md): add the `pv_click` token to your order, and POST a signed conversion back.

## Validate from the command line

```bash
curl -s "https://api.shop.example.com/api/listings?q=sofa&sort=relevance&limit=3" | jq '.listings[0] | {id, title, price}'
```
