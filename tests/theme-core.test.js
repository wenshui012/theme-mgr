const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.ThemeMgrModules = {};
require('../src/theme-schema.js');
require('../src/theme-api.js');
require('../src/theme-runtime.js');
require('../src/theme-transactions.js');
require('../src/theme-transfer.js');
require('../src/theme-metadata.js');
require('../src/editor-draft.js');
require('../src/image-tools.js');
require('../src/theme-pairs.js');
require('../src/theme-series.js');
require('../src/theme-bindings.js');
require('../src/theme-appearance.js');
require('../src/storage.js');
require('../src/ui-sheets.js');
require('../src/ui-events.js');

const modules = global.ThemeMgrModules;
const schema = modules.themeSchema;
const imageTools = modules.imageTools;
const appearance = modules.themeAppearance;
const pairs = modules.themePairs;
const series = modules.themeSeries;
const bindings = modules.themeBindings;
const metadata = modules.themeMetadata;
const editorDraft = modules.editorDraft;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function completeTheme(name, overrides) {
    const theme = { name };
    schema.THEME_FIELDS.forEach((key, index) => {
        theme[key] = key === 'custom_css' ? `/* ${name} */` : `${key}:${index}`;
    });
    return Object.assign(theme, overrides || {});
}

function completeBaseline(overrides) {
    const baseline = {};
    schema.THEME_FIELDS.forEach((key, index) => {
        baseline[key] = key === 'custom_css' ? '/* baseline */' : `baseline:${key}:${index}`;
    });
    return Object.assign(baseline, overrides || {});
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
    const deadline = Date.now() + 1000;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error(message || 'condition was not reached');
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
}

function createStorageTestHarness(options) {
    const config = options || {};
    const shared = config.shared || { data: null, sync: null };
    const puts = [];
    const imagePosts = [];
    const imageBatchPosts = [];
    let getCount = 0;
    let localWriteCount = 0;
    const putFactory = config.putFactory || (() => {
        const request = deferred();
        request.resolve({ ok: true, json: async () => ({ ok: true }) });
        return request;
    });
    const fetch = (url, requestOptions) => {
        const method = requestOptions && requestOptions.method || 'GET';
        if (url.endsWith('/status')) {
            if (typeof config.statusFactory === 'function') return config.statusFactory();
            if (config.server === false) {
                return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        if (url.endsWith('/data') && method === 'GET') {
            getCount += 1;
            if (typeof config.getFactory === 'function') return config.getFactory(getCount);
            return Promise.resolve({
                ok: true,
                json: async () => ({ ok: true, data: clone(config.serverData === undefined ? { value: 'server' } : config.serverData) }),
            });
        }
        if (url.endsWith('/data') && method === 'PUT') {
            const pending = putFactory(puts.length, JSON.parse(requestOptions.body));
            puts.push({ body: JSON.parse(requestOptions.body), pending });
            return pending.promise;
        }
        if (url.endsWith('/images') && method === 'POST') {
            imagePosts.push(JSON.parse(requestOptions.body));
            return Promise.resolve({ ok: true, json: async () => ({ ok: true, url: '/server/images/test.png' }) });
        }
        if (url.endsWith('/images/batch-fetch') && method === 'POST') {
            imageBatchPosts.push(JSON.parse(requestOptions.body));
            return Promise.resolve({ ok: true, json: async () => ({ ok: true, images: {} }) });
        }
        throw new Error(`unexpected fetch: ${method} ${url}`);
    };
    const storageOptions = {
        DB_NAME: 'test',
        DB_VERSION: 1,
        STORE_NAME: 'test',
        DATA_KEY: 'data',
        SERVER_BASE: '/server',
        SERVER_IMAGE_PREFIX: '/server/images/',
        IMAGE_FIELD_KEYS: config.imageFieldKeys || {},
        ensureDefaults(value) { return Object.assign({ value: 'default' }, value || {}); },
        getPostHeaders() { return Promise.resolve({ 'Content-Type': 'application/json' }); },
        fetch,
        serverDebounceMs: config.serverDebounceMs === undefined ? 0 : config.serverDebounceMs,
        serverRetryDelays: config.serverRetryDelays || [0, 0, 0],
        serverReadTimeoutMs: config.serverReadTimeoutMs,
    };
    if (!config.useIndexedDB) {
        storageOptions.localStore = {
            read() {
                if (config.localReadError) throw config.localReadError;
                if (Object.prototype.hasOwnProperty.call(config, 'localReadResult')) {
                    return clone(config.localReadResult);
                }
                return { data: clone(shared.data), sync: clone(shared.sync), hasData: !!shared.data };
            },
            write(data, sync) {
                localWriteCount += 1;
                if (config.localWriteError) throw config.localWriteError;
                if (typeof config.localWriteFactory === 'function') {
                    return Promise.resolve(config.localWriteFactory(clone(data), clone(sync), localWriteCount))
                        .then((result) => {
                            if (result === false) return false;
                            shared.data = clone(data);
                            shared.sync = clone(sync);
                            return result;
                        });
                }
                shared.data = clone(data);
                shared.sync = clone(sync);
            },
        };
    }
    const storage = modules.createStorage(storageOptions);
    return {
        storage,
        shared,
        puts,
        imagePosts,
        imageBatchPosts,
        getCount: () => getCount,
        localWriteCount: () => localWriteCount,
    };
}

function createMemoryLocalStorage(initial) {
    const values = new Map(Object.entries(initial || {}));
    const removed = [];
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { removed.push(key); values.delete(key); },
        has(key) { return values.has(key); },
        value(key) { return values.get(key); },
        removed,
    };
}

function createFakeIndexedDB(mode, shared, counters) {
    const state = shared || { data: null, sync: null };
    const stats = counters || { readTransactions: 0, writeTransactions: 0 };
    const db = {
        objectStoreNames: { contains() { return true; } },
        transaction(_storeName, accessMode) {
            const isWrite = accessMode === 'readwrite';
            if (!isWrite) stats.readTransactions += 1;
            else stats.writeTransactions += 1;
            if (mode === 'transaction-throw' && !isWrite) throw new Error('IndexedDB transaction failed');
            const requests = [];
            const pendingWrites = [];
            const tx = {
                error: null,
                objectStore() {
                    return {
                        get(key) {
                            const request = { result: undefined, error: null };
                            requests.push({ key, request });
                            return request;
                        },
                        put(value, key) {
                            pendingWrites.push({ key, value: clone(value) });
                        },
                    };
                },
            };
            queueMicrotask(() => {
                if (isWrite) {
                    pendingWrites.forEach(({ key, value }) => {
                        if (key === 'data') state.data = value;
                        if (key === 'data:sync-state') state.sync = value;
                    });
                    if (typeof tx.oncomplete === 'function') tx.oncomplete();
                    return;
                }
                if (mode === 'transaction-error') {
                    tx.error = new Error('IndexedDB transaction failed');
                    if (typeof tx.onerror === 'function') tx.onerror();
                    return;
                }
                if (mode === 'transaction-abort') {
                    tx.error = new Error('IndexedDB transaction aborted');
                    if (typeof tx.onabort === 'function') tx.onabort();
                    return;
                }
                if (mode === 'request-error') {
                    requests[0].request.error = new Error('IndexedDB request failed');
                    if (typeof requests[0].request.onerror === 'function') requests[0].request.onerror();
                    if (typeof tx.onabort === 'function') tx.onabort();
                    return;
                }
                requests.forEach(({ key, request }) => {
                    request.result = key === 'data' ? clone(state.data) : clone(state.sync);
                    if (typeof request.onsuccess === 'function') request.onsuccess();
                });
                if (typeof tx.oncomplete === 'function') tx.oncomplete();
            });
            return tx;
        },
    };
    return {
        stats,
        open() {
            const request = { error: null };
            queueMicrotask(() => {
                if (mode === 'open-error') {
                    request.error = new Error('IndexedDB open failed');
                    if (typeof request.onerror === 'function') request.onerror();
                    return;
                }
                if (typeof request.onsuccess === 'function') request.onsuccess({ target: { result: db } });
            });
            return request;
        },
    };
}

function initTestStorage(storage) {
    return new Promise((resolve) => storage.initStorage(resolve));
}

test('stale PUT acknowledgement cannot overwrite a newer local mutation', async () => {
    const requests = [];
    const harness = createStorageTestHarness({
        serverData: { value: 'initial' },
        putFactory() {
            const request = deferred();
            requests.push(request);
            return request;
        },
    });
    await initTestStorage(harness.storage);

    await harness.storage.save({ value: 'A' });
    await waitFor(() => harness.puts.length === 1, 'PUT A did not start');
    await harness.storage.save({ value: 'B' });
    requests[0].resolve({ ok: true, json: async () => ({ ok: true, data: { value: 'A' } }) });
    await waitFor(() => harness.puts.length === 2, 'latest PUT did not follow stale ACK');

    assert.equal(harness.storage.load().value, 'B');
    assert.deepEqual(harness.puts.map((item) => item.body.value), ['A', 'B']);
    requests[1].resolve({ ok: true, json: async () => ({ ok: true, data: { value: 'B' } }) });
    assert.equal(await harness.storage.flush(), true);
});

test('single-flight storage coalesces intermediate revisions and sends only the newest snapshot', async () => {
    const requests = [];
    const harness = createStorageTestHarness({
        serverData: { value: 'initial' },
        putFactory() {
            const request = deferred();
            requests.push(request);
            return request;
        },
    });
    await initTestStorage(harness.storage);

    await harness.storage.save({ value: 'A' });
    await waitFor(() => harness.puts.length === 1);
    await harness.storage.save({ value: 'B' });
    await harness.storage.save({ value: 'C' });
    requests[0].resolve({ ok: true, json: async () => ({ ok: true, data: { value: 'A' } }) });
    await waitFor(() => harness.puts.length === 2);

    assert.deepEqual(harness.puts.map((item) => item.body.value), ['A', 'C']);
    assert.equal(harness.storage.load().value, 'C');
    requests[1].resolve({ ok: true, json: async () => ({ ok: true }) });
    assert.equal(await harness.storage.flush(), true);
});

test('failed PUT keeps pending state and retries the newest revision', async () => {
    const requests = [];
    const harness = createStorageTestHarness({
        serverData: { value: 'initial' },
        serverRetryDelays: [20, 20],
        putFactory() {
            const request = deferred();
            requests.push(request);
            return request;
        },
    });
    await initTestStorage(harness.storage);

    await harness.storage.save({ value: 'A' });
    await waitFor(() => harness.puts.length === 1);
    requests[0].reject(new Error('temporary failure'));
    await waitFor(() => harness.storage.getSyncState().pendingServerSync === true);
    await harness.storage.save({ value: 'B' });
    await waitFor(() => harness.puts.length === 2, 'retry did not start');

    assert.equal(harness.puts[1].body.value, 'B');
    assert.equal(harness.storage.load().value, 'B');
    requests[1].resolve({ ok: true, json: async () => ({ ok: true }) });
    assert.equal(await harness.storage.flush(), true);
    assert.equal(harness.storage.getSyncState().pendingServerSync, false);
});

test('pending local snapshot survives recreation and takes precedence over stale server data', async () => {
    const shared = { data: null, sync: null };
    const firstRequest = deferred();
    const first = createStorageTestHarness({
        shared,
        serverData: { value: 'server-old' },
        putFactory() { return firstRequest; },
    });
    await initTestStorage(first.storage);
    await first.storage.save({ value: 'local-new' });
    await waitFor(() => first.puts.length === 1);
    assert.equal(shared.data.value, 'local-new');
    assert.equal(shared.sync.pendingServerSync, true);

    const secondRequests = [];
    const second = createStorageTestHarness({
        shared,
        serverData: { value: 'server-stale' },
        putFactory() {
            const request = deferred();
            secondRequests.push(request);
            return request;
        },
    });
    await initTestStorage(second.storage);
    await waitFor(() => second.puts.length === 1);

    assert.equal(second.getCount(), 1);
    assert.equal(second.storage.load().value, 'local-new');
    assert.equal(second.puts[0].body.value, 'local-new');
    secondRequests[0].resolve({ ok: true, json: async () => ({ ok: true }) });
    assert.equal(await second.storage.flush(), true);
});

test('backend data HTTP failure keeps the server untouched', async () => {
    const harness = createStorageTestHarness({
        getFactory() {
            return Promise.resolve({ ok: false, status: 500, json: async () => ({ ok: false }) });
        },
    });

    await initTestStorage(harness.storage);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(harness.puts.length, 0);
    assert.equal(harness.storage.getSyncState().pendingServerSync, false);
});

test('backend data fetch rejection keeps the server untouched', async () => {
    const harness = createStorageTestHarness({
        getFactory() { return Promise.reject(new Error('connection reset')); },
    });

    await initTestStorage(harness.storage);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(harness.puts.length, 0);
});

test('backend data timeout becomes an error and releases storage readiness without a PUT', async () => {
    const harness = createStorageTestHarness({
        serverReadTimeoutMs: 5,
        getFactory() { return new Promise(() => {}); },
    });

    await initTestStorage(harness.storage);

    assert.equal(harness.storage.isReady(), true);
    assert.equal(harness.puts.length, 0);
    assert.equal(harness.storage.getServerMode(), false);
});

test('backend data body timeout becomes an error and releases storage readiness without a PUT', async () => {
    const harness = createStorageTestHarness({
        serverReadTimeoutMs: 5,
        getFactory() {
            return Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
        },
    });

    await initTestStorage(harness.storage);

    assert.equal(harness.storage.isReady(), true);
    assert.equal(harness.puts.length, 0);
    assert.equal(harness.storage.getServerMode(), false);
});

test('backend status error keeps an absent legacy migration source untouched', async (t) => {
    const previousLocalStorage = global.localStorage;
    const legacyRaw = JSON.stringify({ value: 'legacy-status-recovery' });
    const memory = createMemoryLocalStorage({ theme_mgr_v2: legacyRaw });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        statusFactory() { return Promise.reject(new Error('status offline')); },
    });

    await initTestStorage(harness.storage);
    await assert.rejects(
        harness.storage.save({ value: 'must-stay-session-only' }),
        /not authoritative enough to overwrite/,
    );

    assert.equal(harness.localWriteCount(), 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.value('theme_mgr_v2'), legacyRaw);
});

test('backend status ok false is an error and cannot authorize legacy migration', async (t) => {
    const previousLocalStorage = global.localStorage;
    const legacyRaw = JSON.stringify({ value: 'legacy-status-ok-false' });
    const memory = createMemoryLocalStorage({ theme_mgr_v2: legacyRaw });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        statusFactory() {
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: false }) });
        },
    });

    await initTestStorage(harness.storage);

    assert.equal(harness.localWriteCount(), 0);
    assert.equal(memory.value('theme_mgr_v2'), legacyRaw);
});

test('backend data invalid JSON keeps the server untouched', async () => {
    const harness = createStorageTestHarness({
        getFactory() {
            return Promise.resolve({
                ok: true,
                json: async () => { throw new SyntaxError('invalid JSON'); },
            });
        },
    });

    await initTestStorage(harness.storage);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(harness.puts.length, 0);
});

test('backend data ok false body keeps the server untouched', async () => {
    const harness = createStorageTestHarness({
        getFactory() {
            return Promise.resolve({ ok: true, json: async () => ({ ok: false, data: null }) });
        },
    });

    await initTestStorage(harness.storage);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(harness.puts.length, 0);
});

test('only an explicit authoritative absent response permits the first server seed', async () => {
    const harness = createStorageTestHarness({ serverData: null });

    await initTestStorage(harness.storage);
    await waitFor(() => harness.puts.length === 1, 'authoritative absent did not seed the server');

    assert.equal(harness.getCount(), 1);
    assert.equal(harness.puts[0].body.value, 'default');
});

test('local data remains usable after backend GET error without any server write', async () => {
    const shared = { data: { value: 'local-safe' }, sync: null };
    const harness = createStorageTestHarness({
        shared,
        getFactory() { return Promise.reject(new Error('offline')); },
    });

    await initTestStorage(harness.storage);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(harness.storage.load().value, 'local-safe');
    assert.equal(harness.puts.length, 0);
});

test('pending local data remains pending after backend GET error and flush stays fail closed', async () => {
    const shared = {
        data: { value: 'pending-local' },
        sync: { localRevision: 4, lastAckRevision: 3, pendingServerSync: true },
    };
    const harness = createStorageTestHarness({
        shared,
        getFactory() { return Promise.reject(new Error('offline')); },
    });

    await initTestStorage(harness.storage);

    assert.equal(harness.storage.getSyncState().pendingServerSync, true);
    assert.equal(await harness.storage.flush(), false);
    assert.equal(harness.puts.length, 0);
});

test('backend GET error blocks image uploads until server data authority is re-established', async () => {
    const harness = createStorageTestHarness({
        getFactory() { return Promise.reject(new Error('offline')); },
    });

    await initTestStorage(harness.storage);
    const originalDataUrl = 'data:image/png;base64,AAAA';
    const resolvedUrl = await new Promise((resolve) => {
        harness.storage.uploadImage(originalDataUrl, (_error, url) => resolve(url));
    });

    assert.equal(resolvedUrl, originalDataUrl);
    assert.equal(harness.imagePosts.length, 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(harness.storage.getServerMode(), false);
});

test('backend GET error blocks image batch requests until server data authority is re-established', async () => {
    const harness = createStorageTestHarness({
        getFactory() { return Promise.reject(new Error('offline')); },
    });

    await initTestStorage(harness.storage);
    const url = '/server/images/example.png';
    const images = await new Promise((resolve) => {
        harness.storage.batchResolveImages([url], resolve);
    });

    assert.deepEqual(clone(images), { [url]: url });
    assert.equal(harness.imageBatchPosts.length, 0);
});

test('backend GET error cannot promote generated defaults into a later pending overwrite', async () => {
    const shared = { data: null, sync: null };
    const first = createStorageTestHarness({
        shared,
        getFactory() { return Promise.reject(new Error('offline')); },
    });

    await initTestStorage(first.storage);
    await assert.rejects(
        first.storage.save({ value: 'default-derived-session' }),
        /not authoritative enough to overwrite/,
    );

    assert.equal(shared.data, null);
    assert.equal(first.puts.length, 0);

    const second = createStorageTestHarness({ shared, serverData: { value: 'server-correct' } });
    await initTestStorage(second.storage);

    assert.equal(second.storage.load().value, 'server-correct');
    assert.equal(second.puts.length, 0);
});

test('existing current data is never replaced by a legacy snapshot selected only by themeMeta', async (t) => {
    const previousLocalStorage = global.localStorage;
    const legacy = {
        themeMeta: { Old: { note: 'legacy' } },
        categories: ['Legacy'],
        settings: 'old',
    };
    const memory = createMemoryLocalStorage({ theme_mgr_v2: JSON.stringify(legacy) });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const current = {
        themeMeta: {},
        categories: ['A'],
        pairs: [{ id: 'pair-current' }],
        bindings: { manualTarget: 'Current' },
        settings: 'new',
    };
    const harness = createStorageTestHarness({
        server: false,
        shared: { data: clone(current), sync: null },
    });

    await initTestStorage(harness.storage);

    assert.deepEqual(harness.storage.load().themeMeta, {});
    assert.deepEqual(harness.storage.load().categories, ['A']);
    assert.deepEqual(harness.storage.load().pairs, [{ id: 'pair-current' }]);
    assert.deepEqual(harness.storage.load().bindings, { manualTarget: 'Current' });
    assert.equal(harness.storage.load().settings, 'new');
    assert.equal(memory.has('theme_mgr_v2'), true);
    assert.equal(harness.puts.length, 0);
});

test('genuinely absent current storage may migrate a valid legacy snapshot', async (t) => {
    const previousLocalStorage = global.localStorage;
    const legacy = { value: 'legacy-safe', themeMeta: { Old: { note: 'kept' } } };
    const memory = createMemoryLocalStorage({ theme_mgr_v2: JSON.stringify(legacy) });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const shared = { data: null, sync: null };
    const harness = createStorageTestHarness({ server: false, shared });

    await initTestStorage(harness.storage);

    assert.equal(harness.storage.load().value, 'legacy-safe');
    assert.equal(shared.data.value, 'legacy-safe');
    assert.deepEqual(shared.data.themeMeta, legacy.themeMeta);
});

test('current storage read error cannot turn legacy data into an automatic migration or server seed', async (t) => {
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({
        theme_mgr_v2: JSON.stringify({ value: 'legacy-session-copy', settings: 'old' }),
    });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        localReadError: new Error('IndexedDB read failed'),
        serverData: null,
    });

    await initTestStorage(harness.storage);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(harness.storage.load().value, 'legacy-session-copy');
    assert.equal(harness.localWriteCount(), 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.has('theme_mgr_v2'), true);
});

test('current storage read error blocks later saves from overwriting the unknown current snapshot', async (t) => {
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({
        theme_mgr_v2: JSON.stringify({ value: 'legacy-session-copy' }),
    });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        localReadError: new Error('IndexedDB read failed'),
        serverData: null,
    });

    await initTestStorage(harness.storage);
    await assert.rejects(
        harness.storage.save({ value: 'must-remain-session-only' }),
        /not authoritative enough to overwrite/,
    );

    assert.equal(harness.localWriteCount(), 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.value('theme_mgr_v2'), JSON.stringify({ value: 'legacy-session-copy' }));
});

test('current storage read error cannot let a present server overwrite local recovery data', async (t) => {
    const previousLocalStorage = global.localStorage;
    const legacyRaw = JSON.stringify({ value: 'legacy-recovery' });
    const memory = createMemoryLocalStorage({ theme_mgr_v2: legacyRaw });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        localReadError: new Error('IndexedDB read failed'),
        serverData: { value: 'server-present' },
    });

    await initTestStorage(harness.storage);

    assert.equal(harness.storage.load().value, 'legacy-recovery');
    assert.equal(harness.localWriteCount(), 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.value('theme_mgr_v2'), legacyRaw);
});

test('backend GET error leaves a pending legacy migration source completely untouched', async (t) => {
    const previousLocalStorage = global.localStorage;
    const legacyRaw = JSON.stringify({ value: 'legacy-pending' });
    const syncRaw = JSON.stringify({
        localRevision: 7,
        lastAckRevision: 6,
        pendingServerSync: true,
    });
    const memory = createMemoryLocalStorage({
        theme_mgr_v2: legacyRaw,
        'theme_mgr_v2:sync-state': syncRaw,
    });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        getFactory() { return Promise.reject(new Error('offline')); },
    });

    await initTestStorage(harness.storage);

    assert.equal(harness.localWriteCount(), 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.value('theme_mgr_v2'), legacyRaw);
    assert.equal(memory.value('theme_mgr_v2:sync-state'), syncRaw);
});

