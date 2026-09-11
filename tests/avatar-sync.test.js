const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function loadModules() {
    const window = { console, Promise, Map, Set, WeakMap, Date, Math, JSON, Number, Object, setTimeout, clearTimeout };
    window.window = window;
    window.globalThis = window;
    const context = vm.createContext(window);
    ['avatar-storage.js', 'avatar-sync.js'].forEach(name => {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8'), context, { filename: name });
    });
    return window.ThemeMgrModules;
}

const modules = loadModules();

function fingerprint(number) {
    return 'sha256:' + String(number).padStart(64, '0');
}

function asset(id = 'a') {
    return {
        id,
        name: id,
        imageData: `data:image/jpeg;base64,main-${id}`,
        thumbData: `data:image/jpeg;base64,thumb-${id}`,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
    };
}

function memoryStore(seed) {
    return modules.createAvatarStore({ adapter: modules.avatarStorage.createMemoryAdapter(seed) });
}

function inspect(dataUrl) {
    return Promise.resolve({ sha256: 'sha256:' + crypto.createHash('sha256').update(String(dataUrl)).digest('hex'), bytes: String(dataUrl).length, mime: 'image/jpeg' });
}

function refFor(dataUrl) {
    const name = crypto.createHash('sha1').update(String(dataUrl)).digest('hex') + '.jpg';
    return {
        name,
        url: '/api/plugins/theme-manager/images/' + name,
        sha256: 'sha256:' + crypto.createHash('sha256').update(String(dataUrl)).digest('hex'),
        bytes: String(dataUrl).length,
        mime: 'image/jpeg',
    };
}

function emptyManifest() {
    return { schemaVersion: 1, assets: [], bindings: [], nativeViews: [], sourceIntents: [] };
}

function httpResponse(status, body, contentType = 'application/json') {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get(name) { return String(name).toLowerCase() === 'content-type' ? contentType : null; },
        },
        text() { return Promise.resolve(body); },
    };
}

function validCommitResponse(input) {
    return {
        ok: true,
        state: 'present',
        datasetId: input.datasetId,
        revision: input.expectedRevision + 1,
        fingerprint: fingerprint(input.expectedRevision + 1),
        manifest: input.manifest,
    };
}

function createRemote(initial, options = {}) {
    let current = initial || { status: 'empty' };
    let readCount = 0;
    let commitError = options.commitError;
    const calls = [];
    const blobs = new Map();
    return {
        calls,
        blobs,
        setState(value) { current = value; },
        setCommitError(error) { commitError = error; },
        probeCapability() {
            calls.push('capability');
            if (options.capabilityError) return Promise.reject(options.capabilityError);
            return Promise.resolve(options.capability || { status: 'supported' });
        },
        readState() {
            calls.push('read-state');
            readCount += 1;
            if (options.readError) return Promise.reject(options.readError);
            if (options.readErrorAfter && readCount > options.readErrorAfter.count) return Promise.reject(options.readErrorAfter.error);
            return Promise.resolve(JSON.parse(JSON.stringify(current)));
        },
        upload(dataUrl) {
            calls.push('upload:' + dataUrl);
            if (options.uploadError) return Promise.reject(options.uploadError);
            const ref = refFor(dataUrl);
            blobs.set(ref.url, dataUrl);
            return Promise.resolve(ref);
        },
        download(ref) {
            calls.push('download:' + ref.url);
            const value = blobs.get(ref.url) || options.downloads && options.downloads[ref.url];
            return value ? Promise.resolve(value) : Promise.reject(modules.avatarSync.makeError('AVATAR_IMAGE_DOWNLOAD_FAILED', 'missing'));
        },
        commit(input) {
            calls.push('commit:' + input.expectedRevision);
            if (commitError) return Promise.reject(commitError);
            const currentRevision = current.status === 'present' ? current.revision : 0;
            const currentDatasetId = current.status === 'present' ? current.datasetId : input.datasetId;
            if (input.expectedRevision !== currentRevision || input.datasetId !== currentDatasetId) {
                return Promise.reject(modules.avatarSync.makeError('AVATAR_REVISION_CONFLICT', 'conflict'));
            }
            current = {
                status: 'present',
                datasetId: input.datasetId,
                revision: input.expectedRevision + 1,
                fingerprint: fingerprint(input.expectedRevision + 1),
                manifest: JSON.parse(JSON.stringify(input.manifest)),
            };
            return Promise.resolve(JSON.parse(JSON.stringify(current)));
        },
    };
}

