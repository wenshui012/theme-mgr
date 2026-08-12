// ST美化管理主界面与控制器 v4.0
// 基于穿搭管理 v14.5b 架构，对接 ST 真实主题 API
// 功能：读取ST主题列表、一键切换、预览截图、分类标签、收藏、排序、批量操作

(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createUiMain = function (options) {
    options = options || {};
    var modules = options.modules || ns;

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

    var TM_VERSION = options.version || '4.0.0';
    var storageApi = null;
    var imageToolsApi = null;
    var styleApi = null;
    var themeSchema = null;
    var themeApi = null;
    var themeRuntime = null;
    var themeTransactions = null;
    var themeTransfer = null;
    var metadataApi = null;
    var editorDraftApi = null;
    var pairsApi = null;
    var seriesApi = null;
    var bindingsApi = null;
    var bindingController = null;
    var appearanceApi = null;
    var backgroundsApi = null;
    var uiSheetsApi = null;
    var uiEventsApi = null;
    var supportReady = false;
    var supportFailed = false;
    var supportErrorText = '';
    var pendingOpenAfterReady = false;
    var darkMode = false;

    // 缓存主题列表
    var stThemeList = [];
    var stThemeListReliable = false;
    var themeListRevision = 0;
    var metadataRevision = 0;
    var libraryViewCache = null;
    var verifiedThemeSelectSyncBound = false;
    var managerAppearanceObserver = null;
    var managerAppearanceTimer = null;
    var managerAppearanceSettleTimer = null;
    var lastBindingWarningKey = '';
    var pendingVerifiedManualThemes = {};
    var colorSchemeWatcher = null;
    var temporaryPairOverride = null;
    var frameAssetAnalysisCache = Object.create(null);
    var frameAssetAnalysisOrder = [];
    var IMAGE_FIELD_KEYS = { imageData: true, thumbData: true, previewData: true, fabImage: true };

    function initUiEvents() {
        if (uiEventsApi || !modules.createUiEvents) return uiEventsApi;
        uiEventsApi = modules.createUiEvents({
            fabId: FAB_ID,
            buttonId: BTN_ID,
            launcherName: LAUNCHER_NAME,
            version: TM_VERSION,
            load: load,
            save: save,
            esc: esc,
            getCurrentThemeName: getCurrentThemeName,
            openPopup: openPopup,
            toast: toast,
            getSupportState: function () {
                return { ready: supportReady, failed: supportFailed, errorText: supportErrorText };
            },
            requestOpenAfterReady: function () { pendingOpenAfterReady = true; },
            whenStorageReady: whenStorageReady,
            isStorageReady: isStorageReady,
        });
        return uiEventsApi;
    }

    function setupSupportModules(cb) {
            initUiEvents();
            var ok = true;
            if (!ok || !modules.themeSchema || !modules.createThemeApi || !modules.createThemeRuntime ||
                !modules.createThemeTransactions || !modules.createThemeTransfer ||
                !modules.themeMetadata || !modules.editorDraft ||
                !modules.themePairs ||
                !modules.themeSeries ||
                !modules.themeBindings ||
                !modules.themeAppearance ||
                !modules.createBackgrounds ||
                !modules.createUiSheets ||
                !modules.createUiEvents ||
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
                    if (!modules.createThemeTransactions) missing.push('theme-transactions.js');
                    if (!modules.createThemeTransfer) missing.push('theme-transfer.js');
                    if (!modules.themeMetadata) missing.push('theme-metadata.js');
                    if (!modules.editorDraft) missing.push('editor-draft.js');
                    if (!modules.themePairs) missing.push('theme-pairs.js');
                    if (!modules.themeSeries) missing.push('theme-series.js');
                    if (!modules.themeBindings) missing.push('theme-bindings.js');
                    if (!modules.themeAppearance) missing.push('theme-appearance.js');
                    if (!modules.createBackgrounds) missing.push('backgrounds.js');
                    if (!modules.createUiSheets) missing.push('ui-sheets.js');
                    if (!modules.createUiEvents) missing.push('ui-events.js');
                    supportErrorText = missing.length ? ('模块未注册：' + missing.join('、')) : '支持模块初始化失败';
                }
                console.error('[美化管理] 支持模块初始化失败:', supportErrorText);
                updateBtn();
                return;
            }
            themeSchema = modules.themeSchema;
            themeApi = modules.createThemeApi({ schema: themeSchema });
            themeRuntime = modules.createThemeRuntime({ schema: themeSchema, api: themeApi });
            themeTransactions = modules.createThemeTransactions({
                schema: themeSchema,
                api: themeApi,
                runtime: themeRuntime,
            });
            themeTransfer = modules.createThemeTransfer({
                schema: themeSchema,
                runtime: themeRuntime,
                transactions: themeTransactions,
                metadata: modules.themeMetadata,
            });
            metadataApi = modules.themeMetadata;
            editorDraftApi = modules.editorDraft;
            pairsApi = modules.themePairs;
            seriesApi = modules.themeSeries;
            bindingsApi = modules.themeBindings;
            bindingController = bindingsApi.createController({
                load: load,
                save: save,
                getContext: function () {
                    try {
                        return global.SillyTavern && typeof global.SillyTavern.getContext === 'function'
                            ? global.SillyTavern.getContext()
                            : {};
                    } catch (e) {
                        return {};
                    }
                },
                getCurrentThemeName: getCurrentThemeName,
                makeTargetForTheme: function (themeName) {
                    return pairsApi.targetForTheme(load(), themeName);
                },
                resolveTargetTheme: function (target) {
                    return resolveLogicalTargetTheme(target);
                },
                beforeAutomaticReconcile: function () {
                    clearTemporaryPairOverride();
                },
                applyTheme: applyTheme,
                cancelApply: function () {
                    if (themeRuntime) themeRuntime.beginApply();
                },
                onApplied: function () {
                    lastBindingWarningKey = '';
                    updateActiveCardState(getCurrentThemeName());
                    renderBottomStatus();
                    updateBtn();
                },
                onError: handleBindingApplyError,
            });
            appearanceApi = modules.themeAppearance;
            uiSheetsApi = modules.createUiSheets({
                getPopupLayer: getPopupLayer,
                load: load,
                esc: esc,
            });
            backgroundsApi = modules.createBackgrounds({
                load: load,
                save: save,
                getPostHeaders: getPostHeaders,
                esc: esc,
                createSheet: createSheet,
                closeSheet: closeSheet,
                toast: toast,
                renderGrid: renderGrid,
                setControlValue: setControlValue,
                themeRuntime: themeRuntime,
            });
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
    function invalidateLibraryView() {
        metadataRevision += 1;
        libraryViewCache = null;
    }
    function save(d) {
        invalidateLibraryView();
        return storageApi.save(d);
    }
    function saveToDB(d, cb) { storageApi.saveToDB(d, cb); }
    function loadFromLS() { return storageApi.loadFromLS(); }
    function initStorage(cb) { storageApi.initStorage(cb); }
    function whenStorageReady() {
        return storageApi && typeof storageApi.whenReady === 'function'
            ? storageApi.whenReady()
            : Promise.reject(new Error('Theme Manager storage is unavailable'));
    }
    function isStorageReady() {
        return !!(storageApi && typeof storageApi.isReady === 'function' && storageApi.isReady());
    }
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
    //   dayNight: { pairs: { id: { name, dayTheme, nightTheme, meta } } },
    //   series: { groups: { id: { name, category, members[] } } },
    //   bindings: { characters, chats, manualTarget },
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
        if (typeof d.followThemeAppearance !== 'boolean') d.followThemeAppearance = false;
        if (typeof d.showThemeAvatarFrame !== 'boolean') d.showThemeAvatarFrame = false;
        if (typeof d.followThemePreviewShape !== 'boolean') d.followThemePreviewShape = false;
        if (typeof d.simplifyGridText !== 'boolean') d.simplifyGridText = false;
        if (typeof d.autoHideHeader !== 'boolean') d.autoHideHeader = false;
        var pairNormalizationDiagnostics = pairsApi && typeof pairsApi.inspectState === 'function' ? pairsApi.inspectState(d) : [];
        var seriesNormalizationDiagnostics = seriesApi && typeof seriesApi.inspectState === 'function' ? seriesApi.inspectState(d) : [];
        if (pairNormalizationDiagnostics.length || seriesNormalizationDiagnostics.length) {
            console.warn('[美化管理] 关系数据规范化将拒绝无效或冲突记录:', {
                pairs: pairNormalizationDiagnostics,
                series: seriesNormalizationDiagnostics,
            });
        }
        if (pairsApi) pairsApi.ensureState(d);
        else if (!d.dayNight || typeof d.dayNight !== 'object') d.dayNight = { version: 1, pairs: {} };
        if (seriesApi) seriesApi.ensureState(d);
        else if (!d.series || typeof d.series !== 'object') d.series = { version: 1, groups: {} };
        if (bindingsApi) bindingsApi.ensureState(d);
        else if (!d.bindings || typeof d.bindings !== 'object') d.bindings = { version: 2, characters: {}, chats: {}, manualTheme: '', manualTarget: null };
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
            sortMode: 'name',
            followThemeAppearance: false,
            showThemeAvatarFrame: false,
            followThemePreviewShape: false,
            simplifyGridText: false,
            autoHideHeader: false,
            dayNight: { version: 1, pairs: {} },
            series: { version: 1, groups: {} },
            bindings: { version: 2, characters: {}, chats: {}, manualTheme: '', manualTarget: null }
        };
    }

    function peekMeta(d, name) {
        return metadataApi.peekMeta(d, name);
    }

    function ensureMeta(d, name) {
        return metadataApi.ensureMeta(d, name);
    }

    function getSystemDayNightVariant() {
        if (colorSchemeWatcher) return colorSchemeWatcher.getVariant();
        try {
            return typeof global.matchMedia === 'function' &&
                global.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'night'
                : 'day';
        } catch (e) {
            return 'day';
        }
    }

    function getPreferredPairVariant(pairId) {
        if (temporaryPairOverride && temporaryPairOverride.pairId === pairId) {
            return temporaryPairOverride.variant;
        }
        return getSystemDayNightVariant();
    }

    function clearTemporaryPairOverride() {
        temporaryPairOverride = null;
    }

    function setTemporaryPairOverride(pairId, variant) {
        temporaryPairOverride = {
            pairId: String(pairId || ''),
            variant: variant === 'night' ? 'night' : 'day',
        };
    }

    function resolveLogicalTargetTheme(target) {
        if (!pairsApi) return bindingsApi ? bindingsApi.getThemeName(target) : '';
        var variant = target && target.kind === 'day-night'
            ? getPreferredPairVariant(target.pairId)
            : getSystemDayNightVariant();
        return pairsApi.resolveTargetTheme(load(), target, variant);
    }

    function bindColorSchemeListener() {
        if (colorSchemeWatcher || !pairsApi || typeof pairsApi.createColorSchemeWatcher !== 'function') return;
        colorSchemeWatcher = pairsApi.createColorSchemeWatcher({
            matchMedia: typeof global.matchMedia === 'function'
                ? function (query) { return global.matchMedia(query); }
                : null,
            document: global.document,
            window: global,
            intervalMs: 1000,
            onChange: function () {
                clearTemporaryPairOverride();
                if (bindingController) bindingController.reconcile();
                renderGrid();
                renderBottomStatus();
            },
        });
        colorSchemeWatcher.start();
    }

    function buildLogicalItemsRaw(d) {
        return pairsApi
            ? pairsApi.buildLogicalItems(d, stThemeList)
            : stThemeList.map(function (name) {
                return { key: 'theme:' + name, kind: 'theme', name: name, themeName: name, themeNames: [name], meta: d.themeMeta[name] || {} };
            });
    }

    function setThemeList(list, reliable) {
        stThemeList = Array.isArray(list) ? list : [];
        stThemeListReliable = reliable === true;
        themeListRevision += 1;
        libraryViewCache = null;
    }

    function buildLibraryView(d) {
        d = d || load();
        if (libraryViewCache && libraryViewCache.data === d &&
            libraryViewCache.themeListRevision === themeListRevision &&
            libraryViewCache.metadataRevision === metadataRevision) {
            return libraryViewCache;
        }

        var items = buildLogicalItemsRaw(d);
        var itemByKey = Object.create(null);
        var itemByRef = Object.create(null);
        var itemByThemeName = Object.create(null);
        var metaByKey = Object.create(null);
        var searchTextByKey = Object.create(null);
        var themeNameSet = new Set(stThemeList);
        var pairByThemeName = Object.create(null);
        var pairById = Object.create(null);

        items.forEach(function (item) {
            var meta = item.kind === 'pair' ? (item.meta || {}) : peekMeta(d, item.themeName);
            item.meta = meta;
            itemByKey[item.key] = item;
            itemByRef[item.key] = item;
            metaByKey[item.key] = meta;
            if (item.kind === 'pair') {
                pairById[item.pairId] = item;
                itemByRef[item.pairId] = item;
            } else {
                itemByRef[item.themeName] = item;
            }
            (item.themeNames || []).forEach(function (themeName) {
                if (!themeName) return;
                itemByThemeName[themeName] = item;
                itemByRef[themeName] = item;
                if (item.kind === 'pair') pairByThemeName[themeName] = item;
            });
            var searchParts = [item.name].concat(item.themeNames || []);
            if (meta.author) searchParts.push(meta.author);
            if (Array.isArray(meta.tags)) searchParts = searchParts.concat(meta.tags);
            if (meta.description) searchParts.push(meta.description);
            searchTextByKey[item.key] = searchParts.map(function (value) {
                return String(value || '').toLowerCase();
            }).join('\n');
        });

        var seriesGroups = Object.create(null);
        var seriesMembership = Object.create(null);
        if (seriesApi) {
            seriesApi.listSeries(d).forEach(function (group) {
                seriesGroups[group.id] = group;
                (group.members || []).forEach(function (member) {
                    var key = seriesApi.targetKey(member);
                    if (key) seriesMembership[key] = group.id;
                });
            });
        }

        libraryViewCache = {
            data: d,
            themeListRevision: themeListRevision,
            metadataRevision: metadataRevision,
            items: items,
            itemByKey: itemByKey,
            itemByRef: itemByRef,
            itemByThemeName: itemByThemeName,
            metaByKey: metaByKey,
            searchTextByKey: searchTextByKey,
            themeNameSet: themeNameSet,
            pairByThemeName: pairByThemeName,
            pairById: pairById,
            seriesGroups: seriesGroups,
            seriesMembership: seriesMembership,
            sortedByMode: Object.create(null),
        };
        return libraryViewCache;
    }

    function getLogicalItems(d) {
        return buildLibraryView(d).items;
    }

    function getLogicalItem(ref, d) {
        d = d || load();
        return buildLibraryView(d).itemByRef[String(ref || '').trim()] || null;
    }

    function getItemMeta(d, item) {
        if (!item) return {};
        var view = buildLibraryView(d);
        return view.metaByKey[item.key] || item.meta || {};
    }

    function getItemMetaForWrite(d, item) {
        if (!item) return null;
        if (item.kind === 'pair') {
            var pair = pairsApi.getPair(d, item.pairId);
            return pair ? pair.meta : null;
        }
        return ensureMeta(d, item.themeName);
    }

    function getItemDisplayTheme(d, item, variant) {
        if (!item) return '';
        if (item.kind !== 'pair') return item.themeName;
        return (variant || getPreferredPairVariant(item.pairId)) === 'night'
            ? item.nightTheme
            : item.dayTheme;
    }

    function getCurrentLogicalItem(d) {
        d = d || load();
        return getLogicalItem(getCurrentThemeName(), d);
    }

    function isItemActive(item, currentTheme) {
        return !!item && item.themeNames.indexOf(currentTheme) !== -1;
    }

    function getItemTarget(item) {
        return pairsApi
            ? pairsApi.targetForItem(item)
            : bindingsApi.makeThemeTarget(item && item.themeName);
    }

    function expandItemThemeNames(items) {
        var names = [];
        var seen = new Set();
        (items || []).forEach(function (item) {
            (item.themeNames || []).forEach(function (name) {
                if (name && !seen.has(name)) { seen.add(name); names.push(name); }
            });
        });
        return names;
    }

    function getSeriesForItem(d, item) {
        if (!seriesApi || !item) return null;
        var view = buildLibraryView(d);
        var key = item.kind === 'pair' ? ('pair:' + item.pairId) : ('theme:' + item.themeName);
        var seriesId = view.seriesMembership[key];
        return seriesId ? (view.seriesGroups[seriesId] || null) : null;
    }

    function displayCategoryMatches(category, cat) {
        category = typeof category === 'string' ? category : '';
        if (cat === '__all__') return true;
        if (cat === '__uncategorized__') return !category;
        return category === cat;
    }

    function getItemsForDisplayCategory(d, cat) {
        return getLogicalItems(d).filter(function (item) {
            var group = getSeriesForItem(d, item);
            var category = group ? group.category : getItemMeta(d, item).category;
            return displayCategoryMatches(category, cat);
        });
    }

    function itemMatchesSearch(d, item, query, view) {
        if (!query) return true;
        var q = String(query).toLowerCase();
        view = view || buildLibraryView(d);
        return (view.searchTextByKey[item.key] || '').indexOf(q) !== -1;
    }

    function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

    // ── ST 主题列表获取（多策略）──────────────────────────────
    function fetchThemeList(cb) {
        var found = false;

        function done(list, method, reliable) {
            if (found) return;
            found = true;
            setThemeList(list, reliable);
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
                    if (names.length > 0) { done(names, 'SELECT#themes', true); return; }
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
                            if (names2.length > 0) { done(names2, 'INPUT#themes+datalist', true); return; }
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
                    if (items.length > 5) done(items, 'datalist#' + (dl.id || ''), false);
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
                    if (Array.isArray(data) && data.length > 0) done(data, 'fetch ' + path, false);
                    else if (typeof data === 'object' && !Array.isArray(data)) {
                        var keys = Object.keys(data);
                        if (keys.length > 0) done(keys, 'fetch ' + path, false);
                    }
                })
                .catch(function () {})
                .finally(function () {
                    apiDone++;
                    if (apiDone >= apiPaths.length && !found) {
                        setThemeList([], false);
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
        return backgroundsApi.getBackgroundCssUrl(backgroundName);
    }

    function getBackgroundList(cb, force) {
        backgroundsApi.getBackgroundList(cb, force);
    }

    function normalizeBackgroundRename(oldName, rawName) {
        return backgroundsApi.normalizeBackgroundRename(oldName, rawName);
    }

    function renameBackgroundOnServer(oldName, newName, cb) {
        backgroundsApi.renameBackgroundOnServer(oldName, newName, cb);
    }

    function buildBackgroundBindHtml(backgroundName) {
        return backgroundsApi.buildBackgroundBindHtml(backgroundName);
    }

    function openBackgroundPickerSheet(selectedName, onPick) {
        return backgroundsApi.openBackgroundPickerSheet(selectedName, onPick);
    }

    function applyBoundBackground(themeName, cb, isCurrent) {
        return backgroundsApi.applyBoundBackground(themeName, cb, isCurrent);
    }

    function finishApplyTheme(themeName, cb, ok, requestId) {
        return backgroundsApi.finishApplyTheme(themeName, function (backgroundOk, reason) {
            scheduleManagerAppearanceSync();
            if (cb) cb(backgroundOk, reason);
        }, ok, requestId);
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
            var customCssInput = document.getElementById('customCSS');
            setControlValue('#customCSS', theme.custom_css);
            var style = document.getElementById('custom-style');
            if (!style) {
                style = document.createElement('style');
                style.setAttribute('type', 'text/css');
                style.setAttribute('id', 'custom-style');
                document.head.appendChild(style);
            }
            style.innerHTML = theme.custom_css;
            // The fallback path does not run ST's private applyTheme(). Notify
            // native/third-party editors after both the source and style agree.
            if (customCssInput && typeof customCssInput.dispatchEvent === 'function') {
                customCssInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
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

    // 原生 ST 没有暴露主题数组刷新能力时，仅对已验证的可用主题兜底。
    function applyUsableNativeThemeFallback(theme, cb) {
        if (!isUsableThemeObject(theme, theme && theme.name)) { if (cb) cb(false); return; }
        setThemeControlValue(theme.name);
        Promise.all([
            import('/scripts/power-user.js'),
            import('/script.js').catch(function () { return null; }),
        ])
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

    function hydrateVerifiedNativeTheme(theme) {
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

    function bindVerifiedThemeSelectSync() {
        if (verifiedThemeSelectSyncBound) return;
        verifiedThemeSelectSyncBound = true;
        document.addEventListener('change', function (e) {
            if (!e.target || e.target.id !== 'themes') return;
            var name = getThemeNameFromControl(e.target);
            if (bindingController && name && !pendingVerifiedManualThemes[name] && !bindingController.isAutomatedThemeChange(name)) {
                bindingController.recordManualTheme(name);
            }
            var verifiedTheme = name ? themeRuntime.getCached(name) : null;
            if (!verifiedTheme || hydrateVerifiedNativeTheme(verifiedTheme)) return;
            applyUsableNativeThemeFallback(verifiedTheme, function (ok) {
                if (ok) {
                    applyBoundBackground(name, function () {
                        scheduleManagerAppearanceSync();
                        updateActiveCardState(name); renderBottomStatus();
                    });
                }
            });
        }, true);
    }

    function isPlainThemeObject(theme) { return themeSchema.isPlainObject(theme); }
    function isUsableThemeObject(theme, expectedName) { return themeSchema.isUsableTheme(theme, expectedName); }

    function cloneThemeValue(value) { return themeSchema.cloneValue(value); }

    function getPostHeaders() {
        return themeApi.getPostHeaders();
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
        var changed = false;
        if (dd.themeMeta[oldName]) {
            dd.themeMeta[newName] = dd.themeMeta[oldName];
            delete dd.themeMeta[oldName];
            changed = true;
        }
        if (pairsApi && pairsApi.renameThemeReferences(dd, oldName, newName) > 0) changed = true;
        if (seriesApi && seriesApi.renameThemeReferences(dd, oldName, newName) > 0) changed = true;
        if (bindingsApi && bindingsApi.renameThemeReferences(dd, oldName, newName) > 0) changed = true;
        if (changed) save(dd);
    }

    function cleanupRemovedThemeData(dd, themeNames) {
        themeNames = Array.isArray(themeNames) ? themeNames : [themeNames];
        var changed = false;
        var migrations = pairsApi ? pairsApi.removeThemeReferences(dd, themeNames) : [];
        migrations.forEach(function (migration) {
            if (seriesApi) {
                var seriesMigration = seriesApi.replacePairReference(
                    dd,
                    migration.pairId,
                    migration.replacementTheme ? [migration.replacementTheme] : []
                );
                if (seriesMigration && !seriesMigration.ok) {
                    seriesMigration = seriesApi.replacePairReference(dd, migration.pairId, []);
                }
                if (seriesMigration && seriesMigration.changed) changed = true;
            }
            if (bindingsApi && bindingsApi.replacePairReferences(dd, migration.pairId, migration.replacementTheme) > 0) {
                changed = true;
            }
            changed = true;
        });
        themeNames.forEach(function (themeName) {
            if (dd.themeMeta[themeName]) {
                delete dd.themeMeta[themeName];
                changed = true;
            }
            if (bindingsApi && bindingsApi.removeThemeReferences(dd, themeName) > 0) changed = true;
        });
        if (seriesApi && seriesApi.removeThemeReferences(dd, themeNames) > 0) changed = true;
        return changed;
    }

    function removeThemeMetaName(themeName) {
        var dd = load();
        if (cleanupRemovedThemeData(dd, [themeName])) save(dd);
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

        var wasCurrent = getCurrentThemeName() === oldName;

        themeTransactions.renameTheme(oldName, newName, {
            extraNames: stThemeList.slice(),
            extraNamesComplete: stThemeListReliable,
        })
            .then(function (result) {
                themeRuntime.forget(oldName);
                themeRuntime.remember(result.theme);
                themeRuntime.replaceNativeTheme(oldName, result.theme, result.nativeThemeRef);
                migrateThemeMetaName(oldName, newName);

                return syncCurrentThemeRenameState(oldName, newName, wasCurrent)
                    .then(function () { return result.themes; });
            })
            .then(function (themes) {
                if (themes) {
                    setThemeList(themes.filter(function (theme) { return theme && theme.name; }).map(function (theme) { return theme.name; }), true);
                } else {
                    var renamedList = stThemeList.filter(function (name) { return name !== oldName && name !== newName; });
                    renamedList.push(newName);
                    setThemeList(renamedList, false);
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
                if (cb) cb(false, reason);
            });
    }

    function deleteThemeEverywhere(themeName, cb) {
        themeTransactions.deleteThemeVerified(themeName, {
            deleteReason: 'theme-manager-delete',
            verifyReason: 'theme-manager-delete-verify',
        })
            .then(function (result) {
                var wasCurrent = getCurrentThemeName() === themeName;
                themeRuntime.forget(themeName);
                themeRuntime.evictNativeTheme(themeName, result.nativeThemeRef);
                removeThemeMetaName(themeName);
                removeThemeOption(themeName);
                setThemeList(result.themes.filter(function (theme) { return theme && theme.name; }).map(function (theme) { return theme.name; }), true);
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

    function deleteThemesEverywhere(themeNames, cb) {
        themeTransactions.deleteThemesVerified(themeNames, {
            readReason: 'theme-manager-delete-batch-read',
            deleteReason: 'theme-manager-delete-batch',
            verifyReason: 'theme-manager-delete-batch-verify',
        })
            .then(function (result) {
                var removed = result.results.filter(function (item) { return item.ok; });
                var failed = result.results.filter(function (item) { return !item.ok; });
                var dd = load();
                var removedNames = removed.map(function (item) { return item.name; });
                var metaChanged = cleanupRemovedThemeData(dd, removedNames);

                removed.forEach(function (item) {
                    themeRuntime.evictNativeTheme(item.name, item.nativeThemeRef);
                    removeThemeOption(item.name);
                });
                if (metaChanged) save(dd);

                setThemeList(result.themes
                    .filter(function (theme) { return theme && theme.name; })
                    .map(function (theme) { return theme.name; }), true);
                renderCatbar();
                renderGrid();
                renderBottomStatus();
                updateBtn();
                if (cb) cb(true, { removed: removed, failed: failed, result: result });
            })
            .catch(function (err) {
                console.warn('[美化管理] 批量删除美化失败:', err);
                if (cb) cb(false, { error: err, removed: [], failed: [] });
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
            var pair = pairsApi ? pairsApi.findPairByTheme(d, theme.name) : null;
            if (pair) clean = Object.assign(clean, cleanThemeMetaForBundle(pair.meta));
            if (Object.keys(clean).length > 0) meta[theme.name] = clean;
        });
        return meta;
    }

    function reportExportWarnings(prepared) {
        var diagnostics = prepared && prepared.diagnostics;
        if (!diagnostics) return;
        var warningCount = (diagnostics.sameConfigGroups || []).length +
            (diagnostics.orphanMetadata || []).length +
            (diagnostics.emptyMetadata || []).length +
            (diagnostics.inventoryWithoutMetadata || []).length;
        if (warningCount > 0) console.warn('[美化管理] 导出前只读诊断（不阻止导出、不删除数据）:', diagnostics);
    }

    function buildSeriesManifestForBundle(data, themes, exportedPairs) {
        if (!seriesApi) return { version: 1, groups: [] };
        return {
            version: 1,
            groups: seriesApi.exportSeries(
                data,
                (themes || []).map(function (theme) { return theme.name; }),
                (exportedPairs || []).map(function (pair) { return pair.id; })
            ),
        };
    }

    function countSeriesForItems(data, items) {
        if (!seriesApi) return 0;
        var ids = {};
        (items || []).forEach(function (item) {
            var group = getSeriesForItem(data, item);
            if (group) ids[group.id] = true;
        });
        return Object.keys(ids).length;
    }

    function extractThemeObjects(parsed, sourceName) {
        var raw = [];
        if (parsed && Array.isArray(parsed.themes)) raw = parsed.themes;
        else if (Array.isArray(parsed)) raw = parsed;
        else if (parsed && parsed.name) raw = [parsed];
        else throw new Error(sourceName + ' 缺少 name 或 themes 字段');

        return raw.map(function (input, idx) {
            var theme = cloneThemeValue(input);
            if (!isPlainThemeObject(theme) || !theme.name || !String(theme.name).trim()) {
                throw new Error(sourceName + ' 第 ' + (idx + 1) + ' 个主题缺少 name 或不是普通对象');
            }
            theme.name = String(theme.name).trim();
            return theme;
        });
    }

    function extractThemeImportPayload(parsed, sourceName) {
        var themes = extractThemeObjects(parsed, sourceName);
        var metaSrc = {};
        var cats = [];
        var dayNightPairs = [];
        var seriesGroups = [];

        if (parsed && parsed.themeMeta && typeof parsed.themeMeta === 'object') metaSrc = parsed.themeMeta;
        else if (parsed && parsed.meta && parsed.meta.themeMeta && typeof parsed.meta.themeMeta === 'object') metaSrc = parsed.meta.themeMeta;

        if (parsed && Array.isArray(parsed.categories)) cats = parsed.categories.slice();
        else if (parsed && parsed.meta && Array.isArray(parsed.meta.categories)) cats = parsed.meta.categories.slice();
        if (parsed && Array.isArray(parsed.dayNightPairs)) dayNightPairs = parsed.dayNightPairs.slice();
        else if (parsed && parsed.dayNight && parsed.dayNight.pairs) {
            var rawPairs = parsed.dayNight.pairs;
            dayNightPairs = Array.isArray(rawPairs)
                ? rawPairs.slice()
                : Object.keys(rawPairs).map(function (id) {
                    var pair = cloneJson(rawPairs[id]);
                    if (pair && !pair.id) pair.id = id;
                    return pair;
                });
        }
        if (parsed && parsed.seriesManifest) {
            var manifest = parsed.seriesManifest;
            if (Array.isArray(manifest)) seriesGroups = manifest.slice();
            else if (Array.isArray(manifest.groups)) seriesGroups = manifest.groups.slice();
            else if (Array.isArray(manifest.series)) seriesGroups = manifest.series.slice();
        }

        var metaByName = {};
        themes.forEach(function (theme) {
            var m = metaSrc[theme.name];
            if (m) metaByName[theme.name] = cleanThemeMetaForBundle(m);
        });

        return {
            themes: themes,
            themeMeta: metaByName,
            categories: cats,
            dayNightPairs: dayNightPairs,
            seriesGroups: seriesGroups,
            sourceName: sourceName,
        };
    }

    function mergeThemePayload(target, payload) {
        payload.themes.forEach(function (theme) { target.themes.push(theme); });
        for (var name in payload.themeMeta) target.themeMeta[name] = payload.themeMeta[name];
        payload.categories.forEach(function (cat) {
            if (cat && target.categories.indexOf(cat) === -1) target.categories.push(cat);
        });
        if (!Array.isArray(target.dayNightPairs)) target.dayNightPairs = [];
        (payload.dayNightPairs || []).forEach(function (pair) { target.dayNightPairs.push(pair); });
        if (!Array.isArray(target.seriesGroups)) target.seriesGroups = [];
        (payload.seriesGroups || []).forEach(function (group) { target.seriesGroups.push(group); });
        return target;
    }

    function getPayloadThemeCategory(payload, themeName) {
        var category = payload.themeMeta[themeName] && payload.themeMeta[themeName].category
            ? String(payload.themeMeta[themeName].category)
            : '';
        var pairById = {};
        (payload.dayNightPairs || []).forEach(function (pair) {
            if (pair && pair.id) pairById[String(pair.id)] = pair;
        });
        (payload.seriesGroups || []).some(function (group) {
            if (!group || !Array.isArray(group.members)) return false;
            var contains = group.members.some(function (member) {
                if (!member || typeof member !== 'object') return false;
                if (member.kind === 'theme') return String(member.themeName || '') === themeName;
                if (member.kind !== 'day-night') return false;
                var pair = pairById[String(member.pairId || '')];
                return !!pair && (pair.dayTheme === themeName || pair.nightTheme === themeName);
            });
            if (!contains) return false;
            category = typeof group.category === 'string' ? group.category : '';
            return true;
        });
        return category;
    }

    function filterImportedSeriesGroups(groups, selectedThemeNames, selectedPairIds, forcedCategory) {
        var themes = {};
        var pairs = {};
        (selectedThemeNames || []).forEach(function (name) { themes[name] = true; });
        (selectedPairIds || []).forEach(function (id) { pairs[id] = true; });
        return (groups || []).map(function (raw) {
            if (!raw || !Array.isArray(raw.members) || raw.members.length < 2) return null;
            var complete = raw.members.every(function (member) {
                if (!member || typeof member !== 'object') return false;
                if (member.kind === 'theme') return !!themes[member.themeName];
                if (member.kind === 'day-night') return !!pairs[member.pairId];
                return false;
            });
            if (!complete) return null;
            var copy = cloneJson(raw);
            if (forcedCategory !== null && forcedCategory !== undefined) copy.category = forcedCategory;
            return copy;
        }).filter(Boolean);
    }

    function countPartiallySelectedSeriesGroups(groups, selectedThemeNames, selectedPairIds) {
        var themes = {};
        var pairs = {};
        (selectedThemeNames || []).forEach(function (name) { themes[name] = true; });
        (selectedPairIds || []).forEach(function (id) { pairs[id] = true; });
        return (groups || []).filter(function (group) {
            if (!group || !Array.isArray(group.members) || group.members.length < 2) return false;
            var matched = group.members.filter(function (member) {
                if (!member || typeof member !== 'object') return false;
                return member.kind === 'theme' ? !!themes[member.themeName] :
                    (member.kind === 'day-night' ? !!pairs[member.pairId] : false);
            }).length;
            return matched > 0 && matched < group.members.length;
        }).length;
    }

    function collectSelectionRelationshipDiagnostics(payload, selectedThemeNames, selectedPairIds) {
        var themes = {};
        var pairIds = {};
        (selectedThemeNames || []).forEach(function (name) { themes[name] = true; });
        (selectedPairIds || []).forEach(function (id) { pairIds[id] = true; });
        var diagnostics = [];
        (payload.dayNightPairs || []).forEach(function (pair) {
            if (!pair) return;
            var selectedMembers = [pair.dayTheme, pair.nightTheme].filter(function (name) { return !!themes[name]; });
            if (selectedMembers.length === 1) diagnostics.push({
                type: 'pair', id: pair.id || '', name: pair.name || '', reason: 'partial-selection',
                members: [pair.dayTheme, pair.nightTheme].filter(function (name) { return !themes[name]; }),
            });
        });
        (payload.seriesGroups || []).forEach(function (group) {
            if (!group || !Array.isArray(group.members)) return;
            var selectedCount = group.members.filter(function (member) {
                return member && (member.kind === 'theme' ? themes[member.themeName] : pairIds[member.pairId]);
            }).length;
            if (selectedCount > 0 && selectedCount < group.members.length) diagnostics.push({
                type: 'series', id: group.id || '', name: group.name || '', category: group.category || '',
                reason: 'partial-selection', members: cloneJson(group.members),
            });
        });
        return diagnostics;
    }

    function mergeImportedThemeMeta(themeNames, metaByName, categories, forceCategory) {
        if ((!metaByName || Object.keys(metaByName).length === 0) && (!categories || categories.length === 0)) return;
        var dd = load();
        metadataApi.mergeImported(dd, themeNames, metaByName, categories, {
            forceCategory: forceCategory,
            mergePreview: function (existing, incoming) {
                imageToolsApi.mergeMissingPreview(existing, incoming);
            },
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
        (payload.seriesGroups || []).forEach(function (group) {
            if (group && group.category) addCat(String(group.category));
        });
        payload.themes.forEach(function (theme) {
            var cat = getPayloadThemeCategory(payload, theme.name);
            if (cat) {
                addCat(cat);
                counts[cat] = (counts[cat] || 0) + 1;
            } else {
                uncatCount++;
            }
        });
        return { categories: order, counts: counts, uncatCount: uncatCount };
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
                var cat = getPayloadThemeCategory(payload, theme.name);
                var shouldImport = info.categories.length === 0 || (cat && selected[cat]) || (!cat && includeUncat);
                if (shouldImport) {
                    selectedThemes.push(theme);
                    selectedMeta[theme.name] = payload.themeMeta[theme.name] ? Object.assign({}, payload.themeMeta[theme.name]) : {};
                    if (targetCat !== '__keep__') selectedMeta[theme.name].category = targetCat;
                }
            });
            if (selectedThemes.length === 0) { toast('请至少选择一个分类', true); return; }
            var selectedThemeNames = selectedThemes.map(function (theme) { return theme.name; });
            var selectedPairs = (payload.dayNightPairs || []).filter(function (pair) {
                return pair && selectedThemeNames.indexOf(pair.dayTheme) !== -1 && selectedThemeNames.indexOf(pair.nightTheme) !== -1;
            });
            var selectedPairIds = selectedPairs.map(function (pair) { return pair.id; });
            var selectionRelationshipDiagnostics = collectSelectionRelationshipDiagnostics(payload, selectedThemeNames, selectedPairIds);
            var selectedSeriesGroups = filterImportedSeriesGroups(
                payload.seriesGroups,
                selectedThemeNames,
                selectedPairIds,
                targetCat === '__keep__' ? null : targetCat
            );
            closeSheet(sheet);
            importThemeObjects(selectedThemes, {
                failText: opts.failText,
                metaByName: selectedMeta,
                categories: targetCat === '__keep__' ? selectedCats : (targetCat ? [targetCat] : []),
                forceCategory: targetCat !== '__keep__',
                dayNightPairs: selectedPairs,
                seriesGroups: selectedSeriesGroups,
                skippedSeriesGroups: countPartiallySelectedSeriesGroups(payload.seriesGroups, selectedThemeNames, selectedPairIds),
                relationshipDiagnostics: selectionRelationshipDiagnostics,
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

        var validation = themeTransfer.validateImportThemes(finalThemes);
        if (validation.invalid.length > 0) {
            var invalidNames = validation.invalid.map(function (item) { return item.name; });
            console.warn('[美化管理] 已拒绝不安全的导入主题:', validation.invalid);
            toast('导入已中止，不完整或不安全主题：' + invalidNames.join('、'), true);
            return;
        }

        var importThemes = finalThemes.filter(function (theme) { return typeof theme.custom_css === 'string' && /@import/i.test(theme.custom_css); });
        if (importThemes.length > 0 && !confirm('检测到 ' + importThemes.length + ' 个美化的 custom_css 中包含 @import。\n导入外部样式可能带来加载失败或安全风险，仍要继续吗？')) return;

        var existing = finalThemes.filter(function (theme) { return stThemeList.indexOf(theme.name) !== -1; });
        if (existing.length > 0 && !confirm('检测到 ' + existing.length + ' 个同名美化，继续导入将覆盖已有主题。是否继续？')) return;

        themeTransfer.importVerified(finalThemes)
            .then(function (outcome) {
                var results = outcome.results || [];
                var successful = results.filter(function (res) { return res.ok; });
                var failed = results.filter(function (res) { return !res.ok; });

                if (Array.isArray(outcome.themes)) {
                    themeRuntime.replaceInventory(outcome.themes);
                    setThemeList(outcome.themes.filter(function (theme) {
                        return theme && typeof theme.name === 'string' && theme.name.trim();
                    }).map(function (theme) { return theme.name; }), true);
                }

                successful.forEach(function (res) {
                    syncThemeOption(res.theme.name);
                });
                var okNames = successful.map(function (res) { return res.theme.name; });
                if (okNames.length > 0) mergeImportedThemeMeta(okNames, opts.metaByName, opts.categories, opts.forceCategory);
                var pairImport = { imported: 0, skipped: 0, idMap: {}, skippedIds: [] };
                var seriesImport = { imported: 0, skipped: 0 };
                var relationData = load();
                var relationThemeNames = Array.isArray(outcome.themes)
                    ? outcome.themes.filter(function (theme) { return theme && theme.name; }).map(function (theme) { return theme.name; })
                    : stThemeList.slice();
                if (pairsApi && opts.dayNightPairs && opts.dayNightPairs.length > 0) {
                    pairImport = pairsApi.importPairs(relationData, opts.dayNightPairs, relationThemeNames);
                }
                if (seriesApi && opts.seriesGroups && opts.seriesGroups.length > 0) {
                    seriesImport = seriesApi.importSeries(relationData, opts.seriesGroups, {
                        availableThemeNames: relationThemeNames,
                        availablePairIds: Object.keys(pairsApi.ensureState(relationData).pairs),
                        pairIdMap: pairImport.idMap || {},
                        skippedPairIds: pairImport.skippedIds || [],
                        requirePairIdMap: true,
                    });
                }
                if (pairImport.imported > 0 || seriesImport.imported > 0) save(relationData);
                var relationshipDiagnostics = (pairImport.diagnostics || []).concat(seriesImport.diagnostics || []);
                relationshipDiagnostics = (opts.relationshipDiagnostics || []).concat(relationshipDiagnostics);
                var rejectedRelationshipDiagnostics = relationshipDiagnostics.filter(function (item) { return item.severity !== 'info'; });
                if (relationshipDiagnostics.length > 0) {
                    console.warn('[美化管理] 导入关系诊断:', relationshipDiagnostics);
                }
                var skippedSeriesCount = (opts.skippedSeriesGroups || 0) + (seriesImport.skipped || 0);
                var seriesImportText = (seriesImport.imported ? '，恢复 ' + seriesImport.imported + ' 个系列' : '') +
                    (skippedSeriesCount ? '；' + skippedSeriesCount + ' 个系列未新增' : '') +
                    (rejectedRelationshipDiagnostics.length ? '；关系诊断 ' + rejectedRelationshipDiagnostics.length + ' 项（详情见控制台）' : '');

                if (outcome.legacyPartials && outcome.legacyPartials.length > 0) {
                    console.info('[美化管理] 旧版部分主题已使用同一份固定 baseline 按 SillyTavern 语义补齐:', outcome.legacyPartials);
                }
                if (failed.length > 0) console.warn('[美化管理] 批量导入失败项（已恢复覆盖前主题）:', failed);

                renderCatbar(); renderGrid(); renderBottomStatus();
                if (failed.length > 0) {
                    toast('导入完成：成功 ' + successful.length + ' 个；失败并已保护旧主题：' + failed.map(function (res) {
                        return res.theme.name;
                    }).join('、') + seriesImportText, true);
                } else if (successful.length === 1) {
                    toast('✅ 已导入并验证美化：' + successful[0].theme.name + seriesImportText);
                } else {
                    toast('✅ 已导入并验证美化：' + successful.length + ' 个' +
                        (pairImport.imported ? '，恢复 ' + pairImport.imported + ' 组日夜美化' : '') +
                        seriesImportText);
                }
            })
            .catch(function (err) {
                console.warn('[美化管理] 导入美化失败:', err);
                var names = err && Array.isArray(err.details) ? err.details.map(function (item) { return item.name; }).join('、') : '';
                toast((opts.failText || '导入美化失败') + (names ? '：' + names : '：' + err.message), true);
            });
    }

    function applyTheme(themeName, cb) {
        themeRuntime.applyThemeAndWait(
            themeName,
            function (prepared, requestId, isCurrent) {
                return applyPreparedNativeTheme(prepared, requestId, isCurrent);
            },
            function (prepared, requestId, isCurrent) {
                return applyVerifiedThemeFallback(prepared.theme, requestId, isCurrent);
            },
            function (prepared, requestId, isCurrent) {
                return applyVerifiedThemeFallback(prepared.theme, requestId, isCurrent);
            }
        )
            .then(function (result) {
                scheduleManagerAppearanceSync();
                if (!result.visualVerification || !result.visualVerification.ok) {
                    console.warn('[ThemeManager] bound background skipped', {
                        requestedTheme: themeName,
                        currentTheme: getCurrentThemeName(),
                        requestId: result.requestId,
                        visualVerification: false,
                        mismatches: result.visualVerification ? result.visualVerification.mismatches : ['unavailable'],
                    });
                    if (cb) cb(true, 'visual-failed');
                    return;
                }
                finishApplyTheme(themeName, cb, true, result.requestId);
            })
            .catch(function (err) {
                console.warn('[美化管理] 切换美化失败:', err);
                if (cb) cb(false, err && err.code ? err.code : 'load-failed');
            });
    }

    function recordManualTheme(themeName) {
        if (bindingController) bindingController.recordManualTheme(themeName);
    }

    function applyManualTheme(themeName, cb) {
        var intentToken = bindingController && typeof bindingController.beginManualIntent === 'function'
            ? bindingController.beginManualIntent(themeName)
            : null;
        pendingVerifiedManualThemes[themeName] = (pendingVerifiedManualThemes[themeName] || 0) + 1;
        applyTheme(themeName, function (ok, reason) {
            pendingVerifiedManualThemes[themeName] -= 1;
            if (pendingVerifiedManualThemes[themeName] <= 0) delete pendingVerifiedManualThemes[themeName];
            if (intentToken && bindingController && typeof bindingController.finishManualIntent === 'function') {
                bindingController.finishManualIntent(intentToken, ok, reason);
            } else if (ok) {
                recordManualTheme(themeName);
            }
            if (cb) cb(ok, reason);
        });
    }

    function handleBindingApplyError(themeName, reason, resolution) {
        if (reason === 'superseded') return;
        var context = resolution && resolution.context ? resolution.context : {};
        var key = [
            resolution && resolution.scope ? resolution.scope : 'manual',
            context.chatKey || context.characterKey || '',
            themeName,
            reason,
        ].join('|');
        if (lastBindingWarningKey === key) return;
        lastBindingWarningKey = key;
        var prefix = resolution && resolution.scope === 'chat'
            ? '当前聊天绑定的'
            : (resolution && resolution.scope === 'character' ? '当前角色绑定的' : '要恢复的全局');
        toast(prefix + '美化「' + themeName + '」暂时无法应用，已保留当前美化', true);
    }

    function applyPreparedNativeTheme(prepared, requestId, isCurrent) {
        if (!isCurrent()) return Promise.reject(themeRuntime.makeError('superseded', '主题切换已被更新请求取代'));
        var themeName = prepared.theme.name;
        var themeEl = document.getElementById('themes');
        if (!themeEl) return Promise.reject(themeRuntime.makeError('apply-failed', '找不到 SillyTavern 原生主题控件'));

        syncThemeOption(themeName);
        if (themeEl.tagName === 'SELECT') {
            var found = false;
            for (var i = 0; i < themeEl.options.length; i++) {
                if (themeEl.options[i].value === themeName || themeEl.options[i].textContent === themeName) {
                    themeEl.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found) return Promise.reject(themeRuntime.makeError('apply-failed', '原生主题列表中找不到目标主题'));
        } else if (themeEl.tagName === 'INPUT') {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            if (setter) setter.call(themeEl, themeName); else themeEl.value = themeName;
        } else {
            return Promise.reject(themeRuntime.makeError('apply-failed', '不支持的原生主题控件'));
        }

        dispatchPreparedNativeThemeChange(themeEl, themeName, prepared.hydrated);
        return Promise.resolve({ native: true });
    }

    function applyVerifiedThemeFallback(theme, requestId, isCurrent) {
        if (!isCurrent()) return Promise.reject(themeRuntime.makeError('superseded', '主题切换已被更新请求取代'));
        return new Promise(function (resolve, reject) {
            applyUsableNativeThemeFallback(theme, function (ok) {
                if (!isCurrent()) { reject(themeRuntime.makeError('superseded', '主题切换已被更新请求取代')); return; }
                if (!ok) { reject(themeRuntime.makeError('apply-failed', '主题兜底应用失败')); return; }
                resolve({ fallback: true, requestId: requestId });
            });
        });
    }

    // ── 图片工具（由 src/image-tools.js 提供实现）──────────────
    function compressImage(dataUrl, cb) {
        imageToolsApi.compressImage(dataUrl, cb, { maxWidth: MAX_IMG_WIDTH, quality: IMG_QUALITY });
    }

    function makeResponsiveThumb(dataUrl, cb) {
        imageToolsApi.makeResponsiveThumb(dataUrl, cb, { maxDimension: 800, quality: IMG_QUALITY });
    }

    function openImageCropSheet(dataUrl, initialCrop, onDone) {
        var img = new Image();
        img.onload = function () {
            var naturalW = img.width;
            var naturalH = img.height;
            var state = imageToolsApi.resolvePreviewView(initialCrop);

            var sheet = createSheet([
                '<div class="tm-sheet-title"><i class="fa-solid fa-up-down-left-right"></i>调整网格显示区域</div>',
                '<div class="tm-hint tm-crop-hint">这里只设置画面重点；网格形状变化时会自然增减边缘内容，不会裁掉原图。</div>',
                '<div class="tm-crop-stage"><canvas id="tm-crop-canvas" width="800" height="600"></canvas></div>',
                '<div class="tm-crop-controls">',
                '<label>缩放 <input type="range" id="tm-crop-zoom" min="1" max="3" step="0.01" value="' + esc(state.zoom) + '" /></label>',
                '<label>横向 <input type="range" id="tm-crop-x" min="0" max="100" step="1" value="' + esc(state.posX) + '" /></label>',
                '<label>纵向 <input type="range" id="tm-crop-y" min="0" max="100" step="1" value="' + esc(state.posY) + '" /></label>',
                '</div>',
                '<div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" id="tm-crop-cancel">取消</button><button class="tm-btn tm-btn-outline" id="tm-crop-reset">居中</button><button class="tm-btn tm-btn-safe" id="tm-crop-ok">使用此显示区域</button></div>',
            ].join(''));

            var canvas = sheet.querySelector('#tm-crop-canvas');
            var ctx = canvas.getContext('2d');
            var zoomInp = sheet.querySelector('#tm-crop-zoom');
            var xInp = sheet.querySelector('#tm-crop-x');
            var yInp = sheet.querySelector('#tm-crop-y');

            function calcView() {
                return imageToolsApi.normalizePreviewView({
                    zoom: zoomInp.value,
                    posX: xInp.value,
                    posY: yInp.value,
                });
            }

            function drawViewToCanvas(view) {
                var baseScale = Math.max(canvas.width / naturalW, canvas.height / naturalH);
                var scale = baseScale * view.zoom;
                var drawW = naturalW * scale;
                var drawH = naturalH * scale;
                var drawX = (canvas.width - drawW) * view.posX / 100;
                var drawY = (canvas.height - drawH) * view.posY / 100;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, drawX, drawY, drawW, drawH);
            }

            function renderCrop() {
                drawViewToCanvas(calcView());
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
                var button = sheet.querySelector('#tm-crop-ok');
                var view = calcView();
                button.disabled = true;
                button.textContent = '处理中...';
                makeResponsiveThumb(dataUrl, function (thumb) {
                    closeSheet(sheet);
                    if (onDone) onDone({ imageData: dataUrl, thumbData: thumb || dataUrl, crop: view });
                });
            });
            renderCrop();
        };
        img.onerror = function () {
            toast('无法读取这张图片，请重新选择', true);
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
    var batchSelected = new Set();
    var batchDeleting = false;
    var searchQuery = '';
    var searchOpen = false;
    var searchComposing = false;
    var searchDebounceTimer = null;
    var sortOpen = false;
    var gridSizeSaveTimer = null;
    var expandedSeriesId = '';
    var seriesScrollPositions = {};
    var seriesResizeBound = false;
    var seriesResizeTimer = null;
    var seriesGridResizeObserver = null;
    var lastSeriesColumnCount = 0;
    var gridRenderGeneration = 0;
    var gridRenderFrame = null;
    var gridRenderState = null;
    var renderedCardsByKey = Object.create(null);
    var renderedActiveItemKey = '';
    var GRID_RENDER_BATCH_SIZE = 48;
    var GRID_RENDER_FOLLOWUP_BATCH_SIZE = 96;
    var SEARCH_DEBOUNCE_MS = 100;

    function getBatchSelectedKeys() {
        return Array.from(batchSelected);
    }

    function sortItems(list, mode, d, view) {
        view = view || buildLibraryView(d);
        if (list === view.items && view.sortedByMode[mode]) return view.sortedByMode[mode];
        var sorted = list.slice();
        switch (mode) {
            case 'name': sorted.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); }); break;
            case 'recent': sorted.sort(function (a, b) { return (getItemMeta(d, b).lastUsed || 0) - (getItemMeta(d, a).lastUsed || 0); }); break;
            case 'freq': sorted.sort(function (a, b) { return (getItemMeta(d, b).useCount || 0) - (getItemMeta(d, a).useCount || 0); }); break;
            case 'starred': sorted.sort(function (a, b) {
                var sa = getItemMeta(d, a).starred ? 1 : 0, sb = getItemMeta(d, b).starred ? 1 : 0;
                return sb - sa || a.name.localeCompare(b.name, 'zh');
            }); break;
        }
        if (list === view.items) view.sortedByMode[mode] = sorted;
        return sorted;
    }

    function normalizeGridCardSize(value) {
        var n = parseInt(value, 10);
        if (!n) n = 108;
        return Math.max(84, Math.min(220, n));
    }

    function applyGridCardSize(size) {
        var area = document.getElementById('tm-grid-area');
        if (area) {
            area.style.setProperty('--tm-grid-card-min', normalizeGridCardSize(size) + 'px');
            syncSeriesCardWidth(area, size);
        }
    }

    function getGridLayoutMetrics(area, size) {
        var gap = 9;
        var min = normalizeGridCardSize(size);
        var width = area ? area.clientWidth : 0;
        if (area && global.getComputedStyle) {
            var computed = global.getComputedStyle(area);
            width -= (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
        }
        width = Math.max(min, width || min);
        var columns = Math.max(1, Math.floor((width + gap) / (min + gap)));
        var cardWidth = Math.max(min, (width - gap * (columns - 1)) / columns);
        return { width: width, gap: gap, columns: columns, cardWidth: cardWidth };
    }

    function syncSeriesCardWidth(area, size) {
        if (!area) return;
        var metrics = getGridLayoutMetrics(area, size);
        area.style.setProperty('--tm-series-card-width', metrics.cardWidth.toFixed(2) + 'px');
        lastSeriesColumnCount = metrics.columns;
    }

    function scheduleSeriesResizeCheck() {
        if (seriesResizeTimer) clearTimeout(seriesResizeTimer);
        seriesResizeTimer = setTimeout(function () {
            seriesResizeTimer = null;
            var area = document.getElementById('tm-grid-area');
            if (!area) return;
            var d = load();
            var nextColumns = getGridLayoutMetrics(area, d.gridCardSize).columns;
            if (nextColumns !== lastSeriesColumnCount) renderGrid();
            else syncSeriesCardWidth(area, d.gridCardSize);
        }, 100);
    }

    function bindSeriesResizeListener() {
        if (!seriesResizeBound && global.addEventListener) {
            seriesResizeBound = true;
            global.addEventListener('resize', scheduleSeriesResizeCheck);
        }
        if (seriesGridResizeObserver) seriesGridResizeObserver.disconnect();
        seriesGridResizeObserver = null;
        var area = document.getElementById('tm-grid-area');
        if (area && typeof ResizeObserver === 'function') {
            seriesGridResizeObserver = new ResizeObserver(scheduleSeriesResizeCheck);
            seriesGridResizeObserver.observe(area);
        }
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
        renderGrid();
        if (gridSizeSaveTimer) clearTimeout(gridSizeSaveTimer);
        gridSizeSaveTimer = setTimeout(function () {
            gridSizeSaveTimer = null;
            save(load());
        }, 120);
    }

    var MANAGER_APPEARANCE_VARS = [
        '--tm-bg',
        '--tm-bg2',
        '--tm-text',
        '--tm-border',
        '--tm-card-bg',
        '--tm-card-border',
        '--tm-head-bg',
        '--tm-control-bg',
        '--tm-control-hover',
        '--tm-control-border',
        '--tm-shadow',
        '--tm-accent-text',
        '--tm-card-radius',
        '--tm-panel-radius',
        '--tm-control-radius',
        '--tm-card-border-style',
        '--tm-control-border-style',
        '--tm-card-shadow',
        '--tm-card-hover-shadow',
        '--tm-panel-shadow',
        '--tm-control-shadow',
        '--tm-card-blur',
        '--tm-panel-blur',
        '--tm-theme-font',
        '--tm-theme-bg-image',
        '--tm-theme-bg-size',
        '--tm-theme-bg-position',
        '--tm-theme-bg-repeat',
        '--tm-theme-bg-opacity',
        '--tm-theme-manager-image',
        '--tm-theme-manager-size',
        '--tm-theme-manager-position',
        '--tm-theme-manager-repeat',
        '--tm-theme-manager-opacity',
        '--tm-theme-surface-image',
        '--tm-theme-surface-size',
        '--tm-theme-surface-position',
        '--tm-theme-surface-repeat',
        '--tm-theme-surface-opacity',
        '--tm-theme-card-motif-opacity',
        '--tm-theme-topbar-image',
        '--tm-theme-topbar-size',
        '--tm-theme-topbar-position',
        '--tm-theme-topbar-repeat',
        '--tm-theme-topbar-overlay-height',
        '--tm-theme-topbar-overlay-top',
        '--tm-theme-top-icon-image',
        '--tm-theme-top-icon-transform',
        '--tm-theme-top-icon-size',
        '--tm-theme-bottombar-image',
        '--tm-theme-bottombar-size',
        '--tm-theme-bottombar-position',
        '--tm-theme-bottombar-repeat',
        '--tm-theme-bottom-refresh-image',
        '--tm-theme-bottom-refresh-transform',
        '--tm-theme-bottom-refresh-size',
        '--tm-theme-bottom-refresh-bg-size',
        '--tm-theme-bottom-refresh-bg-position',
        '--tm-theme-bottom-refresh-bg-repeat',
        '--tm-theme-bottom-refresh-filter',
        '--tm-theme-bottom-refresh-opacity',
        '--tm-theme-bottom-batch-image',
        '--tm-theme-bottom-batch-transform',
        '--tm-theme-bottom-batch-size',
        '--tm-theme-bottom-batch-bg-size',
        '--tm-theme-bottom-batch-bg-position',
        '--tm-theme-bottom-batch-bg-repeat',
        '--tm-theme-bottom-batch-filter',
        '--tm-theme-bottom-batch-opacity',
        '--tm-theme-bottom-settings-image',
        '--tm-theme-bottom-settings-transform',
        '--tm-theme-bottom-settings-size',
        '--tm-theme-bottom-settings-bg-size',
        '--tm-theme-bottom-settings-bg-position',
        '--tm-theme-bottom-settings-bg-repeat',
        '--tm-theme-bottom-settings-filter',
        '--tm-theme-bottom-settings-opacity',
        '--tm-theme-card-frame-image',
        '--tm-theme-card-frame-size',
        '--tm-theme-card-frame-position',
        '--tm-theme-card-frame-repeat',
        '--tm-theme-card-frame-blend',
        '--tm-theme-card-frame-filter',
        '--tm-theme-card-frame-opacity',
        '--tm-preview-aspect',
        '--tm-preview-radius',
        '--tm-preview-border-style',
        '--tm-preview-shadow',
        '--tm-preview-clip-path',
        '--tm-preview-mask-image',
        '--tm-preview-mask-size',
        '--tm-preview-mask-position',
        '--tm-preview-mask-repeat',
        '--tm-preview-slot-left',
        '--tm-preview-slot-top',
        '--tm-preview-slot-width',
        '--tm-preview-slot-height',
        '--tm-preview-slot-radius',
        '--tm-preview-slot-clip-path',
        '--tm-preview-slot-mask-image',
        '--tm-preview-slot-mask-size',
        '--tm-preview-slot-mask-position',
        '--tm-preview-slot-mask-repeat',
        '--tm-preview-slot-object-fit',
        '--tm-preview-slot-object-position',
        '--tm-preview-slot-transform',
        '--SmartThemeQuoteColor',
    ];

    function clearManagerAppearanceVars(ov) {
        MANAGER_APPEARANCE_VARS.forEach(function (name) { ov.style.removeProperty(name); });
        ov.classList.remove(
            'tm-has-manager-background',
            'tm-has-topbar-decoration',
            'tm-topbar-overhang',
            'tm-has-top-icon',
            'tm-has-bottombar-decoration',
            'tm-has-bottom-refresh-icon',
            'tm-has-bottom-batch-icon',
            'tm-has-bottom-settings-icon',
            'tm-has-card-frame',
            'tm-follow-grid',
            'tm-follow-card-frame',
            'tm-card-frame-blended',
            'tm-follow-preview-shape'
        );
    }

    function resolveBrowserColor(probe, value, fallback) {
        var candidate = String(value || '').trim();
        if (!candidate) candidate = String(fallback || '').trim();
        if (!candidate) return '';
        probe.style.removeProperty('color');
        probe.style.setProperty('color', candidate, 'important');
        if (!probe.style.color) return String(fallback || '');
        return getComputedStyle(probe).color || String(fallback || '');
    }

    function readCurrentThemeAppearance() {
        var rootStyle = getComputedStyle(document.documentElement);
        var bodyStyle = getComputedStyle(document.body);
        var probe = document.createElement('span');
        probe.setAttribute('style', 'position:fixed!important;left:-10000px!important;top:-10000px!important;visibility:hidden!important;pointer-events:none!important;');
        document.body.appendChild(probe);
        function read(variable, fallback) {
            return resolveBrowserColor(probe, rootStyle.getPropertyValue(variable), fallback);
        }
        var colors = {
            text: read('--SmartThemeBodyColor', bodyStyle.color),
            accent: read('--SmartThemeQuoteColor', '#7c6daf'),
            background: read('--SmartThemeBlurTintColor', bodyStyle.backgroundColor),
            chat: read('--SmartThemeChatTintColor', bodyStyle.backgroundColor),
            border: read('--SmartThemeBorderColor', ''),
            shadow: read('--SmartThemeShadowColor', 'rgba(0,0,0,.28)'),
        };
        probe.parentNode.removeChild(probe);
        return colors;
    }

    function applyCurrentBackgroundAppearance(ov, palette) {
        var bg = document.getElementById('bg1');
        var bgStyle = bg ? getComputedStyle(bg) : getComputedStyle(document.body);
        var image = String(bgStyle.backgroundImage || '').trim();
        var transparentImage = !image || image === 'none' || /__transparent(?:\.png)?/i.test(image);
        ov.style.setProperty('--tm-theme-bg-image', transparentImage ? 'none' : image);
        ov.style.setProperty('--tm-theme-bg-size', bgStyle.backgroundSize || 'cover');
        ov.style.setProperty('--tm-theme-bg-position', bgStyle.backgroundPosition || 'center');
        ov.style.setProperty('--tm-theme-bg-repeat', bgStyle.backgroundRepeat || 'no-repeat');
        ov.style.setProperty('--tm-theme-bg-opacity', transparentImage ? '0' : (palette.mode === 'dark' ? '.3' : '.24'));
    }

    function getSafeComputedValue(value, fallback, maxLength) {
        var text = String(value || '').trim();
        if (!text || text.length > (maxLength || 500)) return fallback;
        return text;
    }

    function getSafeImageValue(value, fallback) {
        var text = getSafeComputedValue(value, '', 32000);
        if (!text || text === 'none') return fallback || 'none';
        if (!/(?:url|image-set|(?:repeating-)?(?:linear|radial|conic)-gradient)\(/i.test(text)) {
            return fallback || 'none';
        }
        return text;
    }

    function getClampedPixelSize(value, fallback, minimum, maximum) {
        var parsed = parseFloat(String(value || ''));
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(minimum || 12, Math.min(maximum || 30, parsed)) + 'px';
    }

    function getComputedAspectRatio(element, pseudo, fallback) {
        var fallbackValue = arguments.length >= 3 ? fallback : '4 / 3';
        if (!element) return fallbackValue;
        var style = getComputedStyle(element, pseudo || null);
        var aspectText = String(style.aspectRatio || '');
        var aspectMatch = aspectText.match(/(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)/);
        var ratio = aspectMatch
            ? Number(aspectMatch[1]) / Number(aspectMatch[2])
            : NaN;
        if (!Number.isFinite(ratio) || ratio <= 0) {
            var width = parseFloat(style.width);
            var height = parseFloat(style.height);
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                ratio = width / height;
            }
        }
        if ((!Number.isFinite(ratio) || ratio <= 0) && !pseudo) {
            var rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) ratio = rect.width / rect.height;
        }
        if (!Number.isFinite(ratio) || ratio <= 0) return fallbackValue;
        ratio = Math.max(0.5, Math.min(2.4, ratio));
        return Number(ratio.toFixed(4)) + ' / 1';
    }

    function getSafeClipPath(value) {
        var text = getSafeComputedValue(value, 'none', 2000);
        if (text === 'none') return text;
        return /^(?:circle|ellipse|inset|polygon|path)\(/i.test(text) ? text : 'none';
    }

    function readBackgroundDecoration(element, pseudo) {
        if (!element) return null;
        var style = getComputedStyle(element, pseudo || null);
        var image = getSafeImageValue(style.backgroundImage, 'none');
        if (image === 'none' || style.display === 'none' || style.visibility === 'hidden') return null;
        var width = parseFloat(style.width);
        var height = parseFloat(style.height);
        var top = parseFloat(style.top);
        return {
            image: image,
            size: getSafeComputedValue(style.backgroundSize, 'cover', 1000),
            position: getSafeComputedValue(style.backgroundPosition, 'center', 1000),
            repeat: getSafeComputedValue(style.backgroundRepeat, 'no-repeat', 500),
            width: Number.isFinite(width) && width > 0 ? width : 0,
            height: Number.isFinite(height) && height > 0 ? height : 0,
            top: Number.isFinite(top) ? top : 0,
            pseudo: String(pseudo || ''),
        };
    }

    function readFirstBackgroundDecoration(candidates) {
        for (var i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            var decoration = readBackgroundDecoration(candidate.element, candidate.pseudo);
            if (decoration) return decoration;
        }
        return null;
    }

    function getFirstVisibleElement(selector) {
        var elements = Array.from(document.querySelectorAll(selector));
        return elements.find(function (element) {
            var style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        }) || elements[0] || null;
    }

    function readImageDecoration(element, pseudo, maximumSize, allowHidden) {
        if (!element) return null;
        var style = getComputedStyle(element, pseudo || null);
        if (!allowHidden && (style.display === 'none' || style.visibility === 'hidden')) return null;
        var image = getSafeImageValue(style.content, 'none');
        if (image === 'none') image = getSafeImageValue(style.backgroundImage, 'none');
        if (image === 'none' && !pseudo && element.tagName === 'IMG' && element.currentSrc) {
            image = 'url("' + String(element.currentSrc).replace(/["\\]/g, '\\$&') + '")';
        }
        if (image === 'none') return null;
        return {
            image: image,
            transform: getSafeComputedValue(style.transform, 'none', 500),
            size: getClampedPixelSize(style.width, '24px', 14, maximumSize || 30),
            aspectRatio: getComputedAspectRatio(element, pseudo, ''),
            backgroundSize: getSafeComputedValue(style.backgroundSize, 'contain', 1000),
            backgroundPosition: getSafeComputedValue(style.backgroundPosition, 'center', 1000),
            backgroundRepeat: getSafeComputedValue(style.backgroundRepeat, 'no-repeat', 500),
            mixBlendMode: getSafeComputedValue(style.mixBlendMode, 'normal', 100),
            filter: getSafeComputedValue(style.filter, 'none', 1000),
            opacity: String(clampPercent(parseFloat(style.opacity), 0, 1, 1)),
        };
    }

    function readFirstTargetedImageDecoration(selectors, maximumSize) {
        for (var i = 0; i < selectors.length; i++) {
            var decoration = readImageDecoration(
                document.querySelector(selectors[i]),
                '',
                maximumSize,
                true
            );
            if (decoration) return decoration;
        }
        return null;
    }

    function extractSingleCssImageUrl(image) {
        var text = String(image || '').trim();
        var match = text.match(/^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)$/i);
        return match ? String(match[1] || match[2] || match[3] || '').trim() : '';
    }

    function finishFrameAssetAnalysis(key, state, result) {
        state.status = result && result.trimmed ? 'ready' : 'plain';
        state.result = result || null;
        var attempts = frameAssetAnalysisOrder.length;
        while (frameAssetAnalysisOrder.length > 12 && attempts-- > 0) {
            var oldestKey = frameAssetAnalysisOrder.shift();
            var oldest = frameAssetAnalysisCache[oldestKey];
            if (oldest && oldest.status === 'loading') {
                frameAssetAnalysisOrder.push(oldestKey);
                continue;
            }
            if (oldest && oldest.result && oldest.result.objectUrl) {
                try { URL.revokeObjectURL(oldest.result.objectUrl); } catch (_) {}
            }
            delete frameAssetAnalysisCache[oldestKey];
        }
        scheduleManagerAppearanceSync();
    }

    function analyzeFrameAsset(image) {
        var url = extractSingleCssImageUrl(image);
        if (!url || (!/\.png(?:[?#].*)?$/i.test(url) && !/^data:image\/png/i.test(url))) return null;
        if (frameAssetAnalysisCache[url]) return frameAssetAnalysisCache[url];

        var state = { status: 'loading', result: null };
        frameAssetAnalysisCache[url] = state;
        frameAssetAnalysisOrder.push(url);

        fetch(url)
            .then(function (response) {
                if (!response.ok) throw new Error('frame image request failed');
                return response.blob();
            })
            .then(function (blob) {
                if (blob.type && blob.type !== 'image/png') return null;
                if (typeof createImageBitmap !== 'function') return null;
                return createImageBitmap(blob);
            })
            .then(function (bitmap) {
                if (!bitmap) return null;
                var maximumSample = 512;
                var sampleScale = Math.min(1, maximumSample / Math.max(bitmap.width, bitmap.height));
                var sampleWidth = Math.max(1, Math.round(bitmap.width * sampleScale));
                var sampleHeight = Math.max(1, Math.round(bitmap.height * sampleScale));
                var sample = document.createElement('canvas');
                sample.width = sampleWidth;
                sample.height = sampleHeight;
                var sampleContext = sample.getContext('2d', { willReadFrequently: true });
                sampleContext.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
                var pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
                var minX = sampleWidth;
                var minY = sampleHeight;
                var maxX = -1;
                var maxY = -1;
                for (var y = 0; y < sampleHeight; y++) {
                    for (var x = 0; x < sampleWidth; x++) {
                        if (pixels[(y * sampleWidth + x) * 4 + 3] <= 4) continue;
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                    }
                }
                if (maxX < minX || maxY < minY) {
                    if (bitmap.close) bitmap.close();
                    return null;
                }

                var sourceLeft = Math.floor(minX / sampleWidth * bitmap.width);
                var sourceTop = Math.floor(minY / sampleHeight * bitmap.height);
                var sourceRight = Math.ceil((maxX + 1) / sampleWidth * bitmap.width);
                var sourceBottom = Math.ceil((maxY + 1) / sampleHeight * bitmap.height);
                var padding = Math.max(2, Math.round(Math.max(bitmap.width, bitmap.height) * 0.01));
                sourceLeft = Math.max(0, sourceLeft - padding);
                sourceTop = Math.max(0, sourceTop - padding);
                sourceRight = Math.min(bitmap.width, sourceRight + padding);
                sourceBottom = Math.min(bitmap.height, sourceBottom + padding);
                var cropWidth = sourceRight - sourceLeft;
                var cropHeight = sourceBottom - sourceTop;
                var originalWidth = bitmap.width;
                var originalHeight = bitmap.height;
                var needsTrim = cropWidth < bitmap.width * 0.92 || cropHeight < bitmap.height * 0.92;
                if (!needsTrim) {
                    if (bitmap.close) bitmap.close();
                    return null;
                }

                var crop = document.createElement('canvas');
                crop.width = cropWidth;
                crop.height = cropHeight;
                crop.getContext('2d').drawImage(
                    bitmap,
                    sourceLeft,
                    sourceTop,
                    cropWidth,
                    cropHeight,
                    0,
                    0,
                    cropWidth,
                    cropHeight
                );
                if (bitmap.close) bitmap.close();
                return new Promise(function (resolve) {
                    crop.toBlob(function (trimmedBlob) {
                        if (!trimmedBlob) {
                            resolve(null);
                            return;
                        }
                        var objectUrl = URL.createObjectURL(trimmedBlob);
                        resolve({
                            trimmed: true,
                            image: 'url("' + objectUrl.replace(/["\\]/g, '\\$&') + '")',
                            objectUrl: objectUrl,
                            originalWidth: originalWidth,
                            originalHeight: originalHeight,
                            left: sourceLeft,
                            top: sourceTop,
                            width: cropWidth,
                            height: cropHeight,
                        });
                    }, 'image/png');
                });
            })
            .then(function (result) {
                finishFrameAssetAnalysis(url, state, result);
            })
            .catch(function () {
                state.status = 'failed';
                state.result = null;
                scheduleManagerAppearanceSync();
            });

        return state;
    }

    function setBackgroundDecorationVars(ov, prefix, decoration) {
        ov.style.setProperty(prefix + '-image', decoration ? decoration.image : 'none');
        ov.style.setProperty(prefix + '-size', decoration ? decoration.size : 'cover');
        ov.style.setProperty(prefix + '-position', decoration ? decoration.position : 'center');
        ov.style.setProperty(prefix + '-repeat', decoration ? decoration.repeat : 'no-repeat');
    }

    function getLargestPixelRadius(value, fallback, maximum) {
        var matches = String(value || '').match(/-?\d*\.?\d+px/gi);
        if (!matches || matches.length === 0) return fallback;
        var radius = matches.reduce(function (largest, part) {
            var parsed = parseFloat(part);
            return Number.isFinite(parsed) ? Math.max(largest, parsed) : largest;
        }, 0);
        return Math.max(0, Math.min(maximum || 30, radius)) + 'px';
    }

    function getVisibleBorder(style, fallback) {
        if (!style) return fallback;
        var width = parseFloat(style.borderTopWidth || style.borderWidth || '0');
        var borderStyle = style.borderTopStyle || style.borderStyle || 'none';
        var colorText = style.borderTopColor || style.borderColor || '';
        var color = appearanceApi && typeof appearanceApi.parseCssColor === 'function'
            ? appearanceApi.parseCssColor(colorText)
            : null;
        if (!Number.isFinite(width) || width <= 0 || borderStyle === 'none' || borderStyle === 'hidden' ||
            (color && color.a <= 0.03)) {
            return fallback;
        }
        return Math.min(width, 3) + 'px ' + borderStyle + ' ' + colorText;
    }

    function getRepresentativeMessage() {
        var messages = Array.from(document.querySelectorAll('#chat .mes'));
        return messages.find(function (message) {
            if (message.classList.contains('smallSysMes')) return false;
            var style = getComputedStyle(message);
            return style.display !== 'none' && style.visibility !== 'hidden';
        }) || messages[0] || null;
    }

    function getThemeSurfaceMotif(message) {
        var candidates = [];
        if (message) {
            candidates.push({ element: message, pseudo: '::before' });
            candidates.push({ element: message, pseudo: '::after' });
            candidates.push({ element: message, pseudo: '' });
        }
        var sendForm = document.getElementById('send_form');
        if (sendForm) candidates.push({ element: sendForm, pseudo: '::before' });
        var topBar = document.getElementById('top-bar');
        if (topBar) candidates.push({ element: topBar, pseudo: '::before' });

        for (var i = 0; i < candidates.length; i++) {
            var item = candidates[i];
            var style = getComputedStyle(item.element, item.pseudo || null);
            var image = getSafeComputedValue(style.backgroundImage, 'none', 32000);
            if (image === 'none' || style.display === 'none' || style.visibility === 'hidden') continue;
            if (item.pseudo && (style.content === 'none' || style.content === 'normal')) continue;
            return {
                image: image,
                size: getSafeComputedValue(style.backgroundSize, 'cover', 1000),
                position: getSafeComputedValue(style.backgroundPosition, 'center', 1000),
                repeat: getSafeComputedValue(style.backgroundRepeat, 'no-repeat', 500),
            };
        }
        return null;
    }

    function readFunctionalPageBackground(element, pseudo) {
        if (!element) return null;
        var style = getComputedStyle(element, pseudo || null);
        var image = getSafeImageValue(style.backgroundImage, 'none');
        if (image === 'none') return null;
        if (pseudo && (style.content === 'none' || style.content === 'normal')) return null;
        return {
            image: image,
            size: getSafeComputedValue(style.backgroundSize, 'cover', 1000),
            position: getSafeComputedValue(style.backgroundPosition, 'center', 1000),
            repeat: getSafeComputedValue(style.backgroundRepeat, 'no-repeat', 500),
        };
    }

    function getThemeManagerBackground() {
        var pageSurfaces = [
            document.getElementById('rm_extensions_block'),
            document.getElementById('user-settings-block'),
            document.getElementById('PersonaManagement'),
            document.getElementById('right-nav-panel'),
            document.getElementById('left-nav-panel'),
        ];
        var candidates = [];
        pageSurfaces.forEach(function (surface) {
            if (!surface) return;
            candidates.push({ element: surface, pseudo: '' });
            candidates.push({ element: surface, pseudo: '::before' });
            candidates.push({ element: surface, pseudo: '::after' });
        });
        for (var i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            var decoration = readFunctionalPageBackground(candidate.element, candidate.pseudo);
            if (decoration) return decoration;
        }
        return null;
    }

    function getTransformTranslation(transform) {
        var text = String(transform || '').trim();
        if (!text || text === 'none') return { x: 0, y: 0 };
        try {
            if (typeof DOMMatrixReadOnly === 'function') {
                var matrix = new DOMMatrixReadOnly(text);
                return { x: Number(matrix.m41) || 0, y: Number(matrix.m42) || 0 };
            }
        } catch (error) {
            // Fall through to the simple matrix parser.
        }
        var match = text.match(/^matrix\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([^,]+),\s*([^)]+)\)$/);
        return match
            ? { x: Number(match[1]) || 0, y: Number(match[2]) || 0 }
            : { x: 0, y: 0 };
    }

    function getTransformGeometry(transform) {
        var text = String(transform || '').trim();
        if (!text || text === 'none') {
            return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
        }
        try {
            if (typeof DOMMatrixReadOnly === 'function') {
                var matrix = new DOMMatrixReadOnly(text);
                var scaleX = Math.hypot(matrix.a, matrix.b) || 1;
                var determinant = matrix.a * matrix.d - matrix.b * matrix.c;
                var scaleY = Math.abs(determinant / scaleX) || 1;
                return {
                    x: Number(matrix.m41) || 0,
                    y: Number(matrix.m42) || 0,
                    scaleX: scaleX,
                    scaleY: scaleY,
                    rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
                };
            }
        } catch (error) {
            // Fall through to translation-only compatibility.
        }
        var translation = getTransformTranslation(text);
        return { x: translation.x, y: translation.y, scaleX: 1, scaleY: 1, rotation: 0 };
    }

    function getOffsetWithin(element, ancestor) {
        var left = 0;
        var top = 0;
        var current = element;
        while (current && current !== ancestor) {
            left += Number(current.offsetLeft) || 0;
            top += Number(current.offsetTop) || 0;
            current = current.offsetParent;
        }
        return current === ancestor ? { left: left, top: top } : null;
    }

    function clampPercent(value, minimum, maximum, fallback) {
        var numeric = Number(value);
        if (!Number.isFinite(numeric)) numeric = fallback;
        return Math.max(minimum, Math.min(maximum, numeric));
    }

    function readFrameComposition(avatar, cardFrame) {
        var image = avatar && avatar.querySelector('img');
        if (!avatar || !image || !cardFrame) return null;
        var frameStyle = getComputedStyle(avatar, '::after');
        var frameWidth = parseFloat(frameStyle.width);
        var frameHeight = parseFloat(frameStyle.height);
        if (!Number.isFinite(frameWidth) || frameWidth <= 0) frameWidth = avatar.offsetWidth;
        if (!Number.isFinite(frameHeight) || frameHeight <= 0) {
            var frameRatio = parseFloat(cardFrame.aspectRatio);
            frameHeight = frameRatio > 0 ? frameWidth / frameRatio : avatar.offsetHeight;
        }
        var imageWidth = image.offsetWidth || parseFloat(getComputedStyle(image).width);
        var imageHeight = image.offsetHeight || parseFloat(getComputedStyle(image).height);
        if (!(frameWidth > 0 && frameHeight > 0 && imageWidth > 0 && imageHeight > 0)) return null;

        var frameLeft = parseFloat(frameStyle.left);
        var frameTop = parseFloat(frameStyle.top);
        if (!Number.isFinite(frameLeft)) frameLeft = 0;
        if (!Number.isFinite(frameTop)) frameTop = 0;
        var imageStyle = getComputedStyle(image);
        var frameTransform = getTransformGeometry(frameStyle.transform);
        var imageTransform = getTransformGeometry(imageStyle.transform);
        var imageOffset = getOffsetWithin(image, avatar) || {
            left: parseFloat(imageStyle.left) || 0,
            top: parseFloat(imageStyle.top) || 0,
        };
        var frameX = frameLeft + frameTransform.x;
        var frameY = frameTop + frameTransform.y;
        var imageX = imageOffset.left + imageTransform.x;
        var imageY = imageOffset.top + imageTransform.y;
        var transformedImageWidth = imageWidth * imageTransform.scaleX;
        var transformedImageHeight = imageHeight * imageTransform.scaleY;
        var slotLeft = clampPercent((imageX - frameX) / frameWidth * 100, -35, 95, 0);
        var slotTop = clampPercent((imageY - frameY) / frameHeight * 100, -35, 95, 0);
        var slotWidth = clampPercent(transformedImageWidth / frameWidth * 100, 12, 140, 100);
        var slotHeight = clampPercent(transformedImageHeight / frameHeight * 100, 12, 140, 100);
        var rotation = Math.abs(imageTransform.rotation) > 0.01
            ? 'rotate(' + Number(imageTransform.rotation.toFixed(3)) + 'deg)'
            : 'none';

        return {
            aspectRatio: Number(Math.max(0.5, Math.min(2.4, frameWidth / frameHeight)).toFixed(4)) + ' / 1',
            left: Number(slotLeft.toFixed(3)) + '%',
            top: Number(slotTop.toFixed(3)) + '%',
            width: Number(slotWidth.toFixed(3)) + '%',
            height: Number(slotHeight.toFixed(3)) + '%',
            radius: getSafeComputedValue(imageStyle.borderRadius, '0px', 500),
            clipPath: getSafeClipPath(imageStyle.clipPath),
            maskImage: getSafeImageValue(imageStyle.webkitMaskImage || imageStyle.maskImage, 'none'),
            maskSize: getSafeComputedValue(imageStyle.webkitMaskSize || imageStyle.maskSize, 'cover', 1000),
            maskPosition: getSafeComputedValue(imageStyle.webkitMaskPosition || imageStyle.maskPosition, 'center', 1000),
            maskRepeat: getSafeComputedValue(imageStyle.webkitMaskRepeat || imageStyle.maskRepeat, 'no-repeat', 500),
            objectFit: getSafeComputedValue(imageStyle.objectFit, 'cover', 100),
            objectPosition: getSafeComputedValue(imageStyle.objectPosition, 'center', 500),
            transform: rotation,
            geometry: {
                frameLeft: frameX,
                frameTop: frameY,
                frameWidth: frameWidth,
                frameHeight: frameHeight,
                backgroundSize: cardFrame.backgroundSize,
                backgroundPosition: cardFrame.backgroundPosition,
                imageLeft: imageX,
                imageTop: imageY,
                imageWidth: transformedImageWidth,
                imageHeight: transformedImageHeight,
            },
        };
    }

    function readPreviewShape(avatar, cardFrame, frameComposition) {
        var image = avatar && avatar.querySelector('img');
        var source = cardFrame ? avatar : (image || avatar);
        var sourceStyle = source ? getComputedStyle(source) : null;
        var frameAspect = frameComposition && frameComposition.aspectRatio;
        var radius = cardFrame
            ? '0px'
            : getSafeComputedValue(sourceStyle && sourceStyle.borderRadius, '0px', 500);
        var maskImage = cardFrame
            ? 'none'
            : getSafeImageValue(
                sourceStyle && (sourceStyle.webkitMaskImage || sourceStyle.maskImage),
                'none'
            );
        return {
            aspectRatio: frameAspect || getComputedAspectRatio(source, '', '4 / 3'),
            radius: radius,
            border: cardFrame ? '1px solid transparent' : getVisibleBorder(sourceStyle, '1px solid transparent'),
            shadow: getSafeComputedValue(sourceStyle && sourceStyle.boxShadow, 'none', 1000),
            clipPath: cardFrame ? 'none' : getSafeClipPath(sourceStyle && sourceStyle.clipPath),
            maskImage: maskImage,
            maskSize: getSafeComputedValue(
                sourceStyle && (sourceStyle.webkitMaskSize || sourceStyle.maskSize),
                'cover',
                1000
            ),
            maskPosition: getSafeComputedValue(
                sourceStyle && (sourceStyle.webkitMaskPosition || sourceStyle.maskPosition),
                'center',
                1000
            ),
            maskRepeat: getSafeComputedValue(
                sourceStyle && (sourceStyle.webkitMaskRepeat || sourceStyle.maskRepeat),
                'no-repeat',
                500
            ),
            slot: frameComposition || {
                left: '0%',
                top: '0%',
                width: '100%',
                height: '100%',
                radius: getSafeComputedValue(sourceStyle && sourceStyle.borderRadius, '0px', 500),
                clipPath: getSafeClipPath(sourceStyle && sourceStyle.clipPath),
                maskImage: getSafeImageValue(
                    sourceStyle && (sourceStyle.webkitMaskImage || sourceStyle.maskImage),
                    'none'
                ),
                maskSize: getSafeComputedValue(
                    sourceStyle && (sourceStyle.webkitMaskSize || sourceStyle.maskSize),
                    'cover',
                    1000
                ),
                maskPosition: getSafeComputedValue(
                    sourceStyle && (sourceStyle.webkitMaskPosition || sourceStyle.maskPosition),
                    'center',
                    1000
                ),
                maskRepeat: getSafeComputedValue(
                    sourceStyle && (sourceStyle.webkitMaskRepeat || sourceStyle.maskRepeat),
                    'no-repeat',
                    500
                ),
                objectFit: getSafeComputedValue(sourceStyle && sourceStyle.objectFit, 'cover', 100),
                objectPosition: getSafeComputedValue(sourceStyle && sourceStyle.objectPosition, 'center', 500),
                transform: 'none',
            },
        };
    }

    function getBackgroundPositionOffset(value, freeSpace, horizontal) {
        var tokens = String(value || 'center').trim().split(/\s+/);
        var token = horizontal ? tokens[0] : (tokens[1] || tokens[0]);
        if (token === 'left' || token === 'top') return 0;
        if (token === 'right' || token === 'bottom') return freeSpace;
        if (token === 'center') return freeSpace / 2;
        if (/%$/.test(token)) return freeSpace * (parseFloat(token) || 0) / 100;
        if (/px$/.test(token)) return parseFloat(token) || 0;
        return freeSpace / 2;
    }

    function createTrimmedFrameShape(previewShape, frameShape, analysis) {
        var sourceSlot = frameShape && frameShape.slot;
        var geometry = sourceSlot && sourceSlot.geometry;
        var slot = sourceSlot || previewShape.slot;
        if (geometry && analysis.originalWidth > 0 && analysis.originalHeight > 0) {
            var frameWidth = geometry.frameWidth;
            var frameHeight = geometry.frameHeight;
            var size = String(geometry.backgroundSize || 'contain').toLowerCase();
            var scale = size.indexOf('cover') >= 0
                ? Math.max(frameWidth / analysis.originalWidth, frameHeight / analysis.originalHeight)
                : Math.min(frameWidth / analysis.originalWidth, frameHeight / analysis.originalHeight);
            var renderedWidth = analysis.originalWidth * scale;
            var renderedHeight = analysis.originalHeight * scale;
            var originX = getBackgroundPositionOffset(
                geometry.backgroundPosition,
                frameWidth - renderedWidth,
                true
            );
            var originY = getBackgroundPositionOffset(
                geometry.backgroundPosition,
                frameHeight - renderedHeight,
                false
            );
            var cropLeft = geometry.frameLeft + originX + analysis.left * scale;
            var cropTop = geometry.frameTop + originY + analysis.top * scale;
            var cropWidth = analysis.width * scale;
            var cropHeight = analysis.height * scale;
            if (cropWidth > 0 && cropHeight > 0) {
                slot = Object.assign({}, sourceSlot, {
                    left: Number(clampPercent(
                        (geometry.imageLeft - cropLeft) / cropWidth * 100,
                        -35,
                        95,
                        0
                    ).toFixed(3)) + '%',
                    top: Number(clampPercent(
                        (geometry.imageTop - cropTop) / cropHeight * 100,
                        -35,
                        95,
                        0
                    ).toFixed(3)) + '%',
                    width: Number(clampPercent(
                        geometry.imageWidth / cropWidth * 100,
                        12,
                        140,
                        100
                    ).toFixed(3)) + '%',
                    height: Number(clampPercent(
                        geometry.imageHeight / cropHeight * 100,
                        12,
                        140,
                        100
                    ).toFixed(3)) + '%',
                });
            }
        }
        return {
            aspectRatio: Number(Math.max(0.5, Math.min(2.4, analysis.width / analysis.height)).toFixed(4)) + ' / 1',
            radius: '0px',
            border: '1px solid transparent',
            shadow: previewShape.shadow,
            clipPath: 'none',
            maskImage: 'none',
            maskSize: 'cover',
            maskPosition: 'center',
            maskRepeat: 'no-repeat',
            slot: slot,
        };
    }

    function readCurrentThemeSurface() {
        var message = getRepresentativeMessage();
        var messageStyle = message ? getComputedStyle(message) : null;
        var panel = document.querySelector('.drawer-content') || document.getElementById('send_form');
        var panelStyle = panel ? getComputedStyle(panel) : null;
        var control = document.querySelector('.menu_button');
        var controlStyle = control ? getComputedStyle(control) : null;
        var messageText = document.querySelector('#chat .mes_text');
        var textStyle = messageText ? getComputedStyle(messageText) : messageStyle;
        var motif = getThemeSurfaceMotif(message);
        var managerBackground = getThemeManagerBackground();
        var topSettings = document.getElementById('top-settings-holder');
        var nativeTopBar = document.getElementById('top-bar');
        var topBar = readFirstBackgroundDecoration([
            { element: topSettings, pseudo: '' },
            { element: nativeTopBar, pseudo: '' },
            { element: topSettings, pseudo: '::after' },
            { element: nativeTopBar, pseudo: '::after' },
            { element: topSettings, pseudo: '::before' },
            { element: nativeTopBar, pseudo: '::before' },
        ]);
        var topIcon = readImageDecoration(
            getFirstVisibleElement('#top-settings-holder .drawer-icon'),
            '',
            28
        );
        var bottomBar = readBackgroundDecoration(document.getElementById('send_form'));
        var bottomIcons = {
            refresh: readFirstTargetedImageDecoration(
                ['#send_but', '#mes_continue', '#mes_stop'],
                30
            ),
            batch: readFirstTargetedImageDecoration(
                ['#extensionsMenuButton'],
                30
            ),
            settings: readFirstTargetedImageDecoration(
                ['#options_button'],
                30
            ),
        };
        var avatar = message && message.querySelector('.avatar');
        var cardFrame = readImageDecoration(avatar, '::after', 30);
        var frameComposition = readFrameComposition(avatar, cardFrame);
        var previewShape = readPreviewShape(avatar, null, null);
        var frameShape = readPreviewShape(avatar, cardFrame, frameComposition);

        return {
            cardRadius: getLargestPixelRadius(messageStyle && messageStyle.borderRadius, '10px', 30),
            panelRadius: getLargestPixelRadius(panelStyle && panelStyle.borderRadius, '18px', 32),
            controlRadius: getLargestPixelRadius(controlStyle && controlStyle.borderRadius, '8px', 20),
            cardBorder: getVisibleBorder(messageStyle, '2px solid transparent'),
            controlBorder: getVisibleBorder(controlStyle, '1px solid transparent'),
            cardShadow: getSafeComputedValue(messageStyle && messageStyle.boxShadow, 'none', 1000),
            panelShadow: getSafeComputedValue(panelStyle && panelStyle.boxShadow, 'none', 1000),
            controlShadow: getSafeComputedValue(controlStyle && controlStyle.boxShadow, 'none', 1000),
            cardBlur: getSafeComputedValue(messageStyle && messageStyle.backdropFilter, 'none', 500),
            panelBlur: getSafeComputedValue(panelStyle && panelStyle.backdropFilter, 'none', 500),
            fontFamily: getSafeComputedValue(textStyle && textStyle.fontFamily, 'inherit', 500),
            cardBackground: getSafeComputedValue(messageStyle && messageStyle.backgroundColor, '', 200),
            panelBackground: getSafeComputedValue(panelStyle && panelStyle.backgroundColor, '', 200),
            controlBackground: getSafeComputedValue(controlStyle && controlStyle.backgroundColor, '', 200),
            motif: motif,
            managerBackground: managerBackground,
            topBar: topBar,
            topIcon: topIcon,
            bottomBar: bottomBar,
            bottomIcons: bottomIcons,
            cardFrame: cardFrame,
            previewShape: previewShape,
            frameShape: frameShape,
        };
    }

    function hasVisibleColor(value) {
        if (!appearanceApi || typeof appearanceApi.parseCssColor !== 'function') return Boolean(value);
        var color = appearanceApi.parseCssColor(value);
        return Boolean(color && color.a > 0.08);
    }

    function setThemedButtonIconVars(ov, prefix, decoration) {
        ov.style.setProperty(prefix + '-image', decoration ? decoration.image : 'none');
        ov.style.setProperty(prefix + '-transform', decoration ? decoration.transform : 'none');
        ov.style.setProperty(prefix + '-size', decoration ? decoration.size : '24px');
        ov.style.setProperty(prefix + '-bg-size', decoration ? decoration.backgroundSize : 'contain');
        ov.style.setProperty(prefix + '-bg-position', decoration ? decoration.backgroundPosition : 'center');
        ov.style.setProperty(prefix + '-bg-repeat', decoration ? decoration.backgroundRepeat : 'no-repeat');
        ov.style.setProperty(prefix + '-filter', decoration ? decoration.filter : 'none');
        ov.style.setProperty(prefix + '-opacity', decoration ? decoration.opacity : '1');
    }

    function applyCurrentThemeSurface(ov, palette, settings) {
        var surface = readCurrentThemeSurface();
        var frameAnalysis = settings.showThemeAvatarFrame === true && surface.cardFrame
            ? analyzeFrameAsset(surface.cardFrame.image)
            : null;
        var frameAnalysisPending = frameAnalysis && frameAnalysis.status === 'loading';
        var trimmedFrame = frameAnalysis && frameAnalysis.status === 'ready'
            ? frameAnalysis.result
            : null;
        var effectiveCardFrame = surface.cardFrame;
        if (trimmedFrame) {
            effectiveCardFrame = Object.assign({}, surface.cardFrame, {
                image: trimmedFrame.image,
                backgroundSize: 'contain',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
            });
        }
        var followCardFrame = settings.showThemeAvatarFrame === true &&
            Boolean(surface.cardFrame) &&
            !frameAnalysisPending;
        var followPreviewShape = settings.followThemePreviewShape === true;
        var effectivePreviewShape = followCardFrame
            ? (trimmedFrame
                ? createTrimmedFrameShape(surface.previewShape, surface.frameShape, trimmedFrame)
                : surface.frameShape)
            : surface.previewShape;
        ov.style.setProperty('--tm-card-radius', surface.cardRadius);
        ov.style.setProperty('--tm-panel-radius', surface.panelRadius);
        ov.style.setProperty('--tm-control-radius', surface.controlRadius);
        ov.style.setProperty('--tm-card-border-style', surface.cardBorder);
        ov.style.setProperty('--tm-control-border-style', surface.controlBorder);
        ov.style.setProperty('--tm-card-shadow', surface.cardShadow);
        ov.style.setProperty('--tm-card-hover-shadow', surface.cardShadow);
        ov.style.setProperty('--tm-panel-shadow', surface.panelShadow);
        ov.style.setProperty('--tm-control-shadow', surface.controlShadow);
        ov.style.setProperty('--tm-card-blur', surface.cardBlur);
        ov.style.setProperty('--tm-panel-blur', surface.panelBlur);
        ov.style.setProperty('--tm-theme-font', surface.fontFamily);
        if (hasVisibleColor(surface.cardBackground)) ov.style.setProperty('--tm-card-bg', surface.cardBackground);
        if (hasVisibleColor(surface.panelBackground)) {
            ov.style.setProperty('--tm-head-bg', surface.panelBackground);
        }
        if (hasVisibleColor(surface.controlBackground)) ov.style.setProperty('--tm-control-bg', surface.controlBackground);

        if (surface.motif) {
            ov.style.setProperty('--tm-theme-surface-image', surface.motif.image);
            ov.style.setProperty('--tm-theme-surface-size', surface.motif.size);
            ov.style.setProperty('--tm-theme-surface-position', surface.motif.position);
            ov.style.setProperty('--tm-theme-surface-repeat', surface.motif.repeat);
            ov.style.setProperty('--tm-theme-surface-opacity', palette.mode === 'dark' ? '.12' : '.1');
            ov.style.setProperty('--tm-theme-card-motif-opacity', palette.mode === 'dark' ? '.22' : '.18');
        } else {
            ov.style.setProperty('--tm-theme-surface-image', 'none');
            ov.style.setProperty('--tm-theme-surface-opacity', '0');
            ov.style.setProperty('--tm-theme-card-motif-opacity', '0');
        }

        setBackgroundDecorationVars(ov, '--tm-theme-manager', surface.managerBackground);
        ov.style.setProperty('--tm-theme-manager-opacity', surface.managerBackground ? '.96' : '0');
        setBackgroundDecorationVars(ov, '--tm-theme-topbar', surface.topBar);
        var nativeTopHeight = Math.max(
            document.getElementById('top-settings-holder')?.getBoundingClientRect().height || 0,
            document.getElementById('top-bar')?.getBoundingClientRect().height || 0
        );
        var hasTopBarOverhang = Boolean(
            surface.topBar &&
            surface.topBar.pseudo &&
            surface.topBar.width > 0 &&
            surface.topBar.height > Math.max(72, nativeTopHeight * 1.8)
        );
        var topBarHeight = hasTopBarOverhang
            ? Number(Math.min(60, surface.topBar.height / surface.topBar.width * 100).toFixed(3)) + 'vw'
            : '100%';
        var topBarTop = hasTopBarOverhang && surface.topBar.width > 0
            ? Number((surface.topBar.top / surface.topBar.width * 100).toFixed(3)) + 'vw'
            : '0px';
        ov.style.setProperty('--tm-theme-topbar-overlay-height', topBarHeight);
        ov.style.setProperty('--tm-theme-topbar-overlay-top', topBarTop);
        ov.style.setProperty('--tm-theme-top-icon-image', surface.topIcon ? surface.topIcon.image : 'normal');
        ov.style.setProperty('--tm-theme-top-icon-transform', surface.topIcon ? surface.topIcon.transform : 'none');
        ov.style.setProperty('--tm-theme-top-icon-size', surface.topIcon ? surface.topIcon.size : '24px');
        setBackgroundDecorationVars(ov, '--tm-theme-bottombar', surface.bottomBar);
        setThemedButtonIconVars(ov, '--tm-theme-bottom-refresh', surface.bottomIcons.refresh);
        setThemedButtonIconVars(ov, '--tm-theme-bottom-batch', surface.bottomIcons.batch);
        setThemedButtonIconVars(ov, '--tm-theme-bottom-settings', surface.bottomIcons.settings);
        ov.style.setProperty('--tm-theme-card-frame-image', effectiveCardFrame ? effectiveCardFrame.image : 'none');
        ov.style.setProperty('--tm-theme-card-frame-size', effectiveCardFrame ? effectiveCardFrame.backgroundSize : 'contain');
        ov.style.setProperty('--tm-theme-card-frame-position', effectiveCardFrame ? effectiveCardFrame.backgroundPosition : 'center');
        ov.style.setProperty('--tm-theme-card-frame-repeat', effectiveCardFrame ? effectiveCardFrame.backgroundRepeat : 'no-repeat');
        ov.style.setProperty('--tm-theme-card-frame-blend', effectiveCardFrame ? effectiveCardFrame.mixBlendMode : 'normal');
        ov.style.setProperty('--tm-theme-card-frame-filter', effectiveCardFrame ? effectiveCardFrame.filter : 'none');
        ov.style.setProperty('--tm-theme-card-frame-opacity', effectiveCardFrame ? effectiveCardFrame.opacity : '1');
        ov.style.setProperty('--tm-preview-aspect', effectivePreviewShape.aspectRatio);
        ov.style.setProperty('--tm-preview-radius', effectivePreviewShape.radius);
        ov.style.setProperty('--tm-preview-border-style', effectivePreviewShape.border);
        ov.style.setProperty('--tm-preview-shadow', effectivePreviewShape.shadow);
        ov.style.setProperty('--tm-preview-clip-path', effectivePreviewShape.clipPath);
        ov.style.setProperty('--tm-preview-mask-image', effectivePreviewShape.maskImage);
        ov.style.setProperty('--tm-preview-mask-size', effectivePreviewShape.maskSize);
        ov.style.setProperty('--tm-preview-mask-position', effectivePreviewShape.maskPosition);
        ov.style.setProperty('--tm-preview-mask-repeat', effectivePreviewShape.maskRepeat);
        ov.style.setProperty('--tm-preview-slot-left', effectivePreviewShape.slot.left);
        ov.style.setProperty('--tm-preview-slot-top', effectivePreviewShape.slot.top);
        ov.style.setProperty('--tm-preview-slot-width', effectivePreviewShape.slot.width);
        ov.style.setProperty('--tm-preview-slot-height', effectivePreviewShape.slot.height);
        ov.style.setProperty('--tm-preview-slot-radius', effectivePreviewShape.slot.radius);
        ov.style.setProperty('--tm-preview-slot-clip-path', effectivePreviewShape.slot.clipPath);
        ov.style.setProperty('--tm-preview-slot-mask-image', effectivePreviewShape.slot.maskImage);
        ov.style.setProperty('--tm-preview-slot-mask-size', effectivePreviewShape.slot.maskSize);
        ov.style.setProperty('--tm-preview-slot-mask-position', effectivePreviewShape.slot.maskPosition);
        ov.style.setProperty('--tm-preview-slot-mask-repeat', effectivePreviewShape.slot.maskRepeat);
        ov.style.setProperty('--tm-preview-slot-object-fit', effectivePreviewShape.slot.objectFit);
        ov.style.setProperty('--tm-preview-slot-object-position', effectivePreviewShape.slot.objectPosition);
        ov.style.setProperty('--tm-preview-slot-transform', effectivePreviewShape.slot.transform || 'none');

        ov.classList.toggle('tm-has-manager-background', Boolean(surface.managerBackground));
        ov.classList.toggle('tm-has-topbar-decoration', Boolean(surface.topBar));
        ov.classList.toggle('tm-topbar-overhang', hasTopBarOverhang);
        ov.classList.toggle('tm-has-top-icon', Boolean(surface.topIcon));
        ov.classList.toggle('tm-has-bottombar-decoration', Boolean(surface.bottomBar));
        ov.classList.toggle('tm-has-bottom-refresh-icon', Boolean(surface.bottomIcons.refresh));
        ov.classList.toggle('tm-has-bottom-batch-icon', Boolean(surface.bottomIcons.batch));
        ov.classList.toggle('tm-has-bottom-settings-icon', Boolean(surface.bottomIcons.settings));
        ov.classList.toggle('tm-has-card-frame', Boolean(surface.cardFrame));
        ov.classList.toggle('tm-follow-card-frame', followCardFrame);
        ov.classList.toggle(
            'tm-card-frame-blended',
            followCardFrame && effectiveCardFrame && effectiveCardFrame.mixBlendMode !== 'normal'
        );
        ov.classList.toggle('tm-follow-preview-shape', followPreviewShape);
        ov.classList.toggle('tm-follow-grid', followCardFrame || followPreviewShape);
    }

    function updateAppearanceToggleButton(ov, following, mode) {
        var button = ov && ov.querySelector('#tm-theme-toggle');
        if (!button) return;
        if (following) {
            button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
            button.title = '外观：跟随当前美化（点击切换固定明暗）';
            return;
        }
        var isDark = mode === 'dark';
        button.innerHTML = isDark
            ? '<i class="fa-solid fa-moon"></i>'
            : '<i class="fa-regular fa-sun"></i>';
        button.title = isDark ? '外观：固定深色（点击切换浅色）' : '外观：固定浅色（点击切换深色）';
    }

    function syncManagerAppearance() {
        var ov = document.querySelector('.tm-overlay');
        if (!ov) return;
        var d = load();
        var following = d.followThemeAppearance === true && appearanceApi && typeof appearanceApi.createPalette === 'function';
        var autoHideHeader = d.autoHideHeader === true;

        ov.classList.toggle('tm-follow', following);
        ov.classList.toggle('tm-auto-hide-head', autoHideHeader);
        if (!autoHideHeader) ov.classList.remove('tm-head-revealed');
        var head = ov.querySelector('.tm-head');
        if (head) {
            if (autoHideHeader) {
                head.setAttribute('tabindex', '0');
                head.setAttribute('title', '点击显示顶栏内容');
            } else {
                head.removeAttribute('tabindex');
                head.removeAttribute('title');
            }
        }
        if (!following) {
            clearManagerAppearanceVars(ov);
            ov.classList.remove('tm-compact-card-info');
            ov.classList.toggle('tm-dark', darkMode);
            ov.classList.toggle('tm-light', !darkMode);
            ov.dataset.tmAppearanceMode = darkMode ? 'dark' : 'light';
            updateAppearanceToggleButton(ov, false, ov.dataset.tmAppearanceMode);
            return;
        }

        var palette = appearanceApi.createPalette(readCurrentThemeAppearance());
        ov.classList.toggle('tm-dark', palette.mode === 'dark');
        ov.classList.toggle('tm-light', palette.mode !== 'dark');
        ov.dataset.tmAppearanceMode = palette.mode;
        ov.style.setProperty('--tm-bg', palette.background);
        ov.style.setProperty('--tm-bg2', palette.surface);
        ov.style.setProperty('--tm-text', palette.text);
        ov.style.setProperty('--tm-border', palette.border);
        ov.style.setProperty('--tm-card-bg', palette.card);
        ov.style.setProperty('--tm-card-border', palette.border);
        ov.style.setProperty('--tm-head-bg', palette.surfaceStrong);
        ov.style.setProperty('--tm-control-bg', palette.control);
        ov.style.setProperty('--tm-control-hover', palette.controlHover);
        ov.style.setProperty('--tm-control-border', palette.border);
        ov.style.setProperty('--tm-shadow', palette.shadow);
        ov.style.setProperty('--tm-accent-text', palette.accentText);
        ov.style.setProperty('--SmartThemeQuoteColor', palette.accent);
        applyCurrentBackgroundAppearance(ov, palette);
        applyCurrentThemeSurface(ov, palette, d);
        ov.classList.toggle(
            'tm-compact-card-info',
            d.simplifyGridText === true &&
            (
                d.showThemeAvatarFrame === true ||
                d.followThemePreviewShape === true
            )
        );
        updateAppearanceToggleButton(ov, true, palette.mode);
    }

    function scheduleManagerAppearanceSync() {
        if (!document.querySelector('.tm-overlay')) return;
        if (managerAppearanceTimer) clearTimeout(managerAppearanceTimer);
        if (managerAppearanceSettleTimer) clearTimeout(managerAppearanceSettleTimer);
        managerAppearanceTimer = setTimeout(function () {
            managerAppearanceTimer = null;
            syncManagerAppearance();
        }, 40);
        managerAppearanceSettleTimer = setTimeout(function () {
            managerAppearanceSettleTimer = null;
            syncManagerAppearance();
        }, 360);
    }

    function disconnectManagerAppearanceObserver() {
        if (managerAppearanceObserver) managerAppearanceObserver.disconnect();
        managerAppearanceObserver = null;
        if (managerAppearanceTimer) clearTimeout(managerAppearanceTimer);
        if (managerAppearanceSettleTimer) clearTimeout(managerAppearanceSettleTimer);
        managerAppearanceTimer = null;
        managerAppearanceSettleTimer = null;
    }

    function bindManagerAppearanceObserver() {
        disconnectManagerAppearanceObserver();
        if (typeof MutationObserver !== 'function') return;
        managerAppearanceObserver = new MutationObserver(scheduleManagerAppearanceSync);
        managerAppearanceObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['style'],
        });
        var bg = document.getElementById('bg1');
        if (bg) {
            managerAppearanceObserver.observe(bg, {
                attributes: true,
                attributeFilter: ['style', 'class'],
            });
        }
        var customStyle = document.getElementById('custom-style');
        if (customStyle) {
            managerAppearanceObserver.observe(customStyle, {
                childList: true,
                characterData: true,
                subtree: true,
            });
        }
    }

    // ── 打开全屏主界面 ────────────────────────────────────────
    var popupWaitingForStorage = false;
    function openPopup() {
        if (!isStorageReady()) {
            if (!storageApi || popupWaitingForStorage) return;
            popupWaitingForStorage = true;
            whenStorageReady().then(function () {
                popupWaitingForStorage = false;
                openPopup();
            }).catch(function (err) {
                popupWaitingForStorage = false;
                console.warn('[美化管理] 打开管理器前等待存储失败:', err);
            });
            return;
        }
        if (document.querySelector('.tm-overlay')) return;
        var schemeChanged = colorSchemeWatcher ? colorSchemeWatcher.check('manager-open') : false;
        clearTemporaryPairOverride();
        if (bindingController && !schemeChanged) bindingController.reconcile();
        injectStyles();
        cancelSearchDebounce();
        searchComposing = false;
        batchMode = false; batchSelected.clear(); batchDeleting = false; searchQuery = ''; searchOpen = false; sortOpen = false;
        expandedSeriesId = ''; seriesScrollPositions = {}; lastSeriesColumnCount = 0;

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
            '<div id="tm-popup-slot" style="position:absolute;inset:0;pointer-events:none;z-index:20;isolation:isolate;"></div>' +
            '</div>';

        document.body.appendChild(ov);
        bindSeriesResizeListener();
        syncManagerAppearance();
        bindManagerAppearanceObserver();

        // 防止悬浮球点击穿透：添加一个透明遮罩吸收残余触摸事件，400ms后移除
        var shield = document.createElement('div');
        shield.setAttribute('style', 'position:absolute;inset:0;z-index:999999;background:transparent;');
        shield.addEventListener('touchstart', function (e) { e.stopPropagation(); e.preventDefault(); }, { passive: false });
        shield.addEventListener('touchend', function (e) { e.stopPropagation(); e.preventDefault(); }, { passive: false });
        shield.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); }, { passive: false });
        ov.appendChild(shield);
        setTimeout(function () { if (shield.parentNode) shield.parentNode.removeChild(shield); }, 400);

        // 绑定事件
        var managerHead = ov.querySelector('.tm-head');
        ov.addEventListener('pointerdown', function (e) {
            if (!ov.classList.contains('tm-auto-hide-head')) return;
            if (managerHead.contains(e.target)) {
                if (!ov.classList.contains('tm-head-revealed')) {
                    ov.classList.add('tm-head-revealed');
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }
            ov.classList.remove('tm-head-revealed');
        }, true);
        managerHead.addEventListener('keydown', function (e) {
            if (!ov.classList.contains('tm-auto-hide-head')) return;
            if (e.key !== 'Enter' && e.key !== ' ') return;
            ov.classList.add('tm-head-revealed');
            e.preventDefault();
        });
        ov.querySelector('#tm-x').addEventListener('click', closePopup);
        ov.querySelector('#tm-theme-toggle').addEventListener('click', function () {
            var dd = load();
            if (dd.followThemeAppearance === true) {
                dd.followThemeAppearance = false;
                darkMode = ov.dataset.tmAppearanceMode !== 'dark';
                save(dd);
                toast('已切换为固定' + (darkMode ? '深色' : '浅色') + '，可在设置中恢复跟随');
            } else {
                darkMode = !darkMode;
            }
            syncManagerAppearance();
        });
        ov.querySelector('#tm-refresh').addEventListener('click', function () {
            cancelPendingGridRender();
            ov.querySelector('#tm-grid-area').innerHTML = '<div class="tm-loading"><i class="fa-solid fa-spinner"></i><span>正在刷新…</span></div>';
            fetchThemeList(function () { renderGrid(); renderBottomStatus(); });
        });

        // 搜索
        ov.querySelector('#tm-search-toggle').addEventListener('click', function () {
            searchOpen = !searchOpen;
            ov.querySelector('#tm-search-bar').classList.toggle('open', searchOpen);
            if (searchOpen) ov.querySelector('#tm-search-inp').focus();
            else { cancelSearchDebounce(); searchQuery = ''; ov.querySelector('#tm-search-inp').value = ''; renderGrid(); }
        });
        var sinp = ov.querySelector('#tm-search-inp');
        function scheduleSearchFromInput() {
            cancelSearchDebounce();
            cancelPendingGridRender();
            searchQuery = sinp.value.trim();
            searchDebounceTimer = setTimeout(function () {
                searchDebounceTimer = null;
                if (!searchComposing && document.querySelector('.tm-overlay')) renderGrid();
            }, SEARCH_DEBOUNCE_MS);
        }
        sinp.addEventListener('compositionstart', function () {
            searchComposing = true;
            cancelSearchDebounce();
            cancelPendingGridRender();
        });
        sinp.addEventListener('compositionend', function () {
            searchComposing = false;
            scheduleSearchFromInput();
        });
        sinp.addEventListener('input', function () {
            if (!searchComposing) scheduleSearchFromInput();
        });
        ov.querySelector('#tm-search-clear').addEventListener('click', function () {
            cancelSearchDebounce(); searchQuery = ''; sinp.value = ''; renderGrid(); sinp.focus();
        });
        sinp.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                cancelSearchDebounce(); searchComposing = false; searchOpen = false; searchQuery = '';
                sinp.value = ''; ov.querySelector('#tm-search-bar').classList.remove('open'); renderGrid();
            }
        });

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
            if (batchDeleting) return;
            batchMode = !batchMode; batchSelected.clear();
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
        var currentOverlay = document.querySelector('.tm-overlay');
        if (currentOverlay && uiSheetsApi && !uiSheetsApi.requestCloseAll(currentOverlay, 'manager-close')) return false;
        cancelSearchDebounce();
        searchComposing = false;
        cancelPendingGridRender();
        renderedCardsByKey = Object.create(null);
        renderedActiveItemKey = '';
        disconnectManagerAppearanceObserver();
        if (seriesGridResizeObserver) seriesGridResizeObserver.disconnect();
        seriesGridResizeObserver = null;
        if (seriesResizeTimer) clearTimeout(seriesResizeTimer);
        seriesResizeTimer = null;
        var ov = document.querySelector('.tm-overlay'); if (ov) ov.parentNode.removeChild(ov);
        return true;
    }

    // ── 分类栏 ───────────────────────────────────────────────
    function bindCatbarMouseScroll(catbar) {
        if (!catbar || catbar._tmMouseScrollBound) return;
        var drag = { down: false, moved: false, startX: 0, scrollLeft: 0 };

        function stopDrag() {
            if (!drag.down) return;
            drag.down = false;
            catbar.classList.remove('dragging');
            catbar.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            setTimeout(function () { drag.moved = false; }, 0);
        }
        function onMouseMove(e) {
            if (!drag.down) return;
            var dx = e.pageX - drag.startX;
            if (Math.abs(dx) > 3) drag.moved = true;
            if (drag.moved) e.preventDefault();
            catbar.scrollLeft = drag.scrollLeft - dx;
        }
        function onMouseUp() {
            stopDrag();
        }

        catbar.addEventListener('wheel', function (e) {
            var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (Math.abs(delta) <= 0) return;
            e.preventDefault();
            catbar.scrollLeft += delta;
        }, { passive: false });

        catbar.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            drag.down = true;
            drag.moved = false;
            drag.startX = e.pageX;
            drag.scrollLeft = catbar.scrollLeft;
            catbar.classList.add('dragging');
            catbar.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        catbar.addEventListener('click', function (e) {
            if (!drag.moved) return;
            e.preventDefault();
            e.stopPropagation();
        }, true);

        catbar._tmMouseScrollBound = true;
    }

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
        bindCatbarMouseScroll(catbar);
    }

    // ── 网格 ─────────────────────────────────────────────────
    function buildGridCardHtml(item, d, curTheme, view) {
        view = view || buildLibraryView(d);
        var meta = view.metaByKey[item.key] || getItemMeta(d, item);
        var displayTheme = getItemDisplayTheme(d, item);
        var variantMeta = d.themeMeta[displayTheme] || {};
        var isActive = isItemActive(item, curTheme);
        var selected = batchSelected.has(item.key);
        var checkBox = batchMode
            ? '<div class="tm-card-check' + (selected ? ' checked' : '') + '" data-key="' + esc(item.key) + '"><i class="fa-solid fa-check"></i></div>'
            : '';
        var badge = (isActive && !batchMode) ? '<div class="tm-badge-on"><i class="fa-solid fa-check"></i></div>' : '';
        var starBadge = (meta.starred && !batchMode) ? '<div class="tm-badge-star"><i class="fa-solid fa-star"></i></div>' : '';
        var freqBadge = (d.showFreq !== false && (meta.useCount || 0) > 5 && !batchMode)
            ? '<div class="tm-badge-freq">' + meta.useCount + '次</div>'
            : '';
        var previewAsset = imageToolsApi.resolvePreviewAsset(variantMeta);
        var previewImage = previewAsset.src;
        var previewView = previewAsset.view;
        var previewStyle = '--tm-image-focus-x:' + esc(previewView.posX) + '%;' +
            '--tm-image-focus-y:' + esc(previewView.posY) + '%;' +
            '--tm-image-zoom:' + esc(previewView.zoom) + ';';
        var imgContent = previewImage
            ? '<div class="tm-card-preview-slot" style="' + previewStyle + '">' +
                '<img src="' + esc(previewImage) + '" alt="' + esc(item.name) + '" loading="lazy" decoding="async" />' +
                '</div>'
            : '<div class="tm-card-noimg"><i class="fa-solid fa-palette"></i><span>' + esc(item.name.slice(0, 6)) + '</span></div>';
        var menuBtn = batchMode ? '' : '<button class="tm-card-menu" data-key="' + esc(item.key) + '" title="操作"><i class="fa-solid fa-ellipsis"></i></button>';
        var tagText = (meta.tags && meta.tags.length > 0) ? meta.tags.join(' · ') : (meta.author || '');

        return '<div class="tm-card' + (isActive ? ' on' : '') + (selected ? ' batch-sel' : '') + (previewImage ? '' : ' no-img') + '" data-key="' + esc(item.key) + '">' +
            '<div class="tm-card-img">' + checkBox + imgContent + badge + starBadge + freqBadge + menuBtn + '</div>' +
            '<div class="tm-card-info"><div class="tm-card-name">' + esc(item.name) + '</div>' +
            (tagText ? '<div class="tm-card-tag">' + esc(tagText) + '</div>' : '') +
            '</div></div>';
    }

    function buildSeriesLayoutUnits(d, sortedItems, cat, query, view) {
        view = view || buildLibraryView(d);
        var groups = view.seriesGroups;
        var membership = view.seriesMembership;
        var unitBySeries = {};
        var rawUnits = [];

        sortedItems.forEach(function (item) {
            var targetKey = item.kind === 'pair' ? 'pair:' + item.pairId : 'theme:' + item.themeName;
            var seriesId = targetKey ? membership[targetKey] : '';
            var group = seriesId ? groups[seriesId] : null;
            if (!group) {
                rawUnits.push({ type: 'item', item: item });
                return;
            }
            var unit = unitBySeries[group.id];
            if (!unit) {
                unit = { type: 'series', group: group, items: [] };
                unitBySeries[group.id] = unit;
                rawUnits.push(unit);
            }
            unit.items.push(item);
        });

        var filtered = rawUnits.filter(function (unit) {
            if (unit.type === 'item') {
                if (!displayCategoryMatches((view.metaByKey[unit.item.key] || {}).category, cat)) return false;
                return itemMatchesSearch(d, unit.item, query);
            }
            if (!displayCategoryMatches(unit.group.category, cat)) return false;
            if (!query) return true;
            var q = String(query).toLocaleLowerCase();
            return unit.group.name.toLowerCase().indexOf(q) !== -1 || unit.items.some(function (item) {
                return itemMatchesSearch(d, item, query);
            });
        });
        var displayedItems = [];
        filtered.forEach(function (unit) {
            if (unit.type === 'item') displayedItems.push(unit.item);
            else unit.items.forEach(function (item) { displayedItems.push(item); });
        });
        return { units: filtered, displayedItems: displayedItems };
    }

    function alignSeriesUnitsForGrid(units, columns) {
        var output = [];
        var rowCards = [];
        var deferredSeries = [];
        function flushRow() {
            rowCards.splice(0).forEach(function (unit) { output.push(unit); });
            deferredSeries.splice(0).forEach(function (unit) { output.push(unit); });
        }
        (units || []).forEach(function (unit) {
            if (unit.type === 'item') {
                rowCards.push(unit);
                if (rowCards.length >= columns) flushRow();
                return;
            }
            if (rowCards.length === 0) output.push(unit);
            else deferredSeries.push(unit);
        });
        if (rowCards.length > 0 || deferredSeries.length > 0) flushRow();
        return output;
    }

    function buildSeriesBlockHtml(unit, d, curTheme, view) {
        var group = unit.group;
        var expanded = expandedSeriesId === group.id;
        var controlId = 'tm-series-members-' + group.id;
        return '<section class="tm-series-block' + (expanded ? ' is-expanded' : '') + '" data-series-id="' + esc(group.id) + '">' +
            '<div class="tm-series-head">' +
            '<button type="button" class="tm-series-manage" data-series-id="' + esc(group.id) + '" title="管理系列">' +
            '<i class="fa-solid fa-layer-group"></i><span>' + esc(group.name) + '</span><small>' + group.members.length + ' 款</small></button>' +
            '<button type="button" class="tm-series-toggle" data-series-id="' + esc(group.id) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '" aria-controls="' + esc(controlId) + '" title="' + (expanded ? '收起系列' : '展开全系列') + '">' +
            '<i class="fa-solid fa-chevron-down"></i></button></div>' +
            '<div class="tm-series-track" id="' + esc(controlId) + '">' +
            unit.items.map(function (item) { return buildGridCardHtml(item, d, curTheme, view); }).join('') +
            '</div></section>';
    }

    function captureSeriesScrollPositions(area) {
        if (!area) return;
        area.querySelectorAll('.tm-series-block').forEach(function (block) {
            var track = block.querySelector('.tm-series-track');
            if (track && !block.classList.contains('is-expanded')) {
                seriesScrollPositions[block.dataset.seriesId] = track.scrollLeft;
            }
        });
    }

    function bindSeriesRailEvents(area) {
        if (!area) return;
        area.querySelectorAll('.tm-series-block').forEach(function (block) {
            if (block._tmSeriesRailEventsBound) return;
            block._tmSeriesRailEventsBound = true;
            var seriesId = block.dataset.seriesId;
            var track = block.querySelector('.tm-series-track');
            var savedLeft = Number(seriesScrollPositions[seriesId]) || 0;
            if (track && !block.classList.contains('is-expanded')) track.scrollLeft = savedLeft;

            var manage = block.querySelector('.tm-series-manage');
            if (manage) manage.addEventListener('click', function () { openSeriesManageSheet(seriesId); });
            var toggle = block.querySelector('.tm-series-toggle');
            if (toggle) toggle.addEventListener('click', function () {
                var opening = !block.classList.contains('is-expanded');
                var previous = area.querySelector('.tm-series-block.is-expanded');
                if (opening && previous && previous !== block) {
                    previous.classList.remove('is-expanded');
                    var previousToggle = previous.querySelector('.tm-series-toggle');
                    if (previousToggle) {
                        previousToggle.setAttribute('aria-expanded', 'false');
                        previousToggle.title = '展开全系列';
                    }
                    var previousTrack = previous.querySelector('.tm-series-track');
                    if (previousTrack) previousTrack.scrollLeft = Number(seriesScrollPositions[previous.dataset.seriesId]) || 0;
                }
                if (opening) {
                    if (track) seriesScrollPositions[seriesId] = track.scrollLeft;
                    block.classList.add('is-expanded');
                    expandedSeriesId = seriesId;
                } else {
                    block.classList.remove('is-expanded');
                    expandedSeriesId = '';
                    if (track) track.scrollLeft = Number(seriesScrollPositions[seriesId]) || 0;
                }
                toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
                toggle.title = opening ? '收起系列' : '展开全系列';
            });

            if (!track) return;
            track.addEventListener('scroll', function () {
                if (!block.classList.contains('is-expanded')) seriesScrollPositions[seriesId] = track.scrollLeft;
            }, { passive: true });
            var pointerStartX = 0;
            var pointerStartY = 0;
            var pointerStartScroll = 0;
            var pointerType = '';
            var moved = false;
            var guardUntil = 0;
            track.addEventListener('pointerdown', function (event) {
                if (block.classList.contains('is-expanded') || (event.pointerType === 'mouse' && event.button !== 0)) return;
                pointerStartX = event.clientX;
                pointerStartY = event.clientY;
                pointerStartScroll = track.scrollLeft;
                pointerType = event.pointerType;
                moved = false;
                if (pointerType === 'mouse') {
                    track.classList.add('is-dragging');
                    try { track.setPointerCapture(event.pointerId); } catch (e) {}
                }
            });
            track.addEventListener('pointermove', function (event) {
                if (!pointerType || block.classList.contains('is-expanded')) return;
                var dx = event.clientX - pointerStartX;
                var dy = event.clientY - pointerStartY;
                if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) moved = true;
                if (pointerType === 'mouse' && moved) {
                    event.preventDefault();
                    track.scrollLeft = pointerStartScroll - dx;
                }
            });
            function finishPointer(event) {
                if (moved || Math.abs(track.scrollLeft - pointerStartScroll) > 5) guardUntil = Date.now() + 260;
                if (event && pointerType === 'mouse') {
                    try { track.releasePointerCapture(event.pointerId); } catch (e) {}
                }
                pointerType = '';
                track.classList.remove('is-dragging');
            }
            track.addEventListener('pointerup', finishPointer);
            track.addEventListener('pointercancel', finishPointer);
            track.addEventListener('click', function (event) {
                if (Date.now() > guardUntil) return;
                event.preventDefault();
                event.stopPropagation();
            }, true);
            track.addEventListener('wheel', function (event) {
                if (block.classList.contains('is-expanded') || track.scrollWidth <= track.clientWidth) return;
                var delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
                if (!delta) return;
                var before = track.scrollLeft;
                track.scrollLeft += delta;
                if (track.scrollLeft !== before) event.preventDefault();
            }, { passive: false });
        });
    }

    function syncBatchActionState(d) {
        var count = document.getElementById('tm-batch-count');
        if (count) count.textContent = batchSelected.size;
        var pairButton = document.getElementById('tm-batch-day-night');
        if (pairButton) {
            pairButton.disabled = batchDeleting || batchSelected.size !== 2 || !getBatchSelectedKeys().every(function (key) {
                var item = getLogicalItem(key, d || load());
                return item && item.kind === 'theme';
            });
        }
        var seriesButton = document.getElementById('tm-batch-series');
        if (seriesButton) seriesButton.disabled = batchDeleting || batchSelected.size === 0;
    }

    function cancelSearchDebounce() {
        if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
    }

    function cancelPendingGridRender() {
        gridRenderGeneration += 1;
        if (gridRenderFrame !== null) {
            if (typeof global.cancelAnimationFrame === 'function') global.cancelAnimationFrame(gridRenderFrame);
            else clearTimeout(gridRenderFrame);
        }
        gridRenderFrame = null;
        gridRenderState = null;
    }

    function scheduleGridRenderChunk(state) {
        if (!state || state.generation !== gridRenderGeneration) return;
        var callback = function () {
            gridRenderFrame = null;
            appendGridRenderChunk(state);
        };
        gridRenderFrame = typeof global.requestAnimationFrame === 'function'
            ? global.requestAnimationFrame(callback)
            : setTimeout(callback, 0);
    }

    function gridUnitCardCount(unit) {
        return unit && unit.type === 'series' ? unit.items.length : 1;
    }

    function buildGridUnitHtml(unit, state) {
        return unit.type === 'series'
            ? buildSeriesBlockHtml(unit, state.data, state.currentTheme, state.view)
            : buildGridCardHtml(unit.item, state.data, state.currentTheme, state.view);
    }

    function registerRenderedCards(cards) {
        (cards || []).forEach(function (card) {
            if (card && card.dataset.key) renderedCardsByKey[card.dataset.key] = card;
        });
    }

    function finishGridRender(state) {
        if (!state || state.generation !== gridRenderGeneration) return;
        state.area.dataset.tmRenderComplete = 'true';
        state.area.dataset.tmRenderedCards = String(state.renderedCards);
        gridRenderState = null;
        gridRenderFrame = null;
        try {
            state.area.dispatchEvent(new CustomEvent('tm:grid-render-complete', {
                detail: { generation: state.generation, totalCards: state.renderedCards },
            }));
        } catch (e) {}
    }

    function appendGridRenderChunk(state) {
        if (!state || state.generation !== gridRenderGeneration ||
            document.getElementById('tm-grid-area') !== state.area || !state.area.isConnected) return;
        var html = '';
        var cardsInChunk = 0;
        var batchLimit = state.firstBatchDone ? GRID_RENDER_FOLLOWUP_BATCH_SIZE : GRID_RENDER_BATCH_SIZE;
        while (state.unitIndex < state.units.length && (cardsInChunk < batchLimit || cardsInChunk === 0)) {
            var unit = state.units[state.unitIndex++];
            html += buildGridUnitHtml(unit, state);
            cardsInChunk += gridUnitCardCount(unit);
        }
        if (state.generation !== gridRenderGeneration) return;
        var template = document.createElement('template');
        template.innerHTML = html;
        var cards = Array.from(template.content.querySelectorAll('.tm-card'));
        state.grid.appendChild(template.content);
        if (state.generation !== gridRenderGeneration || document.getElementById('tm-grid-area') !== state.area) return;
        registerRenderedCards(cards);
        state.renderedCards += cards.length;
        state.area.dataset.tmRenderedCards = String(state.renderedCards);
        if (!state.firstBatchDone) {
            state.firstBatchDone = true;
            state.area.dataset.tmFirstBatchReady = 'true';
            try {
                state.area.dispatchEvent(new CustomEvent('tm:grid-first-batch', {
                    detail: { generation: state.generation, renderedCards: state.renderedCards },
                }));
            } catch (e) {}
        }
        bindSeriesRailEvents(state.area);
        if (state.unitIndex < state.units.length) scheduleGridRenderChunk(state);
        else finishGridRender(state);
    }

    function updateActiveCardState(themeName) {
        var d = load();
        var view = buildLibraryView(d);
        var item = view.itemByThemeName[themeName] || null;
        if (gridRenderState) gridRenderState.currentTheme = themeName;
        function setCardActive(key, active) {
            var card = renderedCardsByKey[key];
            if (!card || !card.isConnected) return;
            card.classList.toggle('on', active);
            var badge = card.querySelector('.tm-badge-on');
            if (active && !batchMode && !badge) {
                badge = document.createElement('div');
                badge.className = 'tm-badge-on';
                badge.innerHTML = '<i class="fa-solid fa-check"></i>';
                var image = card.querySelector('.tm-card-img');
                if (image) image.appendChild(badge);
            } else if (!active && badge) badge.remove();
        }
        var nextKey = item ? item.key : '';
        if (renderedActiveItemKey && renderedActiveItemKey !== nextKey) setCardActive(renderedActiveItemKey, false);
        if (nextKey) setCardActive(nextKey, true);
        renderedActiveItemKey = item ? item.key : '';
    }

    function replaceRenderedCard(itemKey) {
        var oldCard = renderedCardsByKey[itemKey];
        if (!oldCard || !oldCard.isConnected) return false;
        var d = load();
        var view = buildLibraryView(d);
        var item = view.itemByKey[itemKey];
        if (!item) return false;
        var template = document.createElement('template');
        template.innerHTML = buildGridCardHtml(item, d, getCurrentThemeName(), view);
        var card = template.content.querySelector('.tm-card');
        if (!card) return false;
        oldCard.replaceWith(card);
        renderedCardsByKey[itemKey] = card;
        return true;
    }

    function refreshSingleItemCard(itemKey, effects) {
        effects = effects || {};
        var d = load();
        var mode = d.sortMode || 'name';
        var requiresLayout = effects.forceFull || effects.layout || effects.category || effects.name ||
            (effects.searchable && !!searchQuery) ||
            (effects.starred && mode === 'starred') ||
            (effects.recent && mode === 'recent') ||
            (effects.freq && mode === 'freq');
        if (requiresLayout || !replaceRenderedCard(itemKey)) renderGrid();
        else updateActiveCardState(getCurrentThemeName());
    }

    function bindGridDelegatedEvents(area) {
        if (!area || area._tmGridDelegatedBound) return;
        area.addEventListener('click', function (event) {
            var menu = event.target.closest('.tm-card-menu');
            if (menu && area.contains(menu)) {
                event.preventDefault();
                event.stopPropagation();
                if (!batchMode) openContextMenu(menu.dataset.key);
                return;
            }
            var card = event.target.closest('.tm-card');
            if (!card || !area.contains(card)) return;
            var key = card.dataset.key;
            if (batchMode) {
                if (batchDeleting) return;
                if (batchSelected.has(key)) batchSelected.delete(key); else batchSelected.add(key);
                var selected = batchSelected.has(key);
                var check = card.querySelector('.tm-card-check');
                if (check) check.classList.toggle('checked', selected);
                card.classList.toggle('batch-sel', selected);
                syncBatchActionState(load());
                return;
            }
            var d = load();
            var item = getLogicalItem(key, d);
            if (!item) return;
            if (item.kind === 'pair') clearTemporaryPairOverride();
            var themeName = getItemDisplayTheme(d, item);
            applyManualTheme(themeName, function (ok, reason) {
                if (ok) {
                    var dd = load();
                    var refreshedItem = getLogicalItem(item.key, dd);
                    var meta = refreshedItem ? getItemMetaForWrite(dd, refreshedItem) : null;
                    if (!meta) return;
                    meta.useCount = (meta.useCount || 0) + 1;
                    meta.lastUsed = Date.now();
                    save(dd);
                    toast('✅ 已应用：' + item.name);
                    refreshSingleItemCard(item.key, { recent: true, freq: true });
                    renderBottomStatus();
                    updateBtn();
                } else if (reason !== 'superseded') {
                    if (reason === 'incomplete') toast('主题尚未完整加载，不能安全切换', true);
                    else if (reason === 'load-failed') toast('主题加载失败，已保留当前主题', true);
                    else if (reason === 'state-verify-failed') toast('主题状态未能确认切换成功，未切换绑定背景', true);
                    else if (reason === 'verify-failed') toast('主题状态或视觉验证失败，未切换绑定背景', true);
                    else toast('切换失败，请重试', true);
                }
            });
        });
        area._tmGridDelegatedBound = true;
    }

    function renderGrid() {
        var area = document.getElementById('tm-grid-area'); if (!area) return;
        cancelPendingGridRender();
        var generation = gridRenderGeneration;
        var batchArea = document.getElementById('tm-batch-area');
        var d = load();
        var view = buildLibraryView(d);
        var curTheme = getCurrentThemeName();
        captureSeriesScrollPositions(area);
        applyGridCardSize(d.gridCardSize);

        var sortedItems = sortItems(view.items, d.sortMode || 'name', d, view);
        var layout = buildSeriesLayoutUnits(d, sortedItems, curCat, searchQuery, view);
        var metrics = getGridLayoutMetrics(area, d.gridCardSize);
        var units = alignSeriesUnitsForGrid(layout.units, metrics.columns);
        var list = layout.displayedItems;
        syncSeriesCardWidth(area, d.gridCardSize);

        if (batchArea) {
            if (batchMode) {
                var disabledAttr = batchDeleting ? ' disabled' : '';
                var pairReady = batchSelected.size === 2 && getBatchSelectedKeys().every(function (key) {
                    var selectedItem = getLogicalItem(key, d);
                    return selectedItem && selectedItem.kind === 'theme';
                });
                batchArea.style.display = '';
                batchArea.innerHTML = '<div class="tm-batch-bar"><span class="tm-batch-info">' +
                (batchDeleting ? '正在删除 <b>' + batchSelected.size + '</b> 个…' : '已选 <b id="tm-batch-count">' + batchSelected.size + '</b> 个') +
                '</span>' +
                '<div class="tm-batch-divider"></div>' +
                '<div class="tm-batch-acts">' +
                '<button class="tm-batch-btn" id="tm-batch-selall"' + disabledAttr + '>全选</button>' +
                '<button class="tm-batch-btn" id="tm-batch-none"' + disabledAttr + '>取消</button>' +
                '<button class="tm-batch-btn" id="tm-batch-cat"' + disabledAttr + '><i class="fa-solid fa-folder"></i> 分类</button>' +
                '<button class="tm-batch-btn" id="tm-batch-star"' + disabledAttr + '><i class="fa-solid fa-star"></i> 收藏</button>' +
                '<button class="tm-batch-btn" id="tm-batch-tag"' + disabledAttr + '><i class="fa-solid fa-tag"></i> 标签</button>' +
                '<button class="tm-batch-btn tm-batch-day-night" id="tm-batch-day-night"' +
                (batchDeleting || !pairReady ? ' disabled' : '') +
                '><i class="fa-solid fa-circle-half-stroke"></i> 日夜</button>' +
                '<button class="tm-batch-btn tm-batch-series" id="tm-batch-series"' +
                (batchDeleting || batchSelected.size === 0 ? ' disabled' : '') +
                '><i class="fa-solid fa-layer-group"></i> 系列</button>' +
                '<button class="tm-batch-btn danger" id="tm-batch-delete"' + disabledAttr + '><i class="fa-solid fa-trash"></i> 删除</button>' +
                '</div></div>';
            } else {
                batchArea.style.display = 'none';
                batchArea.innerHTML = '';
            }
        }

        if (list.length === 0) {
            area.innerHTML = '<div class="tm-grid"></div><div class="tm-empty"><i class="fa-solid fa-palette"></i><span>' +
                (searchQuery ? '没有匹配「' + esc(searchQuery) + '」的主题' : (curCat !== '__all__' ? '该分类暂无主题' : '没有找到主题，请点击底栏刷新按钮')) +
                '</span></div>';
            renderedCardsByKey = Object.create(null);
            renderedActiveItemKey = '';
            area.dataset.tmRenderGeneration = String(generation);
            area.dataset.tmFirstBatchReady = 'true';
            area.dataset.tmRenderComplete = 'true';
            area.dataset.tmRenderedCards = '0';
        } else {
            area.innerHTML = '<div class="tm-grid"></div>';
            renderedCardsByKey = Object.create(null);
            renderedActiveItemKey = (view.itemByThemeName[curTheme] || {}).key || '';
            area.dataset.tmRenderGeneration = String(generation);
            area.dataset.tmFirstBatchReady = 'false';
            area.dataset.tmRenderComplete = 'false';
            area.dataset.tmRenderedCards = '0';
            gridRenderState = {
                generation: generation,
                area: area,
                grid: area.querySelector('.tm-grid'),
                data: d,
                view: view,
                units: units,
                unitIndex: 0,
                renderedCards: 0,
                currentTheme: curTheme,
                firstBatchDone: false,
            };
            appendGridRenderChunk(gridRenderState);
        }
        bindGridDelegatedEvents(area);

        // 事件绑定
        if (batchMode) {
            var batchRoot = batchArea || area;
            var selall = batchRoot.querySelector('#tm-batch-selall');
            var selnone = batchRoot.querySelector('#tm-batch-none');
            if (selall) selall.addEventListener('click', function () {
                batchSelected = new Set(list.map(function (item) { return item.key; }));
                renderGrid();
            });
            if (selnone) selnone.addEventListener('click', function () { batchSelected.clear(); renderGrid(); });

            var bcatBtn = batchRoot.querySelector('#tm-batch-cat');
            if (bcatBtn) bcatBtn.addEventListener('click', function () {
                if (batchSelected.size === 0) { toast('请先选择主题', true); return; }
                var dd = load(); var cats = dd.categories || [];
                if (cats.length === 0) { toast('还没有分类，请先在设置中添加', true); return; }
                var msg = '选择分类（输入序号）：\n' + cats.map(function (n, i) { return (i + 1) + '. ' + n; }).join('\n');
                var choice = prompt(msg); if (choice === null) return;
                var ci = parseInt(choice) - 1;
                if (ci < 0 || ci >= cats.length) { toast('无效选择', true); return; }
                var selectedItems = getBatchSelectedKeys().map(function (key) { return getLogicalItem(key, dd); }).filter(Boolean);
                var selectedKeys = new Set();
                selectedItems.forEach(function (item) { selectedKeys.add(item.key); });
                var selectedGroups = {};
                selectedItems.forEach(function (item) {
                    var group = getSeriesForItem(dd, item);
                    if (group) selectedGroups[group.id] = group;
                });
                var incompleteGroup = '';
                getLogicalItems(dd).some(function (item) {
                    var owner = getSeriesForItem(dd, item);
                    if (!owner || !selectedGroups[owner.id] || selectedKeys.has(item.key)) return false;
                    incompleteGroup = owner.id;
                    return true;
                });
                if (incompleteGroup) {
                    toast('系列需要整组调整分类：请选中该系列全部成员，或点击系列标题修改展示分类', true);
                    return;
                }
                selectedItems.forEach(function (item) {
                    if (!getSeriesForItem(dd, item)) getItemMetaForWrite(dd, item).category = cats[ci];
                });
                Object.keys(selectedGroups).forEach(function (seriesId) {
                    seriesApi.setSeriesCategory(dd, seriesId, cats[ci]);
                });
                save(dd);
                toast('✅ 已将所选美化' + (Object.keys(selectedGroups).length ? '及系列' : '') + '移到「' + cats[ci] + '」');
                batchSelected.clear();
                renderCatbar();
                renderGrid();
            });

            var bstarBtn = batchRoot.querySelector('#tm-batch-star');
            if (bstarBtn) bstarBtn.addEventListener('click', function () {
                if (batchSelected.size === 0) { toast('请先选择主题', true); return; }
                var dd = load();
                batchSelected.forEach(function (key) {
                    var item = getLogicalItem(key, dd);
                    if (item) {
                        var m = getItemMetaForWrite(dd, item);
                        m.starred = !m.starred;
                    }
                });
                save(dd); toast('⭐ 已切换收藏'); batchSelected.clear(); renderGrid();
            });

            var btagBtn = batchRoot.querySelector('#tm-batch-tag');
            if (btagBtn) btagBtn.addEventListener('click', function () {
                if (batchSelected.size === 0) { toast('请先选择主题', true); return; }
                var tag = prompt('为所选主题添加标签：'); if (!tag || !tag.trim()) return; tag = tag.trim();
                var dd = load();
                batchSelected.forEach(function (key) {
                    var item = getLogicalItem(key, dd);
                    if (!item) return;
                    var m = getItemMetaForWrite(dd, item);
                    if (!Array.isArray(m.tags)) m.tags = [];
                    if (m.tags.indexOf(tag) === -1) m.tags.push(tag);
                });
                save(dd); toast('🏷️ 已添加标签：' + tag); batchSelected.clear(); renderGrid();
            });

            var dayNightBtn = batchRoot.querySelector('#tm-batch-day-night');
            if (dayNightBtn) dayNightBtn.addEventListener('click', function () {
                if (batchSelected.size !== 2) {
                    toast('请选择两个尚未组合的美化', true);
                    return;
                }
                var dd = load();
                var selectedItems = getBatchSelectedKeys().map(function (key) { return getLogicalItem(key, dd); }).filter(Boolean);
                if (selectedItems.length !== 2 || selectedItems.some(function (item) { return item.kind !== 'theme'; })) {
                    toast('已组成日夜美化的卡片不能再次组合', true);
                    return;
                }
                openDayNightPairSheet(selectedItems[0], selectedItems[1]);
            });

            var seriesBtn = batchRoot.querySelector('#tm-batch-series');
            if (seriesBtn) seriesBtn.addEventListener('click', function () {
                var dd = load();
                var selectedItems = getBatchSelectedKeys().map(function (key) { return getLogicalItem(key, dd); }).filter(Boolean);
                if (selectedItems.length === 0) { toast('请先选择美化', true); return; }
                openSeriesBatchSheet(selectedItems);
            });

            var bdeleteBtn = batchRoot.querySelector('#tm-batch-delete');
            if (bdeleteBtn) bdeleteBtn.addEventListener('click', function () {
                if (batchDeleting) return;
                if (batchSelected.size === 0) { toast('请先选择主题', true); return; }

                var selectedItems = getBatchSelectedKeys().map(function (key) { return getLogicalItem(key, d); }).filter(Boolean);
                var names = expandItemThemeNames(selectedItems);
                var deletingNameSet = new Set(names);
                var currentTheme = getCurrentThemeName();
                var deletingCurrent = deletingNameSet.has(currentTheme);
                var fallbackTheme = deletingCurrent
                    ? stThemeList.find(function (name) { return !deletingNameSet.has(name); })
                    : '';
                if (deletingCurrent && !fallbackTheme) {
                    toast('当前美化也在所选范围内，请至少保留一个可切换的美化', true);
                    return;
                }

                var shownNames = selectedItems.slice(0, 8).map(function (item) { return '• ' + item.name; }).join('\n');
                if (selectedItems.length > 8) shownNames += '\n…另有 ' + (selectedItems.length - 8) + ' 个';
                var message = '确定删除选中的 ' + selectedItems.length + ' 个美化？\n\n' + shownNames +
                    '\n\n这会从 SillyTavern 主题列表中真实删除，无法通过管理器撤销。';
                if (deletingCurrent) message += '\n当前美化将先切换为「' + fallbackTheme + '」。';
                if (!confirm(message)) return;

                batchDeleting = true;
                renderGrid();

                function finishDeleteStart() {
                    deleteThemesEverywhere(names, function (ok, outcome) {
                        batchDeleting = false;
                        if (!ok) {
                            renderGrid();
                            toast('批量删除后无法完成验证，本地标注未清理，请刷新后确认', true);
                            return;
                        }

                        batchSelected = new Set(outcome.failed.map(function (failedItem) {
                            var logical = getLogicalItem(failedItem.name, load());
                            return logical ? logical.key : '';
                        }).filter(function (key) { return !!key; }));
                        renderGrid();
                        if (outcome.failed.length > 0) {
                            toast('已删除 ' + outcome.removed.length + ' 个；未删除 ' + outcome.failed.length + ' 个：' +
                                outcome.failed.map(function (item) { return item.name; }).join('、'), true);
                        } else {
                            toast('✅ 已删除 ' + outcome.removed.length + ' 个美化');
                        }
                    });
                }

                if (!deletingCurrent) {
                    finishDeleteStart();
                    return;
                }

                applyTheme(fallbackTheme, function (ok, reason) {
                    if (!ok) {
                        batchDeleting = false;
                        renderGrid();
                        if (reason !== 'superseded') toast('无法安全切换当前美化，批量删除已取消', true);
                        return;
                    }
                    renderGrid();
                    renderBottomStatus();
                    updateBtn();
                    finishDeleteStart();
                });
            });

        }
    }

    function seriesCategoryOptions(d, selected) {
        var html = '<option value=""' + (!selected ? ' selected' : '') + '>未分类</option>';
        (d.categories || []).forEach(function (category) {
            html += '<option value="' + esc(category) + '"' + (category === selected ? ' selected' : '') + '>' + esc(category) + '</option>';
        });
        html += '<option value="__new__">+ 新建分类…</option>';
        return html;
    }

    function resolveSeriesCategory(sheet, d) {
        var select = sheet.querySelector('.tm-series-category-select');
        if (!select) return '';
        var category = select.value;
        if (category !== '__new__') return category;
        var input = sheet.querySelector('.tm-series-new-category');
        category = input ? input.value.trim() : '';
        return category || null;
    }

    function bindSeriesCategorySelect(sheet) {
        var select = sheet.querySelector('.tm-series-category-select');
        var wrap = sheet.querySelector('.tm-series-new-category-wrap');
        if (!select || !wrap) return;
        function sync() { wrap.style.display = select.value === '__new__' ? '' : 'none'; }
        select.addEventListener('change', sync);
        sync();
    }

    function buildSeriesSelectedPreview(items) {
        return '<div class="tm-series-selected-list">' + items.map(function (item) {
            return '<span><i class="fa-solid ' + (item.kind === 'pair' ? 'fa-circle-half-stroke' : 'fa-palette') + '"></i>' + esc(item.name) + '</span>';
        }).join('') + '</div>';
    }

    function suggestedSeriesName(items) {
        var base = items && items[0] ? String(items[0].name || '').trim() : '';
        return (base ? base.slice(0, 48) + ' ' : '') + '系列';
    }

    function openSeriesBatchSheet(items) {
        if (!seriesApi) { toast('系列模块尚未就绪', true); return; }
        var d = load();
        var targets = [];
        var targetKeys = new Set();
        var ownerIds = [];
        var ownerIdSet = new Set();
        items.forEach(function (item) {
            var target = getItemTarget(item);
            var key = seriesApi.targetKey(target);
            if (key && !targetKeys.has(key)) { targetKeys.add(key); targets.push(target); }
            var owner = getSeriesForItem(d, item);
            if (owner && !ownerIdSet.has(owner.id)) { ownerIdSet.add(owner.id); ownerIds.push(owner.id); }
        });
        if (ownerIds.length > 1) {
            toast('所选美化分属不同系列，请先移出后再重新组合', true);
            return;
        }
        if (ownerIds.length === 1) {
            var ownerGroup = seriesApi.getSeries(d, ownerIds[0]);
            var membership = buildLibraryView(d).seriesMembership;
            var additions = targets.filter(function (target) { return !membership[seriesApi.targetKey(target)]; });
            var additionKeys = new Set(additions.map(function (target) { return seriesApi.targetKey(target); }));
            if (additions.length === 0) {
                openSeriesManageSheet(ownerGroup.id);
                return;
            }
            var additionItems = items.filter(function (item) {
                return additionKeys.has(seriesApi.targetKey(getItemTarget(item)));
            });
            var addSheet = createSheet([
                '<div class="tm-sheet-title"><i class="fa-solid fa-layer-group"></i>加入现有系列</div>',
                '<div class="tm-hint">以下美化会加入「' + esc(ownerGroup.name) + '」；已有成员不会重复添加。</div>',
                buildSeriesSelectedPreview(additionItems),
                '<div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" id="tm-series-add-cancel">取消</button><button class="tm-btn tm-btn-safe" id="tm-series-add-save">确认加入</button></div>',
            ].join(''));
            addSheet.querySelector('#tm-series-add-cancel').addEventListener('click', function () { closeSheet(addSheet); });
            addSheet.querySelector('#tm-series-add-save').addEventListener('click', function () {
                var dd = load();
                var result = seriesApi.addMembers(dd, ownerGroup.id, additions);
                if (!result.ok) { toast('系列关系已变化，请刷新后重试', true); return; }
                save(dd);
                batchSelected.clear();
                closeSheet(addSheet);
                renderGrid();
                toast('✅ 已加入「' + ownerGroup.name + '」');
            });
            return;
        }

        var groups = seriesApi.listSeries(d);
        if (items.length < 2 && groups.length === 0) {
            toast('创建系列至少需要选择两个美化', true);
            return;
        }
        var commonCategory = '';
        if (curCat !== '__all__' && curCat !== '__uncategorized__') commonCategory = curCat;
        else if (items.length > 0) {
            var firstCategory = getItemMeta(d, items[0]).category || '';
            if (items.every(function (item) { return (getItemMeta(d, item).category || '') === firstCategory; })) commonCategory = firstCategory;
        }
        var operationOptions = '<option value="new">创建新系列</option>' + groups.map(function (group) {
            return '<option value="' + esc(group.id) + '">加入「' + esc(group.name) + '」</option>';
        }).join('');
        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-layer-group"></i>保存为系列</div>',
            '<div class="tm-hint tm-series-hint">系列只收纳展示关系，不会复制或修改真实美化；解散系列也不会删除成员。成员顺序始终跟随当前排序。</div>',
            buildSeriesSelectedPreview(items),
            '<div class="tm-field"><label>操作</label><select id="tm-series-operation">' + operationOptions + '</select></div>',
            '<div id="tm-series-create-fields">' +
            '<div class="tm-field"><label>系列名称</label><input type="text" id="tm-series-name" maxlength="80" value="' + esc(suggestedSeriesName(items)) + '" /></div>' +
            '<div class="tm-field"><label>展示分类</label><select class="tm-series-category-select">' + seriesCategoryOptions(d, commonCategory) + '</select></div>' +
            '<div class="tm-field tm-series-new-category-wrap" style="display:none"><label>新分类名称</label><input type="text" class="tm-series-new-category" maxlength="40" /></div>' +
            '</div>',
            '<div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" id="tm-series-create-cancel">取消</button><button class="tm-btn tm-btn-safe" id="tm-series-create-save">保存系列</button></div>',
        ].join(''));
        var operation = sheet.querySelector('#tm-series-operation');
        var createFields = sheet.querySelector('#tm-series-create-fields');
        var saveButton = sheet.querySelector('#tm-series-create-save');
        if (items.length < 2 && groups.length > 0) operation.value = groups[0].id;
        function syncOperation() {
            var creating = operation.value === 'new';
            createFields.style.display = creating ? '' : 'none';
            saveButton.textContent = creating ? '保存系列' : '确认加入';
        }
        operation.addEventListener('change', syncOperation);
        syncOperation();
        bindSeriesCategorySelect(sheet);
        sheet.querySelector('#tm-series-create-cancel').addEventListener('click', function () { closeSheet(sheet); });
        saveButton.addEventListener('click', function () {
            var dd = load();
            var result;
            if (operation.value === 'new') {
                if (targets.length < 2) { toast('创建系列至少需要两个美化', true); return; }
                var name = sheet.querySelector('#tm-series-name').value.trim();
                if (!name) { toast('请输入系列名称', true); return; }
                if (seriesApi.listSeries(dd).some(function (group) { return group.name === name; })) {
                    toast('已有同名系列，请换一个名称', true);
                    return;
                }
                var category = resolveSeriesCategory(sheet, dd);
                if (category === null) { toast('请输入新分类名称', true); return; }
                result = seriesApi.createSeries(dd, { name: name, category: category, members: targets });
            } else {
                result = seriesApi.addMembers(dd, operation.value, targets);
            }
            if (!result.ok) {
                toast(result.reason === 'already-series' ? '其中一个美化已经属于其他系列' : '无法保存系列，请重试', true);
                return;
            }
            if (category && dd.categories.indexOf(category) === -1) dd.categories.push(category);
            save(dd);
            batchSelected.clear();
            closeSheet(sheet);
            renderCatbar();
            renderGrid();
            toast(operation.value === 'new' ? '✅ 已创建系列' : '✅ 已加入系列');
        });
    }

    function getSeriesMemberView(d, target) {
        var view = buildLibraryView(d);
        var item = target.kind === 'day-night'
            ? view.pairById[target.pairId]
            : view.itemByThemeName[target.themeName];
        if (item) return { name: item.name, kind: item.kind, available: true };
        return {
            name: target.kind === 'day-night' ? ('日夜组合 ' + target.pairId) : target.themeName,
            kind: target.kind === 'day-night' ? 'pair' : 'theme',
            available: false,
        };
    }

    function openSeriesManageSheet(seriesId) {
        if (!seriesApi) return;
        var d = load();
        var group = seriesApi.getSeries(d, seriesId);
        if (!group) { toast('这个系列已经不存在', true); renderGrid(); return; }
        var memberHtml = group.members.map(function (target, index) {
            var view = getSeriesMemberView(d, target);
            return '<div class="tm-series-member-row" data-member-index="' + index + '">' +
                '<i class="fa-solid ' + (view.kind === 'pair' ? 'fa-circle-half-stroke' : 'fa-palette') + '"></i>' +
                '<div><strong>' + esc(view.name) + '</strong>' + (view.available ? '' : '<small>当前主题列表中不可用</small>') + '</div>' +
                '<button type="button" class="tm-btn-sm tm-series-member-remove" data-member-index="' + index + '" title="移出系列"><i class="fa-solid fa-xmark"></i></button></div>';
        }).join('');
        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-layer-group"></i>管理系列</div>',
            '<div class="tm-field"><label>系列名称</label><input type="text" id="tm-series-manage-name" maxlength="80" value="' + esc(group.name) + '" /></div>',
            '<div class="tm-field"><label>展示分类</label><select class="tm-series-category-select">' + seriesCategoryOptions(d, group.category) + '</select></div>',
            '<div class="tm-field tm-series-new-category-wrap" style="display:none"><label>新分类名称</label><input type="text" class="tm-series-new-category" maxlength="40" /></div>',
            '<div class="tm-sec-title">成员 · ' + group.members.length + ' 款</div>',
            '<div class="tm-hint">这里只管理收纳关系；移出、解散都不会删除真实美化。</div>',
            '<div class="tm-series-member-list">' + memberHtml + '</div>',
            '<div class="tm-edit-foot tm-series-manage-actions"><button class="tm-btn tm-btn-danger" id="tm-series-dissolve">解散系列</button><span></span><button class="tm-btn tm-btn-outline" id="tm-series-manage-cancel">取消</button><button class="tm-btn tm-btn-safe" id="tm-series-manage-save">保存修改</button></div>',
        ].join(''));
        bindSeriesCategorySelect(sheet);
        sheet.querySelector('#tm-series-manage-cancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#tm-series-manage-save').addEventListener('click', function () {
            var dd = load();
            var current = seriesApi.getSeries(dd, seriesId);
            if (!current) { closeSheet(sheet); toast('这个系列已经不存在', true); renderGrid(); return; }
            var name = sheet.querySelector('#tm-series-manage-name').value.trim();
            if (!name) { toast('请输入系列名称', true); return; }
            if (seriesApi.listSeries(dd).some(function (other) { return other.id !== seriesId && other.name === name; })) {
                toast('已有同名系列，请换一个名称', true);
                return;
            }
            var category = resolveSeriesCategory(sheet, dd);
            if (category === null) { toast('请输入新分类名称', true); return; }
            seriesApi.renameSeries(dd, seriesId, name);
            seriesApi.setSeriesCategory(dd, seriesId, category);
            if (category && dd.categories.indexOf(category) === -1) dd.categories.push(category);
            save(dd);
            closeSheet(sheet);
            renderCatbar();
            renderGrid();
            toast('✅ 已保存系列');
        });
        sheet.querySelector('#tm-series-dissolve').addEventListener('click', function () {
            if (!confirm('解散系列「' + group.name + '」？\n所有真实美化都会保留。')) return;
            var dd = load();
            seriesApi.dissolveSeries(dd, seriesId);
            save(dd);
            if (expandedSeriesId === seriesId) expandedSeriesId = '';
            closeSheet(sheet);
            renderGrid();
            toast('已解散系列，美化均已保留');
        });
        sheet.querySelectorAll('.tm-series-member-remove').forEach(function (button) {
            button.addEventListener('click', function () {
                var index = parseInt(button.dataset.memberIndex, 10);
                var target = group.members[index];
                if (!target) return;
                if (group.members.length <= 2 && !confirm('移出后系列将自动解散，所有真实美化仍会保留。是否继续？')) return;
                var dd = load();
                var result = seriesApi.removeMember(dd, seriesId, target);
                if (!result.ok) { toast('成员关系已变化，请刷新后重试', true); return; }
                save(dd);
                closeSheet(sheet);
                if (result.dissolved) {
                    if (expandedSeriesId === seriesId) expandedSeriesId = '';
                    renderGrid();
                    toast('系列已自动解散，美化均已保留');
                } else {
                    renderGrid();
                    toast('已移出系列');
                    openSeriesManageSheet(seriesId);
                }
            });
        });
    }

    function openDayNightPairSheet(firstItem, secondItem) {
        if (!pairsApi || !firstItem || !secondItem || firstItem.kind !== 'theme' || secondItem.kind !== 'theme') return;
        var d = load();
        var dayTheme = firstItem.themeName;
        var nightTheme = secondItem.themeName;
        var suggestedName = pairsApi.suggestPairName(dayTheme, nightTheme);

        function optionHtml(selected) {
            return [firstItem, secondItem].map(function (item) {
                return '<option value="' + esc(item.themeName) + '"' + (item.themeName === selected ? ' selected' : '') + '>' +
                    esc(item.name) + '</option>';
            }).join('');
        }

        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-circle-half-stroke"></i>组成日夜美化</div>',
            '<div class="tm-hint tm-day-night-hint">保存后两张卡片会合并成一个美化；系统浅色模式使用日间版，深色模式使用夜间版。</div>',
            '<div class="tm-field"><label>合并后的名称</label><input type="text" id="tm-pair-name" maxlength="80" value="' + esc(suggestedName) + '" placeholder="例如：春日花园" /></div>',
            '<div class="tm-day-night-assign">',
            '<div class="tm-day-night-choice is-day"><div class="tm-day-night-choice-label"><i class="fa-solid fa-sun"></i><span>日间版本</span></div><select id="tm-pair-day">' + optionHtml(dayTheme) + '</select></div>',
            '<button type="button" class="tm-day-night-swap" id="tm-pair-swap" title="交换日夜" aria-label="交换日间和夜间版本">' +
            '<svg class="tm-day-night-swap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12m0 0-3-3m3 3-3 3M18 17H6m0 0 3 3m-3-3 3-3"></path></svg></button>',
            '<div class="tm-day-night-choice is-night"><div class="tm-day-night-choice-label"><i class="fa-solid fa-moon"></i><span>夜间版本</span></div><select id="tm-pair-night">' + optionHtml(nightTheme) + '</select></div>',
            '</div>',
            '<div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" id="tm-pair-cancel">取消</button><button class="tm-btn tm-btn-safe" id="tm-pair-save">保存组合</button></div>',
        ].join(''));

        var daySelect = sheet.querySelector('#tm-pair-day');
        var nightSelect = sheet.querySelector('#tm-pair-night');
        function keepDistinct(changed) {
            if (daySelect.value !== nightSelect.value) return;
            var other = changed === daySelect ? nightSelect : daySelect;
            other.value = changed.value === firstItem.themeName ? secondItem.themeName : firstItem.themeName;
        }
        daySelect.addEventListener('change', function () { keepDistinct(daySelect); });
        nightSelect.addEventListener('change', function () { keepDistinct(nightSelect); });
        sheet.querySelector('#tm-pair-swap').addEventListener('click', function () {
            var previous = daySelect.value;
            daySelect.value = nightSelect.value;
            nightSelect.value = previous;
        });
        sheet.querySelector('#tm-pair-cancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#tm-pair-save').addEventListener('click', function () {
            var name = sheet.querySelector('#tm-pair-name').value.trim();
            if (!name) { toast('请输入合并后的名称', true); return; }
            if (daySelect.value === nightSelect.value) { toast('日间版和夜间版不能是同一个美化', true); return; }
            var currentData = load();
            var duplicate = getLogicalItems(currentData).some(function (item) {
                return item.key !== firstItem.key && item.key !== secondItem.key && item.name === name;
            });
            if (duplicate) { toast('已有同名美化，请换一个名称', true); return; }
            if (seriesApi) {
                var firstSeries = seriesApi.findSeriesByTarget(currentData, { kind: 'theme', themeName: daySelect.value });
                var secondSeries = seriesApi.findSeriesByTarget(currentData, { kind: 'theme', themeName: nightSelect.value });
                if (firstSeries && secondSeries && firstSeries.id !== secondSeries.id) {
                    toast('这两个美化分属不同系列，请先移出其中一个再组成日夜美化', true);
                    return;
                }
            }
            var result = pairsApi.createPair(currentData, {
                name: name,
                dayTheme: daySelect.value,
                nightTheme: nightSelect.value,
            });
            if (!result.ok) {
                toast(result.reason === 'already-paired' ? '其中一个美化已经属于日夜组合' : '无法保存日夜组合', true);
                return;
            }
            if (seriesApi) {
                var seriesMerge = seriesApi.mergeThemeTargetsIntoPair(
                    currentData,
                    [result.pair.dayTheme, result.pair.nightTheme],
                    result.pair.id
                );
                if (!seriesMerge.ok) {
                    pairsApi.dissolvePair(currentData, result.pair.id);
                    toast('系列关系发生变化，日夜组合未保存，请重试', true);
                    return;
                }
            }
            if (bindingsApi) {
                bindingsApi.mergeThemeReferencesIntoPair(
                    currentData,
                    [result.pair.dayTheme, result.pair.nightTheme],
                    result.pair.id
                );
            }
            save(currentData);
            batchSelected.clear();
            closeSheet(sheet);
            renderCatbar();
            renderGrid();
            renderBottomStatus();
            toast('☀️🌙 已合并为「' + name + '」');
        });
    }

    function dissolveDayNightPair(pairId, sheet) {
        var d = load();
        var pair = pairsApi.getPair(d, pairId);
        if (!pair) return;
        var preferredTheme = pairsApi.getVariantTheme(d, pairId, getPreferredPairVariant(pairId));
        var replacementTheme = stThemeList.indexOf(preferredTheme) !== -1
            ? preferredTheme
            : (stThemeList.indexOf(pair.dayTheme) !== -1 ? pair.dayTheme : (stThemeList.indexOf(pair.nightTheme) !== -1 ? pair.nightTheme : ''));
        if (seriesApi) {
            var seriesResult = seriesApi.replacePairReference(d, pairId, [pair.dayTheme, pair.nightTheme]);
            if (!seriesResult.ok) {
                toast('这组日夜美化与其他系列存在成员冲突，请先整理系列关系后再解除', true);
                return;
            }
        }
        pairsApi.dissolvePair(d, pairId);
        if (bindingsApi) bindingsApi.replacePairReferences(d, pairId, replacementTheme);
        save(d);
        clearTemporaryPairOverride();
        if (sheet) closeSheet(sheet);
        renderCatbar();
        renderGrid();
        renderBottomStatus();
        toast('已解除日夜组合，两个美化均已保留');
    }

    function deleteDayNightPair(pairId, sheet) {
        var d = load();
        var pair = pairsApi.getPair(d, pairId);
        if (!pair) return;
        var names = [pair.dayTheme, pair.nightTheme].filter(function (name) {
            return stThemeList.indexOf(name) !== -1;
        });
        if (names.length === 0) {
            dissolveDayNightPair(pairId, sheet);
            return;
        }
        var currentTheme = getCurrentThemeName();
        var deletingCurrent = names.indexOf(currentTheme) !== -1;
        var fallbackTheme = deletingCurrent
            ? stThemeList.find(function (name) { return names.indexOf(name) === -1; })
            : '';
        if (deletingCurrent && !fallbackTheme) {
            toast('请至少保留一个可切换的美化后再删除这组日夜美化', true);
            return;
        }
        if (sheet) closeSheet(sheet);

        function startDelete() {
            deleteThemesEverywhere(names, function (ok, outcome) {
                if (!ok) {
                    toast('删除后无法完成验证，日夜关系与本地标注已保留', true);
                    return;
                }
                if (outcome.failed.length > 0) {
                    toast('已删除 ' + outcome.removed.length + ' 个；未删除：' +
                        outcome.failed.map(function (item) { return item.name; }).join('、'), true);
                } else {
                    toast('已删除日夜组合及两个真实美化');
                }
            });
        }

        if (!deletingCurrent) {
            startDelete();
            return;
        }
        applyTheme(fallbackTheme, function (ok, reason) {
            if (!ok) {
                if (reason !== 'superseded') toast('无法安全切换当前美化，删除已取消', true);
                return;
            }
            startDelete();
        });
    }

    function openDayNightDeleteSheet(pairId) {
        var d = load();
        var pair = pairsApi.getPair(d, pairId);
        if (!pair) return;
        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-circle-half-stroke"></i>管理日夜组合</div>',
            '<div class="tm-hint">「解除组合」只拆开关系并保留两个真实美化；「删除整组」会在 SillyTavern 中真实删除日间版和夜间版。</div>',
            '<div class="tm-day-night-members"><span><i class="fa-solid fa-sun"></i>' + esc(pair.dayTheme) + '</span><span><i class="fa-solid fa-moon"></i>' + esc(pair.nightTheme) + '</span></div>',
            '<div class="tm-edit-foot tm-day-night-delete-actions"><button class="tm-btn tm-btn-outline" id="tm-pair-manage-cancel">取消</button><button class="tm-btn tm-btn-outline" id="tm-pair-dissolve">解除组合</button><button class="tm-btn tm-btn-danger" id="tm-pair-delete-all">删除整组</button></div>',
        ].join(''));
        sheet.querySelector('#tm-pair-manage-cancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#tm-pair-dissolve').addEventListener('click', function () {
            dissolveDayNightPair(pairId, sheet);
        });
        sheet.querySelector('#tm-pair-delete-all').addEventListener('click', function () {
            deleteDayNightPair(pairId, sheet);
        });
    }

    // ── 底栏状态 ─────────────────────────────────────────────
    function renderBottomStatus() {
        var el = document.getElementById('tm-bottom-status'); if (!el) return;
        var curTheme = getCurrentThemeName();
        var dotClass = curTheme ? 'green' : 'gray';
        var item = curTheme ? getLogicalItem(curTheme, load()) : null;
        var text = item ? item.name : (curTheme || '未选择主题');
        el.innerHTML = '<div class="tm-status-dot ' + dotClass + '"></div><span class="tm-status-text">' + esc(text) + '</span>';
    }

    // ── 操作菜单 ─────────────────────────────────────────────
    function openContextMenu(itemRef) {
        var d = load();
        var item = getLogicalItem(itemRef, d);
        if (!item) return;
        var meta = getItemMeta(d, item);
        var themeName = getItemDisplayTheme(d, item);
        var curTheme = getCurrentThemeName();
        var isActive = isItemActive(item, curTheme);
        var imgThemes = stThemeList.filter(function (n) { var m = d.themeMeta[n]; return m && (m.imageData || m.thumbData); });
        var variantMeta = d.themeMeta[themeName] || {};
        var itemLabel = item.name;

        var sheet = createSheet([
            '<div class="tm-ctx-theme-name"><i class="fa-solid fa-palette" style="margin-right:6px;opacity:.5;"></i>' + esc(itemLabel) + '</div>',
            isActive
                ? '<div class="tm-ctx-item" style="opacity:.5"><i class="fa-solid fa-circle-check"></i>当前正在使用</div>'
                : '<div class="tm-ctx-item" id="tm-ctx-apply"><i class="fa-solid fa-circle-check"></i>应用美化</div>',
            (variantMeta.imageData || variantMeta.thumbData) ? '<div class="tm-ctx-item" id="tm-ctx-view"><i class="fa-solid fa-expand"></i>查看截图</div>' : '',
            variantMeta.backgroundName ? '<div class="tm-ctx-item" style="opacity:.75"><i class="fa-solid fa-image"></i>背景：' + esc(variantMeta.backgroundName) + '</div>' : '',
            '<div class="tm-ctx-item" id="tm-ctx-star"><i class="fa-solid fa-star"></i>' + (meta.starred ? '取消收藏' : '加入收藏') + '</div>',
            '<div class="tm-ctx-item" id="tm-ctx-edit"><i class="fa-solid fa-pen"></i>编辑信息</div>',
            '<div class="tm-ctx-item" id="tm-ctx-bind"><i class="fa-solid fa-link"></i>角色 / 聊天绑定</div>',
            '<div class="tm-ctx-item" id="tm-ctx-rename"><i class="fa-solid fa-i-cursor"></i>' + (item.kind === 'pair' ? '修改组合名称' : '重命名美化') + '</div>',
            item.kind === 'pair'
                ? '<div class="tm-ctx-item danger" id="tm-ctx-delete"><i class="fa-solid fa-circle-half-stroke"></i>解除或删除日夜组合</div>'
                : '<div class="tm-ctx-item danger" id="tm-ctx-delete"><i class="fa-solid fa-trash"></i>删除美化</div>',
        ].join(''));

        var applyEl = sheet.querySelector('#tm-ctx-apply');
        if (applyEl) applyEl.addEventListener('click', function () {
            closeSheet(sheet);
            if (item.kind === 'pair') clearTemporaryPairOverride();
            themeName = getItemDisplayTheme(load(), item);
            applyManualTheme(themeName, function (ok, reason) {
                if (ok) {
                    var dd = load();
                    var refreshed = getLogicalItem(item.key, dd);
                    var m = refreshed ? getItemMetaForWrite(dd, refreshed) : null;
                    if (!m) return;
                    m.useCount = (m.useCount || 0) + 1;
                    m.lastUsed = Date.now();
                    save(dd);
                    toast('✅ 已应用：' + itemLabel);
                    refreshSingleItemCard(item.key, { recent: true, freq: true });
                    renderBottomStatus(); updateBtn();
                }
                else if (reason !== 'superseded') {
                    if (reason === 'incomplete') toast('主题尚未完整加载，不能安全切换', true);
                    else if (reason === 'load-failed') toast('主题加载失败，已保留当前主题', true);
                    else if (reason === 'state-verify-failed') toast('主题状态未能确认切换成功，未切换绑定背景', true);
                    else if (reason === 'verify-failed') toast('主题状态或视觉验证失败，未切换绑定背景', true);
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
            var dd = load();
            var refreshed = getLogicalItem(item.key, dd);
            var m = refreshed ? getItemMetaForWrite(dd, refreshed) : null;
            if (!m) return;
            m.starred = !m.starred;
            save(dd); toast(m.starred ? '⭐ 已收藏' : '已取消收藏');
            refreshSingleItemCard(item.key, { starred: true });
        });

        sheet.querySelector('#tm-ctx-edit').addEventListener('click', function () {
            closeSheet(sheet);
            openEditSheet(item.key);
        });

        sheet.querySelector('#tm-ctx-bind').addEventListener('click', function () {
            closeSheet(sheet);
            openBindingSheet(item.key);
        });

        sheet.querySelector('#tm-ctx-rename').addEventListener('click', function () {
            var newName = prompt(item.kind === 'pair' ? '新的组合名称：' : '新的美化名称：', itemLabel);
            if (newName === null) return;
            newName = newName.trim();
            if (!newName || newName === itemLabel) return;
            closeSheet(sheet);
            if (item.kind === 'pair') {
                var pairData = load();
                var duplicate = getLogicalItems(pairData).some(function (other) {
                    return other.key !== item.key && other.name === newName;
                });
                if (duplicate) { toast('已有同名美化', true); return; }
                if (pairsApi.renamePair(pairData, item.pairId, newName)) {
                    save(pairData);
                    renderGrid();
                    renderBottomStatus();
                    toast('已修改日夜美化名称');
                }
                return;
            }
            renameThemeEverywhere(themeName, newName, function (ok, reason) {
                if (ok) toast('已重命名美化');
                else if (reason === 'duplicate') toast('已有同名美化', true);
                else if (reason === 'filename-conflict') toast('名称经酒馆文件名清理后与已有主题冲突', true);
                else if (reason === 'invalid-filename') toast('该名称无法生成有效的主题文件名', true);
                else if (reason === 'incomplete') toast('主题尚未完整加载，不能安全改名', true);
                else if (reason === 'verify-failed') toast('新主题最终验证失败，改名已回滚并保留旧主题', true);
                else if (reason === 'delete-failed') toast('旧主题删除或最终验证失败，改名已回滚', true);
                else if (reason === 'rollback-failed') toast('改名失败且自动回滚未完成，请立即检查主题文件', true);
                else if (reason === 'inventory-failed') toast('无法刷新主题列表，未执行改名', true);
                else toast('重命名失败，旧主题已保留', true);
            });
        });

        sheet.querySelector('#tm-ctx-delete').addEventListener('click', function () {
            if (item.kind === 'pair') {
                closeSheet(sheet);
                openDayNightDeleteSheet(item.pairId);
                return;
            }
            if (!confirm('删除美化「' + themeName + '」？\n这会从 SillyTavern 主题列表中真实删除，不只是从插件移除。')) return;
            closeSheet(sheet);
            deleteThemeEverywhere(themeName, function (ok) {
                if (ok) toast('已删除美化');
                else toast('删除失败', true);
            });
        });
    }

    // ── 角色 / 聊天绑定 ──────────────────────────────────────
    function openBindingSheet(itemRef, onChange) {
        if (!bindingController || !bindingsApi) {
            toast('绑定模块尚未就绪', true);
            return;
        }

        var data = load();
        var item = getLogicalItem(itemRef, data);
        if (!item) {
            toast('找不到要绑定的美化', true);
            return;
        }
        var target = getItemTarget(item);
        var current = bindingController.getCurrentState();
        var info = current.context;

        function bindingLabel(record) {
            if (!record) return '';
            var recordTarget = bindingsApi.getTarget(record);
            if (!recordTarget) return '';
            if (recordTarget.kind === 'day-night') {
                var pair = pairsApi.getPair(load(), recordTarget.pairId);
                return pair ? pair.name : '已失效的日夜组合';
            }
            return recordTarget.themeName || '';
        }

        function buildBindingCard(scope, title, icon, available, label, record) {
            var boundTarget = record ? bindingsApi.getTarget(record) : null;
            var boundLabel = bindingLabel(record);
            var isThisTheme = bindingsApi.targetsEqual(boundTarget, target);
            var status = boundLabel
                ? ('已绑定：' + esc(boundLabel))
                : '尚未绑定';
            var actionLabel = boundLabel
                ? (isThisTheme ? '已绑定此美化' : '改绑为此美化')
                : '绑定此美化';
            var priorityOn = current.resolution.scope === scope;
            return '<div class="tm-binding-card' + (priorityOn ? ' is-active' : '') + '">' +
                '<div class="tm-binding-head"><i class="fa-solid ' + icon + '"></i><div><strong>' + title + '</strong>' +
                '<small>' + (available ? esc(label) : (scope === 'chat' ? '当前没有可绑定的聊天窗口' : '群聊或主页不提供单角色绑定')) + '</small></div>' +
                (priorityOn ? '<span>当前生效</span>' : '') + '</div>' +
                '<div class="tm-binding-status">' + status + '</div>' +
                '<div class="tm-binding-actions">' +
                '<button class="tm-btn tm-btn-safe" data-binding-action="bind" data-binding-scope="' + scope + '"' +
                (!available || isThisTheme ? ' disabled' : '') + '>' + actionLabel + '</button>' +
                (boundLabel ? '<button class="tm-btn tm-btn-outline" data-binding-action="clear" data-binding-scope="' + scope + '">解除绑定</button>' : '') +
                '</div></div>';
        }

        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-link"></i>绑定：' + esc(item.name) + '</div>',
            '<div class="tm-hint tm-binding-hint">切换聊天时自动应用；聊天绑定优先于角色绑定，离开绑定范围后恢复最后一次手动选择的美化。</div>',
            buildBindingCard(
                'character',
                '当前角色卡',
                'fa-user',
                !info.isGroup && !!info.characterKey,
                info.characterLabel || info.characterKey,
                current.character
            ),
            buildBindingCard(
                'chat',
                '当前聊天窗口',
                'fa-message',
                !!(info.chatKey && info.chatId),
                info.chatLabel || info.chatId,
                current.chat
            ),
            '<div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" id="tm-binding-close">关闭</button></div>',
        ].join(''));

        sheet.querySelector('#tm-binding-close').addEventListener('click', function () {
            closeSheet(sheet);
        });

        sheet.querySelectorAll('[data-binding-action]').forEach(function (button) {
            button.addEventListener('click', function () {
                var scope = button.dataset.bindingScope;
                var action = button.dataset.bindingAction;
                var result = action === 'bind'
                    ? bindingController.bindCurrent(scope, target)
                    : bindingController.unbindCurrent(scope);
                if (!result || !result.ok) {
                    var reason = result && result.reason;
                    if (reason === 'no-character') toast('当前不是可绑定的单角色聊天', true);
                    else if (reason === 'no-chat') toast('当前聊天尚未完整加载，请稍后再试', true);
                    else toast('绑定操作失败，请重试', true);
                    return;
                }
                closeSheet(sheet);
                renderGrid();
                renderBottomStatus();
                if (typeof onChange === 'function') onChange();
                if (action === 'bind') {
                    toast(scope === 'chat' ? '已绑定到当前聊天' : '已绑定到当前角色卡');
                } else {
                    toast(scope === 'chat' ? '已解除当前聊天绑定' : '已解除当前角色绑定');
                }
            });
        });
    }

    function openBindingsOverviewSheet(itemRef, onChange) {
        if (!bindingController || !bindingsApi) {
            toast('绑定模块尚未就绪', true);
            return;
        }

        var item = getLogicalItem(itemRef, load());
        if (!item) {
            toast('找不到要查看的美化', true);
            return;
        }

        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-link"></i>绑定信息：' + esc(item.name) + '</div>',
            '<div class="tm-hint tm-bindings-all-hint">这里可以查看并解除这个美化的全部绑定；新增或改绑当前角色、聊天，请使用卡片右上角的三个点菜单。</div>',
            '<div id="tm-bindings-all-body"></div>',
            '<div class="tm-edit-foot tm-bindings-all-foot"><button class="tm-btn tm-btn-danger" id="tm-bindings-clear-all">解除全部</button><button class="tm-btn tm-btn-outline" id="tm-bindings-all-close">关闭</button></div>',
        ].join(''));
        var body = sheet.querySelector('#tm-bindings-all-body');
        var clearAllButton = sheet.querySelector('#tm-bindings-clear-all');

        function sectionHtml(scope, title, icon, references) {
            if (!references.length) return '';
            return '<section class="tm-bindings-all-section"><div class="tm-bindings-all-head"><span><i class="fa-solid ' + icon + '"></i>' + title + '</span><small>' + references.length + ' 项</small></div>' +
                '<div class="tm-bindings-all-list">' + references.map(function (reference) {
                    return '<div class="tm-bindings-all-row"><div class="tm-bindings-all-icon"><i class="fa-solid ' + icon + '"></i></div>' +
                        '<div class="tm-bindings-all-copy"><strong title="' + esc(reference.label) + '">' + esc(reference.label) + '</strong><small>' + (scope === 'character' ? '角色卡' : '聊天窗口') + '</small></div>' +
                        '<button type="button" class="tm-bindings-all-remove" data-binding-scope="' + scope + '" data-binding-key="' + esc(reference.key) + '">解除</button></div>';
                }).join('') + '</div></section>';
        }

        function refreshAfterRemoval(message) {
            bindingController.reconcile();
            renderGrid();
            renderBottomStatus();
            if (typeof onChange === 'function') onChange();
            render();
            toast(message);
        }

        function render() {
            var currentData = load();
            var currentItem = getLogicalItem(itemRef, currentData);
            if (!currentItem) {
                closeSheet(sheet);
                if (typeof onChange === 'function') onChange();
                return;
            }
            var target = getItemTarget(currentItem);
            var refs = bindingsApi.listTargetReferences(currentData, target);
            var total = refs.characters.length + refs.chats.length;
            body.innerHTML = total
                ? sectionHtml('character', '角色卡', 'fa-user', refs.characters) + sectionHtml('chat', '聊天窗口', 'fa-message', refs.chats)
                : '<div class="tm-bindings-all-empty"><i class="fa-solid fa-link-slash"></i><strong>尚无绑定</strong><span>这个美化还没有绑定角色卡或聊天窗口</span></div>';
            clearAllButton.hidden = total < 2;

            body.querySelectorAll('.tm-bindings-all-remove').forEach(function (button) {
                button.addEventListener('click', function () {
                    var data = load();
                    var latestItem = getLogicalItem(itemRef, data);
                    var latestTarget = latestItem ? getItemTarget(latestItem) : null;
                    if (!latestTarget || !bindingsApi.targetsEqual(latestTarget, target)) {
                        render();
                        toast('这项绑定已经发生变化，请重新查看', true);
                        return;
                    }
                    var removed = bindingsApi.removeTargetReference(
                        data,
                        button.dataset.bindingScope,
                        button.dataset.bindingKey,
                        target
                    );
                    if (!removed) {
                        render();
                        toast('这项绑定已经发生变化，请重新查看', true);
                        return;
                    }
                    save(data);
                    refreshAfterRemoval('已解除这项绑定');
                });
            });
        }

        clearAllButton.addEventListener('click', function () {
            var currentData = load();
            var currentItem = getLogicalItem(itemRef, currentData);
            if (!currentItem) {
                render();
                return;
            }
            var target = getItemTarget(currentItem);
            var refs = bindingsApi.listTargetReferences(currentData, target);
            var total = refs.characters.length + refs.chats.length;
            if (!total) {
                render();
                return;
            }
            if (!confirm('解除美化「' + currentItem.name + '」的全部 ' + total + ' 项角色 / 聊天绑定？')) return;
            var removed = bindingsApi.removeTargetReferences(currentData, target);
            if (!removed) {
                render();
                toast('绑定已经发生变化，请重新查看', true);
                return;
            }
            save(currentData);
            refreshAfterRemoval('已解除全部绑定');
        });

        sheet.querySelector('#tm-bindings-all-close').addEventListener('click', function () {
            closeSheet(sheet);
        });
        render();
    }

    // ── 编辑主题附加信息 ─────────────────────────────────────
    function openEditSheet(itemRef) {
        var d = load();
        var item = getLogicalItem(itemRef, d);
        if (!item) return;
        var pair = item.kind === 'pair' ? pairsApi.getPair(d, item.pairId) : null;
        var meta = getItemMeta(d, item);
        var originalEditName = item.name;
        var originalEditCategory = meta.category || '';
        var selectedVariant = pair
            ? (pair.nightTheme === getCurrentThemeName() ? 'night' : (pair.dayTheme === getCurrentThemeName() ? 'day' : getPreferredPairVariant(pair.id)))
            : 'day';
        var variantDrafts = {};
        if (pair) {
            ['day', 'night'].forEach(function (variant) {
                var name = variant === 'night' ? pair.nightTheme : pair.dayTheme;
                var variantMeta = peekMeta(d, name);
                variantDrafts[variant] = {
                    themeName: name,
                    imageData: variantMeta.imageData || null,
                    thumbData: variantMeta.thumbData || null,
                    crop: variantMeta.crop || null,
                    backgroundName: variantMeta.backgroundName || '',
                };
            });
        } else {
            var ordinaryMeta = peekMeta(d, item.themeName);
            variantDrafts.day = {
                themeName: item.themeName,
                imageData: ordinaryMeta.imageData || null,
                thumbData: ordinaryMeta.thumbData || null,
                crop: ordinaryMeta.crop || null,
                backgroundName: ordinaryMeta.backgroundName || '',
            };
        }
        var activeDraft = variantDrafts[selectedVariant] || variantDrafts.day;
        var themeName = activeDraft.themeName;
        var editImgData = activeDraft.imageData;
        var editThumbData = activeDraft.thumbData;
        var editCrop = activeDraft.crop;
        var editPreviewData = editImgData || editThumbData;
        var editTags = (meta.tags || []).slice();
        var editBackgroundName = activeDraft.backgroundName;
        var itemTarget = getItemTarget(item);
        function buildBindingsOverviewHtml() {
            var refs = bindingsApi ? bindingsApi.listTargetReferences(load(), itemTarget) : { characters: [], chats: [] };
            var total = refs.characters.length + refs.chats.length;
            var summary = total
                ? (refs.characters.length ? refs.characters.length + ' 个角色' : '') +
                    (refs.characters.length && refs.chats.length ? ' · ' : '') +
                    (refs.chats.length ? refs.chats.length + ' 个聊天' : '')
                : '尚未绑定角色卡或聊天';
            return '<span class="tm-theme-bind-icon"><i class="fa-solid fa-link"></i></span>' +
                '<span class="tm-theme-bind-copy"><strong>角色 / 聊天绑定</strong><small>' + summary + '</small></span>' +
                '<i class="fa-solid fa-chevron-right tm-theme-bind-chevron"></i>';
        }
        var catOpts = '<option value="">无分类</option>' +
            d.categories.map(function (c) { return '<option value="' + esc(c) + '"' + (meta.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');

        var sheet = createSheet([
            '<div class="tm-sheet-title tm-edit-sheet-title"><span><i class="fa-solid fa-pen"></i>编辑：<b id="tm-edit-title-name">' + esc(item.name) + '</b></span>' +
            (pair ? '<div class="tm-day-night-toggle" role="group" aria-label="切换日夜版本">' +
                '<button type="button" data-variant="day" class="' + (selectedVariant === 'day' ? 'on' : '') + '" title="编辑并应用日间版"><i class="fa-solid fa-sun"></i></button>' +
                '<button type="button" data-variant="night" class="' + (selectedVariant === 'night' ? 'on' : '') + '" title="编辑并应用夜间版"><i class="fa-solid fa-moon"></i></button>' +
                '</div>' : '') + '</div>',
            pair ? '<div class="tm-field"><label>美化名称</label><input type="text" id="tm-pair-edit-name" maxlength="80" value="' + esc(pair.name) + '" /></div>' : '',
            '<div class="tm-field"><label>分类</label><div class="tm-frow"><select id="tm-dcat">' + catOpts + '</select><button class="tm-btn tm-btn-outline" id="tm-dnewcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
            '<div class="tm-field"><label>绑定背景</label><button type="button" class="tm-bg-bind-card" id="tm-bg-bind">' + buildBackgroundBindHtml(editBackgroundName) + '</button></div>',
            '<div class="tm-field"><label>绑定范围</label><button type="button" class="tm-theme-bind-card" id="tm-theme-bind-overview">' + buildBindingsOverviewHtml() + '</button></div>',
            '<div class="tm-field"><label>作者</label><input type="text" id="tm-dauthor" placeholder="主题作者名" value="' + esc(meta.author || '') + '" /></div>',
            '<div class="tm-field"><label>备注</label><textarea id="tm-ddesc" rows="2" placeholder="主题特点、适用场景等">' + esc(meta.description || '') + '</textarea></div>',
            '<div class="tm-field"><label>标签</label><div class="tm-tags-wrap" id="tm-tags-wrap"></div>' +
            '<div class="tm-tag-add-row"><input type="text" id="tm-tag-inp" placeholder="输入标签后回车" /><button class="tm-btn tm-btn-outline" id="tm-tag-add" style="font-size:.8em;padding:6px 10px">添加</button></div></div>',
            '<div class="tm-field"><label>预览截图</label>' +
            '<div class="tm-imgarea" id="tm-dimgarea">' + (editPreviewData ? '<img src="' + esc(editPreviewData) + '" />' : '<div class="tm-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传截图</span></div>') + '</div>' +
            '<input type="file" id="tm-dfile" accept="image/*" style="display:none" />' +
            '<div class="tm-img-actions"></div></div>',
            '<div class="tm-edit-foot"><button class="tm-btn tm-btn-outline" id="tm-dcancel">取消</button><button class="tm-btn tm-btn-safe" id="tm-dsave">保存</button></div>',
        ].join(''));

        function renderBackgroundBind() {
            sheet.querySelector('#tm-bg-bind').innerHTML = buildBackgroundBindHtml(editBackgroundName);
        }
        sheet.querySelector('#tm-bg-bind').addEventListener('click', function () {
            openBackgroundPickerSheet(editBackgroundName, function (name) {
                if (!editorSession || !editorSession.isActive() || editorSession.isSaving()) return;
                editBackgroundName = name || '';
                renderBackgroundBind();
            });
        });
        function renderBindingsOverview() {
            var button = sheet.querySelector('#tm-theme-bind-overview');
            if (button) button.innerHTML = buildBindingsOverviewHtml();
        }
        sheet.querySelector('#tm-theme-bind-overview').addEventListener('click', function () {
            openBindingsOverviewSheet(item.key, renderBindingsOverview);
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
        var imgActions = sheet.querySelector('.tm-img-actions');
        function renderImageActions() {
            var hasImage = Boolean(editImgData || editThumbData);
            imgActions.innerHTML = '<button class="tm-btn tm-btn-outline" id="tm-dpick" style="font-size:.8em"><i class="fa-solid fa-image"></i> 选择图片</button>' +
                (hasImage ? '<button class="tm-btn tm-btn-outline" id="tm-dadjust" style="font-size:.8em"><i class="fa-solid fa-up-down-left-right"></i> 调整显示区域</button>' +
                    '<button class="tm-btn tm-btn-danger" id="tm-dclr" style="font-size:.8em">删除图片</button>' : '');
        }
        function setImg(data, thumb, crop) {
            editImgData = data || null;
            editThumbData = thumb || null;
            editCrop = crop || null;
            var preview = editImgData || editThumbData;
            imgArea.innerHTML = preview ? '<img src="' + esc(preview) + '" />' : '<div class="tm-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传截图</span></div>';
            renderImageActions();
        }
        function captureVariantDraft() {
            var draft = variantDrafts[selectedVariant];
            if (!draft) return;
            draft.imageData = editImgData;
            draft.thumbData = editThumbData;
            draft.crop = editCrop;
            draft.backgroundName = editBackgroundName;
        }
        function captureEditSnapshot() {
            captureVariantDraft();
            return {
                pairName: pair ? sheet.querySelector('#tm-pair-edit-name').value.trim() : '',
                category: sheet.querySelector('#tm-dcat').value,
                author: sheet.querySelector('#tm-dauthor').value.trim(),
                description: sheet.querySelector('#tm-ddesc').value.trim(),
                tags: editTags.slice(),
                variants: cloneJson(variantDrafts),
            };
        }
        function loadVariantDraft(variant) {
            var draft = variantDrafts[variant];
            if (!draft) return;
            selectedVariant = variant;
            themeName = draft.themeName;
            editBackgroundName = draft.backgroundName || '';
            editImgData = draft.imageData || null;
            editThumbData = draft.thumbData || null;
            editCrop = draft.crop || null;
            renderBackgroundBind();
            setImg(editImgData, editThumbData, editCrop);
            sheet.querySelectorAll('.tm-day-night-toggle button').forEach(function (button) {
                button.classList.toggle('on', button.dataset.variant === variant);
            });
        }
        if (pair) {
            sheet.querySelectorAll('.tm-day-night-toggle button').forEach(function (button) {
                button.addEventListener('click', function () {
                    var variant = button.dataset.variant === 'night' ? 'night' : 'day';
                    if (variant === selectedVariant) return;
                    captureVariantDraft();
                    loadVariantDraft(variant);
                    setTemporaryPairOverride(pair.id, variant);
                    applyManualTheme(themeName, function (ok, reason) {
                        if (ok) {
                            renderGrid();
                            renderBottomStatus();
                            updateBtn();
                        } else if (reason !== 'superseded') {
                            toast('无法应用' + (variant === 'night' ? '夜间版' : '日间版') + '，当前美化已保留', true);
                        }
                    });
                });
            });
            var pairNameInput = sheet.querySelector('#tm-pair-edit-name');
            if (pairNameInput) pairNameInput.addEventListener('input', function () {
                var title = sheet.querySelector('#tm-edit-title-name');
                if (title) title.textContent = pairNameInput.value.trim() || pair.name;
            });
        }
        function handleFile(f) {
            if (!f || f.type.indexOf('image') !== 0) return;
            var r = new FileReader();
            r.onload = function (e) {
                if (!editorSession || !editorSession.isActive() || editorSession.isSaving()) return;
                compressImage(e.target.result, function (c) {
                    if (!editorSession || !editorSession.isActive() || editorSession.isSaving()) return;
                    openImageCropSheet(c, null, function (res) {
                        if (!editorSession || !editorSession.isActive() || editorSession.isSaving()) return;
                        setImg(res.imageData, res.thumbData, res.crop);
                    });
                });
            };
            r.readAsDataURL(f);
        }
        function adjustCurrentImage() {
            var source = editImgData || editThumbData;
            if (!source) return;
            openImageCropSheet(source, editCrop, function (res) {
                if (!editorSession || !editorSession.isActive() || editorSession.isSaving()) return;
                setImg(res.imageData, res.thumbData, res.crop);
            });
        }
        renderImageActions();
        imgActions.addEventListener('click', function (e) {
            var button = e.target && e.target.closest ? e.target.closest('button') : null;
            if (!button || !imgActions.contains(button)) return;
            if (button.id === 'tm-dpick') fileInp.click();
            else if (button.id === 'tm-dadjust') adjustCurrentImage();
            else if (button.id === 'tm-dclr') setImg(null, null, null);
        });
        imgArea.addEventListener('click', function () { fileInp.click(); });
        fileInp.addEventListener('change', function () {
            if (fileInp.files[0]) handleFile(fileInp.files[0]);
            fileInp.value = '';
        });
        imgArea.addEventListener('dragover', function (e) { e.preventDefault(); imgArea.classList.add('drag'); });
        imgArea.addEventListener('dragleave', function () { imgArea.classList.remove('drag'); });
        imgArea.addEventListener('drop', function (e) { e.preventDefault(); imgArea.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

        sheet.querySelector('#tm-dnewcat').addEventListener('click', function () {
            var name = prompt('新分类名称：'); if (!name || !name.trim()) return; name = name.trim();
            var dd = load(); if (dd.categories.indexOf(name) === -1) { dd.categories.push(name); save(dd); renderCatbar(); }
            var sel2 = sheet.querySelector('#tm-dcat');
            var ex = false; for (var i = 0; i < sel2.options.length; i++) { if (sel2.options[i].value === name) { ex = true; break; } }
            if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel2.appendChild(opt); }
            sel2.value = name; toast('分类「' + name + '」已添加');
        });

        var editorSession = editorDraftApi.createSession(captureEditSnapshot());
        function setEditorSaving(saving) {
            sheet.querySelectorAll('input,select,textarea,button').forEach(function (control) {
                if (control.id !== 'tm-dcancel') control.disabled = saving;
            });
            var button = sheet.querySelector('#tm-dsave');
            if (button) button.textContent = saving ? '保存中...' : '保存';
        }
        uiSheetsApi.setBeforeClose(sheet, function () {
            var dirty = editorSession.isDirty(captureEditSnapshot());
            if (!dirty && !editorSession.isSaving()) {
                editorSession.invalidate();
                return true;
            }
            if (editorSession.isSaving()) {
                toast('美化仍在保存处理中，请等待完成后再关闭', true);
                return false;
            }
            var message = '当前修改尚未保存，是否放弃修改？';
            if (!confirm(message)) return false;
            editorSession.invalidate();
            return true;
        });
        sheet.querySelector('#tm-dcancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#tm-dsave').addEventListener('click', function () {
            var saveBtn = sheet.querySelector('#tm-dsave');
            var snapshot = captureEditSnapshot();
            var pairName = snapshot.pairName;
            if (pair && !pairName) { toast('美化名称不能为空', true); return; }
            if (pair) {
                var duplicate = getLogicalItems(load()).some(function (other) {
                    return other.key !== item.key && other.name === pairName;
                });
                if (duplicate) { toast('已有同名美化，请换一个名称', true); return; }
            }
            var saveTicket = editorSession.beginSave(snapshot);
            if (!saveTicket) return;
            setEditorSaving(true);

            function uploadDraft(draft, callback) {
                uploadImage(draft.imageData, function (imgErr, imgUrl) {
                    if (imgErr) { callback(imgErr); return; }
                    uploadImage(draft.thumbData, function (thumbErr, thumbUrl) {
                        if (thumbErr) { callback(thumbErr); return; }
                        callback(null, {
                            themeName: draft.themeName,
                            imageData: imgUrl || draft.imageData || null,
                            thumbData: draft.thumbData ? (thumbUrl || draft.thumbData) : null,
                            crop: draft.crop || null,
                            backgroundName: draft.backgroundName || '',
                        });
                    });
                });
            }

            var draftKeys = pair ? ['day', 'night'] : ['day'];
            var uploaded = {};
            var remaining = draftKeys.length;
            var uploadFailed = false;
            draftKeys.forEach(function (variant) {
                uploadDraft(saveTicket.snapshot.variants[variant], function (err, result) {
                    if (!editorSession.isCurrent(saveTicket.token) || uploadFailed) return;
                    if (err) {
                        uploadFailed = true;
                        editorSession.failSave(saveTicket.token);
                        setEditorSaving(false);
                        toast('图片处理失败，草稿仍保留，请重试', true);
                        return;
                    }
                    uploaded[variant] = result;
                    remaining -= 1;
                    if (remaining === 0) finishSave();
                });
            });

            function finishSave() {
                if (!editorSession.isCurrent(saveTicket.token)) return;
                var dd = cloneJson(load());
                var refreshedItem = getLogicalItem(item.key, dd);
                if (!refreshedItem) {
                    editorSession.failSave(saveTicket.token);
                    setEditorSaving(false);
                    toast('美化已发生变化，请关闭后重试', true);
                    return;
                }
                var shared = getItemMetaForWrite(dd, refreshedItem);
                shared.category = saveTicket.snapshot.category;
                shared.author = saveTicket.snapshot.author;
                shared.description = saveTicket.snapshot.description;
                shared.tags = saveTicket.snapshot.tags.slice();
                if (refreshedItem.kind === 'pair') {
                    pairsApi.renamePair(dd, refreshedItem.pairId, pairName);
                    ['day', 'night'].forEach(function (variant) {
                        var result = uploaded[variant];
                        var variantMeta = ensureMeta(dd, result.themeName);
                        variantMeta.backgroundName = result.backgroundName;
                        variantMeta.imageData = result.imageData;
                        variantMeta.thumbData = result.thumbData;
                        variantMeta.crop = result.crop;
                    });
                } else {
                    var ordinary = uploaded.day;
                    shared.backgroundName = ordinary.backgroundName;
                    shared.imageData = ordinary.imageData;
                    shared.thumbData = ordinary.thumbData;
                    shared.crop = ordinary.crop;
                }
                var persist;
                try {
                    persist = save(dd);
                } catch (err) {
                    editorSession.failSave(saveTicket.token);
                    setEditorSaving(false);
                    toast('保存失败，草稿仍保留，请重试', true);
                    return;
                }
                Promise.resolve(persist).then(function () {
                    if (!editorSession.completeSave(saveTicket.token, saveTicket.snapshot)) return;
                    closeSheet(sheet, { force: true });
                    var editEffects = {
                        name: refreshedItem.name !== originalEditName || (refreshedItem.kind === 'pair' && pairName !== originalEditName),
                        category: shared.category !== originalEditCategory,
                        searchable: true,
                        layout: refreshedItem.kind === 'pair' && pairName !== originalEditName,
                    };
                    var currentTheme = getCurrentThemeName();
                    if (refreshedItem.themeNames.indexOf(currentTheme) !== -1) {
                        applyBoundBackground(currentTheme, function () {
                            toast('✨ 已保存');
                            renderCatbar(); refreshSingleItemCard(item.key, editEffects); renderBottomStatus();
                        });
                    } else {
                        toast('✨ 已保存');
                        renderCatbar(); refreshSingleItemCard(item.key, editEffects);
                    }
                }).catch(function () {
                    if (!editorSession.failSave(saveTicket.token)) return;
                    setEditorSaving(false);
                    toast('保存失败，草稿仍保留，请重试', true);
                });
            }
        });
    }

    function mergeImportedAnnotations(imported) {
        var dd = load();
        var importedCount = 0;
        var importedBindingCount = 0;
        var importedPairCount = 0;
        var importedSeriesCount = 0;
        var skippedImportedSeriesCount = 0;
        var importedPairIdMap = {};
        var skippedImportedPairIds = {};
        var relationshipDiagnostics = [];

        if (imported.categories) imported.categories.forEach(function (c) { if (dd.categories.indexOf(c) === -1) dd.categories.push(c); });
        for (var k in imported.themeMeta) {
            var imp = imported.themeMeta[k] || {};
            if (!dd.themeMeta[k]) {
                dd.themeMeta[k] = imp;
                if (!Array.isArray(dd.themeMeta[k].tags)) dd.themeMeta[k].tags = [];
                if (dd.themeMeta[k].thumbData === undefined) dd.themeMeta[k].thumbData = null;
                if (dd.themeMeta[k].crop === undefined) dd.themeMeta[k].crop = null;
            } else {
                var existing = ensureMeta(dd, k);
                if (!Array.isArray(existing.tags)) existing.tags = [];
                imageToolsApi.mergeMissingPreview(existing, imp);
                if (!existing.category && imp.category) existing.category = imp.category;
                if (!existing.backgroundName && imp.backgroundName) existing.backgroundName = imp.backgroundName;
                if (imp.tags) imp.tags.forEach(function (t) { if (existing.tags.indexOf(t) === -1) existing.tags.push(t); });
                if (!existing.author && imp.author) existing.author = imp.author;
                if (!existing.description && imp.description) existing.description = imp.description;
            }
            importedCount++;
        }
        if (pairsApi && imported.dayNight) {
            var rawPairs = imported.dayNight.pairs || imported.dayNight;
            var pairOutcome = pairsApi.importPairs(dd, rawPairs, stThemeList);
            importedPairCount = pairOutcome.imported;
            importedPairIdMap = pairOutcome.idMap || {};
            (pairOutcome.skippedIds || []).forEach(function (id) { skippedImportedPairIds[id] = true; });
            relationshipDiagnostics = relationshipDiagnostics.concat(pairOutcome.diagnostics || []);
        }
        if (seriesApi && imported.series && typeof imported.series === 'object') {
            var importedGroups = imported.series.groups || imported.series;
            var seriesOutcome = seriesApi.importSeries(dd, importedGroups, {
                availableThemeNames: stThemeList,
                availablePairIds: Object.keys(pairsApi.ensureState(dd).pairs),
                pairIdMap: importedPairIdMap,
                skippedPairIds: Object.keys(skippedImportedPairIds),
                requirePairIdMap: true,
            });
            importedSeriesCount = seriesOutcome.imported;
            skippedImportedSeriesCount = seriesOutcome.skipped;
            relationshipDiagnostics = relationshipDiagnostics.concat(seriesOutcome.diagnostics || []);
        }
        if (bindingsApi && imported.bindings && typeof imported.bindings === 'object') {
            var importedBindingData = { bindings: cloneJson(imported.bindings) };
            var sourceBindings = bindingsApi.ensureState(importedBindingData);
            var targetBindings = bindingsApi.ensureState(dd);
            ['characters', 'chats'].forEach(function (scope) {
                Object.keys(sourceBindings[scope]).forEach(function (key) {
                    var record = sourceBindings[scope][key];
                    var target = bindingsApi.getTarget(record);
                    if (target && target.kind === 'day-night') {
                        if (importedPairIdMap[target.pairId]) target.pairId = importedPairIdMap[target.pairId];
                        else if (skippedImportedPairIds[target.pairId]) return;
                        if (!pairsApi.getPair(dd, target.pairId)) return;
                    }
                    targetBindings[scope][key] = record;
                    importedBindingCount += 1;
                });
            });
            if (!targetBindings.manualTarget && sourceBindings.manualTarget) {
                var manualTarget = bindingsApi.normalizeTarget(sourceBindings.manualTarget);
                if (manualTarget && manualTarget.kind === 'day-night') {
                    if (importedPairIdMap[manualTarget.pairId]) manualTarget.pairId = importedPairIdMap[manualTarget.pairId];
                    else if (skippedImportedPairIds[manualTarget.pairId]) manualTarget = null;
                    if (manualTarget && !pairsApi.getPair(dd, manualTarget.pairId)) manualTarget = null;
                }
                if (manualTarget) {
                    targetBindings.manualTarget = manualTarget;
                    targetBindings.manualTheme = manualTarget.kind === 'theme' ? manualTarget.themeName : '';
                }
            }
        }

        if (relationshipDiagnostics.length > 0) console.warn('[美化管理] 标注备份关系诊断:', relationshipDiagnostics);
        save(dd);
        if (bindingController && importedBindingCount) bindingController.reconcile();
        renderCatbar();
        renderGrid();
        renderBottomStatus();
        toast('✅ 导入成功：' + importedCount + ' 个美化标注' +
            (importedPairCount ? '，' + importedPairCount + ' 组日夜美化' : '') +
            (importedSeriesCount ? '，' + importedSeriesCount + ' 个系列' : '') +
            (skippedImportedSeriesCount ? '；' + skippedImportedSeriesCount + ' 个系列未新增（可能已存在、成员缺失或归属冲突）' : '') +
            (relationshipDiagnostics.filter(function (item) { return item.severity !== 'info'; }).length ? '；关系诊断见控制台' : '') +
            (importedBindingCount ? '，' + importedBindingCount + ' 个绑定' : ''));
    }

    function openCategoryExportSheet() {
        var d = load();
        var rows = '';
        function countForCat(cat) {
            return getItemsForDisplayCategory(d, cat).length;
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
                var data = load();
                var targetItems = getItemsForDisplayCategory(data, cat);
                var targetNames = expandItemThemeNames(targetItems);
                themeTransfer.prepareExport(targetNames, { themeMeta: data.themeMeta })
                    .then(function (prepared) {
                        reportExportWarnings(prepared);
                        var catName = cat === '__uncategorized__' ? '未分类' : cat;
                        var exportedPairs = pairsApi.exportPairs(data, prepared.themes.map(function (theme) { return theme.name; }));
                        var seriesManifest = buildSeriesManifestForBundle(data, prepared.themes, exportedPairs);
                        var skippedSeriesCount = Math.max(0, countSeriesForItems(data, targetItems) - seriesManifest.groups.length);
                        var bundle = {
                            type: 'theme-mgr-theme-bundle',
                            version: 1,
                            exportedAt: new Date().toISOString(),
                            exportScope: { type: 'category', category: catName },
                            themes: prepared.themes,
                            categories: cat === '__uncategorized__' ? [] : [cat],
                            themeMeta: buildThemeMetaForBundle(prepared.themes),
                            dayNightPairs: exportedPairs,
                            seriesManifest: seriesManifest,
                            themeFingerprints: prepared.fingerprints.byFingerprint,
                            themeCompatibilityReport: prepared.report,
                        };
                        var safeName = String(catName).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'category';
                        var reportText = prepared.report.legacyCount > 0
                            ? '，兼容补齐 ' + prepared.report.legacyCount + ' 个旧主题的 ' + prepared.report.filledFieldCount + ' 个字段'
                            : '';
                        downloadJsonFile('theme-mgr-' + safeName + '-' + new Date().toISOString().slice(0, 10) + '.json', bundle, function (assetCount) {
                            toast('✅ 已安全导出「' + catName + '」：' + prepared.themes.length + ' 个' + reportText +
                                (assetCount ? '，含 ' + assetCount + ' 张图片' : '') +
                                (skippedSeriesCount ? '；' + skippedSeriesCount + ' 个系列因成员不完整未附带关系' : ''));
                        });
                    })
                    .catch(function (err) {
                        console.warn('[美化管理] 导出分类安全检查失败:', err);
                        toast('导出分类已中止：' + err.message, true);
                    });
            });
        });
    }

    // ── 设置 ─────────────────────────────────────────────────
    function openSettingsSheet() {
        var d = load();
        var metadataDiagnostics = metadataApi.inspect(stThemeList, d.themeMeta);
        var metaCount = metadataDiagnostics.annotatedCount;
        var orphanMetaCount = metadataDiagnostics.orphanMetadata.length;
        var imgCount = 0;
        for (var k in d.themeMeta) { if (d.themeMeta[k].imageData) imgCount++; }

        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-sliders"></i>设置</div>',
            '<div class="tm-sec-title">分类管理</div>',
            '<button class="tm-btn tm-btn-outline" id="tm-open-cats" style="width:100%;text-align:left;margin-bottom:10px"><i class="fa-solid fa-tags" style="margin-right:6px"></i>管理分类（' + d.categories.length + '个）</button>',
            '<div class="tm-sec-title">显示</div>',
            '<div class="tm-row-inline"><label class="tm-setting-copy"><span>界面跟随当前美化</span><small>同步背景、顶底栏装饰、字体与配色，并保护文字对比度</small></label><input type="checkbox" class="tm-chk" id="tm-follow-appearance" ' + (d.followThemeAppearance === true ? 'checked' : '') + ' /></div>',
            '<div class="tm-row-inline tm-follow-detail"><label class="tm-setting-copy"><span>显示头像框</span><small>把当前美化的头像框用于网格预览；没有头像框时保持原样</small></label><input type="checkbox" class="tm-chk" id="tm-show-theme-avatar-frame" ' + (d.showThemeAvatarFrame === true ? 'checked' : '') + ' /></div>',
            '<div class="tm-row-inline tm-follow-detail"><label class="tm-setting-copy"><span>更改预览图片形状</span><small>同步当前美化头像的圆角、裁切与遮罩形状</small></label><input type="checkbox" class="tm-chk" id="tm-follow-preview-shape" ' + (d.followThemePreviewShape === true ? 'checked' : '') + ' /></div>',
            '<div class="tm-row-inline tm-follow-detail tm-grid-text-detail"><label class="tm-setting-copy"><span>简洁网格文字</span><small>头像框或预览形状任一开启时，名称和标签取消底纹并居中</small></label><input type="checkbox" class="tm-chk" id="tm-simplify-grid-text" ' + (d.simplifyGridText === true ? 'checked' : '') + ' /></div>',
            '<div class="tm-row-inline"><label class="tm-setting-copy"><span>自动隐藏顶栏内容</span><small>隐藏标题与按钮；点击顶栏显示，点击其他区域再次隐藏</small></label><input type="checkbox" class="tm-chk" id="tm-auto-hide-header" ' + (d.autoHideHeader === true ? 'checked' : '') + ' /></div>',
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
            '<div class="tm-storage-info">ST 共有 ' + stThemeList.length + ' 个主题 / 已标注 ' + metaCount + ' 个' +
            (orphanMetaCount ? ' / 孤儿标注 ' + orphanMetaCount + ' 个' : '') + ' / ' + imgCount + ' 张截图 / ' +
            (getServerMode() ? '后端存储' : '浏览器存储') + '</div>',
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

        var followAppearanceInput = sheet.querySelector('#tm-follow-appearance');
        var showThemeAvatarFrameInput = sheet.querySelector('#tm-show-theme-avatar-frame');
        var followThemePreviewShapeInput = sheet.querySelector('#tm-follow-preview-shape');
        var simplifyGridTextInput = sheet.querySelector('#tm-simplify-grid-text');
        var autoHideHeaderInput = sheet.querySelector('#tm-auto-hide-header');
        function syncFollowDetailState() {
            var enabled = followAppearanceInput.checked;
            [showThemeAvatarFrameInput, followThemePreviewShapeInput].forEach(function (input) {
                input.disabled = !enabled;
                var row = input.closest('.tm-follow-detail');
                if (row) row.classList.toggle('is-disabled', !enabled);
            });
            var gridTextEnabled = enabled &&
                (
                    showThemeAvatarFrameInput.checked ||
                    followThemePreviewShapeInput.checked
                );
            simplifyGridTextInput.disabled = !gridTextEnabled;
            var gridTextRow = simplifyGridTextInput.closest('.tm-follow-detail');
            if (gridTextRow) gridTextRow.classList.toggle('is-disabled', !gridTextEnabled);
        }
        syncFollowDetailState();

        followAppearanceInput.addEventListener('change', function () {
            var dd = load();
            dd.followThemeAppearance = this.checked;
            save(dd);
            syncFollowDetailState();
            syncManagerAppearance();
            toast(this.checked ? '✨ 管理器界面将跟随当前美化' : '管理器已恢复固定明暗外观');
        });
        showThemeAvatarFrameInput.addEventListener('change', function () {
            var dd = load();
            dd.showThemeAvatarFrame = this.checked;
            save(dd);
            syncFollowDetailState();
            syncManagerAppearance();
        });
        followThemePreviewShapeInput.addEventListener('change', function () {
            var dd = load();
            dd.followThemePreviewShape = this.checked;
            save(dd);
            syncFollowDetailState();
            syncManagerAppearance();
        });
        simplifyGridTextInput.addEventListener('change', function () {
            var dd = load();
            dd.simplifyGridText = this.checked;
            save(dd);
            syncManagerAppearance();
        });
        autoHideHeaderInput.addEventListener('change', function () {
            var dd = load();
            dd.autoHideHeader = this.checked;
            save(dd);
            syncManagerAppearance();
        });
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
                    var payload = { themes: [], themeMeta: {}, categories: [], dayNightPairs: [], seriesGroups: [] };
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
            if (stThemeList.length === 0) { toast('没有可导出的美化', true); return; }
            themeTransfer.prepareExport(stThemeList.slice(), { themeMeta: load().themeMeta })
                .then(function (prepared) {
                    reportExportWarnings(prepared);
                    var data = load();
                    var exportedPairs = pairsApi.exportPairs(data, prepared.themes.map(function (theme) { return theme.name; }));
                    var seriesManifest = buildSeriesManifestForBundle(data, prepared.themes, exportedPairs);
                    var skippedSeriesCount = Math.max(0, seriesApi.listSeries(data).length - seriesManifest.groups.length);
                    var bundle = {
                        type: 'theme-mgr-theme-bundle',
                        version: 1,
                        exportedAt: new Date().toISOString(),
                        themes: prepared.themes,
                        categories: data.categories.slice(),
                        themeMeta: buildThemeMetaForBundle(prepared.themes),
                        dayNightPairs: exportedPairs,
                        seriesManifest: seriesManifest,
                        themeFingerprints: prepared.fingerprints.byFingerprint,
                        themeCompatibilityReport: prepared.report,
                    };
                    var reportText = prepared.report.legacyCount > 0
                        ? '，兼容补齐 ' + prepared.report.legacyCount + ' 个旧主题的 ' + prepared.report.filledFieldCount + ' 个字段'
                        : '';
                    downloadJsonFile('theme-mgr-themes-' + new Date().toISOString().slice(0, 10) + '.json', bundle, function (assetCount) {
                        toast('✅ 已安全导出美化包：' + prepared.themes.length + ' 个' + reportText +
                            (assetCount ? '，含 ' + assetCount + ' 张图片' : '') +
                            (skippedSeriesCount ? '；' + skippedSeriesCount + ' 个系列因成员不完整未附带关系' : ''));
                    });
                })
                .catch(function (err) {
                    console.warn('[美化管理] 导出美化包安全检查失败:', err);
                    toast('导出美化包已中止：' + err.message, true);
                });
        });
        sheet.querySelector('#tm-exp-theme-cat').addEventListener('click', function () { openCategoryExportSheet(); });
        sheet.querySelector('#tm-clear').addEventListener('click', function () {
            if (!confirm('确定清空所有标注数据（分类、标签、截图）？\n主题文件本身不受影响。')) return;
            var dd = load(); dd.themeMeta = {}; dd.categories = []; curCat = '__all__';
            if (pairsApi) {
                var pairState = pairsApi.ensureState(dd);
                Object.keys(pairState.pairs).forEach(function (id) {
                    pairState.pairs[id].meta = pairsApi.normalizeMeta({});
                });
            }
            if (seriesApi) {
                seriesApi.listSeries(dd).forEach(function (group) { group.category = ''; });
            }
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
                var n = getItemsForDisplayCategory(d, cat).length;
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
        function startPointerCategoryDrag(item, idx, clientY) {
            var rect = item.getBoundingClientRect();
            dragFrom = idx;
            dragTo = idx;
            touchOffsetY = clientY - rect.top;
            dragGhost = item.cloneNode(true);
            dragGhost.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
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
            updateTouchInsert(clientY);
        }
        function movePointerCategoryDrag(clientY) {
            if (dragFrom === null) return;
            if (dragGhost) dragGhost.style.top = (clientY - touchOffsetY) + 'px';
            updateTouchInsert(clientY);
        }
        function finishPointerCategoryDrag() {
            if (dragFrom === null) return;
            var from = dragFrom; var to = dragTo;
            clearDragState();
            dragFrom = null; dragTo = null;
            moveCategory(from, to);
        }
        function cancelPointerCategoryDrag() {
            clearDragState();
            dragFrom = null; dragTo = null;
        }
        function onMouseMoveCategory(e) {
            if (dragFrom === null) return;
            e.preventDefault();
            movePointerCategoryDrag(e.clientY);
        }
        function onMouseUpCategory(e) {
            document.removeEventListener('mousemove', onMouseMoveCategory);
            document.removeEventListener('mouseup', onMouseUpCategory);
            if (dragFrom === null) return;
            e.preventDefault();
            finishPointerCategoryDrag();
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
            handle.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                document.removeEventListener('mousemove', onMouseMoveCategory);
                document.removeEventListener('mouseup', onMouseUpCategory);
                var item = handle.closest('.tm-cat-item');
                startPointerCategoryDrag(item, parseInt(handle.dataset.idx, 10), e.clientY);
                document.addEventListener('mousemove', onMouseMoveCategory);
                document.addEventListener('mouseup', onMouseUpCategory);
            });
            handle.addEventListener('touchstart', function (e) {
                if (!e.touches || !e.touches.length) return;
                e.preventDefault();
                var touch = e.touches[0];
                var item = handle.closest('.tm-cat-item');
                startPointerCategoryDrag(item, parseInt(handle.dataset.idx, 10), touch.clientY);
            }, { passive: false });
            handle.addEventListener('touchmove', function (e) {
                if (!e.touches || !e.touches.length || dragFrom === null) return;
                e.preventDefault();
                var touch = e.touches[0];
                movePointerCategoryDrag(touch.clientY);
            }, { passive: false });
            handle.addEventListener('touchend', function (e) {
                if (dragFrom === null) return;
                e.preventDefault();
                finishPointerCategoryDrag();
            }, { passive: false });
            handle.addEventListener('touchcancel', function () {
                cancelPointerCategoryDrag();
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
                getLogicalItems(dd).forEach(function (item) {
                    var meta = getItemMeta(dd, item);
                    if (meta.category === old) getItemMetaForWrite(dd, item).category = nw;
                });
                if (seriesApi) {
                    seriesApi.listSeries(dd).forEach(function (group) {
                        if (group.category === old) group.category = nw;
                    });
                }
                save(dd); closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('已重命名');
            });
        });
        sheet.querySelectorAll('.tm-cat-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var dd = load(); var idx = parseInt(btn.dataset.idx); var name = dd.categories[idx];
                if (!confirm('删除分类「' + name + '」？')) return;
                dd.categories.splice(idx, 1);
                getLogicalItems(dd).forEach(function (item) {
                    var meta = getItemMeta(dd, item);
                    if (meta.category === name) getItemMetaForWrite(dd, item).category = '';
                });
                if (seriesApi) {
                    seriesApi.listSeries(dd).forEach(function (group) {
                        if (group.category === name) group.category = '';
                    });
                }
                if (curCat === name) curCat = '__all__';
                save(dd); closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('已删除');
            });
        });
    }

    // ── Bottom Sheet 通用 ───────────────────────────────────
    function createSheet(contentHtml) {
        return uiSheetsApi.createSheet(contentHtml);
    }
    function closeSheet(ov, options) { return uiSheetsApi.closeSheet(ov, options); }

    // ── Lightbox ─────────────────────────────────────────────
    function openLightbox(themeNames, startName) {
        return uiSheetsApi.openLightbox(themeNames, startName);
    }

    // ── FAB ──────────────────────────────────────────────────
    function removeFab() {
        var eventsApi = initUiEvents();
        if (eventsApi) return eventsApi.removeFab();
    }

    function injectFab() {
        var eventsApi = initUiEvents();
        if (eventsApi) return eventsApi.injectFab();
    }
    function closeFab() {
        var eventsApi = initUiEvents();
        if (eventsApi) return eventsApi.closeFab();
    }

    // ── 侧栏按钮 ──────────────────────────────────────────────
    function updateBtn() {
        var eventsApi = initUiEvents();
        if (eventsApi) return eventsApi.updateBtn();
    }

    function startLauncherInjection() {
        var eventsApi = initUiEvents();
        if (eventsApi) return eventsApi.startLauncherInjection();
    }

    // ── 启动 ──────────────────────────────────────────────────
    function startThemeManager() {
        injectStyles();
        bindVerifiedThemeSelectSync();
        if (themeRuntime && typeof themeRuntime.bindNativeEditTracking === 'function') {
            themeRuntime.bindNativeEditTracking();
        }
        startLauncherInjection();
        var eventsApi = initUiEvents();
        if (eventsApi) eventsApi.startFabInjection();

        initStorage(function (d) {
            var lsData = loadFromLS();
            if (lsData && lsData.themeMeta && Object.keys(lsData.themeMeta).length > 0 && (!d.themeMeta || Object.keys(d.themeMeta).length === 0)) {
                var migratedData = ensureDefaults(lsData);
                save(migratedData);
                saveToDB(migratedData, function () { try { localStorage.removeItem('theme_mgr_v2'); } catch (e) {} });
            }
            if (eventsApi && typeof eventsApi.syncFabVisibility === 'function') eventsApi.syncFabVisibility(d);
            bindColorSchemeListener();
            if (bindingController) bindingController.start();
            updateBtn();
        });
    }

    function start() {
        startLauncherInjection();
        setupSupportModules(startThemeManager);
    }

    return { start: start };
    };
})(window);
