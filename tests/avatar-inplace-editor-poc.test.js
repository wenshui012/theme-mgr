const test = require('node:test');
const assert = require('node:assert/strict');

class FakeClassList {
    constructor(owner) { this.owner = owner; this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
    toString() { return [...this.values].join(' '); }
}

class FakeEventTarget {
    constructor() { this.listeners = Object.create(null); }
    addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        if (!this.listeners[type].includes(handler)) this.listeners[type].push(handler);
    }
    removeEventListener(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler);
    }
    dispatch(type, overrides) {
        const event = Object.assign({
            type,
            target: this,
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: 0,
            clientY: 0,
            defaultPrevented: false,
            propagationStopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopImmediatePropagation() { this.propagationStopped = true; },
        }, overrides || {});
        (this.listeners[type] || []).slice().forEach((handler) => handler(event));
        return event;
    }
}

class FakeAnimation {
    constructor(keyframes, supportsAdditive) {
        this.keyframes = keyframes.map((frame) => Object.assign({}, frame, {
            composite: supportsAdditive ? frame.composite : 'replace',
        }));
        this.effect = {
            getKeyframes: () => this.keyframes.map((frame) => Object.assign({}, frame)),
            setKeyframes: (next) => { this.keyframes = next.map((frame) => Object.assign({}, frame)); },
        };
        this.currentTime = null;
        this.paused = false;
        this.cancelled = false;
    }
    pause() { this.paused = true; }
    cancel() { this.cancelled = true; }
}

class FakeElement extends FakeEventTarget {
    constructor(tagName, options) {
        super();
        options = options || {};
        this.tagName = String(tagName || 'div').toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.parentElement = null;
        this.attributes = Object.create(null);
        this.classList = new FakeClassList(this);
        this._className = '';
        this.id = '';
        this.textContent = '';
        this.type = '';
        this.disabled = false;
        this.supportsAdditive = options.supportsAdditive !== false;
        this.animations = [];
        this.capturedPointers = [];
        this.releasedPointers = [];
        this.rect = options.rect || { x: 10, y: 20, width: 64, height: 64 };
        this.computed = Object.assign({
            display: 'block',
            visibility: 'visible',
            overflow: 'visible',
            overflowX: 'visible',
            overflowY: 'visible',
            objectFit: 'cover',
            objectPosition: '42% 55%',
            transform: 'matrix(0.98, 0.2, -0.2, 0.98, 4, 2)',
            translate: '3px 2px',
            scale: '1.1',
            rotate: '8deg',
            transformOrigin: '20px 24px',
            borderRadius: '22px',
            clipPath: 'circle(48%)',
            webkitMaskImage: 'url("mask.png")',
            maskImage: 'url("mask.png")',
            filter: 'drop-shadow(0 0 2px #000)',
        }, options.computed || {});
    }
    set className(value) {
        this._className = String(value || '');
        this.classList.values = new Set(this._className.split(/\s+/).filter(Boolean));
    }
    get className() { return this.classList.toString(); }
    appendChild(child) {
        child.parentNode = this;
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    removeChild(child) {
        this.children = this.children.filter((item) => item !== child);
        child.parentNode = null;
        child.parentElement = null;
        return child;
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === 'id') this.id = String(value);
        if (name === 'class') this.className = String(value);
    }
    getAttribute(name) {
        if (name === 'id') return this.id || null;
        if (name === 'class') return this.className || null;
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    removeAttribute(name) {
        delete this.attributes[name];
        if (name === 'id') this.id = '';
        if (name === 'class') this.className = '';
    }
    contains(node) {
        if (node === this) return true;
        return this.children.some((child) => child.contains(node));
    }
    closest(selector) {
        let current = this;
        while (current) {
            if (selector === '.avatar' && current.classList.contains('avatar')) return current;
            if (selector === '.mes' && current.classList.contains('mes')) return current;
            if (selector === '[data-tm-avatar-poc-action]' && current.getAttribute('data-tm-avatar-poc-action')) return current;
            current = current.parentElement;
        }
        return null;
    }
    querySelector(selector) {
        if (selector === ':scope > img') return this.children.find((child) => child.tagName === 'IMG') || null;
        if (selector === 'img') {
            for (const child of this.children) {
                if (child.tagName === 'IMG') return child;
                const nested = child.querySelector('img');
                if (nested) return nested;
            }
        }
        return null;
    }
    getBoundingClientRect() {
        const rect = Object.assign({}, this.rect);
        const animation = [...this.animations].reverse().find((entry) => !entry.cancelled);
        const transform = animation?.keyframes?.[0]?.transform || '';
        const match = transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s+scale\((-?[\d.]+)\)/);
        if (match) {
            const translateX = Number(match[1]);
            const translateY = Number(match[2]);
            const scale = Number(match[3]);
            rect.x += translateX - (rect.width * (scale - 1) / 2);
            rect.y += translateY - (rect.height * (scale - 1) / 2);
            rect.width *= scale;
            rect.height *= scale;
        }
        return Object.assign(rect, { left: rect.x, top: rect.y });
    }
    animate(keyframes) {
        const animation = new FakeAnimation(keyframes, this.supportsAdditive);
        this.animations.push(animation);
        return animation;
    }
    setPointerCapture(pointerId) { this.capturedPointers.push(pointerId); }
    releasePointerCapture(pointerId) { this.releasedPointers.push(pointerId); }
    get isConnected() {
        let current = this;
        while (current) {
            if (current._documentRoot) return true;
            current = current.parentElement;
        }
        return false;
    }
}

