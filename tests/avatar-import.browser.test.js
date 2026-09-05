const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['image-tools.js', 'avatar-storage.js', 'avatar-image-tools.js', 'image-loader.js', 'avatar-page.js'];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function makeFixture(page, mimeType, alpha) {
    const dataUrl = await page.evaluate(({ mimeType, alpha }) => {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 18;
        const context = canvas.getContext('2d');
        if (alpha) context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = alpha ? 'rgba(25,120,210,.45)' : 'rgb(25,120,210)';
        context.fillRect(2, 2, 20, 14);
        return canvas.toDataURL(mimeType, 0.92);
    }, { mimeType, alpha });
    return {
        mimeType,
        supported: dataUrl.startsWith(`data:${mimeType}`),
        buffer: Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'),
    };
}

async function waitForIdle(page) {
    await page.waitForFunction(() => window.__avatarImport.page.getState().importing === false);
}

(async () => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>avatar import integration</title>');
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
        await page.setContent('<!doctype html><html><head></head><body><section class="tm-app-page tm-app-page-avatars" data-tm-page="avatars"></section></body></html>');
        for (const name of MODULES) await page.addScriptTag({ path: path.join(ROOT, 'src', name) });
        await page.evaluate(async () => {
            const modules = window.ThemeMgrModules;
            const dbName = `tm-avatar-import-${Date.now()}-${Math.random()}`;
            const store = modules.createAvatarStore({ dbName });
            const processor = modules.createAvatarImageProcessor({ imageTools: modules.imageTools });
            const runtime = {
                getCapabilities: () => ({ themeKey: null, character: { available: false }, user: { available: false } }),
                notifyAssetChanged() {}, deleteAsset: (id) => store.deleteAsset(id), clearBinding: async () => {}, beginEdit: async () => {},
            };
            const controller = modules.createAvatarPage({
                store, processor, runtime, imageLoader: modules.imageLoader, imageTools: modules.imageTools,
                getRoot: () => document.querySelector('[data-tm-page="avatars"]'), toast() {}, confirm: () => true,
            });
            document.querySelector('[data-tm-page="avatars"]').innerHTML = modules.avatarPage.buildPageHtml();
            await controller.mount();
            window.__avatarImport = { dbName, store, page: controller, originalPutAsset: store.putAsset };
        });

        const input = page.locator('[data-avatar-file]');
        const jpeg = await makeFixture(page, 'image/jpeg', false);
        const png = await makeFixture(page, 'image/png', true);
        const webp = await makeFixture(page, 'image/webp', true);
        assert(jpeg.supported && png.supported, 'Chromium did not create JPEG/PNG fixtures');

        await input.setInputFiles({ name: '中文头像.jpg', mimeType: 'image/jpeg', buffer: jpeg.buffer });
        await page.waitForFunction(() => window.__avatarImport.page.getState().count === 1);
        await waitForIdle(page);
        assert(await page.locator('.tm-avatar-page-card').count() === 1, 'JPEG card was not rendered');
        assert(await input.inputValue() === '', 'file input was not reset after the snapshot');

        await input.setInputFiles({ name: '透明头像.png', mimeType: 'image/png', buffer: png.buffer });
        await page.waitForFunction(() => window.__avatarImport.page.getState().count === 2);
        await waitForIdle(page);

        if (webp.supported) {
            await input.setInputFiles({ name: '头像.webp', mimeType: 'image/webp', buffer: webp.buffer });
            await page.waitForFunction(() => window.__avatarImport.page.getState().count === 3);
            await waitForIdle(page);
        }
        const afterFormats = await page.evaluate(() => window.__avatarImport.page.getState().count);

        await input.setInputFiles({ name: '无类型头像.PNG', mimeType: '', buffer: png.buffer });
        await page.waitForFunction((count) => window.__avatarImport.page.getState().count === count + 1, afterFormats);
        await waitForIdle(page);

        const beforeRepeat = await page.evaluate(() => window.__avatarImport.page.getState().count);
        await input.setInputFiles({ name: '重复头像.jpg', mimeType: 'image/jpeg', buffer: jpeg.buffer });
        await page.waitForFunction((count) => window.__avatarImport.page.getState().count === count + 1, beforeRepeat);
        await waitForIdle(page);
        await input.setInputFiles({ name: '重复头像.jpg', mimeType: 'image/jpeg', buffer: jpeg.buffer });
        await page.waitForFunction((count) => window.__avatarImport.page.getState().count === count + 2, beforeRepeat);
        await waitForIdle(page);

        const beforeInvalid = await page.evaluate(() => window.__avatarImport.page.getState().count);
        await input.setInputFiles({ name: '损坏头像.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not-an-image') });
        await waitForIdle(page);
        assert(await page.evaluate(() => window.__avatarImport.page.getState().count) === beforeInvalid, 'decode failure changed the library');
        assert((await page.locator('[data-avatar-notice]').textContent()).includes('图片解码失败'), 'decode failure was not visible');

        await page.evaluate(() => {
            const state = window.__avatarImport;
            state.store.putAsset = () => Promise.reject(Object.assign(new Error('simulated IDB failure'), { code: 'AVATAR_IDB_WRITE_FAILED' }));
        });
        await input.setInputFiles({ name: '存储失败.png', mimeType: 'image/png', buffer: png.buffer });
        await waitForIdle(page);
        assert(await page.evaluate(() => window.__avatarImport.page.getState().count) === beforeInvalid, 'IDB failure changed the visible library');
        assert((await page.locator('[data-avatar-notice]').textContent()).includes('本地存储失败'), 'IDB failure was not visible');

        const persistence = await page.evaluate(async () => {
            const state = window.__avatarImport;
            const reloaded = window.ThemeMgrModules.createAvatarStore({ dbName: state.dbName });
            await reloaded.ready;
            const assets = await reloaded.listAssets();
            return {
                count: assets.length,
                names: assets.map((asset) => asset.name),
                cardCount: document.querySelectorAll('.tm-avatar-page-card').length,
                duplicateTitle: Boolean(document.querySelector('.tm-avatar-page h2')),
                visiblePickers: [...document.querySelectorAll('[data-avatar-action="pick"]')].filter((button) => button.getClientRects().length).length,
            };
        });
        assert(persistence.count === beforeInvalid, 'committed assets were not readable from a fresh IndexedDB adapter');
        assert(persistence.cardCount === beforeInvalid, 'grid did not match the committed library');
        assert(persistence.names.includes('中文头像') && persistence.names.includes('无类型头像'), 'Chinese or empty-MIME file names were not preserved');
        assert(!persistence.duplicateTitle, 'Avatar Page repeated the shell title');
        assert(persistence.visiblePickers === 0, 'Avatar Page retained an in-page add control instead of the shared header entry');
        assert(pageErrors.length === 0, `unhandled browser errors: ${pageErrors.join('; ')}`);

        console.log(JSON.stringify({
            ok: true,
            jpeg: true,
            pngAlpha: true,
            webp: webp.supported ? 'tested' : 'skipped-not-supported',
            emptyMimeByExtension: true,
            repeatedImport: true,
            decodeFailureVisible: true,
            idbFailureVisible: true,
            persisted: persistence.count,
        }, null, 2));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
