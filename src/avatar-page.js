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
            '<div class="tm-avatar-page-top"><div><h2>头像管理</h2><p>本设备头像库 · 实际应用使用高清主图</p></div>' +
            '<button type="button" class="tm-avatar-page-primary" data-avatar-action="pick"><i class="fa-solid fa-plus"></i> 添加头像</button>' +
            '<input type="file" data-avatar-file accept="image/*" multiple hidden></div>' +
            '<div class="tm-avatar-page-notice" data-avatar-notice hidden></div>' +
            '<div class="tm-avatar-page-grid" data-avatar-grid><div class="tm-avatar-page-loading">正在读取头像库…</div></div>' +
            '<div class="tm-avatar-page-actions" data-avatar-actions hidden>' +
            '<div class="tm-avatar-page-selected" data-avatar-selected></div>' +
            '<button type="button" data-avatar-action="apply-character">用于当前角色并调整</button>' +
            '<button type="button" data-avatar-action="apply-user">用于 User 并调整</button>' +
            '</div>' +
            '<div class="tm-avatar-page-restore">' +
            '<button type="button" data-avatar-action="restore-character">恢复当前角色原头像</button>' +
            '<button type="button" data-avatar-action="restore-user">恢复 User 原头像</button>' +
            '</div></div>';
    }

    function styleText() {
        return [
            '.tm-app-page-avatars{min-width:0;overflow:hidden}',
            '.tm-avatar-page{height:100%;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:14px;overflow:hidden}',
            '.tm-avatar-page-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:0 0 auto}',
            '.tm-avatar-page-top h2{margin:0;font-size:1.08rem}.tm-avatar-page-top p{margin:3px 0 0;opacity:.62;font-size:.78rem}',
            '.tm-avatar-page button{appearance:none;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:9px;background:color-mix(in srgb,currentColor 8%,transparent);color:inherit;padding:8px 10px;min-height:36px;font:inherit;cursor:pointer}',
            '.tm-avatar-page button:disabled{opacity:.38;cursor:not-allowed}.tm-avatar-page .tm-avatar-page-primary{background:#7c4dff;color:#fff;border-color:transparent;font-weight:650;white-space:nowrap}',
            '.tm-avatar-page-notice{flex:0 0 auto;padding:8px 10px;border-radius:8px;background:rgba(196,67,67,.13);color:#c44343;font-size:.8rem}',
            '.tm-avatar-page-grid{min-width:0;flex:1 1 auto;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));align-content:start;gap:10px;padding:2px 2px 12px}',
            '.tm-avatar-page-card{min-width:0;position:relative;border:2px solid transparent;border-radius:12px;padding:6px;background:color-mix(in srgb,currentColor 5%,transparent);cursor:pointer}',
            '.tm-avatar-page-card.selected{border-color:#9d6cff;background:rgba(157,108,255,.12)}',
            '.tm-avatar-page-thumb{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:rgba(127,127,127,.13)}',
            '.tm-avatar-page-name{display:block;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem}',
            '.tm-avatar-page-delete{position:absolute;right:9px;top:9px!important;min-width:30px!important;min-height:30px!important;padding:4px!important;border-radius:50%!important;background:rgba(24,24,28,.8)!important;color:#fff!important}',
            '.tm-avatar-page-actions,.tm-avatar-page-restore{flex:0 0 auto;display:flex;gap:8px;align-items:center;min-width:0}',
            '.tm-avatar-page-actions[hidden]{display:none}.tm-avatar-page-selected{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem}',
            '.tm-avatar-page-restore{justify-content:flex-end}.tm-avatar-page-loading,.tm-avatar-page-empty{grid-column:1/-1;align-self:center;text-align:center;padding:42px 16px;opacity:.65}',
            '@media(max-width:430px){.tm-avatar-page{padding:10px;gap:9px}.tm-avatar-page-top{align-items:flex-start}.tm-avatar-page-top p{display:none}.tm-avatar-page-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.tm-avatar-page-actions{display:grid;grid-template-columns:1fr 1fr}.tm-avatar-page-selected{grid-column:1/-1}.tm-avatar-page-actions button,.tm-avatar-page-restore button{min-width:0;padding:7px 5px;font-size:.75rem}.tm-avatar-page-restore{display:grid;grid-template-columns:1fr 1fr}}',
        ].join('');
    }

    ns.createAvatarPage = function (options) {
        options = options || {};
        var doc = options.document || global.document;
        var store = options.store;
        var processor = options.processor;
        var runtime = options.runtime;
        var imageLoaderApi = options.imageLoader;
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
        function setNotice(message) {
            if (!root) return;
            var notice = root.querySelector('[data-avatar-notice]');
            notice.textContent = message || '';
            notice.hidden = !message;
        }
        function selectedAsset() { return assets.find(function (asset) { return asset.id === selectedId; }) || null; }
        function cardHtml(asset) {
            return '<article class="tm-avatar-page-card' + (asset.id === selectedId ? ' selected' : '') + '" data-avatar-id="' + esc(asset.id) + '" tabindex="0" role="button" aria-label="选择头像 ' + esc(asset.name) + '">' +
                '<img class="tm-avatar-page-thumb" src="' + esc(imageLoaderApi.PLACEHOLDER_SRC) + '" data-image-key="' + esc(asset.id) + '" alt="">' +
                '<span class="tm-avatar-page-name" title="' + esc(asset.name) + '">' + esc(asset.name) + '</span>' +
                '<button type="button" class="tm-avatar-page-delete" data-avatar-action="delete" data-avatar-id="' + esc(asset.id) + '" title="删除头像" aria-label="删除 ' + esc(asset.name) + '"><i class="fa-solid fa-trash"></i></button></article>';
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
            actions.hidden = !selected;
            root.querySelector('[data-avatar-selected]').textContent = selected ? ('已选择：' + selected.name) : '';
            var caps = runtime.getCapabilities();
            var character = root.querySelector('[data-avatar-action="apply-character"]');
            var user = root.querySelector('[data-avatar-action="apply-user"]');
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
                restoreCharacter.disabled = !bindings[0];
                restoreUser.disabled = !bindings[1];
            });
        }
        function render() {
            if (!root) return;
            var grid = root.querySelector('[data-avatar-grid]');
            grid.innerHTML = assets.length
                ? assets.map(cardHtml).join('')
                : '<div class="tm-avatar-page-empty"><i class="fa-solid fa-user-plus"></i><p>头像库还是空的，先添加一张图片吧</p></div>';
            setupGridLoader();
            updateActions();
        }
        function refresh() {
            var token = ++refreshToken;
            return store.listAssets().then(function (items) {
                if (!mounted || token !== refreshToken) return;
                assets = (items || []).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
                if (selectedId && !assets.some(function (asset) { return asset.id === selectedId; })) selectedId = '';
                render();
            }).catch(function (error) { if (mounted) setNotice('头像库读取失败：' + error.message); });
        }
        function importFiles(files) {
            files = Array.prototype.slice.call(files || []);
            if (!files.length) return Promise.resolve([]);
            setNotice('');
            return Promise.all(files.map(function (file) {
                return processor.processFile(file).then(function (asset) {
                    return store.putAsset(asset).then(function (saved) {
                        runtime.notifyAssetChanged(saved.id);
                        return { ok: true, asset: saved };
                    });
                }).catch(function (error) { return { ok: false, name: file.name, error: error }; });
            })).then(function (results) {
                var failed = results.filter(function (item) { return !item.ok; });
                var passed = results.filter(function (item) { return item.ok; });
                if (passed.length) selectedId = passed[passed.length - 1].asset.id;
                if (failed.length) setNotice(failed.map(function (item) { return item.name + '：' + item.error.message; }).join('；'));
                if (passed.length) toast('✅ 已添加 ' + passed.length + ' 张头像');
                return refresh().then(function () { return results; });
            });
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
                refresh();
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
        function handleFileChange() {
            var files = fileInput.files;
            fileInput.value = '';
            importFiles(files);
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
            getState: function () { return { mounted: mounted, selectedId: selectedId, count: assets.length }; },
        };
    };

    ns.avatarPage = { buildPageHtml: buildPageHtml, styleText: styleText };
})(window);
