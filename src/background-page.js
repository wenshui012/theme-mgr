(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var STYLE_ID = 'tm-background-page-style';

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildPageHtml(placeholder) {
        return '<div class="tm-background-page" data-background-page>' +
            '<input type="file" data-background-file accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.apng" multiple hidden>' +
            '<div class="tm-search-bar" data-background-search-bar><div class="tm-search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input class="tm-search-inp" data-background-search placeholder="搜索背景名称或分类…" autocomplete="off"></div><button class="tm-search-clear" data-background-search-clear aria-label="清除搜索"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="tm-sortbar" data-background-sortbar><span style="font-size:.72em;opacity:.4;flex-shrink:0">排序：</span><button class="tm-sort-chip on" data-background-sort="name">名称</button><button class="tm-sort-chip" data-background-sort="starred">收藏优先</button><span class="tm-sort-divider"></span><span class="tm-grid-size-label">网格</span><button type="button" class="tm-grid-size-btn" data-background-grid-zoom="out" title="缩小图片" aria-label="缩小背景图片"><i class="fa-solid fa-minus"></i></button><button type="button" class="tm-grid-size-btn" data-background-grid-zoom="in" title="放大图片" aria-label="放大背景图片"><i class="fa-solid fa-plus"></i></button></div>' +
            '<div class="tm-catbar tm-background-catbar" data-background-catbar></div>' +
            '<div class="tm-batch-area" data-background-batch-area></div>' +
            '<div class="tm-background-notice" data-background-notice role="status" aria-live="polite" hidden></div>' +
            '<div class="tm-background-grid" data-background-grid><div class="tm-background-loading">正在读取酒馆背景…</div></div>' +
            '<img src="' + esc(placeholder || '') + '" alt="" hidden>' +
            '</div>';
    }

    function styleText() {
        return [
            '.tm-app-page-backgrounds{display:block;place-items:initial;min-width:0;overflow:hidden;padding:0}',
            '.tm-background-page{height:100%;min-width:0;display:flex;flex-direction:column;overflow:hidden}',
            '.tm-background-notice{flex:0 0 auto;margin:9px 14px 0;padding:8px 10px;border:var(--tm-control-border-style,1px solid var(--tm-control-border,rgba(127,127,127,.16)));border-radius:var(--tm-control-radius,8px);background:var(--tm-control-bg,rgba(127,127,127,.06));font-size:.8em}.tm-background-notice[data-kind="loading"] i{display:inline-block;margin-right:6px;animation:tm-spin 1s linear infinite}.tm-background-notice[data-kind="error"]{border-color:rgba(229,115,115,.7)}',
            '.tm-background-grid{--tm-background-card-min:156px;min-width:0;min-height:0;flex:1 1 auto;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--tm-background-card-min),1fr));grid-auto-rows:max-content;align-content:start;align-items:start;gap:10px;padding:12px;touch-action:pan-x pan-y!important;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}',
            '.tm-background-card{min-width:0;position:relative;overflow:hidden;aspect-ratio:16/9;border:var(--tm-card-border-style,2px solid var(--tm-card-border,transparent));border-radius:var(--tm-card-radius,10px);background:var(--tm-card-bg,rgba(127,127,127,.06));box-shadow:var(--tm-card-shadow,none);cursor:pointer;content-visibility:auto;contain-intrinsic-size:156px 88px}',
            '.tm-background-card:focus-visible{outline:2px solid var(--SmartThemeQuoteColor,#7c6daf);outline-offset:2px}',
            '.tm-background-thumb{position:absolute;inset:0;overflow:hidden;background:var(--tm-control-bg,rgba(127,127,127,.1))}.tm-background-thumb>img{display:block;width:100%;height:100%;object-fit:cover;opacity:.72;transition:opacity .18s;pointer-events:none;-webkit-user-drag:none}.tm-background-thumb>img.tm-image-loaded{opacity:1}',
            '.tm-background-menu{position:absolute;right:1px;bottom:1px;z-index:4;display:grid;place-items:center;width:44px;height:44px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:#fff;cursor:pointer;opacity:.78;filter:drop-shadow(0 1px 3px rgba(0,0,0,.75))}.tm-background-menu:hover,.tm-background-menu:focus-visible{opacity:1;outline:2px solid var(--SmartThemeQuoteColor,#7c6daf);outline-offset:-5px}',
            '.tm-background-card-check{position:absolute;top:6px;left:6px;z-index:4;width:24px;height:24px;display:grid;place-items:center;border:2px solid rgba(255,255,255,.72);border-radius:50%;background:rgba(0,0,0,.4);color:transparent;font-size:.68em;pointer-events:none}.tm-background-card.batch-sel{border-color:var(--SmartThemeQuoteColor,#7c6daf);opacity:.88}.tm-background-card.batch-sel .tm-background-card-check{border-color:var(--SmartThemeQuoteColor,#7c6daf);background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff}',
            '.tm-background-loading,.tm-background-empty{grid-column:1/-1;align-self:center;justify-self:center;text-align:center;padding:24px 16px;opacity:.55}.tm-background-empty{display:flex;flex-direction:column;gap:7px;align-items:center}.tm-background-empty i{font-size:1.7em}',
            '.tm-background-category-actions{display:flex;gap:4px}.tm-background-category-actions button{width:30px;height:30px;padding:0}',
            '.tm-background-action-copy{display:flex;min-width:0;flex-direction:column;gap:2px;overflow-wrap:anywhere}.tm-background-action-copy strong{font-size:.92em}.tm-background-action-copy small{font-size:.7em;font-weight:400;opacity:.5}',
            '@media(max-width:430px){.tm-background-grid{gap:7px;padding:10px}.tm-background-notice{margin:8px 10px 0}}',
        ].join('');
    }

    ns.createBackgroundPage = function (options) {
        options = options || {};
        var doc = options.document || global.document;
        var service = options.backgrounds;
        var library = options.library || ns.backgroundLibrary;
        var imageLoaderApi = options.imageLoader || ns.imageLoader;
        var getRoot = options.getRoot;
        var createSheet = options.createSheet;
        var closeSheet = options.closeSheet;
        var createActionDialog = options.createActionDialog;
        var openImageLightbox = options.openImageLightbox;
        var openCategoryPicker = options.openCategoryPicker;
        var loadUiData = options.loadUiData;
        var saveUiData = options.saveUiData;
        var toast = options.toast || function () {};
        var confirmAction = options.confirm || global.confirm;
        var onStateChange = options.onStateChange || function () {};
        var onBatchModeChange = options.onBatchModeChange || function () {};
        var logger = options.console || global.console || { warn: function () {}, error: function () {} };
        var mounted = false;
        var root = null;
        var fileInput = null;
        var gridLoader = null;
        var backgrounds = [];
        var visibleBackgrounds = [];
        var refreshToken = 0;
        var searchOpen = false;
        var sortOpen = false;
        var query = '';
        var category = '__all__';
        var busy = false;
        var batchMode = false;
        var batchSelected = new Set();
        var batchDeleting = false;

        function data() {
            var value = loadUiData();
            library.ensureState(value);
            return value;
        }

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
            var notice = root.querySelector('[data-background-notice]');
            notice.innerHTML = kind === 'loading' && message ? '<i class="fa-solid fa-spinner"></i>' + esc(message) : esc(message || '');
            if (kind) notice.setAttribute('data-kind', kind);
            else notice.removeAttribute('data-kind');
            notice.hidden = !message;
        }

        function publishState() {
            onStateChange(getState());
        }

        function setBusy(next) {
            busy = next === true;
            if (fileInput) fileInput.disabled = busy;
            if (root) renderBatch();
            publishState();
        }

        function persist(value, message) {
            return Promise.resolve(saveUiData(value)).then(function () {
                if (message) toast(message);
                publishState();
                return true;
            }).catch(function (error) {
                logger.error('[Theme Manager][Background] metadata save failed', error);
                setNotice('背景分类与收藏信息保存失败，请重试', 'error');
                throw error;
            });
        }

        function renderCategoryBar(state) {
            var bar = root.querySelector('[data-background-catbar]');
            var libraryState = library.ensureState(state);
            if (!libraryState.categories.length) {
                bar.innerHTML = '';
                bar.style.display = 'none';
                category = '__all__';
                return;
            }
            bar.style.display = '';
            var rows = [
                { value: '__all__', label: '全部' },
                { value: '__uncategorized__', label: '未分类' },
            ].concat(libraryState.categories.map(function (name) {
                return { value: name, label: name };
            }));
            bar.innerHTML = rows.map(function (item) {
                return '<button type="button" class="tm-catbtn' + (category === item.value ? ' on' : '') + '" data-background-category="' + esc(item.value) + '">' + esc(item.label) + '</button>';
            }).join('');
        }

        function renderBatch() {
            if (!root) return;
            var area = root.querySelector('[data-background-batch-area]');
            onBatchModeChange(batchMode);
            if (!batchMode) {
                area.innerHTML = '';
                area.style.display = 'none';
                return;
            }
            var disabled = busy || batchDeleting ? ' disabled' : '';
            area.style.display = '';
            area.innerHTML = '<div class="tm-batch-bar"><span class="tm-batch-info">' +
                (batchDeleting ? '正在删除 <b>' + batchSelected.size + '</b> 张…' : '已选 <b data-background-batch-count>' + batchSelected.size + '</b> 张') +
                '</span><div class="tm-batch-divider"></div><div class="tm-batch-acts">' +
                '<button type="button" class="tm-batch-btn" data-background-batch="all"' + disabled + '>全选</button>' +
                '<button type="button" class="tm-batch-btn" data-background-batch="none"' + disabled + '>取消</button>' +
                '<button type="button" class="tm-batch-btn" data-background-batch="category"' + disabled + '><i class="fa-solid fa-folder"></i> 分类</button>' +
                '<button type="button" class="tm-batch-btn" data-background-batch="export"' + disabled + '><i class="fa-solid fa-file-zipper"></i> 导出</button>' +
                '<button type="button" class="tm-batch-btn danger" data-background-batch="delete"' + disabled + '><i class="fa-solid fa-trash"></i> 删除</button>' +
                '</div></div>';
        }

        function updateBatchCount() {
            if (!root) return;
            var count = root.querySelector('[data-background-batch-count]');
            if (count) count.textContent = String(batchSelected.size);
        }

        function syncBatchCard(card) {
            if (!card) return;
            var selected = batchSelected.has(card.dataset.backgroundName);
            card.classList.toggle('batch-sel', selected);
            var icon = card.querySelector('.tm-background-card-check i');
            if (icon) {
                icon.classList.toggle('fa-check', selected);
                icon.classList.toggle('fa-plus', !selected);
            }
        }

        function syncRenderedBatchCards() {
            if (!root) return;
            root.querySelectorAll('.tm-background-card').forEach(syncBatchCard);
            updateBatchCount();
        }

        function filteredNames(state) {
            var needle = query.trim().toLocaleLowerCase();
            return backgrounds.filter(function (name) {
                if (!library.matchesCategory(state, name, category)) return false;
                if (!needle) return true;
                var meta = library.peekMeta(state, name);
                return (name + '\n' + meta.category).toLocaleLowerCase().indexOf(needle) !== -1;
            }).sort(function (a, b) { return library.compareNames(state, a, b); });
        }

        function disconnectLoader() {
            if (gridLoader) gridLoader.disconnect();
            gridLoader = null;
        }

        function render() {
            if (!root) return;
            disconnectLoader();
            var state = data();
            var libraryState = library.ensureState(state);
            renderCategoryBar(state);
            renderBatch();
            root.querySelectorAll('[data-background-sort]').forEach(function (button) {
                button.classList.toggle('on', button.dataset.backgroundSort === libraryState.sortMode);
            });
            visibleBackgrounds = filteredNames(state);
            var grid = root.querySelector('[data-background-grid]');
            grid.style.setProperty('--tm-background-card-min', libraryState.cardSize + 'px');
            if (!visibleBackgrounds.length) {
                grid.innerHTML = '<div class="tm-background-empty"><i class="fa-regular fa-image"></i><span>' + (query ? '没有符合条件的背景' : '这个分类里还没有背景') + '</span></div>';
                publishState();
                return;
            }
            grid.innerHTML = visibleBackgrounds.map(function (name) {
                var meta = library.peekMeta(state, name);
                var selected = batchSelected.has(name);
                var check = batchMode ? '<span class="tm-background-card-check"><i class="fa-solid ' + (selected ? 'fa-check' : 'fa-plus') + '"></i></span>' : '';
                var star = meta.starred && !batchMode ? '<span class="tm-badge-star" title="已收藏"><i class="fa-solid fa-star"></i></span>' : '';
                var menu = batchMode ? '' : '<button type="button" class="tm-background-menu" data-background-menu="' + esc(name) + '" title="管理背景" aria-label="管理背景 ' + esc(name) + '"><i class="fa-solid fa-ellipsis"></i></button>';
                return '<div class="tm-background-card' + (selected ? ' batch-sel' : '') + '" data-background-name="' + esc(name) + '" role="button" tabindex="0" aria-label="预览背景 ' + esc(name) + '，分类 ' + esc(meta.category || '未分类') + '">' +
                    '<div class="tm-background-thumb"><img src="' + esc(imageLoaderApi.PLACEHOLDER_SRC) + '" data-background-image="' + esc(name) + '" alt="" loading="lazy"></div>' +
                    check + star + menu +
                    '</div>';
            }).join('');
            gridLoader = imageLoaderApi.createImageLoader({
                root: grid,
                rootMargin: '240px 0px',
                getKey: function (image) { return image.dataset.backgroundImage || ''; },
                resolveSource: function (name) { return service.getBackgroundThumbnailSource(name); },
            });
            gridLoader.observe(grid.querySelectorAll('img[data-background-image]'));
            publishState();
        }

        function refresh(force) {
            var token = ++refreshToken;
            if (root) setNotice('正在读取酒馆背景…', 'loading');
            return service.getBackgroundListPromise(force === true).then(function (items) {
                if (!mounted || token !== refreshToken) return [];
                backgrounds = (items || []).slice();
                setNotice('', '');
                render();
                return backgrounds.slice();
            }).catch(function (error) {
                logger.error('[Theme Manager][Background] refresh failed', error);
                if (mounted && token === refreshToken) setNotice('背景列表读取失败，请检查酒馆或 TT 接口', 'error');
                throw error;
            });
        }

        function viewBackground(name) {
            openImageLightbox(visibleBackgrounds.map(function (item) {
                return { key: item, label: item, source: service.getBackgroundPath(item) };
            }), name);
        }

        function setBackgroundCategory(name) {
            var state = data();
            var categories = library.ensureState(state).categories;
            if (!categories.length) {
                toast('请先添加背景分类', true);
                openCategoryManager();
                return;
            }
            openCategoryPicker({
                categories: categories,
                selected: library.peekMeta(state, name).category,
                allowClear: true,
                title: '设置背景分类',
                onSelect: function (value) {
                    var next = data();
                    var result = library.setCategory(next, name, value);
                    if (!result.ok) { toast('目标分类已不存在', true); return; }
                    persist(next, value ? '已移动到「' + value + '」' : '已设为未分类').then(render);
                },
            });
        }

        function exportOne(name) {
            if (busy) return;
            setBusy(true);
            setNotice('正在导出「' + name + '」…', 'loading');
            service.exportBackground(name).then(function () {
                setNotice('', '');
                toast('已导出背景原图');
            }).catch(function (error) {
                logger.error('[Theme Manager][Background] export failed', error);
                setNotice(error.message || '背景导出失败', 'error');
                toast(error.message || '背景导出失败', true);
            }).finally(function () { setBusy(false); });
        }

        function deleteOne(name) {
            if (busy) return;
            var bindingCount = service.countThemeBindings(name);
            var message = '永久删除背景「' + name + '」？\n删除后无法恢复。';
            if (bindingCount) message += '\n\n它正被 ' + bindingCount + ' 个美化绑定，删除后这些绑定会自动清除。';
            if (!confirmAction(message)) return;
            setBusy(true);
            setNotice('正在删除「' + name + '」…', 'loading');
            service.deleteBackgroundOnServer(name).then(function (result) {
                if (!result.metadataSaved) {
                    setNotice('背景文件已删除，但分类或绑定整理信息保存失败，请勿立即关闭酒馆', 'error');
                    toast('背景已删除，但整理信息保存失败', true);
                } else {
                    setNotice('', '');
                    toast(result.themeBindingsCleared ? '已删除背景并清除 ' + result.themeBindingsCleared + ' 个美化绑定' : '已删除背景');
                }
                return refresh(false);
            }).catch(function (error) {
                logger.error('[Theme Manager][Background] delete failed', error);
                setNotice(error.message || '背景删除失败', 'error');
                toast(error.message || '背景删除失败', true);
            }).finally(function () { setBusy(false); });
        }

        function openBackgroundMenu(name) {
            var state = data();
            var meta = library.peekMeta(state, name);
            var dialog = createActionDialog('<div class="tm-action-dialog-title"><i class="fa-solid fa-image"></i><span class="tm-background-action-copy"><strong>' + esc(name) + '</strong><small>' + esc(meta.category || '未分类') + '</small></span></div><div class="tm-action-dialog-list">' +
                '<button type="button" class="tm-action-dialog-item" data-background-action="favorite"><i class="fa-' + (meta.starred ? 'solid' : 'regular') + ' fa-star"></i><span><strong>' + (meta.starred ? '取消收藏' : '收藏') + '</strong><small>收藏后可使用“收藏优先”排序</small></span></button>' +
                '<button type="button" class="tm-action-dialog-item" data-background-action="category"><i class="fa-solid fa-folder"></i><span><strong>修改分类</strong><small>' + esc(meta.category || '当前未分类') + '</small></span></button>' +
                '<button type="button" class="tm-action-dialog-item" data-background-action="export"><i class="fa-solid fa-download"></i><span><strong>导出原图</strong><small>保存酒馆中的原始背景文件</small></span></button>' +
                '<div class="tm-action-dialog-divider"></div>' +
                '<button type="button" class="tm-action-dialog-item is-danger" data-background-action="delete"><i class="fa-solid fa-trash"></i><span><strong>永久删除</strong><small>同时清理分类、收藏与美化绑定</small></span></button>' +
                '</div>');
            dialog.addEventListener('click', function (event) {
                var button = event.target.closest('[data-background-action]');
                if (!button) return;
                var action = button.dataset.backgroundAction;
                closeSheet(dialog);
                if (action === 'favorite') {
                    var next = data();
                    var starred = library.toggleStarred(next, name);
                    persist(next, starred ? '已收藏背景' : '已取消收藏').then(render);
                } else if (action === 'category') setBackgroundCategory(name);
                else if (action === 'export') exportOne(name);
                else if (action === 'delete') deleteOne(name);
            });
        }

        function orderedBatchNames() {
            var state = data();
            return backgrounds.slice().sort(function (a, b) { return library.compareNames(state, a, b); }).filter(function (name) { return batchSelected.has(name); });
        }

        function applyBatchCategory() {
            if (!batchSelected.size) { toast('请先选择背景', true); return; }
            var state = data();
            var categories = library.ensureState(state).categories;
            if (!categories.length) { toast('还没有分类，请先在设置中添加', true); return; }
            openCategoryPicker({
                categories: categories,
                allowClear: true,
                title: '批量设置背景分类',
                onSelect: function (value) {
                    var next = data();
                    batchSelected.forEach(function (name) { library.setCategory(next, name, value); });
                    persist(next, value ? '已批量移动到「' + value + '」' : '已批量设为未分类').then(render);
                },
            });
        }

        function exportBatchSelection() {
            var names = orderedBatchNames();
            if (!names.length) { toast('请先选择背景', true); return Promise.resolve(false); }
            if (busy) return Promise.resolve(false);
            setBusy(true);
            setNotice('正在读取并打包 ' + names.length + ' 张背景…', 'loading');
            renderBatch();
            return service.exportBackgroundBatch(names).then(function () {
                setNotice('', '');
                toast('已导出 ' + names.length + ' 张背景原图');
                return true;
            }).catch(function (error) {
                logger.error('[Theme Manager][Background] batch export failed', error);
                setNotice(error.message || '背景批量导出失败', 'error');
                toast(error.message || '背景批量导出失败', true);
                return false;
            }).finally(function () { setBusy(false); renderBatch(); });
        }

        function deleteBatchSelection() {
            if (busy || batchDeleting) return;
            var names = orderedBatchNames();
            if (!names.length) { toast('请先选择背景', true); return; }
            var bindingCount = names.reduce(function (total, name) { return total + service.countThemeBindings(name); }, 0);
            var message = '永久删除已选的 ' + names.length + ' 张背景？\n删除后无法恢复。';
            if (bindingCount) message += '\n\n它们正被 ' + bindingCount + ' 个美化绑定，删除后这些绑定会自动清除。';
            if (!confirmAction(message)) return;
            batchDeleting = true;
            setBusy(true);
            render();
            var removed = [];
            var failed = [];
            names.reduce(function (promise, name) {
                return promise.then(function () {
                    setNotice('正在删除背景 ' + (removed.length + failed.length + 1) + ' / ' + names.length + '…', 'loading');
                    return service.deleteBackgroundOnServer(name).then(function () { removed.push(name); }, function (error) { failed.push({ name: name, error: error }); });
                });
            }, Promise.resolve()).then(function () {
                return refresh(false);
            }).then(function () {
                batchSelected = new Set(failed.map(function (item) { return item.name; }));
                if (failed.length) {
                    setNotice('已删除 ' + removed.length + ' 张，失败 ' + failed.length + ' 张', 'error');
                    toast('已删除 ' + removed.length + ' 张；未删除：' + failed.map(function (item) { return item.name; }).join('、'), true);
                } else {
                    setNotice('', '');
                    toast('已删除 ' + removed.length + ' 张背景');
                }
            }).catch(function (error) {
                logger.error('[Theme Manager][Background] batch delete failed', error);
                setNotice(error.message || '背景批量删除失败', 'error');
                toast(error.message || '背景批量删除失败', true);
            }).finally(function () {
                batchDeleting = false;
                setBusy(false);
                render();
            });
        }

        function isImageFile(file) {
            return !!file && Number(file.size) > 0 && (/^image\//i.test(file.type || '') || /\.(?:jpe?g|png|webp|gif|apng)$/i.test(file.name || ''));
        }

        function isSafeUploadName(name) {
            name = String(name || '');
            var base = name.replace(/\.[^.]*$/, '');
            return !!name && name.length <= 180 && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !/[. ]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base);
        }

        function importFiles(files) {
            if (busy) return Promise.reject(new Error('已有背景操作正在进行'));
            files = Array.prototype.slice.call(files || []);
            if (!files.length) return Promise.resolve([]);
            setBusy(true);
            var imported = [];
            var failed = [];
            var skipped = [];
            var state = data();
            var importCategory = category !== '__all__' && category !== '__starred__' && category !== '__uncategorized__' && library.ensureState(state).categories.indexOf(category) !== -1 ? category : '';
            return service.getBackgroundListPromise(true).then(function (existing) {
                var names = Object.create(null);
                existing.forEach(function (name) { names[String(name).toLocaleLowerCase()] = true; });
                return files.reduce(function (promise, file, index) {
                    return promise.then(function () {
                        setNotice('正在导入背景 ' + (index + 1) + ' / ' + files.length + '…', 'loading');
                        if (!isImageFile(file)) { failed.push({ name: file && file.name || '未命名文件', message: '不是有效图片' }); return; }
                        if (!isSafeUploadName(file.name)) { failed.push({ name: file.name, message: '文件名包含酒馆不支持的字符，请先重命名' }); return; }
                        var key = String(file.name || '').toLocaleLowerCase();
                        if (names[key]) { skipped.push(file.name); return; }
                        return service.uploadBackgroundFile(file).then(function (savedName) {
                            names[String(savedName).toLocaleLowerCase()] = true;
                            imported.push(savedName);
                            if (importCategory) library.setCategory(state, savedName, importCategory);
                        }).catch(function (error) {
                            failed.push({ name: file.name, message: error.message || '上传失败' });
                        });
                    });
                }, Promise.resolve());
            }).then(function () {
                return imported.length && importCategory ? persist(state) : true;
            }).then(function () {
                return refresh(true);
            }).then(function () {
                var summary = '导入完成：成功 ' + imported.length + ' 张';
                if (skipped.length) summary += '，同名跳过 ' + skipped.length + ' 张';
                if (failed.length) summary += '，失败 ' + failed.length + ' 张';
                if (failed.length) {
                    setNotice(summary + '；' + failed.slice(0, 3).map(function (item) { return item.name + '：' + item.message; }).join('；'), 'error');
                    toast(summary, true);
                } else {
                    setNotice('', '');
                    toast(summary);
                }
                return { imported: imported, skipped: skipped, failed: failed };
            }).catch(function (error) {
                logger.error('[Theme Manager][Background] import failed', error);
                setNotice(error.message || '背景导入失败', 'error');
                throw error;
            }).finally(function () { setBusy(false); });
        }

        function openCategoryRenameSheet(name, parentSheet) {
            var sheet = createSheet('<div class="tm-sheet-title"><i class="fa-solid fa-pen"></i>重命名背景分类</div><div class="tm-field"><label>分类名称</label><input type="text" data-background-category-rename maxlength="40" value="' + esc(name) + '"></div><div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" data-background-category-rename-cancel>取消</button><button class="tm-btn tm-btn-safe" data-background-category-rename-save>保存</button></div>');
            sheet.querySelector('[data-background-category-rename-cancel]').addEventListener('click', function () { closeSheet(sheet); });
            sheet.querySelector('[data-background-category-rename-save]').addEventListener('click', function () {
                var nextName = sheet.querySelector('[data-background-category-rename]').value.trim();
                var state = data();
                var result = library.renameCategory(state, name, nextName);
                if (!result.ok) { toast(result.reason === 'collision' ? '已有同名分类' : '请输入有效分类名称', true); return; }
                if (category === name) category = result.name;
                persist(state, '已重命名分类').then(function () {
                    closeSheet(sheet);
                    if (parentSheet) closeSheet(parentSheet);
                    render();
                    openCategoryManager();
                });
            });
            return sheet;
        }

        function openCategoryManager() {
            var state = data();
            var categories = library.ensureState(state).categories.slice();
            var counts = Object.create(null);
            backgrounds.forEach(function (name) {
                var itemCategory = library.peekMeta(state, name).category;
                if (itemCategory) counts[itemCategory] = (counts[itemCategory] || 0) + 1;
            });
            var sheet = createSheet('<div class="tm-sheet-title"><i class="fa-solid fa-folder-tree"></i>背景分类管理</div>' +
                (categories.length ? categories.map(function (name, index) {
                    return '<div class="tm-cat-item"><span class="tm-cat-name">' + esc(name) + '</span><span class="tm-cat-count">' + (counts[name] || 0) + '张</span><span class="tm-background-category-actions"><button class="tm-btn-sm" data-background-cat-rename="' + index + '" title="重命名"><i class="fa-solid fa-pen"></i></button><button class="tm-btn-sm" data-background-cat-up="' + index + '" title="上移"><i class="fa-solid fa-arrow-up"></i></button><button class="tm-btn-sm" data-background-cat-down="' + index + '" title="下移"><i class="fa-solid fa-arrow-down"></i></button><button class="tm-btn-sm" data-background-cat-delete="' + index + '" title="删除"><i class="fa-solid fa-trash"></i></button></span></div>';
                }).join('') : '<div class="tm-empty"><i class="fa-solid fa-folder-open"></i><span>还没有背景分类</span></div>') +
                '<div class="tm-divider"></div><div class="tm-cat-add-row"><input type="text" data-background-new-category maxlength="40" placeholder="新分类名称…"><button class="tm-btn tm-btn-safe" data-background-category-add>添加</button></div>');
            sheet.addEventListener('click', function (event) {
                var current = data();
                var list = library.ensureState(current).categories.slice();
                var add = event.target.closest('[data-background-category-add]');
                if (add) {
                    var result = library.addCategory(current, sheet.querySelector('[data-background-new-category]').value);
                    if (!result.ok) { toast(result.reason === 'collision' ? '已有同名分类' : '请输入有效分类名称', true); return; }
                } else {
                    var rename = event.target.closest('[data-background-cat-rename]');
                    var up = event.target.closest('[data-background-cat-up]');
                    var down = event.target.closest('[data-background-cat-down]');
                    var remove = event.target.closest('[data-background-cat-delete]');
                    if (rename) { openCategoryRenameSheet(list[Number(rename.dataset.backgroundCatRename)], sheet); return; }
                    if (up) {
                        if (!library.moveCategory(current, Number(up.dataset.backgroundCatUp), Number(up.dataset.backgroundCatUp) - 1)) return;
                    } else if (down) {
                        if (!library.moveCategory(current, Number(down.dataset.backgroundCatDown), Number(down.dataset.backgroundCatDown) + 1)) return;
                    } else if (remove) {
                        var target = list[Number(remove.dataset.backgroundCatDelete)];
                        if (!confirmAction('删除分类「' + target + '」？\n其中的背景图片不会删除，只会变为未分类。')) return;
                        library.deleteCategory(current, target);
                        if (category === target) category = '__all__';
                    } else return;
                }
                persist(current).then(function () { closeSheet(sheet); render(); openCategoryManager(); });
            });
            return sheet;
        }

        function openSettingsSheet() {
            var state = data();
            var categoryCount = library.ensureState(state).categories.length;
            var sheet = createSheet('<div class="tm-sheet-title"><i class="fa-solid fa-sliders"></i>背景设置</div>' +
                '<button type="button" class="tm-btn tm-btn-outline" data-background-settings-categories style="width:100%;text-align:left"><i class="fa-solid fa-tags"></i> 管理分类（' + categoryCount + '个）</button>' +
                '<details class="tm-disclosure" id="tm-background-settings-data"><summary><span><i class="fa-solid fa-database"></i>数据管理</span><i class="fa-solid fa-chevron-right tm-disclosure-chevron"></i></summary><div class="tm-disclosure-body">' +
                '<div class="tm-storage-info" data-background-settings-summary>背景 ' + backgrounds.length + ' 张 / 分类 ' + categoryCount + ' 个</div>' +
                '<div class="tm-hint" style="margin-bottom:9px">背景来自酒馆图库；导入和删除会自动刷新。若在管理器外修改过背景，可手动重新读取。</div>' +
                '<button type="button" class="tm-btn tm-btn-outline" data-background-settings-refresh style="width:100%"><i class="fa-solid fa-rotate"></i> 重新读取酒馆背景</button>' +
                '</div></details>');
            sheet.classList.add('tm-settings-sheet');
            sheet.querySelector('[data-background-settings-categories]').addEventListener('click', function () {
                closeSheet(sheet);
                openCategoryManager();
            });
            sheet.querySelector('[data-background-settings-refresh]').addEventListener('click', function () {
                var button = this;
                var original = button.innerHTML;
                button.disabled = true;
                button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在读取…';
                refresh(true).then(function () {
                    var summary = sheet.querySelector('[data-background-settings-summary]');
                    if (summary) summary.textContent = '背景 ' + backgrounds.length + ' 张 / 分类 ' + library.ensureState(data()).categories.length + ' 个';
                    toast('背景列表已刷新');
                }).catch(function (error) {
                    toast(error.message || '背景刷新失败', true);
                }).finally(function () {
                    if (!button.parentNode) return;
                    button.disabled = false;
                    button.innerHTML = original;
                });
            });
            return sheet;
        }

        function adjustGridSize(delta) {
            var state = data();
            var libraryState = library.ensureState(state);
            var next = Math.max(84, Math.min(260, libraryState.cardSize + delta));
            if (next === libraryState.cardSize) return;
            libraryState.cardSize = next;
            var grid = root && root.querySelector('[data-background-grid]');
            if (grid) grid.style.setProperty('--tm-background-card-min', next + 'px');
            persist(state);
        }

        function setBatchMode(enabled) {
            batchMode = enabled === true;
            batchSelected.clear();
            batchDeleting = false;
            render();
            return batchMode;
        }

        function handleClick(event) {
            var batchButton = event.target.closest('[data-background-batch]');
            if (batchButton) {
                if (busy || batchDeleting) return;
                var batchAction = batchButton.dataset.backgroundBatch;
                if (batchAction === 'all') batchSelected = new Set(visibleBackgrounds);
                else if (batchAction === 'none') batchSelected.clear();
                else if (batchAction === 'category') { applyBatchCategory(); return; }
                else if (batchAction === 'export') { exportBatchSelection(); return; }
                else if (batchAction === 'delete') { deleteBatchSelection(); return; }
                syncRenderedBatchCards();
                return;
            }
            var zoom = event.target.closest('[data-background-grid-zoom]');
            if (zoom) {
                adjustGridSize(zoom.dataset.backgroundGridZoom === 'out' ? -12 : 12);
                return;
            }
            var categoryButton = event.target.closest('[data-background-category]');
            if (categoryButton) { category = categoryButton.dataset.backgroundCategory || '__all__'; render(); return; }
            var sortButton = event.target.closest('[data-background-sort]');
            if (sortButton) {
                var sortState = data();
                library.ensureState(sortState).sortMode = sortButton.dataset.backgroundSort;
                persist(sortState).then(render);
                return;
            }
            var menuButton = event.target.closest('[data-background-menu]');
            if (menuButton) {
                event.preventDefault();
                event.stopPropagation();
                openBackgroundMenu(menuButton.dataset.backgroundMenu);
                return;
            }
            var card = event.target.closest('.tm-background-card');
            if (card && root.contains(card)) {
                var name = card.dataset.backgroundName;
                if (batchMode) {
                    if (batchSelected.has(name)) batchSelected.delete(name);
                    else batchSelected.add(name);
                    syncBatchCard(card);
                    updateBatchCount();
                } else viewBackground(name);
            }
        }

        function handleKeydown(event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            if (event.target.closest('button')) return;
            var card = event.target.closest('.tm-background-card');
            if (!card) return;
            event.preventDefault();
            if (batchMode) {
                var name = card.dataset.backgroundName;
                if (batchSelected.has(name)) batchSelected.delete(name);
                else batchSelected.add(name);
                syncBatchCard(card);
                updateBatchCount();
            } else viewBackground(card.dataset.backgroundName);
        }

        function handleFileChange(event) {
            var input = event.currentTarget || fileInput;
            var files = Array.prototype.slice.call(input.files || []);
            input.value = '';
            importFiles(files).catch(function () {});
        }

        function mount() {
            if (mounted) return refresh(false);
            root = getRoot();
            if (!root) return Promise.reject(new Error('背景管理页面不存在'));
            mounted = true;
            ensureStyle();
            fileInput = root.querySelector('[data-background-file]');
            root.addEventListener('click', handleClick);
            root.addEventListener('keydown', handleKeydown);
            fileInput.addEventListener('change', handleFileChange);
            var search = root.querySelector('[data-background-search]');
            search.addEventListener('input', function () { query = search.value.trim(); render(); });
            root.querySelector('[data-background-search-clear]').addEventListener('click', function () {
                query = '';
                search.value = '';
                render();
                search.focus();
            });
            return refresh(false);
        }

        function unmount() {
            if (!mounted) return;
            mounted = false;
            refreshToken += 1;
            disconnectLoader();
            root.removeEventListener('click', handleClick);
            root.removeEventListener('keydown', handleKeydown);
            fileInput.removeEventListener('change', handleFileChange);
            fileInput = null;
            root = null;
            removeStyle();
        }

        function toggleSearch() {
            if (!root) return false;
            searchOpen = !searchOpen;
            root.querySelector('[data-background-search-bar]').classList.toggle('open', searchOpen);
            var input = root.querySelector('[data-background-search]');
            if (searchOpen) input.focus();
            else { query = ''; input.value = ''; render(); }
            return searchOpen;
        }

        function toggleSort() {
            if (!root) return false;
            sortOpen = !sortOpen;
            root.querySelector('[data-background-sortbar]').classList.toggle('open', sortOpen);
            return sortOpen;
        }

        function pickFiles() {
            if (!mounted || !fileInput || busy) return false;
            fileInput.click();
            return true;
        }

        function getState() {
            var state = data();
            return {
                mounted: mounted,
                count: backgrounds.length,
                categories: library.ensureState(state).categories.length,
                busy: busy,
                batchMode: batchMode,
            };
        }

        return {
            mount: mount,
            unmount: unmount,
            refresh: refresh,
            pickFiles: pickFiles,
            importFiles: importFiles,
            toggleSearch: toggleSearch,
            toggleSort: toggleSort,
            toggleBatchMode: function () { return setBatchMode(!batchMode); },
            openCategoryManager: openCategoryManager,
            openSettingsSheet: openSettingsSheet,
            getState: getState,
        };
    };

    ns.backgroundPage = { buildPageHtml: buildPageHtml, styleText: styleText };
})(window);
