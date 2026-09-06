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
    const calls = [];
    const blobs = new Map();
    return {
        calls,
        blobs,
        setState(value) { current = value; },
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
            if (options.commitError) return Promise.reject(options.commitError);
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

function coordinator({ local, cache, control, remote }) {
    return modules.createAvatarStorageCoordinator({
        localStore: local || memoryStore(),
        cacheStore: cache || memoryStore(),
        controlStore: control || modules.avatarSync.createMemoryControlStore(),
        remote,
        inspectDataUrl: inspect,
        avatarStorage: modules.avatarStorage,
    });
}

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
        readErrorAfter: { count: 1, error: modules.avatarSync.makeError('AVATAR_BACKEND_ERROR', 'readback failed') },
    });
    const sync = coordinator({ local, control, remote });
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
