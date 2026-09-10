import vm from 'node:vm';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

const PREFILLED_START_URL = 'https://www.hellotickets.com/us/new-york/c-1?qs=New%20York';
const API_MAX_ATTEMPTS = 3;

await Actor.init();

const input = (await Actor.getInput()) || {};
const { startUrl = '', location = '', results_wanted: rawResultsWanted = 20 } = input;
const proxyInput = input.proxyConfiguration || {};
const hasCustomProxyUrls = Array.isArray(proxyInput.proxyUrls) && proxyInput.proxyUrls.length > 0;
const shouldUseProxy = Boolean(proxyInput.useApifyProxy || hasCustomProxyUrls);
const proxyConfiguration = shouldUseProxy && (Actor.isAtHome() || hasCustomProxyUrls)
    ? await Actor.createProxyConfiguration(proxyInput)
    : null;
const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
const httpClient = new Impit({
    browser: 'chrome',
    ignoreTlsErrors: true,
    ...(proxyUrl && { proxyUrl }),
});

if (shouldUseProxy && !proxyConfiguration) {
    log.info('Proxy requested locally without a usable Apify proxy context; continuing without a proxy.');
}

const resultsWanted = normalizePositiveInteger(rawResultsWanted, 20);
const targetUrl = normalizeHttpUrl(startUrl || PREFILLED_START_URL);

try {
    const items = await searchUrl(targetUrl, location, resultsWanted);

    if (items.length === 0) {
        throw new Error('The Hellotickets URL returned no matching listings. Check the URL or location filter.');
    }

    await Actor.pushData(items);
    log.info(`Done | saved=${items.length}`);
} finally {
    await Actor.exit();
}

async function searchUrl(targetUrlValue, filterLocation, limit) {
    const targetContext = parseTargetContext(targetUrlValue);
    log.info(`Start run | mode=url | target=${targetUrlValue} | results=${limit}`);

    const records = await fetchPageRecords(targetContext);
    const filteredRecords = records.filter((record) => matchesLocation(record, filterLocation));

    log.info(`Page records=${records.length} | after_location_filter=${filteredRecords.length}`);
    return filteredRecords.slice(0, limit);
}

async function fetchWithImpit(url, options = {}) {
    let lastError;

    for (let attempt = 1; attempt <= API_MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await httpClient.fetch(url, options);
            const body = await response.text();

            if (response.status >= 200 && response.status < 300) {
                return {
                    status: response.status,
                    contentType: String(response.headers.get('content-type') || ''),
                    body,
                };
            }

            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        } catch (error) {
            lastError = error;
            const retryable = error.status === 429 || error.status >= 500 || error.status == null;
            if (!retryable || attempt === API_MAX_ATTEMPTS) break;

            log.warning(`Request attempt ${attempt}/${API_MAX_ATTEMPTS} failed: ${error.message}`);
            await waitForRetry(attempt, error.status);
        }
    }

    throw lastError || new Error('HTTP request failed.');
}

async function waitForRetry(attempt, status) {
    const delay = status === 429 ? attempt * 1000 + Math.round(Math.random() * 500) : attempt * 500;
    await new Promise((resolve) => {
        setTimeout(resolve, delay);
    });
}

function normalizePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
}

function normalizeHttpUrl(value) {
    try {
        const url = new URL(String(value));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
        if (!['hellotickets.com', 'www.hellotickets.com'].includes(url.hostname)) {
            throw new Error('unsupported host');
        }
        return url.href;
    } catch {
        throw new Error('startUrl must be a valid HTTP or HTTPS Hellotickets URL.');
    }
}

function parseTargetContext(urlValue) {
    const parsedUrl = new URL(urlValue);
    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    const citySegmentIndex = pathSegments.findIndex((segment) => /^c-\d+$/i.test(segment));
    const citySlug = citySegmentIndex > 0 ? pathSegments[citySegmentIndex - 1] : pathSegments[1];
    const cityId = citySegmentIndex > 0 ? pathSegments[citySegmentIndex].slice(2) : undefined;
    const locale = pathSegments[0] || 'us';
    const lastSegment = pathSegments[pathSegments.length - 1] || 'Hellotickets listings';
    const pageTitle = parsedUrl.searchParams.get('qs') || formatSlug(lastSegment.replace(/-\d+$/, ''));

    return {
        cityId,
        citySlug,
        locale,
        pageUrl: parsedUrl.href,
        pageTitle,
        baseOrigin: parsedUrl.origin,
        city: citySlug ? { id: cityId, slugName: citySlug } : undefined,
    };
}

