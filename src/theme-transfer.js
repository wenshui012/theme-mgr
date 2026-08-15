(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createThemeTransfer = function (opts) {
        opts = opts || {};
        var schema = opts.schema || ns.themeSchema;
        var runtime = opts.runtime;
        var transactions = opts.transactions;
        var metadata = opts.metadata || ns.themeMetadata;
        var captureBaseline = opts.captureBaseline || function () {
            return import('/scripts/power-user.js').then(function (mod) {
                var baseline = schema.snapshotThemeBaseline(mod && mod.power_user);
                var missing = schema.getMissingThemeFields(baseline);
                if (missing.length > 0) {
                    throw error('baseline-incomplete', '无法取得完整且稳定的当前主题快照', missing);
                }
                return baseline;
            });
        };

        function error(code, message, details) {
            var err = new Error(message || code);
            err.code = code;
            if (details !== undefined) err.details = details;
            return err;
        }

        function uniqueNames(names) {
            var seen = Object.create(null);
            var out = [];
            (names || []).forEach(function (name) {
                name = String(name || '').trim();
                if (!name || seen[name]) return;
                seen[name] = true;
                out.push(name);
            });
            return out;
        }

        function inspectFingerprints(themes) {
            var groups = Object.create(null);
            (themes || []).forEach(function (theme) {
                var fingerprint = schema.fingerprint(theme, {
                    excludeName: true,
                    excludeLazyMarker: true,
                });
                if (!groups[fingerprint]) groups[fingerprint] = [];
                groups[fingerprint].push(theme.name);
            });

            var duplicates = Object.keys(groups).filter(function (fingerprint) {
                return groups[fingerprint].length > 1;
            }).map(function (fingerprint) {
                return { fingerprint: fingerprint, names: groups[fingerprint].slice() };
            });
            return { byFingerprint: groups, duplicates: duplicates, anomalous: [] };
        }

        function inspectLibrary(themes, themeMeta) {
            var list = Array.isArray(themes) ? themes : [];
            var names = list.map(function (theme) {
                return theme && typeof theme.name === 'string' ? theme.name.trim() : '';
            }).filter(Boolean);
            var metadataDiagnostics = metadata && typeof metadata.inspect === 'function'
                ? metadata.inspect(names, themeMeta)
                : { inventoryDuplicateNames: [], orphanMetadata: [], inventoryWithoutMetadata: [], emptyMetadata: [], annotatedNames: [], annotatedCount: 0 };
            var filenames = Object.create(null);
            var sanitizedFilenameCollisions = [];
            var invalidThemeObjects = [];
            var fingerprintThemes = [];
            list.forEach(function (theme, index) {
                var name = theme && typeof theme.name === 'string' ? theme.name.trim() : '';
                if (!schema.isPlainObject(theme) || !name || !schema.isUsableTheme(theme, name) || schema.isLazyThemePlaceholder(theme, name)) {
                    invalidThemeObjects.push({ index: index, name: name || ('第 ' + (index + 1) + ' 项') });
                    return;
                }
                try {
                    JSON.stringify(theme);
                } catch (err) {
                    invalidThemeObjects.push({ index: index, name: name, reason: 'unserializable' });
                    return;
                }
                fingerprintThemes.push(theme);
                var filename = schema.sanitizeFilename(name);
                var key = String(filename || '').toLowerCase();
                if (!filename) {
                    invalidThemeObjects.push({ index: index, name: name, reason: 'invalid-filename' });
                } else if (filenames[key] && filenames[key] !== name) {
                    sanitizedFilenameCollisions.push({ filename: filename, names: [filenames[key], name] });
                } else {
                    filenames[key] = name;
                }
            });
            var fingerprints = inspectFingerprints(fingerprintThemes);
            return Object.assign({}, metadataDiagnostics, {
                sameConfigGroups: fingerprints.duplicates,
                sanitizedFilenameCollisions: sanitizedFilenameCollisions,
                invalidThemeObjects: invalidThemeObjects,
                fingerprints: fingerprints,
                fatal: metadataDiagnostics.inventoryDuplicateNames.length > 0 ||
                    sanitizedFilenameCollisions.length > 0 || invalidThemeObjects.length > 0,
            });
        }

        function prepareExport(themeNames, options) {
            options = options || {};
            var requestedNames = Array.isArray(themeNames) ? themeNames.map(function (name) { return String(name || '').trim(); }).filter(Boolean) : [];
            var names = uniqueNames(requestedNames);
            var themes = [];
            var failures = [];
            var inventorySnapshot = [];

            var requestedCounts = Object.create(null);
            requestedNames.forEach(function (name) { requestedCounts[name] = (requestedCounts[name] || 0) + 1; });
            var duplicateRequests = Object.keys(requestedCounts).filter(function (name) { return requestedCounts[name] > 1; });
            if (duplicateRequests.length > 0) {
                return Promise.reject(error('export-duplicate-name', '导出目标包含重名主题，无法安全确定导出对象', duplicateRequests));
            }

            runtime.invalidate('theme-manager-export-read');
            return runtime.getInventory().then(function (inventory) {
                inventorySnapshot = Array.isArray(inventory) ? inventory : [];
                var inventoryDiagnostics = inspectLibrary(inventorySnapshot, options.themeMeta);
                if (inventoryDiagnostics.inventoryDuplicateNames.some(function (item) { return names.indexOf(item.name) !== -1; })) {
                    throw error('export-duplicate-name', '主题库存存在同名主题，无法安全确定导出对象', inventoryDiagnostics.inventoryDuplicateNames);
                }
                return names.reduce(function (pending, name) {
                    return pending.then(function () {
                        return runtime.resolveUsableTheme(name, runtime.findTheme(inventory, name))
                        .then(function (theme) {
                            if (!schema.isUsableTheme(theme, name) || schema.isLazyThemePlaceholder(theme, name)) {
                                throw error('incomplete', '主题未能解析为可用对象');
                            }
                            themes.push(schema.cloneValue(theme));
                        })
                        .catch(function (err) {
                            failures.push({ name: name, error: err });
                        });
                    });
                }, Promise.resolve());
            }).then(function () {
                if (failures.length > 0) {
                    throw error('export-incomplete', '以下主题无法完整加载：' + failures.map(function (item) {
                        return item.name;
                    }).join('、'), failures);
                }
                var partials = themes.filter(function (theme) { return schema.isLegacyPartialTheme(theme, theme.name); });
                var baselinePromise = partials.length > 0 ? captureBaseline() : Promise.resolve(null);
                return baselinePromise.then(function (baseline) {
                    var report = { legacyCount: partials.length, filledFieldCount: 0, themes: [] };
                    var normalizedThemes = themes.map(function (theme) {
                        if (!schema.isLegacyPartialTheme(theme, theme.name)) return schema.cloneValue(theme);
                        var missing = schema.getMissingThemeFields(theme);
                        report.filledFieldCount += missing.length;
                        report.themes.push({ name: theme.name, filledFields: missing });
                        var normalized = schema.normalizeImportedThemeLikeSillyTavern(theme, baseline);
                        if (!normalized || !schema.isCompleteTheme(normalized, theme.name)) {
                            throw error('export-normalize-failed', '旧版主题补齐失败：' + theme.name);
                        }
                        return normalized;
                    });
                    var diagnostics = inspectLibrary(normalizedThemes, options.themeMeta);
                    if (diagnostics.sanitizedFilenameCollisions.length > 0) {
                        throw error('export-filename-collision', '主题名称清理后会写入同一文件，已中止导出', diagnostics.sanitizedFilenameCollisions);
                    }
                    if (diagnostics.invalidThemeObjects.length > 0) {
                        throw error('export-invalid', '导出目标包含无法安全序列化的主题', diagnostics.invalidThemeObjects);
                    }
                    var inventoryWarnings = inspectLibrary(inventorySnapshot, options.themeMeta);
                    diagnostics.orphanMetadata = inventoryWarnings.orphanMetadata;
                    diagnostics.emptyMetadata = inventoryWarnings.emptyMetadata;
                    diagnostics.inventoryWithoutMetadata = inventoryWarnings.inventoryWithoutMetadata;
                    return { themes: normalizedThemes, fingerprints: diagnostics.fingerprints, diagnostics: diagnostics, report: report };
                });
            });
        }

        function validateImportThemes(themes) {
            var valid = [];
            var invalid = [];
            var legacyPartials = [];
            var filenames = Object.create(null);

            (themes || []).forEach(function (input, index) {
                var theme = schema.cloneValue(input);
                var name = theme && typeof theme.name === 'string' ? theme.name.trim() : '';
                if (theme) theme.name = name;
                var reason = '';
                var details = null;

                if (!schema.isPlainObject(theme)) reason = '主题不是普通对象';
                else if (!name) reason = '主题名称为空';
                else if (schema.isLazyThemePlaceholder(theme, name)) reason = '是懒加载占位对象或不含真实主题字段';
                else if (!schema.isUsableTheme(theme, name)) reason = '不是可用主题对象';

                var filename = name ? schema.sanitizeFilename(name) : '';
                var filenameKey = filename.toLowerCase();
                if (!reason && !filename) reason = '主题名称无法生成有效文件名';
                if (!reason && filenames[filenameKey] !== undefined) {
                    reason = '文件名清理后与导入项冲突';
                    details = [filenames[filenameKey]];
                }

                if (reason) {
                    invalid.push({ index: index, name: name || ('第 ' + (index + 1) + ' 项'), reason: reason, details: details });
                    return;
                }

                filenames[filenameKey] = name;
                if (schema.isLegacyPartialTheme(theme, name)) {
                    legacyPartials.push({ name: name, missingFields: schema.getMissingThemeFields(theme) });
                }
                valid.push(theme);
            });

            return { valid: valid, invalid: invalid, legacyPartials: legacyPartials };
        }

        function importVerified(themes) {
            var validation = validateImportThemes(themes);
            if (validation.invalid.length > 0) {
                return Promise.reject(error('import-invalid', '导入内容包含不安全主题', validation.invalid));
            }

            return captureBaseline().then(function (baseline) {
                var normalizedThemes = validation.valid.map(function (theme) {
                    var normalized = schema.normalizeImportedThemeLikeSillyTavern(theme, baseline);
                    if (!normalized || !schema.isCompleteTheme(normalized, theme.name)) {
                        throw error('import-normalize-failed', '主题无法按 SillyTavern 兼容方式补齐：' + theme.name);
                    }
                    return { source: theme, normalized: normalized };
                });
                return transactions.saveVerifiedThemes(normalizedThemes.map(function (item) {
                    return item.normalized;
                }), {
                    readReason: 'theme-manager-import-batch-read',
                    saveReason: 'theme-manager-import-batch-save',
                    verifyReason: 'theme-manager-import-batch-verify',
                    rollbackVerifyReason: 'theme-manager-import-batch-rollback-verify',
                }).then(function (savedBatch) {
                    if (typeof runtime.replaceInventory === 'function') {
                        runtime.replaceInventory(savedBatch.themes || []);
                    }
                    var results = savedBatch.results.map(function (saved, index) {
                        if (typeof runtime.replaceInventory !== 'function') runtime.remember(saved.theme);
                        runtime.hydrate(saved.theme);
                        return {
                            ok: true,
                            theme: saved.theme,
                            sourceTheme: normalizedThemes[index].source,
                            overwritten: saved.overwritten,
                        };
                    });
                    return {
                        results: results,
                        legacyPartials: validation.legacyPartials,
                        themes: savedBatch.themes,
                    };
                });
            });
        }

        return {
            inspectFingerprints: inspectFingerprints,
            inspectLibrary: inspectLibrary,
            prepareExport: prepareExport,
            validateImportThemes: validateImportThemes,
            importVerified: importVerified,
            error: error,
        };
    };
})(window);
