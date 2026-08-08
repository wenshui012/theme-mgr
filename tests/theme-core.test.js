const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.ThemeMgrModules = {};
require('../src/theme-schema.js');
require('../src/theme-api.js');
require('../src/theme-runtime.js');
require('../src/theme-transactions.js');
require('../src/theme-transfer.js');
require('../src/image-tools.js');
require('../src/theme-pairs.js');
require('../src/theme-series.js');
require('../src/theme-bindings.js');
require('../src/theme-appearance.js');

const modules = global.ThemeMgrModules;
const schema = modules.themeSchema;
const imageTools = modules.imageTools;
const appearance = modules.themeAppearance;
const pairs = modules.themePairs;
const series = modules.themeSeries;
const bindings = modules.themeBindings;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function completeTheme(name, overrides) {
    const theme = { name };
    schema.THEME_FIELDS.forEach((key, index) => {
        theme[key] = key === 'custom_css' ? `/* ${name} */` : `${key}:${index}`;
    });
    return Object.assign(theme, overrides || {});
}

function completeBaseline(overrides) {
    const baseline = {};
    schema.THEME_FIELDS.forEach((key, index) => {
        baseline[key] = key === 'custom_css' ? '/* baseline */' : `baseline:${key}:${index}`;
    });
    return Object.assign(baseline, overrides || {});
}

test('preview view normalization clamps v2 focus values and supplies safe defaults', () => {
    assert.deepEqual(imageTools.normalizePreviewView({
        version: 2,
        mode: 'focus',
        zoom: 8,
        posX: -12,
        posY: 140,
    }), {
        version: 2,
        mode: 'focus',
        zoom: 3,
        posX: 0,
        posY: 100,
    });
    assert.deepEqual(imageTools.normalizePreviewView(null), {
        version: 2,
        mode: 'focus',
        zoom: 1,
        posX: 50,
        posY: 50,
    });
});

test('preview view resolves legacy slider values and clamps zoom below one', () => {
    assert.deepEqual(imageTools.resolvePreviewView({
        zoom: 0.35,
        posX: 18,
        posY: 82,
    }), {
        version: 2,
        mode: 'focus',
        zoom: 1,
        posX: 18,
        posY: 82,
    });
});

test('preview view derives focus and zoom from legacy pixel crop geometry', () => {
    assert.deepEqual(imageTools.resolvePreviewView({
        x: 600,
        y: 0,
        width: 800,
        height: 600,
        naturalWidth: 1600,
        naturalHeight: 1200,
    }), {
        version: 2,
        mode: 'focus',
        zoom: 2,
        posX: 75,
        posY: 0,
    });
});

test('preview asset uses the full image instead of a legacy cropped thumbnail', () => {
    const asset = imageTools.resolvePreviewAsset({
        imageData: 'full-image.jpg',
        thumbData: 'legacy-cropped-thumb.jpg',
        crop: {
            x: 600,
            y: 0,
            width: 800,
            height: 600,
            naturalWidth: 1600,
            naturalHeight: 1200,
        },
    });

    assert.equal(asset.src, 'full-image.jpg');
    assert.deepEqual(asset.view, {
        version: 2,
        mode: 'focus',
        zoom: 2,
        posX: 75,
        posY: 0,
    });
});

test('preview asset prefers a full-composition thumbnail for a v2 focus view', () => {
    const view = { version: 2, mode: 'focus', zoom: 1.75, posX: 24, posY: 76 };
    const asset = imageTools.resolvePreviewAsset({
        imageData: 'original-image.jpg',
        thumbData: 'full-composition-thumb.jpg',
        crop: view,
    });

    assert.equal(asset.src, 'full-composition-thumb.jpg');
    assert.deepEqual(asset.view, view);
});

test('preview asset gives a legacy thumbnail the default view when no full image exists', () => {
    const asset = imageTools.resolvePreviewAsset({
        thumbData: 'legacy-only-thumb.jpg',
        crop: { zoom: 2.5, posX: 5, posY: 95 },
    });

    assert.equal(asset.src, 'legacy-only-thumb.jpg');
    assert.deepEqual(asset.view, {
        version: 2,
        mode: 'focus',
        zoom: 1,
        posX: 50,
        posY: 50,
    });
});

test('missing preview merge leaves an existing local image and its empty companion fields untouched', () => {
    const target = {
        author: 'Local Author',
        imageData: 'local-full-image.jpg',
        thumbData: null,
        crop: null,
    };
    const before = clone(target);
    const incoming = {
        imageData: 'incoming-full-image.jpg',
        thumbData: 'incoming-full-composition-thumb.jpg',
        crop: { version: 2, mode: 'focus', zoom: 1.8, posX: 30, posY: 70 },
    };

    imageTools.mergeMissingPreview(target, incoming);

    assert.deepEqual(target, before);
});

test('missing preview merge copies the complete incoming preview atomically into an empty local target', () => {
    const target = {
        author: 'Local Author',
        imageData: null,
        thumbData: null,
        crop: null,
    };
    const incoming = {
        imageData: 'incoming-full-image.jpg',
        thumbData: 'incoming-full-composition-thumb.jpg',
        crop: { version: 2, mode: 'focus', zoom: 2.2, posX: 20, posY: 80 },
    };

    imageTools.mergeMissingPreview(target, incoming);

    assert.deepEqual(target, {
        author: 'Local Author',
        imageData: 'incoming-full-image.jpg',
        thumbData: 'incoming-full-composition-thumb.jpg',
        crop: { version: 2, mode: 'focus', zoom: 2.2, posX: 20, posY: 80 },
    });
    incoming.crop.posX = 99;
    assert.equal(target.crop.posX, 20);
});

function makeRuntimeForTransfer(inventory, resolveOverride) {
    const cache = {};
    return {
        invalidate() {},
        getInventory() { return Promise.resolve(clone(inventory)); },
        findTheme(themes, name) { return (themes || []).find((theme) => theme && theme.name === name) || null; },
        resolveUsableTheme(name, candidate) {
            if (resolveOverride) return resolveOverride(name, candidate);
            if (!schema.isUsableTheme(candidate, name)) {
                const error = new Error(`incomplete: ${name}`);
                error.code = 'incomplete';
                return Promise.reject(error);
            }
            return Promise.resolve(clone(candidate));
        },
        remember(theme) { cache[theme.name] = clone(theme); },
        replaceInventory(themes) {
            Object.keys(cache).forEach((name) => { delete cache[name]; });
            (themes || []).forEach((theme) => {
                if (schema.isUsableTheme(theme, theme && theme.name)) cache[theme.name] = clone(theme);
            });
        },
        hydrate() { return true; },
        cache,
    };
}

function makeTransactionHarness(initialThemes, hooks) {
    hooks = hooks || {};
    const store = {};
    (initialThemes || []).forEach((theme) => { store[theme.name] = clone(theme); });
    const calls = [];
    const remembered = {};
    let saveCount = 0;
    let deleteCount = 0;
    let inventoryCount = 0;
    let headerCount = 0;

    const api = {
        getPostHeaders() {
            headerCount += 1;
            if (hooks.headerErrorAt === headerCount) return Promise.reject(new Error('injected header failure'));
            return Promise.resolve({ 'X-Test': String(headerCount) });
        },
        saveTheme(theme, headers) {
            saveCount += 1;
            calls.push({ type: 'save', name: theme.name, theme: clone(theme), headers });
            if (hooks.saveErrorAt === saveCount) return Promise.reject(new Error('injected save failure'));
            let written = clone(theme);
            if (typeof hooks.transformSave === 'function') written = hooks.transformSave(written, saveCount);
            store[written.name] = written;
            return Promise.resolve(written);
        },
        deleteTheme(name, headers) {
            deleteCount += 1;
            calls.push({ type: 'delete', name, headers });
            if (hooks.deleteErrorAt === deleteCount || hooks.deleteErrorName === name) {
                return Promise.reject(new Error('injected delete failure'));
            }
            delete store[name];
            return Promise.resolve(true);
        },
    };

    const runtime = {
        invalidate() {},
        getInventory(options) {
            inventoryCount += 1;
            if (hooks.inventoryErrorAt === inventoryCount) return Promise.reject(new Error('injected inventory failure'));
            let inventory = Object.values(store).map(clone);
            if (typeof hooks.transformInventory === 'function') {
                inventory = hooks.transformInventory(inventory, inventoryCount, store, options);
            }
            return Promise.resolve(clone(inventory));
        },
        findTheme(themes, name) { return (themes || []).find((theme) => theme && theme.name === name) || null; },
        resolveUsableTheme(name, candidate) {
            if (!schema.isUsableTheme(candidate, name)) {
                const error = new Error(`incomplete: ${name}`);
                error.code = 'incomplete';
                return Promise.reject(error);
            }
            return Promise.resolve(clone(candidate));
        },
        getBridge() { return hooks.bridge || null; },
        remember(theme) { remembered[theme.name] = clone(theme); },
        forget(name) { delete remembered[name]; },
        getCached(name) {
            const cached = hooks.cachedThemes && hooks.cachedThemes[name]
                ? hooks.cachedThemes[name]
                : remembered[name];
            return cached ? clone(cached) : null;
        },
    };

    return {
        store,
        calls,
        remembered,
        getInventoryCount() { return inventoryCount; },
        getHeaderCount() { return headerCount; },
        transactions: modules.createThemeTransactions({ schema, api, runtime }),
    };
}

test('theme schema distinguishes lazy placeholders, legacy partials, and complete themes', () => {
    const markedWithData = { name: 'Lazy', main_text_color: '#fff', __baibaokuLazyTheme: true };
    const nameOnly = { name: 'Empty' };
    const partial = { name: 'Legacy', custom_css: '' };
    const complete = completeTheme('Complete');

    assert.equal(schema.isLazyThemePlaceholder(markedWithData, 'Lazy'), true);
    assert.equal(schema.isUsableTheme(markedWithData, 'Lazy'), false);
    assert.equal(schema.isLazyThemePlaceholder(nameOnly, 'Empty'), true);
    assert.equal(schema.isLegacyPartialTheme(partial, 'Legacy'), true);
    assert.equal(schema.isUsableTheme(partial, 'Legacy'), true);
    assert.equal(schema.isCompleteTheme(partial, 'Legacy'), false);
    assert.equal(schema.isCompleteTheme(complete, 'Complete'), true);
});