test('authoritative pending legacy data survives a present stale server and syncs only after durable migration', async (t) => {
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({
        theme_mgr_v2: JSON.stringify({ value: 'legacy-newer' }),
        'theme_mgr_v2:sync-state': JSON.stringify({
            localRevision: 7,
            lastAckRevision: 6,
            pendingServerSync: true,
        }),
    });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const shared = { data: null, sync: null };
    const harness = createStorageTestHarness({
        shared,
        serverData: { value: 'server-stale' },
    });

    await initTestStorage(harness.storage);
    await waitFor(() => harness.puts.length === 1, 'pending legacy snapshot was not synced');

    assert.equal(harness.storage.load().value, 'legacy-newer');
    assert.equal(shared.data.value, 'legacy-newer');
    assert.equal(harness.puts[0].body.value, 'legacy-newer');
    assert.equal(memory.has('theme_mgr_v2'), false);
});

test('orphan current sync record fails closed without promoting legacy or overwriting from server', async (t) => {
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({
        theme_mgr_v2: JSON.stringify({ value: 'legacy-not-pending' }),
        'theme_mgr_v2:sync-state': JSON.stringify({
            localRevision: 2,
            lastAckRevision: 2,
            pendingServerSync: false,
        }),
    });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        localReadResult: {
            status: 'absent',
            data: null,
            sync: { localRevision: 9, lastAckRevision: 8, pendingServerSync: true },
        },
        serverData: { value: 'server-authoritative' },
    });

    await initTestStorage(harness.storage);

    assert.equal(harness.storage.load().value, 'default');
    assert.equal(harness.localWriteCount(), 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.has('theme_mgr_v2'), true);
});

test('malformed legacy data is retained and cannot authorize defaults or a server seed', async (t) => {
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({ theme_mgr_v2: '{not-json' });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({ serverData: null });

    await initTestStorage(harness.storage);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(harness.localWriteCount(), 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.has('theme_mgr_v2'), true);
});

test('failed legacy migration destination write preserves the legacy source', async (t) => {
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({
        theme_mgr_v2: JSON.stringify({ value: 'legacy-only-copy' }),
    });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        serverData: null,
        localWriteError: new Error('quota exceeded'),
    });

    await initTestStorage(harness.storage);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(harness.storage.load().value, 'legacy-only-copy');
    assert.equal(harness.localWriteCount(), 1);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.has('theme_mgr_v2'), true);
});

test('an unconfirmed local migration write result preserves legacy and blocks server seed', async (t) => {
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({
        theme_mgr_v2: JSON.stringify({ value: 'legacy-unconfirmed' }),
    });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        serverData: null,
        localWriteFactory() { return false; },
    });

    await initTestStorage(harness.storage);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(harness.localWriteCount(), 1);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.has('theme_mgr_v2'), true);
});

test('legacy image migration does not upload before the destination is durable', async (t) => {
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({
        theme_mgr_v2: JSON.stringify({ value: 'legacy-image', imageData: 'data:image/png;base64,AAAA' }),
    });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const harness = createStorageTestHarness({
        serverData: null,
        localWriteError: new Error('quota exceeded'),
        imageFieldKeys: { imageData: true },
    });

    await initTestStorage(harness.storage);

    assert.equal(harness.localWriteCount(), 1);
    assert.equal(harness.imagePosts.length, 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.has('theme_mgr_v2'), true);
});

test('legacy source is removed only after the migration destination resolves durably', async (t) => {
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({
        theme_mgr_v2: JSON.stringify({ value: 'legacy-durable' }),
        'theme_mgr_v2:sync-state': JSON.stringify({ pendingServerSync: false }),
    });
    global.localStorage = memory;
    t.after(() => {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });
    const destinationWrite = deferred();
    const harness = createStorageTestHarness({
        server: false,
        localWriteFactory() { return destinationWrite.promise; },
    });

    const initialization = initTestStorage(harness.storage);
    await waitFor(() => harness.localWriteCount() === 1, 'legacy destination write did not start');
    assert.equal(memory.has('theme_mgr_v2'), true);

    destinationWrite.resolve(true);
    await initialization;

    assert.equal(memory.has('theme_mgr_v2'), false);
    assert.equal(memory.has('theme_mgr_v2:sync-state'), false);
});

test('IndexedDB open error keeps legacy data session-only and performs zero writes', async (t) => {
    const previousIndexedDB = global.indexedDB;
    const previousLocalStorage = global.localStorage;
    const legacyRaw = JSON.stringify({ value: 'legacy-open-recovery' });
    const memory = createMemoryLocalStorage({ theme_mgr_v2: legacyRaw });
    const fake = createFakeIndexedDB('open-error');
    global.indexedDB = fake;
    global.localStorage = memory;
    t.after(() => {
        if (previousIndexedDB === undefined) delete global.indexedDB;
        else global.indexedDB = previousIndexedDB;
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });

    const harness = createStorageTestHarness({ useIndexedDB: true, serverData: null });
    await initTestStorage(harness.storage);

    assert.equal(harness.storage.load().value, 'legacy-open-recovery');
    assert.equal(fake.stats.writeTransactions, 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.value('theme_mgr_v2'), legacyRaw);
    assert.deepEqual(memory.removed, []);
});

for (const [mode, label] of [
    ['transaction-error', 'transaction error'],
    ['transaction-abort', 'transaction abort'],
    ['request-error', 'request error'],
]) {
    test(`IndexedDB ${label} is not treated as empty storage`, async (t) => {
        const previousIndexedDB = global.indexedDB;
        const previousLocalStorage = global.localStorage;
        const legacyRaw = JSON.stringify({ value: `legacy-${mode}` });
        const memory = createMemoryLocalStorage({ theme_mgr_v2: legacyRaw });
        const fake = createFakeIndexedDB(mode);
        global.indexedDB = fake;
        global.localStorage = memory;
        t.after(() => {
            if (previousIndexedDB === undefined) delete global.indexedDB;
            else global.indexedDB = previousIndexedDB;
            if (previousLocalStorage === undefined) delete global.localStorage;
            else global.localStorage = previousLocalStorage;
        });

        const harness = createStorageTestHarness({ useIndexedDB: true, serverData: null });
        await initTestStorage(harness.storage);

        assert.equal(harness.storage.load().value, `legacy-${mode}`);
        assert.equal(fake.stats.writeTransactions, 0);
        assert.equal(harness.puts.length, 0);
        assert.equal(memory.value('theme_mgr_v2'), legacyRaw);
        assert.deepEqual(memory.removed, []);
    });
}

test('truly absent IndexedDB state follows safe first initialization', async (t) => {
    const previousIndexedDB = global.indexedDB;
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage();
    const shared = { data: null, sync: null };
    const fake = createFakeIndexedDB('success', shared);
    global.indexedDB = fake;
    global.localStorage = memory;
    t.after(() => {
        if (previousIndexedDB === undefined) delete global.indexedDB;
        else global.indexedDB = previousIndexedDB;
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });

    const harness = createStorageTestHarness({ useIndexedDB: true, server: false });
    await initTestStorage(harness.storage);

    assert.equal(harness.storage.load().value, 'default');
    assert.equal(shared.data.value, 'default');
    assert.equal(fake.stats.writeTransactions, 1);
    assert.equal(harness.puts.length, 0);
});

test('malformed legacy JSON cannot turn an absent IndexedDB into default persistence', async (t) => {
    const previousIndexedDB = global.indexedDB;
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage({ theme_mgr_v2: '' });
    const fake = createFakeIndexedDB('success', { data: null, sync: null });
    global.indexedDB = fake;
    global.localStorage = memory;
    t.after(() => {
        if (previousIndexedDB === undefined) delete global.indexedDB;
        else global.indexedDB = previousIndexedDB;
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });

    const harness = createStorageTestHarness({ useIndexedDB: true, serverData: null });
    await initTestStorage(harness.storage);

    assert.equal(harness.storage.load().value, 'default');
    assert.equal(fake.stats.writeTransactions, 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(memory.value('theme_mgr_v2'), '');
    assert.deepEqual(memory.removed, []);
});

test('orphan current sync metadata is an error instead of proof that current data is absent', async (t) => {
    const previousIndexedDB = global.indexedDB;
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage();
    const fake = createFakeIndexedDB('success', {
        data: null,
        sync: { version: 1, localRevision: 4, lastAckRevision: 3, pendingServerSync: true, localUpdatedAt: 1 },
    });
    global.indexedDB = fake;
    global.localStorage = memory;
    t.after(() => {
        if (previousIndexedDB === undefined) delete global.indexedDB;
        else global.indexedDB = previousIndexedDB;
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });

    const harness = createStorageTestHarness({ useIndexedDB: true, serverData: null });
    await initTestStorage(harness.storage);

    assert.equal(fake.stats.writeTransactions, 0);
    assert.equal(harness.puts.length, 0);
    assert.equal(harness.storage.getSyncState().pendingServerSync, false);
});

test('invalid current sync revisions retain current data read-only and perform zero writes', async (t) => {
    const previousIndexedDB = global.indexedDB;
    const previousLocalStorage = global.localStorage;
    const memory = createMemoryLocalStorage();
    const shared = {
        data: { value: 'current-safe-copy' },
        sync: { version: 1, localRevision: 1, lastAckRevision: 2, pendingServerSync: false, localUpdatedAt: 1 },
    };
    const fake = createFakeIndexedDB('success', shared);
    global.indexedDB = fake;
    global.localStorage = memory;
    t.after(() => {
        if (previousIndexedDB === undefined) delete global.indexedDB;
        else global.indexedDB = previousIndexedDB;
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
    });

    const harness = createStorageTestHarness({ useIndexedDB: true, serverData: null });
    await initTestStorage(harness.storage);

    assert.equal(harness.storage.load().value, 'current-safe-copy');
    assert.equal(fake.stats.writeTransactions, 0);
    assert.equal(harness.puts.length, 0);
});

test('FAB stays absent while storage readiness is delayed beyond the former 1.5 second injection', async () => {
    const originalDocument = global.document;
    const ready = deferred();
    let storageReady = false;
    let loadCount = 0;
    let createdCount = 0;
    let intervalCount = 0;
    global.document = {
        getElementById() { return null; },
        createElement() { createdCount += 1; return {}; },
        body: { appendChild() { createdCount += 1; } },
    };

    try {
        const events = modules.createUiEvents({
            fabId: 'test-fab',
            buttonId: 'test-button',
            launcherName: 'test',
            version: 'test',
            load() { loadCount += 1; return { showBall: false }; },
            save() {},
            esc(value) { return value; },
            getCurrentThemeName() { return ''; },
            openPopup() {},
            toast() {},
            getSupportState() { return { ready: true, failed: false }; },
            requestOpenAfterReady() {},
            whenStorageReady() { return ready.promise; },
            isStorageReady() { return storageReady; },
            setInterval() { intervalCount += 1; return 1; },
        });

        events.startFabInjection();
        await new Promise((resolve) => setTimeout(resolve, 1550));
        assert.equal(loadCount, 0);
        assert.equal(createdCount, 0);
        assert.equal(intervalCount, 0);

        storageReady = true;
        ready.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(loadCount, 1);
        assert.equal(createdCount, 0);
        assert.equal(intervalCount, 1);
    } finally {
        global.document = originalDocument;
    }
});

test('preview view normalization clamps v2 focus values and supplies safe defaults', () => {
    assert.deepEqual(imageTools.normalizePreviewView({
        version: 2,
        mode: 'focus',
        zoom: 8,
        posX: -12,
        posY: 140,
    }), {
        version: 2,
        mode: 'focus',
        zoom: 3,
        posX: 0,
        posY: 100,
    });
    assert.deepEqual(imageTools.normalizePreviewView(null), {
        version: 2,
        mode: 'focus',
        zoom: 1,
        posX: 50,
        posY: 50,
    });
});

test('preview view resolves legacy slider values and clamps zoom below one', () => {
    assert.deepEqual(imageTools.resolvePreviewView({
        zoom: 0.35,
        posX: 18,
        posY: 82,
    }), {
        version: 2,
        mode: 'focus',
        zoom: 1,
        posX: 18,
        posY: 82,
    });
});

test('preview view derives focus and zoom from legacy pixel crop geometry', () => {
    assert.deepEqual(imageTools.resolvePreviewView({
        x: 600,
        y: 0,
        width: 800,
        height: 600,
        naturalWidth: 1600,
        naturalHeight: 1200,
    }), {
        version: 2,
        mode: 'focus',
        zoom: 2,
        posX: 75,
        posY: 0,
    });
});

test('preview asset uses the full image instead of a legacy cropped thumbnail', () => {
    const asset = imageTools.resolvePreviewAsset({
        imageData: 'full-image.jpg',
        thumbData: 'legacy-cropped-thumb.jpg',
        crop: {
            x: 600,
            y: 0,
            width: 800,
            height: 600,
            naturalWidth: 1600,
            naturalHeight: 1200,
        },
    });

    assert.equal(asset.src, 'full-image.jpg');
    assert.deepEqual(asset.view, {
        version: 2,
        mode: 'focus',
        zoom: 2,
        posX: 75,
        posY: 0,
    });
});

test('preview asset prefers a full-composition thumbnail for a v2 focus view', () => {
    const view = { version: 2, mode: 'focus', zoom: 1.75, posX: 24, posY: 76 };
    const asset = imageTools.resolvePreviewAsset({
        imageData: 'original-image.jpg',
        thumbData: 'full-composition-thumb.jpg',
        crop: view,
    });

    assert.equal(asset.src, 'full-composition-thumb.jpg');
    assert.deepEqual(asset.view, view);
});

test('preview asset gives a legacy thumbnail the default view when no full image exists', () => {
    const asset = imageTools.resolvePreviewAsset({
        thumbData: 'legacy-only-thumb.jpg',
        crop: { zoom: 2.5, posX: 5, posY: 95 },
    });

    assert.equal(asset.src, 'legacy-only-thumb.jpg');
    assert.deepEqual(asset.view, {
        version: 2,
        mode: 'focus',
        zoom: 1,
        posX: 50,
        posY: 50,
    });
});

test('missing preview merge leaves an existing local image and its empty companion fields untouched', () => {
    const target = {
        author: 'Local Author',
        imageData: 'local-full-image.jpg',
        thumbData: null,
        crop: null,
    };
    const before = clone(target);
    const incoming = {
        imageData: 'incoming-full-image.jpg',
        thumbData: 'incoming-full-composition-thumb.jpg',
        crop: { version: 2, mode: 'focus', zoom: 1.8, posX: 30, posY: 70 },
    };

    imageTools.mergeMissingPreview(target, incoming);

    assert.deepEqual(target, before);
});

test('missing preview merge copies the complete incoming preview atomically into an empty local target', () => {
    const target = {
        author: 'Local Author',
        imageData: null,
        thumbData: null,
        crop: null,
    };
    const incoming = {
        imageData: 'incoming-full-image.jpg',
        thumbData: 'incoming-full-composition-thumb.jpg',
        crop: { version: 2, mode: 'focus', zoom: 2.2, posX: 20, posY: 80 },
    };

    imageTools.mergeMissingPreview(target, incoming);

    assert.deepEqual(target, {
        author: 'Local Author',
        imageData: 'incoming-full-image.jpg',
        thumbData: 'incoming-full-composition-thumb.jpg',
        crop: { version: 2, mode: 'focus', zoom: 2.2, posX: 20, posY: 80 },
    });
    incoming.crop.posX = 99;
    assert.equal(target.crop.posX, 20);
});

function makeRuntimeForTransfer(inventory, resolveOverride) {
    const cache = Object.create(null);
    return {
        invalidate() {},
        getInventory() { return Promise.resolve(clone(inventory)); },
        findTheme(themes, name) { return (themes || []).find((theme) => theme && theme.name === name) || null; },
        resolveUsableTheme(name, candidate) {
            if (resolveOverride) return resolveOverride(name, candidate);
            if (!schema.isUsableTheme(candidate, name)) {
                const error = new Error(`incomplete: ${name}`);
                error.code = 'incomplete';
                return Promise.reject(error);
            }
            return Promise.resolve(clone(candidate));
        },
        remember(theme) { cache[theme.name] = clone(theme); },
        replaceInventory(themes) {
            Object.keys(cache).forEach((name) => { delete cache[name]; });
            (themes || []).forEach((theme) => {
                if (schema.isUsableTheme(theme, theme && theme.name)) cache[theme.name] = clone(theme);
            });
        },
        hydrate() { return true; },
        cache,
    };
}

function makeTransactionHarness(initialThemes, hooks) {
    hooks = hooks || {};
    const store = Object.create(null);
    (initialThemes || []).forEach((theme) => { store[theme.name] = clone(theme); });
    const calls = [];
    const remembered = Object.create(null);
    let saveCount = 0;
    let deleteCount = 0;
    let inventoryCount = 0;
    let headerCount = 0;

    const api = {
        getPostHeaders() {
            headerCount += 1;
            if (hooks.headerErrorAt === headerCount) return Promise.reject(new Error('injected header failure'));
            return Promise.resolve({ 'X-Test': String(headerCount) });
        },
        saveTheme(theme, headers) {
            saveCount += 1;
            calls.push({ type: 'save', name: theme.name, theme: clone(theme), headers });
            if (hooks.saveErrorAt === saveCount) return Promise.reject(new Error('injected save failure'));
            let written = clone(theme);
            if (typeof hooks.transformSave === 'function') written = hooks.transformSave(written, saveCount);
            store[written.name] = written;
            return Promise.resolve(written);
        },
        deleteTheme(name, headers) {
            deleteCount += 1;
            calls.push({ type: 'delete', name, headers });
            if (typeof hooks.onDelete === 'function') hooks.onDelete(name, deleteCount);
            if (hooks.deleteErrorAt === deleteCount || hooks.deleteErrorName === name) {
                return Promise.reject(new Error('injected delete failure'));
            }
            delete store[name];
            return Promise.resolve(true);
        },
    };

    const runtime = {
        invalidate() {},
        getInventory(options) {
            inventoryCount += 1;
            if (hooks.inventoryErrorAt === inventoryCount) return Promise.reject(new Error('injected inventory failure'));
            let inventory = Object.values(store).map(clone);
            if (typeof hooks.transformInventory === 'function') {
                inventory = hooks.transformInventory(inventory, inventoryCount, store, options);
            }
            return Promise.resolve(clone(inventory));
        },
        findTheme(themes, name) { return (themes || []).find((theme) => theme && theme.name === name) || null; },
        resolveUsableTheme(name, candidate) {
            if (!schema.isUsableTheme(candidate, name)) {
                const error = new Error(`incomplete: ${name}`);
                error.code = 'incomplete';
                return Promise.reject(error);
            }
            return Promise.resolve(clone(candidate));
        },
        getBridge() { return hooks.bridge || null; },
        remember(theme) { remembered[theme.name] = clone(theme); },
        forget(name) { delete remembered[name]; },
        getCached(name) {
            const cached = hooks.cachedThemes && hooks.cachedThemes[name]
                ? hooks.cachedThemes[name]
                : remembered[name];
            return cached ? clone(cached) : null;
        },
        hydrate() { return true; },
    };

    return {
        store,
        calls,
        remembered,
        runtime,
        getInventoryCount() { return inventoryCount; },
        getHeaderCount() { return headerCount; },
        transactions: modules.createThemeTransactions({ schema, api, runtime }),
    };
}

test('theme schema distinguishes lazy placeholders, legacy partials, and complete themes', () => {
    const markedWithData = { name: 'Lazy', main_text_color: '#fff', __baibaokuLazyTheme: true };
    const nameOnly = { name: 'Empty' };
    const partial = { name: 'Legacy', custom_css: '' };
    const complete = completeTheme('Complete');

    assert.equal(schema.isLazyThemePlaceholder(markedWithData, 'Lazy'), true);
    assert.equal(schema.isUsableTheme(markedWithData, 'Lazy'), false);
    assert.equal(schema.isLazyThemePlaceholder(nameOnly, 'Empty'), true);
    assert.equal(schema.isLegacyPartialTheme(partial, 'Legacy'), true);
    assert.equal(schema.isUsableTheme(partial, 'Legacy'), true);
    assert.equal(schema.isCompleteTheme(partial, 'Legacy'), false);
    assert.equal(schema.isCompleteTheme(complete, 'Complete'), true);
});

test('SillyTavern-compatible normalization uses a stable baseline and preserves explicit partial fields', () => {
    const baseline = completeBaseline({ main_text_color: '#baseline', custom_css: 'baseline css' });
    const partial = { name: 'Legacy', main_text_color: '#legacy', custom_css: '', noShadows: false };
    const normalized = schema.normalizeImportedThemeLikeSillyTavern(partial, baseline);

    assert.equal(schema.isCompleteTheme(normalized, 'Legacy'), true);
    assert.equal(normalized.main_text_color, '#legacy');
    assert.equal(normalized.custom_css, '');
    assert.equal(normalized.noShadows, false);
    assert.equal(normalized.quote_text_color, baseline.quote_text_color);
    assert.equal(partial.quote_text_color, undefined);
    assert.equal(schema.normalizeImportedThemeLikeSillyTavern({ name: 'OnlyName' }, baseline), null);
});

test('filename sanitization detects names that map to the same SillyTavern file', () => {
    assert.equal(schema.sanitizeFilename('A:B'), schema.sanitizeFilename('AB'));
});

test('runtime accepts legacy partials directly but hydrates lazy placeholders', async (t) => {
    let ensureCalls = 0;
    const previousBridge = global.__baibaokuEarlyBridge;
    const previousHydrate = global.baibaokuHydrateTheme;
    t.after(() => {
        global.__baibaokuEarlyBridge = previousBridge;
        global.baibaokuHydrateTheme = previousHydrate;
    });
    global.__baibaokuEarlyBridge = {
        ensureThemeLoaded(name) {
            ensureCalls += 1;
            return Promise.resolve({ name, main_text_color: '#hydrated' });
        },
        clearSettingsGetCache() {},
    };
    global.baibaokuHydrateTheme = () => {};

    const api = {
        getSettingsInventory() { return Promise.resolve([]); },
        getRawSettingsInventory() { return Promise.resolve([]); },
    };
    const runtime = modules.createThemeRuntime({ schema, api });
    const legacy = await runtime.resolveUsableTheme('Legacy', { name: 'Legacy', custom_css: '' });
    const hydrated = await runtime.resolveUsableTheme('Lazy', { name: 'Lazy', __baibaokuLazyTheme: true });

    assert.deepEqual(legacy, { name: 'Legacy', custom_css: '' });
    assert.equal(ensureCalls, 1);
    assert.equal(hydrated.main_text_color, '#hydrated');
    assert.equal(Object.hasOwn(hydrated, schema.LAZY_THEME_MARKER), false);
    assert.deepEqual(runtime.getCached('Lazy'), hydrated);
});

test('runtime aborts when a lazy placeholder cannot hydrate', async (t) => {
    const previousBridge = global.__baibaokuEarlyBridge;
    t.after(() => { global.__baibaokuEarlyBridge = previousBridge; });
    global.__baibaokuEarlyBridge = { ensureThemeLoaded() { return Promise.resolve({ name: 'Lazy' }); } };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
    });
    await assert.rejects(
        runtime.resolveUsableTheme('Lazy', { name: 'Lazy', __baibaokuLazyTheme: true }),
        (error) => error.code === 'incomplete',
    );
});

