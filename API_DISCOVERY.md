## Selected API

- Endpoint: `https://www.hellotickets.com/api/cities/:cityId/top-subcategories?carouselItemsAmount=12`
- Method: `GET`
- Auth: None
- Pagination: No explicit pagination on this endpoint. The actor combines it with page data and related collection-page expansion.
- Fields available: category id, category name, category URL, category image, category description, tours count, aliases, alias id, supplier code, title, origin title, short description, price, currency, rating, review count, images, product URL, duration, offered languages, cancellation flags, ticket features, service, price in EUR, and related status flags.
- Fields currently missing in the old actor: price, currency, rating, review count, duration, images, provider source, mobile ticket flag, instant delivery flag, cancellation flags, accessibility flag, source collection metadata, city id, locale, and merged section provenance.
- Field count: More than 25 useful listing-level fields versus 7 fields in the old Remote.co actor.

## Discovery Notes

- The target page exposes rich server-rendered data in `window.__NUXT__.data[0]`.
- Standard URL pagination parameters on the page URL did not advance the listing payload.
- The `/api/cities/:cityId/top-subcategories` endpoint returned a broad catalog of related attractions and their aliases without authentication.
- Because the page already contains `cityId`, the actor first reads the page context and then calls the selected endpoint for wider product coverage.
- The page payload remains the fallback source for featured search items and event collections.

## Selection Rationale

- Returns JSON directly: yes.
- Rich field coverage: yes, well above the minimum threshold.
- No authentication required: yes.
- Extends the actor meaningfully beyond the previous output: yes.
- Stable enough to combine with page context for a production run: yes.
