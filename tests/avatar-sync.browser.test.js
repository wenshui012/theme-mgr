const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['avatar-storage.js', 'avatar-sync.js'];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function chromium() {
    const { chromium } = require('playwright');
    try { return await chromium.launch({ headless: true }); }
    catch (error) {
        const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        return chromium.launch({ executablePath, headless: true });
    }
}

(async () => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>avatar sync integration</title>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium();
    const context = await browser.newContext();
    const page = await context.newPage();
    let offline = false;
    let remoteState = { status: 'empty' };
    const calls = [];
    const csrfToken = 'browser-csrf-token';

    await page.route('**/api/plugins/theme-manager/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push(request.method() + ' ' + url.pathname);
        if (offline) return route.abort('failed');
        if (url.pathname.endsWith('/status')) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                ok: true,
                version: 2,
                capabilities: { avatarStorage: { version: 1, manifestVersion: 1, revisionCas: true, verifiedImageMetadata: true } },
            }) });
        }
        if (url.pathname.endsWith('/avatars/state')) {
            const body = remoteState.status === 'empty'
                ? { ok: true, state: 'empty', datasetId: null, revision: 0, manifest: null }
                : { ok: true, state: 'present', datasetId: remoteState.datasetId, revision: remoteState.revision, fingerprint: remoteState.fingerprint, manifest: remoteState.manifest };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        }
        if (url.pathname.endsWith('/images') && request.method() === 'POST') {
            assert(request.headers()['x-csrf-token'] === csrfToken, 'upload omitted the resolved CSRF header');
            assert(request.headers()['content-type'] === 'application/json', 'upload omitted the JSON content type');
            const dataUrl = request.postDataJSON().dataUrl;
            const match = /^data:image\/(png);base64,(.+)$/i.exec(dataUrl);
            assert(match, 'unexpected uploaded image');
            const raw = Buffer.from(match[2], 'base64');
            const name = crypto.createHash('sha1').update(raw).digest('hex') + '.png';
            const image = {
                name,
                url: '/api/plugins/theme-manager/images/' + name,
                sha256: 'sha256:' + crypto.createHash('sha256').update(raw).digest('hex'),
                bytes: raw.length,
                mime: 'image/png',
            };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, image }) });
        }
        if (url.pathname.endsWith('/avatars/manifest') && request.method() === 'PUT') {
            assert(request.headers()['x-csrf-token'] === csrfToken, 'manifest commit omitted the resolved CSRF header');
            assert(request.headers()['content-type'] === 'application/json', 'manifest commit omitted the JSON content type');
            const body = request.postDataJSON();
            assert(remoteState.status === 'empty' && body.expectedRevision === 0, 'initial CAS was not revision 0');
            remoteState = { status: 'present', datasetId: body.datasetId, revision: 1, fingerprint: 'sha256:' + '1'.repeat(64), manifest: body.manifest };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                ok: true,
                state: 'present',
                datasetId: remoteState.datasetId,
                revision: remoteState.revision,
                fingerprint: remoteState.fingerprint,
                manifest: remoteState.manifest,
            }) });
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
    });

    await page.goto(origin);
    await page.setContent('<!doctype html><html><body></body></html>');
    for (const name of MODULES) await page.addScriptTag({ path: path.join(ROOT, 'src', name) });
    const names = await page.evaluate(() => ({
        local: 'tm-avatar-sync-browser-local-' + Date.now(),
        cache: 'tm-avatar-sync-browser-cache-' + Date.now(),
        control: 'tm-avatar-sync-browser-control-' + Date.now(),
    }));
    const first = await page.evaluate(async names => {
        const modules = window.ThemeMgrModules;
        const canvas = document.createElement('canvas');
        canvas.width = 2; canvas.height = 2;
        canvas.getContext('2d').fillRect(0, 0, 2, 2);
        const dataUrl = canvas.toDataURL('image/png');
        const local = modules.createAvatarStore({ dbName: names.local });
        await local.putAsset({ id: 'browser-a', name: 'Browser A', imageData: dataUrl, thumbData: dataUrl, mimeType: 'image/png', width: 2, height: 2 });
        const before = await local.readSnapshot();
        const coordinator = modules.createAvatarStorageCoordinator({
            localStore: local,
            cacheDbName: names.cache,
            controlDbName: names.control,
            getPostHeaders: () => Promise.resolve({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'browser-csrf-token' }),
        });
        const state = await coordinator.initialize();
        const after = await local.readSnapshot();
        const active = await coordinator.store.getAsset('browser-a');
        return {
            state,
            localUnchanged: JSON.stringify(before) === JSON.stringify(after),
            activeDataUrl: active.imageData.startsWith('data:image/png;base64,'),
        };
    }, names);
    assert(first.state.phase === 'remote-ready' && first.state.writable === true, 'migration did not become writable remote-ready');
    assert(first.localUnchanged, 'original local database changed during takeover');
    assert(first.activeDataUrl, 'migrated active store lost its image bytes');
    assert(calls.filter(call => call === 'PUT /api/plugins/theme-manager/avatars/manifest').length === 1, 'manifest was not committed exactly once');

    offline = true;
    const second = await page.evaluate(async names => {
        const modules = window.ThemeMgrModules;
        const local = modules.createAvatarStore({ dbName: names.local });
        const coordinator = modules.createAvatarStorageCoordinator({
            localStore: local,
            cacheDbName: names.cache,
            controlDbName: names.control,
            getPostHeaders: () => Promise.resolve({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'browser-csrf-token' }),
            timeoutMs: 500,
        });
        const state = await coordinator.initialize();
        const assets = await coordinator.store.listAssets();
        let writeCode = '';
        try { await coordinator.store.putSourceIntent({ targetKey: 'user:global' }); }
        catch (error) { writeCode = error.code; }
        return { state, count: assets.length, writeCode };
    }, names);
    assert(second.state.phase === 'remote-ready' && second.state.offline === true && second.state.writable === false, 'offline reload did not use read-only cache');
    assert(second.count === 1, 'offline cache did not retain the avatar');
    assert(second.writeCode === 'AVATAR_STORAGE_READ_ONLY', 'offline cache accepted a mutation');

    console.log(JSON.stringify({ ok: true, migration: first.state, offline: second.state, calls }, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
})().catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
});
