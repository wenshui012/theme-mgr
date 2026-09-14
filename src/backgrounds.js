(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createBackgrounds = function (opts) {
        opts = opts || {};
        var load = opts.load;
        var save = opts.save;
        var getPostHeaders = opts.getPostHeaders;
        var esc = opts.esc;
        var createSheet = opts.createSheet;
        var closeSheet = opts.closeSheet;
        var setBeforeClose = opts.setBeforeClose;
        var toast = opts.toast;
        var renderGrid = opts.renderGrid;
        var setControlValue = opts.setControlValue;
        var themeRuntime = opts.themeRuntime;
        var imageLoaderApi = opts.imageLoader || ns.imageLoader;
        var loadBoundBackgroundModules = typeof opts.loadBackgroundModules === 'function'
            ? opts.loadBackgroundModules
            : function () { return Promise.all([import('/scripts/backgrounds.js'), import('/script.js')]); };
        var backgroundListCache = null;
        var backgroundThumbnailCache = new Map();
        var BACKGROUND_THUMBNAIL_CACHE_LIMIT = 64;

        function getBackgroundPath(backgroundName) {
            if (typeof global.__TAURITAVERN_BACKGROUND_PATH__ === 'function') {
                try { return global.__TAURITAVERN_BACKGROUND_PATH__(backgroundName); }
                catch (error) { console.warn('[美化管理] TauriTavern 背景路径转换失败:', error); }
            }
            return 'backgrounds/' + encodeURIComponent(backgroundName);
        }

        function getBackgroundCssUrl(backgroundName) {
            return 'url("' + getBackgroundPath(backgroundName) + '")';
        }

        function blobToDataUrl(blob) {
            if (typeof global.FileReader !== 'function') return Promise.reject(new Error('FileReader unavailable'));
            return new Promise(function (resolve, reject) {
                var reader = new global.FileReader();
                reader.onload = function () { resolve(typeof reader.result === 'string' ? reader.result : ''); };
                reader.onerror = function () { reject(reader.error || new Error('background thumbnail read failed')); };
                reader.onabort = function () { reject(reader.error || new Error('background thumbnail read aborted')); };
                reader.readAsDataURL(blob);
            });
        }

        function getBackgroundThumbnailSource(backgroundName) {
            if (backgroundThumbnailCache.has(backgroundName)) return backgroundThumbnailCache.get(backgroundName);
            var promise = Promise.resolve().then(function () {
                return global.fetch('/thumbnail?type=bg&file=' + encodeURIComponent(backgroundName), { cache: 'force-cache' });
            }).then(function (response) {
                if (!response || !response.ok || typeof response.blob !== 'function') throw new Error('background thumbnail unavailable');
                return response.blob();
            }).then(blobToDataUrl).then(function (source) {
                if (!source) throw new Error('background thumbnail is empty');
                return source;
            }).catch(function () {
                return getBackgroundPath(backgroundName);
            });
            backgroundThumbnailCache.set(backgroundName, promise);
            while (backgroundThumbnailCache.size > BACKGROUND_THUMBNAIL_CACHE_LIMIT) {
                backgroundThumbnailCache.delete(backgroundThumbnailCache.keys().next().value);
            }
            return promise;
        }

        function getBackgroundList(cb, force) {
            if (backgroundListCache && !force) { cb(backgroundListCache); return; }
            getPostHeaders()
                .then(function (headers) {
                    return global.fetch('/api/backgrounds/all', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({}),
                    });
                })
                .then(function (response) {
                    if (!response.ok) throw new Error('backgrounds ' + response.status);
                    return response.json();
                })
                .then(function (data) {
                    var images = data && Array.isArray(data.images) ? data.images : [];
                    backgroundListCache = images.map(function (image) {
                        return typeof image === 'string' ? image : image.filename;
                    }).filter(function (name) { return !!name; }).sort(function (a, b) { return a.localeCompare(b); });
                    cb(backgroundListCache);
                })
                .catch(function (err) {
                    console.warn('[美化管理] 读取背景列表失败:', err);
                    cb([]);
                });
        }

        function normalizeBackgroundRename(oldName, rawName) {
            var name = String(rawName || '').trim();
            if (!name) return '';
            var oldExt = '';
            var dot = oldName.lastIndexOf('.');
            if (dot !== -1) oldExt = oldName.slice(dot);
            if (oldExt && name.lastIndexOf('.') === -1) name += oldExt;
            return name;
        }

        function syncRenamedBackground(oldName, newName, cb) {
            var data = load();
            var changed = false;
            Object.keys(data.themeMeta || {}).forEach(function (themeName) {
                if (data.themeMeta[themeName] && data.themeMeta[themeName].backgroundName === oldName) {
                    data.themeMeta[themeName].backgroundName = newName;
                    changed = true;
                }
            });
            if (changed) save(data);
            Promise.all([import('/scripts/backgrounds.js'), import('/script.js')])
                .then(function (mods) {
                    var bgMod = mods[0];
                    var scriptMod = mods[1];
                    if (bgMod.background_settings && bgMod.background_settings.name === oldName) {
                        var url = getBackgroundCssUrl(newName);
                        bgMod.background_settings.name = newName;
                        bgMod.background_settings.url = url;
                        var bg = global.document.getElementById('bg1');
                        if (bg) bg.style.backgroundImage = url;
                        if (scriptMod && typeof scriptMod.saveSettingsDebounced === 'function') scriptMod.saveSettingsDebounced();
                    }
                    if (cb) cb(true);
                })
                .catch(function () { if (cb) cb(changed); });
        }

        function renameBackgroundOnServer(oldName, newName, cb) {
            getPostHeaders()
                .then(function (headers) {
                    return global.fetch('/api/backgrounds/rename', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ old_bg: oldName, new_bg: newName }),
                        cache: 'no-cache',
                    });
                })
                .then(function (response) {
                    if (!response || !response.ok) throw new Error('rename background ' + (response ? response.status : 'failed'));
                    backgroundListCache = null;
                    syncRenamedBackground(oldName, newName, function () { if (cb) cb(true); });
                })
                .catch(function (err) {
                    console.warn('[美化管理] 重命名背景失败:', err);
                    if (cb) cb(false);
                });
        }

        function buildBackgroundBindHtml(backgroundName) {
            var thumb = backgroundName
                ? '<div class="tm-bg-bind-thumb" style="background-image:' + esc(getBackgroundCssUrl(backgroundName)) + '"></div>'
                : '<div class="tm-bg-bind-thumb empty"><i class="fa-regular fa-image"></i></div>';
            var title = backgroundName ? esc(backgroundName) : '不绑定背景';
            var sub = backgroundName ? '点击更换绑定壁纸' : '点击选择 ST 已导入壁纸';
            return thumb +
                '<div class="tm-bg-bind-info"><div class="tm-bg-bind-name">' + title + '</div><div class="tm-bg-bind-sub">' + sub + '</div></div>' +
                '<i class="fa-solid fa-chevron-right"></i>';
        }

        function openBackgroundPickerSheet(selectedName, onPick) {
            var data = load();
            var bgSize = Math.max(84, Math.min(220, data.bgPickerSize || 132));
            var sheet = createSheet([
                '<div class="tm-sheet-title"><i class="fa-solid fa-image"></i>选择绑定背景</div>',
                '<div class="tm-bg-picker-tools">',
                '<div class="tm-bg-search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="tm-bg-search" placeholder="搜索背景名…" autocomplete="off" /></div>',
                '<button class="tm-btn-sm" id="tm-bg-zoom-out" title="缩小"><i class="fa-solid fa-minus"></i></button>',
                '<button class="tm-btn-sm" id="tm-bg-zoom-in" title="放大"><i class="fa-solid fa-plus"></i></button>',
                '</div>',
                '<div class="tm-bg-picker-list" id="tm-bg-picker-list"><div class="tm-loading"><i class="fa-solid fa-spinner"></i><span>正在读取壁纸…</span></div></div>',
            ].join(''));
            var list = sheet.querySelector('#tm-bg-picker-list');
            var searchInp = sheet.querySelector('#tm-bg-search');
            var backgroundsCache = [];
            var thumbnailLoader = null;

            if (typeof setBeforeClose === 'function') {
                setBeforeClose(sheet, function () {
                    if (thumbnailLoader) thumbnailLoader.disconnect();
                    return true;
                });
            }

            function choose(name) {
                if (thumbnailLoader) thumbnailLoader.disconnect();
                if (onPick) onPick(name);
                closeSheet(sheet);
            }

            function applyBgSize() {
                list.style.setProperty('--tm-bg-card-min', bgSize + 'px');
            }

            function saveBgSize() {
                var nextData = load();
                nextData.bgPickerSize = bgSize;
                save(nextData);
            }

            function renderBackgrounds() {
                if (thumbnailLoader) thumbnailLoader.disconnect();
                applyBgSize();
                var query = (searchInp.value || '').trim().toLowerCase();
                var backgrounds = query ? backgroundsCache.filter(function (name) {
                    return name.toLowerCase().indexOf(query) !== -1;
                }) : backgroundsCache.slice();
                var html = '<div class="tm-bg-picker-card' + (!selectedName ? ' on' : '') + '" data-bg="" tabindex="0">' +
                    '<div class="tm-bg-picker-thumb empty"><i class="fa-regular fa-image"></i></div>' +
                    '<div class="tm-bg-picker-name">不绑定背景</div><i class="fa-solid fa-circle-check"></i></div>';
                backgrounds.forEach(function (name) {
                    html += '<div class="tm-bg-picker-card' + (selectedName === name ? ' on' : '') + '" data-bg="' + esc(name) + '" tabindex="0">' +
                        '<div class="tm-bg-picker-thumb"><img src="' + esc(imageLoaderApi.PLACEHOLDER_SRC) + '" data-background-name="' + esc(name) + '" alt="" loading="lazy"></div>' +
                        '<div class="tm-bg-picker-name">' + esc(name) + '</div>' +
                        '<button class="tm-bg-rename" title="重命名背景" data-bg="' + esc(name) + '"><i class="fa-solid fa-pen"></i></button>' +
                        '<i class="fa-solid fa-circle-check"></i></div>';
                });
                if (backgrounds.length === 0) {
                    html += '<div class="tm-empty"><i class="fa-regular fa-image"></i><span>' + (query ? '没有匹配的背景' : '还没有可绑定的 ST 壁纸') + '</span></div>';
                }
                list.innerHTML = html;
                thumbnailLoader = imageLoaderApi.createImageLoader({
                    root: list,
                    rootMargin: '240px 0px',
                    getKey: function (image) { return image.dataset.backgroundName || ''; },
                    resolveSource: function (name) { return getBackgroundThumbnailSource(name); },
                });
                thumbnailLoader.observe(list.querySelectorAll('img[data-background-name]'));
                list.querySelectorAll('.tm-bg-picker-card').forEach(function (card) {
                    card.addEventListener('click', function () { choose(card.dataset.bg || ''); });
                    card.addEventListener('keydown', function (event) { if (event.key === 'Enter') choose(card.dataset.bg || ''); });
                });
                list.querySelectorAll('.tm-bg-rename').forEach(function (button) {
                    button.addEventListener('click', function (event) {
                        event.stopPropagation();
                        var oldName = button.dataset.bg || '';
                        var raw = global.prompt('新的背景名称：', oldName);
                        if (raw === null) return;
                        var newName = normalizeBackgroundRename(oldName, raw);
                        if (!newName || newName === oldName) return;
                        if (backgroundsCache.indexOf(newName) !== -1) { toast('已有同名背景', true); return; }
                        renameBackgroundOnServer(oldName, newName, function (ok) {
                            if (!ok) { toast('背景改名失败', true); return; }
                            if (selectedName === oldName) {
                                selectedName = newName;
                                if (onPick) onPick(newName);
                            }
                            getBackgroundList(function (fresh) {
                                backgroundsCache = fresh;
                                renderBackgrounds();
                                renderGrid();
                                toast('已重命名背景');
                            }, true);
                        });
                    });
                });
            }

            searchInp.addEventListener('input', renderBackgrounds);
            sheet.querySelector('#tm-bg-zoom-out').addEventListener('click', function () {
                bgSize = Math.max(84, bgSize - 24);
                saveBgSize();
                renderBackgrounds();
            });
            sheet.querySelector('#tm-bg-zoom-in').addEventListener('click', function () {
                bgSize = Math.min(220, bgSize + 24);
                saveBgSize();
                renderBackgrounds();
            });

            getBackgroundList(function (backgrounds) {
                backgroundsCache = backgrounds;
                renderBackgrounds();
            }, true);
        }

        function applyBoundBackground(themeName, cb, isCurrent) {
            var data = load();
            var meta = data.themeMeta[themeName];
            var backgroundName = meta && meta.backgroundName ? meta.backgroundName : '';
            if (!backgroundName) { if (cb) cb(true); return; }

            var url = getBackgroundCssUrl(backgroundName);
            loadBoundBackgroundModules()
                .then(function (mods) {
                    if (isCurrent && !isCurrent()) { if (cb) cb(false, 'superseded'); return; }
                    var bgMod = mods[0];
                    var scriptMod = mods[1];
                    if (bgMod.background_settings) {
                        bgMod.background_settings.name = backgroundName;
                        bgMod.background_settings.url = url;
                    }
                    var bg = global.document.getElementById('bg1');
                    if (bg) bg.style.backgroundImage = url;
                    setControlValue('#background_fitting', bgMod.background_settings && bgMod.background_settings.fitting ? bgMod.background_settings.fitting : '');
                    if (scriptMod && typeof scriptMod.saveSettingsDebounced === 'function') scriptMod.saveSettingsDebounced();
                    if (cb) cb(true);
                })
                .catch(function (err) {
                    if (isCurrent && !isCurrent()) { if (cb) cb(false, 'superseded'); return; }
                    console.warn('[美化管理] 应用绑定背景失败:', err);
                    var bg = global.document.getElementById('bg1');
                    if (bg) bg.style.backgroundImage = url;
                    if (cb) cb(true);
                });
        }

        function finishApplyTheme(themeName, cb, ok, requestId) {
            var isCurrent = function () { return themeRuntime.isApplyCurrent(requestId); };
            if (!isCurrent()) { if (cb) cb(false, 'superseded'); return; }
            if (!ok) { if (cb) cb(false); return; }
            applyBoundBackground(themeName, function (backgroundOk, reason) {
                if (!isCurrent()) { if (cb) cb(false, 'superseded'); return; }
                if (cb) cb(backgroundOk !== false, reason);
            }, isCurrent);
        }

        return {
            getBackgroundCssUrl: getBackgroundCssUrl,
            getBackgroundList: getBackgroundList,
            normalizeBackgroundRename: normalizeBackgroundRename,
            renameBackgroundOnServer: renameBackgroundOnServer,
            buildBackgroundBindHtml: buildBackgroundBindHtml,
            openBackgroundPickerSheet: openBackgroundPickerSheet,
            applyBoundBackground: applyBoundBackground,
            finishApplyTheme: finishApplyTheme,
        };
    };
})(window);
