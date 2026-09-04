const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.ThemeMgrModules = {};
require('../src/image-loader.js');

const { createImageLoader, PLACEHOLDER_SRC } = global.ThemeMgrModules.imageLoader;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

class FakeImage {
    constructor(key, root) {
        this.dataset = { themeKey: key, imageState: 'idle' };
        this.classNames = new Set();
        this.classList = {
            add: (...names) => names.forEach((name) => this.classNames.add(name)),
        };
        this.listeners = { load: new Set(), error: new Set() };
        this.isConnected = true;
        this.parentRoot = root;
        this.complete = false;
        this.naturalWidth = 0;
        this.src = PLACEHOLDER_SRC;
    }

    addEventListener(type, handler) {
        this.listeners[type].add(handler);
    }

    removeEventListener(type, handler) {
        this.listeners[type].delete(handler);
    }

    dispatch(type) {
        [...this.listeners[type]].forEach((handler) => handler());
    }
}

function createHarness(overrides) {
    const observers = [];
    class FakeIntersectionObserver {
        constructor(callback, options) {
            this.callback = callback;
            this.options = options;
            this.observed = new Set();
            this.unobserved = [];
            this.disconnected = false;
            observers.push(this);
        }

        observe(image) {
            this.observed.add(image);
        }

        unobserve(image) {
            this.observed.delete(image);
            this.unobserved.push(image);
        }

        disconnect() {
            this.disconnected = true;
            this.observed.clear();
        }

        intersect(image) {
            this.callback([{ target: image, isIntersecting: true, intersectionRatio: 1 }], this);
        }
    }

    const root = {
        contains(image) {
            return image.parentRoot === root && image.isConnected !== false;
        },
    };
    const resolved = [];
    const options = Object.assign({
        root,
        rootMargin: '600px 0px',
        generation: 1,
        IntersectionObserver: FakeIntersectionObserver,
        resolveSource(key) {
            resolved.push(key);
            return `/images/${key}.png`;
        },
    }, overrides || {});
    const loader = createImageLoader(options);
    return { loader, root, resolved, observers, FakeImage };
}

test('observe waits for intersection and uses the configured scroll root', async () => {
    const harness = createHarness();
    const image = new FakeImage('alpha', harness.root);
    harness.loader.observe(image, 1);

    assert.deepEqual(harness.resolved, []);
    assert.equal(image.src, PLACEHOLDER_SRC);
    assert.equal(harness.observers[0].options.root, harness.root);
    assert.equal(harness.observers[0].options.rootMargin, '600px 0px');

    harness.observers[0].intersect(image);
    await flushPromises();
    assert.deepEqual(harness.resolved, ['alpha']);
    assert.equal(image.src, '/images/alpha.png');

    image.dispatch('load');
    assert.equal(image.dataset.imageState, 'loaded');
    assert.ok(image.classNames.has('tm-image-loaded'));
    assert.ok(harness.observers[0].unobserved.includes(image));
});

test('repeated intersections do not resolve the same image twice', async () => {
    const pending = deferred();
    let calls = 0;
    const harness = createHarness({ resolveSource() { calls += 1; return pending.promise; } });
    const image = new FakeImage('repeat', harness.root);
    harness.loader.observe(image, 1);
    harness.observers[0].intersect(image);
    harness.observers[0].intersect(image);
    await flushPromises();
    assert.equal(calls, 1);
    pending.resolve('/images/repeat.png');
    await flushPromises();
    harness.observers[0].intersect(image);
    await flushPromises();
    assert.equal(calls, 1);
});

test('unobserve prevents a queued observer entry from resolving', async () => {
    const harness = createHarness();
    const image = new FakeImage('removed', harness.root);
    harness.loader.observe(image, 1);
    harness.loader.unobserve(image);
    harness.observers[0].intersect(image);
    await flushPromises();
    assert.deepEqual(harness.resolved, []);
});

