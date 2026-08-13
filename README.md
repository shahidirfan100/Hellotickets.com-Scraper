## What does Hellotickets Listings Scraper do?

Hellotickets Listings Scraper collects structured tours, attraction tickets, city passes, and other travel experiences from public Hellotickets city and category pages. Provide one Hellotickets listing URL and choose the maximum number of records to save. The result is a clean dataset with titles, prices, currencies, ratings, review counts, durations, ticket features, provider information, and source context.

Use the dataset for travel market research, destination catalog building, experience comparison, price tracking, content planning, and recurring checks of public listings. The Actor also discovers related collections from the selected page, which helps find more unique experiences than the first visible group of listings alone.

## Why use Hellotickets Listings Scraper?

- **Destination research** - Compare the tours and attraction tickets available in New York, London, and other Hellotickets destinations.
- **Structured travel data** - Receive consistent fields for listing identity, pricing, reviews, duration, languages, ticket options, and accessibility.
- **Catalog monitoring** - Repeat runs to identify new listings, changed prices, updated ratings, or shifts in the experiences shown for a destination.
- **Clean results** - Repeated appearances of the same experience are combined, and empty values are left out of saved records.
- **Flexible collection size** - Use a small target for a quick check or a larger target for destination-level research.
- **Workflow-ready exports** - Download results as JSON, CSV, Excel, or XML, or connect completed runs to other services through Apify integrations.

## What data can you extract from Hellotickets?

Each dataset item represents one unique Hellotickets experience. The exact fields depend on the information published for that listing.

| Field | Type | Description |
|-------|------|-------------|
| `id` | Integer | Internal listing identifier when available. |
| `alias_id` | Integer | Stable experience alias identifier when available. |
| `code` | String | Listing or supplier code. |
| `title` | String | Experience or ticket title. |
| `origin_title` | String | Original title supplied by the source. |
| `short_description` | String | Short plain-text description. |
| `price` | Number | Displayed price for the listing. |
| `price_eur` | Number | Euro-converted price when available. |
| `currency_code` | String | Currency code associated with `price`. |
| `rating` | Number | Average customer rating. |
| `review_count` | Integer | Number of reviews. |
| `image_url` | String | Main image URL for the listing. |
| `product_url` | String | Direct Hellotickets experience URL. |
| `duration` | String | Duration shown for the experience. |
| `offered_languages` | Array | Languages offered for the experience. |
| `merchant_cancellable` | Boolean | Whether the merchant marks the listing as cancellable. |
| `cancellation_type` | Integer | Cancellation type code when available. |
| `skip_line` | Boolean | Whether skip-the-line access is indicated. |
| `smartphone_ticket` | Boolean | Whether a smartphone ticket is supported. |
| `wheelchair_access` | Boolean | Whether wheelchair access is indicated. |
| `instant_ticket_delivery` | Boolean | Whether instant ticket delivery is indicated. |
| `is_open` | Boolean | Availability or open-status indicator. |
| `is_free_product` | Boolean | Whether the listing is marked as free. |
| `is_grouped_tour` | Boolean | Whether the listing is marked as a group tour. |
| `service` | String | Provider or service label. |
| `source_section` | String | Main page section where the listing was found. |
| `source_sections` | Array | All page sections where the listing appeared. |
| `source_collection_id` | Integer | Parent collection identifier when available. |
| `source_collection_title` | String | Parent collection title. |
| `source_collection_url` | String | Parent collection URL. |
| `source_collection_description` | String | Parent collection description. |
| `city_id` | String | Hellotickets city identifier. |
| `locale` | String | Locale inferred from the submitted URL. |
| `page_url` | String | Page used to start the collection. |
| `page_title` | String | Title of the source page. |

## How to use Hellotickets Listings Scraper

1. Open a public Hellotickets city or category page that contains the experiences you want to collect.
2. Copy the complete page URL.
3. Open this Actor in Apify and paste the URL into `startUrl`.
4. Set `results_wanted` to the maximum number of unique listings you want.
5. Run the Actor and review the dataset preview.
6. Download the results or connect the dataset to your research, reporting, or automation workflow.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `https://www.hellotickets.com/us/new-york/c-1?qs=New%20York` | Public Hellotickets city or category page URL to start from. |
| `results_wanted` | Integer | No | `20` | Maximum number of unique tour, ticket, pass, or experience listings to save. Minimum value is `1`. |

The Actor accepts one `startUrl` per run. To collect several destinations, create separate runs or schedules with a different URL for each destination.

## Output Data

The default dataset contains one JSON object per unique listing. Fields that are not available on the source page are omitted from that item rather than saved as empty values. This keeps the dataset easier to filter and use in spreadsheets, databases, and downstream applications.

## Usage Examples

### Basic New York Collection

