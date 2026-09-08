const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.ThemeMgrModules = {};
require('../src/update-manager.js');

const { createExtensionUpdater, extensionUpdater } = global.ThemeMgrModules;

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json() { return Promise.resolve(body); },
    };
}

function version(overrides) {
    return Object.assign({
        currentBranchName: 'main',
        currentCommitHash: 'a'.repeat(40),
        isUpToDate: false,
        remoteUrl: 'https://github.com/wenshui012/theme-mgr.git',
    }, overrides || {});
}

test('normalizes trusted HTTPS and SSH GitHub remotes', () => {
    assert.equal(extensionUpdater.normalizeRemoteUrl('https://github.com/wenshui012/theme-mgr.git/'), 'https://github.com/wenshui012/theme-mgr');
    assert.equal(extensionUpdater.normalizeRemoteUrl('git@github.com:wenshui012/theme-mgr.git'), 'https://github.com/wenshui012/theme-mgr');
});

test('checks the current-user Git install with CSRF headers and reports an update', async () => {
    const calls = [];
    const updater = createExtensionUpdater({
        extensionName: 'theme-mgr',
        trustedRemotes: ['https://github.com/wenshui012/theme-mgr'],
        getPostHeaders: async () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' }),
        fetch: async (url, init) => {
            calls.push({ url, init });
            return response(200, version({ currentBranchName: 'feature/avatar-manager-mvp' }));
        },
    });
    const state = await updater.check();
    assert.equal(state.phase, 'ready');
    assert.equal(state.available, true);
    assert.equal(state.global, false);
    assert.equal(state.branch, 'feature/avatar-manager-mvp');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/extensions/version');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(calls[0].init.headers['X-CSRF-Token'], 'test-token');
    assert.deepEqual(JSON.parse(calls[0].init.body), { extensionName: 'theme-mgr', global: false });
});

test('falls back to a global install only when the local extension is absent', async () => {
    const bodies = [];
    const updater = createExtensionUpdater({
        trustedRemotes: ['https://github.com/wenshui012/theme-mgr'],
        fetch: async (_url, init) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            return body.global ? response(200, version({ isUpToDate: true })) : response(404, {});
        },
    });
    const state = await updater.check();
    assert.equal(state.phase, 'ready');
    assert.equal(state.available, false);
    assert.equal(state.global, true);
    assert.deepEqual(bodies.map((body) => body.global), [false, true]);
});

test('blocks copied installs and unexpected remotes instead of updating them', async () => {
    const copied = createExtensionUpdater({ fetch: async () => response(200, version({ currentBranchName: '', currentCommitHash: '', remoteUrl: '', isUpToDate: true })) });
    assert.deepEqual(await copied.check(), {
        phase: 'unsupported', checked: true, supported: false, available: false,
        global: false, branch: '', commit: '', remoteUrl: '', reason: 'not-git-install',
    });

    const fork = createExtensionUpdater({
        trustedRemotes: ['https://github.com/wenshui012/theme-mgr'],
        fetch: async () => response(200, version({ remoteUrl: 'https://github.com/example/fork.git' })),
    });
    const forkState = await fork.check();
    assert.equal(forkState.phase, 'unsupported');
    assert.equal(forkState.reason, 'untrusted-remote');
});

test('updates only an available trusted install and keeps the resolved scope', async () => {
    const calls = [];
    const updater = createExtensionUpdater({
        trustedRemotes: ['https://github.com/wenshui012/theme-mgr'],
        fetch: async (url, init) => {
            calls.push({ url, body: JSON.parse(init.body) });
            if (url.endsWith('/version')) return response(200, version());
            return response(200, { shortCommitHash: 'bcdef12', isUpToDate: false, remoteUrl: 'https://github.com/wenshui012/theme-mgr.git' });
        },
    });
    await updater.check();
    const state = await updater.update();
    assert.equal(state.phase, 'updated');
    assert.equal(state.commit, 'bcdef12');
    assert.deepEqual(calls[1], { url: '/api/extensions/update', body: { extensionName: 'theme-mgr', global: false } });
    await assert.rejects(updater.update(), { code: 'UPDATE_NOT_AVAILABLE' });
});