test('confirmed current theme identity requires matching power user and native control state', async (t) => {
    const previousDocument = global.document;
    let powerUserTheme = 'A';
    let controlTheme = 'A';
    t.after(() => { global.document = previousDocument; });
    global.document = {
        getElementById(id) {
            if (id !== 'themes') return null;
            return {
                tagName: 'SELECT',
                selectedIndex: 0,
                options: [{ value: controlTheme, textContent: controlTheme }],
            };
        },
    };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
        loadPowerUserModule() { return Promise.resolve({ power_user: { theme: powerUserTheme } }); },
    });

    assert.deepEqual(await runtime.captureConfirmedCurrentThemeIdentity(), {
        status: 'known',
        name: 'A',
        powerUserTheme: 'A',
        controlTheme: 'A',
    });
    controlTheme = 'B';
    assert.equal((await runtime.captureConfirmedCurrentThemeIdentity()).status, 'unknown');
    controlTheme = 'A';
    powerUserTheme = '';
    assert.equal((await runtime.captureConfirmedCurrentThemeIdentity()).status, 'unknown');
});

test('theme appearance derives readable palettes from both light and dark beautifications', () => {
    const light = appearance.createPalette({
        text: 'rgba(77, 75, 79, 1)',
        background: 'rgba(255, 245, 250, 0.96)',
        accent: 'rgba(236, 190, 216, 1)',
    });
    const dark = appearance.createPalette({
        text: '#eeeeee',
        background: 'rgba(20, 18, 28, 0.94)',
        accent: '#8c73c9',
    });

    assert.equal(light.mode, 'light');
    assert.equal(dark.mode, 'dark');
    assert.ok(appearance.contrastRatio(
        appearance.parseCssColor(light.text),
        appearance.parseCssColor(light.background),
    ) >= 4.5);
    assert.ok(appearance.contrastRatio(
        appearance.parseCssColor(dark.text),
        appearance.parseCssColor(dark.background),
    ) >= 4.5);
    assert.ok(appearance.contrastRatio(
        appearance.parseCssColor(light.accent),
        appearance.parseCssColor(light.background),
    ) >= 3);
});

test('theme appearance safely falls back for transparent or malformed theme colors', () => {
    const palette = appearance.createPalette({
        text: 'not-a-color',
        background: 'rgba(0, 0, 0, 0)',
        chat: 'transparent',
        accent: 'also-invalid',
    });

    assert.match(palette.background, /^rgba\(/);
    assert.match(palette.text, /^rgba\(/);
    assert.equal(Object.values(palette).some((value) => String(value).includes('NaN')), false);
    assert.ok(appearance.contrastRatio(
        appearance.parseCssColor(palette.text),
        appearance.parseCssColor(palette.background),
    ) >= 4.5);
});

test('runtime evicts a detached batch inventory object from SillyTavern native theme cache', (t) => {
    const previousHydrate = global.baibaokuHydrateTheme;
    t.after(() => { global.baibaokuHydrateTheme = previousHydrate; });

    const nativeThemes = [completeTheme('Delete Me', { main_text_color: '#native-old' })];
    global.baibaokuHydrateTheme = (theme) => {
        const index = nativeThemes.findIndex((item) => item.name === theme.name);
        if (index === -1) nativeThemes.push(theme);
        else nativeThemes[index] = theme;
    };

    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
    });
    const detachedInventoryTheme = completeTheme('Delete Me', { main_text_color: '#detached' });

    runtime.evictNativeTheme('Delete Me', detachedInventoryTheme);

    assert.equal(nativeThemes.some((theme) => theme.name === 'Delete Me'), false);
    assert.equal(nativeThemes.find((theme) => theme.name === 'Delete Me'), undefined);
    assert.match(detachedInventoryTheme.name, /^__theme_mgr_deleted__/);
});

test('runtime replaces stale cached themes with the authoritative post-import inventory', () => {
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
    });
    runtime.remember({ name: 'Old cached theme', custom_css: 'old' });

    const inventory = [
        { name: '新主题 ✨', custom_css: 'new' },
        { name: 'Existing', main_text_color: '#123456' },
    ];
    runtime.replaceInventory(inventory);

    assert.equal(runtime.getCached('Old cached theme'), null);
    assert.deepEqual(runtime.getCached('新主题 ✨'), inventory[0]);
    assert.deepEqual(runtime.getCached('Existing'), inventory[1]);
});

test('native custom CSS edits invalidate only that theme and reload its newest saved definition', async (t) => {
    const previousDocument = global.document;
    const previousHydrate = global.baibaokuHydrateTheme;
    const previousBridge = global.__baibaokuEarlyBridge;
    const previousFetch = global.fetch;
    t.after(() => {
        global.document = previousDocument;
        global.baibaokuHydrateTheme = previousHydrate;
        global.__baibaokuEarlyBridge = previousBridge;
        global.fetch = previousFetch;
    });

    const handlers = {};
    const themeControl = { tagName: 'SELECT', selectedIndex: 0, options: [{ value: 'A' }] };
    const customCss = { id: 'customCSS', value: 'new css 1' };
    const customStyle = { textContent: 'new css 1' };
    global.document = {
        addEventListener(type, handler) { handlers[type] = handler; },
        getElementById(id) {
            if (id === 'themes') return themeControl;
            if (id === 'customCSS') return customCss;
            if (id === 'custom-style') return customStyle;
            return null;
        },
    };
    let serverTheme = completeTheme('A', { custom_css: 'new css 1' });
    let inventoryReads = 0;
    let bridgeClearCount = 0;
    let hydratedTheme = null;
    global.__baibaokuEarlyBridge = {
        clearSettingsGetCache() { bridgeClearCount += 1; },
    };
    global.baibaokuHydrateTheme = (theme) => { hydratedTheme = clone(theme); };
    const runtime = modules.createThemeRuntime({
        schema,
        api: {
            getSettingsInventory() { inventoryReads += 1; return Promise.resolve([clone(serverTheme)]); },
            getRawSettingsInventory() { throw new Error('raw fetch is not available'); },
        },
    });
    runtime.remember(completeTheme('A', { custom_css: 'old css' }));
    runtime.remember(completeTheme('B', { custom_css: 'B css' }));
    assert.equal(runtime.bindNativeEditTracking(), true);

    handlers.input({ target: customCss });
    assert.equal(runtime.getCached('A'), null);
    assert.equal(runtime.getCached('B').custom_css, 'B css');
    const first = await runtime.prepareUsableThemeForApply('A');
    assert.equal(first.theme.custom_css, 'new css 1');
    assert.equal(hydratedTheme.custom_css, 'new css 1');
    assert.equal(inventoryReads, 1);
    assert.equal(bridgeClearCount, 1);

    customCss.value = 'new css 2';
    customStyle.textContent = 'new css 2';
    serverTheme = completeTheme('A', { custom_css: 'new css 2' });
    handlers.change({ target: customCss });
    const second = await runtime.prepareUsableThemeForApply('A');
    assert.equal(second.theme.custom_css, 'new css 2');
    assert.equal(hydratedTheme.custom_css, 'new css 2');
    assert.equal(inventoryReads, 2);
    assert.equal(bridgeClearCount, 2);
    assert.equal(runtime.getCached('B').custom_css, 'B css');
});

test('live CSS mismatch remains transient when the native edit event was missed and refresh is stale', async (t) => {
    const previousDocument = global.document;
    const previousHydrate = global.baibaokuHydrateTheme;
    t.after(() => {
        global.document = previousDocument;
        global.baibaokuHydrateTheme = previousHydrate;
    });
    const staleServerTheme = completeTheme('A', { custom_css: 'server still old css' });
    const themeControl = { tagName: 'SELECT', selectedIndex: 0, options: [{ value: 'A' }] };
    global.document = {
        getElementById(id) {
            if (id === 'themes') return themeControl;
            if (id === 'customCSS') return { value: 'saved new css' };
            if (id === 'custom-style') return { textContent: 'saved new css' };
            return null;
        },
    };
    let inventoryReads = 0;
    let hydrated = null;
    global.baibaokuHydrateTheme = (theme) => { hydrated = clone(theme); };
    const runtime = modules.createThemeRuntime({
        schema,
        api: {
            getSettingsInventory() { inventoryReads += 1; return Promise.resolve([staleServerTheme]); },
            getRawSettingsInventory() { return Promise.resolve([staleServerTheme]); },
        },
    });
    runtime.remember(completeTheme('A', { custom_css: 'cached old css' }));

    const prepared = await runtime.prepareUsableThemeForApply('A');

    assert.equal(prepared.theme.custom_css, 'saved new css');
    assert.equal(hydrated.custom_css, 'saved new css');
    assert.equal(inventoryReads, 1);
    assert.equal(runtime.getCached('A'), null);
});

function createNativeCssSaveSyncHarness(t, options) {
    options = options || {};
    const previousDocument = global.document;
    const previousHydrate = global.baibaokuHydrateTheme;
    const previousBridge = global.__baibaokuEarlyBridge;
    const previousFetch = global.fetch;
    const handlers = {};
    const names = ['A', 'B', 'C'];
    const themeControl = {
        tagName: 'SELECT',
        selectedIndex: 0,
        options: names.map((name) => ({ value: name, textContent: name })),
    };
    const customCss = { id: 'customCSS', value: 'old css' };
    const customStyle = { textContent: 'old css' };
    const serverThemes = {
        A: completeTheme('A', { custom_css: 'old css' }),
        B: completeTheme('B', { custom_css: 'B css' }),
        C: completeTheme('C', { custom_css: 'C css' }),
    };
    let inventoryReads = 0;
    let bridgeClearCount = 0;
    const hydrated = [];
    const fetchCalls = [];

    global.document = {
        addEventListener(type, handler) { handlers[type] = handler; },
        getElementById(id) {
            if (id === 'themes') return themeControl;
            if (id === 'customCSS') return customCss;
            if (id === 'custom-style') return customStyle;
            return null;
        },
    };
    global.__baibaokuEarlyBridge = {
        clearSettingsGetCache() { bridgeClearCount += 1; },
    };
    global.baibaokuHydrateTheme = (theme) => { hydrated.push(clone(theme)); };
    global.fetch = (url, init) => {
        fetchCalls.push({ url: String(url), init: clone(init || {}) });
        return Promise.resolve({ ok: options.saveOk !== false, status: options.saveOk === false ? 500 : 200 });
    };

    const runtime = modules.createThemeRuntime({
        schema,
        api: {
            getSettingsInventory() {
                inventoryReads += 1;
                return Promise.resolve(Object.values(serverThemes).map(clone));
            },
            getRawSettingsInventory() {
                inventoryReads += 1;
                return Promise.resolve(Object.values(serverThemes).map(clone));
            },
        },
    });
    Object.values(serverThemes).forEach((theme) => runtime.remember(clone(theme)));
    assert.equal(runtime.bindNativeEditTracking(), true);

    function setCurrent(name) {
        themeControl.selectedIndex = names.indexOf(name);
    }

    function setLiveCss(css) {
        customCss.value = css;
        customStyle.textContent = css;
    }

    function editDraft(css, event) {
        setLiveCss(css);
        handlers.input(Object.assign({ target: customCss }, event || {}));
    }

    function saveTheme(theme) {
        return global.fetch('/api/themes/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(theme),
        });
    }

    t.after(() => {
        global.document = previousDocument;
        global.baibaokuHydrateTheme = previousHydrate;
        global.__baibaokuEarlyBridge = previousBridge;
        global.fetch = previousFetch;
    });

    return {
        runtime,
        handlers,
        serverThemes,
        fetchCalls,
        hydrated,
        customCss,
        customStyle,
        setCurrent,
        setLiveCss,
        editDraft,
        saveTheme,
        inventoryReads: () => inventoryReads,
        bridgeClearCount: () => bridgeClearCount,
    };
}

test('editor draft closes cleanly without changes', () => {
    const baseline = { note: 'same', tags: ['one'] };
    const session = editorDraft.createSession(baseline);
    assert.equal(session.isDirty(clone(baseline)), false);
});

test('editor draft detects a changed note', () => {
    const session = editorDraft.createSession({ note: 'before' });
    assert.equal(session.isDirty({ note: 'after' }), true);
});

test('editor draft becomes clean when a value is reverted to its baseline', () => {
    const session = editorDraft.createSession({ note: 'before', tags: ['a'] });
    assert.equal(session.isDirty({ note: 'after', tags: ['a'] }), true);
    assert.equal(session.isDirty({ note: 'before', tags: ['a'] }), false);
});

test('one successful editor save advances the baseline and clears dirty state', () => {
    const session = editorDraft.createSession({ note: 'before' });
    const ticket = session.beginSave({ note: 'after' });
    assert.ok(ticket);
    assert.equal(session.completeSave(ticket.token, ticket.snapshot), true);
    assert.equal(session.isDirty({ note: 'after' }), false);
});

test('rapid double editor save creates only one active commit ticket', () => {
    const session = editorDraft.createSession({ note: 'before' });
    const first = session.beginSave({ note: 'after' });
    const second = session.beginSave({ note: 'other' });
    assert.ok(first);
    assert.equal(second, null);
});

test('failed editor save keeps the draft dirty and permits a retry', () => {
    const session = editorDraft.createSession({ note: 'before' });
    const first = session.beginSave({ note: 'after' });
    assert.equal(session.failSave(first.token), true);
    assert.equal(session.isDirty({ note: 'after' }), true);
    assert.ok(session.beginSave({ note: 'after' }));
});

test('closing an editor invalidates a late asynchronous save result', () => {
    const session = editorDraft.createSession({ note: 'before' });
    const ticket = session.beginSave({ note: 'after' });
    session.invalidate();
    assert.equal(session.isActive(), false);
    assert.equal(session.isCurrent(ticket.token), false);
    assert.equal(session.completeSave(ticket.token, ticket.snapshot), false);
});

test('editor draft fingerprint covers category tags and variant image/background fields', () => {
    const baseline = {
        category: 'A',
        tags: ['one'],
        variants: { day: { imageData: null, backgroundName: '' } },
    };
    const session = editorDraft.createSession(baseline);
    assert.equal(session.isDirty(clone(baseline)), false);
    assert.equal(session.isDirty({ category: 'B', tags: ['one'], variants: clone(baseline.variants) }), true);
    assert.equal(session.isDirty({ category: 'A', tags: ['one', 'two'], variants: clone(baseline.variants) }), true);
    assert.equal(session.isDirty({ category: 'A', tags: ['one'], variants: { day: { imageData: 'new.png', backgroundName: '' } } }), true);
    assert.equal(session.isDirty({ category: 'A', tags: ['one'], variants: { day: { imageData: null, backgroundName: 'bg' } } }), true);
});

function createFakeSheet() {
    const parent = {
        removed: [],
        removeChild(node) {
            this.removed.push(node);
            node.parentNode = null;
        },
    };
    return { className: 'tm-sheet-overlay', parentNode: parent, parent };
}

test('sheet backdrop and programmatic close use the same dirty guard', () => {
    const api = modules.createUiSheets({ getPopupLayer() {}, load() {}, esc(value) { return value; } });
    const reasons = [];
    const backdropSheet = createFakeSheet();
    api.setBeforeClose(backdropSheet, (reason) => { reasons.push(reason); return false; });
    assert.equal(api.requestClose(backdropSheet, 'backdrop'), false);
    assert.ok(backdropSheet.parentNode);

    const programmaticSheet = createFakeSheet();
    api.setBeforeClose(programmaticSheet, (reason) => { reasons.push(reason); return false; });
    assert.equal(api.closeSheet(programmaticSheet), false);
    assert.ok(programmaticSheet.parentNode);
    assert.deepEqual(reasons, ['backdrop', 'programmatic']);
});

test('manager close preflights the same dirty guard before removing any sheet', () => {
    const api = modules.createUiSheets({ getPopupLayer() {}, load() {}, esc(value) { return value; } });
    const clean = createFakeSheet();
    const dirty = createFakeSheet();
    const root = { querySelectorAll() { return [clean, dirty]; } };
    api.setBeforeClose(dirty, (reason) => reason !== 'manager-close');

    assert.equal(api.requestCloseAll(root, 'manager-close'), false);
    assert.ok(clean.parentNode);
    assert.ok(dirty.parentNode);

    api.setBeforeClose(dirty, () => true);
    assert.equal(api.requestCloseAll(root, 'manager-close'), true);
    assert.equal(clean.parentNode, null);
    assert.equal(dirty.parentNode, null);
});

test('confirmed native CSS save replaces an old cache across A to B to A', async (t) => {
    const harness = createNativeCssSaveSyncHarness(t);
    const saved = completeTheme('A', { custom_css: 'saved new css', main_text_color: 'saved color' });
    harness.setLiveCss(saved.custom_css);

    await harness.saveTheme(saved);
    harness.setCurrent('B');
    const prepared = await harness.runtime.prepareUsableThemeForApply('A');

    assert.equal(prepared.theme.custom_css, 'saved new css');
    assert.notEqual(prepared.theme.main_text_color, 'saved color');
    assert.equal(harness.runtime.getConfirmedSavedPatch('A').custom_css, 'saved new css');
});

test('unsaved native CSS draft is not promoted when leaving and returning to A', async (t) => {
    const harness = createNativeCssSaveSyncHarness(t);
    harness.editDraft('unsaved draft css');
    assert.equal(harness.runtime.getCached('A'), null);

    harness.setCurrent('B');
    const prepared = await harness.runtime.prepareUsableThemeForApply('A');

    assert.equal(prepared.theme.custom_css, 'old css');
    assert.equal(harness.runtime.getConfirmedSavedPatch('A'), null);
});

test('two confirmed native CSS saves keep the latest saved revision', async (t) => {
    const harness = createNativeCssSaveSyncHarness(t);
    harness.setLiveCss('new css 1');
    await harness.saveTheme(completeTheme('A', { custom_css: 'new css 1' }));
    const firstRevision = harness.runtime.getConfirmedSavedPatch('A').revision;
    harness.setLiveCss('new css 2');
    await harness.saveTheme(completeTheme('A', { custom_css: 'new css 2' }));

    harness.setCurrent('B');
    const prepared = await harness.runtime.prepareUsableThemeForApply('A');

    assert.equal(prepared.theme.custom_css, 'new css 2');
    assert.ok(harness.runtime.getConfirmedSavedPatch('A').revision > firstRevision);
});

test('confirmed native CSS patch protects an immediate switch while inventory is delayed', async (t) => {
    const harness = createNativeCssSaveSyncHarness(t);
    harness.editDraft('saved while inventory is old');
    await harness.saveTheme(completeTheme('A', { custom_css: 'saved while inventory is old' }));

    harness.setCurrent('B');
    const prepared = await harness.runtime.prepareUsableThemeForApply('A');
    assert.equal(prepared.theme.custom_css, 'saved while inventory is old');
    assert.equal(harness.runtime.getConfirmedSavedPatch('A').custom_css, 'saved while inventory is old');

    harness.serverThemes.A = completeTheme('A', { custom_css: 'saved while inventory is old' });
    harness.runtime.replaceInventory(Object.values(harness.serverThemes).map(clone));
    assert.equal(harness.runtime.getConfirmedSavedPatch('A'), null);
});

test('ThemeMgr apply source does not create a confirmed native CSS save', async (t) => {
    const harness = createNativeCssSaveSyncHarness(t);
    harness.setCurrent('B');
    harness.setLiveCss('ThemeMgr apply css');
    harness.handlers.input({ target: harness.customCss, __themeManagerApply: true });

    const prepared = await harness.runtime.prepareUsableThemeForApply('A');

    assert.equal(prepared.theme.custom_css, 'old css');
    assert.equal(harness.runtime.getConfirmedSavedPatch('A'), null);
    assert.equal(harness.fetchCalls.filter((call) => call.url === '/api/themes/save').length, 0);
});

test('confirmed native CSS save survives A to B to C to A', async (t) => {
    const harness = createNativeCssSaveSyncHarness(t);
    harness.setLiveCss('latest saved css');
    await harness.saveTheme(completeTheme('A', { custom_css: 'latest saved css' }));

    harness.setCurrent('B');
    await harness.runtime.prepareUsableThemeForApply('B');
    harness.setCurrent('C');
    await harness.runtime.prepareUsableThemeForApply('C');
    const prepared = await harness.runtime.prepareUsableThemeForApply('A');

    assert.equal(prepared.theme.custom_css, 'latest saved css');
});

test('newly imported theme falls back from stale native state and keeps the applied theme when only visual verification fails', async (t) => {
    const previousDocument = global.document;
    const previousToolkit = global.__baiBaiToolkitExtensionInstalled;
    const previousHydrate = global.baibaokuHydrateTheme;
    const previousRaf = global.requestAnimationFrame;
    t.after(() => {
        global.document = previousDocument;
        global.__baiBaiToolkitExtensionInstalled = previousToolkit;
        global.baibaokuHydrateTheme = previousHydrate;
        global.requestAnimationFrame = previousRaf;
    });

    const cssValues = { '--SmartThemeBodyColor': '#old' };
    const controls = {
        themes: {
            tagName: 'SELECT',
            selectedIndex: 0,
            options: [{ value: 'Old' }, { value: '刚导入 ✨' }],
        },
        customCSS: { value: 'old css' },
        'custom-style': { textContent: 'old css' },
    };
    global.document = {
        documentElement: { style: { getPropertyValue: (name) => cssValues[name] || '' } },
        getElementById: (id) => controls[id] || null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    global.baibaokuHydrateTheme = undefined;
    global.__baiBaiToolkitExtensionInstalled = {
        __baiBaiToolkitCustomCssCodeMirrorEditor: {
            enabled: true,
            view: { state: { doc: 'old css' } },
        },
    };

    const powerUser = { theme: 'Old', main_text_color: '#old', custom_css: 'old css' };
    const expected = { name: '刚导入 ✨', main_text_color: '#new', custom_css: 'new css' };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        stateVerifyTimeoutMs: 0,
        stateVerifyIntervalMs: 0,
        visualMaxAttempts: 2,
        visualRetryDelayMs: 0,
    });
    runtime.remember(expected);
    let rollbackCount = 0;

    const result = await runtime.applyThemeAndWait(
        expected.name,
        () => {
            // Mirrors ST's stale private themes[] path: the selected name changes,
            // but applyTheme cannot find the just-saved theme object.
            controls.themes.selectedIndex = 1;
            powerUser.theme = expected.name;
        },
        () => {
            powerUser.theme = expected.name;
            powerUser.main_text_color = expected.main_text_color;
            powerUser.custom_css = expected.custom_css;
            cssValues['--SmartThemeBodyColor'] = expected.main_text_color;
            controls.customCSS.value = expected.custom_css;
            controls['custom-style'].textContent = expected.custom_css;
        },
        () => { rollbackCount += 1; },
    );

    assert.equal(result.fallbackUsed, true);
    assert.equal(result.stateVerification.ok, true);
    assert.equal(result.visualVerification.ok, false);
    assert.deepEqual(result.visualVerification.mismatches, ['custom-css-editor']);
    assert.equal(powerUser.theme, expected.name);
    assert.equal(powerUser.custom_css, expected.custom_css);
    assert.equal(rollbackCount, 0);
});

