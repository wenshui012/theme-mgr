(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function parseChannel(value) {
        var text = String(value || '').trim();
        if (!text) return NaN;
        if (/%$/.test(text)) return clamp(parseFloat(text) * 2.55, 0, 255);
        return clamp(parseFloat(text), 0, 255);
    }

    function parseAlpha(value) {
        var text = String(value == null ? '1' : value).trim();
        if (/%$/.test(text)) return clamp(parseFloat(text) / 100, 0, 1);
        return clamp(parseFloat(text), 0, 1);
    }

    function parseCssColor(value) {
        var text = String(value || '').trim().toLowerCase();
        if (!text) return null;
        if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

        var hex = text.match(/^#([0-9a-f]{3,8})$/i);
        if (hex) {
            var raw = hex[1];
            if (raw.length === 3 || raw.length === 4) {
                raw = raw.split('').map(function (part) { return part + part; }).join('');
            }
            if (raw.length !== 6 && raw.length !== 8) return null;
            return {
                r: parseInt(raw.slice(0, 2), 16),
                g: parseInt(raw.slice(2, 4), 16),
                b: parseInt(raw.slice(4, 6), 16),
                a: raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1,
            };
        }

        var rgb = text.match(/^rgba?\((.*)\)$/i);
        if (rgb) {
            var body = rgb[1].trim();
            var parts = body.indexOf(',') !== -1
                ? body.split(',').map(function (part) { return part.trim(); })
                : body.replace(/\s*\/\s*/, ' ').split(/\s+/);
            if (parts.length < 3) return null;
            var parsed = {
                r: parseChannel(parts[0]),
                g: parseChannel(parts[1]),
                b: parseChannel(parts[2]),
                a: parseAlpha(parts.length > 3 ? parts[3] : 1),
            };
            if ([parsed.r, parsed.g, parsed.b, parsed.a].some(function (part) { return !Number.isFinite(part); })) return null;
            return parsed;
        }

        var srgb = text.match(/^color\(srgb\s+([^)]+)\)$/i);
        if (srgb) {
            var srgbParts = srgb[1].replace(/\s*\/\s*/, ' ').trim().split(/\s+/);
            if (srgbParts.length < 3) return null;
            var srgbColor = {
                r: clamp(parseFloat(srgbParts[0]) * 255, 0, 255),
                g: clamp(parseFloat(srgbParts[1]) * 255, 0, 255),
                b: clamp(parseFloat(srgbParts[2]) * 255, 0, 255),
                a: parseAlpha(srgbParts.length > 3 ? srgbParts[3] : 1),
            };
            if ([srgbColor.r, srgbColor.g, srgbColor.b, srgbColor.a].some(function (part) { return !Number.isFinite(part); })) return null;
            return srgbColor;
        }

        return null;
    }

    function mix(first, second, amount) {
        var ratio = clamp(Number(amount) || 0, 0, 1);
        return {
            r: first.r + (second.r - first.r) * ratio,
            g: first.g + (second.g - first.g) * ratio,
            b: first.b + (second.b - first.b) * ratio,
            a: first.a + (second.a - first.a) * ratio,
        };
    }

    function composite(foreground, background) {
        var alpha = clamp(foreground.a, 0, 1);
        return {
            r: foreground.r * alpha + background.r * (1 - alpha),
            g: foreground.g * alpha + background.g * (1 - alpha),
            b: foreground.b * alpha + background.b * (1 - alpha),
            a: 1,
        };
    }

    function luminance(color) {
        function channel(value) {
            var normalized = clamp(value, 0, 255) / 255;
            return normalized <= 0.03928
                ? normalized / 12.92
                : Math.pow((normalized + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    }

    function contrastRatio(first, second) {
        var light = Math.max(luminance(first), luminance(second));
        var dark = Math.min(luminance(first), luminance(second));
        return (light + 0.05) / (dark + 0.05);
    }

    function chooseReadable(candidate, background, minimum) {
        var rendered = composite(candidate, background);
        if (contrastRatio(rendered, background) >= minimum) return rendered;
        var black = { r: 18, g: 18, b: 20, a: 1 };
        var white = { r: 250, g: 250, b: 252, a: 1 };
        return contrastRatio(black, background) >= contrastRatio(white, background) ? black : white;
    }

    function protectAccent(candidate, background, isDark) {
        var accent = composite(candidate, background);
        if (contrastRatio(accent, background) >= 3) return accent;
        var target = isDark
            ? { r: 255, g: 255, b: 255, a: 1 }
            : { r: 0, g: 0, b: 0, a: 1 };
        for (var amount = 0.08; amount <= 0.8; amount += 0.08) {
            var adjusted = mix(accent, target, amount);
            if (contrastRatio(adjusted, background) >= 3) return adjusted;
        }
        return target;
    }

    function toCss(color, alpha) {
        var finalAlpha = alpha === undefined ? color.a : alpha;
        return 'rgba(' +
            Math.round(clamp(color.r, 0, 255)) + ', ' +
            Math.round(clamp(color.g, 0, 255)) + ', ' +
            Math.round(clamp(color.b, 0, 255)) + ', ' +
            Math.round(clamp(finalAlpha, 0, 1) * 1000) / 1000 + ')';
    }

    function createPalette(input) {
        input = input || {};
        var rawText = parseCssColor(input.text) || { r: 238, g: 238, b: 240, a: 1 };
        var rawBackground = parseCssColor(input.background);
        var rawChat = parseCssColor(input.chat);
        var rawAccent = parseCssColor(input.accent) || { r: 124, g: 109, b: 175, a: 1 };
        var rawBorder = parseCssColor(input.border);
        var rawShadow = parseCssColor(input.shadow);

        var textLooksLight = luminance(rawText) > 0.55;
        var neutral = textLooksLight
            ? { r: 22, g: 22, b: 27, a: 1 }
            : { r: 247, g: 247, b: 249, a: 1 };
        var backgroundSource = rawBackground && rawBackground.a > 0.03
            ? rawBackground
            : (rawChat && rawChat.a > 0.03 ? rawChat : null);
        var background = backgroundSource ? composite(backgroundSource, neutral) : neutral;
        var isDark = luminance(background) < 0.42;
        var text = chooseReadable(rawText, background, 4.5);
        var accent = protectAccent(rawAccent, background, isDark);
        var accentText = chooseReadable({ r: 255, g: 255, b: 255, a: 1 }, accent, 4.5);
        var surfaceTarget = isDark
            ? { r: 255, g: 255, b: 255, a: 1 }
            : { r: 0, g: 0, b: 0, a: 1 };
        var surface = mix(background, surfaceTarget, isDark ? 0.08 : 0.045);
        var surfaceStrong = mix(background, surfaceTarget, isDark ? 0.15 : 0.09);
        var card = mix(surface, accent, 0.035);
        var border = rawBorder && rawBorder.a > 0.08
            ? rawBorder
            : { r: text.r, g: text.g, b: text.b, a: 0.16 };
        var shadow = rawShadow && rawShadow.a > 0.05
            ? rawShadow
            : { r: 0, g: 0, b: 0, a: isDark ? 0.36 : 0.2 };

        return {
            mode: isDark ? 'dark' : 'light',
            background: toCss(background),
            surface: toCss(surface),
            surfaceStrong: toCss(surfaceStrong),
            card: toCss(card, isDark ? 0.9 : 0.94),
            text: toCss(text),
            accent: toCss(accent),
            accentText: toCss(accentText),
            border: toCss(border),
            control: toCss(text, 0.075),
            controlHover: toCss(text, 0.14),
            muted: toCss(text, 0.62),
            shadow: toCss(shadow),
        };
    }

    ns.themeAppearance = {
        parseCssColor: parseCssColor,
        contrastRatio: contrastRatio,
        createPalette: createPalette,
    };
})(window);
