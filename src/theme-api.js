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
                    return data && Array.isArray(data.themes) ? data.themes : [];
                });
        }

        function getRawSettingsInventory(rawFetch) {
            return getSettingsInventory({ requester: rawFetch });
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
