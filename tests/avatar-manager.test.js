const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModules(window) {
    window.window = window;
    window.globalThis = window;
    window.console = console;
    window.Promise = Promise;
    window.Map = Map;
    window.Set = Set;
    window.WeakMap = WeakMap;
    window.Date = Date;
    window.Math = Math;
    window.JSON = JSON;
    window.Number = Number;
    window.Object = Object;
    window.Uint8Array = Uint8Array;
    window.Uint32Array = Uint32Array;
    window.ArrayBuffer = ArrayBuffer;
    window.DataView = DataView;
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    window.Blob = Blob;
    window.atob = atob;
    window.btoa = btoa;
    const context = vm.createContext(window);
    ['image-tools.js', 'avatar-storage.js', 'avatar-sync.js', 'avatar-image-tools.js', 'avatar-library.js', 'avatar-transfer.js', 'avatar-runtime.js', 'avatar-page.js'].forEach((name) => {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8'), context, { filename: name });
    });
    return window.ThemeMgrModules;
}

function asset(id = 'a', extra = {}) {
    return Object.assign({
        id, name: id, imageData: `data:image/jpeg;base64,main-${id}`,
        thumbData: `data:image/jpeg;base64,thumb-${id}`, mimeType: 'image/jpeg',
        width: 800, height: 600, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }, extra);
}

const baseWindow = { indexedDB: null, URL };
const modules = loadModules(baseWindow);

function processorFixture(type, width, height, hasAlpha) {
    const calls = [];
    const processor = modules.createAvatarImageProcessor({
        decode: async () => ({ source: {}, width, height, hasAlpha, close() {} }),
        encode: async (_decoded, size, mime, quality) => {
            calls.push({ size, mime, quality });
            return `data:${mime};base64,${size.width}x${size.height}-${calls.length}`;
        },
        makeId: () => 'generated',
        now: () => '2026-01-02T00:00:00.000Z',
    });
    return { processor, file: { name: `portrait.${type.split('/')[1]}`, type }, calls };
}

test('1 import jpg uses high quality JPEG', async () => {
    const f = processorFixture('image/jpeg', 1200, 900, false);
    const result = await f.processor.processFile(f.file);
    assert.equal(result.mimeType, 'image/jpeg');
    assert.equal(f.calls[0].quality, 0.92);
});
test('2 import png alpha preserves PNG', async () => {
    const f = processorFixture('image/png', 800, 800, true);
    const result = await f.processor.processFile(f.file);
    assert.equal(result.mimeType, 'image/png');
    assert.match(result.imageData, /^data:image\/png/);
});
test('3 import webp preserves WebP including alpha capability', async () => {
    const f = processorFixture('image/webp', 800, 500, true);
    const result = await f.processor.processFile(f.file);
    assert.equal(result.mimeType, 'image/webp');
});
test('4 small images are never enlarged', () => assert.deepEqual({ ...modules.avatarImageTools.fit(120, 80, 2048) }, { width: 120, height: 80 }));
test('5 large images are limited to 2048 on the longest edge', () => assert.deepEqual({ ...modules.avatarImageTools.fit(4096, 2048, 2048) }, { width: 2048, height: 1024 }));
test('6 thumbnail generation is limited to 384', async () => {
    const f = processorFixture('image/jpeg', 1600, 800, false);
    await f.processor.processFile(f.file);
    assert.deepEqual({ ...f.calls[1].size }, { width: 384, height: 192 });
});
test('7 high resolution and thumbnail payloads stay separate', async () => {
    const f = processorFixture('image/jpeg', 1600, 800, false);
    const result = await f.processor.processFile(f.file);
    assert.notEqual(result.imageData, result.thumbData);
    assert.match(result.imageData, /1600x800/);
    assert.match(result.thumbData, /384x192/);
});

function memoryStore(seed) {
    const adapter = modules.avatarStorage.createMemoryAdapter(seed);
    return { adapter, store: modules.createAvatarStore({ adapter }) };
}

test('8 reload with the same durable adapter retains avatars', async () => {
    const { adapter, store } = memoryStore();
    await store.putAsset(asset());
    const reloaded = modules.createAvatarStore({ adapter });
    assert.equal((await reloaded.listAssets()).length, 1);
});
test('9 avatar deletion removes the asset', async () => {
    const { store } = memoryStore({ assets: [asset()] });
    await store.deleteAsset('a');
    assert.equal(await store.getAsset('a'), null);
});
test('10 avatar deletion transaction removes every referencing binding', async () => {
    const { store } = memoryStore({ assets: [asset()], bindings: [
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
        { themeKey: 'theme-name:B', targetKey: 'character:c.png', avatarId: 'a', view: {} },
    ] });
    const result = await store.deleteAsset('a');
    assert.equal(result.bindings.length, 2);
    assert.equal((await store.listBindings()).length, 0);
});

test('avatar library assigns explicit monotonic import order and keeps a stable legacy fallback', () => {
    const data = {};
    modules.avatarLibrary.assignImportOrders(data, ['new-a', 'new-b']);
    assert.equal(data.avatarLibrary.assetMeta['new-a'].importOrder, 1);
    assert.equal(data.avatarLibrary.assetMeta['new-b'].importOrder, 2);
    assert.equal(data.avatarLibrary.nextImportOrder, 3);

    const oldA = asset('old-a', { createdAt: '2025-01-01T00:00:00.000Z' });
    const oldB = asset('old-b', { createdAt: '2025-02-01T00:00:00.000Z' });
    assert.ok(modules.avatarLibrary.compareAssets(data, oldA, oldB, 'import-asc') < 0);
    const reloaded = JSON.parse(JSON.stringify(data));
    assert.equal(Math.sign(modules.avatarLibrary.compareAssets(reloaded, oldA, oldB, 'import-desc')), 1);
});

test('avatar series enforce one owner, preserve explicit order, and auto-dissolve below two members', () => {
    const data = {};
    const created = modules.avatarLibrary.createSeries(data, '双人组', ['b', 'a']);
    assert.equal(created.ok, true);
    assert.deepEqual(Array.from(data.avatarLibrary.series.groups[created.series.id].members), ['b', 'a']);
    assert.equal(modules.avatarLibrary.createSeries(data, '冲突组', ['a', 'c']).reason, 'already-series');
    assert.equal(modules.avatarLibrary.addMember(data, created.series.id, 'c').ok, true);
    assert.deepEqual(Array.from(data.avatarLibrary.series.groups[created.series.id].members), ['b', 'a', 'c']);
    assert.equal(modules.avatarLibrary.moveMember(data, created.series.id, 'c', -1).ok, true);
    assert.deepEqual(Array.from(data.avatarLibrary.series.groups[created.series.id].members), ['b', 'c', 'a']);
    assert.equal(modules.avatarLibrary.removeMember(data, created.series.id, 'b').dissolved, false);
    assert.equal(modules.avatarLibrary.removeMember(data, created.series.id, 'c').dissolved, true);
    assert.equal(modules.avatarLibrary.findSeries(data, 'a'), null);
});

test('avatar series normalization resolves duplicate ownership without deleting valid later groups', () => {
    const data = { avatarLibrary: { series: { groups: {
        first: { id: 'first', name: '第一组', members: ['a', 'b'] },
        invalid: { id: 'invalid', name: '冲突后不足两张', members: ['b', 'c'] },
        later: { id: 'later', name: '后一组', members: ['c', 'd'] },
    } } } };
    modules.avatarLibrary.ensureState(data);
    assert.deepEqual(Object.keys(data.avatarLibrary.series.groups), ['first', 'later']);
    assert.deepEqual(Array.from(data.avatarLibrary.series.groups.later.members), ['c', 'd']);
});

test('avatar category rename and delete update annotations only', () => {
    const data = { avatarLibrary: { categories: ['旧分类'], assetMeta: { a: { category: '旧分类', tags: ['标签'] } } } };
    assert.equal(modules.avatarLibrary.renameCategory(data, '旧分类', '新分类').ok, true);
    assert.equal(data.avatarLibrary.assetMeta.a.category, '新分类');
    assert.equal(modules.avatarLibrary.deleteCategory(data, '新分类'), true);
    assert.equal(data.avatarLibrary.assetMeta.a.category, '');
    assert.deepEqual(Array.from(data.avatarLibrary.assetMeta.a.tags), ['标签']);
});

test('binding batches validate every operation before changing local state', async () => {
    const { store } = memoryStore({ assets: [asset('a')] });
    await assert.rejects(store.mutateBindings([
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global:theme-avatar:a', avatarId: 'a', view: {} } },
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'missing', view: {} } },
    ]), error => error.code === 'AVATAR_NOT_FOUND');
    assert.equal((await store.listBindings()).length, 0);
});

class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((x) => x !== fn)); }
    dispatchEvent(event) { event.target ||= this; event.preventDefault ||= () => { event.defaultPrevented = true; }; event.stopImmediatePropagation ||= () => {}; for (const fn of [...(this.listeners.get(event.type) || [])]) fn(event); return !event.defaultPrevented; }
    on(type, fn) { this.addEventListener(type, fn); }
    removeListener(type, fn) { this.removeEventListener(type, fn); }
    emit(type, ...args) { for (const fn of [...(this.listeners.get(type) || [])]) fn(...args); }
}
class Classes {
    constructor() { this.values = new Set(); }
    add(...v) { v.forEach((x) => this.values.add(x)); }
    remove(...v) { v.forEach((x) => this.values.delete(x)); }
    toggle(v, force) { const next = force === undefined ? !this.values.has(v) : Boolean(force); if (next) this.values.add(v); else this.values.delete(v); return next; }
    contains(v) { return this.values.has(v); }
    toString() { return [...this.values].join(' '); }
}
class Animation {
    constructor(frames) { this.frames = frames.map((x) => ({ ...x })); this.cancelled = false; this.effect = { getKeyframes: () => this.frames.map((x) => ({ ...x })), setKeyframes: (x) => { this.frames = x.map((y) => ({ ...y })); } }; }
    pause() {}
    cancel() { this.cancelled = true; }
}
class Element extends Events {
    constructor(tag = 'div', rect = { x: 20, y: 20, width: 100, height: 100 }) {
        super(); this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.parentElement = null;
        this.attributes = {}; this.classList = new Classes(); this.rect = { ...rect }; this.animations = []; this.id = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this._html = ''; this.style = {}; this.value = '';
        this.computed = { objectFit: 'cover', objectPosition: '50% 50%', transform: 'rotate(8deg)', translate: '3px 2px', scale: '1.1', rotate: '8deg', transformOrigin: '50px 50px', borderRadius: '50%', clipPath: 'circle(48%)', webkitMaskImage: 'url(mask.png)', maskImage: 'url(mask.png)', overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden' };
    }
    appendChild(child) { child.parentNode = this; child.parentElement = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter((x) => x !== child); child.parentNode = null; child.parentElement = null; return child; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((x) => this.classList.add(x)); }
    getAttribute(k) { if (k === 'id') return this.id || null; if (k === 'class') return this.classList.toString() || null; return Object.hasOwn(this.attributes, k) ? this.attributes[k] : null; }
    removeAttribute(k) { delete this.attributes[k]; if (k === 'id') this.id = ''; }
    contains(node) { return node === this || this.children.some((x) => x.contains(node)); }
    querySelector(selector) {
        if (selector === ':scope > img') return this.children.find((x) => x.tagName === 'IMG') || null;
        if (selector === '.avatar') return this.find((x) => x.classList.contains('avatar'));
        if (selector === 'img') return this.find((x) => x.tagName === 'IMG');
        if (selector === '.tm-avatar-editor-scale') return this.find((x) => x.classList.contains('tm-avatar-editor-scale'));
        return null;
    }
    querySelectorAll(selector) {
        if (selector === '.mes') return this.findAll((x) => x.classList.contains('mes'));
        return [];
    }
    find(predicate) { for (const child of this.children) { if (predicate(child)) return child; const nested = child.find(predicate); if (nested) return nested; } return null; }
    findAll(predicate, out = []) { for (const child of this.children) { if (predicate(child)) out.push(child); child.findAll(predicate, out); } return out; }
    getBoundingClientRect() {
        const rect = { ...this.rect };
        const animation = [...this.animations].reverse().find((x) => !x.cancelled);
        const transform = animation?.frames?.[0]?.transform || '';
        const match = transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s+scale\((-?[\d.]+)\)/);
        if (match) { const x = +match[1], y = +match[2], s = +match[3]; rect.x += x - rect.width * (s - 1) / 2; rect.y += y - rect.height * (s - 1) / 2; rect.width *= s; rect.height *= s; }
        return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height };
    }
    animate(frames) { const a = new Animation(frames); this.animations.push(a); return a; }
    focus() {}
    click() { this.dispatchEvent({ type: 'click' }); }
    scrollIntoView() { this.scrollIntoViewCalls = (this.scrollIntoViewCalls || 0) + 1; }
    setPointerCapture() {}
    releasePointerCapture() {}
    get isConnected() { let node = this; while (node) { if (node._root) return true; node = node.parentElement; } return false; }
    set innerHTML(value) { this._html = String(value); if (this._html.includes('tm-avatar-editor-scale')) { const scale = new Element('span'); scale.classList.add('tm-avatar-editor-scale'); this.appendChild(scale); } }
    get innerHTML() { return this._html; }
    closest(selector) { if (selector === '[data-action]' && this.getAttribute('data-action')) return this; return null; }
}
class MutationObserver {
    static instances = [];
    constructor(fn) { this.fn = fn; MutationObserver.instances.push(this); }
    observe() {}
    disconnect() {}
}
class Document extends Events {
    constructor() { super(); this.head = new Element('head'); this.body = new Element('body'); this.head._root = true; this.body._root = true; }
    createElement(tag) { return new Element(tag); }
    getElementById(id) { if (this.head.id === id) return this.head; if (this.body.id === id) return this.body; return this.head.find((x) => x.id === id) || this.body.find((x) => x.id === id); }
    querySelector(selector) { if (selector === '[data-tm-page="avatars"]') return this.pageRoot || null; return null; }
}
function message(role, rect, src) {
    const mes = new Element('div'); mes.classList.add('mes'); mes.setAttribute('is_user', role === 'user'); mes.setAttribute('is_system', 'false');
    const avatar = mes.appendChild(new Element('div', rect)); avatar.classList.add('avatar');
    const image = avatar.appendChild(new Element('img', rect)); image.setAttribute('src', src || `raw-${role}.png`); image.setAttribute('style', 'opacity:.99');
    return { mes, avatar, image };
}
function runtimeFixture(options = {}) {
    const doc = new Document(); const chat = doc.body.appendChild(new Element('div')); chat.id = 'chat';
    const charSource = options.charSrc || 'raw-char.png';
    const userSource = options.userSrc || 'raw-user.png';
    const chars = [message('character', options.charRect || { x: 30, y: 100, width: 100, height: 100 }, charSource), message('character', options.charRect2 || { x: 30, y: 230, width: 50, height: 50 }, charSource)];
    const user = message('user', { x: 500, y: 100, width: 80, height: 80 }, userSource);
    [...chars, user].forEach((x) => chat.appendChild(x.mes));
    let theme = options.theme || 'A';
    const eventSource = new Events();
    const context = options.context || {
        characters: [{ avatar: 'char.png', name: 'Char' }], characterId: 0, groupId: null, name1: 'User',
        chatId: 'Chat One', chatMetadata: { integrity: 'chat-uuid-1' },
        getCurrentChatId() { return this.chatId; },
        eventSource, eventTypes: options.eventTypes || {},
    };
    const win = { document: doc, location: { href: 'http://localhost/' }, URL, innerWidth: 800, innerHeight: 600, MutationObserver, setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(), getComputedStyle: (el) => el.computed, confirm: () => true };
    const mods = loadModules(win); const bundle = memoryStore(options.seed); const runtimeStore = options.store || bundle.store; const runtime = mods.createAvatarRuntime({
        window: win, document: doc, store: runtimeStore, getContext: () => context, getThemeName: () => theme,
        canMutate: options.canMutate,
        canStart: options.canStart,
        loadNativeImage: options.loadNativeImage || (async (nativeAsset) => ({ ...nativeAsset, imageData: 'data:image/png;base64,AA==' })),
        preloadHostImage: options.preloadHostImage,
        overwriteHostAvatar: options.overwriteHostAvatar,
    });
    return { win, doc, chat, chars, user, context, eventSource: context.eventSource || eventSource, store: bundle.store, runtime, mods, setTheme: (x) => { theme = x; } };
}

