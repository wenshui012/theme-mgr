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
    const context = vm.createContext(window);
    ['image-tools.js', 'avatar-storage.js', 'avatar-image-tools.js', 'avatar-runtime.js', 'avatar-page.js'].forEach((name) => {
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

const baseWindow = { indexedDB: null };
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

class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((x) => x !== fn)); }
    dispatchEvent(event) { event.target ||= this; event.preventDefault ||= () => { event.defaultPrevented = true; }; event.stopImmediatePropagation ||= () => {}; for (const fn of [...(this.listeners.get(event.type) || [])]) fn(event); return !event.defaultPrevented; }
}
class Classes {
    constructor() { this.values = new Set(); }
    add(...v) { v.forEach((x) => this.values.add(x)); }
    remove(...v) { v.forEach((x) => this.values.delete(x)); }
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
        this.attributes = {}; this.classList = new Classes(); this.rect = { ...rect }; this.animations = []; this.id = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this._html = '';
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
    setPointerCapture() {}
    releasePointerCapture() {}
    get isConnected() { let node = this; while (node) { if (node._root) return true; node = node.parentElement; } return false; }
    set innerHTML(value) { this._html = String(value); if (this._html.includes('tm-avatar-editor-scale')) { const scale = new Element('span'); scale.classList.add('tm-avatar-editor-scale'); this.appendChild(scale); } }
    get innerHTML() { return this._html; }
    closest(selector) { if (selector === '[data-action]' && this.getAttribute('data-action')) return this; return null; }
}
class MutationObserver { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} }
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
    const chars = [message('character', options.charRect || { x: 30, y: 100, width: 100, height: 100 }, 'raw-char.png'), message('character', options.charRect2 || { x: 30, y: 230, width: 50, height: 50 }, 'raw-char.png')];
    const user = message('user', { x: 500, y: 100, width: 80, height: 80 }, 'raw-user.png');
    [...chars, user].forEach((x) => chat.appendChild(x.mes));
    let theme = options.theme || 'A';
    const eventSource = { on() {}, removeListener() {} };
    const context = options.context || { characters: [{ avatar: 'char.png', name: 'Char' }], characterId: 0, groupId: null, name1: 'User', eventSource, eventTypes: {} };
    const win = { document: doc, innerWidth: 800, innerHeight: 600, MutationObserver, setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(), getComputedStyle: (el) => el.computed, confirm: () => true };
    const mods = loadModules(win); const bundle = memoryStore(options.seed); const runtime = mods.createAvatarRuntime({ window: win, document: doc, store: bundle.store, getContext: () => context, getThemeName: () => theme });
    return { win, doc, chat, chars, user, context, store: bundle.store, runtime, mods, setTheme: (x) => { theme = x; } };
}

