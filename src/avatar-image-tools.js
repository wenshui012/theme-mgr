(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var MAIN_MAX = 2048;
    var THUMB_MAX = 384;
    var JPEG_QUALITY = 0.92;
    var THUMB_QUALITY = 0.84;
    var TAURI_USER_WIDTH = 800;
    var TAURI_USER_HEIGHT = 1200;
    var TRANSFORM_EDGE_MARGIN = 1;
    var ALLOWED = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };

    function avatarImageError(code, message, cause) {
        var error = new Error(message);
        error.name = 'AvatarImageError';
        error.code = code;
        if (cause) error.cause = cause;
        return error;
    }

    function fit(width, height, maximum) {
        width = Math.max(1, Math.round(Number(width) || 0));
        height = Math.max(1, Math.round(Number(height) || 0));
        var ratio = Math.min(1, maximum / Math.max(width, height));
        return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
    }

    function fileBaseName(name) {
        var value = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
        return value || '未命名头像';
    }

    function idForFile(file) {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
        return 'avatar-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function outputMime(inputMime, hasAlpha) {
        if (inputMime === 'image/webp') return 'image/webp';
        if (hasAlpha || inputMime === 'image/png') return 'image/png';
        return 'image/jpeg';
    }

    function browserEncode(decoded, size, mimeType, quality) {
        var canvas = global.document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        var context = canvas.getContext('2d', { alpha: mimeType !== 'image/jpeg' });
        if (!context) return Promise.reject(new Error('无法创建图片处理画布'));
        context.drawImage(decoded.source, 0, 0, size.width, size.height);
        try { return Promise.resolve(canvas.toDataURL(mimeType, quality)); }
        catch (error) { return Promise.reject(error); }
        finally { canvas.width = 1; canvas.height = 1; }
    }

    function finite(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function round(value, precision) {
        var factor = Math.pow(10, precision == null ? 5 : precision);
        return Math.round(Number(value) * factor) / factor;
    }

    function normalizeTauriUserView(view) {
        view = view && typeof view === 'object' ? view : {};
        return {
            x: round(finite(view.x, 0)),
            y: round(finite(view.y, 0)),
            scale: round(Math.max(0.5, Math.min(3, finite(view.scale, 1))), 3),
            rotate: round(Math.max(-180, Math.min(180, finite(view.rotate, 0))), 2),
            flipX: view.flipX === true,
            flipY: view.flipY === true,
        };
    }

    function tauriUserBakeGeometry(width, height, view) {
        width = Math.max(1, finite(width, 1));
        height = Math.max(1, finite(height, 1));
        view = normalizeTauriUserView(view);
        var radians = view.rotate * Math.PI / 180;
        var cosine = Math.abs(Math.cos(radians));
        var sine = Math.abs(Math.sin(radians));
        if (cosine < 1e-12) cosine = 0;
        if (sine < 1e-12) sine = 0;
        var rotatedWidth = width * cosine + height * sine;
        var rotatedHeight = width * sine + height * cosine;
        var canvasWidth = Math.ceil(Math.max(width, rotatedWidth) + TRANSFORM_EDGE_MARGIN * 2);
        var canvasHeight = Math.ceil(Math.max(height, rotatedHeight) + TRANSFORM_EDGE_MARGIN * 2);
        var logicalLeft = (canvasWidth - width) / 2;
        var logicalTop = (canvasHeight - height) / 2;
        var visibleWidth = width / view.scale;
        var visibleHeight = height / view.scale;
        var crop = {
            left: logicalLeft + (width - visibleWidth) / 2 - view.x * visibleWidth,
            top: logicalTop + (height - visibleHeight) / 2 - view.y * visibleHeight,
            width: visibleWidth,
            height: visibleHeight,
        };
        var targetRatio = TAURI_USER_WIDTH / TAURI_USER_HEIGHT;
        var outputCrop = Object.assign({}, crop);
        if (crop.width / crop.height > targetRatio) {
            outputCrop.width = crop.height * targetRatio;
            outputCrop.left = crop.left + (crop.width - outputCrop.width) / 2;
        } else {
            outputCrop.height = crop.width / targetRatio;
            outputCrop.top = crop.top + (crop.height - outputCrop.height) / 2;
        }
        return {
            targetWidth: TAURI_USER_WIDTH,
            targetHeight: TAURI_USER_HEIGHT,
            sourceWidth: width,
            sourceHeight: height,
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight,
            centerX: canvasWidth / 2,
            centerY: canvasHeight / 2,
            crop: outputCrop,
            view: view,
        };
    }

    function decodeAvatarAsset(asset) {
        var sharedImageTools = ns.imageTools;
        if (!global.fetch || !sharedImageTools || typeof sharedImageTools.decodeImageFile !== 'function') {
            return Promise.reject(avatarImageError('AVATAR_IMAGE_TOOLS_UNAVAILABLE', '图片处理组件不可用'));
        }
        var match = String(asset && asset.imageData || '').match(/^data:(image\/(?:jpeg|png|webp));base64,/i);
        if (!match) return Promise.reject(avatarImageError('AVATAR_READ_FAILED', '头像母图数据无效'));
        return global.fetch(asset.imageData).then(function (response) {
            if (!response || !response.ok || typeof response.blob !== 'function') throw new Error('avatar data decode failed');
            return response.blob();
        }).then(function (blob) {
            return sharedImageTools.decodeImageFile(blob, match[1].toLowerCase());
        });
    }

    function encodeTauriUserCanvas(decoded, geometry) {
        var canvas = global.document.createElement('canvas');
        canvas.width = geometry.targetWidth;
        canvas.height = geometry.targetHeight;
        var context = canvas.getContext('2d', { alpha: true });
        if (!context) return Promise.reject(new Error('无法创建头像兼容画布'));
        var crop = geometry.crop;
        var scaleX = geometry.targetWidth / crop.width;
        var scaleY = geometry.targetHeight / crop.height;
        try {
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.setTransform(scaleX, 0, 0, scaleY, -crop.left * scaleX, -crop.top * scaleY);
            context.translate(geometry.centerX, geometry.centerY);
            context.rotate(geometry.view.rotate * Math.PI / 180);
            context.scale(geometry.view.flipX ? -1 : 1, geometry.view.flipY ? -1 : 1);
            context.drawImage(decoded.source, -geometry.sourceWidth / 2, -geometry.sourceHeight / 2, geometry.sourceWidth, geometry.sourceHeight);
            return Promise.resolve(canvas.toDataURL('image/png'));
        } catch (error) {
            return Promise.reject(error);
        } finally {
            canvas.width = 1;
            canvas.height = 1;
        }
    }

    function prepareTauriUserUpload(asset, view, options) {
        options = options || {};
        var decodeAsset = options.decodeAsset || decodeAvatarAsset;
        var encode = options.encode || encodeTauriUserCanvas;
        var decoded;
        return Promise.resolve().then(function () {
            return decodeAsset(asset);
        }).then(function (value) {
            decoded = value;
            if (!decoded || !(decoded.width > 0) || !(decoded.height > 0)) throw new Error('头像母图解码失败');
            var geometry = tauriUserBakeGeometry(decoded.width, decoded.height, view);
            return Promise.resolve(encode(decoded, geometry)).then(function (imageData) {
                if (!/^data:image\/png;base64,/i.test(String(imageData || ''))) throw new Error('头像兼容图片生成失败');
                return Object.assign({}, asset, {
                    imageData: imageData,
                    mimeType: 'image/png',
                    width: TAURI_USER_WIDTH,
                    height: TAURI_USER_HEIGHT,
                });
            });
        }).catch(function (error) {
            if (error && error.code) throw error;
            throw avatarImageError('TAURI_USER_AVATAR_BAKE_FAILED', 'TT User 头像兼容处理失败', error);
        }).finally(function () {
            if (decoded && typeof decoded.close === 'function') decoded.close();
        });
    }

    ns.createAvatarImageProcessor = function (options) {
        options = options || {};
        var sharedImageTools = options.imageTools || ns.imageTools;
        var decode = options.decode || sharedImageTools && sharedImageTools.decodeImageFile;
        var inferMime = options.inferMime || sharedImageTools && sharedImageTools.inferImageMime;
        var encode = options.encode || browserEncode;
        var makeId = options.makeId || idForFile;
        var now = options.now || function () { return new Date().toISOString(); };

        function processFile(file) {
            if (typeof decode !== 'function' || typeof inferMime !== 'function') {
                return Promise.reject(avatarImageError('AVATAR_IMAGE_TOOLS_UNAVAILABLE', '图片处理组件不可用'));
            }
            var mimeType = inferMime(file);
            if (!file) return Promise.reject(avatarImageError('AVATAR_READ_FAILED', '图片读取失败'));
            if (!ALLOWED[mimeType]) return Promise.reject(avatarImageError('AVATAR_FORMAT_UNSUPPORTED', '图片格式暂不支持'));
            var decodedPromise;
            try { decodedPromise = decode(file, mimeType); }
            catch (error) { decodedPromise = Promise.reject(error); }
            return Promise.resolve(decodedPromise).catch(function (error) {
                if (error && error.code) throw error;
                throw avatarImageError('AVATAR_DECODE_FAILED', '图片解码失败', error);
            }).then(function (decoded) {
                if (!decoded || !(decoded.width > 0) || !(decoded.height > 0)) throw Object.assign(new Error('图片解码失败'), { code: 'AVATAR_DECODE_FAILED' });
                var mainSize = fit(decoded.width, decoded.height, MAIN_MAX);
                var thumbSize = fit(decoded.width, decoded.height, THUMB_MAX);
                var mime = outputMime(mimeType, decoded.hasAlpha === true);
                return Promise.all([
                    encode(decoded, mainSize, mime, mime === 'image/jpeg' ? JPEG_QUALITY : undefined),
                    encode(decoded, thumbSize, mime, mime === 'image/jpeg' || mime === 'image/webp' ? THUMB_QUALITY : undefined),
                ]).then(function (images) {
                    var timestamp = now();
                    return {
                        version: 1,
                        id: makeId(file),
                        name: fileBaseName(file.name),
                        imageData: images[0],
                        thumbData: images[1],
                        mimeType: mime,
                        width: mainSize.width,
                        height: mainSize.height,
                        sourceWidth: decoded.width,
                        sourceHeight: decoded.height,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                    };
                }).finally(function () { if (typeof decoded.close === 'function') decoded.close(); });
            }).catch(function (error) {
                if (!error.code) error.code = 'AVATAR_PROCESS_FAILED';
                throw error;
            });
        }

        return { processFile: processFile };
    };

    ns.avatarImageTools = {
        MAIN_MAX: MAIN_MAX,
        THUMB_MAX: THUMB_MAX,
        JPEG_QUALITY: JPEG_QUALITY,
        THUMB_QUALITY: THUMB_QUALITY,
        TAURI_USER_WIDTH: TAURI_USER_WIDTH,
        TAURI_USER_HEIGHT: TAURI_USER_HEIGHT,
        fit: fit,
        fileBaseName: fileBaseName,
        outputMime: outputMime,
        avatarImageError: avatarImageError,
        normalizeTauriUserView: normalizeTauriUserView,
        tauriUserBakeGeometry: tauriUserBakeGeometry,
        prepareTauriUserUpload: prepareTauriUserUpload,
    };
})(window);