function coordinator({ local, cache, control, remote, isBackendAvailable }) {
    return modules.createAvatarStorageCoordinator({
        localStore: local || memoryStore(),
        cacheStore: cache || memoryStore(),
        controlStore: control || modules.avatarSync.createMemoryControlStore(),
        remote,
        isBackendAvailable,
        inspectDataUrl: inspect,
        avatarStorage: modules.avatarStorage,
    });
}

test('shared annotation backend mode keeps Avatar local-ready without a second backend probe', async () => {
    const local = memoryStore({ assets: [asset()] });
    const remote = createRemote({ status: 'empty' });
    let controlReads = 0;
    const control = {
        ready: Promise.resolve(true),
        get() { controlReads += 1; return Promise.resolve(null); },
        put() { return Promise.reject(new Error('control must not be written in local mode')); },
    };
    const sync = coordinator({ local, control, remote, isBackendAvailable: () => false });
    const state = await sync.initialize();
    assert.equal(state.phase, 'local-ready');
    assert.equal(state.authoritative, 'local');
    assert.equal(state.writable, true);
    assert.equal(controlReads, 1);
    assert.deepEqual(remote.calls, []);
    await sync.store.putAsset(asset('local-only'));
    assert.ok(await local.getAsset('local-only'));
});

test('shared local mode keeps an existing remote takeover on its verified cache without probing the backend', async () => {
    const local = memoryStore({ assets: [asset()] });
    const cache = memoryStore();
    const control = modules.avatarSync.createMemoryControlStore();
    const online = coordinator({ local, cache, control, remote: createRemote({ status: 'empty' }) });
    await online.initialize();

    const unavailableRemote = createRemote({ status: 'empty' });
    const offline = coordinator({ local, cache, control, remote: unavailableRemote, isBackendAvailable: () => false });
    const state = await offline.initialize();
    assert.equal(state.phase, 'remote-ready');
    assert.equal(state.offline, true);
    assert.equal(state.writable, false);
    assert.equal((await offline.store.listAssets()).length, 1);
    assert.deepEqual(unavailableRemote.calls, []);
});

test('a real Avatar local-store initialization failure still blocks local mode', async () => {
    const localError = modules.avatarStorage.makeError('AVATAR_IDB_READ_FAILED', 'local read failed');
    const local = { ready: Promise.resolve(true), readSnapshot: () => Promise.reject(localError) };
    const remote = createRemote({ status: 'empty' });
    const sync = coordinator({ local, remote, isBackendAvailable: () => false });
    await assert.rejects(sync.initialize(), error => {
        assert.equal(error.code, 'AVATAR_STORAGE_BLOCKED');
        assert.equal(error.details.reason, 'local-error');
        return true;
    });
    assert.deepEqual(remote.calls, []);
});

test('Avatar capability and state probe failures fall back to local after the shared backend probe succeeded', async () => {
    const cases = [
        {
            expectedCalls: ['capability'],
            options: { capabilityError: modules.avatarSync.makeError('AVATAR_BACKEND_INVALID', 'bad capability', { stage: 'capability' }) },
        },
        {
            expectedCalls: ['capability', 'read-state'],
            options: { readError: modules.avatarSync.makeError('AVATAR_BACKEND_ERROR', 'state offline', { stage: 'state' }) },
        },
    ];
    for (const item of cases) {
        const local = memoryStore({ assets: [asset()] });
        const remote = createRemote({ status: 'empty' }, item.options);
        const sync = coordinator({ local, remote, isBackendAvailable: () => true });
        const state = await sync.initialize();
        assert.equal(state.phase, 'local-ready');
        assert.equal(state.authoritative, 'local');
        assert.equal(state.writable, true);
        assert.deepEqual(remote.calls, item.expectedCalls);
    }
});

