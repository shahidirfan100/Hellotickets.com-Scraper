## Selected API

## Broad destination discovery

- Endpoint: `https://www.hellotickets.com/api/cities?page=:page`
- Method: `GET`
- Response shape: `{ "cities": [...], "pagination": { "page": 1, "pageSize": 50, "total": ... } }`
- Use: Keyword-only and keyword-plus-location runs scan this worldwide directory progressively, starting with the most popular destinations and stopping after `results_wanted` matching listings are found.

- Endpoint: `https://www.hellotickets.com/api/cities/:cityId/top-subcategories?carouselItemsAmount=12`
- Method: `GET`
- Auth: None
- Pagination: No explicit page or cursor parameter. The response returns the top subcategories for the city and their aliases in one catalog response.
- Response shape: `{ "subcategories": [...], "totalCount": 0 }`
- Fields available on each alias: `id`, `aliasId`, `code`, `title`, `originTitle`, `shortDescription`, `price`, `currencyCode`, `rating`, `reviewCount`, `thumbnailHiResUrl`, `thumbnailUrl`, `url`, `duration`, `merchantCancellable`, `offeredLangs`, `feeTotalI18N`, `feePercentage`, `cancellationType`, `isProductOrAlias`, `isGroupedTour`, `skipLine`, `smartphoneTicket`, `wheelchairAccess`, `instantTicketDelivery`, `service`, `customSettings`, `slugExists`, `isOpen`, `isFreeProduct`, `subCategories`, `systemGroups`, and `priceInEUR`.
- Field count: More than 30 alias-level fields, compared with the smaller normalized output produced by the previous HTML-dependent implementation.
- Request requirements: A normal desktop browser user agent, `Accept: application/json`, `Accept-Language`, and the Hellotickets page as `Referer`. `useHeaderGenerator: false` and `http2: false` were reliable during direct tests.
- Browser fallback: Not required. The selected JSON endpoint works with direct HTTP requests when the request headers match the target website.

## Why the previous run succeeded with zero items

The previous implementation fetched an HTML page and depended on a specific `window.__NUXT__=` marker, then accepted a record only when its URL contained `/a/pa-`. That combination was fragile for two reasons:

1. Hellotickets can return a Cloudflare challenge page for some request profiles. The old code did not identify that response before attempting extraction.
2. The page payload contains ordinary event-style records such as `/sports/.../242` and `/concerts/.../294783`, while the old normalizer only accepted `/a/pa-` product URLs. Those records were discarded by design.

The previous code also treated the page payload as the main source even though the city endpoint returns the richer catalog of product aliases directly. A successful run could therefore finish without an exception and still save no records when the usable product collection was absent or filtered out.

## Discovery candidate matrix

| Candidate                                                | Header profile                                     | Status and body                                                                | Fields                                                | Pagination                      | Decision                                                                  |
| -------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `/api/cities/1/top-subcategories?carouselItemsAmount=12` | Desktop browser headers, JSON accept, page referer | HTTP 200, JSON, roughly 230-265 KB                                             | 30+ alias fields, 15 subcategories, about 110 aliases | No explicit pagination          | Selected                                                                  |
| Same city endpoint without browser headers               | Minimal/default request                            | Cloudflare challenge HTML in one direct probe                                  | 0 usable fields                                       | None                            | Rejected as an unreliable request profile                                 |
| Start page HTML and `window.__NUXT__`                    | Desktop browser headers                            | HTTP 200, roughly 1.2 MB HTML                                                  | Page context plus mixed products and events           | No usable page pagination found | Retained only as historical diagnosis, not used by the rewritten actor    |
| iOS Safari page bootstrap                                | Exact iOS Safari headers                           | HTTP 403 Cloudflare challenge                                                  | 0                                                     | None                            | Rejected                                                                  |
| Android app-style page request                           | `okhttp` and JSON accept                           | HTTP 200 HTML page, not JSON                                                   | No direct API payload                                 | None                            | Rejected                                                                  |
| URLScan public search                                    | `urlscan.io` public search                         | Domain scans were found, but result retrieval returned `You are not logged in` | Not available from the result API                     | Unknown                         | Used as a discovery check; direct endpoint validation selected the source |

## Selection rationale

- Returns JSON directly: yes.
- Rich field coverage: yes, with more than 30 useful alias-level fields.
- Authentication required: no.
- Matches the existing product fields: yes, including title, pricing, ratings, images, duration, cancellation, ticket, accessibility, provider, and source fields.
- More resilient than the old approach: yes. The actor can derive `cityId` from the supplied `/c-<id>` URL without parsing HTML.
- API score: 85 using the updater scoring criteria. It does not receive the pagination points because the selected endpoint has no explicit page or cursor control, but it exceeds the minimum score of 50.

## Implementation notes

- The rewritten actor derives the city ID and locale from `startUrl`.
- It calls the selected JSON endpoint directly and validates status, content type, and the `subcategories` response key.
- It traverses subcategory aliases and nested category data, removes null or empty values, and deduplicates by stable alias ID, listing ID, or normalized product URL.
- `keyword` filters title, original title, description, service, and collection context.
- `location` filters the supplied page URL, locale, page title, collection title, and listing URL context.
- Results are pushed in one validated batch after the requested limit is applied. An empty result is treated as an error with a diagnostic message rather than a successful empty run.
