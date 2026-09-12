const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function loadModules() {
    const window = {
        console, Promise, Map, Set, WeakMap, Date, Math, JSON, Number, Object,
        Uint8Array, Uint32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, Blob,
        atob, btoa, setTimeout, clearTimeout, innerWidth: 1024, crypto: crypto.webcrypto,
    };
    window.window = window;
    window.globalThis = window;
    const context = vm.createContext(window);
    ['avatar-storage.js', 'avatar-sync.js', 'avatar-library.js', 'avatar-transfer.js', 'avatar-recovery.js'].forEach((name) => {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8'), context, { filename: name });
    });
    return window.ThemeMgrModules;
}

const modules = loadModules();
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(marker, padding = 0) {
    return `data:image/png;base64,${Buffer.from(PNG_HEADER.concat([marker], new Array(padding).fill(marker))).toString('base64')}`;
}

function asset(id, marker = 1, padding = 0) {
    return {
        id, name: `头像 ${id}`, imageData: png(marker, padding), thumbData: png(marker + 20), mimeType: 'image/png',
        width: 800, height: 600, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
    };
}

function memoryStore(seed) {
    return modules.createAvatarStore({ adapter: modules.avatarStorage.createMemoryAdapter(seed) });
}

function localStorageFake(seed = {}) {
    const values = new Map(Object.entries(seed));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        dump() { return Object.fromEntries(values); },
    };
}

function libraryFor(id, category) {
    return {
        version: 1,
        categories: [category],
        assetMeta: { [id]: { category, tags: [], importOrder: 1 } },
        series: { version: 1, groups: {} },
        sortMode: 'import-asc',
        nextImportOrder: 2,
    };
}

async function makeBackup(seed, avatarLibrary, options = {}) {
    const downloads = [];
    const store = memoryStore(seed);
    const transfer = modules.createAvatarTransfer({
        store,
        coordinator: {
            runReadBarrier(task) { return Promise.resolve().then(task); },
            getConsistencyState() { return Promise.resolve({ phase: 'local-ready', authority: 'local', consistency: 'verified', offline: false, datasetId: null, revision: null, fingerprint: '' }); },
        },
        library: modules.avatarLibrary,
        avatarStorage: modules.avatarStorage,
        loadUiData: () => ({ avatarLibrary }),
        pluginVersion: 'test',
        sha256: bytes => 'sha256:' + crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
        Blob,
        isMobile: options.isMobile || (() => false),
        limits: options.limits,
        download(blob, filename) { downloads.push({ blob, filename }); },
    });
    await transfer.createFullBackup();
    return downloads[0].blob;
}

async function fixture() {
    const defaultName = modules.avatarStorage.DB_NAME;
    const storage = localStorageFake();
    const oldLibrary = libraryFor('old', '旧分类');
    const nextLibrary = libraryFor('new', '新分类');
    let uiData = { avatarLibrary: oldLibrary, unrelated: { keep: true } };
    let locked = false;
    const stores = new Map([[defaultName, memoryStore({ assets: [asset('old', 1)] })]]);
    const coordinator = modules.createAvatarStorageCoordinator({
        localStore: stores.get(defaultName),
        cacheStore: memoryStore(),
        controlStore: modules.avatarSync.createMemoryControlStore(),
        isBackendAvailable: () => false,
        isExternalWriteBlocked: () => locked,
    });
    await coordinator.initialize();
    const verificationTransfer = modules.createAvatarTransfer({
        store: coordinator.store,
        coordinator,
        library: modules.avatarLibrary,
        avatarStorage: modules.avatarStorage,
        loadUiData: () => uiData,
        sha256: bytes => 'sha256:' + crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
        Blob,
        isMobile: () => false,
        download() {},
    });
    const recovery = modules.createAvatarRecovery({
        bootstrap: modules.avatarRecovery.resolveBootstrap({ localStorage: storage, defaultDatabaseName: defaultName }),
        localStorage: storage,
        defaultDatabaseName: defaultName,
        avatarStorage: modules.avatarStorage,
        avatarTransferTools: modules.avatarTransfer,
        transfer: verificationTransfer,
        coordinator,
        createStore(databaseName) {
            if (!stores.has(databaseName)) stores.set(databaseName, memoryStore());
            return stores.get(databaseName);
        },
        library: modules.avatarLibrary,
        loadUiData: () => uiData,
        saveUiData(value) { uiData = JSON.parse(JSON.stringify(value)); return Promise.resolve(true); },
        flushUiData: () => Promise.resolve(true),
        getAuthorityState: () => ({ ready: true, localOnly: true, evidence: 'test-local-only' }),
        setGlobalLock(value) { locked = value; },
        estimateStorage: () => Promise.resolve({ quota: 1024 * 1024 * 1024, usage: 0 }),
        memoryState: () => ({ limit: 1024 * 1024 * 1024, used: 0 }),
        crypto: crypto.webcrypto,
        btoa,
    });
    const blob = await makeBackup({
        assets: [asset('new', 2)],
        bindings: [{ themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'new' }],
        nativeViews: [{ targetKey: 'user:global', sourceKey: 'persona:user.png' }],
        sourceIntents: [{ targetKey: 'user:global' }],
    }, nextLibrary);
    return { defaultName, storage, stores, coordinator, recovery, blob, oldLibrary, nextLibrary, getUi: () => uiData, isLocked: () => locked };
}

