const fs = require('node:fs');

function loadPlaywright() {
    try {
        return require('playwright');
    } catch (defaultError) {
        const explicitPath = process.env.THEME_MGR_PLAYWRIGHT_PATH;
        if (!explicitPath) {
            throw new Error('Playwright is unavailable; install it or set THEME_MGR_PLAYWRIGHT_PATH');
        }
        return require(explicitPath);
    }
}

const { chromium } = loadPlaywright();

const ST_URL = process.env.THEME_MGR_SMOKE_URL || 'http://127.0.0.1:8000/';
const CHROME_PATH = process.env.THEME_MGR_CHROME_PATH || undefined;
const THEME_SOURCE_PATH = process.env.THEME_MGR_SMOKE_THEME_SOURCE || '';
const EMPTY_BOOTSTRAP_SMOKE = process.env.THEME_MGR_SMOKE_EMPTY_BOOTSTRAP === '1';
const SMOKE_THEME_NAME = '__ThemeMgr_SingleFile_Smoke__';

function assert(condition, message) {
    if (!condition) throw new Error(`[single-file smoke] ${message}`);
}

async function waitForManagerRender(page) {
    await page.waitForSelector('.tm-overlay', { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('#tm-grid-area')?.dataset.tmRenderComplete === 'true', null, { timeout: 60_000 });
}

async function openManager(page) {
    const existing = page.locator('.tm-overlay');
    if (await existing.count()) return;
    const button = page.locator('#theme-mgr-ext-btn, #tm-fab-main').first();
    await button.waitFor({ state: 'attached', timeout: 90_000 });
    await button.evaluate((element) => element.click());
    await waitForManagerRender(page);
    await page.waitForTimeout(450);
}

async function closeTopSheet(page) {
    const cancel = page.locator('#tm-dcancel, #tm-import-cat-cancel').last();
    if (await cancel.count()) {
        await cancel.click();
        await page.waitForTimeout(100);
    }
}

async function closeAllSheets(page) {
    while (await page.locator('.tm-sheet-overlay').count()) {
        const sheet = page.locator('.tm-sheet-overlay').last();
        await sheet.click({ position: { x: 2, y: 2 } });
        await page.waitForTimeout(80);
    }
}

async function dismissHostDialogs(page) {
    return page.locator('dialog[open]').evaluateAll((openDialogs) => openDialogs.map((dialog) => {
        const summary = (dialog.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        dialog.close();
        return summary;
    }));
}

async function clickElement(locator) {
    await locator.waitFor({ state: 'attached' });
    await locator.evaluate((element) => element.click());
}

async function openCardEdit(page, cardKey) {
    await dismissHostDialogs(page);
    const card = page.locator(`.tm-card[data-key=${JSON.stringify(cardKey)}]`);
    await clickElement(card.locator('.tm-card-menu'));
    await clickElement(page.locator('#tm-ctx-edit'));
    await page.locator('#tm-dsave').waitFor({ state: 'visible' });
}

async function saveMetadata(page, author, description) {
    await dismissHostDialogs(page);
    await page.locator('#tm-dauthor').fill(author);
    await page.locator('#tm-ddesc').fill(description);
    await clickElement(page.locator('#tm-dsave'));
    await page.locator('#tm-dsave').waitFor({ state: 'detached', timeout: 30_000 });
}

async function readPluginDataSummary(page) {
    return page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('theme_mgr_db', 1);
        request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('data', 'readonly');
            const get = tx.objectStore('data').get('main');
            get.onerror = () => reject(get.error || new Error('IndexedDB read failed'));
            get.onsuccess = () => {
                const value = get.result || {};
                const data = value.data && typeof value.data === 'object' ? value.data : value;
                const pairs = data.dayNight?.pairs || {};
                const series = data.series?.groups || {};
                const bindings = data.bindings || {};
                resolve({
                    categories: Array.isArray(data.categories) ? data.categories.length : 0,
                    metadata: data.themeMeta && typeof data.themeMeta === 'object' ? Object.keys(data.themeMeta).length : 0,
                    pairs: Object.keys(pairs).length,
                    series: Object.keys(series).length,
                    characterBindings: Object.keys(bindings.characters || {}).length,
                    chatBindings: Object.keys(bindings.chats || {}).length,
                });
                db.close();
            };
        };
    }));
}

async function backgroundSnapshot(page) {
    return page.evaluate(() => {
        const bg = document.querySelector('#bg1');
        const nameControl = document.querySelector('#background_name');
        return {
            style: bg?.getAttribute('style') || '',
            inlineImage: bg?.style?.backgroundImage || '',
            controlValue: nameControl && 'value' in nameControl ? nameControl.value : '',
        };
    });
}