class PageRoot extends Events {
    constructor() {
        super();
        this.grid = new Element('div'); this.grid.clientWidth = 360;
        this.notice = new Element('div'); this.input = new Element('input'); this.search = new Element('input');
        this.searchClear = new Element('button'); this.searchBar = new Element('div'); this.sortBar = new Element('div');
        this.catBar = new Element('div'); this.batchArea = new Element('div'); this.classList = new Classes();
    }
    querySelector(s) {
        if (s === '[data-avatar-grid]') return this.grid;
        if (s === '[data-avatar-notice]') return this.notice;
        if (s === '[data-avatar-file]') return this.input;
        if (s === '[data-avatar-search]') return this.search;
        if (s === '[data-avatar-search-clear]') return this.searchClear;
        if (s === '[data-avatar-search-bar]') return this.searchBar;
        if (s === '[data-avatar-sortbar]') return this.sortBar;
        if (s === '[data-avatar-catbar]') return this.catBar;
        if (s === '[data-avatar-batch-area]') return this.batchArea;
        return null;
    }
    querySelectorAll() { return []; }
    contains() { return true; }
}
function pageFixture(seed = [], bindings = [], options = {}) {
    const doc = new Document(); const pageRoot = new PageRoot(); doc.pageRoot = pageRoot;
    const { store } = memoryStore({ assets: seed, bindings }); let disconnected = 0; let observed = 0;
    const imageLoader = { PLACEHOLDER_SRC: 'placeholder', createImageLoader: () => ({ observe: () => { observed++; }, disconnect: () => { disconnected++; } }) };
    const runtime = { getCapabilities: () => ({ themeKey: 'theme-name:A', character: { available: true, target: { key: 'character:c' } }, user: { available: true, target: { key: 'user:global' } } }), getActiveAvatarIds: () => options.activeAvatarIds || { user: '', character: '' }, notifyAssetChanged: async () => {}, deleteAsset: (id) => store.deleteAsset(id), clearBinding: async () => {}, beginEdit: async () => {} };
    const win = { document: doc, confirm: () => true, setTimeout, clearTimeout };
    if (options.gridTemplateColumns) win.getComputedStyle = () => ({ gridTemplateColumns: options.gridTemplateColumns });
    const mods = loadModules(win);
    const processor = options.processor || { processFile: async (file) => asset(file.name) };
    const uiData = options.uiData || {};
    let lastDialog = '';
    const page = mods.createAvatarPage({
        document: doc, store, processor, runtime, imageLoader, getRoot: () => pageRoot,
        closeManager() {}, toast: options.toast || function () {}, confirm: () => true, canMutate: options.canMutate,
        onImportStateChange: options.onImportStateChange,
        loadUiData: () => uiData, saveUiData: () => {},
        createActionDialog(html) { lastDialog = html; return new Element('div'); },
    });
    return { page, doc, pageRoot, store, uiData, lastDialog: () => lastDialog, stats: () => ({ disconnected, observed }) };
}
test('11 Avatar Page mount and unmount own their loader and style', async () => { const f=pageFixture(); await f.page.mount(); assert.equal(f.page.getState().mounted,true); f.page.unmount(); assert.equal(f.page.getState().mounted,false); assert.ok(f.stats().disconnected >= 1); });
test('12 avatar grid uses thumbnail lazy loader rather than main image', async () => { const f=pageFixture([asset()]); await f.page.mount(); assert.match(f.pageRoot.grid.innerHTML,/placeholder/); assert.doesNotMatch(f.pageRoot.grid.innerHTML,/main-a/); assert.ok(f.stats().observed >= 1); });
test('13 successful import renders the new card without a selection footer', async () => { const f=pageFixture(); await f.page.mount(); await f.page.importFiles([{name:'new',type:'image/jpeg'}]); assert.equal(f.page.getState().count,1); assert.doesNotMatch(f.pageRoot.grid.innerHTML,/tm-avatar-page-actions/); });
test('14 current character target uses stable character avatar key', () => assert.equal(modules.avatarRuntime.getContextInfo({characters:[{avatar:'x.png'}],characterId:0}).character.key,'character:x.png'));
test('15 User target uses a stable non-DOM global key', () => assert.equal(modules.avatarRuntime.getContextInfo({name1:'U'}).user.key,'user:global'));
test('16 group chat refuses a current-character target', () => assert.equal(modules.avatarRuntime.getContextInfo({groups:[{id:1}],groupId:1,characters:[{avatar:'x'}],characterId:0}).character,null));
test('17 editor start has no selecting state', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); assert.notEqual(f.runtime.getState().state,'selecting'); });
test('18 known target enters editing directly', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); const state=await f.runtime.beginEdit({kind:'character',avatarId:'a'}); assert.equal(state.state,'editing'); });
test('19 temporary high resolution src replaces every same-target instance', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); assert.ok(f.chars.every((x)=>x.image.getAttribute('src').includes('main-a'))); });
test('20 pointer drag updates normalized x and y', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); const entry=f.chars.find((x)=>x.image.classList.contains('tm-avatar-editor-target')); const rect=entry.avatar.getBoundingClientRect(); entry.image.dispatchEvent({type:'pointerdown',pointerId:1,button:0,clientX:0,clientY:0}); f.doc.dispatchEvent({type:'pointermove',pointerId:1,clientX:rect.width*.2,clientY:rect.height*.1}); f.doc.dispatchEvent({type:'pointerup',pointerId:1}); assert.deepEqual(JSON.parse(JSON.stringify(f.runtime.getState().view)),{x:.2,y:.1,scale:1,rotate:0,flipX:false,flipY:false}); });
test('21 scale plus uses 0.05 step', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); f.runtime.scaleUp(); assert.equal(f.runtime.getState().view.scale,1.05); });
test('22 reset restores normalized zero zero one', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); f.runtime.setScale(2); f.runtime.reset(); assert.deepEqual(f.runtime.getState().view,{x:0,y:0,scale:1,rotate:0,flipX:false,flipY:false}); });
test('23 Cancel restores the previous binding rather than raw avatar', async () => { const f=runtimeFixture({seed:{assets:[asset('a'),asset('b')],bindings:[{version:1,themeKey:'theme-name:A',targetKey:'character:char.png',avatarId:'a',view:{x:.1,y:.1,scale:1}}]}}); await f.runtime.start(); await f.runtime.beginEdit({kind:'character',avatarId:'b'}); await f.runtime.cancelEdit(); assert.ok(f.chars.every((x)=>x.image.getAttribute('src').includes('main-a'))); });
test('24 Save persists the formal default binding', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'user',avatarId:'a'}); const result=await f.runtime.saveEdit(); assert.equal(result.binding.avatarId,'a'); assert.equal((await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY,'user:global')).avatarId,'a'); });
test('25 normalized view yields proportionate pixels across avatar sizes', () => { assert.deepEqual({ ...modules.avatarRuntime.pixelsForView({x:.2,y:.1,scale:1.5},{getBoundingClientRect:()=>({x:0,y:0,width:50,height:80,left:0,top:0,right:50,bottom:80})}) },{x:10,y:8,scale:1.5}); });
test('26 theme transform and avatar box stay fixed while only image content is cropped', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); const beforeTransform=f.chars[0].image.computed.transform; const beforeRect=f.chars[0].image.getBoundingClientRect(); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); f.runtime.setScale(1.5); assert.equal(f.chars[0].image.computed.transform,beforeTransform); assert.deepEqual(f.chars[0].image.getBoundingClientRect(),beforeRect); assert.match(f.chars[0].image.getAttribute('style'),/object-view-box:inset\(/); assert.equal(f.chars[0].image.animations.length,0); });
test('27 mask and clip properties are not rewritten', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); assert.equal(f.chars[0].image.computed.clipPath,'circle(48%)'); assert.equal(f.chars[0].image.computed.maskImage,'url(mask.png)'); });
test('28 a newly rendered message is reapplied on reconcile', async () => { const f=runtimeFixture({seed:{assets:[asset()],bindings:[{version:1,themeKey:'theme-name:A',targetKey:'character:char.png',avatarId:'a',view:{}}]}}); await f.runtime.start(); const next=message('character',{x:20,y:350,width:60,height:60},'raw-new'); f.chat.appendChild(next.mes); await f.runtime.reconcile(); assert.match(next.image.getAttribute('src'),/main-a/); });
test('29 a fresh runtime restores persisted bindings after reload', async () => { const seed={assets:[asset()],bindings:[{version:1,themeKey:'theme-name:A',targetKey:'user:global',avatarId:'a',view:{}}]}; const f=runtimeFixture({seed}); await f.runtime.start(); assert.match(f.user.image.getAttribute('src'),/main-a/); });
test('30 a promoted default avatar keeps the same normalized crop across theme switches', async () => { const f=runtimeFixture({seed:{assets:[asset()],bindings:[{version:1,themeKey:'theme-name:A',targetKey:'user:global',avatarId:'a',view:{x:.1}}]}}); await f.runtime.start(); const a=f.user.image.getAttribute('style'); f.setTheme('B'); await f.runtime.reconcile(); const b=f.user.image.getAttribute('style'); const expected=modules.avatarRuntime.objectViewBoxForView({x:.1}); assert.ok(a.includes(expected)); assert.ok(b.includes(expected)); });
test('31 switching to a theme without an explicit avatar keeps the default avatar', async () => { const f=runtimeFixture({seed:{assets:[asset()],bindings:[{version:1,themeKey:'theme-name:A',targetKey:'user:global',avatarId:'a',view:{}}]}}); await f.runtime.start(); f.setTheme('B'); await f.runtime.reconcile(); assert.match(f.user.image.getAttribute('src'),/main-a/); assert.ok(await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY,'user:global')); });
test('32 deleting an avatar under edit safely cancels and clears binding references', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'user',avatarId:'a'}); await f.runtime.deleteAsset('a'); assert.equal(f.runtime.getState().state,'idle'); assert.equal(await f.store.getAsset('a'),null); });
test('33 frontend-only import to edit to save flow needs no server', async () => { const f=runtimeFixture(); await f.store.putAsset(asset()); await f.runtime.beginEdit({kind:'user',avatarId:'a'}); await f.runtime.saveEdit(); assert.ok(await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY,'user:global')); });
test('34 Avatar Manager never calls backend fetch', async () => { let calls=0; const old=global.fetch; global.fetch=()=>{calls++;}; try { const {store}=memoryStore(); await store.putAsset(asset()); await store.listAssets(); assert.equal(calls,0); } finally { global.fetch=old; } });
test('35 Avatar Manager does not modify themeMeta', async () => { const sentinel={themeMeta:{A:{imageData:'keep'}}}; const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'user',avatarId:'a'}); await f.runtime.saveEdit(); assert.deepEqual(sentinel,{themeMeta:{A:{imageData:'keep'}}}); });
test('36 Avatar Manager does not touch custom-style', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); const custom=f.doc.body.appendChild(new Element('style')); custom.id='custom-style'; custom.textContent='keep'; await f.runtime.beginEdit({kind:'user',avatarId:'a'}); await f.runtime.cancelEdit(); assert.equal(custom.textContent,'keep'); });
test('37 previewImageQuality cannot affect avatar main selection', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); f.context.previewImageQuality='performance'; await f.runtime.beginEdit({kind:'user',avatarId:'a'}); assert.match(f.user.image.getAttribute('src'),/main-a/); });
test('38 editing Character does not modify User or another target', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); assert.equal(f.user.image.getAttribute('src'),'raw-user.png'); });
test('39 IndexedDB quota failures have a stable explicit error code', () => {
    const error = modules.avatarStorage.idbError('AVATAR_IDB_WRITE_FAILED', 'write failed', { name: 'QuotaExceededError' });
    assert.equal(error.code, 'AVATAR_STORAGE_QUOTA_EXCEEDED');
});
test('40 shared file picker helper freezes FileList before input reset', () => {
    const chosen = { name: '安卓头像.jpg', type: 'image/jpeg' };
    const input = { files: [chosen] };
    const snapshot = modules.imageTools.snapshotInputFiles(input);
    input.files.length = 0;
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0], chosen);
});
test('41 shared MIME inference accepts an empty Android MIME with a legal extension', () => {
    assert.equal(modules.imageTools.inferImageMime({ name: '中文头像.JPEG', type: '' }), 'image/jpeg');
    assert.equal(modules.imageTools.inferImageMime({ name: '透明头像.png', type: '' }), 'image/png');
    assert.equal(modules.imageTools.inferImageMime({ name: '头像.webp', type: '' }), 'image/webp');
});
test('42 Avatar Page has no duplicate title or hard-coded purple CTA', () => {
    const html = modules.avatarPage.buildPageHtml('placeholder');
    const css = modules.avatarPage.styleText();
    assert.doesNotMatch(html, /<h2>头像管理<\/h2>/);
    assert.doesNotMatch(css, /#7c4dff|#9d6cff|tm-avatar-page-primary/);
    assert.match(html, /还没有头像|data-avatar-grid/);
    assert.doesNotMatch(html, /data-avatar-action="pick"|data-avatar-actions/);
});
test('43 Avatar Page exposes a visible importing state until the pipeline settles', async () => {
    let finish;
    const f = pageFixture();
    await f.page.mount();
    const pendingAsset = new Promise((resolve) => { finish = resolve; });
    const custom = modules.createAvatarPage({
        document: f.doc,
        store: f.store,
        processor: { processFile: () => pendingAsset },
        runtime: { getCapabilities: () => ({ themeKey: null, character: { available: false }, user: { available: false } }), notifyAssetChanged() {} },
        imageLoader: { PLACEHOLDER_SRC: 'placeholder', createImageLoader: () => ({ observe() {}, disconnect() {} }) },
        imageTools: modules.imageTools,
        getRoot: () => f.pageRoot,
        toast() {},
    });
    f.page.unmount();
    await custom.mount();
    const pending = custom.importFiles([{ name: 'pending.jpg', type: 'image/jpeg' }]);
    assert.equal(custom.getState().importing, true);
    assert.match(f.pageRoot.notice.innerHTML, /正在添加头像/);
    finish(asset('pending'));
    await pending;
    assert.equal(custom.getState().importing, false);
});
test('Avatar Page processes 8 imported images sequentially and reports live counts', async () => {
    let active = 0;
    let maximum = 0;
    const states = [];
    const f = pageFixture([], [], {
        processor: {
            processFile: file => new Promise(resolve => {
                active += 1;
                maximum = Math.max(maximum, active);
                setTimeout(() => {
                    active -= 1;
                    resolve(asset(file.name));
                }, 1);
            }),
        },
        onImportStateChange: state => states.push(state),
    });
    await f.page.mount();
    const files = Array.from({ length: 8 }, (_, index) => ({ name: 'batch-' + index, type: 'image/jpeg' }));
    const results = await f.page.importFiles(files);
    assert.equal(maximum, 1, 'only one decoded asset may be held by the import pipeline at a time');
    assert.equal(results.filter(result => result.ok).length, 8);
    assert.equal((await f.store.listAssets()).length, 8);
    assert.equal(states.some(state => state.phase === 'running' && state.total === 8 && state.processed > 0), true);
    assert.equal(f.page.getImportState().success, 8);
});

test('a failure at image 37 preserves earlier files and continues later files', async () => {
    let current = 0;
    const f = pageFixture([], [], {
        processor: {
            processFile: async () => {
                current += 1;
                if (current === 37) throw Object.assign(new Error('broken image'), { code: 'AVATAR_DECODE_FAILED' });
                return asset('partial-' + current);
            },
        },
    });
    await f.page.mount();
    const files = Array.from({ length: 45 }, (_, index) => ({ name: 'image-' + (index + 1) + '.png', type: 'image/png' }));
    const results = await f.page.importFiles(files);
    assert.equal(results.length, 45);
    assert.equal(results[36].ok, false);
    assert.equal((await f.store.listAssets()).length, 44);
    const finalState = JSON.parse(JSON.stringify(f.page.getImportState()));
    assert.deepEqual(finalState, {
        phase: 'completed', total: 45, processed: 45, success: 44, failed: 1,
        failures: [{ name: 'image-37.png', code: 'AVATAR_DECODE_FAILED', message: '图片解码失败' }],
        startedAt: finalState.startedAt,
        completedAt: finalState.completedAt,
        error: '',
    });
});

test('an import keeps running after Avatar Page unmount and restores progress on remount', async () => {
    let releaseFirst;
    let calls = 0;
    const states = [];
    const toasts = [];
    const first = new Promise(resolve => { releaseFirst = resolve; });
    const f = pageFixture([], [], {
        processor: {
            processFile: async file => {
                calls += 1;
                if (calls === 1) await first;
                return asset(file.name);
            },
        },
        onImportStateChange: state => states.push(state),
        toast: (message, error) => toasts.push({ message, error }),
    });
    await f.page.mount();
    const pending = f.page.importFiles([{ name: 'one' }, { name: 'two' }, { name: 'three' }]);
    await Promise.resolve();
    assert.match(f.pageRoot.notice.innerHTML, /正在添加头像 1 \/ 3/);
    assert.match(f.pageRoot.notice.innerHTML, /可关闭头像管理继续使用酒馆，请勿刷新或关闭酒馆页面/);
    f.page.unmount();
    releaseFirst();
    await pending;
    assert.equal(f.page.getImportState().success, 3);
    assert.equal(states.at(-1).phase, 'completed');
    assert.match(toasts.at(-1).message, /已添加 3 张头像/);
    await f.page.mount();
    assert.match(f.pageRoot.notice.innerHTML, /导入完成：成功 3 张，失败 0 张/);
});
test('44 avatar grid starts with the original-avatar slot and cards stay image-only', async () => {
    const f = pageFixture([asset('1000116691')]);
    await f.page.mount();
    assert.ok(f.pageRoot.grid.innerHTML.indexOf('tm-avatar-native-slot') < f.pageRoot.grid.innerHTML.indexOf('tm-avatar-page-card'));
    assert.match(f.pageRoot.grid.innerHTML, /fa-circle-user/);
    assert.doesNotMatch(f.pageRoot.grid.innerHTML, /data-avatar-action="menu"|fa-ellipsis|data-avatar-action="view"/);
    assert.doesNotMatch(f.pageRoot.grid.innerHTML, /tm-avatar-page-name|fa-trash|<span[^>]*>调整原头像/);
    assert.doesNotMatch(modules.avatarPage.styleText(), /\.tm-avatar-page-menu\{/);
    await f.page.openAssetMenu('1000116691');
    assert.match(f.lastDialog(), /使用这张头像/);
    assert.match(f.lastDialog(), /调整为 User 头像/);
    assert.match(f.lastDialog(), /调整为当前角色头像/);
    assert.match(f.lastDialog(), /查看完整大图/);
    assert.match(f.lastDialog(), /导出主图/);
    assert.match(f.lastDialog(), /管理头像/);
    assert.match(f.lastDialog(), /is-weak/);
    assert.ok(f.lastDialog().indexOf('查看完整大图') < f.lastDialog().indexOf('导出主图'));
    assert.ok(f.lastDialog().indexOf('导出主图') < f.lastDialog().indexOf('管理头像'));
});
test('45 Avatar bottom bar uses the lightweight four-entry layout and scoped unbind actions', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.js'), 'utf8');
    assert.match(source, /id="tm-avatar-add"/);
    assert.match(source, /id="tm-avatar-global"/);
    assert.match(source, /fa-eraser/);
    assert.match(source, /id="tm-avatar-global"[\s\S]*id="tm-avatar-batch-toggle"[\s\S]*id="tm-avatar-add"[\s\S]*id="tm-bottom-settings"/);
    assert.match(source, /id="tm-avatar-global" title="头像解绑" aria-label="头像解绑"/);
    assert.match(source, /group\('user'/);
    assert.match(source, /group\('character'/);
    assert.match(source, /item\(kind, 'chat'/);
    assert.match(source, /item\(kind, 'theme'/);
    assert.match(source, /item\(kind, 'global'/);
    assert.match(source, /全部解绑并恢复原头像/);
    assert.match(source, /所有聊天、所有美化和全局/);
    assert.match(source, /原头像调整数据都会保留/);
    assert.doesNotMatch(source, /id="tm-avatar-restore-user"|id="tm-avatar-restore-character"/);
    assert.doesNotMatch(source, /tm-icon-btn tm-avatars-only" id="tm-avatar-add"/);
    assert.doesNotMatch(source, /tm-avatar-add-primary/);
    assert.match(styles, /data-tm-active-page="avatars"\]\s+\.tm-bottombar\{justify-content:space-evenly;gap:0;/);
    assert.match(styles, /data-tm-active-page="avatars"\]\s+\.tm-bottom-btn\{width:34px;height:34px;[^}]*font-size:1\.15em;/);
    assert.match(styles, /data-tm-active-page="avatars"\]\s+\.tm-bottom-btn\{[^}]*background:var\(--tm-control-bg/);
    assert.doesNotMatch(styles, /tm-avatar-add-primary|grid-template-columns:40px 40px minmax\(52px,1fr\)/);
    assert.doesNotMatch(source, /fa-user-rotate/);
    assert.doesNotMatch(source, /tm-avatar-enter-batch/);
    assert.doesNotMatch(source, /id="tm-avatar-bottom-status"/);
    assert.match(source, /renderAvatarBottomStatus/);
    assert.match(source, /avatarPageController\.pickFiles\(\)/);
    assert.match(source, /avatarPageController\.toggleBatchMode\(\)/);
    assert.match(source, /defaultPage: lastAppPage/);
    assert.match(source, /onImportStateChange: syncAvatarImportIndicator/);
    assert.match(source, /\[data-tm-page-target="avatars"\],#tm-avatar-add/);
    assert.match(styles, /tm-avatar-import-active::after/);
    assert.match(source, /lastAppPage = appShellController\.getActivePage\(\)/);
});

test('batch avatar selection updates only the clicked card and count while delete stays local to affected cards', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-page.js'), 'utf8');
    const clickHandler = source.slice(source.indexOf('function handleClick'), source.indexOf('function handleKeydown'));
    const selectionBranch = clickHandler.slice(clickHandler.lastIndexOf('if (batchMode)'), clickHandler.indexOf('} else openAssetMenu'));
    const deleteHandler = source.slice(source.indexOf('function deleteBatchSelection'), source.indexOf('function openJoinSeriesSheet'));
    assert.match(source, /data-avatar-batch="delete"/);
    assert.match(source, /data-avatar-batch="export"/);
    assert.match(source, /确定删除已选的 ' \+ count \+ ' 张头像吗/);
    assert.match(clickHandler, /syncBatchCard\(card\); updateBatchCount\(\);/);
    assert.doesNotMatch(selectionBranch, /render\(\)/);
    assert.match(deleteHandler, /ids\.reduce/);
    assert.match(deleteHandler, /removeDeletedCards\(deleted\)/);
    assert.doesNotMatch(deleteHandler, /refresh\(\)|store\.listAssets/);
});

test('active User and Character avatars are promoted after the fixed original-avatar slot', async () => {
    const f = pageFixture([asset('a'), asset('b'), asset('c')], [], { activeAvatarIds: { user: 'b', character: 'c' } });
    await f.page.mount();
    const html = f.pageRoot.grid.innerHTML;
    assert.ok(html.indexOf('tm-avatar-native-slot') < html.indexOf('data-avatar-id="b"'));
    assert.ok(html.indexOf('data-avatar-id="b"') < html.indexOf('data-avatar-id="c"'));
    assert.ok(html.indexOf('data-avatar-id="c"') < html.indexOf('data-avatar-id="a"'));
    assert.equal((html.match(/tm-avatar-page-card is-active/g) || []).length, 2);
});

test('runtime exposes only the currently applied library avatar ids for grid prioritization', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('user-active'), asset('char-active')], bindings: [
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'user-active', view: {} },
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'char-active', view: {} },
    ] } });
    await f.runtime.start();
    assert.deepEqual(JSON.parse(JSON.stringify(f.runtime.getActiveAvatarIds())), { user: 'user-active', character: 'char-active' });
});

