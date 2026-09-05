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
            '.tm-avatar-page-grid{min-width:0;min-height:0;flex:1 1 auto;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));grid-auto-rows:max-content;align-content:start;align-items:start;gap:9px;padding:12px}',
            '.tm-avatar-page-card{min-width:0;width:100%;height:auto;aspect-ratio:1;align-self:start;position:relative;overflow:hidden;border:var(--tm-card-border-style,2px solid var(--tm-card-border,transparent));border-radius:var(--tm-card-radius,10px);background:var(--tm-card-bg,rgba(127,127,127,.06));box-shadow:var(--tm-card-shadow,none)}',
            '.tm-avatar-page-thumb{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;background:var(--tm-control-bg,rgba(127,127,127,.1))}',
            '.tm-avatar-picker-grid{max-height:min(58vh,520px);overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));grid-auto-rows:max-content;align-content:start;align-items:start;gap:9px;padding:2px}.tm-avatar-picker-card{appearance:none;padding:0;color:inherit;cursor:pointer}.tm-avatar-picker-card.is-selected{border-color:var(--SmartThemeQuoteColor,#7c6daf)}.tm-avatar-picker-empty{grid-column:1/-1;padding:28px 12px;text-align:center;opacity:.58}',
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
        var openImageLightbox = options.openImageLightbox;
        var onImportingChange = options.onImportingChange || function () {};
        var toast = options.toast || function () {};
        var confirmDelete = options.confirm || global.confirm;
        var mounted = false;
        var root = null;
        var fileInput = null;
        var gridLoader = null;
        var pickerLoader = null;
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
                '<img class="tm-avatar-page-thumb" src="' + esc(imageLoaderApi.PLACEHOLDER_SRC) + '" data-image-key="' + esc(asset.id) + '" data-avatar-action="view" data-avatar-id="' + esc(asset.id) + '" tabindex="0" role="button" aria-label="查看 ' + esc(asset.name) + ' 大图" alt="">' +
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
        function beginEdit(kind, avatarId, sheet, bindingMode, themeName) {
            var caps = runtime.getCapabilities();
            var cap = kind === 'character' ? caps.character : caps.user;
            if (!caps.themeKey || !cap.target) { setNotice(!caps.themeKey ? '头像存储暂不可用' : cap.reason); return; }
            if (sheet) closeSheet(sheet);
            if (closeManager() === false) return;
            global.setTimeout(function () {
                runtime.beginEdit({ kind: kind, avatarId: avatarId, bindingMode: bindingMode, themeName: themeName }).catch(function (error) {
                    toast(error.message || '无法启动头像调整', true);
                });
            }, 32);
        }
        function openUserApplyChoice(asset, parentSheet) {
            if (parentSheet) closeSheet(parentSheet);
            var sheet = createSheet([
                '<div class="tm-ctx-theme-name"><i class="fa-solid fa-user" style="margin-right:6px;opacity:.5"></i>当前美化已有 User 头像绑定</div>',
                menuItem('temporary-user', 'fa-clock', '临时替换', false, '', false),
                '<div class="tm-hint" style="padding:2px 12px 8px">不修改美化绑定；下次切换美化时恢复专属头像。</div>',
                menuItem('update-theme-user', 'fa-link', '修改当前美化绑定', false, '', false),
                '<div class="tm-hint" style="padding:2px 12px 8px">把这张头像和调整结果保存到当前美化。</div>',
            ].join(''));
            bindSheetAction(sheet, 'temporary-user', function () { beginEdit('user', asset.id, sheet, 'temporary'); });
            bindSheetAction(sheet, 'update-theme-user', function () { beginEdit('user', asset.id, sheet, 'theme'); });
        }
        function beginUserEditFromLibrary(asset, sheet) {
            runtime.getThemeUserBinding().then(function (binding) {
                if (binding) openUserApplyChoice(asset, sheet);
                else beginEdit('user', asset.id, sheet, 'global');
            }).catch(function (error) { setNotice(error.message || '无法读取 User 头像绑定', 'error'); });
        }
        function beginNativeEdit(kind, sheet) {
            kind = kind === 'user' ? 'user' : 'character';
            var cap = runtime.getCapabilities()[kind];
            if (!cap || !cap.available) { setNotice(cap && cap.reason || '当前角色原头像无法调整'); return; }
            if (sheet) closeSheet(sheet);
            closeManager();
            global.setTimeout(function () {
                runtime.beginNativeEdit(kind).catch(function (error) {
                    toast(error.message || '无法启动原头像调整', true);
                });
            }, 32);
        }
        function clearNativeView(kind, sheet) {
            if (sheet) closeSheet(sheet);
            return runtime.clearNativeView(kind).then(function () {
                toast(kind === 'user' ? '已恢复 User 原头像显示' : '已恢复当前角色原头像显示');
            }).catch(function (error) { setNotice(error.message || '无法恢复原头像显示', 'error'); });
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
                var characterDisabled = !caps.themeKey || !caps.character.target;
                var userDisabled = !caps.themeKey || !caps.user.target;
                var sheet = createSheet([
                    '<div class="tm-ctx-theme-name"><i class="fa-solid fa-user" style="margin-right:6px;opacity:.5"></i>' + esc(asset.name) + '</div>',
                    menuItem('apply-character', 'fa-wand-magic-sparkles', '用于当前角色并调整', characterDisabled, caps.character.reason, false),
                    menuItem('apply-user', 'fa-wand-magic-sparkles', '用于 User 并调整', userDisabled, caps.user.reason, false),
                    bindings[0] ? menuItem('restore-character', 'fa-rotate-left', '恢复当前角色原头像', false, '', false) : '',
                    bindings[1] ? menuItem('restore-user', 'fa-rotate-left', '清除全局 User 头像', false, '', false) : '',
                    menuItem('delete', 'fa-trash', '删除头像', false, '', true),
                ].join(''));
                bindSheetAction(sheet, 'apply-character', function () { beginEdit('character', asset.id, sheet); });
                bindSheetAction(sheet, 'apply-user', function () { beginUserEditFromLibrary(asset, sheet); });
                bindSheetAction(sheet, 'restore-character', function () {
                    closeSheet(sheet); runtime.clearBinding('character').then(function () { toast('已恢复 SillyTavern 原头像'); }).catch(function (error) { setNotice(error.message, 'error'); });
                });
                bindSheetAction(sheet, 'restore-user', function () {
                    closeSheet(sheet); runtime.clearBinding('user').then(function () { toast('已清除全局 User 头像'); }).catch(function (error) { setNotice(error.message, 'error'); });
                });
                bindSheetAction(sheet, 'delete', function () { deleteAvatar(asset.id, sheet); });
                return sheet;
            });
        }
        function openNativeMenu() {
            if (typeof createSheet !== 'function') return Promise.reject(new Error('原头像操作菜单不可用'));
            var caps = runtime.getCapabilities();
            var character = caps.character || {};
            var user = caps.user || {};
            return Promise.all([
                character.target ? store.getNativeView(character.target.key) : null,
                user.target ? store.getNativeView(user.target.key) : null,
            ]).then(function (views) {
                var heading = character.target && character.target.label || '原头像调整';
                var sheet = createSheet([
                    '<div class="tm-ctx-theme-name"><i class="fa-solid fa-user" style="margin-right:6px;opacity:.5"></i>' + esc(heading) + '</div>',
                    menuItem('adjust-native-character', 'fa-sliders', '调整当前角色原头像', !character.available, character.reason, false),
                    views[0] ? menuItem('reset-native-character', 'fa-rotate-left', '恢复当前角色原始显示', false, '', false) : '',
                    menuItem('adjust-native-user', 'fa-sliders', '调整 User 原头像', !user.available, user.reason, false),
                    views[1] ? menuItem('reset-native-user', 'fa-rotate-left', '恢复 User 原始显示', false, '', false) : '',
                ].join(''));
                bindSheetAction(sheet, 'adjust-native-character', function () { beginNativeEdit('character', sheet); });
                bindSheetAction(sheet, 'reset-native-character', function () { clearNativeView('character', sheet); });
                bindSheetAction(sheet, 'adjust-native-user', function () { beginNativeEdit('user', sheet); });
                bindSheetAction(sheet, 'reset-native-user', function () { clearNativeView('user', sheet); });
                return sheet;
            });
        }
        function viewAsset(id) {
            if (typeof openImageLightbox !== 'function') return Promise.reject(new Error('大图查看器不可用'));
            return store.getAsset(id).then(function (asset) {
                if (!asset || !asset.imageData) throw new Error('头像主图不存在');
                openImageLightbox([{ key: asset.id, label: asset.name, source: asset.imageData }], asset.id);
                return asset;
            });
        }
        function handleClick(event) {
            var action = event.target && event.target.closest ? event.target.closest('[data-avatar-action]') : null;
            if (action && root.contains(action)) {
                var name = action.getAttribute('data-avatar-action');
                if (name === 'menu') openAssetMenu(action.getAttribute('data-avatar-id')).catch(function (error) {
                    reportError('avatar menu failed', error); setNotice(error.message || '头像操作菜单无法打开', 'error');
                });
                else if (name === 'view') viewAsset(action.getAttribute('data-avatar-id')).catch(function (error) {
                    reportError('avatar preview failed', error); setNotice(error.message || '头像大图无法打开', 'error');
                });
                return;
            }
        }
        function handleKeydown(event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            var action = event.target && event.target.closest ? event.target.closest('[data-avatar-action="view"]') : null;
            if (!action || !root.contains(action)) return;
            event.preventDefault();
            viewAsset(action.getAttribute('data-avatar-id')).catch(function (error) {
                reportError('avatar preview failed', error); setNotice(error.message || '头像大图无法打开', 'error');
            });
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
            root.addEventListener('keydown', handleKeydown);
            fileInput.addEventListener('change', handleFileChange);
            return refresh();
        }
        function unmount() {
            if (!mounted) return;
            mounted = false;
            refreshToken += 1;
            if (gridLoader) gridLoader.disconnect();
            gridLoader = null;
            if (pickerLoader) pickerLoader.disconnect();
            pickerLoader = null;
            if (root) {
                root.removeEventListener('click', handleClick);
                root.removeEventListener('keydown', handleKeydown);
            }
            if (fileInput) fileInput.removeEventListener('change', handleFileChange);
            fileInput = null;
            root = null;
            removeStyle();
        }

        function openPicker(options) {
            options = options || {};
            if (typeof createSheet !== 'function') return Promise.reject(new Error('头像选择器不可用'));
            return store.listAssets().then(function (items) {
                var choices = (items || []).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
                ensureStyle();
                var selectedId = String(options.selectedId || '');
                var sheet = createSheet(
                    '<div class="tm-sheet-title"><span><i class="fa-solid fa-user"></i>' + esc(options.title || '选择 User 头像') + '</span></div>' +
                    '<div class="tm-avatar-picker-grid" data-avatar-picker-grid>' + (choices.length ? choices.map(function (asset) {
                        return '<button type="button" class="tm-avatar-page-card tm-avatar-picker-card' + (asset.id === selectedId ? ' is-selected' : '') + '" data-avatar-pick-id="' + esc(asset.id) + '" aria-label="选择 ' + esc(asset.name) + '">' +
                            '<img class="tm-avatar-page-thumb" src="' + esc(imageLoaderApi.PLACEHOLDER_SRC) + '" data-image-key="' + esc(asset.id) + '" alt=""></button>';
                    }).join('') : '<div class="tm-avatar-picker-empty">头像库为空，请先到头像管理添加图片</div>') + '</div>' +
                    '<div class="tm-edit-foot"><button type="button" class="tm-btn tm-btn-outline" data-avatar-picker-cancel>取消</button></div>'
                );
                var grid = sheet.querySelector('[data-avatar-picker-grid]');
                if (pickerLoader) pickerLoader.disconnect();
                var loader = imageLoaderApi.createImageLoader({
                    root: grid,
                    rootMargin: '240px 0px',
                    resolveSource: function (id) { return store.getThumbnail(id); },
                });
                pickerLoader = loader;
                loader.observe(grid.querySelectorAll('.tm-avatar-page-thumb'));
                function cleanupPicker() {
                    loader.disconnect();
                    if (pickerLoader === loader) pickerLoader = null;
                    if (!mounted) removeStyle();
                }
                function closePicker() {
                    cleanupPicker();
                    closeSheet(sheet);
                }
                sheet.addEventListener('click', function (event) {
                    if (event.target === sheet) global.setTimeout(cleanupPicker, 0);
                });
                sheet.querySelector('[data-avatar-picker-cancel]').addEventListener('click', closePicker);
                sheet.querySelectorAll('[data-avatar-pick-id]').forEach(function (button) {
                    button.addEventListener('click', function () {
                        var asset = choices.find(function (item) { return item.id === button.getAttribute('data-avatar-pick-id'); });
                        if (!asset) return;
                        closePicker();
                        if (typeof options.onSelect === 'function') options.onSelect(asset);
                    });
                });
                return sheet;
            });
        }

        return {
            mount: mount,
            unmount: unmount,
            refresh: refresh,
            importFiles: importFiles,
            pickFiles: function () { if (!mounted || !fileInput || importing) return false; fileInput.click(); return true; },
            beginNativeEdit: beginNativeEdit,
            openNativeMenu: openNativeMenu,
            getNativeStatus: function (kind) {
                kind = kind === 'user' ? 'user' : 'character';
                var cap = runtime.getCapabilities()[kind] || {};
                return {
                    available: !!cap.available,
                    reason: cap.reason || '',
                    label: cap.target && cap.target.label || '',
                    targetKey: cap.target && cap.target.key || '',
                };
            },
            openAssetMenu: openAssetMenu,
            openPicker: openPicker,
            viewAsset: viewAsset,
            getState: function () { return { mounted: mounted, count: assets.length, importing: importing }; },
        };
    };

    ns.avatarPage = { buildPageHtml: buildPageHtml, styleText: styleText };
})(window);