test('complete local restore commits a verified shadow DB and preserves the old DB', async () => {
    const f = await fixture();
    const result = await f.recovery.restoreBackup(f.blob);
    assert.equal(result.assets, 1);
    assert.equal(f.isLocked(), false);
    assert.deepEqual(Array.from(await f.coordinator.store.listAssets(), item => item.id), ['new']);
    assert.deepEqual(Array.from(await f.stores.get(f.defaultName).listAssets(), item => item.id), ['old']);
    assert.deepEqual(f.getUi().avatarLibrary, f.nextLibrary);
    assert.deepEqual(f.getUi().unrelated, { keep: true });
    const pointer = JSON.parse(f.storage.getItem(modules.avatarRecovery.POINTER_KEY));
    const log = JSON.parse(f.storage.getItem(modules.avatarRecovery.TRANSACTION_KEY));
    assert.equal(pointer.databaseName, result.databaseName);
    assert.equal(log.state, 'committed');
    assert.equal(log.rollbackComplete, false);
    assert.equal(f.stores.has(result.databaseName), true);
});

test('all nonterminal recovery log states lock startup; only matching terminal states unlock it', async () => {
    const f = await fixture();
    const result = await f.recovery.restoreBackup(f.blob);
    const committed = JSON.parse(f.storage.getItem(modules.avatarRecovery.TRANSACTION_KEY));
    for (const state of ['prepared', 'applying', 'verifying']) {
        const value = JSON.parse(JSON.stringify(committed));
        value.state = state;
        value.rollbackComplete = false;
        f.storage.setItem(modules.avatarRecovery.TRANSACTION_KEY, JSON.stringify(value));
        assert.equal(modules.avatarRecovery.resolveBootstrap({ localStorage: f.storage, defaultDatabaseName: f.defaultName }).blocked, true, state);
    }
    const rollback = JSON.parse(JSON.stringify(committed));
    rollback.state = 'rollback';
    rollback.rollbackComplete = false;
    f.storage.setItem(modules.avatarRecovery.TRANSACTION_KEY, JSON.stringify(rollback));
    assert.equal(modules.avatarRecovery.resolveBootstrap({ localStorage: f.storage, defaultDatabaseName: f.defaultName }).blocked, true);
    rollback.rollbackComplete = true;
    f.storage.removeItem(modules.avatarRecovery.POINTER_KEY);
    f.storage.setItem(modules.avatarRecovery.TRANSACTION_KEY, JSON.stringify(rollback));
    assert.equal(modules.avatarRecovery.resolveBootstrap({ localStorage: f.storage, defaultDatabaseName: f.defaultName }).blocked, false);
    f.storage.setItem(modules.avatarRecovery.POINTER_KEY, JSON.stringify({ version: 1, databaseName: committed.target.databaseName }));
    f.storage.setItem(modules.avatarRecovery.TRANSACTION_KEY, JSON.stringify(committed));
    assert.equal(modules.avatarRecovery.resolveBootstrap({ localStorage: f.storage, defaultDatabaseName: f.defaultName }).blocked, false);
});

