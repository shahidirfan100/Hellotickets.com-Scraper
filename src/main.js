import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';

const PREFILLED_START_URL = 'https://www.hellotickets.com/us/new-york/c-1?qs=New%20York';
const CITIES_API_URL = 'https://www.hellotickets.com/api/cities';
const API_PAGE_SIZE = 12;
const API_MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const CITY_DIRECTORY_PAGE_SIZE = 50;
const BROAD_SEARCH_CONCURRENCY = 4;
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
];

await Actor.init();

const input = (await Actor.getInput()) || {};
const { startUrl = '', keyword = '', location = '', results_wanted: rawResultsWanted = 20 } = input;

const resultsWanted = normalizePositiveInteger(rawResultsWanted, 20);
const hasKeyword = hasValue(keyword);
const hasLocation = hasValue(location);
const hasNonPrefilledUrl = hasValue(startUrl) && !isPrefilledStartUrl(startUrl);
const useBroadSearch = hasKeyword || hasLocation;
const targetUrl = hasNonPrefilledUrl || !useBroadSearch
    ? normalizeHttpUrl(startUrl || PREFILLED_START_URL)
    : null;

try {
    const items = targetUrl
        ? await searchSingleCatalog(targetUrl, keyword, location, resultsWanted)
        : await searchBroadCatalog(keyword, location, resultsWanted);

    if (items.length === 0) {
        throw new Error(
            'The Hellotickets catalog returned no matching listings. Check the URL, keyword, or location filter.',
        );
    }

    await Actor.pushData(items);
    log.info(`Done | saved=${items.length}`);
} finally {
    await Actor.exit();
}

async function searchSingleCatalog(targetUrlValue, filterKeyword, filterLocation, limit) {
    const targetContext = parseTargetContext(targetUrlValue);
    log.info(`Start run | mode=url | target=${targetUrlValue} | results=${limit}`);

    const apiData = await fetchCityCatalog(targetContext);
    const records = extractRecords(apiData, targetContext);
    const filteredRecords = records
        .filter((record) => matchesKeyword(record, filterKeyword))
        .filter((record) => matchesLocation(record, filterLocation));

    log.info(`Catalog records=${records.length} | after_filters=${filteredRecords.length}`);
    return filteredRecords.slice(0, limit);
}

async function searchBroadCatalog(filterKeyword, filterLocation, limit) {
    log.info(
        `Start run | mode=broad | keyword=${String(filterKeyword || 'none')} | location=${String(
            filterLocation || 'worldwide',
        )} | results=${limit}`,
    );

    const firstPage = await fetchCitiesPage(1);
    const totalPages = Math.ceil(
        (firstPage.pagination?.total || firstPage.cities.length) /
            (firstPage.pagination?.pageSize || CITY_DIRECTORY_PAGE_SIZE),
    );
    const locationTerms = tokenize(filterLocation);
    const recordsByKey = new Map();
    let catalogsProcessed = 0;
    let duplicatesRemoved = 0;
    let citiesAvailable = 0;
    let citiesSelected = 0;

    for (let page = 1; page <= totalPages && recordsByKey.size < limit; page += 1) {
        const directoryPage = page === 1 ? firstPage : await fetchCitiesPage(page);
        const cities = (directoryPage.cities || []).filter((city) => city.status === 'active');
        const matchingCities = locationTerms.length
            ? cities.filter((city) => matchesCityLocation(city, locationTerms))
            : cities;

        citiesAvailable += cities.length;
        citiesSelected += matchingCities.length;

        for (
            let index = 0;
            index < matchingCities.length && recordsByKey.size < limit;
            index += BROAD_SEARCH_CONCURRENCY
        ) {
            const cityBatch = matchingCities.slice(index, index + BROAD_SEARCH_CONCURRENCY);
            const catalogResults = await Promise.allSettled(
                cityBatch.map(async (city) => {
                    const cityContext = parseTargetContext(buildCityPageUrl(city, filterKeyword));
                    const apiData = await fetchCityCatalog(cityContext, { logResult: false });
                    return { city, records: extractRecords(apiData, cityContext) };
                }),
            );

            let skippedCatalogs = 0;
            for (const result of catalogResults) {
                catalogsProcessed += 1;
                if (result.status === 'rejected') {
                    skippedCatalogs += 1;
                    continue;
                }

                for (const record of result.value.records) {
                    if (!matchesKeyword(record, filterKeyword)) continue;
                    const key = String(record.alias_id || record.id || record.product_url);
                    const existing = recordsByKey.get(key);
                    if (existing) {
                        recordsByKey.set(key, mergeRecords(existing, record));
                        duplicatesRemoved += 1;
                    } else {
                        recordsByKey.set(key, record);
                    }
                }
            }

            if (skippedCatalogs > 0) {
                log.warning(`Broad catalog batch skipped=${skippedCatalogs}/${catalogResults.length}`);
            }

            log.info(
                `Broad search progress | directory_page=${page}/${totalPages} | catalogs=${catalogsProcessed} | matches=${recordsByKey.size}`,
            );
        }
    }

    if (locationTerms.length && citiesSelected === 0) {
        throw new Error(`No Hellotickets destinations matched location: ${filterLocation}`);
    }

    log.info(
        `Broad search complete | catalogs=${catalogsProcessed} | cities_available=${citiesAvailable} | cities_selected=${citiesSelected} | matches=${recordsByKey.size} | duplicates_removed=${duplicatesRemoved}`,
    );
    return Array.from(recordsByKey.values()).slice(0, limit);
}

