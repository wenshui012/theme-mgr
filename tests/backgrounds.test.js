const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'backgrounds.js'), 'utf8');
const librarySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'background-library.js'), 'utf8');

function loadBackgrounds(window) {
    window.window = window;
    window.Promise = Promise;
    window.Map = Map;
    window.console = console;
    const context = vm.createContext(window);
    vm.runInContext(librarySource, context, { filename: 'background-library.js' });
    vm.runInContext(source, context, { filename: 'backgrounds.js' });
    return window.ThemeMgrModules;
}

function baseOptions(extra = {}) {
    return Object.assign({
        load: () => ({ themeMeta: {}, bgPickerSize: 132 }),
        save: () => Promise.resolve(true),
        getPostHeaders: () => Promise.resolve({}),
        esc: (value) => String(value),
        closeSheet() {},
        toast() {},
        renderGrid() {},
        setControlValue() {},
        themeRuntime: { isApplyCurrent: () => true },
    }, extra);
}

test('TauriTavern background URLs use the host resource-path helper', () => {
    const window = {
        __TAURITAVERN_BACKGROUND_PATH__: (name) => `asset://background/${encodeURIComponent(name)}`,
    };
    const modules = loadBackgrounds(window);
    const backgrounds = modules.createBackgrounds(baseOptions());
    assert.equal(backgrounds.getBackgroundCssUrl('夜 景.png'), 'url("asset://background/%E5%A4%9C%20%E6%99%AF.png")');
});

test('background picker registers thumbnail placeholders with a viewport loader', async () => {
    let html = '';
    let loaderOptions = null;
    let observed = [];
    let beforeClose = null;
    let disconnectCount = 0;
    const list = {
        style: { setProperty() {} },
        set innerHTML(value) { html = String(value); },
        get innerHTML() { return html; },
        querySelectorAll(selector) {
            if (selector === 'img[data-background-name]') return [{ dataset: { backgroundName: 'large.png' } }];
            return [];
        },
    };
    const inert = { value: '', addEventListener() {} };
    const sheet = {
        querySelector(selector) {
            if (selector === '#tm-bg-picker-list') return list;
            return inert;
        },
    };
    const imageLoader = {
        PLACEHOLDER_SRC: 'placeholder.gif',
        createImageLoader(options) {
            loaderOptions = options;
            return { disconnect() { disconnectCount += 1; }, observe(images) { observed = Array.from(images); } };
        },
    };
    const requests = [];
    class FileReader {
        readAsDataURL() { this.result = 'data:image/png;base64,thumbnail'; this.onload(); }
    }
    const window = {
        FileReader,
        fetch: async (url) => {
            requests.push(url);
            if (url === '/api/backgrounds/all') return { ok: true, json: async () => ({ images: ['large.png'] }) };
            return { ok: true, blob: async () => ({ type: 'image/png' }) };
        },
    };
    const modules = loadBackgrounds(window);
    const backgrounds = modules.createBackgrounds(baseOptions({
        createSheet: () => sheet,
        imageLoader,
        setBeforeClose(_sheet, handler) { beforeClose = handler; },
    }));
    backgrounds.openBackgroundPickerSheet('', () => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(html, /placeholder\.gif/);
    assert.match(html, /data-background-name="large\.png"/);
    assert.doesNotMatch(html, /background-image:[^>]*large\.png/);
    assert.equal(loaderOptions.root, list);
    assert.equal(loaderOptions.rootMargin, '240px 0px');
    assert.equal(observed.length, 1);
    assert.equal(await loaderOptions.resolveSource('large.png'), 'data:image/png;base64,thumbnail');
    assert.deepEqual(requests, ['/api/backgrounds/all', '/thumbnail?type=bg&file=large.png']);
    assert.equal(beforeClose(), true);
    assert.equal(disconnectCount, 1);
});

test('background upload uses multipart headers and returns the server filename', async () => {
    const requests = [];
    class FormData {
        constructor() { this.values = new Map(); }
        append(key, value, filename) { this.values.set(key, { value, filename }); }
    }
    const window = {
        FormData,
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, text: async () => '夜景.png' };
        },
    };
    const modules = loadBackgrounds(window);
    const backgrounds = modules.createBackgrounds(baseOptions({
        backgroundLibrary: modules.backgroundLibrary,
        getPostHeaders: async () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'token' }),
    }));
    const file = { name: '夜景.png', size: 42, type: 'image/png' };
    assert.equal(await backgrounds.uploadBackgroundFile(file), '夜景.png');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/backgrounds/upload');
    assert.equal(requests[0].options.headers['Content-Type'], undefined);
    assert.equal(requests[0].options.headers['X-CSRF-Token'], 'token');
    assert.deepEqual(requests[0].options.body.values.get('avatar'), { value: file, filename: '夜景.png' });
});

test('background export falls back to the HTTP path when a TT resource URL cannot be fetched', async () => {
    const requests = [];
    const downloads = [];
    const blob = { type: 'image/png', size: 12 };
    const window = {
        __TAURITAVERN_BACKGROUND_PATH__: (name) => `asset://background/${encodeURIComponent(name)}`,
        fetch: async (url) => {
            requests.push(url);
            if (url.startsWith('asset://')) return { ok: false };
            return { ok: true, blob: async () => blob };
        },
    };
    const modules = loadBackgrounds(window);
    const backgrounds = modules.createBackgrounds(baseOptions({
        backgroundLibrary: modules.backgroundLibrary,
        downloadBlob: (value, filename) => downloads.push({ value, filename }),
    }));
    assert.equal(await backgrounds.exportBackground('夜 景.png'), '夜 景.png');
    assert.deepEqual(requests, ['asset://background/%E5%A4%9C%20%E6%99%AF.png', 'backgrounds/%E5%A4%9C%20%E6%99%AF.png']);
    assert.deepEqual(downloads, [{ value: blob, filename: '夜 景.png' }]);
});