test('remote upload and manifest commit await asynchronous post headers', async () => {
    const calls = [];
    const token = 'test-csrf-token';
    const remote = modules.avatarSync.createRemoteApi({
        serverBase: '/avatar-test',
        getPostHeaders() {
            return Promise.resolve({ 'Content-Type': 'application/json', 'X-CSRF-Token': token });
        },
        fetch(endpoint, init) {
            calls.push({ endpoint, init });
            if (endpoint.endsWith('/images')) {
                return Promise.resolve(httpResponse(200, JSON.stringify({ ok: true, image: refFor('upload-body') })));
            }
            const input = JSON.parse(init.body);
            return Promise.resolve(httpResponse(200, JSON.stringify(validCommitResponse(input))));
        },
    });

    await remote.upload('upload-body');
    await remote.commit({ expectedRevision: 0, datasetId: 'dataset-test', manifest: emptyManifest() });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[1].init.method, 'PUT');
    for (const call of calls) {
        assert.equal(typeof call.init.headers.then, 'undefined', 'fetch received a Promise as HeadersInit');
        assert.equal(call.init.headers['X-CSRF-Token'], token);
        assert.equal(call.init.headers['Content-Type'], 'application/json');
    }
});

test('remote HTTP errors preserve method endpoint status stage and do not expose response bodies', async () => {
    const cases = [
        {
            label: '403 text/html upload',
            status: 403,
            contentType: 'text/html',
            body: '<html>Invalid CSRF token raw-secret-token</html>',
            code: 'AVATAR_CSRF_REJECTED',
            method: 'POST',
            stage: 'upload',
            invoke(remote) { return remote.upload('upload-body'); },
        },
        {
            label: '403 text/plain commit',
            status: 403,
            contentType: 'text/plain',
            body: 'Invalid CSRF token raw-secret-token',
            code: 'AVATAR_CSRF_REJECTED',
            method: 'PUT',
            stage: 'commit',
            invoke(remote) { return remote.commit({ expectedRevision: 0, datasetId: 'dataset-test', manifest: emptyManifest() }); },
        },
        {
            label: '403 JSON body cannot leak a token-shaped server error',
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }),
            code: 'AVATAR_CSRF_REJECTED',
            method: 'POST',
            stage: 'upload',
            invoke(remote) { return remote.upload('upload-body'); },
        },
        {
            label: '500 non-JSON upload',
            status: 500,
            contentType: 'text/plain',
            body: 'server exploded raw-secret-token',
            code: 'AVATAR_HTTP_ERROR',
            method: 'POST',
            stage: 'upload',
            invoke(remote) { return remote.upload('upload-body'); },
        },
        {
            label: '200 invalid JSON upload',
            status: 200,
            contentType: 'application/json',
            body: '{invalid',
            code: 'AVATAR_BACKEND_INVALID',
            method: 'POST',
            stage: 'upload',
            invoke(remote) { return remote.upload('upload-body'); },
        },
        {
            label: '409 manifest conflict',
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ ok: false, code: 'REVISION_CONFLICT', current: { revision: 4 } }),
            code: 'AVATAR_REVISION_CONFLICT',
            method: 'PUT',
            stage: 'commit',
            invoke(remote) { return remote.commit({ expectedRevision: 3, datasetId: 'dataset-test', manifest: emptyManifest() }); },
        },
    ];

    for (const item of cases) {
        const remote = modules.avatarSync.createRemoteApi({
            serverBase: '/avatar-test',
            getPostHeaders: () => Promise.resolve({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf-token' }),
            fetch: () => Promise.resolve(httpResponse(item.status, item.body, item.contentType)),
        });
        await assert.rejects(item.invoke(remote), error => {
            assert.equal(error.code, item.code, item.label);
            assert.equal(error.details.status, item.status, item.label);
            assert.equal(error.details.method, item.method, item.label);
            assert.equal(error.details.stage, item.stage, item.label);
            assert.match(error.details.endpoint, /^\/avatar-test\//, item.label);
            assert.equal(error.details.contentType, item.contentType, item.label);
            assert.equal(typeof error.details.cause, 'string', item.label);
            assert.equal(JSON.stringify(error).includes('raw-secret-token'), false, item.label);
            assert.equal(JSON.stringify(error).includes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), false, item.label);
            return true;
        });
    }
});

