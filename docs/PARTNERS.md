# Partners: connect your shop or app

Piitrade Videos promotes the shops and apps that connect to it. Once you are a partner:

* your products appear in **video search** and in **"Find in shops"** results next to Piitrade's,
* creators can **pin your products** inside their videos and viewers can save them,
* every tap goes through the attribution redirect, so you see which videos send you traffic,
* if you report sales, the creator whose video sent the buyer earns your commission.

## 1. Expose the listing API
`GET {apiBase}/api/listings?q=<text>&sort=relevance&limit=<n>&country=<ISO>` → `{ "listings": [ { "id", "title", "price", … } ] }`.
Full contract: [LISTING_SPEC.md](LISTING_SPEC.md). `GET /api/partners/spec` returns a short machine-readable summary.

## 2. Apply
Either use the form at **`/partners`** or call the API:

```bash
curl -s -X POST https://api.yotweek.com/api/partners/apply \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Shop","baseUrl":"https://acme.example.com","apiBase":"https://api.acme.example.com",
       "contactEmail":"owner@acme.example.com","country":"UG","currency":"UGX"}'
```

* The server **calls your `apiBase` and validates the response against the spec before queueing anything.**
  If it fails you get `422 {"code":"API_CHECK_FAILED","check":{"issues":[…]}}` listing exactly what to fix; nothing is stored.
* `baseUrl` and `apiBase` must be public `http(s)` URLs (private/loopback/link-local hosts are refused). Redirects are not followed.
* One pending application per website; a website that is already a partner is refused (`409`).
* `201` returns `{ application, statusToken, check }`. **The `statusToken` is shown once** (only its hash is stored): keep it.
* Limit: 6 applications per IP per hour.

## 3. Check your status and collect credentials
```bash
curl -s https://api.yotweek.com/api/partners/applications/<id> -H 'X-Application-Token: <statusToken>'
```
`status` is `pending`, `approved` or `rejected` (with the reviewer's note). When approved, the **first** call also returns
`credentials.postbackSecret`; later calls do not. If you lose it, an admin can rotate it (Admin → Shops).
A wrong id and a wrong token both answer `404`.

## 4. (Optional) Report sales
Send the `pv_click` token you received on the landing URL back with each order, signed with your postback secret.
See [ATTRIBUTION.md](ATTRIBUTION.md).

## For admins
**Admin → Partner applications** lists applications with the result of the check made at submission and a **Re-check now**
button. *Approve & connect* creates the shop (active, with the commission you choose, default 5%) and caches are refreshed
at once; *Reject* records a note the applicant can see. An application can be reviewed once (concurrent approvals are safe).
Permissions reuse `sites.view` / `sites.create` / `sites.edit`.
