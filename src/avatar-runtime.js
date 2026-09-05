(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var MIN_SCALE = 0.5;
    var MAX_SCALE = 3;
    var SCALE_STEP = 0.05;
    var TOOLBAR_ID = 'tm-avatar-editor-toolbar';
    var STYLE_ID = 'tm-avatar-editor-style';
    var TARGET_CLASS = 'tm-avatar-editor-target';
    var AVATAR_CLASS = 'tm-avatar-editor-selected';

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function clean(value) { return String(value == null ? '' : value).trim(); }
    function round(value, precision) {
        var factor = Math.pow(10, precision == null ? 5 : precision);
        return Math.round(Number(value) * factor) / factor;
    }
    function clampScale(value) {
        var number = Number(value);
        if (!Number.isFinite(number)) number = 1;
        return round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, number)), 3);
    }
    function normalizeView(view) {
        view = view && typeof view === 'object' ? view : {};
        return {
            x: round(Number.isFinite(Number(view.x)) ? Number(view.x) : 0),
            y: round(Number.isFinite(Number(view.y)) ? Number(view.y) : 0),
            scale: clampScale(view.scale),
        };
    }
    function getAttribute(element, name) {
        return element && typeof element.getAttribute === 'function' ? element.getAttribute(name) : null;
    }
    function setExactAttribute(element, name, value) {
        if (!element) return;
        if (value == null) element.removeAttribute(name);
        else element.setAttribute(name, value);
    }
    function themeKey(themeName) {
        themeName = clean(themeName);
        return themeName ? 'theme-name:' + themeName : '';
    }
    function getContextInfo(context) {
        context = context || {};
        var characters = Array.isArray(context.characters) ? context.characters : [];
        var characterId = context.characterId;
        var character = characterId !== undefined && characterId !== null ? characters[characterId] : null;
        var groupId = context.groupId;
        var isGroup = groupId !== undefined && groupId !== null && String(groupId) !== '';
        var characterAvatar = character && clean(character.avatar);
        var characterName = character && clean(character.name);
        return {
            isGroup: isGroup,
            character: !isGroup && characterAvatar ? {
                kind: 'character',
                key: 'character:' + characterAvatar,
                label: characterName || characterAvatar,
                characterAvatar: characterAvatar,
            } : null,
            user: {
                kind: 'user',
                key: 'user:global',
                label: clean(context.name1) || 'User',
            },
        };
    }
    function directImage(avatar) {
        if (!avatar || typeof avatar.querySelector !== 'function') return null;
        try { return avatar.querySelector(':scope > img') || avatar.querySelector('img'); }
        catch (_) { return avatar.querySelector('img'); }
    }
    function messageImages(doc, target) {
        var chat = doc && doc.getElementById && doc.getElementById('chat');
        if (!chat || !target || typeof chat.querySelectorAll !== 'function') return [];
        return Array.prototype.slice.call(chat.querySelectorAll('.mes')).map(function (message) {
            var isUser = clean(getAttribute(message, 'is_user')).toLowerCase() === 'true';
            var isSystem = clean(getAttribute(message, 'is_system')).toLowerCase() === 'true';
            var match = target.kind === 'user' ? isUser : (!isUser && !isSystem);
            if (!match) return null;
            var avatar = message.querySelector('.avatar');
            var image = directImage(avatar);
            return image ? { message: message, avatar: avatar, image: image } : null;
        }).filter(Boolean);
    }
    function rectOf(element) {
        if (!element || typeof element.getBoundingClientRect !== 'function') return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
        var rect = element.getBoundingClientRect();
        return {
            x: Number(rect.x != null ? rect.x : rect.left) || 0,
            y: Number(rect.y != null ? rect.y : rect.top) || 0,
            left: Number(rect.left != null ? rect.left : rect.x) || 0,
            top: Number(rect.top != null ? rect.top : rect.y) || 0,
            right: Number(rect.right) || ((Number(rect.left) || 0) + (Number(rect.width) || 0)),
            bottom: Number(rect.bottom) || ((Number(rect.top) || 0) + (Number(rect.height) || 0)),
            width: Number(rect.width) || 0,
            height: Number(rect.height) || 0,
        };
    }
    function chooseRepresentative(entries, win) {
        var viewportWidth = Number(win.innerWidth) || 0;
        var viewportHeight = Number(win.innerHeight) || 0;
        var centerX = viewportWidth / 2;
        var centerY = viewportHeight / 2;
        return (entries || []).map(function (entry) {
            var rect = rectOf(entry.avatar || entry.image);
            var visible = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight;
            var distance = Math.abs((rect.left + rect.width / 2) - centerX) + Math.abs((rect.top + rect.height / 2) - centerY);
            return { entry: entry, visible: visible, distance: distance };
        }).filter(function (item) { return item.visible; }).sort(function (a, b) { return a.distance - b.distance; })[0]?.entry || null;
    }
    function localTransform(x, y, scale) {
        return 'translate(' + round(x, 3) + 'px, ' + round(y, 3) + 'px) scale(' + clampScale(scale) + ')';
    }
    function transformForPixels(x, y, scale, mapping) {
        var inverse = mapping && mapping.screenToLocal;
        var localX = inverse ? inverse.a * x + inverse.c * y : x;
        var localY = inverse ? inverse.b * x + inverse.d * y : y;
        return localTransform(localX, localY, scale);
    }
    function createAnimation(image) {
        if (!image || typeof image.animate !== 'function') throw Object.assign(new Error('当前浏览器暂不支持安全头像调整'), { code: 'ADDITIVE_UNSUPPORTED' });
        var keyframes = [
            { transform: localTransform(0, 0, 1), composite: 'add' },
            { transform: localTransform(0, 0, 1), composite: 'add' },
        ];
        var animation = image.animate(keyframes, { duration: 1, fill: 'both' });
        animation.pause();
        animation.currentTime = 0;
        var applied = animation.effect && typeof animation.effect.getKeyframes === 'function' ? animation.effect.getKeyframes() : [];
        if (!applied.length || applied[0].composite !== 'add' || !animation.effect || typeof animation.effect.setKeyframes !== 'function') {
            animation.cancel();
            throw Object.assign(new Error('当前浏览器暂不支持安全头像调整'), { code: 'ADDITIVE_UNSUPPORTED' });
        }
        return animation;
    }
    function updateAnimation(animation, pixels, mapping) {
        var transform = transformForPixels(pixels.x, pixels.y, pixels.scale, mapping);
        animation.effect.setKeyframes([
            { transform: transform, composite: 'add' },
            { transform: transform, composite: 'add' },
        ]);
        animation.currentTime = 0;
    }
    function centerOf(element) {
        var rect = rectOf(element);
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    function measureMapping(image, animation) {
        var sample = 10;
        updateAnimation(animation, { x: 0, y: 0, scale: 1 });
        var origin = centerOf(image);
        updateAnimation(animation, { x: sample, y: 0, scale: 1 });
        var horizontal = centerOf(image);
        updateAnimation(animation, { x: 0, y: sample, scale: 1 });
        var vertical = centerOf(image);
        updateAnimation(animation, { x: 0, y: 0, scale: 1 });
        var a = (horizontal.x - origin.x) / sample;
        var b = (horizontal.y - origin.y) / sample;
        var c = (vertical.x - origin.x) / sample;
        var d = (vertical.y - origin.y) / sample;
        var determinant = a * d - b * c;
        if (![a, b, c, d, determinant].every(Number.isFinite) || Math.abs(determinant) < 0.0001) {
            throw Object.assign(new Error('当前主题的头像变换不可安全叠加'), { code: 'ADDITIVE_MAPPING_INVALID' });
        }
        return { screenToLocal: { a: d / determinant, b: -b / determinant, c: -c / determinant, d: a / determinant } };
    }
    function pixelsForView(view, avatar) {
        var rect = rectOf(avatar);
        view = normalizeView(view);
        return { x: view.x * rect.width, y: view.y * rect.height, scale: view.scale };
    }
    function clips(style) {
        return /^(?:hidden|clip)$/i.test(clean(style && style.overflow)) || /^(?:hidden|clip)$/i.test(clean(style && style.overflowX)) || /^(?:hidden|clip)$/i.test(clean(style && style.overflowY));
    }

    ns.createAvatarRuntime = function (options) {
        options = options || {};
        var win = options.window || global;
        var doc = options.document || win.document;
        var store = options.store;
        var getContext = options.getContext || function () { return {}; };
        var getThemeName = options.getThemeName || function () { return ''; };
        var onError = options.onError || function () {};
        if (!store) throw new Error('avatar store is required');

        var baselines = new WeakMap();
        var activeImages = new Set();
        var assetCache = new Map();
        var listeners = [];
        var chatObserver = null;
        var observedChat = null;
        var reconcileTimer = null;
        var sequence = 0;
        var started = false;
        var hasRuntimeBinding = false;
        var editor = null;
        var editorClosing = false;
        var toolbarHost = null;
        var toolbar = null;
        var styleNode = null;
        var activePointer = null;
        var dragOrigin = null;

        function contextSafe() {
            try { return getContext() || {}; } catch (_) { return {}; }
        }
        function currentThemeKey() { return themeKey(getThemeName()); }
        function targets() { return getContextInfo(contextSafe()); }
        function captureBaseline(image) {
            var record = baselines.get(image);
            if (record) return record;
            record = {
                src: getAttribute(image, 'src'),
                srcset: getAttribute(image, 'srcset'),
                style: getAttribute(image, 'style'),
                targetClass: image.classList.contains(TARGET_CLASS),
                avatarClass: image.parentElement && image.parentElement.classList.contains(AVATAR_CLASS),
                animation: null,
                mapping: null,
            };
            baselines.set(image, record);
            return record;
        }
        function restoreImage(image) {
            var record = baselines.get(image);
            if (!record) return;
            if (record.animation) { try { record.animation.cancel(); } catch (_) {} }
            setExactAttribute(image, 'src', record.src);
            setExactAttribute(image, 'srcset', record.srcset);
            setExactAttribute(image, 'style', record.style);
            if (!record.targetClass) image.classList.remove(TARGET_CLASS);
            if (image.parentElement && !record.avatarClass) image.parentElement.classList.remove(AVATAR_CLASS);
            record.animation = null;
            activeImages.delete(image);
            baselines.delete(image);
        }
        function restoreAll() {
            Array.from(activeImages).forEach(restoreImage);
        }
        function applyToEntry(entry, asset, view) {
            var image = entry.image;
            var record = captureBaseline(image);
            if (record.animation) { try { record.animation.cancel(); } catch (_) {} }
            setExactAttribute(image, 'srcset', null);
            setExactAttribute(image, 'src', asset.imageData);
            var animation = createAnimation(image);
            var mapping;
            try { mapping = measureMapping(image, animation); }
            catch (error) { animation.cancel(); throw error; }
            updateAnimation(animation, pixelsForView(view, entry.avatar), mapping);
            record.animation = animation;
            record.mapping = mapping;
            activeImages.add(image);
        }
        function getAsset(id) {
            if (assetCache.has(id)) return Promise.resolve(assetCache.get(id));
            return store.getAsset(id).then(function (asset) {
                if (asset) assetCache.set(id, asset);
                return asset;
            });
        }
        function desiredForBinding(target, binding, asset) {
            return messageImages(doc, target).map(function (entry) { return { entry: entry, binding: binding, asset: asset }; });
        }
        function applyDesired(items) {
            var desired = new Set(items.map(function (item) { return item.entry.image; }));
            Array.from(activeImages).forEach(function (image) { if (!desired.has(image)) restoreImage(image); });
            items.forEach(function (item) { applyToEntry(item.entry, item.asset, item.binding.view); });
        }
        function resolveRuntimeDesired() {
            var key = currentThemeKey();
            var info = targets();
            if (!key) return Promise.resolve({ items: [], hasBinding: false });
            var targetList = [info.character, info.user].filter(Boolean);
            var foundBinding = false;
            return Promise.all(targetList.map(function (target) {
                return store.getBinding(key, target.key).then(function (binding) {
                    if (!binding) return null;
                    foundBinding = true;
                    return getAsset(binding.avatarId).then(function (asset) {
                        if (!asset) {
                            return store.deleteBinding(key, target.key).then(function () { return null; });
                        }
                        return desiredForBinding(target, binding, asset);
                    });
                });
            })).then(function (groups) {
                return {
                    items: groups.reduce(function (all, group) { return group ? all.concat(group) : all; }, []),
                    hasBinding: foundBinding,
                };
            });
        }
        function syncEditorInstances() {
            if (!editor) return false;
            var entries = messageImages(doc, editor.target);
            if (!editor.representative || editor.representative.image.isConnected === false) {
                cancelEdit('target-disconnected');
                return false;
            }
            var desired = new Set(entries.map(function (entry) { return entry.image; }));
            Array.from(activeImages).forEach(function (image) { if (!desired.has(image)) restoreImage(image); });
            entries.forEach(function (entry) { applyToEntry(entry, editor.asset, editor.view); });
            return true;
        }
        function reconcile() {
            var request = ++sequence;
            if (editor) { syncEditorInstances(); return Promise.resolve({ editing: true }); }
            return Promise.resolve(store.ready).then(resolveRuntimeDesired).then(function (desired) {
                if (request !== sequence || editor) return { superseded: true };
                hasRuntimeBinding = desired.hasBinding;
                try { applyDesired(desired.items); observeChat(); }
                catch (error) { restoreAll(); onError(error); return { ok: false, error: error }; }
                return { ok: true, count: desired.items.length };
            }).catch(function (error) { if (request === sequence) onError(error); return { ok: false, error: error }; });
        }
        function scheduleReconcile(delay) {
            if (reconcileTimer) win.clearTimeout(reconcileTimer);
            reconcileTimer = win.setTimeout(function () { reconcileTimer = null; reconcile(); }, delay == null ? 40 : delay);
        }
        function observeChat() {
            var chat = doc.getElementById && doc.getElementById('chat');
            if (!editor && !hasRuntimeBinding) chat = null;
            if (chat === observedChat) return;
            if (chatObserver) chatObserver.disconnect();
            observedChat = chat;
            if (!chat || typeof win.MutationObserver !== 'function') return;
            chatObserver = new win.MutationObserver(function () { scheduleReconcile(30); });
            chatObserver.observe(chat, { childList: true, subtree: true });
        }
        function addEvent(source, name, handler) {
            if (!source || !name || typeof source.on !== 'function') return;
            source.on(name, handler);
            listeners.push({ source: source, name: name, handler: handler });
        }
        function contextChanged() {
            if (editor) cancelEdit('context-changed');
            else { observeChat(); scheduleReconcile(20); }
        }
        function contentChanged() { if (editor || hasRuntimeBinding) { observeChat(); scheduleReconcile(20); } }
        function onThemeControlChange(event) {
            if (!event.target || event.target.id !== 'themes') return;
            if (editor) cancelEdit('theme-changed');
            else scheduleReconcile(80);
        }
        function start() {
            if (started) return Promise.resolve(false);
            started = true;
            var context = contextSafe();
            var source = context.eventSource;
            var types = context.eventTypes || {};
            [types.CHAT_CHANGED, types.CHAT_LOADED, types.PERSONA_CHANGED].forEach(function (name) { addEvent(source, name, contextChanged); });
            [types.MESSAGE_SENT, types.MESSAGE_RECEIVED, types.MESSAGE_UPDATED, types.USER_MESSAGE_RENDERED, types.CHARACTER_MESSAGE_RENDERED].forEach(function (name) { addEvent(source, name, contentChanged); });
            doc.addEventListener('change', onThemeControlChange, true);
            return Promise.resolve(store.ready).then(reconcile);
        }
        function stop() {
            if (editor) finishEditorUi();
            editor = null;
            listeners.forEach(function (item) {
                if (item.source && typeof item.source.removeListener === 'function') item.source.removeListener(item.name, item.handler);
            });
            listeners = [];
            doc.removeEventListener('change', onThemeControlChange, true);
            if (chatObserver) chatObserver.disconnect();
            chatObserver = null;
            observedChat = null;
            if (reconcileTimer) win.clearTimeout(reconcileTimer);
            reconcileTimer = null;
            started = false;
            hasRuntimeBinding = false;
            sequence += 1;
            restoreAll();
        }
        function capability(kind) {
            var info = targets();
            var target = kind === 'character' ? info.character : info.user;
            if (kind === 'character' && info.isGroup) return { available: false, reason: '当前群聊暂不支持角色头像原位调整', target: null };
            if (!target) return { available: false, reason: kind === 'character' ? '无法识别当前角色' : '无法识别当前 User', target: null };
            var entries = messageImages(doc, target);
            var representative = chooseRepresentative(entries, win);
            if (!representative) return { available: false, reason: '当前聊天中没有可见的目标头像', target: target, count: entries.length };
            return { available: true, reason: '', target: target, count: entries.length, representative: representative };
        }
        function getCapabilities() { return { character: capability('character'), user: capability('user'), themeKey: currentThemeKey() }; }
        function diagnosticsFor(entry, target, mapping) {
            var imageStyle = win.getComputedStyle(entry.image);
            var avatarStyle = win.getComputedStyle(entry.avatar);
            var imageRect = rectOf(entry.image);
            var avatarRect = rectOf(entry.avatar);
            return {
                targetKind: target.kind,
                targetKey: target.key,
                imageBox: { width: round(imageRect.width, 3), height: round(imageRect.height, 3) },
                avatarBox: { width: round(avatarRect.width, 3), height: round(avatarRect.height, 3) },
                objectFit: imageStyle.objectFit,
                objectPosition: imageStyle.objectPosition,
                transform: imageStyle.transform,
                translate: imageStyle.translate,
                scale: imageStyle.scale,
                rotate: imageStyle.rotate,
                transformOrigin: imageStyle.transformOrigin,
                borderRadius: imageStyle.borderRadius,
                clipPath: imageStyle.clipPath,
                maskImage: imageStyle.webkitMaskImage || imageStyle.maskImage,
                avatarOverflow: avatarStyle.overflow,
                parentClips: clips(avatarStyle),
                themeInlineStyleBaseline: getAttribute(entry.image, 'style'),
                strategy: 'web-animations-additive-transform',
                coordinateModel: 'normalized-avatar-box',
                mapping: clone(mapping),
            };
        }
        function ensureEditorUi() {
            styleNode = doc.createElement('style');
            styleNode.id = STYLE_ID;
            styleNode.textContent = [
                '.' + TARGET_CLASS + '{touch-action:none!important;user-select:none!important;-webkit-user-select:none!important;-webkit-user-drag:none!important;cursor:grab!important}',
                '.' + AVATAR_CLASS + '{outline:2px solid #d8a8ff!important;outline-offset:3px!important}',
            ].join('');
            doc.head.appendChild(styleNode);
            toolbarHost = doc.createElement('div');
            toolbarHost.id = TOOLBAR_ID;
            toolbarHost.setAttribute('style', 'all:initial!important;position:fixed!important;left:50%!important;bottom:calc(12px + env(safe-area-inset-bottom,0px))!important;transform:translateX(-50%)!important;z-index:2147483647!important;display:block!important;width:max-content!important;max-width:calc(100vw - 16px)!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;box-sizing:border-box!important');
            var toolbarRoot = typeof toolbarHost.attachShadow === 'function' ? toolbarHost.attachShadow({ mode: 'open' }) : toolbarHost;
            var toolbarStyle = doc.createElement('style');
            toolbarStyle.textContent = [
                '.tm-avatar-editor-bar{display:flex;align-items:center;gap:7px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:8px 10px;border:1px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(22,22,28,.95);color:#fff;font:13px/1.2 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.38);user-select:none;-webkit-user-select:none;pointer-events:auto;touch-action:manipulation}',
                'button{appearance:none;border:1px solid rgba(255,255,255,.24);border-radius:7px;background:rgba(255,255,255,.1);color:inherit;min-width:34px;min-height:34px;padding:6px 9px;font:inherit;white-space:nowrap}',
                '.tm-avatar-editor-scale{min-width:48px;text-align:center;font-variant-numeric:tabular-nums}',
                '@media(max-width:430px){.tm-avatar-editor-bar{gap:5px;padding:7px 8px}.tm-avatar-editor-title{display:none}button{padding:5px 7px}}',
            ].join('');
            toolbarRoot.appendChild(toolbarStyle);
            toolbar = doc.createElement('div');
            toolbar.className = 'tm-avatar-editor-bar';
            toolbar.innerHTML = '<span class="tm-avatar-editor-title">头像调整</span><button type="button" data-action="down">−</button><span class="tm-avatar-editor-scale">100%</span><button type="button" data-action="up">+</button><button type="button" data-action="reset">重置</button><button type="button" data-action="cancel">取消</button><button type="button" data-action="save">保存</button>';
            toolbar.addEventListener('click', onToolbarClick);
            toolbarRoot.appendChild(toolbar);
            doc.body.appendChild(toolbarHost);
        }
        function updateToolbar() {
            if (!toolbar || !editor) return;
            var scale = toolbar.querySelector('.tm-avatar-editor-scale');
            if (scale) scale.textContent = Math.round(editor.view.scale * 100) + '%';
        }
        function bindRepresentative() {
            if (!editor || !editor.representative) return;
            var image = editor.representative.image;
            image.classList.add(TARGET_CLASS);
            editor.representative.avatar.classList.add(AVATAR_CLASS);
            image.addEventListener('pointerdown', onPointerDown, true);
            image.addEventListener('click', blockClick, true);
        }
        function unbindRepresentative() {
            endDrag();
            if (!editor || !editor.representative) return;
            var image = editor.representative.image;
            var record = baselines.get(image);
            image.removeEventListener('pointerdown', onPointerDown, true);
            image.removeEventListener('click', blockClick, true);
            if (!record || !record.targetClass) image.classList.remove(TARGET_CLASS);
            if (editor.representative.avatar && (!record || !record.avatarClass)) editor.representative.avatar.classList.remove(AVATAR_CLASS);
        }
        function finishEditorUi() {
            unbindRepresentative();
            if (toolbar) toolbar.removeEventListener('click', onToolbarClick);
            if (toolbarHost && toolbarHost.parentNode) toolbarHost.parentNode.removeChild(toolbarHost);
            if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode);
            toolbarHost = null;
            toolbar = null;
            styleNode = null;
        }
        function beginEdit(input) {
            input = input || {};
            if (editor || editorClosing) return Promise.reject(Object.assign(new Error('头像编辑器正在使用中'), { code: 'EDITOR_ACTIVE' }));
            var kind = input.target && input.target.kind || input.kind;
            var cap = capability(kind);
            var key = currentThemeKey();
            if (!key) return Promise.reject(Object.assign(new Error('无法识别当前美化'), { code: 'THEME_UNAVAILABLE' }));
            if (!cap.available) return Promise.reject(Object.assign(new Error(cap.reason), { code: 'TARGET_UNAVAILABLE' }));
            return Promise.all([getAsset(input.avatarId), store.getBinding(key, cap.target.key)]).then(function (parts) {
                var asset = parts[0];
                if (!asset) throw Object.assign(new Error('所选头像不存在'), { code: 'AVATAR_NOT_FOUND' });
                editor = {
                    themeKey: key,
                    target: cap.target,
                    avatarId: asset.id,
                    asset: asset,
                    previousBinding: clone(parts[1]),
                    view: normalizeView(parts[1] && parts[1].view),
                    representative: cap.representative,
                    diagnostics: null,
                };
                observeChat();
                ensureEditorUi();
                try {
                    syncEditorInstances();
                    bindRepresentative();
                    var record = baselines.get(editor.representative.image);
                    editor.diagnostics = diagnosticsFor(editor.representative, editor.target, record && record.mapping);
                    updateToolbar();
                } catch (error) {
                    finishEditorUi();
                    editor = null;
                    return reconcile().then(function () { throw error; });
                }
                return getState();
            });
        }
        function blockClick(event) { event.preventDefault(); event.stopImmediatePropagation(); }
        function onPointerDown(event) {
            if (!editor || activePointer != null || event.button != null && event.button !== 0) return;
            activePointer = event.pointerId == null ? 1 : event.pointerId;
            var rect = rectOf(editor.representative.avatar);
            dragOrigin = { clientX: Number(event.clientX) || 0, clientY: Number(event.clientY) || 0, view: clone(editor.view), width: rect.width || 1, height: rect.height || 1 };
            try { if (event.pointerId != null) editor.representative.image.setPointerCapture(event.pointerId); } catch (_) {}
            doc.addEventListener('pointermove', onPointerMove, true);
            doc.addEventListener('pointerup', onPointerUp, true);
            doc.addEventListener('pointercancel', onPointerUp, true);
            event.preventDefault(); event.stopImmediatePropagation();
        }
        function onPointerMove(event) {
            if (!editor || activePointer == null || !dragOrigin || event.pointerId != null && event.pointerId !== activePointer) return;
            editor.view.x = round(dragOrigin.view.x + ((Number(event.clientX) || 0) - dragOrigin.clientX) / dragOrigin.width);
            editor.view.y = round(dragOrigin.view.y + ((Number(event.clientY) || 0) - dragOrigin.clientY) / dragOrigin.height);
            syncEditorInstances();
            event.preventDefault(); event.stopImmediatePropagation();
        }
        function onPointerUp(event) {
            if (activePointer == null || event.pointerId != null && event.pointerId !== activePointer) return;
            endDrag(event);
        }
        function endDrag(event) {
            if (activePointer != null && editor && editor.representative) {
                try { editor.representative.image.releasePointerCapture(activePointer); } catch (_) {}
            }
            activePointer = null;
            dragOrigin = null;
            doc.removeEventListener('pointermove', onPointerMove, true);
            doc.removeEventListener('pointerup', onPointerUp, true);
            doc.removeEventListener('pointercancel', onPointerUp, true);
            if (event && event.preventDefault) event.preventDefault();
        }
        function setScale(value) {
            if (!editor) return getState();
            editor.view.scale = clampScale(value);
            syncEditorInstances(); updateToolbar();
            return getState();
        }
        function resetEdit() {
            if (!editor) return getState();
            editor.view = normalizeView(null);
            syncEditorInstances(); updateToolbar();
            return getState();
        }
        function cancelEdit(reason) {
            if (!editor || editorClosing) return Promise.resolve(null);
            editorClosing = true;
            var result = { saved: false, reason: reason || 'cancelled', previousBinding: clone(editor.previousBinding) };
            finishEditorUi();
            editor = null;
            sequence += 1;
            return reconcile().then(function () { editorClosing = false; return result; }, function (error) { editorClosing = false; throw error; });
        }
        function saveEdit() {
            if (!editor || editorClosing) return Promise.resolve(null);
            editorClosing = true;
            var binding = {
                themeKey: editor.themeKey,
                targetKey: editor.target.key,
                avatarId: editor.avatarId,
                view: normalizeView(editor.view),
            };
            var diagnostics = clone(editor.diagnostics);
            return store.putBinding(binding).then(function (saved) {
                finishEditorUi();
                editor = null;
                sequence += 1;
                return reconcile().then(function () {
                    editorClosing = false;
                    return { saved: true, binding: saved, diagnostics: diagnostics };
                });
            }).catch(function (error) { editorClosing = false; throw error; });
        }
        function onToolbarClick(event) {
            var button = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
            if (!button || !toolbar.contains(button)) return;
            var action = button.getAttribute('data-action');
            if (action === 'down') setScale(editor.view.scale - SCALE_STEP);
            else if (action === 'up') setScale(editor.view.scale + SCALE_STEP);
            else if (action === 'reset') resetEdit();
            else if (action === 'cancel') cancelEdit();
            else if (action === 'save') saveEdit().catch(onError);
        }
        function clearBinding(kind) {
            var cap = capability(kind);
            var key = currentThemeKey();
            if (!cap.target || !key) return Promise.reject(Object.assign(new Error(cap.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' }));
            if (editor) return cancelEdit('binding-cleared').then(function () { return clearBinding(kind); });
            return store.deleteBinding(key, cap.target.key).then(reconcile);
        }
        function deleteAsset(id) {
            var cancel = editor && editor.avatarId === id ? cancelEdit('avatar-deleted') : Promise.resolve();
            return cancel.then(function () { return store.deleteAsset(id); }).then(function (result) {
                assetCache.delete(id);
                return reconcile().then(function () { return result; });
            });
        }
        function getState() {
            return editor ? {
                state: 'editing',
                themeKey: editor.themeKey,
                target: clone(editor.target),
                avatarId: editor.avatarId,
                view: clone(editor.view),
                previousBinding: clone(editor.previousBinding),
                diagnostics: clone(editor.diagnostics),
            } : { state: 'idle' };
        }
        function notifyAssetChanged(id) { if (id) assetCache.delete(id); return reconcile(); }

        return {
            start: start,
            stop: stop,
            reconcile: reconcile,
            scheduleReconcile: scheduleReconcile,
            getCapabilities: getCapabilities,
            beginEdit: beginEdit,
            cancelEdit: cancelEdit,
            saveEdit: saveEdit,
            reset: resetEdit,
            setScale: setScale,
            scaleUp: function () { return setScale(editor ? editor.view.scale + SCALE_STEP : 1); },
            scaleDown: function () { return setScale(editor ? editor.view.scale - SCALE_STEP : 1); },
            clearBinding: clearBinding,
            deleteAsset: deleteAsset,
            notifyAssetChanged: notifyAssetChanged,
            getState: getState,
            isEditing: function () { return !!editor; },
        };
    };

    ns.avatarRuntime = {
        MIN_SCALE: MIN_SCALE,
        MAX_SCALE: MAX_SCALE,
        SCALE_STEP: SCALE_STEP,
        themeKey: themeKey,
        getContextInfo: getContextInfo,
        messageImages: messageImages,
        chooseRepresentative: chooseRepresentative,
        normalizeView: normalizeView,
        pixelsForView: pixelsForView,
        transformForPixels: transformForPixels,
    };
})(window);