async function fetchCitiesPage(page) {
    let lastError;

    for (let attempt = 0; attempt < API_MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await gotScraping.get(`${CITIES_API_URL}?page=${page}`, {
                headers: getRequestHeaders('https://www.hellotickets.com/'),
                useHeaderGenerator: false,
                http2: false,
                throwHttpErrors: false,
                timeout: { request: REQUEST_TIMEOUT_MS },
            });

            const contentType = String(response.headers['content-type'] || '');
            const body = String(response.body || '');
            if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`HTTP ${response.statusCode}`);
            if (!contentType.includes('json')) throw new Error('The destination directory response was not JSON.');

            const data = JSON.parse(body);
            if (!Array.isArray(data?.cities)) throw new Error('The destination directory has no cities array.');
            return data;
        } catch (error) {
            lastError = error;
            if (attempt < API_MAX_ATTEMPTS - 1) {
                log.warning(`Destination directory page ${page} attempt ${attempt + 1}/${API_MAX_ATTEMPTS} failed: ${error.message}`);
            }
        }
    }

    throw new Error(`Unable to fetch destination directory page ${page}: ${lastError?.message || 'unknown error'}`);
}

function buildCityPageUrl(city, filterKeyword) {
    const pageUrl = new URL(city.url, 'https://www.hellotickets.com');
    if (hasValue(filterKeyword)) pageUrl.searchParams.set('qs', String(filterKeyword).trim());
    return pageUrl.href;
}

function matchesCityLocation(city, locationTerms) {
    const haystack = tokenize(
        [city.name, city.slugName, city.state, city.country, city.countrySlugName, city.url]
            .filter(Boolean)
            .join(' '),
    );

    return locationTerms.every((term) => haystack.includes(term));
}

function getRequestHeaders(referer) {
    return {
        'user-agent': USER_AGENTS[0],
        accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        referer,
        origin: 'https://www.hellotickets.com',
    };
}

function normalizePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
}

function hasValue(value) {
    return typeof value === 'string' ? value.trim().length > 0 : value != null;
}

function isPrefilledStartUrl(value) {
    try {
        return normalizeHttpUrl(value) === normalizeHttpUrl(PREFILLED_START_URL);
    } catch {
        return false;
    }
}

function normalizeHttpUrl(value) {
    try {
        const url = new URL(String(value));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
        return url.href;
    } catch {
        throw new Error('startUrl must be a valid HTTP or HTTPS Hellotickets URL.');
    }
}

function parseTargetContext(urlValue) {
    const parsedUrl = new URL(urlValue);
    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    const citySegmentIndex = pathSegments.findIndex((segment) => /^c-\d+$/i.test(segment));

    if (parsedUrl.hostname !== 'www.hellotickets.com' || citySegmentIndex < 1) {
        throw new Error(
            'startUrl must be a public Hellotickets city or category URL containing a /c-<cityId> path segment.',
        );
    }

    const citySegment = pathSegments[citySegmentIndex];
    const citySlug = pathSegments[citySegmentIndex - 1];
    const locale = pathSegments[0] || 'us';
    const cityId = citySegment.slice(2);
    const queryKeyword = parsedUrl.searchParams.get('qs') || '';
    const pageTitle = queryKeyword || `${formatSlug(citySlug)} experiences`;

    return {
        cityId,
        citySlug,
        locale,
        pageUrl: parsedUrl.href,
        pageTitle,
        baseOrigin: parsedUrl.origin,
    };
}