test('visual verification waits for frames and retries a slow CSS update', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    const previousToolkit = global.__baiBaiToolkitExtensionInstalled;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
        global.__baiBaiToolkitExtensionInstalled = previousToolkit;
    });

    const cssValues = { '--SmartThemeBodyColor': '#old' };
    const themeControl = { tagName: 'SELECT', selectedIndex: 0, options: [{ value: 'Slow' }] };
    global.document = {
        documentElement: { style: { getPropertyValue: (name) => cssValues[name] || '' } },
        getElementById: (id) => id === 'themes' ? themeControl : null,
    };
    global.__baiBaiToolkitExtensionInstalled = undefined;
    let frameCount = 0;
    global.requestAnimationFrame = (callback) => {
        frameCount += 1;
        if (frameCount === 3) cssValues['--SmartThemeBodyColor'] = '#new';
        callback();
        return frameCount;
    };

    const powerUser = { theme: 'Slow', main_text_color: '#new' };
    const expected = { name: 'Slow', main_text_color: '#new' };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        visualMaxAttempts: 3,
        visualRetryDelayMs: 0,
    });
    runtime.remember(expected);

    const result = await runtime.applyThemeAndWait('Slow', () => {}, null, null);

    assert.equal(result.stateVerification.ok, true);
    assert.equal(result.visualVerification.ok, true);
    assert.equal(result.visualVerification.attempt, 2);
    assert.equal(frameCount, 3);
});

test('A B C imports switch immediately and can alternate with an old native theme without reopening', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    const previousToolkit = global.__baiBaiToolkitExtensionInstalled;
    const previousHydrate = global.baibaokuHydrateTheme;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
        global.__baiBaiToolkitExtensionInstalled = previousToolkit;
        global.baibaokuHydrateTheme = previousHydrate;
    });

    const themes = [
        { name: 'Old', main_text_color: '#old' },
        { name: 'A', main_text_color: '#a' },
        { name: 'B', main_text_color: '#b' },
        { name: 'C', main_text_color: '#c' },
    ];
    const options = themes.map((theme) => ({ value: theme.name }));
    const themeControl = { tagName: 'SELECT', selectedIndex: 0, options };
    const cssValues = { '--SmartThemeBodyColor': '#old' };
    const powerUser = { theme: 'Old', main_text_color: '#old' };
    global.document = {
        documentElement: { style: { getPropertyValue: (name) => cssValues[name] || '' } },
        getElementById: (id) => id === 'themes' ? themeControl : null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    global.__baiBaiToolkitExtensionInstalled = undefined;
    global.baibaokuHydrateTheme = undefined;

    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve(themes), getRawSettingsInventory: () => Promise.resolve(themes) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        stateVerifyTimeoutMs: 0,
        stateVerifyIntervalMs: 0,
        visualMaxAttempts: 1,
        visualRetryDelayMs: 0,
    });
    runtime.replaceInventory(themes);

    async function apply(name) {
        const expected = runtime.getCached(name);
        return runtime.applyThemeAndWait(
            name,
            () => {
                themeControl.selectedIndex = options.findIndex((option) => option.value === name);
                powerUser.theme = name;
                if (name === 'Old') {
                    powerUser.main_text_color = expected.main_text_color;
                    cssValues['--SmartThemeBodyColor'] = expected.main_text_color;
                }
            },
            () => {
                powerUser.theme = name;
                powerUser.main_text_color = expected.main_text_color;
                cssValues['--SmartThemeBodyColor'] = expected.main_text_color;
            },
            () => { throw new Error('no rollback expected'); },
        );
    }

    const results = [];
    for (const name of ['A', 'B', 'C', 'Old', 'A']) results.push(await apply(name));

    assert.deepEqual(results.map((result) => result.fallbackUsed), [true, true, true, false, true]);
    assert.equal(results.every((result) => result.stateVerification.ok && result.visualVerification.ok), true);
    assert.equal(powerUser.theme, 'A');
    assert.equal(cssValues['--SmartThemeBodyColor'], '#a');
});

test('native hydration path remains equivalent when a compatible theme bridge is available', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    const previousHydrate = global.baibaokuHydrateTheme;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
        global.baibaokuHydrateTheme = previousHydrate;
    });

    const expected = { name: 'Hydrated', main_text_color: '#hydrated' };
    const cssValues = { '--SmartThemeBodyColor': '#old' };
    const themeControl = { tagName: 'SELECT', selectedIndex: 0, options: [{ value: 'Hydrated' }] };
    const powerUser = { theme: 'Old', main_text_color: '#old' };
    let hydratedTheme = null;
    global.document = {
        documentElement: { style: { getPropertyValue: (name) => cssValues[name] || '' } },
        getElementById: (id) => id === 'themes' ? themeControl : null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    global.baibaokuHydrateTheme = (theme) => { hydratedTheme = clone(theme); };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([expected]), getRawSettingsInventory: () => Promise.resolve([expected]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        visualMaxAttempts: 1,
    });
    runtime.remember(expected);

    const result = await runtime.applyThemeAndWait('Hydrated', (prepared) => {
        assert.equal(prepared.hydrated, true);
        powerUser.theme = prepared.theme.name;
        powerUser.main_text_color = prepared.theme.main_text_color;
        cssValues['--SmartThemeBodyColor'] = prepared.theme.main_text_color;
    }, () => { throw new Error('fallback not expected'); }, null);

    assert.deepEqual(hydratedTheme, expected);
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.visualVerification.ok, true);
});

test('genuine state failure still rolls back and remains a failed theme switch', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
    });

    const themeControl = {
        tagName: 'SELECT',
        selectedIndex: 0,
        options: [{ value: 'Old' }, { value: 'Broken' }],
    };
    global.document = {
        documentElement: { style: { getPropertyValue: () => '#old' } },
        getElementById: (id) => id === 'themes' ? themeControl : null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    const powerUser = { theme: 'Old', main_text_color: '#old' };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        stateVerifyTimeoutMs: 0,
        stateVerifyIntervalMs: 0,
    });
    runtime.remember({ name: 'Broken', main_text_color: '#broken' });
    let rollbackCount = 0;

    await assert.rejects(
        runtime.applyThemeAndWait(
            'Broken',
            () => {},
            () => {},
            (prepared) => {
                rollbackCount += 1;
                powerUser.theme = prepared.theme.name;
                powerUser.main_text_color = prepared.theme.main_text_color;
                themeControl.selectedIndex = 0;
            },
        ),
        (error) => error.code === 'state-verify-failed' && error.rollbackRestored === true,
    );
    assert.equal(rollbackCount, 1);
    assert.equal(powerUser.theme, 'Old');
});

test('visual verifier errors are contained and never roll back a confirmed theme state', async (t) => {
    const previousDocument = global.document;
    const previousRaf = global.requestAnimationFrame;
    t.after(() => {
        global.document = previousDocument;
        global.requestAnimationFrame = previousRaf;
    });

    const expected = { name: 'Applied', main_text_color: '#new' };
    const powerUser = { theme: 'Applied', main_text_color: '#new' };
    global.document = {
        documentElement: { style: { getPropertyValue() { throw new Error('detached visual root'); } } },
        getElementById: (id) => id === 'themes'
            ? { tagName: 'SELECT', selectedIndex: 0, options: [{ value: 'Applied' }] }
            : null,
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    const runtime = modules.createThemeRuntime({
        schema,
        api: { getSettingsInventory: () => Promise.resolve([]), getRawSettingsInventory: () => Promise.resolve([]) },
        loadPowerUserModule: () => Promise.resolve({ power_user: powerUser }),
        visualMaxAttempts: 1,
    });
    runtime.remember(expected);
    let rollbackCount = 0;

    const result = await runtime.applyThemeAndWait('Applied', () => {}, null, () => { rollbackCount += 1; });

    assert.equal(result.stateVerification.ok, true);
    assert.equal(result.visualVerification.ok, false);
    assert.deepEqual(result.visualVerification.mismatches, ['verification-error']);
    assert.equal(rollbackCount, 0);
    assert.equal(powerUser.theme, 'Applied');
});

test('theme API never submits markers or name-only objects but permits legacy partials', async (t) => {
    const previousFetch = global.fetch;
    const requests = [];
    t.after(() => { global.fetch = previousFetch; });
    global.fetch = async (url, options) => {
        requests.push({ url, body: options && options.body });
        return { ok: true, json: async () => ({}) };
    };
    const api = modules.createThemeApi({ schema });

    await assert.rejects(api.saveTheme({ name: 'Lazy', __baibaokuLazyTheme: true }, {}));
    await assert.rejects(api.saveTheme({ name: 'OnlyName' }, {}));
    await api.saveTheme({ name: 'Legacy', custom_css: '' }, {});

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/themes/save');
    assert.equal(requests[0].body.includes(schema.LAZY_THEME_MARKER), false);
});

test('theme API rejects malformed inventories and accepts only an explicit themes array', async (t) => {
    const previousFetch = global.fetch;
    let settingsBody = { themes: [] };
    let settingsJsonError = null;
    t.after(() => { global.fetch = previousFetch; });
    global.fetch = async (url) => {
        if (url === '/csrf-token') return { ok: true, json: async () => ({ token: 'test' }) };
        if (url === '/api/settings/get') {
            return {
                ok: true,
                json: async () => {
                    if (settingsJsonError) throw settingsJsonError;
                    return clone(settingsBody);
                },
            };
        }
        throw new Error(`unexpected fetch: ${url}`);
    };
    const api = modules.createThemeApi({ schema });

    for (const malformed of [
        {},
        { themes: null },
        { themes: {} },
        { themes: 'not-an-array' },
        null,
        { themes: [{ name: '' }] },
        { themes: [completeTheme('Duplicate'), completeTheme('Duplicate')] },
    ]) {
        settingsBody = malformed;
        await assert.rejects(
            api.getSettingsInventory(),
            (error) => error.code === 'inventory-invalid',
        );
    }

    settingsJsonError = new SyntaxError('malformed settings response');
    await assert.rejects(api.getSettingsInventory(), /malformed settings response/);
    settingsJsonError = null;
    settingsBody = { themes: [] };
    assert.deepEqual(await api.getSettingsInventory(), []);
});

test('malformed initial inventory aborts standalone save before any theme write or rollback delete', async () => {
    const old = completeTheme('Existing');
    const harness = makeTransactionHarness([old], {
        transformInventory() { return {}; },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedTheme(completeTheme('Existing', { custom_css: '/* replacement */' })),
        (error) => error.code === 'inventory-invalid',
    );

    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.store.Existing, old);
});

test('malformed post-save inventory restores an authoritatively present prior theme without DELETE', async () => {
    const old = completeTheme('Existing', { custom_css: '/* prior */' });
    const harness = makeTransactionHarness([old], {
        transformInventory(inventory, count) { return count === 2 ? {} : inventory; },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedTheme(completeTheme('Existing', { custom_css: '/* replacement */' })),
        (error) => error.code === 'verify-failed',
    );

    assert.deepEqual(harness.store.Existing, old);
    assert.deepEqual(harness.calls.map((call) => `${call.type}:${call.name}`), [
        'save:Existing',
        'save:Existing',
    ]);
});

test('malformed rollback verification never turns a known prior theme into a DELETE rollback', async () => {
    const old = completeTheme('Existing', { custom_css: '/* prior */' });
    const harness = makeTransactionHarness([old], {
        transformInventory(inventory, count) {
            return count === 2 || count === 3 ? { themes: null } : inventory;
        },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedTheme(completeTheme('Existing', { custom_css: '/* replacement */' })),
        (error) => error.code === 'rollback-failed',
    );

    assert.deepEqual(harness.store.Existing, old);
    assert.deepEqual(harness.calls.map((call) => `${call.type}:${call.name}`), [
        'save:Existing',
        'save:Existing',
    ]);
});

test('an unknown prior inventory cannot be declared absent to authorize a destructive rollback', async () => {
    const harness = makeTransactionHarness([]);

    await assert.rejects(
        harness.transactions.saveVerifiedTheme(completeTheme('New'), {
            knownInventory: undefined,
            knownPreviousTheme: null,
            headers: { 'X-Test': 'known-unknown' },
        }),
        (error) => error.code === 'inventory-invalid',
    );

    assert.deepEqual(harness.calls, []);
    assert.equal(harness.store.New, undefined);
});

test('malformed inventory aborts single delete before DELETE and before caller cleanup', async () => {
    const old = completeTheme('Keep');
    const harness = makeTransactionHarness([old], {
        transformInventory() { return { themes: null }; },
    });
    let cleanupRan = false;
    const managerState = {
        themeMeta: { Keep: { category: 'Protected' } },
        pairs: [{ id: 'pair-keep', themes: ['Keep', 'Other'] }],
        series: [{ id: 'series-keep', themes: ['Keep', 'Other'] }],
        bindings: { manualTarget: { kind: 'theme', themeName: 'Keep' } },
    };
    const beforeCleanup = clone(managerState);

    await assert.rejects(
        harness.transactions.deleteThemeVerified('Keep').then(() => {
            cleanupRan = true;
            delete managerState.themeMeta.Keep;
            managerState.pairs = [];
            managerState.series = [];
            managerState.bindings = {};
        }),
        (error) => error.code === 'delete-read-failed',
    );

    assert.equal(cleanupRan, false);
    assert.deepEqual(managerState, beforeCleanup);
    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.store.Keep, old);
});

test('malformed post-delete verification prevents caller metadata cleanup', async () => {
    const old = completeTheme('Keep');
    const harness = makeTransactionHarness([old], {
        transformInventory(inventory, count) {
            return count === 2 ? { themes: null } : inventory;
        },
    });
    const managerState = {
        themeMeta: { Keep: { category: 'Protected' } },
        pairs: [{ id: 'pair-keep', themes: ['Keep', 'Other'] }],
        series: [{ id: 'series-keep', themes: ['Keep', 'Other'] }],
        bindings: { manualTarget: { kind: 'theme', themeName: 'Keep' } },
    };
    const beforeCleanup = clone(managerState);

    await assert.rejects(
        harness.transactions.deleteThemeVerified('Keep').then(() => {
            managerState.themeMeta = {};
            managerState.pairs = [];
            managerState.series = [];
            managerState.bindings = {};
        }),
        (error) => error.code === 'delete-failed',
    );

    assert.deepEqual(harness.calls.map((call) => `${call.type}:${call.name}`), ['delete:Keep']);
    assert.deepEqual(managerState, beforeCleanup);
});

test('malformed inventory aborts batch delete before every DELETE', async () => {
    const keepA = completeTheme('Keep A');
    const keepB = completeTheme('Keep B');
    const harness = makeTransactionHarness([keepA, keepB], {
        transformInventory() { return 'invalid inventory'; },
    });

    await assert.rejects(
        harness.transactions.deleteThemesVerified(['Keep A', 'Keep B']),
        (error) => error.code === 'batch-delete-read-failed',
    );

    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.store['Keep A'], keepA);
    assert.deepEqual(harness.store['Keep B'], keepB);
});

test('duplicate inventory names abort save, delete, and rename before every theme write', async () => {
    const old = completeTheme('Old');
    const duplicateInventory = (inventory) => [clone(inventory[0]), clone(inventory[0])];

    const saveHarness = makeTransactionHarness([old], { transformInventory: duplicateInventory });
    await assert.rejects(
        saveHarness.transactions.saveVerifiedTheme(completeTheme('Old', { custom_css: '/* replacement */' })),
        (error) => error.code === 'inventory-invalid',
    );
    assert.deepEqual(saveHarness.calls, []);

    const deleteHarness = makeTransactionHarness([old], { transformInventory: duplicateInventory });
    await assert.rejects(
        deleteHarness.transactions.deleteThemeVerified('Old'),
        (error) => error.code === 'delete-read-failed',
    );
    assert.deepEqual(deleteHarness.calls, []);

    const renameHarness = makeTransactionHarness([old], {
        cachedThemes: { Old: old },
        transformInventory: duplicateInventory,
    });
    await assert.rejects(
        renameHarness.transactions.renameTheme('Old', 'New', {
            extraNames: ['Old'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'inventory-invalid',
    );
    assert.deepEqual(renameHarness.calls, []);
});

test('valid empty inventory remains authoritative for an already-absent delete', async () => {
    const harness = makeTransactionHarness([], {
        transformInventory() { return []; },
    });

    const result = await harness.transactions.deleteThemeVerified('Already Gone');

    assert.equal(result.alreadyAbsent, true);
    assert.deepEqual(harness.calls, []);
});

test('export hydrates every requested theme, normalizes legacy partials with one baseline, and reports filled fields', async () => {
    const inventory = [
        { name: 'Legacy A', main_text_color: '#a' },
        { name: 'Legacy B', custom_css: '' },
    ];
    const baseline = completeBaseline();
    let baselineCalls = 0;
    const runtime = makeRuntimeForTransfer(inventory);
    const transfer = modules.createThemeTransfer({
        schema,
        runtime,
        transactions: {},
        captureBaseline() { baselineCalls += 1; return Promise.resolve(clone(baseline)); },
    });
    const result = await transfer.prepareExport(['Legacy A', 'Legacy B']);

    assert.equal(baselineCalls, 1);
    assert.equal(result.report.legacyCount, 2);
    assert.equal(
        result.report.filledFieldCount,
        schema.getMissingThemeFields(inventory[0]).length + schema.getMissingThemeFields(inventory[1]).length,
    );
    assert.equal(result.themes.every((theme) => schema.isCompleteTheme(theme, theme.name)), true);
    assert.equal(JSON.stringify(result.themes).includes(schema.LAZY_THEME_MARKER), false);
    assert.equal(result.themes[0].main_text_color, '#a');
    assert.equal(result.themes[1].custom_css, '');
});

test('export aborts with the failed theme names when lazy hydration fails', async () => {
    const inventory = [{ name: 'Broken Lazy', __baibaokuLazyTheme: true }];
    const runtime = makeRuntimeForTransfer(inventory, (name) => {
        const error = new Error(`cannot hydrate ${name}`);
        error.code = 'incomplete';
        return Promise.reject(error);
    });
    const transfer = modules.createThemeTransfer({ schema, runtime, transactions: {} });

    await assert.rejects(
        transfer.prepareExport(['Broken Lazy']),
        (error) => error.code === 'export-incomplete' && error.message.includes('Broken Lazy'),
    );
});

test('export diagnostics allow three differently named themes with identical configuration', async () => {
    const first = completeTheme('Duplicate One');
    const inventory = ['Duplicate One', 'Duplicate Two', 'Duplicate Three'].map((name) => {
        const theme = clone(first);
        theme.name = name;
        return theme;
    });
    const runtime = makeRuntimeForTransfer(inventory);
    const transfer = modules.createThemeTransfer({ schema, runtime, transactions: {} });

    const result = await transfer.prepareExport(inventory.map((theme) => theme.name));
    assert.equal(result.themes.length, 3);
    assert.equal(result.diagnostics.sameConfigGroups.length, 1);
    assert.deepEqual(result.diagnostics.sameConfigGroups[0].names, inventory.map((theme) => theme.name));
});

test('export diagnostics identify true inventory duplicate names without deleting either object', () => {
    const first = completeTheme('Same Name');
    const second = completeTheme('Same Name', { custom_css: '/* second */' });
    const transfer = modules.createThemeTransfer({ schema, runtime: makeRuntimeForTransfer([]), transactions: {}, metadata });
    const diagnostics = transfer.inspectLibrary([first, second], {});

    assert.deepEqual(diagnostics.inventoryDuplicateNames, [{ name: 'Same Name', count: 2 }]);
    assert.equal(diagnostics.fatal, true);
    assert.equal(first.custom_css, '/* Same Name */');
    assert.equal(second.custom_css, '/* second */');
});

test('export diagnostics identify sanitized filename collisions as fatal', () => {
    const transfer = modules.createThemeTransfer({ schema, runtime: makeRuntimeForTransfer([]), transactions: {}, metadata });
    const diagnostics = transfer.inspectLibrary([
        completeTheme('Folder/Theme'),
        completeTheme('Folder\\Theme'),
    ], {});

    assert.equal(diagnostics.sanitizedFilenameCollisions.length, 1);
    assert.equal(diagnostics.fatal, true);
});

test('export diagnostics classify malformed theme objects as fatal without throwing', () => {
    const transfer = modules.createThemeTransfer({ schema, runtime: makeRuntimeForTransfer([]), transactions: {}, metadata });
    const diagnostics = transfer.inspectLibrary([{ name: 'Only Name' }, null], {});

    assert.equal(diagnostics.invalidThemeObjects.length, 2);
    assert.equal(diagnostics.fatal, true);
});

test('orphan and empty metadata are warnings and only current meaningful annotations are counted', () => {
    const themeMeta = {
        Current: { category: '分类' },
        Empty: {},
        Deleted: { tags: ['orphan'] },
    };
    const diagnostics = metadata.inspect(['Current', 'Empty', 'No Meta'], themeMeta);

    assert.equal(diagnostics.annotatedCount, 1);
    assert.deepEqual(diagnostics.annotatedNames, ['Current']);
    assert.deepEqual(diagnostics.orphanMetadata, ['Deleted']);
    assert.deepEqual(diagnostics.emptyMetadata, ['Empty']);
    assert.deepEqual(diagnostics.inventoryWithoutMetadata, ['No Meta']);
    assert.deepEqual(Object.keys(themeMeta), ['Current', 'Empty', 'Deleted']);
});

test('read-only metadata lookup for 1000 themes creates no empty records', () => {
    const data = { themeMeta: {} };
    for (let index = 0; index < 1000; index += 1) {
        assert.equal(metadata.peekMeta(data, `Theme ${index}`).category, '');
    }
    assert.equal(Object.keys(data.themeMeta).length, 0);
});

test('metadata records are created only by an explicit write', () => {
    const data = { themeMeta: {} };
    metadata.peekMeta(data, 'Write Later');
    assert.equal(data.themeMeta['Write Later'], undefined);

    metadata.ensureMeta(data, 'Write Later').category = '分类';
    assert.equal(data.themeMeta['Write Later'].category, '分类');
});

test('category rename collision aborts without changing categories metadata pairs or series', () => {
    const data = {
        categories: ['A', 'B'],
        themeMeta: {
            One: { category: 'A', note: 'keep-a' },
            Two: { category: 'B', note: 'keep-b' },
        },
        dayNight: { pairs: {
            pairA: { id: 'pairA', name: 'Pair A', dayTheme: 'Day', nightTheme: 'Night', meta: { category: 'A', future: 'keep' } },
        } },
        series: { groups: {
            seriesA: { id: 'seriesA', name: 'Series A', category: 'A', members: [] },
        } },
    };
    const before = clone(data);

    const result = metadata.renameCategory(data, 'A', 'B');

    assert.deepEqual(result, { ok: false, reason: 'collision' });
    assert.deepEqual(data, before);
});

test('category rename to a clean name updates every raw category reference exactly once', () => {
    const data = {
        categories: ['A', 'B'],
        themeMeta: { One: { category: 'A' }, Two: { category: 'B' } },
        dayNight: { pairs: {
            pairA: { id: 'pairA', meta: { category: 'A', future: 'keep' } },
            pairB: { id: 'pairB', meta: { category: 'B' } },
        } },
        series: { groups: {
            seriesA: { id: 'seriesA', category: 'A', members: [] },
            seriesB: { id: 'seriesB', category: 'B', members: [] },
        } },
    };

    const result = metadata.renameCategory(data, 'A', 'C');

    assert.equal(result.ok, true);
    assert.equal(result.changedReferences, 3);
    assert.deepEqual(data.categories, ['C', 'B']);
    assert.equal(data.themeMeta.One.category, 'C');
    assert.equal(data.themeMeta.Two.category, 'B');
    assert.equal(data.dayNight.pairs.pairA.meta.category, 'C');
    assert.equal(data.dayNight.pairs.pairA.meta.future, 'keep');
    assert.equal(data.dayNight.pairs.pairB.meta.category, 'B');
    assert.equal(data.series.groups.seriesA.category, 'C');
    assert.equal(data.series.groups.seriesB.category, 'B');
});

test('reserved category sentinels are rejected only at create and rename boundaries', () => {
    for (const name of ['__all__', '__uncategorized__', '__new__', '__keep__']) {
        assert.equal(metadata.isReservedCategoryName(name), true);
        const data = { categories: ['A', name], themeMeta: { Existing: { category: name } } };
        const before = clone(data);
        assert.deepEqual(metadata.renameCategory(data, 'A', name), { ok: false, reason: 'reserved' });
        assert.deepEqual(data, before);
    }
    assert.deepEqual(metadata.inspectCategories(['Normal', '__all__']).reservedNames, ['__all__']);
});

test('ordinary category metadata round trip preserves classified and unclassified themes', () => {
    const target = { categories: [], themeMeta: {} };
    metadata.mergeImported(target, ['A', 'B', 'C'], {
        A: { category: 'X', tags: ['red'], author: 'Alice', description: 'note' },
        B: { category: 'Y' },
        C: { category: '' },
    }, ['X', 'Y'], { forceCategory: true });

    assert.deepEqual(target.categories, ['X', 'Y']);
    assert.equal(target.themeMeta.A.category, 'X');
    assert.equal(target.themeMeta.B.category, 'Y');
    assert.equal(target.themeMeta.C.category, '');
    assert.deepEqual(target.themeMeta.A.tags, ['red']);
    assert.equal(target.themeMeta.A.author, 'Alice');
    assert.equal(target.themeMeta.A.description, 'note');
});

test('empty and special-character category definitions survive metadata round trip in order', () => {
    const categories = ['空分类', '夜/日 ✨', '引号「测试」'];
    const target = { categories: [], themeMeta: {} };
    metadata.mergeImported(target, ['A'], { A: { category: '夜/日 ✨' } }, categories);

    assert.deepEqual(target.categories, categories);
    assert.equal(target.themeMeta.A.category, '夜/日 ✨');
});

test('dangerous literal names remain own metadata and category identities without prototype mutation', () => {
    const names = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];
    const prototypeKeysBefore = Object.getOwnPropertyNames(Object.prototype);
    const incoming = Object.create(null);
    names.forEach((name, index) => {
        incoming[name] = { category: name, description: `literal-${index}`, tags: [name] };
    });
    const data = { categories: [], themeMeta: {} };

    const merged = metadata.mergeImported(data, names, incoming, names, { forceCategory: true });

    assert.equal(merged.merged, names.length);
    assert.equal(Object.getPrototypeOf(data.themeMeta), null);
    names.forEach((name, index) => {
        assert.equal(Object.prototype.hasOwnProperty.call(data.themeMeta, name), true, name);
        assert.equal(metadata.peekMeta(data, name).description, `literal-${index}`, name);
        assert.equal(data.themeMeta[name].category, name, name);
    });
    assert.deepEqual(metadata.inspect(names, data.themeMeta).inventoryWithoutMetadata, []);

    const categoryData = {
        categories: ['Base'],
        themeMeta: { Theme: { category: 'Base' } },
        dayNight: { pairs: { Pair: { id: 'Pair', meta: { category: 'Base' } } } },
        series: { groups: { Series: { id: 'Series', category: 'Base', members: [] } } },
    };
    assert.equal(metadata.renameCategory(categoryData, 'Base', '__proto__').ok, true);
    assert.deepEqual(categoryData.categories, ['__proto__']);
    assert.equal(categoryData.themeMeta.Theme.category, '__proto__');
    assert.equal(categoryData.dayNight.pairs.Pair.meta.category, '__proto__');
    assert.equal(categoryData.series.groups.Series.category, '__proto__');
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), prototypeKeysBefore);
});

test('dangerous literal relationship ids keys and theme references remain addressable', () => {
    const prototypeKeysBefore = Object.getOwnPropertyNames(Object.prototype);
    const data = { themeMeta: {} };
    ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'].forEach((name) => {
        metadata.ensureMeta(data, name).description = name;
    });

    const pairResult = pairs.createPair(data, {
        id: '__proto__',
        name: 'Literal pair',
        dayTheme: '__proto__',
        nightTheme: 'constructor',
    });
    assert.equal(pairResult.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(data.dayNight.pairs, '__proto__'), true);
    assert.equal(pairs.getPair(data, '__proto__').nightTheme, 'constructor');

    const seriesResult = series.createSeries(data, {
        id: 'constructor',
        name: 'Literal series',
        members: [
            { kind: 'day-night', pairId: '__proto__' },
            { kind: 'theme', themeName: 'prototype' },
        ],
    });
    assert.equal(seriesResult.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(data.series.groups, 'constructor'), true);

    const context = {
        characters: [{ avatar: '__proto__', name: 'Literal character' }],
        characterId: 0,
        chatMetadata: { integrity: 'constructor' },
        chatId: 'literal-chat',
    };
    assert.equal(bindings.setBinding(data, 'character', context, bindings.makeThemeTarget('toString')).ok, true);
    assert.equal(bindings.setBinding(data, 'chat', context, bindings.makeThemeTarget('hasOwnProperty')).ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(data.bindings.characters, '__proto__'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(data.bindings.chats, 'constructor'), true);

    assert.equal(pairs.exportPairs(data, ['__proto__', 'constructor']).length, 1);
    assert.equal(series.exportSeries(data, ['prototype'], ['__proto__']).length, 1);
    assert.equal(pairs.renameThemeReferences(data, '__proto__', 'toString'), 1);
    assert.equal(series.renameThemeReferences(data, 'prototype', 'hasOwnProperty'), 1);
    assert.equal(bindings.renameThemeReferences(data, 'toString', 'prototype'), 1);
    assert.equal(pairs.getPair(data, '__proto__').dayTheme, 'toString');
    assert.equal(series.getSeries(data, 'constructor').members[1].themeName, 'hasOwnProperty');

    assert.equal(pairs.removeThemeReferences(data, 'constructor').length, 1);
    assert.equal(series.removeThemeReferences(data, 'hasOwnProperty'), 1);
    assert.equal(bindings.removeThemeReferences(data, 'prototype'), 1);
    assert.equal(bindings.removeThemeReferences(data, 'hasOwnProperty'), 1);
    assert.equal(Object.prototype.hasOwnProperty.call(data.dayNight.pairs, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(data.series.groups, 'constructor'), false);
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), prototypeKeysBefore);
});