test('coordinator blocked state retains the sanitized underlying HTTP error', async () => {
    const failure = modules.avatarSync.makeError('AVATAR_CSRF_REJECTED', 'rejected', {
        status: 403,
        endpoint: '/api/plugins/theme-manager/images',
        method: 'POST',
        stage: 'upload',
        cause: 'SyntaxError',
    });
    const sync = coordinator({
        local: memoryStore({ assets: [asset()] }),
        remote: createRemote({ status: 'empty' }, { uploadError: failure }),
    });
    await assert.rejects(sync.initialize(), error => {
        assert.equal(error.code, 'AVATAR_STORAGE_BLOCKED');
        assert.equal(error.details.reason, 'AVATAR_CSRF_REJECTED');
        assert.equal(error.details.error.code, 'AVATAR_CSRF_REJECTED');
        assert.equal(error.details.error.details.status, 403);
        assert.equal(error.details.error.details.endpoint, '/api/plugins/theme-manager/images');
        assert.equal(error.details.error.details.method, 'POST');
        assert.equal(error.details.error.details.stage, 'upload');
        assert.equal(error.details.error.details.cause, 'SyntaxError');
        return true;
    });
});

test('old backend without avatar capability stays local-ready and is never classified as remote empty', async () => {
    const local = memoryStore({ assets: [asset()] });
    const remote = createRemote({ status: 'empty' }, { capability: { status: 'unsupported', reason: 'capability-absent' } });
    const sync = coordinator({ local, remote });
    const state = await sync.initialize();
    assert.equal(state.phase, 'local-ready');
    assert.equal(state.authoritative, 'local');
    assert.deepEqual(remote.calls, ['capability']);
    await sync.store.putSourceIntent({ targetKey: 'user:global' });
    assert.equal((await local.getSourceIntent('user:global')).mode, 'host-source');
});

test('local present plus explicit remote empty uploads blobs then CAS commits and reads back before takeover', async () => {
    const local = memoryStore({
        assets: [asset()],
        bindings: [{ themeKey: 'avatar-default', targetKey: 'user:global', avatarId: 'a', view: {} }],
    });
    const before = await local.readSnapshot();
    const cache = memoryStore();
    const control = modules.avatarSync.createMemoryControlStore();
    const remote = createRemote({ status: 'empty' });
    const sync = coordinator({ local, cache, control, remote });
    const state = await sync.initialize();
    assert.equal(state.phase, 'remote-ready');
    assert.equal(state.authoritative, 'remote');
    assert.equal(state.writable, true);
    assert.deepEqual(remote.calls.map(call => call.split(':')[0]), ['capability', 'read-state', 'upload', 'upload', 'commit', 'read-state']);
    assert.deepEqual(await local.readSnapshot(), before, 'the original local database must remain unchanged');
    assert.deepEqual(await cache.readSnapshot(), before);
    const marker = await control.get();
    assert.equal(marker.mode, 'remote-authoritative');
    assert.equal(marker.revision, 1);
    await sync.store.deleteAsset('a');
    assert.deepEqual(remote.calls.filter(call => call.startsWith('commit:')), ['commit:0', 'commit:1']);
    const afterDelete = await remote.readState();
    assert.equal(afterDelete.manifest.assets.length, 0);
    assert.equal(afterDelete.manifest.bindings.length, 0);
    assert.equal(afterDelete.manifest.sourceIntents[0].targetKey, 'user:global');
    assert.deepEqual(await local.readSnapshot(), before, 'remote deletion must not mutate the takeover backup');
});

test('remote binding batches use one CAS revision for creation and one for active replacement', async () => {
    const local = memoryStore({ assets: [asset('a'), asset('b')] });
    const remote = createRemote({ status: 'empty' });
    const sync = coordinator({ local, remote });
    await sync.initialize();
    assert.equal((await remote.readState()).revision, 1);

    let commitCount = remote.calls.filter(call => call.startsWith('commit:')).length;
    await sync.store.mutateBindings([
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global:theme-avatar:a', avatarId: 'a', view: { scale: 1.25 } } },
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: { scale: 1.25 } } },
    ]);
    assert.equal(remote.calls.filter(call => call.startsWith('commit:')).length, commitCount + 1);
    assert.equal((await remote.readState()).revision, 2);

    commitCount += 1;
    await sync.store.mutateBindings([
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global:theme-avatar:a', avatarId: 'a', view: { scale: 1.25 } } },
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global:theme-avatar:b', avatarId: 'b', view: { scale: 1.5 } } },
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'b', view: { scale: 1.5 } } },
    ]);
    assert.equal(remote.calls.filter(call => call.startsWith('commit:')).length, commitCount + 1);
    const state = await remote.readState();
    assert.equal(state.revision, 3);
    assert.equal(state.manifest.bindings.find(binding => binding.targetKey === 'user:global').avatarId, 'b');
    assert.deepEqual(new Set(state.manifest.bindings.filter(binding => binding.targetKey.indexOf('user:global:theme-avatar:') === 0).map(binding => binding.avatarId)), new Set(['a', 'b']));
});