test('SillyTavern-compatible normalization uses a stable baseline and preserves explicit partial fields', () => {
    const baseline = completeBaseline({ main_text_color: '#baseline', custom_css: 'baseline css' });
    const partial = { name: 'Legacy', main_text_color: '#legacy', custom_css: '', noShadows: false };
    const normalized = schema.normalizeImportedThemeLikeSillyTavern(partial, baseline);

    assert.equal(schema.isCompleteTheme(normalized, 'Legacy'), true);
    assert.equal(normalized.main_text_color, '#legacy');
    assert.equal(normalized.custom_css, '');
    assert.equal(normalized.noShadows, false);
    assert.equal(normalized.quote_text_color, baseline.quote_text_color);
    assert.equal(partial.quote_text_color, undefined);
    assert.equal(schema.normalizeImportedThemeLikeSillyTavern({ name: 'OnlyName' }, baseline), null);
});

test('filename sanitization detects names that map to the same SillyTavern file', () => {
    assert.equal(schema.sanitizeFilename('A:B'), schema.sanitizeFilename('AB'));
});

test('runtime accepts legacy partials directly but hydrates lazy placeholders', async (t) => {
    let ensureCalls = 0;
    const previousBridge = global.__baibaokuEarlyBridge;
    const previousHydrate = global.baibaokuHydrateTheme;
    t.after(() => {
        global.__baibaokuEarlyBridge = previousBridge;
        global.baibaokuHydrateTheme = previousHydrate;
    });
    global.__baibaokuEarlyBridge = {
        ensureThemeLoaded(name) {
            ensureCalls += 1;
            return Promise.resolve({ name, main_text_color: '#hydrated' });
        },
        clearSettingsGetCache() {},
    };
    global.baibaokuHydrateTheme = () => {};

    const api = {
        getSettingsInventory() { return Promise.resolve([]); },
        getRawSettingsInventory() { return Promise.resolve([]); },
    };
    const runtime = modules.createThemeRuntime({ schema, api });
    const legacy = await runtime.resolveUsableTheme('Legacy', { name: 'Legacy', custom_css: '' });
    const hydrated = await runtime.resolveUsableTheme('Lazy', { name: 'Lazy', __baibaokuLazyTheme: true });

    assert.deepEqual(legacy, { name: 'Legacy', custom_css: '' });
    assert.equal(ensureCalls, 1);
    assert.equal(hydrated.main_text_color, '#hydrated');
    assert.equal(Object.hasOwn(hydrated, schema.LAZY_THEME_MARKER), false);
    assert.deepEqual(runtime.getCached('Lazy'), hydrated);
});

test('runtime aborts when a lazy placeholder cannot hydrate', async (t) => {
    const previousBridge = global.__baibaokuEarlyBridge;
    t.after(() => { global.__baibaokuEarlyBridge = previousBridge; });
    global.__baibaokuEarlyBridge = { ensureThemeLoaded() { return Promise.resolve({ name: 'Lazy' }); } };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
    });
    await assert.rejects(
        runtime.resolveUsableTheme('Lazy', { name: 'Lazy', __baibaokuLazyTheme: true }),
        (error) => error.code === 'incomplete',
    );
});

test('theme appearance derives readable palettes from both light and dark beautifications', () => {
    const light = appearance.createPalette({
        text: 'rgba(77, 75, 79, 1)',
        background: 'rgba(255, 245, 250, 0.96)',
        accent: 'rgba(236, 190, 216, 1)',
    });
    const dark = appearance.createPalette({
        text: '#eeeeee',
        background: 'rgba(20, 18, 28, 0.94)',
        accent: '#8c73c9',
    });

    assert.equal(light.mode, 'light');
    assert.equal(dark.mode, 'dark');
    assert.ok(appearance.contrastRatio(
        appearance.parseCssColor(light.text),
        appearance.parseCssColor(light.background),
    ) >= 4.5);
    assert.ok(appearance.contrastRatio(
        appearance.parseCssColor(dark.text),
        appearance.parseCssColor(dark.background),
    ) >= 4.5);
    assert.ok(appearance.contrastRatio(
        appearance.parseCssColor(light.accent),
        appearance.parseCssColor(light.background),
    ) >= 3);
});

test('theme appearance safely falls back for transparent or malformed theme colors', () => {
    const palette = appearance.createPalette({
        text: 'not-a-color',
        background: 'rgba(0, 0, 0, 0)',
        chat: 'transparent',
        accent: 'also-invalid',
    });

    assert.match(palette.background, /^rgba\(/);
    assert.match(palette.text, /^rgba\(/);
    assert.equal(Object.values(palette).some((value) => String(value).includes('NaN')), false);
    assert.ok(appearance.contrastRatio(
        appearance.parseCssColor(palette.text),
        appearance.parseCssColor(palette.background),
    ) >= 4.5);
});

test('runtime evicts a detached batch inventory object from SillyTavern native theme cache', (t) => {
    const previousHydrate = global.baibaokuHydrateTheme;
    t.after(() => { global.baibaokuHydrateTheme = previousHydrate; });

    const nativeThemes = [completeTheme('Delete Me', { main_text_color: '#native-old' })];
    global.baibaokuHydrateTheme = (theme) => {
        const index = nativeThemes.findIndex((item) => item.name === theme.name);
        if (index === -1) nativeThemes.push(theme);
        else nativeThemes[index] = theme;
    };

    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
    });
    const detachedInventoryTheme = completeTheme('Delete Me', { main_text_color: '#detached' });

    runtime.evictNativeTheme('Delete Me', detachedInventoryTheme);

    assert.equal(nativeThemes.some((theme) => theme.name === 'Delete Me'), false);
    assert.equal(nativeThemes.find((theme) => theme.name === 'Delete Me'), undefined);
    assert.match(detachedInventoryTheme.name, /^__theme_mgr_deleted__/);
});

test('runtime replaces stale cached themes with the authoritative post-import inventory', () => {
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
    });
    runtime.remember({ name: 'Old cached theme', custom_css: 'old' });

    const inventory = [
        { name: '新主题 ✨', custom_css: 'new' },
        { name: 'Existing', main_text_color: '#123456' },
    ];
    runtime.replaceInventory(inventory);

    assert.equal(runtime.getCached('Old cached theme'), null);
    assert.deepEqual(runtime.getCached('新主题 ✨'), inventory[0]);
    assert.deepEqual(runtime.getCached('Existing'), inventory[1]);
});

test('newly imported theme falls back from stale native state and keeps the applied theme when only visual verification fails', async (t) => {
    const previousDocument = global.document;
    const previousToolkit = global.__baiBaiToolkitExtensionInstalled;
    const previousHydrate = global.baibaokuHydrateTheme;
    const previousRaf = global.requestAnimationFrame;
    t.after(() => {
        global.document = previousDocument;
        global.__baiBaiToolkitExtensionInstalled = previousToolkit;
        global.baibaokuHydrateTheme = previousHydrate;
        global.requestAnimationFrame = previousRaf;
    });

    const cssValues = { '--SmartThemeBodyColor': '#old' };
    const controls = {
        themes: {
            tagName: 'SELECT',
            selectedIndex: 0,
            options: [{ value: 'Old' }, { value: '刚导入 ✨' }],
        },
        customCSS: { value: 'old css' },
        'custom-style': { textContent: 'old css' },
    };
    global.document = {
        documentElement: { style: { getPropertyValue: (name) => cssValues[name] || '' } },
        getElementById: (id) => controls[id] || null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    global.baibaokuHydrateTheme = undefined;
    global.__baiBaiToolkitExtensionInstalled = {
        __baiBaiToolkitCustomCssCodeMirrorEditor: {
            enabled: true,
            view: { state: { doc: 'old css' } },
        },
    };

    const powerUser = { theme: 'Old', main_text_color: '#old', custom_css: 'old css' };
    const expected = { name: '刚导入 ✨', main_text_color: '#new', custom_css: 'new css' };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        stateVerifyTimeoutMs: 0,
        stateVerifyIntervalMs: 0,
        visualMaxAttempts: 2,
        visualRetryDelayMs: 0,
    });
    runtime.remember(expected);
    let rollbackCount = 0;

    const result = await runtime.applyThemeAndWait(
        expected.name,
        () => {
            // Mirrors ST's stale private themes[] path: the selected name changes,
            // but applyTheme cannot find the just-saved theme object.
            controls.themes.selectedIndex = 1;
            powerUser.theme = expected.name;
        },
        () => {
            powerUser.theme = expected.name;
            powerUser.main_text_color = expected.main_text_color;
            powerUser.custom_css = expected.custom_css;
            cssValues['--SmartThemeBodyColor'] = expected.main_text_color;
            controls.customCSS.value = expected.custom_css;
            controls['custom-style'].textContent = expected.custom_css;
        },
        () => { rollbackCount += 1; },
    );

    assert.equal(result.fallbackUsed, true);
    assert.equal(result.stateVerification.ok, true);
    assert.equal(result.visualVerification.ok, false);
    assert.deepEqual(result.visualVerification.mismatches, ['custom-css-editor']);
    assert.equal(powerUser.theme, expected.name);
    assert.equal(powerUser.custom_css, expected.custom_css);
    assert.equal(rollbackCount, 0);
});

test('visual verification waits for frames and retries a slow CSS update', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    const previousToolkit = global.__baiBaiToolkitExtensionInstalled;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
        global.__baiBaiToolkitExtensionInstalled = previousToolkit;
    });

    const cssValues = { '--SmartThemeBodyColor': '#old' };
    const themeControl = { tagName: 'SELECT', selectedIndex: 0, options: [{ value: 'Slow' }] };
    global.document = {
        documentElement: { style: { getPropertyValue: (name) => cssValues[name] || '' } },
        getElementById: (id) => id === 'themes' ? themeControl : null,
    };
    global.__baiBaiToolkitExtensionInstalled = undefined;
    let frameCount = 0;
    global.requestAnimationFrame = (callback) => {
        frameCount += 1;
        if (frameCount === 3) cssValues['--SmartThemeBodyColor'] = '#new';
        callback();
        return frameCount;
    };

    const powerUser = { theme: 'Slow', main_text_color: '#new' };
    const expected = { name: 'Slow', main_text_color: '#new' };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        visualMaxAttempts: 3,
        visualRetryDelayMs: 0,
    });
    runtime.remember(expected);

    const result = await runtime.applyThemeAndWait('Slow', () => {}, null, null);

    assert.equal(result.stateVerification.ok, true);
    assert.equal(result.visualVerification.ok, true);
    assert.equal(result.visualVerification.attempt, 2);
    assert.equal(frameCount, 3);
});

