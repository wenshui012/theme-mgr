// ST美化管理扩展 v3.5 - SillyTavern Extension
// 基于穿搭管理 v14.5b 架构，对接 ST 真实主题 API
// 功能：读取ST主题列表、一键切换、预览截图、分类标签、收藏、排序、批量操作

(function () {

    var SCRIPT_NAME = '美化管理';
    var LAUNCHER_NAME = '美化管理器';
    var BTN_ID = 'theme-mgr-ext-btn';
    var DB_NAME = 'theme_mgr_db';
    var DB_VERSION = 1;
    var STORE_NAME = 'data';
    var DATA_KEY = 'main';
    var SERVER_BASE = '/api/plugins/theme-manager';
    var SERVER_IMAGE_PREFIX = SERVER_BASE + '/images/';
    var MAX_IMG_WIDTH = 1200;
    var IMG_QUALITY = 0.8;
    var FAB_ID = 'tm-fab-main';

    var TM_VERSION = '3.5.5';
    var MODULE_VERSION = TM_VERSION;
    var storageApi = null;
    var imageToolsApi = null;
    var styleApi = null;
    var themeSchema = null;
    var themeApi = null;
    var themeRuntime = null;
    var supportReady = false;
    var supportFailed = false;
    var supportErrorText = '';
    var pendingOpenAfterReady = false;
    var launcherInjectStarted = false;
    var fabOpen = false;
    var darkMode = false;

    // 缓存主题列表
    var stThemeList = [];
    var importedThemeCache = {};
    var renamedNativeThemeCache = {};
    var importedThemeSelectSyncBound = false;
    var backgroundListCache = null;
    var IMAGE_FIELD_KEYS = { imageData: true, thumbData: true, previewData: true, fabImage: true };

    function getExtensionBaseUrl() {
        var script = document.currentScript;
        if (script && script.src && isThemeManagerIndex(script.src)) return script.src.replace(/index\.js(?:\?.*)?$/, '');

        function isThemeManagerIndex(src) {
            return /\/index\.js(?:\?|$)/.test(src) &&
                /\/(?:theme-mgr|theme-manager)\//.test(src);
        }

        var scripts = document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
            var src = scripts[i].src || '';
            if (src && isThemeManagerIndex(src)) return src.replace(/index\.js(?:\?.*)?$/, '');
        }

        try {
            var entries = performance.getEntriesByType('resource') || [];
            for (var j = entries.length - 1; j >= 0; j--) {
                var name = entries[j].name || '';
                if (name && isThemeManagerIndex(name)) return name.replace(/index\.js(?:\?.*)?$/, '');
            }
        } catch (e) {}

        return '/scripts/extensions/third-party/theme-mgr/';
    }

    function loadSupportScript(baseUrl, rel, cb) {
        var src = baseUrl + rel + '?v=' + encodeURIComponent(MODULE_VERSION);
        var existing = document.querySelector('script[data-theme-mgr-module="' + rel + '"]');
        if (existing) { cb(true); return; }

        var s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.dataset.themeMgrModule = rel;
        s.onload = function () { cb(true); };
        s.onerror = function () {
            supportErrorText = '无法加载：' + src;
            console.error('[美化管理] 模块加载失败:', src);
            cb(false);
        };
        document.head.appendChild(s);
    }

    function loadSupportScripts(cb) {
        var baseUrl = getExtensionBaseUrl();
        var files = [
            'src/theme-schema.js', 'src/theme-api.js', 'src/theme-runtime.js',
            'src/storage.js', 'src/image-tools.js', 'src/styles.js'
        ];
        var idx = 0;
        function next(ok) {
            if (ok === false) { cb(false); return; }
            if (idx >= files.length) { cb(true); return; }
            loadSupportScript(baseUrl, files[idx++], next);
        }
        next(true);
    }

    function setupSupportModules(cb) {
        loadSupportScripts(function (ok) {
            var modules = window.ThemeMgrModules || {};
            if (!ok || !modules.themeSchema || !modules.createThemeApi || !modules.createThemeRuntime ||
                !modules.createStorage || !modules.imageTools || !modules.injectStyles) {
                supportFailed = true;
                if (!supportErrorText) {
                    var missing = [];
                    if (!modules.createStorage) missing.push('storage.js');
                    if (!modules.imageTools) missing.push('image-tools.js');
                    if (!modules.injectStyles) missing.push('styles.js');
                    if (!modules.themeSchema) missing.push('theme-schema.js');
                    if (!modules.createThemeApi) missing.push('theme-api.js');
                    if (!modules.createThemeRuntime) missing.push('theme-runtime.js');
                    supportErrorText = missing.length ? ('模块未注册：' + missing.join('、')) : '支持模块初始化失败';
                }
                console.error('[美化管理] 支持模块初始化失败:', supportErrorText);
                updateBtn();
                return;
            }
            themeSchema = modules.themeSchema;
            themeApi = modules.createThemeApi({ schema: themeSchema });
            themeRuntime = modules.createThemeRuntime({ schema: themeSchema, api: themeApi });
            storageApi = modules.createStorage({
                DB_NAME: DB_NAME,
                DB_VERSION: DB_VERSION,
                STORE_NAME: STORE_NAME,
                DATA_KEY: DATA_KEY,
                SERVER_BASE: SERVER_BASE,
                SERVER_IMAGE_PREFIX: SERVER_IMAGE_PREFIX,
                IMAGE_FIELD_KEYS: IMAGE_FIELD_KEYS,
                ensureDefaults: ensureDefaults,
                getPostHeaders: getPostHeaders,
                LS_KEY: 'theme_mgr_v2',
            });
            imageToolsApi = modules.imageTools;
            styleApi = modules.injectStyles;
            supportReady = true;
            supportFailed = false;
            cb();
            if (pendingOpenAfterReady) {
                pendingOpenAfterReady = false;
                setTimeout(openPopup, 50);
            }
        });
    }

    function getPopupLayer() {
        var slot = document.getElementById('tm-popup-slot');
        if (slot) return slot;
        var ov = document.querySelector('.tm-overlay');
        if (ov) return ov;
        return document.body;
    }

    // ── 数据与图片存储（由 src/storage.js 提供实现）────────────
    function load() { return storageApi.load(); }
    function save(d) { storageApi.save(d); }
    function saveToDB(d, cb) { storageApi.saveToDB(d, cb); }
    function loadFromLS() { return storageApi.loadFromLS(); }
    function initStorage(cb) { storageApi.initStorage(cb); }
    function uploadImage(dataUrl, cb) { storageApi.uploadImage(dataUrl, cb); }
    function batchResolveImages(urls, cb) { storageApi.batchResolveImages(urls, cb); }
    function collectImageFields(root, refs) { return storageApi.collectImageFields(root, refs); }
    function isDataImage(value) { return storageApi.isDataImage(value); }
    function isServerImage(value) { return storageApi.isServerImage(value); }
    function getServerMode() { return storageApi ? storageApi.getServerMode() : false; }

    // data 结构：
    // {
    //   themeMeta: { "主题名": { category, tags[], starred, imageData, useCount, lastUsed, author, description } },
    //   categories: [],
    //   showBall: true,
    //   fabImage: '',
    //   fabSize: 38,
    //   fabPos: null,
    //   sortMode: 'name'
    // }
    function ensureDefaults(d) {
        var dd = def();
        if (!d) return dd;
        for (var k in dd) { if (d[k] === undefined) d[k] = dd[k]; }
        if (typeof d.themeMeta !== 'object' || !d.themeMeta) d.themeMeta = {};
        if (!Array.isArray(d.categories)) d.categories = [];
        if (typeof d.sortMode !== 'string') d.sortMode = 'name';
        if (typeof d.fabImage !== 'string') d.fabImage = '';
        if (typeof d.fabSize !== 'number') d.fabSize = 38;
        if (typeof d.bgPickerSize !== 'number') d.bgPickerSize = 132;
        if (typeof d.gridCardSize !== 'number') d.gridCardSize = 108;
        d.gridCardSize = Math.max(84, Math.min(220, d.gridCardSize));
        if (!d.fabPos || typeof d.fabPos.top !== 'number' || typeof d.fabPos.left !== 'number') d.fabPos = null;
        for (var name in d.themeMeta) {
            if (!d.themeMeta[name] || typeof d.themeMeta[name] !== 'object') d.themeMeta[name] = {};
            if (d.themeMeta[name].thumbData === undefined) d.themeMeta[name].thumbData = null;
            if (d.themeMeta[name].crop === undefined) d.themeMeta[name].crop = null;
            if (d.themeMeta[name].backgroundName === undefined) d.themeMeta[name].backgroundName = '';
        }
        return d;
    }

    function def() {
        return {
            themeMeta: {},
            categories: [],
            showBall: true,
            showFreq: true,
            fabImage: '',
            fabSize: 38,
            fabPos: null,
            bgPickerSize: 132,
            gridCardSize: 108,
            sortMode: 'name'
        };
    }

    function getMeta(d, name) {
        if (!d.themeMeta[name]) d.themeMeta[name] = { category: '', tags: [], starred: false, imageData: null, thumbData: null, crop: null, useCount: 0, lastUsed: 0, author: '', description: '', backgroundName: '' };
        if (d.themeMeta[name].backgroundName === undefined) d.themeMeta[name].backgroundName = '';
        if (d.themeMeta[name].thumbData === undefined) d.themeMeta[name].thumbData = null;
        if (d.themeMeta[name].crop === undefined) d.themeMeta[name].crop = null;
        return d.themeMeta[name];
    }

    function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

    // ── ST 主题列表获取（多策略）──────────────────────────────
    function fetchThemeList(cb) {
        var found = false;

        function done(list, method) {
            if (found) return;
            found = true;
            stThemeList = list;
            console.log('[美化管理] 主题列表获取成功:', method, list.length + '个');
            if (cb) cb(list);
        }

        // 方式A: 从 UI 里的 #themes 元素读取
        try {
            var sel = document.getElementById('themes');
            if (sel) {
                if (sel.tagName === 'SELECT' && sel.options && sel.options.length > 0) {
                    var names = [];
                    for (var i = 0; i < sel.options.length; i++) {
                        var v = sel.options[i].value || sel.options[i].textContent;
                        if (v && v.trim()) names.push(v.trim());
                    }
                    if (names.length > 0) { done(names, 'SELECT#themes'); return; }
                }
                if (sel.tagName === 'INPUT') {
                    var listId = sel.getAttribute('list');
                    if (listId) {
                        var dl = document.getElementById(listId);
                        if (dl && dl.options) {
                            var names2 = [];
                            for (var j = 0; j < dl.options.length; j++) {
                                var v2 = dl.options[j].value || dl.options[j].textContent;
                                if (v2 && v2.trim()) names2.push(v2.trim());
                            }
                            if (names2.length > 0) { done(names2, 'INPUT#themes+datalist'); return; }
                        }
                    }
                }
            }
        } catch (e) {}

        // 方式B: 遍历页面所有 select/datalist 找主题列表
        try {
            var allDl = document.querySelectorAll('datalist');
            allDl.forEach(function (dl) {
                if (found) return;
                if (dl.options && dl.options.length > 5) {
                    var items = [];
                    for (var k = 0; k < dl.options.length; k++) {
                        var val = dl.options[k].value || dl.options[k].textContent;
                        if (val && val.trim()) items.push(val.trim());
                    }
                    if (items.length > 5) done(items, 'datalist#' + (dl.id || ''));
                }
            });
            if (found) return;
        } catch (e) {}

        // 方式C: 尝试多种 API 路径
        var apiPaths = ['/api/themes', '/api/themes/all', '/themes'];
        var apiDone = 0;
        apiPaths.forEach(function (path) {
            fetch(path)
                .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); return r.json(); })
                .then(function (data) {
                    if (Array.isArray(data) && data.length > 0) done(data, 'fetch ' + path);
                    else if (typeof data === 'object' && !Array.isArray(data)) {
                        var keys = Object.keys(data);
                        if (keys.length > 0) done(keys, 'fetch ' + path);
                    }
                })
                .catch(function () {})
                .finally(function () {
                    apiDone++;
                    if (apiDone >= apiPaths.length && !found) {
                        stThemeList = [];
                        if (cb) cb([]);
                    }
                });
        });
    }

    function getCurrentThemeName() {
        // 尝试从 ST 的 power_user 获取当前主题名
        try {
            if (window.power_user && window.power_user.theme) return window.power_user.theme;
        } catch (e) {}
        // 尝试从主题选择器 UI 获取
        try {
            var inp = document.getElementById('themes');
            if (inp && inp.value) return inp.value;
        } catch (e) {}
        return '';
    }

    function setControlValue(selector, value) {
        var el = document.querySelector(selector);
        if (el) el.value = value;
    }

    function setControlChecked(selector, value) {
        var el = document.querySelector(selector);
        if (el) el.checked = !!value;
    }

    function setControlDisabled(selector, value) {
        var el = document.querySelector(selector);
        if (el) el.disabled = !!value;
    }

    function setControlOpacity(selector, value) {
        var el = document.querySelector(selector);
        if (el) el.style.opacity = value;
    }

    function setColorPicker(selector, value) {
        var el = document.querySelector(selector);
        if (el) el.setAttribute('color', value);
    }

    function getBackgroundCssUrl(backgroundName) {
        return 'url("backgrounds/' + encodeURIComponent(backgroundName) + '")';
    }

    function getBackgroundList(cb, force) {
        if (backgroundListCache && !force) { cb(backgroundListCache); return; }
        getPostHeaders()
            .then(function (headers) {
                return fetch('/api/backgrounds/all', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({}),
                });
            })
            .then(function (r) { if (!r.ok) throw new Error('backgrounds ' + r.status); return r.json(); })
            .then(function (data) {
                var images = data && Array.isArray(data.images) ? data.images : [];
                backgroundListCache = images.map(function (img) {
                    return typeof img === 'string' ? img : img.filename;
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
        var dd = load();
        var changed = false;
        for (var themeName in dd.themeMeta) {
            if (dd.themeMeta[themeName] && dd.themeMeta[themeName].backgroundName === oldName) {
                dd.themeMeta[themeName].backgroundName = newName;
                changed = true;
            }
        }
        if (changed) save(dd);
        Promise.all([import('/scripts/backgrounds.js'), import('/script.js')])
            .then(function (mods) {
                var bgMod = mods[0];
                var scriptMod = mods[1];
                if (bgMod.background_settings && bgMod.background_settings.name === oldName) {
                    var url = getBackgroundCssUrl(newName);
                    bgMod.background_settings.name = newName;
                    bgMod.background_settings.url = url;
                    var bg = document.getElementById('bg1');
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
                return fetch('/api/backgrounds/rename', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ old_bg: oldName, new_bg: newName }),
                    cache: 'no-cache',
                });
            })
            .then(function (r) {
                if (!r || !r.ok) throw new Error('rename background ' + (r ? r.status : 'failed'));
                backgroundListCache = null;
                syncRenamedBackground(oldName, newName, function () {
                    if (cb) cb(true);
                });
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
        var dd = load();
        var bgSize = Math.max(84, Math.min(220, dd.bgPickerSize || 132));
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

        function choose(name) {
            if (onPick) onPick(name);
            closeSheet(sheet);
        }

        function applyBgSize() {
            list.style.setProperty('--tm-bg-card-min', bgSize + 'px');
        }

        function saveBgSize() {
            var d2 = load();
            d2.bgPickerSize = bgSize;
            save(d2);
        }

        function renderBackgrounds() {
            applyBgSize();
            var q = (searchInp.value || '').trim().toLowerCase();
            var backgrounds = q ? backgroundsCache.filter(function (name) { return name.toLowerCase().indexOf(q) !== -1; }) : backgroundsCache.slice();
            var html = '<div class="tm-bg-picker-card' + (!selectedName ? ' on' : '') + '" data-bg="" tabindex="0">' +
                '<div class="tm-bg-picker-thumb empty"><i class="fa-regular fa-image"></i></div>' +
                '<div class="tm-bg-picker-name">不绑定背景</div><i class="fa-solid fa-circle-check"></i></div>';
            backgrounds.forEach(function (name) {
                html += '<div class="tm-bg-picker-card' + (selectedName === name ? ' on' : '') + '" data-bg="' + esc(name) + '" tabindex="0">' +
                    '<div class="tm-bg-picker-thumb" style="background-image:' + esc(getBackgroundCssUrl(name)) + '"></div>' +
                    '<div class="tm-bg-picker-name">' + esc(name) + '</div>' +
                    '<button class="tm-bg-rename" title="重命名背景" data-bg="' + esc(name) + '"><i class="fa-solid fa-pen"></i></button>' +
                    '<i class="fa-solid fa-circle-check"></i></div>';
            });
            if (backgrounds.length === 0) {
                html += '<div class="tm-empty"><i class="fa-regular fa-image"></i><span>' + (q ? '没有匹配的背景' : '还没有可绑定的 ST 壁纸') + '</span></div>';
            }
            list.innerHTML = html;
            list.querySelectorAll('.tm-bg-picker-card').forEach(function (card) {
                card.addEventListener('click', function () { choose(card.dataset.bg || ''); });
                card.addEventListener('keydown', function (e) { if (e.key === 'Enter') choose(card.dataset.bg || ''); });
            });
            list.querySelectorAll('.tm-bg-rename').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var oldName = btn.dataset.bg || '';
                    var raw = prompt('新的背景名称：', oldName);
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
        var d = load();
        var meta = d.themeMeta[themeName];
        var backgroundName = meta && meta.backgroundName ? meta.backgroundName : '';
        var targetName = backgroundName || '__transparent.png';
        var url = getBackgroundCssUrl(targetName);
        Promise.all([import('/scripts/backgrounds.js'), import('/script.js')])
            .then(function (mods) {
                if (isCurrent && !isCurrent()) { if (cb) cb(false, 'superseded'); return; }
                var bgMod = mods[0];
                var scriptMod = mods[1];
                if (bgMod.background_settings) {
                    bgMod.background_settings.name = targetName;
                    bgMod.background_settings.url = url;
                }
                var bg = document.getElementById('bg1');
                if (bg) bg.style.backgroundImage = url;
                setControlValue('#background_fitting', bgMod.background_settings && bgMod.background_settings.fitting ? bgMod.background_settings.fitting : '');
                if (scriptMod && typeof scriptMod.saveSettingsDebounced === 'function') scriptMod.saveSettingsDebounced();
                if (cb) cb(true);
            })
            .catch(function (err) {
                if (isCurrent && !isCurrent()) { if (cb) cb(false, 'superseded'); return; }
                console.warn('[美化管理] 应用绑定背景失败:', err);
                var bg = document.getElementById('bg1');
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

    function setThemeControlValue(themeName) {
        var themeEl = document.getElementById('themes');
        if (!themeEl) return;
        try {
            if (themeEl.tagName === 'INPUT') {
                var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                if (setter) setter.call(themeEl, themeName); else themeEl.value = themeName;
            } else {
                themeEl.value = themeName;
            }
        } catch (e) { themeEl.value = themeName; }
    }

    function applyThemeVisuals(theme) {
        var root = document.documentElement;
        var body = document.body;
        function has(key) { return theme[key] !== undefined; }
        function cssVar(name, value) { root.style.setProperty(name, String(value)); }
        function bodyClass(cls, value) { body.classList.toggle(cls, !!value); }

        if (has('main_text_color')) {
            cssVar('--SmartThemeBodyColor', theme.main_text_color);
            setColorPicker('#main-text-color-picker', theme.main_text_color);
            var match = String(theme.main_text_color).match(/\(([^)]+)\)/);
            if (match) {
                var parts = match[1].split(',');
                if (parts.length >= 4) {
                    cssVar('--SmartThemeCheckboxBgColorR', parts[0]);
                    cssVar('--SmartThemeCheckboxBgColorG', parts[1]);
                    cssVar('--SmartThemeCheckboxBgColorB', parts[2]);
                    cssVar('--SmartThemeCheckboxBgColorA', parts[3]);
                }
            }
        }
        if (has('italics_text_color')) { cssVar('--SmartThemeEmColor', theme.italics_text_color); setColorPicker('#italics-color-picker', theme.italics_text_color); }
        if (has('underline_text_color')) { cssVar('--SmartThemeUnderlineColor', theme.underline_text_color); setColorPicker('#underline-color-picker', theme.underline_text_color); }
        if (has('quote_text_color')) { cssVar('--SmartThemeQuoteColor', theme.quote_text_color); setColorPicker('#quote-color-picker', theme.quote_text_color); }
        if (has('blur_tint_color')) {
            cssVar('--SmartThemeBlurTintColor', theme.blur_tint_color);
            setColorPicker('#blur-tint-color-picker', theme.blur_tint_color);
            var metaThemeColor = document.querySelector('meta[name=theme-color]');
            if (metaThemeColor) metaThemeColor.setAttribute('content', theme.blur_tint_color);
        }
        if (has('chat_tint_color')) { cssVar('--SmartThemeChatTintColor', theme.chat_tint_color); setColorPicker('#chat-tint-color-picker', theme.chat_tint_color); }
        if (has('user_mes_blur_tint_color')) { cssVar('--SmartThemeUserMesBlurTintColor', theme.user_mes_blur_tint_color); setColorPicker('#user-mes-blur-tint-color-picker', theme.user_mes_blur_tint_color); }
        if (has('bot_mes_blur_tint_color')) { cssVar('--SmartThemeBotMesBlurTintColor', theme.bot_mes_blur_tint_color); setColorPicker('#bot-mes-blur-tint-color-picker', theme.bot_mes_blur_tint_color); }
        if (has('shadow_color')) { cssVar('--SmartThemeShadowColor', theme.shadow_color); setColorPicker('#shadow-color-picker', theme.shadow_color); }
        if (has('border_color')) { cssVar('--SmartThemeBorderColor', theme.border_color); setColorPicker('#border-color-picker', theme.border_color); }

        if (has('blur_strength')) { cssVar('--blurStrength', theme.blur_strength); setControlValue('#blur_strength', theme.blur_strength); setControlValue('#blur_strength_counter', theme.blur_strength); }
        if (has('shadow_width')) { cssVar('--shadowWidth', theme.shadow_width); setControlValue('#shadow_width', theme.shadow_width); setControlValue('#shadow_width_counter', theme.shadow_width); }
        if (has('font_scale')) { cssVar('--fontScale', theme.font_scale); setControlValue('#font_scale', theme.font_scale); setControlValue('#font_scale_counter', theme.font_scale); }
        if (has('chat_width')) { cssVar('--sheldWidth', theme.chat_width + 'vw'); setControlValue('#chat_width_slider', theme.chat_width); setControlValue('#chat_width_slider_counter', theme.chat_width); }

        if (has('custom_css')) {
            setControlValue('#customCSS', theme.custom_css);
            var style = document.getElementById('custom-style');
            if (!style) {
                style = document.createElement('style');
                style.setAttribute('type', 'text/css');
                style.setAttribute('id', 'custom-style');
                document.head.appendChild(style);
            }
            style.innerHTML = theme.custom_css;
        }

        if (has('fast_ui_mode')) {
            bodyClass('no-blur', theme.fast_ui_mode);
            setControlChecked('#fast_ui_mode', theme.fast_ui_mode);
            setControlOpacity('#blur-strength-block', theme.fast_ui_mode ? '0.2' : '1');
            setControlDisabled('#blur_strength', theme.fast_ui_mode);
        }
        if (has('waifuMode')) { bodyClass('waifuMode', theme.waifuMode); setControlChecked('#waifuMode', theme.waifuMode); }
        if (has('noShadows')) {
            bodyClass('noShadows', theme.noShadows);
            setControlChecked('#noShadowsmode', theme.noShadows);
            setControlOpacity('#shadow-width-block', theme.noShadows ? '0.2' : '1');
            setControlDisabled('#shadow_width', theme.noShadows);
        }
        if (has('avatar_style')) {
            body.classList.toggle('big-avatars', Number(theme.avatar_style) === 1);
            body.classList.toggle('square-avatars', Number(theme.avatar_style) === 2);
            body.classList.toggle('rounded-avatars', Number(theme.avatar_style) === 3);
            setControlValue('#avatar_style', theme.avatar_style);
        }
        if (has('chat_display')) {
            var chatDisplay = Number(theme.chat_display);
            body.classList.toggle('bubblechat', chatDisplay === 1);
            body.classList.toggle('documentstyle', chatDisplay === 2);
            setControlValue('#chat_display', theme.chat_display);
        }
        if (has('toastr_position') && window.toastr) {
            window.toastr.options.positionClass = theme.toastr_position;
            setControlValue('#toastr_position', theme.toastr_position);
        }

        if (has('hotswap_enabled')) { body.classList.toggle('no-hotswap', !theme.hotswap_enabled); setControlChecked('#hotswapEnabled', theme.hotswap_enabled); }
        if (has('timer_enabled')) { body.classList.toggle('no-timer', !theme.timer_enabled); setControlChecked('#messageTimerEnabled', theme.timer_enabled); }
        if (has('timestamps_enabled')) { body.classList.toggle('no-timestamps', !theme.timestamps_enabled); setControlChecked('#messageTimestampsEnabled', theme.timestamps_enabled); }
        if (has('timestamp_model_icon')) { body.classList.toggle('no-modelIcons', !theme.timestamp_model_icon); setControlChecked('#messageModelIconEnabled', theme.timestamp_model_icon); }
        if (has('message_token_count_enabled')) { body.classList.toggle('no-tokenCount', !theme.message_token_count_enabled); setControlChecked('#messageTokensEnabled', theme.message_token_count_enabled); }
        if (has('mesIDDisplay_enabled')) { body.classList.toggle('no-mesIDDisplay', !theme.mesIDDisplay_enabled); setControlChecked('#mesIDDisplayEnabled', theme.mesIDDisplay_enabled); }
        if (has('hideChatAvatars_enabled')) { bodyClass('hideChatAvatars', theme.hideChatAvatars_enabled); setControlChecked('#hideChatAvatarsEnabled', theme.hideChatAvatars_enabled); }
        if (has('expand_message_actions')) { bodyClass('expandMessageActions', theme.expand_message_actions); setControlChecked('#expandMessageActions', theme.expand_message_actions); }
        if (has('reduced_motion')) { bodyClass('reduced-motion', theme.reduced_motion); setControlChecked('#reduced_motion', theme.reduced_motion); }
        if (has('compact_input_area')) {
            var sendForm = document.getElementById('send_form');
            if (sendForm) sendForm.classList.toggle('compact', !!theme.compact_input_area);
            setControlChecked('#compact_input_area', theme.compact_input_area);
        }
        if (has('show_swipe_num_all_messages')) { bodyClass('swipeAllMessages', theme.show_swipe_num_all_messages); setControlChecked('#show_swipe_num_all_messages', theme.show_swipe_num_all_messages); }
        if (has('click_to_edit')) setControlChecked('#click_to_edit', theme.click_to_edit);
        if (has('media_display')) setControlValue('#media_display', theme.media_display);
    }

    function applyImportedThemeObject(theme, cb) {
        if (!theme || !theme.name) { if (cb) cb(false); return; }
        setThemeControlValue(theme.name);
        Promise.all([import('/scripts/power-user.js'), import('/script.js')])
            .then(function (mods) {
                var puMod = mods[0];
                var scriptMod = mods[1];
                if (puMod.power_user) {
                    for (var key in theme) {
                        if (key === 'name') continue;
                        if (Object.prototype.hasOwnProperty.call(puMod.power_user, key)) puMod.power_user[key] = theme[key];
                    }
                    puMod.power_user.theme = theme.name;
                }
                applyThemeVisuals(theme);
                if (scriptMod && typeof scriptMod.saveSettingsDebounced === 'function') scriptMod.saveSettingsDebounced();
                if (cb) cb(true);
            })
            .catch(function (err) {
                console.warn('[美化管理] 直接应用导入主题失败，尝试仅应用视觉样式:', err);
                applyThemeVisuals(theme);
                if (cb) cb(true);
            });
    }

    // 原生 ST 没有暴露主题数组刷新能力时，仅对本页刚改名的完整主题兜底。
    // 普通酒馆主题不会进入 importedThemeCache，也不会交给 applyImportedThemeObject。
    function applyCompleteNativeThemeFallback(theme, cb) {
        if (!isCompleteThemeObject(theme, theme && theme.name)) { if (cb) cb(false); return; }
        setThemeControlValue(theme.name);
        Promise.all([import('/scripts/power-user.js'), import('/script.js')])
            .then(function (mods) {
                var powerUserModule = mods[0];
                var scriptModule = mods[1];
                if (powerUserModule.power_user) {
                    for (var key in theme) {
                        if (key === 'name') continue;
                        if (Object.prototype.hasOwnProperty.call(powerUserModule.power_user, key)) {
                            powerUserModule.power_user[key] = theme[key];
                        }
                    }
                    powerUserModule.power_user.theme = theme.name;
                }
                applyThemeVisuals(theme);
                if (scriptModule && typeof scriptModule.saveSettingsDebounced === 'function') {
                    scriptModule.saveSettingsDebounced();
                }
                if (cb) cb(true);
            })
            .catch(function (err) {
                console.warn('[美化管理] 原生主题缓存不可刷新，兜底应用视觉样式:', err);
                applyThemeVisuals(theme);
                if (cb) cb(true);
            });
    }

    function hydrateRenamedNativeTheme(theme) {
        return themeRuntime.hydrate(theme);
    }

    function getThemeNameFromControl(themeEl) {
        if (!themeEl) return '';
        if (themeEl.tagName === 'SELECT') {
            var opt = themeEl.options[themeEl.selectedIndex];
            return opt ? String(opt.value || opt.textContent || '').trim() : '';
        }
        return String(themeEl.value || '').trim();
    }

    function bindImportedThemeSelectSync() {
        if (importedThemeSelectSyncBound) return;
        importedThemeSelectSyncBound = true;
        document.addEventListener('change', function (e) {
            if (!e.target || e.target.id !== 'themes') return;
            var name = getThemeNameFromControl(e.target);
            var theme = name ? importedThemeCache[name] : null;
            if (theme) {
                applyImportedThemeObject(theme, function (ok) {
                    if (ok) {
                        applyBoundBackground(name, function () {
                            renderGrid(); renderBottomStatus();
                        });
                    }
                });
                return;
            }

            var renamedNativeTheme = name ? renamedNativeThemeCache[name] : null;
            if (!renamedNativeTheme || hydrateRenamedNativeTheme(renamedNativeTheme)) return;
            applyCompleteNativeThemeFallback(renamedNativeTheme, function (ok) {
                if (ok) {
                    applyBoundBackground(name, function () {
                        renderGrid(); renderBottomStatus();
                    });
                }
            });
        }, true);
    }

    function rememberImportedTheme(theme) {
        if (!theme || !theme.name) return;
        importedThemeCache[theme.name] = theme;
        themeRuntime.remember(theme);
        bindImportedThemeSelectSync();
    }

    function isPlainThemeObject(theme) { return themeSchema.isPlainObject(theme); }
    function isCompleteThemeObject(theme, expectedName) { return themeSchema.isCompleteTheme(theme, expectedName); }

    function invalidateBaibaokuThemeCache(reason) {
        themeRuntime.invalidate(reason);
    }

    function cloneThemeValue(value) { return themeSchema.cloneValue(value); }

    function getFallbackThemeDefaults() {
        var rootStyle = getComputedStyle(document.documentElement);
        function cssVar(name, fallback) {
            var value = rootStyle.getPropertyValue(name).trim();
            return value || fallback;
        }
        return {
            blur_strength: 10,
            main_text_color: cssVar('--SmartThemeBodyColor', 'rgba(220, 220, 210, 1)'),
            italics_text_color: cssVar('--SmartThemeEmColor', 'rgba(145, 145, 145, 1)'),
            underline_text_color: cssVar('--SmartThemeUnderlineColor', 'rgba(188, 231, 207, 1)'),
            quote_text_color: cssVar('--SmartThemeQuoteColor', 'rgba(225, 138, 36, 1)'),
            blur_tint_color: cssVar('--SmartThemeBlurTintColor', 'rgba(23, 23, 23, 1)'),
            chat_tint_color: cssVar('--SmartThemeChatTintColor', 'rgba(23, 23, 23, 1)'),
            user_mes_blur_tint_color: cssVar('--SmartThemeUserMesBlurTintColor', 'rgba(23, 23, 23, 1)'),
            bot_mes_blur_tint_color: cssVar('--SmartThemeBotMesBlurTintColor', 'rgba(23, 23, 23, 1)'),
            shadow_color: cssVar('--SmartThemeShadowColor', 'rgba(0, 0, 0, 1)'),
            shadow_width: 2,
            border_color: cssVar('--SmartThemeBorderColor', 'rgba(0, 0, 0, 1)'),
            font_scale: 1,
            fast_ui_mode: true,
            waifuMode: false,
            avatar_style: 0,
            chat_display: 0,
            toastr_position: 'toast-top-center',
            noShadows: false,
            chat_width: 50,
            timer_enabled: true,
            timestamps_enabled: true,
            timestamp_model_icon: false,
            mesIDDisplay_enabled: false,
            hideChatAvatars_enabled: false,
            message_token_count_enabled: false,
            expand_message_actions: false,
            hotswap_enabled: true,
            custom_css: '',
            reduced_motion: false,
            compact_input_area: true,
            show_swipe_num_all_messages: false,
            click_to_edit: false,
            media_display: 'list'
        };
    }

    function getThemeCompatDefaults(cb) {
        var defaults = getFallbackThemeDefaults();
        import('/scripts/power-user.js')
            .then(function (mod) {
                var pu = mod && mod.power_user;
                if (pu) {
                    themeSchema.THEME_FIELDS.forEach(function (key) {
                        if (Object.prototype.hasOwnProperty.call(pu, key)) defaults[key] = cloneThemeValue(pu[key]);
                    });
                }
                cb(defaults);
            })
            .catch(function () { cb(defaults); });
    }

    function getMissingThemeFields(theme) {
        return themeSchema.getMissingFields(theme);
    }

    function normalizeThemeObject(theme, defaults, existingTheme) {
        return themeSchema.normalizeTheme(theme, defaults, existingTheme);
    }

    function normalizeThemeObjects(themes, cb) {
        getThemeCompatDefaults(function (defaults) {
            getAllThemeObjects(function (existingThemes) {
                var existingByName = {};
                (existingThemes || []).forEach(function (theme) {
                    if (theme && theme.name) existingByName[theme.name] = theme;
                });
                var fixedCount = 0;
                var missingTotal = 0;
                var normalized = themes.map(function (theme) {
                    var missing = getMissingThemeFields(theme);
                    if (missing.length > 0) {
                        fixedCount++;
                        missingTotal += missing.length;
                    }
                    return normalizeThemeObject(theme, defaults, existingByName[theme.name]);
                });
                cb(normalized, { fixedCount: fixedCount, missingTotal: missingTotal });
            });
        });
    }

    function getPostHeaders() {
        return themeApi.getPostHeaders();
    }

    function getAllThemeObjects(cb, bypassBaibaokuCache) {
        themeRuntime.getInventory({ bypassBaibaokuCache: bypassBaibaokuCache })
            .then(function (themes) { cb(themes); })
            .catch(function (err) {
                console.warn('[美化管理] 获取完整主题失败:', err);
                cb(null, err);
            });
    }

    function getThemeObjectByName(themeName, cb) {
        if (importedThemeCache[themeName]) { cb(importedThemeCache[themeName]); return; }
        var cached = themeRuntime.getCached(themeName);
        if (cached) { cb(cached); return; }
        getAllThemeObjects(function (themes) {
            var found = null;
            if (themes) {
                themes.forEach(function (theme) {
                    if (theme && theme.name === themeName) found = theme;
                });
            }
            if (isCompleteThemeObject(found, themeName)) themeRuntime.remember(found);
            cb(found);
        });
    }

    function prepareCompleteNativeThemeForApply(themeName) {
        return themeRuntime.prepareCompleteThemeForApply(themeName);
    }

    function dispatchPreparedNativeThemeChange(themeEl, themeName, bypassLazyGuard) {
        var guard = null;
        var previousReplaying = false;
        try { guard = window.__baiBaiToolkitLazyThemeChangeGuard; } catch (e) {}
        if (bypassLazyGuard && guard && typeof guard === 'object') {
            previousReplaying = guard.replaying === true;
            guard.replaying = true;
        }
        try {
            if (themeEl.tagName === 'INPUT') themeEl.dispatchEvent(new Event('input', { bubbles: true }));
            themeEl.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
            if (bypassLazyGuard && guard && typeof guard === 'object') {
                guard.replaying = previousReplaying;
                guard.currentThemeName = themeName;
            }
        }
    }

    function syncThemeOption(themeName) {
        var themeEl = document.getElementById('themes');
        if (themeEl && themeEl.tagName === 'SELECT') {
            var hasOption = false;
            for (var i = 0; i < themeEl.options.length; i++) {
                if (themeEl.options[i].value === themeName || themeEl.options[i].textContent === themeName) { hasOption = true; break; }
            }
            if (!hasOption) {
                var opt = document.createElement('option'); opt.value = themeName; opt.textContent = themeName; themeEl.appendChild(opt);
            }
        } else if (themeEl && themeEl.tagName === 'INPUT' && themeEl.getAttribute('list')) {
            var dl = document.getElementById(themeEl.getAttribute('list'));
            if (dl && dl.options) {
                var hasDlOption = false;
                for (var j = 0; j < dl.options.length; j++) {
                    if (dl.options[j].value === themeName || dl.options[j].textContent === themeName) { hasDlOption = true; break; }
                }
                if (!hasDlOption) {
                    var dlOpt = document.createElement('option'); dlOpt.value = themeName; dl.appendChild(dlOpt);
                }
            }
        }
    }

    function saveThemeToServer(theme, headers) {
        return themeApi.saveTheme(theme, headers);
    }

    function deleteThemeFromServer(themeName, headers) {
        return themeApi.deleteTheme(themeName, headers);
    }

    function removeThemeOption(themeName) {
        var themeEl = document.getElementById('themes');
        if (themeEl && themeEl.tagName === 'SELECT') {
            for (var i = themeEl.options.length - 1; i >= 0; i--) {
                if (themeEl.options[i].value === themeName || themeEl.options[i].textContent === themeName) themeEl.remove(i);
            }
        } else if (themeEl && themeEl.tagName === 'INPUT' && themeEl.getAttribute('list')) {
            var dl = document.getElementById(themeEl.getAttribute('list'));
            if (dl && dl.options) {
                for (var j = dl.options.length - 1; j >= 0; j--) {
                    if (dl.options[j].value === themeName || dl.options[j].textContent === themeName) dl.removeChild(dl.options[j]);
                }
            }
        }
    }

    function renameThemeOption(oldName, newName) {
        var themeEl = document.getElementById('themes');
        if (themeEl && themeEl.tagName === 'SELECT') {
            for (var i = 0; i < themeEl.options.length; i++) {
                if (themeEl.options[i].value === oldName || themeEl.options[i].textContent === oldName) {
                    themeEl.options[i].value = newName;
                    themeEl.options[i].textContent = newName;
                }
            }
        } else if (themeEl && themeEl.tagName === 'INPUT' && themeEl.getAttribute('list')) {
            var dl = document.getElementById(themeEl.getAttribute('list'));
            if (dl && dl.options) {
                for (var j = 0; j < dl.options.length; j++) {
                    if (dl.options[j].value === oldName || dl.options[j].textContent === oldName) {
                        dl.options[j].value = newName;
                        dl.options[j].textContent = newName;
                    }
                }
            }
        }
    }

    function migrateThemeMetaName(oldName, newName) {
        var dd = load();
        if (dd.themeMeta[oldName]) {
            dd.themeMeta[newName] = dd.themeMeta[oldName];
            delete dd.themeMeta[oldName];
            save(dd);
        }
    }

    function removeThemeMetaName(themeName) {
        var dd = load();
        if (dd.themeMeta[themeName]) {
            delete dd.themeMeta[themeName];
            save(dd);
        }
    }

    function makeThemeRenameError(code, message) {
        var error = new Error(message || code);
        error.code = code;
        return error;
    }

    function getSanitizedThemeFilename(themeName) {
        return themeSchema.sanitizeFilename(themeName);
    }

    function findThemeByName(themes, themeName) {
        return themeRuntime.findTheme(themes, themeName);
    }

    function getFreshThemeInventory(reason, bypassBaibaokuCache) {
        invalidateBaibaokuThemeCache(reason);
        return new Promise(function (resolve, reject) {
            getAllThemeObjects(function (themes, err) {
                if (!themes) {
                    reject(makeThemeRenameError('inventory-failed', err && err.message ? err.message : '无法读取主题列表'));
                    return;
                }
                resolve(themes);
            }, bypassBaibaokuCache);
        });
    }

    function ensureCompleteThemeObject(themeName, candidate) {
        return themeRuntime.ensureCompleteTheme(themeName, candidate)
            .catch(function (err) {
                if (err && err.code !== 'incomplete') console.warn('[美化管理] 柏宝库完整主题加载失败:', err);
                throw makeThemeRenameError('incomplete', '主题尚未完整加载，不能安全改名');
            });
    }

    function resolveCompleteThemeForRename(themeName) {
        var nativeThemeRef = null;
        var bridge = themeRuntime.getBridge();
        var bridgeLoad = bridge && typeof bridge.ensureThemeLoaded === 'function'
            ? Promise.resolve().then(function () { return bridge.ensureThemeLoaded(themeName); }).catch(function (err) {
                console.warn('[美化管理] 柏宝库原生主题缓存预加载失败:', err);
                return null;
            })
            : Promise.resolve(null);

        return bridgeLoad
            .then(function (loaded) {
                if (isCompleteThemeObject(loaded, themeName)) nativeThemeRef = loaded;
                // Bypass fast-get here so the inventory reflects the actual files and
                // does not replace BaiBaoKu's reference to SillyTavern's native array.
                return getFreshThemeInventory('theme-manager-rename-read', true);
            })
            .then(function (themes) {
                var candidate = findThemeByName(themes, themeName);
                if (!isCompleteThemeObject(candidate, themeName) && nativeThemeRef) candidate = nativeThemeRef;
                return ensureCompleteThemeObject(themeName, candidate)
                    .then(function (theme) { return { theme: theme, themes: themes, nativeThemeRef: nativeThemeRef }; });
            });
    }

    function getThemeRenameConflict(oldName, newName, themes) {
        var targetFilename = getSanitizedThemeFilename(newName);
        if (!targetFilename) return 'invalid-filename';

        var seenNames = {};
        var names = [];
        (themes || []).forEach(function (theme) {
            if (theme && theme.name && !seenNames[theme.name]) {
                seenNames[theme.name] = true;
                names.push(theme.name);
            }
        });
        stThemeList.forEach(function (name) {
            if (name && !seenNames[name]) {
                seenNames[name] = true;
                names.push(name);
            }
        });

        var targetKey = targetFilename.toLowerCase();
        for (var i = 0; i < names.length; i++) {
            var existingName = names[i];
            if (existingName === newName && existingName !== oldName) return 'duplicate';
            if (existingName === oldName && newName === oldName) continue;
            var existingKey = getSanitizedThemeFilename(existingName).toLowerCase();
            if (existingKey && existingKey === targetKey) return 'filename-conflict';
        }
        return '';
    }

    function sameThemeConfig(expected, actual) {
        return themeSchema.sameConfig(expected, actual);
    }

    function verifySavedTheme(expectedTheme) {
        return getFreshThemeInventory('theme-manager-rename-verify', true)
            .then(function (themes) {
                var candidate = findThemeByName(themes, expectedTheme.name);
                if (!candidate) throw makeThemeRenameError('verify-failed', '保存后未找到新主题');
                return ensureCompleteThemeObject(expectedTheme.name, candidate)
                    .then(function (complete) {
                        if (!sameThemeConfig(expectedTheme, complete)) {
                            throw makeThemeRenameError('verify-failed', '新主题内容验证失败');
                        }
                        return { theme: complete, themes: themes };
                    });
            })
            .catch(function (err) {
                if (err && err.code === 'verify-failed') throw err;
                throw makeThemeRenameError('verify-failed', err && err.message ? err.message : '新主题验证失败');
            });
    }

    function syncCurrentThemeRenameState(oldName, newName, wasCurrent) {
        renameThemeOption(oldName, newName);
        if (!wasCurrent) return Promise.resolve();

        setThemeControlValue(newName);
        try {
            if (window.power_user && window.power_user.theme === oldName) window.power_user.theme = newName;
        } catch (e) {}

        return Promise.all([import('/scripts/power-user.js'), import('/script.js')])
            .then(function (mods) {
                var powerUserModule = mods[0];
                var scriptModule = mods[1];
                if (powerUserModule && powerUserModule.power_user) powerUserModule.power_user.theme = newName;
                if (scriptModule && typeof scriptModule.saveSettingsDebounced === 'function') {
                    scriptModule.saveSettingsDebounced();
                }
            })
            .catch(function (err) {
                console.warn('[美化管理] 同步当前主题新名称失败:', err);
            });
    }

    function refreshNativeThemeCache(oldName, verifiedTheme, nativeThemeRef) {
        var complete = cloneThemeValue(verifiedTheme);
        if (isPlainThemeObject(nativeThemeRef) && (nativeThemeRef.name === oldName || nativeThemeRef.name === complete.name)) {
            Object.keys(nativeThemeRef).forEach(function (key) { delete nativeThemeRef[key]; });
            Object.assign(nativeThemeRef, cloneThemeValue(complete));
        }
        hydrateRenamedNativeTheme(complete);
    }

    function renderAfterThemeRename() {
        renderCatbar();
        renderGrid();
        renderBottomStatus();
        updateBtn();
    }

    function renameThemeEverywhere(oldName, newName, cb) {
        newName = String(newName || '').trim();
        if (!newName) { if (cb) cb(false, 'empty'); return; }
        if (newName === oldName) { if (cb) cb(false, 'same'); return; }

        var headers = null;
        var renamed = null;
        var verified = null;
        var nativeThemeRef = null;
        var saveAttempted = false;
        var deleteOldStarted = false;
        var wasCurrent = getCurrentThemeName() === oldName;

        resolveCompleteThemeForRename(oldName)
            .then(function (resolved) {
                nativeThemeRef = resolved.nativeThemeRef;
                var conflict = getThemeRenameConflict(oldName, newName, resolved.themes);
                if (conflict) throw makeThemeRenameError(conflict, conflict);

                renamed = cloneJson(resolved.theme);
                renamed.name = newName;
                themeSchema.removeLazyMarker(renamed);
                if (!isCompleteThemeObject(renamed, newName)) {
                    throw makeThemeRenameError('incomplete', '主题尚未完整加载，不能安全改名');
                }
                return getPostHeaders();
            })
            .then(function (postHeaders) {
                headers = postHeaders;
                saveAttempted = true;
                return saveThemeToServer(renamed, headers);
            })
            .then(function () { return verifySavedTheme(renamed); })
            .then(function (result) {
                verified = result.theme;
                deleteOldStarted = true;
                return deleteThemeFromServer(oldName, headers);
            })
            .then(function () {
                invalidateBaibaokuThemeCache('theme-manager-rename-delete-old');
                delete importedThemeCache[oldName];
                delete importedThemeCache[newName];
                themeRuntime.forget(oldName);
                themeRuntime.remember(verified);
                delete renamedNativeThemeCache[oldName];
                delete renamedNativeThemeCache[newName];
                renamedNativeThemeCache[newName] = cloneThemeValue(verified);
                refreshNativeThemeCache(oldName, verified, nativeThemeRef);
                migrateThemeMetaName(oldName, newName);

                return syncCurrentThemeRenameState(oldName, newName, wasCurrent)
                    .then(function () {
                        return getFreshThemeInventory('theme-manager-rename-final', true).catch(function (err) {
                            console.warn('[美化管理] 重命名后的主题列表刷新失败:', err);
                            return null;
                        });
                    });
            })
            .then(function (themes) {
                if (themes) {
                    stThemeList = themes.filter(function (theme) { return theme && theme.name; }).map(function (theme) { return theme.name; });
                } else {
                    stThemeList = stThemeList.filter(function (name) { return name !== oldName && name !== newName; });
                    stThemeList.push(newName);
                }
                removeThemeOption(oldName);
                syncThemeOption(newName);
                setThemeControlValue(wasCurrent ? newName : getCurrentThemeName());
                renderAfterThemeRename();
                if (cb) cb(true);
            })
            .catch(function (err) {
                var reason = err && err.code ? err.code : 'failed';
                console.warn('[美化管理] 重命名美化失败:', err);

                if (saveAttempted && !deleteOldStarted && headers) {
                    deleteThemeFromServer(newName, headers)
                        .catch(function (cleanupErr) {
                            console.warn('[美化管理] 清理失败的新主题文件失败:', cleanupErr);
                        })
                        .then(function () {
                            invalidateBaibaokuThemeCache('theme-manager-rename-rollback');
                            if (cb) cb(false, reason);
                        });
                    return;
                }

                if (deleteOldStarted) reason = 'delete-failed';
                if (cb) cb(false, reason);
            });
    }

    function deleteThemeEverywhere(themeName, cb) {
        getPostHeaders()
            .then(function (headers) { return deleteThemeFromServer(themeName, headers); })
            .then(function () {
                var wasCurrent = getCurrentThemeName() === themeName;
                delete importedThemeCache[themeName];
                themeRuntime.forget(themeName);
                delete renamedNativeThemeCache[themeName];
                removeThemeMetaName(themeName);
                removeThemeOption(themeName);
                stThemeList = stThemeList.filter(function (n) { return n !== themeName; });
                var nextTheme = stThemeList[0] || '';
                if (wasCurrent && nextTheme) {
                    applyTheme(nextTheme, function () {
                        fetchThemeList(function () { renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn(); });
                    });
                } else {
                    fetchThemeList(function () { renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn(); });
                }
                if (cb) cb(true);
            })
            .catch(function (err) {
                console.warn('[美化管理] 删除美化失败:', err);
                if (cb) cb(false, err.message);
            });
    }

    function downloadJsonBlob(filename, data) {
        try {
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
        } catch (e) {
            toast('导出失败：' + e.message, true);
        }
    }

    function cloneJson(v) {
        return themeSchema.cloneValue(v);
    }

    function collectServerImageUrls(data) {
        var urls = [];
        var seen = {};
        collectImageFields(data).forEach(function (ref) {
            if (isServerImage(ref.value) && !seen[ref.value]) {
                seen[ref.value] = true;
                urls.push(ref.value);
            }
        });
        return urls;
    }

    function downloadJsonFile(filename, data, cb) {
        var exportData = cloneJson(data);
        var urls = collectServerImageUrls(exportData);
        if (urls.length === 0) {
            downloadJsonBlob(filename, exportData);
            if (cb) cb(0);
            return;
        }
        toast('正在打包图片…');
        batchResolveImages(urls, function (imageMap) {
            var assets = {};
            for (var url in imageMap) {
                var dataUrl = imageMap[url];
                if (isDataImage(dataUrl)) {
                    var name = url.replace(SERVER_IMAGE_PREFIX, '');
                    if (name) assets[name] = dataUrl;
                }
            }
            if (Object.keys(assets).length > 0) exportData._assets = assets;
            downloadJsonBlob(filename, exportData);
            if (cb) cb(Object.keys(assets).length);
        });
    }

    function readJsonFile(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function (e) {
                try { resolve({ file: file, data: JSON.parse(e.target.result) }); }
                catch (err) { reject(new Error(file.name + ' 解析失败')); }
            };
            reader.onerror = function () { reject(new Error(file.name + ' 读取失败')); };
            reader.readAsText(file, 'utf-8');
        });
    }

    function replaceAssetUrlsInData(data, urlMap) {
        collectImageFields(data).forEach(function (ref) {
            if (!isServerImage(ref.value)) return;
            var name = ref.value.replace(SERVER_IMAGE_PREFIX, '');
            if (urlMap[name]) ref.obj[ref.key] = urlMap[name];
        });
    }

    function resolveImportAssets(imported, cb) {
        var assets = imported && imported._assets;
        if (!assets || typeof assets !== 'object') { if (cb) cb(); return; }
        var names = Object.keys(assets);
        if (names.length === 0) { delete imported._assets; if (cb) cb(); return; }

        if (!getServerMode()) {
            var fallbackMap = {};
            names.forEach(function (name) { fallbackMap[name] = assets[name]; });
            replaceAssetUrlsInData(imported, fallbackMap);
            delete imported._assets;
            if (cb) cb();
            return;
        }

        var urlMap = {};
        var done = 0;
        toast('正在导入图片（0/' + names.length + '）…');
        names.forEach(function (name) {
            uploadImage(assets[name], function (_err, newUrl) {
                urlMap[name] = newUrl || assets[name];
                done++;
                if (done % 5 === 0 || done === names.length) toast('正在导入图片（' + done + '/' + names.length + '）…');
                if (done >= names.length) {
                    replaceAssetUrlsInData(imported, urlMap);
                    delete imported._assets;
                    if (cb) cb();
                }
            });
        });
    }

    function cleanThemeMetaForBundle(meta) {
        var out = {};
        if (!meta) return out;
        if (meta.category) out.category = meta.category;
        if (Array.isArray(meta.tags) && meta.tags.length > 0) out.tags = meta.tags.slice();
        if (meta.author) out.author = meta.author;
        if (meta.description) out.description = meta.description;
        if (meta.backgroundName) out.backgroundName = meta.backgroundName;
        if (meta.imageData) out.imageData = meta.imageData;
        if (meta.thumbData) out.thumbData = meta.thumbData;
        if (meta.crop) out.crop = meta.crop;
        return out;
    }

    function buildThemeMetaForBundle(themes) {
        var d = load();
        var meta = {};
        themes.forEach(function (theme) {
            if (!theme || !theme.name) return;
            var m = d.themeMeta[theme.name];
            var clean = cleanThemeMetaForBundle(m);
            if (Object.keys(clean).length > 0) meta[theme.name] = clean;
        });
        return meta;
    }

    function extractThemeObjects(parsed, sourceName) {
        var raw = [];
        if (parsed && Array.isArray(parsed.themes)) raw = parsed.themes;
        else if (Array.isArray(parsed)) raw = parsed;
        else if (parsed && parsed.name) raw = [parsed];
        else throw new Error(sourceName + ' 缺少 name 或 themes 字段');

        return raw.map(function (theme, idx) {
            if (!theme || !theme.name || !String(theme.name).trim()) throw new Error(sourceName + ' 第 ' + (idx + 1) + ' 个主题缺少 name');
            theme.name = String(theme.name).trim();
            return theme;
        });
    }

    function extractThemeImportPayload(parsed, sourceName) {
        var themes = extractThemeObjects(parsed, sourceName);
        var metaSrc = {};
        var cats = [];

        if (parsed && parsed.themeMeta && typeof parsed.themeMeta === 'object') metaSrc = parsed.themeMeta;
        else if (parsed && parsed.meta && parsed.meta.themeMeta && typeof parsed.meta.themeMeta === 'object') metaSrc = parsed.meta.themeMeta;

        if (parsed && Array.isArray(parsed.categories)) cats = parsed.categories.slice();
        else if (parsed && parsed.meta && Array.isArray(parsed.meta.categories)) cats = parsed.meta.categories.slice();

        var metaByName = {};
        themes.forEach(function (theme) {
            var m = metaSrc[theme.name];
            if (m) metaByName[theme.name] = cleanThemeMetaForBundle(m);
        });

        return { themes: themes, themeMeta: metaByName, categories: cats, sourceName: sourceName };
    }

    function mergeThemePayload(target, payload) {
        payload.themes.forEach(function (theme) { target.themes.push(theme); });
        for (var name in payload.themeMeta) target.themeMeta[name] = payload.themeMeta[name];
        payload.categories.forEach(function (cat) {
            if (cat && target.categories.indexOf(cat) === -1) target.categories.push(cat);
        });
        return target;
    }

    function mergeImportedThemeMeta(themeNames, metaByName, categories, forceCategory) {
        if ((!metaByName || Object.keys(metaByName).length === 0) && (!categories || categories.length === 0)) return;
        var dd = load();
        (categories || []).forEach(function (cat) {
            if (cat && dd.categories.indexOf(cat) === -1) dd.categories.push(cat);
        });
        themeNames.forEach(function (name) {
            var imp = metaByName ? metaByName[name] : null;
            if (!imp) return;
            var existing = getMeta(dd, name);
            if (!Array.isArray(existing.tags)) existing.tags = [];
            if (forceCategory && Object.prototype.hasOwnProperty.call(imp, 'category')) existing.category = imp.category || '';
            else if (!existing.category && imp.category) existing.category = imp.category;
            if (imp.tags) imp.tags.forEach(function (t) { if (existing.tags.indexOf(t) === -1) existing.tags.push(t); });
            if (!existing.author && imp.author) existing.author = imp.author;
            if (!existing.description && imp.description) existing.description = imp.description;
            if (!existing.backgroundName && imp.backgroundName) existing.backgroundName = imp.backgroundName;
            if (!existing.imageData && imp.imageData) existing.imageData = imp.imageData;
            if (!existing.thumbData && imp.thumbData) existing.thumbData = imp.thumbData;
            if (!existing.crop && imp.crop) existing.crop = imp.crop;
        });
        save(dd);
    }

    function getThemeImportCategoryInfo(payload) {
        var order = [];
        var counts = {};
        var uncatCount = 0;
        function addCat(cat) {
            if (!cat || order.indexOf(cat) !== -1) return;
            order.push(cat);
            if (counts[cat] === undefined) counts[cat] = 0;
        }
        payload.categories.forEach(function (cat) { if (cat) addCat(String(cat)); });
        payload.themes.forEach(function (theme) {
            var meta = payload.themeMeta[theme.name] || {};
            var cat = meta.category ? String(meta.category) : '';
            if (cat) {
                addCat(cat);
                counts[cat] = (counts[cat] || 0) + 1;
            } else {
                uncatCount++;
            }
        });
        return { categories: order.filter(function (cat) { return (counts[cat] || 0) > 0; }), counts: counts, uncatCount: uncatCount };
    }

    function importThemePayload(payload, opts) {
        opts = opts || {};
        if (!payload || !payload.themes || payload.themes.length === 0) { toast('没有可导入的美化', true); return; }
        openThemeImportCategorySheet(payload, opts);
    }

    function openThemeImportCategorySheet(payload, opts) {
        opts = opts || {};
        var info = getThemeImportCategoryInfo(payload);
        var localCats = load().categories || [];
        var rows = '';
        if (info.categories.length > 0) {
            info.categories.forEach(function (cat) {
                rows += '<label class="tm-import-cat-item"><input type="checkbox" class="tm-chk tm-import-cat-check" data-cat="' + esc(cat) + '" checked />' +
                    '<span>' + esc(cat) + '</span><small>' + (info.counts[cat] || 0) + ' 个美化</small></label>';
            });
            if (info.uncatCount > 0) {
                rows += '<label class="tm-import-cat-item"><input type="checkbox" class="tm-chk tm-import-uncat-check" checked />' +
                    '<span>未分类</span><small>' + info.uncatCount + ' 个美化</small></label>';
            }
        } else {
            rows = '<div class="tm-hint">这次导入的美化没有包内分类，将全部导入。可在下方指定导入后的本地分类。</div>';
        }
        var targetOptions = (info.categories.length > 0 ? '<option value="__keep__">保留包内分类</option>' : '') +
            '<option value="">未分类</option>' +
            localCats.map(function (cat) { return '<option value="' + esc(cat) + '">' + esc(cat) + '</option>'; }).join('') +
            '<option value="__new__">新建分类...</option>';

        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-filter"></i>选择导入分类</div>',
            '<div class="tm-hint">' + (info.categories.length > 0 ? '只会导入勾选分类下的美化；分类来自美化包附带的管理器标注。' : '导入前可以给这些美化指定一个本地分类。') + '</div>',
            (info.categories.length > 0 ? '<div class="tm-import-cat-tools">' +
            '<button class="tm-btn-sm" id="tm-import-cat-all">全选</button>' +
            '<button class="tm-btn-sm" id="tm-import-cat-none">全不选</button>' +
            '</div>' : ''),
            '<div class="tm-import-cat-list">' + rows + '</div>',
            '<div class="tm-field"><label>导入后分类</label><select id="tm-import-target-cat">' + targetOptions + '</select></div>',
            '<div class="tm-field" id="tm-import-new-cat-wrap" style="display:none"><label>新分类名称</label><input type="text" id="tm-import-new-cat" placeholder="输入分类名称" /></div>',
            '<div class="tm-edit-foot">' +
            '<button class="tm-btn tm-btn-outline" id="tm-import-cat-cancel">取消</button>' +
            '<button class="tm-btn tm-btn-safe" id="tm-import-cat-ok">导入选中</button>' +
            '</div>',
        ].join(''));

        var allBtn = sheet.querySelector('#tm-import-cat-all');
        if (allBtn) allBtn.addEventListener('click', function () {
            sheet.querySelectorAll('.tm-import-cat-check,.tm-import-uncat-check').forEach(function (chk) { chk.checked = true; });
        });
        var noneBtn = sheet.querySelector('#tm-import-cat-none');
        if (noneBtn) noneBtn.addEventListener('click', function () {
            sheet.querySelectorAll('.tm-import-cat-check,.tm-import-uncat-check').forEach(function (chk) { chk.checked = false; });
        });
        sheet.querySelector('#tm-import-target-cat').addEventListener('change', function () {
            sheet.querySelector('#tm-import-new-cat-wrap').style.display = this.value === '__new__' ? '' : 'none';
        });
        sheet.querySelector('#tm-import-cat-cancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#tm-import-cat-ok').addEventListener('click', function () {
            var selected = {};
            var selectedCats = [];
            sheet.querySelectorAll('.tm-import-cat-check').forEach(function (chk) {
                if (chk.checked) { selected[chk.dataset.cat] = true; selectedCats.push(chk.dataset.cat); }
            });
            var uncat = sheet.querySelector('.tm-import-uncat-check');
            var includeUncat = !!(uncat && uncat.checked);
            var targetCat = sheet.querySelector('#tm-import-target-cat').value;
            if (targetCat === '__new__') {
                targetCat = sheet.querySelector('#tm-import-new-cat').value.trim();
                if (!targetCat) { toast('请输入新分类名称', true); return; }
            }
            var selectedThemes = [];
            var selectedMeta = {};
            payload.themes.forEach(function (theme) {
                var meta = payload.themeMeta[theme.name] || {};
                var cat = meta.category || '';
                var shouldImport = info.categories.length === 0 || (cat && selected[cat]) || (!cat && includeUncat);
                if (shouldImport) {
                    selectedThemes.push(theme);
                    selectedMeta[theme.name] = payload.themeMeta[theme.name] ? Object.assign({}, payload.themeMeta[theme.name]) : {};
                    if (targetCat !== '__keep__') selectedMeta[theme.name].category = targetCat;
                }
            });
            if (selectedThemes.length === 0) { toast('请至少选择一个分类', true); return; }
            closeSheet(sheet);
            importThemeObjects(selectedThemes, {
                failText: opts.failText,
                metaByName: selectedMeta,
                categories: targetCat === '__keep__' ? selectedCats : (targetCat ? [targetCat] : []),
                forceCategory: targetCat !== '__keep__',
            });
        });
    }

    function importThemeObjects(themes, opts) {
        opts = opts || {};
        if (!themes || themes.length === 0) { toast('没有可导入的美化', true); return; }

        var byName = {};
        var dupInImport = [];
        themes.forEach(function (theme) {
            if (byName[theme.name]) dupInImport.push(theme.name);
            byName[theme.name] = theme;
        });
        var finalThemes = Object.keys(byName).map(function (name) { return byName[name]; });

        if (dupInImport.length > 0 && !confirm('导入内容中有 ' + dupInImport.length + ' 个重名美化，将以最后出现的为准。是否继续？')) return;

        var importThemes = finalThemes.filter(function (theme) { return typeof theme.custom_css === 'string' && /@import/i.test(theme.custom_css); });
        if (importThemes.length > 0 && !confirm('检测到 ' + importThemes.length + ' 个美化的 custom_css 中包含 @import。\n导入外部样式可能带来加载失败或安全风险，仍要继续吗？')) return;

        var existing = finalThemes.filter(function (theme) { return stThemeList.indexOf(theme.name) !== -1; });
        if (existing.length > 0 && !confirm('检测到 ' + existing.length + ' 个同名美化，继续导入将覆盖已有主题。是否继续？')) return;

        normalizeThemeObjects(finalThemes, function (normalizedThemes, compatInfo) {
            getPostHeaders()
                .then(function (headers) {
                    return Promise.all(normalizedThemes.map(function (theme) {
                        return saveThemeToServer(theme, headers)
                            .then(function () { return { ok: true, theme: theme }; })
                            .catch(function (err) { return { ok: false, theme: theme, error: err }; });
                    }));
                })
                .then(function (results) {
                    var okCount = 0;
                    var failCount = 0;
                    results.forEach(function (res) {
                        if (res.ok) {
                            okCount++;
                            rememberImportedTheme(res.theme);
                            syncThemeOption(res.theme.name);
                        } else failCount++;
                    });
                    var okNames = results.filter(function (res) { return res.ok; }).map(function (res) { return res.theme.name; });
                    if (okNames.length > 0) mergeImportedThemeMeta(okNames, opts.metaByName, opts.categories, opts.forceCategory);
                    fetchThemeList(function () {
                        renderCatbar(); renderGrid(); renderBottomStatus();
                        var fixedText = compatInfo && compatInfo.fixedCount > 0 ? '，已补齐 ' + compatInfo.fixedCount + ' 个不完整美化' : '';
                        if (failCount > 0) toast('导入完成：成功 ' + okCount + ' 个，失败 ' + failCount + ' 个' + fixedText, true);
                        else if (okCount === 1 && results[0] && results[0].theme) toast('✅ 已导入美化：' + results[0].theme.name + fixedText);
                        else toast('✅ 已导入美化：' + okCount + ' 个' + fixedText);
                    });
                    if (failCount > 0) console.warn('[美化管理] 批量导入失败项:', results.filter(function (r) { return !r.ok; }));
                })
                .catch(function (err) { toast((opts.failText || '导入美化失败') + '：' + err.message, true); });
        });
    }

    function applyTheme(themeName, cb) {
        var requestId = themeRuntime.beginApply();
        if (importedThemeCache[themeName]) {
            applyImportedThemeObject(importedThemeCache[themeName], function (ok) {
                finishApplyTheme(themeName, cb, ok, requestId);
            });
            return;
        }

        prepareCompleteNativeThemeForApply(themeName)
            .then(function (prepared) {
                if (!themeRuntime.isApplyCurrent(requestId)) {
                    if (cb) cb(false, 'superseded');
                    return;
                }
                if (prepared.theme && !prepared.hydrated) {
                    applyCompleteNativeThemeFallback(prepared.theme, function (ok) {
                        finishApplyTheme(themeName, cb, ok, requestId);
                    });
                    return;
                }
                applyPreparedTheme(themeName, cb, requestId, Boolean(prepared.theme && prepared.hydrated));
            })
            .catch(function (err) {
                if (!themeRuntime.isApplyCurrent(requestId)) {
                    if (cb) cb(false, 'superseded');
                    return;
                }
                console.warn('[美化管理] 切换美化失败:', err);
                if (cb) cb(false, err && err.code ? err.code : 'load-failed');
            });
    }

    function applyPreparedTheme(themeName, cb, requestId, bypassLazyGuard) {
        var logs = [];

        var renamedNativeTheme = renamedNativeThemeCache[themeName];
        if (renamedNativeTheme && !hydrateRenamedNativeTheme(renamedNativeTheme)) {
            applyCompleteNativeThemeFallback(renamedNativeTheme, function (ok) {
                finishApplyTheme(themeName, cb, ok, requestId);
            });
            return;
        }

        // 方式1：模拟用户在 #themes 输入框/下拉框中选择，然后触发 change 事件
        // 这是最可靠的方式——直接模拟用户操作
        try {
            var themeEl = document.getElementById('themes');
            if (themeEl) {
                logs.push('找到#themes: ' + themeEl.tagName);

                if (themeEl.tagName === 'SELECT') {
                    // 找到匹配的 option 并选中
                    for (var i = 0; i < themeEl.options.length; i++) {
                        if (themeEl.options[i].value === themeName || themeEl.options[i].textContent === themeName) {
                            themeEl.selectedIndex = i;
                            dispatchPreparedNativeThemeChange(themeEl, themeName, bypassLazyGuard);
                            logs.push('SELECT 已选中 index=' + i + '，已触发 change');
                            finishApplyTheme(themeName, cb, true, requestId);
                            return;
                        }
                    }
                    logs.push('SELECT 未找到匹配项');
                } else if (themeEl.tagName === 'INPUT') {
                    // 设置 value 然后触发 input + change 事件
                    var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    nativeInputValueSetter.call(themeEl, themeName);
                    dispatchPreparedNativeThemeChange(themeEl, themeName, bypassLazyGuard);
                    logs.push('INPUT 已设值并触发 input+change');
                    finishApplyTheme(themeName, cb, true, requestId);
                    return;
                }
            } else {
                logs.push('#themes 元素不存在');
            }
        } catch (e) { logs.push('方式1异常: ' + e.message); }

        // 方式2：通过 SillyTavern context 的 SlashCommandParser
        try {
            var ctx = null;
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ctx = SillyTavern.getContext();
            else if (typeof getContext === 'function') ctx = getContext();

            if (ctx) {
                logs.push('ctx 可用');

                // 2a: executeSlashCommands 或 executeSlashCommandsWithOptions
                if (typeof ctx.executeSlashCommands === 'function') {
                    ctx.executeSlashCommands('/theme ' + themeName);
                    logs.push('executeSlashCommands 已调用');
                    finishApplyTheme(themeName, cb, true, requestId);
                    return;
                }
                if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                    ctx.executeSlashCommandsWithOptions('/theme ' + themeName);
                    logs.push('executeSlashCommandsWithOptions 已调用');
                    finishApplyTheme(themeName, cb, true, requestId);
                    return;
                }

                // 2b: SlashCommandParser
                if (ctx.SlashCommandParser) {
                    var parserMethods = Object.keys(ctx.SlashCommandParser).filter(function(k) { return typeof ctx.SlashCommandParser[k] === 'function'; });
                    logs.push('SlashCommandParser methods: ' + parserMethods.join(','));
                    try {
                        ctx.SlashCommandParser.execute('/theme ' + themeName);
                        logs.push('SlashCommandParser.execute 已调用');
                        finishApplyTheme(themeName, cb, true, requestId);
                        return;
                    } catch (e2) { logs.push('SlashCommandParser.execute 失败: ' + e2.message); }
                }

                // 2c: 看 ctx 上有没有直接的主题切换方法
                var ctxFns = Object.keys(ctx).filter(function (k) {
                    return typeof ctx[k] === 'function' && k.toLowerCase().indexOf('theme') !== -1;
                });
                logs.push('ctx 中 theme 相关函数: ' + (ctxFns.join(',') || '无'));
            } else {
                logs.push('ctx 不可用');
            }
        } catch (e) { logs.push('方式2异常: ' + e.message); }

        // 方式3：找页面上保存主题的按钮，模拟选中+点击
        try {
            // 有些 ST 版本用 .themeSaveButton 或类似的
            var saveBtn = document.querySelector('#themes + .menu_button, #themes ~ .menu_button, [id*="theme"][id*="save"]');
            if (saveBtn) {
                logs.push('找到 save 按钮: ' + (saveBtn.id || saveBtn.className).slice(0, 30));
            }
        } catch (e) {}

        // 所有方式都失败了——用 toast 显示调试信息
        toast('切换失败', true);
        setTimeout(function () {
            toast(logs.join(' → ').slice(0, 100), true);
        }, 600);
        console.log('[美化管理] applyTheme 调试:', logs);
        if (cb) cb(false);
    }

    // ── 图片工具（由 src/image-tools.js 提供实现）──────────────
    function compressImage(dataUrl, cb) {
        imageToolsApi.compressImage(dataUrl, cb, { maxWidth: MAX_IMG_WIDTH, quality: IMG_QUALITY });
    }

    function getDefaultCrop(imgW, imgH) {
        return imageToolsApi.getDefaultCrop(imgW, imgH);
    }

    function makeThumbFromCrop(dataUrl, crop, cb) {
        imageToolsApi.makeThumbFromCrop(dataUrl, crop, cb, { quality: IMG_QUALITY });
    }

    function openImageCropSheet(dataUrl, initialCrop, onDone) {
        var img = new Image();
        img.onload = function () {
            var naturalW = img.width;
            var naturalH = img.height;
            var baseCrop = getDefaultCrop(naturalW, naturalH);
            var state = Object.assign({}, baseCrop, initialCrop || {});
            if (!state.zoom) state.zoom = 1;
            if (state.zoom < 0.35) state.zoom = 0.35;
            if (state.zoom > 3) state.zoom = 3;
            if (state.posX === undefined) state.posX = 50;
            if (state.posY === undefined) state.posY = 50;

            var sheet = createSheet([
                '<div class="tm-sheet-title"><i class="fa-solid fa-crop-simple"></i>选择网格预览区域</div>',
                '<div class="tm-crop-stage"><canvas id="tm-crop-canvas" width="800" height="600"></canvas></div>',
                '<div class="tm-crop-controls">',
                '<label>缩放 <input type="range" id="tm-crop-zoom" min="0.35" max="3" step="0.01" value="' + esc(state.zoom) + '" /></label>',
                '<label>横向 <input type="range" id="tm-crop-x" min="0" max="100" step="1" value="' + esc(state.posX) + '" /></label>',
                '<label>纵向 <input type="range" id="tm-crop-y" min="0" max="100" step="1" value="' + esc(state.posY) + '" /></label>',
                '</div>',
                '<div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" id="tm-crop-cancel">取消</button><button class="tm-btn tm-btn-outline" id="tm-crop-reset">居中</button><button class="tm-btn tm-btn-safe" id="tm-crop-ok">使用此区域</button></div>',
            ].join(''));

            var canvas = sheet.querySelector('#tm-crop-canvas');
            var ctx = canvas.getContext('2d');
            var zoomInp = sheet.querySelector('#tm-crop-zoom');
            var xInp = sheet.querySelector('#tm-crop-x');
            var yInp = sheet.querySelector('#tm-crop-y');

            function calcCrop() {
                var zoom = Math.max(0.35, Math.min(3, parseFloat(zoomInp.value) || 1));
                var base = getDefaultCrop(naturalW, naturalH);
                var cropW = Math.max(1, Math.round(base.width / zoom));
                var cropH = Math.max(1, Math.round(base.height / zoom));
                var posX = Math.max(0, Math.min(100, parseFloat(xInp.value) || 0));
                var posY = Math.max(0, Math.min(100, parseFloat(yInp.value) || 0));
                var maxX = naturalW - cropW;
                var maxY = naturalH - cropH;
                var x = maxX >= 0 ? Math.round(maxX * posX / 100) : -Math.round((-maxX) * posX / 100);
                var y = maxY >= 0 ? Math.round(maxY * posY / 100) : -Math.round((-maxY) * posY / 100);
                return {
                    x: x,
                    y: y,
                    width: cropW,
                    height: cropH,
                    naturalWidth: naturalW,
                    naturalHeight: naturalH,
                    zoom: zoom,
                    posX: posX,
                    posY: posY,
                };
            }

            function drawCropToCanvas(c) {
                var sx = Math.max(0, c.x);
                var sy = Math.max(0, c.y);
                var ex = Math.min(naturalW, c.x + c.width);
                var ey = Math.min(naturalH, c.y + c.height);
                var sw = Math.max(1, ex - sx);
                var sh = Math.max(1, ey - sy);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            }

            function renderCrop() {
                var c = calcCrop();
                drawCropToCanvas(c);
            }

            zoomInp.addEventListener('input', renderCrop);
            xInp.addEventListener('input', renderCrop);
            yInp.addEventListener('input', renderCrop);
            sheet.querySelector('#tm-crop-reset').addEventListener('click', function () {
                zoomInp.value = 1;
                xInp.value = 50;
                yInp.value = 50;
                renderCrop();
            });
            sheet.querySelector('#tm-crop-cancel').addEventListener('click', function () { closeSheet(sheet); });
            sheet.querySelector('#tm-crop-ok').addEventListener('click', function () {
                var crop = calcCrop();
                var thumb = canvas.toDataURL('image/jpeg', IMG_QUALITY);
                closeSheet(sheet);
                if (onDone) onDone({ imageData: dataUrl, thumbData: thumb, crop: crop });
            });
            renderCrop();
        };
        img.onerror = function () {
            makeThumbFromCrop(dataUrl, null, function (thumb) {
                if (onDone) onDone({ imageData: dataUrl, thumbData: thumb, crop: null });
            });
        };
        img.src = dataUrl;
    }

    // ── Toast ─────────────────────────────────────────────────
    function toast(msg, isErr) {
        var el = document.createElement('div');
        el.textContent = msg;
        el.style.cssText = 'position:absolute !important;bottom:96px !important;left:50% !important;' +
            'transform:translateX(-50%) translateY(8px) !important;' +
            'background:' + (isErr ? '#e57373' : 'var(--SmartThemeQuoteColor,#7c6daf)') + ' !important;' +
            'color:#fff !important;padding:8px 20px !important;border-radius:20px !important;' +
            'font-size:13px !important;font-weight:600 !important;z-index:2147483649 !important;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.4) !important;white-space:nowrap !important;' +
            'pointer-events:none !important;opacity:0 !important;transition:all .22s !important;';
        getPopupLayer().appendChild(el);
        setTimeout(function () {
            el.style.setProperty('opacity', '1', 'important');
            el.style.setProperty('transform', 'translateX(-50%) translateY(0)', 'important');
        }, 10);
        setTimeout(function () { el.style.setProperty('opacity', '0', 'important'); }, 2400);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2700);
    }

    // ── CSS（由 src/styles.js 提供实现）───────────────────────
    function injectStyles() {
        styleApi();
    }

    // ── UI 状态 ───────────────────────────────────────────────
    var curCat = '__all__';
    var batchMode = false;
    var batchSelected = [];
    var searchQuery = '';
    var searchOpen = false;
    var sortOpen = false;
    var gridSizeSaveTimer = null;

    function sortThemes(list, mode, d) {
        var sorted = list.slice();
        switch (mode) {
            case 'name': sorted.sort(function (a, b) { return a.localeCompare(b, 'zh'); }); break;
            case 'recent': sorted.sort(function (a, b) { return ((d.themeMeta[b] || {}).lastUsed || 0) - ((d.themeMeta[a] || {}).lastUsed || 0); }); break;
            case 'freq': sorted.sort(function (a, b) { return ((d.themeMeta[b] || {}).useCount || 0) - ((d.themeMeta[a] || {}).useCount || 0); }); break;
            case 'starred': sorted.sort(function (a, b) {
                var sa = (d.themeMeta[a] || {}).starred ? 1 : 0, sb = (d.themeMeta[b] || {}).starred ? 1 : 0;
                return sb - sa || a.localeCompare(b, 'zh');
            }); break;
        }
        return sorted;
    }

    function normalizeGridCardSize(value) {
        var n = parseInt(value, 10);
        if (!n) n = 108;
        return Math.max(84, Math.min(220, n));
    }

    function applyGridCardSize(size) {
        var area = document.getElementById('tm-grid-area');
        if (area) area.style.setProperty('--tm-grid-card-min', normalizeGridCardSize(size) + 'px');
    }

    function adjustGridCardSize(delta) {
        var d = load();
        var current = normalizeGridCardSize(d.gridCardSize || 108);
        var next = normalizeGridCardSize(current + delta);
        if (next === current) {
            applyGridCardSize(next);
            return;
        }
        d.gridCardSize = next;
        applyGridCardSize(next);
        if (gridSizeSaveTimer) clearTimeout(gridSizeSaveTimer);
        gridSizeSaveTimer = setTimeout(function () {
            gridSizeSaveTimer = null;
            save(load());
        }, 120);
    }

    // ── 打开全屏主界面 ────────────────────────────────────────
    function openPopup() {
        if (document.querySelector('.tm-overlay')) return;
        injectStyles();
        batchMode = false; batchSelected = []; searchQuery = ''; searchOpen = false; sortOpen = false;

        var ov = document.createElement('div');
        ov.className = 'tm-overlay ' + (darkMode ? 'tm-dark' : 'tm-light');
        ov.setAttribute('style', 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;z-index:2147483647 !important;');

        ov.innerHTML =
            '<div class="tm-box">' +
            '<div class="tm-head">' +
            '<div class="tm-head-title"><i class="fa-solid fa-palette"></i>' + SCRIPT_NAME + '<span class="tm-version">v' + esc(TM_VERSION) + '</span></div>' +
            '<div class="tm-head-actions">' +
            '<button class="tm-icon-btn" id="tm-search-toggle" title="搜索"><i class="fa-solid fa-magnifying-glass"></i></button>' +
            '<button class="tm-icon-btn" id="tm-sort-toggle" title="排序"><i class="fa-solid fa-arrow-down-wide-short"></i></button>' +
            '<button class="tm-icon-btn" id="tm-theme-toggle" title="切换明暗"><i class="fa-solid fa-circle-half-stroke"></i></button>' +
            '<button class="tm-icon-btn" id="tm-x" title="关闭"><i class="fa-solid fa-xmark"></i></button>' +
            '</div></div>' +
            '<div class="tm-search-bar" id="tm-search-bar"><div class="tm-search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input class="tm-search-inp" id="tm-search-inp" placeholder="搜索主题名称、标签、作者…" autocomplete="off" /></div><button class="tm-search-clear" id="tm-search-clear"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="tm-sortbar" id="tm-sortbar">' +
            '<span style="font-size:.72em;opacity:.4;flex-shrink:0">排序：</span>' +
            '<button class="tm-sort-chip on" data-sort="name">名称</button>' +
            '<button class="tm-sort-chip" data-sort="recent">最近使用</button>' +
            '<button class="tm-sort-chip" data-sort="freq">使用频率</button>' +
            '<button class="tm-sort-chip" data-sort="starred">收藏优先</button>' +
            '<span class="tm-sort-divider"></span>' +
            '<span class="tm-grid-size-label">网格</span>' +
            '<button class="tm-grid-size-btn" id="tm-grid-zoom-out" title="缩小卡片"><i class="fa-solid fa-minus"></i></button>' +
            '<button class="tm-grid-size-btn" id="tm-grid-zoom-in" title="放大卡片"><i class="fa-solid fa-plus"></i></button>' +
            '</div>' +
            '<div class="tm-catbar" id="tm-catbar" style="display:none"></div>' +
            '<div class="tm-batch-area" id="tm-batch-area"></div>' +
            '<div class="tm-grid-area" id="tm-grid-area"><div class="tm-loading"><i class="fa-solid fa-spinner"></i><span>正在读取主题列表…</span></div></div>' +
            '<div class="tm-bottombar">' +
            '<div class="tm-bottom-status" id="tm-bottom-status"></div>' +
            '<button class="tm-bottom-btn" id="tm-refresh" title="刷新"><i class="fa-solid fa-rotate"></i></button>' +
            '<button class="tm-bottom-btn" id="tm-batch-toggle" title="多选"><i class="fa-solid fa-list-check"></i></button>' +
            '<button class="tm-bottom-btn" id="tm-bottom-settings" title="设置"><i class="fa-solid fa-sliders"></i></button>' +
            '</div>' +
            '<div id="tm-popup-slot" style="position:absolute;inset:0;pointer-events:none;z-index:1;"></div>' +
            '</div>';

        document.body.appendChild(ov);

        // 防止悬浮球点击穿透：添加一个透明遮罩吸收残余触摸事件，400ms后移除
        var shield = document.createElement('div');
        shield.setAttribute('style', 'position:absolute;inset:0;z-index:999999;background:transparent;');
        shield.addEventListener('touchstart', function (e) { e.stopPropagation(); e.preventDefault(); }, { passive: false });
        shield.addEventListener('touchend', function (e) { e.stopPropagation(); e.preventDefault(); }, { passive: false });
        shield.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); }, { passive: false });
        ov.appendChild(shield);
        setTimeout(function () { if (shield.parentNode) shield.parentNode.removeChild(shield); }, 400);

        // 绑定事件
        ov.querySelector('#tm-x').addEventListener('click', closePopup);
        ov.querySelector('#tm-theme-toggle').addEventListener('click', function () {
            darkMode = !darkMode;
            ov.classList.toggle('tm-dark', darkMode);
            ov.classList.toggle('tm-light', !darkMode);
            this.innerHTML = darkMode ? '<i class="fa-solid fa-circle-half-stroke"></i>' : '<i class="fa-regular fa-sun"></i>';
        });
        ov.querySelector('#tm-refresh').addEventListener('click', function () {
            ov.querySelector('#tm-grid-area').innerHTML = '<div class="tm-loading"><i class="fa-solid fa-spinner"></i><span>正在刷新…</span></div>';
            fetchThemeList(function () { renderGrid(); renderBottomStatus(); });
        });

        // 搜索
        ov.querySelector('#tm-search-toggle').addEventListener('click', function () {
            searchOpen = !searchOpen;
            ov.querySelector('#tm-search-bar').classList.toggle('open', searchOpen);
            if (searchOpen) ov.querySelector('#tm-search-inp').focus();
            else { searchQuery = ''; ov.querySelector('#tm-search-inp').value = ''; renderGrid(); }
        });
        var sinp = ov.querySelector('#tm-search-inp');
        sinp.addEventListener('input', function () { searchQuery = sinp.value.trim(); renderGrid(); });
        ov.querySelector('#tm-search-clear').addEventListener('click', function () { searchQuery = ''; sinp.value = ''; renderGrid(); sinp.focus(); });
        sinp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { searchOpen = false; searchQuery = ''; ov.querySelector('#tm-search-bar').classList.remove('open'); renderGrid(); } });

        // 排序
        ov.querySelector('#tm-sort-toggle').addEventListener('click', function () {
            sortOpen = !sortOpen;
            ov.querySelector('#tm-sortbar').classList.toggle('open', sortOpen);
        });
        ov.querySelectorAll('.tm-sort-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                var d = load(); d.sortMode = chip.dataset.sort; save(d);
                ov.querySelectorAll('.tm-sort-chip').forEach(function (c) { c.classList.remove('on'); });
                chip.classList.add('on');
                renderGrid();
            });
        });
        ov.querySelector('#tm-grid-zoom-out').addEventListener('click', function () {
            adjustGridCardSize(-12);
        });
        ov.querySelector('#tm-grid-zoom-in').addEventListener('click', function () {
            adjustGridCardSize(12);
        });

        // 底栏
        ov.querySelector('#tm-batch-toggle').addEventListener('click', function () {
            batchMode = !batchMode; batchSelected = [];
            ov.querySelector('#tm-batch-toggle').classList.toggle('on', batchMode);
            renderGrid();
        });
        ov.querySelector('#tm-bottom-settings').addEventListener('click', function () { openSettingsSheet(); });
        ov.querySelector('#tm-bottom-status').addEventListener('click', function () {
            var curTheme = getCurrentThemeName();
            if (!curTheme) return;
            openEditSheet(curTheme);
        });

        // 初始排序高亮
        var d = load();
        ov.querySelectorAll('.tm-sort-chip').forEach(function (c) { c.classList.toggle('on', c.dataset.sort === d.sortMode); });

        // 加载真实主题列表
        fetchThemeList(function () {
            renderCatbar();
            renderGrid();
            renderBottomStatus();
        });

        closeFab();
    }

    function closePopup() {
        var ov = document.querySelector('.tm-overlay'); if (ov) ov.parentNode.removeChild(ov);
    }

    // ── 分类栏 ───────────────────────────────────────────────
    function renderCatbar() {
        var catbar = document.getElementById('tm-catbar'); if (!catbar) return;
        var d = load();
        if (d.categories.length === 0) { catbar.style.display = 'none'; return; }
        catbar.style.display = '';
        var html = '<button class="tm-catbtn' + (curCat === '__all__' ? ' on' : '') + '" data-c="__all__">全部</button>';
        html += '<button class="tm-catbtn' + (curCat === '__uncategorized__' ? ' on' : '') + '" data-c="__uncategorized__">未分类</button>';
        d.categories.forEach(function (c) {
            html += '<button class="tm-catbtn' + (curCat === c ? ' on' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>';
        });
        catbar.innerHTML = html;
        catbar.querySelectorAll('.tm-catbtn').forEach(function (btn) {
            btn.addEventListener('click', function () { curCat = btn.dataset.c; renderCatbar(); renderGrid(); });
        });
    }

    // ── 网格 ─────────────────────────────────────────────────
    function renderGrid() {
        var area = document.getElementById('tm-grid-area'); if (!area) return;
        var batchArea = document.getElementById('tm-batch-area');
        var d = load();
        var curTheme = getCurrentThemeName();
        applyGridCardSize(d.gridCardSize);

        // 过滤
        var list = stThemeList.slice();
        if (curCat === '__uncategorized__') {
            list = list.filter(function (name) { var m = d.themeMeta[name]; return !m || !m.category; });
        } else if (curCat !== '__all__') {
            list = list.filter(function (name) { var m = d.themeMeta[name]; return m && m.category === curCat; });
        }
        if (searchQuery) {
            var q = searchQuery.toLowerCase();
            list = list.filter(function (name) {
                if (name.toLowerCase().indexOf(q) !== -1) return true;
                var m = d.themeMeta[name];
                if (!m) return false;
                if (m.author && m.author.toLowerCase().indexOf(q) !== -1) return true;
                if (m.tags && m.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1; })) return true;
                if (m.description && m.description.toLowerCase().indexOf(q) !== -1) return true;
                return false;
            });
        }

        list = sortThemes(list, d.sortMode || 'name', d);

        if (batchArea) {
            if (batchMode) {
                batchArea.style.display = '';
                batchArea.innerHTML = '<div class="tm-batch-bar"><span class="tm-batch-info">已选 <b id="tm-batch-count">' + batchSelected.length + '</b> 个</span>' +
                '<div class="tm-batch-divider"></div>' +
                '<div class="tm-batch-acts">' +
                '<button class="tm-batch-btn" id="tm-batch-selall">全选</button>' +
                '<button class="tm-batch-btn" id="tm-batch-none">取消</button>' +
                '<button class="tm-batch-btn" id="tm-batch-cat"><i class="fa-solid fa-folder"></i> 分类</button>' +
                '<button class="tm-batch-btn" id="tm-batch-star"><i class="fa-solid fa-star"></i> 收藏</button>' +
                '<button class="tm-batch-btn" id="tm-batch-tag"><i class="fa-solid fa-tag"></i> 标签</button>' +
                '</div></div>';
            } else {
                batchArea.style.display = 'none';
                batchArea.innerHTML = '';
            }
        }

        var html = '';
        html += '<div class="tm-grid">';

        if (list.length === 0) {
            html += '</div><div class="tm-empty"><i class="fa-solid fa-palette"></i><span>' +
                (searchQuery ? '没有匹配「' + esc(searchQuery) + '」的主题' : (curCat !== '__all__' ? '该分类暂无主题' : '没有找到主题，请点击底栏刷新按钮')) +
                '</span></div>';
        } else {
            list.forEach(function (name) {
                var meta = d.themeMeta[name] || {};
                var isActive = curTheme === name;
                var bsel = batchSelected.indexOf(name) !== -1;
                var checkBox = batchMode ? '<div class="tm-card-check' + (bsel ? ' checked' : '') + '" data-name="' + esc(name) + '"><i class="fa-solid fa-check"></i></div>' : '';
                var badge = (isActive && !batchMode) ? '<div class="tm-badge-on"><i class="fa-solid fa-check"></i></div>' : '';
                var starBadge = (meta.starred && !batchMode) ? '<div class="tm-badge-star"><i class="fa-solid fa-star"></i></div>' : '';
                var freqBadge = (d.showFreq !== false && (meta.useCount || 0) > 5 && !batchMode) ? '<div class="tm-badge-freq">' + meta.useCount + '次</div>' : '';

                var previewImage = meta.thumbData || meta.imageData;
                var imgContent = previewImage
                    ? '<img src="' + previewImage + '" alt="' + esc(name) + '" loading="lazy" decoding="async" />'
                    : '<div class="tm-card-noimg"><i class="fa-solid fa-palette"></i><span>' + esc(name.slice(0, 6)) + '</span></div>';

                var menuBtn = batchMode ? '' : '<button class="tm-card-menu" data-name="' + esc(name) + '" title="操作"><i class="fa-solid fa-ellipsis"></i></button>';
                var tagText = (meta.tags && meta.tags.length > 0) ? meta.tags.join(' · ') : (meta.author || '');

                html += '<div class="tm-card' + (isActive ? ' on' : '') + (bsel ? ' batch-sel' : '') + (previewImage ? '' : ' no-img') + '" data-name="' + esc(name) + '">' +
                    '<div class="tm-card-img">' + checkBox + imgContent + badge + starBadge + freqBadge + menuBtn + '</div>' +
                    '<div class="tm-card-info"><div class="tm-card-name">' + esc(name) + '</div>' +
                    (tagText ? '<div class="tm-card-tag">' + esc(tagText) + '</div>' : '') +
                    '</div></div>';
            });
            html += '</div>';
        }

        area.innerHTML = html;

        // 事件绑定
        if (batchMode) {
            var batchRoot = batchArea || area;
            var selall = batchRoot.querySelector('#tm-batch-selall');
            var selnone = batchRoot.querySelector('#tm-batch-none');
            if (selall) selall.addEventListener('click', function () { batchSelected = list.slice(); renderGrid(); });
            if (selnone) selnone.addEventListener('click', function () { batchSelected = []; renderGrid(); });

            var bcatBtn = batchRoot.querySelector('#tm-batch-cat');
            if (bcatBtn) bcatBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择主题', true); return; }
                var dd = load(); var cats = dd.categories || [];
                if (cats.length === 0) { toast('还没有分类，请先在设置中添加', true); return; }
                var msg = '选择分类（输入序号）：\n' + cats.map(function (n, i) { return (i + 1) + '. ' + n; }).join('\n');
                var choice = prompt(msg); if (choice === null) return;
                var ci = parseInt(choice) - 1;
                if (ci < 0 || ci >= cats.length) { toast('无效选择', true); return; }
                batchSelected.forEach(function (name) { getMeta(dd, name).category = cats[ci]; });
                save(dd); toast('✅ 已将 ' + batchSelected.length + ' 个移到「' + cats[ci] + '」'); batchSelected = []; renderGrid();
            });

            var bstarBtn = batchRoot.querySelector('#tm-batch-star');
            if (bstarBtn) bstarBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择主题', true); return; }
                var dd = load();
                batchSelected.forEach(function (name) { var m = getMeta(dd, name); m.starred = !m.starred; });
                save(dd); toast('⭐ 已切换收藏'); batchSelected = []; renderGrid();
            });

            var btagBtn = batchRoot.querySelector('#tm-batch-tag');
            if (btagBtn) btagBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择主题', true); return; }
                var tag = prompt('为所选主题添加标签：'); if (!tag || !tag.trim()) return; tag = tag.trim();
                var dd = load();
                batchSelected.forEach(function (name) { var m = getMeta(dd, name); if (m.tags.indexOf(tag) === -1) m.tags.push(tag); });
                save(dd); toast('🏷️ 已添加标签：' + tag); batchSelected = []; renderGrid();
            });

            area.querySelectorAll('.tm-card').forEach(function (card) {
                card.addEventListener('click', function () {
                    var name = card.dataset.name;
                    var idx = batchSelected.indexOf(name);
                    if (idx !== -1) batchSelected.splice(idx, 1); else batchSelected.push(name);
                    var chk = card.querySelector('.tm-card-check');
                    if (chk) chk.classList.toggle('checked', batchSelected.indexOf(name) !== -1);
                    card.classList.toggle('batch-sel', batchSelected.indexOf(name) !== -1);
                    var cnt = document.getElementById('tm-batch-count');
                    if (cnt) cnt.textContent = batchSelected.length;
                });
            });
        } else {
            area.querySelectorAll('.tm-card').forEach(function (card) {
                card.addEventListener('click', function (e) {
                    if (e.target.closest('.tm-card-menu')) return;
                    var name = card.dataset.name;
                    var dd = load();
                    var m = getMeta(dd, name);
                    m.useCount = (m.useCount || 0) + 1;
                    m.lastUsed = Date.now();
                    save(dd);
                    applyTheme(name, function (ok, reason) {
                        if (ok) {
                            toast('✅ 已应用：' + name);
                            renderGrid(); renderBottomStatus(); updateBtn();
                        } else if (reason !== 'superseded') {
                            if (reason === 'incomplete') toast('主题尚未完整加载，不能安全切换', true);
                            else if (reason === 'load-failed') toast('主题加载失败，已保留当前主题', true);
                            else toast('切换失败，请重试', true);
                        }
                    });
                });
            });

            area.querySelectorAll('.tm-card-menu').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openContextMenu(btn.dataset.name);
                });
            });
        }
    }

    // ── 底栏状态 ─────────────────────────────────────────────
    function renderBottomStatus() {
        var el = document.getElementById('tm-bottom-status'); if (!el) return;
        var curTheme = getCurrentThemeName();
        var dotClass = curTheme ? 'green' : 'gray';
        var text = curTheme || '未选择主题';
        el.innerHTML = '<div class="tm-status-dot ' + dotClass + '"></div><span class="tm-status-text">' + esc(text) + '</span>';
    }

    // ── 操作菜单 ─────────────────────────────────────────────
    function openContextMenu(themeName) {
        var d = load();
        var meta = d.themeMeta[themeName] || {};
        var curTheme = getCurrentThemeName();
        var isActive = curTheme === themeName;
        var imgThemes = stThemeList.filter(function (n) { var m = d.themeMeta[n]; return m && (m.imageData || m.thumbData); });

        var sheet = createSheet([
            '<div class="tm-ctx-theme-name"><i class="fa-solid fa-palette" style="margin-right:6px;opacity:.5;"></i>' + esc(themeName) + '</div>',
            isActive
                ? '<div class="tm-ctx-item" style="opacity:.5"><i class="fa-solid fa-circle-check"></i>当前正在使用</div>'
                : '<div class="tm-ctx-item" id="tm-ctx-apply"><i class="fa-solid fa-circle-check"></i>应用主题</div>',
            (meta.imageData || meta.thumbData) ? '<div class="tm-ctx-item" id="tm-ctx-view"><i class="fa-solid fa-expand"></i>查看截图</div>' : '',
            meta.backgroundName ? '<div class="tm-ctx-item" style="opacity:.75"><i class="fa-solid fa-image"></i>背景：' + esc(meta.backgroundName) + '</div>' : '',
            '<div class="tm-ctx-item" id="tm-ctx-star"><i class="fa-solid fa-star"></i>' + (meta.starred ? '取消收藏' : '加入收藏') + '</div>',
            '<div class="tm-ctx-item" id="tm-ctx-edit"><i class="fa-solid fa-pen"></i>编辑信息</div>',
            '<div class="tm-ctx-item" id="tm-ctx-rename"><i class="fa-solid fa-i-cursor"></i>重命名美化</div>',
            '<div class="tm-ctx-item danger" id="tm-ctx-delete"><i class="fa-solid fa-trash"></i>删除美化</div>',
        ].join(''));

        var applyEl = sheet.querySelector('#tm-ctx-apply');
        if (applyEl) applyEl.addEventListener('click', function () {
            closeSheet(sheet);
            var dd = load(); var m = getMeta(dd, themeName); m.useCount = (m.useCount || 0) + 1; m.lastUsed = Date.now(); save(dd);
            applyTheme(themeName, function (ok, reason) {
                if (ok) { toast('✅ 已应用：' + themeName); renderGrid(); renderBottomStatus(); updateBtn(); }
                else if (reason !== 'superseded') {
                    if (reason === 'incomplete') toast('主题尚未完整加载，不能安全切换', true);
                    else if (reason === 'load-failed') toast('主题加载失败，已保留当前主题', true);
                    else toast('切换失败', true);
                }
            });
        });

        var viewEl = sheet.querySelector('#tm-ctx-view');
        if (viewEl) viewEl.addEventListener('click', function () {
            closeSheet(sheet);
            openLightbox(imgThemes, themeName);
        });

        sheet.querySelector('#tm-ctx-star').addEventListener('click', function () {
            closeSheet(sheet);
            var dd = load(); var m = getMeta(dd, themeName); m.starred = !m.starred;
            save(dd); toast(m.starred ? '⭐ 已收藏' : '已取消收藏'); renderGrid();
        });

        sheet.querySelector('#tm-ctx-edit').addEventListener('click', function () {
            closeSheet(sheet);
            openEditSheet(themeName);
        });

        sheet.querySelector('#tm-ctx-rename').addEventListener('click', function () {
            var newName = prompt('新的美化名称：', themeName);
            if (newName === null) return;
            newName = newName.trim();
            if (!newName || newName === themeName) return;
            closeSheet(sheet);
            renameThemeEverywhere(themeName, newName, function (ok, reason) {
                if (ok) toast('已重命名美化');
                else if (reason === 'duplicate') toast('已有同名美化', true);
                else if (reason === 'filename-conflict') toast('名称经酒馆文件名清理后与已有主题冲突', true);
                else if (reason === 'invalid-filename') toast('该名称无法生成有效的主题文件名', true);
                else if (reason === 'incomplete') toast('主题尚未完整加载，不能安全改名', true);
                else if (reason === 'verify-failed') toast('新主题保存验证失败，旧主题已保留', true);
                else if (reason === 'delete-failed') toast('新主题已保存，但旧主题删除失败；已保留两者', true);
                else if (reason === 'inventory-failed') toast('无法刷新主题列表，未执行改名', true);
                else toast('重命名失败，旧主题已保留', true);
            });
        });

        sheet.querySelector('#tm-ctx-delete').addEventListener('click', function () {
            if (!confirm('删除美化「' + themeName + '」？\n这会从 SillyTavern 主题列表中真实删除，不只是从插件移除。')) return;
            closeSheet(sheet);
            deleteThemeEverywhere(themeName, function (ok) {
                if (ok) toast('已删除美化');
                else toast('删除失败', true);
            });
        });
    }

    // ── 编辑主题附加信息 ─────────────────────────────────────
    function openEditSheet(themeName) {
        var d = load();
        var meta = getMeta(d, themeName);
        var editImgData = meta.imageData || null;
        var editThumbData = meta.thumbData || null;
        var editCrop = meta.crop || null;
        var editPreviewData = editThumbData || editImgData;
        var editTags = (meta.tags || []).slice();
        var editBackgroundName = meta.backgroundName || '';
        var catOpts = '<option value="">无分类</option>' +
            d.categories.map(function (c) { return '<option value="' + esc(c) + '"' + (meta.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');

        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-pen"></i>编辑：' + esc(themeName) + '</div>',
            '<div class="tm-field"><label>分类</label><div class="tm-frow"><select id="tm-dcat">' + catOpts + '</select><button class="tm-btn tm-btn-outline" id="tm-dnewcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
            '<div class="tm-field"><label>绑定背景</label><button type="button" class="tm-bg-bind-card" id="tm-bg-bind">' + buildBackgroundBindHtml(editBackgroundName) + '</button></div>',
            '<div class="tm-field"><label>作者</label><input type="text" id="tm-dauthor" placeholder="主题作者名" value="' + esc(meta.author || '') + '" /></div>',
            '<div class="tm-field"><label>备注</label><textarea id="tm-ddesc" rows="2" placeholder="主题特点、适用场景等">' + esc(meta.description || '') + '</textarea></div>',
            '<div class="tm-field"><label>标签</label><div class="tm-tags-wrap" id="tm-tags-wrap"></div>' +
            '<div class="tm-tag-add-row"><input type="text" id="tm-tag-inp" placeholder="输入标签后回车" /><button class="tm-btn tm-btn-outline" id="tm-tag-add" style="font-size:.8em;padding:6px 10px">添加</button></div></div>',
            '<div class="tm-field"><label>预览截图</label>' +
            '<div class="tm-imgarea" id="tm-dimgarea">' + (editPreviewData ? '<img src="' + editPreviewData + '" />' : '<div class="tm-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传截图</span></div>') + '</div>' +
            '<input type="file" id="tm-dfile" accept="image/*" style="display:none" />' +
            '<div class="tm-img-actions"><button class="tm-btn tm-btn-outline" id="tm-dpick" style="font-size:.8em"><i class="fa-solid fa-image"></i> 选择图片</button>' +
            (editPreviewData ? '<button class="tm-btn tm-btn-danger" id="tm-dclr" style="font-size:.8em">删除图片</button>' : '') + '</div></div>',
            '<div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" id="tm-dcancel">取消</button><button class="tm-btn tm-btn-safe" id="tm-dsave">保存</button></div>',
        ].join(''));

        function renderBackgroundBind() {
            sheet.querySelector('#tm-bg-bind').innerHTML = buildBackgroundBindHtml(editBackgroundName);
        }
        sheet.querySelector('#tm-bg-bind').addEventListener('click', function () {
            openBackgroundPickerSheet(editBackgroundName, function (name) {
                editBackgroundName = name || '';
                renderBackgroundBind();
            });
        });

        // 标签
        function renderTagChips() {
            var wrap = sheet.querySelector('#tm-tags-wrap');
            wrap.innerHTML = editTags.map(function (tag) {
                return '<span class="tm-tag-chip">' + esc(tag) + '<button class="tm-tag-chip-x" data-tag="' + esc(tag) + '">×</button></span>';
            }).join('');
            wrap.querySelectorAll('.tm-tag-chip-x').forEach(function (btn) {
                btn.addEventListener('click', function () { var idx = editTags.indexOf(btn.dataset.tag); if (idx !== -1) { editTags.splice(idx, 1); renderTagChips(); } });
            });
        }
        renderTagChips();
        function addTag() { var inp = sheet.querySelector('#tm-tag-inp'); var tag = inp.value.trim(); if (!tag) return; if (editTags.indexOf(tag) === -1) { editTags.push(tag); renderTagChips(); } inp.value = ''; inp.focus(); }
        sheet.querySelector('#tm-tag-add').addEventListener('click', addTag);
        sheet.querySelector('#tm-tag-inp').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });

        // 图片
        var fileInp = sheet.querySelector('#tm-dfile');
        var imgArea = sheet.querySelector('#tm-dimgarea');
        function setImg(data, thumb, crop) {
            editImgData = data;
            editThumbData = thumb || data;
            editCrop = crop || null;
            var preview = editThumbData || editImgData;
            imgArea.innerHTML = preview ? '<img src="' + preview + '" />' : '<div class="tm-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传截图</span></div>';
            var clrOld = sheet.querySelector('#tm-dclr'); var acts = sheet.querySelector('.tm-img-actions');
            if (preview && !clrOld && acts) {
                var b2 = document.createElement('button'); b2.className = 'tm-btn tm-btn-danger'; b2.id = 'tm-dclr'; b2.style.fontSize = '.8em'; b2.textContent = '删除图片';
                b2.addEventListener('click', function () { setImg(null, null, null); }); acts.appendChild(b2);
            } else if (!preview && clrOld) clrOld.parentNode.removeChild(clrOld);
        }
        function handleFile(f) {
            if (!f || f.type.indexOf('image') !== 0) return;
            var r = new FileReader();
            r.onload = function (e) {
                compressImage(e.target.result, function (c) {
                    openImageCropSheet(c, editCrop, function (res) {
                        setImg(res.imageData, res.thumbData, res.crop);
                    });
                });
            };
            r.readAsDataURL(f);
        }
        sheet.querySelector('#tm-dpick').addEventListener('click', function () { fileInp.click(); });
        imgArea.addEventListener('click', function () { fileInp.click(); });
        fileInp.addEventListener('change', function () { if (fileInp.files[0]) handleFile(fileInp.files[0]); });
        imgArea.addEventListener('dragover', function (e) { e.preventDefault(); imgArea.classList.add('drag'); });
        imgArea.addEventListener('dragleave', function () { imgArea.classList.remove('drag'); });
        imgArea.addEventListener('drop', function (e) { e.preventDefault(); imgArea.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
        var clr = sheet.querySelector('#tm-dclr'); if (clr) clr.addEventListener('click', function () { setImg(null, null, null); });

        sheet.querySelector('#tm-dnewcat').addEventListener('click', function () {
            var name = prompt('新分类名称：'); if (!name || !name.trim()) return; name = name.trim();
            var dd = load(); if (dd.categories.indexOf(name) === -1) { dd.categories.push(name); save(dd); renderCatbar(); }
            var sel2 = sheet.querySelector('#tm-dcat');
            var ex = false; for (var i = 0; i < sel2.options.length; i++) { if (sel2.options[i].value === name) { ex = true; break; } }
            if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel2.appendChild(opt); }
            sel2.value = name; toast('分类「' + name + '」已添加');
        });

        sheet.querySelector('#tm-dcancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#tm-dsave').addEventListener('click', function () {
            var saveBtn = sheet.querySelector('#tm-dsave');
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中...';
            function finishSave(imgUrl, thumbUrl) {
                var dd = load();
                var m = getMeta(dd, themeName);
                m.category = sheet.querySelector('#tm-dcat').value;
                m.author = sheet.querySelector('#tm-dauthor').value.trim();
                m.description = sheet.querySelector('#tm-ddesc').value.trim();
                m.backgroundName = editBackgroundName;
                m.tags = editTags.slice();
                m.imageData = imgUrl || null;
                m.thumbData = thumbUrl || imgUrl || null;
                m.crop = editCrop || null;
                save(dd);
                closeSheet(sheet);
                if (getCurrentThemeName() === themeName) {
                    applyBoundBackground(themeName, function () {
                        toast('✨ 已保存');
                        renderCatbar(); renderGrid(); renderBottomStatus();
                    });
                } else {
                    toast('✨ 已保存');
                    renderCatbar(); renderGrid();
                }
            }
            if (editImgData && !editThumbData) {
                makeThumbFromCrop(editImgData, editCrop, function (thumb) {
                    editThumbData = thumb;
                    uploadImage(editImgData, function (_err, imgUrl) {
                        uploadImage(editThumbData, function (_err2, thumbUrl) { finishSave(imgUrl, thumbUrl); });
                    });
                });
            } else {
                uploadImage(editImgData, function (_err, imgUrl) {
                    uploadImage(editThumbData, function (_err2, thumbUrl) { finishSave(imgUrl, thumbUrl); });
                });
            }
        });
    }

    function mergeImportedAnnotations(imported) {
        var dd = load();
        var importedCount = 0;

        for (var k in imported.themeMeta) {
            var imp = imported.themeMeta[k] || {};
            if (!dd.themeMeta[k]) {
                dd.themeMeta[k] = imp;
                if (!Array.isArray(dd.themeMeta[k].tags)) dd.themeMeta[k].tags = [];
                if (dd.themeMeta[k].thumbData === undefined) dd.themeMeta[k].thumbData = null;
                if (dd.themeMeta[k].crop === undefined) dd.themeMeta[k].crop = null;
            } else {
                var existing = getMeta(dd, k);
                if (!Array.isArray(existing.tags)) existing.tags = [];
                if (!existing.imageData && imp.imageData) existing.imageData = imp.imageData;
                if (!existing.thumbData && imp.thumbData) existing.thumbData = imp.thumbData;
                if (!existing.crop && imp.crop) existing.crop = imp.crop;
                if (!existing.category && imp.category) existing.category = imp.category;
                if (!existing.backgroundName && imp.backgroundName) existing.backgroundName = imp.backgroundName;
                if (imp.tags) imp.tags.forEach(function (t) { if (existing.tags.indexOf(t) === -1) existing.tags.push(t); });
                if (!existing.author && imp.author) existing.author = imp.author;
                if (!existing.description && imp.description) existing.description = imp.description;
            }
            importedCount++;
        }

        if (imported.categories) imported.categories.forEach(function (c) { if (dd.categories.indexOf(c) === -1) dd.categories.push(c); });

        save(dd);
        renderCatbar();
        renderGrid();
        renderBottomStatus();
        toast('✅ 导入成功：' + importedCount + ' 个标注');
    }

    function openCategoryExportSheet() {
        var d = load();
        var rows = '';
        function countForCat(cat) {
            var n = 0;
            stThemeList.forEach(function (name) {
                var m = d.themeMeta[name] || {};
                if (cat === '__uncategorized__') { if (!m.category) n++; }
                else if (m.category === cat) n++;
            });
            return n;
        }
        rows += '<button class="tm-cat-export-item" data-cat="__uncategorized__"><span>未分类</span><small>' + countForCat('__uncategorized__') + ' 个美化</small></button>';
        d.categories.forEach(function (cat) {
            rows += '<button class="tm-cat-export-item" data-cat="' + esc(cat) + '"><span>' + esc(cat) + '</span><small>' + countForCat(cat) + ' 个美化</small></button>';
        });
        if (d.categories.length === 0) rows += '<div class="tm-hint">还没有自定义分类，可以先导出未分类美化。</div>';

        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-folder-open"></i>导出分类</div>',
            '<div class="tm-import-cat-list">' + rows + '</div>',
            '<div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" id="tm-cat-exp-cancel">取消</button></div>',
        ].join(''));

        sheet.querySelector('#tm-cat-exp-cancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelectorAll('.tm-cat-export-item').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var cat = btn.dataset.cat || '';
                var count = countForCat(cat);
                if (count <= 0) { toast('这个分类里没有美化', true); return; }
                closeSheet(sheet);
                getAllThemeObjects(function (themes, err) {
                    if (!themes) { toast('导出分类失败：' + (err ? err.message : '无法读取主题'), true); return; }
                    var filtered = themes.filter(function (theme) {
                        if (!theme || !theme.name) return false;
                        var m = load().themeMeta[theme.name] || {};
                        if (cat === '__uncategorized__') return !m.category;
                        return m.category === cat;
                    });
                    if (filtered.length === 0) { toast('这个分类里没有可导出的美化', true); return; }
                    normalizeThemeObjects(filtered, function (normalizedThemes, compatInfo) {
                        var catName = cat === '__uncategorized__' ? '未分类' : cat;
                        var bundle = {
                            type: 'theme-mgr-theme-bundle',
                            version: 1,
                            exportedAt: new Date().toISOString(),
                            exportScope: { type: 'category', category: catName },
                            themes: normalizedThemes,
                            categories: cat === '__uncategorized__' ? [] : [cat],
                            themeMeta: buildThemeMetaForBundle(normalizedThemes),
                        };
                        var safeName = String(catName).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'category';
                        var fixedText = compatInfo && compatInfo.fixedCount > 0 ? '，已补齐 ' + compatInfo.fixedCount + ' 个不完整美化' : '';
                        downloadJsonFile('theme-mgr-' + safeName + '-' + new Date().toISOString().slice(0, 10) + '.json', bundle, function (assetCount) {
                            toast('✅ 已导出「' + catName + '」：' + normalizedThemes.length + ' 个' + fixedText + (assetCount ? '，含 ' + assetCount + ' 张图片' : ''));
                        });
                    });
                });
            });
        });
    }

    // ── 设置 ─────────────────────────────────────────────────
    function openSettingsSheet() {
        var d = load();
        var metaCount = Object.keys(d.themeMeta).length;
        var imgCount = 0;
        for (var k in d.themeMeta) { if (d.themeMeta[k].imageData) imgCount++; }

        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-sliders"></i>设置</div>',
            '<div class="tm-sec-title">分类管理</div>',
            '<button class="tm-btn tm-btn-outline" id="tm-open-cats" style="width:100%;text-align:left;margin-bottom:10px"><i class="fa-solid fa-tags" style="margin-right:6px"></i>管理分类（' + d.categories.length + '个）</button>',
            '<div class="tm-sec-title">显示</div>',
            '<div class="tm-row-inline"><label>显示悬浮球</label><input type="checkbox" class="tm-chk" id="tm-show-ball" ' + (d.showBall !== false ? 'checked' : '') + ' /></div>',
            '<div class="tm-row-inline" style="margin-top:6px"><label>显示使用次数</label><input type="checkbox" class="tm-chk" id="tm-show-freq" ' + (d.showFreq !== false ? 'checked' : '') + ' /></div>',
            '<div class="tm-sec-title">悬浮球自定义</div>',
            '<div class="tm-field"><label>自定义图片 <span class="tm-hint">支持 gif 动图、透明底 png</span></label>' +
            '<div class="tm-fab-custom-row">' +
            '<div class="tm-fab-preview" id="tm-fab-preview">' +
            (d.fabImage ? '<img src="' + esc(d.fabImage) + '" />' : '<div class="tm-fab-default-preview"><i class="fa-solid fa-palette"></i></div>') +
            '</div>' +
            '<div class="tm-fab-custom-actions">' +
            '<button class="tm-btn tm-btn-outline" id="tm-fab-pick"><i class="fa-solid fa-image"></i> 选择图片</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-fab-reset" style="' + (d.fabImage ? '' : 'opacity:.35;pointer-events:none;') + '"><i class="fa-solid fa-rotate-left"></i> 恢复默认</button>' +
            '</div>' +
            '<input type="file" id="tm-fab-file" accept="image/*" style="display:none" />' +
            '</div></div>',
            '<div class="tm-field"><label>悬浮球大小：<span id="tm-fab-size-val">' + (d.fabSize || 38) + 'px</span></label>' +
            '<input type="range" class="tm-range" id="tm-fab-size" min="28" max="64" value="' + (d.fabSize || 38) + '" /></div>',
            '<div class="tm-divider"></div>',
            '<div class="tm-sec-title">数据</div>',
            '<div class="tm-storage-info">ST 共有 ' + stThemeList.length + ' 个主题 / 已标注 ' + metaCount + ' 个 / ' + imgCount + ' 张截图 / ' + (getServerMode() ? '后端存储' : '浏览器存储') + '</div>',
            '<div class="tm-data-grid">' +
            '<button class="tm-btn tm-btn-outline" id="tm-imp-theme"><i class="fa-solid fa-file-import"></i> 导入美化</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-imp-theme-batch"><i class="fa-solid fa-upload"></i> 批量导入美化</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-exp-theme-bundle"><i class="fa-solid fa-file-export"></i> 导出美化包</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-exp-theme-cat"><i class="fa-solid fa-folder-open"></i> 导出分类</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-exp"><i class="fa-solid fa-download"></i> 导出标注</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-imp"><i class="fa-solid fa-upload"></i> 导入标注</button>' +
            '<button class="tm-btn tm-btn-danger" id="tm-clear">清空标注</button>' +
            '</div>',
            '<div class="tm-hint" style="margin-top:8px">※ 标注只包含分类、标签、截图等附加信息；美化包会打包 ST 当前所有主题 JSON，并附带分类等轻量标注</div>',
        ].join(''));

        sheet.querySelector('#tm-show-ball').addEventListener('change', function () {
            var dd = load(); dd.showBall = this.checked; save(dd);
            removeFab();
            if (dd.showBall) injectFab();
        });
        sheet.querySelector('#tm-show-freq').addEventListener('change', function () {
            var dd = load(); dd.showFreq = this.checked; save(dd); renderGrid();
        });
        var fabFileInp = sheet.querySelector('#tm-fab-file');
        var fabResetBtn = sheet.querySelector('#tm-fab-reset');
        function updateFabPreview(imgSrc) {
            var prev = sheet.querySelector('#tm-fab-preview');
            if (!prev) return;
            if (imgSrc) {
                prev.innerHTML = '<img src="' + esc(imgSrc) + '" />';
                fabResetBtn.style.opacity = '';
                fabResetBtn.style.pointerEvents = '';
            } else {
                prev.innerHTML = '<div class="tm-fab-default-preview"><i class="fa-solid fa-palette"></i></div>';
                fabResetBtn.style.opacity = '.35';
                fabResetBtn.style.pointerEvents = 'none';
            }
        }
        function refreshFab() {
            removeFab();
            var dd = load();
            if (dd.showBall !== false) injectFab();
        }
        sheet.querySelector('#tm-fab-pick').addEventListener('click', function () { fabFileInp.click(); });
        fabFileInp.addEventListener('change', function () {
            var file = fabFileInp.files[0]; if (!file) return;
            var reader = new FileReader();
            reader.onload = function (e) {
                var dataUrl = e.target.result;
                uploadImage(dataUrl, function (_err, imageUrl) {
                    var dd = load(); dd.fabImage = imageUrl || dataUrl; save(dd);
                    updateFabPreview(dd.fabImage);
                    refreshFab();
                    toast('✨ 悬浮球已更新');
                });
            };
            reader.readAsDataURL(file);
        });
        fabResetBtn.addEventListener('click', function () {
            var dd = load(); dd.fabImage = ''; save(dd);
            updateFabPreview('');
            refreshFab();
            toast('悬浮球已恢复默认');
        });
        sheet.querySelector('#tm-fab-size').addEventListener('input', function () {
            var val = parseInt(this.value);
            if (!val || val < 28) val = 28;
            if (val > 64) val = 64;
            sheet.querySelector('#tm-fab-size-val').textContent = val + 'px';
            var dd = load(); dd.fabSize = val; save(dd);
            refreshFab();
        });
        sheet.querySelector('#tm-exp').addEventListener('click', function () {
            var d2 = load();
            downloadJsonFile('theme-mgr-data-' + new Date().toISOString().slice(0, 10) + '.json', d2, function (assetCount) {
                toast('✅ 已导出' + (assetCount ? '（含 ' + assetCount + ' 张图片）' : ''));
            });
        });
        sheet.querySelector('#tm-imp').addEventListener('click', function () {
            var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
            inp.addEventListener('change', function () {
                if (!inp.files[0]) return;
                var reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        var imported = JSON.parse(e.target.result);
                        if (imported.themeMeta) {
                            resolveImportAssets(imported, function () { mergeImportedAnnotations(imported); });
                        } else { toast('文件格式不正确', true); }
                    } catch (err) { toast('解析失败', true); }
                };
                reader.readAsText(inp.files[0], 'utf-8');
            });
            inp.click();
        });
        sheet.querySelector('#tm-imp-theme').addEventListener('click', function () {
            var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
            inp.addEventListener('change', function () {
                if (!inp.files[0]) return;
                var reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        var parsed = JSON.parse(e.target.result);
                        resolveImportAssets(parsed, function () {
                            try {
                                var payload = extractThemeImportPayload(parsed, inp.files[0].name);
                                importThemePayload(payload, { failText: '导入美化失败' });
                            } catch (err2) { toast('解析失败', true); }
                        });
                    } catch (err) { toast('解析失败', true); }
                };
                reader.readAsText(inp.files[0], 'utf-8');
            });
            inp.click();
        });
        sheet.querySelector('#tm-imp-theme-batch').addEventListener('click', function () {
            var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json'; inp.multiple = true;
            inp.addEventListener('change', function () {
                var files = Array.prototype.slice.call(inp.files || []);
                if (files.length === 0) return;
                Promise.all(files.map(function (file) {
                    return readJsonFile(file)
                        .then(function (res) {
                            return new Promise(function (resolve) {
                                resolveImportAssets(res.data, function () { resolve({ file: file, data: res.data }); });
                            });
                        })
                        .catch(function (err) { return { file: file, error: err }; });
                })).then(function (results) {
                    var payload = { themes: [], themeMeta: {}, categories: [] };
                    var errors = [];
                    results.forEach(function (res) {
                        if (res.error) { errors.push(res.error.message); return; }
                        try {
                            mergeThemePayload(payload, extractThemeImportPayload(res.data, res.file.name));
                        } catch (err) { errors.push(err.message); }
                    });
                    if (errors.length > 0) {
                        console.warn('[美化管理] 批量导入解析错误:', errors);
                        if (!confirm('有 ' + errors.length + ' 个文件/主题解析失败，将跳过它们继续导入其余内容。是否继续？')) return;
                    }
                    importThemePayload(payload, { failText: '批量导入美化失败' });
                });
            });
            inp.click();
        });
        sheet.querySelector('#tm-exp-theme-bundle').addEventListener('click', function () {
            getAllThemeObjects(function (themes, err) {
                if (!themes) { toast('导出美化包失败：' + (err ? err.message : '无法读取主题'), true); return; }
                if (themes.length === 0) { toast('没有可导出的美化', true); return; }
                normalizeThemeObjects(themes, function (normalizedThemes, compatInfo) {
                    var bundle = {
                        type: 'theme-mgr-theme-bundle',
                        version: 1,
                        exportedAt: new Date().toISOString(),
                        themes: normalizedThemes,
                        categories: load().categories.slice(),
                        themeMeta: buildThemeMetaForBundle(normalizedThemes),
                    };
                    var fixedText = compatInfo && compatInfo.fixedCount > 0 ? '，已补齐 ' + compatInfo.fixedCount + ' 个不完整美化' : '';
                    downloadJsonFile('theme-mgr-themes-' + new Date().toISOString().slice(0, 10) + '.json', bundle, function (assetCount) {
                        toast('✅ 已导出美化包：' + normalizedThemes.length + ' 个' + fixedText + (assetCount ? '，含 ' + assetCount + ' 张图片' : ''));
                    });
                });
            });
        });
        sheet.querySelector('#tm-exp-theme-cat').addEventListener('click', function () { openCategoryExportSheet(); });
        sheet.querySelector('#tm-clear').addEventListener('click', function () {
            if (!confirm('确定清空所有标注数据（分类、标签、截图）？\n主题文件本身不受影响。')) return;
            var dd = load(); dd.themeMeta = {}; dd.categories = []; curCat = '__all__';
            save(dd); closeSheet(sheet);
            fetchThemeList(function () { renderCatbar(); renderGrid(); renderBottomStatus(); });
            toast('已清空');
        });
        sheet.querySelector('#tm-open-cats').addEventListener('click', function () { closeSheet(sheet); openCatsSheet(); });
    }

    // ── 分类管理 ─────────────────────────────────────────────
    function openCatsSheet() {
        var d = load();
        var listHTML = d.categories.length === 0
            ? '<div class="tm-empty"><i class="fa-solid fa-tags"></i><span>还没有分类</span></div>'
            : d.categories.map(function (cat, idx) {
                var n = 0; for (var k in d.themeMeta) { if (d.themeMeta[k].category === cat) n++; }
                return '<div class="tm-cat-item" data-idx="' + idx + '"><span class="tm-drag-handle" draggable="true" data-idx="' + idx + '"><i class="fa-solid fa-grip-vertical"></i></span><span class="tm-cat-name">' + esc(cat) + '</span><span class="tm-cat-count">' + n + '个</span>' +
                    '<button class="tm-btn-sm tm-cat-ren" data-idx="' + idx + '"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="tm-btn-sm tm-cat-del" data-idx="' + idx + '"><i class="fa-solid fa-trash"></i></button></div>';
            }).join('');

        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-tags"></i>分类管理</div>',
            listHTML,
            '<div class="tm-divider"></div>',
            '<div class="tm-cat-add-row"><input type="text" id="tm-newcat" placeholder="新分类名称…" /><button class="tm-btn tm-btn-safe" id="tm-newadd">添加</button></div>',
        ].join(''));

        var inp = sheet.querySelector('#tm-newcat');
        var dragFrom = null;
        var dragTo = null;
        var dragGhost = null;
        var touchOffsetY = 0;

        function clearDropMarks() {
            sheet.querySelectorAll('.tm-cat-item').forEach(function (item) {
                item.classList.remove('drag-over-top', 'drag-over-bottom');
            });
        }
        function clearDragState() {
            clearDropMarks();
            sheet.querySelectorAll('.tm-cat-item').forEach(function (item) {
                item.classList.remove('dragging');
            });
            if (dragGhost && dragGhost.parentNode) dragGhost.parentNode.removeChild(dragGhost);
            dragGhost = null;
        }
        function getInsertIndex(item, clientY) {
            var idx = parseInt(item.dataset.idx, 10);
            var rect = item.getBoundingClientRect();
            return clientY > rect.top + rect.height / 2 ? idx + 1 : idx;
        }
        function markInsert(item, clientY) {
            var rect = item.getBoundingClientRect();
            clearDropMarks();
            item.classList.add(clientY > rect.top + rect.height / 2 ? 'drag-over-bottom' : 'drag-over-top');
        }
        function moveCategory(from, to) {
            var dd = load();
            if (from === null || to === null || from < 0 || from >= dd.categories.length) return;
            if (to < 0) to = 0;
            if (to > dd.categories.length) to = dd.categories.length;
            if (to === from || to === from + 1) return;
            var cat = dd.categories.splice(from, 1)[0];
            if (to > from) to--;
            dd.categories.splice(to, 0, cat);
            save(dd); closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('已调整顺序');
        }
        function updateTouchInsert(clientY) {
            var items = sheet.querySelectorAll('.tm-cat-item');
            var last = null;
            clearDropMarks();
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var rect = item.getBoundingClientRect();
                last = item;
                if (clientY < rect.top + rect.height / 2) {
                    dragTo = parseInt(item.dataset.idx, 10);
                    item.classList.add('drag-over-top');
                    return;
                }
            }
            if (last) {
                dragTo = parseInt(last.dataset.idx, 10) + 1;
                last.classList.add('drag-over-bottom');
            }
        }

        sheet.querySelector('#tm-newadd').addEventListener('click', function () {
            var name = inp.value.trim(); if (!name) return;
            var dd = load();
            if (dd.categories.indexOf(name) === -1) { dd.categories.push(name); save(dd); inp.value = ''; closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('分类「' + name + '」已添加'); }
            else toast('分类已存在', true);
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sheet.querySelector('#tm-newadd').click(); });
        sheet.querySelectorAll('.tm-drag-handle').forEach(function (handle) {
            handle.addEventListener('dragstart', function (e) {
                dragFrom = parseInt(handle.dataset.idx, 10);
                dragTo = dragFrom;
                handle.closest('.tm-cat-item').classList.add('dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(dragFrom));
                }
            });
            handle.addEventListener('dragend', function () {
                clearDragState();
                dragFrom = null; dragTo = null;
            });
            handle.addEventListener('touchstart', function (e) {
                if (!e.touches || !e.touches.length) return;
                e.preventDefault();
                dragFrom = parseInt(handle.dataset.idx, 10);
                dragTo = dragFrom;
                var touch = e.touches[0];
                var item = handle.closest('.tm-cat-item');
                var rect = item.getBoundingClientRect();
                touchOffsetY = touch.clientY - rect.top;
                dragGhost = item.cloneNode(true);
                dragGhost.style.position = 'fixed';
                dragGhost.style.left = rect.left + 'px';
                dragGhost.style.top = rect.top + 'px';
                dragGhost.style.width = rect.width + 'px';
                dragGhost.style.margin = '0';
                dragGhost.style.pointerEvents = 'none';
                dragGhost.style.opacity = '.8';
                dragGhost.style.zIndex = '99';
                sheet.appendChild(dragGhost);
                item.classList.add('dragging');
                updateTouchInsert(touch.clientY);
            }, { passive: false });
            handle.addEventListener('touchmove', function (e) {
                if (!e.touches || !e.touches.length || dragFrom === null) return;
                e.preventDefault();
                var touch = e.touches[0];
                if (dragGhost) dragGhost.style.top = (touch.clientY - touchOffsetY) + 'px';
                updateTouchInsert(touch.clientY);
            }, { passive: false });
            handle.addEventListener('touchend', function (e) {
                if (dragFrom === null) return;
                e.preventDefault();
                var from = dragFrom; var to = dragTo;
                clearDragState();
                dragFrom = null; dragTo = null;
                moveCategory(from, to);
            }, { passive: false });
            handle.addEventListener('touchcancel', function () {
                clearDragState();
                dragFrom = null; dragTo = null;
            });
        });
        sheet.querySelectorAll('.tm-cat-item').forEach(function (item) {
            item.addEventListener('dragover', function (e) {
                if (dragFrom === null) return;
                e.preventDefault();
                dragTo = getInsertIndex(item, e.clientY);
                markInsert(item, e.clientY);
            });
            item.addEventListener('drop', function (e) {
                if (dragFrom === null) return;
                e.preventDefault();
                var from = dragFrom; var to = getInsertIndex(item, e.clientY);
                clearDragState();
                dragFrom = null; dragTo = null;
                moveCategory(from, to);
            });
        });
        sheet.querySelectorAll('.tm-cat-ren').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var dd = load(); var idx = parseInt(btn.dataset.idx); var old = dd.categories[idx];
                var nw = prompt('重命名（原：' + old + '）：', old); if (!nw || !nw.trim() || nw.trim() === old) return;
                nw = nw.trim(); dd.categories[idx] = nw;
                for (var k in dd.themeMeta) { if (dd.themeMeta[k].category === old) dd.themeMeta[k].category = nw; }
                save(dd); closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('已重命名');
            });
        });
        sheet.querySelectorAll('.tm-cat-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var dd = load(); var idx = parseInt(btn.dataset.idx); var name = dd.categories[idx];
                if (!confirm('删除分类「' + name + '」？')) return;
                dd.categories.splice(idx, 1);
                for (var k in dd.themeMeta) { if (dd.themeMeta[k].category === name) dd.themeMeta[k].category = ''; }
                if (curCat === name) curCat = '__all__';
                save(dd); closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('已删除');
            });
        });
    }

    // ── Bottom Sheet 通用 ───────────────────────────────────
    function createSheet(contentHtml) {
        var ov = document.createElement('div');
        ov.className = 'tm-sheet-overlay';
        ov.innerHTML = '<div class="tm-sheet"><div class="tm-sheet-handle"></div><div class="tm-sheet-content">' + contentHtml + '</div></div>';
        getPopupLayer().appendChild(ov);
        ov.addEventListener('click', function (e) { if (e.target === ov) closeSheet(ov); });
        return ov;
    }
    function closeSheet(ov) { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }

    // ── Lightbox ─────────────────────────────────────────────
    function openLightbox(themeNames, startName) {
        var themes = themeNames.filter(function (n) { var m = load().themeMeta[n]; return m && (m.imageData || m.thumbData); });
        if (themes.length === 0) return;
        var idx = themes.indexOf(startName); if (idx === -1) idx = 0;

        var lb = document.createElement('div');
        lb.className = 'tm-lightbox';
        lb.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2 !important;pointer-events:auto !important;';

        function render() {
            var d = load(); var name = themes[idx]; var meta = d.themeMeta[name] || {};
            var lbImg = meta.imageData || meta.thumbData || '';
            lb.innerHTML =
                '<button class="tm-lb-close"><i class="fa-solid fa-xmark"></i></button>' +
                '<div class="tm-lb-name">' + esc(name) + '</div>' +
                (themes.length > 1 ? '<button class="tm-lb-nav tm-lb-prev"><i class="fa-solid fa-chevron-left"></i></button>' : '') +
                '<img class="tm-lb-img" src="' + lbImg + '" draggable="false" />' +
                (themes.length > 1 ? '<button class="tm-lb-nav tm-lb-next"><i class="fa-solid fa-chevron-right"></i></button>' : '') +
                (themes.length > 1 ? '<div class="tm-lb-counter">' + (idx + 1) + ' / ' + themes.length + '</div>' : '');
            lb.querySelector('.tm-lb-close').addEventListener('click', closeLb);
            var prev = lb.querySelector('.tm-lb-prev'); var next = lb.querySelector('.tm-lb-next');
            if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx - 1 + themes.length) % themes.length; render(); });
            if (next) next.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx + 1) % themes.length; render(); });
        }
        lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
        function closeLb() { if (lb.parentNode) lb.parentNode.removeChild(lb); document.removeEventListener('keydown', keyH); }
        function keyH(e) {
            if (e.key === 'Escape') closeLb();
            else if (e.key === 'ArrowLeft' && themes.length > 1) { idx = (idx - 1 + themes.length) % themes.length; render(); }
            else if (e.key === 'ArrowRight' && themes.length > 1) { idx = (idx + 1) % themes.length; render(); }
        }
        document.addEventListener('keydown', keyH);
        render();
        getPopupLayer().appendChild(lb);
    }

    // ── FAB ──────────────────────────────────────────────────
    var fabResizeHandler = null;
    function removeFab() {
        var fab = document.getElementById(FAB_ID);
        if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
        if (fabResizeHandler) {
            window.removeEventListener('resize', fabResizeHandler);
            fabResizeHandler = null;
        }
    }

    function injectFab() {
        if (document.getElementById(FAB_ID)) return;
        var d = load(); if (d.showBall === false) return;
        var container = document.createElement('div'); container.id = FAB_ID;
        var MAIN_SIZE = d.fabSize || 38;
        var accent = 'var(--SmartThemeQuoteColor,#7c6daf)';

        function posFab() {
            var vh = window.innerHeight || document.documentElement.clientHeight;
            var vw = window.innerWidth || document.documentElement.clientWidth;
            var dd = load();
            var mainTop, mainLeft;
            if (dd.fabPos && typeof dd.fabPos.top === 'number' && typeof dd.fabPos.left === 'number') {
                mainTop = Math.max(0, Math.min(dd.fabPos.top, vh - MAIN_SIZE));
                mainLeft = Math.max(0, Math.min(dd.fabPos.left, vw - MAIN_SIZE));
            } else {
                mainTop = vh - 80 - MAIN_SIZE;
                mainLeft = vw - 16 - MAIN_SIZE;
                if (mainTop < 10) mainTop = 10;
                if (mainLeft < 10) mainLeft = 10;
            }
            container.setAttribute('style',
                'position:fixed !important;top:' + mainTop + 'px !important;left:' + mainLeft + 'px !important;' +
                'z-index:2147483647 !important;display:flex !important;align-items:center !important;' +
                'pointer-events:none !important;margin:0 !important;padding:0 !important;');
        }

        var mainBtn;
        if (d.fabImage) {
            mainBtn = document.createElement('img');
            mainBtn.src = d.fabImage;
            mainBtn.setAttribute('style',
                'width:' + MAIN_SIZE + 'px !important;height:' + MAIN_SIZE + 'px !important;' +
                'cursor:pointer !important;display:block !important;pointer-events:auto !important;' +
                'object-fit:contain !important;touch-action:none !important;' +
                'filter:drop-shadow(0 2px 6px rgba(0,0,0,.25)) !important;');
        } else {
            mainBtn = document.createElement('div');
            mainBtn.innerHTML = '<i class="fa-solid fa-palette" style="pointer-events:none;font-size:' + Math.max(0.7, MAIN_SIZE / 35) + 'em;"></i>';
            mainBtn.setAttribute('style',
                'width:' + MAIN_SIZE + 'px !important;height:' + MAIN_SIZE + 'px !important;border-radius:50% !important;' +
                'background:' + accent + ' !important;color:#fff !important;border:none !important;cursor:pointer !important;' +
                'display:flex !important;align-items:center !important;justify-content:center !important;' +
                'box-shadow:0 4px 16px rgba(0,0,0,.35) !important;opacity:.9 !important;pointer-events:auto !important;' +
                'touch-action:none !important;');
        }
        mainBtn.id = 'tm-fab-main-btn';
        container.appendChild(mainBtn);

        var _ds = { sx: 0, sy: 0, ox: 0, oy: 0, moved: false, handled: false };
        function startDrag(x, y) {
            var rect = container.getBoundingClientRect();
            _ds.sx = x; _ds.sy = y; _ds.ox = rect.left; _ds.oy = rect.top; _ds.moved = false;
        }
        function moveDrag(x, y) {
            var dx = x - _ds.sx, dy = y - _ds.sy;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) _ds.moved = true;
            if (_ds.moved) {
                var nx = Math.max(0, Math.min(_ds.ox + dx, window.innerWidth - MAIN_SIZE));
                var ny = Math.max(0, Math.min(_ds.oy + dy, window.innerHeight - MAIN_SIZE));
                container.style.setProperty('left', nx + 'px', 'important');
                container.style.setProperty('top', ny + 'px', 'important');
            }
        }
        function saveFabPos() {
            var rect = container.getBoundingClientRect();
            var dd = load();
            dd.fabPos = { top: Math.round(rect.top), left: Math.round(rect.left) };
            save(dd);
        }

        mainBtn.addEventListener('touchstart', function (e) {
            var t = e.touches[0];
            startDrag(t.clientX, t.clientY);
        }, { passive: true });
        mainBtn.addEventListener('touchmove', function (e) {
            var t = e.touches[0];
            moveDrag(t.clientX, t.clientY);
        }, { passive: true });
        mainBtn.addEventListener('touchend', function (e) {
            if (!_ds.moved) {
                _ds.handled = true;
                e.preventDefault();
                setTimeout(function () { openPopup(); }, 50);
            } else {
                saveFabPos();
            }
        });

        mainBtn.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            startDrag(e.clientX, e.clientY);
            document.addEventListener('mousemove', mouseMove);
            document.addEventListener('mouseup', mouseUp);
        });
        function mouseMove(e) {
            moveDrag(e.clientX, e.clientY);
        }
        function mouseUp() {
            document.removeEventListener('mousemove', mouseMove);
            document.removeEventListener('mouseup', mouseUp);
            if (_ds.moved) saveFabPos();
        }
        mainBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (_ds.handled) { _ds.handled = false; return; }
            if (_ds.moved) { _ds.moved = false; return; }
            openPopup();
        });

        posFab();
        if (fabResizeHandler) window.removeEventListener('resize', fabResizeHandler);
        fabResizeHandler = posFab; window.addEventListener('resize', fabResizeHandler);
        document.body.appendChild(container);
    }
    function closeFab() { fabOpen = false; }

    // ── 侧栏按钮 ──────────────────────────────────────────────
    function updateBtn() {
        var btn = document.getElementById(BTN_ID); if (!btn) return;
        var curTheme = getCurrentThemeName();
        var span = btn.querySelector('span');
        var status = supportFailed ? '（模块加载失败）' : (!supportReady ? '（加载中）' : '');
        var title = curTheme ? (LAUNCHER_NAME + status + '：' + curTheme) : (LAUNCHER_NAME + status);
        var inner = btn.querySelector('.list-group-item');
        if (span) span.textContent = LAUNCHER_NAME;
        btn.title = title;
        if (inner) inner.title = title;
        btn.style.color = curTheme ? 'var(--SmartThemeQuoteColor)' : '';
        if (inner) inner.style.color = curTheme ? 'var(--SmartThemeQuoteColor)' : '';
    }

    function openLauncher() {
        if (supportReady) {
            openPopup();
            return;
        }
        if (supportFailed) {
            var failedMsg = '美化管理器模块加载失败：' + (supportErrorText || '未知原因') + '\n\n请更新到 v3.5.5 后刷新/重启酒馆。';
            try { alert(failedMsg); } catch (e) {}
            return;
        }
        pendingOpenAfterReady = true;
        try {
            toast('美化管理器正在加载，请稍等一下…');
        } catch (e2) {}
    }

    function findMenu() {
        var m = document.getElementById('extensionsMenu'); if (m) return m;
        m = document.getElementById('extensions_menu'); if (m) return m;
        var items = document.querySelectorAll('.list-group-item.interactable');
        for (var i = 0; i < items.length; i++) { var t = items[i].textContent || ''; if (t.indexOf('CSS') !== -1 || t.indexOf('穿搭') !== -1 || t.indexOf('变量管理') !== -1) return items[i].parentElement; }
        return null;
    }

    function injectBtn() {
        if (document.getElementById(BTN_ID)) { updateBtn(); return; }
        var menu = findMenu(); if (!menu) return;
        var curTheme = getCurrentThemeName();
        var btn = document.createElement('div');
        btn.id = BTN_ID;
        btn.title = curTheme ? (LAUNCHER_NAME + '：' + curTheme) : LAUNCHER_NAME;
        if (curTheme) btn.style.color = 'var(--SmartThemeQuoteColor)';
        if (menu.id === 'extensionsMenu') {
            btn.className = 'extension_container interactable';
            btn.tabIndex = 0;
            btn.innerHTML =
                '<div class="list-group-item flex-container flexGap5 interactable" role="listitem" tabindex="0" title="' + esc(btn.title) + '">' +
                '<div class="fa-fw fa-solid fa-palette extensionsMenuExtensionButton"></div>' +
                '<span>' + esc(LAUNCHER_NAME) + '</span>' +
                '</div>';
        } else {
            btn.className = 'list-group-item flex-container flexGap5 interactable';
            btn.innerHTML = '<i class="fa-solid fa-palette"></i><span>' + esc(LAUNCHER_NAME) + '</span>';
        }
        btn.addEventListener('click', openLauncher);
        menu.appendChild(btn);
    }

    function startLauncherInjection() {
        if (launcherInjectStarted) return;
        launcherInjectStarted = true;
        setTimeout(injectBtn, 0);
        setTimeout(injectBtn, 250);
        setTimeout(injectBtn, 750);
        setInterval(injectBtn, 2000);
    }

    // ── 启动 ──────────────────────────────────────────────────
    function startThemeManager() {
        injectStyles();
        bindImportedThemeSelectSync();
        startLauncherInjection();
        setTimeout(injectFab, 1500);
        setInterval(function () { if (!document.getElementById(FAB_ID)) injectFab(); }, 3000);

        initStorage(function (d) {
            var lsData = loadFromLS();
            if (lsData && lsData.themeMeta && Object.keys(lsData.themeMeta).length > 0 && (!d.themeMeta || Object.keys(d.themeMeta).length === 0)) {
                var migratedData = ensureDefaults(lsData);
                save(migratedData);
                saveToDB(migratedData, function () { try { localStorage.removeItem('theme_mgr_v2'); } catch (e) {} });
            }
            updateBtn();
        });
    }

    startLauncherInjection();
    setupSupportModules(startThemeManager);

})();
