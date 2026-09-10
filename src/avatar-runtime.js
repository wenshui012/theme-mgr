(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var MIN_SCALE = 0.5;
    var MAX_SCALE = 3;
    var SCALE_STEP = 0.05;
    var POSITION_STEP = 0.05;
    var ROTATE_STEP = 1;
    var SOURCE_CACHE_LIMIT = 2;
    var SOURCE_ASSET_CACHE_LIMIT = 2;
    var SOURCE_EDGE_MARGIN = 1;
    var EDITOR_PREVIEW_MAX_DIMENSION = 384;
    var EDITOR_SETTLE_DELAY = 120;
    var TOOLBAR_ID = 'tm-avatar-editor-toolbar';
    var STYLE_ID = 'tm-avatar-editor-style';
    var TARGET_CLASS = 'tm-avatar-editor-target';
    var AVATAR_CLASS = 'tm-avatar-editor-selected';
    var DEFAULT_BINDING_KEY = 'avatar-default';
    var THEME_BINDING_VERSION = 4;
    var USER_TARGET_KEY = 'user:global';
    var THEME_USER_CANDIDATE_PREFIX = USER_TARGET_KEY + ':theme-avatar:';
    var THEME_CHARACTER_CANDIDATE_PREFIX = 'theme-avatar-candidate:';
    var CHAT_BINDING_PREFIX = 'chat-integrity:';

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function clean(value) { return String(value == null ? '' : value).trim(); }
    function escapeHtml(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function themeUserCandidateTargetKey(avatarId) { return THEME_USER_CANDIDATE_PREFIX + encodeURIComponent(clean(avatarId)); }
    function themeAvatarCandidatePrefix(targetKey) {
        targetKey = clean(targetKey);
        return targetKey === USER_TARGET_KEY
            ? THEME_USER_CANDIDATE_PREFIX
            : THEME_CHARACTER_CANDIDATE_PREFIX + encodeURIComponent(targetKey) + ':';
    }
    function themeAvatarCandidateTargetKey(targetKey, avatarId) {
        return themeAvatarCandidatePrefix(targetKey) + encodeURIComponent(clean(avatarId));
    }
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
            rotate: round(Math.max(-180, Math.min(180, Number.isFinite(Number(view.rotate)) ? Number(view.rotate) : 0)), 2),
            flipX: view.flipX === true,
            flipY: view.flipY === true,
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
    function syncExactAttribute(element, name, value) {
        var current = getAttribute(element, name);
        if ((current == null ? null : current) === (value == null ? null : String(value))) return false;
        setExactAttribute(element, name, value);
        return true;
    }
    function themeKey(themeName) {
        themeName = clean(themeName);
        return themeName ? 'theme-name:' + themeName : '';
    }
    function chatBindingKey(chatKey) {
        chatKey = clean(chatKey);
        return chatKey ? CHAT_BINDING_PREFIX + encodeURIComponent(chatKey) : '';
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
        var chatMetadata = context.chatMetadata && typeof context.chatMetadata === 'object' ? context.chatMetadata : {};
        var chatKey = clean(chatMetadata.integrity);
        var chatId = '';
        try {
            chatId = typeof context.getCurrentChatId === 'function'
                ? clean(context.getCurrentChatId())
                : clean(context.chatId);
        } catch (_) { chatId = clean(context.chatId); }
        return {
            isGroup: isGroup,
            chatKey: chatKey,
            chatId: chatId,
            chatBindingKey: chatKey && chatId ? chatBindingKey(chatKey) : '',
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
    function objectViewBoxForView(view) {
        view = normalizeView(view);
        var geometry = arguments[1];
        if (geometry && Number(geometry.canvasWidth) > 0 && Number(geometry.canvasHeight) > 0) {
            var canvasWidth = Number(geometry.canvasWidth);
            var canvasHeight = Number(geometry.canvasHeight);
            var logicalWidth = Number(geometry.logicalWidth) || canvasWidth;
            var logicalHeight = Number(geometry.logicalHeight) || canvasHeight;
            var logicalLeft = Number.isFinite(Number(geometry.logicalLeft)) ? Number(geometry.logicalLeft) : (canvasWidth - logicalWidth) / 2;
            var logicalTop = Number.isFinite(Number(geometry.logicalTop)) ? Number(geometry.logicalTop) : (canvasHeight - logicalHeight) / 2;
            var visibleWidth = logicalWidth / view.scale;
            var visibleHeight = logicalHeight / view.scale;
            var leftPixels = logicalLeft + (logicalWidth - visibleWidth) / 2 - view.x * visibleWidth;
            var topPixels = logicalTop + (logicalHeight - visibleHeight) / 2 - view.y * visibleHeight;
            var rightPixels = canvasWidth - leftPixels - visibleWidth;
            var bottomPixels = canvasHeight - topPixels - visibleHeight;
            return 'inset(' + [topPixels / canvasHeight, rightPixels / canvasWidth, bottomPixels / canvasHeight, leftPixels / canvasWidth].map(function (value) {
                return round(value * 100, 4) + '%';
            }).join(' ') + ')';
        }
        var visible = 1 / view.scale;
        var centerInset = (1 - visible) / 2;
        var left = centerInset - view.x / view.scale;
        var top = centerInset - view.y / view.scale;
        var right = 1 - visible - left;
        var bottom = 1 - visible - top;
        return 'inset(' + [top, right, bottom, left].map(function (value) { return round(value * 100, 4) + '%'; }).join(' ') + ')';
    }
    function transformedSourceGeometry(asset, view) {
        view = normalizeView(view);
        var width = Math.max(1, Number(asset && asset.width) || 1);
        var height = Math.max(1, Number(asset && asset.height) || 1);
        var radians = view.rotate * Math.PI / 180;
        var cosine = Math.abs(Math.cos(radians));
        var sine = Math.abs(Math.sin(radians));
        if (cosine < 1e-12) cosine = 0;
        if (sine < 1e-12) sine = 0;
        var rotatedWidth = width * cosine + height * sine;
        var rotatedHeight = width * sine + height * cosine;
        var canvasWidth = Math.ceil(Math.max(width, rotatedWidth) + SOURCE_EDGE_MARGIN * 2);
        var canvasHeight = Math.ceil(Math.max(height, rotatedHeight) + SOURCE_EDGE_MARGIN * 2);
        return {
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight,
            logicalWidth: width,
            logicalHeight: height,
            logicalLeft: (canvasWidth - width) / 2,
            logicalTop: (canvasHeight - height) / 2,
            rotatedWidth: rotatedWidth,
            rotatedHeight: rotatedHeight,
        };
    }
    function editorPreviewGeometry(asset) {
        var width = Math.max(1, Number(asset && asset.width) || 1);
        var height = Math.max(1, Number(asset && asset.height) || 1);
        var envelope = Math.sqrt(width * width + height * height);
        var canvasWidth = Math.ceil(Math.max(width, envelope) + SOURCE_EDGE_MARGIN * 2);
        var canvasHeight = Math.ceil(Math.max(height, envelope) + SOURCE_EDGE_MARGIN * 2);
        return {
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight,
            logicalWidth: width,
            logicalHeight: height,
            logicalLeft: (canvasWidth - width) / 2,
            logicalTop: (canvasHeight - height) / 2,
            rotatedWidth: envelope,
            rotatedHeight: envelope,
            previewEnvelope: true,
        };
    }
    function editorPreviewAsset(asset) {
        if (!asset || !/^data:image\//i.test(asset.thumbData || '') || asset.thumbData === asset.imageData) return asset;
        var width = Math.max(1, Number(asset.width) || 1);
        var height = Math.max(1, Number(asset.height) || 1);
        var ratio = Math.min(1, EDITOR_PREVIEW_MAX_DIMENSION / Math.max(width, height));
        return {
            id: asset.id + ':editor-preview',
            imageData: asset.thumbData,
            width: Math.max(1, round(width * ratio, 3)),
            height: Math.max(1, round(height * ratio, 3)),
        };
    }
    function setImportantStyle(element, name, value) {
        if (element && element.style && typeof element.style.setProperty === 'function') {
            element.style.setProperty(name, value, 'important');
            return;
        }
        var current = clean(getAttribute(element, 'style'));
        if (current && current.charAt(current.length - 1) !== ';') current += ';';
        setExactAttribute(element, 'style', current + name + ':' + value + '!important;');
    }
    function clips(style) {
        return /^(?:hidden|clip)$/i.test(clean(style && style.overflow)) || /^(?:hidden|clip)$/i.test(clean(style && style.overflowX)) || /^(?:hidden|clip)$/i.test(clean(style && style.overflowY));
    }

    ns.createAvatarRuntime = function (options) {
        options = options || {};
        var win = options.window || global;
        var doc = options.document || win.document;
        var store = options.store;
        var canMutate = options.canMutate || function () { return true; };
        var canStart = options.canStart || function () { return true; };
        var getContext = options.getContext || function () { return {}; };
        var getThemeName = options.getThemeName || function () { return ''; };
        var onError = options.onError || function () {};
        var overwriteHostAvatar = options.overwriteHostAvatar;
        var imageTools = options.imageTools || ns.imageTools;
        var fetchImage = options.fetch || (typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
        var loadNativeImage = options.loadNativeImage || function (asset) {
            if (/^data:image\//i.test(asset.imageData)) return Promise.resolve(asset);
            if (!fetchImage || !imageTools || typeof imageTools.readImageFile !== 'function') {
                return Promise.reject(Object.assign(new Error('原头像图片读取组件不可用'), { code: 'AVATAR_NATIVE_READ_UNAVAILABLE' }));
            }
            return Promise.resolve(fetchImage(asset.imageData, { credentials: 'same-origin', cache: 'force-cache' })).then(function (response) {
                if (!response || !response.ok || typeof response.blob !== 'function') throw new Error('avatar image request failed');
                return response.blob();
            }).then(function (blob) {
                return imageTools.readImageFile(blob);
            }).then(function (dataUrl) {
                return Object.assign({}, asset, { imageData: dataUrl });
            }).catch(function (error) {
                throw Object.assign(new Error('无法读取角色或 User 的原头像'), { code: 'AVATAR_NATIVE_READ_FAILED', cause: error });
            });
        };
        if (!store) throw new Error('avatar store is required');

        var baselines = new WeakMap();
        var activeImages = new Set();
        var assetCache = new Map();
        var bindingPlans = [];
        var promotedBindings = new Map();
        var rotatedSources = new Map();
        var nativeImageCache = new Map();
        var runtimeAttributeValues = new WeakMap();
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
        var toolbarViewport = null;
        var editorRenderFrame = null;
        var editorSettleTimer = null;
        var editorSyncAll = false;
        var editorControlActive = false;
        var editorPreviewSettled = true;
        var scopePanelToken = 0;
        var activePointer = null;
        var dragOrigin = null;
        var temporaryUserOverride = null;
        var hostSourceTargets = new Set();

        function syncRuntimeAttribute(element, name, value) {
            if (!syncExactAttribute(element, name, value)) return false;
            var expected = runtimeAttributeValues.get(element);
            if (!expected) { expected = {}; runtimeAttributeValues.set(element, expected); }
            var normalized = value == null ? null : String(value);
            expected[name] = normalized;
            return true;
        }
        function isRuntimeAttributeMutation(record) {
            if (!record || record.type !== 'attributes' || (record.attributeName !== 'src' && record.attributeName !== 'srcset')) return false;
            var expected = runtimeAttributeValues.get(record.target);
            return Boolean(expected && Object.prototype.hasOwnProperty.call(expected, record.attributeName) &&
                expected[record.attributeName] === getAttribute(record.target, record.attributeName));
        }

        function requireMutable() {
            if (canMutate()) return null;
            return Object.assign(new Error('头像存储当前只读'), { code: 'AVATAR_STORAGE_READ_ONLY' });
        }

        function contextSafe() {
            try { return getContext() || {}; } catch (_) { return {}; }
        }
        function currentThemeKey() { return themeKey(getThemeName()); }
        function currentChatBindingKey() { return targets().chatBindingKey || ''; }
        function targets() { return getContextInfo(contextSafe()); }
        function isDedicatedThemeBinding(binding) {
            return Boolean(binding && /^theme-name:/.test(binding.themeKey || '') && Number(binding.version) >= THEME_BINDING_VERSION);
        }
        function isDedicatedChatBinding(binding) {
            return Boolean(binding && binding.themeKey && binding.themeKey.indexOf(CHAT_BINDING_PREFIX) === 0 && Number(binding.version) >= THEME_BINDING_VERSION);
        }
        function ensureSourceCache(asset) {
            var cached = rotatedSources.get(asset.id);
            if (!cached || cached.imageData !== asset.imageData) {
                var width = Math.max(1, Number(asset.width) || 1);
                var height = Math.max(1, Number(asset.height) || 1);
                var href = String(asset.imageData).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                cached = {
                    imageData: asset.imageData,
                    width: width,
                    height: height,
                    encodedHref: encodeURIComponent(href),
                    sources: new Map(),
                };
                while (rotatedSources.size >= SOURCE_ASSET_CACHE_LIMIT) rotatedSources.delete(rotatedSources.keys().next().value);
                rotatedSources.set(asset.id, cached);
            } else {
                rotatedSources.delete(asset.id);
                rotatedSources.set(asset.id, cached);
            }
            return cached;
        }
        function sourceForView(asset, view, geometryOverride) {
            view = normalizeView(view);
            if (!geometryOverride && !view.rotate && !view.flipX && !view.flipY) return { source: asset.imageData, geometry: null };
            var signature = [geometryOverride ? 'envelope' : 'exact', view.rotate, view.flipX ? -1 : 1, view.flipY ? -1 : 1].join(':');
            var cached = ensureSourceCache(asset);
            if (cached.sources.has(signature)) return cached.sources.get(signature);
            var geometry = geometryOverride || transformedSourceGeometry(asset, view);
            var centerX = round(geometry.canvasWidth / 2, 3);
            var centerY = round(geometry.canvasHeight / 2, 3);
            var transform = 'translate(' + centerX + ' ' + centerY + ') rotate(' + view.rotate + ') scale(' + (view.flipX ? -1 : 1) + ' ' + (view.flipY ? -1 : 1) + ') translate(' + round(-cached.width / 2, 3) + ' ' + round(-cached.height / 2, 3) + ')';
            var prefix = '<svg xmlns="http://www.w3.org/2000/svg" width="' + geometry.canvasWidth + '" height="' + geometry.canvasHeight + '" viewBox="0 0 ' + geometry.canvasWidth + ' ' + geometry.canvasHeight + '"><image href="';
            var suffix = '" width="' + cached.width + '" height="' + cached.height + '" transform="' + transform + '"/></svg>';
            var source = {
                source: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(prefix) + cached.encodedHref + encodeURIComponent(suffix),
                geometry: geometry,
            };
            if (cached.sources.size >= SOURCE_CACHE_LIMIT) cached.sources.delete(cached.sources.keys().next().value);
            cached.sources.set(signature, source);
            return source;
        }
        function resolvedImageSource(image, attributeSource) {
            return clean(image && (image.currentSrc || image.src)) || clean(attributeSource);
        }
        function captureBaseline(image) {
            var record = baselines.get(image);
            if (record) return record;
            record = {
                src: getAttribute(image, 'src'),
                resolvedSrc: resolvedImageSource(image, getAttribute(image, 'src')),
                srcset: getAttribute(image, 'srcset'),
                style: getAttribute(image, 'style'),
                naturalWidth: Number(image.naturalWidth) || 0,
                naturalHeight: Number(image.naturalHeight) || 0,
                targetClass: image.classList.contains(TARGET_CLASS),
                avatarClass: image.parentElement && image.parentElement.classList.contains(AVATAR_CLASS),
                animation: null,
                mapping: null,
                targetKey: '',
            };
            baselines.set(image, record);
            return record;
        }
        function nativeAssetForEntry(entry, target) {
            var image = entry && entry.image;
            var baseline = baselines.get(image);
            var attributeSource = baseline ? baseline.src : getAttribute(image, 'src');
            var source = baseline && baseline.resolvedSrc || resolvedImageSource(image, attributeSource);
            var rect = rectOf(image);
            return {
                id: 'native:' + target.key + ':' + source,
                imageData: source,
                width: baseline && baseline.naturalWidth || Number(image && image.naturalWidth) || Math.max(1, Math.round(rect.width)),
                height: baseline && baseline.naturalHeight || Number(image && image.naturalHeight) || Math.max(1, Math.round(rect.height)),
            };
        }
        function nativeSourceKey(target, entry) {
            if (target && target.kind === 'character') return clean(target.characterAvatar);
            var image = entry && entry.image;
            var baseline = baselines.get(image);
            return clean(baseline && (baseline.src || baseline.resolvedSrc)) || clean(getAttribute(image, 'src')) || resolvedImageSource(image, '');
        }
        function embeddedNativeAsset(entry, target) {
            var asset = nativeAssetForEntry(entry, target);
            if (/^data:image\//i.test(asset.imageData)) return Promise.resolve(asset);
            var cached = nativeImageCache.get(asset.id);
            if (cached) return cached;
            cached = Promise.resolve(loadNativeImage(asset)).then(function (embedded) {
                if (!embedded || !/^data:image\//i.test(embedded.imageData || '')) {
                    throw Object.assign(new Error('原头像图片读取结果无效'), { code: 'AVATAR_NATIVE_READ_FAILED' });
                }
                return embedded;
            }).catch(function (error) {
                nativeImageCache.delete(asset.id);
                throw error;
            });
            nativeImageCache.set(asset.id, cached);
            return cached;
        }
        function restoreImage(image, hostSourceTargetKey) {
            var record = baselines.get(image);
            if (!record) return;
            if (record.animation) { try { record.animation.cancel(); } catch (_) {} }
            syncRuntimeAttribute(image, 'src', record.src);
            syncRuntimeAttribute(image, 'srcset', record.srcset);
            setExactAttribute(image, 'style', record.style);
            if (!record.targetClass) image.classList.remove(TARGET_CLASS);
            if (image.parentElement && !record.avatarClass) image.parentElement.classList.remove(AVATAR_CLASS);
            record.animation = null;
            if (hostSourceTargetKey) {
                setImportantStyle(image, 'content', 'normal');
                record.targetKey = hostSourceTargetKey;
                activeImages.add(image);
                return;
            }
            activeImages.delete(image);
            baselines.delete(image);
        }
        function restoreAll() {
            Array.from(activeImages).forEach(restoreImage);
        }
        function applyToEntry(entry, asset, view, targetKey, preview) {
            var image = entry.image;
            var record = captureBaseline(image);
            if (record.animation) { try { record.animation.cancel(); } catch (_) {} }
            syncRuntimeAttribute(image, 'srcset', null);
            var sourceAsset = preview ? editorPreviewAsset(asset) : asset;
            var renderedSource = sourceForView(sourceAsset, view, preview ? editorPreviewGeometry(sourceAsset) : null);
            syncRuntimeAttribute(image, 'src', renderedSource.source);
            // Some theme CSS uses `content: url(...)` on avatar images. That
            // replaces the replaced element's rendered content and wins over
            // the new src, leaving a stale avatar visible even though the DOM
            // and binding store point at the selected asset.
            setImportantStyle(image, 'content', 'normal');
            if (win.CSS && typeof win.CSS.supports === 'function' && !win.CSS.supports('object-view-box', 'inset(10%)')) {
                throw Object.assign(new Error('当前浏览器暂不支持框内头像调整，请更新 WebView'), { code: 'CONTENT_CROP_UNSUPPORTED' });
            }
            setImportantStyle(image, 'object-view-box', objectViewBoxForView(view, renderedSource.geometry));
            record.targetKey = targetKey || '';
            activeImages.add(image);
        }
        function applyNativeToEntry(entry, view, target, embeddedAsset) {
            var image = entry.image;
            var record = captureBaseline(image);
            if (record.animation) { try { record.animation.cancel(); } catch (_) {} }
            var normalized = normalizeView(view);
            var nativeAsset = nativeAssetForEntry(entry, target);
            var transformsSource = Boolean(normalized.x || normalized.y || normalized.scale !== 1 || normalized.rotate || normalized.flipX || normalized.flipY);
            if (!transformsSource) {
                syncRuntimeAttribute(image, 'src', record.src || nativeAsset.imageData);
                syncRuntimeAttribute(image, 'srcset', record.srcset);
                setExactAttribute(image, 'style', record.style);
                setImportantStyle(image, 'content', 'normal');
                record.targetKey = target && target.key || '';
                activeImages.add(image);
                return;
            }
            var computed = win.getComputedStyle(image);
            var frame = {
                objectFit: computed.objectFit,
                objectPosition: computed.objectPosition,
                borderRadius: computed.borderRadius,
                clipPath: computed.clipPath,
                webkitMaskImage: computed.webkitMaskImage,
                maskImage: computed.maskImage,
            };
            applyToEntry(entry, embeddedAsset, normalized, target && target.key);
            if (frame.objectFit) setImportantStyle(image, 'object-fit', frame.objectFit);
            if (frame.objectPosition) setImportantStyle(image, 'object-position', frame.objectPosition);
            if (frame.borderRadius) setImportantStyle(image, 'border-radius', frame.borderRadius);
            if (frame.clipPath && frame.clipPath !== 'none') setImportantStyle(image, 'clip-path', frame.clipPath);
            if (frame.webkitMaskImage && frame.webkitMaskImage !== 'none') setImportantStyle(image, '-webkit-mask-image', frame.webkitMaskImage);
            if (frame.maskImage && frame.maskImage !== 'none') setImportantStyle(image, 'mask-image', frame.maskImage);
        }
        function applyHostSourceToEntry(entry, target) {
            captureBaseline(entry.image);
            restoreImage(entry.image, target && target.key);
        }
        function putHostSourceIntent(targetKey) {
            targetKey = clean(targetKey);
            if (!targetKey) return Promise.resolve(null);
            hostSourceTargets.add(targetKey);
            if (typeof store.putSourceIntent !== 'function') return Promise.resolve({ targetKey: targetKey, mode: 'host-source' });
            return store.putSourceIntent({ targetKey: targetKey, mode: 'host-source' });
        }
        function getHostSourceIntent(targetKey) {
            targetKey = clean(targetKey);
            if (!targetKey) return Promise.resolve(null);
            if (hostSourceTargets.has(targetKey)) return Promise.resolve({ targetKey: targetKey, mode: 'host-source' });
            if (typeof store.getSourceIntent !== 'function') return Promise.resolve(null);
            return store.getSourceIntent(targetKey).then(function (record) {
                if (record && record.mode === 'host-source') hostSourceTargets.add(targetKey);
                return record && record.mode === 'host-source' ? record : null;
            });
        }
        function getAsset(id) {
            if (assetCache.has(id)) return Promise.resolve(assetCache.get(id));
            return store.getAsset(id).then(function (asset) {
                if (asset) assetCache.set(id, asset);
                return asset;
            });
        }
        function getDefaultBinding(target) {
            return store.getBinding(DEFAULT_BINDING_KEY, target.key).then(function (binding) {
                if (binding) {
                    promotedBindings.set(target.key, binding);
                    return binding;
                }
                if (promotedBindings.has(target.key)) return promotedBindings.get(target.key);
                return null;
            });
        }
        function promoteLegacyBinding(target, legacy) {
            if (!legacy || isDedicatedThemeBinding(legacy)) return Promise.resolve(null);
            var promoted = Object.assign({}, legacy, { themeKey: DEFAULT_BINDING_KEY });
            delete promoted.id;
            delete promoted.version;
            return store.putBinding(promoted).then(function (saved) {
                promotedBindings.set(target.key, saved);
                return saved;
            }).catch(function (error) {
                onError(error);
                promotedBindings.set(target.key, promoted);
                return promoted;
            });
        }
        function getBindingForTarget(target, requestedThemeKey, requestedChatKey) {
            requestedThemeKey = requestedThemeKey || '';
            requestedChatKey = requestedChatKey || '';
            var chatScoped = requestedChatKey
                ? store.getBinding(requestedChatKey, target.key)
                : Promise.resolve(null);
            return chatScoped.then(function (chatBinding) {
                if (isDedicatedChatBinding(chatBinding)) return chatBinding;
                if (target.kind === 'user' && temporaryUserOverride) {
                    if (temporaryUserOverride.themeKey === requestedThemeKey && temporaryUserOverride.targetKey === target.key) {
                        return temporaryUserOverride;
                    }
                    temporaryUserOverride = null;
                }
                var themed = requestedThemeKey
                    ? store.getBinding(requestedThemeKey, target.key)
                    : Promise.resolve(null);
                return themed.then(function (themeBinding) {
                    if (isDedicatedThemeBinding(themeBinding)) return themeBinding;
                    return getDefaultBinding(target).then(function (binding) {
                        if (binding) return binding;
                        return promoteLegacyBinding(target, themeBinding);
                    });
                });
            });
        }
        function desiredForBinding(target, binding, asset) {
            return messageImages(doc, target).map(function (entry) { return { entry: entry, binding: binding, asset: asset }; });
        }
        function desiredForNativeView(target, record, asset) {
            return messageImages(doc, target).map(function (entry) {
                return { entry: entry, binding: record, asset: asset, native: true, target: target };
            });
        }
        function desiredForHostSource(target, record) {
            return messageImages(doc, target).map(function (entry) {
                return { entry: entry, binding: record, hostSource: true, target: target };
            });
        }
        function desiredForPlan(plan) {
            return plan.hostSource
                ? desiredForHostSource(plan.target, plan.binding)
                : plan.native
                ? desiredForNativeView(plan.target, plan.binding, plan.asset)
                : desiredForBinding(plan.target, plan.binding, plan.asset);
        }
        function applyDesired(items) {
            var desired = new Set(items.map(function (item) { return item.entry.image; }));
            Array.from(activeImages).forEach(function (image) { if (!desired.has(image)) restoreImage(image); });
            items.forEach(function (item) {
                if (item.hostSource) applyHostSourceToEntry(item.entry, item.target);
                else if (item.native) applyNativeToEntry(item.entry, item.binding.view, item.target, item.asset);
                else applyToEntry(item.entry, item.asset, item.binding.view, item.binding.targetKey);
            });
        }
        function resolveRuntimeDesired(requestedThemeKey, requestedChatKey) {
            var info = targets();
            var targetList = [info.character, info.user].filter(Boolean);
            var foundBinding = false;
            return Promise.all(targetList.map(function (target) {
                return getBindingForTarget(target, requestedThemeKey, requestedChatKey).then(function (binding) {
                    if (binding) {
                        foundBinding = true;
                        return getAsset(binding.avatarId).then(function (asset) {
                            if (!asset) {
                                if (binding.themeKey === DEFAULT_BINDING_KEY) promotedBindings.delete(target.key);
                                var wasTemporary = binding === temporaryUserOverride;
                                if (wasTemporary) temporaryUserOverride = null;
                                var removeMissing = wasTemporary
                                    ? Promise.resolve()
                                    : putHostSourceIntent(target.key).then(function () {
                                        return store.deleteBinding(binding.themeKey, target.key);
                                    });
                                return removeMissing.then(function () {
                                    if (binding.themeKey !== DEFAULT_BINDING_KEY) {
                                        return getDefaultBinding(target).then(function (fallback) {
                                            if (!fallback) return null;
                                            return getAsset(fallback.avatarId).then(function (fallbackAsset) {
                                                return fallbackAsset ? { target: target, binding: fallback, asset: fallbackAsset, native: false } : null;
                                            });
                                        });
                                    }
                                    return null;
                                });
                            }
                            return { target: target, binding: binding, asset: asset, native: false };
                        });
                    }
                    return store.getNativeView(target.key).then(function (record) {
                        if (!record) {
                            return getHostSourceIntent(target.key).then(function (intent) {
                                if (!intent) return null;
                                foundBinding = true;
                                return { target: target, binding: intent, asset: null, native: false, hostSource: true };
                            });
                        }
                        var representative = messageImages(doc, target)[0] || null;
                        var sourceKey = nativeSourceKey(target, representative);
                        if (sourceKey && record.sourceKey !== sourceKey) {
                            return putHostSourceIntent(target.key).then(function () {
                                return store.deleteNativeView(target.key);
                            }).then(function () { return null; });
                        }
                        foundBinding = true;
                        return embeddedNativeAsset(representative, target).then(function (asset) {
                            return { target: target, binding: record, asset: asset, native: true };
                        });
                    });
                });
            })).then(function (groups) {
                var plans = groups.filter(Boolean);
                return {
                    items: plans.reduce(function (all, plan) { return all.concat(desiredForPlan(plan)); }, []),
                    plans: plans,
                    hasBinding: foundBinding,
                };
            });
        }
        function syncEditorInstances() {
            if (!editor) return false;
            var entries = messageImages(doc, editor.target);
            var lightweightNative = editor.mode === 'native' && editor.nativeKnownImages;
            if (!editor.representative || editor.representative.image.isConnected === false) {
                cancelEdit('target-disconnected');
                return false;
            }
            var desired = new Set();
            bindingPlans.forEach(function (plan) {
                if (plan.target.key === editor.target.key) return;
                desiredForPlan(plan).forEach(function (item) {
                    desired.add(item.entry.image);
                    if (!lightweightNative || !activeImages.has(item.entry.image)) {
                        if (item.hostSource) applyHostSourceToEntry(item.entry, item.target);
                        else if (item.native) applyNativeToEntry(item.entry, item.binding.view, item.target, item.asset);
                        else applyToEntry(item.entry, item.asset, item.binding.view, item.binding.targetKey);
                    }
                });
            });
            entries.forEach(function (entry) { desired.add(entry.image); });
            Array.from(activeImages).forEach(function (image) { if (!desired.has(image)) restoreImage(image); });
            entries.forEach(function (entry) {
                if (lightweightNative) {
                    if (entry.image === editor.representative.image) applyNativeToEntry(entry, editor.view, editor.target, editor.asset);
                    else if (!editor.nativeKnownImages.has(entry.image)) {
                        applyNativeToEntry(entry, editor.view, editor.target, editor.asset);
                        editor.nativeKnownImages.add(entry.image);
                    }
                    return;
                }
                if (editor.mode === 'native') applyNativeToEntry(entry, editor.view, editor.target, editor.asset);
                else applyToEntry(entry, editor.asset, editor.view, editor.target.key);
            });
            return true;
        }
        function syncEditorRepresentative() {
            if (!editor || !editor.representative || editor.representative.image.isConnected === false) {
                if (editor) cancelEdit('target-disconnected');
                return false;
            }
            if (editor.mode === 'native') applyNativeToEntry(editor.representative, editor.view, editor.target, editor.asset);
            else applyToEntry(editor.representative, editor.asset, editor.view, editor.target.key, !editorPreviewSettled);
            return true;
        }
        function reconcile() {
            var request = ++sequence;
            var requestedThemeKey = currentThemeKey();
            var requestedChatKey = currentChatBindingKey();
            if (editor) {
                if (editorPreviewSettled) syncEditorInstances();
                else syncEditorRepresentative();
                return Promise.resolve({ editing: true });
            }
            return Promise.resolve(store.ready).then(function () { return resolveRuntimeDesired(requestedThemeKey, requestedChatKey); }).then(function (desired) {
                if (request !== sequence || editor || requestedThemeKey !== currentThemeKey() || requestedChatKey !== currentChatBindingKey()) return { superseded: true };
                hasRuntimeBinding = desired.hasBinding;
                bindingPlans = desired.plans;
                try { applyDesired(desired.items); observeChat(); }
                catch (error) { restoreAll(); onError(error); return { ok: false, error: error }; }
                return { ok: true, count: desired.items.length };
            }).catch(function (error) { if (request === sequence) onError(error); return { ok: false, error: error }; });
        }
        function scheduleReconcile(delay) {
            if (reconcileTimer) win.clearTimeout(reconcileTimer);
            reconcileTimer = win.setTimeout(function () { reconcileTimer = null; reconcile(); }, delay == null ? 40 : delay);
        }
        function applyCachedPlans() {
            if (editor) return editorPreviewSettled ? syncEditorInstances() : syncEditorRepresentative();
            if (!bindingPlans.length) return false;
            try {
                applyDesired(bindingPlans.reduce(function (all, plan) { return all.concat(desiredForPlan(plan)); }, []));
                return true;
            } catch (error) {
                onError(error);
                return false;
            }
        }
        function invalidateAndScheduleReconcile(delay) {
            sequence += 1;
            scheduleReconcile(delay);
        }
        function observeChat() {
            var chat = doc.getElementById && doc.getElementById('chat');
            if (!editor && !hasRuntimeBinding) chat = null;
            if (chat === observedChat) return;
            if (chatObserver) chatObserver.disconnect();
            observedChat = chat;
            if (!chat || typeof win.MutationObserver !== 'function') return;
            chatObserver = new win.MutationObserver(function (records) {
                if (records && records.length && records.every(isRuntimeAttributeMutation)) return;
                applyCachedPlans();
                scheduleReconcile(0);
            });
            chatObserver.observe(chat, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['is_user', 'is_system', 'src', 'srcset'],
            });
        }
        function addEvent(source, name, handler) {
            if (!source || !name || typeof source.on !== 'function') return;
            source.on(name, handler);
            listeners.push({ source: source, name: name, handler: handler });
        }
        function contextChanged() {
            if (editor) cancelEdit('context-changed');
            else { observeChat(); invalidateAndScheduleReconcile(20); }
        }
        function contentChanged() {
            if (!editor && !hasRuntimeBinding) return;
            observeChat();
            applyCachedPlans();
            scheduleReconcile(0);
        }
        function onThemeControlChange(event) {
            if (!event.target || event.target.id !== 'themes') return;
            if (editor) cancelEdit('theme-changed');
            else invalidateAndScheduleReconcile(80);
        }
        function start() {
            if (started) return Promise.resolve(false);
            if (!canStart()) return Promise.reject(Object.assign(new Error('头像本地存储不可用'), { code: 'AVATAR_STORAGE_NOT_READY' }));
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
            bindingPlans = [];
            temporaryUserOverride = null;
            hostSourceTargets.clear();
            nativeImageCache.clear();
            sequence += 1;
            restoreAll();
        }
        function capability(kind) {
            var info = targets();
            var target = kind === 'character' ? info.character : info.user;
            if (kind === 'character' && info.isGroup) return { available: false, reason: '当前群聊暂不支持角色头像原位调整', target: null };
            if (!target) return { available: false, reason: kind === 'character' ? '无法识别当前角色' : '无法识别当前 User', target: null };
            var entries = messageImages(doc, target);
            var visibleRepresentative = chooseRepresentative(entries, win);
            var representative = visibleRepresentative || entries[entries.length - 1] || null;
            if (!representative) return { available: false, reason: '当前聊天中还没有可调整的目标头像', target: target, count: 0 };
            return { available: true, reason: '', target: target, count: entries.length, representative: representative, visible: !!visibleRepresentative };
        }
        function getCapabilities() { return { character: capability('character'), user: capability('user'), themeKey: DEFAULT_BINDING_KEY }; }
        function diagnosticsFor(entry, target) {
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
                themeInlineStyleBaseline: (baselines.get(entry.image) || {}).style || null,
                strategy: 'css-object-view-box-content-crop',
                coordinateModel: 'normalized-avatar-content-transform',
                objectViewBox: entry.image.style && entry.image.style.getPropertyValue ? entry.image.style.getPropertyValue('object-view-box') : '',
            };
        }
        function positionEditorToolbar() {
            if (!toolbarHost) return;
            var viewport = win.visualViewport;
            var viewportWidth = Number(viewport && viewport.width) || Number(win.innerWidth) || 320;
            var viewportHeight = Number(viewport && viewport.height) || Number(win.innerHeight) || 480;
            var offsetLeft = Number(viewport && viewport.offsetLeft) || 0;
            var offsetTop = Number(viewport && viewport.offsetTop) || 0;
            var rect = rectOf(toolbarHost);
            var top = Math.max(offsetTop + 8, offsetTop + viewportHeight - rect.height - 12);
            setImportantStyle(toolbarHost, 'left', round(offsetLeft + viewportWidth / 2, 2) + 'px');
            setImportantStyle(toolbarHost, 'top', 'calc(' + round(top, 2) + 'px - env(safe-area-inset-bottom,0px))');
            setImportantStyle(toolbarHost, 'max-width', Math.max(240, viewportWidth - 16) + 'px');
        }
        function bindToolbarViewport() {
            toolbarViewport = win.visualViewport || null;
            if (toolbarViewport && typeof toolbarViewport.addEventListener === 'function') {
                toolbarViewport.addEventListener('resize', positionEditorToolbar);
                toolbarViewport.addEventListener('scroll', positionEditorToolbar);
            }
            if (typeof win.addEventListener === 'function') {
                win.addEventListener('resize', positionEditorToolbar);
                win.addEventListener('orientationchange', positionEditorToolbar);
            }
        }
        function unbindToolbarViewport() {
            if (toolbarViewport && typeof toolbarViewport.removeEventListener === 'function') {
                toolbarViewport.removeEventListener('resize', positionEditorToolbar);
                toolbarViewport.removeEventListener('scroll', positionEditorToolbar);
            }
            if (typeof win.removeEventListener === 'function') {
                win.removeEventListener('resize', positionEditorToolbar);
                win.removeEventListener('orientationchange', positionEditorToolbar);
            }
            toolbarViewport = null;
        }
        function ensureEditorUi() {
            styleNode = doc.createElement('style');
            styleNode.id = STYLE_ID;
            styleNode.textContent = [
                '.' + TARGET_CLASS + '{touch-action:none!important;user-select:none!important;-webkit-user-select:none!important;-webkit-user-drag:none!important;cursor:grab!important}',
                '.' + AVATAR_CLASS + '{outline:2px solid var(--SmartThemeQuoteColor,#7c6daf)!important;outline-offset:3px!important}',
            ].join('');
            doc.head.appendChild(styleNode);
            toolbarHost = doc.createElement('div');
            toolbarHost.id = TOOLBAR_ID;
            toolbarHost.setAttribute('style', 'all:initial!important;position:fixed!important;left:50%!important;top:0!important;bottom:auto!important;transform:translateX(-50%)!important;z-index:2147483647!important;display:block!important;width:max-content!important;max-width:calc(100vw - 16px)!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;box-sizing:border-box!important');
            var toolbarRoot = typeof toolbarHost.attachShadow === 'function' ? toolbarHost.attachShadow({ mode: 'open' }) : toolbarHost;
            var toolbarStyle = doc.createElement('style');
            toolbarStyle.textContent = [
                ':host{--tm-avatar-accent:var(--SmartThemeQuoteColor,#7c6daf);--tm-avatar-text:var(--SmartThemeBodyColor,#eee);--tm-avatar-bg:var(--SmartThemeBlurTintColor,var(--SmartThemeBackgroundColor,#16161a))}',
                '.tm-avatar-editor-bar{width:min(420px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;padding:10px;border:1px solid rgba(127,127,127,.26);border-color:color-mix(in srgb,var(--tm-avatar-accent) 42%,transparent);border-radius:14px;background:var(--tm-avatar-bg);color:var(--tm-avatar-text);font:13px/1.2 system-ui,sans-serif;box-shadow:0 10px 32px rgba(0,0,0,.34);backdrop-filter:blur(14px);user-select:none;-webkit-user-select:none;pointer-events:auto;touch-action:manipulation}',
                '.tm-avatar-editor-controls{display:grid;gap:5px}.tm-avatar-editor-row{display:grid;grid-template-columns:34px 32px minmax(100px,1fr) 44px 32px;align-items:center;gap:6px;min-height:34px}.tm-avatar-editor-label{white-space:nowrap;font-weight:600;opacity:.82}.tm-avatar-editor-value{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.76}.tm-avatar-editor-row input{width:100%;min-width:0;margin:0;accent-color:var(--tm-avatar-accent)}',
                'button{appearance:none;border:1px solid rgba(127,127,127,.28);border-radius:8px;background:rgba(127,127,127,.12);color:inherit;min-width:32px;min-height:32px;padding:5px 8px;font:inherit;white-space:nowrap;cursor:pointer}button:hover,button:focus-visible{border-color:var(--tm-avatar-accent);color:var(--tm-avatar-accent);outline:none}button:disabled{cursor:default;opacity:.38}.tm-avatar-editor-step{padding:0;font-size:17px;line-height:1}.tm-avatar-editor-bind{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;white-space:normal}.tm-avatar-editor-bind span{font-weight:650}.tm-avatar-editor-bind small{font-size:10px;opacity:.62;text-align:right}.tm-avatar-editor-bind.is-active{border-color:var(--tm-avatar-accent);background:color-mix(in srgb,var(--tm-avatar-accent) 18%,transparent);color:var(--tm-avatar-accent)}.tm-avatar-editor-scope-panel[hidden]{display:none}.tm-avatar-editor-scope-panel{display:flex;flex-direction:column;gap:5px;padding:7px;border:1px solid color-mix(in srgb,var(--tm-avatar-accent) 34%,transparent);border-radius:10px;background:rgba(127,127,127,.08)}.tm-avatar-editor-scope-title{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 2px 4px;font-weight:700}.tm-avatar-editor-scope-title small{font-size:10px;font-weight:500;opacity:.64}.tm-avatar-editor-priority{padding:0 2px 4px;font-size:10px;line-height:1.35;opacity:.68}.tm-avatar-editor-scope-option{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:38px;text-align:left;white-space:normal}.tm-avatar-editor-scope-option span{display:flex;min-width:0;flex-direction:column;gap:2px}.tm-avatar-editor-scope-option strong{font-size:12px}.tm-avatar-editor-scope-option small{font-size:10px;opacity:.64}.tm-avatar-editor-scope-option em{font-size:9px;font-style:normal;opacity:.72}.tm-avatar-editor-footer{display:grid;grid-template-columns:repeat(6,minmax(0,auto));gap:5px;padding-top:2px}.tm-avatar-editor-footer button{min-width:0}.tm-avatar-editor-footer button.is-active{border-color:var(--tm-avatar-accent);background:rgba(127,127,127,.18);background:color-mix(in srgb,var(--tm-avatar-accent) 22%,transparent);color:var(--tm-avatar-accent)}.tm-avatar-editor-save{border-color:var(--tm-avatar-accent);background:var(--tm-avatar-accent);color:#fff;font-weight:700}.tm-avatar-editor-save:hover,.tm-avatar-editor-save:focus-visible{filter:brightness(1.08);color:#fff}',
                '@media(max-width:430px){.tm-avatar-editor-bar{gap:6px;padding:8px;font-size:12px}.tm-avatar-editor-controls{gap:3px}.tm-avatar-editor-row{grid-template-columns:30px 30px minmax(92px,1fr) 40px 30px;gap:4px;min-height:32px}button{min-height:30px;padding:4px 6px}.tm-avatar-editor-footer{gap:4px}}',
            ].join('');
            toolbarRoot.appendChild(toolbarStyle);
            toolbar = doc.createElement('div');
            toolbar.className = 'tm-avatar-editor-bar';
            toolbar.setAttribute('role', 'dialog');
            toolbar.setAttribute('aria-label', '头像调整');
            toolbar.innerHTML = '<div class="tm-avatar-editor-controls">' +
                '<div class="tm-avatar-editor-row"><span class="tm-avatar-editor-label">大小</span><button type="button" class="tm-avatar-editor-step" data-step-view="scale" data-step-direction="-1" aria-label="缩小">−</button><input type="range" min="0.5" max="3" step="0.05" value="1" data-view="scale" aria-label="调整大小"><output class="tm-avatar-editor-value" data-view-output="scale">100%</output><button type="button" class="tm-avatar-editor-step" data-step-view="scale" data-step-direction="1" aria-label="放大">+</button></div>' +
                '<div class="tm-avatar-editor-row"><span class="tm-avatar-editor-label">左右</span><button type="button" class="tm-avatar-editor-step" data-step-view="x" data-step-direction="-1" aria-label="向左移动">−</button><input type="range" min="-1" max="1" step="0.01" value="0" data-view="x" aria-label="左右位置"><output class="tm-avatar-editor-value" data-view-output="x">0%</output><button type="button" class="tm-avatar-editor-step" data-step-view="x" data-step-direction="1" aria-label="向右移动">+</button></div>' +
                '<div class="tm-avatar-editor-row"><span class="tm-avatar-editor-label">上下</span><button type="button" class="tm-avatar-editor-step" data-step-view="y" data-step-direction="-1" aria-label="向上移动">−</button><input type="range" min="-1" max="1" step="0.01" value="0" data-view="y" aria-label="上下位置"><output class="tm-avatar-editor-value" data-view-output="y">0%</output><button type="button" class="tm-avatar-editor-step" data-step-view="y" data-step-direction="1" aria-label="向下移动">+</button></div>' +
                '<div class="tm-avatar-editor-row"><span class="tm-avatar-editor-label">倾斜</span><button type="button" class="tm-avatar-editor-step" data-step-view="rotate" data-step-direction="-1" aria-label="逆时针倾斜">−</button><input type="range" min="-180" max="180" step="1" value="0" data-view="rotate" aria-label="倾斜角度"><output class="tm-avatar-editor-value" data-view-output="rotate">0°</output><button type="button" class="tm-avatar-editor-step" data-step-view="rotate" data-step-direction="1" aria-label="顺时针倾斜">+</button></div>' +
                '</div>' + (editor.mode === 'library' && editor.target.kind === 'user' && editor.bindingMode === 'adaptive'
                    ? '<button type="button" class="tm-avatar-editor-bind" data-action="bind-theme" aria-pressed="false"><span>绑定到当前美化</span><small data-bind-theme-hint></small></button>'
                    : '') + '<div class="tm-avatar-editor-scope-panel" data-scope-panel hidden></div><div class="tm-avatar-editor-footer"><button type="button" data-action="flip-x" aria-pressed="false" title="水平镜像">水平</button><button type="button" data-action="flip-y" aria-pressed="false" title="垂直镜像">垂直</button><button type="button" data-action="reset">重置</button>' + (editor.mode === 'library' ? '<button type="button" data-action="clear-bindings" title="解除头像绑定">解绑</button>' : '') + '<button type="button" data-action="cancel">取消</button><button type="button" class="tm-avatar-editor-save" data-action="save">保存</button></div>';
            toolbar.addEventListener('click', onToolbarClick);
            toolbar.addEventListener('input', onToolbarInput);
            toolbar.addEventListener('change', onToolbarCommit);
            toolbar.addEventListener('pointerdown', onToolbarPointerStart);
            toolbar.addEventListener('pointerup', onToolbarPointerEnd);
            toolbar.addEventListener('pointercancel', onToolbarPointerEnd);
            toolbarRoot.appendChild(toolbar);
            doc.body.appendChild(toolbarHost);
            bindToolbarViewport();
            positionEditorToolbar();
            if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(positionEditorToolbar);
        }
        function updateToolbar() {
            if (!toolbar || !editor) return;
            ['scale', 'x', 'y', 'rotate'].forEach(function (name) {
                var input = toolbar.querySelector('[data-view="' + name + '"]');
                var output = toolbar.querySelector('[data-view-output="' + name + '"]');
                if (input) input.value = editor.view[name];
                if (output) output.textContent = name === 'rotate' ? Math.round(editor.view.rotate) + '°' : Math.round(editor.view[name] * 100) + '%';
            });
            ['flipX', 'flipY'].forEach(function (name) {
                var action = name === 'flipX' ? 'flip-x' : 'flip-y';
                var button = toolbar.querySelector('[data-action="' + action + '"]');
                if (!button) return;
                button.classList.toggle('is-active', editor.view[name]);
                button.setAttribute('aria-pressed', editor.view[name] ? 'true' : 'false');
            });
            var bindButton = toolbar.querySelector('[data-action="bind-theme"]');
            if (bindButton) {
                bindButton.classList.toggle('is-active', editor.bindToTheme === true);
                bindButton.setAttribute('aria-pressed', editor.bindToTheme === true ? 'true' : 'false');
                var hint = bindButton.querySelector('[data-bind-theme-hint]');
                if (hint) hint.textContent = editor.bindToTheme
                    ? '保存后加入并设为当前头像'
                    : (editor.unboundSaveMode === 'temporary' ? '未绑定：仅临时替换' : '未绑定：保存为全局头像');
            }
        }
        function scopeOptionHtml(action, label, hint, state, requireBinding, boundText) {
            state = state || {};
            var bound = Boolean(state.binding);
            var enabled = state.available !== false && (!requireBinding || bound);
            var statusText = bound ? (boundText || '当前已设置') : (requireBinding ? '当前无绑定' : '');
            return '<button type="button" class="tm-avatar-editor-scope-option" data-action="' + action + '"' + (enabled ? '' : ' disabled') + '><span><strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(hint) + '</small></span><em>' + escapeHtml(statusText) + '</em></button>';
        }
        function closeScopePanel() {
            scopePanelToken += 1;
            if (!toolbar) return;
            var panel = toolbar.querySelector('[data-scope-panel]');
            if (panel) { panel.hidden = true; panel.innerHTML = ''; delete panel.dataset.mode; }
            ['save', 'clear-bindings'].forEach(function (action) {
                var button = toolbar.querySelector('[data-action="' + action + '"]');
                if (button) button.setAttribute('aria-expanded', 'false');
            });
            positionEditorToolbar();
        }
        function renderScopePanel(mode, status) {
            if (!toolbar || !editor) return;
            var panel = toolbar.querySelector('[data-scope-panel]');
            if (!panel) return;
            var scopes = status && status.scopes || {};
            if (mode === 'save') {
                panel.innerHTML = '<div class="tm-avatar-editor-scope-title"><span>保存头像</span><small>选择应用范围</small></div>' +
                    '<div class="tm-avatar-editor-priority">显示优先级：当前聊天 ＞ 当前美化 ＞ 全局 ＞ SillyTavern 原头像。保存到低权重范围不会清除高权重绑定。</div>' +
                    scopeOptionHtml('save-chat', '绑定当前聊天', '最高优先级，仅当前聊天使用', scopes.chat, false, '当前已设置') +
                    scopeOptionHtml('save-theme', '绑定当前美化', '可以继续添加头像及其调整数据', scopes.theme, false, '已绑定 ' + Number(scopes.theme && scopes.theme.count || 1) + ' 张头像') +
                    scopeOptionHtml('save-global', editor.target.kind === 'user' ? '覆盖 User 全局头像' : '覆盖该角色全局头像', '作为没有聊天或美化绑定时的默认头像', scopes.global, false, '当前已设置') +
                    scopeOptionHtml('save-original', editor.target.kind === 'user' ? '覆盖当前人设原头像' : '覆盖当前角色卡卡面', '不清除绑定；当前调整参数不会写进原图', scopes.original, false);
            } else {
                panel.innerHTML = '<div class="tm-avatar-editor-scope-title"><span>解除头像绑定</span><small>只清除所选范围</small></div>' +
                    '<div class="tm-avatar-editor-priority">清除后立即退出调整，并按聊天 ＞ 美化 ＞ 全局 ＞ 原头像回退。</div>' +
                    scopeOptionHtml('clear-chat', '清除当前聊天绑定', '只影响当前聊天', scopes.chat, true, '当前有绑定') +
                    scopeOptionHtml('clear-theme', '清除当前美化绑定', '清除当前目标在此美化下的全部头像', scopes.theme, true, '已绑定 ' + Number(scopes.theme && scopes.theme.count || 1) + ' 张头像') +
                    scopeOptionHtml('clear-global', editor.target.kind === 'user' ? '清除 User 全局头像' : '清除该角色全局头像', '不会清除聊天或美化绑定', scopes.global, true, '当前有绑定');
            }
            positionEditorToolbar();
        }
        function openScopePanel(mode) {
            if (!toolbar || !editor || editor.mode !== 'library') return Promise.resolve(false);
            var panel = toolbar.querySelector('[data-scope-panel]');
            if (!panel) return Promise.resolve(false);
            if (!panel.hidden && panel.dataset.mode === mode) { closeScopePanel(); return Promise.resolve(false); }
            var token = ++scopePanelToken;
            panel.hidden = false;
            panel.dataset.mode = mode;
            panel.innerHTML = '<div class="tm-avatar-editor-priority">正在读取头像绑定…</div>';
            ['save', 'clear-bindings'].forEach(function (action) {
                var button = toolbar.querySelector('[data-action="' + action + '"]');
                if (button) button.setAttribute('aria-expanded', action === (mode === 'save' ? 'save' : 'clear-bindings') ? 'true' : 'false');
            });
            positionEditorToolbar();
            return getApplicationScopes(editor.target.kind).then(function (status) {
                if (token !== scopePanelToken || !editor || !panel.parentNode || panel.dataset.mode !== mode) return false;
                renderScopePanel(mode, status);
                return true;
            }).catch(function (error) {
                if (token === scopePanelToken && panel.parentNode) panel.innerHTML = '<div class="tm-avatar-editor-priority">头像绑定读取失败</div>';
                onError(error);
                return false;
            });
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
            scopePanelToken += 1;
            unbindRepresentative();
            unbindToolbarViewport();
            cancelEditorSettle();
            cancelEditorSync();
            if (toolbar) toolbar.removeEventListener('click', onToolbarClick);
            if (toolbar) toolbar.removeEventListener('input', onToolbarInput);
            if (toolbar) toolbar.removeEventListener('change', onToolbarCommit);
            if (toolbar) toolbar.removeEventListener('pointerdown', onToolbarPointerStart);
            if (toolbar) toolbar.removeEventListener('pointerup', onToolbarPointerEnd);
            if (toolbar) toolbar.removeEventListener('pointercancel', onToolbarPointerEnd);
            if (toolbarHost && toolbarHost.parentNode) toolbarHost.parentNode.removeChild(toolbarHost);
            if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode);
            toolbarHost = null;
            toolbar = null;
            styleNode = null;
            editorControlActive = false;
            editorPreviewSettled = true;
        }
        function beginEdit(input) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            input = input || {};
            if (editor || editorClosing) return Promise.reject(Object.assign(new Error('头像编辑器正在使用中'), { code: 'EDITOR_ACTIVE' }));
            var kind = input.target && input.target.kind || input.kind;
            var cap = capability(kind);
            if (!cap.available) return Promise.reject(Object.assign(new Error(cap.reason), { code: 'TARGET_UNAVAILABLE' }));
            var requestedMode = clean(input.bindingMode);
            var bindingMode = requestedMode === 'deferred' || requestedMode === 'theme' || requestedMode === 'chat' ||
                (kind === 'user' && (requestedMode === 'temporary' || requestedMode === 'adaptive'))
                ? requestedMode
                : 'global';
            var requestedChatKey = currentChatBindingKey();
            var requestedThemeKey = bindingMode === 'global'
                ? DEFAULT_BINDING_KEY
                : (bindingMode === 'chat' ? requestedChatKey : themeKey(input.themeName || getThemeName()));
            if (bindingMode === 'chat' && !requestedThemeKey) {
                return Promise.reject(Object.assign(new Error('无法可靠识别当前聊天'), { code: 'CHAT_UNAVAILABLE' }));
            }
            if (bindingMode !== 'global' && bindingMode !== 'chat' && bindingMode !== 'deferred' && !requestedThemeKey) {
                return Promise.reject(Object.assign(new Error('无法识别当前美化'), { code: 'THEME_UNAVAILABLE' }));
            }
            var editContextPromise;
            if (bindingMode === 'adaptive') {
                editContextPromise = Promise.all([
                    getThemeUserBindingSet(input.themeName || getThemeName()),
                    getDefaultBinding(cap.target),
                ]).then(function (parts) {
                    var bindingSet = parts[0];
                    var selected = bindingSet.candidates.find(function (binding) { return binding.avatarId === input.avatarId; }) || null;
                    var globalBinding = parts[1] && parts[1].avatarId === input.avatarId ? parts[1] : null;
                    return {
                        previous: selected || globalBinding,
                        bindToTheme: Boolean(selected),
                        unboundSaveMode: bindingSet.active ? 'temporary' : 'global',
                    };
                });
            } else {
                var previousPromise = bindingMode === 'temporary' || bindingMode === 'deferred'
                    ? getBindingForTarget(cap.target, requestedThemeKey, currentChatBindingKey())
                    : store.getBinding(requestedThemeKey, cap.target.key).then(function (binding) {
                        if (bindingMode === 'theme' && !isDedicatedThemeBinding(binding)) return null;
                        if (bindingMode === 'chat' && !isDedicatedChatBinding(binding)) return null;
                        return binding;
                    });
                editContextPromise = previousPromise.then(function (binding) {
                    return { previous: binding, bindToTheme: bindingMode === 'theme', unboundSaveMode: bindingMode };
                });
            }
            return Promise.all([getAsset(input.avatarId), editContextPromise]).then(function (parts) {
                var asset = parts[0];
                var editContext = parts[1];
                if (!asset) throw Object.assign(new Error('所选头像不存在'), { code: 'AVATAR_NOT_FOUND' });
                editor = {
                    mode: 'library',
                    bindingMode: bindingMode,
                    themeKey: requestedThemeKey,
                    chatKey: requestedChatKey,
                    target: cap.target,
                    avatarId: asset.id,
                    asset: asset,
                    previousBinding: clone(editContext.previous),
                    view: normalizeView(editContext.previous && editContext.previous.view),
                    bindToTheme: editContext.bindToTheme,
                    unboundSaveMode: editContext.unboundSaveMode,
                    representative: cap.representative,
                    diagnostics: null,
                };
                editorPreviewSettled = true;
                win.setTimeout(function () {
                    if (editor && editor.asset.id === asset.id) {
                        ensureSourceCache(asset);
                        ensureSourceCache(editorPreviewAsset(asset));
                    }
                }, 0);
                observeChat();
                ensureEditorUi();
                try {
                    syncEditorInstances();
                    bindRepresentative();
                    editor.diagnostics = diagnosticsFor(editor.representative, editor.target);
                    updateToolbar();
                } catch (error) {
                    finishEditorUi();
                    editor = null;
                    return reconcile().then(function () { throw error; });
                }
                return getState();
            });
        }
        function beginNativeEdit(kind) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            if (editor || editorClosing) return Promise.reject(Object.assign(new Error('头像编辑器正在使用中'), { code: 'EDITOR_ACTIVE' }));
            kind = kind === 'user' ? 'user' : 'character';
            var cap = capability(kind);
            if (!cap.available) return Promise.reject(Object.assign(new Error(cap.reason), { code: 'TARGET_UNAVAILABLE' }));
            return Promise.all([getBindingForTarget(cap.target), store.getNativeView(cap.target.key), embeddedNativeAsset(cap.representative, cap.target)]).then(function (parts) {
                var sourceKey = nativeSourceKey(cap.target, cap.representative);
                var nativeView = parts[1] && parts[1].sourceKey === sourceKey ? parts[1] : null;
                editor = {
                    mode: 'native',
                    themeKey: null,
                    target: cap.target,
                    avatarId: null,
                    asset: parts[2],
                    previousBinding: clone(parts[0]),
                    previousNativeView: clone(nativeView),
                    nativeSourceKey: sourceKey,
                    view: normalizeView(nativeView && nativeView.view),
                    representative: cap.representative,
                    diagnostics: null,
                };
                editorPreviewSettled = true;
                observeChat();
                ensureEditorUi();
                try {
                    syncEditorInstances();
                    editor.nativeKnownImages = new Set(messageImages(doc, editor.target).map(function (item) { return item.image; }));
                    bindRepresentative();
                    editor.diagnostics = diagnosticsFor(editor.representative, editor.target);
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
            editorPreviewSettled = false;
            updateToolbar();
            scheduleEditorSync();
            scheduleEditorSettle();
            event.preventDefault(); event.stopImmediatePropagation();
        }
        function onPointerUp(event) {
            if (activePointer == null || event.pointerId != null && event.pointerId !== activePointer) return;
            endDrag(event);
        }
        function endDrag(event) {
            var completedDrag = activePointer != null && dragOrigin;
            if (activePointer != null && editor && editor.representative) {
                try { editor.representative.image.releasePointerCapture(activePointer); } catch (_) {}
            }
            activePointer = null;
            dragOrigin = null;
            doc.removeEventListener('pointermove', onPointerMove, true);
            doc.removeEventListener('pointerup', onPointerUp, true);
            doc.removeEventListener('pointercancel', onPointerUp, true);
            if (completedDrag) commitEditorPreview();
            if (event && event.preventDefault) event.preventDefault();
        }
        function setScale(value) {
            if (!editor) return getState();
            editor.view.scale = clampScale(value);
            editorPreviewSettled = true;
            scheduleEditorSync(true); updateToolbar();
            return getState();
        }
        function cancelEditorSettle() {
            if (editorSettleTimer == null) return;
            win.clearTimeout(editorSettleTimer);
            editorSettleTimer = null;
        }
        function scheduleEditorSettle() {
            if (!editor || editor.mode === 'native') return;
            cancelEditorSettle();
            if (editorControlActive) return;
            editorSettleTimer = win.setTimeout(function () {
                editorSettleTimer = null;
                commitEditorPreview();
            }, EDITOR_SETTLE_DELAY);
        }
        function commitEditorPreview() {
            if (!editor || editor.mode === 'native') return;
            cancelEditorSettle();
            editorPreviewSettled = true;
            scheduleEditorSync(true);
        }
        function cancelEditorSync() {
            if (editorRenderFrame == null) return;
            if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(editorRenderFrame);
            else win.clearTimeout(editorRenderFrame);
            editorRenderFrame = null;
            editorSyncAll = false;
        }
        function scheduleEditorSync(syncAll) {
            if (!editor) return;
            if (syncAll) editorSyncAll = true;
            if (editorRenderFrame != null) return;
            var render = function () {
                editorRenderFrame = null;
                var shouldSyncAll = editorSyncAll;
                editorSyncAll = false;
                if (!editor) return;
                if (shouldSyncAll && editor.mode !== 'native') syncEditorInstances();
                else syncEditorRepresentative();
            };
            editorRenderFrame = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(render) : win.setTimeout(render, 16);
        }
        function setViewValue(name, value) {
            if (!editor) return getState();
            if (name === 'scale') editor.view.scale = clampScale(value);
            else if (name === 'rotate') editor.view.rotate = round(Math.max(-180, Math.min(180, Number(value) || 0)), 2);
            else if (name === 'x' || name === 'y') editor.view[name] = round(Math.max(-1, Math.min(1, Number(value) || 0)));
            scheduleEditorSync(); updateToolbar();
            return getState();
        }
        function stepView(name, direction) {
            if (!editor) return getState();
            var step = name === 'scale' ? SCALE_STEP : name === 'rotate' ? ROTATE_STEP : POSITION_STEP;
            var state = setViewValue(name, Number(editor.view[name]) + step * (direction < 0 ? -1 : 1));
            commitEditorPreview();
            return state;
        }
        function toggleFlip(name) {
            if (!editor || (name !== 'flipX' && name !== 'flipY')) return getState();
            editor.view[name] = !editor.view[name];
            editorPreviewSettled = true;
            scheduleEditorSync(true); updateToolbar();
            return getState();
        }
        function setBindToTheme(enabled) {
            if (!editor || editor.mode !== 'library' || editor.target.kind !== 'user' || editor.bindingMode !== 'adaptive') return getState();
            editor.bindToTheme = enabled === true;
            updateToolbar();
            return getState();
        }
        function toggleThemeBinding() { return setBindToTheme(!(editor && editor.bindToTheme)); }
        function resetEdit() {
            if (!editor) return getState();
            editor.view = normalizeView(null);
            editorPreviewSettled = true;
            scheduleEditorSync(true); updateToolbar();
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
        function saveEdit(requestedScope) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            if (!editor || editorClosing) return Promise.resolve(null);
            var effectiveBindingMode = editor.bindingMode === 'adaptive'
                ? (editor.bindToTheme ? 'theme' : editor.unboundSaveMode)
                : (editor.bindingMode === 'deferred' ? clean(requestedScope) : editor.bindingMode);
            if (editor.bindingMode === 'deferred' && ['original', 'chat', 'theme', 'global'].indexOf(effectiveBindingMode) === -1) {
                return Promise.reject(Object.assign(new Error('请选择头像保存范围'), { code: 'AVATAR_SCOPE_REQUIRED' }));
            }
            if (effectiveBindingMode === 'chat' && !editor.chatKey) {
                return Promise.reject(Object.assign(new Error('无法可靠识别当前聊天'), { code: 'CHAT_UNAVAILABLE' }));
            }
            if (effectiveBindingMode === 'theme' && !editor.themeKey) {
                return Promise.reject(Object.assign(new Error('无法识别当前美化'), { code: 'THEME_UNAVAILABLE' }));
            }
            var editorContextChanged = editor.mode === 'library' && (
                (effectiveBindingMode === 'chat' && editor.chatKey !== currentChatBindingKey()) ||
                (effectiveBindingMode === 'theme' && editor.themeKey !== currentThemeKey())
            );
            if (editorContextChanged) {
                var changedScope = effectiveBindingMode;
                return cancelEdit('superseded').then(function () {
                    throw Object.assign(new Error(changedScope === 'chat' ? '当前聊天已切换，头像修改未保存' : '当前美化已切换，头像修改未保存'), { code: 'superseded' });
                });
            }
            editorClosing = true;
            if (editor.mode === 'native') {
                var nativeRecord = {
                    targetKey: editor.target.key,
                    sourceKey: editor.nativeSourceKey,
                    view: normalizeView(editor.view),
                };
                var nativeDiagnostics = clone(editor.diagnostics);
                return store.putNativeView(nativeRecord).then(function (saved) {
                    promotedBindings.delete(nativeRecord.targetKey);
                    return deleteTargetBindings(nativeRecord.targetKey).then(function () { return saved; });
                }).then(function (saved) {
                    finishEditorUi();
                    editor = null;
                    sequence += 1;
                    return reconcile().then(function () {
                        editorClosing = false;
                        return { saved: true, nativeView: saved, diagnostics: nativeDiagnostics };
                    });
                }).catch(function (error) { editorClosing = false; throw error; });
            }
            if (effectiveBindingMode === 'original') {
                var originalEditor = editor;
                var originalContext = contextSafe();
                return writeHostOriginal(originalEditor.target.kind, originalEditor.target, originalEditor.asset, originalContext).then(function (result) {
                    finishEditorUi();
                    editor = null;
                    nativeImageCache.clear();
                    sequence += 1;
                    var reload = originalContext && typeof originalContext.reloadCurrentChat === 'function'
                        ? Promise.resolve().then(function () { return originalContext.reloadCurrentChat(); })
                        : Promise.resolve();
                    return reload.then(reconcile).then(function () {
                        editorClosing = false;
                        return { saved: true, original: true, result: result || { ok: true } };
                    });
                }).catch(function (error) { editorClosing = false; throw error; });
            }
            var binding = {
                themeKey: effectiveBindingMode === 'global' ? DEFAULT_BINDING_KEY : (effectiveBindingMode === 'chat' ? editor.chatKey : editor.themeKey),
                targetKey: editor.target.key,
                avatarId: editor.avatarId,
                view: normalizeView(editor.view),
            };
            if (effectiveBindingMode === 'theme' || effectiveBindingMode === 'chat') binding.version = THEME_BINDING_VERSION;
            var diagnostics = clone(editor.diagnostics);
            if (effectiveBindingMode === 'temporary') {
                var savedTemporary = Object.assign({ version: THEME_BINDING_VERSION, temporary: true }, binding);
                temporaryUserOverride = savedTemporary;
                finishEditorUi();
                editor = null;
                sequence += 1;
                return reconcile().then(function () {
                    editorClosing = false;
                    return { saved: true, temporary: true, binding: clone(savedTemporary), diagnostics: diagnostics };
                }, function (error) { editorClosing = false; throw error; });
            }
            var saveBinding = effectiveBindingMode === 'theme'
                ? putThemeAvatarBindingByKey(editor.themeKey, editor.target, binding.avatarId, binding.view)
                : store.putBinding(binding);
            return saveBinding.then(function (saved) {
                if (binding.themeKey === DEFAULT_BINDING_KEY) promotedBindings.set(binding.targetKey, saved);
                if (binding.themeKey !== DEFAULT_BINDING_KEY && temporaryUserOverride && temporaryUserOverride.targetKey === binding.targetKey) {
                    temporaryUserOverride = null;
                }
                finishEditorUi();
                editor = null;
                sequence += 1;
                return reconcile().then(function () {
                    editorClosing = false;
                    return { saved: true, binding: saved, diagnostics: diagnostics };
                });
            }).catch(function (error) { editorClosing = false; throw error; });
        }
        function deleteTargetBindings(targetKey) {
            return store.listBindings().then(function (bindings) {
                var targetsToDelete = (bindings || []).filter(function (binding) {
                    return binding.targetKey === targetKey && (binding.themeKey === DEFAULT_BINDING_KEY ||
                        (/^theme-name:/.test(binding.themeKey) && !isDedicatedThemeBinding(binding)));
                });
                if (!targetsToDelete.some(function (binding) { return binding.themeKey === DEFAULT_BINDING_KEY; })) {
                    targetsToDelete.push({ themeKey: DEFAULT_BINDING_KEY, targetKey: targetKey });
                }
                return Promise.all(targetsToDelete.map(function (binding) { return store.deleteBinding(binding.themeKey, binding.targetKey); }));
            });
        }
        function onToolbarClick(event) {
            var stepButton = event.target && event.target.closest ? event.target.closest('[data-step-view]') : null;
            if (stepButton && toolbar.contains(stepButton)) {
                stepView(stepButton.getAttribute('data-step-view'), Number(stepButton.getAttribute('data-step-direction')));
                return;
            }
            var button = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
            if (!button || !toolbar.contains(button)) return;
            var action = button.getAttribute('data-action');
            if (action === 'flip-x') toggleFlip('flipX');
            else if (action === 'flip-y') toggleFlip('flipY');
            else if (action === 'bind-theme') toggleThemeBinding();
            else if (action === 'reset') resetEdit();
            else if (action === 'cancel') cancelEdit();
            else if (action === 'clear-bindings') openScopePanel('clear');
            else if (action === 'save') {
                if (editor && editor.bindingMode === 'deferred') openScopePanel('save');
                else saveEdit().catch(onError);
            } else if (action.indexOf('save-') === 0) {
                var saveScope = action.slice(5);
                if (saveScope === 'original' && typeof win.confirm === 'function') {
                    var originalLabel = editor && editor.target.kind === 'user' ? '当前人设原头像' : '当前角色卡卡面';
                    if (!win.confirm('确定用这张图片覆盖' + originalLabel + '？\n现有聊天、美化和全局绑定不会被清除；当前调整参数不会写进原图。')) return;
                }
                button.disabled = true;
                saveEdit(saveScope).catch(function (error) { button.disabled = false; onError(error); });
            } else if (action.indexOf('clear-') === 0 && editor) {
                var clearKind = editor.target.kind;
                var clearScope = action.slice(6);
                button.disabled = true;
                clearApplicationScope(clearKind, clearScope).catch(function (error) { button.disabled = false; onError(error); });
            }
        }
        function onToolbarInput(event) {
            if (!editor) return;
            var input = event.target && event.target.closest ? event.target.closest('[data-view]') : null;
            if (!input || !toolbar.contains(input)) return;
            var name = input.getAttribute('data-view');
            var value = Number(input.value);
            editorPreviewSettled = false;
            setViewValue(name, value);
            scheduleEditorSettle();
        }
        function onToolbarPointerStart(event) {
            var input = event.target && event.target.closest ? event.target.closest('[data-view]') : null;
            if (!input || !toolbar.contains(input)) return;
            editorControlActive = true;
            cancelEditorSettle();
        }
        function onToolbarPointerEnd(event) {
            if (!editorControlActive) return;
            editorControlActive = false;
            onToolbarCommit(event);
        }
        function onToolbarCommit(event) {
            var input = event.target && event.target.closest ? event.target.closest('[data-view]') : null;
            if (!input || !toolbar.contains(input)) return;
            commitEditorPreview();
        }
        function clearBinding(kind) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            var cap = capability(kind);
            if (!cap.target) return Promise.reject(Object.assign(new Error(cap.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' }));
            if (editor) return cancelEdit('binding-cleared').then(function () { return clearBinding(kind); });
            promotedBindings.delete(cap.target.key);
            if (kind === 'user') temporaryUserOverride = null;
            return putHostSourceIntent(cap.target.key).then(function () {
                return deleteTargetBindings(cap.target.key);
            }).then(reconcile);
        }
        function getApplicationScopes(kind) {
            kind = kind === 'user' ? 'user' : 'character';
            var cap = capability(kind);
            var info = targets();
            var target = cap.target;
            var themeScopeKey = currentThemeKey();
            var chatScopeKey = info.chatBindingKey || '';
            if (!target) return Promise.resolve({ kind: kind, target: null, available: false, reason: cap.reason || '目标不可用', scopes: {} });
            return Promise.resolve(store.ready).then(function () {
                return Promise.all([
                    getDefaultBinding(target),
                    themeScopeKey ? store.getBinding(themeScopeKey, target.key) : Promise.resolve(null),
                    chatScopeKey ? store.getBinding(chatScopeKey, target.key) : Promise.resolve(null),
                    themeScopeKey ? getThemeAvatarBindingSetByTarget(getThemeName(), target) : Promise.resolve(null),
                ]);
            }).then(function (parts) {
                return {
                    kind: kind,
                    target: clone(target),
                    available: cap.available,
                    reason: cap.reason || '',
                    themeName: clean(getThemeName()),
                    chatId: info.chatId,
                    scopes: {
                        original: { available: cap.available && typeof overwriteHostAvatar === 'function', binding: null },
                        chat: { available: cap.available && Boolean(chatScopeKey), binding: isDedicatedChatBinding(parts[2]) ? clone(parts[2]) : null },
                        global: { available: cap.available, binding: clone(parts[0]) },
                        theme: { available: cap.available && Boolean(themeScopeKey), binding: isDedicatedThemeBinding(parts[1]) ? clone(parts[1]) : null, count: parts[3] && parts[3].candidates ? parts[3].candidates.length : 0 },
                    },
                };
            });
        }
        function clearApplicationScope(kind, scope) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            kind = kind === 'user' ? 'user' : 'character';
            scope = clean(scope);
            var cap = capability(kind);
            if (!cap.target) return Promise.reject(Object.assign(new Error(cap.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' }));
            if (editor) return cancelEdit('binding-cleared').then(function () { return clearApplicationScope(kind, scope); });
            var scopeKey = scope === 'chat' ? currentChatBindingKey() : (scope === 'theme' ? currentThemeKey() : DEFAULT_BINDING_KEY);
            if ((scope === 'chat' || scope === 'theme') && !scopeKey) {
                return Promise.reject(Object.assign(new Error(scope === 'chat' ? '无法可靠识别当前聊天' : '无法识别当前美化'), { code: scope === 'chat' ? 'CHAT_UNAVAILABLE' : 'THEME_UNAVAILABLE' }));
            }
            if (scope !== 'chat' && scope !== 'theme' && scope !== 'global') {
                return Promise.reject(Object.assign(new Error('头像应用范围无效'), { code: 'AVATAR_SCOPE_INVALID' }));
            }
            if (scope === 'theme') return clearThemeAvatarBinding(getThemeName(), kind);
            if (scope === 'global') promotedBindings.delete(cap.target.key);
            sequence += 1;
            return store.deleteBinding(scopeKey, cap.target.key).then(reconcile);
        }
        function writeHostOriginal(kind, target, avatarAsset, context) {
            if (typeof overwriteHostAvatar !== 'function') return Promise.reject(Object.assign(new Error('当前环境不支持覆盖原头像'), { code: 'HOST_AVATAR_WRITE_UNAVAILABLE' }));
            return Promise.resolve(overwriteHostAvatar({ kind: kind, target: clone(target), asset: clone(avatarAsset), context: context }));
        }
        function overwriteOriginal(kind, avatarId) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            kind = kind === 'user' ? 'user' : 'character';
            var cap = capability(kind);
            if (!cap.available || !cap.target) return Promise.reject(Object.assign(new Error(cap.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' }));
            if (typeof overwriteHostAvatar !== 'function') return Promise.reject(Object.assign(new Error('当前环境不支持覆盖原头像'), { code: 'HOST_AVATAR_WRITE_UNAVAILABLE' }));
            if (editor) return cancelEdit('original-overwrite').then(function () { return overwriteOriginal(kind, avatarId); });
            var context = contextSafe();
            var target = clone(cap.target);
            return getAsset(avatarId).then(function (avatarAsset) {
                if (!avatarAsset) throw Object.assign(new Error('所选头像不存在'), { code: 'AVATAR_NOT_FOUND' });
                return writeHostOriginal(kind, target, avatarAsset, context);
            }).then(function (result) {
                nativeImageCache.clear();
                sequence += 1;
                var reload = context && typeof context.reloadCurrentChat === 'function'
                    ? Promise.resolve().then(function () { return context.reloadCurrentChat(); })
                    : Promise.resolve();
                return reload.then(function () { return reconcile(); }).then(function () { return result || { ok: true }; });
            });
        }
        function getThemeUserBinding(themeName) {
            var key = themeKey(themeName || getThemeName());
            if (!key) return Promise.resolve(null);
            return Promise.resolve(store.ready).then(function () {
                return store.getBinding(key, 'user:global');
            }).then(function (binding) { return isDedicatedThemeBinding(binding) ? binding : null; });
        }
        function getGlobalUserBinding() {
            return Promise.resolve(store.ready).then(function () { return getDefaultBinding(targets().user); });
        }
        function getThemeAvatarBindingSetByTarget(themeName, target) {
            var key = themeKey(themeName || getThemeName());
            var targetKey = target && clean(target.key);
            if (!key || !targetKey) return Promise.resolve({ themeKey: key, target: clone(target), active: null, candidates: [] });
            var candidatePrefix = themeAvatarCandidatePrefix(targetKey);
            return Promise.resolve(store.ready).then(function () {
                return Promise.all([store.getBinding(key, targetKey), store.listBindings()]);
            }).then(function (parts) {
                var active = isDedicatedThemeBinding(parts[0]) ? parts[0] : null;
                var candidates = (parts[1] || []).filter(function (binding) {
                    return binding.themeKey === key && binding.targetKey.indexOf(candidatePrefix) === 0 && isDedicatedThemeBinding(binding);
                });
                if (active && !candidates.some(function (binding) { return binding.avatarId === active.avatarId; })) {
                    candidates.unshift(Object.assign({}, active, { targetKey: themeAvatarCandidateTargetKey(targetKey, active.avatarId) }));
                }
                candidates.sort(function (a, b) {
                    if (active && a.avatarId === active.avatarId) return -1;
                    if (active && b.avatarId === active.avatarId) return 1;
                    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
                });
                return {
                    themeKey: key,
                    target: clone(target),
                    active: clone(active),
                    candidates: candidates.map(function (binding) {
                        return Object.assign(clone(binding), { active: Boolean(active && active.avatarId === binding.avatarId) });
                    }),
                };
            });
        }
        function getThemeAvatarBindingSet(themeName, kind) {
            kind = kind === 'character' ? 'character' : 'user';
            var cap = capability(kind);
            if (!cap.target) return Promise.resolve({ themeKey: themeKey(themeName || getThemeName()), kind: kind, target: null, available: false, reason: cap.reason || '目标不可用', active: null, candidates: [] });
            return getThemeAvatarBindingSetByTarget(themeName, cap.target).then(function (bindingSet) {
                return Object.assign(bindingSet, { kind: kind, available: cap.available, reason: cap.reason || '' });
            });
        }
        function putThemeAvatarBindingByKey(key, target, avatarId, view) {
            var targetKey = target && clean(target.key);
            if (!key) return Promise.reject(Object.assign(new Error('无法识别当前美化'), { code: 'THEME_UNAVAILABLE' }));
            if (!targetKey) return Promise.reject(Object.assign(new Error('无法识别头像目标'), { code: 'TARGET_UNAVAILABLE' }));
            var normalizedView = normalizeView(view);
            var candidate = { version: THEME_BINDING_VERSION, themeKey: key, targetKey: themeAvatarCandidateTargetKey(targetKey, avatarId), avatarId: avatarId, view: normalizedView };
            var active = { version: THEME_BINDING_VERSION, themeKey: key, targetKey: targetKey, avatarId: avatarId, view: normalizedView };
            return store.getBinding(key, targetKey).then(function (previous) {
                var operations = [];
                if (isDedicatedThemeBinding(previous) && previous.avatarId !== avatarId) {
                    operations.push({ type: 'put', binding: {
                        version: THEME_BINDING_VERSION,
                        themeKey: key,
                        targetKey: themeAvatarCandidateTargetKey(targetKey, previous.avatarId),
                        avatarId: previous.avatarId,
                        view: previous.view,
                    } });
                }
                operations.push({ type: 'put', binding: candidate });
                operations.push({ type: 'put', binding: active });
                return store.mutateBindings(operations).then(function (results) { return results[results.length - 1]; });
            });
        }
        function setThemeAvatarBinding(themeName, kind, avatarId) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            var key = themeKey(themeName || getThemeName());
            if (!key) return Promise.reject(Object.assign(new Error('无法识别当前美化'), { code: 'THEME_UNAVAILABLE' }));
            return getThemeAvatarBindingSet(themeName, kind).then(function (bindingSet) {
                if (!bindingSet.target) throw Object.assign(new Error(bindingSet.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' });
                var candidate = bindingSet.candidates.find(function (binding) { return binding.avatarId === avatarId; });
                if (!candidate) throw Object.assign(new Error('这个头像尚未绑定到当前美化'), { code: 'THEME_AVATAR_NOT_BOUND' });
                return store.putBinding({ version: THEME_BINDING_VERSION, themeKey: key, targetKey: bindingSet.target.key, avatarId: candidate.avatarId, view: candidate.view });
            }).then(function (saved) {
                if (kind !== 'character' && temporaryUserOverride && temporaryUserOverride.themeKey === key) temporaryUserOverride = null;
                sequence += 1;
                return reconcile().then(function () { return saved; });
            });
        }
        function removeThemeAvatarBinding(themeName, kind, avatarId) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            var key = themeKey(themeName || getThemeName());
            if (!key) return Promise.reject(Object.assign(new Error('无法识别当前美化'), { code: 'THEME_UNAVAILABLE' }));
            return getThemeAvatarBindingSet(themeName, kind).then(function (bindingSet) {
                if (!bindingSet.target) throw Object.assign(new Error(bindingSet.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' });
                var targetKey = bindingSet.target.key;
                var remaining = bindingSet.candidates.filter(function (binding) { return binding.avatarId !== avatarId; });
                var operations = [{ type: 'delete', themeKey: key, targetKey: themeAvatarCandidateTargetKey(targetKey, avatarId) }];
                if (bindingSet.active && bindingSet.active.avatarId === avatarId) {
                    if (remaining.length) operations.push({ type: 'put', binding: { version: THEME_BINDING_VERSION, themeKey: key, targetKey: targetKey, avatarId: remaining[0].avatarId, view: remaining[0].view } });
                    else operations.push({ type: 'delete', themeKey: key, targetKey: targetKey });
                }
                return store.mutateBindings(operations);
            }).then(function () {
                if (kind !== 'character' && temporaryUserOverride && temporaryUserOverride.themeKey === key) temporaryUserOverride = null;
                sequence += 1;
                return reconcile();
            });
        }
        function clearThemeAvatarBinding(themeName, kind) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            var key = themeKey(themeName || getThemeName());
            if (!key) return Promise.reject(Object.assign(new Error('无法识别当前美化'), { code: 'THEME_UNAVAILABLE' }));
            if (editor) return cancelEdit('theme-binding-cleared').then(function () { return clearThemeAvatarBinding(themeName, kind); });
            return getThemeAvatarBindingSet(themeName, kind).then(function (bindingSet) {
                if (!bindingSet.target) throw Object.assign(new Error(bindingSet.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' });
                var targetKey = bindingSet.target.key;
                var operations = bindingSet.candidates.map(function (binding) {
                    return { type: 'delete', themeKey: key, targetKey: themeAvatarCandidateTargetKey(targetKey, binding.avatarId) };
                });
                operations.push({ type: 'delete', themeKey: key, targetKey: targetKey });
                return store.mutateBindings(operations);
            }).then(function () {
                if (kind !== 'character' && temporaryUserOverride && temporaryUserOverride.themeKey === key) temporaryUserOverride = null;
                sequence += 1;
                return reconcile();
            });
        }
        function bindingBelongsToTarget(binding, targetKey) {
            targetKey = clean(targetKey);
            return Boolean(binding && targetKey && (
                binding.targetKey === targetKey ||
                clean(binding.targetKey).indexOf(themeAvatarCandidatePrefix(targetKey)) === 0
            ));
        }
        function summarizeTargetBindings(bindings, target) {
            if (!target) return { target: null, available: false, chat: 0, theme: 0, global: 0, total: 0 };
            var matches = (bindings || []).filter(function (binding) { return bindingBelongsToTarget(binding, target.key); });
            return {
                target: clone(target),
                available: true,
                chat: matches.filter(function (binding) { return binding.targetKey === target.key && clean(binding.themeKey).indexOf(CHAT_BINDING_PREFIX) === 0; }).length,
                theme: matches.filter(function (binding) { return clean(binding.themeKey).indexOf('theme-name:') === 0; }).length,
                global: matches.filter(function (binding) { return binding.targetKey === target.key && binding.themeKey === DEFAULT_BINDING_KEY; }).length,
                total: matches.length,
            };
        }
        function getAvatarBindingRecoverySummary() {
            var info = targets();
            return Promise.resolve(store.ready).then(function () { return store.listBindings(); }).then(function (bindings) {
                var user = summarizeTargetBindings(bindings, info.user);
                var character = summarizeTargetBindings(bindings, info.character);
                return { user: user, character: character, total: user.total + character.total };
            });
        }
        function clearAllAvatarBindings() {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            if (editor) return cancelEdit('all-avatar-bindings-cleared').then(clearAllAvatarBindings);
            var info = targets();
            var targetKeys = [info.user && info.user.key, info.character && info.character.key].filter(Boolean);
            temporaryUserOverride = null;
            targetKeys.forEach(function (targetKey) { promotedBindings.delete(targetKey); });
            sequence += 1;
            return Promise.resolve(store.ready).then(function () { return store.listBindings(); }).then(function (bindings) {
                var targetsToDelete = (bindings || []).filter(function (binding) {
                    return targetKeys.some(function (targetKey) { return bindingBelongsToTarget(binding, targetKey); });
                });
                var operations = targetsToDelete.map(function (binding) {
                    return { type: 'delete', themeKey: binding.themeKey, targetKey: binding.targetKey };
                });
                return Promise.all(targetKeys.map(putHostSourceIntent)).then(function () {
                    return operations.length ? store.mutateBindings(operations) : [];
                }).then(function () {
                    return reconcile().then(function () {
                        return { bindingsCleared: targetsToDelete.length, targetKeys: targetKeys.slice() };
                    });
                });
            });
        }
        function getThemeUserBindingSet(themeName) { return getThemeAvatarBindingSet(themeName, 'user'); }
        function putThemeUserBindingByKey(key, avatarId, view) { return putThemeAvatarBindingByKey(key, targets().user, avatarId, view); }
        function setThemeUserBinding(themeName, avatarId) { return setThemeAvatarBinding(themeName, 'user', avatarId); }
        function removeThemeUserBinding(themeName, avatarId) { return removeThemeAvatarBinding(themeName, 'user', avatarId); }
        function clearThemeUserBinding(themeName) { return clearThemeAvatarBinding(themeName, 'user'); }
        function clearAllUserOverrides() {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            if (editor) return cancelEdit('all-user-overrides-cleared').then(clearAllUserOverrides);
            temporaryUserOverride = null;
            promotedBindings.delete(USER_TARGET_KEY);
            sequence += 1;
            return putHostSourceIntent(USER_TARGET_KEY).then(function () {
                bindingPlans = bindingPlans.filter(function (plan) {
                    return !plan.target || plan.target.key !== USER_TARGET_KEY;
                });
                Array.from(activeImages).forEach(function (image) {
                    var record = baselines.get(image);
                    if (record && record.targetKey === USER_TARGET_KEY) restoreImage(image, USER_TARGET_KEY);
                });
                return Promise.resolve(store.ready);
            }).then(function () { return store.listBindings(); }).then(function (bindings) {
                var targetsToDelete = (bindings || []).filter(function (binding) {
                    return binding.targetKey === USER_TARGET_KEY || binding.targetKey.indexOf(THEME_USER_CANDIDATE_PREFIX) === 0;
                });
                return Promise.all(targetsToDelete.map(function (binding) {
                    return store.deleteBinding(binding.themeKey, binding.targetKey);
                })).then(function () {
                    return store.deleteNativeView(USER_TARGET_KEY).then(function (nativeViewCleared) {
                        return { bindingsCleared: targetsToDelete.length, nativeViewCleared: nativeViewCleared === true };
                    });
                });
            }).then(function (summary) {
                var context = contextSafe();
                var reloadChat = context && typeof context.reloadCurrentChat === 'function'
                    ? Promise.resolve().then(function () { return context.reloadCurrentChat(); }).then(function () { return true; }, function () { return false; })
                    : Promise.resolve(false);
                return reloadChat.then(function (hostChatReloaded) {
                    summary.hostChatReloaded = hostChatReloaded;
                    return reconcile().then(function (result) {
                        summary.reconciled = !result || result.ok !== false;
                        return summary;
                    });
                });
            });
        }
        function clearNativeView(kind) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            var cap = capability(kind === 'user' ? 'user' : 'character');
            if (!cap.target) return Promise.reject(Object.assign(new Error(cap.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' }));
            if (editor) return cancelEdit('native-view-cleared').then(function () { return clearNativeView(kind); });
            return putHostSourceIntent(cap.target.key).then(function () {
                return store.deleteNativeView(cap.target.key);
            }).then(reconcile);
        }
        function deleteAsset(id) {
            var mutationError = requireMutable();
            if (mutationError) return Promise.reject(mutationError);
            var cancel = editor && editor.avatarId === id ? cancelEdit('avatar-deleted') : Promise.resolve();
            return cancel.then(function () { return store.deleteAsset(id); }).then(function (result) {
                assetCache.delete(id);
                rotatedSources.delete(id);
                var targetKeys = Array.from(new Set((result && result.bindings || []).map(function (binding) {
                    return binding && binding.targetKey;
                }).filter(function (targetKey) {
                    return targetKey === USER_TARGET_KEY || /^character:/.test(targetKey || '');
                })));
                targetKeys.forEach(function (targetKey) { hostSourceTargets.add(targetKey); });
                return reconcile().then(function () { return result; });
            });
        }
        function getState() {
            return editor ? {
                state: 'editing',
                mode: editor.mode,
                themeKey: editor.themeKey,
                bindingMode: editor.bindingMode || null,
                target: clone(editor.target),
                avatarId: editor.avatarId,
                view: clone(editor.view),
                bindToTheme: editor.bindToTheme === true,
                unboundSaveMode: editor.unboundSaveMode || null,
                previousBinding: clone(editor.previousBinding),
                previousNativeView: clone(editor.previousNativeView),
                diagnostics: clone(editor.diagnostics),
            } : { state: 'idle' };
        }
        function getActiveAvatarIds() {
            var result = { user: '', character: '' };
            bindingPlans.forEach(function (plan) {
                if (!plan || plan.native || plan.hostSource || !plan.target || !plan.binding || !plan.binding.avatarId) return;
                if (plan.target.kind === 'user' || plan.target.kind === 'character') result[plan.target.kind] = plan.binding.avatarId;
            });
            return result;
        }
        function notifyAssetChanged(id) { if (id) { assetCache.delete(id); rotatedSources.delete(id); } return reconcile(); }

        return {
            start: start,
            stop: stop,
            reconcile: reconcile,
            scheduleReconcile: scheduleReconcile,
            getCapabilities: getCapabilities,
            beginEdit: beginEdit,
            beginNativeEdit: beginNativeEdit,
            clearNativeView: clearNativeView,
            cancelEdit: cancelEdit,
            saveEdit: saveEdit,
            reset: resetEdit,
            setScale: setScale,
            setBindToTheme: setBindToTheme,
            scaleUp: function () { return setScale(editor ? editor.view.scale + SCALE_STEP : 1); },
            scaleDown: function () { return setScale(editor ? editor.view.scale - SCALE_STEP : 1); },
            clearBinding: clearBinding,
            getApplicationScopes: getApplicationScopes,
            clearApplicationScope: clearApplicationScope,
            overwriteOriginal: overwriteOriginal,
            getThemeUserBinding: getThemeUserBinding,
            getThemeAvatarBindingSet: getThemeAvatarBindingSet,
            setThemeAvatarBinding: setThemeAvatarBinding,
            removeThemeAvatarBinding: removeThemeAvatarBinding,
            clearThemeAvatarBinding: clearThemeAvatarBinding,
            getAvatarBindingRecoverySummary: getAvatarBindingRecoverySummary,
            clearAllAvatarBindings: clearAllAvatarBindings,
            getThemeUserBindingSet: getThemeUserBindingSet,
            getGlobalUserBinding: getGlobalUserBinding,
            setThemeUserBinding: setThemeUserBinding,
            removeThemeUserBinding: removeThemeUserBinding,
            clearThemeUserBinding: clearThemeUserBinding,
            clearAllUserOverrides: clearAllUserOverrides,
            deleteAsset: deleteAsset,
            notifyAssetChanged: notifyAssetChanged,
            getState: getState,
            getActiveAvatarIds: getActiveAvatarIds,
            isEditing: function () { return !!editor; },
        };
    };

    ns.avatarRuntime = {
        MIN_SCALE: MIN_SCALE,
        MAX_SCALE: MAX_SCALE,
        SCALE_STEP: SCALE_STEP,
        DEFAULT_BINDING_KEY: DEFAULT_BINDING_KEY,
        CHAT_BINDING_PREFIX: CHAT_BINDING_PREFIX,
        THEME_USER_CANDIDATE_PREFIX: THEME_USER_CANDIDATE_PREFIX,
        THEME_CHARACTER_CANDIDATE_PREFIX: THEME_CHARACTER_CANDIDATE_PREFIX,
        themeUserCandidateTargetKey: themeUserCandidateTargetKey,
        themeAvatarCandidateTargetKey: themeAvatarCandidateTargetKey,
        themeKey: themeKey,
        chatBindingKey: chatBindingKey,
        getContextInfo: getContextInfo,
        messageImages: messageImages,
        chooseRepresentative: chooseRepresentative,
        normalizeView: normalizeView,
        pixelsForView: pixelsForView,
        transformForPixels: transformForPixels,
        objectViewBoxForView: objectViewBoxForView,
        transformedSourceGeometry: transformedSourceGeometry,
        editorPreviewGeometry: editorPreviewGeometry,
    };
})(window);