test('remote binding-only mutations avoid full snapshot staging and update cache incrementally', async () => {
    const local = memoryStore({ assets: [asset('a'), asset('b')] });
    const cache = memoryStore();
    const cacheCalls = { replaceSnapshot: 0, putBinding: 0, deleteBinding: 0, mutateBindings: 0 };
    Object.keys(cacheCalls).forEach(method => {
        const original = cache[method].bind(cache);
        cache[method] = function () {
            cacheCalls[method] += 1;
            return original.apply(cache, arguments);
        };
    });
    let memoryAdapterCreates = 0;
    const storageApi = Object.assign({}, modules.avatarStorage, {
        createMemoryAdapter(seed) {
            memoryAdapterCreates += 1;
            return modules.avatarStorage.createMemoryAdapter(seed);
        },
    });
    const remote = createRemote({ status: 'empty' });
    const sync = modules.createAvatarStorageCoordinator({
        localStore: local,
        cacheStore: cache,
        controlStore: modules.avatarSync.createMemoryControlStore(),
        remote,
        inspectDataUrl: inspect,
        avatarStorage: storageApi,
    });
    await sync.initialize();
    const initialAdapterCreates = memoryAdapterCreates;
    cacheCalls.replaceSnapshot = 0;

    await sync.store.mutateBindings([
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global:theme-avatar:a', avatarId: 'a', view: {} } },
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} } },
    ]);
    assert.equal(memoryAdapterCreates, initialAdapterCreates, 'binding staging must not rebuild an asset-backed memory store');
    assert.equal(cacheCalls.replaceSnapshot, 0, 'binding-only cache updates must not replace all image stores');
    assert.equal(cacheCalls.mutateBindings, 1);

    await sync.store.putBinding({ themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'b', view: { scale: 1.5 } });
    assert.equal(memoryAdapterCreates, initialAdapterCreates);
    assert.equal(cacheCalls.replaceSnapshot, 0);
    assert.equal(cacheCalls.putBinding, 1);
    assert.equal((await cache.getBinding('theme-name:A', 'user:global')).avatarId, 'b');
    assert.equal((await sync.store.getBinding('theme-name:A', 'user:global')).avatarId, 'b');
    assert.equal((await remote.readState()).revision, 3);

    await sync.store.putAsset(asset('c'));
    const afterAssetWrite = await remote.readState();
    assert.equal(afterAssetWrite.revision, 4);
    assert.equal(afterAssetWrite.manifest.bindings.find(binding => binding.targetKey === 'user:global').avatarId, 'b',
        'a later full asset mutation must stage from the incrementally updated binding snapshot');
});

test('remote binding batch CAS conflict leaves the authoritative manifest and cache unchanged', async () => {
    const local = memoryStore({ assets: [asset('a'), asset('b')] });
    const cache = memoryStore();
    const remote = createRemote({ status: 'empty' });
    const sync = coordinator({ local, cache, remote });
    await sync.initialize();
    const beforeRemote = await remote.readState();
    const beforeCache = await cache.readSnapshot();
    remote.setCommitError(modules.avatarSync.makeError('AVATAR_REVISION_CONFLICT', 'conflict'));
    await assert.rejects(sync.store.mutateBindings([
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global:theme-avatar:a', avatarId: 'a', view: {} } },
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'a', view: {} } },
    ]), error => error.code === 'AVATAR_REVISION_CONFLICT');
    assert.deepEqual(await remote.readState(), beforeRemote);
    assert.deepEqual(await cache.readSnapshot(), beforeCache);
    assert.equal(sync.getState().phase, 'conflict');
});

