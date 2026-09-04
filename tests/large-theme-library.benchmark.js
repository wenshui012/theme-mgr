/* eslint-disable no-console */
'use strict';

// Isolated large-library benchmark. It never reads or writes a SillyTavern
// profile or theme directory: all themes live in a fresh headless-browser
// context and mocked HTTP responses.

const path = require('node:path');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

let playwright;
try {
    playwright = require('playwright');
} catch (error) {
    console.error('playwright is required (set NODE_PATH to the bundled Codex node_modules directory).');
    throw error;
}

const ROOT = path.resolve(__dirname, '..');
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+4iH7WQAAAABJRU5ErkJggg==', 'base64');
const ENTRY_MODE = argValue('entry', 'modules') === 'dist' ? 'dist' : 'modules';
const MODULE_FILES = [
    'src/theme-schema.js',
    'src/theme-api.js',
    'src/theme-runtime.js',
    'src/theme-transactions.js',
    'src/theme-transfer.js',
    'src/theme-metadata.js',
    'src/editor-draft.js',
    'src/theme-pairs.js',
    'src/theme-series.js',
    'src/theme-bindings.js',
    'src/theme-appearance.js',
    'src/storage.js',
    'src/image-tools.js',
    'src/image-loader.js',
    'src/app-shell.js',
    'src/styles.js',
    'src/backgrounds.js',
    'src/ui-sheets.js',
    'src/ui-events.js',
    'src/ui-main.js',
];

