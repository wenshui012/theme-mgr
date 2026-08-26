(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createThemeApi = function (opts) {
        opts = opts || {};
        var schema = opts.schema || ns.themeSchema;

        function getPostHeaders() {
            return global.fetch('/csrf-token')
                .then(function (response) {
                    if (!response.ok) throw new Error('csrf ' + response.status);
                    return response.json();
                })
                .then(function (tokenData) {
                    return { 'Content-Type': 'application/json', 'X-CSRF-Token': tokenData.token };
                });
        }

        function inventoryError(message, details, code) {
            var err = new Error(message || '主题库存格式无效');
            err.code = code || 'inventory-invalid';
            if (details !== undefined) err.details = details;
            return err;
        }

        function reportInventoryDiagnostics(callback, diagnostics) {
            if (typeof callback !== 'function' || !diagnostics.length) return;
            try {
                callback(diagnostics.slice());
            } catch (err) {
                console.warn('[ThemeManager] inventory diagnostics callback failed:', err);
            }
        }

        function validateSettingsInventory(data, options) {
            options = options || {};
            if (!schema || typeof schema.isPlainObject !== 'function' ||
                !schema.isPlainObject(data) ||
                !Object.prototype.hasOwnProperty.call(data, 'themes') ||
                !Array.isArray(data.themes)) {
                throw inventoryError('SillyTavern 主题库存响应缺少有效 themes 数组', {
                    reason: 'inventory-structure',
                });
            }

            var targetName = typeof options.targetName === 'string' && options.targetName.trim()
                ? options.targetName
                : '';
            var seenNames = Object.create(null);
            var namedItems = [];
            var diagnostics = [];
            for (var i = 0; i < data.themes.length; i++) {
                var item = data.themes[i];
                if (!schema.isPlainObject(item) || typeof item.name !== 'string' || !item.name.trim()) {
                    if (!targetName) {
                        throw inventoryError('SillyTavern 主题库存包含无效主题项', {
                            reason: 'item-invalid',
                            index: i,
                        });
                    }
                    diagnostics.push({
                        code: 'inventory-item-invalid',
                        reason: 'item-invalid',
                        index: i,
                    });
                    continue;
                }
                if (!seenNames[item.name]) seenNames[item.name] = [];
                seenNames[item.name].push(i);
                namedItems.push({ item: item, index: i });
            }

            var duplicateNames = Object.keys(seenNames).filter(function (name) {
                return seenNames[name].length > 1;
            });
            if (!targetName && duplicateNames.length) {
                var duplicateName = duplicateNames[0];
                throw inventoryError('SillyTavern 主题库存包含重复主题名', {
                    reason: 'duplicate-name',
                    index: seenNames[duplicateName][1],
                    indices: seenNames[duplicateName].slice(),
                    name: duplicateName,
                });
            }

            duplicateNames.forEach(function (name) {
                diagnostics.push({
                    code: 'inventory-name-duplicate',
                    reason: 'duplicate-name',
                    name: name,
                    count: seenNames[name].length,
                    indices: seenNames[name].slice(),
                });
            });

            if (targetName && seenNames[targetName] && seenNames[targetName].length > 1) {
                throw inventoryError('目标主题在 SillyTavern 库存中存在重名歧义', {
                    reason: 'target-ambiguous',
                    targetName: targetName,
                    indices: seenNames[targetName].slice(),
                    diagnostics: diagnostics,
                }, 'inventory-target-ambiguous');
            }

            if (targetName) {
                reportInventoryDiagnostics(options.onDiagnostics, diagnostics);
                return namedItems.filter(function (entry) {
                    return seenNames[entry.item.name].length === 1;
                }).map(function (entry) {
                    return entry.item;
                });
            }

            return data.themes;
        }

        function getSettingsInventory(options) {
            options = options || {};
            return getPostHeaders()
                .then(function (headers) {
                    var requester = typeof options.requester === 'function' ? options.requester : global.fetch;
                    return requester('/api/settings/get', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({}),
                        cache: 'no-cache',
                    });
                })
                .then(function (response) {
                    if (!response.ok) throw new Error('settings ' + response.status);
                    return response.json();
                })
                .then(function (data) {
                    return validateSettingsInventory(data, options);
                });
        }

        function getRawSettingsInventory(rawFetch, options) {
            var requestOptions = Object.assign({}, options || {}, { requester: rawFetch });
            return getSettingsInventory(requestOptions);
        }

        function saveTheme(theme, headers) {
            if (!schema || !schema.isUsableTheme(theme, theme && theme.name) || schema.isLazyThemePlaceholder(theme, theme && theme.name)) {
                return Promise.reject(new Error('拒绝保存柏宝库懒加载占位主题'));
            }
            var headersPromise = headers ? Promise.resolve(headers) : getPostHeaders();
            return headersPromise.then(function (resolvedHeaders) {
                return global.fetch('/api/themes/save', {
                    method: 'POST',
                    headers: resolvedHeaders,
                    body: JSON.stringify(theme),
                });
            }).then(function (response) {
                if (!response.ok) throw new Error(theme.name + ': status ' + response.status);
                return theme;
            });
        }

        function deleteTheme(themeName, headers) {
            var headersPromise = headers ? Promise.resolve(headers) : getPostHeaders();
            return headersPromise.then(function (resolvedHeaders) {
                return global.fetch('/api/themes/delete', {
                    method: 'POST',
                    headers: resolvedHeaders,
                    body: JSON.stringify({ name: themeName }),
                });
            }).then(function (response) {
                if (!response.ok) throw new Error(themeName + ': delete status ' + response.status);
                return true;
            });
        }

        return {
            getPostHeaders: getPostHeaders,
            getSettingsInventory: getSettingsInventory,
            getRawSettingsInventory: getRawSettingsInventory,
            saveTheme: saveTheme,
            deleteTheme: deleteTheme,
        };
    };
})(window);
