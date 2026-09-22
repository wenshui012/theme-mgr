const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'background-library.js'), 'utf8');

function loadLibrary() {
    const window = { window: null };
    window.window = window;
    vm.runInContext(source, vm.createContext(window), { filename: 'background-library.js' });
    return window.ThemeMgrModules.backgroundLibrary;
}

test('background library normalizes state without allocating metadata during reads', () => {
    const library = loadLibrary();
    const state = {
        backgroundLibrary: {
            categories: [' 夜景 ', '', '夜景', '__all__'],
            assetMeta: { 'city.png': { category: ' 夜景 ', starred: 1 } },
            sortMode: 'bad',
            cardSize: 999,
        },
    };
    const normalized = library.ensureState(state);
    assert.deepEqual(Array.from(normalized.categories), ['夜景']);
    assert.equal(normalized.assetMeta['city.png'].category, '夜景');
    assert.equal(normalized.assetMeta['city.png'].starred, false);
    assert.equal(normalized.sortMode, 'name');
    assert.equal(normalized.cardSize, 260);
    assert.equal(library.peekMeta(state, 'missing.png').category, '');
    assert.equal(Object.hasOwn(normalized.assetMeta, 'missing.png'), false);
});

test('background categories rename and delete without deleting image annotations unnecessarily', () => {
    const library = loadLibrary();
    const state = {};
    const added = library.addCategory(state, '室内');
    assert.equal(added.ok, true);
    assert.equal(added.name, '室内');
    assert.equal(library.setCategory(state, 'room.png', '室内').ok, true);
    assert.equal(library.toggleStarred(state, 'room.png'), true);
    const renamed = library.renameCategory(state, '室内', '房间');
    assert.equal(renamed.ok, true);
    assert.equal(renamed.name, '房间');
    assert.equal(library.peekMeta(state, 'room.png').category, '房间');
    assert.equal(library.deleteCategory(state, '房间'), true);
    assert.equal(library.peekMeta(state, 'room.png').category, '');
    assert.equal(library.peekMeta(state, 'room.png').starred, true);
});

test('background grid size supports compact mobile cards', () => {
    const library = loadLibrary();
    const compact = { backgroundLibrary: { cardSize: 1 } };
    assert.equal(library.ensureState(compact).cardSize, 84);
    const large = { backgroundLibrary: { cardSize: 999 } };
    assert.equal(library.ensureState(large).cardSize, 260);
});

test('background metadata follows file rename and is removed after deletion', () => {
    const library = loadLibrary();
    const state = {};
    library.addCategory(state, '收藏夹');
    library.setCategory(state, 'old.png', '收藏夹');
    library.toggleStarred(state, 'old.png');
    assert.equal(library.renameAsset(state, 'old.png', 'new.png'), true);
    assert.equal(library.peekMeta(state, 'new.png').category, '收藏夹');
    assert.equal(library.peekMeta(state, 'new.png').starred, true);
    assert.equal(library.removeAsset(state, 'new.png'), true);
    assert.equal(Object.hasOwn(library.ensureState(state).assetMeta, 'new.png'), false);
});

test('favorite sorting is deterministic and category filters stay independent', () => {
    const library = loadLibrary();
    const state = {};
    library.addCategory(state, '城市');
    library.setCategory(state, 'b.png', '城市');
    library.toggleStarred(state, 'z.png');
    library.ensureState(state).sortMode = 'starred';
    const names = ['b.png', 'z.png', 'a.png'].sort((a, b) => library.compareNames(state, a, b));
    assert.deepEqual(names, ['z.png', 'a.png', 'b.png']);
    assert.equal(library.matchesCategory(state, 'b.png', '城市'), true);
    assert.equal(library.matchesCategory(state, 'z.png', '__starred__'), true);
    assert.equal(library.matchesCategory(state, 'a.png', '__uncategorized__'), true);
});