async function findUnboundOrdinaryCard(page, currentTheme) {
    const candidates = await page.locator('.tm-card[data-key^="theme:"]').evaluateAll((cards) => cards.map((card) => ({
        key: card.dataset.key,
        name: card.querySelector('.tm-card-name')?.textContent?.trim() || '',
    })));
    for (const candidate of candidates.slice(0, 30)) {
        if (!candidate.name || candidate.name === currentTheme) continue;
        await openCardEdit(page, candidate.key);
        const backgroundLabel = await page.locator('#tm-bg-bind .tm-bg-bind-name').textContent();
        await page.locator('#tm-dcancel').click();
        await page.waitForTimeout(80);
        if (backgroundLabel?.trim() === '不绑定背景') return candidate;
    }
    return null;
}

async function removeSmokeTheme(page) {
    await openManager(page);
    await closeAllSheets(page);
    const key = `theme:${SMOKE_THEME_NAME}`;
    const card = page.locator(`.tm-card[data-key=${JSON.stringify(key)}]`);
    if (!await card.count()) return false;
    await card.locator('.tm-card-menu').click();
    await page.locator('#tm-ctx-delete').click();
    await card.waitFor({ state: 'detached', timeout: 30_000 });
    return true;
}

async function importSmokeTheme(page) {
    assert(THEME_SOURCE_PATH, 'THEME_MGR_SMOKE_THEME_SOURCE is required for the import smoke');
    const source = JSON.parse(fs.readFileSync(THEME_SOURCE_PATH, 'utf8'));
    source.name = SMOKE_THEME_NAME;

    await removeSmokeTheme(page);
    await dismissHostDialogs(page);
    await clickElement(page.locator('#tm-bottom-settings'));
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#tm-imp-theme').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: `${SMOKE_THEME_NAME}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(source), 'utf8'),
    });
    await page.locator('#tm-import-cat-ok').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#tm-import-cat-ok').click();
    await page.locator('#tm-import-cat-ok').waitFor({ state: 'detached', timeout: 30_000 });
    await closeAllSheets(page);

    const card = page.locator(`.tm-card[data-key=${JSON.stringify(`theme:${SMOKE_THEME_NAME}`)}]`);
    await card.waitFor({ state: 'visible', timeout: 60_000 });
    const optionExists = await page.locator('#themes').evaluate((control, name) => {
        return Array.from(control.options || []).some((option) => option.value === name || option.textContent === name);
    }, SMOKE_THEME_NAME);
    assert(optionExists, 'imported theme did not enter the native theme selector');
    return true;
}

