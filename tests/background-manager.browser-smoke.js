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
        await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div class="tm-overlay tm-dark" data-tm-active-page="backgrounds"><section class="tm-app-page tm-app-page-backgrounds" data-tm-page="backgrounds"></section><div id="popup"></div></div></body></html>');
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
            const pixel = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#456"/></svg>');
            const service = {
                getBackgroundListPromise: async () => names.slice(),
                getBackgroundThumbnailSource: async () => pixel,
                getBackgroundPath: () => pixel,
                uploadBackgroundFile: async (file) => { names.push(file.name); return file.name; },
                exportBackground: async () => true,
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
                openCategoryPicker: () => {},
                loadUiData: () => state,
                saveUiData: async () => true,
                toast: () => {},
                confirm: () => true,
            });
            window.__backgroundSmoke = { controller, state, names };
            await controller.mount();
        });

        assert(await page.locator('.tm-background-card').count() === 3, 'initial background cards did not render');
        const columns = await page.locator('[data-background-grid]').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
        assert(columns === 2, `mobile background grid expected 2 columns, got ${columns}`);

        await page.locator('[data-background-star="city.png"]').click();
        await page.waitForFunction(() => window.__backgroundSmoke.state.backgroundLibrary.assetMeta['city.png'].starred === true);
        assert(await page.locator('[data-background-star="city.png"]').getAttribute('class').then((value) => value.includes('is-starred')), 'favorite state did not rerender');

        await page.locator('[data-background-category="室内"]').click();
        assert(await page.locator('.tm-background-card').count() === 1, 'category filter did not narrow the grid');
        await page.locator('.tm-background-thumb').click();
        assert(await page.locator('.tm-lightbox').count() === 1, 'card click did not open image preview');
        await page.locator('.tm-lb-close').click();

        await page.locator('[data-background-menu="room.png"]').click();
        assert(await page.locator('[data-background-action]').count() === 3, 'background action menu is incomplete');
        await page.keyboard.press('Escape');

        await page.evaluate(async () => {
            const file = new File([new Uint8Array([137, 80, 78, 71])], 'new.png', { type: 'image/png' });
            await window.__backgroundSmoke.controller.importFiles([file]);
        });
        await page.locator('[data-background-category="__all__"]').click();
        assert(await page.locator('.tm-background-card').count() === 4, 'imported background did not appear in the grid');
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
