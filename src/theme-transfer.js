(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createThemeTransfer = function (opts) {
        opts = opts || {};
        var schema = opts.schema || ns.themeSchema;
        var runtime = opts.runtime;
        var transactions = opts.transactions;
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
            var seen = {};
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
            var groups = {};
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
            var total = (themes || []).length;
            var anomalous = duplicates.filter(function (group) {
                return group.names.length >= 3 || (total > 1 && group.names.length === total);
            });
            return { byFingerprint: groups, duplicates: duplicates, anomalous: anomalous };
        }

        function prepareExport(themeNames) {
            var names = uniqueNames(themeNames);
            var themes = [];
            var failures = [];

            runtime.invalidate('theme-manager-export-read');
            return runtime.getInventory().then(function (inventory) {
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
                    var fingerprints = inspectFingerprints(normalizedThemes);
                    if (fingerprints.anomalous.length > 0) {
                        throw error('export-duplicate', '检测到异常重复主题，已中止导出', fingerprints.anomalous);
                    }
                    return { themes: normalizedThemes, fingerprints: fingerprints, report: report };
                });
            });
        }

        function validateImportThemes(themes) {
            var valid = [];
            var invalid = [];
            var legacyPartials = [];
            var filenames = {};

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

            var results = [];
            return captureBaseline().then(function (baseline) {
                var normalizedThemes = validation.valid.map(function (theme) {
                    var normalized = schema.normalizeImportedThemeLikeSillyTavern(theme, baseline);
                    if (!normalized || !schema.isCompleteTheme(normalized, theme.name)) {
                        throw error('import-normalize-failed', '主题无法按 SillyTavern 兼容方式补齐：' + theme.name);
                    }
                    return { source: theme, normalized: normalized };
                });
                return normalizedThemes.reduce(function (pending, item) {
                    return pending.then(function () {
                        return transactions.saveVerifiedTheme(item.normalized, {
                            readReason: 'theme-manager-import-read',
                            saveReason: 'theme-manager-import-save',
                            verifyReason: 'theme-manager-import-verify',
                        }).then(function (saved) {
                            runtime.remember(saved.theme);
                            runtime.hydrate(saved.theme);
                            results.push({ ok: true, theme: saved.theme, sourceTheme: item.source, overwritten: saved.overwritten });
                        }).catch(function (err) {
                            results.push({ ok: false, theme: item.normalized, sourceTheme: item.source, error: err });
                        });
                    });
                }, Promise.resolve());
            }).then(function () {
                return {
                    results: results,
                    legacyPartials: validation.legacyPartials,
                };
            });
        }

        return {
            inspectFingerprints: inspectFingerprints,
            prepareExport: prepareExport,
            validateImportThemes: validateImportThemes,
            importVerified: importVerified,
            error: error,
        };
    };
})(window);