class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.connected = false; FakeMutationObserver.instances.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    trigger() { if (this.connected) this.callback([]); }
}
FakeMutationObserver.instances = [];

class FakeDocument extends FakeEventTarget {
    constructor() {
        super();
        this.head = new FakeElement('head');
        this.body = new FakeElement('body');
        this.head._documentRoot = true;
        this.body._documentRoot = true;
    }
    createElement(tagName) { return new FakeElement(tagName); }
    getElementById(id) {
        const search = (node) => {
            if (node.id === id) return node;
            for (const child of node.children) {
                const found = search(child);
                if (found) return found;
            }
            return null;
        };
        return search(this.head) || search(this.body);
    }
}

function createFixture() {
    FakeMutationObserver.instances = [];
    const document = new FakeDocument();
    const chat = new FakeElement('div');
    chat.id = 'chat';
    document.body.appendChild(chat);

    function addMessage(role, options) {
        options = options || {};
        const message = new FakeElement('div');
        message.classList.add('mes');
        message.setAttribute('is_user', role === 'user' ? 'true' : role === 'character' ? 'false' : '');
        message.setAttribute('is_system', role === 'unknown' ? 'true' : 'false');
        message.setAttribute('mesid', options.id || String(chat.children.length));
        const wrapper = new FakeElement('div');
        wrapper.classList.add('mesAvatarWrapper');
        const avatar = new FakeElement('div', { computed: options.avatarComputed });
        avatar.classList.add('avatar');
        const image = new FakeElement('img', { computed: options.imageComputed, supportsAdditive: options.supportsAdditive });
        image.setAttribute('src', options.src || `${role}.png`);
        if (options.inlineStyle !== undefined) image.setAttribute('style', options.inlineStyle);
        avatar.appendChild(image);
        wrapper.appendChild(avatar);
        message.appendChild(wrapper);
        chat.appendChild(message);
        return { message, wrapper, avatar, image };
    }

    const character = addMessage('character', { id: '1', inlineStyle: 'opacity:.94;transform-origin:30% 40%' });
    const user = addMessage('user', { id: '2' });
    const unknown = addMessage('unknown', { id: '3' });
    const ordinaryImage = new FakeElement('img');
    character.message.appendChild(ordinaryImage);
    const sidebarAvatar = new FakeElement('div');
    sidebarAvatar.classList.add('avatar');
    const sidebarImage = new FakeElement('img');
    sidebarAvatar.appendChild(sidebarImage);
    document.body.appendChild(sidebarAvatar);
    const customStyle = new FakeElement('style');
    customStyle.id = 'custom-style';
    customStyle.textContent = '.theme{color:red}';
    document.head.appendChild(customStyle);
    const window = {
        document,
        MutationObserver: FakeMutationObserver,
        getComputedStyle(element) { return element.computed; },
    };
    return { document, window, chat, character, user, unknown, ordinaryImage, sidebarAvatar, sidebarImage, customStyle };
}

