(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var MAIN_MAX = 2048;
    var THUMB_MAX = 384;
    var JPEG_QUALITY = 0.92;
    var THUMB_QUALITY = 0.84;
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
        fit: fit,
        fileBaseName: fileBaseName,
        outputMime: outputMime,
        avatarImageError: avatarImageError,
    };
})(window);
