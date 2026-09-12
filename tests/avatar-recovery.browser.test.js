const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['avatar-storage.js', 'avatar-sync.js', 'avatar-library.js', 'avatar-transfer.js', 'avatar-recovery.js'];

function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>avatar recovery browser</title>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.THEME_MGR_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    });
    try {
        const page = await browser.newPage();
        page.on('console', message => console.log('[avatar-recovery-browser]', message.text()));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        for (const name of MODULES) await page.addScriptTag({ path: path.join(ROOT, 'src', name) });
        const report = await page.evaluate(async () => {
            const modules = window.ThemeMgrModules;
            const timed = (label, promise) => Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), 5000)),
            ]);
            const suffix = Date.now().toString(36);
            const defaultName = `theme_mgr_avatar_db_browser_${suffix}`;
            const backupName = `${defaultName}_backup`;
            const pointerKey = modules.avatarRecovery.POINTER_KEY;
            const transactionKey = modules.avatarRecovery.TRANSACTION_KEY;
            localStorage.removeItem(pointerKey);
            localStorage.removeItem(transactionKey);
            const png = marker => {
                const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);
                let binary = '';
                bytes.forEach(byte => { binary += String.fromCharCode(byte); });
                return `data:image/png;base64,${btoa(binary)}`;
            };
            const asset = (id, marker) => ({ id, name: id, imageData: png(marker), thumbData: png(marker + 10), mimeType: 'image/png', width: 10, height: 10, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' });
            const library = id => ({ version: 1, categories: [], assetMeta: { [id]: { category: '', tags: [], importOrder: 1 } }, series: { version: 1, groups: {} }, sortMode: 'import-asc', nextImportOrder: 2 });
            const backupStore = modules.createAvatarStore({ dbName: backupName });
            await timed('backup-store-ready', backupStore.ready);
            await timed('backup-store-put', backupStore.putAsset(asset('restored', 2)));
            let backupBlob;
            const backupTransfer = modules.createAvatarTransfer({
                store: backupStore,
                coordinator: { runReadBarrier: task => Promise.resolve().then(task), getConsistencyState: () => Promise.resolve({ phase: 'local-ready', authority: 'local', consistency: 'verified', offline: false, datasetId: null, revision: null, fingerprint: '' }) },
                library: modules.avatarLibrary,
                avatarStorage: modules.avatarStorage,
                loadUiData: () => ({ avatarLibrary: library('restored') }),
                download(blob) { backupBlob = blob; },
            });
            await timed('create-backup', backupTransfer.createFullBackup());
            console.log('backup-ready');

            const oldStore = modules.createAvatarStore({ dbName: defaultName });
            await timed('old-store-ready', oldStore.ready);
            await timed('old-store-put', oldStore.putAsset(asset('old', 1)));
            let locked = false;
            let ui = { avatarLibrary: library('old'), unrelated: 'preserved' };
            const coordinator = modules.createAvatarStorageCoordinator({
                localStore: oldStore,
                isBackendAvailable: () => false,
                isExternalWriteBlocked: () => locked,
                cacheDbName: `${defaultName}_cache`,
                controlDbName: `${defaultName}_control`,
            });
            await timed('coordinator-init', coordinator.initialize());
            console.log('coordinator-ready');
            const transfer = modules.createAvatarTransfer({ store: coordinator.store, coordinator, library: modules.avatarLibrary, avatarStorage: modules.avatarStorage, loadUiData: () => ui, download() {} });
            const createStore = databaseName => modules.createAvatarStore({ dbName: databaseName });
            const recovery = modules.createAvatarRecovery({
                bootstrap: modules.avatarRecovery.resolveBootstrap({ localStorage, defaultDatabaseName: defaultName }),
                localStorage, defaultDatabaseName: defaultName, transfer, coordinator, avatarStorage: modules.avatarStorage, avatarTransferTools: modules.avatarTransfer,
                createStore, library: modules.avatarLibrary, loadUiData: () => ui,
                saveUiData(value) { ui = JSON.parse(JSON.stringify(value)); return Promise.resolve(true); },
                flushUiData: () => Promise.resolve(true), getAuthorityState: () => ({ ready: true, localOnly: true, evidence: 'browser-test' }),
                setGlobalLock(value) { locked = value; }, estimateStorage: () => Promise.resolve({ quota: 1024 ** 3, usage: 0 }), memoryState: () => null,
            });
            const restored = await timed('restore-backup', recovery.restoreBackup(backupBlob));
            console.log('restore-committed');
            const activeAfterRestore = (await coordinator.store.listAssets()).map(item => item.id);
            const oldStillPresent = (await oldStore.listAssets()).map(item => item.id);
            const log = JSON.parse(localStorage.getItem(transactionKey));
            log.state = 'verifying';
            log.rollbackComplete = false;
            localStorage.setItem(transactionKey, JSON.stringify(log));
            const bootstrap = modules.avatarRecovery.resolveBootstrap({ localStorage, defaultDatabaseName: defaultName });

            let restartLocked = true;
            const pointedStore = createStore(restored.databaseName);
            const restarted = modules.createAvatarStorageCoordinator({
                localStore: pointedStore, isBackendAvailable: () => false, isExternalWriteBlocked: () => restartLocked,
                startupLock: { error: bootstrap.error }, cacheDbName: `${defaultName}_cache_restart`, controlDbName: `${defaultName}_control_restart`,
            });
            let startupCode = '';
            try { await timed('restart-init', restarted.initialize()); } catch (error) { startupCode = error.code || error.message; }
            console.log('restart-blocked');
            const restartTransfer = modules.createAvatarTransfer({ store: restarted.store, coordinator: restarted, library: modules.avatarLibrary, avatarStorage: modules.avatarStorage, loadUiData: () => ui, download() {} });
            const restartRecovery = modules.createAvatarRecovery({
                bootstrap, localStorage, defaultDatabaseName: defaultName, transfer: restartTransfer, coordinator: restarted, avatarStorage: modules.avatarStorage, avatarTransferTools: modules.avatarTransfer,
                createStore, library: modules.avatarLibrary, loadUiData: () => ui,
                saveUiData(value) { ui = JSON.parse(JSON.stringify(value)); return Promise.resolve(true); },
                flushUiData: () => Promise.resolve(true), getAuthorityState: () => ({ ready: true, localOnly: true }), setGlobalLock(value) { restartLocked = value; },
            });
            await timed('rollback-incomplete', restartRecovery.rollbackIncomplete());
            console.log('rollback-complete');
            const activeAfterRollback = (await restarted.store.listAssets()).map(item => item.id);
            const databases = typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map(item => item.name) : [];
            return {
                activeAfterRestore, oldStillPresent, activeAfterRollback,
                uiAvatarIds: Object.keys(ui.avatarLibrary.assetMeta), unrelated: ui.unrelated,
                committedState: log.state, startupBlocked: bootstrap.blocked, startupCode, restartLocked,
                pointerAfterRollback: localStorage.getItem(pointerKey), rollbackComplete: JSON.parse(localStorage.getItem(transactionKey)).rollbackComplete,
                shadowExists: databases.includes(restored.databaseName),
            };
        });
        assert(JSON.stringify(report.activeAfterRestore) === JSON.stringify(['restored']), 'shadow DB did not become active');
        assert(JSON.stringify(report.oldStillPresent) === JSON.stringify(['old']), 'old DB was overwritten or removed');
        assert(report.startupBlocked && report.startupCode === 'AVATAR_STORAGE_BLOCKED', 'incomplete transaction did not lock restart');
        assert(JSON.stringify(report.activeAfterRollback) === JSON.stringify(['old']), 'rollback did not rebind the old DB');
        assert(JSON.stringify(report.uiAvatarIds) === JSON.stringify(['old']) && report.unrelated === 'preserved', 'settings rollback was incomplete or overwrote unrelated data');
        assert(report.pointerAfterRollback === null && report.rollbackComplete === true && report.restartLocked === false, 'rollback did not finish its durable control state');
        assert(report.shadowExists, 'shadow DB should be preserved rather than deleted');
        console.log(JSON.stringify({ ok: true, report }, null, 2));
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
