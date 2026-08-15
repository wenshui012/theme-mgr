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

        function requireValidInventory(themes, reason) {
            if (!Array.isArray(themes)) {
                throw error('inventory-invalid', '主题库存不是有效数组', { reason: reason || '' });
            }
            var seenNames = Object.create(null);
            for (var i = 0; i < themes.length; i++) {
                var item = themes[i];
                if (!schema.isPlainObject(item) || typeof item.name !== 'string' || !item.name.trim()) {
                    throw error('inventory-invalid', '主题库存包含无效主题项', {
                        reason: reason || '',
                        index: i,
                    });
                }
                if (seenNames[item.name]) {
                    throw error('inventory-invalid', '主题库存包含重复主题名', {
                        reason: reason || '',
                        index: i,
                        name: item.name,
                    });
                }
                seenNames[item.name] = true;
            }
            return themes;
        }

        function freshInventory(reason) {
            runtime.invalidate(reason);
            return Promise.resolve()
                .then(function () { return runtime.getInventory({ bypassBaibaokuCache: true }); })
                .then(function (themes) { return requireValidInventory(themes, reason); });
        }

        function isTauriTavernMobileRuntime() {
            return Boolean(global.__TAURITAVERN_MOBILE_RUNTIME_COMPAT__);
        }

        function valuesMatchForVerifiedTheme(key, expected, actual) {
            if (JSON.stringify(actual) === JSON.stringify(expected)) return true;
            return key === 'chat_width' && isTauriTavernMobileRuntime() && actual === 100;
        }

        function sameVerifiedConfig(expected, actual) {
            if (!schema.isUsableTheme(actual, expected && expected.name)) return false;
            var keys = Object.keys(expected).filter(function (key) {
                return key !== 'name' && key !== schema.LAZY_THEME_MARKER && expected[key] !== undefined;
            });
            if (keys.length === 0) return false;
            return keys.every(function (key) {
                return Object.prototype.hasOwnProperty.call(actual, key) &&
                    valuesMatchForVerifiedTheme(key, expected[key], actual[key]);
            });
        }

        function verifySavedTheme(expectedTheme, reason) {
            return freshInventory(reason || 'theme-manager-verify-save').then(function (themes) {
                var candidate = runtime.findTheme(themes, expectedTheme.name);
                if (!candidate) throw error('verify-failed', '保存后未找到主题：' + expectedTheme.name);
                return runtime.resolveUsableTheme(expectedTheme.name, candidate).then(function (usable) {
                    if (!sameVerifiedConfig(expectedTheme, usable)) {
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

        function rollbackSavedTheme(themeName, previousTheme, previousState, headers) {
            if (previousState === 'present' && previousTheme) {
                return api.saveTheme(previousTheme, headers)
                    .then(function () { return verifySavedTheme(previousTheme, 'theme-manager-rollback-restore'); });
            }
            if (previousState !== 'absent') {
                return Promise.reject(error(
                    'rollback-state-unknown',
                    '无法权威确认主题修改前不存在，已拒绝删除式回滚',
                ));
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
            var previousState = 'unknown';
            var headers = null;
            var saveAttempted = false;
            var inventory = null;
            var hasKnownPrevious = Object.prototype.hasOwnProperty.call(options, 'knownPreviousTheme');
            var inventoryPromise = Object.prototype.hasOwnProperty.call(options, 'knownInventory')
                ? Promise.resolve().then(function () {
                    return requireValidInventory(options.knownInventory, 'theme-manager-known-inventory');
                })
                : freshInventory(options.readReason || 'theme-manager-save-read');

            return inventoryPromise
                .then(function (themes) {
                    inventory = themes;
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
                        var knownCandidate = runtime.findTheme(inventory, expected.name);
                        if (options.knownPreviousTheme) {
                            if (!knownCandidate || !schema.isUsableTheme(options.knownPreviousTheme, expected.name)) {
                                throw error('unsafe-options', '已知旧主题与权威库存不一致');
                            }
                            previousState = 'present';
                            return schema.cloneValue(options.knownPreviousTheme);
                        }
                        if (knownCandidate) {
                            throw error('unsafe-options', '不能将已存在的主题当作已知不存在');
                        }
                        previousState = 'absent';
                        return null;
                    }
                    var previousCandidate = runtime.findTheme(inventory, expected.name);
                    if (!previousCandidate) {
                        previousState = 'absent';
                        return null;
                    }
                    previousState = 'present';
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
                    return rollbackSavedTheme(expected.name, previousTheme, previousState, headers)
                        .then(function () { throw originalError; }, function (rollbackError) {
                            throw error('rollback-failed', originalError.message + '；恢复旧主题失败：' + rollbackError.message, {
                                cause: originalError,
                                rollback: rollbackError,
                            });
                        });
                });
        }

        function verifyBatchSavedThemes(expectedThemes, themes) {
            var verified = [];
            var failures = [];
            (expectedThemes || []).forEach(function (expected) {
                var candidate = runtime.findTheme(themes, expected.name);
                if (!schema.isUsableTheme(candidate, expected.name) ||
                    schema.isLazyThemePlaceholder(candidate, expected.name) ||
                    !sameVerifiedConfig(expected, candidate)) {
                    failures.push(expected.name);
                    return;
                }
                verified.push(schema.cloneValue(candidate));
            });
            if (failures.length > 0) {
                throw error('batch-verify-failed', '批量保存后的主题联合验证失败', {
                    failedNames: failures,
                });
            }
            return verified;
        }

        function describeBatchRollbackState(entries, themes) {
            return (entries || []).map(function (entry) {
                var candidate = runtime.findTheme(themes, entry.expected.name);
                var expectedPrevious = entry.previousTheme;
                var restored = entry.previousState === 'present' && expectedPrevious
                    ? schema.isUsableTheme(candidate, expectedPrevious.name) &&
                        schema.fingerprint(candidate) === schema.fingerprint(expectedPrevious)
                    : entry.previousState === 'absent' && !candidate;
                return {
                    name: entry.expected.name,
                    previousState: entry.previousState || 'unknown',
                    expectedPrevious: Boolean(expectedPrevious),
                    present: Boolean(candidate),
                    restored: restored,
                };
            });
        }

        function rollbackVerifiedThemeBatch(entries, headers, originalError, options) {
            options = options || {};
            var rollbackEntries = (entries || []).slice().reverse();
            return rollbackEntries.reduce(function (pending, entry) {
                return pending.then(function () {
                    var rollbackRequest;
                    if (entry.previousState === 'present' && entry.previousTheme) {
                        rollbackRequest = api.saveTheme(entry.previousTheme, headers);
                    } else if (entry.previousState === 'absent') {
                        rollbackRequest = api.deleteTheme(entry.expected.name, headers);
                    } else {
                        rollbackRequest = Promise.reject(error(
                            'rollback-state-unknown',
                            '批量回滚时无法权威确认主题修改前不存在',
                        ));
                    }
                    return rollbackRequest.catch(function (rollbackRequestError) {
                        if (rollbackRequestError && rollbackRequestError.code === 'rollback-state-unknown') {
                            throw rollbackRequestError;
                        }
                        // The final fresh inventory is authoritative. A rejected delete may
                        // still mean the requested state was reached or the response was lost.
                        return null;
                    });
                });
            }, Promise.resolve())
                .then(function () {
                    return freshInventory(options.rollbackVerifyReason || 'theme-manager-import-batch-rollback-verify');
                })
                .then(function (themes) {
                    var state = describeBatchRollbackState(entries, themes);
                    if (state.some(function (item) { return !item.restored; })) {
                        throw error('rollback-state-invalid', '批量导入回滚后的主题状态验证失败', state);
                    }
                    entries.forEach(function (entry) {
                        if (entry.previousTheme) runtime.remember(entry.previousTheme);
                        else runtime.forget(entry.expected.name);
                    });
                    originalError.rollbackRestored = true;
                    originalError.rollbackState = state;
                    throw originalError;
                })
                .catch(function (rollbackError) {
                    if (rollbackError === originalError) throw rollbackError;
                    if (rollbackError && rollbackError.code === 'rollback-failed') throw rollbackError;
                    throw error('rollback-failed', '批量导入失败，且无法确认旧主题已全部恢复', {
                        causeCode: originalError && originalError.code ? originalError.code : 'batch-save-failed',
                        rollbackCode: rollbackError && rollbackError.code ? rollbackError.code : 'rollback-error',
                        state: rollbackError && rollbackError.details ? rollbackError.details : null,
                    });
                });
        }

        function saveVerifiedThemes(themes, options) {
            options = options || {};
            var expectedThemes = (themes || []).map(function (theme) { return schema.cloneValue(theme); });
            if (expectedThemes.length === 0) {
                return Promise.resolve({ results: [], themes: [], initialInventory: [] });
            }

            var filenames = Object.create(null);
            for (var i = 0; i < expectedThemes.length; i++) {
                var expected = expectedThemes[i];
                if (!schema.isUsableTheme(expected, expected && expected.name) || schema.hasLazyMarker(expected)) {
                    return Promise.reject(error('incomplete', '批量保存包含不可用主题对象'));
                }
                var filenameKey = schema.sanitizeFilename(expected.name).toLowerCase();
                if (!filenameKey) return Promise.reject(error('invalid-filename', '主题名称无法生成有效文件名'));
                if (filenames[filenameKey] !== undefined) {
                    return Promise.reject(error('filename-conflict', '批量保存项经文件名清理后发生冲突'));
                }
                filenames[filenameKey] = expected.name;
            }

            var initialInventory = null;
            var headers = null;
            var entries = [];
            var attemptedEntries = [];
            var writeStarted = false;

            return freshInventory(options.readReason || 'theme-manager-import-batch-read')
                .then(function (inventory) {
                    initialInventory = inventory;
                    var collision = expectedThemes.some(function (expected) {
                        var targetKey = schema.sanitizeFilename(expected.name).toLowerCase();
                        return initialInventory.some(function (item) {
                            return item && item.name && item.name !== expected.name &&
                                schema.sanitizeFilename(item.name).toLowerCase() === targetKey;
                        });
                    });
                    if (collision) throw error('filename-conflict', '主题名称经文件名清理后与已有主题冲突');

                    return expectedThemes.reduce(function (pending, expected) {
                        return pending.then(function () {
                            var previousCandidate = runtime.findTheme(initialInventory, expected.name);
                            if (!previousCandidate) {
                                entries.push({ expected: expected, previousTheme: null, previousState: 'absent' });
                                return null;
                            }
                            return runtime.resolveUsableTheme(expected.name, previousCandidate).then(function (previous) {
                                entries.push({
                                    expected: expected,
                                    previousTheme: schema.cloneValue(previous),
                                    previousState: 'present',
                                });
                            });
                        });
                    }, Promise.resolve());
                })
                .then(function () { return options.headers || api.getPostHeaders(); })
                .then(function (postHeaders) {
                    headers = postHeaders;
                    return entries.reduce(function (pending, entry) {
                        return pending.then(function () {
                            writeStarted = true;
                            attemptedEntries.push(entry);
                            var transactionContext = {};
                            return saveVerifiedTheme(entry.expected, {
                                knownInventory: initialInventory,
                                knownPreviousTheme: entry.previousTheme,
                                headers: headers,
                                deferVerification: true,
                                transactionContext: transactionContext,
                                saveReason: options.saveReason || 'theme-manager-import-batch-save',
                            });
                        });
                    }, Promise.resolve());
                })
                .then(function () {
                    return freshInventory(options.verifyReason || 'theme-manager-import-batch-verify');
                })
                .then(function (finalInventory) {
                    var verified = verifyBatchSavedThemes(expectedThemes, finalInventory);
                    verified.forEach(function (theme) { runtime.remember(theme); });
                    return {
                        results: verified.map(function (theme, index) {
                            return {
                                ok: true,
                                theme: theme,
                                previousTheme: entries[index].previousTheme,
                                overwritten: Boolean(entries[index].previousTheme),
                            };
                        }),
                        themes: finalInventory,
                        initialInventory: initialInventory,
                    };
                })
                .catch(function (originalError) {
                    if (!writeStarted || !headers) throw originalError;
                    return rollbackVerifiedThemeBatch(attemptedEntries, headers, originalError, options);
                });
        }

        function deleteThemeVerified(themeName, options) {
            options = options || {};
            var headers = null;
            var requestError = null;
            var nativeThemeRef = null;
            var bridge = runtime.getBridge();
            return freshInventory(options.readReason || 'theme-manager-delete-read')
                .catch(function (err) {
                    throw error('delete-read-failed', err && err.message ? err.message : '删除前无法读取主题库存', {
                        inventory: err,
                    });
                })
                .then(function (initialInventory) {
                    if (!runtime.findTheme(initialInventory, themeName)) {
                        runtime.forget(themeName);
                        return {
                            name: themeName,
                            themes: initialInventory,
                            requestError: null,
                            nativeThemeRef: null,
                            alreadyAbsent: true,
                        };
                    }
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
                });
        }

        function deleteThemesVerified(themeNames, options) {
            options = options || {};
            var seen = {};
            var names = (themeNames || []).map(function (name) {
                return String(name || '').trim();
            }).filter(function (name) {
                if (!name || seen[name]) return false;
                seen[name] = true;
                return true;
            });
            if (names.length === 0) {
                return Promise.resolve({ results: [], themes: [], initialInventory: [] });
            }

            var initialInventory = null;
            var headers = null;
            var requestErrors = {};
            var nativeRefs = {};

            return freshInventory(options.readReason || 'theme-manager-delete-batch-read')
                .catch(function (err) {
                    throw error('batch-delete-read-failed', err && err.message ? err.message : '批量删除前无法读取主题列表');
                })
                .then(function (themes) {
                    initialInventory = themes;
                    names.forEach(function (name) {
                        nativeRefs[name] = runtime.findTheme(initialInventory, name);
                    });
                    var pendingNames = names.filter(function (name) { return Boolean(nativeRefs[name]); });
                    if (pendingNames.length === 0) {
                        return {
                            results: names.map(function (name) {
                                runtime.forget(name);
                                return {
                                    name: name,
                                    ok: true,
                                    alreadyAbsent: true,
                                    requestError: null,
                                    nativeThemeRef: null,
                                };
                            }),
                            themes: initialInventory,
                            initialInventory: initialInventory,
                        };
                    }

                    return api.getPostHeaders()
                        .catch(function (err) {
                            throw error('batch-delete-headers-failed', err && err.message ? err.message : '批量删除无法取得请求头');
                        })
                        .then(function (postHeaders) {
                            headers = postHeaders;
                            return pendingNames.reduce(function (pending, name) {
                                return pending.then(function () {
                                    return api.deleteTheme(name, headers).catch(function (err) {
                                        requestErrors[name] = err;
                                    });
                                });
                            }, Promise.resolve());
                        })
                        .then(function () {
                            runtime.invalidate(options.deleteReason || 'theme-manager-delete-batch-written');
                            return freshInventory(options.verifyReason || 'theme-manager-delete-batch-verify')
                                .catch(function (err) {
                                    throw error('batch-delete-verify-failed', err && err.message ? err.message : '批量删除后无法验证主题列表', {
                                        requestFailures: Object.keys(requestErrors),
                                    });
                                });
                        })
                        .then(function (finalInventory) {
                            var results = names.map(function (name) {
                                var remaining = runtime.findTheme(finalInventory, name);
                                var ok = !remaining;
                                if (ok) runtime.forget(name);
                                return {
                                    name: name,
                                    ok: ok,
                                    alreadyAbsent: !nativeRefs[name],
                                    requestError: requestErrors[name] || null,
                                    nativeThemeRef: nativeRefs[name] || null,
                                };
                            });
                            return {
                                results: results,
                                themes: finalInventory,
                                initialInventory: initialInventory,
                            };
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

        function describeRenameState(context, themes) {
            var oldTheme = runtime.findTheme(themes, context.oldName);
            var newTheme = runtime.findTheme(themes, context.newName);
            return {
                inventoryAvailable: true,
                oldPresent: Boolean(oldTheme),
                oldMatchesExpected: Boolean(oldTheme && sameVerifiedConfig(context.sourceTheme, oldTheme)),
                newPresent: Boolean(newTheme),
                newMatchesExpected: Boolean(newTheme && sameVerifiedConfig(context.expectedRenamedTheme, newTheme)),
            };
        }

        function verifyFinalRename(context, themes) {
            var state = describeRenameState(context, themes);
            var candidate = runtime.findTheme(themes, context.newName);
            if (!candidate || !schema.isUsableTheme(candidate, context.newName)) {
                throw error('verify-failed', '最终验证未找到可用的新主题：' + context.newName, { state: state });
            }
            if (!sameVerifiedConfig(context.expectedRenamedTheme, candidate)) {
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
                    if (context.destinationState !== 'absent') {
                        return rejectRollbackFailure(
                            context,
                            originalError,
                            error('rollback-state-unknown', '无法权威确认新主题在改名前不存在'),
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
            var managerIdentityConflicts = Array.isArray(options.destinationIdentityConflicts)
                ? options.destinationIdentityConflicts.filter(Boolean)
                : [];
            if (managerIdentityConflicts.length > 0) {
                return Promise.reject(error(
                    'manager-identity-conflict',
                    '目标名称存在遗留 ThemeMgr 数据，请先处理冲突。',
                    { conflicts: managerIdentityConflicts }
                ));
            }

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
                destinationState: 'unknown',
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

                    // DOM/cache names are only an early rejection hint. The prewrite read
                    // below remains the authority for the destination-existence decision.
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
                    // Do not let the earlier UI/cache snapshot authorize a write. This
                    // fresh, schema-validated inventory is the final R0 conflict gate.
                    return freshInventory('theme-manager-rename-prewrite').then(function (authoritativeInventory) {
                        var conflict = getRenameConflict(oldName, newName, authoritativeInventory, []);
                        if (conflict) throw error(conflict, conflict);
                        context.originalInventory = authoritativeInventory;
                        context.existingNames = collectThemeNames(authoritativeInventory, options.extraNames);
                        context.previousDestinationTheme = null;
                        context.destinationState = 'absent';
                        return saveVerifiedTheme(context.expectedRenamedTheme, {
                            knownInventory: authoritativeInventory,
                            knownPreviousTheme: null,
                            headers: context.postHeaders,
                            deferVerification: true,
                            transactionContext: context,
                            saveReason: 'theme-manager-rename-save',
                        });
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
            saveVerifiedThemes: saveVerifiedThemes,
            deleteThemeVerified: deleteThemeVerified,
            deleteThemesVerified: deleteThemesVerified,
            getRenameConflict: getRenameConflict,
            renameTheme: renameTheme,
            error: error,
        };
    };
})(window);