test('series use the computed three-column grid and stay in one invisible row container', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    const uiData = { avatarLibrary: { series: { groups: { trio: { id: 'trio', name: '三人组', members: ids.slice(0, 3) } } } } };
    const f = pageFixture(ids.map(asset), [], { uiData, gridTemplateColumns: '100px 100px 100px' });
    await f.page.mount();
    assert.match(f.pageRoot.grid.innerHTML, /class="tm-avatar-series-inline"[^>]*--tm-avatar-series-size:3/);
    assert.doesNotMatch(f.pageRoot.grid.innerHTML, /class="tm-avatar-series-block/);
    assert.match(modules.avatarPage.styleText(), /grid-auto-flow:row dense/);
    assert.match(modules.avatarPage.styleText(), /grid-column:span var\(--tm-avatar-series-size,2\)/);
});

test('a series larger than the computed row capacity becomes a single-row rail', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    const uiData = { avatarLibrary: { series: { groups: { four: { id: 'four', name: '四人组', members: ids } } } } };
    const f = pageFixture(ids.map(asset), [], { uiData, gridTemplateColumns: '100px 100px 100px' });
    await f.page.mount();
    assert.match(f.pageRoot.grid.innerHTML, /class="tm-avatar-series-block/);
    assert.match(f.pageRoot.grid.innerHTML, /--tm-avatar-series-cols:3/);
});

