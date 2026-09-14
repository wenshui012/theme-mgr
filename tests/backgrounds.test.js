const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'backgrounds.js'), 'utf8');

function loadBackgrounds(window) {
    window.window = window;
    window.Promise = Promise;
    window.Map = Map;
    window.console = console;
    vm.runInContext(source, vm.createContext(window), { filename: 'backgrounds.js' });
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
