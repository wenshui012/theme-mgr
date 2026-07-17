(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createThemeTransactions = function (opts) {
        opts = opts || {};
        var schema = opts.schema || ns.themeSchema;
        var api = opts.api;
        var runtime = opts.runtime;

        function error(code, message, details) {
            var err = new Error(message || code);
            err.code = code;
            if (details !== undefined) err.details = details;
            return err;
        }

        function freshInventory(reason) {
            runtime.invalidate(reason);
            return runtime.getInventory({ bypassBaibaokuCache: true });
        }

        function verifySavedTheme(expectedTheme, reason) {
            return freshInventory(reason || 'theme-manager-verify-save').then(function (themes) {
                var candidate = runtime.findTheme(themes, expectedTheme.name);
                if (!candidate) throw error('verify-failed', '保存后未找到主题：' + expectedTheme.name);
                return runtime.resolveUsableTheme(expectedTheme.name, candidate).then(function (usable) {
                    if (!schema.sameConfig(expectedTheme, usable)) {
                        throw error('verify-failed', '主题内容验证失败：' + expectedTheme.name);
                    }
                    runtime.remember(usable);
                    return { theme: usable, themes: themes };
                });
            }).catch(function (err) {
                if (err && err.code === 'verify-failed') throw err;
                throw error('verify-failed', err && err.message ? err.message : '主题保存验证失败');
            });
        }

        function verifyThemeAbsent(themeName, reason) {
            return freshInventory(reason || 'theme-manager-verify-delete').then(function (themes) {
                if (runtime.findTheme(themes, themeName)) {
                    throw error('delete-verify-failed', '删除后主题仍然存在：' + themeName);
                }
                runtime.forget(themeName);
                return themes;
            });
        }

        function rollbackSavedTheme(themeName, previousTheme, headers) {
            if (previousTheme) {
                return api.saveTheme(previousTheme, headers)
                    .then(function () { return verifySavedTheme(previousTheme, 'theme-manager-rollback-restore'); });
            }
            var requestError = null;
            return api.deleteTheme(themeName, headers)
                .catch(function (err) { requestError = err; })
                .then(function () { return verifyThemeAbsent(themeName, 'theme-manager-rollback-delete'); })
                .catch(function (err) { throw requestError || err; });
        }

        function saveVerifiedTheme(theme, options) {
            options = options || {};
            if (!schema.isUsableTheme(theme, theme && theme.name)) {
                return Promise.reject(error('incomplete', '拒绝保存不可用主题对象'));
            }
            if (schema.hasLazyMarker(theme)) {
                return Promise.reject(error('lazy-placeholder', '拒绝保存柏宝库懒加载占位主题'));
            }

            var expected = schema.cloneValue(theme);
            var previousTheme = null;
            var headers = null;
            var saveAttempted = false;

            return freshInventory(options.readReason || 'theme-manager-save-read')
                .then(function (themes) {
                    var targetFilename = schema.sanitizeFilename(expected.name).toLowerCase();
                    if (!targetFilename) throw error('invalid-filename', '主题名称无法生成有效文件名');
                    var filenameConflict = (themes || []).some(function (item) {
                        return item && item.name && item.name !== expected.name &&
                            schema.sanitizeFilename(item.name).toLowerCase() === targetFilename;
                    });
                    if (filenameConflict) {
                        throw error('filename-conflict', '主题名称经文件名清理后与已有主题冲突');
                    }
                    var previousCandidate = runtime.findTheme(themes, expected.name);
                    if (!previousCandidate) return null;
                    return runtime.resolveUsableTheme(expected.name, previousCandidate);
                })
                .then(function (previous) {
                    previousTheme = previous ? schema.cloneValue(previous) : null;
                    return api.getPostHeaders();
                })
                .then(function (postHeaders) {
                    headers = postHeaders;
                    saveAttempted = true;
                    return api.saveTheme(expected, headers);
                })
                .then(function () {
                    runtime.invalidate(options.saveReason || 'theme-manager-save-written');
                    return verifySavedTheme(expected, options.verifyReason || 'theme-manager-save-verify');
                })
                .then(function (verified) {
                    return {
                        theme: verified.theme,
                        themes: verified.themes,
                        previousTheme: previousTheme,
                        overwritten: Boolean(previousTheme),
                    };
                })
                .catch(function (originalError) {
                    if (!saveAttempted || !headers) throw originalError;
                    return rollbackSavedTheme(expected.name, previousTheme, headers)
                        .then(function () { throw originalError; }, function (rollbackError) {
                            throw error('rollback-failed', originalError.message + '；恢复旧主题失败：' + rollbackError.message, {
                                cause: originalError,
                                rollback: rollbackError,
                            });
                        });
                });
        }

        function deleteThemeVerified(themeName, options) {
            options = options || {};
            var headers = null;
            var requestError = null;
            var nativeThemeRef = null;
            var bridge = runtime.getBridge();
            var preload = bridge && typeof bridge.ensureThemeLoaded === 'function'
                ? Promise.resolve().then(function () { return bridge.ensureThemeLoaded(themeName); }).catch(function () { return null; })
                : Promise.resolve(null);
            return preload
                .then(function (loaded) {
                    if (schema.isPlainObject(loaded) && loaded.name === themeName) nativeThemeRef = loaded;
                    return api.getPostHeaders();
                })
                .then(function (postHeaders) {
                    headers = postHeaders;
                    return api.deleteTheme(themeName, headers).catch(function (err) { requestError = err; });
                })
                .then(function () {
                    runtime.invalidate(options.deleteReason || 'theme-manager-delete-written');
                    return verifyThemeAbsent(themeName, options.verifyReason || 'theme-manager-delete-verify');
                })
                .then(function (themes) {
                    return { name: themeName, themes: themes, requestError: requestError, nativeThemeRef: nativeThemeRef };
                })
                .catch(function (verifyError) {
                    throw error('delete-failed', requestError ? requestError.message : verifyError.message, {
                        request: requestError,
                        verification: verifyError,
                    });
                });
        }

        function getRenameConflict(oldName, newName, themes, extraNames) {
            var targetFilename = schema.sanitizeFilename(newName);
            if (!targetFilename) return 'invalid-filename';
            var seen = {};
            var names = [];
            (themes || []).forEach(function (theme) {
                if (theme && theme.name && !seen[theme.name]) {
                    seen[theme.name] = true;
                    names.push(theme.name);
                }
            });
            (extraNames || []).forEach(function (name) {
                if (name && !seen[name]) { seen[name] = true; names.push(name); }
            });

            var targetKey = targetFilename.toLowerCase();
            for (var i = 0; i < names.length; i++) {
                var existingName = names[i];
                if (existingName === newName && existingName !== oldName) return 'duplicate';
                var existingKey = schema.sanitizeFilename(existingName).toLowerCase();
                if (existingKey && existingKey === targetKey) return 'filename-conflict';
            }
            return '';
        }

        function renameTheme(oldName, newName, options) {
            options = options || {};
            newName = String(newName || '').trim();
            if (!newName) return Promise.reject(error('empty', '主题名称不能为空'));
            if (newName === oldName) return Promise.reject(error('same', '主题名称没有变化'));

            var nativeThemeRef = null;
            var sourceTheme = null;
            var verifiedTheme = null;
            var bridge = runtime.getBridge();
            var preload = bridge && typeof bridge.ensureThemeLoaded === 'function'
                ? Promise.resolve().then(function () { return bridge.ensureThemeLoaded(oldName); }).catch(function (err) {
                    console.warn('[美化管理] 柏宝库原生主题缓存预加载失败:', err);
                    return null;
                })
                : Promise.resolve(null);

            return preload
                .then(function (loaded) {
                    if (schema.isUsableTheme(loaded, oldName)) nativeThemeRef = loaded;
                    return freshInventory('theme-manager-rename-read');
                })
                .then(function (themes) {
                    var conflict = getRenameConflict(oldName, newName, themes, options.extraNames);
                    if (conflict) throw error(conflict, conflict);
                    var candidate = runtime.findTheme(themes, oldName);
                    if (!schema.isUsableTheme(candidate, oldName) && nativeThemeRef) candidate = nativeThemeRef;
                    return runtime.resolveUsableTheme(oldName, candidate).then(function (usable) {
                        sourceTheme = usable;
                    });
                })
                .then(function () {
                    var renamed = schema.cloneValue(sourceTheme);
                    renamed.name = newName;
                    schema.removeLazyMarker(renamed);
                    if (!schema.isUsableTheme(renamed, newName)) {
                        throw error('incomplete', '主题尚未完整加载，不能安全改名');
                    }
                    return saveVerifiedTheme(renamed, {
                        readReason: 'theme-manager-rename-save-read',
                        saveReason: 'theme-manager-rename-save',
                        verifyReason: 'theme-manager-rename-verify',
                    });
                })
                .then(function (saved) {
                    verifiedTheme = saved.theme;
                    return deleteThemeVerified(oldName, {
                        deleteReason: 'theme-manager-rename-delete-old',
                        verifyReason: 'theme-manager-rename-delete-verify',
                    });
                })
                .then(function (deleted) {
                    runtime.forget(oldName);
                    runtime.remember(verifiedTheme);
                    return {
                        oldName: oldName,
                        newName: newName,
                        theme: verifiedTheme,
                        themes: deleted.themes,
                        nativeThemeRef: nativeThemeRef,
                    };
                });
        }

        return {
            freshInventory: freshInventory,
            verifySavedTheme: verifySavedTheme,
            verifyThemeAbsent: verifyThemeAbsent,
            saveVerifiedTheme: saveVerifiedTheme,
            deleteThemeVerified: deleteThemeVerified,
            getRenameConflict: getRenameConflict,
            renameTheme: renameTheme,
            error: error,
        };
    };
})(window);
