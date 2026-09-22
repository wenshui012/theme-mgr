const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const librarySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'background-library.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'background-page.js'), 'utf8');
const uiMainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.js'), 'utf8');

function loadModules() {
    const window = { window: null, console };
    window.window = window;
    const context = vm.createContext(window);
    vm.runInContext(librarySource, context, { filename: 'background-library.js' });
    vm.runInContext(pageSource, context, { filename: 'background-page.js' });
    return window.ThemeMgrModules;
}

test('background page exposes the compact image-library controls', () => {
    const modules = loadModules();
    const html = modules.backgroundPage.buildPageHtml('placeholder.gif');
    assert.match(html, /data-background-file/);
    assert.match(html, /multiple/);
    assert.match(html, /data-background-search/);
    assert.match(html, /data-background-sort="starred"/);
    assert.match(html, /data-background-grid-zoom="out"/);
    assert.match(html, /data-background-batch-area/);
    assert.match(html, /data-background-catbar/);
    assert.match(html, /data-background-grid/);
    assert.match(modules.backgroundPage.styleText(), /repeat\(auto-fill,minmax\(var\(--tm-background-card-min\),1fr\)\)/);
    assert.match(modules.backgroundPage.styleText(), /aspect-ratio:16\/9/);
    assert.doesNotMatch(modules.backgroundPage.styleText(), /tm-background-info/);
});

test('background page state reports library counts before mounting', () => {
    const modules = loadModules();
    const state = { backgroundLibrary: { categories: ['城市', '室内'] } };
    const controller = modules.createBackgroundPage({
        backgrounds: {},
        library: modules.backgroundLibrary,
        loadUiData: () => state,
        saveUiData: () => Promise.resolve(),
    });
    const result = controller.getState();
    assert.equal(result.mounted, false);
    assert.equal(result.count, 0);
    assert.equal(result.categories, 2);
    assert.equal(result.busy, false);
    assert.equal(result.batchMode, false);
});

test('background bottom bar mirrors avatar controls without a status block', () => {
    assert.doesNotMatch(uiMainSource, /id="tm-background-status"/);
    const refreshAt = uiMainSource.indexOf('id="tm-background-refresh"');
    const batchAt = uiMainSource.indexOf('id="tm-background-batch-toggle"');
    const addAt = uiMainSource.indexOf('id="tm-background-add"');
    const settingsAt = uiMainSource.indexOf('id="tm-bottom-settings"');
    assert.ok(refreshAt !== -1 && refreshAt < batchAt && batchAt < addAt && addAt < settingsAt);
    assert.ok(stylesSource.includes('.tm-overlay[data-tm-active-page="backgrounds"] .tm-bottombar'));
    assert.match(uiMainSource, /lastAppPage === 'backgrounds'\) return backgroundPageController\.openSettingsSheet\(\)/);
});

test('background import is sequential, skips existing names, and rejects unsafe filenames', async () => {
    const modules = loadModules();
    const state = {};
    const uploaded = [];
    let listReads = 0;
    const controller = modules.createBackgroundPage({
        backgrounds: {
            getBackgroundListPromise: async () => {
                listReads += 1;
                return listReads === 1 ? ['keep.png'] : ['keep.png', 'new.png'];
            },
            uploadBackgroundFile: async (file) => {
                uploaded.push(file.name);
                return file.name;
            },
        },
        library: modules.backgroundLibrary,
        loadUiData: () => state,
        saveUiData: () => Promise.resolve(),
        toast() {},
    });
    const result = await controller.importFiles([
        { name: 'keep.png', size: 10, type: 'image/png' },
        { name: 'new.png', size: 10, type: 'image/png' },
        { name: 'bad?.png', size: 10, type: 'image/png' },
    ]);
    assert.deepEqual(uploaded, ['new.png']);
    assert.deepEqual(Array.from(result.imported), ['new.png']);
    assert.deepEqual(Array.from(result.skipped), ['keep.png']);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].message, /文件名/);
});