test('an interrupted verifying transaction stays read-only until exact rollback completes', async () => {
    const f = await fixture();
    const result = await f.recovery.restoreBackup(f.blob);
    const log = JSON.parse(f.storage.getItem(modules.avatarRecovery.TRANSACTION_KEY));
    log.state = 'verifying';
    log.rollbackComplete = false;
    f.storage.setItem(modules.avatarRecovery.TRANSACTION_KEY, JSON.stringify(log));
    const bootstrap = modules.avatarRecovery.resolveBootstrap({ localStorage: f.storage, defaultDatabaseName: f.defaultName });
    assert.equal(bootstrap.blocked, true);

    let locked = true;
    let uiData = { avatarLibrary: f.nextLibrary, unrelated: { keep: true } };
    const coordinator = modules.createAvatarStorageCoordinator({
        localStore: f.stores.get(result.databaseName), cacheStore: memoryStore(), controlStore: modules.avatarSync.createMemoryControlStore(),
        isBackendAvailable: () => false, isExternalWriteBlocked: () => locked, startupLock: { error: bootstrap.error },
    });
    await assert.rejects(coordinator.initialize(), error => error.code === 'AVATAR_STORAGE_BLOCKED');
    assert.equal(coordinator.canMutate(), false);
    const transfer = modules.createAvatarTransfer({ store: coordinator.store, coordinator, library: modules.avatarLibrary, avatarStorage: modules.avatarStorage, loadUiData: () => uiData, Blob, isMobile: () => false, download() {} });
    const recovery = modules.createAvatarRecovery({
        bootstrap, localStorage: f.storage, defaultDatabaseName: f.defaultName, avatarStorage: modules.avatarStorage, avatarTransferTools: modules.avatarTransfer,
        transfer, coordinator, createStore: name => f.stores.get(name), library: modules.avatarLibrary,
        loadUiData: () => uiData, saveUiData(value) { uiData = JSON.parse(JSON.stringify(value)); return Promise.resolve(true); }, flushUiData: () => Promise.resolve(true),
        getAuthorityState: () => ({ ready: true, localOnly: true }), setGlobalLock(value) { locked = value; }, crypto: crypto.webcrypto, btoa,
    });
    await recovery.rollbackIncomplete();
    assert.equal(locked, false);
    assert.deepEqual(Array.from(await coordinator.store.listAssets(), item => item.id), ['old']);
    assert.deepEqual(uiData.avatarLibrary, f.oldLibrary);
    assert.equal(f.storage.getItem(modules.avatarRecovery.POINTER_KEY), null);
    assert.equal(JSON.parse(f.storage.getItem(modules.avatarRecovery.TRANSACTION_KEY)).rollbackComplete, true);
});

test('rollback remains blocked if Theme settings are no longer proven local-only', async () => {
    const f = await fixture();
    await f.recovery.restoreBackup(f.blob);
    const log = JSON.parse(f.storage.getItem(modules.avatarRecovery.TRANSACTION_KEY));
    log.state = 'verifying';
    log.rollbackComplete = false;
    f.storage.setItem(modules.avatarRecovery.TRANSACTION_KEY, JSON.stringify(log));
    let saves = 0;
    let locked = true;
    const recovery = modules.createAvatarRecovery({
        bootstrap: modules.avatarRecovery.resolveBootstrap({ localStorage: f.storage, defaultDatabaseName: f.defaultName }),
        localStorage: f.storage, defaultDatabaseName: f.defaultName, avatarStorage: modules.avatarStorage, avatarTransferTools: modules.avatarTransfer,
        transfer: {}, coordinator: f.coordinator, createStore: name => f.stores.get(name), library: modules.avatarLibrary,
        loadUiData: f.getUi, saveUiData() { saves += 1; return Promise.resolve(true); }, flushUiData: () => Promise.resolve(true),
        getAuthorityState: () => ({ ready: true, localOnly: false, evidence: 'present' }), setGlobalLock(value) { locked = value; }, crypto: crypto.webcrypto, btoa,
    });
    await assert.rejects(recovery.rollbackIncomplete(), error => error.code === 'AVATAR_RECOVERY_LOCAL_ONLY_REQUIRED');
    assert.equal(saves, 0);
    assert.equal(locked, true);
    assert.equal(JSON.parse(f.storage.getItem(modules.avatarRecovery.TRANSACTION_KEY)).state, 'verifying');
});

test('invalid pointer never falls back to the legacy Avatar DB', () => {
    const storage = localStorageFake({ [modules.avatarRecovery.POINTER_KEY]: '{"version":1,"databaseName":"other-user-db"}' });
    const bootstrap = modules.avatarRecovery.resolveBootstrap({ localStorage: storage, defaultDatabaseName: modules.avatarStorage.DB_NAME });
    assert.equal(bootstrap.blocked, true);
    assert.equal(bootstrap.databaseName, null);
    assert.equal(bootstrap.error.code, 'AVATAR_RECOVERY_POINTER_INVALID');
});