test('local-authoritative binding batches apply all operations through one store call', async () => {
    const local = memoryStore({ assets: [asset('a'), asset('b')] });
    const remote = createRemote({ status: 'empty' }, { capability: { status: 'unsupported', reason: 'capability-absent' } });
    const sync = coordinator({ local, remote });
    const state = await sync.initialize();
    assert.equal(state.authoritative, 'local');
    await sync.store.mutateBindings([
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global:theme-avatar:a', avatarId: 'a', view: {} } },
        { type: 'put', binding: { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'b', view: {} } },
    ]);
    const bindings = await local.listBindings();
    assert.equal(bindings.length, 2);
    assert.equal(bindings.find(binding => binding.targetKey === 'user:global').avatarId, 'b');
    assert.equal(remote.calls.some(call => call.startsWith('commit:')), false);
});

test('both sides empty perform no initialization write and first mutation creates revision 1 with CAS', async () => {
    const remote = createRemote({ status: 'empty' });
    const sync = coordinator({ local: memoryStore(), remote });
    const state = await sync.initialize();
    assert.equal(state.phase, 'remote-ready');
    assert.equal(state.remote, 'empty');
    assert.equal(remote.calls.some(call => call.startsWith('commit:')), false);
    await sync.store.putAsset(asset());
    assert.deepEqual(remote.calls.filter(call => call.startsWith('commit:')), ['commit:0']);
    assert.equal(sync.getState().remote, 'present');
});

test('upload failure blocks takeover without a manifest commit or local mutation', async () => {
    const local = memoryStore({ assets: [asset()] });
    const before = await local.readSnapshot();
    const remote = createRemote({ status: 'empty' }, { uploadError: modules.avatarSync.makeError('AVATAR_IMAGE_UPLOAD_FAILED', 'failed') });
    const sync = coordinator({ local, remote });
    await assert.rejects(sync.initialize(), error => error.code === 'AVATAR_STORAGE_BLOCKED');
    assert.equal(remote.calls.some(call => call.startsWith('commit:')), false);
    assert.deepEqual(await local.readSnapshot(), before);
    assert.equal(sync.isRuntimeReady(), false);
});

test('failed post-commit readback preserves local data and never writes the authority marker', async () => {
    const local = memoryStore({ assets: [asset()] });
    const before = await local.readSnapshot();
    const control = modules.avatarSync.createMemoryControlStore();
    const remote = createRemote({ status: 'empty' }, {
        readErrorAfter: { count: 1, error: modules.avatarSync.makeError('AVATAR_BACKEND_ERROR', 'readback failed', { stage: 'state' }) },
    });
    const sync = coordinator({ local, control, remote, isBackendAvailable: () => true });
    await assert.rejects(sync.initialize(), error => error.code === 'AVATAR_STORAGE_BLOCKED');
    assert.deepEqual(await local.readSnapshot(), before);
    assert.equal(await control.get(), null);
    assert.equal(remote.calls.filter(call => call.startsWith('commit:')).length, 1);
    assert.equal(sync.isRuntimeReady(), false);
});

test('local present and remote present enters conflict with zero writes', async () => {
    const local = memoryStore({ assets: [asset()] });
    const remote = createRemote({ status: 'present', datasetId: 'dataset-remote', revision: 3, fingerprint: fingerprint(3), manifest: emptyManifest() });
    const sync = coordinator({ local, remote });
    await assert.rejects(sync.initialize(), error => error.code === 'AVATAR_STORAGE_CONFLICT');
    assert.equal(sync.getState().phase, 'conflict');
    assert.equal(remote.calls.some(call => call.startsWith('upload:') || call.startsWith('commit:')), false);
    assert.equal(sync.isRuntimeReady(), false);
});

test('backend errors and invalid protocol block first takeover and never write', async () => {
    for (const error of [
        modules.avatarSync.makeError('AVATAR_BACKEND_ERROR', 'offline'),
        modules.avatarSync.makeError('AVATAR_BACKEND_INVALID', 'bad protocol'),
    ]) {
        const remote = createRemote({ status: 'empty' }, { capabilityError: error });
        const sync = coordinator({ local: memoryStore(), remote });
        await assert.rejects(sync.initialize(), failure => failure.code === 'AVATAR_STORAGE_BLOCKED');
        assert.equal(remote.calls.some(call => call.startsWith('commit:')), false);
    }
});

