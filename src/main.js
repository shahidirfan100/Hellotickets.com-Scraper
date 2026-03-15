import vm from 'node:vm';

import { load as cheerioLoad } from 'cheerio';
import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

const DEFAULT_START_URL = 'https://www.hellotickets.com/us/new-york/c-1?qs=New%20York';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0';
const BASE_COLLECTION_PAGE_EXPANSIONS = 40;
const MAX_COLLECTION_PAGE_EXPANSIONS = 300;
const MAX_COLLECTION_QUEUE_SIZE = 1500;

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    startUrl,
    results_wanted: rawResultsWanted = 20,
    proxyConfiguration,
} = input;

const resultsWanted = normalizePositiveInteger(rawResultsWanted, 20);
const targetUrl = startUrl || DEFAULT_START_URL;
const proxyConfig = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;
const collectionPageExpansionLimit = Math.min(
    MAX_COLLECTION_PAGE_EXPANSIONS,
    Math.max(BASE_COLLECTION_PAGE_EXPANSIONS, resultsWanted * 2),
);
const collectionQueueLimit = Math.min(MAX_COLLECTION_QUEUE_SIZE, Math.max(250, collectionPageExpansionLimit * 6));

try {
    const listingHtml = await fetchText(targetUrl, proxyConfig);
    const pageData = extractNuxtPageData(listingHtml);

    if (!pageData) {
        throw new Error('Could not extract Hellotickets page data from the start URL.');
    }

    const pageUrl = new URL(targetUrl);
    const baseOrigin = pageUrl.origin;
    const locale = pageUrl.pathname.split('/').filter(Boolean)[0] || 'us';
    const cityId = String(pageData.cityId || '').trim();
    const pageTitle = pageData.metaTags?.title || pageData.scriptDataLayer?.pageTitle || 'Hellotickets listing';

    let apiTopSubcategories = null;
    if (cityId) {
        const topSubcategoriesUrl = `${baseOrigin}/api/cities/${cityId}/top-subcategories?carouselItemsAmount=12`;
        try {
            apiTopSubcategories = await fetchJson(topSubcategoriesUrl, proxyConfig, targetUrl);
            log.info(`Fetched top subcategories API for city ${cityId}.`);
        } catch (error) {
            log.warning(`Top subcategories API failed, using page data fallback: ${error.message}`);
        }
    }

    const sectionEntries = buildSectionEntries({
        pageData,
        apiTopSubcategories,
        cityId,
        locale,
        pageUrl: targetUrl,
        pageTitle,
        baseOrigin,
    });

    const mergedRecords = new Map();

    for (const entry of sectionEntries) {
        collectProductRecords(entry.value, entry.context, baseOrigin, mergedRecords);
    }

    const initialCollectionUrls = collectCollectionUrlsFromEntries(sectionEntries, baseOrigin);
    const initialPageUrl = normalizeCollectionUrl(targetUrl, baseOrigin);
    const visitedCollectionUrls = new Set(initialPageUrl ? [initialPageUrl] : []);
    const queuedCollectionUrls = new Set();
    const collectionQueue = [];
    enqueueCollectionUrls(initialCollectionUrls, {
        queue: collectionQueue,
        queuedUrls: queuedCollectionUrls,
        visitedUrls: visitedCollectionUrls,
        baseOrigin,
        maxQueueSize: collectionQueueLimit,
    });

    let expandedCollectionPages = 0;

    while (
        collectionQueue.length
        && mergedRecords.size < resultsWanted
        && expandedCollectionPages < collectionPageExpansionLimit
    ) {
        const nextCollectionUrl = collectionQueue.shift();
        if (!nextCollectionUrl || visitedCollectionUrls.has(nextCollectionUrl)) continue;

        visitedCollectionUrls.add(nextCollectionUrl);

        try {
            const relatedHtml = await fetchText(nextCollectionUrl, proxyConfig);
            const relatedPageData = extractNuxtPageData(relatedHtml);
            if (!relatedPageData) continue;

            const relatedPage = new URL(nextCollectionUrl);
            const relatedLocale = relatedPage.pathname.split('/').filter(Boolean)[0] || locale;
            const relatedCityId = String(relatedPageData.cityId || cityId || '').trim();
            const relatedTitle = relatedPageData.metaTags?.title || relatedPageData.scriptDataLayer?.pageTitle || pageTitle;

            const relatedEntries = buildSectionEntries({
                pageData: relatedPageData,
                apiTopSubcategories: null,
                cityId: relatedCityId,
                locale: relatedLocale,
                pageUrl: nextCollectionUrl,
                pageTitle: relatedTitle,
                baseOrigin,
            });

            for (const entry of relatedEntries) {
                collectProductRecords(entry.value, entry.context, baseOrigin, mergedRecords);
            }

            const discoveredCollectionUrls = collectCollectionUrlsFromEntries(relatedEntries, baseOrigin);
            enqueueCollectionUrls(discoveredCollectionUrls, {
                queue: collectionQueue,
                queuedUrls: queuedCollectionUrls,
                visitedUrls: visitedCollectionUrls,
                baseOrigin,
                maxQueueSize: collectionQueueLimit,
            });
        } catch (error) {
            log.warning(`Failed to expand related collection ${nextCollectionUrl}: ${error.message}`);
        }

        expandedCollectionPages += 1;
    }

    const items = Array.from(mergedRecords.values()).slice(0, resultsWanted);

    if (items.length === 0) {
        throw new Error('No product records were extracted from the provided Hellotickets page.');
    }

    await Dataset.pushData(items);
    log.info(`Expanded ${expandedCollectionPages} related collection pages (limit: ${collectionPageExpansionLimit}).`);
    log.info(`Saved ${items.length} unique Hellotickets listings from ${targetUrl}.`);
} finally {
    await Actor.exit();
}

function normalizePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
}

async function fetchText(url, proxyConfiguration) {
    const response = await gotScraping({
        url,
        proxyUrl: proxyConfiguration ? await proxyConfiguration.newUrl() : undefined,
        headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
        },
        timeout: { request: 30000 },
    });

    return response.body;
}

async function fetchJson(url, proxyConfiguration, referer) {
    const response = await gotScraping({
        url,
        proxyUrl: proxyConfiguration ? await proxyConfiguration.newUrl() : undefined,
        headers: {
            'user-agent': USER_AGENT,
            accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            referer: referer || DEFAULT_START_URL,
        },
        timeout: { request: 30000 },
    });

    return JSON.parse(response.body);
}

function extractNuxtPageData(html) {
    const marker = 'window.__NUXT__=';
    const startIndex = html.indexOf(marker);
    if (startIndex === -1) return null;

    const endIndex = html.indexOf('</script>', startIndex);
    if (endIndex === -1) return null;

    const nuxtPayload = html.slice(startIndex + marker.length, endIndex).trim().replace(/;$/, '');
    const sandbox = { window: {} };

    vm.runInNewContext(`window.__NUXT__=${nuxtPayload};`, sandbox, { timeout: 3000 });

    return sandbox.window.__NUXT__?.data?.[0] || null;
}

function buildSectionEntries({ pageData, apiTopSubcategories, cityId, locale, pageUrl, pageTitle, baseOrigin }) {
    const baseContext = {
        cityId,
        locale,
        pageUrl,
        pageTitle,
        baseOrigin,
    };
    const entries = [];

    if (Array.isArray(pageData.searchItems) && pageData.searchItems.length) {
        entries.push({
            value: pageData.searchItems,
            context: {
                ...baseContext,
                section: 'search_items',
                collectionTitle: pageTitle,
                collectionUrl: pageUrl,
            },
        });
    }

    const apiTopSubcategoryItems = extractCollectionItems(apiTopSubcategories);
    const pageTopSubcategoryItems = Array.isArray(pageData.topSubcategories)
            ? pageData.topSubcategories
            : [];
    const topSubcategories = apiTopSubcategoryItems.length ? apiTopSubcategoryItems : pageTopSubcategoryItems;

    if (topSubcategories.length) {
        entries.push({
            value: topSubcategories,
            context: {
                ...baseContext,
                section: apiTopSubcategoryItems.length ? 'top_subcategories_api' : 'top_subcategories_page',
                collectionTitle: 'Top subcategories',
                collectionUrl: pageUrl,
            },
        });
    }

    const eventCollections = [];
    if (pageData.events && typeof pageData.events === 'object') {
        for (const [eventType, eventGroup] of Object.entries(pageData.events)) {
            if (eventGroup && Array.isArray(eventGroup.items) && eventGroup.items.length) {
                eventCollections.push({ eventType, items: eventGroup.items });
            }
        }
    }

    for (const collection of eventCollections) {
        entries.push({
            value: collection.items,
            context: {
                ...baseContext,
                section: `events_${collection.eventType}`,
                collectionTitle: collection.eventType,
                collectionUrl: pageUrl,
            },
        });
    }

    return entries;
}