async function fetchPageRecords(context) {
    try {
        const response = await fetchWithImpit(context.pageUrl, {
            headers: {
                referer: `${context.baseOrigin}/`,
                origin: context.baseOrigin,
            },
        });
        const payload = parseNuxtPayload(response.body);
        const records = extractPageRecords(payload, context);
        log.info(`Fetched URL payload | records=${records.length}`);
        return records;
    } catch (error) {
        throw new Error(`Unable to fetch Hellotickets URL: ${error.message}`);
    }
}

function extractPageRecords(nuxtPayload, context) {
    const pageData = nuxtPayload?.data?.[0] || {};
    const recordsByKey = new Map();

    if (Array.isArray(pageData.topSubcategories)) {
        for (const record of extractRecords({ subcategories: pageData.topSubcategories }, context)) {
            recordsByKey.set(String(record.alias_id || record.id || record.product_url), record);
        }
    }

    for (const record of extractPagePayloadRecords(nuxtPayload, context.pageUrl, {
        name: context.pageTitle,
        city: context.city,
    }, context.pageTitle)) {
        const key = String(record.alias_id || record.id || record.product_url);
        const existing = recordsByKey.get(key);
        recordsByKey.set(key, existing ? mergeRecords(existing, record) : record);
    }

    return Array.from(recordsByKey.values());
}

function parseNuxtPayload(html) {
    const marker = 'window.__NUXT__=';
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) throw new Error('The URL did not contain a Nuxt data payload.');

    const scriptEnd = html.indexOf('</script>', markerIndex);
    if (scriptEnd < 0) throw new Error('The Nuxt data script was incomplete.');

    const expression = html.slice(markerIndex + marker.length, scriptEnd);
    try {
        return vm.runInNewContext(expression, Object.create(null), { timeout: 2000 });
    } catch {
        throw new Error('The Nuxt data payload could not be parsed.');
    }
}

function extractPagePayloadRecords(nuxtPayload, pageUrl, hit, pageTitle) {
    const page = nuxtPayload?.data?.[0] || {};
    const rawItems = [];

    if (page.event) rawItems.push(page.event);
    if (Array.isArray(page.searchItems)) rawItems.push(...page.searchItems);

    const layoutEvents = page.layoutAttributes?.events;
    if (Array.isArray(layoutEvents)) {
        rawItems.push(...layoutEvents);
    } else if (layoutEvents && typeof layoutEvents === 'object') {
        rawItems.push(...Object.values(layoutEvents));
    }

    const performanceMonths = page.performancesList?.items;
    if (performanceMonths && typeof performanceMonths === 'object') {
        for (const month of Object.values(performanceMonths)) {
            if (Array.isArray(month?.perfs)) rawItems.push(...month.perfs);
        }
    }

    if (Array.isArray(page.relatedEvents)) rawItems.push(...page.relatedEvents);
    if (Array.isArray(page.relatedMatches)) rawItems.push(...page.relatedMatches);

    return rawItems
        .map((item) => normalizePageRecord(item, pageUrl, hit, pageTitle))
        .filter(Boolean);
}

function normalizePageRecord(candidate, pageUrl, hit, pageTitle) {
    const city = candidate.city || candidate.venue?.city || hit.city || {};
    const pathSegments = new URL(pageUrl).pathname.split('/').filter(Boolean);
    const citySlug = city.slugName || city.slug || hit.city?.slugName || hit.city?.slug;
    const productUrl = toAbsoluteUrl(candidate.url || hit.url || pageUrl, 'https://www.hellotickets.com');
    if (!productUrl || (!candidate.id && !candidate.name && !candidate.title)) return null;

    return pruneEmptyValues({
        id: candidate.aliasId || candidate.id,
        alias_id: candidate.aliasId,
        title: candidate.title || candidate.name,
        origin_title: candidate.originTitle || candidate.originName || candidate.name,
        short_description: stripHtml(candidate.description),
        price: candidate.price,
        currency_code: candidate.currencyCode || candidate.currency,
        rating: candidate.rating,
        review_count: candidate.reviewCount,
        image_url: toAbsoluteUrl(
            candidate.thumbnailHiResUrl || candidate.thumbnailUrl || candidate.imageUrl || candidate.image || hit.image,
            'https://www.hellotickets.com',
        ),
        product_url: productUrl,
        merchant_cancellable: candidate.merchantCancellable,
        is_product_or_alias: candidate.isProductOrAlias ?? true,
        service: candidate.provider,
        source_section: 'page_payload',
        source_sections: ['page_payload'],
        source_collection_id: hit.id,
        source_collection_title: hit.name || pageTitle,
        source_collection_url: toAbsoluteUrl(hit.url || pageUrl, 'https://www.hellotickets.com'),
        city_id: city.id || hit.city?.id,
        city_slug: citySlug,
        locale: pathSegments[0],
        page_url: pageUrl,
        page_title: pageTitle,
    });
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
