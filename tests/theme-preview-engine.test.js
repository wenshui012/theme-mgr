const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.ThemeMgrModules = {};
require('../src/theme-appearance.js');
require('../src/theme-preview-engine.js');

const engine = global.ThemeMgrModules.themePreviewEngine;

class FakeStyleDeclaration {
    constructor(initial) { Object.assign(this, initial || {}); this._custom = Object.create(null); }
    getPropertyValue(name) { return this._custom[name] || ''; }
    setProperty(name, value) { this._custom[name] = String(value); }
}

class FakeElement {
    constructor(tagName, computed) {
        this.tagName = String(tagName || 'div').toUpperCase();
        this.nodeType = 1;
        this.children = [];
        this.parentNode = null;
        this.style = new FakeStyleDeclaration();
        this._computed = new FakeStyleDeclaration(Object.assign({
            display: 'block',
            visibility: 'visible',
            content: 'none',
            backgroundImage: 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundColor: 'transparent',
            color: 'rgb(238, 238, 240)',
            border: '0px none rgba(0, 0, 0, 0)',
            borderRadius: '0px',
            boxShadow: 'none',
            backdropFilter: 'none',
            padding: '0px',
            width: '58px',
            height: '58px',
            fontFamily: 'Test Sans',
            fontSize: '16px',
            fontWeight: '400',
            clipPath: 'none',
            maskImage: 'none',
            webkitMaskImage: 'none',
            maskSize: 'cover',
            maskPosition: 'center',
            maskRepeat: 'no-repeat',
            objectFit: 'cover',
            objectPosition: 'center',
            transform: 'none',
            mixBlendMode: 'normal',
            filter: 'none',
            opacity: '1',
        }, computed || {}));
        this._pseudo = Object.create(null);
        this._queries = Object.create(null);
        this.attributes = Object.create(null);
        this.className = '';
        this.textContent = '';
        this.value = '';
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; return child; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    attachShadow() { this.shadowRoot = new FakeElement('shadow-root'); this.shadowRoot.nodeType = 11; return this.shadowRoot; }
    querySelector(selector) { return this._queries[selector] || null; }
    querySelectorAll(selector) {
        if (selector !== 'img') return [];
        const found = [];
        const visit = (node) => {
            if (node.tagName === 'IMG') found.push(node);
            node.children.forEach(visit);
        };
        visit(this);
        return found;
    }
    getBoundingClientRect() {
        return { width: parseFloat(this._computed.width) || 0, height: parseFloat(this._computed.height) || 0 };
    }
    get outerHTML() {
        const tag = this.tagName.toLowerCase();
        const attrs = this.className ? ` class="${this.className}"` : '';
        return `<${tag}${attrs}>${this.textContent}${this.children.map((child) => child.outerHTML).join('')}</${tag}>`;
    }
}

function createFixture(overrides) {
    overrides = overrides || {};
    const root = new FakeElement('html');
    root._computed._custom = Object.assign(Object.create(null), {
        '--SmartThemeBodyColor': 'rgb(238, 238, 240)',
        '--SmartThemeQuoteColor': 'rgb(150, 120, 220)',
        '--SmartThemeBlurTintColor': 'rgba(18, 20, 27, 0.86)',
        '--SmartThemeChatTintColor': 'rgba(28, 31, 42, 0.82)',
        '--SmartThemeUserMesBlurTintColor': 'rgba(50, 42, 72, 0.78)',
        '--SmartThemeBotMesBlurTintColor': 'rgba(30, 34, 46, 0.78)',
        '--SmartThemeBorderColor': 'rgba(255, 255, 255, 0.18)',
        '--SmartThemeShadowColor': 'rgba(0, 0, 0, 0.35)',
    });
    const body = new FakeElement('body', { backgroundColor: 'rgb(18, 20, 27)', color: 'rgb(238, 238, 240)' });
    const bg = new FakeElement('div', {
        backgroundImage: overrides.backgroundImage === undefined ? 'url("data:image/png;base64,AAAA")' : overrides.backgroundImage,
        backgroundSize: 'cover',
        backgroundPosition: '50% 40%',
        backgroundRepeat: 'no-repeat',
    });
    const character = new FakeElement('div', { backgroundColor: 'rgba(30, 34, 46, 0.78)', border: '1px solid rgba(255,255,255,.18)', borderRadius: '14px', boxShadow: '0 6px 20px rgba(0,0,0,.25)', padding: '16px' });
    const user = new FakeElement('div', { backgroundColor: 'rgba(50, 42, 72, 0.78)', borderRadius: '18px', padding: '15px' });
    const messageText = new FakeElement('div', { fontFamily: 'Example Serif', fontSize: '17px', fontWeight: '450' });
    const avatar = new FakeElement('div', { width: '64px', height: '72px' });
    const avatarImage = new FakeElement('img', Object.assign({ width: '64px', height: '72px', borderRadius: '50%', clipPath: 'circle(48%)', objectPosition: '40% 50%' }, overrides.avatarStyle || {}));
    avatar._queries.img = avatarImage;
    if (overrides.frame !== false) avatar._pseudo['::after'] = new FakeStyleDeclaration(Object.assign({}, avatar._computed, { content: 'url("data:image/png;base64,FRAME")', backgroundImage: 'none', opacity: '.9' }));
    character._queries['.avatar'] = avatar;
    const top = new FakeElement('header', { backgroundColor: 'rgba(24, 25, 34, .9)', border: '1px solid rgba(255,255,255,.12)', borderRadius: '12px' });
    const input = new FakeElement('form', { backgroundColor: 'rgba(24, 25, 34, .9)', border: '1px solid rgba(255,255,255,.12)', borderRadius: '16px', padding: '12px' });
    const themes = new FakeElement('select');
    themes.value = 'Fixture Theme';
    const selectorMap = {
        '#chat .mes:not([is_user="true"]):not(.smallSysMes)': character,
        '#chat .mes[is_user="true"]': user,
        '#chat .mes_text': messageText,
        '#top-settings-holder': top,
        '#send_form': input,
    };
    const ids = { bg1: bg, themes: themes };
    const doc = {
        documentElement: root,
        body,
        baseURI: 'https://example.test/app/',
        fonts: { ready: Promise.resolve() },
        createElement(tag) { return new FakeElement(tag); },
        querySelector(selector) { return selectorMap[selector] || null; },
        getElementById(id) { return ids[id] || null; },
    };
    const win = {
        document: doc,
        getComputedStyle(element, pseudo) { return pseudo ? (element._pseudo[pseudo] || new FakeStyleDeclaration({ display: 'block', visibility: 'visible', content: 'none', backgroundImage: 'none' })) : element._computed; },
        requestAnimationFrame(callback) { callback(); },
        Blob,
        URL,
        power_user: { theme: 'Fixture Theme' },
    };
    return { doc, win, elements: { root, body, bg, character, user, messageText, avatar, avatarImage, top, input } };
}

test('profile is JSON-serializable pure data', () => {
    const fixture = createFixture();
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    assert.deepEqual(JSON.parse(JSON.stringify(profile)), profile);
    assert.equal(profile.version, 1);
});

test('profile contains no DOM references or functions', () => {
    const fixture = createFixture();
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    const values = [];
    (function visit(value) {
        if (!value || typeof value !== 'object') { values.push(value); return; }
        values.push(value);
        Object.values(value).forEach(visit);
    })(profile);
    assert.equal(values.some((value) => value && value.nodeType), false);
    assert.equal(values.some((value) => typeof value === 'function'), false);
});

test('missing real theme elements use safe fallbacks', () => {
    const fixture = createFixture({ frame: false, backgroundImage: 'none' });
    fixture.doc.querySelector = () => null;
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    assert.equal(profile.messages.character.borderRadius, '10px');
    assert.equal(profile.avatar.width, '58px');
    assert.equal(profile.avatar.frame, null);
});

test('missing avatar frame remains null', () => {
    const fixture = createFixture({ frame: false });
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    assert.equal(profile.avatar.frame, null);
});

test('missing background image remains none', () => {
    const fixture = createFixture({ backgroundImage: 'none' });
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    assert.equal(profile.background.image, 'none');
});

test('background image and placement are extracted', () => {
    const fixture = createFixture({ backgroundImage: 'url("/assets/theme-bg.png")' });
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    assert.equal(profile.background.image, 'url("/assets/theme-bg.png")');
    assert.equal(profile.background.position, '50% 40%');
});

test('avatar radius, clip and mask are extracted', () => {
    const fixture = createFixture({ avatarStyle: { borderRadius: '22px', clipPath: 'polygon(50% 0%, 100% 100%, 0 100%)', webkitMaskImage: 'url("data:image/png;base64,MASK")' } });
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    assert.equal(profile.avatar.borderRadius, '22px');
    assert.match(profile.avatar.clipPath, /^polygon/);
    assert.match(profile.avatar.maskImage, /^url/);
});

test('preview stage is created with fixed logical dimensions', () => {
    const fixture = createFixture();
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    const handle = engine.createStage(profile, { document: fixture.doc });
    assert.equal(handle.width, 390);
    assert.equal(handle.height, 700);
    assert.equal(fixture.doc.body.children.includes(handle.host), true);
    handle.destroy();
});

test('preview stage destroy removes its host and is idempotent', () => {
    const fixture = createFixture();
    const handle = engine.createStage(engine.createProfile({ window: fixture.win, document: fixture.doc }), { document: fixture.doc });
    handle.destroy();
    handle.destroy();
    assert.equal(fixture.doc.body.children.includes(handle.host), false);
    assert.equal(engine.getDiagnostics().activeStages, 0);
});

test('repeated create and destroy leaves no active stages', () => {
    const fixture = createFixture();
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    for (let i = 0; i < 20; i++) engine.createStage(profile, { document: fixture.doc }).destroy();
    assert.equal(engine.getDiagnostics().activeStages, 0);
    assert.equal(fixture.doc.body.children.length, 0);
});

test('screenshot failure safely returns a structured error', async () => {
    const result = await engine.captureStage(null, {});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'stage-unavailable');
});