Collect up to 20 unique listings from a New York city page.

```json
{
  "startUrl": "https://www.hellotickets.com/us/new-york/c-1?qs=New%20York",
  "results_wanted": 20
}
```

### Keyword-Focused Collection

Use the Hellotickets query string to collect listings surfaced for a specific interest, such as Broadway experiences.

```json
{
  "startUrl": "https://www.hellotickets.com/us/new-york/c-1?qs=Broadway",
  "results_wanted": 50
}
```

### Larger London Collection

Increase the result target when you are building a broader destination catalog.

```json
{
  "startUrl": "https://www.hellotickets.com/united-kingdom/london/c-2?qs=London",
  "results_wanted": 200
}
```

## Sample Output

This example shows one realistic dataset item. Some optional fields may be omitted when Hellotickets does not publish them.

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
  "duration": "Flexible entry",
  "offered_languages": ["English"],
  "merchant_cancellable": true,
  "cancellation_type": 1,
  "skip_line": false,
  "smartphone_ticket": true,
  "wheelchair_access": true,
  "instant_ticket_delivery": true,
  "is_open": true,
  "is_grouped_tour": false,
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

## Tips for best results

- **Start with a listing page** - Use a city or category URL that visibly contains tours, tickets, passes, or other experiences.
- **Keep the URL complete** - Preserve the locale, city path, category path, and any `qs` query that defines the collection you want.
- **Test with a small target** - Start with `results_wanted: 20` and inspect the dataset before requesting a larger collection.
- **Match the target to the destination** - Smaller destinations may contain fewer unique experiences than major travel markets.
- **Use query variations carefully** - Different `qs` values can surface different experiences, but similar queries may return overlapping listings.
- **Schedule destination checks** - Recurring runs are useful for tracking changes in prices, ratings, review counts, and visible inventory.

## Integrations and export formats

- **Google Sheets** - Review prices, ratings, and destination coverage in a shared spreadsheet.
- **Airtable** - Build a searchable experience catalog with views for cities, providers, or ticket features.
- **Make and Zapier** - Start follow-up actions after a run completes.
- **Webhooks** - Send completed run notifications or dataset information to another application.
- **API access** - Retrieve run and dataset data from your own applications through Apify.

| Format | Useful for |
|--------|------------|
| JSON | APIs, data processing, and application workflows |
| CSV | Spreadsheet analysis and quick review |
| Excel | Reporting and business analysis |
| XML | Systems that require XML exports |

## Frequently Asked Questions

### Can I collect tours and attraction tickets from any Hellotickets destination?

Yes. Use a public Hellotickets city or category page as `startUrl`. The available records depend on the destination, category, and listings published on that page.

### Can I search with a keyword?

Yes. When Hellotickets supports a query in the page URL, include the `qs` value in `startUrl`, such as `?qs=Broadway` or `?qs=New%20York`.

### Why did the Actor return fewer records than `results_wanted`?

The destination may have fewer unique public listings than the requested limit, or the selected category and query may be narrow. Try a broader city or category page and compare the available inventory.

### Are duplicate listings removed?

Yes. When the same experience appears in more than one section or related collection, the Actor combines it into one dataset item and retains the available source context.

### Can I export the dataset to CSV or Excel?

Yes. Apify supports JSON, CSV, Excel, XML, and other dataset export options from the run results.

### Can I schedule recurring runs?

Yes. Apify Schedules can run the Actor daily, weekly, or at a custom interval for destination and catalog monitoring.

### Why are some fields missing?

Fields are omitted when the source listing does not provide that information. Check several records before treating an optional field as required for your workflow.

### Is collecting Hellotickets data legal?

You are responsible for complying with Hellotickets terms, applicable laws, privacy requirements, and any restrictions that apply to your use of the collected data. Collect only information you are permitted to use and respect the source website's rules.

## Related Actors

- [Feverup Event Scraper](https://apify.com/shahidirfan/feverup-event-scraper) - Collect event listings, prices, dates, venues, ratings, and direct links from Feverup category pages.
- [Eventbrite Scraper](https://apify.com/shahidirfan/eventbrite-scraper) - Extract public Eventbrite event listings with dates, locations, categories, prices, and ticket URLs.
- [Ticketmaster Event Scraper](https://apify.com/shahidirfan/ticketmaster-event-scraper) - Collect public Ticketmaster event data with dates, venues, availability, and artist information.

## Support

For a bug report or feature request, use the Issues tab on the Actor page in Apify Console. Include the input URL, the expected result, and a short description of what happened so the issue can be investigated efficiently.

## Legal Notice

This Actor is intended for legitimate collection of publicly available Hellotickets listing data. You are responsible for complying with website terms, applicable laws, privacy rules, and any agreements governing how you access, store, analyze, or redistribute the data.
