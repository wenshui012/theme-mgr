(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var MIN_SCALE = 0.5;
    var MAX_SCALE = 3;
    var SCALE_STEP = 0.05;
    var TARGET_CLASS = 'tm-avatar-poc-target';
    var AVATAR_CLASS = 'tm-avatar-poc-selected';
    var TOOLBAR_ID = 'tm-avatar-poc-toolbar';
    var STYLE_ID = 'tm-avatar-poc-style';

    function round(value, precision) {
        var factor = Math.pow(10, precision == null ? 3 : precision);
        return Math.round(Number(value) * factor) / factor;
    }

    function clampScale(value) {
        var number = Number(value);
        if (!Number.isFinite(number)) number = 1;
        return round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, number)), 3);
    }

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function rectSnapshot(element) {
        if (!element || typeof element.getBoundingClientRect !== 'function') return null;
        var rect = element.getBoundingClientRect();
        return {
            x: round(rect.x || rect.left || 0, 3),
            y: round(rect.y || rect.top || 0, 3),
            width: round(rect.width || 0, 3),
            height: round(rect.height || 0, 3),
        };
    }

    function classSummary(element) {
        return String(element && element.className || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    }

    function getAttribute(element, name) {
        if (!element || typeof element.getAttribute !== 'function') return null;
        return element.getAttribute(name);
    }

    function closest(element, selector) {
        if (!element || typeof element.closest !== 'function') return null;
        try { return element.closest(selector); } catch (_) { return null; }
    }

    function directAvatarImage(avatar) {
        if (!avatar || typeof avatar.querySelector !== 'function') return null;
        try {
            return avatar.querySelector(':scope > img') || avatar.querySelector('img');
        } catch (_) {
            return avatar.querySelector('img');
        }
    }

    function classifyMessage(message) {
        if (!message) return 'unknown';
        var isUser = String(getAttribute(message, 'is_user') || '').toLowerCase();
        var isSystem = String(getAttribute(message, 'is_system') || '').toLowerCase();
        if (isUser === 'true') return 'user';
        if (isUser === 'false' && isSystem !== 'true') return 'character';
        return 'unknown';
    }

    function findEditableAvatar(start, doc, win) {
        if (!start || !doc) return null;
        var avatar = closest(start, '.avatar');
        if (!avatar && String(start.tagName || '').toUpperCase() === 'IMG') avatar = closest(start.parentElement, '.avatar');
        if (!avatar) return null;
        var image = String(start.tagName || '').toUpperCase() === 'IMG' && closest(start, '.avatar') === avatar
            ? start
            : directAvatarImage(avatar);
        if (!image || directAvatarImage(avatar) !== image) return null;
        var message = closest(avatar, '.mes');
        var chat = doc.getElementById && doc.getElementById('chat');
        if (!message || !chat || (typeof chat.contains === 'function' && !chat.contains(message))) return null;
        if (typeof message.contains === 'function' && !message.contains(image)) return null;
        var imageStyle = win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle(image) : null;
        var avatarStyle = win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle(avatar) : null;
        if (imageStyle && (imageStyle.display === 'none' || imageStyle.visibility === 'hidden')) return null;
        if (avatarStyle && (avatarStyle.display === 'none' || avatarStyle.visibility === 'hidden')) return null;
        var imageRect = rectSnapshot(image);
        if (imageRect && (!(imageRect.width > 0) || !(imageRect.height > 0))) return null;
        return {
            image: image,
            avatar: avatar,
            message: message,
            role: classifyMessage(message),
        };
    }

    function clipsFromStyle(style) {
        if (!style) return false;
        return [style.overflow, style.overflowX, style.overflowY].some(function (value) {
            return /^(?:hidden|clip)$/i.test(String(value || ''));
        });
    }

    function styleText(style, key, fallback) {
        var value = String(style && style[key] || '').trim();
        return value || fallback;
    }

    function createDiagnostics(candidate, win) {
        var image = candidate.image;
        var avatar = candidate.avatar;
        var parent = image.parentElement;
        var imageStyle = win.getComputedStyle(image);
        var avatarStyle = win.getComputedStyle(avatar);
        var parentStyle = parent ? win.getComputedStyle(parent) : null;
        return {
            role: candidate.role,
            tag: String(image.tagName || '').toUpperCase(),
            sourceElement: '#chat .mes .avatar > img',
            message: {
                isUser: getAttribute(candidate.message, 'is_user'),
                isSystem: getAttribute(candidate.message, 'is_system'),
                messageId: getAttribute(candidate.message, 'mesid'),
            },
            avatarBox: rectSnapshot(avatar),
            imageBox: rectSnapshot(image),
            objectFit: styleText(imageStyle, 'objectFit', 'fill'),
            objectPosition: styleText(imageStyle, 'objectPosition', '50% 50%'),
            transform: styleText(imageStyle, 'transform', 'none'),
            translate: styleText(imageStyle, 'translate', 'none'),
            scale: styleText(imageStyle, 'scale', 'none'),
            rotate: styleText(imageStyle, 'rotate', 'none'),
            transformOrigin: styleText(imageStyle, 'transformOrigin', '50% 50%'),
            borderRadius: styleText(imageStyle, 'borderRadius', '0px'),
            clipPath: styleText(imageStyle, 'clipPath', 'none'),
            maskImage: styleText(imageStyle, 'webkitMaskImage', styleText(imageStyle, 'maskImage', 'none')),
            filter: styleText(imageStyle, 'filter', 'none'),
            avatarOverflow: {
                overflow: styleText(avatarStyle, 'overflow', 'visible'),
                overflowX: styleText(avatarStyle, 'overflowX', 'visible'),
                overflowY: styleText(avatarStyle, 'overflowY', 'visible'),
                clips: clipsFromStyle(avatarStyle),
            },
            parent: {
                tag: String(parent && parent.tagName || '').toUpperCase(),
                classes: classSummary(parent),
                overflow: styleText(parentStyle, 'overflow', 'visible'),
                overflowX: styleText(parentStyle, 'overflowX', 'visible'),
                overflowY: styleText(parentStyle, 'overflowY', 'visible'),
                clips: clipsFromStyle(parentStyle),
            },
            themeInlineStyleBaseline: getAttribute(image, 'style'),
            pluginAdjustmentStrategy: 'web-animations-additive-transform',
            preservesDomHierarchy: true,
            preservesThemeTransformProperties: true,
        };
    }

    function localTransform(x, y, scale) {
        return 'translate(' + round(x, 3) + 'px, ' + round(y, 3) + 'px) scale(' + clampScale(scale) + ')';
    }

    function adjustmentTransform(adjustment, mapping) {
        mapping = mapping && mapping.screenToLocal;
        var x = Number(adjustment.x) || 0;
        var y = Number(adjustment.y) || 0;
        var localX = mapping ? mapping.a * x + mapping.c * y : x;
        var localY = mapping ? mapping.b * x + mapping.d * y : y;
        return localTransform(localX, localY, adjustment.scale);
    }

    function createAdditiveAnimation(image, adjustment) {
        if (!image || typeof image.animate !== 'function') throw new Error('Web Animations API is unavailable');
        var transform = adjustmentTransform(adjustment);
        var keyframes = [
            { transform: transform, composite: 'add' },
            { transform: transform, composite: 'add' },
        ];
        var animation = image.animate(keyframes, { duration: 1, fill: 'both' });
        animation.pause();
        animation.currentTime = 0;
        var applied = animation.effect && typeof animation.effect.getKeyframes === 'function'
            ? animation.effect.getKeyframes()
            : [];
        if (!applied.length || applied[0].composite !== 'add') {
            animation.cancel();
            throw new Error('Additive transform composition is unavailable');
        }
        return animation;
    }

    function updateAdditiveAnimation(animation, adjustment, mapping) {
        if (!animation || !animation.effect || typeof animation.effect.setKeyframes !== 'function') return false;
        var transform = adjustmentTransform(adjustment, mapping);
        animation.effect.setKeyframes([
            { transform: transform, composite: 'add' },
            { transform: transform, composite: 'add' },
        ]);
        animation.currentTime = 0;
        return true;
    }

    function rectCenter(element) {
        var rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function measureDragMapping(image, animation) {
        var sample = 10;
        updateAdditiveAnimation(animation, { x: 0, y: 0, scale: 1 });
        var origin = rectCenter(image);
        updateAdditiveAnimation(animation, { x: sample, y: 0, scale: 1 });
        var horizontal = rectCenter(image);
        updateAdditiveAnimation(animation, { x: 0, y: sample, scale: 1 });
        var vertical = rectCenter(image);
        updateAdditiveAnimation(animation, { x: 0, y: 0, scale: 1 });
        var a = (horizontal.x - origin.x) / sample;
        var b = (horizontal.y - origin.y) / sample;
        var c = (vertical.x - origin.x) / sample;
        var d = (vertical.y - origin.y) / sample;
        var determinant = a * d - b * c;
        if (![a, b, c, d, determinant].every(Number.isFinite) || Math.abs(determinant) < 0.0001) {
            throw new Error('Theme transform coordinate mapping is singular');
        }
        return {
            localToScreen: { a: round(a, 6), b: round(b, 6), c: round(c, 6), d: round(d, 6) },
            screenToLocal: {
                a: round(d / determinant, 6),
                b: round(-b / determinant, 6),
                c: round(-c / determinant, 6),
                d: round(a / determinant, 6),
            },
        };
    }

    function makeButton(doc, label, action, requiresTarget) {
        var button = doc.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('data-tm-avatar-poc-action', action);
        if (requiresTarget) button.setAttribute('data-tm-avatar-poc-requires-target', 'true');
        return button;
    }

    ns.createAvatarInplaceEditorPoc = function (options) {
        options = options || {};
        var win = options.window || global;
        var doc = options.document || win.document;
        var state = 'idle';
        var candidate = null;
        var baseline = null;
        var diagnostics = null;
        var adjustment = { x: 0, y: 0, scale: 1 };
        var animation = null;
        var dragMapping = null;
        var observer = null;
        var styleNode = null;
        var toolbar = null;
        var toolbarRefs = null;
        var activePointer = null;
        var dragOrigin = null;
        var lastResult = null;
        var lastEndReason = '';

        function hasTarget() {
            return state === 'editing' && candidate && candidate.image;
        }

        function snapshotState() {
            return {
                state: state,
                role: candidate ? candidate.role : null,
                x: adjustment.x,
                y: adjustment.y,
                scale: adjustment.scale,
                diagnostics: clone(diagnostics),
                lastResult: clone(lastResult),
                lastEndReason: lastEndReason,
            };
        }

        function ensureStyle() {
            var existing = doc.getElementById && doc.getElementById(STYLE_ID);
            if (existing) {
                styleNode = existing;
                return;
            }
            styleNode = doc.createElement('style');
            styleNode.id = STYLE_ID;
            styleNode.textContent = [
                '#' + TOOLBAR_ID + '{position:fixed;left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483646;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 20px);padding:9px 11px;border:1px solid rgba(255,255,255,.24);border-radius:12px;background:rgba(24,24,30,.94);color:#f5f5f7;font:13px/1.2 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);user-select:none;-webkit-user-select:none}',
                '#' + TOOLBAR_ID + ' button{appearance:none;border:1px solid rgba(255,255,255,.24);border-radius:7px;background:rgba(255,255,255,.1);color:inherit;min-width:34px;min-height:32px;padding:6px 9px;font:inherit;cursor:pointer}',
                '#' + TOOLBAR_ID + ' button:disabled{opacity:.38;cursor:default}',
                '#' + TOOLBAR_ID + ' .tm-avatar-poc-status{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
                '#' + TOOLBAR_ID + ' .tm-avatar-poc-scale{min-width:48px;text-align:center;font-variant-numeric:tabular-nums}',
                '.' + TARGET_CLASS + '{touch-action:none!important;user-select:none!important;-webkit-user-select:none!important;-webkit-user-drag:none!important;cursor:grab!important}',
                '.' + TARGET_CLASS + ':active{cursor:grabbing!important}',
                '.' + AVATAR_CLASS + '{outline:2px solid #d7a8ff!important;outline-offset:3px!important}',
            ].join('');
            doc.head.appendChild(styleNode);
        }

        function makeToolbar() {
            toolbar = doc.createElement('div');
            toolbar.id = TOOLBAR_ID;
            toolbar.setAttribute('role', 'toolbar');
            toolbar.setAttribute('aria-label', '原位头像调整 PoC');
            var status = doc.createElement('span');
            status.className = 'tm-avatar-poc-status';
            var minus = makeButton(doc, '−', 'scale-down', true);
            var scale = doc.createElement('span');
            scale.className = 'tm-avatar-poc-scale';
            var plus = makeButton(doc, '+', 'scale-up', true);
            var reset = makeButton(doc, '重置', 'reset', true);
            var cancel = makeButton(doc, '取消', 'cancel', false);
            var save = makeButton(doc, '保存', 'save', true);
            [status, minus, scale, plus, reset, cancel, save].forEach(function (item) { toolbar.appendChild(item); });
            toolbarRefs = { status: status, minus: minus, scale: scale, plus: plus, reset: reset, cancel: cancel, save: save };
            toolbar.addEventListener('click', onToolbarClick);
            doc.body.appendChild(toolbar);
            updateToolbar();
        }

        function updateToolbar(message) {
            if (!toolbarRefs) return;
            toolbarRefs.status.textContent = message || (hasTarget() ? '原位头像调整 · ' + candidate.role : '请点击聊天正文中的头像');
            toolbarRefs.scale.textContent = Math.round(adjustment.scale * 100) + '%';
            [toolbarRefs.minus, toolbarRefs.plus, toolbarRefs.reset, toolbarRefs.save].forEach(function (button) {
                button.disabled = !hasTarget();
            });
        }

        function removeSelectionListener() {
            doc.removeEventListener('pointerdown', onSelectionPointerDown, true);
        }

        function endDrag(event) {
            if (activePointer == null) return;
            if (candidate && candidate.image && typeof candidate.image.releasePointerCapture === 'function') {
                try { candidate.image.releasePointerCapture(activePointer); } catch (_) {}
            }
            activePointer = null;
            dragOrigin = null;
            doc.removeEventListener('pointermove', onPointerMove, true);
            doc.removeEventListener('pointerup', onPointerUp, true);
            doc.removeEventListener('pointercancel', onPointerUp, true);
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
        }

        function cleanupTargetListeners() {
            endDrag();
            if (!candidate || !candidate.image) return;
            candidate.image.removeEventListener('pointerdown', onPointerDown, true);
            candidate.image.removeEventListener('click', blockTargetClick, true);
        }

        function removeTemporaryUi() {
            removeSelectionListener();
            cleanupTargetListeners();
            if (observer) observer.disconnect();
            observer = null;
            if (candidate) {
                if (!baseline || !baseline.targetClassPresent) candidate.image.classList.remove(TARGET_CLASS);
                if (!baseline || !baseline.avatarClassPresent) candidate.avatar.classList.remove(AVATAR_CLASS);
            }
            if (toolbar) {
                toolbar.removeEventListener('click', onToolbarClick);
                if (toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
            }
            toolbar = null;
            toolbarRefs = null;
            if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode);
            styleNode = null;
        }

        function restoreBaseline() {
            if (!candidate || !candidate.image || !baseline) return;
            if (animation) {
                try { animation.cancel(); } catch (_) {}
            }
            animation = null;
            if (baseline.styleAttribute == null) candidate.image.removeAttribute('style');
            else candidate.image.setAttribute('style', baseline.styleAttribute);
            if (baseline.srcAttribute == null) candidate.image.removeAttribute('src');
            else candidate.image.setAttribute('src', baseline.srcAttribute);
        }

        function finish(keepAdjustment, reason) {
            var finishedCandidate = candidate;
            var finishedDiagnostics = diagnostics;
            var finishedAdjustment = clone(adjustment);
            if (!keepAdjustment) restoreBaseline();
            removeTemporaryUi();
            if (keepAdjustment) animation = null;
            var result = {
                role: finishedCandidate ? finishedCandidate.role : null,
                x: finishedAdjustment.x,
                y: finishedAdjustment.y,
                scale: finishedAdjustment.scale,
                diagnostics: clone(finishedDiagnostics),
                saved: Boolean(keepAdjustment),
                reason: reason || (keepAdjustment ? 'saved' : 'cancelled'),
            };
            candidate = null;
            baseline = null;
            diagnostics = null;
            dragMapping = null;
            adjustment = { x: 0, y: 0, scale: 1 };
            state = 'idle';
            lastResult = result;
            lastEndReason = result.reason;
            return clone(result);
        }

        function failSelection(message) {
            updateToolbar(message);
            lastEndReason = message;
            return false;
        }

        function observeTarget() {
            if (typeof win.MutationObserver !== 'function') return;
            observer = new win.MutationObserver(function () {
                if (candidate && candidate.image && candidate.image.isConnected === false) finish(false, 'target-disconnected');
            });
            observer.observe(doc.body, { childList: true, subtree: true });
        }

        function selectTarget(target) {
            if (state !== 'selecting') return false;
            var next = target && target.image ? target : findEditableAvatar(target, doc, win);
            if (!next) return failSelection('只能选择聊天正文中的真实头像');
            var nextBaseline = {
                styleAttribute: getAttribute(next.image, 'style'),
                srcAttribute: getAttribute(next.image, 'src'),
                targetClassPresent: next.image.classList.contains(TARGET_CLASS),
                avatarClassPresent: next.avatar.classList.contains(AVATAR_CLASS),
            };
            var nextDiagnostics = createDiagnostics(next, win);
            var nextAnimation;
            var nextMapping;
            try {
                nextAnimation = createAdditiveAnimation(next.image, adjustment);
                nextMapping = measureDragMapping(next.image, nextAnimation);
            } catch (error) {
                if (nextAnimation) try { nextAnimation.cancel(); } catch (_) {}
                return failSelection('当前浏览器不支持安全叠加：' + (error.message || error));
            }
            candidate = next;
            baseline = nextBaseline;
            diagnostics = nextDiagnostics;
            animation = nextAnimation;
            dragMapping = nextMapping;
            diagnostics.dragCoordinateSpace = 'viewport-css-pixels';
            diagnostics.dragMapping = clone(nextMapping);
            removeSelectionListener();
            candidate.image.classList.add(TARGET_CLASS);
            candidate.avatar.classList.add(AVATAR_CLASS);
            candidate.image.addEventListener('pointerdown', onPointerDown, true);
            candidate.image.addEventListener('click', blockTargetClick, true);
            state = 'editing';
            observeTarget();
            updateToolbar();
            return true;
        }

        function onSelectionPointerDown(event) {
            var next = findEditableAvatar(event.target, doc, win);
            if (!next) return;
            if (typeof event.preventDefault === 'function') event.preventDefault();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            selectTarget(next);
        }

        function blockTargetClick(event) {
            if (typeof event.preventDefault === 'function') event.preventDefault();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        }

        function onPointerDown(event) {
            if (!hasTarget() || activePointer != null) return;
            if (event.button != null && event.button !== 0) return;
            if (candidate.image.isConnected === false) { finish(false, 'target-disconnected'); return; }
            activePointer = event.pointerId == null ? 1 : event.pointerId;
            dragOrigin = {
                clientX: Number(event.clientX) || 0,
                clientY: Number(event.clientY) || 0,
                x: adjustment.x,
                y: adjustment.y,
            };
            if (typeof event.preventDefault === 'function') event.preventDefault();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            if (typeof candidate.image.setPointerCapture === 'function' && event.pointerId != null) {
                try { candidate.image.setPointerCapture(event.pointerId); } catch (_) {}
            }
            doc.addEventListener('pointermove', onPointerMove, true);
            doc.addEventListener('pointerup', onPointerUp, true);
            doc.addEventListener('pointercancel', onPointerUp, true);
        }

        function onPointerMove(event) {
            if (activePointer == null || !dragOrigin) return;
            if (event.pointerId != null && event.pointerId !== activePointer) return;
            if (!candidate || candidate.image.isConnected === false) { finish(false, 'target-disconnected'); return; }
            adjustment.x = round(dragOrigin.x + (Number(event.clientX) || 0) - dragOrigin.clientX, 3);
            adjustment.y = round(dragOrigin.y + (Number(event.clientY) || 0) - dragOrigin.clientY, 3);
            updateAdditiveAnimation(animation, adjustment, dragMapping);
            updateToolbar();
            if (typeof event.preventDefault === 'function') event.preventDefault();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        }

        function onPointerUp(event) {
            if (activePointer == null) return;
            if (event.pointerId != null && event.pointerId !== activePointer) return;
            endDrag(event);
        }

        function setScale(value) {
            if (!hasTarget()) return snapshotState();
            adjustment.scale = clampScale(value);
            updateAdditiveAnimation(animation, adjustment, dragMapping);
            updateToolbar();
            return snapshotState();
        }

        function reset() {
            if (!hasTarget()) return snapshotState();
            adjustment = { x: 0, y: 0, scale: 1 };
            updateAdditiveAnimation(animation, adjustment, dragMapping);
            updateToolbar();
            return snapshotState();
        }

        function save() {
            return hasTarget() ? finish(true, 'saved') : null;
        }

        function cancel() {
            if (state === 'idle') return null;
            return finish(false, state === 'selecting' ? 'selection-cancelled' : 'cancelled');
        }

        function onToolbarClick(event) {
            var button = closest(event.target, '[data-tm-avatar-poc-action]');
            if (!button || !toolbar || !toolbar.contains(button) || button.disabled) return;
            var action = getAttribute(button, 'data-tm-avatar-poc-action');
            if (action === 'scale-down') setScale(adjustment.scale - SCALE_STEP);
            else if (action === 'scale-up') setScale(adjustment.scale + SCALE_STEP);
            else if (action === 'reset') reset();
            else if (action === 'cancel') cancel();
            else if (action === 'save') save();
        }

        function start(nextOptions) {
            if (state !== 'idle') return snapshotState();
            if (!doc || !doc.body || !doc.head) throw new Error('Avatar in-place PoC requires a document');
            lastResult = null;
            lastEndReason = '';
            adjustment = { x: 0, y: 0, scale: 1 };
            ensureStyle();
            makeToolbar();
            doc.addEventListener('pointerdown', onSelectionPointerDown, true);
            state = 'selecting';
            updateToolbar();
            return snapshotState();
        }

        return {
            start: start,
            cancel: cancel,
            save: save,
            reset: reset,
            setScale: setScale,
            scaleUp: function () { return setScale(adjustment.scale + SCALE_STEP); },
            scaleDown: function () { return setScale(adjustment.scale - SCALE_STEP); },
            selectTarget: selectTarget,
            getState: snapshotState,
            findEditableAvatar: function (element) { return findEditableAvatar(element, doc, win); },
            constants: {
                minScale: MIN_SCALE,
                maxScale: MAX_SCALE,
                scaleStep: SCALE_STEP,
            },
        };
    };

    ns.avatarInplacePoc = ns.createAvatarInplaceEditorPoc({ window: global, document: global.document });
    global.ThemeMgrAvatarPoc = ns.avatarInplacePoc;
    ns.avatarInplacePocInternals = {
        clampScale: clampScale,
        classifyMessage: classifyMessage,
        findEditableAvatar: findEditableAvatar,
        adjustmentTransform: adjustmentTransform,
    };
})(window);