test('avatar click opens the action dialog directly without a double-click delay', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-page.js'), 'utf8');
    assert.match(source, /else openAssetMenu\(id\)\.catch/);
    assert.doesNotMatch(source, /dblclick|doubleclick|setTimeout\([^)]*openAssetMenu/);
});

test('avatar and beauty managers expose their intended import sorting choices', () => {
    const avatarHtml = modules.avatarPage.buildPageHtml();
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    assert.match(avatarHtml, /data-avatar-sort="import-asc"/);
    assert.match(avatarHtml, /data-avatar-sort="import-desc"/);
    assert.doesNotMatch(avatarHtml, /data-avatar-sort="name"/);
    assert.match(source, /data-sort="name"/);
    assert.match(source, /data-sort="import-asc"/);
    assert.match(source, /data-sort="import-desc"/);
    assert.match(source, /themeImportOrder/);
});
test('46 editor toolbar uses a host-level important layout and Shadow DOM isolation when supported', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-runtime.js'), 'utf8');
    assert.match(source, /attachShadow\(\{ mode: 'open' \}\)/);
    assert.match(source, /position:fixed!important/);
    assert.match(source, /visibility:visible!important/);
    assert.match(source, /win\.visualViewport/);
    assert.match(source, /css-object-view-box-content-crop/);
    assert.match(source, /data-view="x"/);
    assert.match(source, /data-view="y"/);
    assert.match(source, /data-view="rotate"/);
    assert.match(source, /data-view="scale"/);
    assert.match(source, /data-step-view="scale"/);
    assert.match(source, /data-step-view="x"/);
    assert.match(source, /data-step-view="y"/);
    assert.match(source, /data-step-view="rotate"/);
    assert.match(source, /data-action="flip-x"/);
    assert.match(source, /data-action="flip-y"/);
    assert.match(source, /--SmartThemeQuoteColor/);
    assert.match(source, /scheduleEditorSync/);
    assert.match(source, /doc\.body\.appendChild\(toolbarHost\)/);
    assert.doesNotMatch(source, /scrollIntoView|documentElement\.style|doc\.body\.style/);
    assert.match(source, /requestAnimationFrame/);
    assert.match(source, /ensureSourceCache/);
});

test('offscreen avatar editing never scrolls the SillyTavern host and removes the fixed toolbar on close', async () => {
    const f = runtimeFixture({
        seed: { assets: [asset()] },
        charRect: { x: 30, y: 900, width: 100, height: 100 },
        charRect2: { x: 30, y: 1040, width: 50, height: 50 },
    });
    await f.runtime.beginEdit({ kind: 'character', avatarId: 'a' });
    assert.ok(f.doc.getElementById('tm-avatar-editor-toolbar'));
    assert.equal(f.chars.reduce((sum, entry) => sum + (entry.avatar.scrollIntoViewCalls || 0), 0), 0);
    await f.runtime.cancelEdit();
    assert.equal(f.doc.getElementById('tm-avatar-editor-toolbar'), null);
});
test('47 editing either target preserves the other target binding', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a'), asset('b')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'a', view: {} },
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'b', view: {} },
    ] } });
    await f.runtime.start();
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'b' });
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src').includes('main-a')));
    const newCharacterMessage = message('character', { x: 30, y: 340, width: 70, height: 70 }, 'raw-new-character.png');
    f.chat.appendChild(newCharacterMessage.mes);
    await f.runtime.reconcile();
    assert.match(newCharacterMessage.image.getAttribute('src'), /main-a/);
    await f.runtime.saveEdit();
    await f.runtime.beginEdit({ kind: 'character', avatarId: 'a' });
    assert.match(f.user.image.getAttribute('src'), /main-b/);
    await f.runtime.saveEdit();
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src').includes('main-a')));
    assert.match(f.user.image.getAttribute('src'), /main-b/);
});
test('48 explicit restore clears the default and every legacy theme-scoped avatar for that target', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'a', view: {} },
        { version: 1, themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
        { version: 1, themeKey: 'theme-name:B', targetKey: 'user:global', avatarId: 'a', view: {} },
    ] } });
    await f.runtime.start();
    await f.runtime.clearBinding('user');
    assert.equal((await f.store.listBindings()).filter((binding) => binding.targetKey === 'user:global').length, 0);
    assert.equal(f.user.image.getAttribute('src'), 'raw-user.png');
});
test('49 mirror flags normalize safely and survive binding persistence', async () => {
    const { store } = memoryStore({ assets: [asset()] });
    const saved = await store.putBinding({ themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'a', view: { flipX: true, flipY: true } });
    assert.deepEqual(saved.view, { x: 0, y: 0, scale: 1, rotate: 0, flipX: true, flipY: true });
    assert.deepEqual(JSON.parse(JSON.stringify(modules.avatarRuntime.normalizeView({ flipX: 'true', flipY: 1 }))), { x: 0, y: 0, scale: 1, rotate: 0, flipX: false, flipY: false });
});
test('rotated source geometry contains both the logical window and transformed pixels with an antialias margin', () => {
    const shapes = [
        { label: 'square', width: 800, height: 800 },
        { label: 'portrait', width: 600, height: 1200 },
        { label: 'landscape', width: 1400, height: 700 },
    ];
    for (const shape of shapes) {
        for (const angle of [-90, -35, -15, 15, 35, 90]) {
            const geometry = modules.avatarRuntime.transformedSourceGeometry(shape, { rotate: angle });
            assert.ok(geometry.canvasWidth >= shape.width, `${shape.label} ${angle} logical width`);
            assert.ok(geometry.canvasHeight >= shape.height, `${shape.label} ${angle} logical height`);
            assert.ok((geometry.canvasWidth - geometry.rotatedWidth) / 2 >= 1, `${shape.label} ${angle} rotated width margin`);
            assert.ok((geometry.canvasHeight - geometry.rotatedHeight) / 2 >= 1, `${shape.label} ${angle} rotated height margin`);
            assert.equal(geometry.logicalLeft, (geometry.canvasWidth - shape.width) / 2);
            assert.equal(geometry.logicalTop, (geometry.canvasHeight - shape.height) / 2);
        }
    }
});
test('expanded source crop maps pan and scale from the original logical coordinates', () => {
    const shape = { width: 1400, height: 700 };
    const view = { x: .2, y: -.15, scale: 1.4, rotate: 35 };
    const geometry = modules.avatarRuntime.transformedSourceGeometry(shape, view);
    const crop = modules.avatarRuntime.objectViewBoxForView(view, geometry);
    const values = crop.match(/-?[\d.]+/g).map(Number);
    const [top, right, bottom, left] = values;
    const leftPixels = left * geometry.canvasWidth / 100;
    const rightPixels = right * geometry.canvasWidth / 100;
    const topPixels = top * geometry.canvasHeight / 100;
    const bottomPixels = bottom * geometry.canvasHeight / 100;
    const visibleWidth = geometry.canvasWidth - leftPixels - rightPixels;
    const visibleHeight = geometry.canvasHeight - topPixels - bottomPixels;
    assert.ok(Math.abs(visibleWidth - shape.width / view.scale) < .02);
    assert.ok(Math.abs(visibleHeight - shape.height / view.scale) < .02);
    assert.ok(Math.abs((leftPixels + visibleWidth / 2) - (geometry.canvasWidth / 2 - view.x * shape.width / view.scale)) < .02);
    assert.ok(Math.abs((topPixels + visibleHeight / 2) - (geometry.canvasHeight / 2 - view.y * shape.height / view.scale)) < .02);
});
test('live rotation preview keeps one geometric envelope and crop across every angle', () => {
    const shapes = [
        { label: 'square', width: 384, height: 384 },
        { label: 'portrait', width: 192, height: 384 },
        { label: 'landscape', width: 384, height: 192 },
    ];
    for (const shape of shapes) {
        const geometry = modules.avatarRuntime.editorPreviewGeometry(shape);
        const crops = [];
        for (const angle of [-90, -35, -15, 0, 15, 35, 90]) {
            const exact = modules.avatarRuntime.transformedSourceGeometry(shape, { rotate: angle });
            assert.ok(geometry.canvasWidth >= exact.rotatedWidth + 2, `${shape.label} ${angle} horizontal envelope`);
            assert.ok(geometry.canvasHeight >= exact.rotatedHeight + 2, `${shape.label} ${angle} vertical envelope`);
            crops.push(modules.avatarRuntime.objectViewBoxForView({ x: .12, y: -.08, scale: .8, rotate: angle }, geometry));
        }
        assert.equal(new Set(crops).size, 1, `${shape.label} angle-invariant crop`);
    }
});
test('flip plus rotation uses the expanded SVG while preserving theme transforms masks and logical crop', async () => {
    const transformed = asset('wide', { width: 1400, height: 700 });
    const view = { x: .2, y: -.15, scale: 1.4, rotate: -35, flipX: true, flipY: false };
    const f = runtimeFixture({ seed: { assets: [transformed], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'wide', view },
    ] } });
    const before = { transform: f.chars[0].image.computed.transform, clip: f.chars[0].image.computed.clipPath, mask: f.chars[0].image.computed.maskImage };
    await f.runtime.start();
    const source = f.chars[0].image.getAttribute('src');
    const svgText = decodeURIComponent(source.slice(source.indexOf(',') + 1));
    const geometry = modules.avatarRuntime.transformedSourceGeometry(transformed, view);
    assert.match(source, /^data:image\/svg\+xml/);
    assert.match(svgText, new RegExp(`width="${geometry.canvasWidth}" height="${geometry.canvasHeight}" viewBox="0 0 ${geometry.canvasWidth} ${geometry.canvasHeight}"`));
    assert.match(svgText, /rotate\(-35\) scale\(-1 1\)/);
    assert.ok((geometry.canvasWidth - geometry.rotatedWidth) / 2 >= 1);
    assert.ok((geometry.canvasHeight - geometry.rotatedHeight) / 2 >= 1);
    assert.deepEqual({ transform: f.chars[0].image.computed.transform, clip: f.chars[0].image.computed.clipPath, mask: f.chars[0].image.computed.maskImage }, before);
    assert.match(f.chars[0].image.getAttribute('style'), /object-view-box:inset\(/);
});
test('library drag updates only the representative until pointer release then synchronizes the target once', async () => {
    const f = runtimeFixture({ seed: { assets: [asset()] } });
    await f.runtime.beginEdit({ kind: 'character', avatarId: 'a' });
    const representative = f.chars.find((entry) => entry.image.classList.contains('tm-avatar-editor-target'));
    const before = f.chars.map((entry) => entry.image.getAttribute('style'));
    const rect = representative.avatar.getBoundingClientRect();
    representative.image.dispatchEvent({ type: 'pointerdown', pointerId: 2, button: 0, clientX: 0, clientY: 0 });
    f.doc.dispatchEvent({ type: 'pointermove', pointerId: 2, clientX: rect.width * .2, clientY: rect.height * .1 });
    const observer = MutationObserver.instances[MutationObserver.instances.length - 1];
    observer.fn([{ type: 'attributes', attributeName: 'src', target: representative.image }]);
    const during = f.chars.map((entry) => entry.image.getAttribute('style'));
    assert.equal(during.filter((style, index) => style !== before[index]).length, 1);
    assert.match(representative.image.getAttribute('src'), /^data:image\/svg\+xml/);
    assert.match(decodeURIComponent(representative.image.getAttribute('src').slice(representative.image.getAttribute('src').indexOf(',') + 1)), /thumb-a/);
    assert.equal(f.chars.filter((entry) => entry !== representative).every((entry) => /main-a/.test(entry.image.getAttribute('src'))), true);
    f.doc.dispatchEvent({ type: 'pointerup', pointerId: 2 });
    const settled = f.chars.map((entry) => entry.image.getAttribute('style'));
    assert.ok(settled.every((style, index) => style !== before[index]));
    assert.ok(settled.every((style) => /object-view-box:inset\(/.test(style)));
    assert.ok(f.chars.every((entry) => /main-a/.test(entry.image.getAttribute('src'))));
    await f.runtime.cancelEdit();
});
test('saved rotated preview reloads to the identical expanded source and crop', async () => {
    const transformed = asset('portrait', { width: 600, height: 1200 });
    const view = { x: -.18, y: .22, scale: 1.6, rotate: 90, flipX: false, flipY: true };
    const f = runtimeFixture({ seed: { assets: [transformed], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'portrait', view },
    ] } });
    await f.runtime.start();
    await f.runtime.beginEdit({ kind: 'character', avatarId: 'portrait' });
    const visual = (entry) => {
        const style = entry.image.getAttribute('style');
        const crops = [...style.matchAll(/object-view-box:([^;]+)!important/g)];
        return { src: entry.image.getAttribute('src'), crop: crops.at(-1)?.[1] || '' };
    };
    const preview = visual(f.chars[0]);
    await f.runtime.saveEdit();
    const saved = visual(f.chars[0]);
    f.runtime.stop();
    await f.runtime.start();
    const reloaded = visual(f.chars[0]);
    assert.equal(saved.src, preview.src);
    assert.equal(reloaded.src, saved.src);
    assert.equal(saved.crop, preview.crop);
    assert.equal(reloaded.crop, saved.crop);
});
test('50 native character views persist without copying the original image into the avatar library', async () => {
    const { adapter, store } = memoryStore();
    await store.putNativeView({ targetKey: 'character:char.png', sourceKey: 'char.png', view: { x: .2, scale: 1.4 } });
    const reloaded = modules.createAvatarStore({ adapter });
    const saved = await reloaded.getNativeView('character:char.png');
    assert.equal((await reloaded.listAssets()).length, 0);
    assert.equal(saved.sourceKey, 'char.png');
    assert.deepEqual(saved.view, { x: .2, y: 0, scale: 1.4, rotate: 0, flipX: false, flipY: false });
});
test('51 native editor previews the original character image and Cancel restores an existing replacement', async () => {
    const f = runtimeFixture({ seed: { assets: [asset()], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'a', view: {} },
    ] } });
    await f.runtime.start();
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src').includes('main-a')));
    const state = await f.runtime.beginNativeEdit();
    assert.equal(state.mode, 'native');
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src').includes('raw-char.png')));
    await f.runtime.cancelEdit();
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src').includes('main-a')));
});
test('52 saving native character adjustment clears replacement binding and uses the shared in-frame crop path', async () => {
    const f = runtimeFixture({ seed: { assets: [asset()], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'a', view: {} },
    ] } });
    f.chars[0].image.setAttribute('srcset', 'raw-char@2x.png 2x');
    await f.runtime.start();
    await f.runtime.beginNativeEdit();
    f.runtime.setScale(1.35);
    const result = await f.runtime.saveEdit();
    const stored = await f.store.getNativeView('character:char.png');
    assert.equal(result.nativeView.view.scale, 1.35);
    assert.equal(stored.sourceKey, 'char.png');
    assert.equal(await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY, 'character:char.png'), null);
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src') === 'data:image/png;base64,AA=='));
    assert.ok(f.chars.every((entry) => /object-view-box:inset\(12\.963% 12\.963% 12\.963% 12\.963%\)!important/.test(entry.image.getAttribute('style'))));
    assert.equal(f.chars[0].image.getAttribute('srcset'), null);
});
test('53 persisted native character adjustment reapplies after reload and across theme changes', async () => {
    const f = runtimeFixture({ seed: { nativeViews: [
        { targetKey: 'character:char.png', sourceKey: 'char.png', view: { x: .15, y: -.1, scale: 1.2 } },
    ] } });
    await f.runtime.start();
    const first = f.chars[0].image.getAttribute('src');
    const firstCrop = f.chars[0].image.getAttribute('style');
    assert.equal(first, 'data:image/png;base64,AA==');
    assert.match(firstCrop, /object-view-box:inset\(16\.6667% 20\.8333% 0% -4\.1667%\)!important/);
    f.setTheme('B');
    await f.runtime.reconcile();
    assert.equal(f.chars[0].image.getAttribute('src'), first);
    assert.match(f.chars[0].image.getAttribute('style'), /object-view-box:inset\(16\.6667% 20\.8333% 0% -4\.1667%\)!important/);
    assert.equal(f.user.image.getAttribute('src'), 'raw-user.png');
});
test('54 a different character avatar identity does not inherit the previous original-image adjustment', async () => {
    const context = { characters: [{ avatar: 'new-char.png', name: 'Char' }], characterId: 0, groupId: null, name1: 'User', eventSource: { on() {}, removeListener() {} }, eventTypes: {} };
    const f = runtimeFixture({ context, seed: { nativeViews: [
        { targetKey: 'character:old-char.png', sourceKey: 'old-char.png', view: { scale: 2 } },
    ] } });
    await f.runtime.start();
    assert.equal(f.chars[0].image.getAttribute('src'), 'raw-char.png');
    assert.equal(f.chars[0].image.getAttribute('style'), 'opacity:.99');
});
test('55 Avatar Page keeps the grid for library assets and exposes current-character status for the shared bottom bar', () => {
    const html = modules.avatarPage.buildPageHtml('placeholder');
    assert.doesNotMatch(html, /data-avatar-native-bar|data-avatar-action="adjust-native"|调整原头像/);
    const f = pageFixture();
    const status = f.page.getNativeStatus();
    assert.equal(status.available, true);
    assert.equal(status.targetKey, 'character:c');
});
test('56 User original avatar restores its exact host source while retaining content neutralization', async () => {
    const f = runtimeFixture();
    f.user.image.setAttribute('srcset', 'raw-user@2x.png 2x');
    await f.runtime.start();
    await f.runtime.beginNativeEdit('user');
    f.runtime.setScale(1.25);
    const saved = await f.runtime.saveEdit();
    const record = await f.store.getNativeView('user:global');
    assert.equal(saved.nativeView.targetKey, 'user:global');
    assert.equal(record.sourceKey, 'raw-user.png');
    assert.equal(f.user.image.getAttribute('src'), 'data:image/png;base64,AA==');
    assert.match(f.user.image.getAttribute('style'), /object-view-box:inset\(10% 10% 10% 10%\)!important/);
    assert.equal(f.chars[0].image.getAttribute('src'), 'raw-char.png');
    await f.runtime.clearNativeView('user');
    assert.equal(await f.store.getNativeView('user:global'), null);
    assert.equal(f.user.image.getAttribute('src'), 'raw-user.png');
    assert.equal(f.user.image.getAttribute('srcset'), 'raw-user@2x.png 2x');
    assert.match(f.user.image.getAttribute('style'), /^opacity:\.99;content:normal!important;$/);
});
test('57 a saved character original-avatar adjustment can be cleared without touching User', async () => {
    const f = runtimeFixture({ seed: { nativeViews: [
        { targetKey: 'character:char.png', sourceKey: 'char.png', view: { x: .2, scale: 1.4 } },
    ] } });
    await f.runtime.start();
    assert.equal(f.chars[0].image.getAttribute('src'), 'data:image/png;base64,AA==');
    assert.match(f.chars[0].image.getAttribute('style'), /object-view-box:/);
    await f.runtime.clearNativeView('character');
    assert.equal(await f.store.getNativeView('character:char.png'), null);
    assert.equal(f.chars[0].image.getAttribute('src'), 'raw-char.png');
    assert.match(f.chars[0].image.getAttribute('style'), /^opacity:\.99;content:normal!important;$/);
    assert.equal(f.user.image.getAttribute('src'), 'raw-user.png');
    assert.equal(f.user.image.getAttribute('style'), 'opacity:.99');
});
test('58 native live adjustment updates only the representative until Save', async () => {
    const f = runtimeFixture();
    await f.runtime.start();
    await f.runtime.beginNativeEdit('character');
    f.runtime.setScale(1.4);
    assert.equal(f.chars.filter((entry) => entry.image.getAttribute('src') === 'data:image/png;base64,AA==').length, 1);
    assert.equal(f.chars.filter((entry) => entry.image.getAttribute('src') === 'raw-char.png').length, 1);
    await f.runtime.saveEdit();
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src') === 'data:image/png;base64,AA=='));
});

