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
        var backgroundLibraryApi = opts.backgroundLibrary || ns.backgroundLibrary;
        var archiveApi = opts.archive || ns.avatarTransfer;
        var downloadBlob = typeof opts.downloadBlob === 'function' ? opts.downloadBlob : defaultDownloadBlob;
        var loadBoundBackgroundModules = typeof opts.loadBackgroundModules === 'function'
            ? opts.loadBackgroundModules
            : function () { return Promise.all([import('/scripts/backgrounds.js'), import('/script.js')]); };
        var backgroundListCache = null;
        var backgroundThumbnailCache = new Map();
        var BACKGROUND_THUMBNAIL_CACHE_LIMIT = 64;

        function defaultDownloadBlob(blob, filename) {
            if (!global.URL || typeof global.URL.createObjectURL !== 'function') throw new Error('当前环境不支持导出文件');
            var url = global.URL.createObjectURL(blob);
            var anchor = global.document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.style.display = 'none';
            global.document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
        }

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

        function getBackgroundHttpPath(backgroundName) {
            return 'backgrounds/' + encodeURIComponent(backgroundName);
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

        function requestBackgroundList(force) {
            if (backgroundListCache && !force) return Promise.resolve(backgroundListCache);
            return getPostHeaders()
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
                    return backgroundListCache;
                });
        }

        function getBackgroundList(cb, force) {
            requestBackgroundList(force).then(cb).catch(function (err) {
                console.warn('[美化管理] 读取背景列表失败:', err);
                cb([]);
            });
        }

        function getBackgroundListPromise(force) {
            return requestBackgroundList(force);
        }

        function invalidateBackgroundCache(name) {
            backgroundListCache = null;
            if (name) backgroundThumbnailCache.delete(name);
        }

        function getMultipartHeaders() {
            return getPostHeaders().then(function (headers) {
                var multipartHeaders = {};
                Object.keys(headers || {}).forEach(function (key) {
                    if (key.toLowerCase() !== 'content-type') multipartHeaders[key] = headers[key];
                });
                return multipartHeaders;
            });
        }

        function uploadBackgroundFile(file) {
            if (!file || !file.name) return Promise.reject(new Error('未选择有效图片'));
            if (typeof global.FormData !== 'function') return Promise.reject(new Error('当前环境不支持图片上传'));
            var formData = new global.FormData();
            formData.append('avatar', file, file.name);
            return getMultipartHeaders().then(function (headers) {
                return global.fetch('/api/backgrounds/upload', {
                    method: 'POST',
                    headers: headers,
                    body: formData,
                    cache: 'no-cache',
                });
            }).then(function (response) {
                if (!response || !response.ok) throw new Error('上传背景失败' + (response ? '（' + response.status + '）' : ''));
                return response.text();
            }).then(function (name) {
                name = String(name || file.name).trim();
                if (!name) throw new Error('酒馆未返回背景文件名');
                invalidateBackgroundCache(name);
                return name;
            });
        }

        function fetchBackgroundBlob(name, source) {
            return global.fetch(source, { cache: 'no-cache' }).then(function (response) {
                if (!response || !response.ok || typeof response.blob !== 'function') throw new Error('读取背景原图失败');
                return response.blob();
            });
        }

        function readBackgroundBlob(name) {
            var preferredPath = getBackgroundPath(name);
            var httpPath = getBackgroundHttpPath(name);
            return fetchBackgroundBlob(name, preferredPath).catch(function (error) {
                if (preferredPath === httpPath) throw error;
                return fetchBackgroundBlob(name, httpPath);
            });
        }

        function blobToBytes(blob) {
            if (blob && typeof blob.arrayBuffer === 'function') {
                return blob.arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
            }
            if (typeof global.FileReader !== 'function') return Promise.reject(new Error('当前环境不支持读取背景原图'));
            return new Promise(function (resolve, reject) {
                var reader = new global.FileReader();
                reader.onload = function () { resolve(new Uint8Array(reader.result)); };
                reader.onerror = function () { reject(reader.error || new Error('读取背景原图失败')); };
                reader.onabort = function () { reject(reader.error || new Error('读取背景原图已取消')); };
                reader.readAsArrayBuffer(blob);
            });
        }

        function isMobileRuntime() {
            var userAgent = global.navigator && global.navigator.userAgent || '';
            return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || Number(global.innerWidth) > 0 && Number(global.innerWidth) <= 768;
        }

        function exportBackgroundBatch(names) {
            names = Array.from(new Set((names || []).map(function (name) { return String(name || '').trim(); }).filter(Boolean)));
            if (!names.length) return Promise.reject(new Error('请先选择背景'));
            if (!archiveApi || typeof archiveApi.buildStoredZip !== 'function' || typeof archiveApi.estimateZipSize !== 'function') {
                return Promise.reject(new Error('当前环境不支持批量 ZIP 导出'));
            }
            var entries = [];
            return names.reduce(function (promise, name) {
                return promise.then(function () {
                    return readBackgroundBlob(name).then(blobToBytes).then(function (bytes) {
                        entries.push({ path: 'backgrounds/' + name, data: bytes });
                    });
                });
            }, Promise.resolve()).then(function () {
                var limit = (isMobileRuntime() ? 64 : 320) * 1024 * 1024;
                var estimated = archiveApi.estimateZipSize(entries);
                if (estimated > limit) {
                    throw new Error('所选背景导出包超过当前设备安全上限，请减少选择后重试');
                }
                var now = new Date();
                var blob = archiveApi.buildStoredZip(entries, now.toISOString(), global.Blob);
                var stamp = now.toISOString().replace(/[:.]/g, '-');
                var filename = 'backgrounds-' + stamp + '.zip';
                return Promise.resolve(downloadBlob(blob, filename)).then(function () {
                    return { filename: filename, count: names.length, bytes: blob.size };
                });
            });
        }

        function exportBackground(name) {
            return readBackgroundBlob(name).then(function (blob) {
                return Promise.resolve(downloadBlob(blob, name)).then(function () { return name; });
            });
        }

        function referencesBackground(value, name) {
            value = String(value || '');
            return value.indexOf(name) !== -1 || value.indexOf(encodeURIComponent(name)) !== -1;
        }

        function syncDeletedHostBackground(name, remaining) {
            return loadBoundBackgroundModules().then(function (mods) {
                var bgMod = mods[0] || {};
                var scriptMod = mods[1] || {};
                var fallback = remaining && remaining[0] ? remaining[0] : '';
                var fallbackUrl = fallback ? getBackgroundCssUrl(fallback) : 'none';
                var changedSettings = false;
                if (bgMod.background_settings && bgMod.background_settings.name === name) {
                    bgMod.background_settings.name = fallback;
                    bgMod.background_settings.url = fallbackUrl;
                    changedSettings = true;
                }
                var chatMetadata = scriptMod.chat_metadata;
                var lockedDeleted = chatMetadata && referencesBackground(chatMetadata.custom_background, name);
                var hasOtherChatLock = chatMetadata && chatMetadata.custom_background && !lockedDeleted;
                if (lockedDeleted) delete chatMetadata.custom_background;
                if (!hasOtherChatLock && (changedSettings || lockedDeleted)) {
                    var bg = global.document && global.document.getElementById ? global.document.getElementById('bg1') : null;
                    var visualUrl = changedSettings
                        ? fallbackUrl
                        : (bgMod.background_settings && bgMod.background_settings.url ? bgMod.background_settings.url : fallbackUrl);
                    if (bg) bg.style.backgroundImage = visualUrl;
                }
                if (changedSettings && typeof scriptMod.saveSettingsDebounced === 'function') scriptMod.saveSettingsDebounced();
                if (lockedDeleted) {
                    if (typeof scriptMod.saveMetadataDebounced === 'function') scriptMod.saveMetadataDebounced();
                    else if (typeof scriptMod.saveMetadata === 'function') scriptMod.saveMetadata();
                }
                return {
                    activeChanged: changedSettings,
                    chatLockCleared: !!lockedDeleted,
                    fallback: changedSettings ? fallback : (lockedDeleted && bgMod.background_settings ? bgMod.background_settings.name || '' : ''),
                };
            }).catch(function (error) {
                console.warn('[背景管理] 删除后同步酒馆当前背景失败:', error);
                return { activeChanged: false, chatLockCleared: false, fallback: '' };
            });
        }

        function syncDeletedBackground(name) {
            var data = load();
            var bindingCount = 0;
            var changed = false;
            Object.keys(data.themeMeta || {}).forEach(function (themeName) {
                if (data.themeMeta[themeName] && data.themeMeta[themeName].backgroundName === name) {
                    data.themeMeta[themeName].backgroundName = '';
                    bindingCount += 1;
                    changed = true;
                }
            });
            if (backgroundLibraryApi && typeof backgroundLibraryApi.removeAsset === 'function') {
                changed = backgroundLibraryApi.removeAsset(data, name) || changed;
            } else if (data.backgroundLibrary && data.backgroundLibrary.assetMeta && Object.prototype.hasOwnProperty.call(data.backgroundLibrary.assetMeta, name)) {
                delete data.backgroundLibrary.assetMeta[name];
                changed = true;
            }
            var metadataSave = changed ? Promise.resolve(save(data)).then(function () { return true; }).catch(function (error) {
                console.warn('[背景管理] 背景删除成功，但整理信息保存失败:', error);
                return false;
            }) : Promise.resolve(true);
            var remainingBackgrounds = getBackgroundListPromise(true).catch(function (error) {
                console.warn('[背景管理] 删除成功，但刷新酒馆背景列表失败:', error);
                return [];
            });
            return Promise.all([metadataSave, remainingBackgrounds]).then(function (parts) {
                return syncDeletedHostBackground(name, parts[1]).then(function (hostState) {
                    return {
                        name: name,
                        themeBindingsCleared: bindingCount,
                        metadataSaved: parts[0],
                        activeChanged: hostState.activeChanged,
                        chatLockCleared: hostState.chatLockCleared,
                        fallback: hostState.fallback,
                    };
                });
            });
        }

        function deleteBackgroundOnServer(name) {
            return getPostHeaders().then(function (headers) {
                return global.fetch('/api/backgrounds/delete', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ bg: name }),
                    cache: 'no-cache',
                });
            }).then(function (response) {
                if (!response || !response.ok) throw new Error('删除背景失败' + (response ? '（' + response.status + '）' : ''));
                invalidateBackgroundCache(name);
                return syncDeletedBackground(name);
            });
        }

        function countThemeBindings(name) {
            var data = load();
            return Object.keys(data.themeMeta || {}).filter(function (themeName) {
                return data.themeMeta[themeName] && data.themeMeta[themeName].backgroundName === name;
            }).length;
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
            if (backgroundLibraryApi && typeof backgroundLibraryApi.renameAsset === 'function') {
                changed = backgroundLibraryApi.renameAsset(data, oldName, newName) || changed;
            }
            if (changed) Promise.resolve(save(data)).catch(function (error) { console.warn('[背景管理] 背景改名后的整理信息保存失败:', error); });
            loadBoundBackgroundModules()
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
                    invalidateBackgroundCache(oldName);
                    backgroundThumbnailCache.delete(newName);
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
            getBackgroundPath: getBackgroundPath,
            getBackgroundThumbnailSource: getBackgroundThumbnailSource,
            getBackgroundList: getBackgroundList,
            getBackgroundListPromise: getBackgroundListPromise,
            uploadBackgroundFile: uploadBackgroundFile,
            exportBackground: exportBackground,
            exportBackgroundBatch: exportBackgroundBatch,
            deleteBackgroundOnServer: deleteBackgroundOnServer,
            countThemeBindings: countThemeBindings,
            normalizeBackgroundRename: normalizeBackgroundRename,
            renameBackgroundOnServer: renameBackgroundOnServer,
            buildBackgroundBindHtml: buildBackgroundBindHtml,
            openBackgroundPickerSheet: openBackgroundPickerSheet,
            applyBoundBackground: applyBoundBackground,
            finishApplyTheme: finishApplyTheme,
        };
    };
})(window);