async function fetchCityCatalog(context, { logResult = true } = {}) {
    const apiUrl = `${context.baseOrigin}/api/cities/${context.cityId}/top-subcategories?carouselItemsAmount=${API_PAGE_SIZE}`;
    let lastError;

    for (let attempt = 0; attempt < API_MAX_ATTEMPTS; attempt += 1) {
        const userAgent = USER_AGENTS[attempt % USER_AGENTS.length];

        try {
            const response = await gotScraping.get(apiUrl, {
                headers: {
                    'user-agent': userAgent,
                    accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.9',
                    referer: context.pageUrl,
                    origin: context.baseOrigin,
                },
                useHeaderGenerator: false,
                http2: false,
                throwHttpErrors: false,
                timeout: { request: REQUEST_TIMEOUT_MS },
            });

            const contentType = String(response.headers['content-type'] || '');
            const body = String(response.body || '');

            if (response.statusCode < 200 || response.statusCode >= 300) {
                throw new Error(`HTTP ${response.statusCode}`);
            }

            if (
                !contentType.includes('json') ||
                /<title>Just a moment|cf-chl-|Enable JavaScript and cookies/i.test(body)
            ) {
                throw new Error('The response was not a usable JSON catalog.');
            }

            const data = JSON.parse(body);
            if (!Array.isArray(data?.subcategories)) {
                const keys = Object.keys(data || {}).join(', ') || 'none';
                throw new Error(`The JSON response has no subcategories array. Keys: ${keys}`);
            }

            if (logResult) {
                log.info(`Fetched city catalog | city=${context.cityId} | subcategories=${data.subcategories.length}`);
            }
            return data;
        } catch (error) {
            lastError = error;
            if (attempt < API_MAX_ATTEMPTS - 1) {
                log.warning(`Catalog request attempt ${attempt + 1}/${API_MAX_ATTEMPTS} failed: ${error.message}`);
            }
        }
    }

    throw new Error(
        `Unable to fetch the Hellotickets JSON catalog after ${API_MAX_ATTEMPTS} attempts: ${lastError?.message || 'unknown error'}`,
    );
}

function extractRecords(apiData, context) {
    const recordsByKey = new Map();
    let duplicatesRemoved = 0;

    for (const subcategory of apiData.subcategories) {
        const collectionContext = {
            ...context,
            collectionId: subcategory.id,
            collectionTitle: subcategory.name,
            collectionUrl: toAbsoluteUrl(subcategory.url, context.baseOrigin),
            collectionDescription: subcategory.searchDescription,
        };

        duplicatesRemoved += walkApiValue(subcategory.aliases, collectionContext, recordsByKey);
        duplicatesRemoved += walkApiValue(subcategory.subCategories, collectionContext, recordsByKey);
    }

    const records = Array.from(recordsByKey.values());
    records.duplicatesRemoved = duplicatesRemoved;
    return records;
}

function walkApiValue(value, context, recordsByKey, depth = 0) {
    if (value == null || depth > 10) return 0;

    if (Array.isArray(value)) {
        return value.reduce(
            (duplicateCount, item) => duplicateCount + walkApiValue(item, context, recordsByKey, depth + 1),
            0,
        );
    }

    if (typeof value !== 'object') return 0;

    let duplicateCount = 0;

    const normalized = normalizeProductRecord(value, context);
    if (normalized) {
        const key = String(normalized.alias_id || normalized.id || normalized.product_url);
        const existing = recordsByKey.get(key);
        if (existing) {
            recordsByKey.set(key, mergeRecords(existing, normalized));
            duplicateCount += 1;
        } else {
            recordsByKey.set(key, normalized);
        }
    }

    for (const childKey of ['aliases', 'subCategories', 'subcategories']) {
        if (Array.isArray(value[childKey])) {
            duplicateCount += walkApiValue(
                value[childKey],
                {
                    ...context,
                    collectionId: value.id || context.collectionId,
                    collectionTitle: value.name || value.title || context.collectionTitle,
                    collectionUrl: toAbsoluteUrl(value.url, context.baseOrigin) || context.collectionUrl,
                    collectionDescription: value.searchDescription || context.collectionDescription,
                },
                recordsByKey,
                depth + 1,
            );
        }
    }

    return duplicateCount;
}

