const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['image-loader.js', 'background-library.js', 'ui-sheets.js', 'background-page.js'];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

(async () => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>background manager smoke</title>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.THEME_MGR_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
        await page.goto(origin);
        await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div class="tm-overlay tm-dark" data-tm-active-page="backgrounds"><section class="tm-app-page tm-app-page-backgrounds" data-tm-page="backgrounds"></section><div id="popup"></div></div></body></html>');
        for (const name of MODULES) await page.addScriptTag({ path: path.join(ROOT, 'src', name) });
        await page.evaluate(async () => {
            const modules = window.ThemeMgrModules;
            const root = document.querySelector('[data-tm-page="backgrounds"]');
            root.innerHTML = modules.backgroundPage.buildPageHtml(modules.imageLoader.PLACEHOLDER_SRC);
            const state = {
                backgroundLibrary: {
                    version: 1,
                    categories: ['城市', '室内'],
                    assetMeta: {
                        'city.png': { category: '城市', starred: false },
                        'room.png': { category: '室内', starred: true },
                    },
                    sortMode: 'name',
                    cardSize: 156,
                },
            };
            const names = ['city.png', 'room.png', 'plain.png'];
            const batchExports = [];
            const pixel = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#456"/></svg>');
            const service = {
                getBackgroundListPromise: async () => names.slice(),
                getBackgroundThumbnailSource: async () => pixel,
                getBackgroundPath: () => pixel,
                uploadBackgroundFile: async (file) => { names.push(file.name); return file.name; },
                exportBackground: async () => true,
                exportBackgroundBatch: async (selected) => { batchExports.push(selected.slice()); return true; },
                countThemeBindings: () => 0,
                deleteBackgroundOnServer: async (name) => { names.splice(names.indexOf(name), 1); return { metadataSaved: true, themeBindingsCleared: 0 }; },
            };
            const sheets = modules.createUiSheets({
                getPopupLayer: () => document.getElementById('popup'),
                load: () => state,
                esc: (value) => String(value),
            });
            const controller = modules.createBackgroundPage({
                document,
                backgrounds: service,
                library: modules.backgroundLibrary,
                imageLoader: modules.imageLoader,
                getRoot: () => root,
                createSheet: sheets.createSheet,
                closeSheet: sheets.closeSheet,
                createActionDialog: sheets.createActionDialog,
                openImageLightbox: sheets.openImageLightbox,
                openCategoryPicker: (options) => { window.__backgroundPicker = options; },
                loadUiData: () => state,
                saveUiData: async () => true,
                toast: () => {},
                confirm: () => true,
            });
            window.__backgroundSmoke = { controller, state, names, batchExports };
            await controller.mount();
        });

        assert(await page.locator('.tm-background-card').count() === 3, 'initial background cards did not render');
        const columns = await page.locator('[data-background-grid]').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
        assert(columns === 2, `mobile background grid expected 2 columns, got ${columns}`);
        assert(await page.locator('.tm-background-info').count() === 0, 'background cards should be image-only');
        assert(await page.locator('.tm-catcount').count() === 0, 'category filters should not show counts');
        assert(await page.locator('[data-background-category="__starred__"]').count() === 0, 'favorites should not occupy the category bar');

        for (let index = 0; index < 6; index += 1) await page.locator('[data-background-grid-zoom="out"]').click();
        const compactColumns = await page.locator('[data-background-grid]').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
        assert(compactColumns === 4, `compact mobile grid expected 4 columns, got ${compactColumns}`);
        for (let index = 0; index < 15; index += 1) await page.locator('[data-background-grid-zoom="in"]').click();
        const largeColumns = await page.locator('[data-background-grid]').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
        assert(largeColumns === 1, `large mobile grid expected 1 column, got ${largeColumns}`);

        await page.locator('[data-background-menu="city.png"]').click();
        assert((await page.locator('.tm-background-action-copy').innerText()).includes('city.png'), 'menu should contain the background name');
        assert(await page.locator('[data-background-action]').count() === 4, 'background action menu is incomplete');
        await page.locator('[data-background-action="favorite"]').click();
        await page.waitForFunction(() => window.__backgroundSmoke.state.backgroundLibrary.assetMeta['city.png'].starred === true);
        assert(await page.locator('[data-background-name="city.png"] .tm-badge-star').count() === 1, 'favorite badge did not rerender');

        await page.locator('[data-background-category="室内"]').click();
        assert(await page.locator('.tm-background-card').count() === 1, 'category filter did not narrow the grid');
        await page.locator('.tm-background-thumb').click();
        assert(await page.locator('.tm-lightbox').count() === 1, 'card click did not open image preview');
        await page.locator('.tm-lb-close').click();

        await page.locator('[data-background-category="__all__"]').click();
        await page.evaluate(() => window.__backgroundSmoke.controller.toggleBatchMode());
        await page.locator('[data-background-name="city.png"]').click();
        await page.locator('[data-background-name="room.png"]').click();
        assert(await page.locator('[data-background-batch-count]').innerText() === '2', 'batch selection count is wrong');
        await page.locator('[data-background-batch="category"]').click();
        await page.evaluate(() => window.__backgroundPicker.onSelect('城市'));
        await page.waitForFunction(() => window.__backgroundSmoke.state.backgroundLibrary.assetMeta['room.png'].category === '城市');
        await page.locator('[data-background-batch="all"]').click();
        assert(await page.locator('[data-background-batch-count]').innerText() === '3', 'batch select-all failed');
        await page.locator('[data-background-batch="export"]').click();
        await page.waitForFunction(() => window.__backgroundSmoke.batchExports.length === 1);
        assert(await page.evaluate(() => window.__backgroundSmoke.batchExports[0].join(',')) === 'city.png,plain.png,room.png', 'batch export selection is wrong');
        await page.evaluate(() => window.__backgroundSmoke.controller.toggleBatchMode());

        await page.evaluate(() => window.__backgroundSmoke.controller.openSettingsSheet());
        const settingsSummary = await page.locator('[data-background-settings-summary]').textContent();
        assert(settingsSummary === '背景 3 张 / 分类 2 个', `settings data summary is wrong: ${JSON.stringify(settingsSummary)}`);
        await page.keyboard.press('Escape');

        await page.evaluate(async () => {
            const file = new File([new Uint8Array([137, 80, 78, 71])], 'new.png', { type: 'image/png' });
            await window.__backgroundSmoke.controller.importFiles([file]);
        });
        assert(await page.locator('.tm-background-card').count() === 4, 'imported background did not appear in the grid');
        await page.evaluate(() => window.__backgroundSmoke.controller.toggleBatchMode());
        await page.locator('[data-background-name="plain.png"]').click();
        await page.locator('[data-background-name="new.png"]').click();
        await page.locator('[data-background-batch="delete"]').click();
        await page.waitForFunction(() => window.__backgroundSmoke.names.length === 2);
        assert(await page.locator('.tm-background-card').count() === 2, 'batch delete did not refresh the grid');
        assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`);
        console.log('background manager browser smoke passed');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