test('dangerous literal theme names survive import export dedupe rename and delete transactions', async () => {
    const names = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];
    const prototypeKeysBefore = Object.getOwnPropertyNames(Object.prototype);
    const themes = names.map((name) => completeTheme(name));
    const harness = makeTransactionHarness([]);
    const transfer = modules.createThemeTransfer({
        schema,
        runtime: harness.runtime,
        transactions: harness.transactions,
        metadata,
        captureBaseline() { return Promise.resolve(completeBaseline()); },
    });

    const validation = transfer.validateImportThemes(themes);
    assert.equal(validation.valid.length, names.length);
    assert.equal(validation.invalid.length, 0);
    const imported = await transfer.importVerified(themes);
    assert.equal(imported.results.length, names.length);
    names.forEach((name) => {
        assert.equal(Object.prototype.hasOwnProperty.call(harness.store, name), true, name);
        assert.equal(Object.prototype.hasOwnProperty.call(harness.remembered, name), true, name);
    });

    const exported = await transfer.prepareExport(names);
    assert.deepEqual(exported.themes.map((theme) => theme.name), names);
    await assert.rejects(
        transfer.prepareExport(['__proto__', '__proto__']),
        (error) => error.code === 'export-duplicate-name',
    );

    const renamed = await harness.transactions.renameTheme('__proto__', 'literal-renamed', {
        destinationIdentityConflicts: [],
    });
    assert.equal(renamed.newName, 'literal-renamed');
    assert.equal(Object.prototype.hasOwnProperty.call(harness.store, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(harness.store, 'literal-renamed'), true);

    await harness.transactions.deleteThemeVerified('constructor');
    const deleted = await harness.transactions.deleteThemesVerified([
        'prototype',
        'toString',
        'hasOwnProperty',
        'literal-renamed',
    ]);
    assert.equal(deleted.results.every((item) => item.ok), true);
    assert.deepEqual(Object.keys(harness.store), []);
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), prototypeKeysBefore);
});

test('import rejects marker and name-only inputs before capturing a baseline or saving', async () => {
    let baselineCalls = 0;
    let saveCalls = 0;
    const transfer = modules.createThemeTransfer({
        schema,
        runtime: makeRuntimeForTransfer([]),
        transactions: { saveVerifiedTheme() { saveCalls += 1; return Promise.resolve({}); } },
        captureBaseline() { baselineCalls += 1; return Promise.resolve(completeBaseline()); },
    });

    await assert.rejects(
        transfer.importVerified([
            { name: 'Marked', main_text_color: '#fff', __baibaokuLazyTheme: true },
            { name: 'OnlyName' },
        ]),
        (error) => error.code === 'import-invalid' && error.details.length === 2,
    );
    assert.equal(baselineCalls, 0);
    assert.equal(saveCalls, 0);
});

test('batch import captures one fixed baseline before saving every partial theme', async () => {
    const baseline = completeBaseline({ quote_text_color: '#fixed' });
    let baselineCalls = 0;
    const savedThemes = [];
    const runtime = makeRuntimeForTransfer([]);
    runtime.remember({ name: 'Stale before import', custom_css: 'stale' });
    const existing = completeTheme('Existing inventory theme');
    const transfer = modules.createThemeTransfer({
        schema,
        runtime,
        transactions: {
            saveVerifiedThemes(themes) {
                themes.forEach((theme) => savedThemes.push(clone(theme)));
                baseline.quote_text_color = '#mutated-during-import';
                return Promise.resolve({
                    results: themes.map((theme) => ({ theme: clone(theme), overwritten: false })),
                    themes: [clone(existing)].concat(themes.map(clone)),
                });
            },
        },
        captureBaseline() { baselineCalls += 1; return Promise.resolve(clone(baseline)); },
    });

    const result = await transfer.importVerified([
        { name: 'Partial One', main_text_color: '#one' },
        { name: 'Partial Two', custom_css: '' },
    ]);

    assert.equal(baselineCalls, 1);
    assert.equal(result.results.every((item) => item.ok), true);
    assert.equal(savedThemes.length, 2);
    assert.equal(savedThemes[0].quote_text_color, '#fixed');
    assert.equal(runtime.cache['Stale before import'], undefined);
    assert.deepEqual(runtime.cache['Existing inventory theme'], existing);
    assert.deepEqual(runtime.cache['Partial One'], result.results[0].theme);
    assert.deepEqual(runtime.cache['Partial Two'], result.results[1].theme);
    assert.equal(savedThemes[1].quote_text_color, '#fixed');
    assert.equal(savedThemes[1].custom_css, '');
});

test('batch save uses one initial and one final inventory for any number of themes', async () => {
    const previous = completeTheme('Existing', { custom_css: '/* old */' });
    const batch = [
        completeTheme('Existing', { custom_css: '/* new */' }),
        completeTheme('Import Two'),
        completeTheme('Import Three'),
        completeTheme('Import Four'),
        completeTheme('Import Five'),
    ];
    const harness = makeTransactionHarness([previous]);

    const result = await harness.transactions.saveVerifiedThemes(batch);

    assert.equal(harness.getInventoryCount(), 2);
    assert.equal(harness.getHeaderCount(), 1);
    assert.equal(result.results.length, 5);
    assert.equal(result.results.every((item) => item.ok), true);
    assert.equal(result.results[0].overwritten, true);
    assert.equal(result.results.slice(1).every((item) => !item.overwritten), true);
    assert.equal(harness.calls.filter((call) => call.type === 'save').length, 5);
    batch.forEach((theme) => assert.deepEqual(harness.store[theme.name], theme));
});

test('batch save failure restores every attempted destination before reporting failure', async () => {
    const previous = completeTheme('Existing', { custom_css: '/* old */' });
    const batch = [
        completeTheme('Existing', { custom_css: '/* new */' }),
        completeTheme('Import Two'),
        completeTheme('Import Three'),
    ];
    const harness = makeTransactionHarness([previous], { saveErrorAt: 3 });

    await assert.rejects(
        harness.transactions.saveVerifiedThemes(batch),
        (error) => error.message === 'injected save failure' && error.rollbackRestored === true,
    );

    assert.deepEqual(harness.store.Existing, previous);
    assert.equal(harness.store['Import Two'], undefined);
    assert.equal(harness.store['Import Three'], undefined);
    assert.equal(harness.getHeaderCount(), 1);
    assert.equal(harness.getInventoryCount(), 2);
});

test('TauriTavern mobile batch verification accepts chat_width normalized to 100', async () => {
    const batch = [
        completeTheme('Mobile Import', { chat_width: 72, custom_css: '/* mobile */' }),
    ];
    const harness = makeTransactionHarness([], {
        transformInventory(inventory, inventoryCount) {
            if (inventoryCount !== 2) return inventory;
            return inventory.map((theme) => theme.name === 'Mobile Import'
                ? Object.assign({}, theme, { chat_width: 100 })
                : theme);
        },
    });

    global.__TAURITAVERN_MOBILE_RUNTIME_COMPAT__ = {};
    try {
        const result = await harness.transactions.saveVerifiedThemes(batch);

        assert.equal(result.results.length, 1);
        assert.equal(result.results[0].ok, true);
        assert.equal(result.results[0].theme.chat_width, 100);
        assert.equal(harness.getInventoryCount(), 2);
    } finally {
        delete global.__TAURITAVERN_MOBILE_RUNTIME_COMPAT__;
    }
});

