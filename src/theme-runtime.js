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

        function clearFullCache() {
            Object.keys(fullThemeCache).forEach(function (name) { delete fullThemeCache[name]; });
        }

        function invalidate(reason) {
            clearFullCache();
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
            if (schema.isPlainObject(nativeThemeRef) && nativeThemeRef.name === themeName) {
                Object.keys(nativeThemeRef).forEach(function (key) { delete nativeThemeRef[key]; });
                nativeThemeRef.name = '__theme_mgr_deleted__' + Date.now();
            }
            forget(themeName);
        }

        function remember(theme) {
            if (!schema.isUsableTheme(theme, theme && theme.name)) return false;
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
            return promise.then(function (themes) {
                if (options.capture === false || options.bypassBaibaokuCache) return themes || [];
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
                return Promise.resolve(usableCandidate);
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
                    return usable;
                })
                .catch(function (err) {
                    if (err && err.code === 'incomplete') throw err;
                    console.warn('[美化管理] 柏宝库主题加载失败:', err);
                    throw makeError('incomplete', '主题尚未完整加载，不能安全操作');
                });
        }

        function resolveUsableTheme(themeName, candidate) {
            if (arguments.length > 1) return resolveCandidate(themeName, candidate);
            var cached = getCached(themeName);
            if (cached) return Promise.resolve(cached);
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

        function getThemeControlName() {
            var control = global.document && global.document.getElementById('themes');
            if (!control) return '';
            if (control.tagName === 'SELECT') {
                var option = control.options[control.selectedIndex];
                return option ? String(option.value || option.textContent || '').trim() : '';
            }
            return String(control.value || '').trim();
        }

        function verifyAppliedTheme(themeName, expectedTheme) {
            return import('/scripts/power-user.js').then(function (mod) {
                var powerUser = mod && mod.power_user;
                var mismatches = [];
                if (!powerUser) mismatches.push('power_user');
                if (getThemeControlName() !== themeName) mismatches.push('#themes');
                if (powerUser && powerUser.theme !== themeName) mismatches.push('theme');

                if (powerUser) {
                    schema.THEME_FIELDS.forEach(function (key) {
                        if (!Object.prototype.hasOwnProperty.call(expectedTheme, key) || expectedTheme[key] === undefined) return;
                        if (JSON.stringify(powerUser[key]) !== JSON.stringify(expectedTheme[key])) mismatches.push(key);
                    });
                }

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
                    if (actual !== String(expectedTheme[key]).trim()) mismatches.push('visual:' + key);
                });

                if (Object.prototype.hasOwnProperty.call(expectedTheme, 'custom_css')) {
                    var expectedCss = String(expectedTheme.custom_css == null ? '' : expectedTheme.custom_css);
                    var expectedDomCss = expectedCss.replace(/\r\n?/g, '\n');
                    var input = global.document.getElementById('customCSS');
                    var style = global.document.getElementById('custom-style');
                    if (!input || String(input.value || '').replace(/\r\n?/g, '\n') !== expectedDomCss) mismatches.push('visual:customCSS');
                    if (!style || String(style.textContent || '').replace(/\r\n?/g, '\n') !== expectedDomCss) mismatches.push('visual:custom-style');
                    var toolkitState = global.__baiBaiToolkitExtensionInstalled;
                    var editorState = toolkitState && toolkitState.__baiBaiToolkitCustomCssCodeMirrorEditor;
                    if (editorState && editorState.enabled && editorState.view &&
                        String(editorState.view.state.doc).replace(/\r\n?/g, '\n') !== expectedDomCss) {
                        mismatches.push('visual:custom-css-editor');
                    }
                }

                return { ok: mismatches.length === 0, mismatches: mismatches };
            });
        }

        function waitForThemeApplied(themeName, expectedTheme, requestId, timeoutMs) {
            var started = Date.now();
            var timeout = timeoutMs || 1600;
            return new Promise(function (resolve, reject) {
                function check() {
                    if (!isApplyCurrent(requestId)) {
                        reject(makeError('superseded', '主题切换已被更新请求取代'));
                        return;
                    }
                    verifyAppliedTheme(themeName, expectedTheme)
                        .then(function (result) {
                            if (result.ok) { resolve(result); return; }
                            if (Date.now() - started >= timeout) {
                                var err = makeError('verify-failed', '主题视觉与状态验证失败');
                                err.details = result.mismatches;
                                reject(err);
                                return;
                            }
                            setTimeout(check, 25);
                        })
                        .catch(function (err) {
                            if (Date.now() - started >= timeout) { reject(err); return; }
                            setTimeout(check, 25);
                        });
                }
                setTimeout(check, 0);
            });
        }

        function captureCurrentThemeSnapshot() {
            return import('/scripts/power-user.js').then(function (mod) {
                var powerUser = mod && mod.power_user;
                var name = powerUser && powerUser.theme ? String(powerUser.theme) : getThemeControlName();
                if (!name) return null;
                var snapshot = schema.snapshotThemeBaseline(powerUser);
                snapshot.name = name;
                return schema.isUsableTheme(snapshot, name) ? snapshot : null;
            }).catch(function () { return null; });
        }

        function applyThemeAndWait(themeName, applyFn, fallbackFn, rollbackFn) {
            var requestId = beginApply();
            var previousTheme = null;
            var workflow = captureCurrentThemeSnapshot().then(function (snapshot) {
                previousTheme = snapshot;
                return prepareUsableThemeForApply(themeName);
            }).then(function (prepared) {
                if (!isApplyCurrent(requestId)) throw makeError('superseded', '主题切换已被更新请求取代');
                return Promise.resolve(applyFn(prepared, requestId, function () {
                    return isApplyCurrent(requestId);
                })).then(function (applyResult) {
                    if (!isApplyCurrent(requestId)) throw makeError('superseded', '主题切换已被更新请求取代');
                    return waitForThemeApplied(themeName, prepared.theme, requestId)
                        .then(function (verification) {
                            return { requestId: requestId, theme: prepared.theme, verification: verification, applyResult: applyResult, fallbackUsed: false };
                        });
                }).catch(function (firstError) {
                    if (!isApplyCurrent(requestId) || firstError.code === 'superseded') throw firstError;
                    if (typeof fallbackFn !== 'function') throw firstError;
                    return Promise.resolve(fallbackFn(prepared, requestId, function () {
                        return isApplyCurrent(requestId);
                    })).then(function () {
                        return waitForThemeApplied(themeName, prepared.theme, requestId).then(function (verification) {
                            return { requestId: requestId, theme: prepared.theme, verification: verification, fallbackUsed: true, nativeError: firstError };
                        });
                    });
                });
            });
            return workflow.catch(function (originalError) {
                if (!isApplyCurrent(requestId) || originalError.code === 'superseded' ||
                    typeof rollbackFn !== 'function' || !previousTheme || previousTheme.name === themeName) {
                    throw originalError;
                }
                var rollbackPrepared = { theme: previousTheme, hydrated: hydrate(previousTheme), kind: 'rollback-snapshot' };
                return Promise.resolve(rollbackFn(rollbackPrepared, requestId, function () {
                    return isApplyCurrent(requestId);
                })).then(function () {
                    return waitForThemeApplied(previousTheme.name, previousTheme, requestId);
                }).then(function () {
                    originalError.rollbackRestored = true;
                    throw originalError;
                }, function (rollbackError) {
                    originalError.rollbackError = rollbackError;
                    throw originalError;
                });
            });
        }

        return {
            getBridge: getBridge,
            invalidate: invalidate,
            hydrate: hydrate,
            replaceNativeTheme: replaceNativeTheme,
            evictNativeTheme: evictNativeTheme,
            remember: remember,
            forget: forget,
            clearFullCache: clearFullCache,
            getCached: getCached,
            getInventory: getInventory,
            findTheme: findTheme,
            resolveUsableTheme: resolveUsableTheme,
            resolveUsableThemes: resolveUsableThemes,
            ensureCompleteTheme: resolveUsableTheme,
            ensureCompleteThemes: resolveUsableThemes,
            prepareUsableThemeForApply: prepareUsableThemeForApply,
            prepareCompleteThemeForApply: prepareUsableThemeForApply,
            beginApply: beginApply,
            isApplyCurrent: isApplyCurrent,
            verifyAppliedTheme: verifyAppliedTheme,
            waitForThemeApplied: waitForThemeApplied,
            captureCurrentThemeSnapshot: captureCurrentThemeSnapshot,
            applyThemeAndWait: applyThemeAndWait,
            makeError: makeError,
        };
    };
})(window);
