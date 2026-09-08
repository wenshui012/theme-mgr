(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    function clean(value) {
        return String(value == null ? '' : value).trim();
    }

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function makeError(code, message, details) {
        var error = new Error(message);
        error.name = 'ThemeManagerUpdateError';
        error.code = code;
        if (details) error.details = details;
        return error;
    }

    function normalizeRemoteUrl(value) {
        var url = clean(value).replace(/\.git\/?$/i, '').replace(/\/$/, '');
        var ssh = url.match(/^git@github\.com:(.+)$/i);
        if (ssh) url = 'https://github.com/' + ssh[1];
        return url.toLowerCase();
    }

    ns.createExtensionUpdater = function (options) {
        options = options || {};
        var fetchFn = typeof options.fetch === 'function' ? options.fetch : global.fetch.bind(global);
        var getPostHeaders = typeof options.getPostHeaders === 'function'
            ? options.getPostHeaders
            : function () { return { 'Content-Type': 'application/json' }; };
        var extensionName = clean(options.extensionName) || 'theme-mgr';
        var trustedRemotes = (options.trustedRemotes || []).map(normalizeRemoteUrl).filter(Boolean);
        var onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : function () {};
        var state = {
            phase: 'idle',
            checked: false,
            supported: null,
            available: false,
            global: false,
            branch: '',
            commit: '',
            remoteUrl: '',
            reason: '',
        };
        var checkPromise = null;
        var updatePromise = null;

        function publish(next) {
            state = Object.assign({}, state, next || {});
            onStateChange(clone(state));
            return clone(state);
        }

        function request(endpoint, globalInstall) {
            return Promise.resolve()
                .then(function () { return getPostHeaders(); })
                .then(function (headers) {
                    return fetchFn(endpoint, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: headers,
                        body: JSON.stringify({ extensionName: extensionName, global: globalInstall === true }),
                    });
                })
                .then(function (response) {
                    if (!response || typeof response.ok !== 'boolean') {
                        throw makeError('UPDATE_RESPONSE_INVALID', '扩展更新接口响应无效');
                    }
                    if (!response.ok) {
                        throw makeError('UPDATE_HTTP_ERROR', '扩展更新接口请求失败', { status: Number(response.status) || 0 });
                    }
                    return Promise.resolve(response.json()).catch(function (error) {
                        throw makeError('UPDATE_RESPONSE_INVALID', '扩展更新接口返回了无效数据', { cause: clean(error && error.message) });
                    });
                });
        }

        function requestVersion(globalInstall) {
            return request('/api/extensions/version', globalInstall).then(function (info) {
                if (!info || typeof info !== 'object' || typeof info.isUpToDate !== 'boolean') {
                    throw makeError('UPDATE_RESPONSE_INVALID', '扩展版本信息不完整');
                }
                return { info: info, global: globalInstall === true };
            });
        }

        function discoverInstall() {
            return requestVersion(false).catch(function (error) {
                if (error && error.code === 'UPDATE_HTTP_ERROR' && error.details && error.details.status === 404) {
                    return requestVersion(true);
                }
                throw error;
            });
        }

        function inspectVersion(result) {
            var info = result.info;
            var branch = clean(info.currentBranchName);
            var commit = clean(info.currentCommitHash);
            var remoteUrl = clean(info.remoteUrl);
            var normalizedRemote = normalizeRemoteUrl(remoteUrl);
            var hasGitMetadata = Boolean(branch && commit && remoteUrl);
            var trusted = trustedRemotes.length === 0 || trustedRemotes.indexOf(normalizedRemote) !== -1;
            if (!hasGitMetadata) {
                return publish({
                    phase: 'unsupported', checked: true, supported: false, available: false,
                    global: result.global, branch: branch, commit: commit, remoteUrl: remoteUrl,
                    reason: 'not-git-install',
                });
            }
            if (!trusted) {
                return publish({
                    phase: 'unsupported', checked: true, supported: false, available: false,
                    global: result.global, branch: branch, commit: commit, remoteUrl: remoteUrl,
                    reason: 'untrusted-remote',
                });
            }
            return publish({
                phase: 'ready', checked: true, supported: true, available: info.isUpToDate === false,
                global: result.global, branch: branch, commit: commit, remoteUrl: remoteUrl, reason: '',
            });
        }

        function check(options) {
            options = options || {};
            if (!options.force && state.checked) return Promise.resolve(clone(state));
            if (checkPromise) return checkPromise;
            publish({ phase: 'checking', available: false, reason: '' });
            checkPromise = discoverInstall()
                .then(inspectVersion)
                .catch(function (error) {
                    publish({
                        phase: 'error', checked: true, supported: null, available: false,
                        reason: error && error.code || 'update-check-failed',
                    });
                    throw error;
                })
                .finally(function () { checkPromise = null; });
            return checkPromise;
        }

        function update() {
            if (updatePromise) return updatePromise;
            if (!state.supported || !state.available) {
                return Promise.reject(makeError('UPDATE_NOT_AVAILABLE', '当前没有可安装的更新'));
            }
            var targetGlobal = state.global;
            publish({ phase: 'updating', available: false, reason: '' });
            updatePromise = request('/api/extensions/update', targetGlobal)
                .then(function (info) {
                    var commit = clean(info && (info.fullCommitHash || info.shortCommitHash));
                    if (!info || typeof info !== 'object' || !commit) {
                        throw makeError('UPDATE_RESPONSE_INVALID', '扩展更新结果不完整');
                    }
                    return publish({
                        phase: 'updated', checked: true, supported: true, available: false,
                        commit: commit, reason: '',
                    });
                })
                .catch(function (error) {
                    publish({
                        phase: 'error', checked: true, supported: true, available: false,
                        reason: error && error.code || 'update-failed',
                    });
                    throw error;
                })
                .finally(function () { updatePromise = null; });
            return updatePromise;
        }

        return {
            check: check,
            update: update,
            getState: function () { return clone(state); },
        };
    };

    ns.extensionUpdater = {
        normalizeRemoteUrl: normalizeRemoteUrl,
    };
})(window);
