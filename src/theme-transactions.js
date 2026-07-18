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
            if (options.deferVerification && !options.transactionContext) {
                return Promise.reject(error('unsafe-options', '仅事务上下文允许延迟主题保存验证'));
            }

            var expected = schema.cloneValue(theme);
            var previousTheme = null;
            var headers = null;
            var saveAttempted = false;
            var inventory = null;
            var hasKnownPrevious = Object.prototype.hasOwnProperty.call(options, 'knownPreviousTheme');
            var inventoryPromise = Array.isArray(options.knownInventory)
                ? Promise.resolve(options.knownInventory)
                : freshInventory(options.readReason || 'theme-manager-save-read');

            return inventoryPromise
                .then(function (themes) {
                    inventory = themes || [];
                    var targetFilename = schema.sanitizeFilename(expected.name).toLowerCase();
                    if (!targetFilename) throw error('invalid-filename', '主题名称无法生成有效文件名');
                    var filenameConflict = inventory.some(function (item) {
                        return item && item.name && item.name !== expected.name &&
                            schema.sanitizeFilename(item.name).toLowerCase() === targetFilename;
                    });
                    if (filenameConflict) {
                        throw error('filename-conflict', '主题名称经文件名清理后与已有主题冲突');
                    }
                    if (hasKnownPrevious) {
                        return options.knownPreviousTheme
                            ? schema.cloneValue(options.knownPreviousTheme)
                            : null;
                    }
                    var previousCandidate = runtime.findTheme(inventory, expected.name);
                    if (!previousCandidate) return null;
                    return runtime.resolveUsableTheme(expected.name, previousCandidate);
                })
                .then(function (previous) {
                    previousTheme = previous ? schema.cloneValue(previous) : null;
                    return options.headers ? options.headers : api.getPostHeaders();
                })
                .then(function (postHeaders) {
                    headers = postHeaders;
                    saveAttempted = true;
                    if (options.transactionContext) {
                        options.transactionContext.postHeaders = headers;
                        options.transactionContext.saveAttempted = true;
                    }
                    return api.saveTheme(expected, headers);
                })
                .then(function () {
                    if (options.transactionContext) options.transactionContext.saveSucceeded = true;
                    runtime.invalidate(options.saveReason || 'theme-manager-save-written');
                    if (options.deferVerification) {
                        return {
                            theme: schema.cloneValue(expected),
                            themes: inventory,
                            previousTheme: previousTheme,
                            overwritten: Boolean(previousTheme),
                            verificationDeferred: true,
                        };
                    }
                    return verifySavedTheme(expected, options.verifyReason || 'theme-manager-save-verify');
                })
                .then(function (verified) {
                    if (options.deferVerification) return verified;
                    return {
                        theme: verified.theme,
                        themes: verified.themes,
                        previousTheme: previousTheme,
                        overwritten: Boolean(previousTheme),
                    };
                })
                .catch(function (originalError) {
                    if (options.deferVerification) throw originalError;
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

        function collectThemeNames(themes, extraNames) {
            var seen = {};
            var names = [];
            (themes || []).forEach(function (theme) {
                var name = theme && theme.name;
                if (!name || seen[name]) return;
                seen[name] = true;
                names.push(name);
            });
            (extraNames || []).forEach(function (name) {
                name = String(name || '').trim();
                if (!name || seen[name]) return;
                seen[name] = true;
                names.push(name);
            });
            return names;
        }

        function namesAsInventory(names) {
            return (names || []).map(function (name) { return { name: name }; });
        }

        function describeRenameState(context, themes) {
            var oldTheme = runtime.findTheme(themes, context.oldName);
            var newTheme = runtime.findTheme(themes, context.newName);
            return {
                inventoryAvailable: true,
                oldPresent: Boolean(oldTheme),
                oldMatchesExpected: Boolean(oldTheme && schema.sameConfig(context.sourceTheme, oldTheme)),
                newPresent: Boolean(newTheme),
                newMatchesExpected: Boolean(newTheme && schema.sameConfig(context.expectedRenamedTheme, newTheme)),
            };
        }

        function verifyFinalRename(context, themes) {
            var state = describeRenameState(context, themes);
            var candidate = runtime.findTheme(themes, context.newName);
            if (!candidate || !schema.isUsableTheme(candidate, context.newName)) {
                throw error('verify-failed', '最终验证未找到可用的新主题：' + context.newName, { state: state });
            }
            if (!schema.sameConfig(context.expectedRenamedTheme, candidate)) {
                throw error('verify-failed', '最终验证发现新主题内容不一致：' + context.newName, { state: state });
            }
            if (runtime.findTheme(themes, context.oldName)) {
                throw error('delete-failed', '最终验证发现旧主题仍然存在：' + context.oldName, { state: state });
            }
            return {
                theme: schema.cloneValue(candidate),
                themes: themes || [],
                state: state,
            };
        }

        function makeRollbackFailure(originalError, rollbackError, currentState) {
            var message = originalError && originalError.message ? originalError.message : '改名失败';
            var rollbackMessage = rollbackError && rollbackError.message ? rollbackError.message : '未知回滚错误';
            return error('rollback-failed', message + '；回滚失败：' + rollbackMessage, {
                cause: originalError,
                rollback: rollbackError,
                currentState: currentState || { inventoryAvailable: false },
            });
        }

        function readRenameState(context, reason, fallbackError) {
            return freshInventory(reason).then(function (themes) {
                return describeRenameState(context, themes);
            }, function (inventoryError) {
                return {
                    inventoryAvailable: false,
                    inventoryError: inventoryError && inventoryError.message ? inventoryError.message : String(inventoryError || ''),
                    precedingError: fallbackError && fallbackError.message ? fallbackError.message : '',
                };
            });
        }

        function rejectRollbackFailure(context, originalError, rollbackError, currentState) {
            if (currentState) return Promise.reject(makeRollbackFailure(originalError, rollbackError, currentState));
            return readRenameState(context, 'theme-manager-rename-rollback-state', rollbackError)
                .then(function (state) {
                    throw makeRollbackFailure(originalError, rollbackError, state);
                });
        }

        function rollbackRename(context, originalError) {
            var headers = context.postHeaders;
            var restoredState = null;
            if (!headers || !schema.isUsableTheme(context.sourceTheme, context.oldName)) {
                return rejectRollbackFailure(
                    context,
                    originalError,
                    error('rollback-unavailable', '缺少回滚所需的 headers 或完整旧主题'),
                );
            }

            return api.saveTheme(context.sourceTheme, headers)
                .catch(function (restoreError) {
                    return rejectRollbackFailure(context, originalError, restoreError);
                })
                .then(function () {
                    return freshInventory('theme-manager-rename-rollback-restore-verify')
                        .catch(function (inventoryError) {
                            return rejectRollbackFailure(context, originalError, inventoryError);
                        });
                })
                .then(function (themes) {
                    restoredState = describeRenameState(context, themes);
                    if (!restoredState.oldPresent || !restoredState.oldMatchesExpected) {
                        return rejectRollbackFailure(
                            context,
                            originalError,
                            error('rollback-restore-verify-failed', '旧主题恢复验证失败'),
                            restoredState,
                        );
                    }
                    return api.deleteTheme(context.newName, headers)
                        .catch(function (cleanupError) {
                            return rejectRollbackFailure(context, originalError, cleanupError);
                        });
                })
                .then(function () {
                    return freshInventory('theme-manager-rename-rollback-cleanup-verify')
                        .catch(function (inventoryError) {
                            return rejectRollbackFailure(context, originalError, inventoryError);
                        });
                })
                .then(function (themes) {
                    var finalState = describeRenameState(context, themes);
                    if (!finalState.oldPresent || !finalState.oldMatchesExpected || finalState.newPresent) {
                        return rejectRollbackFailure(
                            context,
                            originalError,
                            error('rollback-cleanup-verify-failed', '回滚后的主题状态验证失败'),
                            finalState,
                        );
                    }
                    runtime.forget(context.newName);
                    runtime.remember(context.sourceTheme);
                    return finalState;
                });
        }

        function getRenameConflict(oldName, newName, themes, extraNames) {
            var targetFilename = schema.sanitizeFilename(newName);
            if (!targetFilename) return 'invalid-filename';
            var names = collectThemeNames(themes, extraNames);

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
            var bridge = runtime.getBridge();
            var providedNames = collectThemeNames([], options.extraNames);
            var hasReliableNames = Boolean(
                options.extraNamesComplete === true &&
                providedNames.indexOf(oldName) !== -1
            );
            var cachedSource = typeof runtime.getCached === 'function'
                ? runtime.getCached(oldName)
                : null;
            var context = {
                oldName: oldName,
                newName: newName,
                sourceTheme: null,
                originalInventory: null,
                existingNames: [],
                previousDestinationTheme: null,
                postHeaders: null,
                expectedRenamedTheme: null,
                saveAttempted: false,
                saveSucceeded: false,
                deleteAttempted: false,
                deleteSucceeded: false,
            };
            var preload;
            if (schema.isUsableTheme(cachedSource, oldName)) {
                preload = Promise.resolve({ theme: cachedSource, nativeRef: null });
            } else if (bridge && typeof bridge.ensureThemeLoaded === 'function') {
                preload = Promise.resolve()
                    .then(function () { return bridge.ensureThemeLoaded(oldName); })
                    .then(function (loaded) { return { theme: loaded, nativeRef: loaded }; })
                    .catch(function (err) {
                        console.warn('[美化管理] 柏宝库原生主题缓存预加载失败:', err);
                        return { theme: null, nativeRef: null };
                    });
            } else {
                preload = Promise.resolve({ theme: null, nativeRef: null });
            }

            return preload
                .then(function (preloaded) {
                    var loaded = preloaded && preloaded.theme;
                    if (schema.isUsableTheme(loaded, oldName)) {
                        nativeThemeRef = preloaded.nativeRef;
                        context.sourceTheme = schema.cloneValue(loaded);
                    }

                    if (context.sourceTheme && hasReliableNames) {
                        context.existingNames = providedNames.slice();
                        var nameConflict = getRenameConflict(oldName, newName, [], context.existingNames);
                        if (nameConflict) throw error(nameConflict, nameConflict);
                        return null;
                    }

                    return freshInventory('theme-manager-rename-read').then(function (themes) {
                        context.originalInventory = themes || [];
                        context.existingNames = collectThemeNames(context.originalInventory, options.extraNames);
                        var conflict = getRenameConflict(oldName, newName, context.originalInventory, options.extraNames);
                        if (conflict) throw error(conflict, conflict);
                        var previousDestination = runtime.findTheme(context.originalInventory, newName);
                        if (schema.isUsableTheme(previousDestination, newName)) {
                            context.previousDestinationTheme = schema.cloneValue(previousDestination);
                        }
                        if (context.sourceTheme) return null;
                        var candidate = runtime.findTheme(context.originalInventory, oldName);
                        return runtime.resolveUsableTheme(oldName, candidate).then(function (usable) {
                            context.sourceTheme = schema.cloneValue(usable);
                        });
                    });
                })
                .then(function () {
                    if (!schema.isUsableTheme(context.sourceTheme, oldName)) {
                        throw error('incomplete', '主题尚未完整加载，不能安全改名');
                    }
                    var renamed = schema.cloneValue(context.sourceTheme);
                    renamed.name = newName;
                    schema.removeLazyMarker(renamed);
                    if (!schema.isUsableTheme(renamed, newName)) {
                        throw error('incomplete', '主题尚未完整加载，不能安全改名');
                    }
                    context.expectedRenamedTheme = schema.cloneValue(renamed);
                    return api.getPostHeaders();
                })
                .then(function (headers) {
                    context.postHeaders = headers;
                    var knownInventory = context.originalInventory || namesAsInventory(context.existingNames);
                    return saveVerifiedTheme(context.expectedRenamedTheme, {
                        knownInventory: knownInventory,
                        knownPreviousTheme: context.previousDestinationTheme,
                        headers: context.postHeaders,
                        deferVerification: true,
                        transactionContext: context,
                        saveReason: 'theme-manager-rename-save',
                    });
                })
                .then(function () {
                    context.deleteAttempted = true;
                    return api.deleteTheme(oldName, context.postHeaders).catch(function (deleteError) {
                        throw error('delete-failed', deleteError.message || '旧主题删除请求失败', {
                            request: deleteError,
                        });
                    });
                })
                .then(function () {
                    context.deleteSucceeded = true;
                    return freshInventory('theme-manager-rename-final-verify').catch(function (inventoryError) {
                        throw error('verify-failed', '无法完成改名后的最终主题验证：' + inventoryError.message, {
                            verification: inventoryError,
                        });
                    });
                })
                .then(function (themes) {
                    return verifyFinalRename(context, themes);
                })
                .then(function (verified) {
                    runtime.forget(oldName);
                    runtime.remember(verified.theme);
                    return {
                        oldName: oldName,
                        newName: newName,
                        theme: verified.theme,
                        themes: verified.themes,
                        nativeThemeRef: nativeThemeRef,
                        transactionContext: context,
                    };
                })
                .catch(function (originalError) {
                    if (!context.saveAttempted && !context.deleteAttempted) throw originalError;
                    return rollbackRename(context, originalError).then(function (rollbackState) {
                        originalError.rollbackRestored = true;
                        originalError.rollbackState = rollbackState;
                        throw originalError;
                    });
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
