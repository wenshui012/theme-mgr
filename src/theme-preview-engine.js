(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var PROFILE_VERSION = 1;
    var STAGE_WIDTH = 390;
    var STAGE_HEIGHT = 700;
    var activeStages = 0;
    var resultViewer = null;

    var STAGE_CSS = [
        ':host{all:initial;contain:strict;color-scheme:light dark}',
        '.tm-poc-stage,.tm-poc-stage *{box-sizing:border-box}',
        '.tm-poc-stage{position:relative;width:390px;height:700px;overflow:hidden;background:var(--poc-page-color);color:var(--poc-text);font-family:var(--poc-font-family);font-size:var(--poc-font-size);font-weight:var(--poc-font-weight);line-height:1.45}',
        '.tm-poc-page-bg,.tm-poc-tint{position:absolute;inset:0;pointer-events:none}',
        '.tm-poc-page-bg{background-image:var(--poc-page-image);background-size:var(--poc-page-size);background-position:var(--poc-page-position);background-repeat:var(--poc-page-repeat)}',
        '.tm-poc-tint{background:var(--poc-page-tint);opacity:var(--poc-page-tint-opacity)}',
        '.tm-poc-shell{position:relative;height:100%;display:flex;flex-direction:column;padding:18px 14px 16px;gap:13px}',
        '.tm-poc-top{position:relative;min-height:62px;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;overflow:hidden;background:var(--poc-top-bg);border:var(--poc-top-border);border-radius:var(--poc-top-radius);box-shadow:var(--poc-top-shadow);backdrop-filter:var(--poc-top-blur)}',
        '.tm-poc-top-decoration,.tm-poc-message-decoration{position:absolute;inset:0;pointer-events:none}',
        '.tm-poc-top-decoration{background-image:var(--poc-top-decoration-image);background-size:var(--poc-top-decoration-size);background-position:var(--poc-top-decoration-position);background-repeat:var(--poc-top-decoration-repeat);opacity:var(--poc-top-decoration-opacity)}',
        '.tm-poc-message-decoration{background-image:var(--poc-message-decoration-image);background-size:var(--poc-message-decoration-size);background-position:var(--poc-message-decoration-position);background-repeat:var(--poc-message-decoration-repeat);opacity:var(--poc-message-decoration-opacity)}',
        '.tm-poc-title{position:relative;font-size:15px;font-weight:700;letter-spacing:.02em}',
        '.tm-poc-icons{position:relative;display:flex;gap:7px}',
        '.tm-poc-icon{width:8px;height:8px;border-radius:99px;background:var(--poc-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--poc-accent) 22%,transparent)}',
        '.tm-poc-chat{flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:10px 0}',
        '.tm-poc-row{display:grid;grid-template-columns:68px minmax(0,1fr);gap:10px;align-items:start}',
        '.tm-poc-row-user{grid-template-columns:minmax(0,1fr) 68px}',
        '.tm-poc-row-user .tm-poc-avatar{grid-column:2}.tm-poc-row-user .tm-poc-message{grid-column:1;grid-row:1}',
        '.tm-poc-avatar{position:relative;width:var(--poc-avatar-width);height:var(--poc-avatar-height);justify-self:center}',
        '.tm-poc-avatar-image{position:absolute;left:var(--poc-avatar-slot-left);top:var(--poc-avatar-slot-top);width:var(--poc-avatar-slot-width);height:var(--poc-avatar-slot-height);background-image:var(--poc-avatar-image);background-size:var(--poc-avatar-object-fit);background-position:var(--poc-avatar-object-position);background-repeat:no-repeat;border:var(--poc-avatar-border);border-radius:var(--poc-avatar-radius);box-shadow:var(--poc-avatar-shadow);clip-path:var(--poc-avatar-clip);-webkit-mask-image:var(--poc-avatar-mask);mask-image:var(--poc-avatar-mask);-webkit-mask-size:var(--poc-avatar-mask-size);mask-size:var(--poc-avatar-mask-size);-webkit-mask-position:var(--poc-avatar-mask-position);mask-position:var(--poc-avatar-mask-position);-webkit-mask-repeat:var(--poc-avatar-mask-repeat);mask-repeat:var(--poc-avatar-mask-repeat);transform:var(--poc-avatar-transform)}',
        '.tm-poc-avatar-frame{position:absolute;left:var(--poc-frame-left);top:var(--poc-frame-top);width:var(--poc-frame-width);height:var(--poc-frame-height);pointer-events:none;background-image:var(--poc-frame-image);background-size:var(--poc-frame-size);background-position:var(--poc-frame-position);background-repeat:var(--poc-frame-repeat);mix-blend-mode:var(--poc-frame-blend);filter:var(--poc-frame-filter);opacity:var(--poc-frame-opacity);transform:var(--poc-frame-transform)}',
        '.tm-poc-message{position:relative;min-height:126px;overflow:hidden}',
        '.tm-poc-message-character{padding:var(--poc-character-padding);background:var(--poc-character-bg);border-radius:var(--poc-character-radius);border:var(--poc-character-border);box-shadow:var(--poc-character-shadow);backdrop-filter:var(--poc-character-blur)}',
        '.tm-poc-message-user{padding:var(--poc-user-padding);background:var(--poc-user-bg);border-radius:var(--poc-user-radius);border:var(--poc-user-border);box-shadow:var(--poc-user-shadow);backdrop-filter:var(--poc-user-blur)}',
        '.tm-poc-name,.tm-poc-copy{position:relative}.tm-poc-name{font-weight:700;color:var(--poc-accent);margin-bottom:7px}.tm-poc-copy{color:var(--poc-text)}',
        '.tm-poc-copy-secondary{color:var(--poc-text-secondary);margin-top:7px;font-size:.9em}',
        '.tm-poc-input{min-height:68px;display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--poc-input-bg);border:var(--poc-input-border);border-radius:var(--poc-input-radius);box-shadow:var(--poc-input-shadow);backdrop-filter:var(--poc-input-blur)}',
        '.tm-poc-placeholder{flex:1;color:var(--poc-text-secondary)}',
        '.tm-poc-send{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--poc-accent);color:var(--poc-accent-text);font-weight:800}',
    ].join('');

    var SAMPLE_AVATAR = 'radial-gradient(circle at 50% 38%, rgba(255,255,255,.86) 0 18%, transparent 19%), radial-gradient(ellipse at 50% 108%, rgba(255,255,255,.82) 0 43%, transparent 44%), linear-gradient(135deg, #7b6db2, #d9a7bd)';

    function text(value, fallback, maximum) {
        var result = String(value == null ? '' : value).trim();
        if (!result || result.length > (maximum || 1000)) return fallback;
        return result;
    }

    function finitePixel(value, fallback, minimum, maximum) {
        var parsed = parseFloat(String(value == null ? '' : value));
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(minimum, Math.min(maximum, parsed)) + 'px';
    }

    function styleOf(win, element, pseudo) {
        if (!element || !win || typeof win.getComputedStyle !== 'function') return null;
        try { return win.getComputedStyle(element, pseudo || null); } catch (_) { return null; }
    }

    function styleValue(style, key, fallback, maximum) {
        return text(style && style[key], fallback, maximum);
    }

    function cssVariable(style, name, fallback) {
        if (!style || typeof style.getPropertyValue !== 'function') return fallback;
        return text(style.getPropertyValue(name), fallback, 32000);
    }

    function safeImage(value, fallback) {
        var result = text(value, '', 32000);
        if (!result || result === 'none') return fallback || 'none';
        return /(?:url|image-set|(?:repeating-)?(?:linear|radial|conic)-gradient)\(/i.test(result)
            ? result
            : (fallback || 'none');
    }

    function safeClip(value) {
        var result = text(value, 'none', 2000);
        return result === 'none' || /^(?:circle|ellipse|inset|polygon|path)\(/i.test(result) ? result : 'none';
    }

    function visible(style) {
        return Boolean(style && style.display !== 'none' && style.visibility !== 'hidden');
    }

    function query(doc, selectors) {
        for (var i = 0; i < selectors.length; i++) {
            try {
                var element = doc.querySelector(selectors[i]);
                if (element) return element;
            } catch (_) {}
        }
        return null;
    }

    function readThemeName(win, doc, override) {
        if (override != null) return text(override, '', 500);
        try {
            if (win.power_user && win.power_user.theme) return text(win.power_user.theme, '', 500);
        } catch (_) {}
        var control = doc.getElementById && doc.getElementById('themes');
        return text(control && control.value, '', 500);
    }

    function readDecoration(win, element, pseudo) {
        var style = styleOf(win, element, pseudo);
        if (!visible(style)) return null;
        if (pseudo && (style.content === 'none' || style.content === 'normal')) return null;
        var image = safeImage(style.content, 'none');
        if (image === 'none') image = safeImage(style.backgroundImage, 'none');
        if (image === 'none') return null;
        return {
            image: image,
            size: styleValue(style, 'backgroundSize', 'contain', 1000),
            position: styleValue(style, 'backgroundPosition', 'center', 1000),
            repeat: styleValue(style, 'backgroundRepeat', 'no-repeat', 500),
            transform: styleValue(style, 'transform', 'none', 500),
            mixBlendMode: styleValue(style, 'mixBlendMode', 'normal', 100),
            filter: styleValue(style, 'filter', 'none', 1000),
            opacity: styleValue(style, 'opacity', '1', 50),
            left: styleValue(style, 'left', '0px', 100),
            top: styleValue(style, 'top', '0px', 100),
            width: styleValue(style, 'width', '100%', 100),
            height: styleValue(style, 'height', '100%', 100),
            source: pseudo || 'element',
        };
    }

    function firstDecoration(win, candidates) {
        for (var i = 0; i < candidates.length; i++) {
            var result = readDecoration(win, candidates[i].element, candidates[i].pseudo);
            if (result) return result;
        }
        return null;
    }

    function readBox(win, element, fallback) {
        var style = styleOf(win, element);
        fallback = fallback || {};
        return {
            background: styleValue(style, 'backgroundColor', fallback.background || 'transparent', 300),
            border: styleValue(style, 'border', fallback.border || '0px none transparent', 500),
            borderRadius: styleValue(style, 'borderRadius', fallback.borderRadius || '0px', 500),
            boxShadow: styleValue(style, 'boxShadow', fallback.boxShadow || 'none', 1000),
            backdropFilter: styleValue(style, 'backdropFilter', fallback.backdropFilter || 'none', 500),
            padding: styleValue(style, 'padding', fallback.padding || '0px', 500),
        };
    }

    function readAvatar(win, avatar) {
        var image = avatar && avatar.querySelector ? avatar.querySelector('img') : null;
        var source = image || avatar;
        var style = styleOf(win, source);
        var avatarStyle = styleOf(win, avatar);
        var rect = source && typeof source.getBoundingClientRect === 'function' ? source.getBoundingClientRect() : null;
        var width = rect && rect.width > 0 ? rect.width : parseFloat(style && style.width);
        var height = rect && rect.height > 0 ? rect.height : parseFloat(style && style.height);
        var frame = firstDecoration(win, [
            { element: avatar, pseudo: '::after' },
            { element: avatar, pseudo: '::before' },
        ]);
        return {
            width: finitePixel(width, '58px', 24, 180),
            height: finitePixel(height, '58px', 24, 220),
            border: styleValue(style, 'border', '0px none transparent', 500),
            borderRadius: styleValue(style, 'borderRadius', styleValue(avatarStyle, 'borderRadius', '0px', 500), 500),
            boxShadow: styleValue(style, 'boxShadow', 'none', 1000),
            clipPath: safeClip(style && style.clipPath),
            maskImage: safeImage(style && (style.webkitMaskImage || style.maskImage), 'none'),
            maskSize: styleValue(style, style && style.webkitMaskSize ? 'webkitMaskSize' : 'maskSize', 'cover', 1000),
            maskPosition: styleValue(style, style && style.webkitMaskPosition ? 'webkitMaskPosition' : 'maskPosition', 'center', 1000),
            maskRepeat: styleValue(style, style && style.webkitMaskRepeat ? 'webkitMaskRepeat' : 'maskRepeat', 'no-repeat', 500),
            objectFit: styleValue(style, 'objectFit', 'cover', 100),
            objectPosition: styleValue(style, 'objectPosition', 'center', 500),
            transform: styleValue(style, 'transform', 'none', 500),
            slot: { left: '0%', top: '0%', width: '100%', height: '100%' },
            frame: frame,
        };
    }

    function createProfile(options) {
        options = options || {};
        var win = options.window || global;
        var doc = options.document || win.document;
        if (!doc || !doc.documentElement || !doc.body) throw new Error('Theme Visual Profile requires a document');
        var rootStyle = styleOf(win, doc.documentElement);
        var bodyStyle = styleOf(win, doc.body);
        var characterMessage = query(doc, ['#chat .mes:not([is_user="true"]):not(.smallSysMes)', '#chat .mes:not(.smallSysMes)', '#chat .mes']);
        var userMessage = query(doc, ['#chat .mes[is_user="true"]', '#chat .mes.user_mes', '#chat .mes']);
        var messageText = query(doc, ['#chat .mes_text', '#chat .mes .mes_text']);
        var messageTextStyle = styleOf(win, messageText || characterMessage);
        var topBar = query(doc, ['#top-settings-holder', '#top-bar']);
        var sendForm = query(doc, ['#send_form', '#send_textarea']);
        var avatar = characterMessage && characterMessage.querySelector ? characterMessage.querySelector('.avatar') : query(doc, ['#chat .mes .avatar', '.mes .avatar']);
        var bg = doc.getElementById && doc.getElementById('bg1');
        var bgStyle = styleOf(win, bg || doc.body);
        var characterBox = readBox(win, characterMessage, { background: cssVariable(rootStyle, '--SmartThemeBotMesBlurTintColor', 'rgba(30,30,36,.72)'), borderRadius: '10px', padding: '14px' });
        var userBox = readBox(win, userMessage, { background: cssVariable(rootStyle, '--SmartThemeUserMesBlurTintColor', characterBox.background), borderRadius: characterBox.borderRadius, padding: characterBox.padding });
        var inputBox = readBox(win, sendForm, { background: cssVariable(rootStyle, '--SmartThemeChatTintColor', characterBox.background), borderRadius: '10px', padding: '12px' });
        var topBox = readBox(win, topBar, { background: cssVariable(rootStyle, '--SmartThemeBlurTintColor', styleValue(bodyStyle, 'backgroundColor', '#202026', 300)), borderRadius: '0px' });
        var rawColors = {
            text: cssVariable(rootStyle, '--SmartThemeBodyColor', styleValue(bodyStyle, 'color', '#eeeeef', 300)),
            accent: cssVariable(rootStyle, '--SmartThemeQuoteColor', '#7c6daf'),
            background: cssVariable(rootStyle, '--SmartThemeBlurTintColor', styleValue(bodyStyle, 'backgroundColor', '#202026', 300)),
            chat: cssVariable(rootStyle, '--SmartThemeChatTintColor', characterBox.background),
            border: cssVariable(rootStyle, '--SmartThemeBorderColor', characterBox.border),
            shadow: cssVariable(rootStyle, '--SmartThemeShadowColor', 'rgba(0,0,0,.28)'),
        };
        var paletteApi = options.appearance || ns.themeAppearance;
        var palette = paletteApi && typeof paletteApi.createPalette === 'function'
            ? paletteApi.createPalette(rawColors)
            : { text: rawColors.text, muted: rawColors.text, accent: rawColors.accent, accentText: '#fff' };
        var pageImage = safeImage(bgStyle && bgStyle.backgroundImage, 'none');
        if (/__transparent(?:\.png)?/i.test(pageImage)) pageImage = 'none';
        var topDecoration = firstDecoration(win, [
            { element: topBar, pseudo: '::after' },
            { element: topBar, pseudo: '::before' },
            { element: topBar, pseudo: '' },
        ]);
        var messageDecoration = firstDecoration(win, [
            { element: characterMessage, pseudo: '::before' },
            { element: characterMessage, pseudo: '::after' },
        ]);
        var profile = {
            version: PROFILE_VERSION,
            sourceThemeName: readThemeName(win, doc, options.sourceThemeName),
            colors: {
                page: rawColors.background,
                textPrimary: palette.text || rawColors.text,
                textSecondary: palette.muted || rawColors.text,
                accent: palette.accent || rawColors.accent,
                accentText: palette.accentText || '#fff',
                characterSurface: characterBox.background,
                userSurface: userBox.background,
            },
            background: {
                image: pageImage,
                size: styleValue(bgStyle, 'backgroundSize', 'cover', 1000),
                position: styleValue(bgStyle, 'backgroundPosition', 'center', 1000),
                repeat: styleValue(bgStyle, 'backgroundRepeat', 'no-repeat', 500),
                overlay: {
                    color: rawColors.background,
                    opacity: pageImage === 'none' ? '1' : (palette.mode === 'light' ? '.24' : '.3'),
                },
            },
            typography: {
                fontFamily: styleValue(messageTextStyle || bodyStyle, 'fontFamily', 'sans-serif', 500),
                fontSize: finitePixel(styleValue(messageTextStyle || bodyStyle, 'fontSize', '16px', 100), '16px', 10, 28),
                fontWeight: styleValue(messageTextStyle || bodyStyle, 'fontWeight', '400', 100),
            },
            messages: {
                character: characterBox,
                user: userBox,
            },
            topBar: Object.assign(topBox, { decoration: topDecoration }),
            input: inputBox,
            avatar: readAvatar(win, avatar),
            decorations: {
                messageMotif: messageDecoration,
            },
        };
        return JSON.parse(JSON.stringify(profile));
    }

    function setVar(element, name, value, fallback) {
        element.style.setProperty(name, text(value, fallback, 32000));
    }

    function append(doc, parent, tag, className, content) {
        var element = doc.createElement(tag);
        element.className = className;
        if (content != null) element.textContent = content;
        parent.appendChild(element);
        return element;
    }

    function addAvatar(doc, parent, profile) {
        var avatar = append(doc, parent, 'div', 'tm-poc-avatar');
        append(doc, avatar, 'div', 'tm-poc-avatar-image');
        append(doc, avatar, 'div', 'tm-poc-avatar-frame');
        return avatar;
    }

    function addMessage(doc, parent, profile, role) {
        var row = append(doc, parent, 'div', 'tm-poc-row' + (role === 'user' ? ' tm-poc-row-user' : ''));
        if (role !== 'user') addAvatar(doc, row, profile);
        var message = append(doc, row, 'div', 'tm-poc-message tm-poc-message-' + role);
        append(doc, message, 'div', 'tm-poc-message-decoration');
        append(doc, message, 'div', 'tm-poc-name', role === 'user' ? 'User' : 'Character');
        append(doc, message, 'div', 'tm-poc-copy', role === 'user' ? 'This is a fixed sample reply for visual preview.' : 'This preview uses fixed text and never reads the current chat.');
        append(doc, message, 'div', 'tm-poc-copy tm-poc-copy-secondary', role === 'user' ? 'Typography, surface and spacing.' : 'Theme colors, shape and decoration.');
        if (role === 'user') addAvatar(doc, row, profile);
        return row;
    }

    function applyProfile(stage, profile) {
        var avatar = profile.avatar || {};
        var frame = avatar.frame || {};
        var motif = profile.decorations && profile.decorations.messageMotif || {};
        var topDecoration = profile.topBar && profile.topBar.decoration || {};
        setVar(stage, '--poc-page-color', profile.colors.page, '#202026');
        setVar(stage, '--poc-page-image', profile.background.image, 'none');
        setVar(stage, '--poc-page-size', profile.background.size, 'cover');
        setVar(stage, '--poc-page-position', profile.background.position, 'center');
        setVar(stage, '--poc-page-repeat', profile.background.repeat, 'no-repeat');
        setVar(stage, '--poc-page-tint', profile.background.overlay && profile.background.overlay.color, 'transparent');
        setVar(stage, '--poc-page-tint-opacity', profile.background.overlay && profile.background.overlay.opacity, '1');
        setVar(stage, '--poc-text', profile.colors.textPrimary, '#eee');
        setVar(stage, '--poc-text-secondary', profile.colors.textSecondary, '#aaa');
        setVar(stage, '--poc-accent', profile.colors.accent, '#7c6daf');
        setVar(stage, '--poc-accent-text', profile.colors.accentText, '#fff');
        setVar(stage, '--poc-character-bg', profile.colors.characterSurface, 'rgba(30,30,36,.72)');
        setVar(stage, '--poc-user-bg', profile.colors.userSurface, 'rgba(45,42,55,.72)');
        setVar(stage, '--poc-font-family', profile.typography.fontFamily, 'sans-serif');
        setVar(stage, '--poc-font-size', profile.typography.fontSize, '16px');
        setVar(stage, '--poc-font-weight', profile.typography.fontWeight, '400');
        var characterMessage = profile.messages.character;
        var userMessage = profile.messages.user;
        setVar(stage, '--poc-character-padding', characterMessage.padding, '14px');
        setVar(stage, '--poc-character-radius', characterMessage.borderRadius, '10px');
        setVar(stage, '--poc-character-border', characterMessage.border, '0px none transparent');
        setVar(stage, '--poc-character-shadow', characterMessage.boxShadow, 'none');
        setVar(stage, '--poc-character-blur', characterMessage.backdropFilter, 'none');
        setVar(stage, '--poc-user-padding', userMessage.padding, '14px');
        setVar(stage, '--poc-user-radius', userMessage.borderRadius, '10px');
        setVar(stage, '--poc-user-border', userMessage.border, '0px none transparent');
        setVar(stage, '--poc-user-shadow', userMessage.boxShadow, 'none');
        setVar(stage, '--poc-user-blur', userMessage.backdropFilter, 'none');
        setVar(stage, '--poc-top-bg', profile.topBar.background, 'rgba(30,30,36,.72)');
        setVar(stage, '--poc-top-border', profile.topBar.border, '0px none transparent');
        setVar(stage, '--poc-top-radius', profile.topBar.borderRadius, '0px');
        setVar(stage, '--poc-top-shadow', profile.topBar.boxShadow, 'none');
        setVar(stage, '--poc-top-blur', profile.topBar.backdropFilter, 'none');
        setVar(stage, '--poc-input-bg', profile.input.background, 'rgba(30,30,36,.72)');
        setVar(stage, '--poc-input-border', profile.input.border, '0px none transparent');
        setVar(stage, '--poc-input-radius', profile.input.borderRadius, '10px');
        setVar(stage, '--poc-input-shadow', profile.input.boxShadow, 'none');
        setVar(stage, '--poc-input-blur', profile.input.backdropFilter, 'none');
        setVar(stage, '--poc-avatar-width', avatar.width, '58px');
        setVar(stage, '--poc-avatar-height', avatar.height, '58px');
        setVar(stage, '--poc-avatar-image', SAMPLE_AVATAR, SAMPLE_AVATAR);
        setVar(stage, '--poc-avatar-border', avatar.border, '0px none transparent');
        setVar(stage, '--poc-avatar-radius', avatar.borderRadius, '0px');
        setVar(stage, '--poc-avatar-shadow', avatar.boxShadow, 'none');
        setVar(stage, '--poc-avatar-clip', avatar.clipPath, 'none');
        setVar(stage, '--poc-avatar-mask', avatar.maskImage, 'none');
        setVar(stage, '--poc-avatar-mask-size', avatar.maskSize, 'cover');
        setVar(stage, '--poc-avatar-mask-position', avatar.maskPosition, 'center');
        setVar(stage, '--poc-avatar-mask-repeat', avatar.maskRepeat, 'no-repeat');
        setVar(stage, '--poc-avatar-object-position', avatar.objectPosition, 'center');
        setVar(stage, '--poc-avatar-object-fit', avatar.objectFit === 'contain' ? 'contain' : 'cover', 'cover');
        setVar(stage, '--poc-avatar-transform', avatar.transform, 'none');
        setVar(stage, '--poc-avatar-slot-left', avatar.slot && avatar.slot.left, '0%');
        setVar(stage, '--poc-avatar-slot-top', avatar.slot && avatar.slot.top, '0%');
        setVar(stage, '--poc-avatar-slot-width', avatar.slot && avatar.slot.width, '100%');
        setVar(stage, '--poc-avatar-slot-height', avatar.slot && avatar.slot.height, '100%');
        setVar(stage, '--poc-frame-image', frame.image, 'none');
        setVar(stage, '--poc-frame-size', frame.size, 'contain');
        setVar(stage, '--poc-frame-position', frame.position, 'center');
        setVar(stage, '--poc-frame-repeat', frame.repeat, 'no-repeat');
        setVar(stage, '--poc-frame-blend', frame.mixBlendMode, 'normal');
        setVar(stage, '--poc-frame-filter', frame.filter, 'none');
        setVar(stage, '--poc-frame-opacity', frame.opacity, '1');
        setVar(stage, '--poc-frame-left', frame.left, '0px');
        setVar(stage, '--poc-frame-top', frame.top, '0px');
        setVar(stage, '--poc-frame-width', frame.width, '100%');
        setVar(stage, '--poc-frame-height', frame.height, '100%');
        setVar(stage, '--poc-frame-transform', frame.transform, 'none');
        setVar(stage, '--poc-message-decoration-image', motif.image, 'none');
        setVar(stage, '--poc-message-decoration-size', motif.size, 'cover');
        setVar(stage, '--poc-message-decoration-position', motif.position, 'center');
        setVar(stage, '--poc-message-decoration-repeat', motif.repeat, 'no-repeat');
        setVar(stage, '--poc-message-decoration-opacity', motif.opacity, '.2');
        setVar(stage, '--poc-top-decoration-image', topDecoration.image, 'none');
        setVar(stage, '--poc-top-decoration-size', topDecoration.size, 'cover');
        setVar(stage, '--poc-top-decoration-position', topDecoration.position, 'center');
        setVar(stage, '--poc-top-decoration-repeat', topDecoration.repeat, 'no-repeat');
        setVar(stage, '--poc-top-decoration-opacity', topDecoration.opacity, '.2');
    }

    function createStage(profile, options) {
        options = options || {};
        var doc = options.document || global.document;
        if (!doc || !doc.body || typeof doc.createElement !== 'function') throw new Error('Preview Stage requires a document');
        var host = doc.createElement('div');
        host.setAttribute('data-theme-preview-poc', 'stage-host');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + STAGE_WIDTH + 'px;height:' + STAGE_HEIGHT + 'px;overflow:hidden;pointer-events:none;contain:strict;z-index:-2147483648;';
        var shadow = host.attachShadow({ mode: 'open' });
        var style = doc.createElement('style');
        style.textContent = STAGE_CSS;
        shadow.appendChild(style);
        var stage = append(doc, shadow, 'div', 'tm-poc-stage');
        append(doc, stage, 'div', 'tm-poc-page-bg');
        append(doc, stage, 'div', 'tm-poc-tint');
        var shell = append(doc, stage, 'div', 'tm-poc-shell');
        var top = append(doc, shell, 'div', 'tm-poc-top');
        append(doc, top, 'div', 'tm-poc-top-decoration');
        append(doc, top, 'div', 'tm-poc-title', 'Theme Visual Preview');
        var icons = append(doc, top, 'div', 'tm-poc-icons');
        append(doc, icons, 'span', 'tm-poc-icon');
        append(doc, icons, 'span', 'tm-poc-icon');
        append(doc, icons, 'span', 'tm-poc-icon');
        var chat = append(doc, shell, 'div', 'tm-poc-chat');
        addMessage(doc, chat, profile, 'character');
        addMessage(doc, chat, profile, 'user');
        var input = append(doc, shell, 'div', 'tm-poc-input');
        append(doc, input, 'div', 'tm-poc-placeholder', 'Write a fixed preview message…');
        append(doc, input, 'div', 'tm-poc-send', '›');
        applyProfile(stage, profile);
        doc.body.appendChild(host);
        activeStages++;
        var destroyed = false;
        return {
            host: host,
            shadowRoot: shadow,
            stage: stage,
            styleText: STAGE_CSS,
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            destroy: function () {
                if (destroyed) return;
                destroyed = true;
                if (host.parentNode) host.parentNode.removeChild(host);
                activeStages = Math.max(0, activeStages - 1);
                this.host = null;
                this.shadowRoot = null;
                this.stage = null;
            },
        };
    }

    function nextFrame(win) {
        return new Promise(function (resolve) {
            if (win && typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(function () { resolve(); });
            else setTimeout(resolve, 16);
        });
    }

    function bounded(promise, timeoutMs) {
        return new Promise(function (resolve) {
            var settled = false;
            var timer = setTimeout(finish, timeoutMs);
            function finish() {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve();
            }
            Promise.resolve(promise).then(finish, finish);
        });
    }

    function waitForImages(stage, timeoutMs) {
        if (!stage || typeof stage.querySelectorAll !== 'function') return Promise.resolve();
        var images = Array.prototype.slice.call(stage.querySelectorAll('img'));
        return bounded(Promise.all(images.map(function (image) {
            if (image.complete) return null;
            return new Promise(function (resolve) {
                function finish() {
                    image.removeEventListener('load', finish);
                    image.removeEventListener('error', finish);
                    resolve();
                }
                image.addEventListener('load', finish);
                image.addEventListener('error', finish);
            });
        })), timeoutMs);
    }

    function settleStage(handle, options) {
        options = options || {};
        var win = options.window || global;
        var doc = options.document || win.document;
        var timeoutMs = Math.max(100, Number(options.timeoutMs) || 2000);
        var fonts = doc && doc.fonts && doc.fonts.ready ? bounded(doc.fonts.ready, timeoutMs) : Promise.resolve();
        return Promise.all([fonts, waitForImages(handle && handle.stage, timeoutMs)])
            .then(function () { return nextFrame(win); })
            .then(function () { return nextFrame(win); });
    }

    function blobToDataUrl(blob, win) {
        return new Promise(function (resolve, reject) {
            var Reader = win.FileReader;
            if (typeof Reader !== 'function') { reject(new Error('FileReader unavailable')); return; }
            var reader = new Reader();
            reader.onload = function () { resolve(String(reader.result || '')); };
            reader.onerror = function () { reject(reader.error || new Error('asset read failed')); };
            reader.readAsDataURL(blob);
        });
    }

    function replaceCssUrls(value, resolver) {
        var matches = [];
        String(value || '').replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, function (whole, doubleQuoted, singleQuoted, bare, offset) {
            matches.push({ whole: whole, url: String(doubleQuoted || singleQuoted || bare || '').trim(), offset: offset });
            return whole;
        });
        if (!matches.length) return Promise.resolve({ value: value, normalized: 0, failures: [] });
        return Promise.all(matches.map(function (match) {
            return resolver(match.url).then(function (dataUrl) {
                return { match: match, dataUrl: dataUrl };
            }).catch(function (error) {
                return { match: match, error: error };
            });
        })).then(function (results) {
            var output = String(value);
            var failures = [];
            var normalized = 0;
            results.forEach(function (item) {
                if (item.error) {
                    failures.push({ url: item.match.url, message: item.error.message || String(item.error) });
                    return;
                }
                if (item.dataUrl !== item.match.url) normalized++;
                output = output.split(item.match.whole).join('url("' + String(item.dataUrl).replace(/["\\]/g, '\\$&') + '")');
            });
            return { value: output, normalized: normalized, failures: failures };
        });
    }

    function normalizeProfileAssets(profile, options) {
        options = options || {};
        var win = options.window || global;
        var doc = options.document || win.document;
        var fetcher = options.fetch || win.fetch;
        var convert = options.blobToDataUrl || function (blob) { return blobToDataUrl(blob, win); };
        var clone = JSON.parse(JSON.stringify(profile));
        var failures = [];
        var normalizedCount = 0;
        var seen = Object.create(null);

        function resolveAsset(url) {
            if (!url || /^data:/i.test(url)) return Promise.resolve(url);
            if (/^#/.test(url)) return Promise.reject(new Error('document-fragment image cannot be isolated'));
            var absolute;
            try { absolute = new URL(url, doc && doc.baseURI || win.location && win.location.href || undefined).href; }
            catch (_) { return Promise.reject(new Error('invalid asset URL')); }
            if (seen[absolute]) return seen[absolute];
            if (typeof fetcher !== 'function') return Promise.reject(new Error('fetch unavailable'));
            seen[absolute] = Promise.resolve(fetcher(absolute, { credentials: 'same-origin' }))
                .then(function (response) {
                    if (!response || !response.ok) throw new Error('asset request failed' + (response ? ' (' + response.status + ')' : ''));
                    return response.blob();
                })
                .then(convert);
            return seen[absolute];
        }

        function visit(value, parent, key) {
            if (typeof value === 'string' && /url\(/i.test(value)) {
                return replaceCssUrls(value, resolveAsset).then(function (result) {
                    parent[key] = result.value;
                    normalizedCount += result.normalized;
                    failures = failures.concat(result.failures);
                });
            }
            if (!value || typeof value !== 'object') return Promise.resolve();
            return Promise.all(Object.keys(value).map(function (childKey) { return visit(value[childKey], value, childKey); }));
        }

        return visit(clone, { root: clone }, 'root').then(function () {
            return { profile: clone, normalizedCount: normalizedCount, failures: failures };
        });
    }

    function xmlEscapeStyle(value) {
        return String(value).replace(/<\/style/gi, '<\\/style');
    }

    function canvasBlob(canvas, type) {
        return new Promise(function (resolve) {
            if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
            canvas.toBlob(resolve, type);
        });
    }

    function finishCapture(promise, win, getCanvas, getObjectUrl) {
        return promise.catch(function (error) {
            return { ok: false, error: { code: /security|taint/i.test(error.message || '') ? 'tainted-canvas' : 'capture-failed', message: error.message || String(error) } };
        }).finally(function () {
            var objectUrl = getObjectUrl();
            if (objectUrl) try { win.URL.revokeObjectURL(objectUrl); } catch (_) {}
            var canvas = getCanvas();
            if (canvas) { canvas.width = 1; canvas.height = 1; }
        });
    }

    function captureStage(handle, options) {
        options = options || {};
        var win = options.window || global;
        var doc = options.document || win.document;
        var scale = Math.max(1, Math.min(4, Number(options.scale) || 2));
        var mimeType = options.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        var timeoutMs = Math.max(250, Number(options.timeoutMs) || 4000);
        if (!handle || !handle.stage || typeof handle.stage.outerHTML !== 'string') {
            return Promise.resolve({ ok: false, error: { code: 'stage-unavailable', message: 'Preview Stage is unavailable' } });
        }
        var canvas = null;
        var promise = Promise.resolve().then(function () {
            var markup = '<div xmlns="http://www.w3.org/1999/xhtml"><style>' + xmlEscapeStyle(handle.styleText) + '</style>' + handle.stage.outerHTML + '</div>';
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + handle.width + '" height="' + handle.height + '" viewBox="0 0 ' + handle.width + ' ' + handle.height + '"><foreignObject width="100%" height="100%">' + markup + '</foreignObject></svg>';
            return blobToDataUrl(new win.Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), win).then(function (svgDataUrl) {
                canvas = doc.createElement('canvas');
                canvas.width = Math.round(handle.width * scale);
                canvas.height = Math.round(handle.height * scale);
                var context = canvas.getContext('2d');
                if (!context) throw new Error('Canvas 2D context unavailable');
                context.scale(scale, scale);
                return new Promise(function (resolve, reject) {
                    var settled = false;
                    var timer = setTimeout(function () { if (!settled) { settled = true; reject(new Error('capture timed out')); } }, timeoutMs);
                    var image = new win.Image();
                    image.onload = function () {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        try { context.drawImage(image, 0, 0, handle.width, handle.height); resolve(); }
                        catch (error) { reject(error); }
                    };
                    image.onerror = function () {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        reject(new Error('SVG foreignObject could not be decoded'));
                    };
                    image.src = svgDataUrl;
                });
            }).then(function () {
                var dataUrl = canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.9 : undefined);
                if (!/^data:image\//.test(dataUrl) || dataUrl.length < 100) throw new Error('Canvas returned an empty image');
                return canvasBlob(canvas, mimeType).then(function (blob) {
                    return { ok: true, dataUrl: dataUrl, blob: blob, width: canvas.width, height: canvas.height, mimeType: mimeType };
                });
            });
        });
        return finishCapture(promise, win, function () { return canvas; }, function () { return ''; });
    }

    function closeResult() {
        if (!resultViewer) return;
        if (resultViewer.parentNode) resultViewer.parentNode.removeChild(resultViewer);
        resultViewer = null;
    }

    function showResult(result, profile, doc) {
        closeResult();
        if (!result || !result.ok) return;
        var host = doc.createElement('div');
        host.id = 'tm-preview-poc-result';
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.78);display:grid;place-items:center;padding:20px;';
        var shadow = host.attachShadow({ mode: 'open' });
        var wrap = doc.createElement('div');
        wrap.style.cssText = 'font:14px/1.4 system-ui;color:#eee;max-height:96vh;display:grid;gap:10px;justify-items:center;';
        var label = doc.createElement('div');
        label.textContent = 'Theme Preview PoC · ' + (profile.sourceThemeName || 'current theme') + ' · ' + result.width + '×' + result.height;
        var image = doc.createElement('img');
        image.src = result.dataUrl;
        image.alt = 'Theme Visual Profile preview';
        image.style.cssText = 'display:block;max-width:min(390px,90vw);max-height:82vh;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.45);';
        var button = doc.createElement('button');
        button.type = 'button';
        button.textContent = '关闭 PoC 预览';
        button.style.cssText = 'appearance:none;border:1px solid #777;border-radius:8px;background:#222;color:#fff;padding:8px 14px;cursor:pointer;';
        button.addEventListener('click', closeResult, { once: true });
        wrap.appendChild(label);
        wrap.appendChild(image);
        wrap.appendChild(button);
        shadow.appendChild(wrap);
        doc.body.appendChild(host);
        resultViewer = host;
    }

    function run(options) {
        options = options || {};
        var win = options.window || global;
        var doc = options.document || win.document;
        var profile;
        var handle;
        return Promise.resolve().then(function () {
            profile = createProfile(Object.assign({}, options, { window: win, document: doc }));
            return normalizeProfileAssets(profile, Object.assign({}, options, { window: win, document: doc }));
        }).then(function (assets) {
            if (assets.failures.length) {
                return {
                    ok: false,
                    profile: profile,
                    profileBytes: new win.Blob([JSON.stringify(profile)]).size,
                    error: { code: 'asset-normalization-failed', message: 'One or more image assets could not be embedded', assets: assets.failures },
                };
            }
            handle = createStage(assets.profile, { document: doc });
            return settleStage(handle, { window: win, document: doc, timeoutMs: options.settleTimeoutMs })
                .then(function () { return captureStage(handle, { window: win, document: doc, scale: options.scale, timeoutMs: options.captureTimeoutMs }); })
                .then(function (capture) {
                    var output = Object.assign({}, capture, {
                        profile: profile,
                        profileJson: JSON.stringify(profile, null, 2),
                        profileBytes: new win.Blob([JSON.stringify(profile)]).size,
                        normalizedAssetCount: assets.normalizedCount,
                    });
                    if (output.ok && options.showResult !== false) showResult(output, profile, doc);
                    return output;
                });
        }).catch(function (error) {
            return { ok: false, profile: profile || null, error: { code: 'poc-failed', message: error.message || String(error) } };
        }).finally(function () {
            if (handle) handle.destroy();
        });
    }

    var api = {
        PROFILE_VERSION: PROFILE_VERSION,
        STAGE_WIDTH: STAGE_WIDTH,
        STAGE_HEIGHT: STAGE_HEIGHT,
        createProfile: createProfile,
        normalizeProfileAssets: normalizeProfileAssets,
        createStage: createStage,
        settleStage: settleStage,
        captureStage: captureStage,
        run: run,
        closeResult: closeResult,
        getDiagnostics: function () { return { activeStages: activeStages, resultViewerOpen: Boolean(resultViewer) }; },
    };

    ns.themePreviewEngine = api;
    global.ThemeMgrPreviewPoc = api;
})(window);