const bootstrap = createFixture();
global.window = bootstrap.window;
global.document = bootstrap.document;
global.ThemeMgrModules = {};
bootstrap.window.ThemeMgrModules = global.ThemeMgrModules;
require('../src/avatar-inplace-editor-poc.js');

const createPoc = bootstrap.window.ThemeMgrModules.createAvatarInplaceEditorPoc;
const internals = bootstrap.window.ThemeMgrModules.avatarInplacePocInternals;

function startAndSelect(fixture, which = 'character') {
    const poc = createPoc({ window: fixture.window, document: fixture.document });
    poc.start();
    const item = fixture[which];
    fixture.document.dispatch('pointerdown', { target: item.image });
    return { poc, item };
}

test('only a direct avatar image inside #chat .mes is eligible', () => {
    const fixture = createFixture();
    assert.equal(internals.findEditableAvatar(fixture.character.image, fixture.document, fixture.window).role, 'character');
    assert.equal(internals.findEditableAvatar(fixture.ordinaryImage, fixture.document, fixture.window), null);
    assert.equal(internals.findEditableAvatar(fixture.sidebarImage, fixture.document, fixture.window), null);
});

test('User Character and Unknown roles are classified from message attributes', () => {
    const fixture = createFixture();
    assert.equal(internals.classifyMessage(fixture.user.message), 'user');
    assert.equal(internals.classifyMessage(fixture.character.message), 'character');
    assert.equal(internals.classifyMessage(fixture.unknown.message), 'unknown');
});

test('start select edit save state machine returns runtime-only parameters', () => {
    const fixture = createFixture();
    const { poc } = startAndSelect(fixture);
    assert.equal(poc.getState().state, 'editing');
    const saved = poc.save();
    assert.deepEqual({ role: saved.role, x: saved.x, y: saved.y, scale: saved.scale, saved: saved.saved }, { role: 'character', x: 0, y: 0, scale: 1, saved: true });
    assert.equal(poc.getState().state, 'idle');
});

test('pointer drag updates x and y and uses pointer capture', () => {
    const fixture = createFixture();
    const { poc, item } = startAndSelect(fixture);
    item.image.dispatch('pointerdown', { pointerId: 7, clientX: 10, clientY: 20 });
    fixture.document.dispatch('pointermove', { target: item.image, pointerId: 7, clientX: 34, clientY: 51 });
    fixture.document.dispatch('pointerup', { target: item.image, pointerId: 7, clientX: 34, clientY: 51 });
    assert.equal(poc.getState().x, 24);
    assert.equal(poc.getState().y, 31);
    assert.deepEqual(item.image.capturedPointers, [7]);
    assert.deepEqual(item.image.releasedPointers, [7]);
    poc.cancel();
});

test('scale plus and minus use the configured step', () => {
    const fixture = createFixture();
    const { poc } = startAndSelect(fixture);
    poc.scaleUp();
    assert.equal(poc.getState().scale, 1.05);
    poc.scaleDown();
    assert.equal(poc.getState().scale, 1);
    poc.cancel();
});

test('scale is clamped and rejects non-finite values', () => {
    assert.equal(internals.clampScale(-2), 0.5);
    assert.equal(internals.clampScale(99), 3);
    assert.equal(internals.clampScale(Infinity), 1);
    assert.equal(internals.clampScale(NaN), 1);
});