function extractCollectionItems(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.items)) return value.items;
    if (value && Array.isArray(value.subcategories)) return value.subcategories;
    return [];
}

function collectCollectionUrlsFromEntries(entries, baseOrigin) {
    const urls = new Set();

    for (const entry of entries) {
        collectCollectionUrls(entry?.value, baseOrigin, urls);
    }

    return urls;
}

function collectCollectionUrls(value, baseOrigin, urls, depth = 0) {
    if (value == null || depth > 8) return;

    if (Array.isArray(value)) {
        for (const item of value) {
            collectCollectionUrls(item, baseOrigin, urls, depth + 1);
        }
        return;
    }

    if (typeof value !== 'object') return;

    const normalizedUrl = normalizeCollectionUrl(value.url, baseOrigin);
    if (normalizedUrl) urls.add(normalizedUrl);

    if (Array.isArray(value.aliases)) {
        for (const alias of value.aliases) {
            collectCollectionUrls(alias, baseOrigin, urls, depth + 1);
        }
    }

    if (Array.isArray(value.items)) {
        for (const item of value.items) {
            collectCollectionUrls(item, baseOrigin, urls, depth + 1);
        }
    }

    if (Array.isArray(value.subcategories)) {
        for (const subcategory of value.subcategories) {
            collectCollectionUrls(subcategory, baseOrigin, urls, depth + 1);
        }
    }
}

function enqueueCollectionUrls(urls, { queue, queuedUrls, visitedUrls, baseOrigin, maxQueueSize }) {
    for (const candidateUrl of urls) {
        const normalizedUrl = normalizeCollectionUrl(candidateUrl, baseOrigin);
        if (!normalizedUrl) continue;
        if (visitedUrls.has(normalizedUrl) || queuedUrls.has(normalizedUrl)) continue;
        if (queue.length >= maxQueueSize) break;

        queue.push(normalizedUrl);
        queuedUrls.add(normalizedUrl);
    }
}

function collectProductRecords(value, context, baseOrigin, recordsById, depth = 0) {
    if (depth > 8 || value == null) return;

    if (Array.isArray(value)) {
        for (const item of value) {
            collectProductRecords(item, context, baseOrigin, recordsById, depth + 1);
        }
        return;
    }

    if (typeof value !== 'object') return;

    const normalized = normalizeProductRecord(value, context, baseOrigin);
    if (normalized) {
        const recordKey = String(normalized.alias_id || normalized.id || normalized.product_url);
        const existing = recordsById.get(recordKey);
        recordsById.set(recordKey, existing ? mergeRecords(existing, normalized) : normalized);
    }

    if (Array.isArray(value.aliases) && value.aliases.length) {
        const aliasContext = {
            ...context,
            collectionId: value.id,
            collectionTitle: value.name || value.title || context.collectionTitle,
            collectionUrl: toAbsoluteUrl(value.url, baseOrigin) || context.collectionUrl,
            collectionDescription: value.searchDescription || context.collectionDescription,
        };

        for (const alias of value.aliases) {
            collectProductRecords(alias, aliasContext, baseOrigin, recordsById, depth + 1);
        }
    }

    if (Array.isArray(value.items) && value.items.length) {
        const itemsContext = {
            ...context,
            collectionId: value.id || context.collectionId,
            collectionTitle: value.name || value.title || context.collectionTitle,
            collectionUrl: toAbsoluteUrl(value.url, baseOrigin) || context.collectionUrl,
            collectionDescription: value.searchDescription || context.collectionDescription,
        };

        for (const item of value.items) {
            collectProductRecords(item, itemsContext, baseOrigin, recordsById, depth + 1);
        }
    }
}

