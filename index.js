// ST美化管理扩展 v3.5 - 模块装配与总入口
(function () {
    var TM_VERSION = '3.5.5';

    function getExtensionBaseUrl() {
        var script = document.currentScript;
        if (script && script.src) return script.src.replace(/index\.js(?:\?.*)?$/, '');
        var scripts = document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
            var src = scripts[i].src || '';
            if (/\/(?:theme-mgr|theme-manager)\/index\.js(?:\?|$)/.test(src)) {
                return src.replace(/index\.js(?:\?.*)?$/, '');
            }
        }
        return '/scripts/extensions/third-party/theme-mgr/';
    }

    function loadModule(baseUrl, rel) {
        return new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[data-theme-mgr-module="' + rel + '"]');
            if (existing) { resolve(); return; }
            var script = document.createElement('script');
            script.src = baseUrl + rel + '?v=' + encodeURIComponent(TM_VERSION);
            script.async = false;
            script.dataset.themeMgrModule = rel;
            script.onload = resolve;
            script.onerror = function () { reject(new Error('无法加载：' + rel)); };
            document.head.appendChild(script);
        });
    }

    async function start() {
        var baseUrl = getExtensionBaseUrl();
        var files = [
            'src/theme-schema.js',
            'src/theme-api.js',
            'src/theme-runtime.js',
            'src/theme-transactions.js',
            'src/theme-transfer.js',
            'src/storage.js',
            'src/image-tools.js',
            'src/styles.js',
            'src/backgrounds.js',
            'src/ui-sheets.js',
            'src/ui-events.js',
            'src/ui-main.js',
        ];
        for (var i = 0; i < files.length; i++) await loadModule(baseUrl, files[i]);

        var modules = window.ThemeMgrModules || {};
        if (typeof modules.createUiMain !== 'function') throw new Error('ui-main.js 未注册');
        modules.createUiMain({ version: TM_VERSION, modules: modules }).start();
    }

    start().catch(function (err) {
        console.error('[美化管理] 初始化失败:', err);
    });
})();