test('A B C imports switch immediately and can alternate with an old native theme without reopening', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    const previousToolkit = global.__baiBaiToolkitExtensionInstalled;
    const previousHydrate = global.baibaokuHydrateTheme;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
        global.__baiBaiToolkitExtensionInstalled = previousToolkit;
        global.baibaokuHydrateTheme = previousHydrate;
    });

    const themes = [
        { name: 'Old', main_text_color: '#old' },
        { name: 'A', main_text_color: '#a' },
        { name: 'B', main_text_color: '#b' },
        { name: 'C', main_text_color: '#c' },
    ];
    const options = themes.map((theme) => ({ value: theme.name }));
    const themeControl = { tagName: 'SELECT', selectedIndex: 0, options };
    const cssValues = { '--SmartThemeBodyColor': '#old' };
    const powerUser = { theme: 'Old', main_text_color: '#old' };
    global.document = {
        documentElement: { style: { getPropertyValue: (name) => cssValues[name] || '' } },
        getElementById: (id) => id === 'themes' ? themeControl : null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    global.__baiBaiToolkitExtensionInstalled = undefined;
    global.baibaokuHydrateTheme = undefined;

    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve(themes), getRawSettingsInventory: () => Promise.resolve(themes) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        stateVerifyTimeoutMs: 0,
        stateVerifyIntervalMs: 0,
        visualMaxAttempts: 1,
        visualRetryDelayMs: 0,
    });
    runtime.replaceInventory(themes);

    async function apply(name) {
        const expected = runtime.getCached(name);
        return runtime.applyThemeAndWait(
            name,
            () => {
                themeControl.selectedIndex = options.findIndex((option) => option.value === name);
                powerUser.theme = name;
                if (name === 'Old') {
                    powerUser.main_text_color = expected.main_text_color;
                    cssValues['--SmartThemeBodyColor'] = expected.main_text_color;
                }
            },
            () => {
                powerUser.theme = name;
                powerUser.main_text_color = expected.main_text_color;
                cssValues['--SmartThemeBodyColor'] = expected.main_text_color;
            },
            () => { throw new Error('no rollback expected'); },
        );
    }

    const results = [];
    for (const name of ['A', 'B', 'C', 'Old', 'A']) results.push(await apply(name));

    assert.deepEqual(results.map((result) => result.fallbackUsed), [true, true, true, false, true]);
    assert.equal(results.every((result) => result.stateVerification.ok && result.visualVerification.ok), true);
    assert.equal(powerUser.theme, 'A');
    assert.equal(cssValues['--SmartThemeBodyColor'], '#a');
});

test('native hydration path remains equivalent when a compatible theme bridge is available', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    const previousHydrate = global.baibaokuHydrateTheme;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
        global.baibaokuHydrateTheme = previousHydrate;
    });

    const expected = { name: 'Hydrated', main_text_color: '#hydrated' };
    const cssValues = { '--SmartThemeBodyColor': '#old' };
    const themeControl = { tagName: 'SELECT', selectedIndex: 0, options: [{ value: 'Hydrated' }] };
    const powerUser = { theme: 'Old', main_text_color: '#old' };
    let hydratedTheme = null;
    global.document = {
        documentElement: { style: { getPropertyValue: (name) => cssValues[name] || '' } },
        getElementById: (id) => id === 'themes' ? themeControl : null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    global.baibaokuHydrateTheme = (theme) => { hydratedTheme = clone(theme); };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([expected]), getRawSettingsInventory: () => Promise.resolve([expected]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        visualMaxAttempts: 1,
    });
    runtime.remember(expected);

    const result = await runtime.applyThemeAndWait('Hydrated', (prepared) => {
        assert.equal(prepared.hydrated, true);
        powerUser.theme = prepared.theme.name;
        powerUser.main_text_color = prepared.theme.main_text_color;
        cssValues['--SmartThemeBodyColor'] = prepared.theme.main_text_color;
    }, () => { throw new Error('fallback not expected'); }, null);

    assert.deepEqual(hydratedTheme, expected);
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.visualVerification.ok, true);
});

test('genuine state failure still rolls back and remains a failed theme switch', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
    });

    const themeControl = {
        tagName: 'SELECT',
        selectedIndex: 0,
        options: [{ value: 'Old' }, { value: 'Broken' }],
    };
    global.document = {
        documentElement: { style: { getPropertyValue: () => '#old' } },
        getElementById: (id) => id === 'themes' ? themeControl : null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    const powerUser = { theme: 'Old', main_text_color: '#old' };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        stateVerifyTimeoutMs: 0,
        stateVerifyIntervalMs: 0,
    });
    runtime.remember({ name: 'Broken', main_text_color: '#broken' });
    let rollbackCount = 0;

    await assert.rejects(
        runtime.applyThemeAndWait(
            'Broken',
            () => {},
            () => {},
            (prepared) => {
                rollbackCount += 1;
                powerUser.theme = prepared.theme.name;
                powerUser.main_text_color = prepared.theme.main_text_color;
                themeControl.selectedIndex = 0;
            },
        ),
        (error) => error.code === 'state-verify-failed' && error.rollbackRestored === true,
    );
    assert.equal(rollbackCount, 1);
    assert.equal(powerUser.theme, 'Old');
});

test('visual verifier errors are contained and never roll back a confirmed theme state', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
    });

    const expected = { name: 'Applied', main_text_color: '#new' };
    const powerUser = { theme: 'Applied', main_text_color: '#new' };
    global.document = {
        documentElement: { style: { getPropertyValue() { throw new Error('detached visual root'); } } },
        getElementById: (id) => id === 'themes'
            ? { tagName: 'SELECT', selectedIndex: 0, options: [{ value: 'Applied' }] }
            : null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        visualMaxAttempts: 1,
    });
    runtime.remember(expected);
    let rollbackCount = 0;

    const result = await runtime.applyThemeAndWait('Applied', () => {}, null, () => { rollbackCount += 1; });

    assert.equal(result.stateVerification.ok, true);
    assert.equal(result.visualVerification.ok, false);
    assert.deepEqual(result.visualVerification.mismatches, ['verification-error']);
    assert.equal(rollbackCount, 0);
    assert.equal(powerUser.theme, 'Applied');
});

test('theme API never submits markers or name-only objects but permits legacy partials', async (t) => {
    const previousFetch = global.fetch;
    const requests = [];
    t.after(() => { global.fetch = previousFetch; });
    global.fetch = async (url, options) => {
        requests.push({ url, body: options && options.body });
        return { ok: true, json: async () => ({}) };
    };
    const api = modules.createThemeApi({ schema });

    await assert.rejects(api.saveTheme({ name: 'Lazy', __baibaokuLazyTheme: true }, {}));
    await assert.rejects(api.saveTheme({ name: 'OnlyName' }, {}));
    await api.saveTheme({ name: 'Legacy', custom_css: '' }, {});

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/themes/save');
    assert.equal(requests[0].body.includes(schema.LAZY_THEME_MARKER), false);
});

test('export hydrates every requested theme, normalizes legacy partials with one baseline, and reports filled fields', async () => {
    const inventory = [
        { name: 'Legacy A', main_text_color: '#a' },
        { name: 'Legacy B', custom_css: '' },
    ];
    const baseline = completeBaseline();
    let baselineCalls = 0;
    const runtime = makeRuntimeForTransfer(inventory);
    const transfer = modules.createThemeTransfer({
        schema,
        runtime,
        transactions: {},
        captureBaseline() { baselineCalls += 1; return Promise.resolve(clone(baseline)); },
    });
    const result = await transfer.prepareExport(['Legacy A', 'Legacy B']);

    assert.equal(baselineCalls, 1);
    assert.equal(result.report.legacyCount, 2);
    assert.equal(
        result.report.filledFieldCount,
        schema.getMissingThemeFields(inventory[0]).length + schema.getMissingThemeFields(inventory[1]).length,
    );
    assert.equal(result.themes.every((theme) => schema.isCompleteTheme(theme, theme.name)), true);
    assert.equal(JSON.stringify(result.themes).includes(schema.LAZY_THEME_MARKER), false);
    assert.equal(result.themes[0].main_text_color, '#a');
    assert.equal(result.themes[1].custom_css, '');
});

test('export aborts with the failed theme names when lazy hydration fails', async () => {
    const inventory = [{ name: 'Broken Lazy', __baibaokuLazyTheme: true }];
    const runtime = makeRuntimeForTransfer(inventory, (name) => {
        const error = new Error(`cannot hydrate ${name}`);
        error.code = 'incomplete';
        return Promise.reject(error);
    });
    const transfer = modules.createThemeTransfer({ schema, runtime, transactions: {} });

    await assert.rejects(
        transfer.prepareExport(['Broken Lazy']),
        (error) => error.code === 'export-incomplete' && error.message.includes('Broken Lazy'),
    );
});

test('export fingerprint audit aborts when three differently named themes have identical configuration', async () => {
    const first = completeTheme('Duplicate One');
    const inventory = ['Duplicate One', 'Duplicate Two', 'Duplicate Three'].map((name) => {
        const theme = clone(first);
        theme.name = name;
        return theme;
    });
    const runtime = makeRuntimeForTransfer(inventory);
    const transfer = modules.createThemeTransfer({ schema, runtime, transactions: {} });

    await assert.rejects(
        transfer.prepareExport(inventory.map((theme) => theme.name)),
        (error) => error.code === 'export-duplicate' && error.details[0].names.length === 3,
    );
});

test('import rejects marker and name-only inputs before capturing a baseline or saving', async () => {
    let baselineCalls = 0;
    let saveCalls = 0;
    const transfer = modules.createThemeTransfer({
        schema,
        runtime: makeRuntimeForTransfer([]),
        transactions: { saveVerifiedTheme() { saveCalls += 1; return Promise.resolve({}); } },
        captureBaseline() { baselineCalls += 1; return Promise.resolve(completeBaseline()); },
    });

    await assert.rejects(
        transfer.importVerified([
            { name: 'Marked', main_text_color: '#fff', __baibaokuLazyTheme: true },
            { name: 'OnlyName' },
        ]),
        (error) => error.code === 'import-invalid' && error.details.length === 2,
    );
    assert.equal(baselineCalls, 0);
    assert.equal(saveCalls, 0);
});

