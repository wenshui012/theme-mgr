(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createThemeRuntime = function (opts) {
        opts = opts || {};
        var schema = opts.schema || ns.themeSchema;
        var api = opts.api;
        var fullThemeCache = {};
        var applyRequestId = 0;

        function makeError(code, message) {
            var error = new Error(message || code);
            error.code = code;
            return error;
        }

        function getBridge() {
            try {
                var bridge = global.__baibaokuEarlyBridge;
                return bridge && typeof bridge === 'object' ? bridge : null;
            } catch (e) {
                return null;
            }
        }

        function invalidate(reason) {
            try {
                var bridge = getBridge();
                if (bridge && typeof bridge.clearSettingsGetCache === 'function') {
                    bridge.clearSettingsGetCache(reason || 'theme-manager-theme-change');
                }
            } catch (err) {
                console.warn('[美化管理] 清理柏宝库主题缓存失败:', err);
            }
        }

        function hydrate(theme) {
            try {
                if (typeof global.baibaokuHydrateTheme !== 'function') return false;
                global.baibaokuHydrateTheme(schema.cloneValue(theme));
                return true;
            } catch (err) {
                console.warn('[美化管理] 刷新酒馆原生主题缓存失败:', err);
                return false;
            }
        }

        function remember(theme) {
            if (!schema.isCompleteTheme(theme, theme && theme.name)) return false;
            fullThemeCache[theme.name] = schema.cloneValue(theme);
            return true;
        }

        function forget(themeName) {
            delete fullThemeCache[themeName];
        }

        function getCached(themeName) {
            return fullThemeCache[themeName] ? schema.cloneValue(fullThemeCache[themeName]) : null;
        }

        function captureInventory(themes) {
            (themes || []).forEach(function (theme) {
                if (!theme || !theme.name) return;
                if (!remember(theme)) forget(theme.name);
            });
            return themes || [];
        }

        function getInventory(options) {
            options = options || {};
            var bridge = getBridge();
            var promise = options.bypassBaibaokuCache && bridge && typeof bridge.rawFetch === 'function'
                ? api.getRawSettingsInventory(bridge.rawFetch)
                : api.getSettingsInventory();
            return promise.then(captureInventory);
        }

        function findTheme(themes, themeName) {
            var found = null;
            (themes || []).some(function (theme) {
                if (theme && theme.name === themeName) { found = theme; return true; }
                return false;
            });
            return found;
        }

        function ensureCandidate(themeName, candidate) {
            if (schema.isCompleteTheme(candidate, themeName)) {
                var completeCandidate = schema.cloneValue(candidate);
                remember(completeCandidate);
                return Promise.resolve(completeCandidate);
            }

            var bridge = getBridge();
            if (!bridge || typeof bridge.ensureThemeLoaded !== 'function') {
                return Promise.reject(makeError('incomplete', '主题尚未完整加载，不能安全操作'));
            }

            return Promise.resolve()
                .then(function () { return bridge.ensureThemeLoaded(themeName); })
                .then(function (loaded) {
                    if (!schema.isCompleteTheme(loaded, themeName)) {
                        throw makeError('incomplete', '主题尚未完整加载，不能安全操作');
                    }
                    var complete = schema.cloneValue(loaded);
                    remember(complete);
                    return complete;
                })
                .catch(function (err) {
                    if (err && err.code === 'incomplete') throw err;
                    console.warn('[美化管理] 柏宝库完整主题加载失败:', err);
                    throw makeError('incomplete', '主题尚未完整加载，不能安全操作');
                });
        }

        function ensureCompleteTheme(themeName, candidate) {
            if (arguments.length > 1) return ensureCandidate(themeName, candidate);
            var cached = getCached(themeName);
            if (cached) return Promise.resolve(cached);
            return getInventory().then(function (themes) {
                return ensureCandidate(themeName, findTheme(themes, themeName));
            });
        }

        function ensureCompleteThemes(themeNames) {
            var names = Array.isArray(themeNames) ? themeNames.slice() : [];
            var complete = [];
            return names.reduce(function (pending, themeName) {
                return pending.then(function () {
                    return ensureCompleteTheme(themeName).then(function (theme) { complete.push(theme); });
                });
            }, Promise.resolve()).then(function () { return complete; });
        }

        function prepareCompleteThemeForApply(themeName) {
            var bridge = getBridge();
            if (!bridge || typeof bridge.ensureThemeLoaded !== 'function') {
                return Promise.resolve({ theme: null, hydrated: false });
            }

            var cached = getCached(themeName);
            var ensureLoaded = function () {
                return Promise.resolve().then(function () { return bridge.ensureThemeLoaded(themeName); });
            };
            var completeResult = function (theme) {
                if (!schema.isCompleteTheme(theme, themeName)) {
                    throw makeError('incomplete', '主题尚未完整加载，不能安全切换');
                }
                var complete = schema.cloneValue(theme);
                remember(complete);
                return { theme: complete, hydrated: hydrate(complete) };
            };

            return ensureLoaded()
                .then(function (loaded) {
                    if (schema.isCompleteTheme(loaded, themeName)) return loaded;
                    if (cached) return cached;
                    return getInventory().then(function (themes) {
                        var candidate = findTheme(themes, themeName);
                        if (schema.isCompleteTheme(candidate, themeName)) return candidate;

                        var isLazy = schema.isLazyTheme(candidate);
                        try {
                            if (!isLazy && typeof bridge.isThemeLazy === 'function') {
                                isLazy = bridge.isThemeLazy(themeName) === true;
                            }
                        } catch (e) {}
                        if (!candidate && !isLazy) return null;
                        if (!isLazy) throw makeError('incomplete', '主题尚未完整加载，不能安全切换');
                        return ensureLoaded().then(function (complete) {
                            if (!schema.isCompleteTheme(complete, themeName)) {
                                throw makeError('incomplete', '主题尚未完整加载，不能安全切换');
                            }
                            return complete;
                        });
                    });
                })
                .then(function (theme) {
                    return theme ? completeResult(theme) : { theme: null, hydrated: false };
                })
                .catch(function (err) {
                    if (err && (err.code === 'incomplete' || err.code === 'load-failed')) throw err;
                    console.warn('[美化管理] 柏宝库主题切换预加载失败:', err);
                    throw makeError('load-failed', err && err.message ? err.message : '主题加载失败');
                });
        }

        function beginApply() {
            applyRequestId += 1;
            return applyRequestId;
        }

        function isApplyCurrent(requestId) {
            return !requestId || requestId === applyRequestId;
        }

        function applyThemeAndWait(themeName, applyFn) {
            var requestId = beginApply();
            return prepareCompleteThemeForApply(themeName).then(function (prepared) {
                if (!isApplyCurrent(requestId)) throw makeError('superseded', '主题切换已被更新请求取代');
                return Promise.resolve(applyFn(prepared, requestId, function () {
                    return isApplyCurrent(requestId);
                })).then(function (result) {
                    if (!isApplyCurrent(requestId)) throw makeError('superseded', '主题切换已被更新请求取代');
                    return result;
                });
            });
        }

        return {
            getBridge: getBridge,
            invalidate: invalidate,
            hydrate: hydrate,
            remember: remember,
            forget: forget,
            getCached: getCached,
            getInventory: getInventory,
            findTheme: findTheme,
            ensureCompleteTheme: ensureCompleteTheme,
            ensureCompleteThemes: ensureCompleteThemes,
            prepareCompleteThemeForApply: prepareCompleteThemeForApply,
            beginApply: beginApply,
            isApplyCurrent: isApplyCurrent,
            applyThemeAndWait: applyThemeAndWait,
            makeError: makeError,
        };
    };
})(window);
