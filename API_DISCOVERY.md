## Selected source

- Endpoint: the user-supplied Hellotickets URL
- Method: `GET`
- Supported URL types: city pages, category pages, event pages, venue pages, performer pages, lineup pages, and Hellotickets search URLs.
- Authentication: none for direct requests; an Apify or custom proxy can be supplied when the origin is challenged.
- Client: one shared Impit instance using the Chrome browser profile.
- Payload: `window.__NUXT__` embedded in the server-rendered page.

## Page payload coverage

The actor inspects the Nuxt payload for the structures exposed by the supplied URL:

- `data[0].topSubcategories` for city and catalog pages, including nested aliases and product fields.
- `data[0].event` for event pages.
- `data[0].performancesList.items` for venue and performer pages.
- `data[0].layoutAttributes.events` for lineup and category pages.
- `data[0].searchItems`, `relatedEvents`, and `relatedMatches` when available on search and related-content pages.

All supported page structures are normalized into the existing dataset field names. The actor requests only the submitted URL and does not scan the worldwide city directory.

## Request requirements

- Impit's coherent Chrome TLS and HTTP profile is used without manual fingerprint headers.
- The submitted URL origin is sent as `Referer` and `Origin`.
- `proxyConfiguration` is optional and can provide Apify Proxy or custom proxy URLs when Hellotickets blocks the direct cloud origin.
- Retries are bounded for `429`, `5xx`, and network failures. Permanent `4xx` responses fail quickly instead of triggering repeated requests.

## Historical endpoint findings


- The previous worldwide directory fallback was removed because it caused long runs and unnecessary catalog requests when a user supplied a search or category URL.
- City-page Nuxt payloads remain the richest source for city/catalog URLs, while the additional page structures above provide direct extraction for other URL types.

## Implementation notes

- `startUrl` is normalized and validated as an HTTP(S) Hellotickets URL.
- The parser derives context from any URL path without requiring a `/c-<cityId>` segment.
- Results are deduplicated by stable alias ID, listing ID, or normalized product URL.

- An empty result is treated as an error rather than a successful empty run.
