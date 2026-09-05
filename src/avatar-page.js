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
            '<div class="tm-avatar-page-tools" data-avatar-tools hidden><span>本设备头像库 · 应用时使用高清主图</span>' +
            '<button type="button" class="tm-catbtn tm-avatar-page-pick" data-avatar-action="pick"><i class="fa-solid fa-plus"></i> 添加</button></div>' +
            '<input type="file" data-avatar-file accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple hidden>' +
            '<div class="tm-avatar-page-notice" data-avatar-notice role="status" aria-live="polite" hidden></div>' +
            '<div class="tm-avatar-page-grid" data-avatar-grid><div class="tm-avatar-page-loading">正在读取头像库…</div></div>' +
            '<div class="tm-avatar-page-actions" data-avatar-actions hidden>' +
            '<div class="tm-avatar-page-selected" data-avatar-selected></div>' +
            '<div class="tm-avatar-page-action-buttons">' +
            '<button type="button" class="tm-catbtn" data-avatar-action="apply-character">用于当前角色并调整</button>' +
            '<button type="button" class="tm-catbtn" data-avatar-action="apply-user">用于 User 并调整</button>' +
            '<button type="button" class="tm-catbtn tm-avatar-page-restore" data-avatar-action="restore-character" hidden>恢复当前角色原头像</button>' +
            '<button type="button" class="tm-catbtn tm-avatar-page-restore" data-avatar-action="restore-user" hidden>恢复 User 原头像</button>' +
            '</div></div></div>';
    }

    function styleText() {
        return [
            '.tm-app-page-avatars{display:block;place-items:initial;min-width:0;overflow:hidden;padding:0}',
            '.tm-avatar-page{height:100%;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}',
            '.tm-avatar-page-tools{min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 14px;border-bottom:1px solid var(--tm-border,rgba(127,127,127,.1));background:color-mix(in srgb,var(--tm-head-bg,transparent) 64%,transparent);box-sizing:border-box;flex:0 0 auto}',
            '.tm-avatar-page-tools[hidden]{display:none}.tm-avatar-page-tools>span{min-width:0;opacity:.52;font-size:.76em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.tm-avatar-page .tm-catbtn{color:inherit;font-family:inherit;box-shadow:var(--tm-control-shadow,none)}.tm-avatar-page .tm-catbtn:disabled{opacity:.38;cursor:not-allowed}',
            '.tm-avatar-page-pick{min-height:40px;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}',
            '.tm-avatar-page-notice{flex:0 0 auto;margin:9px 14px 0;padding:8px 10px;border:var(--tm-control-border-style,1px solid var(--tm-control-border,rgba(127,127,127,.16)));border-radius:var(--tm-control-radius,8px);background:var(--tm-control-bg,rgba(127,127,127,.06));color:inherit;font-size:.8em}',
            '.tm-avatar-page-notice[data-kind="loading"] i{display:inline-block;margin-right:6px;animation:tm-spin 1s linear infinite}.tm-avatar-page-notice[data-kind="error"]{border-color:currentColor}',
            '.tm-avatar-page-grid{min-width:0;flex:1 1 auto;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));align-content:start;gap:9px;padding:12px}',
            '.tm-avatar-page-card{min-width:0;position:relative;border:var(--tm-card-border-style,2px solid var(--tm-card-border,transparent));border-radius:var(--tm-card-radius,10px);padding:6px;background:var(--tm-card-bg,rgba(127,127,127,.06));box-shadow:var(--tm-card-shadow,none);cursor:pointer;transition:background .16s,border-color .16s,box-shadow .16s}',
            '.tm-avatar-page-card:hover{background:var(--tm-control-hover,rgba(127,127,127,.12))}.tm-avatar-page-card.selected{border-color:var(--SmartThemeQuoteColor,#7c6daf);box-shadow:0 0 0 1px var(--SmartThemeQuoteColor,#7c6daf)}',
            '.tm-avatar-page-thumb{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:calc(var(--tm-card-radius,10px) - 3px);background:var(--tm-control-bg,rgba(127,127,127,.1))}',
            '.tm-avatar-page-name{display:block;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem}',
            '.tm-avatar-page-delete{position:absolute;right:9px;top:9px!important;bottom:auto!important;min-width:30px!important;min-height:30px!important;padding:4px!important;background:var(--tm-head-bg,rgba(0,0,0,.38))!important;color:inherit!important}',
            '.tm-avatar-page-actions{flex:0 0 auto;display:flex;gap:8px;align-items:center;min-width:0;padding:9px 14px;padding-bottom:max(9px,env(safe-area-inset-bottom,9px));border-top:1px solid var(--tm-border,rgba(127,127,127,.1));background:var(--tm-head-bg,rgba(0,0,0,.12));backdrop-filter:var(--tm-panel-blur,blur(14px))}',
            '.tm-avatar-page-actions[hidden]{display:none}.tm-avatar-page-selected{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8em}.tm-avatar-page-action-buttons{display:flex;gap:7px;align-items:center;justify-content:flex-end}.tm-avatar-page-action-buttons button{min-height:40px}',
            '.tm-avatar-page-loading,.tm-avatar-page-empty{grid-column:1/-1;align-self:center;justify-self:center;text-align:center}.tm-avatar-page-loading{padding:24px 16px;opacity:.55}',
            '.tm-avatar-page-empty{width:min(100%,300px);display:flex;flex-direction:column;align-items:center;gap:6px;padding:22px 16px;border:var(--tm-control-border-style,1px dashed var(--tm-control-border,rgba(127,127,127,.18)));border-radius:var(--tm-panel-radius,16px);background:var(--tm-control-bg,rgba(127,127,127,.05));box-sizing:border-box}',
            '.tm-avatar-page-empty>i{font-size:1.55em;color:var(--SmartThemeQuoteColor,#7c6daf);opacity:.62;margin-bottom:2px}.tm-avatar-page-empty>strong{font-size:.9em}.tm-avatar-page-empty>span{font-size:.76em;opacity:.52}.tm-avatar-page-empty .tm-avatar-page-pick{margin-top:7px}',
            '@media(max-width:430px){.tm-avatar-page-tools{padding:5px 10px}.tm-avatar-page-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;padding:10px}.tm-avatar-page-notice{margin:8px 10px 0}.tm-avatar-page-actions{display:block;padding:8px 10px}.tm-avatar-page-selected{margin-bottom:7px}.tm-avatar-page-action-buttons{display:grid;grid-template-columns:1fr 1fr}.tm-avatar-page-action-buttons button{min-width:0;padding:6px;font-size:.74em}.tm-avatar-page-empty{padding:18px 14px}}',
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
        var toast = options.toast || function () {};
        var confirmDelete = options.confirm || global.confirm;
        var mounted = false;
        var root = null;
        var fileInput = null;
        var gridLoader = null;
        var assets = [];
        var selectedId = '';
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
            if (!root) return;
            Array.prototype.forEach.call(root.querySelectorAll('[data-avatar-action="pick"]'), function (button) { button.disabled = importing; });
            if (importing) setNotice('正在添加头像…', 'loading');
        }
        function selectedAsset() { return assets.find(function (asset) { return asset.id === selectedId; }) || null; }
        function cardHtml(asset) {
            return '<article class="tm-avatar-page-card' + (asset.id === selectedId ? ' selected' : '') + '" data-avatar-id="' + esc(asset.id) + '" tabindex="0" role="button" aria-label="选择头像 ' + esc(asset.name) + '">' +
                '<img class="tm-avatar-page-thumb" src="' + esc(imageLoaderApi.PLACEHOLDER_SRC) + '" data-image-key="' + esc(asset.id) + '" alt="">' +
                '<span class="tm-avatar-page-name" title="' + esc(asset.name) + '">' + esc(asset.name) + '</span>' +
                '<button type="button" class="tm-card-menu tm-avatar-page-delete" data-avatar-action="delete" data-avatar-id="' + esc(asset.id) + '" title="删除头像" aria-label="删除 ' + esc(asset.name) + '"><i class="fa-solid fa-trash"></i></button></article>';
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
        function updateActions() {
            if (!root) return Promise.resolve();
            var selected = selectedAsset();
            var actions = root.querySelector('[data-avatar-actions]');
            var selectedLabel = root.querySelector('[data-avatar-selected]');
            selectedLabel.textContent = selected ? ('已选择：' + selected.name) : '';
            selectedLabel.hidden = !selected;
            var caps = runtime.getCapabilities();
            var character = root.querySelector('[data-avatar-action="apply-character"]');
            var user = root.querySelector('[data-avatar-action="apply-user"]');
            character.hidden = !selected;
            user.hidden = !selected;
            character.disabled = !selected || !caps.character.available || !caps.themeKey;
            user.disabled = !selected || !caps.user.available || !caps.themeKey;
            character.title = caps.character.reason || '';
            user.title = caps.user.reason || '';
            return Promise.all([
                caps.character.target && caps.themeKey ? store.getBinding(caps.themeKey, caps.character.target.key) : null,
                caps.user.target && caps.themeKey ? store.getBinding(caps.themeKey, caps.user.target.key) : null,
            ]).then(function (bindings) {
                if (!root) return;
                var restoreCharacter = root.querySelector('[data-avatar-action="restore-character"]');
                var restoreUser = root.querySelector('[data-avatar-action="restore-user"]');
                restoreCharacter.hidden = !bindings[0];
                restoreUser.hidden = !bindings[1];
                actions.hidden = !selected && !bindings[0] && !bindings[1];
            });
        }
        function render() {
            if (!root) return;
            var grid = root.querySelector('[data-avatar-grid]');
            root.querySelector('[data-avatar-tools]').hidden = assets.length === 0;
            grid.innerHTML = assets.length
                ? assets.map(cardHtml).join('')
                : '<div class="tm-avatar-page-empty"><i class="fa-regular fa-image"></i><strong>还没有头像</strong><span>添加一张图片开始使用</span><button type="button" class="tm-catbtn tm-avatar-page-pick" data-avatar-action="pick"><i class="fa-solid fa-plus"></i> 添加头像</button></div>';
            setupGridLoader();
            setImporting(importing);
            updateActions().catch(function (error) {
                reportError('actions refresh failed', error);
                setNotice('头像状态读取失败', 'error');
            });
        }
        function refresh() {
            var token = ++refreshToken;
            return store.listAssets().then(function (items) {
                if (!mounted || token !== refreshToken) return;
                assets = (items || []).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
                if (selectedId && !assets.some(function (asset) { return asset.id === selectedId; })) selectedId = '';
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
                if (passed.length) selectedId = passed[passed.length - 1].asset.id;
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
        function beginEdit(kind) {
            var selected = selectedAsset();
            if (!selected) return;
            var caps = runtime.getCapabilities();
            var cap = kind === 'character' ? caps.character : caps.user;
            if (!caps.themeKey || !cap.available) { setNotice(!caps.themeKey ? '无法识别当前美化' : cap.reason); return; }
            closeManager();
            global.requestAnimationFrame(function () {
                runtime.beginEdit({ target: cap.target, avatarId: selected.id }).catch(function (error) {
                    toast(error.message || '无法启动头像调整', true);
                });
            });
        }
        function deleteAvatar(id) {
            var asset = assets.find(function (item) { return item.id === id; });
            if (!asset || !confirmDelete('确定删除头像「' + asset.name + '」吗？使用它的绑定会同时清理。')) return;
            runtime.deleteAsset(id).then(function () {
                if (selectedId === id) selectedId = '';
                toast('已删除头像并清理相关绑定');
                return refresh();
            }).catch(function (error) { setNotice('删除失败：' + error.message); });
        }
        function handleClick(event) {
            var action = event.target && event.target.closest ? event.target.closest('[data-avatar-action]') : null;
            if (action && root.contains(action)) {
                var name = action.getAttribute('data-avatar-action');
                if (name === 'pick') fileInput.click();
                else if (name === 'delete') deleteAvatar(action.getAttribute('data-avatar-id'));
                else if (name === 'apply-character') beginEdit('character');
                else if (name === 'apply-user') beginEdit('user');
                else if (name === 'restore-character' || name === 'restore-user') {
                    runtime.clearBinding(name === 'restore-character' ? 'character' : 'user').then(function () {
                        toast('已恢复 SillyTavern 原头像'); updateActions();
                    }).catch(function (error) { setNotice(error.message); });
                }
                return;
            }
            var card = event.target && event.target.closest ? event.target.closest('[data-avatar-id]') : null;
            if (card && root.contains(card)) {
                selectedId = card.getAttribute('data-avatar-id'); render();
            }
        }
        function handleKeydown(event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            var card = event.target && event.target.closest ? event.target.closest('.tm-avatar-page-card') : null;
            if (!card) return;
            event.preventDefault(); selectedId = card.getAttribute('data-avatar-id'); render();
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
            if (root) {
                root.removeEventListener('click', handleClick);
                root.removeEventListener('keydown', handleKeydown);
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
            getState: function () { return { mounted: mounted, selectedId: selectedId, count: assets.length, importing: importing }; },
        };
    };

    ns.avatarPage = { buildPageHtml: buildPageHtml, styleText: styleText };
})(window);
