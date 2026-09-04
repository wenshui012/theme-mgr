const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.ThemeMgrModules = {};
require('../src/app-shell.js');

const appShell = global.ThemeMgrModules.appShell;
const pageDefinitions = [
    { id: 'themes', label: '美化', icon: 'fa-palette', html: '<div id="theme-content"></div>' },
    { id: 'avatars', label: '头像', icon: 'fa-user', html: '<p>avatar placeholder</p>' },
    { id: 'backgrounds', label: '背景', icon: 'fa-image', html: '<p>background placeholder</p>' },
];

class FakeClassList {
    constructor() { this.values = new Set(); }
    toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
    }
    contains(name) { return this.values.has(name); }
}

class FakeNode {
    constructor(attributes) {
        this.attributes = Object.assign({}, attributes || {});
        this.classList = new FakeClassList();
        this.hidden = false;
        this.listeners = Object.create(null);
        this.focusCount = 0;
    }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }
    removeEventListener(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler);
    }
    dispatch(type, target, overrides) {
        const event = Object.assign({
            type,
            target,
            key: '',
            prevented: false,
            preventDefault() { this.prevented = true; },
        }, overrides || {});
        (this.listeners[type] || []).slice().forEach((handler) => handler(event));
        return event;
    }
    closest(selector) {
        if (selector === '[data-tm-page-target]' && this.getAttribute('data-tm-page-target')) return this;
        return null;
    }
    focus() { this.focusCount += 1; }
}

function createHarness(callbacks) {
    const buttons = pageDefinitions.map((page) => new FakeNode({ 'data-tm-page-target': page.id }));
    const panels = pageDefinitions.map((page) => new FakeNode({ 'data-tm-page': page.id }));
    const nav = new FakeNode({ 'data-tm-primary-nav': '' });
    nav.contains = (node) => buttons.includes(node);
    const root = new FakeNode();
    root.querySelectorAll = (selector) => {
        if (selector === '[data-tm-page-target]') return buttons;
        if (selector === '[data-tm-page]') return panels;
        return [];
    };
    root.querySelector = (selector) => {
        if (selector === '[data-tm-primary-nav]') return nav;
        const match = selector.match(/^\[data-tm-page-target="([a-z-]+)"\]$/);
        return match ? buttons.find((button) => button.getAttribute('data-tm-page-target') === match[1]) : null;
    };
    const controller = appShell.createAppShell(Object.assign({
        root,
        pages: pageDefinitions,
        defaultPage: 'themes',
    }, callbacks || {}));
    return { root, nav, buttons, panels, controller };
}

test('page registry rejects invalid and duplicate ids without creating business data', () => {
    const pages = appShell.normalizePages([
        { id: 'themes', label: '美化' },
        { id: 'themes', label: '重复' },
        { id: '../bad', label: '错误' },
        { id: 'avatars', label: '头像' },
    ]);
    assert.deepEqual(pages.map((page) => page.id), ['themes', 'avatars']);
    assert.equal(Object.prototype.hasOwnProperty.call(pages[0], 'data'), false);
});

test('missing or invalid active page falls back to themes', () => {
    assert.equal(appShell.normalizePageId(undefined, pageDefinitions, 'themes'), 'themes');
    assert.equal(appShell.normalizePageId('unknown', pageDefinitions, 'themes'), 'themes');
});

test('shell markup contains exactly three primary navigation buttons and page containers', () => {
    const html = appShell.buildShellHtml({ pages: pageDefinitions, defaultPage: 'themes' });
    assert.equal((html.match(/data-tm-page-target=/g) || []).length, 3);
    assert.equal((html.match(/data-tm-page=/g) || []).length, 3);
    assert.match(html, />美化<\/span>/);
    assert.match(html, />头像<\/span>/);
    assert.match(html, />背景<\/span>/);
});

test('themes is the accessible default tab and panel', () => {
    const html = appShell.buildShellHtml({ pages: pageDefinitions });
    assert.match(html, /data-tm-page-target="themes"[^>]*aria-selected="true"[^>]*aria-current="page"/);
    assert.doesNotMatch(html, /id="tm-page-themes"[^>]*hidden/);
    assert.match(html, /id="tm-page-avatars"[^>]*hidden/);
});