test('desktop batch verification still rejects unexpected chat_width changes', async () => {
    const batch = [
        completeTheme('Desktop Import', { chat_width: 72, custom_css: '/* desktop */' }),
    ];
    const harness = makeTransactionHarness([], {
        transformInventory(inventory, inventoryCount) {
            if (inventoryCount !== 2) return inventory;
            return inventory.map((theme) => theme.name === 'Desktop Import'
                ? Object.assign({}, theme, { chat_width: 100 })
                : theme);
        },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedThemes(batch),
        (error) => error.code === 'batch-verify-failed' && error.rollbackRestored === true,
    );

    assert.equal(harness.store['Desktop Import'], undefined);
    assert.equal(harness.getInventoryCount(), 3);
});

test('batch final verification failure restores the complete original batch state', async () => {
    const previous = completeTheme('Existing', { custom_css: '/* old */' });
    const batch = [
        completeTheme('Existing', { custom_css: '/* new */' }),
        completeTheme('Import Two'),
    ];
    const harness = makeTransactionHarness([previous], {
        transformInventory(inventory, inventoryCount) {
            if (inventoryCount !== 2) return inventory;
            return inventory.map((theme) => theme.name === 'Import Two'
                ? Object.assign({}, theme, { custom_css: '/* corrupted */' })
                : theme);
        },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedThemes(batch),
        (error) => error.code === 'batch-verify-failed' && error.rollbackRestored === true,
    );

    assert.deepEqual(harness.store.Existing, previous);
    assert.equal(harness.store['Import Two'], undefined);
    assert.equal(harness.getInventoryCount(), 3);
});

test('batch rollback failure reports rollback-failed with a content-free state summary', async () => {
    const previous = completeTheme('Existing', { custom_css: '/* old */' });
    const replacement = completeTheme('Existing', { custom_css: '/* new */' });
    const harness = makeTransactionHarness([previous], {
        saveErrorAt: 2,
        transformInventory(inventory, inventoryCount) {
            if (inventoryCount !== 2) return inventory;
            return inventory.map((theme) => Object.assign({}, theme, { custom_css: '/* corrupted */' }));
        },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedThemes([replacement]),
        (error) => {
            assert.equal(error.code, 'rollback-failed');
            assert.equal(Array.isArray(error.details.state), true);
            assert.equal(error.details.state[0].restored, false);
            assert.equal(JSON.stringify(error.details).includes('/* old */'), false);
            assert.equal(JSON.stringify(error.details).includes('/* new */'), false);
            return true;
        },
    );
});

test('rename treats a stale DOM name list as display-only and preserves a fresh destination', async () => {
    const old = completeTheme('Old');
    const concurrentNew = completeTheme('New', { custom_css: '/* concurrent */' });
    const harness = makeTransactionHarness([old, concurrentNew], {
        cachedThemes: { Old: old },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Old', 'New', {
            extraNames: ['Old'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'duplicate',
    );

    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.store.Old, old);
    assert.deepEqual(harness.store.New, concurrentNew);
});

test('rename performs a zero-write abort when the destination appears after the UI snapshot', async () => {
    const old = completeTheme('Old');
    const concurrentNew = completeTheme('New', { custom_css: '/* appeared later */' });
    const harness = makeTransactionHarness([old], {
        cachedThemes: { Old: old },
        transformInventory(inventory, count, store) {
            if (count === 1) {
                store.New = clone(concurrentNew);
                return inventory.concat(clone(concurrentNew));
            }
            return inventory;
        },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Old', 'New', {
            extraNames: ['Old'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'duplicate',
    );

    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.store.Old, old);
    assert.deepEqual(harness.store.New, concurrentNew);
});

test('rename aborts with zero writes when the authoritative prewrite inventory is malformed', async () => {
    const old = completeTheme('Old');
    const harness = makeTransactionHarness([old], {
        cachedThemes: { Old: old },
        transformInventory() { return { themes: null }; },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Old', 'New', {
            extraNames: ['Old'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'inventory-invalid',
    );

    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.store.Old, old);
    assert.equal(harness.store.New, undefined);
});

test('orphan ThemeMgr destination identities abort rename before every theme write', async () => {
    const cases = [
        {
            label: 'metadata',
            data: { themeMeta: { New: { note: 'orphan', screenshot: 'keep.png', category: 'Keep' } } },
            expectedType: 'metadata',
        },
        {
            label: 'pair',
            data: { dayNight: { pairs: { orphanPair: { id: 'orphanPair', dayTheme: 'New', nightTheme: 'Other' } } } },
            expectedType: 'pair',
        },
        {
            label: 'series',
            data: { series: { groups: { orphanSeries: { id: 'orphanSeries', members: [{ kind: 'theme', themeName: 'New' }] } } } },
            expectedType: 'series',
        },
        {
            label: 'binding',
            data: { bindings: { characters: { 'orphan.png': { target: { kind: 'theme', themeName: 'New' } } } } },
            expectedType: 'binding',
        },
    ];

    for (const item of cases) {
        const before = clone(item.data);
        const conflicts = metadata.findThemeIdentityConflicts(item.data, 'New');
        assert.equal(conflicts.some((conflict) => conflict.type === item.expectedType), true, item.label);
        const harness = makeTransactionHarness([completeTheme('Old')]);

        await assert.rejects(
            harness.transactions.renameTheme('Old', 'New', { destinationIdentityConflicts: conflicts }),
            (error) => error && error.code === 'manager-identity-conflict',
        );

        assert.deepEqual(harness.calls, [], item.label);
        assert.equal(harness.getInventoryCount(), 0, item.label);
        assert.equal(harness.getHeaderCount(), 0, item.label);
        assert.deepEqual(item.data, before, item.label);
        assert.equal(harness.store.Old.name, 'Old', item.label);
        assert.equal(harness.store.New, undefined, item.label);
    }
});

test('even an empty own metadata destination key blocks rename while a clean destination proceeds', async () => {
    const orphanData = { themeMeta: { New: {} } };
    assert.deepEqual(metadata.findThemeIdentityConflicts(orphanData, 'New'), [{ type: 'metadata', key: 'New' }]);
    const blocked = makeTransactionHarness([completeTheme('Old')]);
    await assert.rejects(
        blocked.transactions.renameTheme('Old', 'New', {
            destinationIdentityConflicts: metadata.findThemeIdentityConflicts(orphanData, 'New'),
        }),
        (error) => error && error.code === 'manager-identity-conflict',
    );
    assert.deepEqual(blocked.calls, []);

    const cleanData = { themeMeta: {} };
    assert.deepEqual(metadata.findThemeIdentityConflicts(cleanData, 'New'), []);
    const clean = makeTransactionHarness([completeTheme('Old')]);
    const result = await clean.transactions.renameTheme('Old', 'New', { destinationIdentityConflicts: [] });
    assert.equal(result.newName, 'New');
    assert.deepEqual(clean.calls.map((call) => `${call.type}:${call.name}`), ['save:New', 'delete:Old']);
});

test('transactional rename preserves the exact legacy partial fields and saves before deleting', async () => {
    const original = { name: 'Legacy Old', main_text_color: '#abc', custom_css: '' };
    const harness = makeTransactionHarness([original]);
    const result = await harness.transactions.renameTheme('Legacy Old', 'Legacy New');

    assert.deepEqual(harness.store['Legacy New'], { name: 'Legacy New', main_text_color: '#abc', custom_css: '' });
    assert.equal(harness.store['Legacy Old'], undefined);
    assert.equal(result.newName, 'Legacy New');
    assert.equal(harness.getInventoryCount(), 3);
    assert.equal(harness.getHeaderCount(), 1);
    assert.equal(harness.calls[0].headers, harness.calls[1].headers);
    assert.deepEqual(result.transactionContext.sourceTheme, original);
    assert.equal(result.transactionContext.originalInventory.length, 1);
    assert.deepEqual(result.transactionContext.existingNames, ['Legacy Old']);
    assert.equal(result.transactionContext.previousDestinationTheme, null);
    assert.deepEqual(result.transactionContext.expectedRenamedTheme, {
        name: 'Legacy New',
        main_text_color: '#abc',
        custom_css: '',
    });
    assert.deepEqual(harness.calls.map((call) => `${call.type}:${call.name}`), ['save:Legacy New', 'delete:Legacy Old']);
});

test('bridge rename uses hydrated source plus authoritative prewrite and final inventories', async () => {
    const original = { name: 'Bridge Old', main_text_color: '#bridge', custom_css: '' };
    let hydrateCalls = 0;
    const harness = makeTransactionHarness([original], {
        bridge: {
            ensureThemeLoaded(name) {
                hydrateCalls += 1;
                return Promise.resolve(clone(Object.assign({}, original, { name })));
            },
        },
    });

    const result = await harness.transactions.renameTheme('Bridge Old', 'Bridge New', {
        extraNames: ['Bridge Old'],
        extraNamesComplete: true,
    });

    assert.equal(hydrateCalls, 1);
    assert.equal(harness.getInventoryCount(), 2);
    assert.equal(harness.getHeaderCount(), 1);
    assert.equal(result.transactionContext.originalInventory.length, 1);
    assert.deepEqual(result.transactionContext.existingNames, ['Bridge Old']);
    assert.deepEqual(harness.store['Bridge New'], { name: 'Bridge New', main_text_color: '#bridge', custom_css: '' });
    assert.equal(harness.store['Bridge Old'], undefined);
});

test('bridge rename adds an initial source read when the supplied name list is not marked complete', async () => {
    const original = { name: 'Fallback Old', main_text_color: '#bridge' };
    const harness = makeTransactionHarness([original], {
        bridge: { ensureThemeLoaded() { return Promise.resolve(clone(original)); } },
    });

    await harness.transactions.renameTheme('Fallback Old', 'Fallback New', {
        extraNames: ['Fallback Old'],
    });

    assert.equal(harness.getInventoryCount(), 3);
});

test('runtime cache rename still performs authoritative prewrite and final inventories', async () => {
    const original = { name: 'Cached Old', main_text_color: '#cached', custom_css: '' };
    const harness = makeTransactionHarness([original], {
        cachedThemes: { 'Cached Old': original },
    });

    const result = await harness.transactions.renameTheme('Cached Old', 'Cached New', {
        extraNames: ['Cached Old'],
        extraNamesComplete: true,
    });

    assert.equal(harness.getInventoryCount(), 2);
    assert.equal(result.transactionContext.originalInventory.length, 1);
    assert.deepEqual(harness.store['Cached New'], { name: 'Cached New', main_text_color: '#cached', custom_css: '' });
    assert.equal(harness.store['Cached Old'], undefined);
});

test('runtime cache fast path rejects exact name conflicts before saving', async () => {
    const original = { name: 'Cached Source', main_text_color: '#cached' };
    const harness = makeTransactionHarness([
        original,
        { name: 'Existing', main_text_color: '#existing' },
    ], {
        cachedThemes: { 'Cached Source': original },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Cached Source', 'Existing', {
            extraNames: ['Cached Source', 'Existing'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'duplicate',
    );
    assert.equal(harness.getInventoryCount(), 0);
    assert.equal(harness.calls.length, 0);
});

test('runtime cache placeholders do not enter the fast path and safely fall back', async () => {
    const lazy = { name: 'Cached Lazy', __baibaokuLazyTheme: true };
    const harness = makeTransactionHarness([lazy], {
        cachedThemes: { 'Cached Lazy': lazy },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Cached Lazy', 'Cached Lazy New', {
            extraNames: ['Cached Lazy'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'incomplete',
    );
    assert.equal(harness.getInventoryCount(), 1);
    assert.equal(harness.calls.some((call) => call.type === 'save'), false);
});

test('runtime cache name-only objects do not enter the fast path or get saved', async () => {
    const nameOnly = { name: 'Cached Empty' };
    const harness = makeTransactionHarness([nameOnly], {
        cachedThemes: { 'Cached Empty': nameOnly },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Cached Empty', 'Cached Empty New', {
            extraNames: ['Cached Empty'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'incomplete',
    );
    assert.equal(harness.getInventoryCount(), 1);
    assert.equal(harness.calls.some((call) => call.type === 'save'), false);
});

test('bridge fast path still rejects sanitized filename conflicts before saving', async () => {
    const original = { name: 'Bridge Source', main_text_color: '#bridge' };
    const harness = makeTransactionHarness([
        original,
        { name: 'AB', main_text_color: '#existing' },
    ], {
        bridge: { ensureThemeLoaded() { return Promise.resolve(clone(original)); } },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Bridge Source', 'A:B', {
            extraNames: ['Bridge Source', 'AB'],
            extraNamesComplete: true,
        }),
        (error) => error.code === 'filename-conflict',
    );
    assert.equal(harness.getInventoryCount(), 0);
    assert.equal(harness.calls.length, 0);
});

test('save request failure preserves the old theme and does not leave a new file', async () => {
    const old = { name: 'Old', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], { saveErrorAt: 1 });

    await assert.rejects(harness.transactions.renameTheme('Old', 'New'), /injected save failure/);
    assert.deepEqual(harness.store.Old, old);
    assert.equal(harness.store.New, undefined);
});

test('standalone saveVerifiedTheme keeps its original read and post-save verification safety', async () => {
    const harness = makeTransactionHarness([]);
    const theme = { name: 'Standalone', main_text_color: '#safe' };

    await harness.transactions.saveVerifiedTheme(theme);

    assert.equal(harness.getInventoryCount(), 2);
    assert.equal(harness.getHeaderCount(), 1);
    assert.deepEqual(harness.store.Standalone, theme);
});

test('save verification failure preserves old theme and cleans the newly created file', async () => {
    const old = { name: 'Old', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], {
        transformSave(theme, count) {
            if (count === 1) theme.main_text_color = '#corrupted';
            return theme;
        },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Old', 'New'),
        (error) => error.code === 'verify-failed',
    );
    assert.deepEqual(harness.store.Old, old);
    assert.equal(harness.store.New, undefined);
    assert.equal(harness.calls.some((call) => call.type === 'delete' && call.name === 'New'), true);
});

test('failed overwrite verification restores the exact previous partial theme', async () => {
    const old = { name: 'Existing', main_text_color: '#old', custom_css: '' };
    const replacement = { name: 'Existing', main_text_color: '#new' };
    const harness = makeTransactionHarness([old], {
        transformSave(theme, count) {
            if (count === 1) theme.main_text_color = '#corrupted';
            return theme;
        },
    });

    await assert.rejects(
        harness.transactions.saveVerifiedTheme(replacement),
        (error) => error.code === 'verify-failed',
    );
    assert.deepEqual(harness.store.Existing, old);
    assert.deepEqual(harness.calls.map((call) => `${call.type}:${call.name}`), ['save:Existing', 'save:Existing']);
});

test('delete failure is reported only after a fresh read confirms the old theme still exists', async () => {
    const old = { name: 'Keep Me', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], { deleteErrorName: 'Keep Me' });

    await assert.rejects(
        harness.transactions.deleteThemeVerified('Keep Me'),
        (error) => error.code === 'delete-failed',
    );
    assert.deepEqual(harness.store['Keep Me'], old);
});

test('safe single delete removes a non-current theme without switching', async () => {
    const events = [];
    const harness = makeTransactionHarness([completeTheme('A'), completeTheme('B')], {
        onDelete(name) { events.push(`delete:${name}`); },
    });

    const result = await harness.transactions.deleteThemeSafely('B', {
        readCurrentTheme() { return { status: 'known', name: 'A' }; },
        applyFallback() { throw new Error('non-current delete must not switch'); },
    });

    assert.equal(result.switchedFromCurrent, false);
    assert.equal(result.fallbackTheme, '');
    assert.deepEqual(events, ['delete:B']);
    assert.equal(harness.store.A.name, 'A');
    assert.equal(harness.store.B, undefined);
});

test('safe single delete applies and confirms a fallback before deleting the current theme', async () => {
    const events = [];
    let currentTheme = 'A';
    const harness = makeTransactionHarness([completeTheme('A'), completeTheme('B')], {
        onDelete(name) { events.push(`delete:${name}`); },
    });

    const result = await harness.transactions.deleteThemeSafely('A', {
        readCurrentTheme() { return { status: 'known', name: currentTheme }; },
        applyFallback(name) {
            events.push(`apply:${name}`);
            currentTheme = name;
            return { ok: true };
        },
    });

    assert.deepEqual(events, ['apply:B', 'delete:A']);
    assert.equal(result.switchedFromCurrent, true);
    assert.equal(result.fallbackTheme, 'B');
    assert.equal(currentTheme, 'B');
    assert.equal(harness.store.A, undefined);
    assert.equal(harness.store.B.name, 'B');
});

test('safe single delete performs zero delete when fallback application fails', async () => {
    const harness = makeTransactionHarness([completeTheme('A'), completeTheme('B')]);

    await assert.rejects(
        harness.transactions.deleteThemeSafely('A', {
            readCurrentTheme() { return { status: 'known', name: 'A' }; },
            applyFallback() { return { ok: false, reason: 'injected apply failure' }; },
        }),
        (error) => error.code === 'fallback-apply-failed',
    );

    assert.equal(harness.calls.filter((call) => call.type === 'delete').length, 0);
    assert.equal(harness.store.A.name, 'A');
});

test('safe single delete performs zero delete when fallback state verification fails', async () => {
    const harness = makeTransactionHarness([completeTheme('A'), completeTheme('B')]);

    await assert.rejects(
        harness.transactions.deleteThemeSafely('A', {
            readCurrentTheme() { return { status: 'known', name: 'A' }; },
            applyFallback() { return { ok: true }; },
        }),
        (error) => error.code === 'fallback-verify-failed',
    );

    assert.equal(harness.calls.filter((call) => call.type === 'delete').length, 0);
    assert.equal(harness.store.A.name, 'A');
});

test('safe single delete performs zero delete when current identity is unknown', async () => {
    const harness = makeTransactionHarness([completeTheme('A'), completeTheme('B')]);

    await assert.rejects(
        harness.transactions.deleteThemeSafely('A', {
            readCurrentTheme() { return { status: 'unknown' }; },
            applyFallback() { return { ok: true }; },
        }),
        (error) => error.code === 'current-theme-unknown',
    );

    assert.equal(harness.calls.filter((call) => call.type === 'delete').length, 0);
    assert.equal(harness.store.A.name, 'A');
});

test('safe single delete performs zero delete when its authoritative inventory is malformed', async () => {
    let currentReads = 0;
    const harness = makeTransactionHarness([completeTheme('A'), completeTheme('B')], {
        transformInventory() { return { themes: null }; },
    });

    await assert.rejects(
        harness.transactions.deleteThemeSafely('A', {
            readCurrentTheme() { currentReads += 1; return { status: 'known', name: 'A' }; },
            applyFallback() { return { ok: true }; },
        }),
        (error) => error.code === 'delete-read-failed',
    );

    assert.equal(currentReads, 0);
    assert.equal(harness.calls.filter((call) => call.type === 'delete').length, 0);
    assert.equal(harness.store.A.name, 'A');
});

test('safe single delete refuses to remove the sole current theme without a proven fallback', async () => {
    const harness = makeTransactionHarness([completeTheme('A')]);

    await assert.rejects(
        harness.transactions.deleteThemeSafely('A', {
            readCurrentTheme() { return { status: 'known', name: 'A' }; },
            applyFallback() { return { ok: true }; },
        }),
        (error) => error.code === 'no-safe-fallback',
    );

    assert.equal(harness.calls.filter((call) => call.type === 'delete').length, 0);
    assert.equal(harness.store.A.name, 'A');
});

test('malformed safe-delete verification never runs caller metadata cleanup', async () => {
    let cleanupRan = false;
    const harness = makeTransactionHarness([completeTheme('A'), completeTheme('B')], {
        transformInventory(inventory, count) {
            return count === 3 ? { themes: null } : inventory;
        },
    });

    await harness.transactions.deleteThemeSafely('B', {
        readCurrentTheme() { return { status: 'known', name: 'A' }; },
    }).then(() => { cleanupRan = true; }, (error) => {
        assert.equal(error.code, 'delete-failed');
    });

    assert.equal(harness.calls.filter((call) => call.type === 'delete').length, 1);
    assert.equal(cleanupRan, false);
});

test('batch delete uses one initial and one final inventory for every selected theme', async () => {
    const harness = makeTransactionHarness([
        completeTheme('Delete A'),
        completeTheme('Delete B'),
        completeTheme('Keep C'),
    ]);

    const result = await harness.transactions.deleteThemesVerified(['Delete A', 'Delete B', 'Delete A']);

    assert.deepEqual(result.results.map((item) => [item.name, item.ok]), [
        ['Delete A', true],
        ['Delete B', true],
    ]);
    assert.equal(harness.store['Delete A'], undefined);
    assert.equal(harness.store['Delete B'], undefined);
    assert.notEqual(harness.store['Keep C'], undefined);
    assert.equal(harness.getInventoryCount(), 2);
    assert.equal(harness.getHeaderCount(), 1);
    assert.deepEqual(
        harness.calls.filter((call) => call.type === 'delete').map((call) => call.name),
        ['Delete A', 'Delete B'],
    );
});

test('batch delete reports verified partial success without hiding failed items', async () => {
    const harness = makeTransactionHarness([
        completeTheme('Delete A'),
        completeTheme('Keep B'),
    ], { deleteErrorName: 'Keep B' });

    const result = await harness.transactions.deleteThemesVerified(['Delete A', 'Keep B']);

    assert.equal(result.results[0].name, 'Delete A');
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[1].name, 'Keep B');
    assert.equal(result.results[1].ok, false);
    assert.equal(result.results[1].requestError instanceof Error, true);
    assert.equal(harness.store['Delete A'], undefined);
    assert.notEqual(harness.store['Keep B'], undefined);
    assert.equal(harness.getInventoryCount(), 2);
});

test('batch delete read failure sends no delete requests', async () => {
    const harness = makeTransactionHarness([
        completeTheme('Keep A'),
        completeTheme('Keep B'),
    ], { inventoryErrorAt: 1 });

    await assert.rejects(
        harness.transactions.deleteThemesVerified(['Keep A', 'Keep B']),
        (error) => error.code === 'batch-delete-read-failed',
    );

    assert.deepEqual(harness.calls.filter((call) => call.type === 'delete'), []);
    assert.notEqual(harness.store['Keep A'], undefined);
    assert.notEqual(harness.store['Keep B'], undefined);
});

test('rename delete failure restores the old theme and safely removes the new theme', async () => {
    const old = { name: 'Old Safe', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], { deleteErrorName: 'Old Safe' });

    await assert.rejects(
        harness.transactions.renameTheme('Old Safe', 'New Verified'),
        (error) => error.code === 'delete-failed' && error.rollbackRestored === true,
    );
    assert.deepEqual(harness.store['Old Safe'], old);
    assert.equal(harness.store['New Verified'], undefined);
});

test('final rename verification failure restores the old theme and removes the new theme', async () => {
    const old = { name: 'Verify Old', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], {
        transformSave(theme, count) {
            if (count === 1) theme.main_text_color = '#corrupted';
            return theme;
        },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Verify Old', 'Verify New'),
        (error) => error.code === 'verify-failed' && error.rollbackRestored === true,
    );
    assert.deepEqual(harness.store['Verify Old'], old);
    assert.equal(harness.store['Verify New'], undefined);
});

test('rename reports rollback-failed with a content-free current state summary', async () => {
    const old = { name: 'Rollback Old', main_text_color: '#old' };
    const harness = makeTransactionHarness([old], {
        saveErrorAt: 2,
        transformSave(theme, count) {
            if (count === 1) theme.main_text_color = '#corrupted';
            return theme;
        },
    });

    await assert.rejects(
        harness.transactions.renameTheme('Rollback Old', 'Rollback New'),
        (error) => {
            assert.equal(error.code, 'rollback-failed');
            assert.equal(error.details.currentState.inventoryAvailable, true);
            assert.equal(error.details.currentState.oldPresent, false);
            assert.equal(error.details.currentState.newPresent, true);
            assert.equal(JSON.stringify(error.details.currentState).includes('#corrupted'), false);
            return true;
        },
    );
});

test('rename never saves a lazy placeholder when hydration is unavailable', async () => {
    const lazy = { name: 'Lazy Old', __baibaokuLazyTheme: true };
    const harness = makeTransactionHarness([lazy]);

    await assert.rejects(
        harness.transactions.renameTheme('Lazy Old', 'Lazy New'),
        (error) => error.code === 'incomplete',
    );
    assert.equal(harness.calls.some((call) => call.type === 'save'), false);
    assert.deepEqual(harness.store['Lazy Old'], lazy);
});

test('consecutive renames keep remembering each new name for one-inventory follow-ups', async () => {
    const harness = makeTransactionHarness([{ name: 'First', main_text_color: '#one', custom_css: '' }]);

    await harness.transactions.renameTheme('First', 'Second', {
        extraNames: ['First'],
        extraNamesComplete: true,
    });
    await harness.transactions.renameTheme('Second', 'Third', {
        extraNames: ['Second'],
        extraNamesComplete: true,
    });
    await harness.transactions.renameTheme('Third', 'Fourth', {
        extraNames: ['Third'],
        extraNamesComplete: true,
    });

    assert.equal(harness.getInventoryCount(), 7);
    assert.equal(harness.getHeaderCount(), 3);
    assert.equal(harness.store.First, undefined);
    assert.equal(harness.store.Second, undefined);
    assert.equal(harness.store.Third, undefined);
    assert.deepEqual(harness.store.Fourth, { name: 'Fourth', main_text_color: '#one', custom_css: '' });
});

test('rename rejects direct and sanitized filename conflicts without saving', async () => {
    const harness = makeTransactionHarness([
        { name: 'Source', main_text_color: '#source' },
        { name: 'AB', main_text_color: '#existing' },
    ]);

    await assert.rejects(
        harness.transactions.renameTheme('Source', 'A:B'),
        (error) => error.code === 'filename-conflict',
    );
    assert.equal(harness.calls.length, 0);
    assert.deepEqual(harness.store.Source, { name: 'Source', main_text_color: '#source' });
});

function makeBindingContext(overrides) {
    overrides = overrides || {};
    const chatId = overrides.chatId === undefined ? 'Chat One' : overrides.chatId;
    return {
        characters: overrides.characters || [{ name: 'Alice', avatar: 'alice.png', chat: chatId }],
        groups: overrides.groups || [],
        characterId: overrides.characterId === undefined ? 0 : overrides.characterId,
        groupId: overrides.groupId,
        chatId,
        chatMetadata: overrides.chatMetadata === undefined ? { integrity: 'chat-uuid-1' } : overrides.chatMetadata,
        getCurrentChatId() { return chatId; },
    };
}

function createTestEventSource() {
    const handlers = {};
    return {
        handlers,
        on(name, handler) { (handlers[name] ||= []).push(handler); },
        removeListener(name, handler) {
            handlers[name] = (handlers[name] || []).filter((item) => item !== handler);
        },
        emit(name, payload) {
            (handlers[name] || []).slice().forEach((handler) => handler(payload));
        },
    };
}

test('day-night pairs merge two real themes into one logical item with shared editable metadata', () => {
    const data = {
        themeMeta: {
            Sunrise: { category: 'Soft', tags: ['warm'], author: 'Alice', useCount: 2, imageData: 'day.png' },
            Moonrise: { category: 'Dark', tags: ['cool'], starred: true, useCount: 3, imageData: 'night.png' },
        },
    };

    const result = pairs.createPair(data, {
        id: 'pair-1',
        name: 'Garden',
        dayTheme: 'Sunrise',
        nightTheme: 'Moonrise',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.pair.meta.tags, ['warm', 'cool']);
    assert.equal(result.pair.meta.useCount, 3);
    assert.equal(result.pair.meta.starred, true);
    const items = pairs.buildLogicalItems(data, ['Sunrise', 'Moonrise', 'Solo']);
    assert.deepEqual(items.map((item) => [item.kind, item.name]), [
        ['pair', 'Garden'],
        ['theme', 'Solo'],
    ]);
    assert.equal(pairs.getVariantTheme(data, 'pair-1', 'day'), 'Sunrise');
    assert.equal(pairs.getVariantTheme(data, 'pair-1', 'night'), 'Moonrise');
    assert.equal(pairs.renamePair(data, 'pair-1', 'Garden 2'), true);
    assert.equal(pairs.getPair(data, 'pair-1').name, 'Garden 2');
});

test('day-night pair export and import preserve both real themes and the logical relationship', () => {
    const source = { themeMeta: {} };
    pairs.createPair(source, {
        id: 'pair-export',
        name: 'Day and Night',
        dayTheme: 'Light',
        nightTheme: 'Dark',
        meta: { category: 'Series', tags: ['paired'] },
    });

    assert.deepEqual(pairs.exportPairs(source, ['Light']), []);
    const exported = pairs.exportPairs(source, ['Light', 'Dark']);
    assert.equal(exported.length, 1);
    assert.equal(exported[0].name, 'Day and Night');

    const target = { themeMeta: {} };
    const outcome = pairs.importPairs(target, exported, ['Light', 'Dark']);
    assert.equal(outcome.imported, 1);
    assert.equal(outcome.skipped, 0);
    assert.equal(outcome.idMap['pair-export'], 'pair-export');
    assert.equal(pairs.getPair(target, 'pair-export').nightTheme, 'Dark');
    assert.equal(pairs.getPair(target, 'pair-export').meta.category, 'Series');
});

test('pair import reports missing members and preserves safe theme metadata', () => {
    const target = { categories: [], themeMeta: {} };
    metadata.mergeImported(target, ['Light'], { Light: { category: 'Safe', tags: ['kept'] } }, ['Safe']);
    const outcome = pairs.importPairs(target, [{
        id: 'missing-pair',
        name: 'Incomplete Pair',
        dayTheme: 'Light',
        nightTheme: 'Missing',
        meta: { category: 'Pair Category' },
    }], ['Light']);

    assert.equal(outcome.imported, 0);
    assert.equal(outcome.diagnostics[0].reason, 'missing-theme');
    assert.deepEqual(outcome.diagnostics[0].members, ['Missing']);
    assert.equal(target.themeMeta.Light.category, 'Safe');
    assert.deepEqual(target.themeMeta.Light.tags, ['kept']);
});

test('pair member conflicts are diagnosed without replacing the existing relationship', () => {
    const target = { themeMeta: {} };
    pairs.createPair(target, { id: 'local', name: 'Local', dayTheme: 'A', nightTheme: 'B' });
    const outcome = pairs.importPairs(target, [{ id: 'incoming', name: 'Incoming', dayTheme: 'A', nightTheme: 'C' }], ['A', 'B', 'C']);

    assert.equal(outcome.imported, 0);
    assert.equal(outcome.diagnostics[0].reason, 'member-conflict');
    assert.equal(pairs.getPair(target, 'local').nightTheme, 'B');
    assert.equal(pairs.getPair(target, 'incoming'), null);
});

test('pair ensureState diagnostics expose conflicts without discarding raw records', () => {
    const data = { dayNight: { pairs: {
        first: { id: 'first', name: 'First', dayTheme: 'A', nightTheme: 'B' },
        second: { id: 'second', name: 'Second', dayTheme: 'A', nightTheme: 'C' },
    } } };
    const diagnostics = pairs.inspectState(data);

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].reason, 'member-conflict');
    assert.equal(Object.keys(data.dayNight.pairs).length, 2);
    const usable = pairs.ensureState(data);
    assert.deepEqual(Object.keys(usable.pairs), ['first']);
    assert.deepEqual(Object.keys(data.dayNight.pairs), ['first', 'second']);
});

test('series groups ordinary and day-night logical items without changing their theme data', () => {
    const data = { themeMeta: { Rose: { author: 'Alice' }, Blue: { tags: ['cool'] } } };
    const result = series.createSeries(data, {
        id: 'series-colors',
        name: 'Color Set',
        category: 'Variants',
        members: [
            { kind: 'theme', themeName: 'Rose' },
            { kind: 'day-night', pairId: 'pair-colors' },
        ],
    });

    assert.equal(result.ok, true);
    assert.equal(series.getSeries(data, 'series-colors').category, 'Variants');
    assert.deepEqual(data.themeMeta, { Rose: { author: 'Alice' }, Blue: { tags: ['cool'] } });
    assert.equal(series.findSeriesByTarget(data, { kind: 'day-night', pairId: 'pair-colors' }).id, 'series-colors');
    assert.equal(series.createSeries(data, {
        name: 'Duplicate',
        members: [
            { kind: 'theme', themeName: 'Other' },
            { kind: 'theme', themeName: 'Rose' },
        ],
    }).reason, 'already-series');
});

test('series references survive day-night creation and dissolution in their original position', () => {
    const data = {};
    series.createSeries(data, {
        id: 'series-pair-flow',
        name: 'Flow',
        members: [
            { kind: 'theme', themeName: 'Day' },
            { kind: 'theme', themeName: 'Night' },
            { kind: 'theme', themeName: 'Extra' },
        ],
    });

    const merged = series.mergeThemeTargetsIntoPair(data, ['Day', 'Night'], 'pair-flow');
    assert.equal(merged.ok, true);
    assert.deepEqual(series.getSeries(data, 'series-pair-flow').members, [
        { kind: 'day-night', pairId: 'pair-flow' },
        { kind: 'theme', themeName: 'Extra' },
    ]);

    const expanded = series.replacePairReference(data, 'pair-flow', ['Day', 'Night']);
    assert.equal(expanded.ok, true);
    assert.deepEqual(series.getSeries(data, 'series-pair-flow').members, [
        { kind: 'theme', themeName: 'Day' },
        { kind: 'theme', themeName: 'Night' },
        { kind: 'theme', themeName: 'Extra' },
    ]);
});

test('series cleanup dissolves only the relationship when fewer than two members remain', () => {
    const data = {};
    series.createSeries(data, {
        id: 'series-cleanup',
        name: 'Cleanup',
        members: [
            { kind: 'theme', themeName: 'Old' },
            { kind: 'theme', themeName: 'Keep' },
        ],
    });

    assert.equal(series.renameThemeReferences(data, 'Old', 'New'), 1);
    assert.equal(series.findSeriesByTarget(data, { kind: 'theme', themeName: 'New' }).id, 'series-cleanup');
    assert.equal(series.removeThemeReferences(data, ['New']), 1);
    assert.equal(series.getSeries(data, 'series-cleanup'), null);
    assert.equal(data.themeMeta, undefined);
});

test('series export and import require every member and remap day-night pair ids', () => {
    const source = {};
    series.createSeries(source, {
        id: 'series-export',
        name: 'Exported Set',
        category: 'Sets',
        members: [
            { kind: 'theme', themeName: 'Solo' },
            { kind: 'day-night', pairId: 'pair-old' },
        ],
    });

    assert.deepEqual(series.exportSeries(source, ['Solo'], ['pair-old']).map((item) => item.id), ['series-export']);
    assert.deepEqual(series.exportSeries(source, ['Solo'], []), []);

    const target = {};
    const imported = series.importSeries(target, series.exportSeries(source, ['Solo'], ['pair-old']), {
        availableThemeNames: ['Solo'],
        availablePairIds: ['pair-new'],
        pairIdMap: { 'pair-old': 'pair-new' },
    });
    assert.equal(imported.imported, 1);
    assert.deepEqual(series.getSeries(target, 'series-export').members, [
        { kind: 'theme', themeName: 'Solo' },
        { kind: 'day-night', pairId: 'pair-new' },
    ]);
    assert.equal(series.getSeries(target, 'series-export').category, 'Sets');

    const incomplete = {};
    const skipped = series.importSeries(incomplete, series.exportSeries(source, ['Solo'], ['pair-old']), {
        availableThemeNames: ['Solo'],
        availablePairIds: [],
        pairIdMap: {},
    });
    assert.equal(skipped.imported, 0);
    assert.equal(series.listSeries(incomplete).length, 0);
});

test('series partial-member diagnostics preserve safe metadata and do not fabricate a group', () => {
    const target = { categories: [], themeMeta: {} };
    metadata.mergeImported(target, ['First'], { First: { category: 'Safe', author: 'Alice' } }, ['Safe']);
    const outcome = series.importSeries(target, [{
        id: 'partial-series',
        name: 'Partial',
        category: 'Series Category',
        members: [
            { kind: 'theme', themeName: 'First' },
            { kind: 'theme', themeName: 'Missing' },
        ],
    }], { availableThemeNames: ['First'], availablePairIds: [] });

    assert.equal(outcome.imported, 0);
    assert.equal(outcome.diagnostics[0].reason, 'incomplete-members');
    assert.equal(outcome.diagnostics[0].category, 'Series Category');
    assert.equal(target.themeMeta.First.category, 'Safe');
    assert.equal(target.themeMeta.First.author, 'Alice');
    assert.equal(series.listSeries(target).length, 0);
});

test('series member conflicts are diagnosed without replacing a legal local group', () => {
    const target = {};
    series.createSeries(target, {
        id: 'local-series',
        name: 'Local',
        members: [{ kind: 'theme', themeName: 'A' }, { kind: 'theme', themeName: 'B' }],
    });
    const outcome = series.importSeries(target, [{
        id: 'incoming-series',
        name: 'Incoming',
        members: [{ kind: 'theme', themeName: 'A' }, { kind: 'theme', themeName: 'C' }],
    }], { availableThemeNames: ['A', 'B', 'C'], availablePairIds: [] });

    assert.equal(outcome.imported, 0);
    assert.equal(outcome.diagnostics[0].reason, 'member-conflict');
    assert.deepEqual(series.getSeries(target, 'local-series').members, [
        { kind: 'theme', themeName: 'A' },
        { kind: 'theme', themeName: 'B' },
    ]);
    assert.equal(series.getSeries(target, 'incoming-series'), null);
});

test('series ensureState diagnostics expose overlapping records without mutating raw state', () => {
    const data = { series: { groups: {
        first: { id: 'first', name: 'First', members: [{ kind: 'theme', themeName: 'A' }, { kind: 'theme', themeName: 'B' }] },
        second: { id: 'second', name: 'Second', members: [{ kind: 'theme', themeName: 'A' }, { kind: 'theme', themeName: 'C' }] },
    } } };
    const diagnostics = series.inspectState(data);

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].reason, 'member-conflict');
    assert.equal(Object.keys(data.series.groups).length, 2);
    const usable = series.ensureState(data);
    assert.deepEqual(Object.keys(usable.groups), ['first']);
    assert.deepEqual(Object.keys(data.series.groups), ['first', 'second']);
    assert.equal(series.getSeries(data, 'first').members.length, 2);
    assert.equal(series.getSeries(data, 'second'), null);
});

test('pair startup browse export and unrelated saves preserve malformed conflicting raw records', () => {
    const data = {
        dayNight: {
            version: 9,
            futureState: { keep: true },
            pairs: {
                valid: {
                    id: 'valid',
                    name: 'Valid',
                    dayTheme: 'A',
                    nightTheme: 'B',
                    futurePairField: { keep: 'pair' },
                },
                conflict: { id: 'conflict', name: 'Conflict', dayTheme: 'A', nightTheme: 'C' },
                malformed: { id: 'malformed', name: 'Malformed', dayTheme: 'Only' },
            },
        },
        themeMeta: {},
        showBall: true,
    };
    const rawBefore = clone(data.dayNight);

    assert.equal(pairs.inspectState(data).length, 2);
    assert.deepEqual(Object.keys(pairs.ensureState(data).pairs), ['valid']);
    pairs.buildLogicalItems(data, ['A', 'B', 'C']);
    pairs.exportPairs(data, ['A', 'B', 'C']);
    data.showBall = false;
    const persisted = clone(data);

    assert.deepEqual(data.dayNight, rawBefore);
    assert.deepEqual(persisted.dayNight, rawBefore);
    assert.equal(Object.keys(data.dayNight.pairs).length, 3);
    assert.deepEqual(data.dayNight.pairs.valid.futurePairField, { keep: 'pair' });
});

test('series startup list export and unrelated saves preserve malformed short and conflicting raw groups', () => {
    const data = {
        series: {
            version: 7,
            futureState: 'keep-series',
            groups: {
                valid: {
                    id: 'valid',
                    name: 'Valid',
                    members: [{ kind: 'theme', themeName: 'A' }, { kind: 'theme', themeName: 'B' }],
                    futureGroupField: { keep: true },
                },
                conflict: {
                    id: 'conflict',
                    name: 'Conflict',
                    members: [{ kind: 'theme', themeName: 'A' }, { kind: 'theme', themeName: 'C' }],
                },
                short: { id: 'short', name: 'Short', members: [{ kind: 'theme', themeName: 'D' }] },
                malformed: { id: 'malformed', members: 'not-an-array' },
            },
        },
        sortMode: 'name',
    };
    const rawBefore = clone(data.series);

    assert.equal(series.inspectState(data).length, 3);
    assert.deepEqual(series.listSeries(data).map((group) => group.id), ['valid']);
    series.exportSeries(data, ['A', 'B', 'C', 'D'], []);
    data.sortMode = 'recent';
    const persisted = clone(data);

    assert.deepEqual(data.series, rawBefore);
    assert.deepEqual(persisted.series, rawBefore);
    assert.equal(Object.keys(data.series.groups).length, 4);
    assert.deepEqual(data.series.groups.valid.futureGroupField, { keep: true });
});

test('binding startup reads and unrelated saves retain invalid and future raw records', () => {
    const data = {
        bindings: {
            version: 8,
            futureState: { keep: 'bindings' },
            characters: {
                'valid.png': { label: 'Valid', target: { kind: 'theme', themeName: 'A' }, futureRecordField: 42 },
                'invalid.png': { target: { kind: 'future-target', value: 'raw' } },
            },
            chats: { 'invalid-chat': { target: null, raw: 'keep' } },
            manualTarget: { kind: 'future-target', value: 'manual-raw' },
        },
        showFreq: true,
    };
    const rawBefore = clone(data.bindings);
    let saves = 0;
    const controller = bindings.createController({
        load() { return data; },
        save() { saves += 1; },
        getContext() { return {}; },
        getCurrentThemeName() { return 'A'; },
        applyTheme() {},
    });

    assert.equal(bindings.inspectState(data).length, 3);
    assert.equal(bindings.ensureState(data).characters['invalid.png'], undefined);
    assert.equal(bindings.countBindings(data), 1);
    controller.start();
    controller.stop();
    data.showFreq = false;
    const persisted = clone(data);

    assert.equal(saves, 0);
    assert.deepEqual(data.bindings, rawBefore);
    assert.deepEqual(persisted.bindings, rawBefore);
    assert.equal(data.bindings.characters['valid.png'].futureRecordField, 42);
});

test('mixed category pair and series data survive an export-import round trip', () => {
    const source = { categories: ['Ordinary', 'Pairs', 'Series'], themeMeta: {} };
    metadata.mergeImported(source, ['Solo', 'Day', 'Night', 'Series A'], {
        Solo: { category: 'Ordinary', tags: ['solo'], author: 'A', description: 'note' },
        Day: { imageData: 'day.png' },
        Night: { imageData: 'night.png' },
        'Series A': { tags: ['member'] },
    }, source.categories);
    pairs.createPair(source, { id: 'mixed-pair', name: 'Mixed Pair', dayTheme: 'Day', nightTheme: 'Night', meta: { category: 'Pairs', author: 'Pair Author' } });
    series.createSeries(source, {
        id: 'mixed-series',
        name: 'Mixed Series',
        category: 'Series',
        members: [{ kind: 'theme', themeName: 'Solo' }, { kind: 'theme', themeName: 'Series A' }],
    });
    const exportedPairs = pairs.exportPairs(source, ['Solo', 'Day', 'Night', 'Series A']);
    const exportedSeries = series.exportSeries(source, ['Solo', 'Series A'], exportedPairs.map((pair) => pair.id));
    const target = { categories: [], themeMeta: {} };

    metadata.mergeImported(target, ['Solo', 'Day', 'Night', 'Series A'], source.themeMeta, source.categories);
    const pairOutcome = pairs.importPairs(target, exportedPairs, ['Solo', 'Day', 'Night', 'Series A']);
    const seriesOutcome = series.importSeries(target, exportedSeries, {
        availableThemeNames: ['Solo', 'Day', 'Night', 'Series A'],
        availablePairIds: Object.keys(pairs.ensureState(target).pairs),
        pairIdMap: pairOutcome.idMap,
        requirePairIdMap: true,
    });

    assert.deepEqual(target.categories, source.categories);
    assert.equal(target.themeMeta.Solo.category, 'Ordinary');
    assert.equal(pairs.getPair(target, 'mixed-pair').meta.category, 'Pairs');
    assert.equal(series.getSeries(target, 'mixed-series').category, 'Series');
    assert.equal(seriesOutcome.imported, 1);
});

test('series export skips the whole group when any member is outside the export', () => {
    const data = {};
    series.createSeries(data, {
        id: 'series-complete-export',
        name: 'Complete Export',
        members: [
            { kind: 'theme', themeName: 'First' },
            { kind: 'theme', themeName: 'Second' },
            { kind: 'day-night', pairId: 'pair-complete-export' },
        ],
    });

    assert.deepEqual(
        series.exportSeries(data, ['First', 'Second'], ['pair-complete-export']).map((group) => group.id),
        ['series-complete-export'],
    );
    assert.deepEqual(series.exportSeries(data, ['First'], ['pair-complete-export']), []);
    assert.deepEqual(series.exportSeries(data, ['First', 'Second'], []), []);
});

test('series import skips the whole group when any member is unavailable', () => {
    const raw = [{
        id: 'series-incomplete-import',
        name: 'Incomplete Import',
        members: [
            { kind: 'theme', themeName: 'First' },
            { kind: 'theme', themeName: 'Second' },
            { kind: 'day-night', pairId: 'pair-source' },
        ],
    }];

    const missingTheme = {};
    const themeOutcome = series.importSeries(missingTheme, raw, {
        availableThemeNames: ['First'],
        availablePairIds: ['pair-target'],
        pairIdMap: { 'pair-source': 'pair-target' },
    });
    assert.equal(themeOutcome.imported, 0);
    assert.equal(themeOutcome.skipped, 1);
    assert.equal(themeOutcome.diagnostics[0].reason, 'incomplete-members');
    assert.deepEqual(series.listSeries(missingTheme), []);

    const missingPair = {};
    const pairOutcome = series.importSeries(missingPair, raw, {
        availableThemeNames: ['First', 'Second'],
        availablePairIds: [],
        pairIdMap: {},
    });
    assert.equal(pairOutcome.imported, 0);
    assert.equal(pairOutcome.skipped, 1);
    assert.equal(pairOutcome.diagnostics[0].reason, 'incomplete-members');
    assert.deepEqual(series.listSeries(missingPair), []);
});

test('series import rejects ordinary targets already represented by a local day-night item', () => {
    const data = {
        dayNight: {
            version: 1,
            pairs: {
                'pair-local': {
                    id: 'pair-local',
                    name: 'Local Pair',
                    dayTheme: 'First',
                    nightTheme: 'Night',
                },
            },
        },
    };
    const outcome = series.importSeries(data, [{
        id: 'series-hidden-import',
        name: 'Hidden Import',
        members: [
            { kind: 'theme', themeName: 'First' },
            { kind: 'theme', themeName: 'Second' },
        ],
    }], {
        availableThemeNames: ['First', 'Second'],
        availablePairIds: ['pair-local'],
    });

    assert.equal(outcome.imported, 0);
    assert.equal(outcome.skipped, 1);
    assert.equal(outcome.diagnostics[0].reason, 'incomplete-members');
    assert.deepEqual(series.listSeries(data), []);
});

test('series import does not reuse a skipped source pair id that belongs to a local pair', () => {
    const data = {
        dayNight: {
            version: 1,
            pairs: {
                'pair-source': {
                    id: 'pair-source',
                    name: 'Unrelated Local Pair',
                    dayTheme: 'Local Day',
                    nightTheme: 'Local Night',
                },
            },
        },
    };
    const outcome = series.importSeries(data, [{
        id: 'series-skipped-pair',
        name: 'Skipped Pair',
        members: [
            { kind: 'theme', themeName: 'Solo' },
            { kind: 'day-night', pairId: 'pair-source' },
        ],
    }], {
        availableThemeNames: ['Solo'],
        availablePairIds: ['pair-source'],
        skippedPairIds: ['pair-source'],
    });

    assert.equal(outcome.imported, 0);
    assert.equal(outcome.skipped, 1);
    assert.equal(outcome.diagnostics[0].reason, 'incomplete-members');
    assert.deepEqual(series.listSeries(data), []);
});

test('series import can require an explicit pair id mapping instead of reusing an unrelated local id', () => {
    const data = {
        dayNight: {
            version: 1,
            pairs: {
                'pair-source': {
                    id: 'pair-source',
                    name: 'Local Pair With Same Id',
                    dayTheme: 'Local Day',
                    nightTheme: 'Local Night',
                },
            },
        },
    };
    const outcome = series.importSeries(data, [{
        id: 'series-requires-pair-map',
        name: 'Requires Pair Map',
        members: [
            { kind: 'theme', themeName: 'Solo' },
            { kind: 'day-night', pairId: 'pair-source' },
        ],
    }], {
        availableThemeNames: ['Solo'],
        availablePairIds: ['pair-source'],
        pairIdMap: {},
        requirePairIdMap: true,
    });

    assert.equal(outcome.imported, 0);
    assert.equal(outcome.skipped, 1);
    assert.equal(outcome.diagnostics[0].reason, 'incomplete-members');
    assert.deepEqual(series.listSeries(data), []);
});

test('series import is idempotent for an already imported group', () => {
    const data = {};
    const raw = [{
        id: 'series-idempotent',
        name: 'Idempotent',
        category: 'Sets',
        members: [
            { kind: 'theme', themeName: 'First' },
            { kind: 'theme', themeName: 'Second' },
        ],
    }];
    const options = {
        availableThemeNames: ['First', 'Second'],
        availablePairIds: [],
        pairIdMap: {},
    };

    const first = series.importSeries(data, raw, options);
    const afterFirst = clone(data.series);
    const second = series.importSeries(data, raw, options);

    assert.deepEqual(clone(first), {
        imported: 1,
        skipped: 0,
        idMap: { 'series-idempotent': 'series-idempotent' },
        diagnostics: [],
    });
    assert.deepEqual(clone(second), {
        imported: 0,
        skipped: 1,
        idMap: { 'series-idempotent': 'series-idempotent' },
        diagnostics: [{ type: 'series', id: 'series-idempotent', name: 'Idempotent', reason: 'already-present', severity: 'info', mappedId: 'series-idempotent' }],
    });
    assert.deepEqual(clone(data.series), afterFirst);
    assert.equal(series.listSeries(data).length, 1);
});

test('series target replacement across two groups is rejected without mutation', () => {
    const data = {};
    series.createSeries(data, {
        id: 'series-left',
        name: 'Left',
        members: [
            { kind: 'theme', themeName: 'Left Source' },
            { kind: 'theme', themeName: 'Left Keep' },
        ],
    });
    series.createSeries(data, {
        id: 'series-right',
        name: 'Right',
        members: [
            { kind: 'theme', themeName: 'Right Source' },
            { kind: 'theme', themeName: 'Right Keep' },
        ],
    });
    const before = clone(data.series);

    const outcome = series.replaceTargets(
        data,
        [
            { kind: 'theme', themeName: 'Left Source' },
            { kind: 'theme', themeName: 'Right Source' },
        ],
        [{ kind: 'day-night', pairId: 'pair-cross-series' }],
    );

    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'multiple-series');
    assert.deepEqual(outcome.seriesIds, ['series-left', 'series-right']);
    assert.deepEqual(clone(data.series), before);
});

test('series ensureState does not leak claims from a rejected overlapping group', () => {
    const data = {
        series: {
            version: 1,
            groups: {
                first: {
                    id: 'first',
                    name: 'First',
                    members: [
                        { kind: 'theme', themeName: 'Claimed' },
                        { kind: 'theme', themeName: 'Shared' },
                    ],
                },
                rejected: {
                    id: 'rejected',
                    name: 'Rejected',
                    members: [
                        { kind: 'theme', themeName: 'Shared' },
                        { kind: 'theme', themeName: 'Available Later' },
                    ],
                },
                later: {
                    id: 'later',
                    name: 'Later',
                    members: [
                        { kind: 'theme', themeName: 'Available Later' },
                        { kind: 'theme', themeName: 'Final' },
                    ],
                },
            },
        },
    };

    const state = series.ensureState(data);

    assert.deepEqual(Object.keys(state.groups), ['first', 'later']);
    assert.equal(series.findSeriesByTarget(data, { kind: 'theme', themeName: 'Available Later' }).id, 'later');
    assert.deepEqual(state.groups.later.members, [
        { kind: 'theme', themeName: 'Available Later' },
        { kind: 'theme', themeName: 'Final' },
    ]);
});

test('color-scheme watcher detects mobile WebView changes even when the original media query stays stale', () => {
    let dark = false;
    let poll = null;
    let clearedTimer = null;
    const listeners = {};
    const mediaQueries = [];
    const makeEventTarget = () => ({
        addEventListener(name, handler) { listeners[name] = handler; },
        removeEventListener(name, handler) {
            if (listeners[name] === handler) delete listeners[name];
        },
    });
    const changes = [];
    const watcher = pairs.createColorSchemeWatcher({
        matchMedia() {
            const query = {
                matches: dark,
                addEventListener(name, handler) {
                    if (name === 'change') this.listener = handler;
                },
                removeEventListener() {},
            };
            mediaQueries.push(query);
            return query;
        },
        document: makeEventTarget(),
        window: makeEventTarget(),
        setInterval(handler) { poll = handler; return 7; },
        clearInterval(id) { clearedTimer = id; },
        onChange(next, previous, reason) { changes.push({ next, previous, reason }); },
    });

    watcher.start();
    assert.equal(watcher.getVariant(), 'day');
    assert.equal(mediaQueries[1].matches, false);
    dark = true;
    assert.equal(mediaQueries[1].matches, false);
    poll();
    assert.deepEqual(changes, [{ next: 'night', previous: 'day', reason: 'poll' }]);
    poll();
    assert.equal(changes.length, 1);
    watcher.stop();
    assert.equal(clearedTimer, 7);
});

test('creating and dissolving a day-night item migrates character chat and manual targets safely', () => {
    const data = { themeMeta: {} };
    const context = makeBindingContext();
    const state = bindings.ensureMutableState(data);
    state.manualTheme = 'Day';
    bindings.setBinding(data, 'character', context, 'Night');
    bindings.setBinding(data, 'chat', context, 'Day');
    pairs.createPair(data, {
        id: 'pair-bindings',
        name: 'Shared',
        dayTheme: 'Day',
        nightTheme: 'Night',
    });

    assert.equal(bindings.mergeThemeReferencesIntoPair(data, ['Day', 'Night'], 'pair-bindings'), 3);
    assert.deepEqual(bindings.resolve(data, context).target, { kind: 'day-night', pairId: 'pair-bindings' });
    assert.deepEqual(bindings.ensureState(data).manualTarget, { kind: 'day-night', pairId: 'pair-bindings' });
    assert.equal(bindings.listTargetReferences(data, { kind: 'day-night', pairId: 'pair-bindings' }).chats.length, 1);

    const migrations = pairs.removeThemeReferences(data, ['Day']);
    assert.deepEqual(migrations.map((item) => [item.pairId, item.replacementTheme]), [['pair-bindings', 'Night']]);
    assert.equal(bindings.replacePairReferences(data, 'pair-bindings', 'Night'), 3);
    assert.equal(bindings.resolve(data, context).themeName, 'Night');
    assert.equal(pairs.getPair(data, 'pair-bindings'), null);
});

test('binding controller resolves a logical day-night target to the current preferred variant', () => {
    const data = { themeMeta: {} };
    pairs.createPair(data, {
        id: 'pair-auto',
        name: 'Auto',
        dayTheme: 'Day',
        nightTheme: 'Night',
    });
    const context = makeBindingContext();
    bindings.setBinding(data, 'chat', context, { kind: 'day-night', pairId: 'pair-auto' });
    let preferred = 'night';
    let currentTheme = 'Day';
    const applied = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        makeTargetForTheme(name) { return pairs.targetForTheme(data, name); },
        resolveTargetTheme(target) { return pairs.resolveTargetTheme(data, target, preferred); },
        applyTheme(name, callback) {
            applied.push(name);
            currentTheme = name;
            callback(true);
        },
    });

    controller.reconcile();
    assert.deepEqual(applied, ['Night']);
    assert.equal(controller.getCurrentState().resolution.themeName, 'Night');
    preferred = 'day';
    controller.reconcile();
    assert.deepEqual(applied, ['Night', 'Day']);
});

test('chat changes clear a temporary day-night override before automatic reconciliation', () => {
    const handlers = {};
    const eventSource = {
        on(name, handler) { (handlers[name] ||= []).push(handler); },
        removeListener(name, handler) {
            handlers[name] = (handlers[name] || []).filter((item) => item !== handler);
        },
        emit(name) { (handlers[name] || []).slice().forEach((handler) => handler()); },
    };
    const context = makeBindingContext();
    context.eventSource = eventSource;
    context.eventTypes = { CHAT_CHANGED: 'chat-changed', CHAT_LOADED: 'chat-loaded' };
    const data = { themeMeta: {} };
    pairs.createPair(data, {
        id: 'pair-temporary',
        name: 'Temporary',
        dayTheme: 'Day',
        nightTheme: 'Night',
    });
    bindings.setBinding(data, 'chat', context, { kind: 'day-night', pairId: 'pair-temporary' });
    let preferred = 'night';
    let currentTheme = 'Night';
    let resetCount = 0;
    const applied = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        resolveTargetTheme(target) { return pairs.resolveTargetTheme(data, target, preferred); },
        beforeAutomaticReconcile() {
            resetCount += 1;
            preferred = 'day';
        },
        applyTheme(name, callback) {
            applied.push(name);
            currentTheme = name;
            callback(true);
        },
    });

    controller.start();
    eventSource.emit('chat-changed');
    assert.equal(resetCount, 1);
    assert.deepEqual(applied, ['Day']);
    controller.stop();
});