test('disconnect releases all observed images and ignores later entries', async () => {
    const harness = createHarness();
    const first = new FakeImage('first', harness.root);
    const second = new FakeImage('second', harness.root);
    harness.loader.observe([first, second], 1);
    harness.loader.disconnect();
    assert.equal(harness.observers[0].disconnected, true);
    harness.observers[0].intersect(first);
    await flushPromises();
    assert.deepEqual(harness.resolved, []);
});

test('reset generation invalidates an older asynchronous resolver', async () => {
    const pending = deferred();
    const harness = createHarness({ resolveSource() { return pending.promise; } });
    const image = new FakeImage('stale', harness.root);
    harness.loader.observe(image, 1);
    harness.observers[0].intersect(image);
    await flushPromises();

    harness.loader.reset({ root: harness.root, generation: 2 });
    pending.resolve('/images/stale.png');
    await flushPromises();
    assert.equal(image.src, PLACEHOLDER_SRC);
    assert.notEqual(image.dataset.imageState, 'loaded');
});

test('detached images are not updated after source resolution', async () => {
    const pending = deferred();
    const harness = createHarness({ resolveSource() { return pending.promise; } });
    const image = new FakeImage('detached', harness.root);
    harness.loader.observe(image, 1);
    harness.observers[0].intersect(image);
    await flushPromises();
    image.isConnected = false;
    pending.resolve('/images/detached.png');
    await flushPromises();
    assert.equal(image.src, PLACEHOLDER_SRC);
    assert.ok(harness.observers[0].unobserved.includes(image));
});

test('resolver failure marks an image once without retrying', async () => {
    let calls = 0;
    let failures = 0;
    const harness = createHarness({
        resolveSource() { calls += 1; return Promise.reject(new Error('offline')); },
        onError() { failures += 1; },
    });
    const image = new FakeImage('offline', harness.root);
    harness.loader.observe(image, 1);
    harness.observers[0].intersect(image);
    await flushPromises();
    harness.observers[0].intersect(image);
    await flushPromises();
    assert.equal(calls, 1);
    assert.equal(failures, 1);
    assert.equal(image.dataset.imageState, 'error');
    assert.equal(image.src, PLACEHOLDER_SRC);
});

test('image request error falls back and does not affect another image', async () => {
    let failures = 0;
    const harness = createHarness({ onError() { failures += 1; } });
    const broken = new FakeImage('broken', harness.root);
    const healthy = new FakeImage('healthy', harness.root);
    harness.loader.observe([broken, healthy], 1);
    harness.observers[0].intersect(broken);
    harness.observers[0].intersect(healthy);
    await flushPromises();
    broken.dispatch('error');
    healthy.dispatch('load');
    assert.equal(failures, 1);
    assert.equal(broken.dataset.imageState, 'error');
    assert.equal(healthy.dataset.imageState, 'loaded');
});

test('new batch images can be registered after earlier images settle', async () => {
    const harness = createHarness();
    const first = new FakeImage('batch-one', harness.root);
    harness.loader.observe(first, 1);
    harness.observers[0].intersect(first);
    await flushPromises();
    first.dispatch('load');

    const second = new FakeImage('batch-two', harness.root);
    harness.loader.observe(second, 1);
    harness.observers[0].intersect(second);
    await flushPromises();
    assert.deepEqual(harness.resolved, ['batch-one', 'batch-two']);
});

test('loadNow supports a small eager group without disabling observation', async () => {
    const harness = createHarness();
    const eager = new FakeImage('eager', harness.root);
    const lazy = new FakeImage('lazy', harness.root);
    harness.loader.loadNow(eager, 1);
    harness.loader.observe(lazy, 1);
    await flushPromises();
    assert.deepEqual(harness.resolved, ['eager']);
    harness.observers[0].intersect(lazy);
    await flushPromises();
    assert.deepEqual(harness.resolved, ['eager', 'lazy']);
});

test('missing IntersectionObserver falls back to immediate loading', async () => {
    const harness = createHarness({ IntersectionObserver: null });
    const image = new FakeImage('fallback', harness.root);
    harness.loader.observe(image, 1);
    await flushPromises();
    assert.deepEqual(harness.resolved, ['fallback']);
    assert.equal(image.src, '/images/fallback.png');
});