test('restore rejects uncertain or remote authority before creating a transaction log', async () => {
    const f = await fixture();
    const blocked = modules.createAvatarRecovery({
        bootstrap: modules.avatarRecovery.resolveBootstrap({ localStorage: f.storage, defaultDatabaseName: f.defaultName }),
        localStorage: f.storage, defaultDatabaseName: f.defaultName, avatarStorage: modules.avatarStorage, avatarTransferTools: modules.avatarTransfer,
        transfer: { verifyBackupBlob: (...args) => f.recovery.inspectBackup(f.blob).then(() => modules.createAvatarTransfer) },
        coordinator: f.coordinator, createStore: name => f.stores.get(name), library: modules.avatarLibrary,
        loadUiData: f.getUi, saveUiData: () => Promise.resolve(true), flushUiData: () => Promise.resolve(true),
        getAuthorityState: () => ({ ready: true, localOnly: false, evidence: 'error' }), setGlobalLock() {}, crypto: crypto.webcrypto, btoa,
    });
    await assert.rejects(blocked.restoreBackup(f.blob), error => error.code === 'AVATAR_RECOVERY_LOCAL_ONLY_REQUIRED');
    assert.equal(f.storage.getItem(modules.avatarRecovery.TRANSACTION_KEY), null);
});

test('storage and memory preflight failures happen before shadow DB or transaction creation', async () => {
    const f = await fixture();
    let created = 0;
    const recovery = modules.createAvatarRecovery({
        bootstrap: modules.avatarRecovery.resolveBootstrap({ localStorage: f.storage, defaultDatabaseName: f.defaultName }),
        localStorage: f.storage, defaultDatabaseName: f.defaultName, avatarStorage: modules.avatarStorage, avatarTransferTools: modules.avatarTransfer,
        transfer: { verifyBackupBlob: (...args) => {
            const real = modules.createAvatarTransfer({ store: f.coordinator.store, coordinator: f.coordinator, library: modules.avatarLibrary, avatarStorage: modules.avatarStorage, loadUiData: f.getUi, Blob, isMobile: () => false, download() {} });
            return real.verifyBackupBlob(f.blob, args[1]);
        } },
        coordinator: f.coordinator, createStore() { created += 1; return memoryStore(); }, library: modules.avatarLibrary,
        loadUiData: f.getUi, saveUiData: () => Promise.resolve(true), flushUiData: () => Promise.resolve(true),
        getAuthorityState: () => ({ ready: true, localOnly: true }), setGlobalLock() {},
        estimateStorage: () => Promise.resolve({ quota: 10, usage: 9 }), memoryState: () => null, crypto: crypto.webcrypto, btoa,
    });
    await assert.rejects(recovery.restoreBackup(f.blob), error => error.code === 'AVATAR_RECOVERY_SPACE_LIMIT');
    assert.equal(created, 0);
    assert.equal(f.storage.getItem(modules.avatarRecovery.TRANSACTION_KEY), null);
});

test('a settings-domain apply failure rolls back the pointer, library, and active store without deleting the shadow', async () => {
    const f = await fixture();
    let uiData = f.getUi();
    let locked = false;
    const verificationTransfer = modules.createAvatarTransfer({
        store: f.coordinator.store, coordinator: f.coordinator, library: modules.avatarLibrary, avatarStorage: modules.avatarStorage,
        loadUiData: () => uiData, Blob, isMobile: () => false, download() {},
    });
    let failedOnce = false;
    const recovery = modules.createAvatarRecovery({
        bootstrap: modules.avatarRecovery.resolveBootstrap({ localStorage: f.storage, defaultDatabaseName: f.defaultName }),
        localStorage: f.storage, defaultDatabaseName: f.defaultName, avatarStorage: modules.avatarStorage, avatarTransferTools: modules.avatarTransfer,
        transfer: verificationTransfer, coordinator: f.coordinator,
        createStore(name) { if (!f.stores.has(name)) f.stores.set(name, memoryStore()); return f.stores.get(name); },
        library: modules.avatarLibrary, loadUiData: () => uiData,
        saveUiData(value) {
            uiData = JSON.parse(JSON.stringify(value));
            if (!failedOnce && Object.hasOwn(value.avatarLibrary.assetMeta, 'new')) {
                failedOnce = true;
                return Promise.reject(new Error('settings write failed'));
            }
            return Promise.resolve(true);
        },
        flushUiData: () => Promise.resolve(true), getAuthorityState: () => ({ ready: true, localOnly: true }),
        setGlobalLock(value) { locked = value; }, estimateStorage: () => Promise.resolve({ quota: 1024 ** 3, usage: 0 }), memoryState: () => null,
        crypto: crypto.webcrypto, btoa,
    });
    await assert.rejects(recovery.restoreBackup(f.blob), error => error.message === 'settings write failed' && error.details.rollback === 'completed');
    assert.equal(locked, false);
    assert.deepEqual(Array.from(await f.coordinator.store.listAssets(), item => item.id), ['old']);
    assert.deepEqual(uiData.avatarLibrary, f.oldLibrary);
    assert.equal(f.storage.getItem(modules.avatarRecovery.POINTER_KEY), null);
    const log = JSON.parse(f.storage.getItem(modules.avatarRecovery.TRANSACTION_KEY));
    assert.equal(log.state, 'rollback');
    assert.equal(log.rollbackComplete, true);
    assert.equal(f.stores.has(log.target.databaseName), true);
});

