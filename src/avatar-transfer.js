(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var BACKUP_FORMAT = 'theme-mgr-avatar-backup';
    var BACKUP_VERSION = 1;
    var IMAGE_EXPORT_FORMAT = 'theme-mgr-avatar-image-export-index';
    var IMAGE_EXPORT_VERSION = 1;
    var MiB = 1024 * 1024;
    var DEFAULT_LIMITS = {
        mobile: { payloadBytes: 48 * MiB, archiveBytes: 64 * MiB, fileBytes: 24 * MiB, files: 4096 },
        desktop: { payloadBytes: 256 * MiB, archiveBytes: 320 * MiB, fileBytes: 128 * MiB, files: 16384 },
    };
    var MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

    function clean(value) { return String(value == null ? '' : value).trim(); }
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
    function makeError(code, message, details) {
        var error = new Error(message);
        error.name = 'AvatarTransferError';
        error.code = code;
        if (details) error.details = details;
        return error;
    }
    function stableStringify(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
        return '{' + Object.keys(value).sort().map(function (key) {
            return JSON.stringify(key) + ':' + stableStringify(value[key]);
        }).join(',') + '}';
    }
    function utf8Encoder() {
        if (typeof global.TextEncoder !== 'function') throw makeError('AVATAR_EXPORT_UNSUPPORTED', '当前环境缺少 UTF-8 编码能力');
        return new global.TextEncoder();
    }
    function utf8Decoder() {
        if (typeof global.TextDecoder !== 'function') throw makeError('AVATAR_EXPORT_UNSUPPORTED', '当前环境缺少 UTF-8 解码能力');
        return new global.TextDecoder('utf-8', { fatal: true });
    }
    function utf8(value) { return utf8Encoder().encode(String(value)); }
    function decodeUtf8(bytes) {
        try { return utf8Decoder().decode(bytes); }
        catch (error) { throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 文本不是有效 UTF-8', { cause: clean(error && error.name) }); }
    }
    function bytesToHex(bytes) {
        return Array.prototype.map.call(new Uint8Array(bytes), function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    }
    function normalizeHash(value) { return clean(value).toLowerCase(); }
    function safeJsonParse(text, label) {
        try { return JSON.parse(text); }
        catch (error) { throw makeError('AVATAR_ARCHIVE_INVALID', (label || 'JSON') + ' 无法解析', { cause: clean(error && error.name) }); }
    }
    function isBase64Code(code) {
        return code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47;
    }
    function isDataWhitespace(code) {
        return code >= 9 && code <= 13 || code === 32 || code === 160 || code === 5760 || code >= 8192 && code <= 8202 ||
            code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
    }
    function dataUrlInfo(dataUrl) {
        var value = clean(dataUrl);
        var comma = value.indexOf(',');
        var header = comma > 0 ? /^data:(image\/(?:jpeg|png|webp));base64$/i.exec(value.slice(0, comma)) : null;
        if (!header) throw makeError('AVATAR_IMAGE_INVALID', '头像图片不是受支持的持久化 Data URL');
        var start = comma + 1;
        var encodedLength = 0;
        var padding = 0;
        var sawPadding = false;
        var chunks = null;
        var segmentStart = start;
        for (var i = start; i < value.length; i += 1) {
            var code = value.charCodeAt(i);
            if (isDataWhitespace(code)) {
                if (!chunks) chunks = [];
                if (i > segmentStart) chunks.push(value.slice(segmentStart, i));
                segmentStart = i + 1;
                continue;
            }
            encodedLength += 1;
            if (code === 61) {
                padding += 1;
                sawPadding = true;
                if (padding > 2) throw makeError('AVATAR_IMAGE_INVALID', '头像图片 Base64 无效');
            } else if (sawPadding || !isBase64Code(code)) {
                throw makeError('AVATAR_IMAGE_INVALID', '头像图片 Base64 无效');
            }
        }
        if (!encodedLength || encodedLength % 4 !== 0 || encodedLength < 4 ||
            padding === 1 && (encodedLength - padding) % 4 !== 3 || padding === 2 && (encodedLength - padding) % 4 !== 2) {
            throw makeError('AVATAR_IMAGE_INVALID', '头像图片 Base64 无效');
        }
        var base64;
        if (chunks) {
            if (segmentStart < value.length) chunks.push(value.slice(segmentStart));
            base64 = chunks.join('');
        } else {
            base64 = value.slice(start);
        }
        return { mime: header[1].toLowerCase(), base64: base64, bytes: encodedLength / 4 * 3 - padding };
    }
    function decodeDataUrl(dataUrl, expectedMime) {
        var info = dataUrlInfo(dataUrl);
        if (expectedMime && info.mime !== expectedMime) throw makeError('AVATAR_IMAGE_INVALID', '头像图片 MIME 与资产元数据不一致');
        if (typeof global.atob !== 'function') throw makeError('AVATAR_EXPORT_UNSUPPORTED', '当前环境缺少 Base64 解码能力');
        var binary;
        try { binary = global.atob(info.base64); }
        catch (error) { throw makeError('AVATAR_IMAGE_INVALID', '头像图片 Base64 无法解码', { cause: clean(error && error.name) }); }
        if (binary.length !== info.bytes) throw makeError('AVATAR_IMAGE_INVALID', '头像图片长度校验失败');
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        verifyImageMagic(bytes, info.mime);
        return { bytes: bytes, mime: info.mime };
    }
    function verifyImageMagic(bytes, mime) {
        var ok = false;
        if (mime === 'image/jpeg') ok = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        else if (mime === 'image/png') ok = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
        else if (mime === 'image/webp') ok = bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
        if (!ok) throw makeError('AVATAR_IMAGE_INVALID', '头像图片文件头与 MIME 不一致', { mime: mime });
    }
    function sanitizeFilename(value, fallback) {
        var result = clean(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 96);
        if (!result || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(result)) result = fallback || 'avatar';
        return result;
    }
    function safeZipPath(path) {
        path = clean(path).replace(/\\/g, '/');
        if (!path || path[0] === '/' || /^[A-Za-z]:/.test(path) || path.split('/').some(function (part) { return !part || part === '.' || part === '..'; })) {
            throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 包含不安全路径');
        }
        return path;
    }
    function uniqueTexts(values) {
        var seen = new Set();
        return (Array.isArray(values) ? values : []).map(clean).filter(function (value) {
            if (!value || seen.has(value)) return false;
            seen.add(value); return true;
        });
    }
    function metadataOnly(asset) {
        return {
            version: asset.version,
            id: asset.id,
            name: asset.name,
            mimeType: asset.mimeType,
            width: asset.width,
            height: asset.height,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
        };
    }
    function sortById(items) {
        return (items || []).map(clone).sort(function (a, b) { return clean(a && a.id).localeCompare(clean(b && b.id)); });
    }
    function sameStable(left, right) { return stableStringify(left) === stableStringify(right); }
    function limitText(bytes) { return (bytes / MiB).toFixed(bytes >= 10 * MiB ? 0 : 1) + ' MiB'; }
    function dosDateTime(date) {
        date = date instanceof Date ? date : new Date(date || Date.now());
        var year = Math.max(1980, Math.min(2107, date.getFullYear()));
        return {
            time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
            date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        };
    }
    function u16(view, offset, value) { view.setUint16(offset, value, true); }
    function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
    var CRC_TABLE = (function () {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n += 1) {
            var c = n;
            for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();
    function crc32(bytes) {
        var crc = 0xffffffff;
        for (var i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }
    function estimateZipSize(entries) {
        return (entries || []).reduce(function (total, entry) {
            var nameLength = utf8(safeZipPath(entry.path)).length;
            return total + 30 + nameLength + entry.data.length + 46 + nameLength;
        }, 22);
    }
    function buildStoredZip(entries, createdAt, BlobCtor) {
        entries = (entries || []).map(function (entry) {
            var path = safeZipPath(entry.path);
            var name = utf8(path);
            var data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || []);
            return { path: path, name: name, data: data, crc: crc32(data) };
        });
        if (!entries.length || entries.length > 65535) throw makeError('AVATAR_ARCHIVE_LIMIT', 'ZIP 文件数量超出安全上限');
        var totalSize = estimateZipSize(entries);
        if (totalSize >= 0xffffffff) throw makeError('AVATAR_ARCHIVE_LIMIT', 'ZIP 大小超出当前格式上限');
        var stamp = dosDateTime(new Date(createdAt));
        var parts = [];
        var central = [];
        var offset = 0;
        entries.forEach(function (entry) {
            var local = new Uint8Array(30);
            var lv = new DataView(local.buffer);
            u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0);
            u16(lv, 10, stamp.time); u16(lv, 12, stamp.date); u32(lv, 14, entry.crc);
            u32(lv, 18, entry.data.length); u32(lv, 22, entry.data.length); u16(lv, 26, entry.name.length); u16(lv, 28, 0);
            parts.push(local, entry.name, entry.data);
            var header = new Uint8Array(46);
            var cv = new DataView(header.buffer);
            u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0);
            u16(cv, 12, stamp.time); u16(cv, 14, stamp.date); u32(cv, 16, entry.crc);
            u32(cv, 20, entry.data.length); u32(cv, 24, entry.data.length); u16(cv, 28, entry.name.length);
            u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset);
            central.push(header, entry.name);
            offset += local.length + entry.name.length + entry.data.length;
        });
        var centralOffset = offset;
        var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
        Array.prototype.push.apply(parts, central);
        var end = new Uint8Array(22);
        var ev = new DataView(end.buffer);
        u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0); u16(ev, 8, entries.length); u16(ev, 10, entries.length);
        u32(ev, 12, centralSize); u32(ev, 16, centralOffset); u16(ev, 20, 0);
        parts.push(end);
        var ResultBlob = BlobCtor || global.Blob;
        if (typeof ResultBlob !== 'function') throw makeError('AVATAR_EXPORT_UNSUPPORTED', '当前环境缺少 Blob 支持');
        return new ResultBlob(parts, { type: 'application/zip' });
    }
    function findSignature(bytes, signature) {
        for (var i = bytes.length - 4; i >= 0; i -= 1) {
            if (bytes[i] === (signature & 0xff) && bytes[i + 1] === ((signature >>> 8) & 0xff) &&
                bytes[i + 2] === ((signature >>> 16) & 0xff) && bytes[i + 3] === ((signature >>> 24) & 0xff)) return i;
        }
        return -1;
    }
    function openStoredZip(blob, limits) {
        limits = limits || DEFAULT_LIMITS.desktop;
        if (!blob || typeof blob.slice !== 'function' || !Number.isSafeInteger(blob.size) || blob.size < 22 || blob.size > limits.archiveBytes) {
            return Promise.reject(makeError('AVATAR_ARCHIVE_LIMIT', 'ZIP 大小无效或超出安全上限'));
        }
        var tailStart = Math.max(0, blob.size - 65557);
        return blob.slice(tailStart).arrayBuffer().then(function (buffer) {
            var tail = new Uint8Array(buffer);
            var eocdAt = findSignature(tail, 0x06054b50);
            if (eocdAt < 0 || eocdAt + 22 > tail.length) throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 结束记录缺失');
            var view = new DataView(tail.buffer, tail.byteOffset + eocdAt, tail.length - eocdAt);
            var count = view.getUint16(10, true);
            var centralSize = view.getUint32(12, true);
            var centralOffset = view.getUint32(16, true);
            var commentLength = view.getUint16(20, true);
            if (!count || count > limits.files || eocdAt + 22 + commentLength !== tail.length || centralOffset + centralSize !== tailStart + eocdAt) {
                throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 目录结构无效');
            }
            return blob.slice(centralOffset, centralOffset + centralSize).arrayBuffer().then(function (centralBuffer) {
                var bytes = new Uint8Array(centralBuffer);
                var directory = new Map();
                var cursor = 0;
                var payloadBytes = 0;
                for (var index = 0; index < count; index += 1) {
                    if (cursor + 46 > bytes.length) throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 中央目录被截断');
                    var cv = new DataView(bytes.buffer, bytes.byteOffset + cursor, bytes.length - cursor);
                    if (cv.getUint32(0, true) !== 0x02014b50 || cv.getUint16(10, true) !== 0 || cv.getUint16(8, true) !== 0x0800) {
                        throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 仅允许 UTF-8 未压缩文件');
                    }
                    var compressed = cv.getUint32(20, true);
                    var uncompressed = cv.getUint32(24, true);
                    var nameLength = cv.getUint16(28, true);
                    var extraLength = cv.getUint16(30, true);
                    var comment = cv.getUint16(32, true);
                    var recordLength = 46 + nameLength + extraLength + comment;
                    if (compressed !== uncompressed || uncompressed > limits.fileBytes || cursor + recordLength > bytes.length) {
                        throw makeError('AVATAR_ARCHIVE_LIMIT', 'ZIP 文件大小无效或超出安全上限');
                    }
                    payloadBytes += uncompressed;
                    if (payloadBytes > limits.payloadBytes) throw makeError('AVATAR_ARCHIVE_LIMIT', 'ZIP 内容超过当前设备安全上限');
                    var path = safeZipPath(decodeUtf8(bytes.subarray(cursor + 46, cursor + 46 + nameLength)));
                    if (directory.has(path)) throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 包含重复路径');
                    directory.set(path, {
                        path: path,
                        crc: cv.getUint32(16, true),
                        bytes: uncompressed,
                        offset: cv.getUint32(42, true),
                        nameLength: nameLength,
                    });
                    cursor += recordLength;
                }
                if (cursor !== bytes.length) throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 中央目录包含额外数据');
                function read(path) {
                    var entry = directory.get(path);
                    if (!entry) return Promise.reject(makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 缺少文件：' + path));
                    return blob.slice(entry.offset, entry.offset + 30 + entry.nameLength).arrayBuffer().then(function (headerBuffer) {
                        var header = new Uint8Array(headerBuffer);
                        if (header.length !== 30 + entry.nameLength) throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 本地文件头被截断');
                        var hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
                        if (hv.getUint32(0, true) !== 0x04034b50 || hv.getUint16(8, true) !== 0 || hv.getUint16(6, true) !== 0x0800 ||
                            hv.getUint32(18, true) !== entry.bytes || hv.getUint32(22, true) !== entry.bytes || hv.getUint16(26, true) !== entry.nameLength || hv.getUint16(28, true) !== 0 ||
                            safeZipPath(decodeUtf8(header.subarray(30))) !== path) {
                            throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 本地文件头与目录不一致');
                        }
                        var start = entry.offset + header.length;
                        return blob.slice(start, start + entry.bytes).arrayBuffer();
                    }).then(function (dataBuffer) {
                        var data = new Uint8Array(dataBuffer);
                        if (data.length !== entry.bytes || crc32(data) !== entry.crc) throw makeError('AVATAR_ARCHIVE_INVALID', 'ZIP 文件 CRC 校验失败：' + path);
                        return data;
                    });
                }
                return { entries: directory, read: read };
            });
        });
    }

    ns.createAvatarTransfer = function (options) {
        options = options || {};
        var store = options.store;
        var coordinator = options.coordinator || null;
        var library = options.library || ns.avatarLibrary;
        var storageApi = options.avatarStorage || ns.avatarStorage;
        var loadUiData = options.loadUiData || function () { return {}; };
        var now = options.now || function () { return new Date(); };
        var download = options.download || defaultDownload;
        var BlobCtor = options.Blob || global.Blob;
        var isMobile = typeof options.isMobile === 'function' ? options.isMobile : function () {
            return Number(global.innerWidth) > 0 && Number(global.innerWidth) <= 600;
        };
        var configuredLimits = options.limits || {};
        var busy = false;
        function limits() {
            var source = isMobile() ? DEFAULT_LIMITS.mobile : DEFAULT_LIMITS.desktop;
            return Object.assign({}, source, configuredLimits);
        }
        function digest(bytes) {
            if (typeof options.sha256 === 'function') return Promise.resolve(options.sha256(bytes)).then(normalizeHash);
            if (!global.crypto || !global.crypto.subtle || typeof global.crypto.subtle.digest !== 'function') {
                return Promise.reject(makeError('AVATAR_EXPORT_UNSUPPORTED', '当前环境缺少 SHA-256 校验能力'));
            }
            return global.crypto.subtle.digest('SHA-256', bytes).then(function (hash) { return 'sha256:' + bytesToHex(hash); });
        }
        function defaultDownload(blob, filename) {
            if (!global.URL || typeof global.URL.createObjectURL !== 'function' || !global.document) throw makeError('AVATAR_EXPORT_UNSUPPORTED', '当前环境不支持文件下载');
            var url = global.URL.createObjectURL(blob);
            var anchor = global.document.createElement('a');
            anchor.href = url; anchor.download = filename;
            global.document.body.appendChild(anchor); anchor.click();
            global.setTimeout(function () {
                if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
                global.URL.revokeObjectURL(url);
            }, 500);
            return true;
        }
        function runExclusive(task) {
            if (busy) return Promise.reject(makeError('AVATAR_EXPORT_BUSY', '已有头像导出任务正在进行'));
            busy = true;
            var execute = function () { return Promise.resolve().then(task); };
            var result = coordinator && typeof coordinator.runReadBarrier === 'function'
                ? coordinator.runReadBarrier(execute)
                : execute();
            return result.finally(function () { busy = false; });
        }
        function sourceStamp() {
            if (coordinator && typeof coordinator.getConsistencyState === 'function') return coordinator.getConsistencyState();
            var state = coordinator && typeof coordinator.getState === 'function' ? coordinator.getState() : { phase: 'local-ready', authoritative: 'local', offline: false };
            if (state.phase === 'blocked' || state.phase === 'conflict') return Promise.reject(makeError('AVATAR_BACKUP_UNAVAILABLE', '头像存储异常或冲突时不能创建完整备份'));
            return Promise.resolve({
                phase: state.phase || 'local-ready', authority: state.authoritative || 'local', consistency: state.offline ? 'last-known-good' : 'verified',
                offline: state.offline === true, datasetId: null, revision: null, fingerprint: '',
            });
        }
        function captureCore() {
            return Promise.all([store.listAssets(), store.listBindings(), store.listNativeViews(), store.listSourceIntents()]).then(function (parts) {
                var value = {
                    assets: sortById(parts[0]).map(metadataOnly),
                    bindings: sortById(parts[1]),
                    nativeViews: sortById(parts[2]),
                    sourceIntents: sortById(parts[3]),
                };
                return digest(utf8(stableStringify(value))).then(function (hash) { return { value: value, hash: hash }; });
            });
        }
        function captureLibrary(assetIds) {
            var raw = loadUiData() || {};
            var hasLibrary = Object.prototype.hasOwnProperty.call(raw, 'avatarLibrary');
            var value;
            if (hasLibrary) {
                if (!isObject(raw.avatarLibrary)) return Promise.reject(makeError('AVATAR_BACKUP_INVALID', '头像分类与整理数据结构无效'));
                value = clone(raw.avatarLibrary);
            } else {
                var holder = {};
                value = clone(library.ensureState(holder));
            }
            validateLibrary(value, assetIds);
            return digest(utf8(stableStringify(value))).then(function (hash) { return { value: value, hash: hash }; });
        }
        function validateLibrary(value, assetIds) {
            if (!isObject(value) || value.version !== 1 || !Array.isArray(value.categories) || !isObject(value.assetMeta) ||
                !isObject(value.series) || value.series.version !== 1 || !isObject(value.series.groups) ||
                (value.sortMode !== 'import-asc' && value.sortMode !== 'import-desc') || !Number.isSafeInteger(value.nextImportOrder) || value.nextImportOrder < 1) {
                throw makeError('AVATAR_BACKUP_INVALID', '头像分类与整理数据结构无效');
            }
            var categories = uniqueTexts(value.categories);
            if (categories.length !== value.categories.length) throw makeError('AVATAR_BACKUP_INVALID', '头像分类包含空值或重复项');
            Object.keys(value.assetMeta).forEach(function (id) {
                var meta = value.assetMeta[id];
                if (!assetIds.has(id) || !isObject(meta) || typeof meta.category !== 'string' || !Array.isArray(meta.tags) || uniqueTexts(meta.tags).length !== meta.tags.length ||
                    !Number.isSafeInteger(meta.importOrder) || meta.importOrder < 0 || (meta.category && categories.indexOf(meta.category) === -1)) {
                    throw makeError('AVATAR_BACKUP_INVALID', '头像分类或标签包含无效资产引用', { avatarId: id });
                }
            });
            var claimed = new Set();
            Object.keys(value.series.groups).forEach(function (key) {
                var group = value.series.groups[key];
                if (!isObject(group) || group.id !== key || !clean(group.name) || !Array.isArray(group.members) || group.members.length < 2 || uniqueTexts(group.members).length !== group.members.length) {
                    throw makeError('AVATAR_BACKUP_INVALID', '头像系列结构无效', { seriesId: key });
                }
                group.members.forEach(function (id) {
                    if (!assetIds.has(id) || claimed.has(id)) throw makeError('AVATAR_BACKUP_INVALID', '头像系列包含缺失或重复归属', { avatarId: id });
                    claimed.add(id);
                });
            });
            return value;
        }
        function ensureMetadataMatches(metadata, asset) {
            if (!asset || !sameStable(metadataOnly(asset), metadataOnly(metadata))) throw makeError('AVATAR_EXPORT_SOURCE_CHANGED', '头像资产在导出期间发生变化，请重试', { avatarId: metadata && metadata.id });
        }
        function sequential(items, task) {
            var results = [];
            return (items || []).reduce(function (promise, item, index) {
                return promise.then(function () { return task(item, index); }).then(function (result) { results.push(result); });
            }, Promise.resolve()).then(function () { return results; });
        }
        function sequentialEach(items, task) {
            return (items || []).reduce(function (promise, item, index) {
                return promise.then(function () { return task(item, index); });
            }, Promise.resolve());
        }
        function inspectAssetSize(metadata, includeThumbnail, total, currentLimits) {
            return store.getAsset(metadata.id).then(function (asset) {
                ensureMetadataMatches(metadata, asset);
                var main = dataUrlInfo(asset.imageData);
                var thumb = includeThumbnail ? dataUrlInfo(asset.thumbData) : null;
                if (main.mime !== asset.mimeType || main.bytes > currentLimits.fileBytes || thumb && thumb.bytes > currentLimits.fileBytes) {
                    throw makeError('AVATAR_EXPORT_LIMIT', '单张头像文件超过当前设备安全上限', { avatarId: metadata.id, limit: currentLimits.fileBytes });
                }
                total.bytes += main.bytes + (thumb ? thumb.bytes : 0);
                if (total.bytes > currentLimits.payloadBytes) {
                    throw makeError('AVATAR_EXPORT_LIMIT', '导出内容约 ' + limitText(total.bytes) + '，超过当前设备 ' + limitText(currentLimits.payloadBytes) + ' 的安全上限；请减少选择或改用桌面端');
                }
                return { main: main, thumbnail: thumb };
            });
        }
        function addBlob(blobMap, decoded) {
            return digest(decoded.bytes).then(function (hash) {
                var ext = MIME_EXT[decoded.mime];
                var path = 'blobs/sha256/' + hash.slice(7) + '.' + ext;
                var existing = blobMap.get(path);
                if (existing && (existing.bytes.length !== decoded.bytes.length || existing.mime !== decoded.mime)) throw makeError('AVATAR_BACKUP_INVALID', '内容哈希发生冲突');
                if (!existing) blobMap.set(path, { path: path, bytes: decoded.bytes, mime: decoded.mime, sha256: hash });
                return { path: path, bytes: decoded.bytes.length, mime: decoded.mime, sha256: hash };
            });
        }
        function imageExportFilename(metadata, index) {
            var prefix = String(index + 1).padStart(3, '0');
            var shortId = clean(metadata.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'avatar';
            return prefix + '-' + sanitizeFilename(metadata.name, 'avatar') + '--' + shortId + '.' + MIME_EXT[metadata.mimeType];
        }
        function downloadName(prefix, extension) {
            return prefix + '-' + now().toISOString().slice(0, 10) + extension;
        }
        function verifyFile(reader, record, expectedMime) {
            if (!isObject(record) || safeZipPath(record.path) !== record.path || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^sha256:[a-f0-9]{64}$/.test(record.sha256)) {
                return Promise.reject(makeError('AVATAR_ARCHIVE_INVALID', '文件清单记录无效'));
            }
            return reader.read(record.path).then(function (bytes) {
                if (bytes.length !== record.bytes) throw makeError('AVATAR_ARCHIVE_INVALID', '文件长度与清单不一致：' + record.path);
                if (expectedMime) verifyImageMagic(bytes, expectedMime);
                return digest(bytes).then(function (hash) {
                    if (hash !== record.sha256) throw makeError('AVATAR_ARCHIVE_INVALID', '文件 SHA-256 与清单不一致：' + record.path);
                    return bytes;
                });
            });
        }
        function validateInventory(inventory, manifestFiles) {
            if (!isObject(inventory) || inventory.schemaVersion !== 1 || !Array.isArray(inventory.assets) || !Array.isArray(inventory.bindings) ||
                !Array.isArray(inventory.nativeViews) || !Array.isArray(inventory.sourceIntents) || !isObject(inventory.avatarLibrary)) {
                throw makeError('AVATAR_ARCHIVE_INVALID', '备份业务清单结构无效');
            }
            var assetIds = new Set();
            var rawAssets = inventory.assets.map(function (asset) {
                if (!isObject(asset) || !isObject(asset.main) || !isObject(asset.thumbnail) || assetIds.has(clean(asset.id))) throw makeError('AVATAR_ARCHIVE_INVALID', '备份包含重复或无效头像资产');
                if (asset.main.mime !== asset.mimeType || !MIME_EXT[asset.main.mime] || !MIME_EXT[asset.thumbnail.mime]) throw makeError('AVATAR_ARCHIVE_INVALID', '备份头像 MIME 引用无效');
                assetIds.add(clean(asset.id));
                [asset.main, asset.thumbnail].forEach(function (ref) {
                    var listed = manifestFiles.get(ref.path);
                    if (!listed || !sameStable(listed, ref)) throw makeError('AVATAR_ARCHIVE_INVALID', '头像图片引用不在文件清单中');
                    if (ref.path !== 'blobs/sha256/' + ref.sha256.slice(7) + '.' + MIME_EXT[ref.mime]) throw makeError('AVATAR_ARCHIVE_INVALID', '头像图片内容寻址路径无效');
                });
                return Object.assign({}, metadataOnly(asset), { imageData: 'data:' + asset.main.mime + ';base64,AA==', thumbData: 'data:' + asset.thumbnail.mime + ';base64,AA==' });
            });
            if (!storageApi || typeof storageApi.normalizeSnapshot !== 'function') throw makeError('AVATAR_EXPORT_UNSUPPORTED', '头像快照校验器不可用');
            storageApi.normalizeSnapshot({ assets: rawAssets, bindings: inventory.bindings, nativeViews: inventory.nativeViews, sourceIntents: inventory.sourceIntents });
            validateLibrary(inventory.avatarLibrary, assetIds);
            return true;
        }
        function verifyBackupBlob(blob, retainReader) {
            var currentLimits = limits();
            return openStoredZip(blob, currentLimits).then(function (reader) {
                return reader.read('manifest.json').then(function (bytes) {
                    var manifest = safeJsonParse(decodeUtf8(bytes), 'manifest.json');
                    if (!isObject(manifest) || manifest.format !== BACKUP_FORMAT || manifest.formatVersion !== BACKUP_VERSION || !isObject(manifest.source) ||
                        !isObject(manifest.schemas) || !isObject(manifest.inventory) || !Array.isArray(manifest.files) || !/^sha256:[a-f0-9]{64}$/.test(manifest.manifestFingerprint)) {
                        throw makeError('AVATAR_ARCHIVE_INVALID', '完整备份 manifest 结构无效');
                    }
                    if ((manifest.source.consistency !== 'verified' && manifest.source.consistency !== 'last-known-good') ||
                        manifest.source.offline !== (manifest.source.consistency === 'last-known-good') ||
                        (manifest.source.phase !== 'local-ready' && manifest.source.phase !== 'remote-ready') ||
                        (manifest.source.authority !== 'local' && manifest.source.authority !== 'remote') ||
                        !/^sha256:[a-f0-9]{64}$/.test(manifest.source.avatarSnapshotSha256) ||
                        !/^sha256:[a-f0-9]{64}$/.test(manifest.source.avatarLibrarySha256)) {
                        throw makeError('AVATAR_ARCHIVE_INVALID', '完整备份来源状态无效');
                    }
                    if (manifest.source.authority === 'remote') {
                        if (!clean(manifest.source.datasetId) || !Number.isSafeInteger(manifest.source.revision) || manifest.source.revision < 0 || !/^sha256:[a-f0-9]{64}$/.test(manifest.source.fingerprint)) {
                            throw makeError('AVATAR_ARCHIVE_INVALID', '完整备份远端来源版本无效');
                        }
                    } else if (manifest.source.datasetId !== null || manifest.source.revision !== null || manifest.source.fingerprint !== '') {
                        throw makeError('AVATAR_ARCHIVE_INVALID', '完整备份本地来源版本无效');
                    }
                    var fingerprint = manifest.manifestFingerprint;
                    var base = clone(manifest); delete base.manifestFingerprint;
                    return digest(utf8(stableStringify(base))).then(function (actual) {
                        if (actual !== fingerprint) throw makeError('AVATAR_ARCHIVE_INVALID', '完整备份 manifest 指纹无效');
                        var files = new Map();
                        manifest.files.forEach(function (file) {
                            if (files.has(file.path) || file.path === 'manifest.json') throw makeError('AVATAR_ARCHIVE_INVALID', '完整备份文件清单包含重复项');
                            files.set(file.path, file);
                        });
                        if (!sameStable(files.get(manifest.inventory.path), manifest.inventory)) throw makeError('AVATAR_ARCHIVE_INVALID', 'inventory.json 清单引用无效');
                        if (reader.entries.size !== files.size + 1 || !reader.entries.has('manifest.json')) throw makeError('AVATAR_ARCHIVE_INVALID', '完整备份包含未列出的文件');
                        return verifyFile(reader, manifest.inventory).then(function (inventoryBytes) {
                            var inventory = safeJsonParse(decodeUtf8(inventoryBytes), 'inventory.json');
                            validateInventory(inventory, files);
                            var core = {
                                assets: inventory.assets.map(metadataOnly),
                                bindings: inventory.bindings,
                                nativeViews: inventory.nativeViews,
                                sourceIntents: inventory.sourceIntents,
                            };
                            return Promise.all([
                                digest(utf8(stableStringify(core))),
                                digest(utf8(stableStringify(inventory.avatarLibrary))),
                            ]).then(function (sourceHashes) {
                                if (sourceHashes[0] !== manifest.source.avatarSnapshotSha256 || sourceHashes[1] !== manifest.source.avatarLibrarySha256) {
                                    throw makeError('AVATAR_ARCHIVE_INVALID', '完整备份来源内容哈希不一致');
                                }
                                return sequentialEach(manifest.files.filter(function (file) { return file.path !== manifest.inventory.path; }), function (file) {
                                    if (!/^blobs\/sha256\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(file.path) || !MIME_EXT[file.mime] ||
                                        file.path !== 'blobs/sha256/' + file.sha256.slice(7) + '.' + MIME_EXT[file.mime]) throw makeError('AVATAR_ARCHIVE_INVALID', '完整备份图片路径或 MIME 无效');
                                    return verifyFile(reader, file, file.mime);
                                }).then(function () {
                                    var result = {
                                        manifest: manifest,
                                        inventory: inventory,
                                        metrics: {
                                            archiveBytes: Number(blob && blob.size) || 0,
                                            payloadBytes: manifest.files.reduce(function (total, file) { return total + file.bytes; }, 0),
                                            files: manifest.files.length + 1,
                                        },
                                    };
                                    if (retainReader === true) result.reader = reader;
                                    return result;
                                });
                            });
                        });
                    });
                });
            });
        }
        function verifyImageExportBlob(blob) {
            return openStoredZip(blob, limits()).then(function (reader) {
                return reader.read('index.json').then(function (bytes) {
                    var index = safeJsonParse(decodeUtf8(bytes), 'index.json');
                    if (!isObject(index) || index.format !== IMAGE_EXPORT_FORMAT || index.formatVersion !== IMAGE_EXPORT_VERSION || index.restorable !== false || !Array.isArray(index.images)) {
                        throw makeError('AVATAR_ARCHIVE_INVALID', '图片导出索引结构无效');
                    }
                    if (reader.entries.size !== index.images.length + 1) throw makeError('AVATAR_ARCHIVE_INVALID', '图片导出 ZIP 文件数量不一致');
                    return sequentialEach(index.images, function (item) {
                        if (!isObject(item) || !clean(item.id) || !clean(item.name) || !MIME_EXT[item.mime] || item.file === 'index.json') throw makeError('AVATAR_ARCHIVE_INVALID', '图片导出索引记录无效');
                        return verifyFile(reader, { path: item.file, bytes: item.bytes, sha256: item.sha256 }, item.mime);
                    }).then(function () { return index; });
                });
            });
        }
        function exportSingle(id) {
            return runExclusive(function () {
                var currentLimits = limits();
                return store.getAsset(id).then(function (asset) {
                    if (!asset) throw makeError('AVATAR_NOT_FOUND', '头像不存在');
                    var info = dataUrlInfo(asset.imageData);
                    if (info.bytes > currentLimits.fileBytes) throw makeError('AVATAR_EXPORT_LIMIT', '头像主图超过当前设备安全上限');
                    var decoded = decodeDataUrl(asset.imageData, asset.mimeType);
                    var blob = new BlobCtor([decoded.bytes], { type: decoded.mime });
                    var filename = sanitizeFilename(asset.name, 'avatar') + '.' + MIME_EXT[decoded.mime];
                    return Promise.resolve(download(blob, filename)).then(function () { return { filename: filename, bytes: decoded.bytes.length, mime: decoded.mime }; });
                });
            });
        }
        function exportBatch(ids) {
            ids = uniqueTexts(ids);
            if (!ids.length) return Promise.reject(makeError('AVATAR_EXPORT_EMPTY', '请先选择头像'));
            return runExclusive(function () {
                var currentLimits = limits();
                return sequential(ids, function (id) {
                    return store.getAssetMetadata(id).then(function (asset) {
                        if (!asset) throw makeError('AVATAR_NOT_FOUND', '所选头像不存在', { avatarId: id });
                        return asset;
                    });
                }).then(function (metadata) {
                    if (metadata.length + 1 > currentLimits.files) throw makeError('AVATAR_EXPORT_LIMIT', '所选头像数量超过当前设备安全上限，请减少选择');
                    var total = { bytes: 0 };
                    return sequentialEach(metadata, function (item) { return inspectAssetSize(item, false, total, currentLimits); }).then(function () {
                        var entries = [];
                        var indexItems = [];
                        return sequentialEach(metadata, function (item, index) {
                            return store.getAsset(item.id).then(function (asset) {
                                ensureMetadataMatches(item, asset);
                                var decoded = decodeDataUrl(asset.imageData, asset.mimeType);
                                var filename = imageExportFilename(item, index);
                                return digest(decoded.bytes).then(function (hash) {
                                    entries.push({ path: filename, data: decoded.bytes });
                                    indexItems.push({ id: item.id, name: item.name, file: filename, mime: decoded.mime, width: item.width, height: item.height, bytes: decoded.bytes.length, sha256: hash });
                                });
                            });
                        }).then(function () {
                            var index = { format: IMAGE_EXPORT_FORMAT, formatVersion: IMAGE_EXPORT_VERSION, restorable: false, exportedAt: now().toISOString(), images: indexItems };
                            entries.unshift({ path: 'index.json', data: utf8(stableStringify(index)) });
                            var size = estimateZipSize(entries);
                            if (size > currentLimits.archiveBytes) throw makeError('AVATAR_EXPORT_LIMIT', '导出 ZIP 超过当前设备 ' + limitText(currentLimits.archiveBytes) + ' 的安全上限');
                            var blob = buildStoredZip(entries, index.exportedAt, BlobCtor);
                            return verifyImageExportBlob(blob).then(function () {
                                var filename = downloadName('avatar-images', '.zip');
                                return Promise.resolve(download(blob, filename)).then(function () { return { filename: filename, count: indexItems.length, bytes: blob.size }; });
                            });
                        });
                    });
                });
            });
        }
        function sameSourceStamp(left, right) {
            return sameStable({ phase: left.phase, authority: left.authority, consistency: left.consistency, offline: left.offline, datasetId: left.datasetId, revision: left.revision, fingerprint: left.fingerprint },
                { phase: right.phase, authority: right.authority, consistency: right.consistency, offline: right.offline, datasetId: right.datasetId, revision: right.revision, fingerprint: right.fingerprint });
        }
        function buildBackupFiles(core, libraryState, source, currentLimits) {
            var blobMap = new Map();
            var inventoryAssets = [];
            return sequentialEach(core.assets, function (metadata) {
                return store.getAsset(metadata.id).then(function (asset) {
                    ensureMetadataMatches(metadata, asset);
                    var main = decodeDataUrl(asset.imageData, asset.mimeType);
                    var thumbnail = decodeDataUrl(asset.thumbData);
                    return Promise.all([addBlob(blobMap, main), addBlob(blobMap, thumbnail)]).then(function (refs) {
                        inventoryAssets.push(Object.assign({}, metadata, { main: refs[0], thumbnail: refs[1] }));
                    });
                });
            }).then(function () {
                var inventory = {
                    schemaVersion: 1,
                    assets: inventoryAssets,
                    bindings: core.bindings,
                    nativeViews: core.nativeViews,
                    sourceIntents: core.sourceIntents,
                    avatarLibrary: libraryState,
                };
                var inventoryBytes = utf8(stableStringify(inventory));
                return digest(inventoryBytes).then(function (inventoryHash) {
                    var inventoryFile = { path: 'inventory.json', bytes: inventoryBytes.length, mime: 'application/json', sha256: inventoryHash };
                    var blobFiles = Array.from(blobMap.values()).sort(function (a, b) { return a.path.localeCompare(b.path); });
                    var manifestBase = {
                        format: BACKUP_FORMAT,
                        formatVersion: BACKUP_VERSION,
                        createdAt: now().toISOString(),
                        createdBy: { pluginVersion: clean(options.pluginVersion) || 'unknown' },
                        schemas: clone(store.versions || { library: 1, bindings: 4, nativeViews: 1, sourceIntents: 1 }),
                        source: clone(source),
                        inventory: inventoryFile,
                        files: [inventoryFile].concat(blobFiles.map(function (file) { return { path: file.path, bytes: file.bytes.length, mime: file.mime, sha256: file.sha256 }; })),
                    };
                    return digest(utf8(stableStringify(manifestBase))).then(function (fingerprint) {
                        var manifest = Object.assign({}, manifestBase, { manifestFingerprint: fingerprint });
                        var entries = [
                            { path: 'manifest.json', data: utf8(stableStringify(manifest)) },
                            { path: 'inventory.json', data: inventoryBytes },
                        ].concat(blobFiles.map(function (file) { return { path: file.path, data: file.bytes }; }));
                        if (entries.length > currentLimits.files) throw makeError('AVATAR_EXPORT_LIMIT', '完整备份文件数量超过当前设备安全上限');
                        var size = estimateZipSize(entries);
                        if (size > currentLimits.archiveBytes) throw makeError('AVATAR_EXPORT_LIMIT', '完整备份 ZIP 超过当前设备 ' + limitText(currentLimits.archiveBytes) + ' 的安全上限');
                        return { blob: buildStoredZip(entries, manifest.createdAt, BlobCtor), manifest: manifest, inventory: inventory };
                    });
                });
            });
        }
        function verifySourceAssets(expectedAssets) {
            return sequentialEach(expectedAssets, function (expected) {
                return store.getAsset(expected.id).then(function (asset) {
                    ensureMetadataMatches(expected, asset);
                    var main = decodeDataUrl(asset.imageData, asset.mimeType);
                    var thumbnail = decodeDataUrl(asset.thumbData);
                    return Promise.all([digest(main.bytes), digest(thumbnail.bytes)]).then(function (hashes) {
                        if (hashes[0] !== expected.main.sha256 || main.bytes.length !== expected.main.bytes || hashes[1] !== expected.thumbnail.sha256 || thumbnail.bytes.length !== expected.thumbnail.bytes) {
                            throw makeError('AVATAR_EXPORT_SOURCE_CHANGED', '头像图片在备份期间发生变化，请重试', { avatarId: expected.id });
                        }
                    });
                });
            });
        }
        function createFullBackup() {
            return runExclusive(function () {
                var currentLimits = limits();
                var beforeStamp;
                var beforeCore;
                var beforeLibrary;
                return sourceStamp().then(function (stamp) {
                    if (stamp.phase === 'blocked' || stamp.phase === 'conflict') throw makeError('AVATAR_BACKUP_UNAVAILABLE', '头像存储异常或冲突时不能创建完整备份');
                    beforeStamp = stamp;
                    return captureCore();
                }).then(function (core) {
                    beforeCore = core;
                    return captureLibrary(new Set(core.value.assets.map(function (asset) { return asset.id; })));
                }).then(function (librarySnapshot) {
                    beforeLibrary = librarySnapshot;
                    if (beforeCore.value.assets.length * 2 + 2 > currentLimits.files) throw makeError('AVATAR_EXPORT_LIMIT', '头像数量超过当前设备完整备份的安全上限');
                    var total = { bytes: 0 };
                    return sequentialEach(beforeCore.value.assets, function (metadata) { return inspectAssetSize(metadata, true, total, currentLimits); });
                }).then(function () {
                    var backupSource = Object.assign({}, beforeStamp, { avatarSnapshotSha256: beforeCore.hash, avatarLibrarySha256: beforeLibrary.hash });
                    return buildBackupFiles(beforeCore.value, beforeLibrary.value, backupSource, currentLimits);
                }).then(function (built) {
                    return verifyBackupBlob(built.blob).then(function () { return built; });
                }).then(function (built) {
                    return verifySourceAssets(built.inventory.assets).then(function () { return built; });
                }).then(function (built) {
                    return Promise.all([
                        sourceStamp(),
                        captureCore(),
                        captureLibrary(new Set(beforeCore.value.assets.map(function (asset) { return asset.id; }))),
                    ]).then(function (after) {
                        if (!sameSourceStamp(beforeStamp, after[0]) || beforeCore.hash !== after[1].hash || beforeLibrary.hash !== after[2].hash) {
                            throw makeError('AVATAR_EXPORT_SOURCE_CHANGED', '头像数据在完整备份期间发生变化，已中止，请重试');
                        }
                        var filename = downloadName('theme-mgr-avatar-backup', '.zip');
                        return Promise.resolve(download(built.blob, filename)).then(function () {
                            return { filename: filename, count: built.inventory.assets.length, bytes: built.blob.size, source: clone(built.manifest.source), manifestFingerprint: built.manifest.manifestFingerprint };
                        });
                    });
                });
            });
        }
        function estimateFullBackupSize() {
            return store.listAssets().then(function (items) {
                var total = 0;
                return sequentialEach(items, function (metadata) {
                    return store.getAsset(metadata.id).then(function (asset) {
                        ensureMetadataMatches(metadata, asset);
                        total += dataUrlInfo(asset.imageData).bytes + dataUrlInfo(asset.thumbData).bytes;
                    });
                }).then(function () {
                    return { assets: items.length, payloadBytes: total, mobilePayloadLimit: DEFAULT_LIMITS.mobile.payloadBytes, desktopPayloadLimit: DEFAULT_LIMITS.desktop.payloadBytes };
                });
            });
        }
        return {
            exportSingle: exportSingle,
            exportBatch: exportBatch,
            createFullBackup: createFullBackup,
            verifyBackupBlob: verifyBackupBlob,
            verifyImageExportBlob: verifyImageExportBlob,
            estimateFullBackupSize: estimateFullBackupSize,
            getState: function () { return { busy: busy, limits: limits() }; },
        };
    };

    ns.avatarTransfer = {
        BACKUP_FORMAT: BACKUP_FORMAT,
        BACKUP_VERSION: BACKUP_VERSION,
        IMAGE_EXPORT_FORMAT: IMAGE_EXPORT_FORMAT,
        IMAGE_EXPORT_VERSION: IMAGE_EXPORT_VERSION,
        DEFAULT_LIMITS: clone(DEFAULT_LIMITS),
        stableStringify: stableStringify,
        dataUrlInfo: dataUrlInfo,
        decodeDataUrl: decodeDataUrl,
        crc32: crc32,
        estimateZipSize: estimateZipSize,
        buildStoredZip: buildStoredZip,
        openStoredZip: openStoredZip,
        makeError: makeError,
    };
})(window);