test('binding state normalizes legacy strings and drops malformed records', () => {
    const data = {
        bindings: {
            characters: {
                'alice.png': 'Rose',
                'broken.png': { target: { kind: 'pair', themeName: 'Future' } },
            },
            chats: {
                'chat-1': { label: 'First', themeName: 'Blue' },
                '': 'Ignored',
            },
            manualTheme: 42,
        },
    };

    const state = bindings.ensureState(data);

    assert.deepEqual(state.characters['alice.png'], {
        label: '',
        target: { kind: 'theme', themeName: 'Rose' },
    });
    assert.equal(state.characters['broken.png'], undefined);
    assert.deepEqual(state.chats['chat-1'], {
        label: 'First',
        target: { kind: 'theme', themeName: 'Blue' },
    });
    assert.equal(state.manualTheme, '');
});

test('binding diagnostics expose malformed records while raw records remain intact', () => {
    const data = {
        bindings: {
            characters: { 'valid.png': 'Rose', 'broken.png': { target: { kind: 'pair', themeName: 'Future' } } },
            chats: { '': 'Ignored' },
            manualTarget: { kind: 'unknown' },
        },
    };
    const diagnostics = bindings.inspectState(data);

    assert.equal(diagnostics.length, 3);
    assert.deepEqual(diagnostics.map((item) => item.scope).sort(), ['characters', 'chats', 'manual']);
    assert.equal(Object.keys(data.bindings.characters).length, 2);
    const usable = bindings.ensureState(data);
    assert.equal(usable.characters['broken.png'], undefined);
    assert.deepEqual(data.bindings.characters['broken.png'], { target: { kind: 'pair', themeName: 'Future' } });
});