test('profile extraction does not modify current theme styles', () => {
    const fixture = createFixture();
    const before = JSON.stringify(fixture.elements.root.style._custom);
    engine.createProfile({ window: fixture.win, document: fixture.doc });
    assert.equal(JSON.stringify(fixture.elements.root.style._custom), before);
    assert.equal(fixture.win.power_user.theme, 'Fixture Theme');
});

test('PoC does not read or modify theme metadata image fields', () => {
    const fixture = createFixture();
    const sentinel = { themeMeta: { A: { imageData: 'original', thumbData: 'thumb' } } };
    const before = JSON.stringify(sentinel);
    engine.createProfile({ window: fixture.win, document: fixture.doc, storage: sentinel });
    assert.equal(JSON.stringify(sentinel), before);
});

test('data URL assets need no backend or fetch', async () => {
    const fixture = createFixture();
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    let fetchCount = 0;
    const result = await engine.normalizeProfileAssets(profile, { window: fixture.win, document: fixture.doc, fetch() { fetchCount++; throw new Error('unexpected'); } });
    assert.equal(result.failures.length, 0);
    assert.equal(fetchCount, 0);
});

test('same-origin asset is normalized to a data URL', async () => {
    const fixture = createFixture({ backgroundImage: 'url("/assets/theme-bg.png")' });
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    const result = await engine.normalizeProfileAssets(profile, {
        window: fixture.win,
        document: fixture.doc,
        fetch(url) {
            assert.equal(url, 'https://example.test/assets/theme-bg.png');
            return Promise.resolve({ ok: true, blob: () => Promise.resolve({}) });
        },
        blobToDataUrl() { return Promise.resolve('data:image/png;base64,NORMALIZED'); },
    });
    assert.equal(result.failures.length, 0);
    assert.equal(result.normalizedCount, 1);
    assert.match(result.profile.background.image, /NORMALIZED/);
});

