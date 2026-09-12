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
    ['avatar-storage.js', 'avatar-library.js', 'avatar-transfer.js'].forEach((name) => {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8'), context, { filename: name });
    });
    return window.ThemeMgrModules;
}

const modules = loadModules();
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngData(marker, padding = 0) {
    const bytes = Buffer.from(PNG_HEADER.concat([marker & 0xff], new Array(padding).fill(marker & 0xff)));
    return `data:image/png;base64,${bytes.toString('base64')}`;
}

function asset(id, marker = 1, padding = 0) {
    return {
        id,
        name: `头像 ${id}`,
        imageData: pngData(marker, padding),
        thumbData: pngData(marker + 100),
        mimeType: 'image/png',
        width: 800,
        height: 600,
        createdAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
    };
}

function sha256(bytes) {
    return 'sha256:' + crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function source(overrides = {}) {
    return Object.assign({
        phase: 'local-ready', authority: 'local', consistency: 'verified', offline: false,
        datasetId: null, revision: null, fingerprint: '',
    }, overrides);
}

function libraryData() {
    return {
        avatarLibrary: {
            version: 1,
            categories: ['朋友'],
            assetMeta: {
                a: { category: '朋友', tags: ['暖色'], importOrder: 1 },
                b: { category: '朋友', tags: ['冷色'], importOrder: 2 },
            },
            series: { version: 1, groups: { duo: { id: 'duo', name: '双人组', members: ['b', 'a'] } } },
            sortMode: 'import-asc',
            nextImportOrder: 3,
        },
        themeMeta: { mustNotLeak: true },
        themes: [{ name: 'not-avatar-data' }],
    };
}

function fixture(options = {}) {
    const seed = options.seed || {
        assets: [asset('a', 1), asset('b', 2)],
        bindings: [
            { themeKey: 'theme-name:A', targetKey: 'user:global:theme-avatar:a', avatarId: 'a', view: { scale: 1.2 } },
            { themeKey: 'theme-name:A', targetKey: 'user:global', avatarId: 'b', view: { x: 0.1 } },
        ],
        nativeViews: [{ targetKey: 'character:char.png', sourceKey: 'avatar:char.png', view: { scale: 1.1 } }],
        sourceIntents: [{ targetKey: 'user:global' }],
    };
    const store = options.store || modules.createAvatarStore({ adapter: modules.avatarStorage.createMemoryAdapter(seed) });
    const downloads = [];
    let stampIndex = 0;
    const stamps = options.stamps || [source(), source()];
    const coordinator = options.coordinator || {
        runReadBarrier(task) { return Promise.resolve().then(task); },
        getConsistencyState() { return Promise.resolve(stamps[Math.min(stampIndex++, stamps.length - 1)]); },
    };
    const ui = options.uiData || libraryData();
    const transfer = modules.createAvatarTransfer({
        store,
        coordinator,
        library: modules.avatarLibrary,
        avatarStorage: modules.avatarStorage,
        loadUiData: options.loadUiData || (() => ui),
        pluginVersion: '4.0.5-test',
        now: () => new Date('2026-09-11T12:00:00.000Z'),
        sha256,
        Blob,
        isMobile: options.isMobile || (() => false),
        limits: options.limits,
        download(blob, filename) { downloads.push({ blob, filename }); },
    });
    return { transfer, store, downloads, ui };
}

async function zipEntries(blob) {
    const reader = await modules.avatarTransfer.openStoredZip(blob, {
        payloadBytes: 1024 * 1024,
        archiveBytes: 1024 * 1024,
        fileBytes: 1024 * 1024,
        files: 1000,
    });
    const entries = [];
    for (const name of reader.entries.keys()) entries.push({ path: name, data: await reader.read(name) });
    return entries;
}

test('single export downloads the exact persisted main-image bytes without thumbnail or view baking', async () => {
    const f = fixture();
    const result = await f.transfer.exportSingle('a');
    assert.equal(f.downloads.length, 1);
    assert.equal(f.downloads[0].filename, '头像 a.png');
    assert.deepEqual(Buffer.from(await f.downloads[0].blob.arrayBuffer()), Buffer.from(PNG_HEADER.concat([1])));
    assert.equal(result.mime, 'image/png');
});

test('multi-select ZIP contains exact main images and a non-restorable verified index only', async () => {
    const f = fixture();
    await f.transfer.exportBatch(['b', 'a']);
    const verified = await f.transfer.verifyImageExportBlob(f.downloads[0].blob);
    assert.equal(verified.restorable, false);
    assert.deepEqual(Array.from(verified.images, (item) => item.id), ['b', 'a']);
    const entries = await zipEntries(f.downloads[0].blob);
    assert.equal(entries.length, 3);
    assert.ok(entries.some((entry) => entry.path === 'index.json'));
    assert.equal(entries.some((entry) => /thumb|inventory|manifest/i.test(entry.path)), false);
    assert.deepEqual(Buffer.from(entries.find((entry) => /--b\.png$/.test(entry.path)).data), Buffer.from(PNG_HEADER.concat([2])));
});

test('multi-select ZIP validates six images including a multi-megabyte persisted main image', async () => {
    const assets = [asset('large', 9, 3_400_000)].concat(Array.from({ length: 5 }, (_, index) => asset(`small-${index}`, index + 1, 128)));
    const f = fixture({
        seed: { assets },
        uiData: {},
        isMobile: () => true,
    });
    const ids = assets.map((item) => item.id);
    const result = await f.transfer.exportBatch(ids);
    assert.equal(result.count, 6);
    assert.equal(f.downloads.length, 1);
    const verified = await f.transfer.verifyImageExportBlob(f.downloads[0].blob);
    assert.deepEqual(Array.from(verified.images, (item) => item.id), ids);
    assert.equal(verified.images[0].bytes, 3_400_009);
});

test('large Base64 validation uses constant call stack and still rejects malformed padding', () => {
    const valid = pngData(7, 3_400_000);
    const info = modules.avatarTransfer.dataUrlInfo(valid);
    assert.equal(info.bytes, 3_400_009);
    assert.throws(
        () => modules.avatarTransfer.dataUrlInfo(valid.slice(0, -4) + 'A=== '),
        (error) => error.code === 'AVATAR_IMAGE_INVALID',
    );
});

test('full backup preserves the complete Avatar Manager inventory and excludes unrelated settings', async () => {
    const f = fixture();
    const result = await f.transfer.createFullBackup();
    assert.equal(f.downloads.length, 1);
    assert.equal(result.source.consistency, 'verified');
    const verified = await f.transfer.verifyBackupBlob(f.downloads[0].blob);
    const inventory = JSON.parse(JSON.stringify(verified.inventory));
    assert.equal(verified.manifest.format, 'theme-mgr-avatar-backup');
    assert.equal(verified.manifest.formatVersion, 1);
    assert.equal(verified.manifest.source.consistency, 'verified');
    assert.match(verified.manifest.source.avatarSnapshotSha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(verified.manifest.source.avatarLibrarySha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(inventory.assets.length, 2);
    assert.equal(inventory.bindings.length, 2);
    assert.equal(inventory.nativeViews.length, 1);
    assert.equal(inventory.sourceIntents.length, 1);
    assert.deepEqual(inventory.avatarLibrary.categories, ['朋友']);
    assert.deepEqual(inventory.avatarLibrary.series.groups.duo.members, ['b', 'a']);
    assert.equal(inventory.avatarLibrary.assetMeta.a.importOrder, 1);
    assert.equal(JSON.stringify(inventory).includes('mustNotLeak'), false);
    assert.equal(JSON.stringify(inventory).includes('not-avatar-data'), false);
    assert.equal(JSON.stringify(inventory).includes('data:image/'), false);
});

test('full backup is rejected after manifest tampering, missing files, or file hash mismatch', async () => {
    const f = fixture();
    await f.transfer.createFullBackup();
    const original = await zipEntries(f.downloads[0].blob);

    const manifestTamper = original.map((entry) => entry.path === 'manifest.json'
        ? { path: entry.path, data: new TextEncoder().encode(new TextDecoder().decode(entry.data).replace('4.0.5-test', '4.0.5-evil')) }
        : entry);
    await assert.rejects(
        f.transfer.verifyBackupBlob(modules.avatarTransfer.buildStoredZip(manifestTamper, new Date(), Blob)),
        (error) => error.code === 'AVATAR_ARCHIVE_INVALID',
    );

    const missing = original.filter((entry) => !entry.path.startsWith('blobs/sha256/'));
    await assert.rejects(
        f.transfer.verifyBackupBlob(modules.avatarTransfer.buildStoredZip(missing, new Date(), Blob)),
        (error) => error.code === 'AVATAR_ARCHIVE_INVALID',
    );

    let changed = false;
    const hashMismatch = original.map((entry) => {
        if (changed || !entry.path.startsWith('blobs/sha256/')) return entry;
        changed = true;
        const bytes = new Uint8Array(entry.data);
        bytes[bytes.length - 1] ^= 0x01;
        return { path: entry.path, data: bytes };
    });
    await assert.rejects(
        f.transfer.verifyBackupBlob(modules.avatarTransfer.buildStoredZip(hashMismatch, new Date(), Blob)),
        (error) => error.code === 'AVATAR_ARCHIVE_INVALID' && /SHA-256/.test(error.message),
    );
});

test('missing persisted image data fails closed before any download', async () => {
    const base = fixture();
    const brokenStore = Object.assign({}, base.store, {
        getAsset(id) { return base.store.getAsset(id).then((value) => id === 'a' ? Object.assign({}, value, { imageData: '' }) : value); },
    });
    const f = fixture({ store: brokenStore });
    await assert.rejects(f.transfer.createFullBackup(), (error) => error.code === 'AVATAR_IMAGE_INVALID');
    assert.equal(f.downloads.length, 0);
});

test('orphan bindings and malformed Avatar Library settings fail closed without guessed repair', async () => {
    const base = fixture();
    const orphanStore = Object.assign({}, base.store, {
        listBindings() {
            return base.store.listBindings().then((items) => items.concat([{
                version: 4,
                id: 'theme-name:Broken::user:global',
                themeKey: 'theme-name:Broken',
                targetKey: 'user:global',
                avatarId: 'missing',
                view: { x: 0, y: 0, scale: 1, rotate: 0, flipX: false, flipY: false },
                updatedAt: '2026-09-11T00:00:00.000Z',
            }]));
        },
    });
    const orphan = fixture({ store: orphanStore });
    await assert.rejects(orphan.transfer.createFullBackup(), (error) => error.code === 'AVATAR_SNAPSHOT_INVALID');
    assert.equal(orphan.downloads.length, 0);

    const malformed = libraryData();
    malformed.avatarLibrary.categories.push('朋友');
    const badLibrary = fixture({ uiData: malformed });
    await assert.rejects(badLibrary.transfer.createFullBackup(), (error) => error.code === 'AVATAR_BACKUP_INVALID');
    assert.equal(badLibrary.downloads.length, 0);
});

test('source revision or Avatar settings changes abort a mixed-point-in-time backup', async () => {
    const changedSource = fixture({
        stamps: [source({ revision: 4, fingerprint: 'sha256:' + '4'.repeat(64), datasetId: 'd', authority: 'remote' }), source({ revision: 5, fingerprint: 'sha256:' + '5'.repeat(64), datasetId: 'd', authority: 'remote' })],
    });
    await assert.rejects(changedSource.transfer.createFullBackup(), (error) => error.code === 'AVATAR_EXPORT_SOURCE_CHANGED');
    assert.equal(changedSource.downloads.length, 0);

    const ui = libraryData();
    let uiReads = 0;
    const changedSettings = fixture({
        loadUiData() {
            uiReads += 1;
            const value = JSON.parse(JSON.stringify(ui));
            if (uiReads > 1) value.avatarLibrary.sortMode = 'import-desc';
            return value;
        },
    });
    await assert.rejects(changedSettings.transfer.createFullBackup(), (error) => error.code === 'AVATAR_EXPORT_SOURCE_CHANGED');
    assert.equal(changedSettings.downloads.length, 0);
});

test('blocked and conflict sources cannot create a backup while verified offline cache is marked last-known-good', async () => {
    for (const phase of ['blocked', 'conflict']) {
        const f = fixture({ stamps: [source({ phase })] });
        await assert.rejects(f.transfer.createFullBackup(), (error) => error.code === 'AVATAR_BACKUP_UNAVAILABLE');
        assert.equal(f.downloads.length, 0);
    }
    const offlineStamp = source({ phase: 'remote-ready', authority: 'remote', offline: true, consistency: 'last-known-good', datasetId: 'd', revision: 8, fingerprint: 'sha256:' + '8'.repeat(64) });
    const offline = fixture({ stamps: [offlineStamp, offlineStamp] });
    await offline.transfer.createFullBackup();
    const verified = await offline.transfer.verifyBackupBlob(offline.downloads[0].blob);
    assert.equal(verified.manifest.source.consistency, 'last-known-good');
    assert.equal(verified.manifest.source.offline, true);
});

test('mobile payload limits reject large exports before ZIP construction or download', async () => {
    const f = fixture({
        seed: { assets: [asset('large', 9, 64)] },
        uiData: {},
        isMobile: () => true,
        limits: { payloadBytes: 32, archiveBytes: 512, fileBytes: 256, files: 32 },
    });
    await assert.rejects(f.transfer.exportBatch(['large']), (error) => error.code === 'AVATAR_EXPORT_LIMIT' && /安全上限/.test(error.message));
    assert.equal(f.downloads.length, 0);
});

test('mobile full backup reports the configured payload limit for multi-megabyte images', async () => {
    const f = fixture({
        seed: { assets: [asset('large-backup', 9, 3_400_000)] },
        uiData: {},
        isMobile: () => true,
        limits: { payloadBytes: 3 * 1024 * 1024, archiveBytes: 8 * 1024 * 1024, fileBytes: 6 * 1024 * 1024, files: 32 },
    });
    await assert.rejects(
        f.transfer.createFullBackup(),
        (error) => error.code === 'AVATAR_EXPORT_LIMIT' && /安全上限/.test(error.message),
    );
    assert.equal(f.downloads.length, 0);
});

test('mobile file-count limits stop a large library before any main image is expanded', async () => {
    const assets = Array.from({ length: 40 }, (_, index) => asset(`mobile-${index}`, index));
    const baseStore = modules.createAvatarStore({ adapter: modules.avatarStorage.createMemoryAdapter({ assets }) });
    let fullImageReads = 0;
    const store = Object.assign({}, baseStore, {
        getAsset(id) { fullImageReads += 1; return baseStore.getAsset(id); },
    });
    const f = fixture({
        store,
        uiData: {},
        isMobile: () => true,
        limits: { payloadBytes: 1024 * 1024, archiveBytes: 1024 * 1024, fileBytes: 1024, files: 32 },
    });
    await assert.rejects(f.transfer.createFullBackup(), (error) => error.code === 'AVATAR_EXPORT_LIMIT' && /头像数量/.test(error.message));
    assert.equal(fullImageReads, 0);
    assert.equal(f.downloads.length, 0);
});

test('large-library backup reads full assets sequentially and stays within explicit bounds', async () => {
    const assets = [asset('large-library-image', 9, 3_400_000)].concat(Array.from({ length: 63 }, (_, index) => asset(`a${index}`, index + 1)));
    const baseStore = modules.createAvatarStore({ adapter: modules.avatarStorage.createMemoryAdapter({ assets }) });
    let activeReads = 0;
    let maxReads = 0;
    const store = Object.assign({}, baseStore, {
        getAsset(id) {
            activeReads += 1;
            maxReads = Math.max(maxReads, activeReads);
            return new Promise((resolve, reject) => setTimeout(() => {
                baseStore.getAsset(id).then(resolve, reject).finally(() => { activeReads -= 1; });
            }, 0));
        },
    });
    const f = fixture({ store, uiData: {} });
    await f.transfer.createFullBackup();
    assert.equal(maxReads, 1);
    assert.equal(f.downloads.length, 1);
});

test('export verifier stays write-free while restore writes remain isolated in the recovery module', () => {
    const sourceText = fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-transfer.js'), 'utf8');
    assert.doesNotMatch(sourceText, /restoreBackup|importBackup|replaceSnapshot|putAsset\s*\(/);
    const recoveryText = fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-recovery.js'), 'utf8');
    assert.match(recoveryText, /restoreBackup/);
    assert.match(recoveryText, /runRecoveryBarrier/);
    const uiText = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');
    assert.match(uiText, /从完整备份恢复/);
});
