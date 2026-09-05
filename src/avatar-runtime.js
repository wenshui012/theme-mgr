(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var MIN_SCALE = 0.5;
    var MAX_SCALE = 3;
    var SCALE_STEP = 0.05;
    var POSITION_STEP = 0.05;
    var ROTATE_STEP = 1;
    var SOURCE_CACHE_LIMIT = 8;
    var TOOLBAR_ID = 'tm-avatar-editor-toolbar';
    var STYLE_ID = 'tm-avatar-editor-style';
    var TARGET_CLASS = 'tm-avatar-editor-target';
    var AVATAR_CLASS = 'tm-avatar-editor-selected';
    var DEFAULT_BINDING_KEY = 'avatar-default';

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
    function objectViewBoxForView(view) {
        view = normalizeView(view);
        var visible = 1 / view.scale;
        var centerInset = (1 - visible) / 2;
        var left = centerInset - view.x / view.scale;
        var top = centerInset - view.y / view.scale;
        var right = 1 - visible - left;
        var bottom = 1 - visible - top;
        return 'inset(' + [top, right, bottom, left].map(function (value) { return round(value * 100, 4) + '%'; }).join(' ') + ')';
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
        var getContext = options.getContext || function () { return {}; };
        var getThemeName = options.getThemeName || function () { return ''; };
        var onError = options.onError || function () {};
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
        var activePointer = null;
        var dragOrigin = null;

        function contextSafe() {
            try { return getContext() || {}; } catch (_) { return {}; }
        }
        function currentThemeKey() { return themeKey(getThemeName()); }
        function targets() { return getContextInfo(contextSafe()); }
        function ensureSourceCache(asset) {
            var cached = rotatedSources.get(asset.id);
            if (!cached || cached.imageData !== asset.imageData) {
                var width = Math.max(1, Number(asset.width) || 1);
                var height = Math.max(1, Number(asset.height) || 1);
                var href = String(asset.imageData).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                cached = {
                    imageData: asset.imageData,
                    centerX: round(width / 2, 3),
                    centerY: round(height / 2, 3),
                    prefix: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><image href="' + href + '" width="' + width + '" height="' + height + '" transform="'),
                    suffix: encodeURIComponent('"/></svg>'),
                    sources: new Map(),
                };
                rotatedSources.set(asset.id, cached);
            }
            return cached;
        }
        function sourceForView(asset, view) {
            view = normalizeView(view);
            if (!view.rotate && !view.flipX && !view.flipY) return asset.imageData;
            var signature = [view.rotate, view.flipX ? -1 : 1, view.flipY ? -1 : 1].join(':');
            var cached = ensureSourceCache(asset);
            if (cached.sources.has(signature)) return cached.sources.get(signature);
            var transform = 'translate(' + cached.centerX + ' ' + cached.centerY + ') rotate(' + view.rotate + ') scale(' + (view.flipX ? -1 : 1) + ' ' + (view.flipY ? -1 : 1) + ') translate(' + (-cached.centerX) + ' ' + (-cached.centerY) + ')';
            var source = cached.prefix + encodeURIComponent(transform) + cached.suffix;
            if (cached.sources.size >= SOURCE_CACHE_LIMIT) cached.sources.delete(cached.sources.keys().next().value);
            cached.sources.set(signature, source);
            return source;
        }
        function sourceForNativeView(asset, view) {
            view = normalizeView(view);
            if (!view.x && !view.y && view.scale === 1 && !view.rotate && !view.flipX && !view.flipY) return asset.imageData;
            var signature = ['native', view.x, view.y, view.scale, view.rotate, view.flipX ? -1 : 1, view.flipY ? -1 : 1].join(':');
            var cached = ensureSourceCache(asset);
            if (cached.sources.has(signature)) return cached.sources.get(signature);
            var translateX = round(cached.centerX + view.x * cached.centerX * 2, 3);
            var translateY = round(cached.centerY + view.y * cached.centerY * 2, 3);
            var scaleX = round(view.scale * (view.flipX ? -1 : 1), 3);
            var scaleY = round(view.scale * (view.flipY ? -1 : 1), 3);
            var transform = 'translate(' + translateX + ' ' + translateY + ') rotate(' + view.rotate + ') scale(' + scaleX + ' ' + scaleY + ') translate(' + (-cached.centerX) + ' ' + (-cached.centerY) + ')';
            var source = cached.prefix + encodeURIComponent(transform) + cached.suffix;
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
        function applyToEntry(entry, asset, view, targetKey) {
            var image = entry.image;
            var record = captureBaseline(image);
            if (record.animation) { try { record.animation.cancel(); } catch (_) {} }
            setExactAttribute(image, 'srcset', null);
            var source = sourceForView(asset, view);
            if (getAttribute(image, 'src') !== source) setExactAttribute(image, 'src', source);
            if (win.CSS && typeof win.CSS.supports === 'function' && !win.CSS.supports('object-view-box', 'inset(10%)')) {
                throw Object.assign(new Error('当前浏览器暂不支持框内头像调整，请更新 WebView'), { code: 'CONTENT_CROP_UNSUPPORTED' });
            }
            setImportantStyle(image, 'object-view-box', objectViewBoxForView(view));
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
            var source = transformsSource ? sourceForNativeView(embeddedAsset, normalized) : nativeAsset.imageData;

            // Restore the host image before every render so its theme-defined frame can
            // be measured intact. A transformed source changes only pixels inside that
            // fixed frame; a neutral view keeps the original src/srcset byte-for-byte.
            setExactAttribute(image, 'src', record.src);
            setExactAttribute(image, 'srcset', record.srcset);
            setExactAttribute(image, 'style', record.style);
            if (transformsSource) {
                var computed = win.getComputedStyle(image);
                var frame = {
                    objectFit: computed.objectFit,
                    objectPosition: computed.objectPosition,
                    borderRadius: computed.borderRadius,
                    clipPath: computed.clipPath,
                    webkitMaskImage: computed.webkitMaskImage,
                    maskImage: computed.maskImage,
                };
                setExactAttribute(image, 'srcset', null);
                setExactAttribute(image, 'src', source);
                if (frame.objectFit) setImportantStyle(image, 'object-fit', frame.objectFit);
                if (frame.objectPosition) setImportantStyle(image, 'object-position', frame.objectPosition);
                if (frame.borderRadius) setImportantStyle(image, 'border-radius', frame.borderRadius);
                if (frame.clipPath && frame.clipPath !== 'none') setImportantStyle(image, 'clip-path', frame.clipPath);
                if (frame.webkitMaskImage && frame.webkitMaskImage !== 'none') setImportantStyle(image, '-webkit-mask-image', frame.webkitMaskImage);
                if (frame.maskImage && frame.maskImage !== 'none') setImportantStyle(image, 'mask-image', frame.maskImage);
            }
            record.targetKey = target && target.key || '';
            activeImages.add(image);
        }
        function getAsset(id) {
            if (assetCache.has(id)) return Promise.resolve(assetCache.get(id));
            return store.getAsset(id).then(function (asset) {
                if (asset) assetCache.set(id, asset);
                return asset;
            });
        }
        function getBindingForTarget(target) {
            return store.getBinding(DEFAULT_BINDING_KEY, target.key).then(function (binding) {
                if (binding) {
                    promotedBindings.set(target.key, binding);
                    return binding;
                }
                if (promotedBindings.has(target.key)) return promotedBindings.get(target.key);
                var legacyKey = currentThemeKey();
                if (!legacyKey) return null;
                return store.getBinding(legacyKey, target.key).then(function (legacy) {
                    if (!legacy) return null;
                    var promoted = Object.assign({}, legacy, { themeKey: DEFAULT_BINDING_KEY });
                    delete promoted.id;
                    return store.putBinding(promoted).then(function (saved) {
                        promotedBindings.set(target.key, saved);
                        return saved;
                    }).catch(function (error) {
                        onError(error);
                        promotedBindings.set(target.key, promoted);
                        return promoted;
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
        function desiredForPlan(plan) {
            return plan.native
                ? desiredForNativeView(plan.target, plan.binding, plan.asset)
                : desiredForBinding(plan.target, plan.binding, plan.asset);
        }
        function applyDesired(items) {
            var desired = new Set(items.map(function (item) { return item.entry.image; }));
            Array.from(activeImages).forEach(function (image) { if (!desired.has(image)) restoreImage(image); });
            items.forEach(function (item) {
                if (item.native) applyNativeToEntry(item.entry, item.binding.view, item.target, item.asset);
                else applyToEntry(item.entry, item.asset, item.binding.view, item.binding.targetKey);
            });
        }
        function resolveRuntimeDesired() {
            var info = targets();
            var targetList = [info.character, info.user].filter(Boolean);
            var foundBinding = false;
            return Promise.all(targetList.map(function (target) {
                return getBindingForTarget(target).then(function (binding) {
                    if (binding) {
                        foundBinding = true;
                        return getAsset(binding.avatarId).then(function (asset) {
                            if (!asset) {
                                promotedBindings.delete(target.key);
                                return store.deleteBinding(DEFAULT_BINDING_KEY, target.key).then(function () { return null; });
                            }
                            return { target: target, binding: binding, asset: asset, native: false };
                        });
                    }
                    return store.getNativeView(target.key).then(function (record) {
                        if (!record) return null;
                        var representative = messageImages(doc, target)[0] || null;
                        var sourceKey = nativeSourceKey(target, representative);
                        if (sourceKey && record.sourceKey !== sourceKey) {
                            return store.deleteNativeView(target.key).then(function () { return null; });
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
            if (!editor.representative || editor.representative.image.isConnected === false) {
                cancelEdit('target-disconnected');
                return false;
            }
            var desired = new Set();
            bindingPlans.forEach(function (plan) {
                if (plan.target.key === editor.target.key) return;
                desiredForPlan(plan).forEach(function (item) {
                    desired.add(item.entry.image);
                    if (item.native) applyNativeToEntry(item.entry, item.binding.view, item.target, item.asset);
                    else applyToEntry(item.entry, item.asset, item.binding.view, item.binding.targetKey);
                });
            });
            entries.forEach(function (entry) { desired.add(entry.image); });
            Array.from(activeImages).forEach(function (image) { if (!desired.has(image)) restoreImage(image); });
            entries.forEach(function (entry) {
                if (editor.mode === 'native') applyNativeToEntry(entry, editor.view, editor.target, editor.asset);
                else applyToEntry(entry, editor.asset, editor.view, editor.target.key);
            });
            return true;
        }
        function reconcile() {
            var request = ++sequence;
            if (editor) { syncEditorInstances(); return Promise.resolve({ editing: true }); }
            return Promise.resolve(store.ready).then(resolveRuntimeDesired).then(function (desired) {
                if (request !== sequence || editor) return { superseded: true };
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
            bindingPlans = [];
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
                strategy: editor && editor.mode === 'native' ? 'svg-native-content-transform' : 'css-object-view-box-content-crop',
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
                '.tm-avatar-editor-bar{width:min(420px,calc(100vw - 16px));display:flex;flex-direction:column;gap:8px;box-sizing:border-box;padding:10px;border:1px solid rgba(127,127,127,.26);border-color:color-mix(in srgb,var(--tm-avatar-accent) 42%,transparent);border-radius:14px;background:var(--tm-avatar-bg);color:var(--tm-avatar-text);font:13px/1.2 system-ui,sans-serif;box-shadow:0 10px 32px rgba(0,0,0,.34);backdrop-filter:blur(14px);user-select:none;-webkit-user-select:none;pointer-events:auto;touch-action:manipulation}',
                '.tm-avatar-editor-controls{display:grid;gap:5px}.tm-avatar-editor-row{display:grid;grid-template-columns:34px 32px minmax(100px,1fr) 44px 32px;align-items:center;gap:6px;min-height:34px}.tm-avatar-editor-label{white-space:nowrap;font-weight:600;opacity:.82}.tm-avatar-editor-value{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.76}.tm-avatar-editor-row input{width:100%;min-width:0;margin:0;accent-color:var(--tm-avatar-accent)}',
                'button{appearance:none;border:1px solid rgba(127,127,127,.28);border-radius:8px;background:rgba(127,127,127,.12);color:inherit;min-width:32px;min-height:32px;padding:5px 8px;font:inherit;white-space:nowrap;cursor:pointer}button:hover,button:focus-visible{border-color:var(--tm-avatar-accent);color:var(--tm-avatar-accent);outline:none}.tm-avatar-editor-step{padding:0;font-size:17px;line-height:1}.tm-avatar-editor-footer{display:grid;grid-template-columns:repeat(5,minmax(0,auto));gap:5px;padding-top:2px}.tm-avatar-editor-footer button{min-width:0}.tm-avatar-editor-footer button.is-active{border-color:var(--tm-avatar-accent);background:rgba(127,127,127,.18);background:color-mix(in srgb,var(--tm-avatar-accent) 22%,transparent);color:var(--tm-avatar-accent)}.tm-avatar-editor-save{border-color:var(--tm-avatar-accent);background:var(--tm-avatar-accent);color:#fff;font-weight:700}.tm-avatar-editor-save:hover,.tm-avatar-editor-save:focus-visible{filter:brightness(1.08);color:#fff}',
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
                '</div><div class="tm-avatar-editor-footer"><button type="button" data-action="flip-x" aria-pressed="false" title="水平镜像">↔ 水平</button><button type="button" data-action="flip-y" aria-pressed="false" title="垂直镜像">↕ 垂直</button><button type="button" data-action="reset">重置</button><button type="button" data-action="cancel">取消</button><button type="button" class="tm-avatar-editor-save" data-action="save">保存</button></div>';
            toolbar.addEventListener('click', onToolbarClick);
            toolbar.addEventListener('input', onToolbarInput);
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
            unbindToolbarViewport();
            cancelEditorSync();
            if (toolbar) toolbar.removeEventListener('click', onToolbarClick);
            if (toolbar) toolbar.removeEventListener('input', onToolbarInput);
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
            var key = DEFAULT_BINDING_KEY;
            if (!cap.available) return Promise.reject(Object.assign(new Error(cap.reason), { code: 'TARGET_UNAVAILABLE' }));
            return Promise.all([getAsset(input.avatarId), getBindingForTarget(cap.target)]).then(function (parts) {
                var asset = parts[0];
                if (!asset) throw Object.assign(new Error('所选头像不存在'), { code: 'AVATAR_NOT_FOUND' });
                editor = {
                    mode: 'library',
                    themeKey: key,
                    target: cap.target,
                    avatarId: asset.id,
                    asset: asset,
                    previousBinding: clone(parts[1]),
                    view: normalizeView(parts[1] && parts[1].view),
                    representative: cap.representative,
                    diagnostics: null,
                };
                if (!rotatedSources.has(asset.id)) {
                    win.setTimeout(function () {
                        if (editor && editor.asset.id === asset.id) ensureSourceCache(asset);
                    }, 0);
                }
                if (!cap.visible && editor.representative.avatar && typeof editor.representative.avatar.scrollIntoView === 'function') {
                    try { editor.representative.avatar.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
                }
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
                if (!cap.visible && editor.representative.avatar && typeof editor.representative.avatar.scrollIntoView === 'function') {
                    try { editor.representative.avatar.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
                }
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
            updateToolbar();
            scheduleEditorSync();
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
            scheduleEditorSync(); updateToolbar();
            return getState();
        }
        function cancelEditorSync() {
            if (editorRenderFrame == null) return;
            if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(editorRenderFrame);
            else win.clearTimeout(editorRenderFrame);
            editorRenderFrame = null;
        }
        function scheduleEditorSync() {
            if (!editor || editorRenderFrame != null) return;
            var render = function () {
                editorRenderFrame = null;
                if (editor) syncEditorInstances();
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
            return setViewValue(name, Number(editor.view[name]) + step * (direction < 0 ? -1 : 1));
        }
        function toggleFlip(name) {
            if (!editor || (name !== 'flipX' && name !== 'flipY')) return getState();
            editor.view[name] = !editor.view[name];
            scheduleEditorSync(); updateToolbar();
            return getState();
        }
        function resetEdit() {
            if (!editor) return getState();
            editor.view = normalizeView(null);
            scheduleEditorSync(); updateToolbar();
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
            var binding = {
                themeKey: editor.themeKey,
                targetKey: editor.target.key,
                avatarId: editor.avatarId,
                view: normalizeView(editor.view),
            };
            var diagnostics = clone(editor.diagnostics);
            return store.putBinding(binding).then(function (saved) {
                promotedBindings.set(binding.targetKey, saved);
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
                    return binding.targetKey === targetKey && (binding.themeKey === DEFAULT_BINDING_KEY || /^theme-name:/.test(binding.themeKey));
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
            else if (action === 'reset') resetEdit();
            else if (action === 'cancel') cancelEdit();
            else if (action === 'save') saveEdit().catch(onError);
        }
        function onToolbarInput(event) {
            if (!editor) return;
            var input = event.target && event.target.closest ? event.target.closest('[data-view]') : null;
            if (!input || !toolbar.contains(input)) return;
            var name = input.getAttribute('data-view');
            var value = Number(input.value);
            setViewValue(name, value);
        }
        function clearBinding(kind) {
            var cap = capability(kind);
            if (!cap.target) return Promise.reject(Object.assign(new Error(cap.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' }));
            if (editor) return cancelEdit('binding-cleared').then(function () { return clearBinding(kind); });
            promotedBindings.delete(cap.target.key);
            return deleteTargetBindings(cap.target.key).then(reconcile);
        }
        function clearNativeView(kind) {
            var cap = capability(kind === 'user' ? 'user' : 'character');
            if (!cap.target) return Promise.reject(Object.assign(new Error(cap.reason || '目标不可用'), { code: 'TARGET_UNAVAILABLE' }));
            if (editor) return cancelEdit('native-view-cleared').then(function () { return clearNativeView(kind); });
            return store.deleteNativeView(cap.target.key).then(reconcile);
        }
        function deleteAsset(id) {
            var cancel = editor && editor.avatarId === id ? cancelEdit('avatar-deleted') : Promise.resolve();
            return cancel.then(function () { return store.deleteAsset(id); }).then(function (result) {
                assetCache.delete(id);
                rotatedSources.delete(id);
                return reconcile().then(function () { return result; });
            });
        }
        function getState() {
            return editor ? {
                state: 'editing',
                mode: editor.mode,
                themeKey: editor.themeKey,
                target: clone(editor.target),
                avatarId: editor.avatarId,
                view: clone(editor.view),
                previousBinding: clone(editor.previousBinding),
                previousNativeView: clone(editor.previousNativeView),
                diagnostics: clone(editor.diagnostics),
            } : { state: 'idle' };
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
        DEFAULT_BINDING_KEY: DEFAULT_BINDING_KEY,
        themeKey: themeKey,
        getContextInfo: getContextInfo,
        messageImages: messageImages,
        chooseRepresentative: chooseRepresentative,
        normalizeView: normalizeView,
        pixelsForView: pixelsForView,
        transformForPixels: transformForPixels,
        objectViewBoxForView: objectViewBoxForView,
    };
})(window);