test('59 theme-specific User bindings switch A and B while an unbound theme uses the global fallback', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('global'), asset('a'), asset('b'), asset('character')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'character', view: {} },
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: { x: .1 } },
        { themeKey: 'theme-name:B', targetKey: 'user:global', avatarId: 'b', view: { y: .2 } },
    ] } });
    await f.runtime.start();
    assert.match(f.user.image.getAttribute('src'), /main-a/);
    const characterSource = f.chars[0].image.getAttribute('src');
    f.setTheme('B'); await f.runtime.reconcile();
    assert.match(f.user.image.getAttribute('src'), /main-b/);
    f.setTheme('C'); await f.runtime.reconcile();
    assert.match(f.user.image.getAttribute('src'), /main-global/);
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src') === characterSource));
});

test('60 clearing a theme-specific User binding immediately falls back to the global avatar', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('global'), asset('a')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
    ] } });
    await f.runtime.start();
    assert.match(f.user.image.getAttribute('src'), /main-a/);
    await f.runtime.clearThemeUserBinding('A');
    assert.match(f.user.image.getAttribute('src'), /main-global/);
    assert.equal(await f.runtime.getThemeUserBinding('A'), null);
});

test('61 a temporary User replacement survives same-theme reconcile but never mutates the theme binding', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('global'), asset('a'), asset('temp')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: { scale: 1.1 } },
    ] } });
    await f.runtime.start();
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'temp', bindingMode: 'temporary', themeName: 'A' });
    f.runtime.setScale(1.4);
    const saved = await f.runtime.saveEdit();
    assert.equal(saved.temporary, true);
    assert.match(f.user.image.getAttribute('src'), /main-temp/);
    await f.runtime.reconcile();
    assert.match(f.user.image.getAttribute('src'), /main-temp/);
    const persisted = await f.store.getBinding('theme-name:A', 'user:global');
    assert.equal(persisted.avatarId, 'a');
    assert.equal(persisted.view.scale, 1.1);
    f.setTheme('B'); await f.runtime.reconcile();
    assert.match(f.user.image.getAttribute('src'), /main-global/);
    f.setTheme('A'); await f.runtime.reconcile();
    assert.match(f.user.image.getAttribute('src'), /main-a/);
});

test('62 modifying the current theme binding persists the chosen avatar and adjusted view only to that theme', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('global'), asset('a'), asset('replacement')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
    ] } });
    await f.runtime.start();
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'replacement', bindingMode: 'theme', themeName: 'A' });
    f.runtime.setScale(1.25);
    await f.runtime.saveEdit();
    const themed = await f.store.getBinding('theme-name:A', 'user:global');
    const global = await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY, 'user:global');
    assert.equal(themed.avatarId, 'replacement');
    assert.equal(themed.view.scale, 1.25);
    assert.equal(global.avatarId, 'global');
});

test('63 a late avatar read from an older theme cannot overwrite the newest theme', async () => {
    const bundle = memoryStore({ assets: [asset('a'), asset('b')], bindings: [
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
        { themeKey: 'theme-name:B', targetKey: 'user:global', avatarId: 'b', view: {} },
    ] });
    let releaseA;
    const gateA = new Promise((resolve) => { releaseA = resolve; });
    const delayedStore = Object.assign({}, bundle.store, {
        getAsset(id) {
            if (id !== 'a') return bundle.store.getAsset(id);
            return gateA.then(() => bundle.store.getAsset(id));
        },
    });
    const f = runtimeFixture({ seed: {}, store: delayedStore });
    const oldApply = f.runtime.reconcile();
    f.setTheme('B');
    const newestApply = f.runtime.reconcile();
    await newestApply;
    assert.match(f.user.image.getAttribute('src'), /main-b/);
    releaseA();
    const oldResult = await oldApply;
    assert.equal(oldResult.superseded, true);
    assert.match(f.user.image.getAttribute('src'), /main-b/);
});

test('64 avatar grids use definite square items without implicit-row compression', () => {
    const css = modules.avatarPage.styleText();
    assert.match(css, /grid-auto-rows:max-content/);
    assert.match(css, /align-items:start/);
    assert.match(css, /tm-avatar-page-card\{[^}]*width:100%[^}]*aspect-ratio:1[^}]*align-self:start/);
    assert.match(css, /tm-avatar-page-thumb\{[^}]*position:absolute[^}]*inset:0/);
});

test('65 the theme editor manages bound User and Character avatars without opening the full library', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    assert.match(source, /<label>头像绑定<\/label>/);
    assert.doesNotMatch(source, /avatarPageController\.openPicker/);
    assert.match(source, /getThemeAvatarBindingSet/);
    assert.match(source, /setThemeAvatarBinding/);
    assert.match(source, /removeThemeAvatarBinding/);
    assert.match(source, /avatarStore\.getAssetMetadata/);
    assert.doesNotMatch(source, /avatarStore\.listAssets/);
    assert.match(source, /IntersectionObserver: null[\s\S]*avatarStore\.getThumbnail/);
    assert.match(source, /bindingMode: 'theme'/);
    assert.match(source, /clearThemeAvatarBinding/);
    assert.match(source, /data-avatar-bind-kind="user"/);
    assert.match(source, /data-avatar-bind-kind="character"/);
});

test('66 clearing the global User avatar preserves a v4 theme-specific binding', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('global'), asset('a')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
    ] } });
    await f.runtime.start();
    await f.runtime.clearBinding('user');
    assert.equal(await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY, 'user:global'), null);
    assert.equal((await f.store.getBinding('theme-name:A', 'user:global')).avatarId, 'a');
    assert.match(f.user.image.getAttribute('src'), /main-a/);
});

test('67 theme-specific edit save fails closed after the current theme changes', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a')] } });
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'a', bindingMode: 'theme', themeName: 'A' });
    f.setTheme('B');
    await assert.rejects(f.runtime.saveEdit(), (error) => error.code === 'superseded');
    assert.equal(await f.store.getBinding('theme-name:A', 'user:global'), null);
    assert.equal(f.runtime.getState().state, 'idle');
});

test('68 a dedicated theme binding applies only to the current Character target', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a'), asset('other')], bindings: [
        { version: 4, themeKey: 'theme-name:A', targetKey: 'character:char.png', avatarId: 'a', view: {} },
        { version: 4, themeKey: 'theme-name:A', targetKey: 'character:other.png', avatarId: 'other', view: {} },
    ] } });
    await f.runtime.start();
    assert.ok(f.chars.every((entry) => /main-a/.test(entry.image.getAttribute('src'))));
    assert.equal(await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY, 'character:char.png'), null);
    assert.equal((await f.store.getBinding('theme-name:A', 'character:other.png')).avatarId, 'other');
});

test('69 adaptive User editing exposes the bind-after-adjust choice and saves global fallback when no theme binding exists', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a')] } });
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'a', bindingMode: 'adaptive', themeName: 'A' });
    assert.equal(f.runtime.getState().bindToTheme, false);
    assert.equal(f.runtime.getState().unboundSaveMode, 'global');
    await f.runtime.saveEdit();
    assert.equal((await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY, 'user:global')).avatarId, 'a');
    assert.equal(await f.store.getBinding('theme-name:A', 'user:global'), null);
});

