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
    add(name) { this.values.add(name); }
    remove(name) { this.values.delete(name); }
    toggle(name, enabled) {
        if (enabled) this.add(name);
        else this.remove(name);
    }
    contains(name) { return this.values.has(name); }
}

class FakeNode {
    constructor(attributes) {
        this.attributes = Object.assign({}, attributes || {});
        this.classList = new FakeClassList();
        this.className = '';
        this.hidden = false;
        this.listeners = Object.create(null);
        this.focusCount = 0;
        this.style = {};
        this.textContent = '';
        this.offsetWidth = 148;
        this.clientWidth = 390;
    }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        if (!this.listeners[type].includes(handler)) this.listeners[type].push(handler);
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
    contains(node) { return node === this; }
    focus() { this.focusCount += 1; }
    getBoundingClientRect() { return { left: 120, top: 10, bottom: 42, width: 90 }; }
}

function createHarness(callbacks) {
    callbacks = callbacks || {};
    const pages = callbacks.pages || pageDefinitions;
    const switcher = new FakeNode({ 'data-tm-page-switcher': '' });
    const label = new FakeNode({ 'data-tm-current-page-label': '' });
    const icon = new FakeNode({ 'data-tm-current-page-icon': '' });
    const trigger = new FakeNode({ id: 'tm-page-switcher-button', 'aria-expanded': 'false' });
    trigger.querySelector = (selector) => {
        if (selector === '[data-tm-current-page-label]') return label;
        if (selector === '[data-tm-current-page-icon]') return icon;
        return null;
    };
    trigger.contains = (node) => node === trigger || node === label || node === icon;
    const items = pages.map((page) => new FakeNode({ 'data-tm-page-target': page.id }));
    const menu = new FakeNode({ id: 'tm-page-switcher-menu', role: 'menu', hidden: '' });
    menu.hidden = true;
    menu.querySelectorAll = (selector) => selector === '[data-tm-page-target]' ? items : [];
    menu.contains = (node) => items.includes(node) || node === menu;
    const panels = pages.map((page) => new FakeNode({ 'data-tm-page': page.id }));
    const root = new FakeNode();
    root.querySelectorAll = (selector) => selector === '[data-tm-page]' ? panels : [];
    root.querySelector = (selector) => {
        if (selector === '[data-tm-page-switcher]') return switcher;
        if (selector === '#tm-page-switcher-button') return trigger;
        if (selector === '#tm-page-switcher-menu') return menu;
        return null;
    };
    root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390 });
    const doc = new FakeNode();
    const controller = appShell.createAppShell(Object.assign({}, callbacks, {
        root,
        document: doc,
        pages,
        defaultPage: callbacks.defaultPage || 'themes',
    }));
    return { root, doc, switcher, trigger, label, icon, menu, items, panels, controller };
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

test('missing or invalid active page still falls back to themes', () => {
    assert.equal(appShell.normalizePageId(undefined, pageDefinitions, 'themes'), 'themes');
    assert.equal(appShell.normalizePageId('unknown', pageDefinitions, 'themes'), 'themes');
});

test('compact switcher shows the current themes label and Font Awesome icons', () => {
    const html = appShell.buildPageSwitcherHtml({ pages: pageDefinitions, defaultPage: 'themes' });
    assert.match(html, /data-tm-current-page-label>美化<\/span>/);
    assert.match(html, /fa-palette/);
    assert.match(html, /fa-chevron-down/);
    assert.match(html, /aria-haspopup="menu"/);
    assert.match(html, /aria-expanded="false"/);
});

test('menu contains three menuitems without stale tablist or tab semantics', () => {
    const html = appShell.buildShellHtml({ pages: pageDefinitions, defaultPage: 'themes' });
    assert.equal((html.match(/role="menuitem"/g) || []).length, 3);
    assert.equal((html.match(/data-tm-page-target=/g) || []).length, 3);
    assert.match(html, /role="menu"/);
    assert.doesNotMatch(html, /role="tablist"|role="tab"|aria-selected/);
    assert.doesNotMatch(html, /tm-primary-nav|tm-primary-tab/);
});

test('page panels and placeholders remain separate from the shared popup root', () => {
    const html = appShell.buildShellHtml({ pages: pageDefinitions });
    assert.equal((html.match(/data-tm-page=/g) || []).length, 3);
    assert.doesNotMatch(html, /tm-popup-slot/);
    assert.doesNotMatch(html, /upload|上传|导入/);
});

