# Hellotickets Listings Scraper

Extract tours, attraction tickets, city passes, and experience listings from Hellotickets city and category pages. Collect pricing, ratings, durations, ticket features, and source context in one structured dataset. Use it for travel market research, catalog monitoring, and competitive analysis.

## Features

- **City and category coverage** - Scrapes listing data from Hellotickets destination and category pages.
- **Broader discovery** - Automatically expands related collections to find additional unique listings.
- **Rich listing fields** - Captures pricing, ratings, reviews, duration, ticket attributes, and provider info.
- **Clean deduplicated output** - Merges repeated items and removes empty fields before saving.
- **Production-ready input** - Works with simple input and scales with larger `results_wanted` targets.

## Use Cases

### Travel Market Research
Track what experiences are offered in each destination and compare pricing, ratings, and review volume over time.

### Competitor Intelligence
Monitor how product mix changes across cities and identify which tours or attractions are prioritized.

### Catalog Enrichment
Build clean structured datasets for internal travel tools, landing pages, destination guides, or partner research.

### Promotion Monitoring
Watch shifts in surfaced tours and passes to identify seasonal trends and fast-moving offers.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `https://www.hellotickets.com/us/new-york/c-1?qs=New%20York` | Hellotickets city or category page URL to start from. |
| `results_wanted` | Integer | No | `20` | Maximum number of unique listings to store. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": false}` | Optional proxy settings for more stable repeated runs. |

---

## Output Data

Each dataset item may include the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | Integer | Internal listing identifier. |
| `alias_id` | Integer | Stable alias identifier when available. |
| `code` | String | Listing or supplier code. |
| `title` | String | Listing title. |
| `origin_title` | String | Original title from source data. |
| `short_description` | String | Clean text description. |
| `price` | Number | Displayed listing price. |
| `price_eur` | Number | Euro-converted price when available. |
| `currency_code` | String | Currency code for `price`. |
| `rating` | Number | Average rating. |
| `review_count` | Integer | Number of reviews. |
| `image_url` | String | Primary listing image URL. |
| `product_url` | String | Absolute listing URL. |
| `duration` | String | Experience duration text. |
| `offered_languages` | Array | Offered language labels. |
| `merchant_cancellable` | Boolean | Merchant cancellation flag. |
| `cancellation_type` | Integer | Cancellation type code. |
| `skip_line` | Boolean | Skip-the-line indicator. |
| `smartphone_ticket` | Boolean | Mobile ticket indicator. |
| `wheelchair_access` | Boolean | Accessibility indicator. |
| `instant_ticket_delivery` | Boolean | Instant delivery indicator. |
| `is_open` | Boolean | Availability/open indicator. |
| `is_free_product` | Boolean | Free product indicator. |
| `is_grouped_tour` | Boolean | Group tour indicator. |
| `service` | String | Provider/service label. |
| `source_section` | String | Main section where listing was found. |
| `source_sections` | Array | All sections where listing appeared. |
| `source_collection_id` | Integer | Parent collection identifier. |
| `source_collection_title` | String | Parent collection title. |
| `source_collection_url` | String | Parent collection URL. |
| `source_collection_description` | String | Parent collection description text. |
| `city_id` | String | City identifier. |
| `locale` | String | Locale inferred from URL. |
| `page_url` | String | Source page URL. |
| `page_title` | String | Source page title. |

---

## Usage Examples

### Basic Run

```json
{
  "startUrl": "https://www.hellotickets.com/us/new-york/c-1?qs=New%20York",
  "results_wanted": 20
}
```

### Larger Collection Run

```json
{
  "startUrl": "https://www.hellotickets.com/united-kingdom/london/c-2?qs=London",
  "results_wanted": 200
}
```

### Reliable Scheduled Run With Proxy

```json
{
  "startUrl": "https://www.hellotickets.com/us/new-york/c-1?qs=Broadway",
  "results_wanted": 300,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

---

## Sample Output

```json
{
  "id": 60277,
  "alias_id": 10544,
  "code": "1092570",
  "title": "New York The Edge Skip the Line Tickets",
  "origin_title": "Edge NYC: Express Pass",
  "short_description": "Get fast-track access to The Edge Observatory in New York and enjoy panoramic views from Hudson Yards.",
  "price": 99,
  "price_eur": 86,
  "currency_code": "USD",
  "rating": 4.7,
  "review_count": 1328,
  "image_url": "https://aws-tiqets-cdn.imgix.net/images/content/61fc54cd909249899d6378ca5eb3db51.jpeg",
  "product_url": "https://www.hellotickets.com/us/new-york/edge-skip-the-line-tickets/a/pa-10544",
  "merchant_cancellable": true,
  "cancellation_type": 1,
  "skip_line": false,
  "smartphone_ticket": true,
  "wheelchair_access": true,
  "instant_ticket_delivery": true,
  "service": "tiqets",
  "source_section": "top_subcategories_api",
  "source_sections": ["search_items", "top_subcategories_api"],
  "source_collection_title": "Edge NYC Tickets and Tours",
  "city_id": "1",
  "locale": "us",
  "page_url": "https://www.hellotickets.com/us/new-york/c-1?qs=New%20York",
  "page_title": "Tickets and tours in New York"
}
```

---

## Tips For Best Results

### Use High-Intent Destination URLs

- Start from city/category pages that already display listing cards.
- Keep locale and city path consistent with your target market.

### Set Realistic Targets

- Increase `results_wanted` only as high as the source inventory allows.
- Some cities naturally expose fewer unique listings than others.

### Run Keyword Variants

- Test multiple `qs` values on the same city URL to compare surfaced inventory.
- Keep the same base city path to preserve destination consistency.

### Use Proxies For Repeat Jobs

- Enable proxy usage for scheduled runs and larger workloads.
- Residential groups can improve stability when running frequently.

---

## Integrations

Connect this dataset with:

- **Google Sheets** - Tabular analysis and quick sharing.
- **Airtable** - Searchable travel catalog management.
- **Make** - Automated destination monitoring workflows.
- **Zapier** - Trigger notifications and downstream actions.
- **Webhooks** - Push data into custom systems.

### Export Formats

- **JSON** - API and engineering workflows.
- **CSV** - Spreadsheet analysis.
- **Excel** - Business reporting.
- **XML** - Legacy system integrations.

---

## Frequently Asked Questions

### Why does one city return fewer items than another?

Each city page has its own available catalog. If the source exposes only a limited number of unique listings, the dataset will stop growing even with higher `results_wanted`.

### Does changing `qs` always increase item count?

Not always. Some city pages return similar inventory across different keywords, while others vary more.

### Are duplicates removed?

Yes. The actor merges repeated listings discovered in multiple sections into one final item.

### Are empty fields included?

No. Empty and null values are removed before items are stored.

### Can I run this on schedules?

Yes. This actor is suitable for scheduled monitoring runs and can be connected to downstream integrations.

---

## Support

For bug reports or feature requests, use the Apify Console issue and feedback channels for this actor.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/platform/schedules)

---

## Legal Notice

Use this actor only for legitimate data collection. You are responsible for compliance with website terms and applicable laws in your jurisdiction.