test('a desktop backup over mobile verification limits is rejected before restore writes', async () => {
    const blob = await makeBackup({ assets: [asset('large', 4, 512)] }, libraryFor('large', '大图'));
    const store = memoryStore({ assets: [asset('old')] });
    const coordinator = modules.createAvatarStorageCoordinator({ localStore: store, cacheStore: memoryStore(), controlStore: modules.avatarSync.createMemoryControlStore(), isBackendAvailable: () => false });
    await coordinator.initialize();
    const mobileTransfer = modules.createAvatarTransfer({
        store: coordinator.store, coordinator, library: modules.avatarLibrary, avatarStorage: modules.avatarStorage, loadUiData: () => ({ avatarLibrary: libraryFor('old', '旧') }),
        Blob, isMobile: () => true, limits: { payloadBytes: 128, archiveBytes: 4096, fileBytes: 2048, files: 32 }, download() {},
    });
    const storage = localStorageFake();
    const recovery = modules.createAvatarRecovery({
        bootstrap: modules.avatarRecovery.resolveBootstrap({ localStorage: storage, defaultDatabaseName: modules.avatarStorage.DB_NAME }),
        localStorage: storage, transfer: mobileTransfer, coordinator, avatarStorage: modules.avatarStorage, avatarTransferTools: modules.avatarTransfer,
        library: modules.avatarLibrary, loadUiData: () => ({ avatarLibrary: libraryFor('old', '旧') }), saveUiData: () => Promise.resolve(true), flushUiData: () => Promise.resolve(true),
        getAuthorityState: () => ({ ready: true, localOnly: true }), setGlobalLock() {}, crypto: crypto.webcrypto, btoa,
    });
    await assert.rejects(recovery.inspectBackup(blob), error => error.code === 'AVATAR_ARCHIVE_LIMIT');
    assert.equal(storage.getItem(modules.avatarRecovery.TRANSACTION_KEY), null);
});

test('a larger verified library restores sequentially without changing the backup format', async () => {
    const assets = [asset('large-0', 5, 3_400_000)].concat(Array.from({ length: 63 }, (_, index) => asset(`many-${index}`, (index % 200) + 1, 32)));
    const avatarLibrary = {
        version: 1,
        categories: [],
        assetMeta: Object.fromEntries(assets.map((item, index) => [item.id, { category: '', tags: [], importOrder: index + 1 }])),
        series: { version: 1, groups: {} },
        sortMode: 'import-asc',
        nextImportOrder: assets.length + 1,
    };
    const blob = await makeBackup({ assets }, avatarLibrary);
    const verifiedTransfer = modules.createAvatarTransfer({
        store: memoryStore(), coordinator: { runReadBarrier: task => task() }, library: modules.avatarLibrary, avatarStorage: modules.avatarStorage,
        loadUiData: () => ({ avatarLibrary: {} }), Blob, isMobile: () => false, download() {},
    });
    const verified = await verifiedTransfer.verifyBackupBlob(blob);
    assert.equal(verified.manifest.formatVersion, 1);
    const f = await fixture();
    const result = await f.recovery.restoreBackup(blob);
    assert.equal(result.assets, 64);
    assert.equal((await f.coordinator.store.listAssets()).length, 64);
});