test('chat binding overrides character binding and both fall back to the manual theme', () => {
    const data = {};
    const context = makeBindingContext();
    bindings.ensureMutableState(data).manualTheme = 'Manual';

    assert.equal(bindings.setBinding(data, 'character', context, 'Character Theme').ok, true);
    assert.equal(bindings.setBinding(data, 'chat', context, 'Chat Theme').ok, true);
    assert.deepEqual(
        [bindings.resolve(data, context).scope, bindings.resolve(data, context).themeName],
        ['chat', 'Chat Theme'],
    );

    bindings.clearBinding(data, 'chat', context);
    assert.deepEqual(
        [bindings.resolve(data, context).scope, bindings.resolve(data, context).themeName],
        ['character', 'Character Theme'],
    );

    bindings.clearBinding(data, 'character', context);
    assert.deepEqual(
        [bindings.resolve(data, context).scope, bindings.resolve(data, context).themeName],
        ['', 'Manual'],
    );
});

test('binding identities use avatar and chat integrity instead of mutable indexes or chat names', () => {
    const first = makeBindingContext({ chatId: 'Before Rename' });
    const reordered = makeBindingContext({
        chatId: 'After Rename',
        characters: [
            { name: 'Other', avatar: 'other.png', chat: 'Other Chat' },
            { name: 'Alice', avatar: 'alice.png', chat: 'After Rename' },
        ],
        characterId: 1,
        chatMetadata: { integrity: 'chat-uuid-1' },
    });
    const data = {};

    bindings.setBinding(data, 'character', first, 'Character Theme');
    bindings.setBinding(data, 'chat', first, 'Chat Theme');

    const result = bindings.resolve(data, reordered);
    assert.equal(result.scope, 'chat');
    assert.equal(result.themeName, 'Chat Theme');
    bindings.clearBinding(data, 'chat', reordered);
    assert.equal(bindings.resolve(data, reordered).themeName, 'Character Theme');
});

test('group chats use only their chat binding and never inherit a transient member character binding', () => {
    const data = {};
    const direct = makeBindingContext();
    const group = makeBindingContext({
        groups: [{ id: 'group-1', name: 'Team', chat_id: 'Group Chat' }],
        groupId: 'group-1',
        chatId: 'Group Chat',
        chatMetadata: { integrity: 'group-chat-uuid' },
    });
    bindings.ensureMutableState(data).manualTheme = 'Manual';
    bindings.setBinding(data, 'character', direct, 'Character Theme');

    assert.deepEqual(
        [bindings.resolve(data, group).scope, bindings.resolve(data, group).themeName],
        ['', 'Manual'],
    );
    assert.equal(bindings.setBinding(data, 'character', group, 'Wrong').reason, 'no-character');
    assert.equal(bindings.setBinding(data, 'chat', group, 'Group Theme').ok, true);
    assert.deepEqual(
        [bindings.resolve(data, group).scope, bindings.resolve(data, group).themeName],
        ['chat', 'Group Theme'],
    );
});

test('theme rename and deletion update every binding reference atomically in plugin data', () => {
    const data = {};
    const first = makeBindingContext();
    const second = makeBindingContext({
        chatId: 'Chat Two',
        chatMetadata: { integrity: 'chat-uuid-2' },
    });
    const state = bindings.ensureMutableState(data);
    state.manualTheme = 'Old';
    bindings.setBinding(data, 'character', first, 'Old');
    bindings.setBinding(data, 'chat', first, 'Old');
    bindings.setBinding(data, 'chat', second, 'Keep');

    assert.equal(bindings.renameThemeReferences(data, 'Old', 'New'), 3);
    assert.equal(bindings.ensureState(data).manualTheme, 'New');
    assert.equal(bindings.countThemeReferences(data, 'New'), 2);
    assert.equal(bindings.removeThemeReferences(data, 'New'), 3);
    assert.equal(bindings.ensureState(data).manualTheme, '');
    assert.equal(bindings.countThemeReferences(data, 'New'), 0);
    assert.equal(bindings.countThemeReferences(data, 'Keep'), 1);
});

test('binding reference listing returns concrete character and chat labels for the edit sheet', () => {
    const data = {};
    const first = makeBindingContext();
    const second = makeBindingContext({
        characters: [{ name: 'Bella', avatar: 'bella.png', chat: 'Bella Chat' }],
        chatId: 'Bella Chat',
        chatMetadata: { integrity: 'chat-uuid-2' },
    });
    bindings.setBinding(data, 'character', first, 'Rose');
    bindings.setBinding(data, 'chat', first, 'Rose');
    bindings.setBinding(data, 'character', second, 'Rose');
    bindings.setBinding(data, 'chat', second, 'Other');

    assert.deepEqual(bindings.listThemeReferences(data, 'Rose'), {
        characters: [
            { key: 'alice.png', label: 'Alice' },
            { key: 'bella.png', label: 'Bella' },
        ],
        chats: [
            { key: 'chat-uuid-1', label: 'Alice · Chat One' },
        ],
    });
});

test('binding overview removal can clear one matching reference or every reference without touching another target', () => {
    const data = {};
    const first = makeBindingContext();
    const second = makeBindingContext({
        characters: [{ name: 'Bella', avatar: 'bella.png', chat: 'Bella Chat' }],
        chatId: 'Bella Chat',
        chatMetadata: { integrity: 'chat-uuid-2' },
    });
    const pairTarget = { kind: 'day-night', pairId: 'pair-overview' };
    bindings.ensureMutableState(data).manualTarget = pairTarget;
    bindings.setBinding(data, 'character', first, pairTarget);
    bindings.setBinding(data, 'chat', first, pairTarget);
    bindings.setBinding(data, 'character', second, pairTarget);
    bindings.setBinding(data, 'chat', second, 'Keep');

    assert.equal(bindings.removeTargetReference(data, 'character', 'alice.png', pairTarget), true);
    assert.equal(bindings.removeTargetReference(data, 'chat', 'chat-uuid-2', pairTarget), false);
    assert.equal(bindings.ensureState(data).chats['chat-uuid-2'].target.themeName, 'Keep');
    assert.equal(bindings.removeTargetReferences(data, pairTarget), 2);
    assert.deepEqual(bindings.listTargetReferences(data, pairTarget), { characters: [], chats: [] });
    assert.equal(bindings.ensureState(data).chats['chat-uuid-2'].target.themeName, 'Keep');
    assert.deepEqual(bindings.ensureState(data).manualTarget, pairTarget);
});

test('character rename migrates the stable binding key and deletion removes it', () => {
    const data = {};
    bindings.setBinding(data, 'character', makeBindingContext(), 'Rose');

    assert.equal(bindings.moveCharacterBinding(data, 'alice.png', 'alice-renamed.png'), true);
    assert.equal(bindings.ensureState(data).characters['alice.png'], undefined);
    assert.equal(bindings.getThemeName(bindings.ensureState(data).characters['alice-renamed.png']), 'Rose');
    assert.equal(bindings.removeCharacterBinding(data, 'alice-renamed.png'), true);
    assert.equal(bindings.countBindings(data), 0);
});

test('live character image replacement migrates its binding from the previous avatar filename', () => {
    const handlers = {};
    const eventSource = {
        on(name, handler) {
            (handlers[name] ||= []).push(handler);
        },
        removeListener(name, handler) {
            handlers[name] = (handlers[name] || []).filter((item) => item !== handler);
        },
        emit(name, payload) {
            (handlers[name] || []).slice().forEach((handler) => handler(payload));
        },
    };
    const context = makeBindingContext();
    context.eventSource = eventSource;
    context.eventTypes = {
        CHAT_CHANGED: 'chat-changed',
        CHAT_LOADED: 'chat-loaded',
        CHARACTER_RENAMED: 'character-renamed',
        CHARACTER_EDITED: 'character-edited',
        CHARACTER_DELETED: 'character-deleted',
        CHARACTER_PAGE_LOADED: 'character-page-loaded',
    };
    const data = {};
    bindings.ensureMutableState(data).manualTheme = 'Rose';
    bindings.setBinding(data, 'character', context, 'Rose');
    let saveCount = 0;
    const controller = bindings.createController({
        load() { return data; },
        save() { saveCount += 1; },
        getContext() { return context; },
        getCurrentThemeName() { return 'Rose'; },
        applyTheme() { throw new Error('no apply expected'); },
    });
    controller.start();

    context.characters[0] = { name: 'Alice', avatar: 'alice-new.png', chat: 'Chat One' };
    eventSource.emit('character-edited', {
        detail: { id: 0, character: context.characters[0] },
    });

    assert.equal(bindings.ensureState(data).characters['alice.png'], undefined);
    assert.equal(bindings.getThemeName(bindings.ensureState(data).characters['alice-new.png']), 'Rose');
    assert.equal(bindings.ensureState(data).characters['alice-new.png'].label, 'Alice');
    assert.equal(saveCount, 1);
    controller.stop();
});

test('rapid context changes cancel an obsolete binding apply even when the restored theme is already current', () => {
    const data = {};
    const boundContext = makeBindingContext();
    const unboundContext = makeBindingContext({
        characterId: null,
        characters: [],
        chatId: '',
        chatMetadata: {},
    });
    bindings.ensureMutableState(data).manualTheme = 'Manual';
    bindings.setBinding(data, 'chat', boundContext, 'Bound');

    let context = boundContext;
    const currentTheme = 'Manual';
    let cancelCount = 0;
    let appliedCount = 0;
    const pending = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        applyTheme(name, callback) { pending.push({ name, callback }); },
        cancelApply() { cancelCount += 1; },
        onApplied() { appliedCount += 1; },
    });

    controller.reconcile();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].name, 'Bound');
    assert.equal(controller.isAutomatedThemeChange('Bound'), true);
    assert.equal(controller.recordManualTheme('Bound'), false);

    context = unboundContext;
    controller.reconcile();
    assert.equal(cancelCount, 1);

    pending[0].callback(true);
    assert.equal(appliedCount, 0);
    assert.equal(controller.isAutomatedThemeChange('Bound'), false);
});

test('duplicate chat events do not cancel the still-desired automatic apply after its native change fires', () => {
    const data = {};
    const context = makeBindingContext();
    bindings.ensureMutableState(data).manualTheme = 'Manual';
    bindings.setBinding(data, 'chat', context, 'Bound');

    let currentTheme = 'Manual';
    let cancelCount = 0;
    const pending = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        applyTheme(name, callback) { pending.push({ name, callback }); },
        cancelApply() { cancelCount += 1; },
    });

    controller.reconcile();
    currentTheme = 'Bound';
    controller.reconcile();

    assert.equal(cancelCount, 0);
    pending[0].callback(true);
    assert.equal(controller.isAutomatedThemeChange('Bound'), false);
});

test('CHAT_CHANGED during a pending manual B intent never restores persisted manual A or starts duplicate B', () => {
    const events = createTestEventSource();
    const context = makeBindingContext();
    context.eventSource = events;
    context.eventTypes = { CHAT_CHANGED: 'chat-changed', CHAT_LOADED: 'chat-loaded' };
    const data = {};
    bindings.ensureMutableState(data).manualTarget = { kind: 'theme', themeName: 'A' };
    bindings.ensureMutableState(data).manualTheme = 'A';
    let currentTheme = 'A';
    const applied = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        applyTheme(name) { applied.push(name); },
    });
    controller.start();
    const token = controller.beginManualIntent('B');

    events.emit('chat-changed');

    assert.deepEqual(applied, []);
    assert.equal(controller.getCurrentState().manualTheme, 'B');
    assert.equal(bindings.ensureState(data).manualTheme, 'A');
    assert.equal(controller.finishManualIntent(token, true), true);
    assert.equal(bindings.ensureState(data).manualTheme, 'B');
    controller.stop();
});

test('late B completion cannot overwrite newer manual C intent and genuine current failure rolls back safely', () => {
    const data = {};
    bindings.ensureMutableState(data).manualTarget = { kind: 'theme', themeName: 'A' };
    bindings.ensureMutableState(data).manualTheme = 'A';
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return makeBindingContext(); },
        getCurrentThemeName() { return 'A'; },
        applyTheme() {},
    });
    const tokenB = controller.beginManualIntent('B');
    const tokenC = controller.beginManualIntent('C');

    assert.equal(controller.finishManualIntent(tokenB, true), false);
    assert.equal(controller.finishManualIntent(tokenB, false, 'apply-failed'), false);
    assert.equal(controller.getCurrentState().manualTheme, 'C');
    assert.equal(bindings.ensureState(data).manualTheme, 'A');
    assert.equal(controller.finishManualIntent(tokenC, true), true);
    assert.equal(bindings.ensureState(data).manualTheme, 'C');

    const tokenD = controller.beginManualIntent('D');
    assert.equal(controller.finishManualIntent(tokenD, false, 'state-verify-failed'), false);
    assert.equal(controller.getCurrentState().manualTheme, 'C');
    assert.equal(bindings.ensureState(data).manualTheme, 'C');
});

test('chat and character bindings keep priority over the latest manual intent', () => {
    const data = {};
    const context = makeBindingContext();
    bindings.ensureMutableState(data).manualTarget = { kind: 'theme', themeName: 'A' };
    bindings.ensureMutableState(data).manualTheme = 'A';
    bindings.setBinding(data, 'character', context, 'Character');
    bindings.setBinding(data, 'chat', context, 'Chat');
    let currentTheme = 'A';
    const pending = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return currentTheme; },
        applyTheme(name, callback) { pending.push({ name, callback }); },
    });
    const manualToken = controller.beginManualIntent('B');

    controller.reconcile();
    const chatRequest = pending.shift();
    assert.equal(chatRequest.name, 'Chat');
    currentTheme = 'Chat';
    chatRequest.callback(true);
    controller.finishManualIntent(manualToken, false, 'superseded');

    bindings.clearBinding(data, 'chat', context);
    controller.reconcile();
    const characterRequest = pending.shift();
    assert.equal(characterRequest.name, 'Character');
    currentTheme = 'Character';
    characterRequest.callback(true);

    bindings.clearBinding(data, 'character', context);
    controller.reconcile();
    const manualRequest = pending.shift();
    assert.equal(manualRequest.name, 'B');
    currentTheme = 'B';
    manualRequest.callback(true);
    assert.equal(bindings.ensureState(data).manualTheme, 'B');
});

test('CHAT_CHANGED with no binding does not reapply an already-current manual theme', () => {
    const events = createTestEventSource();
    const context = makeBindingContext();
    context.eventSource = events;
    context.eventTypes = { CHAT_CHANGED: 'chat-changed', CHAT_LOADED: 'chat-loaded' };
    const data = {};
    bindings.ensureMutableState(data).manualTarget = { kind: 'theme', themeName: 'B' };
    bindings.ensureMutableState(data).manualTheme = 'B';
    let applyCount = 0;
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return context; },
        getCurrentThemeName() { return 'B'; },
        applyTheme() { applyCount += 1; },
    });
    controller.start();
    events.emit('chat-changed');
    events.emit('chat-loaded');

    assert.equal(applyCount, 0);
    controller.stop();
});

test('day-night reconciliation resolves the latest manual pair intent instead of the old persisted target', () => {
    const data = { themeMeta: {} };
    pairs.createPair(data, {
        id: 'intent-pair',
        name: 'Intent Pair',
        dayTheme: 'Day',
        nightTheme: 'Night',
    });
    bindings.ensureMutableState(data).manualTarget = { kind: 'theme', themeName: 'Old' };
    bindings.ensureMutableState(data).manualTheme = 'Old';
    let variant = 'day';
    const pending = [];
    const controller = bindings.createController({
        load() { return data; },
        save() {},
        getContext() { return makeBindingContext(); },
        getCurrentThemeName() { return 'Old'; },
        makeTargetForTheme(name) { return pairs.targetForTheme(data, name); },
        resolveTargetTheme(target) { return pairs.resolveTargetTheme(data, target, variant); },
        applyTheme(name, callback) { pending.push({ name, callback }); },
    });
    controller.beginManualIntent('Day');

    controller.reconcile();
    assert.equal(pending.length, 0);
    variant = 'night';
    controller.reconcile();
    assert.equal(pending[0].name, 'Night');
    assert.notEqual(pending[0].name, 'Old');
});
