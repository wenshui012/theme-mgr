(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    var PREVIEW_VIEW_VERSION = 2;

    function finiteNumber(value, fallback) {
        if (value === null || value === '' || typeof value === 'boolean') return fallback;
        var number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function clampNumber(value, minimum, maximum, fallback) {
        var number = finiteNumber(value, fallback);
        return Math.max(minimum, Math.min(maximum, number));
    }

    function cleanNumber(value) {
        return Number(Number(value).toFixed(3));
    }

    function getDefaultCrop(imgW, imgH) {
        var target = 4 / 3;
        var cropW = imgW;
        var cropH = Math.round(cropW / target);
        if (cropH > imgH) {
            cropH = imgH;
            cropW = Math.round(cropH * target);
        }
        return {
            x: Math.max(0, Math.round((imgW - cropW) / 2)),
            y: Math.max(0, Math.round((imgH - cropH) / 2)),
            width: cropW,
            height: cropH,
            naturalWidth: imgW,
            naturalHeight: imgH,
            zoom: 1,
            posX: 50,
            posY: 50,
        };
    }

    function normalizePreviewView(view) {
        view = view && typeof view === 'object' ? view : {};
        return {
            version: PREVIEW_VIEW_VERSION,
            mode: 'focus',
            zoom: cleanNumber(clampNumber(view.zoom, 1, 3, 1)),
            posX: cleanNumber(clampNumber(view.posX, 0, 100, 50)),
            posY: cleanNumber(clampNumber(view.posY, 0, 100, 50)),
        };
    }

    function isResponsivePreviewView(view) {
        return Boolean(
            view &&
            typeof view === 'object' &&
            Number(view.version) === PREVIEW_VIEW_VERSION &&
            view.mode === 'focus'
        );
    }

    function getLegacyFocus(crop, horizontal) {
        var positionKey = horizontal ? 'posX' : 'posY';
        var explicit = finiteNumber(crop[positionKey], NaN);
        if (Number.isFinite(explicit)) return clampNumber(explicit, 0, 100, 50);

        var start = finiteNumber(crop[horizontal ? 'x' : 'y'], NaN);
        var size = finiteNumber(crop[horizontal ? 'width' : 'height'], NaN);
        var natural = finiteNumber(crop[horizontal ? 'naturalWidth' : 'naturalHeight'], NaN);
        if (Number.isFinite(start) && Number.isFinite(size) && size > 0 && Number.isFinite(natural) && natural > 0) {
            var movable = natural - size;
            if (movable > 0) return clampNumber(start / movable * 100, 0, 100, 50);
        }
        return 50;
    }

    function getLegacyZoom(crop) {
        var explicit = finiteNumber(crop.zoom, NaN);
        if (Number.isFinite(explicit)) return clampNumber(explicit, 1, 3, 1);

        var naturalWidth = finiteNumber(crop.naturalWidth, NaN);
        var naturalHeight = finiteNumber(crop.naturalHeight, NaN);
        var cropWidth = finiteNumber(crop.width, NaN);
        var cropHeight = finiteNumber(crop.height, NaN);
        if (naturalWidth > 0 && naturalHeight > 0 && cropWidth > 0 && cropHeight > 0) {
            var base = getDefaultCrop(naturalWidth, naturalHeight);
            return clampNumber(Math.max(base.width / cropWidth, base.height / cropHeight), 1, 3, 1);
        }
        return 1;
    }

    function resolvePreviewView(view) {
        if (isResponsivePreviewView(view)) return normalizePreviewView(view);
        if (!view || typeof view !== 'object') return normalizePreviewView(null);
        return normalizePreviewView({
            zoom: getLegacyZoom(view),
            posX: getLegacyFocus(view, true),
            posY: getLegacyFocus(view, false),
        });
    }

    function normalizePreviewImageQuality(value) {
        return value === 'quality' ? 'quality' : 'performance';
    }

    function imageField(meta, key) {
        return typeof meta[key] === 'string' && meta[key] ? meta[key] : '';
    }

    function resolvePreviewPresentation(meta) {
        meta = meta && typeof meta === 'object' ? meta : {};
        var imageData = imageField(meta, 'imageData');
        var hasFallback = Boolean(imageField(meta, 'thumbData') || imageField(meta, 'previewData'));
        var isResponsive = isResponsivePreviewView(meta.crop);
        return {
            hasImage: Boolean(imageData || hasFallback),
            view: imageData
                ? resolvePreviewView(meta.crop)
                : (isResponsive ? normalizePreviewView(meta.crop) : normalizePreviewView(null)),
            responsive: imageData ? true : isResponsive,
        };
    }

    function resolvePreviewAsset(meta, quality) {
        meta = meta && typeof meta === 'object' ? meta : {};
        quality = normalizePreviewImageQuality(quality);
        var imageData = imageField(meta, 'imageData');
        var thumbData = imageField(meta, 'thumbData');
        var previewData = imageField(meta, 'previewData');
        var presentation = resolvePreviewPresentation(meta);
        var isResponsive = isResponsivePreviewView(meta.crop);
        if (imageData) {
            return {
                src: quality === 'quality' ? imageData : (isResponsive && thumbData ? thumbData : imageData),
                view: presentation.view,
                responsive: presentation.responsive,
            };
        }
        return {
            src: thumbData || previewData,
            view: presentation.view,
            responsive: presentation.responsive,
        };
    }

    function hasPreviewImage(meta) {
        return Boolean(
            meta &&
            typeof meta === 'object' &&
            ((typeof meta.imageData === 'string' && meta.imageData) ||
                (typeof meta.thumbData === 'string' && meta.thumbData) ||
                (typeof meta.previewData === 'string' && meta.previewData))
        );
    }

    function mergeMissingPreview(target, incoming) {
        if (!target || typeof target !== 'object' || hasPreviewImage(target) || !hasPreviewImage(incoming)) return false;
        target.imageData = typeof incoming.imageData === 'string' && incoming.imageData ? incoming.imageData : null;
        target.thumbData = typeof incoming.thumbData === 'string' && incoming.thumbData ? incoming.thumbData : null;
        if (typeof incoming.previewData === 'string' && incoming.previewData) target.previewData = incoming.previewData;
        target.crop = incoming.crop && typeof incoming.crop === 'object'
            ? Object.assign({}, incoming.crop)
            : null;
        return true;
    }

    ns.imageTools = {
        PREVIEW_VIEW_VERSION: PREVIEW_VIEW_VERSION,
        normalizePreviewView: normalizePreviewView,
        isResponsivePreviewView: isResponsivePreviewView,
        resolvePreviewView: resolvePreviewView,
        resolvePreviewPresentation: resolvePreviewPresentation,
        resolvePreviewAsset: resolvePreviewAsset,
        normalizePreviewImageQuality: normalizePreviewImageQuality,
        hasPreviewImage: hasPreviewImage,
        mergeMissingPreview: mergeMissingPreview,

        compressImage: function (dataUrl, cb, opts) {
            var maxWidth = opts && opts.maxWidth ? opts.maxWidth : 1200;
            var quality = opts && opts.quality ? opts.quality : 0.8;
            var img = new Image();
            img.onload = function () {
                var w = img.width, h = img.height, canvas = document.createElement('canvas');
                if (w > maxWidth) { canvas.width = maxWidth; canvas.height = Math.round(h * maxWidth / w); }
                else { canvas.width = w; canvas.height = h; }
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                cb(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = function () { cb(dataUrl); };
            img.src = dataUrl;
        },

        getDefaultCrop: getDefaultCrop,

        makeResponsiveThumb: function (dataUrl, cb, opts) {
            var quality = opts && opts.quality ? opts.quality : 0.8;
            var maxDimension = opts && opts.maxDimension ? opts.maxDimension : 800;
            var img = new Image();
            img.onload = function () {
                var longest = Math.max(img.width, img.height);
                var scale = longest > maxDimension ? maxDimension / longest : 1;
                var canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                try {
                    cb(canvas.toDataURL('image/jpeg', quality));
                } catch (e) {
                    cb(dataUrl);
                }
            };
            img.onerror = function () { cb(dataUrl); };
            img.src = dataUrl;
        },

        makeThumbFromCrop: function (dataUrl, crop, cb, opts) {
            var quality = opts && opts.quality ? opts.quality : 0.8;
            var getDefaultCrop = ns.imageTools.getDefaultCrop;
            var img = new Image();
            img.onload = function () {
                var c = crop || getDefaultCrop(img.width, img.height);
                var canvas = document.createElement('canvas');
                canvas.width = 800;
                canvas.height = 600;
                var ctx = canvas.getContext('2d');
                var sx = Math.max(0, c.x || 0);
                var sy = Math.max(0, c.y || 0);
                var ex = Math.min(img.width, (c.x || 0) + (c.width || img.width));
                var ey = Math.min(img.height, (c.y || 0) + (c.height || img.height));
                var sw = Math.max(1, ex - sx);
                var sh = Math.max(1, ey - sy);
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                cb(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = function () { cb(dataUrl); };
            img.src = dataUrl;
        },
    };
})(window);