test('reset restores relative adjustment to zero zero one', () => {
    const fixture = createFixture();
    const { poc, item } = startAndSelect(fixture);
    item.image.dispatch('pointerdown', { clientX: 0, clientY: 0 });
    fixture.document.dispatch('pointermove', { target: item.image, clientX: 20, clientY: -12 });
    fixture.document.dispatch('pointerup', { target: item.image });
    poc.setScale(2.2);
    poc.reset();
    assert.deepEqual({ x: poc.getState().x, y: poc.getState().y, scale: poc.getState().scale }, { x: 0, y: 0, scale: 1 });
    poc.cancel();
});

test('cancel exactly restores the baseline style attribute and cancels the effect', () => {
    const fixture = createFixture();
    const baseline = fixture.character.image.getAttribute('style');
    const { poc, item } = startAndSelect(fixture);
    const effect = item.image.animations[0];
    poc.setScale(1.8);
    poc.cancel();
    assert.equal(item.image.getAttribute('style'), baseline);
    assert.equal(effect.cancelled, true);
});

test('theme transform translate scale rotate and origin are retained in diagnostics', () => {
    const fixture = createFixture();
    const { poc, item } = startAndSelect(fixture);
    const diagnostics = poc.getState().diagnostics;
    assert.equal(diagnostics.transform, item.image.computed.transform);
    assert.equal(diagnostics.translate, item.image.computed.translate);
    assert.equal(diagnostics.scale, item.image.computed.scale);
    assert.equal(diagnostics.rotate, item.image.computed.rotate);
    assert.equal(diagnostics.transformOrigin, item.image.computed.transformOrigin);
    assert.equal(item.image.animations[0].keyframes[0].composite, 'add');
    poc.cancel();
});

test('existing inline style is not changed while editing', () => {
    const fixture = createFixture();
    const baseline = fixture.character.image.getAttribute('style');
    const { poc } = startAndSelect(fixture);
    poc.setScale(1.5);
    assert.equal(fixture.character.image.getAttribute('style'), baseline);
    poc.cancel();
});

test('existing object-position is never overwritten', () => {
    const fixture = createFixture();
    const baseline = fixture.character.image.computed.objectPosition;
    const { poc } = startAndSelect(fixture);
    poc.setScale(1.4);
    assert.equal(fixture.character.image.computed.objectPosition, baseline);
    assert.equal(fixture.character.image.getAttribute('style').includes('object-position'), false);
    poc.cancel();
});

test('mask clip and filter properties are not rewritten', () => {
    const fixture = createFixture();
    const before = { mask: fixture.character.image.computed.webkitMaskImage, clip: fixture.character.image.computed.clipPath, filter: fixture.character.image.computed.filter };
    const { poc } = startAndSelect(fixture);
    poc.setScale(1.3);
    assert.deepEqual({ mask: fixture.character.image.computed.webkitMaskImage, clip: fixture.character.image.computed.clipPath, filter: fixture.character.image.computed.filter }, before);
    poc.cancel();
});

test('target disconnection safely terminates and restores baseline', () => {
    const fixture = createFixture();
    const baseline = fixture.character.image.getAttribute('style');
    const { poc, item } = startAndSelect(fixture);
    item.avatar.removeChild(item.image);
    FakeMutationObserver.instances.at(-1).trigger();
    assert.equal(poc.getState().state, 'idle');
    assert.equal(poc.getState().lastEndReason, 'target-disconnected');
    assert.equal(item.image.getAttribute('style'), baseline);
});

test('repeated start does not duplicate selection listeners', () => {
    const fixture = createFixture();
    const poc = createPoc({ window: fixture.window, document: fixture.document });
    poc.start();
    poc.start();
    assert.equal(fixture.document.listeners.pointerdown.length, 1);
    poc.cancel();
    assert.equal(fixture.document.listeners.pointerdown.length, 0);
});