function normalizeProductRecord(candidate, context, baseOrigin) {
    const hasListingUrl = typeof candidate.url === 'string' && candidate.url.includes('/a/pa-');
    const isProductLike = Boolean(candidate.isProductOrAlias || candidate.aliasId || hasListingUrl);
    if (!isProductLike) return null;

    return pruneEmptyValues({
        id: candidate.id,
        alias_id: candidate.aliasId,
        code: candidate.code,
        title: candidate.title,
        origin_title: candidate.originTitle,
        short_description: htmlToText(candidate.shortDescription),
        price: candidate.price,
        price_eur: candidate.priceInEUR,
        currency_code: candidate.currencyCode,
        rating: candidate.rating,
        review_count: candidate.reviewCount,
        image_url: toAbsoluteUrl(candidate.thumbnailHiResUrl || candidate.thumbnailUrl, baseOrigin),
        product_url: toAbsoluteUrl(candidate.url, baseOrigin),
        duration: candidate.duration,
        offered_languages: normalizeLanguages(candidate.offeredLangs),
        merchant_cancellable: candidate.merchantCancellable,
        cancellation_type: candidate.cancellationType,
        skip_line: candidate.skipLine,
        smartphone_ticket: candidate.smartphoneTicket,
        wheelchair_access: candidate.wheelchairAccess,
        instant_ticket_delivery: candidate.instantTicketDelivery,
        is_open: candidate.isOpen,
        is_free_product: candidate.isFreeProduct,
        is_grouped_tour: candidate.isGroupedTour,
        service: candidate.service,
        source_section: context.section,
        source_sections: [context.section],
        source_collection_id: context.collectionId,
        source_collection_title: context.collectionTitle,
        source_collection_url: context.collectionUrl,
        source_collection_description: context.collectionDescription,
        city_id: context.cityId,
        locale: context.locale,
        page_url: context.pageUrl,
        page_title: context.pageTitle,
    });
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

        if (merged[key] == null || merged[key] === '') {
            merged[key] = value;
        }
    }

    return pruneEmptyValues(merged);
}

function normalizeLanguages(offeredLangs) {
    if (!Array.isArray(offeredLangs) || offeredLangs.length === 0) return undefined;

    const languages = offeredLangs
        .flatMap((entry) => Object.values(entry || {}))
        .map((value) => String(value).trim())
        .filter(Boolean);

    return languages.length ? [...new Set(languages)] : undefined;
}

function htmlToText(value) {
    if (!value) return undefined;

    const $ = cheerioLoad(`<div>${value}</div>`);
    const text = $.text().replace(/\s+/g, ' ').trim();
    return text || undefined;
}

function toAbsoluteUrl(value, baseOrigin) {
    if (!value) return undefined;

    try {
        return new URL(value, baseOrigin).href;
    } catch {
        return undefined;
    }
}

function normalizeCollectionUrl(value, baseOrigin) {
    const absoluteUrl = toAbsoluteUrl(value, baseOrigin);
    if (!absoluteUrl) return undefined;

    try {
        const parsedUrl = new URL(absoluteUrl);
        if (parsedUrl.origin !== baseOrigin) return undefined;
        if (parsedUrl.pathname.startsWith('/api/')) return undefined;
        if (parsedUrl.pathname.includes('/a/pa-')) return undefined;

        parsedUrl.hash = '';
        return parsedUrl.href;
    } catch {
        return undefined;
    }
}

function pruneEmptyValues(value) {
    if (Array.isArray(value)) {
        const cleanedArray = value
            .map((item) => pruneEmptyValues(item))
            .filter((item) => item !== undefined);
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