test('batch import captures one fixed baseline before saving every partial theme', async () => {
    const baseline = completeBaseline({ quote_text_color: '#fixed' });
    let baselineCalls = 0;
    const savedThemes = [];
    const runtime = makeRuntimeForTransfer([]);
    runtime.remember({ name: 'Stale before import', custom_css: 'stale' });
    const existing = completeTheme('Existing inventory theme');
    const transfer = modules.createThemeTransfer({
        schema,
        runtime,
        transactions: {
            saveVerifiedThemes(themes) {
                themes.forEach((theme) => savedThemes.push(clone(theme)));
                baseline.quote_text_color = '#mutated-during-import';
                return Promise.resolve({
                    results: themes.map((theme) => ({ theme: clone(theme), overwritten: false })),
                    themes: [clone(existing)].concat(themes.map(clone)),
                });
            },
        },
        captureBaseline() { baselineCalls += 1; return Promise.resolve(clone(baseline)); },
    });

    const result = await transfer.importVerified([
        { name: 'Partial One', main_text_color: '#one' },
        { name: 'Partial Two', custom_css: '' },
    ]);

    assert.equal(baselineCalls, 1);
    assert.equal(result.results.every((item) => item.ok), true);
    assert.equal(savedThemes.length, 2);
    assert.equal(savedThemes[0].quote_text_color, '#fixed');
    assert.equal(runtime.cache['Stale before import'], undefined);
    assert.deepEqual(runtime.cache['Existing inventory theme'], existing);
    assert.deepEqual(runtime.cache['Partial One'], result.results[0].theme);
    assert.deepEqual(runtime.cache['Partial Two'], result.results[1].theme);
    assert.equal(savedThemes[1].quote_text_color, '#fixed');
    assert.equal(savedThemes[1].custom_css, '');
});

test('batch save uses one initial and one final inventory for any number of themes', async () => {
    const previous = completeTheme('Existing', { custom_css: '/* old */' });
    const batch = [
        completeTheme('Existing', { custom_css: '/* new */' }),
        completeTheme('Import Two'),
        completeTheme('Import Three'),
        completeTheme('Import Four'),
        completeTheme('Import Five'),
    ];
    const harness = makeTransactionHarness([previous]);

    const result = await harness.transactions.saveVerifiedThemes(batch);

    assert.equal(harness.getInventoryCount(), 2);
    assert.equal(harness.getHeaderCount(), 1);
    assert.equal(result.results.length, 5);
    assert.equal(result.results.every((item) => item.ok), true);
    assert.equal(result.results[0].overwritten, true);
    assert.equal(result.results.slice(1).every((item) => !item.overwritten), true);
    assert.equal(harness.calls.filter((call) => call.type === 'save').length, 5);
    batch.forEach((theme) => assert.deepEqual(harness.store[theme.name], theme));
});

test('batch save failure restores every attempted destination before reporting failure', async () => {
    const previous = completeTheme('Existing', { custom_css: '/* old */' });
    const batch = [
        completeTheme('Existing', { custom_css: '/* new */' }),
        completeTheme('Import Two'),
        completeTheme('Import Three'),
    ];
    const harness = makeTransactionHarness([previous], { saveErrorAt: 3 });

    await assert.rejects(
        harness.transactions.saveVerifiedThemes(batch),
        (error) => error.message === 'injected save failure' && error.rollbackRestored === true,
    );

    assert.deepEqual(harness.store.Existing, previous);
    assert.equal(harness.store['Import Two'], undefined);
    assert.equal(harness.store['Import Three'], undefined);
    assert.equal(harness.getHeaderCount(), 1);
    assert.equal(harness.getInventoryCount(), 2);
});

test('TauriTavern mobile batch verification accepts chat_width normalized to 100', async () => {
    const batch = [
        completeTheme('Mobile Import', { chat_width: 72, custom_css: '/* mobile */' }),
    ];
    const harness = makeTransactionHarness([], {
        transformInventory(inventory, inventoryCount) {
            if (inventoryCount !== 2) return inventory;
            return inventory.map((theme) => theme.name === 'Mobile Import'
                ? Object.assign({}, theme, { chat_width: 100 })
                : theme);
        },
    });

    global.__TAURITAVERN_MOBILE_RUNTIME_COMPAT__ = {};
    try {
        const result = await harness.transactions.saveVerifiedThemes(batch);

        assert.equal(result.results.length, 1);
        assert.equal(result.results[0].ok, true);
        assert.equal(result.results[0].theme.chat_width, 100);
        assert.equal(harness.getInventoryCount(), 2);
    } finally {
        delete global.__TAURITAVERN_MOBILE_RUNTIME_COMPAT__;
    }
});