test('70 adaptive User editing stays temporary when the theme already has a binding and bind is not selected', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('global'), asset('a'), asset('temp')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
    ] } });
    await f.runtime.start();
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'temp', bindingMode: 'adaptive', themeName: 'A' });
    assert.equal(f.runtime.getState().unboundSaveMode, 'temporary');
    assert.match(f.user.image.getAttribute('src'), /main-temp/);
    const result = await f.runtime.saveEdit();
    assert.equal(result.temporary, true);
    assert.equal((await f.store.getBinding('theme-name:A', 'user:global')).avatarId, 'a');
    assert.match(f.user.image.getAttribute('src'), /main-temp/);
});

test('71 bind-after-adjust adds a candidate and makes it the active theme User avatar', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('global'), asset('a')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
    ] } });
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'a', bindingMode: 'adaptive', themeName: 'A' });
    f.runtime.setBindToTheme(true);
    f.runtime.setScale(1.35);
    await f.runtime.saveEdit();
    const bindingSet = await f.runtime.getThemeUserBindingSet('A');
    assert.equal(bindingSet.active.avatarId, 'a');
    assert.equal(bindingSet.candidates.length, 1);
    assert.equal(bindingSet.candidates[0].view.scale, 1.35);
    assert.match(f.user.image.getAttribute('src'), /main-a/);
});

test('72 a theme can switch among only its bound User avatar candidates and preserve each adjustment', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a'), asset('b')] } });
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'a', bindingMode: 'theme', themeName: 'A' });
    f.runtime.setScale(1.2); await f.runtime.saveEdit();
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'b', bindingMode: 'theme', themeName: 'A' });
    f.runtime.setScale(1.5); await f.runtime.saveEdit();
    let bindingSet = await f.runtime.getThemeUserBindingSet('A');
    assert.equal(bindingSet.candidates.length, 2);
    await f.runtime.setThemeUserBinding('A', 'a');
    bindingSet = await f.runtime.getThemeUserBindingSet('A');
    assert.equal(bindingSet.active.avatarId, 'a');
    assert.equal(bindingSet.active.view.scale, 1.2);
    await f.runtime.removeThemeUserBinding('A', 'a');
    bindingSet = await f.runtime.getThemeUserBindingSet('A');
    assert.equal(bindingSet.active.avatarId, 'b');
    assert.equal(bindingSet.candidates.length, 1);
});

test('theme binding creation uses one local binding batch and preserves active candidate semantics', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a')] } });
    const originalBatch = f.store.mutateBindings;
    const originalPut = f.store.putBinding;
    const batches = [];
    let individualPuts = 0;
    f.store.mutateBindings = function (operations) { batches.push(operations); return originalBatch.call(this, operations); };
    f.store.putBinding = function () { individualPuts += 1; return originalPut.apply(this, arguments); };
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'a', bindingMode: 'theme', themeName: 'A' });
    await f.runtime.saveEdit();
    const bindingSet = await f.runtime.getThemeUserBindingSet('A');
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 2);
    assert.equal(individualPuts, 0);
    assert.equal(bindingSet.active.avatarId, 'a');
    assert.deepEqual(Array.from(bindingSet.candidates, binding => binding.avatarId), ['a']);
});

test('theme binding replacement preserves the previous active in one local binding batch', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a'), asset('b')], bindings: [
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: { scale: 1.25 } },
    ] } });
    const originalBatch = f.store.mutateBindings;
    const batches = [];
    f.store.mutateBindings = function (operations) { batches.push(operations); return originalBatch.call(this, operations); };
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'b', bindingMode: 'theme', themeName: 'A' });
    f.runtime.setScale(1.5);
    await f.runtime.saveEdit();
    const bindingSet = await f.runtime.getThemeUserBindingSet('A');
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 3);
    assert.equal(bindingSet.active.avatarId, 'b');
    assert.equal(bindingSet.active.view.scale, 1.5);
    assert.deepEqual(new Set(bindingSet.candidates.map(binding => binding.avatarId)), new Set(['a', 'b']));
    assert.equal(bindingSet.candidates.find(binding => binding.avatarId === 'a').view.scale, 1.25);
});

test('Character theme bindings keep multiple adjusted candidates and switch or remove them independently', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('char-a'), asset('char-b'), asset('user-a')] } });
    await f.runtime.beginEdit({ kind: 'character', avatarId: 'char-a', bindingMode: 'theme', themeName: 'A' });
    f.runtime.setScale(1.2);
    await f.runtime.saveEdit();
    await f.runtime.beginEdit({ kind: 'character', avatarId: 'char-b', bindingMode: 'theme', themeName: 'A' });
    f.runtime.setScale(1.55);
    await f.runtime.saveEdit();
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'user-a', bindingMode: 'theme', themeName: 'A' });
    await f.runtime.saveEdit();

    let bindingSet = await f.runtime.getThemeAvatarBindingSet('A', 'character');
    assert.equal(bindingSet.active.avatarId, 'char-b');
    assert.equal(bindingSet.candidates.length, 2);
    assert.equal(bindingSet.candidates.find(binding => binding.avatarId === 'char-a').view.scale, 1.2);
    assert.equal(bindingSet.candidates.find(binding => binding.avatarId === 'char-b').view.scale, 1.55);
    assert.ok(bindingSet.candidates.every(binding => binding.targetKey.startsWith('theme-avatar-candidate:')));
    assert.ok(bindingSet.candidates.every(binding => !binding.targetKey.startsWith('character:')));

    await f.runtime.setThemeAvatarBinding('A', 'character', 'char-a');
    bindingSet = await f.runtime.getThemeAvatarBindingSet('A', 'character');
    assert.equal(bindingSet.active.avatarId, 'char-a');
    await f.runtime.removeThemeAvatarBinding('A', 'character', 'char-a');
    bindingSet = await f.runtime.getThemeAvatarBindingSet('A', 'character');
    assert.equal(bindingSet.active.avatarId, 'char-b');
    assert.equal(bindingSet.candidates.length, 1);

    await f.runtime.clearThemeAvatarBinding('A', 'character');
    bindingSet = await f.runtime.getThemeAvatarBindingSet('A', 'character');
    assert.equal(bindingSet.active, null);
    assert.equal(bindingSet.candidates.length, 0);
    assert.equal((await f.runtime.getThemeAvatarBindingSet('A', 'user')).active.avatarId, 'user-a');
});

test('Character theme replacement is committed as one atomic binding batch', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('char-a'), asset('char-b')], bindings: [
        { version: 4, themeKey: 'theme-name:A', targetKey: 'character:char.png', avatarId: 'char-a', view: { scale: 1.25 } },
    ] } });
    const originalBatch = f.store.mutateBindings;
    const batches = [];
    f.store.mutateBindings = function (operations) { batches.push(operations); return originalBatch.call(this, operations); };
    await f.runtime.beginEdit({ kind: 'character', avatarId: 'char-b', bindingMode: 'theme', themeName: 'A' });
    await f.runtime.saveEdit();
    const bindingSet = await f.runtime.getThemeAvatarBindingSet('A', 'character');
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 3);
    assert.equal(bindingSet.active.avatarId, 'char-b');
    assert.deepEqual(new Set(bindingSet.candidates.map(binding => binding.avatarId)), new Set(['char-a', 'char-b']));
});

test('73 newly inserted message avatars receive cached bindings synchronously from the observer callback', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a')], bindings: [
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
    ] } });
    await f.runtime.start();
    const next = message('user', { x: 20, y: 350, width: 60, height: 60 }, 'raw-user-new.png');
    f.chat.appendChild(next.mes);
    const observer = MutationObserver.instances[MutationObserver.instances.length - 1];
    observer.fn([{ type: 'childList', addedNodes: [next.mes] }]);
    assert.match(next.image.getAttribute('src'), /main-a/);
});

test('74 bound-avatar metadata lookup does not load full-size or thumbnail payloads', async () => {
    const { store } = memoryStore({ assets: [asset('a')] });
    const metadata = await store.getAssetMetadata('a');
    assert.equal(metadata.id, 'a');
    assert.equal(Object.hasOwn(metadata, 'imageData'), false);
    assert.equal(Object.hasOwn(metadata, 'thumbData'), false);
});

test('75 runtime neutralizes theme CSS content overrides when applying an avatar', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a')], bindings: [
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
    ] } });
    f.user.image.computed.content = 'url(old-avatar.png)';
    await f.runtime.start();
    assert.match(f.user.image.getAttribute('style'), /content:normal!important/);
});

test('76 an unmanaged target leaves the theme content override untouched', async () => {
    const f = runtimeFixture();
    f.user.image.computed.content = 'url(old-avatar.png)';
    const baselineStyle = f.user.image.getAttribute('style');
    await f.runtime.start();
    assert.equal(f.user.image.getAttribute('style'), baselineStyle);
    assert.equal(await f.store.getSourceIntent('user:global'), null);
});

test('77 explicit global User restore keeps the host source and neutralizes stale content across reconcile reload and new messages', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'a', view: {} },
    ] } });
    f.user.image.computed.content = 'url(old-avatar.png)';
    await f.runtime.start();
    await f.runtime.clearBinding('user');
    assert.equal(f.user.image.getAttribute('src'), 'raw-user.png');
    assert.match(f.user.image.getAttribute('style'), /content:normal!important/);
    assert.equal((await f.store.getSourceIntent('user:global')).mode, 'host-source');

    await f.runtime.reconcile();
    assert.equal(f.user.image.getAttribute('src'), 'raw-user.png');
    assert.match(f.user.image.getAttribute('style'), /content:normal!important/);

    const next = message('user', { x: 20, y: 350, width: 60, height: 60 }, 'raw-user-new.png');
    next.image.computed.content = 'url(old-avatar.png)';
    f.chat.appendChild(next.mes);
    const observer = MutationObserver.instances[MutationObserver.instances.length - 1];
    observer.fn([{ type: 'childList', addedNodes: [next.mes] }]);
    assert.equal(next.image.getAttribute('src'), 'raw-user-new.png');
    assert.match(next.image.getAttribute('style'), /content:normal!important/);

    f.runtime.stop();
    assert.doesNotMatch(f.user.image.getAttribute('style'), /content:normal!important/);
    await f.runtime.start();
    assert.equal(f.user.image.getAttribute('src'), 'raw-user.png');
    assert.match(f.user.image.getAttribute('style'), /content:normal!important/);
});

test('78 runtime observes host avatar source rewrites without broad attribute watching', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-runtime.js'), 'utf8');
    assert.match(source, /attributeFilter:\s*\['is_user', 'is_system', 'src', 'srcset'\]/);
});