async function main() {
    const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    const pageErrors = [];
    const extensionRequests = [];
    const dialogs = [];
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
        if (request.url().includes('/theme-mgr/')) extensionRequests.push(request.url());
    });
    page.on('dialog', async (dialog) => {
        dialogs.push({ type: dialog.type(), message: dialog.message() });
        await dialog.accept();
    });

    const report = { phase: 'launch' };
    let emptyBootstrapStatusRequests = 0;
    let metadataRestore = null;
    let metadataCardKey = '';
    let imported = false;
    try {
        if (EMPTY_BOOTSTRAP_SMOKE) {
            await page.route('**/api/plugins/theme-manager/status', async (route) => {
                emptyBootstrapStatusRequests += 1;
                if (emptyBootstrapStatusRequests === 1) {
                    await route.abort('failed');
                    return;
                }
                await route.fulfill({
                    status: 404,
                    contentType: 'application/json',
                    body: JSON.stringify({ ok: false }),
                });
            });
        }
        report.phase = 'open-sillytavern';
        await page.goto(ST_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        report.phase = 'open-theme-manager';
        await openManager(page);
        await page.waitForTimeout(500);
        report.dismissedHostDialogs = await dismissHostDialogs(page);

        report.phase = 'verify-single-file-startup';
        report.bundleIsGenerated = await page.evaluate(async () => {
            const text = await fetch('/scripts/extensions/third-party/theme-mgr/index.js', { cache: 'no-store' }).then((response) => response.text());
            return text.startsWith('// GENERATED FILE - Theme Manager v4.0.4 single-file release');
        });
        report.version = await page.locator('.tm-version').textContent();
        report.cardCount = await page.locator('.tm-card').count();
        report.moduleRegistrations = await page.evaluate(() => Object.keys(window.ThemeMgrModules || {}).sort());
        report.data = await readPluginDataSummary(page);
        assert(report.bundleIsGenerated, 'the browser did not load the generated dist entry');
        assert(report.version?.trim() === 'v4.0.4', `unexpected UI version: ${report.version}`);
        assert(report.cardCount > 0, 'theme grid is empty');

        report.phase = 'metadata-save';
        const ordinary = page.locator('.tm-card[data-key^="theme:"]').first();
        metadataCardKey = await ordinary.getAttribute('data-key');
        assert(metadataCardKey, 'no ordinary theme card is available for metadata smoke');
        await openCardEdit(page, metadataCardKey);
        metadataRestore = {
            author: await page.locator('#tm-dauthor').inputValue(),
            description: await page.locator('#tm-ddesc').inputValue(),
        };
        const marker = `single-file-smoke-${Date.now()}`;
        await saveMetadata(page, marker, marker);
        await openCardEdit(page, metadataCardKey);
        assert(await page.locator('#tm-dauthor').inputValue() === marker, 'author did not persist');
        assert(await page.locator('#tm-ddesc').inputValue() === marker, 'description did not persist');
        await saveMetadata(page, metadataRestore.author, metadataRestore.description);
        metadataRestore = null;
        report.metadataSaveAndRestore = true;
        if (EMPTY_BOOTSTRAP_SMOKE) {
            report.emptyBootstrap = {
                statusRequests: emptyBootstrapStatusRequests,
                dataAfterSave: await readPluginDataSummary(page),
            };
            assert(emptyBootstrapStatusRequests === 2, `expected two backend status probes, got ${emptyBootstrapStatusRequests}`);
        }

        report.phase = 'theme-switch-and-background';
        const currentTheme = await page.locator('#themes').inputValue();
        const originalActiveKey = await page.locator('.tm-card.on').first().getAttribute('data-key').catch(() => null);
        const unbound = await findUnboundOrdinaryCard(page, currentTheme);
        assert(unbound, 'no unbound ordinary theme is available for background smoke');
        const beforeBackground = await backgroundSnapshot(page);
        await page.locator(`.tm-card[data-key=${JSON.stringify(unbound.key)}] .tm-card-img`).click();
        await page.waitForFunction((name) => document.querySelector('#themes')?.value === name, unbound.name, { timeout: 30_000 });
        await page.waitForTimeout(500);
        const afterBackground = await backgroundSnapshot(page);
        assert(JSON.stringify(afterBackground) === JSON.stringify(beforeBackground), 'unbound theme changed the SillyTavern background state');
        report.unboundBackgroundPreserved = true;
        report.themeSwitch = { from: currentTheme, to: unbound.name };
        if (originalActiveKey) {
            await page.locator(`.tm-card[data-key=${JSON.stringify(originalActiveKey)}] .tm-card-img`).click();
            await page.waitForFunction((name) => document.querySelector('#themes')?.value === name, currentTheme, { timeout: 30_000 });
        }

        report.phase = 'single-theme-import';
        imported = await importSmokeTheme(page);
        report.singleThemeImport = imported;
        report.smokeThemeCleaned = await removeSmokeTheme(page);
        imported = false;

        report.srcModuleRequests = extensionRequests.filter((url) => /\/theme-mgr\/src\//.test(url));
        report.extensionRequestCount = extensionRequests.length;
        report.extensionRequests = extensionRequests.slice(0, 30);
        report.initializationErrors = consoleErrors.filter((message) => message.includes('[美化管理] 初始化失败'));
        report.consoleErrorCount = consoleErrors.length;
        report.consoleErrors = consoleErrors.slice(0, 30);
        report.pageErrorCount = pageErrors.length;
        report.pageErrors = pageErrors.slice(0, 30);
        report.dialogCount = dialogs.length;
        report.dialogs = dialogs.slice(0, 30);
        assert(report.srcModuleRequests.length === 0, `runtime requested ${report.srcModuleRequests.length} src modules`);
        assert(report.initializationErrors.length === 0, 'Theme Manager reported an initialization error');
        assert(report.pageErrors.length === 0, `page errors occurred: ${report.pageErrors.join('; ')}`);

        report.phase = 'complete';
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        console.error(JSON.stringify({
            phase: report.phase,
            message: error.message,
            extensionRequestCount: extensionRequests.length,
            extensionRequests: extensionRequests.slice(0, 30),
            consoleErrorCount: consoleErrors.length,
            consoleErrors: consoleErrors.slice(0, 20),
            pageErrorCount: pageErrors.length,
            pageErrors: pageErrors.slice(0, 20),
            dialogCount: dialogs.length,
            dialogs: dialogs.slice(0, 20),
        }, null, 2));
        throw error;
    } finally {
        if (metadataRestore && metadataCardKey) {
            try {
                await openManager(page);
                await closeTopSheet(page);
                await openCardEdit(page, metadataCardKey);
                await saveMetadata(page, metadataRestore.author, metadataRestore.description);
            } catch (error) {
                console.error(`[single-file smoke] metadata restore failed: ${error.message}`);
            }
        }
        if (imported) {
            try {
                await removeSmokeTheme(page);
            } catch (error) {
                console.error(`[single-file smoke] theme cleanup failed: ${error.message}`);
            }
        }
        await browser.close();
    }
}

main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