function argValue(name, fallback) {
    const prefix = `--${name}=`;
    const found = process.argv.find((value) => value.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
}

function parseSizes() {
    return argValue('sizes', '200,1000,2000')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
}

function parseDatasets() {
    const value = argValue('dataset', 'light,mixed');
    return value.split(',').map((item) => item.trim()).filter((item) => item === 'light' || item === 'mixed' || item === 'images');
}

function makeCss(bytes, seed) {
    if (bytes <= 0) return '';
    const chunk = `.bench-${seed}{color:#${(seed % 0xffffff).toString(16).padStart(6, '0')};}`;
    return chunk.repeat(Math.ceil(bytes / chunk.length)).slice(0, bytes);
}

function makeThemes(count, dataset) {
    const themes = [];
    for (let index = 0; index < count; index += 1) {
        let cssBytes = 0;
        if (dataset === 'mixed') {
            const bucket = index % 20;
            cssBytes = bucket === 0 ? 65536 : (bucket < 6 ? 4096 : 128);
        }
        themes.push({
            name: `Theme ${String(index).padStart(6, '0')}`,
            main_text_color: `#${(index % 0xffffff).toString(16).padStart(6, '0')}`,
            custom_css: makeCss(cssBytes, index),
        });
    }
    return themes;
}

function makeDataPreview(index, kind) {
    const color = kind === 'full' ? '#7556c9' : '#55a889';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><title>${kind}-${index}</title><rect width="16" height="12" fill="${color}"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makeMetadata(themes, dataset) {
    const themeMeta = {};
    const dayNight = { version: 1, pairs: {} };
    const series = { version: 1, groups: {} };
    if (dataset === 'images') {
        themes.forEach((theme, index) => {
            const useDataUrl = index >= 20 && index % 2 === 1;
            themeMeta[theme.name] = {
                category: `Category ${index % 12}`,
                tags: ['preview-fixture'],
                starred: false,
                useCount: 0,
                lastUsed: 0,
                author: 'Benchmark',
                description: '',
                imageData: useDataUrl ? makeDataPreview(index, 'full') : `/benchmark-images/full-${index}.png`,
                thumbData: useDataUrl ? makeDataPreview(index, 'thumb') : `/benchmark-images/thumb-${index}.png`,
                crop: { version: 2, mode: 'focus', zoom: 1.15, posX: 45, posY: 55 },
                backgroundName: '',
            };
        });
        if (themes[4]) themeMeta[themes[4].name].thumbData = null;
        if (themes[5]) themeMeta[themes[5].name].imageData = null;
        if (themes[6]) themeMeta[themes[6].name].crop = {
            x: 120, y: 30, width: 800, height: 600, naturalWidth: 1200, naturalHeight: 900,
        };
        if (themes[7]) themeMeta[themes[7].name].thumbData = '/benchmark-images/broken-7.png';
        if (themes[8]) {
            themeMeta[themes[8].name].previewData = themeMeta[themes[8].name].thumbData;
            themeMeta[themes[8].name].imageData = null;
            themeMeta[themes[8].name].thumbData = null;
        }
    }
    if (themes.length >= 6) {
        dayNight.pairs['benchmark-pair'] = {
            id: 'benchmark-pair',
            name: 'Benchmark Day Night',
            dayTheme: themes[0].name,
            nightTheme: themes[1].name,
            meta: {
                category: 'Category 0', tags: ['paired'], starred: false,
                useCount: 0, lastUsed: 0, author: 'Benchmark', description: 'Day night regression fixture',
            },
        };
        series.groups['benchmark-series'] = {
            id: 'benchmark-series',
            name: 'Benchmark Series',
            category: 'Category 0',
            members: [
                { kind: 'day-night', pairId: 'benchmark-pair' },
                { kind: 'theme', themeName: themes[2].name },
                { kind: 'theme', themeName: themes[3].name },
            ],
        };
    }
    return {
        themeMeta,
        categories: Array.from({ length: 12 }, (_, index) => `Category ${index}`),
        showBall: false,
        showFreq: true,
        fabImage: '',
        fabSize: 38,
        fabPos: null,
        bgPickerSize: 132,
        gridCardSize: 108,
        sortMode: 'name',
        followThemeAppearance: false,
        showThemeAvatarFrame: false,
        followThemePreviewShape: false,
        simplifyGridText: false,
        autoHideHeader: false,
        dayNight,
        series,
        bindings: { version: 2, characters: {}, chats: {}, manualTheme: '', manualTarget: null },
    };
}

function metricMap(metrics) {
    return Object.fromEntries(metrics.map((item) => [item.name, item.value]));
}

async function collectBrowserMetrics(cdp) {
    await cdp.send('HeapProfiler.collectGarbage');
    const response = await cdp.send('Performance.getMetrics');
    const metrics = metricMap(response.metrics);
    return {
        jsHeapUsedBytes: Math.round(metrics.JSHeapUsedSize || 0),
        jsHeapTotalBytes: Math.round(metrics.JSHeapTotalSize || 0),
        documents: Math.round(metrics.Documents || 0),
        nodes: Math.round(metrics.Nodes || 0),
        jsEventListeners: Math.round(metrics.JSEventListeners || 0),
    };
}

async function addModules(page) {
    if (ENTRY_MODE === 'dist') {
        await page.addScriptTag({ path: path.join(ROOT, 'dist/index.js') });
        return;
    }
    for (const relative of MODULE_FILES) {
        await page.addScriptTag({ path: path.join(ROOT, relative) });
    }
}

async function measureCase(browser, count, dataset) {
    const themes = makeThemes(count, dataset);
    const metadata = makeMetadata(themes, dataset);
    const initialMetadataCount = Object.keys(metadata.themeMeta).length;
    const settingsBody = JSON.stringify({ themes });
    const payloadBytes = Buffer.byteLength(settingsBody);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    const pageErrors = [];
    const imageRequests = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (pathname.startsWith('/benchmark-images/')) imageRequests.push(pathname);
    });

    await page.addInitScript(() => {
        const originalAdd = EventTarget.prototype.addEventListener;
        const originalRemove = EventTarget.prototype.removeEventListener;
        const listenerMaps = new WeakMap();
        function listenersFor(target) {
            let byType = listenerMaps.get(target);
            if (!byType) {
                byType = new Map();
                listenerMaps.set(target, byType);
            }
            return byType;
        }
        EventTarget.prototype.addEventListener = function (...args) {
            const type = String(args[0]);
            const handler = args[1];
            const byType = listenersFor(this);
            if (!byType.has(type)) byType.set(type, new Set());
            byType.get(type).add(handler);
            return originalAdd.apply(this, args);
        };
        EventTarget.prototype.removeEventListener = function (...args) {
            const type = String(args[0]);
            const handler = args[1];
            const byType = listenerMaps.get(this);
            if (byType && byType.has(type)) byType.get(type).delete(handler);
            return originalRemove.apply(this, args);
        };
        function listenerCount(target) {
            const byType = listenerMaps.get(target);
            if (!byType) return 0;
            let total = 0;
            byType.forEach((handlers) => { total += handlers.size; });
            return total;
        }
        window.__listenerCountFor = function (root) {
            if (!root) return 0;
            let total = listenerCount(root);
            if (root.querySelectorAll) {
                root.querySelectorAll('*').forEach((node) => { total += listenerCount(node); });
            }
            return total;
        };
        window.__globalListenerCount = function () {
            return listenerCount(window) + listenerCount(document);
        };
        window.__longTasks = [];
        try {
            new PerformanceObserver((list) => {
                list.getEntries().forEach((entry) => window.__longTasks.push({ start: entry.startTime, duration: entry.duration }));
            }).observe({ type: 'longtask', buffered: true });
        } catch (_) {}
        const originalFetch = window.fetch.bind(window);
        window.__fetchCounts = {};
        window.fetch = async function (...args) {
            const url = String(args[0] && args[0].url ? args[0].url : args[0]);
            window.__fetchCounts[url] = (window.__fetchCounts[url] || 0) + 1;
            return originalFetch(...args);
        };
    });

    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') {
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' });
            return;
        }
        if (url.pathname === '/csrf-token') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"benchmark"}' });
            return;
        }
        if (url.pathname === '/api/settings/get') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: settingsBody });
            return;
        }
        if (url.pathname === '/api/plugins/theme-manager/status') {
            await route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false}' });
            return;
        }
        if (url.pathname === '/scripts/power-user.js') {
            await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const power_user = window.__benchmarkPowerUser;' });
            return;
        }
        if (url.pathname === '/scripts/backgrounds.js') {
            await route.fulfill({ status: 200, contentType: 'text/javascript', body: "export const background_settings = { name: '', url: '', fitting: '' };" });
            return;
        }
        if (url.pathname === '/script.js') {
            await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export function saveSettingsDebounced() {}' });
            return;
        }
        if (url.pathname.startsWith('/benchmark-images/')) {
            if (url.pathname.includes('/broken-')) {
                await route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
                return;
            }
            await route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
            return;
        }
        if (url.pathname.startsWith('/api/themes/')) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
            return;
        }
        await route.fulfill({ status: 404, body: '' });
    });

    await page.goto('http://theme-benchmark.test/');
    await page.evaluate(({ inventory, persisted }) => {
        window.__themeInventory = inventory;
        window.__themeByName = new Map(inventory.map((theme) => [theme.name, theme]));
        window.__benchmarkPowerUser = Object.assign({ theme: inventory[0].name }, inventory[0]);
        localStorage.setItem('theme_mgr_v2', JSON.stringify(persisted));

        const menu = document.createElement('div');
        menu.id = 'extensionsMenu';
        document.body.appendChild(menu);
        const select = document.createElement('select');
        select.id = 'themes';
        const fragment = document.createDocumentFragment();
        inventory.forEach((theme) => {
            const option = document.createElement('option');
            option.value = theme.name;
            option.textContent = theme.name;
            fragment.appendChild(option);
        });
        select.appendChild(fragment);
        document.body.appendChild(select);
        const customCss = document.createElement('textarea');
        customCss.id = 'customCSS';
        document.body.appendChild(customCss);
        const customStyle = document.createElement('style');
        customStyle.id = 'custom-style';
        document.head.appendChild(customStyle);
        const background = document.createElement('div');
        background.id = 'bg1';
        document.body.appendChild(background);

        function applyNativeTheme() {
            const theme = window.__themeByName.get(select.value);
            if (!theme) return;
            Object.assign(window.__benchmarkPowerUser, theme, { theme: theme.name });
            document.documentElement.style.setProperty('--SmartThemeBodyColor', String(theme.main_text_color || ''));
            customCss.value = String(theme.custom_css || '');
            customStyle.textContent = String(theme.custom_css || '');
        }
        select.addEventListener('change', applyNativeTheme);
        applyNativeTheme();
        window.SillyTavern = { getContext: () => ({}) };
    }, { inventory: themes, persisted: metadata });

    await addModules(page);
    await page.evaluate((entryMode) => {
        if (entryMode !== 'dist') {
            window.__themeManager = window.ThemeMgrModules.createUiMain({ version: 'benchmark', modules: window.ThemeMgrModules });
            window.__themeManager.start();
        }
        window.__waitGridFlag = async function (name, expected, timeoutMs = 60000) {
            const started = performance.now();
            while (performance.now() - started < timeoutMs) {
                const area = document.getElementById('tm-grid-area');
                if (area && area.dataset[name] === expected) return performance.now();
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            throw new Error(`timed out waiting for grid ${name}=${expected}`);
        };
        window.__waitGridGenerationAfter = async function (previous) {
            const started = performance.now();
            while (performance.now() - started < 60000) {
                const area = document.getElementById('tm-grid-area');
                if (area && area.dataset.tmRenderGeneration !== previous) return area.dataset.tmRenderGeneration;
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            throw new Error('timed out waiting for a new grid generation');
        };
        window.__measureGridAction = async function (action, options = {}) {
            const areaBefore = document.getElementById('tm-grid-area');
            const previousGeneration = areaBefore ? areaBefore.dataset.tmRenderGeneration : '';
            const start = performance.now();
            action();
            const syncEnd = performance.now();
            if (options.expectGeneration !== false) await window.__waitGridGenerationAfter(previousGeneration);
            const firstBatchAt = options.expectGeneration === false
                ? syncEnd
                : await window.__waitGridFlag('tmFirstBatchReady', 'true');
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const interactiveAt = performance.now();
            if (options.expectGeneration !== false) await window.__waitGridFlag('tmRenderComplete', 'true');
            const fullAt = performance.now();
            return {
                syncMs: syncEnd - start,
                firstBatchMs: firstBatchAt - start,
                interactiveMs: interactiveAt - start,
                fullRenderMs: fullAt - start,
                cards: document.querySelectorAll('.tm-card').length,
            };
        };
    });
    await page.waitForSelector('#theme-mgr-ext-btn');
    await page.waitForTimeout(80);

    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    const beforeOpenMemory = await collectBrowserMetrics(cdp);

    const logicalCount = count >= 6 ? count - 1 : count;
    const firstOpen = await page.evaluate(async (expectedCount) => {
        const start = performance.now();
        document.getElementById('theme-mgr-ext-btn').click();
        const syncEnd = performance.now();
        const firstBatchAt = await window.__waitGridFlag('tmFirstBatchReady', 'true');
        const firstBatchCards = document.querySelectorAll('.tm-card').length;
        if (firstBatchCards < 1 || firstBatchCards > 52) throw new Error(`unexpected first batch card count: ${firstBatchCards}`);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const interactiveAt = performance.now();
        await window.__waitGridFlag('tmRenderComplete', 'true');
        const end = performance.now();
        const cards = document.querySelectorAll('.tm-card').length;
        if (cards !== expectedCount) throw new Error(`expected ${expectedCount} cards, got ${cards}`);
        const tasks = window.__longTasks.filter((entry) => entry.start >= start && entry.start <= end);
        return {
            syncMs: syncEnd - start,
            firstBatchVisibleMs: firstBatchAt - start,
            interactiveMs: interactiveAt - start,
            fullRenderMs: end - start,
            firstBatchCards,
            longestLongTaskMs: tasks.reduce((max, entry) => Math.max(max, entry.duration), 0),
            longTasks: tasks,
        };
    }, logicalCount);

    const dom = await page.evaluate(() => {
        const overlay = document.querySelector('.tm-overlay');
        const grid = document.getElementById('tm-grid-area');
        const cards = Array.from(document.querySelectorAll('.tm-card'));
        const cardNodeCounts = cards.map((card) => 1 + card.querySelectorAll('*').length);
        const cardListenerCounts = cards.map((card) => window.__listenerCountFor(card));
        const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        return {
            overlayElements: 1 + overlay.querySelectorAll('*').length,
            gridElements: 1 + grid.querySelectorAll('*').length,
            cards: cards.length,
            buttons: overlay.querySelectorAll('button').length,
            images: overlay.querySelectorAll('img').length,
            previewContainers: overlay.querySelectorAll('.tm-card-img,.tm-card-preview-slot,.tm-card-noimg').length,
            averageElementsPerCard: average(cardNodeCounts),
            minElementsPerCard: Math.min(...cardNodeCounts),
            maxElementsPerCard: Math.max(...cardNodeCounts),
            overlayListeners: window.__listenerCountFor(overlay),
            averageListenersPerCard: average(cardListenerCounts),
            globalListeners: window.__globalListenerCount(),
        };
    });
    let imageLoading = null;
    if (dataset === 'images') {
        await page.waitForTimeout(150);
        const initial = await page.evaluate(() => {
            const placeholder = window.ThemeMgrModules.imageLoader.PLACEHOLDER_SRC;
            const images = Array.from(document.querySelectorAll('img[data-theme-key]'));
            const real = images.filter((image) => image.getAttribute('src') !== placeholder);
            const last = images[images.length - 1];
            function sourceFor(index) {
                const image = document.querySelector(`.tm-card[data-key="theme:Theme ${String(index).padStart(6, '0')}"] img`);
                return image ? image.getAttribute('src') : '';
            }
            return {
                images: images.length,
                realSources: real.length,
                placeholderSources: images.length - real.length,
                loaded: images.filter((image) => image.dataset.imageState === 'loaded').length,
                farCardStillPlaceholder: !!last && last.getAttribute('src') === placeholder,
                firstRealSource: real[0] ? real[0].getAttribute('src') : '',
                compatibility: {
                    imageOnly: sourceFor(4),
                    thumbOnly: sourceFor(5),
                    legacyCrop: sourceFor(6),
                    legacyPreview: sourceFor(8),
                    brokenFallback: !!document.querySelector('.tm-card[data-key="theme:Theme 000007"].image-error .tm-card-noimg'),
                },
            };
        });
        if (initial.realSources < 1 || initial.realSources >= initial.images) {
            throw new Error(`viewport loading resolved ${initial.realSources}/${initial.images} initial images`);
        }
        if (!initial.farCardStillPlaceholder || !initial.firstRealSource.includes('/thumb-')) {
            throw new Error('performance preview selection or distant placeholder state is incorrect');
        }
        if (!initial.compatibility.imageOnly.includes('/full-4.png') ||
            !initial.compatibility.thumbOnly.includes('/thumb-5.png') ||
            !initial.compatibility.legacyCrop.includes('/full-6.png') ||
            !initial.compatibility.legacyPreview.includes('/thumb-8.png') ||
            !initial.compatibility.brokenFallback) {
            throw new Error(`preview compatibility fallback failed: ${JSON.stringify(initial.compatibility)}`);
        }

        const fastScroll = await page.evaluate(async () => {
            const placeholder = window.ThemeMgrModules.imageLoader.PLACEHOLDER_SRC;
            const area = document.getElementById('tm-grid-area');
            const images = Array.from(document.querySelectorAll('img[data-theme-key]'));
            const last = images[images.length - 1];
            area.scrollTop = area.scrollHeight;
            const started = performance.now();
            while (performance.now() - started < 10000) {
                if (last && last.dataset.imageState === 'loaded') break;
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            const source = last ? last.getAttribute('src') : '';
            return {
                loaded: !!last && last.dataset.imageState === 'loaded',
                sourceResolved: !!last && source !== placeholder,
                sourceType: source.startsWith('data:image/') ? 'data-url' : 'url',
                key: last && last.dataset.themeKey,
            };
        });
        if (!fastScroll.loaded || !fastScroll.sourceResolved) throw new Error('fast scroll did not load the final preview');

        const lightbox = await page.evaluate(() => {
            const area = document.getElementById('tm-grid-area');
            area.scrollTop = 0;
            const menu = document.querySelector('.tm-card[data-key="theme:Theme 000002"] .tm-card-menu');
            if (!menu) throw new Error('lightbox fixture card is missing');
            menu.click();
            const view = document.getElementById('tm-ctx-view');
            if (!view) throw new Error('lightbox action is missing');
            view.click();
            const image = document.querySelector('.tm-lb-img');
            const source = image ? image.getAttribute('src') : '';
            const close = document.querySelector('.tm-lb-close');
            if (close) close.click();
            return { source, opened: !!image };
        });
        if (!lightbox.opened || !lightbox.source.includes('/full-2.png')) {
            throw new Error('lightbox did not keep the high-resolution source');
        }

        const quality = await page.evaluate(async () => {
            const area = document.getElementById('tm-grid-area');
            area.scrollTop = 0;
            document.getElementById('tm-bottom-settings').click();
            const sheet = document.querySelector('.tm-sheet-overlay');
            const select = document.getElementById('tm-preview-image-quality');
            const beforeQuality = area.dataset.tmRenderGeneration;
            select.value = 'quality';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            await window.__waitGridGenerationAfter(beforeQuality);
            await window.__waitGridFlag('tmRenderComplete', 'true');
            const qualityStarted = performance.now();
            let qualityImage = null;
            while (performance.now() - qualityStarted < 10000) {
                qualityImage = document.querySelector('.tm-card[data-key^="theme:"] img[data-image-state="loaded"]');
                if (qualityImage) break;
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            const qualitySource = qualityImage ? qualityImage.getAttribute('src') : '';
            const qualitySlot = qualityImage && qualityImage.closest('.tm-card-preview-slot');

            const beforePerformance = area.dataset.tmRenderGeneration;
            select.value = 'performance';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            await window.__waitGridGenerationAfter(beforePerformance);
            await window.__waitGridFlag('tmRenderComplete', 'true');
            const performanceStarted = performance.now();
            let performanceImage = null;
            while (performance.now() - performanceStarted < 10000) {
                performanceImage = document.querySelector('.tm-card[data-key^="theme:"] img[data-image-state="loaded"]');
                if (performanceImage) break;
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            const performanceSource = performanceImage ? performanceImage.getAttribute('src') : '';
            sheet.click();
            document.getElementById('tm-bottom-settings').click();
            const reopenedSheet = document.querySelector('.tm-sheet-overlay');
            const savedMode = document.getElementById('tm-preview-image-quality').value;
            reopenedSheet.click();
            return {
                qualitySource,
                performanceSource,
                responsiveStyle: qualitySlot ? qualitySlot.getAttribute('style') : '',
                savedMode,
            };
        });
        if (!quality.qualitySource.includes('/full-') || !quality.performanceSource.includes('/thumb-')) {
            throw new Error('quality setting did not switch between full and thumbnail grid sources');
        }
        if (!quality.responsiveStyle.includes('--tm-image-focus-x:45%') || quality.savedMode !== 'performance') {
            throw new Error(`quality switch changed responsive layout state or did not persist safely: ${JSON.stringify(quality)}`);
        }
        imageLoading = {
            initial,
            fastScroll,
            lightbox,
            quality,
            requestsAfterViewportChecks: imageRequests.length,
        };
    }
    const firstOpenMemory = await collectBrowserMetrics(cdp);
    const fetchCountsAfterOpen = await page.evaluate(() => ({ ...window.__fetchCounts }));
    const metadataCountAfterOpen = await page.evaluate(() => {
        const raw = localStorage.getItem('theme_mgr_v2');
        const data = raw ? JSON.parse(raw) : {};
        return Object.keys(data.themeMeta || {}).length;
    });

    const closeFirst = await page.evaluate(async () => {
        const start = performance.now();
        document.getElementById('tm-x').click();
        const syncMs = performance.now() - start;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { syncMs, totalMs: performance.now() - start, overlayPresent: !!document.querySelector('.tm-overlay') };
    });
    // Let the 400 ms click-through shield timer release its closure before GC.
    await page.waitForTimeout(500);
    const afterFirstCloseMemory = await collectBrowserMetrics(cdp);

    const reopen = await page.evaluate(async (expectedCount) => {
        const start = performance.now();
        document.getElementById('theme-mgr-ext-btn').click();
        const syncEnd = performance.now();
        const firstBatchAt = await window.__waitGridFlag('tmFirstBatchReady', 'true');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const interactiveAt = performance.now();
        await window.__waitGridFlag('tmRenderComplete', 'true');
        if (document.querySelectorAll('.tm-card').length !== expectedCount) throw new Error('reopen card count mismatch');
        return {
            syncMs: syncEnd - start,
            firstBatchVisibleMs: firstBatchAt - start,
            interactiveMs: interactiveAt - start,
            fullRenderMs: performance.now() - start,
        };
    }, logicalCount);
    const reopenMemory = await collectBrowserMetrics(cdp);
    const fetchCountsAfterReopen = await page.evaluate(() => ({ ...window.__fetchCounts }));

    const searchAll = await page.evaluate(async () => {
        const input = document.getElementById('tm-search-inp');
        return window.__measureGridAction(() => {
            input.value = 't';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
    const searchNarrow = await page.evaluate(async (lastIndex) => {
        const input = document.getElementById('tm-search-inp');
        const query = String(lastIndex).padStart(6, '0');
        return window.__measureGridAction(() => {
            input.value = query;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }, count - 1);
    const searchClear = await page.evaluate(async () => {
        const input = document.getElementById('tm-search-inp');
        return window.__measureGridAction(() => {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    const generationToken = await page.evaluate(async (lastIndex) => {
        const input = document.getElementById('tm-search-inp');
        const allButton = Array.from(document.querySelectorAll('.tm-catbtn')).find((item) => item.dataset.c === '__all__');
        allButton.click();
        const generationA = document.getElementById('tm-grid-area').dataset.tmRenderGeneration;
        input.value = String(lastIndex).padStart(6, '0');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const generationB = await window.__waitGridGenerationAfter(generationA);
        await window.__waitGridFlag('tmRenderComplete', 'true');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const keys = Array.from(document.querySelectorAll('.tm-card')).map((card) => card.dataset.key);
        return {
            generationA,
            generationB,
            cards: keys.length,
            staleCardsEntered: keys.some((key) => !key.endsWith(String(lastIndex).padStart(6, '0'))),
        };
    }, count - 1);
    await page.evaluate(async () => {
        const input = document.getElementById('tm-search-inp');
        await window.__measureGridAction(() => {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    const repeatedSearch = await page.evaluate(async (lastIndex) => {
        const area = document.getElementById('tm-grid-area');
        const initialGeneration = area.dataset.tmRenderGeneration;
        const input = document.getElementById('tm-search-inp');
        input.value = 'Theme 0';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const generationBeforeSecondInput = area.dataset.tmRenderGeneration;
        input.value = String(lastIndex).padStart(6, '0');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const finalGeneration = await window.__waitGridGenerationAfter(initialGeneration);
        await window.__waitGridFlag('tmRenderComplete', 'true');
        return {
            initialGeneration,
            generationBeforeSecondInput,
            finalGeneration,
            cards: document.querySelectorAll('.tm-card').length,
        };
    }, count - 1);

    const imeSearch = await page.evaluate(async () => {
        const input = document.getElementById('tm-search-inp');
        const area = document.getElementById('tm-grid-area');
        const initialGeneration = area.dataset.tmRenderGeneration;
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
        input.value = 'zhu';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'zhu', isComposing: true }));
        for (let index = 0; index < 8; index += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
        const generationDuringComposition = area.dataset.tmRenderGeneration;
        input.value = '不存在的中文检索';
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '不存在的中文检索' }));
        const finalGeneration = await window.__waitGridGenerationAfter(initialGeneration);
        await window.__waitGridFlag('tmRenderComplete', 'true');
        return { initialGeneration, generationDuringComposition, finalGeneration, cards: document.querySelectorAll('.tm-card').length };
    });
    await page.evaluate(async () => {
        const input = document.getElementById('tm-search-inp');
        await window.__measureGridAction(() => {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    const category = await page.evaluate(async () => {
        const button = Array.from(document.querySelectorAll('.tm-catbtn')).find((item) => item.dataset.c === 'Category 0');
        return window.__measureGridAction(() => button.click());
    });
    const categoryAll = await page.evaluate(async () => {
        const button = Array.from(document.querySelectorAll('.tm-catbtn')).find((item) => item.dataset.c === '__all__');
        return window.__measureGridAction(() => button.click());
    });
    const gridSize = await page.evaluate(async () => {
        const area = document.getElementById('tm-grid-area');
        const before = area.style.getPropertyValue('--tm-grid-card-min');
        const result = await window.__measureGridAction(() => document.getElementById('tm-grid-zoom-in').click());
        const after = area.style.getPropertyValue('--tm-grid-card-min');
        if (before === after) throw new Error('grid size control did not update the card size');
        await window.__measureGridAction(() => document.getElementById('tm-grid-zoom-out').click());
        return Object.assign({ before, after }, result);
    });

    const rapidCategories = await page.evaluate(async () => {
        const buttons = ['Category 0', 'Category 1', 'Category 2'].map((category) =>
            Array.from(document.querySelectorAll('.tm-catbtn')).find((item) => item.dataset.c === category));
        const initialGeneration = document.getElementById('tm-grid-area').dataset.tmRenderGeneration;
        buttons.forEach((button) => button.click());
        const finalGeneration = await window.__waitGridGenerationAfter(initialGeneration);
        await window.__waitGridFlag('tmRenderComplete', 'true');
        const keys = Array.from(document.querySelectorAll('.tm-card')).map((card) => card.dataset.key);
        return {
            finalGeneration,
            cards: keys.length,
            wrongCategoryCards: keys.filter((key) => {
                if (!key.startsWith('theme:Theme ')) return true;
                return Number(key.slice(-6)) % 12 !== 2;
            }).length,
        };
    });
    await page.evaluate(async () => {
        const button = Array.from(document.querySelectorAll('.tm-catbtn')).find((item) => item.dataset.c === '__all__');
        await window.__measureGridAction(() => button.click());
    });

    const featureRegression = await page.evaluate(async (names) => {
        const seriesManage = document.querySelector('.tm-series-manage');
        if (!seriesManage) throw new Error('series block was not rendered');
        seriesManage.click();
        if (!document.getElementById('tm-series-manage-cancel')) throw new Error('series manage click failed');
        document.getElementById('tm-series-manage-cancel').click();
        const seriesToggle = document.querySelector('.tm-series-toggle');
        const seriesBlock = seriesToggle && seriesToggle.closest('.tm-series-block');
        seriesToggle.click();
        if (!seriesBlock.classList.contains('is-expanded')) throw new Error('series expansion failed');
        seriesToggle.click();
        if (seriesBlock.classList.contains('is-expanded')) throw new Error('series collapse failed');

        const pairCard = document.querySelector('.tm-card[data-key="pair:benchmark-pair"]');
        if (!pairCard) throw new Error('day/night card was not rendered');
        pairCard.click();
        const started = performance.now();
        while (performance.now() - started < 60000) {
            const select = document.getElementById('themes');
            const active = document.querySelector('.tm-card.on[data-key="pair:benchmark-pair"]');
            const applyFinished = document.getElementById('tm-popup-slot').textContent.includes('已应用：Benchmark Day Night');
            if (select && names.slice(0, 2).includes(select.value) && active && applyFinished) break;
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        if (!document.querySelector('.tm-card.on[data-key="pair:benchmark-pair"]')) throw new Error('day/night card apply failed');
        if (!document.getElementById('tm-popup-slot').textContent.includes('已应用：Benchmark Day Night')) {
            throw new Error('day/night apply callback did not finish');
        }

        await window.__measureGridAction(() => document.getElementById('tm-batch-toggle').click());
        const selectedKeys = names.slice(4, 6).map((name) => `theme:${name}`);
        selectedKeys.forEach((key) => {
            const card = document.querySelector(`.tm-card[data-key="${key}"]`);
            if (!card) throw new Error(`batch card missing: ${key}`);
            card.click();
        });
        const selectedCards = document.querySelectorAll('.tm-card.batch-sel').length;
        const dayNightButton = document.getElementById('tm-batch-day-night');
        if (selectedCards !== 2 || dayNightButton.disabled) throw new Error('delegated batch selection failed');
        dayNightButton.click();
        if (!document.getElementById('tm-pair-cancel')) throw new Error('batch day/night action failed');
        document.getElementById('tm-pair-cancel').click();
        document.getElementById('tm-batch-series').click();
        if (!document.getElementById('tm-series-create-cancel')) throw new Error('batch series action failed');
        document.getElementById('tm-series-create-cancel').click();
        await window.__measureGridAction(() => document.getElementById('tm-batch-toggle').click());
        return { series: true, dayNight: true, batchSelection: true, selectedCards };
    }, themes.map((theme) => theme.name));

    const sort = await page.evaluate(async () => {
        const chip = document.querySelector('.tm-sort-chip[data-sort="recent"]');
        return window.__measureGridAction(() => chip.click());
    });

    await page.evaluate(() => document.querySelector('.tm-card-menu').click());
    const favorite = await page.evaluate(async () => {
        return window.__measureGridAction(() => document.getElementById('tm-ctx-star').click(), { expectGeneration: false });
    });

    const targetName = themes[Math.max(1, themes.length - 1)].name;
    const inventoryCallsBeforeSwitch = await page.evaluate(() => window.__fetchCounts['/api/settings/get'] || 0);
    const switchStart = await page.evaluate((name) => {
        const card = Array.from(document.querySelectorAll('.tm-card')).find((item) => item.dataset.key === `theme:${name}`);
        if (!card) throw new Error(`target card not found: ${name}`);
        const start = performance.now();
        const generation = document.getElementById('tm-grid-area').dataset.tmRenderGeneration;
        window.__switchStart = start;
        card.click();
        return { start, generation };
    }, targetName);
    await page.waitForFunction((name) => {
        const select = document.getElementById('themes');
        const active = Array.from(document.querySelectorAll('.tm-card.on')).some((card) => card.dataset.key === `theme:${name}`);
        return select && select.value === name && active;
    }, targetName);
    await page.evaluate((generation) => window.__waitGridGenerationAfter(generation).then(() => window.__waitGridFlag('tmRenderComplete', 'true')), switchStart.generation);
    const switchTheme = await page.evaluate(async (start) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { totalMs: performance.now() - start };
    }, switchStart.start);
    const inventoryCallsAfterSwitch = await page.evaluate(() => window.__fetchCounts['/api/settings/get'] || 0);
    switchTheme.fullInventoryReads = inventoryCallsAfterSwitch - inventoryCallsBeforeSwitch;

    const warmTargetName = await page.evaluate((excluded) => {
        const card = Array.from(document.querySelectorAll('.tm-card')).find((item) =>
            item.dataset.key.startsWith('theme:') && item.dataset.key !== `theme:${excluded}`);
        return card ? card.dataset.key.slice('theme:'.length) : '';
    }, targetName);
    if (!warmTargetName) throw new Error('no rendered warm-switch target found');
    const inventoryCallsBeforeWarmSwitch = inventoryCallsAfterSwitch;
    const warmSwitchStart = await page.evaluate((name) => {
        const card = Array.from(document.querySelectorAll('.tm-card')).find((item) => item.dataset.key === `theme:${name}`);
        if (!card) throw new Error(`warm target card not found: ${name}`);
        const start = performance.now();
        const generation = document.getElementById('tm-grid-area').dataset.tmRenderGeneration;
        card.click();
        return { start, generation };
    }, warmTargetName);
    await page.waitForFunction((name) => {
        const select = document.getElementById('themes');
        const active = Array.from(document.querySelectorAll('.tm-card.on')).some((card) => card.dataset.key === `theme:${name}`);
        return select && select.value === name && active;
    }, warmTargetName);
    await page.evaluate((generation) => window.__waitGridGenerationAfter(generation).then(() => window.__waitGridFlag('tmRenderComplete', 'true')), warmSwitchStart.generation);
    const switchThemeWarm = await page.evaluate(async (start) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { totalMs: performance.now() - start };
    }, warmSwitchStart.start);
    const inventoryCallsAfterWarmSwitch = await page.evaluate(() => window.__fetchCounts['/api/settings/get'] || 0);
    switchThemeWarm.fullInventoryReads = inventoryCallsAfterWarmSwitch - inventoryCallsBeforeWarmSwitch;

    const targetKey = `theme:${targetName}`;
    await page.evaluate((key) => {
        const menu = Array.from(document.querySelectorAll('.tm-card-menu')).find((item) => item.dataset.key === key);
        menu.click();
        document.getElementById('tm-ctx-edit').click();
    }, targetKey);
    await page.waitForSelector('#tm-dsave');
    const edit = await page.evaluate(async () => {
        const previewImage = document.querySelector('#tm-dimgarea img');
        const previewSource = previewImage ? previewImage.getAttribute('src') : '';
        document.getElementById('tm-dauthor').value = 'Edited benchmark author';
        const start = performance.now();
        document.getElementById('tm-dsave').click();
        const syncEnd = performance.now();
        while (document.getElementById('tm-dsave')) await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return { syncMs: syncEnd - start, totalMs: performance.now() - start, cards: document.querySelectorAll('.tm-card').length, previewSource };
    });
    if (dataset === 'images' && decodeURIComponent(edit.previewSource).indexOf('<title>full-') === -1 && edit.previewSource.indexOf('/full-') === -1) {
        throw new Error('screenshot editor did not keep the high-resolution source');
    }

    const pureCosts = await page.evaluate(async (persisted) => {
        const modules = window.ThemeMgrModules;
        const inventory = window.__themeInventory;
        const schema = modules.themeSchema;
        const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
        async function samples(fn) {
            const values = [];
            for (let index = 0; index < 3; index += 1) {
                const start = performance.now();
                await fn();
                values.push(performance.now() - start);
            }
            return median(values);
        }
        const api = modules.createThemeApi({ schema });
        const apiInventoryMs = await samples(async () => { await api.getSettingsInventory(); });
        const runtimeCaptureMs = await samples(async () => {
            const runtime = modules.createThemeRuntime({
                schema,
                api: {
                    getSettingsInventory: () => Promise.resolve(inventory),
                    getRawSettingsInventory: () => Promise.resolve(inventory),
                },
            });
            await runtime.getInventory();
        });
        const cloneAllMs = await samples(() => { inventory.map((theme) => schema.cloneValue(theme)); });
        const baseline = Object.assign({}, inventory[0]);
        const normalizeAllMs = await samples(() => {
            inventory.map((theme) => schema.normalizeImportedThemeLikeSillyTavern(theme, baseline));
        });
        const logicalItemsMs = await samples(() => {
            modules.themePairs.buildLogicalItems(persisted, inventory.map((theme) => theme.name));
        });
        const logicalItems = modules.themePairs.buildLogicalItems(persisted, inventory.map((theme) => theme.name));
        const sortNameMs = await samples(() => {
            logicalItems.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        });
        return { apiInventoryMs, runtimeCaptureMs, cloneAllMs, normalizeAllMs, logicalItemsMs, sortNameMs };
    }, metadata);

    const cancelOnClose = await page.evaluate(async () => {
        const allButton = Array.from(document.querySelectorAll('.tm-catbtn')).find((item) => item.dataset.c === '__all__');
        allButton.click();
        const area = document.getElementById('tm-grid-area');
        const generation = area.dataset.tmRenderGeneration;
        const cardsBeforeClose = document.querySelectorAll('.tm-card').length;
        document.getElementById('tm-x').click();
        for (let index = 0; index < 6; index += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
            generation,
            cardsBeforeClose,
            overlayPresent: !!document.querySelector('.tm-overlay'),
            cardsAfterClose: document.querySelectorAll('.tm-card').length,
        };
    });

    const consecutiveOpenClose = await page.evaluate(async () => {
        const observations = [];
        for (let cycle = 0; cycle < 3; cycle += 1) {
            document.getElementById('theme-mgr-ext-btn').click();
            await window.__waitGridFlag('tmFirstBatchReady', 'true');
            const cardsBeforeClose = document.querySelectorAll('.tm-card').length;
            document.getElementById('tm-x').click();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            observations.push({ cardsBeforeClose, overlayPresent: !!document.querySelector('.tm-overlay'), cardsAfterClose: document.querySelectorAll('.tm-card').length });
        }
        return observations;
    });

    await page.evaluate(async () => {
        document.getElementById('theme-mgr-ext-btn').click();
        await window.__waitGridFlag('tmRenderComplete', 'true');
    }, ENTRY_MODE);
    const shellLeave = await page.evaluate(async ({ expectedCount, hasImages }) => {
        const overlay = document.querySelector('.tm-overlay');
        const nav = overlay.querySelector('[data-tm-primary-nav]');
        const tabs = Array.from(nav.querySelectorAll('[data-tm-page-target]'));
        const pages = Array.from(overlay.querySelectorAll('[data-tm-page]'));
        const area = document.getElementById('tm-grid-area');
        const initialGeneration = area.dataset.tmRenderGeneration;
        const initialCards = document.querySelectorAll('.tm-card').length;
        if (tabs.length !== 3 || pages.length !== 3 || overlay.dataset.tmActivePage !== 'themes') {
            throw new Error('app shell did not initialize with three pages and themes active');
        }
        if (initialCards !== expectedCount || document.querySelectorAll('#tm-popup-slot').length !== 1) {
            throw new Error('theme page or shared popup root was duplicated');
        }

        const allButton = Array.from(document.querySelectorAll('.tm-catbtn')).find((item) => item.dataset.c === '__all__');
        allButton.click();
        const generationBeforeLeave = area.dataset.tmRenderGeneration;
        const cardsBeforeLeave = document.querySelectorAll('.tm-card').length;

        if (hasImages) {
            const menu = document.querySelector('.tm-card-menu');
            if (menu) {
                menu.click();
                const view = document.getElementById('tm-ctx-view');
                if (view) view.click();
            }
        }
        tabs.find((tab) => tab.dataset.tmPageTarget === 'avatars').click();
        for (let index = 0; index < 6; index += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
        const cardsAfterLeave = document.querySelectorAll('.tm-card').length;
        if (cardsAfterLeave !== cardsBeforeLeave) throw new Error('theme grid kept appending after leaving themes');
        if (document.querySelector('.tm-lightbox') || document.querySelector('.tm-sheet-overlay')) {
            throw new Error('shared popup content survived a primary page switch');
        }
        const avatarPage = document.getElementById('tm-page-avatars');
        if (overlay.dataset.tmActivePage !== 'avatars' || avatarPage.hidden || !avatarPage.textContent.includes('后续版本')) {
            throw new Error('avatar placeholder did not become active');
        }

        tabs.find((tab) => tab.dataset.tmPageTarget === 'backgrounds').click();
        const backgroundPage = document.getElementById('tm-page-backgrounds');
        if (overlay.dataset.tmActivePage !== 'backgrounds' || backgroundPage.hidden || !backgroundPage.textContent.includes('后续版本')) {
            throw new Error('background placeholder did not become active');
        }
        const settingsButton = document.getElementById('tm-bottom-settings');
        if (getComputedStyle(settingsButton).display === 'none') throw new Error('global settings entry is hidden outside themes');
        settingsButton.click();
        if (document.querySelectorAll('#tm-popup-slot').length !== 1 || !document.querySelector('.tm-sheet-overlay')) {
            throw new Error('settings did not use the single shared popup root');
        }
        return {
            navigation: tabs.map((tab) => tab.textContent.trim()),
            navListeners: window.__listenerCountFor(nav),
            initialGeneration,
            generationBeforeLeave,
            cardsBeforeLeave,
            cardsAfterLeave,
            activePage: overlay.dataset.tmActivePage,
            popupRoots: document.querySelectorAll('#tm-popup-slot').length,
        };
    }, { expectedCount: logicalCount, hasImages: dataset === 'images' });

    await page.setViewportSize({ width: 390, height: 720 });
    const mobileShell = await page.evaluate(() => {
        const overlay = document.querySelector('.tm-overlay');
        const nav = overlay.querySelector('.tm-primary-nav');
        const overlayRect = overlay.getBoundingClientRect();
        const overlayStyle = getComputedStyle(overlay);
        return {
            viewportWidth: innerWidth,
            documentClientWidth: document.documentElement.clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            overlayClientWidth: overlay.clientWidth,
            overlayScrollWidth: overlay.scrollWidth,
            overlayRectWidth: overlayRect.width,
            overlayBoxSizing: overlayStyle.boxSizing,
            overlayBorderLeft: overlayStyle.borderLeftWidth,
            overlayBorderRight: overlayStyle.borderRightWidth,
            overlayOverflow: overlay.scrollWidth - overlay.clientWidth,
            navigationClientWidth: nav.clientWidth,
            navigationScrollWidth: nav.scrollWidth,
            navigationOverflow: nav.scrollWidth - nav.clientWidth,
        };
    });
    if (mobileShell.documentOverflow > 1 || mobileShell.navigationOverflow > 1) {
        throw new Error(`mobile app shell overflowed horizontally: ${JSON.stringify(mobileShell)}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    const shellReturn = await page.evaluate(async ({ expectedCount, hasImages }) => {
        const overlay = document.querySelector('.tm-overlay');
        const nav = overlay.querySelector('[data-tm-primary-nav]');
        const themesTab = nav.querySelector('[data-tm-page-target="themes"]');
        const previousGeneration = document.getElementById('tm-grid-area').dataset.tmRenderGeneration;
        themesTab.click();
        await window.__waitGridGenerationAfter(previousGeneration);
        await window.__waitGridFlag('tmRenderComplete', 'true');
        if (document.querySelectorAll('.tm-card').length !== expectedCount) throw new Error('theme page did not fully remount');
        if (document.querySelector('.tm-sheet-overlay')) throw new Error('settings sheet survived the return to themes');
        let imageReloaded = true;
        if (hasImages) {
            const started = performance.now();
            let image = null;
            while (performance.now() - started < 10000) {
                image = document.querySelector('img[data-theme-key][data-image-state="loaded"]');
                if (image) break;
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            imageReloaded = !!image;
        }
        if (!imageReloaded) throw new Error('image loader did not resume after returning to themes');
        return {
            activePage: overlay.dataset.tmActivePage,
            activeTab: themesTab.getAttribute('aria-selected'),
            popupRoots: document.querySelectorAll('#tm-popup-slot').length,
            navListeners: window.__listenerCountFor(nav),
            cards: document.querySelectorAll('.tm-card').length,
            imageReloaded,
        };
    }, { expectedCount: logicalCount, hasImages: dataset === 'images' });
    const beforeFinalCloseMemory = await collectBrowserMetrics(cdp);
    const closeFinal = await page.evaluate(async () => {
        const start = performance.now();
        document.getElementById('tm-x').click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { totalMs: performance.now() - start, overlayPresent: !!document.querySelector('.tm-overlay') };
    });
    // Toasts intentionally retain their nodes for 2.7 s. Exclude that bounded
    // animation lifetime from the post-close leak observation.
    await page.waitForTimeout(3000);
    const afterFinalCloseMemory = await collectBrowserMetrics(cdp);
    const finalFetchCounts = await page.evaluate(() => ({ ...window.__fetchCounts }));

    await context.close();
    return {
        dataset,
        themes: count,
        settingsPayloadBytes: payloadBytes,
        firstOpen,
        dom,
        closeFirst,
        reopen,
        operations: {
            searchAll, searchNarrow, searchClear, generationToken, repeatedSearch, imeSearch,
            category, categoryAll, gridSize, rapidCategories, sort, favorite, switchTheme, switchThemeWarm, edit,
            featureRegression, cancelOnClose, consecutiveOpenClose,
        },
        pureCosts,
        inventory: {
            afterFirstOpen: fetchCountsAfterOpen['/api/settings/get'] || 0,
            afterReopen: fetchCountsAfterReopen['/api/settings/get'] || 0,
            final: finalFetchCounts['/api/settings/get'] || 0,
        },
        metadata: { initial: initialMetadataCount, afterFirstOpen: metadataCountAfterOpen },
        imageLoading,
        appShell: { leave: shellLeave, mobile: mobileShell, returned: shellReturn },
        memory: { beforeOpen: beforeOpenMemory, firstOpen: firstOpenMemory, afterFirstClose: afterFirstCloseMemory, reopen: reopenMemory, beforeFinalClose: beforeFinalCloseMemory, afterFinalClose: afterFinalCloseMemory },
        closeFinal,
        pageErrors,
    };
}

async function launchBrowser() {
    try {
        return await playwright.chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] });
    } catch (firstError) {
        const candidates = [
            process.env.THEME_MGR_BENCHMARK_BROWSER,
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ].filter(Boolean);
        for (const executablePath of candidates) {
            if (!fs.existsSync(executablePath)) continue;
            try {
                return await playwright.chromium.launch({ executablePath, headless: true, args: ['--js-flags=--expose-gc'] });
            } catch (_) {}
        }
        throw firstError;
    }
}

async function main() {
    const sizes = parseSizes();
    const datasets = parseDatasets();
    const started = performance.now();
    const browser = await launchBrowser();
    const results = [];
    try {
        for (const dataset of datasets) {
            for (const size of sizes) {
                console.error(`[benchmark] ${dataset} ${size}`);
                results.push(await measureCase(browser, size, dataset));
            }
        }
    } finally {
        await browser.close();
    }
    const report = {
        generatedAt: new Date().toISOString(),
        entry: ENTRY_MODE,
        safety: 'fresh browser contexts + in-memory fixtures + mocked HTTP; no SillyTavern theme directory access',
        durationMs: performance.now() - started,
        results,
    };
    const output = argValue('output', '');
    if (output) {
        const outputPath = path.resolve(ROOT, output);
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
        console.error(`[benchmark] full report: ${outputPath}`);
    }
    const summary = results.map((result) => ({
        entry: ENTRY_MODE,
        dataset: result.dataset,
        themes: result.themes,
        settingsPayloadBytes: result.settingsPayloadBytes,
        openSyncMs: result.firstOpen.syncMs,
        firstBatchVisibleMs: result.firstOpen.firstBatchVisibleMs,
        openInteractiveMs: result.firstOpen.interactiveMs,
        fullRenderMs: result.firstOpen.fullRenderMs,
        longestLongTaskMs: result.firstOpen.longestLongTaskMs,
        reopenSyncMs: result.reopen.syncMs,
        reopenFullRenderMs: result.reopen.fullRenderMs,
        overlayElements: result.dom.overlayElements,
        averageElementsPerCard: result.dom.averageElementsPerCard,
        overlayListeners: result.dom.overlayListeners,
        averageListenersPerCard: result.dom.averageListenersPerCard,
        operations: result.operations,
        pureCosts: result.pureCosts,
        inventory: result.inventory,
        metadata: result.metadata,
        imageLoading: result.imageLoading,
        appShell: result.appShell,
        heap: {
            beforeOpen: result.memory.beforeOpen.jsHeapUsedBytes,
            firstOpen: result.memory.firstOpen.jsHeapUsedBytes,
            afterFirstClose: result.memory.afterFirstClose.jsHeapUsedBytes,
            afterFinalClose: result.memory.afterFinalClose.jsHeapUsedBytes,
        },
        cdpNodes: {
            beforeOpen: result.memory.beforeOpen.nodes,
            firstOpen: result.memory.firstOpen.nodes,
            afterFirstClose: result.memory.afterFirstClose.nodes,
            afterFinalClose: result.memory.afterFinalClose.nodes,
        },
        cdpListeners: {
            beforeOpen: result.memory.beforeOpen.jsEventListeners,
            firstOpen: result.memory.firstOpen.jsEventListeners,
            afterFirstClose: result.memory.afterFirstClose.jsEventListeners,
            afterFinalClose: result.memory.afterFinalClose.jsEventListeners,
        },
        pageErrors: result.pageErrors,
    }));
    console.log(JSON.stringify({ generatedAt: report.generatedAt, durationMs: report.durationMs, summary }, null, 2));
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