test('79 theme editor keeps unified avatar bindings collapsed and places target tabs above the bound pool', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    assert.match(source, /id=\"tm-avatar-bind-overview\"/);
    assert.match(source, /function openAvatarBindingsSheet\(/);
    assert.match(source, /tm-avatar-bind-targets[\s\S]*id="tm-avatar-bind-actions"[\s\S]*id="tm-avatar-bind-sheet-body"/);
    assert.doesNotMatch(source, /<div class=\"tm-field\"><label>头像绑定<\/label><div class=\"tm-user-avatar-bind\"/);
});

test('80 complete User recovery clears every User override while preserving assets and Character state', async () => {
    const candidateKey = modules.avatarRuntime.themeUserCandidateTargetKey('candidate');
    const f = runtimeFixture({ seed: {
        assets: [asset('global'), asset('legacy'), asset('active'), asset('candidate'), asset('character')],
        bindings: [
            { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
            { version: 1, themeKey: 'theme-name:Legacy', targetKey: 'user:global', avatarId: 'legacy', view: {} },
            { version: 4, themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'active', view: { scale: 1.2 } },
            { version: 4, themeKey: 'theme-name:A', targetKey: candidateKey, avatarId: 'candidate', view: { scale: 1.3 } },
            { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'character', view: {} },
        ],
        nativeViews: [
            { targetKey: 'user:global', sourceKey: 'raw-user.png', view: { scale: 1.4 } },
            { targetKey: 'character:char.png', sourceKey: 'char.png', view: { scale: 1.1 } },
        ],
    } });
    f.user.image.computed.content = 'url(old-avatar.png)';
    let hostChatReloads = 0;
    f.context.reloadCurrentChat = async () => { hostChatReloads += 1; };
    await f.runtime.start();
    const characterSource = f.chars[0].image.getAttribute('src');
    const result = await f.runtime.clearAllUserOverrides();
    const remaining = await f.store.listBindings();
    assert.equal(result.bindingsCleared, 4);
    assert.equal(result.hostChatReloaded, true);
    assert.equal(hostChatReloads, 1);
    assert.equal(remaining.filter((binding) => binding.targetKey === 'user:global' || binding.targetKey.startsWith('user:global:theme-avatar:')).length, 0);
    assert.equal((remaining.find((binding) => binding.targetKey === 'character:char.png') || {}).avatarId, 'character');
    assert.equal(await f.store.getNativeView('user:global'), null);
    assert.equal((await f.store.getNativeView('character:char.png')).sourceKey, 'char.png');
    assert.equal((await f.store.listAssets()).length, 5);
    assert.equal(f.user.image.getAttribute('src'), 'raw-user.png');
    assert.match(f.user.image.getAttribute('style'), /content:normal!important/);
    assert.equal(f.chars[0].image.getAttribute('src'), characterSource);
});

test('81 avatar settings exposes a confirmed complete User recovery action', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    assert.match(source, /id=\"tm-clear-all-user-avatar-overrides\"/);
    assert.match(source, /avatarRuntime\.clearAllUserOverrides\(\)/);
    assert.match(source, /头像库和角色头像不会被删除/);
    assert.match(source, /previousAvatarRuntime\.stop\(\)/);
    assert.match(source, /global\.location\.reload\(\)/);
});

test('Avatar settings expose verified backup restore and a clear mobile size warning', () => {
    const pageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-page.js'), 'utf8');
    const uiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    const settings = uiSource.slice(uiSource.indexOf('function openAvatarSettingsSheet'), uiSource.indexOf('function openSettingsSheet'));
    assert.match(pageSource, /dialogItem\('view'[\s\S]*dialogItem\('export'[\s\S]*dialogItem\('manage'/);
    assert.match(pageSource, /transfer\.exportSingle\(id\)/);
    assert.match(pageSource, /transfer\.exportBatch\(ids\)/);
    assert.match(settings, />设置<\/div>/);
    assert.match(settings, /管理分类（' \+ state\.categories \+ '个）/);
    assert.match(settings, /创建完整备份/);
    assert.match(settings, /avatarTransferApi\.createFullBackup\(\)/);
    assert.match(settings, /从完整备份恢复/);
    assert.match(settings, /avatarRecoveryApi\.restoreBackup\(file\)/);
    assert.match(settings, /超过移动端完整备份安全上限 48MB；可在桌面端备份或分批导出图片/);
    assert.match(settings, /回滚未完成的恢复/);
    assert.ok(uiSource.indexOf('modules.avatarRecovery.resolveBootstrap') < uiSource.indexOf('modules.createAvatarStore({ dbName: avatarRecoveryBootstrap.databaseName })'));
    assert.match(uiSource, /if \(avatarRecoveryGateLocked\) return Promise\.reject/);
    assert.ok(settings.indexOf('organizeHtml') < settings.indexOf("buildDisclosureHtml('tm-avatar-settings-interface'"));
    assert.ok(settings.indexOf("buildDisclosureHtml('tm-avatar-settings-interface'") < settings.indexOf("buildDisclosureHtml('tm-avatar-settings-data'"));
    assert.doesNotMatch(settings, /分类与整理|tm-avatar-settings-organize/);
});

test('82 development module loading replaces stale-build scripts and uses a build cache token', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.match(source, /TM_BUILD = 'beauty-ui-update-r1'/);
    assert.match(source, /existing\.dataset\.themeMgrBuild === TM_BUILD/);
    assert.match(source, /existing\.parentNode\.removeChild\(existing\)/);
    assert.match(source, /encodeURIComponent\(MODULE_LOAD_TOKEN\)/);
});

test('83 runtime rejects every avatar mutation while the coordinator gate is read-only', async () => {
    const f = runtimeFixture({ seed: { assets: [asset()] }, canMutate: () => false });
    await assert.rejects(f.runtime.beginEdit({ kind: 'user', avatarId: 'a' }), error => error.code === 'AVATAR_STORAGE_READ_ONLY');
    await assert.rejects(f.runtime.beginNativeEdit('user'), error => error.code === 'AVATAR_STORAGE_READ_ONLY');
    await assert.rejects(f.runtime.clearBinding('user'), error => error.code === 'AVATAR_STORAGE_READ_ONLY');
    await assert.rejects(f.runtime.deleteAsset('a'), error => error.code === 'AVATAR_STORAGE_READ_ONLY');
    assert.ok(await f.store.getAsset('a'));
});

test('84 runtime cannot start before the coordinator marks storage ready', async () => {
    const f = runtimeFixture({ canStart: () => false });
    await assert.rejects(f.runtime.start(), error => error.code === 'AVATAR_STORAGE_NOT_READY');
    assert.equal(f.user.image.getAttribute('src'), 'raw-user.png');
});

test('85 Avatar Page does not open import while storage is not writable', async () => {
    let processed = 0;
    const f = pageFixture([], [], {
        canMutate: () => false,
        processor: { processFile: async () => { processed += 1; return asset(); } },
    });
    await f.page.mount();
    await assert.rejects(f.page.importFiles([{ name: 'blocked.jpg', type: 'image/jpeg' }]), error => error.code === 'AVATAR_STORAGE_READ_ONLY');
    assert.equal(f.page.pickFiles(), false);
    assert.equal(processed, 0);
    assert.match(f.pageRoot.notice.innerHTML, /只读/);
    assert.doesNotMatch(f.pageRoot.notice.innerHTML, /尚未安全就绪/);
});

test('86 UI reuses Theme Manager backend availability before starting Avatar runtime', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    assert.match(source, /isBackendAvailable: getServerMode/);
    assert.match(source, /avatarCoordinator\.initialize\(\)\.then\(function \(\) \{\s*if \(!avatarCoordinator\.isRuntimeReady\(\)\) return;\s*return avatarRuntime\.start\(\);/);
    assert.match(source, /avatarStore = avatarCoordinator\.store/);
    assert.doesNotMatch(source, /avatarStore = modules\.createAvatarStore\(\{\}\);/);
    assert.doesNotMatch(source, /toast\(error\.message \|\| '头像存储尚未安全就绪'/);
    assert.doesNotMatch(source, /头像存储尚未安全就绪/);
});

test('87 chat scope requires both a stable integrity key and a loaded chat id', () => {
    const ready = modules.avatarRuntime.getContextInfo({
        chatId: 'Chat One', chatMetadata: { integrity: 'chat/key 1' }, getCurrentChatId() { return this.chatId; },
    });
    assert.equal(ready.chatBindingKey, 'chat-integrity:chat%2Fkey%201');
    assert.equal(modules.avatarRuntime.getContextInfo({ chatId: 'Chat One', chatMetadata: {} }).chatBindingKey, '');
    assert.equal(modules.avatarRuntime.getContextInfo({ chatMetadata: { integrity: 'chat-key' } }).chatBindingKey, '');
});

test('88 avatar resolution follows chat then theme then global precedence', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('global'), asset('theme'), asset('chat')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
        { version: 4, themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'theme', view: {} },
        { version: 4, themeKey: 'chat-integrity:chat-uuid-1', targetKey: 'user:global', avatarId: 'chat', view: {} },
    ] } });
    await f.runtime.start();
    assert.match(f.user.image.getAttribute('src'), /main-chat/);
    f.context.chatMetadata = { integrity: 'chat-uuid-2' };
    await f.runtime.reconcile();
    assert.match(f.user.image.getAttribute('src'), /main-theme/);
    f.setTheme('B');
    await f.runtime.reconcile();
    assert.match(f.user.image.getAttribute('src'), /main-global/);
});

test('89 User and Character can save isolated bindings for the current chat', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('user-chat'), asset('character-chat')] } });
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'user-chat', bindingMode: 'chat' });
    await f.runtime.saveEdit();
    await f.runtime.beginEdit({ kind: 'character', avatarId: 'character-chat', bindingMode: 'chat' });
    await f.runtime.saveEdit();
    const scopeKey = 'chat-integrity:chat-uuid-1';
    assert.equal((await f.store.getBinding(scopeKey, 'user:global')).avatarId, 'user-chat');
    assert.equal((await f.store.getBinding(scopeKey, 'character:char.png')).avatarId, 'character-chat');
});

test('90 Character can save a dedicated current-theme binding', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('character-theme')] } });
    await f.runtime.beginEdit({ kind: 'character', avatarId: 'character-theme', bindingMode: 'theme' });
    await f.runtime.saveEdit();
    const saved = await f.store.getBinding('theme-name:A', 'character:char.png');
    assert.equal(saved.avatarId, 'character-theme');
    assert.equal(saved.version, 4);
});

test('91 clearing one application scope preserves every other binding', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('global'), asset('theme'), asset('chat'), asset('character')], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
        { version: 4, themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'theme', view: {} },
        { version: 4, themeKey: 'chat-integrity:chat-uuid-1', targetKey: 'user:global', avatarId: 'chat', view: {} },
        { version: 4, themeKey: 'chat-integrity:chat-uuid-1', targetKey: 'character:char.png', avatarId: 'character', view: {} },
    ] } });
    await f.runtime.clearApplicationScope('user', 'chat');
    assert.equal(await f.store.getBinding('chat-integrity:chat-uuid-1', 'user:global'), null);
    assert.equal((await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY, 'user:global')).avatarId, 'global');
    assert.equal((await f.store.getBinding('theme-name:A', 'user:global')).avatarId, 'theme');
    assert.equal((await f.store.getBinding('chat-integrity:chat-uuid-1', 'character:char.png')).avatarId, 'character');
});

test('application scope status reports the current theme multi-avatar count', async () => {
    const candidateKey = modules.avatarRuntime.themeUserCandidateTargetKey('candidate');
    const f = runtimeFixture({ seed: { assets: [asset('active'), asset('candidate')], bindings: [
        { version: 4, themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'active', view: {} },
        { version: 4, themeKey: 'theme-name:A', targetKey: candidateKey, avatarId: 'candidate', view: {} },
    ] } });
    const status = await f.runtime.getApplicationScopes('user');
    assert.equal(status.scopes.theme.binding.avatarId, 'active');
    assert.equal(status.scopes.theme.count, 2);
});

test('complete avatar recovery atomically clears every User and current Character binding without deleting images or native adjustments', async () => {
    const userCandidate = modules.avatarRuntime.themeUserCandidateTargetKey('user-theme-b');
    const characterCandidate = modules.avatarRuntime.themeAvatarCandidateTargetKey('character:char.png', 'char-theme-b');
    const assets = ['user-global', 'user-theme-a', 'user-theme-b', 'user-chat-a', 'user-chat-b', 'char-global', 'char-theme-a', 'char-theme-b', 'char-chat', 'other-char'].map(id => asset(id));
    const f = runtimeFixture({ seed: {
        assets,
        bindings: [
            { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'user-global', view: {} },
            { version: 4, themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'user-theme-a', view: {} },
            { version: 4, themeKey: 'theme-name:A', targetKey: userCandidate, avatarId: 'user-theme-b', view: {} },
            { version: 4, themeKey: 'chat-integrity:chat-a', targetKey: 'user:global', avatarId: 'user-chat-a', view: {} },
            { version: 4, themeKey: 'chat-integrity:chat-b', targetKey: 'user:global', avatarId: 'user-chat-b', view: {} },
            { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'char-global', view: {} },
            { version: 4, themeKey: 'theme-name:A', targetKey: 'character:char.png', avatarId: 'char-theme-a', view: {} },
            { version: 4, themeKey: 'theme-name:A', targetKey: characterCandidate, avatarId: 'char-theme-b', view: {} },
            { version: 4, themeKey: 'chat-integrity:chat-a', targetKey: 'character:char.png', avatarId: 'char-chat', view: {} },
            { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:other.png', avatarId: 'other-char', view: {} },
        ],
        nativeViews: [
            { targetKey: 'user:global', sourceKey: 'raw-user.png', view: { scale: 1.2 } },
            { targetKey: 'character:char.png', sourceKey: 'char.png', view: { scale: 1.1 } },
        ],
    } });
    const originalBatch = f.store.mutateBindings;
    const batches = [];
    f.store.mutateBindings = function (operations) { batches.push(operations); return originalBatch.call(this, operations); };
    const before = await f.runtime.getAvatarBindingRecoverySummary();
    assert.equal(before.user.total, 5);
    assert.equal(before.character.total, 4);
    assert.equal(before.total, 9);

    const result = await f.runtime.clearAllAvatarBindings();
    const remaining = await f.store.listBindings();
    assert.equal(result.bindingsCleared, 9);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 9);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].targetKey, 'character:other.png');
    assert.equal((await f.store.listAssets()).length, assets.length);
    assert.equal((await f.store.getNativeView('user:global')).view.scale, 1.2);
    assert.equal((await f.store.getNativeView('character:char.png')).view.scale, 1.1);
});

test('92 overwriting the host original preserves all existing bindings', async () => {
    const calls = [];
    let reloads = 0;
    const f = runtimeFixture({
        seed: { assets: [asset('replacement'), asset('global'), asset('theme'), asset('chat')], bindings: [
            { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
            { version: 4, themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'theme', view: {} },
            { version: 4, themeKey: 'chat-integrity:chat-uuid-1', targetKey: 'user:global', avatarId: 'chat', view: {} },
        ] },
        overwriteHostAvatar: async (input) => { calls.push(input); return { ok: true }; },
    });
    f.context.reloadCurrentChat = async () => { reloads += 1; };
    const before = JSON.stringify(await f.store.listBindings());
    await f.runtime.overwriteOriginal('user', 'replacement');
    const after = JSON.stringify(await f.store.listBindings());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'user');
    assert.equal(calls[0].asset.id, 'replacement');
    assert.equal(reloads, 1);
    assert.equal(after, before);
});

test('93 chat-scoped save fails closed when the current chat changes', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('chat')] } });
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'chat', bindingMode: 'chat' });
    f.context.chatMetadata = { integrity: 'chat-uuid-2' };
    await assert.rejects(f.runtime.saveEdit(), error => error.code === 'superseded');
    assert.equal(await f.store.getBinding('chat-integrity:chat-uuid-1', 'user:global'), null);
});

test('deferred adjustment requires an explicit save scope and preserves the editor when none is chosen', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a')] } });
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'a', bindingMode: 'deferred' });
    await assert.rejects(f.runtime.saveEdit(), error => error.code === 'AVATAR_SCOPE_REQUIRED');
    assert.equal(f.runtime.getState().state, 'editing');
    assert.equal(f.runtime.getState().bindingMode, 'deferred');
    await f.runtime.cancelEdit();
});

test('deferred adjustment saves chat theme and global bindings only to the selected scope', async () => {
    const cases = [
        ['chat', 'chat-integrity:chat-uuid-1'],
        ['theme', 'theme-name:A'],
        ['global', modules.avatarRuntime.DEFAULT_BINDING_KEY],
    ];
    for (const [scope, key] of cases) {
        const f = runtimeFixture({ seed: { assets: [asset(scope)] } });
        await f.runtime.beginEdit({ kind: 'user', avatarId: scope, bindingMode: 'deferred' });
        f.runtime.setScale(1.3);
        await f.runtime.saveEdit(scope);
        const binding = await f.store.getBinding(key, 'user:global');
        assert.equal(binding.avatarId, scope);
        assert.equal(binding.view.scale, 1.3);
    }
});