test('desktop batch verification still rejects unexpected chat_width changes', async () => {
    const batch = [
        completeTheme('Desktop Import', { chat_width: 72, custom_css: '/* desktop */' }),
    ];
    const harness = makeTransactionHarness([], {
        transformInventory(inventory, inventoryCount) {
            if (inventoryCount !== 2) return inventory;
            return inventory.map((theme) => theme.name === 'Desktop Import'
                ? Object.assign({}, theme, { chat_width: 100 })
                : theme);
        },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedThemes(batch),
        (error) => error.code === 'batch-verify-failed' && error.rollbackRestored === true,
    );

    assert.equal(harness.store['Desktop Import'], undefined);
    assert.equal(harness.getInventoryCount(), 3);
});

test('batch final verification failure restores the complete original batch state', async () => {
    const previous = completeTheme('Existing', { custom_css: '/* old */' });
    const batch = [
        completeTheme('Existing', { custom_css: '/* new */' }),
        completeTheme('Import Two'),
    ];
    const harness = makeTransactionHarness([previous], {
        transformInventory(inventory, inventoryCount) {
            if (inventoryCount !== 2) return inventory;
            return inventory.map((theme) => theme.name === 'Import Two'
                ? Object.assign({}, theme, { custom_css: '/* corrupted */' })
                : theme);
        },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedThemes(batch),
        (error) => error.code === 'batch-verify-failed' && error.rollbackRestored === true,
    );

    assert.deepEqual(harness.store.Existing, previous);
    assert.equal(harness.store['Import Two'], undefined);
    assert.equal(harness.getInventoryCount(), 3);
});

test('batch rollback failure reports rollback-failed with a content-free state summary', async () => {
    const previous = completeTheme('Existing', { custom_css: '/* old */' });
    const replacement = completeTheme('Existing', { custom_css: '/* new */' });
    const harness = makeTransactionHarness([previous], {
        saveErrorAt: 2,
        transformInventory(inventory, inventoryCount) {
            if (inventoryCount !== 2) return inventory;
            return inventory.map((theme) => Object.assign({}, theme, { custom_css: '/* corrupted */' }));
        },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedThemes([replacement]),
        (error) => {
            assert.equal(error.code, 'rollback-failed');
            assert.equal(Array.isArray(error.details.state), true);
            assert.equal(error.details.state[0].restored, false);
            assert.equal(JSON.stringify(error.details).includes('/* old */'), false);
            assert.equal(JSON.stringify(error.details).includes('/* new */'), false);
            return true;
        },
    );
});

test('transactional rename preserves the exact legacy partial fields and saves before deleting', async () => {
    const original = { name: 'Legacy Old', main_text_color: '#abc', custom_css: '' };
    const harness = makeTransactionHarness([original]);
    const result = await harness.transactions.renameTheme('Legacy Old', 'Legacy New');

    assert.deepEqual(harness.store['Legacy New'], { name: 'Legacy New', main_text_color: '#abc', custom_css: '' });
    assert.equal(harness.store['Legacy Old'], undefined);
    assert.equal(result.newName, 'Legacy New');
    assert.equal(harness.getInventoryCount(), 2);
    assert.equal(harness.getHeaderCount(), 1);
    assert.equal(harness.calls[0].headers, harness.calls[1].headers);
    assert.deepEqual(result.transactionContext.sourceTheme, original);
    assert.equal(result.transactionContext.originalInventory.length, 1);
    assert.deepEqual(result.transactionContext.existingNames, ['Legacy Old']);
    assert.equal(result.transactionContext.previousDestinationTheme, null);
    assert.deepEqual(result.transactionContext.expectedRenamedTheme, {
        name: 'Legacy New',
        main_text_color: '#abc',
        custom_css: '',
    });
    assert.deepEqual(harness.calls.map((call) => `${call.type}:${call.name}`), ['save:Legacy New', 'delete:Legacy Old']);
});

test('bridge rename uses hydrated source and one final inventory when the native name list is complete', async () => {
    const original = { name: 'Bridge Old', main_text_color: '#bridge', custom_css: '' };
    let hydrateCalls = 0;
    const harness = makeTransactionHarness([original], {
        bridge: {
            ensureThemeLoaded(name) {
                hydrateCalls += 1;
                return Promise.resolve(clone(Object.assign({}, original, { name })));
            },
        },
    });

    const result = await harness.transactions.renameTheme('Bridge Old', 'Bridge New', {
        extraNames: ['Bridge Old'],
        extraNamesComplete: true,
    });

    assert.equal(hydrateCalls, 1);
    assert.equal(harness.getInventoryCount(), 1);
    assert.equal(harness.getHeaderCount(), 1);
    assert.equal(result.transactionContext.originalInventory, null);
    assert.deepEqual(result.transactionContext.existingNames, ['Bridge Old']);
    assert.deepEqual(harness.store['Bridge New'], { name: 'Bridge New', main_text_color: '#bridge', custom_css: '' });
    assert.equal(harness.store['Bridge Old'], undefined);
});

test('bridge rename falls back to two inventories when the supplied name list is not marked complete', async () => {
    const original = { name: 'Fallback Old', main_text_color: '#bridge' };
    const harness = makeTransactionHarness([original], {
        bridge: { ensureThemeLoaded() { return Promise.resolve(clone(original)); } },
    });

    await harness.transactions.renameTheme('Fallback Old', 'Fallback New', {
        extraNames: ['Fallback Old'],
    });

    assert.equal(harness.getInventoryCount(), 2);
});

test('runtime cache rename uses one final inventory when the native name list is complete', async () => {
    const original = { name: 'Cached Old', main_text_color: '#cached', custom_css: '' };
    const harness = makeTransactionHarness([original], {
        cachedThemes: { 'Cached Old': original },
    });

    const result = await harness.transactions.renameTheme('Cached Old', 'Cached New', {
        extraNames: ['Cached Old'],
        extraNamesComplete: true,
    });

    assert.equal(harness.getInventoryCount(), 1);
    assert.equal(result.transactionContext.originalInventory, null);
    assert.deepEqual(harness.store['Cached New'], { name: 'Cached New', main_text_color: '#cached', custom_css: '' });
    assert.equal(harness.store['Cached Old'], undefined);
});

test('runtime cache fast path rejects exact name conflicts before saving', async () => {
    const original = { name: 'Cached Source', main_text_color: '#cached' };
    const harness = makeTransactionHarness([
        original,
        { name: 'Existing', main_text_color: '#existing' },
    ], {
        cachedThemes: { 'Cached Source': original },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Cached Source', 'Existing', {
            extraNames: ['Cached Source', 'Existing'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'duplicate',
    );
    assert.equal(harness.getInventoryCount(), 0);
    assert.equal(harness.calls.length, 0);
});

test('runtime cache placeholders do not enter the fast path and safely fall back', async () => {
    const lazy = { name: 'Cached Lazy', __baibaokuLazyTheme: true };
    const harness = makeTransactionHarness([lazy], {
        cachedThemes: { 'Cached Lazy': lazy },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Cached Lazy', 'Cached Lazy New', {
            extraNames: ['Cached Lazy'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'incomplete',
    );
    assert.equal(harness.getInventoryCount(), 1);
    assert.equal(harness.calls.some((call) => call.type === 'save'), false);
});

test('runtime cache name-only objects do not enter the fast path or get saved', async () => {
    const nameOnly = { name: 'Cached Empty' };
    const harness = makeTransactionHarness([nameOnly], {
        cachedThemes: { 'Cached Empty': nameOnly },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Cached Empty', 'Cached Empty New', {
            extraNames: ['Cached Empty'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'incomplete',
    );
    assert.equal(harness.getInventoryCount(), 1);
    assert.equal(harness.calls.some((call) => call.type === 'save'), false);
});

test('bridge fast path still rejects sanitized filename conflicts before saving', async () => {
    const original = { name: 'Bridge Source', main_text_color: '#bridge' };
    const harness = makeTransactionHarness([
        original,
        { name: 'AB', main_text_color: '#existing' },
    ], {
        bridge: { ensureThemeLoaded() { return Promise.resolve(clone(original)); } },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Bridge Source', 'A:B', {
            extraNames: ['Bridge Source', 'AB'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'filename-conflict',
    );
    assert.equal(harness.getInventoryCount(), 0);
    assert.equal(harness.calls.length, 0);
});

test('save request failure preserves the old theme and does not leave a new file', async () => {
    const old = { name: 'Old', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], { saveErrorAt: 1 });

    await assert.rejects(harness.transactions.renameTheme('Old', 'New'), /injected save failure/);
    assert.deepEqual(harness.store.Old, old);
    assert.equal(harness.store.New, undefined);
});

test('standalone saveVerifiedTheme keeps its original read and post-save verification safety', async () => {
    const harness = makeTransactionHarness([]);
    const theme = { name: 'Standalone', main_text_color: '#safe' };

    await harness.transactions.saveVerifiedTheme(theme);

    assert.equal(harness.getInventoryCount(), 2);
    assert.equal(harness.getHeaderCount(), 1);
    assert.deepEqual(harness.store.Standalone, theme);
});

test('save verification failure preserves old theme and cleans the newly created file', async () => {
    const old = { name: 'Old', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], {
        transformSave(theme, count) {
            if (count === 1) theme.main_text_color = '#corrupted';
            return theme;
        },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Old', 'New'),
        (error) => error.code === 'verify-failed',
    );
    assert.deepEqual(harness.store.Old, old);
    assert.equal(harness.store.New, undefined);
    assert.equal(harness.calls.some((call) => call.type === 'delete' && call.name === 'New'), true);
});

test('failed overwrite verification restores the exact previous partial theme', async () => {
    const old = { name: 'Existing', main_text_color: '#old', custom_css: '' };
    const replacement = { name: 'Existing', main_text_color: '#new' };
    const harness = makeTransactionHarness([old], {
        transformSave(theme, count) {
            if (count === 1) theme.main_text_color = '#corrupted';
            return theme;
        },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedTheme(replacement),
        (error) => error.code === 'verify-failed',
    );
    assert.deepEqual(harness.store.Existing, old);
    assert.deepEqual(harness.calls.map((call) => `${call.type}:${call.name}`), ['save:Existing', 'save:Existing']);
});

test('delete failure is reported only after a fresh read confirms the old theme still exists', async () => {
    const old = { name: 'Keep Me', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], { deleteErrorName: 'Keep Me' });

    await assert.rejects(
        harness.transactions.deleteThemeVerified('Keep Me'),
        (error) => error.code === 'delete-failed',
    );
    assert.deepEqual(harness.store['Keep Me'], old);
});

test('batch delete uses one initial and one final inventory for every selected theme', async () => {
    const harness = makeTransactionHarness([
        completeTheme('Delete A'),
        completeTheme('Delete B'),
        completeTheme('Keep C'),
    ]);

    const result = await harness.transactions.deleteThemesVerified(['Delete A', 'Delete B', 'Delete A']);

    assert.deepEqual(result.results.map((item) => [item.name, item.ok]), [
        ['Delete A', true],
        ['Delete B', true],
    ]);
    assert.equal(harness.store['Delete A'], undefined);
    assert.equal(harness.store['Delete B'], undefined);
    assert.notEqual(harness.store['Keep C'], undefined);
    assert.equal(harness.getInventoryCount(), 2);
    assert.equal(harness.getHeaderCount(), 1);
    assert.deepEqual(
        harness.calls.filter((call) => call.type === 'delete').map((call) => call.name),
        ['Delete A', 'Delete B'],
    );
});

test('batch delete reports verified partial success without hiding failed items', async () => {
    const harness = makeTransactionHarness([
        completeTheme('Delete A'),
        completeTheme('Keep B'),
    ], { deleteErrorName: 'Keep B' });

    const result = await harness.transactions.deleteThemesVerified(['Delete A', 'Keep B']);

    assert.equal(result.results[0].name, 'Delete A');
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[1].name, 'Keep B');
    assert.equal(result.results[1].ok, false);
    assert.equal(result.results[1].requestError instanceof Error, true);
    assert.equal(harness.store['Delete A'], undefined);
    assert.notEqual(harness.store['Keep B'], undefined);
    assert.equal(harness.getInventoryCount(), 2);
});

test('batch delete read failure sends no delete requests', async () => {
    const harness = makeTransactionHarness([
        completeTheme('Keep A'),
        completeTheme('Keep B'),
    ], { inventoryErrorAt: 1 });

    await assert.rejects(
        harness.transactions.deleteThemesVerified(['Keep A', 'Keep B']),
        (error) => error.code === 'batch-delete-read-failed',
    );

    assert.deepEqual(harness.calls.filter((call) => call.type === 'delete'), []);
    assert.notEqual(harness.store['Keep A'], undefined);
    assert.notEqual(harness.store['Keep B'], undefined);
});

test('rename delete failure restores the old theme and safely removes the new theme', async () => {
    const old = { name: 'Old Safe', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], { deleteErrorName: 'Old Safe' });

    await assert.rejects(
        harness.transactions.renameTheme('Old Safe', 'New Verified'),
        (error) => error.code === 'delete-failed' && error.rollbackRestored === true,
    );
    assert.deepEqual(harness.store['Old Safe'], old);
    assert.equal(harness.store['New Verified'], undefined);
});

test('final rename verification failure restores the old theme and removes the new theme', async () => {
    const old = { name: 'Verify Old', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], {
        transformSave(theme, count) {
            if (count === 1) theme.main_text_color = '#corrupted';
            return theme;
        },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Verify Old', 'Verify New'),
        (error) => error.code === 'verify-failed' && error.rollbackRestored === true,
    );
    assert.deepEqual(harness.store['Verify Old'], old);
    assert.equal(harness.store['Verify New'], undefined);
});

test('rename reports rollback-failed with a content-free current state summary', async () => {
    const old = { name: 'Rollback Old', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], {
        saveErrorAt: 2,
        transformSave(theme, count) {
            if (count === 1) theme.main_text_color = '#corrupted';
            return theme;
        },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Rollback Old', 'Rollback New'),
        (error) => {
            assert.equal(error.code, 'rollback-failed');
            assert.equal(error.details.currentState.inventoryAvailable, true);
            assert.equal(error.details.currentState.oldPresent, false);
            assert.equal(error.details.currentState.newPresent, true);
            assert.equal(JSON.stringify(error.details.currentState).includes('#corrupted'), false);
            return true;
        },
    );
});

test('rename never saves a lazy placeholder when hydration is unavailable', async () => {
    const lazy = { name: 'Lazy Old', __baibaokuLazyTheme: true };
    const harness = makeTransactionHarness([lazy]);

    await assert.rejects(
        harness.transactions.renameTheme('Lazy Old', 'Lazy New'),
        (error) => error.code === 'incomplete',
    );
    assert.equal(harness.calls.some((call) => call.type === 'save'), false);
    assert.deepEqual(harness.store['Lazy Old'], lazy);
});

test('consecutive renames keep remembering each new name for one-inventory follow-ups', async () => {
    const harness = makeTransactionHarness([{ name: 'First', main_text_color: '#one', custom_css: '' }]);

    await harness.transactions.renameTheme('First', 'Second', {
        extraNames: ['First'],
        extraNamesComplete: true,
    });
    await harness.transactions.renameTheme('Second', 'Third', {
        extraNames: ['Second'],
        extraNamesComplete: true,
    });
    await harness.transactions.renameTheme('Third', 'Fourth', {
        extraNames: ['Third'],
        extraNamesComplete: true,
    });

    assert.equal(harness.getInventoryCount(), 4);
    assert.equal(harness.getHeaderCount(), 3);
    assert.equal(harness.store.First, undefined);
    assert.equal(harness.store.Second, undefined);
    assert.equal(harness.store.Third, undefined);
    assert.deepEqual(harness.store.Fourth, { name: 'Fourth', main_text_color: '#one', custom_css: '' });
});

test('rename rejects direct and sanitized filename conflicts without saving', async () => {
    const harness = makeTransactionHarness([
        { name: 'Source', main_text_color: '#source' },
        { name: 'AB', main_text_color: '#existing' },
    ]);

    await assert.rejects(
        harness.transactions.renameTheme('Source', 'A:B'),
        (error) => error.code === 'filename-conflict',
    );
    assert.equal(harness.calls.length, 0);
    assert.deepEqual(harness.store.Source, { name: 'Source', main_text_color: '#source' });
});

function makeBindingContext(overrides) {
    overrides = overrides || {};
    const chatId = overrides.chatId === undefined ? 'Chat One' : overrides.chatId;
    return {
        characters: overrides.characters || [{ name: 'Alice', avatar: 'alice.png', chat: chatId }],
        groups: overrides.groups || [],
        characterId: overrides.characterId === undefined ? 0 : overrides.characterId,
        groupId: overrides.groupId,
        chatId,
        chatMetadata: overrides.chatMetadata === undefined ? { integrity: 'chat-uuid-1' } : overrides.chatMetadata,
        getCurrentChatId() { return chatId; },
    };
}

test('day-night pairs merge two real themes into one logical item with shared editable metadata', () => {
    const data = {
        themeMeta: {
            Sunrise: { category: 'Soft', tags: ['warm'], author: 'Alice', useCount: 2, imageData: 'day.png' },
            Moonrise: { category: 'Dark', tags: ['cool'], starred: true, useCount: 3, imageData: 'night.png' },
        },
    };

    const result = pairs.createPair(data, {
        id: 'pair-1',
        name: 'Garden',
        dayTheme: 'Sunrise',
        nightTheme: 'Moonrise',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.pair.meta.tags, ['warm', 'cool']);
    assert.equal(result.pair.meta.useCount, 3);
    assert.equal(result.pair.meta.starred, true);
    const items = pairs.buildLogicalItems(data, ['Sunrise', 'Moonrise', 'Solo']);
    assert.deepEqual(items.map((item) => [item.kind, item.name]), [
        ['pair', 'Garden'],
        ['theme', 'Solo'],
    ]);
    assert.equal(pairs.getVariantTheme(data, 'pair-1', 'day'), 'Sunrise');
    assert.equal(pairs.getVariantTheme(data, 'pair-1', 'night'), 'Moonrise');
    assert.equal(pairs.renamePair(data, 'pair-1', 'Garden 2'), true);
    assert.equal(pairs.getPair(data, 'pair-1').name, 'Garden 2');
});

test('day-night pair export and import preserve both real themes and the logical relationship', () => {
    const source = { themeMeta: {} };
    pairs.createPair(source, {
        id: 'pair-export',
        name: 'Day and Night',
        dayTheme: 'Light',
        nightTheme: 'Dark',
        meta: { category: 'Series', tags: ['paired'] },
    });

    assert.deepEqual(pairs.exportPairs(source, ['Light']), []);
    const exported = pairs.exportPairs(source, ['Light', 'Dark']);
    assert.equal(exported.length, 1);
    assert.equal(exported[0].name, 'Day and Night');

    const target = { themeMeta: {} };
    const outcome = pairs.importPairs(target, exported, ['Light', 'Dark']);
    assert.equal(outcome.imported, 1);
    assert.equal(outcome.skipped, 0);
    assert.equal(outcome.idMap['pair-export'], 'pair-export');
    assert.equal(pairs.getPair(target, 'pair-export').nightTheme, 'Dark');
});

test('series groups ordinary and day-night logical items without changing their theme data', () => {
    const data = { themeMeta: { Rose: { author: 'Alice' }, Blue: { tags: ['cool'] } } };
    const result = series.createSeries(data, {
        id: 'series-colors',
        name: 'Color Set',
        category: 'Variants',
        members: [
            { kind: 'theme', themeName: 'Rose' },
            { kind: 'day-night', pairId: 'pair-colors' },
        ],
    });

    assert.equal(result.ok, true);
    assert.equal(series.getSeries(data, 'series-colors').category, 'Variants');
    assert.deepEqual(data.themeMeta, { Rose: { author: 'Alice' }, Blue: { tags: ['cool'] } });
    assert.equal(series.findSeriesByTarget(data, { kind: 'day-night', pairId: 'pair-colors' }).id, 'series-colors');
    assert.equal(series.createSeries(data, {
        name: 'Duplicate',
        members: [
            { kind: 'theme', themeName: 'Other' },
            { kind: 'theme', themeName: 'Rose' },
        ],
    }).reason, 'already-series');
});

test('series references survive day-night creation and dissolution in their original position', () => {
    const data = {};
    series.createSeries(data, {
        id: 'series-pair-flow',
        name: 'Flow',
        members: [
            { kind: 'theme', themeName: 'Day' },
            { kind: 'theme', themeName: 'Night' },
            { kind: 'theme', themeName: 'Extra' },
        ],
    });

    const merged = series.mergeThemeTargetsIntoPair(data, ['Day', 'Night'], 'pair-flow');
    assert.equal(merged.ok, true);
    assert.deepEqual(series.getSeries(data, 'series-pair-flow').members, [
        { kind: 'day-night', pairId: 'pair-flow' },
        { kind: 'theme', themeName: 'Extra' },
    ]);

    const expanded = series.replacePairReference(data, 'pair-flow', ['Day', 'Night']);
    assert.equal(expanded.ok, true);
    assert.deepEqual(series.getSeries(data, 'series-pair-flow').members, [
        { kind: 'theme', themeName: 'Day' },
        { kind: 'theme', themeName: 'Night' },
        { kind: 'theme', themeName: 'Extra' },
    ]);
});

test('series cleanup dissolves only the relationship when fewer than two members remain', () => {
    const data = {};
    series.createSeries(data, {
        id: 'series-cleanup',
        name: 'Cleanup',
        members: [
            { kind: 'theme', themeName: 'Old' },
            { kind: 'theme', themeName: 'Keep' },
        ],
    });

    assert.equal(series.renameThemeReferences(data, 'Old', 'New'), 1);
    assert.equal(series.findSeriesByTarget(data, { kind: 'theme', themeName: 'New' }).id, 'series-cleanup');
    assert.equal(series.removeThemeReferences(data, ['New']), 1);
    assert.equal(series.getSeries(data, 'series-cleanup'), null);
    assert.equal(data.themeMeta, undefined);
});

test('series export and import require every member and remap day-night pair ids', () => {
    const source = {};
    series.createSeries(source, {
        id: 'series-export',
        name: 'Exported Set',
        category: 'Sets',
        members: [
            { kind: 'theme', themeName: 'Solo' },
            { kind: 'day-night', pairId: 'pair-old' },
        ],
    });

    assert.deepEqual(series.exportSeries(source, ['Solo'], ['pair-old']).map((item) => item.id), ['series-export']);
    assert.deepEqual(series.exportSeries(source, ['Solo'], []), []);

    const target = {};
    const imported = series.importSeries(target, series.exportSeries(source, ['Solo'], ['pair-old']), {
        availableThemeNames: ['Solo'],
        availablePairIds: ['pair-new'],
        pairIdMap: { 'pair-old': 'pair-new' },
    });
    assert.equal(imported.imported, 1);
    assert.deepEqual(series.getSeries(target, 'series-export').members, [
        { kind: 'theme', themeName: 'Solo' },
        { kind: 'day-night', pairId: 'pair-new' },
    ]);

    const incomplete = {};
    const skipped = series.importSeries(incomplete, series.exportSeries(source, ['Solo'], ['pair-old']), {
        availableThemeNames: ['Solo'],
        availablePairIds: [],
        pairIdMap: {},
    });
    assert.equal(skipped.imported, 0);
    assert.equal(series.listSeries(incomplete).length, 0);
});

test('series export skips the whole group when any member is outside the export', () => {
    const data = {};
    series.createSeries(data, {
        id: 'series-complete-export',
        name: 'Complete Export',
        members: [
            { kind: 'theme', themeName: 'First' },
            { kind: 'theme', themeName: 'Second' },
            { kind: 'day-night', pairId: 'pair-complete-export' },
        ],
    });

    assert.deepEqual(
        series.exportSeries(data, ['First', 'Second'], ['pair-complete-export']).map((group) => group.id),
        ['series-complete-export'],
    );
    assert.deepEqual(series.exportSeries(data, ['First'], ['pair-complete-export']), []);
    assert.deepEqual(series.exportSeries(data, ['First', 'Second'], []), []);
});

test('series import skips the whole group when any member is unavailable', () => {
    const raw = [{
        id: 'series-incomplete-import',
        name: 'Incomplete Import',
        members: [
            { kind: 'theme', themeName: 'First' },
            { kind: 'theme', themeName: 'Second' },
            { kind: 'day-night', pairId: 'pair-source' },
        ],
    }];

    const missingTheme = {};
    const themeOutcome = series.importSeries(missingTheme, raw, {
        availableThemeNames: ['First'],
        availablePairIds: ['pair-target'],
        pairIdMap: { 'pair-source': 'pair-target' },
    });
    assert.deepEqual(themeOutcome, { imported: 0, skipped: 1, idMap: {} });
    assert.deepEqual(series.listSeries(missingTheme), []);

    const missingPair = {};
    const pairOutcome = series.importSeries(missingPair, raw, {
        availableThemeNames: ['First', 'Second'],
        availablePairIds: [],
        pairIdMap: {},
    });
    assert.deepEqual(pairOutcome, { imported: 0, skipped: 1, idMap: {} });
    assert.deepEqual(series.listSeries(missingPair), []);
});

test('series import rejects ordinary targets already represented by a local day-night item', () => {
    const data = {
        dayNight: {
            version: 1,
            pairs: {
                'pair-local': {
                    id: 'pair-local',
                    name: 'Local Pair',
                    dayTheme: 'First',
                    nightTheme: 'Night',
                },
            },
        },
    };
    const outcome = series.importSeries(data, [{
        id: 'series-hidden-import',
        name: 'Hidden Import',
        members: [
            { kind: 'theme', themeName: 'First' },
            { kind: 'theme', themeName: 'Second' },
        ],
    }], {
        availableThemeNames: ['First', 'Second'],
        availablePairIds: ['pair-local'],
    });

    assert.deepEqual(outcome, { imported: 0, skipped: 1, idMap: {} });
    assert.deepEqual(series.listSeries(data), []);
});

test('series import does not reuse a skipped source pair id that belongs to a local pair', () => {
    const data = {
        dayNight: {
            version: 1,
            pairs: {
                'pair-source': {
                    id: 'pair-source',
                    name: 'Unrelated Local Pair',
                    dayTheme: 'Local Day',
                    nightTheme: 'Local Night',
                },
            },
        },
    };
    const outcome = series.importSeries(data, [{
        id: 'series-skipped-pair',
        name: 'Skipped Pair',
        members: [
            { kind: 'theme', themeName: 'Solo' },
            { kind: 'day-night', pairId: 'pair-source' },
        ],
    }], {
        availableThemeNames: ['Solo'],
        availablePairIds: ['pair-source'],
        skippedPairIds: ['pair-source'],
    });

    assert.deepEqual(outcome, { imported: 0, skipped: 1, idMap: {} });
    assert.deepEqual(series.listSeries(data), []);
});

test('series import can require an explicit pair id mapping instead of reusing an unrelated local id', () => {
    const data = {
        dayNight: {
            version: 1,
            pairs: {
                'pair-source': {
                    id: 'pair-source',
                    name: 'Local Pair With Same Id',
                    dayTheme: 'Local Day',
                    nightTheme: 'Local Night',
                },
            },
        },
    };
    const outcome = series.importSeries(data, [{
        id: 'series-requires-pair-map',
        name: 'Requires Pair Map',
        members: [
            { kind: 'theme', themeName: 'Solo' },
            { kind: 'day-night', pairId: 'pair-source' },
        ],
    }], {
        availableThemeNames: ['Solo'],
        availablePairIds: ['pair-source'],
        pairIdMap: {},
        requirePairIdMap: true,
    });

    assert.deepEqual(outcome, { imported: 0, skipped: 1, idMap: {} });
    assert.deepEqual(series.listSeries(data), []);
});

test('series import is idempotent for an already imported group', () => {
    const data = {};
    const raw = [{
        id: 'series-idempotent',
        name: 'Idempotent',
        category: 'Sets',
        members: [
            { kind: 'theme', themeName: 'First' },
            { kind: 'theme', themeName: 'Second' },
        ],
    }];
    const options = {
        availableThemeNames: ['First', 'Second'],
        availablePairIds: [],
        pairIdMap: {},
    };

    const first = series.importSeries(data, raw, options);
    const afterFirst = clone(data.series);
    const second = series.importSeries(data, raw, options);

    assert.deepEqual(first, {
        imported: 1,
        skipped: 0,
        idMap: { 'series-idempotent': 'series-idempotent' },
    });
    assert.deepEqual(second, {
        imported: 0,
        skipped: 1,
        idMap: { 'series-idempotent': 'series-idempotent' },
    });
    assert.deepEqual(data.series, afterFirst);
    assert.equal(series.listSeries(data).length, 1);
});

test('series target replacement across two groups is rejected without mutation', () => {
    const data = {};
    series.createSeries(data, {
        id: 'series-left',
        name: 'Left',
        members: [
            { kind: 'theme', themeName: 'Left Source' },
            { kind: 'theme', themeName: 'Left Keep' },
        ],
    });
    series.createSeries(data, {
        id: 'series-right',
        name: 'Right',
        members: [
            { kind: 'theme', themeName: 'Right Source' },
            { kind: 'theme', themeName: 'Right Keep' },
        ],
    });
    const before = clone(data.series);

    const outcome = series.replaceTargets(
        data,
        [
            { kind: 'theme', themeName: 'Left Source' },
            { kind: 'theme', themeName: 'Right Source' },
        ],
        [{ kind: 'day-night', pairId: 'pair-cross-series' }],
    );

    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'multiple-series');
    assert.deepEqual(outcome.seriesIds, ['series-left', 'series-right']);
    assert.deepEqual(data.series, before);
});

test('series ensureState does not leak claims from a rejected overlapping group', () => {
    const data = {
        series: {
            version: 1,
            groups: {
                first: {
                    id: 'first',
                    name: 'First',
                    members: [
                        { kind: 'theme', themeName: 'Claimed' },
                        { kind: 'theme', themeName: 'Shared' },
                    ],
                },
                rejected: {
                    id: 'rejected',
                    name: 'Rejected',
                    members: [
                        { kind: 'theme', themeName: 'Shared' },
                        { kind: 'theme', themeName: 'Available Later' },
                    ],
                },
                later: {
                    id: 'later',
                    name: 'Later',
                    members: [
                        { kind: 'theme', themeName: 'Available Later' },
                        { kind: 'theme', themeName: 'Final' },
                    ],
                },
            },
        },
    };

    const state = series.ensureState(data);

    assert.deepEqual(Object.keys(state.groups), ['first', 'later']);
    assert.equal(series.findSeriesByTarget(data, { kind: 'theme', themeName: 'Available Later' }).id, 'later');
    assert.deepEqual(state.groups.later.members, [
        { kind: 'theme', themeName: 'Available Later' },
        { kind: 'theme', themeName: 'Final' },
    ]);
});

test('color-scheme watcher detects mobile WebView changes even when the original media query stays stale', () => {
    let dark = false;
    let poll = null;
    let clearedTimer = null;
    const listeners = {};
    const mediaQueries = [];
    const makeEventTarget = () => ({
        addEventListener(name, handler) { listeners[name] = handler; },
        removeEventListener(name, handler) {
            if (listeners[name] === handler) delete listeners[name];
        },
    });
    const changes = [];
    const watcher = pairs.createColorSchemeWatcher({
        matchMedia() {
            const query = {
                matches: dark,
                addEventListener(name, handler) {
                    if (name === 'change') this.listener = handler;
                },
                removeEventListener() {},
            };
            mediaQueries.push(query);
            return query;
        },
        document: makeEventTarget(),
        window: makeEventTarget(),
        setInterval(handler) { poll = handler; return 7; },
        clearInterval(id) { clearedTimer = id; },
        onChange(next, previous, reason) { changes.push({ next, previous, reason }); },
    });

    watcher.start();
    assert.equal(watcher.getVariant(), 'day');
    assert.equal(mediaQueries[1].matches, false);
    dark = true;
    assert.equal(mediaQueries[1].matches, false);
    poll();
    assert.deepEqual(changes, [{ next: 'night', previous: 'day', reason: 'poll' }]);
    poll();
    assert.equal(changes.length, 1);
    watcher.stop();
    assert.equal(clearedTimer, 7);
});

test('creating and dissolving a day-night item migrates character chat and manual targets safely', () => {
    const data = { themeMeta: {} };
    const context = makeBindingContext();
    const state = bindings.ensureState(data);
    state.manualTheme = 'Day';
    bindings.setBinding(data, 'character', context, 'Night');
    bindings.setBinding(data, 'chat', context, 'Day');
    pairs.createPair(data, {
        id: 'pair-bindings',
        name: 'Shared',
        dayTheme: 'Day',
        nightTheme: 'Night',
    });

    assert.equal(bindings.mergeThemeReferencesIntoPair(data, ['Day', 'Night'], 'pair-bindings'), 3);
    assert.deepEqual(bindings.resolve(data, context).target, { kind: 'day-night', pairId: 'pair-bindings' });
    assert.deepEqual(bindings.ensureState(data).manualTarget, { kind: 'day-night', pairId: 'pair-bindings' });
    assert.equal(bindings.listTargetReferences(data, { kind: 'day-night', pairId: 'pair-bindings' }).chats.length, 1);

    const migrations = pairs.removeThemeReferences(data, ['Day']);
    assert.deepEqual(migrations.map((item) => [item.pairId, item.replacementTheme]), [['pair-bindings', 'Night']]);
    assert.equal(bindings.replacePairReferences(data, 'pair-bindings', 'Night'), 3);
    assert.equal(bindings.resolve(data, context).themeName, 'Night');
    assert.equal(pairs.getPair(data, 'pair-bindings'), null);
});

test('binding controller resolves a logical day-night target to the current preferred variant', () => {
    const data = { themeMeta: {} };
    pairs.createPair(data, {
        id: 'pair-auto',
        name: 'Auto',
        dayTheme: 'Day',
        nightTheme: 'Night',
    });
    const context = makeBindingContext();
    bindings.setBinding(data, 'chat', context, { kind: 'day-night', pairId: 'pair-auto' });
    let preferred = 'night';
    let currentTheme = 'Day';
    const applied = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        makeTargetForTheme(name) { return pairs.targetForTheme(data, name); },
        resolveTargetTheme(target) { return pairs.resolveTargetTheme(data, target, preferred); },
        applyTheme(name, callback) {
            applied.push(name);
            currentTheme = name;
            callback(true);
        },
    });

    controller.reconcile();
    assert.deepEqual(applied, ['Night']);
    assert.equal(controller.getCurrentState().resolution.themeName, 'Night');
    preferred = 'day';
    controller.reconcile();
    assert.deepEqual(applied, ['Night', 'Day']);
});

test('chat changes clear a temporary day-night override before automatic reconciliation', () => {
    const handlers = {};
    const eventSource = {
        on(name, handler) { (handlers[name] ||= []).push(handler); },
        removeListener(name, handler) {
            handlers[name] = (handlers[name] || []).filter((item) => item !== handler);
        },
        emit(name) { (handlers[name] || []).slice().forEach((handler) => handler()); },
    };
    const context = makeBindingContext();
    context.eventSource = eventSource;
    context.eventTypes = { CHAT_CHANGED: 'chat-changed', CHAT_LOADED: 'chat-loaded' };
    const data = { themeMeta: {} };
    pairs.createPair(data, {
        id: 'pair-temporary',
        name: 'Temporary',
        dayTheme: 'Day',
        nightTheme: 'Night',
    });
    bindings.setBinding(data, 'chat', context, { kind: 'day-night', pairId: 'pair-temporary' });
    let preferred = 'night';
    let currentTheme = 'Night';
    let resetCount = 0;
    const applied = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        resolveTargetTheme(target) { return pairs.resolveTargetTheme(data, target, preferred); },
        beforeAutomaticReconcile() {
            resetCount += 1;
            preferred = 'day';
        },
        applyTheme(name, callback) {
            applied.push(name);
            currentTheme = name;
            callback(true);
        },
    });

    controller.start();
    eventSource.emit('chat-changed');
    assert.equal(resetCount, 1);
    assert.deepEqual(applied, ['Day']);
    controller.stop();
});

test('binding state normalizes legacy strings and drops malformed records', () => {
    const data = {
        bindings: {
            characters: {
                'alice.png': 'Rose',
                'broken.png': { target: { kind: 'pair', themeName: 'Future' } },
            },
            chats: {
                'chat-1': { label: 'First', themeName: 'Blue' },
                '': 'Ignored',
            },
            manualTheme: 42,
        },
    };

    const state = bindings.ensureState(data);

    assert.deepEqual(state.characters['alice.png'], {
        label: '',
        target: { kind: 'theme', themeName: 'Rose' },
    });
    assert.equal(state.characters['broken.png'], undefined);
    assert.deepEqual(state.chats['chat-1'], {
        label: 'First',
        target: { kind: 'theme', themeName: 'Blue' },
    });
    assert.equal(state.manualTheme, '');
});

test('chat binding overrides character binding and both fall back to the manual theme', () => {
    const data = {};
    const context = makeBindingContext();
    bindings.ensureState(data).manualTheme = 'Manual';

    assert.equal(bindings.setBinding(data, 'character', context, 'Character Theme').ok, true);
    assert.equal(bindings.setBinding(data, 'chat', context, 'Chat Theme').ok, true);
    assert.deepEqual(
        [bindings.resolve(data, context).scope, bindings.resolve(data, context).themeName],
        ['chat', 'Chat Theme'],
    );

    bindings.clearBinding(data, 'chat', context);
    assert.deepEqual(
        [bindings.resolve(data, context).scope, bindings.resolve(data, context).themeName],
        ['character', 'Character Theme'],
    );

    bindings.clearBinding(data, 'character', context);
    assert.deepEqual(
        [bindings.resolve(data, context).scope, bindings.resolve(data, context).themeName],
        ['', 'Manual'],
    );
});

test('binding identities use avatar and chat integrity instead of mutable indexes or chat names', () => {
    const first = makeBindingContext({ chatId: 'Before Rename' });
    const reordered = makeBindingContext({
        chatId: 'After Rename',
        characters: [
            { name: 'Other', avatar: 'other.png', chat: 'Other Chat' },
            { name: 'Alice', avatar: 'alice.png', chat: 'After Rename' },
        ],
        characterId: 1,
        chatMetadata: { integrity: 'chat-uuid-1' },
    });
    const data = {};

    bindings.setBinding(data, 'character', first, 'Character Theme');
    bindings.setBinding(data, 'chat', first, 'Chat Theme');

    const result = bindings.resolve(data, reordered);
    assert.equal(result.scope, 'chat');
    assert.equal(result.themeName, 'Chat Theme');
    bindings.clearBinding(data, 'chat', reordered);
    assert.equal(bindings.resolve(data, reordered).themeName, 'Character Theme');
});

test('group chats use only their chat binding and never inherit a transient member character binding', () => {
    const data = {};
    const direct = makeBindingContext();
    const group = makeBindingContext({
        groups: [{ id: 'group-1', name: 'Team', chat_id: 'Group Chat' }],
        groupId: 'group-1',
        chatId: 'Group Chat',
        chatMetadata: { integrity: 'group-chat-uuid' },
    });
    bindings.ensureState(data).manualTheme = 'Manual';
    bindings.setBinding(data, 'character', direct, 'Character Theme');

    assert.deepEqual(
        [bindings.resolve(data, group).scope, bindings.resolve(data, group).themeName],
        ['', 'Manual'],
    );
    assert.equal(bindings.setBinding(data, 'character', group, 'Wrong').reason, 'no-character');
    assert.equal(bindings.setBinding(data, 'chat', group, 'Group Theme').ok, true);
    assert.deepEqual(
        [bindings.resolve(data, group).scope, bindings.resolve(data, group).themeName],
        ['chat', 'Group Theme'],
    );
});

test('theme rename and deletion update every binding reference atomically in plugin data', () => {
    const data = {};
    const first = makeBindingContext();
    const second = makeBindingContext({
        chatId: 'Chat Two',
        chatMetadata: { integrity: 'chat-uuid-2' },
    });
    const state = bindings.ensureState(data);
    state.manualTheme = 'Old';
    bindings.setBinding(data, 'character', first, 'Old');
    bindings.setBinding(data, 'chat', first, 'Old');
    bindings.setBinding(data, 'chat', second, 'Keep');

    assert.equal(bindings.renameThemeReferences(data, 'Old', 'New'), 3);
    assert.equal(state.manualTheme, 'New');
    assert.equal(bindings.countThemeReferences(data, 'New'), 2);
    assert.equal(bindings.removeThemeReferences(data, 'New'), 3);
    assert.equal(state.manualTheme, '');
    assert.equal(bindings.countThemeReferences(data, 'New'), 0);
    assert.equal(bindings.countThemeReferences(data, 'Keep'), 1);
});

test('binding reference listing returns concrete character and chat labels for the edit sheet', () => {
    const data = {};
    const first = makeBindingContext();
    const second = makeBindingContext({
        characters: [{ name: 'Bella', avatar: 'bella.png', chat: 'Bella Chat' }],
        chatId: 'Bella Chat',
        chatMetadata: { integrity: 'chat-uuid-2' },
    });
    bindings.setBinding(data, 'character', first, 'Rose');
    bindings.setBinding(data, 'chat', first, 'Rose');
    bindings.setBinding(data, 'character', second, 'Rose');
    bindings.setBinding(data, 'chat', second, 'Other');

    assert.deepEqual(bindings.listThemeReferences(data, 'Rose'), {
        characters: [
            { key: 'alice.png', label: 'Alice' },
            { key: 'bella.png', label: 'Bella' },
        ],
        chats: [
            { key: 'chat-uuid-1', label: 'Alice · Chat One' },
        ],
    });
});

test('binding overview removal can clear one matching reference or every reference without touching another target', () => {
    const data = {};
    const first = makeBindingContext();
    const second = makeBindingContext({
        characters: [{ name: 'Bella', avatar: 'bella.png', chat: 'Bella Chat' }],
        chatId: 'Bella Chat',
        chatMetadata: { integrity: 'chat-uuid-2' },
    });
    const pairTarget = { kind: 'day-night', pairId: 'pair-overview' };
    bindings.ensureState(data).manualTarget = pairTarget;
    bindings.setBinding(data, 'character', first, pairTarget);
    bindings.setBinding(data, 'chat', first, pairTarget);
    bindings.setBinding(data, 'character', second, pairTarget);
    bindings.setBinding(data, 'chat', second, 'Keep');

    assert.equal(bindings.removeTargetReference(data, 'character', 'alice.png', pairTarget), true);
    assert.equal(bindings.removeTargetReference(data, 'chat', 'chat-uuid-2', pairTarget), false);
    assert.equal(bindings.ensureState(data).chats['chat-uuid-2'].target.themeName, 'Keep');
    assert.equal(bindings.removeTargetReferences(data, pairTarget), 2);
    assert.deepEqual(bindings.listTargetReferences(data, pairTarget), { characters: [], chats: [] });
    assert.equal(bindings.ensureState(data).chats['chat-uuid-2'].target.themeName, 'Keep');
    assert.deepEqual(bindings.ensureState(data).manualTarget, pairTarget);
});

test('character rename migrates the stable binding key and deletion removes it', () => {
    const data = {};
    bindings.setBinding(data, 'character', makeBindingContext(), 'Rose');

    assert.equal(bindings.moveCharacterBinding(data, 'alice.png', 'alice-renamed.png'), true);
    assert.equal(bindings.ensureState(data).characters['alice.png'], undefined);
    assert.equal(bindings.getThemeName(bindings.ensureState(data).characters['alice-renamed.png']), 'Rose');
    assert.equal(bindings.removeCharacterBinding(data, 'alice-renamed.png'), true);
    assert.equal(bindings.countBindings(data), 0);
});

test('live character image replacement migrates its binding from the previous avatar filename', () => {
    const handlers = {};
    const eventSource = {
        on(name, handler) {
            (handlers[name] ||= []).push(handler);
        },
        removeListener(name, handler) {
            handlers[name] = (handlers[name] || []).filter((item) => item !== handler);
        },
        emit(name, payload) {
            (handlers[name] || []).slice().forEach((handler) => handler(payload));
        },
    };
    const context = makeBindingContext();
    context.eventSource = eventSource;
    context.eventTypes = {
        CHAT_CHANGED: 'chat-changed',
        CHAT_LOADED: 'chat-loaded',
        CHARACTER_RENAMED: 'character-renamed',
        CHARACTER_EDITED: 'character-edited',
        CHARACTER_DELETED: 'character-deleted',
        CHARACTER_PAGE_LOADED: 'character-page-loaded',
    };
    const data = {};
    bindings.ensureState(data).manualTheme = 'Rose';
    bindings.setBinding(data, 'character', context, 'Rose');
    let saveCount = 0;
    const controller = bindings.createController({
        load() { return data; },
        save() { saveCount += 1; },
        getContext() { return context; },
        getCurrentThemeName() { return 'Rose'; },
        applyTheme() { throw new Error('no apply expected'); },
    });
    controller.start();

    context.characters[0] = { name: 'Alice', avatar: 'alice-new.png', chat: 'Chat One' };
    eventSource.emit('character-edited', {
        detail: { id: 0, character: context.characters[0] },
    });

    assert.equal(bindings.ensureState(data).characters['alice.png'], undefined);
    assert.equal(bindings.getThemeName(bindings.ensureState(data).characters['alice-new.png']), 'Rose');
    assert.equal(bindings.ensureState(data).characters['alice-new.png'].label, 'Alice');
    assert.equal(saveCount, 1);
    controller.stop();
});

test('rapid context changes cancel an obsolete binding apply even when the restored theme is already current', () => {
    const data = {};
    const boundContext = makeBindingContext();
    const unboundContext = makeBindingContext({
        characterId: null,
        characters: [],
        chatId: '',
        chatMetadata: {},
    });
    bindings.ensureState(data).manualTheme = 'Manual';
    bindings.setBinding(data, 'chat', boundContext, 'Bound');

    let context = boundContext;
    const currentTheme = 'Manual';
    let cancelCount = 0;
    let appliedCount = 0;
    const pending = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        applyTheme(name, callback) { pending.push({ name, callback }); },
        cancelApply() { cancelCount += 1; },
        onApplied() { appliedCount += 1; },
    });

    controller.reconcile();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].name, 'Bound');
    assert.equal(controller.isAutomatedThemeChange('Bound'), true);
    assert.equal(controller.recordManualTheme('Bound'), false);

    context = unboundContext;
    controller.reconcile();
    assert.equal(cancelCount, 1);

    pending[0].callback(true);
    assert.equal(appliedCount, 0);
    assert.equal(controller.isAutomatedThemeChange('Bound'), false);
});

test('duplicate chat events do not cancel the still-desired automatic apply after its native change fires', () => {
    const data = {};
    const context = makeBindingContext();
    bindings.ensureState(data).manualTheme = 'Manual';
    bindings.setBinding(data, 'chat', context, 'Bound');

    let currentTheme = 'Manual';
    let cancelCount = 0;
    const pending = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        applyTheme(name, callback) { pending.push({ name, callback }); },
        cancelApply() { cancelCount += 1; },
    });

    controller.reconcile();
    currentTheme = 'Bound';
    controller.reconcile();

    assert.equal(cancelCount, 0);
    pending[0].callback(true);
    assert.equal(controller.isAutomatedThemeChange('Bound'), false);
});