class PageRoot extends Events {
    constructor() { super(); this.grid = new Element('div'); this.notice = new Element('div'); this.actions = new Element('div'); this.selected = new Element('div'); this.tools = new Element('div'); this.input = new Element('input'); this.buttons = {}; ['apply-character','apply-user','restore-character','restore-user'].forEach((x) => this.buttons[x] = new Element('button')); }
    querySelector(s) { if (s === '[data-avatar-grid]') return this.grid; if (s === '[data-avatar-notice]') return this.notice; if (s === '[data-avatar-actions]') return this.actions; if (s === '[data-avatar-selected]') return this.selected; if (s === '[data-avatar-tools]') return this.tools; if (s === '[data-avatar-file]') return this.input; const m=s.match(/data-avatar-action="([^"]+)/); return m ? this.buttons[m[1]] : null; }
    querySelectorAll() { return []; }
    contains() { return true; }
}
function pageFixture(seed = [], bindings = []) {
    const doc = new Document(); const pageRoot = new PageRoot(); doc.pageRoot = pageRoot;
    const { store } = memoryStore({ assets: seed, bindings }); let disconnected = 0; let observed = 0;
    const imageLoader = { PLACEHOLDER_SRC: 'placeholder', createImageLoader: () => ({ observe: () => { observed++; }, disconnect: () => { disconnected++; } }) };
    const runtime = { getCapabilities: () => ({ themeKey: 'theme-name:A', character: { available: true, target: { key: 'character:c' } }, user: { available: true, target: { key: 'user:global' } } }), notifyAssetChanged: async () => {}, deleteAsset: (id) => store.deleteAsset(id), clearBinding: async () => {}, beginEdit: async () => {} };
    const win = { document: doc, confirm: () => true }; const mods = loadModules(win);
    const processor = { processFile: async (file) => asset(file.name) };
    const page = mods.createAvatarPage({ document: doc, store, processor, runtime, imageLoader, getRoot: () => pageRoot, closeManager() {}, toast() {}, confirm: () => true });
    return { page, doc, pageRoot, store, stats: () => ({ disconnected, observed }) };
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
test('23 Cancel restores the previous binding rather than raw avatar', async () => { const f=runtimeFixture({seed:{assets:[asset('a'),asset('b')],bindings:[{themeKey:'theme-name:A',targetKey:'character:char.png',avatarId:'a',view:{x:.1,y:.1,scale:1}}]}}); await f.runtime.start(); await f.runtime.beginEdit({kind:'character',avatarId:'b'}); await f.runtime.cancelEdit(); assert.ok(f.chars.every((x)=>x.image.getAttribute('src').includes('main-a'))); });
test('24 Save persists the formal default binding', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'user',avatarId:'a'}); const result=await f.runtime.saveEdit(); assert.equal(result.binding.avatarId,'a'); assert.equal((await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY,'user:global')).avatarId,'a'); });
test('25 normalized view yields proportionate pixels across avatar sizes', () => { assert.deepEqual({ ...modules.avatarRuntime.pixelsForView({x:.2,y:.1,scale:1.5},{getBoundingClientRect:()=>({x:0,y:0,width:50,height:80,left:0,top:0,right:50,bottom:80})}) },{x:10,y:8,scale:1.5}); });
test('26 theme transform and avatar box stay fixed while only image content is cropped', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); const beforeTransform=f.chars[0].image.computed.transform; const beforeRect=f.chars[0].image.getBoundingClientRect(); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); f.runtime.setScale(1.5); assert.equal(f.chars[0].image.computed.transform,beforeTransform); assert.deepEqual(f.chars[0].image.getBoundingClientRect(),beforeRect); assert.match(f.chars[0].image.getAttribute('style'),/object-view-box:inset\(/); assert.equal(f.chars[0].image.animations.length,0); });
test('27 mask and clip properties are not rewritten', async () => { const f=runtimeFixture({seed:{assets:[asset()]}}); await f.runtime.beginEdit({kind:'character',avatarId:'a'}); assert.equal(f.chars[0].image.computed.clipPath,'circle(48%)'); assert.equal(f.chars[0].image.computed.maskImage,'url(mask.png)'); });
test('28 a newly rendered message is reapplied on reconcile', async () => { const f=runtimeFixture({seed:{assets:[asset()],bindings:[{themeKey:'theme-name:A',targetKey:'character:char.png',avatarId:'a',view:{}}]}}); await f.runtime.start(); const next=message('character',{x:20,y:350,width:60,height:60},'raw-new'); f.chat.appendChild(next.mes); await f.runtime.reconcile(); assert.match(next.image.getAttribute('src'),/main-a/); });
test('29 a fresh runtime restores persisted bindings after reload', async () => { const seed={assets:[asset()],bindings:[{themeKey:'theme-name:A',targetKey:'user:global',avatarId:'a',view:{}}]}; const f=runtimeFixture({seed}); await f.runtime.start(); assert.match(f.user.image.getAttribute('src'),/main-a/); });
test('30 a promoted default avatar keeps the same normalized crop across theme switches', async () => { const f=runtimeFixture({seed:{assets:[asset()],bindings:[{themeKey:'theme-name:A',targetKey:'user:global',avatarId:'a',view:{x:.1}}]}}); await f.runtime.start(); const a=f.user.image.getAttribute('style'); f.setTheme('B'); await f.runtime.reconcile(); const b=f.user.image.getAttribute('style'); const expected=modules.avatarRuntime.objectViewBoxForView({x:.1}); assert.ok(a.includes(expected)); assert.ok(b.includes(expected)); });
test('31 switching to a theme without an explicit avatar keeps the default avatar', async () => { const f=runtimeFixture({seed:{assets:[asset()],bindings:[{themeKey:'theme-name:A',targetKey:'user:global',avatarId:'a',view:{}}]}}); await f.runtime.start(); f.setTheme('B'); await f.runtime.reconcile(); assert.match(f.user.image.getAttribute('src'),/main-a/); assert.ok(await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY,'user:global')); });
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
test('44 avatar cards are image-only and expose a three-dot menu instead of delete', async () => {
    const f = pageFixture([asset('1000116691')]);
    await f.page.mount();
    assert.match(f.pageRoot.grid.innerHTML, /data-avatar-action="menu"/);
    assert.match(f.pageRoot.grid.innerHTML, /fa-ellipsis/);
    assert.match(f.pageRoot.grid.innerHTML, /data-avatar-action="view"/);
    assert.doesNotMatch(f.pageRoot.grid.innerHTML, /tm-avatar-page-name|fa-trash/);
    assert.doesNotMatch(modules.avatarPage.styleText(), /\.tm-avatar-page-menu\{/);
});
test('45 shared header owns the only Avatar add entry and remembers the last app page', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    assert.match(source, /id="tm-avatar-add"/);
    assert.match(source, /avatarPageController\.pickFiles\(\)/);
    assert.match(source, /defaultPage: lastAppPage/);
    assert.match(source, /lastAppPage = appShellController\.getActivePage\(\)/);
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
    assert.match(source, /requestAnimationFrame/);
    assert.match(source, /ensureSourceCache/);
});
test('47 editing either target preserves the other target binding', async () => {
    const f = runtimeFixture({ seed: { assets: [asset('a'), asset('b')], bindings: [
        { themeKey: 'theme-name:A', targetKey: 'character:char.png', avatarId: 'a', view: {} },
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'b', view: {} },
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
        { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} },
        { themeKey: 'theme-name:B', targetKey: 'user:global', avatarId: 'a', view: {} },
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
test('52 saving native character adjustment clears replacement binding and restores the original source with crop', async () => {
    const f = runtimeFixture({ seed: { assets: [asset()], bindings: [
        { themeKey: modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey: 'character:char.png', avatarId: 'a', view: {} },
    ] } });
    await f.runtime.start();
    await f.runtime.beginNativeEdit();
    f.runtime.setScale(1.35);
    const result = await f.runtime.saveEdit();
    const stored = await f.store.getNativeView('character:char.png');
    assert.equal(result.nativeView.view.scale, 1.35);
    assert.equal(stored.sourceKey, 'char.png');
    assert.equal(await f.store.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY, 'character:char.png'), null);
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('src').includes('raw-char.png')));
    assert.ok(f.chars.every((entry) => entry.image.getAttribute('style').includes('object-view-box:inset(')));
});
test('53 persisted native character adjustment reapplies after reload and across theme changes', async () => {
    const f = runtimeFixture({ seed: { nativeViews: [
        { targetKey: 'character:char.png', sourceKey: 'char.png', view: { x: .15, y: -.1, scale: 1.2 } },
    ] } });
    await f.runtime.start();
    const first = f.chars[0].image.getAttribute('style');
    assert.ok(first.includes(modules.avatarRuntime.objectViewBoxForView({ x: .15, y: -.1, scale: 1.2 })));
    f.setTheme('B');
    await f.runtime.reconcile();
    assert.ok(f.chars[0].image.getAttribute('style').includes(modules.avatarRuntime.objectViewBoxForView({ x: .15, y: -.1, scale: 1.2 })));
    assert.ok(first.includes(modules.avatarRuntime.objectViewBoxForView({ x: .15, y: -.1, scale: 1.2 })));
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
test('55 Avatar Page includes a themed current-character original-avatar adjustment entry', () => {
    const html = modules.avatarPage.buildPageHtml('placeholder');
    const css = modules.avatarPage.styleText();
    assert.match(html, /data-avatar-native-bar/);
    assert.match(html, /data-avatar-action="adjust-native"/);
    assert.match(html, /调整原头像/);
    assert.match(css, /SmartThemeQuoteColor/);
});