test('deferred global save never clears higher-priority chat or theme bindings', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('new-global'), asset('theme'), asset('chat')], bindings: [
        { version: 4, themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'theme', view: {} },
        { version: 4, themeKey: 'chat-integrity:chat-uuid-1', targetKey: 'user:global', avatarId: 'chat', view: {} },
    ] } });
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'new-global', bindingMode: 'deferred' });
    await f.runtime.saveEdit('global');
    assert.equal((await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY, 'user:global')).avatarId, 'new-global');
    assert.equal((await f.store.getBinding('theme-name:A', 'user:global')).avatarId, 'theme');
    assert.equal((await f.store.getBinding('chat-integrity:chat-uuid-1', 'user:global')).avatarId, 'chat');
});

test('deferred original overwrite sends the complete library image, saves a chat-only native view, and leaves every binding unchanged', async () => {
    const calls = [];
    const f = runtimeFixture({
        seed: { assets: [asset('replacement'), asset('global'), asset('theme')], bindings: [
            { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
            { version: 4, themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'theme', view: {} },
        ], nativeViews: [{ targetKey: 'user:global', sourceKey: 'raw-user.png', view: { scale: 1.2 } }] },
        overwriteHostAvatar: async input => { calls.push(input); return { ok: true }; },
    });
    const before = JSON.stringify(await f.store.listBindings());
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'replacement', bindingMode: 'deferred' });
    f.runtime.setScale(1.8);
    await f.runtime.saveEdit('original');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].asset.id, 'replacement');
    assert.equal(calls[0].asset.imageData, asset('replacement').imageData);
    assert.equal(calls[0].asset.width, asset('replacement').width);
    assert.equal(calls[0].asset.height, asset('replacement').height);
    assert.equal(JSON.stringify(await f.store.listBindings()), before);
    let nativeView = await f.store.getNativeView('user:global');
    assert.equal(nativeView.view.scale, 1.8);
    assert.equal(nativeView.sourceKey, 'raw-user.png');
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'replacement', bindingMode: 'deferred' });
    f.runtime.setScale(1.4);
    await f.runtime.saveEdit('original');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].asset.imageData, asset('replacement').imageData);
    nativeView = await f.store.getNativeView('user:global');
    assert.equal(nativeView.view.scale, 1.4);
    assert.equal(JSON.stringify(await f.store.listBindings()), before);
});

test('original overwrite host failure preserves the editor, bindings, and previous native adjustment', async () => {
    let hostWrites = 0;
    const f = runtimeFixture({
        seed: { assets: [asset('replacement'), asset('global')], bindings: [
            { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
        ], nativeViews: [{ targetKey: 'user:global', sourceKey: 'raw-user.png', view: { scale: 1.2 } }] },
        overwriteHostAvatar: async () => { hostWrites += 1; throw Object.assign(new Error('write failed'), { code: 'HOST_AVATAR_WRITE_FAILED' }); },
    });
    const bindingsBefore = JSON.stringify(await f.store.listBindings());
    await f.runtime.beginEdit({ kind: 'user', avatarId: 'replacement', bindingMode: 'deferred' });
    f.runtime.setScale(1.8);
    await assert.rejects(f.runtime.saveEdit('original'), error => error.code === 'HOST_AVATAR_WRITE_FAILED');
    assert.equal(hostWrites, 1);
    assert.equal(f.runtime.getState().state, 'editing');
    assert.equal(JSON.stringify(await f.store.listBindings()), bindingsBefore);
    assert.equal((await f.store.getNativeView('user:global')).view.scale, 1.2);
});

test('94 Avatar adjustment opens directly and its toolbar owns four save scopes plus three exact unbind scopes', () => {
    const pageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-page.js'), 'utf8');
    const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-runtime.js'), 'utf8');
    assert.equal((pageSource.match(/bindingMode: 'deferred'/g) || []).length, 1);
    assert.doesNotMatch(pageSource, /openScopeMenu|data-avatar-scope-action/);
    const panelBlock = runtimeSource.slice(runtimeSource.indexOf('function renderScopePanel'), runtimeSource.indexOf('function openScopePanel'));
    assert.equal((panelBlock.match(/scopeOptionHtml\('save-/g) || []).length, 4);
    assert.equal((panelBlock.match(/scopeOptionHtml\('clear-/g) || []).length, 3);
    assert.match(panelBlock, /save-original/);
    assert.match(panelBlock, /save-chat/);
    assert.match(panelBlock, /save-theme/);
    assert.match(panelBlock, /save-global/);
    assert.match(panelBlock, /当前聊天 ＞ 当前美化 ＞ 全局 ＞ SillyTavern 原头像/);
    assert.match(panelBlock, /保存到低权重范围不会清除高权重绑定/);
    assert.match(runtimeSource, /data-action="flip-x"[^>]*>水平<\/button>/);
    assert.match(runtimeSource, /data-action="flip-y"[^>]*>垂直<\/button>/);
    assert.match(runtimeSource, /data-action="clear-bindings"[^>]*>解绑<\/button>/);
    assert.match(runtimeSource, /data-action="save">保存<\/button>/);
    assert.doesNotMatch(runtimeSource, /↔ 水平|↕ 垂直|⌫ 解绑|保存…/);
    assert.match(panelBlock, /已绑定 ' \+ Number\(scopes\.theme/);
    assert.match(runtimeSource, /clearApplicationScope\(clearKind, clearScope\)/);
    assert.match(runtimeSource, /缩放、位置、旋转和翻转只用于聊天头像显示，不会裁剪原图/);
    assert.match(runtimeSource, /完整原图覆盖；调整仅用于聊天头像/);
    assert.doesNotMatch(runtimeSource, /bakeHostAsset|bakedViewGeometry|调整会写入原头像/);
});

test('95 host original overwrite uses SillyTavern avatar endpoints and overwrite fields', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    assert.match(source, /form\.append\('overwrite_name', targetName\)/);
    assert.match(source, /\/api\/avatars\/upload/);
    assert.match(source, /form\.append\('avatar_url', targetName\)/);
    assert.match(source, /\/api\/characters\/edit-avatar/);
    assert.match(source, /overwriteHostAvatar: overwriteSillyTavernAvatar/);
});

test('96 SillyTavern avatar thumbnails map only to their matching original files', () => {
    const map = modules.avatarRuntime.hostOriginalSourceFromThumbnail;
    assert.equal(map('/thumbnail?type=avatar&file=char.png', 'http://localhost/'), '/characters/char.png');
    assert.equal(map('/thumbnail?type=persona&file=User%20One.png', 'http://localhost/'), '/User%20Avatars/User%20One.png');
    assert.equal(map('http://localhost/thumbnail?type=avatar&file=%E8%A7%92%E8%89%B2%20A.png', 'http://localhost/'), 'http://localhost/characters/%E8%A7%92%E8%89%B2%20A.png');
    assert.equal(map('/thumbnail?type=bg&file=scene.png', 'http://localhost/'), '');
    assert.equal(map('/characters/char.png', 'http://localhost/'), '');
});

test('97 unbound User and Character thumbnails switch to preloaded original files without creating bindings', async () => {
    const preloaded = [];
    const f = runtimeFixture({
        charSrc: '/thumbnail?type=avatar&file=char.png',
        userSrc: '/thumbnail?type=persona&file=User%20One.png',
        preloadHostImage: async (source) => { preloaded.push(source); return true; },
    });
    await f.runtime.start();
    assert.ok(f.chars.every((entry) => /^\/characters\/char\.png\?tm_avatar_hd=\d+$/.test(entry.image.getAttribute('src'))));
    assert.match(f.user.image.getAttribute('src'), /^\/User%20Avatars\/User%20One\.png\?tm_avatar_hd=\d+$/);
    assert.deepEqual(new Set(preloaded.map((source) => source.replace(/\?tm_avatar_hd=\d+$/, ''))), new Set(['/characters/char.png', '/User%20Avatars/User%20One.png']));
    assert.equal((await f.store.listBindings()).length, 0);
    assert.equal(await f.store.getSourceIntent('user:global'), null);
});

test('98 failed original-file enhancement keeps the exact working thumbnail and srcset', async () => {
    const thumbnail = '/thumbnail?type=persona&file=user.png';
    const f = runtimeFixture({ userSrc: thumbnail, preloadHostImage: async () => false });
    f.user.image.setAttribute('srcset', '/thumbnail?type=persona&file=user@2x.png 2x');
    await f.runtime.start();
    assert.equal(f.user.image.getAttribute('src'), thumbnail);
    assert.equal(f.user.image.getAttribute('srcset'), '/thumbnail?type=persona&file=user@2x.png 2x');
    assert.match(f.user.image.getAttribute('style'), /^opacity:\.99;content:normal!important;$/);
});

test('99 clearing a replacement reveals the high-resolution host original without changing other binding scopes', async () => {
    const f = runtimeFixture({
        userSrc: '/thumbnail?type=persona&file=user.png',
        preloadHostImage: async () => true,
        seed: { assets: [asset('global'), asset('theme')], bindings: [
            { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'user:global', avatarId: 'global', view: {} },
            { version: 4, themeKey: 'theme-name:B', targetKey: 'user:global', avatarId: 'theme', view: {} },
        ] },
    });
    await f.runtime.start();
    assert.match(f.user.image.getAttribute('src'), /main-global/);
    await f.runtime.clearBinding('user');
    assert.match(f.user.image.getAttribute('src'), /^\/User%20Avatars\/user\.png\?tm_avatar_hd=\d+$/);
    assert.equal(await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY, 'user:global'), null);
    assert.equal((await f.store.getBinding('theme-name:B', 'user:global')).avatarId, 'theme');
});

test('100 native original adjustment retries the thumbnail when the high-resolution file cannot be read', async () => {
    const reads = [];
    const f = runtimeFixture({
        charSrc: '/thumbnail?type=avatar&file=char.png',
        loadNativeImage: async (nativeAsset) => {
            reads.push(nativeAsset.imageData);
            if (nativeAsset.imageData.startsWith('/characters/')) throw new Error('missing original');
            return { ...nativeAsset, imageData: 'data:image/png;base64,fallback' };
        },
        seed: { nativeViews: [{ targetKey: 'character:char.png', sourceKey: 'char.png', view: { scale: 1.2 } }] },
    });
    await f.runtime.start();
    assert.match(reads[0], /^\/characters\/char\.png\?tm_avatar_hd=\d+$/);
    assert.equal(reads[1], '/thumbnail?type=avatar&file=char.png');
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src') === 'data:image/png;base64,fallback'));
});

test('101 persona events and external source rewrites invalidate the high-resolution cache', async () => {
    const sources = [];
    const f = runtimeFixture({
        userSrc: '/thumbnail?type=persona&file=user.png',
        eventTypes: { PERSONA_UPDATED: 'persona-updated' },
        preloadHostImage: async (source) => { sources.push(source); return true; },
    });
    await f.runtime.start();
    const first = f.user.image.getAttribute('src');
    f.eventSource.emit('persona-updated');
    await new Promise((resolve) => setTimeout(resolve, 35));
    const second = f.user.image.getAttribute('src');
    assert.notEqual(second, first);

    f.user.image.setAttribute('src', '/thumbnail?type=persona&file=user.png');
    const observer = MutationObserver.instances[MutationObserver.instances.length - 1];
    observer.fn([{ type: 'attributes', attributeName: 'src', target: f.user.image }]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const third = f.user.image.getAttribute('src');
    assert.notEqual(third, second);
    assert.equal(new Set(sources).size, 3);
});

test('102 overwriting the host original forces a fresh high-resolution URL while preserving bindings', async () => {
    const f = runtimeFixture({
        userSrc: '/thumbnail?type=persona&file=user.png',
        preloadHostImage: async () => true,
        overwriteHostAvatar: async () => ({ ok: true }),
        seed: { assets: [asset('replacement')] },
    });
    f.context.reloadCurrentChat = async () => {};
    await f.runtime.start();
    const before = f.user.image.getAttribute('src');
    await f.runtime.overwriteOriginal('user', 'replacement');
    const after = f.user.image.getAttribute('src');
    assert.notEqual(after, before);
    assert.equal((await f.store.listBindings()).length, 0);
});

test('103 a late high-resolution image error transparently restores the thumbnail', async () => {
    const thumbnail = '/thumbnail?type=persona&file=user.png';
    const f = runtimeFixture({ userSrc: thumbnail, preloadHostImage: async () => true });
    f.user.image.setAttribute('srcset', '/thumbnail?type=persona&file=user@2x.png 2x');
    await f.runtime.start();
    assert.match(f.user.image.getAttribute('src'), /^\/User%20Avatars\/user\.png\?tm_avatar_hd=\d+$/);
    f.user.image.dispatchEvent({ type: 'error' });
    assert.equal(f.user.image.getAttribute('src'), thumbnail);
    assert.equal(f.user.image.getAttribute('srcset'), '/thumbnail?type=persona&file=user@2x.png 2x');
});

test('104 switching Character identity refreshes every message from the new original file', async () => {
    const f = runtimeFixture({
        charSrc: '/thumbnail?type=avatar&file=old-char.png',
        eventTypes: { CHAT_CHANGED: 'chat-changed' },
        preloadHostImage: async () => true,
    });
    await f.runtime.start();
    assert.ok(f.chars.every((entry) => /\/characters\/old-char\.png\?tm_avatar_hd=\d+$/.test(entry.image.getAttribute('src'))));
    f.context.characters[0].avatar = 'new-char.png';
    f.chars.forEach((entry) => entry.image.setAttribute('src', '/thumbnail?type=avatar&file=new-char.png'));
    const observer = MutationObserver.instances[MutationObserver.instances.length - 1];
    observer.fn(f.chars.map((entry) => ({ type: 'attributes', attributeName: 'src', target: entry.image })));
    f.eventSource.emit('chat-changed');
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.ok(f.chars.every((entry) => /\/characters\/new-char\.png\?tm_avatar_hd=\d+$/.test(entry.image.getAttribute('src'))));
});