test('background batch export reads originals sequentially and downloads one ZIP', async () => {
    const requests = [];
    const downloads = [];
    let archivedEntries = [];
    const window = {
        Blob,
        innerWidth: 1200,
        fetch: async (url) => {
            requests.push(url);
            return { ok: true, blob: async () => new Blob([url], { type: 'image/png' }) };
        },
    };
    const modules = loadBackgrounds(window);
    const backgrounds = modules.createBackgrounds(baseOptions({
        backgroundLibrary: modules.backgroundLibrary,
        archive: {
            estimateZipSize: (entries) => entries.reduce((sum, entry) => sum + entry.data.length, 0),
            buildStoredZip(entries) {
                archivedEntries = entries;
                return new Blob(entries.map((entry) => entry.data), { type: 'application/zip' });
            },
        },
        downloadBlob: (value, filename) => downloads.push({ value, filename }),
    }));
    const result = await backgrounds.exportBackgroundBatch(['夜景.png', 'room.webp', '夜景.png']);
    assert.deepEqual(requests, ['backgrounds/%E5%A4%9C%E6%99%AF.png', 'backgrounds/room.webp']);
    assert.deepEqual(Array.from(archivedEntries, (entry) => entry.path), ['backgrounds/夜景.png', 'backgrounds/room.webp']);
    assert.equal(downloads.length, 1);
    assert.match(downloads[0].filename, /^backgrounds-.*\.zip$/);
    assert.equal(result.count, 2);
});

test('background deletion clears local annotations, theme bindings, and deleted active host state', async () => {
    const state = {
        themeMeta: {
            A: { backgroundName: 'night.png' },
            B: { backgroundName: 'day.png' },
        },
        backgroundLibrary: {
            categories: ['夜景'],
            assetMeta: { 'night.png': { category: '夜景', starred: true } },
        },
    };
    let saveCount = 0;
    let savedSettings = 0;
    let savedMetadata = 0;
    const backgroundElement = { style: { backgroundImage: '' } };
    const bgModule = { background_settings: { name: 'night.png', url: 'url("backgrounds/night.png")' } };
    const scriptModule = {
        chat_metadata: { custom_background: 'url("backgrounds/night.png")' },
        saveSettingsDebounced() { savedSettings += 1; },
        saveMetadataDebounced() { savedMetadata += 1; },
    };
    const requests = [];
    const window = {
        document: { getElementById: () => backgroundElement },
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (url === '/api/backgrounds/delete') return { ok: true };
            if (url === '/api/backgrounds/all') return { ok: true, json: async () => ({ images: ['day.png'] }) };
            throw new Error(`unexpected ${url}`);
        },
    };
    const modules = loadBackgrounds(window);
    const backgrounds = modules.createBackgrounds(baseOptions({
        load: () => state,
        save: async () => { saveCount += 1; return true; },
        backgroundLibrary: modules.backgroundLibrary,
        loadBackgroundModules: async () => [bgModule, scriptModule],
    }));
    assert.equal(backgrounds.countThemeBindings('night.png'), 1);
    const result = await backgrounds.deleteBackgroundOnServer('night.png');
    assert.equal(result.themeBindingsCleared, 1);
    assert.equal(result.metadataSaved, true);
    assert.equal(result.activeChanged, true);
    assert.equal(result.chatLockCleared, true);
    assert.equal(result.fallback, 'day.png');
    assert.equal(state.themeMeta.A.backgroundName, '');
    assert.equal(state.themeMeta.B.backgroundName, 'day.png');
    assert.equal(Object.hasOwn(state.backgroundLibrary.assetMeta, 'night.png'), false);
    assert.equal(bgModule.background_settings.name, 'day.png');
    assert.equal(backgroundElement.style.backgroundImage, 'url("backgrounds/day.png")');
    assert.equal(Object.hasOwn(scriptModule.chat_metadata, 'custom_background'), false);
    assert.equal(saveCount, 1);
    assert.equal(savedSettings, 1);
    assert.equal(savedMetadata, 1);
    assert.equal(JSON.parse(requests[0].options.body).bg, 'night.png');
});

test('deleting only the locked chat background restores the real global background', async () => {
    const state = { themeMeta: {}, backgroundLibrary: { categories: [], assetMeta: {} } };
    const backgroundElement = { style: { backgroundImage: 'url("backgrounds/locked.png")' } };
    const bgModule = { background_settings: { name: 'day.png', url: 'url("backgrounds/day.png")' } };
    const scriptModule = {
        chat_metadata: { custom_background: 'url("backgrounds/locked.png")' },
        saveMetadataDebounced() {},
    };
    const window = {
        document: { getElementById: () => backgroundElement },
        fetch: async (url) => {
            if (url === '/api/backgrounds/delete') return { ok: true };
            if (url === '/api/backgrounds/all') return { ok: true, json: async () => ({ images: ['aaa.png', 'day.png'] }) };
            throw new Error(`unexpected ${url}`);
        },
    };
    const modules = loadBackgrounds(window);
    const backgrounds = modules.createBackgrounds(baseOptions({
        load: () => state,
        backgroundLibrary: modules.backgroundLibrary,
        loadBackgroundModules: async () => [bgModule, scriptModule],
    }));
    const result = await backgrounds.deleteBackgroundOnServer('locked.png');
    assert.equal(result.activeChanged, false);
    assert.equal(result.chatLockCleared, true);
    assert.equal(result.fallback, 'day.png');
    assert.equal(backgroundElement.style.backgroundImage, 'url("backgrounds/day.png")');
});