test('cross-origin normalization failure is explicit and non-mutating', async () => {
    const fixture = createFixture({ backgroundImage: 'url("https://blocked.invalid/bg.png")' });
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    const before = JSON.stringify(profile);
    const result = await engine.normalizeProfileAssets(profile, {
        window: fixture.win,
        document: fixture.doc,
        fetch() { return Promise.reject(new Error('CORS blocked')); },
    });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /CORS/);
    assert.equal(JSON.stringify(profile), before);
});

test('document-fragment image references fail instead of fetching the current page as an image', async () => {
    const fixture = createFixture({ avatarStyle: { webkitMaskImage: 'url("#avatar-mask")' } });
    const profile = engine.createProfile({ window: fixture.win, document: fixture.doc });
    let fetchCount = 0;
    const result = await engine.normalizeProfileAssets(profile, {
        window: fixture.win,
        document: fixture.doc,
        fetch() { fetchCount++; return Promise.resolve({ ok: true }); },
    });
    assert.equal(fetchCount, 0);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /document-fragment/);
});

test('settle waits for fonts and two animation frames without a fixed one-second sleep', async () => {
    const fixture = createFixture();
    let frames = 0;
    fixture.win.requestAnimationFrame = (callback) => { frames++; callback(); };
    await engine.settleStage({ stage: new FakeElement('div') }, { window: fixture.win, document: fixture.doc, timeoutMs: 100 });
    assert.equal(frames, 2);
});