test('shell markup does not create a popup root or avatar/background actions', () => {
    const html = appShell.buildShellHtml({ pages: pageDefinitions });
    assert.doesNotMatch(html, /tm-popup-slot/);
    assert.doesNotMatch(html, /upload|上传|导入/);
});

test('controller initializes themes without firing mount lifecycle twice', () => {
    let changes = 0;
    const harness = createHarness({ onChange() { changes += 1; } });
    assert.equal(harness.controller.getActivePage(), 'themes');
    assert.equal(harness.root.getAttribute('data-tm-active-page'), 'themes');
    assert.equal(changes, 0);
});

test('clicking avatars switches to the avatar placeholder and unmounts themes once', () => {
    const events = [];
    const pages = pageDefinitions.map((page) => Object.assign({}, page, {
        mount: () => events.push(`mount:${page.id}`),
        unmount: () => events.push(`unmount:${page.id}`),
    }));
    const harness = createHarness({ pages });
    harness.nav.dispatch('click', harness.buttons[1]);
    assert.equal(harness.controller.getActivePage(), 'avatars');
    assert.deepEqual(events, ['unmount:themes', 'mount:avatars']);
});

test('backgrounds can switch back to a freshly mounted themes page', () => {
    const events = [];
    const pages = pageDefinitions.map((page) => Object.assign({}, page, {
        mount: () => events.push(`mount:${page.id}`),
        unmount: () => events.push(`unmount:${page.id}`),
    }));
    const harness = createHarness({ pages });
    harness.nav.dispatch('click', harness.buttons[2]);
    harness.nav.dispatch('click', harness.buttons[0]);
    assert.equal(harness.controller.getActivePage(), 'themes');
    assert.deepEqual(events, ['unmount:themes', 'mount:backgrounds', 'unmount:backgrounds', 'mount:themes']);
});

test('active state, aria state, tabindex and panel visibility stay synchronized', () => {
    const harness = createHarness();
    harness.nav.dispatch('click', harness.buttons[2]);
    assert.equal(harness.buttons[2].getAttribute('aria-selected'), 'true');
    assert.equal(harness.buttons[2].getAttribute('aria-current'), 'page');
    assert.equal(harness.buttons[2].getAttribute('tabindex'), '0');
    assert.equal(harness.panels[2].hidden, false);
    assert.equal(harness.buttons[0].getAttribute('aria-selected'), 'false');
    assert.equal(harness.buttons[0].getAttribute('aria-current'), null);
    assert.equal(harness.panels[0].hidden, true);
});

test('reselecting the current page does not repeat lifecycle callbacks', () => {
    let changes = 0;
    const harness = createHarness({ onChange() { changes += 1; } });
    harness.nav.dispatch('click', harness.buttons[0]);
    harness.nav.dispatch('click', harness.buttons[0]);
    assert.equal(changes, 0);
});

test('a shared popup close guard can veto navigation', () => {
    const harness = createHarness({ beforeChange() { return false; } });
    harness.nav.dispatch('click', harness.buttons[1]);
    assert.equal(harness.controller.getActivePage(), 'themes');
    assert.equal(harness.buttons[0].getAttribute('aria-selected'), 'true');
});

test('arrow, home and end keys navigate and focus tabs', () => {
    const harness = createHarness();
    const right = harness.nav.dispatch('keydown', harness.buttons[0], { key: 'ArrowRight' });
    assert.equal(harness.controller.getActivePage(), 'avatars');
    assert.equal(harness.buttons[1].focusCount, 1);
    assert.equal(right.prevented, true);
    harness.nav.dispatch('keydown', harness.buttons[1], { key: 'End' });
    assert.equal(harness.controller.getActivePage(), 'backgrounds');
    harness.nav.dispatch('keydown', harness.buttons[2], { key: 'Home' });
    assert.equal(harness.controller.getActivePage(), 'themes');
});

test('destroy removes navigation listeners so reopen can bind exactly once', () => {
    let changes = 0;
    const harness = createHarness({ onChange() { changes += 1; } });
    harness.controller.destroy();
    harness.nav.dispatch('click', harness.buttons[1]);
    assert.equal(harness.controller.getActivePage(), 'themes');
    assert.equal(changes, 0);
    assert.equal((harness.nav.listeners.click || []).length, 0);
    assert.equal((harness.nav.listeners.keydown || []).length, 0);
});