test('controller initializes themes without opening the menu or firing lifecycle', () => {
    let changes = 0;
    const harness = createHarness({ onChange() { changes += 1; } });
    assert.equal(harness.controller.getActivePage(), 'themes');
    assert.equal(harness.controller.isMenuOpen(), false);
    assert.equal(harness.label.textContent, '美化');
    assert.equal(harness.trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(changes, 0);
});

test('clicking the compact switcher opens and toggles the menu', () => {
    const harness = createHarness();
    harness.trigger.dispatch('click', harness.trigger);
    assert.equal(harness.controller.isMenuOpen(), true);
    assert.equal(harness.menu.hidden, false);
    assert.equal(harness.trigger.getAttribute('aria-expanded'), 'true');
    harness.trigger.dispatch('click', harness.trigger);
    assert.equal(harness.controller.isMenuOpen(), false);
    assert.equal(harness.trigger.getAttribute('aria-expanded'), 'false');
});

test('Enter and Space open the compact switcher with keyboard focus in the menu', () => {
    const harness = createHarness();
    const enter = harness.trigger.dispatch('keydown', harness.trigger, { key: 'Enter' });
    assert.equal(enter.prevented, true);
    assert.equal(harness.controller.isMenuOpen(), true);
    assert.equal(harness.items[0].focusCount, 1);
    harness.controller.closeMenu({ restoreFocus: false });
    const space = harness.trigger.dispatch('keydown', harness.trigger, { key: ' ' });
    assert.equal(space.prevented, true);
    assert.equal(harness.controller.isMenuOpen(), true);
    assert.equal(harness.items[0].focusCount, 2);
});

test('selecting avatars switches lifecycle, closes the menu and updates the trigger', () => {
    const events = [];
    const pages = pageDefinitions.map((page) => Object.assign({}, page, {
        mount: () => events.push(`mount:${page.id}`),
        unmount: () => events.push(`unmount:${page.id}`),
    }));
    const harness = createHarness({ pages });
    harness.trigger.dispatch('click', harness.trigger);
    harness.menu.dispatch('click', harness.items[1]);
    assert.equal(harness.controller.getActivePage(), 'avatars');
    assert.equal(harness.controller.isMenuOpen(), false);
    assert.equal(harness.label.textContent, '头像');
    assert.match(harness.icon.className, /fa-user/);
    assert.deepEqual(events, ['unmount:themes', 'mount:avatars']);
});

test('selecting backgrounds updates active state and current marker', () => {
    const harness = createHarness();
    harness.trigger.dispatch('click', harness.trigger);
    harness.menu.dispatch('click', harness.items[2]);
    assert.equal(harness.controller.getActivePage(), 'backgrounds');
    assert.equal(harness.label.textContent, '背景');
    assert.match(harness.icon.className, /fa-image/);
    assert.equal(harness.items[2].getAttribute('aria-current'), 'page');
    assert.equal(harness.panels[2].hidden, false);
    assert.equal(harness.panels[0].hidden, true);
});

test('switching back to themes mounts the original theme page once', () => {
    const events = [];
    const pages = pageDefinitions.map((page) => Object.assign({}, page, {
        mount: () => events.push(`mount:${page.id}`),
        unmount: () => events.push(`unmount:${page.id}`),
    }));
    const harness = createHarness({ pages });
    harness.controller.setActivePage('backgrounds', 'test');
    harness.trigger.dispatch('click', harness.trigger);
    harness.menu.dispatch('click', harness.items[0]);
    assert.equal(harness.controller.getActivePage(), 'themes');
    assert.equal(harness.label.textContent, '美化');
    assert.deepEqual(events, ['unmount:themes', 'mount:backgrounds', 'unmount:backgrounds', 'mount:themes']);
});

test('clicking outside closes the menu without changing activePage', () => {
    const harness = createHarness();
    const outside = new FakeNode();
    harness.trigger.dispatch('click', harness.trigger);
    harness.doc.dispatch('pointerdown', outside);
    assert.equal(harness.controller.isMenuOpen(), false);
    assert.equal(harness.controller.getActivePage(), 'themes');
});

test('Escape closes the menu and restores focus to the trigger', () => {
    const harness = createHarness();
    harness.trigger.dispatch('click', harness.trigger);
    const event = harness.doc.dispatch('keydown', harness.menu, { key: 'Escape' });
    assert.equal(harness.controller.isMenuOpen(), false);
    assert.equal(harness.trigger.focusCount, 1);
    assert.equal(event.prevented, true);
});

test('keyboard opens the menu and ArrowDown plus Enter selects the next item', () => {
    const harness = createHarness();
    harness.trigger.dispatch('keydown', harness.trigger, { key: 'ArrowDown' });
    assert.equal(harness.controller.isMenuOpen(), true);
    assert.equal(harness.items[0].focusCount, 1);
    harness.menu.dispatch('keydown', harness.items[0], { key: 'ArrowDown' });
    assert.equal(harness.items[1].focusCount, 1);
    harness.menu.dispatch('keydown', harness.items[1], { key: 'Enter' });
    assert.equal(harness.controller.getActivePage(), 'avatars');
    assert.equal(harness.controller.isMenuOpen(), false);
});

test('repeated open calls do not duplicate document or component listeners', () => {
    const harness = createHarness();
    harness.controller.openMenu();
    harness.controller.openMenu();
    assert.equal(harness.doc.listeners.pointerdown.length, 1);
    assert.equal(harness.doc.listeners.keydown.length, 1);
    assert.equal(harness.trigger.listeners.click.length, 1);
    assert.equal(harness.trigger.listeners.keydown.length, 1);
    assert.equal(harness.menu.listeners.click.length, 1);
    assert.equal(harness.menu.listeners.keydown.length, 1);
});

test('shared popup guard can veto a page change while the menu still closes', () => {
    const harness = createHarness({ beforeChange() { return false; } });
    harness.trigger.dispatch('click', harness.trigger);
    harness.menu.dispatch('click', harness.items[1]);
    assert.equal(harness.controller.getActivePage(), 'themes');
    assert.equal(harness.controller.isMenuOpen(), false);
    assert.equal(harness.label.textContent, '美化');
});

test('destroy removes component and temporary document listeners', () => {
    const harness = createHarness();
    harness.controller.openMenu();
    harness.controller.destroy();
    assert.equal((harness.trigger.listeners.click || []).length, 0);
    assert.equal((harness.trigger.listeners.keydown || []).length, 0);
    assert.equal((harness.menu.listeners.click || []).length, 0);
    assert.equal((harness.menu.listeners.keydown || []).length, 0);
    assert.equal((harness.doc.listeners.pointerdown || []).length, 0);
    assert.equal((harness.doc.listeners.keydown || []).length, 0);
});