function normalizeProductRecord(candidate, context) {
    const isProductLike = Boolean(candidate.isProductOrAlias || candidate.aliasId || candidate.url?.includes('/a/pa-'));
    if (!isProductLike || !candidate.url) return null;

    return pruneEmptyValues({
        id: candidate.id,
        alias_id: candidate.aliasId,
        code: candidate.code,
        title: candidate.title,
        origin_title: candidate.originTitle,
        short_description: stripHtml(candidate.shortDescription),
        price: candidate.price,
        price_eur: candidate.priceInEUR,
        currency_code: candidate.currencyCode,
        rating: candidate.rating,
        review_count: candidate.reviewCount,
        image_url: toAbsoluteUrl(candidate.thumbnailHiResUrl || candidate.thumbnailUrl, context.baseOrigin),
        thumbnail_url: toAbsoluteUrl(candidate.thumbnailUrl, context.baseOrigin),
        product_url: toAbsoluteUrl(candidate.url, context.baseOrigin),
        duration: candidate.duration,
        offered_languages: normalizeLanguages(candidate.offeredLangs),
        fee_total_i18n: candidate.feeTotalI18N,
        fee_percentage: candidate.feePercentage,
        merchant_cancellable: candidate.merchantCancellable,
        cancellation_type: candidate.cancellationType,
        is_product_or_alias: candidate.isProductOrAlias,
        is_grouped_tour: candidate.isGroupedTour,
        skip_line: candidate.skipLine,
        smartphone_ticket: candidate.smartphoneTicket,
        wheelchair_access: candidate.wheelchairAccess,
        instant_ticket_delivery: candidate.instantTicketDelivery,
        is_open: candidate.isOpen,
        is_free_product: candidate.isFreeProduct,
        service: candidate.service,
        custom_settings: candidate.customSettings,
        slug_exists: candidate.slugExists,
        sub_categories: candidate.subCategories,
        system_groups: candidate.systemGroups,
        source_section: 'top_subcategories_api',
        source_sections: ['top_subcategories_api'],
        source_collection_id: context.collectionId,
        source_collection_title: context.collectionTitle,
        source_collection_url: context.collectionUrl,
        source_collection_description: stripHtml(context.collectionDescription),
        city_id: context.cityId,
        city_slug: context.citySlug,
        locale: context.locale,
        page_url: context.pageUrl,
        page_title: context.pageTitle,
    });
}

function matchesKeyword(record, filterKeyword) {
    const terms = tokenize(filterKeyword);
    if (terms.length === 0) return true;

    const haystack = tokenize(
        [record.title, record.origin_title, record.short_description, record.service, record.source_collection_title]
            .filter(Boolean)
            .join(' '),
    ).join(' ');

    return terms.every((term) => haystack.includes(term));
}

function matchesLocation(record, filterLocation) {
    const terms = tokenize(filterLocation);
    if (terms.length === 0) return true;

    const haystack = tokenize(
        [
            record.city_slug,
            record.locale,
            record.page_url,
            record.page_title,
            record.product_url,
            record.source_collection_title,
        ]
            .filter(Boolean)
            .join(' '),
    ).join(' ');

    return terms.every((term) => haystack.includes(term));
}

function tokenize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[-_/]+/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function mergeRecords(existing, incoming) {
    const merged = { ...existing };

    for (const [key, value] of Object.entries(incoming)) {
        if (value == null) continue;

        if (Array.isArray(value)) {
            const current = Array.isArray(merged[key]) ? merged[key] : [];
            merged[key] = [...new Set([...current, ...value])];
            continue;
        }

        if (merged[key] == null || merged[key] === '') merged[key] = value;
    }

    return pruneEmptyValues(merged);
}

function normalizeLanguages(offeredLangs) {
    if (!Array.isArray(offeredLangs)) return undefined;

    const languages = offeredLangs
        .flatMap((entry) => (typeof entry === 'object' ? Object.values(entry || {}) : entry))
        .map((value) => String(value).trim())
        .filter(Boolean);

    return languages.length ? [...new Set(languages)] : undefined;
}

function stripHtml(value) {
    if (!value) return undefined;
    return (
        String(value)
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || undefined
    );
}

function toAbsoluteUrl(value, baseOrigin) {
    if (!value) return undefined;

    try {
        return new URL(value, baseOrigin).href;
    } catch {
        return undefined;
    }
}

function formatSlug(value) {
    return String(value || '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pruneEmptyValues(value) {
    if (Array.isArray(value)) {
        const cleanedArray = value.map((item) => pruneEmptyValues(item)).filter((item) => item !== undefined);
        return cleanedArray.length ? cleanedArray : undefined;
    }

    if (value && typeof value === 'object') {
        const cleanedEntries = Object.entries(value)
            .map(([key, item]) => [key, pruneEmptyValues(item)])
            .filter(([, item]) => item !== undefined);

        return cleanedEntries.length ? Object.fromEntries(cleanedEntries) : undefined;
    }

    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;

    return value;
}
