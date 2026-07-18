const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.ThemeMgrModules = {};
require('../src/theme-schema.js');
require('../src/theme-api.js');
require('../src/theme-runtime.js');
require('../src/theme-transactions.js');
require('../src/theme-transfer.js');

const modules = global.ThemeMgrModules;
const schema = modules.themeSchema;

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

    const api = {
        getPostHeaders() { return Promise.resolve({ 'X-Test': '1' }); },
        saveTheme(theme) {
            saveCount += 1;
            calls.push({ type: 'save', name: theme.name, theme: clone(theme) });
            if (hooks.saveErrorAt === saveCount) return Promise.reject(new Error('injected save failure'));
            let written = clone(theme);
            if (typeof hooks.transformSave === 'function') written = hooks.transformSave(written, saveCount);
            store[written.name] = written;
            return Promise.resolve(written);
        },
        deleteTheme(name) {
            deleteCount += 1;
            calls.push({ type: 'delete', name });
            if (hooks.deleteErrorAt === deleteCount || hooks.deleteErrorName === name) {
                return Promise.reject(new Error('injected delete failure'));
            }
            delete store[name];
            return Promise.resolve(true);
        },
    };

    const runtime = {
        invalidate() {},
        getInventory() { return Promise.resolve(Object.values(store).map(clone)); },
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
    };

    return {
        store,
        calls,
        remembered,
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
    const transfer = modules.createThemeTransfer({
        schema,
        runtime,
        transactions: {
            saveVerifiedTheme(theme) {
                savedThemes.push(clone(theme));
                baseline.quote_text_color = '#mutated-during-import';
                return Promise.resolve({ theme: clone(theme), overwritten: false });
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
    assert.equal(savedThemes[1].quote_text_color, '#fixed');
    assert.equal(savedThemes[1].custom_css, '');
});

test('transactional rename preserves the exact legacy partial fields and saves before deleting', async () => {
    const original = { name: 'Legacy Old', main_text_color: '#abc', custom_css: '' };
    const harness = makeTransactionHarness([original]);
    const result = await harness.transactions.renameTheme('Legacy Old', 'Legacy New');

    assert.deepEqual(harness.store['Legacy New'], { name: 'Legacy New', main_text_color: '#abc', custom_css: '' });
    assert.equal(harness.store['Legacy Old'], undefined);
    assert.equal(result.newName, 'Legacy New');
    assert.deepEqual(harness.calls.map((call) => `${call.type}:${call.name}`), ['save:Legacy New', 'delete:Legacy Old']);
});

test('save request failure preserves the old theme and does not leave a new file', async () => {
    const old = { name: 'Old', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], { saveErrorAt: 1 });

    await assert.rejects(harness.transactions.renameTheme('Old', 'New'), /injected save failure/);
    assert.deepEqual(harness.store.Old, old);
    assert.equal(harness.store.New, undefined);
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

test('rename delete failure keeps the old theme intact after the new file was verified', async () => {
    const old = { name: 'Old Safe', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], { deleteErrorName: 'Old Safe' });

    await assert.rejects(
        harness.transactions.renameTheme('Old Safe', 'New Verified'),
        (error) => error.code === 'delete-failed',
    );
    assert.deepEqual(harness.store['Old Safe'], old);
    assert.deepEqual(harness.store['New Verified'], { name: 'New Verified', main_text_color: '#old' });
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
