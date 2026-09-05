(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var STYLE_ID = 'tm-avatar-page-style';

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function buildPageHtml(placeholder) {
        return '<div class="tm-avatar-page" data-tm-avatar-page>' +
            '<input type="file" data-avatar-file accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple hidden>' +
            '<div class="tm-avatar-page-notice" data-avatar-notice role="status" aria-live="polite" hidden></div>' +
            '<div class="tm-avatar-page-grid" data-avatar-grid><div class="tm-avatar-page-loading">正在读取头像库…</div></div></div>';
    }

    function styleText() {
        return [
            '.tm-app-page-avatars{display:block;place-items:initial;min-width:0;overflow:hidden;padding:0}',
            '.tm-avatar-page{height:100%;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}',
            '.tm-avatar-page-notice{flex:0 0 auto;margin:9px 14px 0;padding:8px 10px;border:var(--tm-control-border-style,1px solid var(--tm-control-border,rgba(127,127,127,.16)));border-radius:var(--tm-control-radius,8px);background:var(--tm-control-bg,rgba(127,127,127,.06));color:inherit;font-size:.8em}',
            '.tm-avatar-page-notice[data-kind="loading"] i{display:inline-block;margin-right:6px;animation:tm-spin 1s linear infinite}.tm-avatar-page-notice[data-kind="error"]{border-color:currentColor}',
            '.tm-avatar-page-grid{min-width:0;flex:1 1 auto;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));align-content:start;gap:9px;padding:12px}',
            '.tm-avatar-page-card{min-width:0;aspect-ratio:1;position:relative;overflow:hidden;border:var(--tm-card-border-style,2px solid var(--tm-card-border,transparent));border-radius:var(--tm-card-radius,10px);background:var(--tm-card-bg,rgba(127,127,127,.06));box-shadow:var(--tm-card-shadow,none)}',
            '.tm-avatar-page-thumb{display:block;width:100%;height:100%;object-fit:cover;background:var(--tm-control-bg,rgba(127,127,127,.1))}',
            '.tm-avatar-page-menu{right:3px!important;bottom:3px!important;opacity:.92!important;background:var(--tm-head-bg,rgba(0,0,0,.38))!important;color:inherit!important}',
            '.tm-avatar-page-loading,.tm-avatar-page-empty{grid-column:1/-1;align-self:center;justify-self:center;text-align:center}.tm-avatar-page-loading{padding:24px 16px;opacity:.55}',
            '.tm-avatar-page-empty{width:min(100%,300px);display:flex;flex-direction:column;align-items:center;gap:6px;padding:22px 16px;border:var(--tm-control-border-style,1px dashed var(--tm-control-border,rgba(127,127,127,.18)));border-radius:var(--tm-panel-radius,16px);background:var(--tm-control-bg,rgba(127,127,127,.05));box-sizing:border-box}',
            '.tm-avatar-page-empty>i{font-size:1.55em;color:var(--SmartThemeQuoteColor,#7c6daf);opacity:.62;margin-bottom:2px}.tm-avatar-page-empty>strong{font-size:.9em}.tm-avatar-page-empty>span{font-size:.76em;opacity:.52}',
            '@media(max-width:430px){.tm-avatar-page-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;padding:10px}.tm-avatar-page-notice{margin:8px 10px 0}.tm-avatar-page-empty{padding:18px 14px}}',
        ].join('');
    }

    ns.createAvatarPage = function (options) {
        options = options || {};
        var doc = options.document || global.document;
        var store = options.store;
        var processor = options.processor;
        var runtime = options.runtime;
        var imageLoaderApi = options.imageLoader;
        var imageToolsApi = options.imageTools || ns.imageTools;
        var getRoot = options.getRoot;
        var closeManager = options.closeManager || function () {};
        var createSheet = options.createSheet;
        var closeSheet = options.closeSheet || function (sheet) { if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet); };
        var onImportingChange = options.onImportingChange || function () {};
        var toast = options.toast || function () {};
        var confirmDelete = options.confirm || global.confirm;
        var mounted = false;
        var root = null;
        var fileInput = null;
        var gridLoader = null;
        var assets = [];
        var refreshToken = 0;
        var importing = false;
        var logger = options.console || global.console || { error: function () {} };

        function ensureStyle() {
            if (doc.getElementById(STYLE_ID)) return;
            var style = doc.createElement('style');
            style.id = STYLE_ID;
            style.textContent = styleText();
            doc.head.appendChild(style);
        }
        function removeStyle() {
            var style = doc.getElementById(STYLE_ID);
            if (style && style.parentNode) style.parentNode.removeChild(style);
        }
        function setNotice(message, kind) {
            if (!root) return;
            var notice = root.querySelector('[data-avatar-notice]');
            notice.innerHTML = kind === 'loading' && message ? '<i class="fa-solid fa-spinner"></i>' + esc(message) : esc(message || '');
            if (kind) notice.setAttribute('data-kind', kind); else notice.removeAttribute('data-kind');
            notice.hidden = !message;
        }
        function reportError(stage, error, file) {
            if (logger && typeof logger.error === 'function') logger.error('[Theme Manager][Avatar] ' + stage, { file: file && file.name, error: error, cause: error && error.cause });
        }
        function friendlyImportError(error) {
            var code = error && error.code || '';
            if (code === 'IMAGE_READ_FAILED' || code === 'AVATAR_READ_FAILED') return '图片读取失败';
            if (code === 'IMAGE_DECODE_FAILED' || code === 'AVATAR_DECODE_FAILED') return '图片解码失败';
            if (code === 'AVATAR_FORMAT_UNSUPPORTED') return '图片格式暂不支持';
            if (code === 'AVATAR_STORAGE_QUOTA_EXCEEDED') return '存储空间不足';
            if (/^(?:AVATAR_IDB|AVATAR_STORAGE)/.test(code)) return '本地存储失败';
            return '未能保存头像';
        }
        function setImporting(value) {
            importing = Boolean(value);
            onImportingChange(importing);
            if (!root) return;
            if (importing) setNotice('正在添加头像…', 'loading');
        }
        function cardHtml(asset) {
            return '<article class="tm-avatar-page-card" data-avatar-id="' + esc(asset.id) + '" aria-label="头像 ' + esc(asset.name) + '">' +
                '<img class="tm-avatar-page-thumb" src="' + esc(imageLoaderApi.PLACEHOLDER_SRC) + '" data-image-key="' + esc(asset.id) + '" alt="">' +
                '<button type="button" class="tm-card-menu tm-avatar-page-menu" data-avatar-action="menu" data-avatar-id="' + esc(asset.id) + '" title="头像操作" aria-label="打开 ' + esc(asset.name) + ' 的操作菜单"><i class="fa-solid fa-ellipsis"></i></button></article>';
        }
        function setupGridLoader() {
            if (gridLoader) gridLoader.disconnect();
            var grid = root.querySelector('[data-avatar-grid]');
            gridLoader = imageLoaderApi.createImageLoader({
                root: grid,
                rootMargin: '320px 0px',
                resolveSource: function (id) { return store.getThumbnail(id); },
            });
            gridLoader.observe(grid.querySelectorAll('.tm-avatar-page-thumb'));
        }
        function render() {
            if (!root) return;
            var grid = root.querySelector('[data-avatar-grid]');
            grid.innerHTML = assets.length
                ? assets.map(cardHtml).join('')
                : '<div class="tm-avatar-page-empty"><i class="fa-regular fa-image"></i><strong>还没有头像</strong><span>点击顶栏的＋添加图片</span></div>';
            setupGridLoader();
            setImporting(importing);
        }
        function refresh() {
            var token = ++refreshToken;
            return store.listAssets().then(function (items) {
                if (!mounted || token !== refreshToken) return;
                assets = (items || []).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
                render();
            }).catch(function (error) {
                reportError('library refresh failed', error);
                if (mounted) setNotice('头像库读取失败', 'error');
                throw error;
            });
        }
        function importFiles(files) {
            files = Array.prototype.slice.call(files || []);
            if (!files.length) return Promise.resolve([]);
            setImporting(true);
            return Promise.all(files.map(function (file) {
                return processor.processFile(file).then(function (asset) {
                    return store.putAsset(asset).then(function (saved) {
                        runtime.notifyAssetChanged(saved.id);
                        return { ok: true, asset: saved };
                    });
                }).catch(function (error) {
                    reportError('import failed', error, file);
                    return { ok: false, name: file.name || '未命名图片', error: error };
                });
            })).then(function (results) {
                var failed = results.filter(function (item) { return !item.ok; });
                var passed = results.filter(function (item) { return item.ok; });
                return (passed.length ? refresh() : Promise.resolve()).then(function () {
                    if (failed.length) setNotice(failed.map(function (item) { return item.name + '：' + friendlyImportError(item.error); }).join('；'), 'error');
                    else setNotice('已添加 ' + passed.length + ' 张头像', 'success');
                    if (passed.length) toast('✅ 已添加 ' + passed.length + ' 张头像');
                    return results;
                });
            }).catch(function (error) {
                reportError('import pipeline failed', error);
                setNotice(friendlyImportError(error), 'error');
                throw error;
            }).finally(function () { setImporting(false); });
        }
        function beginEdit(kind, avatarId, sheet) {
            var caps = runtime.getCapabilities();
            var cap = kind === 'character' ? caps.character : caps.user;
            if (!caps.themeKey || !cap.available) { setNotice(!caps.themeKey ? '无法识别当前美化' : cap.reason); return; }
            if (sheet) closeSheet(sheet);
            closeManager();
            global.setTimeout(function () {
                runtime.beginEdit({ target: cap.target, avatarId: avatarId }).catch(function (error) {
                    toast(error.message || '无法启动头像调整', true);
                });
            }, 32);
        }
        function deleteAvatar(id, sheet) {
            var asset = assets.find(function (item) { return item.id === id; });
            if (!asset || !confirmDelete('确定删除头像「' + asset.name + '」吗？使用它的绑定会同时清理。')) return;
            if (sheet) closeSheet(sheet);
            runtime.deleteAsset(id).then(function () {
                toast('已删除头像并清理相关绑定');
                return refresh();
            }).catch(function (error) { setNotice('删除失败：' + error.message); });
        }
        function menuItem(action, icon, label, disabled, reason, danger) {
            return '<div class="tm-ctx-item' + (danger ? ' danger' : '') + '" role="button" tabindex="' + (disabled ? '-1' : '0') + '" data-avatar-menu-action="' + action + '"' +
                (disabled ? ' aria-disabled="true" style="opacity:.42"' : '') + (reason ? ' title="' + esc(reason) + '"' : '') + '><i class="fa-solid ' + icon + '"></i>' + esc(label) + '</div>';
        }
        function bindSheetAction(sheet, action, handler) {
            var element = sheet.querySelector('[data-avatar-menu-action="' + action + '"]');
            if (!element || element.getAttribute('aria-disabled') === 'true') return;
            element.addEventListener('click', handler);
            element.addEventListener('keydown', function (event) {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault(); handler();
            });
        }
        function openAssetMenu(id) {
            var asset = assets.find(function (item) { return item.id === id; });
            if (!asset || typeof createSheet !== 'function') return Promise.reject(new Error('头像操作菜单不可用'));
            var caps = runtime.getCapabilities();
            return Promise.all([
                caps.character.target && caps.themeKey ? store.getBinding(caps.themeKey, caps.character.target.key) : null,
                caps.user.target && caps.themeKey ? store.getBinding(caps.themeKey, caps.user.target.key) : null,
            ]).then(function (bindings) {
                if (!mounted) return;
                var characterDisabled = !caps.themeKey || !caps.character.available;
                var userDisabled = !caps.themeKey || !caps.user.available;
                var sheet = createSheet([
                    '<div class="tm-ctx-theme-name"><i class="fa-solid fa-user" style="margin-right:6px;opacity:.5"></i>' + esc(asset.name) + '</div>',
                    menuItem('apply-character', 'fa-wand-magic-sparkles', '用于当前角色并调整', characterDisabled, caps.character.reason, false),
                    menuItem('apply-user', 'fa-wand-magic-sparkles', '用于 User 并调整', userDisabled, caps.user.reason, false),
                    bindings[0] ? menuItem('restore-character', 'fa-rotate-left', '恢复当前角色原头像', false, '', false) : '',
                    bindings[1] ? menuItem('restore-user', 'fa-rotate-left', '恢复 User 原头像', false, '', false) : '',
                    menuItem('delete', 'fa-trash', '删除头像', false, '', true),
                ].join(''));
                bindSheetAction(sheet, 'apply-character', function () { beginEdit('character', asset.id, sheet); });
                bindSheetAction(sheet, 'apply-user', function () { beginEdit('user', asset.id, sheet); });
                bindSheetAction(sheet, 'restore-character', function () {
                    closeSheet(sheet); runtime.clearBinding('character').then(function () { toast('已恢复 SillyTavern 原头像'); }).catch(function (error) { setNotice(error.message, 'error'); });
                });
                bindSheetAction(sheet, 'restore-user', function () {
                    closeSheet(sheet); runtime.clearBinding('user').then(function () { toast('已恢复 SillyTavern 原头像'); }).catch(function (error) { setNotice(error.message, 'error'); });
                });
                bindSheetAction(sheet, 'delete', function () { deleteAvatar(asset.id, sheet); });
                return sheet;
            });
        }
        function handleClick(event) {
            var action = event.target && event.target.closest ? event.target.closest('[data-avatar-action]') : null;
            if (action && root.contains(action)) {
                var name = action.getAttribute('data-avatar-action');
                if (name === 'menu') openAssetMenu(action.getAttribute('data-avatar-id')).catch(function (error) {
                    reportError('avatar menu failed', error); setNotice(error.message || '头像操作菜单无法打开', 'error');
                });
                return;
            }
        }
        function handleFileChange(event) {
            var input = event && event.currentTarget || fileInput;
            var files = imageToolsApi.snapshotInputFiles(input);
            if (!files.length) return;
            var pending = importFiles(files);
            if (input) input.value = '';
            pending.catch(function (error) { reportError('file input import rejected', error); });
        }
        function mount() {
            if (mounted) return refresh();
            root = getRoot();
            if (!root) return Promise.reject(new Error('头像管理页面不存在'));
            mounted = true;
            ensureStyle();
            fileInput = root.querySelector('[data-avatar-file]');
            root.addEventListener('click', handleClick);
            fileInput.addEventListener('change', handleFileChange);
            return refresh();
        }
        function unmount() {
            if (!mounted) return;
            mounted = false;
            refreshToken += 1;
            if (gridLoader) gridLoader.disconnect();
            gridLoader = null;
            if (root) {
                root.removeEventListener('click', handleClick);
            }
            if (fileInput) fileInput.removeEventListener('change', handleFileChange);
            fileInput = null;
            root = null;
            removeStyle();
        }

        return {
            mount: mount,
            unmount: unmount,
            refresh: refresh,
            importFiles: importFiles,
            pickFiles: function () { if (!mounted || !fileInput || importing) return false; fileInput.click(); return true; },
            openAssetMenu: openAssetMenu,
            getState: function () { return { mounted: mounted, count: assets.length, importing: importing }; },
        };
    };

    ns.avatarPage = { buildPageHtml: buildPageHtml, styleText: styleText };
})(window);
