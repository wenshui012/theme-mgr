(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createThemeRuntime = function (opts) {
        opts = opts || {};
        var schema = opts.schema || ns.themeSchema;
        var api = opts.api;
        var fullThemeCache = Object.create(null);
        var staleThemeCache = Object.create(null);
        var confirmedSavedPatches = Object.create(null);
        var confirmedSavedRevision = 0;
        var nativeThemeSaveRequestSequence = 0;
        var applyRequestId = 0;
        var activeApplyCount = 0;
        var nativeEditTrackingBound = false;
        var nativeThemeSaveTrackingBound = false;
        var nativeEvictionSequence = 0;
        var loadPowerUserModule = typeof opts.loadPowerUserModule === 'function'
            ? opts.loadPowerUserModule
            : function () { return import('/scripts/power-user.js'); };
        var stateVerifyTimeoutMs = Number(opts.stateVerifyTimeoutMs) >= 0 ? Number(opts.stateVerifyTimeoutMs) : 600;
        var stateVerifyIntervalMs = Number(opts.stateVerifyIntervalMs) >= 0 ? Number(opts.stateVerifyIntervalMs) : 25;
        var visualMaxAttempts = Number(opts.visualMaxAttempts) > 0 ? Number(opts.visualMaxAttempts) : 4;
        var visualRetryDelayMs = Number(opts.visualRetryDelayMs) >= 0 ? Number(opts.visualRetryDelayMs) : 50;

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

        function clearFullCache() {
            Object.keys(fullThemeCache).forEach(function (name) { delete fullThemeCache[name]; });
        }

        function clearStaleCache() {
            Object.keys(staleThemeCache).forEach(function (name) { delete staleThemeCache[name]; });
        }

        function clearBridgeSettingsCache(reason) {
            try {
                var bridge = getBridge();
                if (bridge && typeof bridge.clearSettingsGetCache === 'function') {
                    bridge.clearSettingsGetCache(reason || 'theme-manager-theme-change');
                }
            } catch (err) {
                console.warn('[美化管理] 清理柏宝库主题缓存失败:', err);
            }
        }

        function invalidate(reason) {
            clearFullCache();
            clearStaleCache();
            clearBridgeSettingsCache(reason);
        }

        function invalidateTheme(themeName, reason) {
            themeName = String(themeName || '').trim();
            if (!themeName) return false;
            delete fullThemeCache[themeName];
            if (staleThemeCache[themeName]) return true;
            staleThemeCache[themeName] = {
                reason: reason || 'theme-manager-native-edit',
                invalidatedAt: Date.now(),
            };
            clearBridgeSettingsCache(reason || 'theme-manager-native-edit');
            return true;
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

        function replaceNativeTheme(oldName, theme, nativeThemeRef) {
            var usable = schema.cloneValue(theme);
            if (!schema.isUsableTheme(usable, usable && usable.name)) return false;
            if (schema.isPlainObject(nativeThemeRef) &&
                (nativeThemeRef.name === oldName || nativeThemeRef.name === usable.name)) {
                Object.keys(nativeThemeRef).forEach(function (key) { delete nativeThemeRef[key]; });
                Object.assign(nativeThemeRef, schema.cloneValue(usable));
            }
            return hydrate(usable);
        }

        function evictNativeTheme(themeName, nativeThemeRef) {
            var target = schema.isPlainObject(nativeThemeRef) && nativeThemeRef.name === themeName
                ? nativeThemeRef
                : null;
            if (target) {
                try {
                    if (typeof global.baibaokuHydrateTheme === 'function') {
                        // Bind this exact object into SillyTavern's private theme array before
                        // turning it into a tombstone. Batch inventories are detached JSON objects.
                        global.baibaokuHydrateTheme(target);
                    }
                } catch (err) {
                    console.warn('[美化管理] 同步移除酒馆原生主题缓存失败:', err);
                }
                Object.keys(target).forEach(function (key) { delete target[key]; });
                nativeEvictionSequence += 1;
                target.name = '__theme_mgr_deleted__' + Date.now() + '_' + nativeEvictionSequence;
            }
            forget(themeName);
        }

        function remember(theme) {
            if (!schema.isUsableTheme(theme, theme && theme.name)) return false;
            var reconciledTheme = reconcileConfirmedSavedPatch(theme.name, theme);
            fullThemeCache[reconciledTheme.name] = schema.cloneValue(reconciledTheme);
            delete staleThemeCache[reconciledTheme.name];
            return true;
        }

        function forget(themeName) {
            delete fullThemeCache[themeName];
            delete staleThemeCache[themeName];
            delete confirmedSavedPatches[themeName];
        }

        function getCached(themeName) {
            return fullThemeCache[themeName] ? schema.cloneValue(fullThemeCache[themeName]) : null;
        }

        function captureInventory(themes) {
            (themes || []).forEach(function (theme) {
                if (!theme || !theme.name) return;
                if (staleThemeCache[theme.name]) return;
                if (!remember(theme)) forget(theme.name);
            });
            return themes || [];
        }

        function replaceInventory(themes) {
            clearFullCache();
            clearStaleCache();
            return captureInventory(themes || []);
        }

        function getInventory(options) {
            options = options || {};
            var bridge = getBridge();
            var promise = options.bypassBaibaokuCache && bridge && typeof bridge.rawFetch === 'function'
                ? api.getRawSettingsInventory(bridge.rawFetch)
                : api.getSettingsInventory();
            return promise.then(function (themes) {
                if (options.capture === false || options.bypassBaibaokuCache) return themes;
                return captureInventory(themes);
            });
        }

        function findTheme(themes, themeName) {
            var found = null;
            (themes || []).some(function (theme) {
                if (theme && theme.name === themeName) { found = theme; return true; }
                return false;
            });
            return found;
        }

        function resolveCandidate(themeName, candidate) {
            if (schema.isUsableTheme(candidate, themeName)) {
                var usableCandidate = schema.cloneValue(candidate);
                remember(usableCandidate);
                return Promise.resolve(getCached(themeName) || usableCandidate);
            }

            var bridge = getBridge();
            if (!bridge || typeof bridge.ensureThemeLoaded !== 'function') {
                return Promise.reject(makeError('incomplete', '主题不是可用主题，且无法加载懒加载内容'));
            }

            return Promise.resolve()
                .then(function () { return bridge.ensureThemeLoaded(themeName); })
                .then(function (loaded) {
                    if (!schema.isUsableTheme(loaded, themeName)) {
                        throw makeError('incomplete', '柏宝库未返回可用主题对象');
                    }
                    var usable = schema.cloneValue(loaded);
                    remember(usable);
                    return getCached(themeName) || usable;
                })
                .catch(function (err) {
                    if (err && err.code === 'incomplete') throw err;
                    console.warn('[美化管理] 柏宝库主题加载失败:', err);
                    throw makeError('incomplete', '主题尚未完整加载，不能安全操作');
                });
        }

        function normalizeCss(value) {
            return String(value == null ? '' : value).replace(/\r\n?/g, '\n');
        }

        function reconcileConfirmedSavedPatch(themeName, theme) {
            var patch = confirmedSavedPatches[themeName];
            if (!patch || !theme || !Object.prototype.hasOwnProperty.call(theme, 'custom_css')) return theme;
            if (normalizeCss(theme.custom_css) === normalizeCss(patch.custom_css)) {
                delete confirmedSavedPatches[themeName];
                return theme;
            }
            var protectedTheme = schema.cloneValue(theme);
            protectedTheme.custom_css = patch.custom_css;
            return protectedTheme;
        }

        function confirmSavedTheme(theme, requestSequence) {
            if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return false;
            var themeName = String(theme.name || '').trim();
            if (!themeName || !Object.prototype.hasOwnProperty.call(theme, 'custom_css')) return false;
            var sequence = Number(requestSequence) || 0;
            var previousPatch = confirmedSavedPatches[themeName];
            if (sequence && previousPatch && previousPatch.requestSequence > sequence) return false;

            confirmedSavedRevision += 1;
            confirmedSavedPatches[themeName] = {
                custom_css: String(theme.custom_css == null ? '' : theme.custom_css),
                revision: confirmedSavedRevision,
                requestSequence: sequence,
                confirmedAt: Date.now(),
            };

            var cached = fullThemeCache[themeName];
            if (schema.isUsableTheme(cached, themeName)) {
                var updated = schema.cloneValue(cached);
                updated.custom_css = confirmedSavedPatches[themeName].custom_css;
                fullThemeCache[themeName] = updated;
                delete staleThemeCache[themeName];
            } else {
                delete fullThemeCache[themeName];
                staleThemeCache[themeName] = {
                    reason: 'theme-manager-confirmed-native-save',
                    invalidatedAt: Date.now(),
                };
            }
            clearBridgeSettingsCache('theme-manager-confirmed-native-save');
            return true;
        }

        function getConfirmedSavedPatch(themeName) {
            var patch = confirmedSavedPatches[String(themeName || '').trim()];
            return patch ? schema.cloneValue(patch) : null;
        }

        function getFetchUrl(input) {
            if (typeof input === 'string') return input;
            if (input && typeof input.url === 'string') return input.url;
            if (input && typeof input.href === 'string') return input.href;
            return '';
        }

        function getFetchMethod(input, init) {
            return String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        }

        function readConfirmedThemeSaveRequest(input, init) {
            if (getFetchMethod(input, init) !== 'POST') return null;
            var rawUrl = getFetchUrl(input);
            if (!rawUrl) return null;
            var parsedUrl;
            try {
                var baseUrl = global.location && global.location.href ? global.location.href : 'http://theme-manager.local/';
                parsedUrl = new URL(rawUrl, baseUrl);
                if (global.location && global.location.origin && parsedUrl.origin !== global.location.origin) return null;
            } catch (e) {
                return null;
            }
            if (parsedUrl.pathname !== '/api/themes/save') return null;
            var body = init && init.body;
            if (typeof body !== 'string') return null;
            try {
                var theme = JSON.parse(body);
                if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return null;
                if (!String(theme.name || '').trim() || !Object.prototype.hasOwnProperty.call(theme, 'custom_css')) return null;
                return theme;
            } catch (e) {
                return null;
            }
        }

        function bindNativeThemeSaveTracking() {
            if (nativeThemeSaveTrackingBound) return true;
            if (typeof global.fetch !== 'function') return false;
            var previousFetch = global.fetch;
            global.fetch = function themeManagerConfirmedThemeSaveFetch(input, init) {
                var savedTheme = readConfirmedThemeSaveRequest(input, init);
                var requestSequence = savedTheme ? ++nativeThemeSaveRequestSequence : 0;
                var responsePromise = previousFetch.apply(this, arguments);
                if (!savedTheme) return responsePromise;
                return Promise.resolve(responsePromise).then(function (response) {
                    if (response && response.ok) {
                        try {
                            confirmSavedTheme(savedTheme, requestSequence);
                        } catch (err) {
                            console.warn('[美化管理] 同步原生主题保存结果失败:', err);
                        }
                    }
                    return response;
                });
            };
            nativeThemeSaveTrackingBound = true;
            return true;
        }

        function readLiveCustomCss() {
            var documentRef = global.document;
            if (!documentRef || typeof documentRef.getElementById !== 'function') return { available: false, values: [] };
            var input = documentRef.getElementById('customCSS');
            var style = documentRef.getElementById('custom-style');
            var values = [];
            if (input && 'value' in input) values.push(normalizeCss(input.value));
            if (style && 'textContent' in style) values.push(normalizeCss(style.textContent));
            return {
                available: values.length > 0,
                value: input && 'value' in input ? normalizeCss(input.value) : values[0],
                values: values,
            };
        }

        function cachedCssDiffersFromLive(themeName, cached) {
            if (!cached || !Object.prototype.hasOwnProperty.call(cached, 'custom_css')) return false;
            if (getThemeControlName() !== themeName) return false;
            var live = readLiveCustomCss();
            if (!live.available) return false;
            var cachedCss = normalizeCss(cached.custom_css);
            return live.values.some(function (value) { return value !== cachedCss; });
        }

        function preserveNewerLiveCustomCss(themeName, theme) {
            if (!theme || getThemeControlName() !== themeName) return theme;
            var live = readLiveCustomCss();
            if (!live.available || !Object.prototype.hasOwnProperty.call(theme, 'custom_css') ||
                normalizeCss(theme.custom_css) === live.value) return theme;
            var protectedTheme = schema.cloneValue(theme);
            protectedTheme.custom_css = live.value;
            return protectedTheme;
        }

        function refreshStaleTheme(themeName) {
            return getInventory({ bypassBaibaokuCache: true, capture: false }).then(function (themes) {
                return resolveCandidate(themeName, findTheme(themes, themeName));
            }).then(function (theme) {
                var protectedTheme = preserveNewerLiveCustomCss(themeName, theme);
                if (protectedTheme !== theme) {
                    // A live editor value is only a transient draft until /api/themes/save
                    // confirms it. Keep the cache stale so leaving and returning to this
                    // theme resolves the last saved definition instead of persisting a draft.
                    delete fullThemeCache[themeName];
                    staleThemeCache[themeName] = {
                        reason: 'theme-manager-live-custom-css-draft',
                        invalidatedAt: Date.now(),
                    };
                }
                return protectedTheme;
            });
        }

        function resolveUsableTheme(themeName, candidate) {
            if (arguments.length > 1) return resolveCandidate(themeName, candidate);
            var cached = getCached(themeName);
            if (cached && cachedCssDiffersFromLive(themeName, cached)) {
                invalidateTheme(themeName, 'theme-manager-live-custom-css-mismatch');
                cached = null;
            }
            if (cached) return Promise.resolve(cached);
            if (staleThemeCache[themeName]) return refreshStaleTheme(themeName);
            return getInventory().then(function (themes) {
                return resolveCandidate(themeName, findTheme(themes, themeName));
            });
        }

        function resolveUsableThemes(themeNames) {
            var names = Array.isArray(themeNames) ? themeNames.slice() : [];
            var usable = [];
            return names.reduce(function (pending, themeName) {
                return pending.then(function () {
                    return resolveUsableTheme(themeName).then(function (theme) { usable.push(theme); });
                });
            }, Promise.resolve()).then(function () { return usable; });
        }

        function prepareUsableThemeForApply(themeName) {
            return resolveUsableTheme(themeName)
                .then(function (theme) {
                    return {
                        theme: theme,
                        hydrated: hydrate(theme),
                        kind: schema.isCompleteTheme(theme, themeName) ? 'complete' : 'legacy-partial',
                    };
                })
                .catch(function (err) {
                    if (err && (err.code === 'incomplete' || err.code === 'load-failed')) throw err;
                    console.warn('[美化管理] 主题切换预加载失败:', err);
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

        function isApplyInProgress() {
            return activeApplyCount > 0;
        }

        function bindNativeEditTracking() {
            var saveTrackingBound = bindNativeThemeSaveTracking();
            if (nativeEditTrackingBound) return true;
            var documentRef = global.document;
            if (!documentRef || typeof documentRef.addEventListener !== 'function') return saveTrackingBound;
            nativeEditTrackingBound = true;
            function handleCustomCssEdit(event) {
                var target = event && event.target;
                if (!target || target.id !== 'customCSS') return;
                if (event.__themeManagerApply === true || isApplyInProgress()) return;
                var themeName = getThemeControlName();
                if (themeName) invalidateTheme(themeName, 'theme-manager-native-custom-css-edit');
            }
            documentRef.addEventListener('input', handleCustomCssEdit, true);
            documentRef.addEventListener('change', handleCustomCssEdit, true);
            return true;
        }

        function getThemeControlName() {
            var control = global.document && global.document.getElementById('themes');
            if (!control) return '';
            if (control.tagName === 'SELECT') {
                var option = control.options[control.selectedIndex];
                return option ? String(option.value || option.textContent || '').trim() : '';
            }
            return String(control.value || '').trim();
        }

        function verifyThemeState(themeName, expectedTheme) {
            return loadPowerUserModule().then(function (mod) {
                var powerUser = mod && mod.power_user;
                var mismatches = [];
                if (!powerUser) mismatches.push('power_user');
                var controlTheme = getThemeControlName();
                if (controlTheme !== themeName) mismatches.push('#themes');
                if (powerUser && powerUser.theme !== themeName) mismatches.push('theme');

                if (powerUser) {
                    schema.THEME_FIELDS.forEach(function (key) {
                        if (!Object.prototype.hasOwnProperty.call(expectedTheme, key) || expectedTheme[key] === undefined) return;
                        if (JSON.stringify(powerUser[key]) !== JSON.stringify(expectedTheme[key])) mismatches.push(key);
                    });
                }

                return {
                    ok: mismatches.length === 0,
                    mismatches: mismatches,
                    currentTheme: powerUser && powerUser.theme ? String(powerUser.theme) : controlTheme,
                    controlTheme: controlTheme,
                };
            });
        }

        function verifyThemeVisuals(expectedTheme) {
            var mismatches = [];
            var cssVariables = {
                    main_text_color: '--SmartThemeBodyColor',
                    italics_text_color: '--SmartThemeEmColor',
                    underline_text_color: '--SmartThemeUnderlineColor',
                    quote_text_color: '--SmartThemeQuoteColor',
                    blur_tint_color: '--SmartThemeBlurTintColor',
                    chat_tint_color: '--SmartThemeChatTintColor',
                    user_mes_blur_tint_color: '--SmartThemeUserMesBlurTintColor',
                    bot_mes_blur_tint_color: '--SmartThemeBotMesBlurTintColor',
                    shadow_color: '--SmartThemeShadowColor',
                    border_color: '--SmartThemeBorderColor',
            };
            Object.keys(cssVariables).forEach(function (key) {
                if (!Object.prototype.hasOwnProperty.call(expectedTheme, key)) return;
                var actual = global.document.documentElement.style.getPropertyValue(cssVariables[key]).trim();
                if (actual !== String(expectedTheme[key]).trim()) mismatches.push(key);
            });

            if (Object.prototype.hasOwnProperty.call(expectedTheme, 'custom_css')) {
                var expectedCss = String(expectedTheme.custom_css == null ? '' : expectedTheme.custom_css);
                var expectedDomCss = expectedCss.replace(/\r\n?/g, '\n');
                var input = global.document.getElementById('customCSS');
                var style = global.document.getElementById('custom-style');
                if (!input || String(input.value || '').replace(/\r\n?/g, '\n') !== expectedDomCss) mismatches.push('customCSS');
                if (!style || String(style.textContent || '').replace(/\r\n?/g, '\n') !== expectedDomCss) mismatches.push('custom-style');
                var toolkitState = global.__baiBaiToolkitExtensionInstalled;
                var editorState = toolkitState && toolkitState.__baiBaiToolkitCustomCssCodeMirrorEditor;
                if (editorState && editorState.enabled && editorState.view &&
                    String(editorState.view.state.doc).replace(/\r\n?/g, '\n') !== expectedDomCss) {
                    mismatches.push('custom-css-editor');
                }
            }

            return Promise.resolve({ ok: mismatches.length === 0, mismatches: mismatches });
        }

        function verifyAppliedTheme(themeName, expectedTheme) {
            return verifyThemeState(themeName, expectedTheme).then(function (state) {
                return verifyThemeVisuals(expectedTheme).then(function (visual) {
                    return {
                        ok: state.ok && visual.ok,
                        mismatches: state.mismatches.concat(visual.mismatches.map(function (key) { return 'visual:' + key; })),
                        state: state,
                        visual: visual,
                    };
                });
            });
        }

        function waitForThemeState(themeName, expectedTheme, requestId, timeoutMs) {
            var started = Date.now();
            var timeout = timeoutMs === undefined ? stateVerifyTimeoutMs : timeoutMs;
            return new Promise(function (resolve, reject) {
                function check() {
                    if (!isApplyCurrent(requestId)) {
                        reject(makeError('superseded', '主题切换已被更新请求取代'));
                        return;
                    }
                    verifyThemeState(themeName, expectedTheme)
                        .then(function (result) {
                            if (result.ok) { resolve(result); return; }
                            if (Date.now() - started >= timeout) {
                                console.warn('[ThemeManager] current theme state failed', {
                                    requestedTheme: themeName,
                                    currentTheme: result.currentTheme,
                                    requestId: requestId,
                                    result: false,
                                    mismatches: result.mismatches,
                                });
                                var err = makeError('state-verify-failed', '主题状态验证失败');
                                err.details = result.mismatches;
                                err.currentTheme = result.currentTheme;
                                reject(err);
                                return;
                            }
                            setTimeout(check, stateVerifyIntervalMs);
                        })
                        .catch(function (err) {
                            if (Date.now() - started >= timeout) { reject(err); return; }
                            setTimeout(check, stateVerifyIntervalMs);
                        });
                }
                setTimeout(check, 0);
            });
        }

        function waitForVisualFrame() {
            return new Promise(function (resolve) {
                var settled = false;
                var fallbackTimer = setTimeout(finish, 100);
                function finish() {
                    if (settled) return;
                    settled = true;
                    clearTimeout(fallbackTimer);
                    resolve();
                }
                if (typeof global.requestAnimationFrame === 'function') global.requestAnimationFrame(finish);
                else setTimeout(finish, 0);
            });
        }

        function waitForVisualSettle() {
            return waitForVisualFrame().then(waitForVisualFrame);
        }

        function waitForThemeVisuals(themeName, expectedTheme, requestId) {
            var attempt = 0;
            console.info('[ThemeManager] visual verification pending', {
                requestedTheme: themeName,
                maxAttempts: visualMaxAttempts,
            });

            function check() {
                if (!isApplyCurrent(requestId)) return Promise.reject(makeError('superseded', '主题切换已被更新请求取代'));
                attempt += 1;
                var verification;
                try {
                    verification = verifyThemeVisuals(expectedTheme);
                } catch (err) {
                    verification = Promise.reject(err);
                }
                return Promise.resolve(verification).catch(function (err) {
                    return {
                        ok: false,
                        mismatches: ['verification-error'],
                        error: err && err.message ? err.message : String(err),
                    };
                }).then(function (result) {
                    result.attempt = attempt;
                    if (result.ok) {
                        console.info('[ThemeManager] visual verification passed', {
                            requestedTheme: themeName,
                            attempt: attempt,
                            result: true,
                        });
                        return result;
                    }
                    if (attempt >= visualMaxAttempts) {
                        console.warn('[ThemeManager] visual verification failed', {
                            requestedTheme: themeName,
                            attempt: attempt,
                            result: false,
                            mismatches: result.mismatches,
                        });
                        return result;
                    }
                    console.info('[ThemeManager] visual verification retry', {
                        requestedTheme: themeName,
                        attempt: attempt,
                        nextAttempt: attempt + 1,
                        mismatches: result.mismatches,
                    });
                    return new Promise(function (resolve) {
                        setTimeout(resolve, visualRetryDelayMs * attempt);
                    }).then(waitForVisualFrame).then(check);
                });
            }

            return waitForVisualSettle().then(check);
        }

        // Backward-compatible combined waiter for callers outside the main apply flow.
        function waitForThemeApplied(themeName, expectedTheme, requestId, timeoutMs) {
            return waitForThemeState(themeName, expectedTheme, requestId, timeoutMs).then(function (state) {
                return waitForThemeVisuals(themeName, expectedTheme, requestId).then(function (visual) {
                    if (!visual.ok) {
                        var err = makeError('verify-failed', '主题视觉验证失败');
                        err.details = visual.mismatches;
                        throw err;
                    }
                    return { ok: true, state: state, visual: visual, mismatches: [] };
                });
            });
        }

        function captureCurrentThemeSnapshot() {
            return loadPowerUserModule().then(function (mod) {
                var powerUser = mod && mod.power_user;
                var name = powerUser && powerUser.theme ? String(powerUser.theme) : getThemeControlName();
                if (!name) return null;
                var snapshot = schema.snapshotThemeBaseline(powerUser);
                snapshot.name = name;
                return schema.isUsableTheme(snapshot, name) ? snapshot : null;
            }).catch(function () { return null; });
        }

        function captureConfirmedCurrentThemeIdentity() {
            return loadPowerUserModule().then(function (mod) {
                var powerUser = mod && mod.power_user;
                var powerUserTheme = powerUser && typeof powerUser.theme === 'string'
                    ? powerUser.theme.trim()
                    : '';
                var controlTheme = getThemeControlName();
                if (!powerUserTheme || !controlTheme || powerUserTheme !== controlTheme) {
                    return {
                        status: 'unknown',
                        powerUserTheme: powerUserTheme,
                        controlTheme: controlTheme,
                    };
                }
                return {
                    status: 'known',
                    name: powerUserTheme,
                    powerUserTheme: powerUserTheme,
                    controlTheme: controlTheme,
                };
            }).catch(function () {
                return { status: 'unknown', powerUserTheme: '', controlTheme: getThemeControlName() };
            });
        }

        function applyThemeAndWait(themeName, applyFn, fallbackFn, rollbackFn) {
            var requestId = beginApply();
            var previousTheme = null;
            activeApplyCount += 1;
            console.info('[ThemeManager] apply requested', {
                requestedTheme: themeName,
                requestId: requestId,
            });

            function applyAndConfirm(prepared, fn, path) {
                return Promise.resolve(fn(prepared, requestId, function () {
                    return isApplyCurrent(requestId);
                })).then(function (applyResult) {
                    if (!isApplyCurrent(requestId)) throw makeError('superseded', '主题切换已被更新请求取代');
                    console.info('[ThemeManager] ST theme apply completed', {
                        requestedTheme: themeName,
                        requestId: requestId,
                        path: path,
                    });
                    return waitForThemeState(themeName, prepared.theme, requestId).then(function (stateVerification) {
                        console.info('[ThemeManager] current theme state confirmed', {
                            requestedTheme: themeName,
                            currentTheme: stateVerification.currentTheme,
                            requestId: requestId,
                            result: true,
                            path: path,
                        });
                        return {
                            requestId: requestId,
                            theme: prepared.theme,
                            stateVerification: stateVerification,
                            applyResult: applyResult,
                            fallbackUsed: path === 'fallback',
                        };
                    });
                });
            }

            var workflow = captureCurrentThemeSnapshot().then(function (snapshot) {
                previousTheme = snapshot;
                return prepareUsableThemeForApply(themeName);
            }).then(function (prepared) {
                if (!isApplyCurrent(requestId)) throw makeError('superseded', '主题切换已被更新请求取代');
                return applyAndConfirm(prepared, applyFn, 'native').catch(function (firstError) {
                    if (!isApplyCurrent(requestId) || firstError.code === 'superseded') throw firstError;
                    if (typeof fallbackFn !== 'function') throw firstError;
                    return applyAndConfirm(prepared, fallbackFn, 'fallback').then(function (result) {
                        result.nativeError = firstError;
                        return result;
                    });
                }).then(function (result) {
                    return waitForThemeVisuals(themeName, prepared.theme, requestId).then(function (visualVerification) {
                        result.visualVerification = visualVerification;
                        result.verification = {
                            ok: result.stateVerification.ok && visualVerification.ok,
                            state: result.stateVerification,
                            visual: visualVerification,
                        };
                        return result;
                    });
                });
            });
            var completedWorkflow = workflow.catch(function (originalError) {
                if (!isApplyCurrent(requestId) || originalError.code === 'superseded' ||
                    typeof rollbackFn !== 'function' || !previousTheme || previousTheme.name === themeName) {
                    throw originalError;
                }
                var rollbackPrepared = { theme: previousTheme, hydrated: hydrate(previousTheme), kind: 'rollback-snapshot' };
                return Promise.resolve(rollbackFn(rollbackPrepared, requestId, function () {
                    return isApplyCurrent(requestId);
                })).then(function () {
                    return waitForThemeState(previousTheme.name, previousTheme, requestId);
                }).then(function () {
                    originalError.rollbackRestored = true;
                    throw originalError;
                }, function (rollbackError) {
                    originalError.rollbackError = rollbackError;
                    throw originalError;
                });
            });
            return completedWorkflow.then(function (result) {
                activeApplyCount = Math.max(0, activeApplyCount - 1);
                return result;
            }, function (err) {
                activeApplyCount = Math.max(0, activeApplyCount - 1);
                throw err;
            });
        }

        return {
            getBridge: getBridge,
            invalidate: invalidate,
            invalidateTheme: invalidateTheme,
            confirmSavedTheme: confirmSavedTheme,
            getConfirmedSavedPatch: getConfirmedSavedPatch,
            hydrate: hydrate,
            replaceNativeTheme: replaceNativeTheme,
            evictNativeTheme: evictNativeTheme,
            remember: remember,
            forget: forget,
            clearFullCache: clearFullCache,
            getCached: getCached,
            replaceInventory: replaceInventory,
            getInventory: getInventory,
            findTheme: findTheme,
            resolveUsableTheme: resolveUsableTheme,
            resolveUsableThemes: resolveUsableThemes,
            prepareUsableThemeForApply: prepareUsableThemeForApply,
            beginApply: beginApply,
            isApplyCurrent: isApplyCurrent,
            isApplyInProgress: isApplyInProgress,
            bindNativeEditTracking: bindNativeEditTracking,
            bindNativeThemeSaveTracking: bindNativeThemeSaveTracking,
            verifyThemeState: verifyThemeState,
            verifyThemeVisuals: verifyThemeVisuals,
            verifyAppliedTheme: verifyAppliedTheme,
            waitForThemeState: waitForThemeState,
            waitForThemeVisuals: waitForThemeVisuals,
            waitForThemeApplied: waitForThemeApplied,
            captureCurrentThemeSnapshot: captureCurrentThemeSnapshot,
            captureConfirmedCurrentThemeIdentity: captureConfirmedCurrentThemeIdentity,
            applyThemeAndWait: applyThemeAndWait,
            makeError: makeError,
        };
    };
})(window);