test('an explicitly invalid remote state blocks migration without uploading local blobs', async () => {
    const remote = createRemote({ status: 'invalid', error: 'AVATAR_DATASET_INVALID' });
    const sync = coordinator({ local: memoryStore({ assets: [asset()] }), remote });
    await assert.rejects(sync.initialize(), error => error.code === 'AVATAR_STORAGE_BLOCKED');
    assert.equal(sync.getState().remote, 'invalid');
    assert.equal(remote.calls.some(call => call.startsWith('upload:') || call.startsWith('commit:')), false);
});

test('migration CAS conflict is not retried and preserves the original local snapshot', async () => {
    const local = memoryStore({ assets: [asset()] });
    const before = await local.readSnapshot();
    const remote = createRemote({ status: 'empty' }, { commitError: modules.avatarSync.makeError('AVATAR_REVISION_CONFLICT', 'conflict') });
    const sync = coordinator({ local, remote });
    await assert.rejects(sync.initialize(), error => error.code === 'AVATAR_STORAGE_CONFLICT');
    assert.equal(sync.getState().phase, 'conflict');
    assert.equal(remote.calls.filter(call => call.startsWith('commit:')).length, 1);
    assert.deepEqual(await local.readSnapshot(), before);
});

test('remote present plus local empty hydrates a verified cache before becoming ready', async () => {
    const snapshot = modules.avatarStorage.normalizeSnapshot({ assets: [asset()], bindings: [], nativeViews: [], sourceIntents: [] });
    const refs = new Map([['a', { image: refFor(snapshot.assets[0].imageData), thumbnail: refFor(snapshot.assets[0].thumbData) }]]);
    const manifest = modules.avatarSync.manifestFromSnapshot(snapshot, refs, modules.avatarStorage);
    const downloads = {};
    downloads[refs.get('a').image.url] = snapshot.assets[0].imageData;
    downloads[refs.get('a').thumbnail.url] = snapshot.assets[0].thumbData;
    const remote = createRemote({ status: 'present', datasetId: 'dataset-remote', revision: 4, fingerprint: fingerprint(4), manifest }, { downloads });
    const cache = memoryStore();
    const control = modules.avatarSync.createMemoryControlStore();
    const sync = coordinator({ local: memoryStore(), cache, control, remote });
    await sync.initialize();
    assert.equal(sync.getState().phase, 'remote-ready');
    assert.deepEqual(JSON.parse(JSON.stringify(await cache.readSnapshot())), JSON.parse(JSON.stringify(snapshot)));
    assert.equal((await sync.store.getAsset('a')).imageData, snapshot.assets[0].imageData);
    assert.equal((await control.get()).revision, 4);
});

test('after takeover an offline backend uses only verified cache and rejects every mutation', async () => {
    const snapshot = modules.avatarStorage.normalizeSnapshot({ assets: [asset()], bindings: [], nativeViews: [], sourceIntents: [] });
    const refs = new Map([['a', { image: refFor(snapshot.assets[0].imageData), thumbnail: refFor(snapshot.assets[0].thumbData) }]]);
    const manifest = modules.avatarSync.manifestFromSnapshot(snapshot, refs, modules.avatarStorage);
    const control = modules.avatarSync.createMemoryControlStore({
        version: 1,
        mode: 'remote-authoritative',
        datasetId: 'dataset-remote',
        revision: 5,
        fingerprint: fingerprint(5),
        manifest,
        updatedAt: '2026-09-06T00:00:00.000Z',
    });
    const remote = createRemote(null, { capabilityError: modules.avatarSync.makeError('AVATAR_BACKEND_ERROR', 'offline') });
    const sync = coordinator({ local: memoryStore({ assets: [asset('backup')] }), cache: memoryStore(snapshot), control, remote });
    const state = await sync.initialize();
    assert.equal(state.phase, 'remote-ready');
    assert.equal(state.offline, true);
    assert.equal(state.writable, false);
    assert.equal((await sync.store.listAssets()).length, 1);
    await assert.rejects(sync.store.putSourceIntent({ targetKey: 'user:global' }), error => error.code === 'AVATAR_STORAGE_READ_ONLY');
    assert.equal(remote.calls.some(call => call.startsWith('commit:')), false);
});