test('toolbar is removed after cancel and save', () => {
    const fixture = createFixture();
    const first = startAndSelect(fixture);
    assert.ok(fixture.document.getElementById('tm-avatar-poc-toolbar'));
    first.poc.cancel();
    assert.equal(fixture.document.getElementById('tm-avatar-poc-toolbar'), null);
    const second = startAndSelect(fixture);
    second.poc.save();
    assert.equal(fixture.document.getElementById('tm-avatar-poc-toolbar'), null);
});

test('temporary style node is removed after every exit path', () => {
    const fixture = createFixture();
    const { poc } = startAndSelect(fixture);
    assert.ok(fixture.document.getElementById('tm-avatar-poc-style'));
    poc.cancel();
    assert.equal(fixture.document.getElementById('tm-avatar-poc-style'), null);
});

test('theme metadata sentinel is not modified', () => {
    const fixture = createFixture();
    const metadata = { A: { imageData: 'image', thumbData: 'thumb' } };
    const before = JSON.stringify(metadata);
    const { poc } = startAndSelect(fixture);
    poc.setScale(1.2);
    poc.save();
    assert.equal(JSON.stringify(metadata), before);
});

test('custom-style content is never modified or replaced', () => {
    const fixture = createFixture();
    const before = fixture.customStyle.textContent;
    const { poc } = startAndSelect(fixture);
    poc.cancel();
    assert.equal(fixture.customStyle.textContent, before);
    assert.equal(fixture.document.getElementById('custom-style'), fixture.customStyle);
});

test('editing does not call fetch or any backend', () => {
    const fixture = createFixture();
    let fetchCount = 0;
    fixture.window.fetch = () => { fetchCount++; throw new Error('unexpected backend call'); };
    const { poc } = startAndSelect(fixture);
    poc.setScale(1.1);
    poc.save();
    assert.equal(fetchCount, 0);
});

test('only the selected avatar receives classes and an animation', () => {
    const fixture = createFixture();
    const { poc } = startAndSelect(fixture, 'character');
    assert.equal(fixture.character.image.animations.length, 1);
    assert.equal(fixture.user.image.animations.length, 0);
    assert.equal(fixture.user.image.classList.contains('tm-avatar-poc-target'), false);
    assert.equal(fixture.sidebarImage.animations.length, 0);
    poc.cancel();
});

test('save preserves the additive effect while removing editing listeners and classes', () => {
    const fixture = createFixture();
    const { poc, item } = startAndSelect(fixture);
    poc.setScale(1.25);
    const effect = item.image.animations[0];
    const saved = poc.save();
    assert.equal(saved.scale, 1.25);
    assert.equal(effect.cancelled, false);
    assert.equal((item.image.listeners.pointerdown || []).length, 0);
    assert.equal((item.image.listeners.click || []).length, 0);
    assert.equal(item.image.classList.contains('tm-avatar-poc-target'), false);
    assert.equal(item.avatar.classList.contains('tm-avatar-poc-selected'), false);
});

test('unsupported additive composition fails safely without selecting the target', () => {
    const fixture = createFixture();
    fixture.character.image.supportsAdditive = false;
    const poc = createPoc({ window: fixture.window, document: fixture.document });
    poc.start();
    fixture.document.dispatch('pointerdown', { target: fixture.character.image });
    assert.equal(poc.getState().state, 'selecting');
    assert.match(poc.getState().lastEndReason, /不支持安全叠加/);
    assert.equal(fixture.character.image.classList.contains('tm-avatar-poc-target'), false);
    poc.cancel();
});

test('selection mode ignores clicks outside an eligible chat avatar', () => {
    const fixture = createFixture();
    const poc = createPoc({ window: fixture.window, document: fixture.document });
    poc.start();
    const event = fixture.document.dispatch('pointerdown', { target: fixture.ordinaryImage });
    assert.equal(poc.getState().state, 'selecting');
    assert.equal(event.defaultPrevented, false);
    poc.cancel();
});
