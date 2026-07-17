(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    var LAZY_THEME_MARKER = '__baibaokuLazyTheme';
    var THEME_FIELDS = [
        'blur_strength', 'main_text_color', 'italics_text_color', 'underline_text_color',
        'quote_text_color', 'blur_tint_color', 'chat_tint_color', 'user_mes_blur_tint_color',
        'bot_mes_blur_tint_color', 'shadow_color', 'shadow_width', 'border_color',
        'font_scale', 'fast_ui_mode', 'waifuMode', 'avatar_style', 'chat_display',
        'toastr_position', 'noShadows', 'chat_width', 'timer_enabled', 'timestamps_enabled',
        'timestamp_model_icon', 'mesIDDisplay_enabled', 'hideChatAvatars_enabled',
        'message_token_count_enabled', 'expand_message_actions', 'enableZenSliders',
        'enableLabMode', 'hotswap_enabled', 'bogus_folders', 'zoomed_avatar_magnification',
        'custom_css', 'reduced_motion', 'compact_input_area', 'show_swipe_num_all_messages',
        'click_to_edit', 'media_display'
    ];
    function isPlainObject(value) {
        if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
        var proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
    }

    function hasLazyMarker(theme) {
        return isPlainObject(theme) && Object.prototype.hasOwnProperty.call(theme, LAZY_THEME_MARKER);
    }

    function hasRealConfigField(theme) {
        if (!isPlainObject(theme)) return false;
        return THEME_FIELDS.some(function (key) {
            return Object.prototype.hasOwnProperty.call(theme, key) && theme[key] !== undefined;
        });
    }

    function getMissingThemeFields(theme) {
        if (!isPlainObject(theme)) return THEME_FIELDS.slice();
        return THEME_FIELDS.filter(function (key) {
            return !Object.prototype.hasOwnProperty.call(theme, key) || theme[key] === undefined;
        });
    }

    function hasValidName(theme, expectedName) {
        if (!isPlainObject(theme) || typeof theme.name !== 'string' || !theme.name.trim()) return false;
        return !expectedName || theme.name === expectedName;
    }

    function isLazyThemePlaceholder(theme, expectedName) {
        if (!hasValidName(theme, expectedName)) return false;
        return hasLazyMarker(theme) || !hasRealConfigField(theme);
    }

    function isUsableTheme(theme, expectedName) {
        return hasValidName(theme, expectedName) && !hasLazyMarker(theme) && hasRealConfigField(theme);
    }

    function isLegacyPartialTheme(theme, expectedName) {
        return isUsableTheme(theme, expectedName) && getMissingThemeFields(theme).length > 0;
    }

    function isCompleteTheme(theme, expectedName) {
        return isUsableTheme(theme, expectedName) && getMissingThemeFields(theme).length === 0;
    }

    function cloneValue(value) {
        if (value === undefined) return undefined;
        if (value === null || typeof value !== 'object') return value;
        try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
    }

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function removeLazyMarker(theme) {
        if (isPlainObject(theme)) delete theme[LAZY_THEME_MARKER];
        return theme;
    }

    function snapshotThemeBaseline(powerUser) {
        var baseline = {};
        THEME_FIELDS.forEach(function (key) {
            if (powerUser && Object.prototype.hasOwnProperty.call(powerUser, key) && powerUser[key] !== undefined) {
                baseline[key] = cloneValue(powerUser[key]);
            }
        });
        return baseline;
    }

    // Mirrors SillyTavern getNewTheme(): start from one stable current-theme
    // snapshot, then overwrite only fields recognized by the native theme shape.
    function normalizeImportedThemeLikeSillyTavern(theme, baseline) {
        if (!isUsableTheme(theme, theme && theme.name)) return null;
        var normalized = snapshotThemeBaseline(baseline);
        normalized.name = String(theme.name).trim();
        Object.keys(theme).forEach(function (key) {
            if (key !== LAZY_THEME_MARKER && Object.prototype.hasOwnProperty.call(normalized, key)) {
                normalized[key] = cloneValue(theme[key]);
            }
        });
        return normalized;
    }

    function truncateUtf8Bytes(value, maxBytes) {
        var chars = Array.from(String(value || ''));
        var out = '';
        var bytes = 0;
        var encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
        for (var i = 0; i < chars.length; i++) {
            var charBytes = encoder
                ? encoder.encode(chars[i]).length
                : unescape(encodeURIComponent(chars[i])).length;
            if (bytes + charBytes > maxBytes) break;
            out += chars[i];
            bytes += charBytes;
        }
        return out;
    }

    // Mirrors sanitize-filename as used by SillyTavern's theme endpoints.
    function sanitizeFilename(themeName) {
        var filename = String(themeName || '') + '.json';
        filename = filename
            .replace(/[\/\?<>\\:\*\|"]/g, '')
            .replace(/[\x00-\x1f\x80-\x9f]/g, '')
            .replace(/^\.+$/, '')
            .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, '')
            .replace(/[\. ]+$/, '');
        return truncateUtf8Bytes(filename, 255);
    }

    function canonicalize(value, options, key) {
        if (options && options.excludeName && key === 'name') return undefined;
        if (options && options.excludeLazyMarker && key === LAZY_THEME_MARKER) return undefined;
        if (Array.isArray(value)) {
            return value.map(function (item) { return canonicalize(item, options, ''); });
        }
        if (isPlainObject(value)) {
            var out = {};
            Object.keys(value).sort().forEach(function (childKey) {
                var child = canonicalize(value[childKey], options, childKey);
                if (child !== undefined) out[childKey] = child;
            });
            return out;
        }
        return value;
    }

    function fingerprint(theme, options) {
        var text = JSON.stringify(canonicalize(theme, options || {}, ''));
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return ('00000000' + (hash >>> 0).toString(16)).slice(-8) + ':' + text.length;
    }

    function sameConfig(expected, actual) {
        if (!isUsableTheme(actual, expected && expected.name)) return false;
        var keys = Object.keys(expected).filter(function (key) {
            return key !== 'name' && key !== LAZY_THEME_MARKER && expected[key] !== undefined;
        });
        if (keys.length === 0) return false;
        return keys.every(function (key) {
            return Object.prototype.hasOwnProperty.call(actual, key) &&
                JSON.stringify(actual[key]) === JSON.stringify(expected[key]);
        });
    }

    ns.themeSchema = {
        LAZY_THEME_MARKER: LAZY_THEME_MARKER,
        THEME_FIELDS: THEME_FIELDS.slice(),
        isPlainObject: isPlainObject,
        hasLazyMarker: hasLazyMarker,
        hasRealConfigField: hasRealConfigField,
        getMissingThemeFields: getMissingThemeFields,
        isLazyThemePlaceholder: isLazyThemePlaceholder,
        isLegacyPartialTheme: isLegacyPartialTheme,
        isUsableTheme: isUsableTheme,
        isCompleteTheme: isCompleteTheme,
        cloneValue: cloneValue,
        cloneJson: cloneJson,
        removeLazyMarker: removeLazyMarker,
        snapshotThemeBaseline: snapshotThemeBaseline,
        normalizeImportedThemeLikeSillyTavern: normalizeImportedThemeLikeSillyTavern,
        sanitizeFilename: sanitizeFilename,
        fingerprint: fingerprint,
        sameConfig: sameConfig,
    };
})(window);