test('a CAS 409 freezes the coordinator in conflict and is never retried', async () => {
    const remoteState = { status: 'present', datasetId: 'dataset-remote', revision: 2, fingerprint: fingerprint(2), manifest: emptyManifest() };
    const control = modules.avatarSync.createMemoryControlStore({
        version: 1,
        mode: 'remote-authoritative',
        datasetId: 'dataset-remote',
        revision: 2,
        fingerprint: fingerprint(2),
        manifest: emptyManifest(),
        updatedAt: '2026-09-06T00:00:00.000Z',
    });
    const remote = createRemote(remoteState, { commitError: modules.avatarSync.makeError('AVATAR_REVISION_CONFLICT', 'conflict') });
    const sync = coordinator({ local: memoryStore(), cache: memoryStore(), control, remote });
    await sync.initialize();
    await assert.rejects(sync.store.putSourceIntent({ targetKey: 'user:global' }), error => error.code === 'AVATAR_REVISION_CONFLICT');
    assert.equal(sync.getState().phase, 'conflict');
    assert.equal(remote.calls.filter(call => call.startsWith('commit:')).length, 1);
    await assert.rejects(sync.store.putSourceIntent({ targetKey: 'character:a' }), error => error.code === 'AVATAR_STORAGE_BLOCKED' || error.code === 'AVATAR_STORAGE_READ_ONLY');
});

test('read barrier blocks new Avatar writes until the consistent export read completes', async () => {
    const local = memoryStore({ assets: [asset('a')] });
    const sync = coordinator({ local, remote: createRemote({ status: 'empty' }), isBackendAvailable: () => false });
    await sync.initialize();
    let release;
    let entered = false;
    const barrier = sync.runReadBarrier(() => {
        entered = true;
        return new Promise((resolve) => { release = resolve; });
    });
    while (!entered) await Promise.resolve();
    assert.equal(sync.canMutate(), false);
    await assert.rejects(sync.store.putSourceIntent({ targetKey: 'user:global' }), (error) => error.code === 'AVATAR_EXPORT_IN_PROGRESS');
    release(true);
    await barrier;
    assert.equal(sync.canMutate(), true);
    await sync.store.putSourceIntent({ targetKey: 'user:global' });
    assert.ok(await local.getSourceIntent('user:global'));
});

test('read barrier waits for an already accepted local write before capturing a snapshot', async () => {
    const local = memoryStore({ assets: [asset('a')] });
    const originalPut = local.putSourceIntent;
    let writeStarted = false;
    let releaseWrite;
    local.putSourceIntent = function (record) {
        writeStarted = true;
        return new Promise((resolve, reject) => {
            releaseWrite = () => originalPut.call(local, record).then(resolve, reject);
        });
    };
    const sync = coordinator({ local, remote: createRemote({ status: 'empty' }), isBackendAvailable: () => false });
    await sync.initialize();
    const pendingWrite = sync.store.putSourceIntent({ targetKey: 'user:global' });
    while (!writeStarted) await Promise.resolve();
    let barrierEntered = false;
    const barrier = sync.runReadBarrier(() => { barrierEntered = true; });
    await Promise.resolve();
    assert.equal(barrierEntered, false);
    releaseWrite();
    await pendingWrite;
    await barrier;
    assert.equal(barrierEntered, true);
    assert.ok(await local.getSourceIntent('user:global'));
});

test('remote consistency state revalidates the live revision and fingerprint and fails closed on drift', async () => {
    const original = { status: 'present', datasetId: 'dataset-remote', revision: 7, fingerprint: fingerprint(7), manifest: emptyManifest() };
    const remote = createRemote(original);
    const sync = coordinator({ local: memoryStore(), cache: memoryStore(), remote });
    await sync.initialize();
    const stamp = await sync.getConsistencyState();
    assert.equal(stamp.consistency, 'verified');
    assert.equal(stamp.revision, 7);
    assert.equal(stamp.fingerprint, fingerprint(7));
    remote.setState(Object.assign({}, original, { revision: 8, fingerprint: fingerprint(8) }));
    await assert.rejects(sync.getConsistencyState(), (error) => error.code === 'AVATAR_EXPORT_SOURCE_CHANGED');
});
