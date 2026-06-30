// ST美化管理扩展 v2.0 - SillyTavern Extension
// 基于穿搭管理 v14.5b 架构，对接 ST 真实主题 API
// 功能：读取ST主题列表、一键切换、预览截图、分类标签、收藏、排序、批量操作

(function () {

    var SCRIPT_NAME = '美化管理';
    var BTN_ID = 'theme-mgr-ext-btn';
    var DB_NAME = 'theme_mgr_db';
    var DB_VERSION = 1;
    var STORE_NAME = 'data';
    var DATA_KEY = 'main';
    var MAX_IMG_WIDTH = 1200;
    var IMG_QUALITY = 0.8;
    var FAB_ID = 'tm-fab-main';

    var dbInstance = null;
    var dataCache = null;
    var fabOpen = false;
    var darkMode = false;

    // 缓存主题列表
    var stThemeList = [];
    var importedThemeCache = {};
    var fullThemeCache = {};
    var importedThemeSelectSyncBound = false;
    var backgroundListCache = null;

    function getPopupLayer() {
        var slot = document.getElementById('tm-popup-slot');
        if (slot) return slot;
        var ov = document.querySelector('.tm-overlay');
        if (ov) return ov;
        return document.body;
    }

    // ── IndexedDB（只存附加信息：分类、标签、收藏、截图）────
    function openDB(cb) {
        if (dbInstance) { cb(dbInstance); return; }
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        req.onsuccess = function (e) { dbInstance = e.target.result; cb(dbInstance); };
        req.onerror = function () { cb(null); };
    }

    function loadFromDB(cb) {
        if (dataCache) { cb(dataCache); return; }
        openDB(function (db) {
            if (!db) { dataCache = ensureDefaults(loadFromLS()); cb(dataCache); return; }
            var tx = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).get(DATA_KEY);
            req.onsuccess = function () { dataCache = ensureDefaults(req.result || loadFromLS()); cb(dataCache); };
            req.onerror = function () { dataCache = ensureDefaults(loadFromLS()); cb(dataCache); };
        });
    }

    function saveToDB(d, cb) {
        dataCache = d;
        openDB(function (db) {
            if (!db) { try { localStorage.setItem('theme_mgr_v2', JSON.stringify(d)); } catch (e) {} if (cb) cb(); return; }
            var tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(d, DATA_KEY);
            tx.oncomplete = function () { if (cb) cb(); };
            tx.onerror = function () { if (cb) cb(); };
        });
    }

    function load() {
        if (dataCache) return dataCache;
        dataCache = ensureDefaults(loadFromLS());
        return dataCache;
    }
    function save(d) { dataCache = d; saveToDB(d); }

    function loadFromLS() {
        try { var r = localStorage.getItem('theme_mgr_v2'); return r ? JSON.parse(r) : null; } catch (e) { return null; }
    }

    // data 结构：
    // {
    //   themeMeta: { "主题名": { category, tags[], starred, imageData, useCount, lastUsed, author, description } },
    //   categories: [],
    //   showBall: true,
    //   sortMode: 'name'
    // }
    function ensureDefaults(d) {
        var dd = def();
        if (!d) return dd;
        for (var k in dd) { if (d[k] === undefined) d[k] = dd[k]; }
        if (typeof d.themeMeta !== 'object' || !d.themeMeta) d.themeMeta = {};
        if (!Array.isArray(d.categories)) d.categories = [];
        if (typeof d.sortMode !== 'string') d.sortMode = 'name';
        return d;
    }

    function def() {
        return {
            themeMeta: {},
            categories: [],
            showBall: true,
            showFreq: true,
            sortMode: 'name'
        };
    }

    function getMeta(d, name) {
        if (!d.themeMeta[name]) d.themeMeta[name] = { category: '', tags: [], starred: false, imageData: null, useCount: 0, lastUsed: 0, author: '', description: '', backgroundName: '' };
        if (d.themeMeta[name].backgroundName === undefined) d.themeMeta[name].backgroundName = '';
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

    function getBackgroundList(cb) {
        if (backgroundListCache) { cb(backgroundListCache); return; }
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
        var sheet = createSheet([
            '<div class="tm-sheet-title"><i class="fa-solid fa-image"></i>选择绑定背景</div>',
            '<div class="tm-bg-picker-list" id="tm-bg-picker-list"><div class="tm-loading"><i class="fa-solid fa-spinner"></i><span>正在读取壁纸…</span></div></div>',
        ].join(''));
        var list = sheet.querySelector('#tm-bg-picker-list');

        function choose(name) {
            if (onPick) onPick(name);
            closeSheet(sheet);
        }

        getBackgroundList(function (backgrounds) {
            var html = '<button type="button" class="tm-bg-picker-card' + (!selectedName ? ' on' : '') + '" data-bg="">' +
                '<div class="tm-bg-picker-thumb empty"><i class="fa-regular fa-image"></i></div>' +
                '<div class="tm-bg-picker-name">不绑定背景</div><i class="fa-solid fa-circle-check"></i></button>';
            backgrounds.forEach(function (name) {
                html += '<button type="button" class="tm-bg-picker-card' + (selectedName === name ? ' on' : '') + '" data-bg="' + esc(name) + '">' +
                    '<div class="tm-bg-picker-thumb" style="background-image:' + esc(getBackgroundCssUrl(name)) + '"></div>' +
                    '<div class="tm-bg-picker-name">' + esc(name) + '</div><i class="fa-solid fa-circle-check"></i></button>';
            });
            if (backgrounds.length === 0) {
                html += '<div class="tm-empty"><i class="fa-regular fa-image"></i><span>还没有可绑定的 ST 壁纸</span></div>';
            }
            list.innerHTML = html;
            list.querySelectorAll('.tm-bg-picker-card').forEach(function (card) {
                card.addEventListener('click', function () { choose(card.dataset.bg || ''); });
            });
        });
    }

    function applyBoundBackground(themeName, cb) {
        var d = load();
        var meta = d.themeMeta[themeName];
        var backgroundName = meta && meta.backgroundName ? meta.backgroundName : '';
        if (!backgroundName) { if (cb) cb(true); return; }

        var url = getBackgroundCssUrl(backgroundName);
        Promise.all([import('/scripts/backgrounds.js'), import('/script.js')])
            .then(function (mods) {
                var bgMod = mods[0];
                var scriptMod = mods[1];
                if (bgMod.background_settings) {
                    bgMod.background_settings.name = backgroundName;
                    bgMod.background_settings.url = url;
                }
                var bg = document.getElementById('bg1');
                if (bg) bg.style.backgroundImage = url;
                setControlValue('#background_fitting', bgMod.background_settings && bgMod.background_settings.fitting ? bgMod.background_settings.fitting : '');
                if (scriptMod && typeof scriptMod.saveSettingsDebounced === 'function') scriptMod.saveSettingsDebounced();
                if (cb) cb(true);
            })
            .catch(function (err) {
                console.warn('[美化管理] 应用绑定背景失败:', err);
                var bg = document.getElementById('bg1');
                if (bg) bg.style.backgroundImage = url;
                if (cb) cb(true);
            });
    }

    function finishApplyTheme(themeName, cb, ok) {
        if (!ok) { if (cb) cb(false); return; }
        applyBoundBackground(themeName, function () {
            if (cb) cb(true);
        });
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
            if (!name) return;
            getThemeObjectByName(name, function (theme) {
                if (!theme) return;
                applyImportedThemeObject(theme, function (ok) {
                    if (ok) {
                        applyBoundBackground(name, function () {
                            renderGrid(); renderBottomStatus();
                        });
                    }
                });
            });
        }, true);
    }

    function rememberImportedTheme(theme) {
        if (!theme || !theme.name) return;
        importedThemeCache[theme.name] = theme;
        fullThemeCache[theme.name] = theme;
        bindImportedThemeSelectSync();
    }

    function getPostHeaders() {
        return fetch('/csrf-token')
            .then(function (r) { if (!r.ok) throw new Error('csrf ' + r.status); return r.json(); })
            .then(function (tokenData) {
                return { 'Content-Type': 'application/json', 'X-CSRF-Token': tokenData.token };
            });
    }

    function getAllThemeObjects(cb) {
        getPostHeaders()
            .then(function (headers) {
                return fetch('/api/settings/get', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({}),
                    cache: 'no-cache',
                });
            })
            .then(function (r) { if (!r.ok) throw new Error('settings ' + r.status); return r.json(); })
            .then(function (data) {
                var themes = data && Array.isArray(data.themes) ? data.themes : [];
                themes.forEach(function (theme) { if (theme && theme.name) fullThemeCache[theme.name] = theme; });
                cb(themes);
            })
            .catch(function (err) {
                console.warn('[美化管理] 获取完整主题失败:', err);
                cb(null, err);
            });
    }

    function getThemeObjectByName(themeName, cb) {
        if (importedThemeCache[themeName]) { cb(importedThemeCache[themeName]); return; }
        if (fullThemeCache[themeName]) { cb(fullThemeCache[themeName]); return; }
        getAllThemeObjects(function (themes) {
            var found = null;
            if (themes) {
                themes.forEach(function (theme) {
                    if (theme && theme.name === themeName) found = theme;
                });
            }
            if (found) rememberImportedTheme(found);
            cb(found);
        });
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
        return fetch('/api/themes/save', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(theme),
        }).then(function (r) {
            if (!r.ok) throw new Error(theme.name + ': status ' + r.status);
            return theme;
        });
    }

    function downloadJsonFile(filename, data) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
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

        getPostHeaders()
            .then(function (headers) {
                return Promise.all(finalThemes.map(function (theme) {
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
                fetchThemeList(function () {
                    renderCatbar(); renderGrid(); renderBottomStatus();
                    if (failCount > 0) toast('导入完成：成功 ' + okCount + ' 个，失败 ' + failCount + ' 个', true);
                    else if (okCount === 1 && results[0] && results[0].theme) toast('✅ 已导入美化：' + results[0].theme.name);
                    else toast('✅ 已导入美化：' + okCount + ' 个');
                });
                if (failCount > 0) console.warn('[美化管理] 批量导入失败项:', results.filter(function (r) { return !r.ok; }));
            })
            .catch(function (err) { toast((opts.failText || '导入美化失败') + '：' + err.message, true); });
    }

    function applyTheme(themeName, cb) {
        var logs = [];
        if (importedThemeCache[themeName]) {
            applyImportedThemeObject(importedThemeCache[themeName], function (ok) { finishApplyTheme(themeName, cb, ok); });
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
                            themeEl.dispatchEvent(new Event('change', { bubbles: true }));
                            logs.push('SELECT 已选中 index=' + i + '，已触发 change');
                            finishApplyTheme(themeName, cb, true);
                            return;
                        }
                    }
                    logs.push('SELECT 未找到匹配项');
                } else if (themeEl.tagName === 'INPUT') {
                    // 设置 value 然后触发 input + change 事件
                    var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    nativeInputValueSetter.call(themeEl, themeName);
                    themeEl.dispatchEvent(new Event('input', { bubbles: true }));
                    themeEl.dispatchEvent(new Event('change', { bubbles: true }));
                    logs.push('INPUT 已设值并触发 input+change');
                    finishApplyTheme(themeName, cb, true);
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
                    finishApplyTheme(themeName, cb, true);
                    return;
                }
                if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                    ctx.executeSlashCommandsWithOptions('/theme ' + themeName);
                    logs.push('executeSlashCommandsWithOptions 已调用');
                    finishApplyTheme(themeName, cb, true);
                    return;
                }

                // 2b: SlashCommandParser
                if (ctx.SlashCommandParser) {
                    var parserMethods = Object.keys(ctx.SlashCommandParser).filter(function(k) { return typeof ctx.SlashCommandParser[k] === 'function'; });
                    logs.push('SlashCommandParser methods: ' + parserMethods.join(','));
                    try {
                        ctx.SlashCommandParser.execute('/theme ' + themeName);
                        logs.push('SlashCommandParser.execute 已调用');
                        finishApplyTheme(themeName, cb, true);
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

    // ── 图片压缩 ─────────────────────────────────────────────
    function compressImage(dataUrl, cb) {
        var img = new Image();
        img.onload = function () {
            var w = img.width, h = img.height, canvas = document.createElement('canvas');
            if (w > MAX_IMG_WIDTH) { canvas.width = MAX_IMG_WIDTH; canvas.height = Math.round(h * MAX_IMG_WIDTH / w); }
            else { canvas.width = w; canvas.height = h; }
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            cb(canvas.toDataURL('image/jpeg', IMG_QUALITY));
        };
        img.onerror = function () { cb(dataUrl); };
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

    // ── CSS ───────────────────────────────────────────────────
    function injectStyles() {
        var old = document.getElementById('tm-style');
        if (old) old.parentNode.removeChild(old);
        var s = document.createElement('style');
        s.id = 'tm-style';
        s.textContent = [
            '@keyframes tm-fadein{from{opacity:0}to{opacity:1}}',
            '@keyframes tm-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}',
            '@keyframes tm-popin{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}',
            '@keyframes tm-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',

            '.tm-light{--tm-bg:#f5f5f7;--tm-bg2:#ececef;--tm-text:#111;--tm-border:rgba(0,0,0,.1);--tm-card-bg:rgba(0,0,0,.04);--tm-head-bg:rgba(255,255,255,.8);}',
            '.tm-dark{--tm-bg:#16161a;--tm-bg2:#1e1e24;--tm-text:#eee;--tm-border:rgba(255,255,255,.08);--tm-card-bg:rgba(255,255,255,.05);--tm-head-bg:rgba(0,0,0,.3);}',
            '.tm-overlay{position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100dvh;z-index:2147483647;',
            'background:var(--tm-bg,var(--SmartThemeBackgroundColor,#16161a));',
            'color:var(--tm-text,var(--SmartThemeBodyColor,#eee));',
            'display:flex;flex-direction:column;animation:tm-fadein .18s ease;font-size:14px;}',
            '.tm-box{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;}',

            /* 顶栏 */
            '.tm-head{display:flex;align-items:center;gap:8px;padding:12px 15px;padding-top:max(12px, env(safe-area-inset-top, 12px));flex-shrink:0;border-bottom:1px solid rgba(127,127,127,.1);background:rgba(0,0,0,.12);}',
            '.tm-head-title{font-weight:700;font-size:1.05em;display:flex;align-items:center;gap:7px;flex:1;min-width:0;}',
            '.tm-head-title i{color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-head-actions{display:flex;align-items:center;gap:4px;}',
            '.tm-icon-btn{cursor:pointer;background:none;border:none;opacity:.55;font-size:1.15em;',
            'width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:.18s;color:inherit;flex-shrink:0;}',
            '.tm-icon-btn:hover{opacity:1;background:rgba(127,127,127,.12);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-theme-btn{cursor:pointer;background:rgba(127,127,127,.1);border:1px solid rgba(127,127,127,.2);',
            'border-radius:14px;padding:4px 10px;font-size:.75em;display:flex;align-items:center;gap:5px;transition:.2s;color:inherit;flex-shrink:0;height:28px;white-space:nowrap;}',
            '.tm-theme-btn:hover{background:rgba(127,127,127,.2);}',

            /* 搜索 */
            '.tm-search-bar{display:none;padding:8px 15px;border-bottom:1px solid rgba(127,127,127,.08);background:rgba(0,0,0,.06);flex-shrink:0;}',
            '.tm-search-bar.open{display:flex;align-items:center;gap:8px;}',
            '.tm-search-wrap{flex:1;position:relative;display:flex;align-items:center;}',
            '.tm-search-wrap i{position:absolute;left:10px;opacity:.4;font-size:.85em;pointer-events:none;}',
            '.tm-search-inp{width:100%;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 32px 7px 30px;font-size:.85em;font-family:inherit;box-sizing:border-box;}',
            '.tm-search-inp:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-search-clear{background:none;border:none;color:inherit;opacity:.4;cursor:pointer;font-size:.9em;padding:4px;line-height:1;}',
            '.tm-search-clear:hover{opacity:.9;}',

            /* 分类栏 */
            '.tm-catbar{display:flex;gap:6px;padding:8px 15px;overflow-x:auto;flex-wrap:nowrap;flex-shrink:0;-webkit-overflow-scrolling:touch;scrollbar-width:none;border-bottom:1px solid rgba(127,127,127,.08);}',
            '.tm-catbar::-webkit-scrollbar{display:none;}',
            '.tm-catbtn{padding:5px 14px;border-radius:18px;font-size:.78em;cursor:pointer;white-space:nowrap;flex-shrink:0;border:1px solid rgba(127,127,127,.15);background:rgba(127,127,127,.06);transition:all .15s;color:inherit;font-family:inherit;}',
            '.tm-catbtn:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-catbtn.on{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);font-weight:600;}',

            /* 排序栏 */
            '.tm-sortbar{display:none;padding:6px 15px;border-bottom:1px solid rgba(127,127,127,.08);flex-shrink:0;gap:6px;align-items:center;overflow-x:auto;scrollbar-width:none;}',
            '.tm-sortbar.open{display:flex;}',
            '.tm-sortbar::-webkit-scrollbar{display:none;}',
            '.tm-sort-chip{padding:4px 12px;border-radius:14px;font-size:.72em;cursor:pointer;white-space:nowrap;flex-shrink:0;border:1px solid rgba(127,127,127,.12);background:rgba(127,127,127,.04);transition:all .15s;color:inherit;font-family:inherit;}',
            '.tm-sort-chip:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-sort-chip.on{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* 网格 */
            '.tm-grid-area{flex:1;overflow-y:auto;padding:12px 12px 8px;}',
            '.tm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:9px;}',
            '.tm-loading{display:flex;flex-direction:column;align-items:center;gap:12px;padding:60px 20px;opacity:.5;}',
            '.tm-loading i{font-size:2em;animation:tm-spin 1s linear infinite;}',

            /* 卡片 */
            '.tm-card{border-radius:10px;overflow:hidden;position:relative;cursor:pointer;transition:all .18s;border:2px solid transparent;display:flex;flex-direction:column;}',
            '.tm-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.25);}',
            '.tm-card.on{border-color:var(--SmartThemeQuoteColor,#7c6daf);box-shadow:0 0 0 1px var(--SmartThemeQuoteColor,#7c6daf),0 4px 16px rgba(0,0,0,.2);}',
            '.tm-card-img{width:100%;aspect-ratio:4/3;position:relative;background:rgba(127,127,127,.1);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;}',
            '.tm-card-img img{width:100%;height:100%;object-fit:cover;display:block;}',
            '@media (hover:hover){.tm-card-menu{opacity:0;} .tm-card:hover .tm-card-menu{opacity:.85;}}',
            '.tm-card-info{padding:5px 7px 6px;background:var(--tm-card-bg,rgba(127,127,127,.06));min-height:36px;box-sizing:border-box;}',
            '.tm-card-name{font-size:.8em;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tm-text,#eee);}',
            '.tm-card-tag{font-size:.68em;line-height:1.2;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tm-text,#aaa);opacity:.5;}',
            '.tm-card-noimg{display:flex;flex-direction:column;align-items:center;gap:6px;opacity:.3;font-size:.75em;width:100%;height:100%;justify-content:center;}',
            '.tm-card-noimg i{font-size:2em;}',
            '.tm-card.no-img{background:rgba(127,127,127,.08);}',
            '.tm-badge-on{position:absolute;top:5px;right:5px;width:20px;height:20px;border-radius:50%;background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.6em;box-shadow:0 2px 6px rgba(0,0,0,.3);}',
            '.tm-badge-star{position:absolute;top:5px;left:5px;font-size:.85em;color:#f0b860;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));}',
            '.tm-badge-freq{position:absolute;bottom:5px;left:5px;padding:1px 6px;border-radius:8px;font-size:.6em;font-weight:600;background:rgba(0,0,0,.55);color:#fff;backdrop-filter:blur(4px);}',
            '.tm-card-menu{position:absolute;bottom:4px;right:4px;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.7em;opacity:.65;transition:opacity .15s;z-index:1;}',
            '.tm-card-menu:hover{opacity:1 !important;background:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-card-check{position:absolute;top:5px;left:5px;width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(0,0,0,.3);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-size:.6em;color:transparent;cursor:pointer;transition:all .15s;z-index:1;}',
            '.tm-card-check.checked{background:var(--SmartThemeQuoteColor,#7c6daf);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;}',
            '.tm-card.batch-sel{border-color:var(--SmartThemeQuoteColor,#7c6daf);opacity:.85;}',
            '.tm-batch-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:8px;background:rgba(127,127,127,.06);border-radius:10px;border:1px solid rgba(127,127,127,.1);flex-wrap:wrap;}',
            '.tm-batch-info{font-size:.82em;opacity:.7;white-space:nowrap;}',
            '.tm-batch-acts{display:flex;gap:5px;flex:1;justify-content:flex-end;flex-wrap:wrap;}',
            '.tm-batch-btn{padding:5px 10px;border-radius:8px;font-size:.75em;cursor:pointer;border:1px solid rgba(127,127,127,.15);background:rgba(127,127,127,.06);color:inherit;font-family:inherit;transition:.15s;white-space:nowrap;}',
            '.tm-batch-btn:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(127,127,127,.1);}',
            '.tm-batch-btn.danger{border-color:#e57373;color:#e57373;}',
            '.tm-batch-btn.danger:hover{background:#e57373;color:#fff;}',
            '.tm-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 20px;opacity:.35;font-size:.9em;text-align:center;}',
            '.tm-empty i{font-size:2.6em;}',

            /* 底栏 */
            '.tm-bottombar{display:flex !important;align-items:center;gap:6px;padding:10px 14px;padding-bottom:max(10px, env(safe-area-inset-bottom, 10px));flex-shrink:0;border-top:1px solid rgba(127,127,127,.1);background:rgba(0,0,0,.12);}',
            '.tm-bottom-status{flex:1;min-width:0;display:flex;align-items:center;gap:7px;cursor:pointer;border-radius:8px;padding:5px 7px;transition:.15s;border:1px solid transparent;}',
            '.tm-bottom-status:hover{background:rgba(127,127,127,.08);border-color:rgba(127,127,127,.12);}',
            '.tm-status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}',
            '.tm-status-dot.gray{background:rgba(127,127,127,.5);}',
            '.tm-status-dot.green{background:#4caf50;}',
            '.tm-status-text{font-size:.82em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9;}',
            '.tm-bottom-btn{width:36px;height:36px;border-radius:50%;border:1px solid rgba(127,127,127,.15);background:rgba(127,127,127,.06);color:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.9em;transition:.18s;flex-shrink:0;}',
            '.tm-bottom-btn:hover{background:rgba(127,127,127,.15);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-batch-toggle-btn{padding:6px 11px;border-radius:18px;border:1px solid rgba(127,127,127,.2);background:rgba(127,127,127,.07);color:inherit;cursor:pointer;font-size:.75em;white-space:nowrap;font-family:inherit;transition:.15s;flex-shrink:0;}',
            '.tm-batch-toggle-btn:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-batch-toggle-btn.on{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* Bottom Sheet 通用 */
            '.tm-sheet-overlay{position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;pointer-events:auto !important;}',
            '.tm-sheet{position:absolute;bottom:0;left:0;right:0;max-height:88vh;max-height:88dvh;background:var(--tm-bg2,var(--SmartThemeBackgroundColor,#1a1a1e));color:var(--tm-text,var(--SmartThemeBodyColor,#eee));border-radius:18px 18px 0 0;overflow-y:auto;animation:tm-sheet-up .25s ease;border:1px solid rgba(127,127,127,.15);border-bottom:none;}',
            '.tm-sheet-handle{width:36px;height:4px;border-radius:2px;background:rgba(127,127,127,.25);margin:10px auto 4px;}',
            '.tm-sheet-content{padding:4px 20px 32px;}',
            '.tm-sheet-title{font-weight:700;font-size:1.05em;padding:10px 0 14px;display:flex;align-items:center;gap:8px;}',
            '.tm-sheet-title i{color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* 操作菜单 */
            '.tm-ctx-item{display:flex;align-items:center;gap:12px;padding:14px 4px;cursor:pointer;border-bottom:1px solid rgba(127,127,127,.08);transition:.15s;border-radius:0;}',
            '.tm-ctx-item:last-child{border-bottom:none;}',
            '.tm-ctx-item:hover{color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-ctx-item i{width:20px;text-align:center;opacity:.75;font-size:1em;}',
            '.tm-ctx-item.danger{color:#e57373;}',
            '.tm-ctx-item.danger:hover{color:#ef5350;}',
            '.tm-ctx-theme-name{font-size:.85em;opacity:.5;padding:2px 0 10px;border-bottom:1px solid rgba(127,127,127,.1);margin-bottom:4px;}',

            /* 通用组件 */
            '.tm-sec-title{font-size:.75em;font-weight:700;opacity:.55;text-transform:uppercase;letter-spacing:.07em;padding:10px 0 7px;}',
            '.tm-divider{height:1px;background:rgba(127,127,127,.12);margin:6px 0 12px;}',
            '.tm-hint{font-size:.76em;opacity:.5;line-height:1.4;}',
            '.tm-btn-row{display:flex;gap:8px;flex-wrap:wrap;}',
            '.tm-btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:.87em;font-weight:600;transition:.18s;font-family:inherit;}',
            '.tm-btn-safe{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;}',
            '.tm-btn-safe:hover{filter:brightness(1.1);}',
            '.tm-btn-outline{background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.22);color:inherit;}',
            '.tm-btn-outline:hover{background:rgba(127,127,127,.15);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-btn-danger{background:rgba(229,115,115,.1);border:1px solid #e57373;color:#e57373;}',
            '.tm-btn-danger:hover{background:#e57373;color:#fff;}',
            '.tm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}',
            '.tm-field label{font-size:.8em;opacity:.7;font-weight:500;}',
            '.tm-field input[type=text],.tm-field select,.tm-field textarea{background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:9px 11px;font-size:.9em;width:100%;box-sizing:border-box;font-family:inherit;}',
            '.tm-field textarea{resize:none;}',
            '.tm-field input:focus,.tm-field select:focus,.tm-field textarea:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-frow{display:flex;gap:7px;align-items:stretch;}',
            '.tm-frow select{flex:1;}',
            '.tm-bg-bind-card{width:100%;display:grid;grid-template-columns:72px minmax(0,1fr) 18px;gap:10px;align-items:center;padding:8px;border-radius:8px;border:1px solid rgba(127,127,127,.2);background:rgba(127,127,127,.08);color:inherit;text-align:left;font-family:inherit;cursor:pointer;}',
            '.tm-bg-bind-card:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(127,127,127,.12);}',
            '.tm-bg-bind-thumb{height:48px;border-radius:7px;background-size:cover;background-position:center;background-color:rgba(127,127,127,.14);border:1px solid rgba(127,127,127,.14);display:flex;align-items:center;justify-content:center;overflow:hidden;}',
            '.tm-bg-bind-thumb.empty{background:repeating-linear-gradient(45deg,rgba(127,127,127,.08),rgba(127,127,127,.08) 8px,rgba(127,127,127,.16) 8px,rgba(127,127,127,.16) 16px);}',
            '.tm-bg-bind-thumb i{opacity:.4;font-size:1.2em;}',
            '.tm-bg-bind-info{min-width:0;}',
            '.tm-bg-bind-name{font-size:.88em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.tm-bg-bind-sub{font-size:.72em;opacity:.48;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.tm-bg-bind-card>i{opacity:.35;}',
            '.tm-bg-picker-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;padding-bottom:8px;}',
            '.tm-bg-picker-card{position:relative;display:flex;flex-direction:column;gap:6px;padding:7px;border-radius:8px;border:2px solid transparent;background:rgba(127,127,127,.06);color:inherit;font-family:inherit;text-align:left;cursor:pointer;min-width:0;}',
            '.tm-bg-picker-card:hover{background:rgba(127,127,127,.11);}',
            '.tm-bg-picker-card.on{border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-bg-picker-thumb{width:100%;aspect-ratio:4/3;border-radius:6px;background-size:cover;background-position:center;background-color:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.12);display:flex;align-items:center;justify-content:center;overflow:hidden;}',
            '.tm-bg-picker-thumb.empty{background:repeating-linear-gradient(45deg,rgba(127,127,127,.08),rgba(127,127,127,.08) 8px,rgba(127,127,127,.16) 8px,rgba(127,127,127,.16) 16px);}',
            '.tm-bg-picker-thumb i{opacity:.38;font-size:1.6em;}',
            '.tm-bg-picker-name{font-size:.75em;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.tm-bg-picker-card>i{position:absolute;top:9px;right:9px;color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(0,0,0,.35);border-radius:50%;opacity:0;}',
            '.tm-bg-picker-card.on>i{opacity:1;}',
            '.tm-imgarea{width:100%;height:160px;background:rgba(127,127,127,.06);border:2px dashed rgba(127,127,127,.25);border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;transition:border-color .18s;}',
            '.tm-imgarea:hover,.tm-imgarea.drag{border-color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(127,127,127,.1);}',
            '.tm-imgph{display:flex;flex-direction:column;align-items:center;gap:6px;opacity:.4;font-size:.82em;pointer-events:none;}',
            '.tm-imgph i{font-size:1.8em;}',
            '.tm-imgarea img{width:100%;height:100%;object-fit:contain;}',
            '.tm-img-actions{display:flex;gap:7px;margin-top:7px;}',
            '.tm-edit-foot{display:flex;gap:9px;justify-content:flex-end;padding-top:14px;border-top:1px solid rgba(127,127,127,.1);margin-top:10px;}',
            '.tm-tags-wrap{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;}',
            '.tm-tag-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 10px;border-radius:12px;background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;font-size:.78em;font-weight:500;}',
            '.tm-tag-chip-x{background:none;border:none;color:#fff;cursor:pointer;font-size:.85em;line-height:1;padding:0 2px;opacity:.7;}',
            '.tm-tag-chip-x:hover{opacity:1;}',
            '.tm-tag-add-row{display:flex;gap:6px;margin-top:6px;}',
            '.tm-tag-add-row input{flex:1;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:6px 10px;font-size:.82em;font-family:inherit;box-sizing:border-box;}',
            '.tm-tag-add-row input:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-cat-item{display:flex;align-items:center;gap:8px;padding:9px 12px;background:rgba(127,127,127,.06);border-radius:9px;border:1px solid rgba(127,127,127,.1);transition:none;margin-bottom:7px;}',
            '.tm-cat-item:hover{background:rgba(127,127,127,.11);}',
            '.tm-cat-item.drag-over-top{border-top:2px solid var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-cat-item.drag-over-bottom{border-bottom:2px solid var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-cat-item.dragging{opacity:.3;}',
            '.tm-drag-handle{opacity:.35;cursor:grab;padding:0 6px;font-size:.9em;touch-action:none;}',
            '.tm-cat-name{flex:1;font-size:.88em;}',
            '.tm-cat-count{font-size:.74em;opacity:.45;}',
            '.tm-cat-add-row{display:flex;gap:8px;}',
            '.tm-cat-add-row input{flex:1;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:8px 11px;font-size:.88em;font-family:inherit;box-sizing:border-box;}',
            '.tm-cat-add-row input:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.tm-btn-sm{padding:5px 7px;border-radius:6px;cursor:pointer;font-size:.78em;background:rgba(127,127,127,.07);border:1px solid rgba(127,127,127,.14);transition:all .15s;color:inherit;font-family:inherit;}',
            '.tm-btn-sm:hover{background:rgba(127,127,127,.15);}',
            '.tm-row-inline{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}',
            '.tm-row-inline label{opacity:.8;font-size:.88em;}',
            '.tm-chk{width:17px;height:17px;accent-color:var(--SmartThemeQuoteColor,#7c6daf);cursor:pointer;}',
            '.tm-storage-info{font-size:.72em;opacity:.45;padding:4px 0;}',

            /* Lightbox */
            '.tm-lightbox{position:absolute;inset:0;z-index:3;background:rgba(0,0,0,.92);pointer-events:auto;display:flex;align-items:center;justify-content:center;animation:tm-popin .18s ease;}',
            '.tm-lb-img{max-width:92vw;max-height:88vh;object-fit:contain;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.6);user-select:none;}',
            '.tm-lb-close{position:absolute;top:18px;right:20px;background:rgba(255,255,255,.12);border:none;color:#fff;font-size:1.3em;width:40px;height:40px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;z-index:2147483647;}',
            '.tm-lb-close:hover{background:rgba(255,255,255,.25);}',
            '.tm-lb-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.12);border:none;color:#fff;font-size:1.2em;width:42px;height:42px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;z-index:2147483647;}',
            '.tm-lb-nav:hover{background:rgba(255,255,255,.25);}',
            '.tm-lb-prev{left:14px;} .tm-lb-next{right:14px;}',
            '.tm-lb-counter{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.6);font-size:.82em;background:rgba(0,0,0,.4);padding:4px 14px;border-radius:20px;z-index:2147483647;}',
            '.tm-lb-name{position:absolute;top:20px;left:50%;transform:translateX(-50%);color:#fff;font-size:.9em;font-weight:600;background:rgba(0,0,0,.4);padding:5px 16px;border-radius:20px;max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2147483647;}',
        ].join('');
        document.head.appendChild(s);
    }

    // ── UI 状态 ───────────────────────────────────────────────
    var curCat = '__all__';
    var batchMode = false;
    var batchSelected = [];
    var searchQuery = '';
    var searchOpen = false;
    var sortOpen = false;

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
            '<div class="tm-head-title"><i class="fa-solid fa-palette"></i>' + SCRIPT_NAME + '</div>' +
            '<div class="tm-head-actions">' +
            '<button class="tm-icon-btn" id="tm-search-toggle" title="搜索"><i class="fa-solid fa-magnifying-glass"></i></button>' +
            '<button class="tm-icon-btn" id="tm-sort-toggle" title="排序"><i class="fa-solid fa-arrow-down-wide-short"></i></button>' +
            '<button class="tm-theme-btn" id="tm-theme-toggle"><i class="fa-solid fa-circle-half-stroke"></i></button>' +
            '<button class="tm-icon-btn" id="tm-x" title="关闭"><i class="fa-solid fa-xmark"></i></button>' +
            '</div></div>' +
            '<div class="tm-search-bar" id="tm-search-bar"><div class="tm-search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input class="tm-search-inp" id="tm-search-inp" placeholder="搜索主题名称、标签、作者…" autocomplete="off" /></div><button class="tm-search-clear" id="tm-search-clear"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="tm-sortbar" id="tm-sortbar">' +
            '<span style="font-size:.72em;opacity:.4;flex-shrink:0">排序：</span>' +
            '<button class="tm-sort-chip on" data-sort="name">名称</button>' +
            '<button class="tm-sort-chip" data-sort="recent">最近使用</button>' +
            '<button class="tm-sort-chip" data-sort="freq">使用频率</button>' +
            '<button class="tm-sort-chip" data-sort="starred">收藏优先</button>' +
            '</div>' +
            '<div class="tm-catbar" id="tm-catbar" style="display:none"></div>' +
            '<div class="tm-grid-area" id="tm-grid-area"><div class="tm-loading"><i class="fa-solid fa-spinner"></i><span>正在读取主题列表…</span></div></div>' +
            '<div class="tm-bottombar">' +
            '<div class="tm-bottom-status" id="tm-bottom-status"></div>' +
            '<button class="tm-bottom-btn" id="tm-refresh" title="刷新"><i class="fa-solid fa-rotate"></i></button>' +
            '<button class="tm-batch-toggle-btn" id="tm-batch-toggle">多选</button>' +
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

        // 底栏
        ov.querySelector('#tm-batch-toggle').addEventListener('click', function () {
            batchMode = !batchMode; batchSelected = [];
            ov.querySelector('#tm-batch-toggle').classList.toggle('on', batchMode);
            renderGrid();
        });
        ov.querySelector('#tm-bottom-settings').addEventListener('click', function () { openSettingsSheet(); });

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
        var d = load();
        var curTheme = getCurrentThemeName();

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

        var html = '';
        if (batchMode) {
            html += '<div class="tm-batch-bar"><span class="tm-batch-info">已选 <b id="tm-batch-count">' + batchSelected.length + '</b> 个</span>' +
                '<div class="tm-batch-acts">' +
                '<button class="tm-batch-btn" id="tm-batch-selall">全选</button>' +
                '<button class="tm-batch-btn" id="tm-batch-none">取消</button>' +
                '<button class="tm-batch-btn" id="tm-batch-cat"><i class="fa-solid fa-folder"></i> 分类</button>' +
                '<button class="tm-batch-btn" id="tm-batch-star"><i class="fa-solid fa-star"></i> 收藏</button>' +
                '<button class="tm-batch-btn" id="tm-batch-tag"><i class="fa-solid fa-tag"></i> 标签</button>' +
                '</div></div>';
        }

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

                var imgContent = meta.imageData
                    ? '<img src="' + meta.imageData + '" alt="' + esc(name) + '" />'
                    : '<div class="tm-card-noimg"><i class="fa-solid fa-palette"></i><span>' + esc(name.slice(0, 6)) + '</span></div>';

                var menuBtn = batchMode ? '' : '<button class="tm-card-menu" data-name="' + esc(name) + '" title="操作"><i class="fa-solid fa-ellipsis"></i></button>';
                var tagText = (meta.tags && meta.tags.length > 0) ? meta.tags.join(' · ') : (meta.author || '');

                html += '<div class="tm-card' + (isActive ? ' on' : '') + (bsel ? ' batch-sel' : '') + (meta.imageData ? '' : ' no-img') + '" data-name="' + esc(name) + '">' +
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
            var selall = area.querySelector('#tm-batch-selall');
            var selnone = area.querySelector('#tm-batch-none');
            if (selall) selall.addEventListener('click', function () { batchSelected = list.slice(); renderGrid(); });
            if (selnone) selnone.addEventListener('click', function () { batchSelected = []; renderGrid(); });

            var bcatBtn = area.querySelector('#tm-batch-cat');
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

            var bstarBtn = area.querySelector('#tm-batch-star');
            if (bstarBtn) bstarBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择主题', true); return; }
                var dd = load();
                batchSelected.forEach(function (name) { var m = getMeta(dd, name); m.starred = !m.starred; });
                save(dd); toast('⭐ 已切换收藏'); batchSelected = []; renderGrid();
            });

            var btagBtn = area.querySelector('#tm-batch-tag');
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
                    var cnt = area.querySelector('#tm-batch-count');
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
                    applyTheme(name, function (ok) {
                        if (ok) {
                            toast('✅ 已应用：' + name);
                            renderGrid(); renderBottomStatus(); updateBtn();
                        } else {
                            toast('切换失败，请重试', true);
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
        var imgThemes = stThemeList.filter(function (n) { return d.themeMeta[n] && d.themeMeta[n].imageData; });

        var sheet = createSheet([
            '<div class="tm-ctx-theme-name"><i class="fa-solid fa-palette" style="margin-right:6px;opacity:.5;"></i>' + esc(themeName) + '</div>',
            isActive
                ? '<div class="tm-ctx-item" style="opacity:.5"><i class="fa-solid fa-circle-check"></i>当前正在使用</div>'
                : '<div class="tm-ctx-item" id="tm-ctx-apply"><i class="fa-solid fa-circle-check"></i>应用主题</div>',
            meta.imageData ? '<div class="tm-ctx-item" id="tm-ctx-view"><i class="fa-solid fa-expand"></i>查看截图</div>' : '',
            meta.backgroundName ? '<div class="tm-ctx-item" style="opacity:.75"><i class="fa-solid fa-image"></i>背景：' + esc(meta.backgroundName) + '</div>' : '',
            '<div class="tm-ctx-item" id="tm-ctx-star"><i class="fa-solid fa-star"></i>' + (meta.starred ? '取消收藏' : '加入收藏') + '</div>',
            '<div class="tm-ctx-item" id="tm-ctx-edit"><i class="fa-solid fa-pen"></i>编辑信息</div>',
        ].join(''));

        var applyEl = sheet.querySelector('#tm-ctx-apply');
        if (applyEl) applyEl.addEventListener('click', function () {
            closeSheet(sheet);
            var dd = load(); var m = getMeta(dd, themeName); m.useCount = (m.useCount || 0) + 1; m.lastUsed = Date.now(); save(dd);
            applyTheme(themeName, function (ok) {
                if (ok) { toast('✅ 已应用：' + themeName); renderGrid(); renderBottomStatus(); updateBtn(); }
                else toast('切换失败', true);
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
    }

    // ── 编辑主题附加信息 ─────────────────────────────────────
    function openEditSheet(themeName) {
        var d = load();
        var meta = getMeta(d, themeName);
        var editImgData = meta.imageData || null;
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
            '<div class="tm-imgarea" id="tm-dimgarea">' + (editImgData ? '<img src="' + editImgData + '" />' : '<div class="tm-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传截图</span></div>') + '</div>' +
            '<input type="file" id="tm-dfile" accept="image/*" style="display:none" />' +
            '<div class="tm-img-actions"><button class="tm-btn tm-btn-outline" id="tm-dpick" style="font-size:.8em"><i class="fa-solid fa-image"></i> 选择图片</button>' +
            (editImgData ? '<button class="tm-btn tm-btn-danger" id="tm-dclr" style="font-size:.8em">删除图片</button>' : '') + '</div></div>',
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
        function setImg(data) {
            editImgData = data;
            imgArea.innerHTML = data ? '<img src="' + data + '" />' : '<div class="tm-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传截图</span></div>';
            var clrOld = sheet.querySelector('#tm-dclr'); var acts = sheet.querySelector('.tm-img-actions');
            if (data && !clrOld && acts) {
                var b2 = document.createElement('button'); b2.className = 'tm-btn tm-btn-danger'; b2.id = 'tm-dclr'; b2.style.fontSize = '.8em'; b2.textContent = '删除图片';
                b2.addEventListener('click', function () { setImg(null); }); acts.appendChild(b2);
            } else if (!data && clrOld) clrOld.parentNode.removeChild(clrOld);
        }
        function handleFile(f) { if (!f || f.type.indexOf('image') !== 0) return; var r = new FileReader(); r.onload = function (e) { compressImage(e.target.result, function (c) { setImg(c); }); }; r.readAsDataURL(f); }
        sheet.querySelector('#tm-dpick').addEventListener('click', function () { fileInp.click(); });
        imgArea.addEventListener('click', function () { fileInp.click(); });
        fileInp.addEventListener('change', function () { if (fileInp.files[0]) handleFile(fileInp.files[0]); });
        imgArea.addEventListener('dragover', function (e) { e.preventDefault(); imgArea.classList.add('drag'); });
        imgArea.addEventListener('dragleave', function () { imgArea.classList.remove('drag'); });
        imgArea.addEventListener('drop', function (e) { e.preventDefault(); imgArea.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
        var clr = sheet.querySelector('#tm-dclr'); if (clr) clr.addEventListener('click', function () { setImg(null); });

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
            var dd = load();
            var m = getMeta(dd, themeName);
            m.category = sheet.querySelector('#tm-dcat').value;
            m.author = sheet.querySelector('#tm-dauthor').value.trim();
            m.description = sheet.querySelector('#tm-ddesc').value.trim();
            m.backgroundName = editBackgroundName;
            m.tags = editTags.slice();
            m.imageData = editImgData;
            save(dd); closeSheet(sheet); toast('✨ 已保存'); renderCatbar(); renderGrid();
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
            '<div class="tm-divider"></div>',
            '<div class="tm-sec-title">数据</div>',
            '<div class="tm-storage-info">ST 共有 ' + stThemeList.length + ' 个主题 / 已标注 ' + metaCount + ' 个 / ' + imgCount + ' 张截图</div>',
            '<div class="tm-btn-row" style="margin-top:8px">' +
            '<button class="tm-btn tm-btn-outline" id="tm-exp"><i class="fa-solid fa-download"></i> 导出标注</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-imp"><i class="fa-solid fa-upload"></i> 导入标注</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-imp-theme"><i class="fa-solid fa-file-import"></i> 导入美化</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-imp-theme-batch"><i class="fa-solid fa-upload"></i> 批量导入美化</button>' +
            '<button class="tm-btn tm-btn-outline" id="tm-exp-theme-bundle"><i class="fa-solid fa-file-export"></i> 导出美化包</button>' +
            '<button class="tm-btn tm-btn-danger" id="tm-clear">清空标注</button>' +
            '</div>',
            '<div class="tm-hint" style="margin-top:8px">※ 标注只包含分类、标签、截图等附加信息；美化包会打包 ST 当前所有主题 JSON</div>',
        ].join(''));

        sheet.querySelector('#tm-show-ball').addEventListener('change', function () {
            var dd = load(); dd.showBall = this.checked; save(dd);
            if (dd.showBall) injectFab();
            else { var fab = document.getElementById(FAB_ID); if (fab) fab.parentNode.removeChild(fab); }
        });
        sheet.querySelector('#tm-show-freq').addEventListener('change', function () {
            var dd = load(); dd.showFreq = this.checked; save(dd); renderGrid();
        });
        sheet.querySelector('#tm-exp').addEventListener('click', function () {
            var d2 = load();
            var blob = new Blob([JSON.stringify(d2, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = 'theme-mgr-data-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a); a.click();
            setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
            toast('✅ 已导出');
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
                            var dd = load();
                            for (var k in imported.themeMeta) {
                                if (!dd.themeMeta[k]) dd.themeMeta[k] = imported.themeMeta[k];
                                else {
                                    var existing = dd.themeMeta[k]; var imp = imported.themeMeta[k];
                                    if (!existing.imageData && imp.imageData) existing.imageData = imp.imageData;
                                    if (!existing.category && imp.category) existing.category = imp.category;
                                    if (!existing.backgroundName && imp.backgroundName) existing.backgroundName = imp.backgroundName;
                                    if (imp.tags) imp.tags.forEach(function (t) { if (existing.tags.indexOf(t) === -1) existing.tags.push(t); });
                                    if (!existing.author && imp.author) existing.author = imp.author;
                                }
                            }
                            if (imported.categories) imported.categories.forEach(function (c) { if (dd.categories.indexOf(c) === -1) dd.categories.push(c); });
                            save(dd); renderCatbar(); renderGrid(); toast('✅ 导入成功');
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
                        var theme = JSON.parse(e.target.result);
                        if (!theme || !theme.name || !String(theme.name).trim()) { toast('主题文件缺少 name 字段', true); return; }
                        theme.name = String(theme.name).trim();
                        importThemeObjects([theme], { failText: '导入美化失败' });
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
                        .then(function (res) { return { file: file, data: res.data }; })
                        .catch(function (err) { return { file: file, error: err }; });
                })).then(function (results) {
                    var themes = [];
                    var errors = [];
                    results.forEach(function (res) {
                        if (res.error) { errors.push(res.error.message); return; }
                        try {
                            themes = themes.concat(extractThemeObjects(res.data, res.file.name));
                        } catch (err) { errors.push(err.message); }
                    });
                    if (errors.length > 0) {
                        console.warn('[美化管理] 批量导入解析错误:', errors);
                        if (!confirm('有 ' + errors.length + ' 个文件/主题解析失败，将跳过它们继续导入其余内容。是否继续？')) return;
                    }
                    importThemeObjects(themes, { failText: '批量导入美化失败' });
                });
            });
            inp.click();
        });
        sheet.querySelector('#tm-exp-theme-bundle').addEventListener('click', function () {
            getAllThemeObjects(function (themes, err) {
                if (!themes) { toast('导出美化包失败：' + (err ? err.message : '无法读取主题'), true); return; }
                if (themes.length === 0) { toast('没有可导出的美化', true); return; }
                var bundle = {
                    type: 'theme-mgr-theme-bundle',
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    themes: themes,
                };
                downloadJsonFile('theme-mgr-themes-' + new Date().toISOString().slice(0, 10) + '.json', bundle);
                toast('✅ 已导出美化包：' + themes.length + ' 个');
            });
        });
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
        var themes = themeNames.filter(function (n) { var m = load().themeMeta[n]; return m && m.imageData; });
        if (themes.length === 0) return;
        var idx = themes.indexOf(startName); if (idx === -1) idx = 0;

        var lb = document.createElement('div');
        lb.className = 'tm-lightbox';
        lb.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2 !important;pointer-events:auto !important;';

        function render() {
            var d = load(); var name = themes[idx]; var meta = d.themeMeta[name] || {};
            lb.innerHTML =
                '<button class="tm-lb-close"><i class="fa-solid fa-xmark"></i></button>' +
                '<div class="tm-lb-name">' + esc(name) + '</div>' +
                (themes.length > 1 ? '<button class="tm-lb-nav tm-lb-prev"><i class="fa-solid fa-chevron-left"></i></button>' : '') +
                '<img class="tm-lb-img" src="' + meta.imageData + '" draggable="false" />' +
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
    function injectFab() {
        if (document.getElementById(FAB_ID)) return;
        var d = load(); if (d.showBall === false) return;
        var container = document.createElement('div'); container.id = FAB_ID;
        var MAIN_SIZE = 38;
        var accent = 'var(--SmartThemeQuoteColor,#7c6daf)';

        function posFab() {
            var vh = window.innerHeight || document.documentElement.clientHeight;
            var vw = window.innerWidth || document.documentElement.clientWidth;
            container.setAttribute('style',
                'position:fixed !important;top:' + (vh - 80 - MAIN_SIZE) + 'px !important;left:' + (vw - 16 - MAIN_SIZE) + 'px !important;' +
                'z-index:2147483647 !important;display:flex !important;align-items:center !important;pointer-events:none !important;');
        }

        var mainBtn = document.createElement('div');
        mainBtn.innerHTML = '<i class="fa-solid fa-palette" style="pointer-events:none;font-size:1.1em;"></i>';
        mainBtn.setAttribute('style',
            'width:' + MAIN_SIZE + 'px !important;height:' + MAIN_SIZE + 'px !important;border-radius:50% !important;' +
            'background:' + accent + ' !important;color:#fff !important;border:none !important;cursor:pointer !important;' +
            'display:flex !important;align-items:center !important;justify-content:center !important;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.35) !important;opacity:.9 !important;pointer-events:auto !important;');
        container.appendChild(mainBtn);

        var _ds = { sx: 0, sy: 0, ox: 0, oy: 0, moved: false, handled: false };
        mainBtn.addEventListener('touchstart', function (e) {
            var t = e.touches[0]; var rect = container.getBoundingClientRect();
            _ds.sx = t.clientX; _ds.sy = t.clientY; _ds.ox = rect.left; _ds.oy = rect.top; _ds.moved = false;
        }, { passive: true });
        mainBtn.addEventListener('touchmove', function (e) {
            var t = e.touches[0]; var dx = t.clientX - _ds.sx, dy = t.clientY - _ds.sy;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) _ds.moved = true;
            if (_ds.moved) {
                var nx = Math.max(0, Math.min(_ds.ox + dx, window.innerWidth - MAIN_SIZE));
                var ny = Math.max(0, Math.min(_ds.oy + dy, window.innerHeight - MAIN_SIZE));
                container.style.setProperty('left', nx + 'px', 'important');
                container.style.setProperty('top', ny + 'px', 'important');
            }
        }, { passive: true });
        mainBtn.addEventListener('touchend', function () { if (!_ds.moved) { _ds.handled = true; openPopup(); } });
        mainBtn.addEventListener('click', function () {
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
        if (span) span.textContent = curTheme || SCRIPT_NAME;
        btn.style.color = curTheme ? 'var(--SmartThemeQuoteColor)' : '';
    }

    function findMenu() {
        var m = document.getElementById('extensionsMenu'); if (m) return m;
        m = document.getElementById('extensions_menu'); if (m) return m;
        var items = document.querySelectorAll('.list-group-item.interactable');
        for (var i = 0; i < items.length; i++) { var t = items[i].textContent || ''; if (t.indexOf('CSS') !== -1 || t.indexOf('穿搭') !== -1 || t.indexOf('变量管理') !== -1) return items[i].parentElement; }
        return null;
    }

    function injectBtn() {
        if (document.getElementById(BTN_ID)) return;
        var menu = findMenu(); if (!menu) return;
        var curTheme = getCurrentThemeName();
        var btn = document.createElement('div');
        btn.id = BTN_ID; btn.className = 'list-group-item flex-container flexGap5 interactable'; btn.title = SCRIPT_NAME;
        if (curTheme) btn.style.color = 'var(--SmartThemeQuoteColor)';
        btn.innerHTML = '<i class="fa-solid fa-palette"></i><span>' + esc(curTheme || SCRIPT_NAME) + '</span>';
        btn.addEventListener('click', openPopup);
        menu.appendChild(btn);
    }

    // ── 启动 ──────────────────────────────────────────────────
    injectStyles();
    bindImportedThemeSelectSync();
    setTimeout(injectBtn, 500);
    setInterval(injectBtn, 2000);
    setTimeout(injectFab, 1500);
    setInterval(function () { if (!document.getElementById(FAB_ID)) injectFab(); }, 3000);

    loadFromDB(function (d) {
        dataCache = d;
        var lsData = loadFromLS();
        if (lsData && lsData.themeMeta && Object.keys(lsData.themeMeta).length > 0 && (!d.themeMeta || Object.keys(d.themeMeta).length === 0)) {
            dataCache = ensureDefaults(lsData);
            saveToDB(dataCache, function () { try { localStorage.removeItem('theme_mgr_v2'); } catch (e) {} });
        }
        updateBtn();
    });

})();
