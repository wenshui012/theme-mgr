(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var SERVER_BASE = '/api/plugins/theme-manager';
    var CACHE_DB_NAME = 'theme_mgr_avatar_cache_db';
    var CONTROL_DB_NAME = 'theme_mgr_avatar_sync_db';
    var CONTROL_DB_VERSION = 1;
    var CONTROL_STORE = 'state';
    var CONTROL_KEY = 'remote-authority';
    var MANIFEST_VERSION = 1;
    var CONTROL_VERSION = 1;
    var IMAGE_URL_PREFIX = SERVER_BASE + '/images/';
    var REQUEST_TIMEOUT_MS = 10000;
    var CACHE_VERIFY_BATCH_SIZE = 8;
    var CACHE_VERIFY_TIMEOUT_MS = 30000;

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function clean(value) { return String(value == null ? '' : value).trim(); }
    function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
    function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    function makeError(code, message, details) {
        var error = new Error(message);
        error.name = 'AvatarSyncError';
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
    function forEachSequential(items, iteratee) {
        items = Array.isArray(items) ? items : [];
        return new Promise(function (resolve, reject) {
            var index = 0;
            function next() {
                if (index >= items.length) { resolve(); return; }
                var currentIndex = index;
                index += 1;
                var result;
                try { result = iteratee(items[currentIndex], currentIndex); }
                catch (error) { reject(error); return; }
                Promise.resolve(result).then(function () {
                    global.setTimeout(next, 0);
                }, reject);
            }
            next();
        });
    }
    function emptySnapshot() { return { assets: [], bindings: [], nativeViews: [], sourceIntents: [] }; }
    function emptyManifest() { return { schemaVersion: MANIFEST_VERSION, assets: [], bindings: [], nativeViews: [], sourceIntents: [] }; }
    function normalizeMime(value) {
        value = clean(value).toLowerCase().split(';')[0];
        return value === 'image/jpg' || value === 'image/pjpeg' ? 'image/jpeg' : value;
    }
    function bytesToHex(bytes) {
        return Array.prototype.map.call(new Uint8Array(bytes), function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    }
    function defaultInspectDataUrl(dataUrl) {
        var match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(clean(dataUrl));
        if (!match || !global.crypto || !global.crypto.subtle || typeof global.atob !== 'function') {
            return Promise.reject(makeError('AVATAR_BLOB_INVALID', '头像图片无法执行完整性校验'));
        }
        var binary;
        try { binary = global.atob(match[2].replace(/\s/g, '')); }
        catch (error) { return Promise.reject(makeError('AVATAR_BLOB_INVALID', '头像图片 Base64 无效', { cause: error.message })); }
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        if (!bytes.length) return Promise.reject(makeError('AVATAR_BLOB_INVALID', '头像图片内容为空'));
        var byteLength = bytes.length;
        return global.crypto.subtle.digest('SHA-256', bytes).then(function (hash) {
            binary = '';
            bytes = null;
            return { sha256: 'sha256:' + bytesToHex(hash), bytes: byteLength, mime: normalizeMime(match[1]) };
        });
    }
    function arrayBufferToDataUrl(buffer, mime) {
        var bytes = new Uint8Array(buffer);
        var parts = [];
        for (var offset = 0; offset < bytes.length; offset += 0x8000) {
            parts.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000)));
        }
        return 'data:' + mime + ';base64,' + global.btoa(parts.join(''));
    }
    function normalizeImageRef(raw) {
        raw = isObject(raw) ? raw : {};
        var ref = {
            name: clean(raw.name),
            url: clean(raw.url),
            sha256: clean(raw.sha256).toLowerCase(),
            bytes: Number(raw.bytes),
            mime: normalizeMime(raw.mime),
        };
        if (!/^[a-f0-9]{40}\.(?:jpg|png|webp|gif|bmp)$/i.test(ref.name) || ref.url !== IMAGE_URL_PREFIX + ref.name ||
            !/^sha256:[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 ||
            !/^image\/(?:jpeg|png|webp|gif|bmp)$/.test(ref.mime)) {
            throw makeError('AVATAR_REMOTE_INVALID', '后端头像图片引用无效');
        }
        return ref;
    }
    function assetManifestRecord(asset, refs) {
        return {
            version: asset.version,
            id: asset.id,
            name: asset.name,
            mimeType: asset.mimeType,
            width: asset.width,
            height: asset.height,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
            image: normalizeImageRef(refs.image),
            thumbnail: normalizeImageRef(refs.thumbnail),
        };
    }
    function normalizeManifest(raw, storageApi) {
        if (!isObject(raw) || raw.schemaVersion !== MANIFEST_VERSION || !Array.isArray(raw.assets) ||
            !Array.isArray(raw.bindings) || !Array.isArray(raw.nativeViews) || !Array.isArray(raw.sourceIntents)) {
            throw makeError('AVATAR_REMOTE_INVALID', '后端头像 manifest 结构无效');
        }
        var refs = new Map();
        var snapshot = storageApi.normalizeSnapshot({
            assets: raw.assets.map(function (asset) {
                if (!isObject(asset)) throw makeError('AVATAR_REMOTE_INVALID', '后端头像资产结构无效');
                var image = normalizeImageRef(asset.image);
                var thumbnail = normalizeImageRef(asset.thumbnail);
                refs.set(clean(asset.id), { image: image, thumbnail: thumbnail });
                return Object.assign({}, asset, { imageData: image.url, thumbData: thumbnail.url });
            }),
            bindings: raw.bindings,
            nativeViews: raw.nativeViews,
            sourceIntents: raw.sourceIntents,
        });
        if (refs.size !== snapshot.assets.length) throw makeError('AVATAR_REMOTE_INVALID', '后端头像资产标识重复');
        var manifest = {
            schemaVersion: MANIFEST_VERSION,
            assets: snapshot.assets.map(function (asset) { return assetManifestRecord(asset, refs.get(asset.id)); }),
            bindings: snapshot.bindings,
            nativeViews: snapshot.nativeViews,
            sourceIntents: snapshot.sourceIntents,
        };
        var received = clone(raw);
        received.assets = received.assets.map(function (asset) {
            return Object.assign({}, asset, { image: normalizeImageRef(asset.image), thumbnail: normalizeImageRef(asset.thumbnail) });
        });
        if (stableStringify(received) !== stableStringify(manifest)) {
            throw makeError('AVATAR_REMOTE_INVALID', '后端头像 manifest 不是规范化的完整数据');
        }
        return {
            manifest: manifest,
            refs: refs,
        };
    }
    function manifestFromSnapshot(snapshot, refs, storageApi) {
        snapshot = storageApi.normalizeSnapshot(snapshot);
        return normalizeManifest({
            schemaVersion: MANIFEST_VERSION,
            assets: snapshot.assets.map(function (asset) {
                var pair = refs.get(asset.id);
                if (!pair) throw makeError('AVATAR_REMOTE_INVALID', '头像资产缺少已验证的后端图片引用', { avatarId: asset.id });
                return assetManifestRecord(asset, pair);
            }),
            bindings: snapshot.bindings,
            nativeViews: snapshot.nativeViews,
            sourceIntents: snapshot.sourceIntents,
        }, storageApi).manifest;
    }
    function refsFromManifest(manifest, storageApi) { return normalizeManifest(manifest, storageApi).refs; }
    function makeDatasetId() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') return 'avatar-' + global.crypto.randomUUID();
        return 'avatar-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
    }
    function normalizeCacheDatabaseName(value, baseName) {
        baseName = clean(baseName) || CACHE_DB_NAME;
        if (baseName.length > 140 || !/^[A-Za-z0-9._-]+$/.test(baseName)) {
            throw makeError('AVATAR_CONTROL_INVALID', '头像缓存数据库基础名称无效');
        }
        value = clean(value) || baseName;
        if (value === baseName) return value;
        if (value.indexOf(baseName + '__hydrate__') !== 0 || value.length > 180 || !/^[A-Za-z0-9._-]+$/.test(value)) {
            throw makeError('AVATAR_CONTROL_INVALID', '头像缓存数据库指针无效');
        }
        return value;
    }
    function makeCacheDatabaseName(baseName) {
        var suffix = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
        if (global.crypto && typeof global.crypto.randomUUID === 'function') suffix = global.crypto.randomUUID();
        return clean(baseName || CACHE_DB_NAME) + '__hydrate__' + suffix;
    }
    function cacheVerifierWorkerSource() {
        return [
            "function fail(code,message){var error=new Error(message);error.code=code;throw error;}",
            "function hex(buffer){return Array.prototype.map.call(new Uint8Array(buffer),function(byte){return byte.toString(16).padStart(2,'0');}).join('');}",
            "function inspect(dataUrl){var match=/^data:(image\\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\\s]+)$/i.exec(String(dataUrl||'').trim());if(!match)fail('AVATAR_BLOB_INVALID','头像缓存图片格式无效');var binary;try{binary=atob(match[2].replace(/\\s/g,''));}catch(error){fail('AVATAR_BLOB_INVALID','头像缓存图片 Base64 无效');}if(!binary.length)fail('AVATAR_BLOB_INVALID','头像缓存图片内容为空');var bytes=new Uint8Array(binary.length);for(var i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);var length=bytes.length;return crypto.subtle.digest('SHA-256',bytes).then(function(hash){binary='';bytes=null;return{sha256:'sha256:'+hex(hash),bytes:length,mime:match[1].toLowerCase()==='image/jpg'?'image/jpeg':match[1].toLowerCase()};});}",
            "function openDb(name){return new Promise(function(resolve,reject){var request=indexedDB.open(name);request.onsuccess=function(){resolve(request.result);};request.onerror=function(){reject(request.error||new Error('cache open failed'));};request.onblocked=function(){reject(new Error('cache open blocked'));};});}",
            "function getRecord(db,storeName,id){return new Promise(function(resolve,reject){var request=db.transaction([storeName],'readonly').objectStore(storeName).get(id);request.onsuccess=function(){resolve(request.result||null);};request.onerror=function(){reject(request.error||new Error('cache read failed'));};});}",
            "function verify(actual,expected){if(!actual||actual.sha256!==expected.sha256||actual.bytes!==expected.bytes||actual.mime!==expected.mime)fail('AVATAR_BLOB_MISMATCH','头像缓存图片完整性校验失败');}",
            "self.onmessage=function(event){var input=event.data||{},db;openDb(input.databaseName).then(function(opened){db=opened;return(input.items||[]).reduce(function(tail,item){return tail.then(function(){var mainData,thumbData;return Promise.all([getRecord(db,'main-images',item.id),getRecord(db,'thumbnails',item.id)]).then(function(records){if(!records[0]||!records[1])fail('AVATAR_CACHE_INVALID','头像缓存缺少主图或缩略图');mainData=records[0].imageData;thumbData=records[1].thumbData;records=null;return inspect(mainData);}).then(function(actual){verify(actual,item.image);mainData='';return inspect(thumbData);}).then(function(actual){verify(actual,item.thumbnail);thumbData='';});});},Promise.resolve());}).then(function(){if(db)db.close();self.postMessage({ok:true});}).catch(function(error){if(db)db.close();self.postMessage({ok:false,code:error&&error.code||'AVATAR_CACHE_INVALID',message:error&&error.message||'头像缓存校验失败'});});};",
        ].join('\n');
    }

    function createMemoryControlStore(seed) {
        var value = seed ? clone(seed) : null;
        return {
            ready: Promise.resolve(true),
            get: function () { return Promise.resolve(clone(value)); },
            put: function (next) { value = clone(next); return Promise.resolve(clone(value)); },
            clear: function () { value = null; return Promise.resolve(true); },
        };
    }
    function createIndexedDbControlStore(indexedDB, dbName) {
        if (!indexedDB || typeof indexedDB.open !== 'function') throw makeError('AVATAR_CONTROL_UNAVAILABLE', '头像同步控制存储不可用');
        var databasePromise = new Promise(function (resolve, reject) {
            var request;
            try { request = indexedDB.open(dbName || CONTROL_DB_NAME, CONTROL_DB_VERSION); }
            catch (error) { reject(makeError('AVATAR_CONTROL_OPEN_FAILED', '头像同步控制存储无法打开', { cause: error.message })); return; }
            request.onupgradeneeded = function () {
                var db = request.result;
                if (!db.objectStoreNames.contains(CONTROL_STORE)) db.createObjectStore(CONTROL_STORE, { keyPath: 'id' });
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(makeError('AVATAR_CONTROL_OPEN_FAILED', '头像同步控制存储无法打开')); };
            request.onblocked = function () { reject(makeError('AVATAR_CONTROL_BLOCKED', '头像同步控制存储升级被阻止')); };
        });
        function get() {
            return databasePromise.then(function (db) {
                return new Promise(function (resolve, reject) {
                    var request = db.transaction([CONTROL_STORE], 'readonly').objectStore(CONTROL_STORE).get(CONTROL_KEY);
                    request.onsuccess = function () { resolve(clone(request.result || null)); };
                    request.onerror = function () { reject(makeError('AVATAR_CONTROL_READ_FAILED', '头像同步控制状态读取失败')); };
                });
            });
        }
        function write(value) {
            return databasePromise.then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction([CONTROL_STORE], 'readwrite');
                    tx.objectStore(CONTROL_STORE).put(Object.assign({ id: CONTROL_KEY }, clone(value)));
                    tx.oncomplete = function () { resolve(clone(value)); };
                    tx.onerror = function () { reject(makeError('AVATAR_CONTROL_WRITE_FAILED', '头像同步控制状态写入失败')); };
                    tx.onabort = tx.onerror;
                });
            });
        }
        function clear() {
            return databasePromise.then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction([CONTROL_STORE], 'readwrite');
                    tx.objectStore(CONTROL_STORE).delete(CONTROL_KEY);
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { reject(makeError('AVATAR_CONTROL_WRITE_FAILED', '头像同步控制状态清除失败')); };
                    tx.onabort = tx.onerror;
                });
            });
        }
        return { ready: databasePromise, get: get, put: write, clear: clear };
    }

    function createRemoteApi(options) {
        options = options || {};
        var fetchFn = options.fetch || global.fetch;
        var getPostHeaders = options.getPostHeaders || function () { return { 'Content-Type': 'application/json' }; };
        var base = options.serverBase || SERVER_BASE;
        var timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : REQUEST_TIMEOUT_MS;
        function request(url, init, stage) {
            var method = clean(init && init.method || 'GET').toUpperCase() || 'GET';
            var details = { endpoint: url, method: method, stage: stage };
            if (typeof fetchFn !== 'function') return Promise.reject(makeError('AVATAR_BACKEND_ERROR', '头像后端请求不可用', details));
            var timeout;
            return Promise.race([
                Promise.resolve().then(function () { return fetchFn(url, init); }),
                new Promise(function (_, reject) {
                    timeout = global.setTimeout(function () {
                        reject(makeError('AVATAR_BACKEND_ERROR', '头像后端请求超时', Object.assign({}, details, { cause: 'TIMEOUT' })));
                    }, timeoutMs);
                }),
            ]).catch(function (error) {
                if (error && error.name === 'AvatarSyncError') throw error;
                throw makeError('AVATAR_BACKEND_ERROR', '头像后端请求失败', Object.assign({}, details, {
                    cause: clean(error && (error.code || error.name)) || 'FETCH_FAILED',
                }));
            }).finally(function () { if (timeout) global.clearTimeout(timeout); });
        }
        function contentType(response) {
            try { return clean(response && response.headers && response.headers.get && response.headers.get('content-type')).toLowerCase(); }
            catch (_) { return ''; }
        }
        function responseDetails(response, method, endpoint, stage, cause) {
            var details = {
                status: Number(response && response.status) || 0,
                endpoint: endpoint,
                method: method,
                stage: stage,
                contentType: contentType(response),
            };
            if (cause) details.cause = cause;
            return details;
        }
        function safeRemoteCause(data, fallback) {
            var candidate = data && (data.code || data.name || (isObject(data.error) && (data.error.code || data.error.name)));
            candidate = clean(candidate);
            return /^[A-Za-z][A-Za-z0-9_.:-]{0,47}$/.test(candidate) ? candidate : fallback;
        }
        function readResponse(response, method, endpoint, stage) {
            var details = responseDetails(response, method, endpoint, stage);
            var read;
            if (response && typeof response.text === 'function') {
                read = Promise.resolve().then(function () { return response.text(); }).then(function (text) {
                    if (!clean(text)) return { data: null, parseCause: 'EMPTY_RESPONSE_BODY' };
                    try { return { data: JSON.parse(text), parseCause: '' }; }
                    catch (error) { return { data: null, parseCause: clean(error && error.name) || 'JSON_PARSE_FAILED' }; }
                });
            } else if (response && typeof response.json === 'function') {
                read = Promise.resolve().then(function () { return response.json(); }).then(function (data) {
                    return { data: data, parseCause: '' };
                }).catch(function (error) {
                    return { data: null, parseCause: clean(error && error.name) || 'JSON_PARSE_FAILED' };
                });
            } else {
                read = Promise.resolve({ data: null, parseCause: 'RESPONSE_BODY_UNAVAILABLE' });
            }
            return read.then(function (payload) {
                return { response: response, details: details, data: payload.data, parseCause: payload.parseCause };
            });
        }
        function throwHttpError(record) {
            var status = record.details.status;
            var details = Object.assign({}, record.details, {
                cause: safeRemoteCause(record.data, record.parseCause || ('HTTP_' + status)),
            });
            if (status === 403) throw makeError('AVATAR_CSRF_REJECTED', '头像后端拒绝了 CSRF 凭据', details);
            if (status === 409) {
                if (record.data && hasOwn(record.data, 'current')) details.current = clone(record.data.current);
                throw makeError('AVATAR_REVISION_CONFLICT', '头像数据已被其他客户端修改', details);
            }
            throw makeError('AVATAR_HTTP_ERROR', '头像后端 HTTP 请求失败', details);
        }
        function successfulJson(record) {
            if (!record.response || !record.response.ok) throwHttpError(record);
            if (record.parseCause) {
                throw makeError('AVATAR_BACKEND_INVALID', '头像后端返回了无效 JSON', Object.assign({}, record.details, { cause: record.parseCause }));
            }
            return record.data;
        }
        function invalidProtocol(record, message, cause) {
            throw makeError('AVATAR_BACKEND_INVALID', message, Object.assign({}, record.details, { cause: cause || 'PROTOCOL_INVALID' }));
        }
        function resolvePostHeaders(method, endpoint, stage) {
            return Promise.resolve().then(function () { return getPostHeaders(); }).catch(function (error) {
                throw makeError('AVATAR_BACKEND_ERROR', '头像后端请求凭据获取失败', {
                    endpoint: endpoint,
                    method: method,
                    stage: stage,
                    cause: clean(error && (error.code || error.name)) || 'HEADERS_FAILED',
                });
            });
        }
        function probeCapability() {
            var endpoint = base + '/status';
            return request(endpoint, { method: 'GET' }, 'capability').then(function (response) {
                if (response.status === 404) return { status: 'unsupported', reason: 'backend-absent' };
                return readResponse(response, 'GET', endpoint, 'capability').then(function (record) {
                    var data = successfulJson(record);
                    if (!isObject(data) || data.ok !== true) invalidProtocol(record, '头像后端 capability 响应无效');
                    var capability = data.capabilities && data.capabilities.avatarStorage;
                    if (!isObject(capability)) return { status: 'unsupported', reason: 'capability-absent' };
                    if (capability.version !== 1 || capability.manifestVersion !== 1 || capability.revisionCas !== true || capability.verifiedImageMetadata !== true) {
                        invalidProtocol(record, '头像后端 capability 版本或能力不兼容', 'CAPABILITY_INCOMPATIBLE');
                    }
                    return { status: 'supported', capability: clone(capability) };
                });
            });
        }
        function readState() {
            var endpoint = base + '/avatars/state';
            return request(endpoint, { method: 'GET' }, 'state').then(function (response) {
                return readResponse(response, 'GET', endpoint, 'state').then(function (record) {
                    if (response.status === 422 && !record.parseCause && record.data && record.data.state === 'invalid') {
                        return { status: 'invalid', error: safeRemoteCause(record.data, 'AVATAR_REMOTE_INVALID') };
                    }
                    var data = successfulJson(record);
                    if (!isObject(data) || data.ok !== true) invalidProtocol(record, '头像后端状态响应无效');
                    if (data.state === 'empty' && data.datasetId === null && data.revision === 0 && data.manifest === null) return { status: 'empty' };
                    if (data.state !== 'present' || typeof data.datasetId !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(data.datasetId) ||
                        !Number.isSafeInteger(data.revision) || data.revision < 1 || !/^sha256:[a-f0-9]{64}$/.test(data.fingerprint) || !isObject(data.manifest)) {
                        invalidProtocol(record, '头像后端状态协议无效');
                    }
                    return { status: 'present', datasetId: data.datasetId, revision: data.revision, fingerprint: data.fingerprint, manifest: data.manifest };
                });
            });
        }
        function upload(dataUrl) {
            var endpoint = base + '/images';
            return resolvePostHeaders('POST', endpoint, 'upload').then(function (headers) {
                return request(endpoint, { method: 'POST', headers: headers, body: JSON.stringify({ dataUrl: dataUrl }) }, 'upload');
            }).then(function (response) {
                return readResponse(response, 'POST', endpoint, 'upload').then(function (record) {
                    var data = successfulJson(record);
                    if (!isObject(data) || data.ok !== true || !isObject(data.image)) invalidProtocol(record, '头像图片上传响应无效');
                    try { return normalizeImageRef(data.image); }
                    catch (error) { invalidProtocol(record, '头像图片上传响应无效', error && error.code || 'IMAGE_REFERENCE_INVALID'); }
                });
            });
        }
        function commit(input) {
            var endpoint = base + '/avatars/manifest';
            return resolvePostHeaders('PUT', endpoint, 'commit').then(function (headers) {
                return request(endpoint, { method: 'PUT', headers: headers, body: JSON.stringify(input) }, 'commit');
            }).then(function (response) {
                return readResponse(response, 'PUT', endpoint, 'commit').then(function (record) {
                    var data = successfulJson(record);
                    if (!isObject(data) || data.ok !== true || data.state !== 'present' ||
                        typeof data.datasetId !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(data.datasetId) || !Number.isSafeInteger(data.revision) || data.revision < 1 ||
                        !/^sha256:[a-f0-9]{64}$/.test(data.fingerprint) || !isObject(data.manifest)) {
                        invalidProtocol(record, '头像 manifest 提交响应无效');
                    }
                    return { status: 'present', datasetId: data.datasetId, revision: data.revision, fingerprint: data.fingerprint, manifest: data.manifest };
                });
            });
        }
        function download(ref) {
            ref = normalizeImageRef(ref);
            return request(ref.url, { method: 'GET' }, 'download').then(function (response) {
                if (!response.ok) {
                    return readResponse(response, 'GET', ref.url, 'download').then(function (record) { throwHttpError(record); });
                }
                if (typeof response.arrayBuffer !== 'function') {
                    throw makeError('AVATAR_BACKEND_INVALID', '头像图片下载响应无效', responseDetails(response, 'GET', ref.url, 'download', 'ARRAY_BUFFER_UNAVAILABLE'));
                }
                return response.arrayBuffer().then(function (buffer) { return arrayBufferToDataUrl(buffer, ref.mime); });
            });
        }
        return { probeCapability: probeCapability, readState: readState, upload: upload, commit: commit, download: download };
    }

    function normalizeControl(raw, storageApi, baseCacheDatabaseName) {
        if (!isObject(raw) || raw.version !== CONTROL_VERSION || raw.mode !== 'remote-authoritative' ||
            typeof raw.datasetId !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(raw.datasetId) || !Number.isSafeInteger(raw.revision) || raw.revision < 1 ||
            !/^sha256:[a-f0-9]{64}$/.test(raw.fingerprint)) throw makeError('AVATAR_CONTROL_INVALID', '头像远端接管标记无效');
        var normalized = normalizeManifest(raw.manifest, storageApi).manifest;
        return {
            version: CONTROL_VERSION,
            mode: 'remote-authoritative',
            datasetId: raw.datasetId,
            revision: raw.revision,
            fingerprint: raw.fingerprint,
            manifest: normalized,
            cacheDatabaseName: normalizeCacheDatabaseName(raw.cacheDatabaseName, baseCacheDatabaseName),
            updatedAt: clean(raw.updatedAt),
        };
    }
    function controlFromState(remoteState, manifest, cacheDatabaseName, baseCacheDatabaseName) {
        return {
            version: CONTROL_VERSION,
            mode: 'remote-authoritative',
            datasetId: remoteState.datasetId,
            revision: remoteState.revision,
            fingerprint: remoteState.fingerprint,
            manifest: clone(manifest),
            cacheDatabaseName: normalizeCacheDatabaseName(cacheDatabaseName, baseCacheDatabaseName),
            updatedAt: new Date().toISOString(),
        };
    }

    ns.createAvatarStorageCoordinator = function (options) {
        options = options || {};
        var storageApi = options.avatarStorage || ns.avatarStorage;
        if (!storageApi || !storageApi.normalizeSnapshot) throw makeError('AVATAR_COORDINATOR_UNAVAILABLE', '头像存储协调器缺少本地存储模块');
        var localStore = options.localStore || ns.createAvatarStore({ dbName: options.localDbName || storageApi.DB_NAME });
        var baseCacheDatabaseName = normalizeCacheDatabaseName(options.cacheDbName || CACHE_DB_NAME, options.cacheDbName || CACHE_DB_NAME);
        var cacheDatabaseName = baseCacheDatabaseName;
        var suppliedCacheStore = options.cacheStore || null;
        var createCacheStore = typeof options.createCacheStore === 'function'
            ? options.createCacheStore
            : suppliedCacheStore
                ? function (name) {
                    if (name === baseCacheDatabaseName) return suppliedCacheStore;
                    throw makeError('AVATAR_CACHE_FACTORY_UNAVAILABLE', '头像缓存需要重建，但没有可持久化的影子库工厂');
                }
                : function (name) { return ns.createAvatarStore({ dbName: name }); };
        var cacheStore = suppliedCacheStore || createCacheStore(cacheDatabaseName);
        var controlStore = options.controlStore || createIndexedDbControlStore(
            hasOwn(options, 'indexedDB') ? options.indexedDB : global.indexedDB,
            options.controlDbName || CONTROL_DB_NAME
        );
        var remote = options.remote || createRemoteApi(options);
        var inspectDataUrl = options.inspectDataUrl || defaultInspectDataUrl;
        var onStateChange = options.onStateChange || function () {};
        var isBackendAvailable = typeof options.isBackendAvailable === 'function' ? options.isBackendAvailable : null;
        var isExternalWriteBlocked = typeof options.isExternalWriteBlocked === 'function' ? options.isExternalWriteBlocked : function () { return false; };
        var startupLock = options.startupLock || null;
        var state = { phase: 'idle', authoritative: null, writable: false, offline: false, local: 'unknown', remote: 'unknown', reason: '', error: null };
        var initialization = null;
        var activeStore = null;
        var activeSnapshot = null;
        var remoteManifest = null;
        var remoteRefs = new Map();
        var datasetId = null;
        var revision = 0;
        var fingerprint = '';
        var writeTail = Promise.resolve();
        var readBarrierDepth = 0;
        var readBarrierRequested = false;
        var recoveryBarrierDepth = 0;
        var recoveryBarrierRequested = false;

        function publish(next) {
            state = Object.assign({}, state, next);
            try { onStateChange(clone(state)); } catch (_) {}
            return clone(state);
        }
        function errorSummary(error) {
            if (!error) return null;
            var summary = {
                code: clean(error.code) || 'AVATAR_UNKNOWN_ERROR',
                name: clean(error.name) || 'Error',
            };
            if (error.details) summary.details = clone(error.details);
            return summary;
        }
        function sharedBackendAvailable() {
            if (!isBackendAvailable) return true;
            try { return isBackendAvailable() === true; }
            catch (_) { return false; }
        }
        function block(reason, localStatus, remoteStatus, phase, underlyingError) {
            var localFailure = /^local-/.test(reason || '') || reason === 'control-error' || reason === 'offline-cache-invalid';
            publish({
                phase: phase || 'blocked',
                authoritative: null,
                writable: false,
                offline: false,
                local: localStatus || state.local,
                remote: remoteStatus || state.remote,
                reason: reason || 'blocked',
                error: errorSummary(underlyingError),
            });
            throw makeError(
                phase === 'conflict' ? 'AVATAR_STORAGE_CONFLICT' : 'AVATAR_STORAGE_BLOCKED',
                phase === 'conflict'
                    ? '本地和后端头像数据存在冲突，已停止自动接管'
                    : localFailure ? '头像本地存储初始化失败' : '头像后端同步未能安全完成',
                clone(state)
            );
        }
        function storeForSnapshot(snapshot) {
            return ns.createAvatarStore({ adapter: storageApi.createMemoryAdapter(snapshot) });
        }
        function setActiveSnapshot(snapshot) {
            activeSnapshot = storageApi.normalizeSnapshot(snapshot);
            activeStore = storeForSnapshot(activeSnapshot);
            return activeSnapshot;
        }
        function setActivePersistentStore(store) {
            activeSnapshot = null;
            activeStore = store;
            return store;
        }
        function selectCacheStore(name) {
            name = normalizeCacheDatabaseName(name, baseCacheDatabaseName);
            if (name === cacheDatabaseName) return cacheStore;
            cacheDatabaseName = name;
            cacheStore = createCacheStore(name);
            if (!cacheStore) throw makeError('AVATAR_CACHE_INVALID', '头像缓存数据库无法打开');
            return cacheStore;
        }
        function useLocal(local, remoteStatus, reason, error) {
            return validateLocal(local).then(function () {
                setActivePersistentStore(localStore);
                return publish({
                    phase: 'local-ready',
                    authoritative: 'local',
                    writable: true,
                    offline: false,
                    remote: remoteStatus || 'unavailable',
                    reason: reason || 'shared-backend-unavailable',
                    error: errorSummary(error),
                });
            });
        }
        function assetMetadata(raw) {
            var asset = storageApi.normalizeAsset(Object.assign({}, raw, { imageData: 'verified-cache-main', thumbData: 'verified-cache-thumb' }));
            delete asset.imageData;
            delete asset.thumbData;
            return asset;
        }
        function normalizedStoreRecords(store) {
            return Promise.resolve(store.ready).then(function () {
                return Promise.all([store.listAssets(), store.listBindings(), store.listNativeViews(), store.listSourceIntents()]);
            }).then(function (parts) {
                var assets = (parts[0] || []).map(assetMetadata);
                var assetIds = new Set();
                assets.forEach(function (asset) {
                    if (assetIds.has(asset.id)) throw makeError('AVATAR_CACHE_INVALID', '头像缓存包含重复资产');
                    assetIds.add(asset.id);
                });
                var bindings = (parts[1] || []).map(storageApi.normalizeBinding);
                var bindingIds = new Set();
                bindings.forEach(function (binding) {
                    if (bindingIds.has(binding.id) || !assetIds.has(binding.avatarId)) throw makeError('AVATAR_CACHE_INVALID', '头像缓存包含重复或悬空绑定');
                    bindingIds.add(binding.id);
                });
                var nativeViews = (parts[2] || []).map(storageApi.normalizeNativeView);
                var nativeIds = new Set();
                nativeViews.forEach(function (record) {
                    if (nativeIds.has(record.id)) throw makeError('AVATAR_CACHE_INVALID', '头像缓存包含重复原头像调整');
                    nativeIds.add(record.id);
                });
                var sourceIntents = (parts[3] || []).map(storageApi.normalizeSourceIntent);
                var sourceIds = new Set();
                sourceIntents.forEach(function (record) {
                    if (sourceIds.has(record.id)) throw makeError('AVATAR_CACHE_INVALID', '头像缓存包含重复来源意图');
                    sourceIds.add(record.id);
                });
                function byId(left, right) { return left.id < right.id ? -1 : left.id > right.id ? 1 : 0; }
                return {
                    assets: assets.sort(byId),
                    bindings: bindings.sort(byId),
                    nativeViews: nativeViews.sort(byId),
                    sourceIntents: sourceIntents.sort(byId),
                };
            });
        }
        function validateStoredAssets(store, records) {
            return forEachSequential(records.assets, function (metadata) {
                return store.getAsset(metadata.id).then(function (storedAsset) {
                    if (!storedAsset) throw makeError('AVATAR_CACHE_INVALID', '头像存储缺少主图或缩略图', { avatarId: metadata.id });
                    var normalized = storageApi.normalizeAsset(storedAsset);
                    if (stableStringify(assetMetadata(normalized)) !== stableStringify(metadata)) {
                        throw makeError('AVATAR_CACHE_INVALID', '头像存储的图片与元数据不一致', { avatarId: metadata.id });
                    }
                    storedAsset = null;
                    normalized = null;
                });
            });
        }
        function classifyLocal() {
            return normalizedStoreRecords(localStore).then(function (records) {
                var empty = !records.assets.length && !records.bindings.length && !records.nativeViews.length && !records.sourceIntents.length;
                return { status: empty ? 'empty' : 'present', records: records, validated: empty };
            }).catch(function (error) {
                return { status: error && error.code === 'AVATAR_SNAPSHOT_INVALID' || error && /INVALID/.test(error.code || '') ? 'invalid' : 'error', error: error };
            });
        }
        function validateLocal(local) {
            if (local.validated || local.status !== 'present') return Promise.resolve(local);
            return validateStoredAssets(localStore, local.records).then(function () {
                local.validated = true;
                return local;
            });
        }
        function loadLocalSnapshot(local) {
            if (local.snapshot) return Promise.resolve(local);
            return localStore.readSnapshot().then(function (snapshot) {
                local.snapshot = storageApi.normalizeSnapshot(snapshot);
                local.status = storageApi.snapshotIsEmpty(local.snapshot) ? 'empty' : 'present';
                return local;
            });
        }
        function readControl() {
            return Promise.resolve(controlStore.ready).then(function () { return controlStore.get(); }).then(function (raw) {
                if (!raw) return { status: 'empty', control: null };
                return { status: 'present', control: normalizeControl(raw, storageApi, baseCacheDatabaseName) };
            }).catch(function (error) { return { status: 'error', error: error }; });
        }
        function verifyBlob(dataUrl, ref) {
            ref = normalizeImageRef(ref);
            var inspection;
            try { inspection = inspectDataUrl(dataUrl); }
            finally { dataUrl = null; }
            return Promise.resolve(inspection).then(function (actual) {
                actual = actual || {};
                if (clean(actual.sha256).toLowerCase() !== ref.sha256 || Number(actual.bytes) !== ref.bytes || normalizeMime(actual.mime) !== ref.mime) {
                    throw makeError('AVATAR_BLOB_MISMATCH', '头像图片与后端校验信息不一致', { name: ref.name });
                }
                return ref;
            });
        }
        function uploadVerified(dataUrl) {
            return Promise.all([inspectDataUrl(dataUrl), remote.upload(dataUrl)]).then(function (parts) {
                var actual = parts[0] || {};
                var ref = normalizeImageRef(parts[1]);
                if (clean(actual.sha256).toLowerCase() !== ref.sha256 || Number(actual.bytes) !== ref.bytes || normalizeMime(actual.mime) !== ref.mime) {
                    throw makeError('AVATAR_IMAGE_UPLOAD_MISMATCH', '后端返回的头像图片校验信息不一致', { name: ref.name });
                }
                return ref;
            });
        }
        function verifyCacheBatch(workerUrl, assets) {
            return new Promise(function (resolve, reject) {
                var worker;
                var timeout;
                var settled = false;
                function finish(error) {
                    if (settled) return;
                    settled = true;
                    if (timeout) global.clearTimeout(timeout);
                    if (worker) worker.terminate();
                    if (error) reject(error);
                    else resolve();
                }
                try { worker = new global.Worker(workerUrl); }
                catch (error) { finish(makeError('AVATAR_CACHE_VERIFY_UNAVAILABLE', '头像缓存隔离校验无法启动', { cause: error.message })); return; }
                worker.onmessage = function (event) {
                    var result = event.data || {};
                    if (result.ok === true) finish();
                    else finish(makeError(clean(result.code) || 'AVATAR_CACHE_INVALID', clean(result.message) || '头像缓存校验失败'));
                };
                worker.onerror = function (event) {
                    finish(makeError('AVATAR_CACHE_VERIFY_UNAVAILABLE', '头像缓存隔离校验异常', { cause: clean(event && event.message) }));
                };
                timeout = global.setTimeout(function () {
                    finish(makeError('AVATAR_CACHE_VERIFY_TIMEOUT', '头像缓存隔离校验超时'));
                }, CACHE_VERIFY_TIMEOUT_MS);
                try {
                    worker.postMessage({
                        databaseName: cacheDatabaseName,
                        items: assets.map(function (asset) {
                            return { id: asset.id, image: clone(asset.image), thumbnail: clone(asset.thumbnail) };
                        }),
                    });
                } catch (error) {
                    finish(makeError('AVATAR_CACHE_VERIFY_UNAVAILABLE', '头像缓存隔离校验请求失败', { cause: error.message }));
                }
            });
        }
        function verifyCacheImages(store, assets) {
            var isolated = store === cacheStore && inspectDataUrl === defaultInspectDataUrl &&
                typeof global.Worker === 'function' && typeof global.Blob === 'function' && global.URL &&
                typeof global.URL.createObjectURL === 'function' && global.indexedDB;
            if (!isolated) {
                return forEachSequential(assets, function (manifestAsset) {
                    return store.getAsset(manifestAsset.id).then(function (cachedAsset) {
                        if (!cachedAsset) throw makeError('AVATAR_CACHE_INVALID', '头像缓存缺少图片', { avatarId: manifestAsset.id });
                        var imageData = cachedAsset.imageData;
                        var thumbData = cachedAsset.thumbData;
                        cachedAsset = null;
                        return verifyBlob(imageData, manifestAsset.image).then(function () {
                            imageData = '';
                            return verifyBlob(thumbData, manifestAsset.thumbnail);
                        }).then(function () { thumbData = ''; });
                    });
                });
            }
            var workerUrl = global.URL.createObjectURL(new global.Blob([cacheVerifierWorkerSource()], { type: 'text/javascript' }));
            var batches = [];
            for (var offset = 0; offset < assets.length; offset += CACHE_VERIFY_BATCH_SIZE) {
                batches.push(assets.slice(offset, offset + CACHE_VERIFY_BATCH_SIZE));
            }
            return forEachSequential(batches, function (batch) { return verifyCacheBatch(workerUrl, batch); }).finally(function () {
                global.URL.revokeObjectURL(workerUrl);
            });
        }
        function validateCacheStore(store, manifest) {
            var normalized = normalizeManifest(manifest, storageApi);
            var expected = {
                assets: normalized.manifest.assets.map(assetMetadata),
                bindings: normalized.manifest.bindings.map(storageApi.normalizeBinding),
                nativeViews: normalized.manifest.nativeViews.map(storageApi.normalizeNativeView),
                sourceIntents: normalized.manifest.sourceIntents.map(storageApi.normalizeSourceIntent),
            };
            Object.keys(expected).forEach(function (key) {
                expected[key].sort(function (left, right) { return left.id < right.id ? -1 : left.id > right.id ? 1 : 0; });
            });
            return normalizedStoreRecords(store).then(function (actual) {
                if (stableStringify(actual) !== stableStringify(expected)) {
                    throw makeError('AVATAR_CACHE_INVALID', '头像最后已知正常缓存与远端 manifest 不一致');
                }
                return verifyCacheImages(store, normalized.manifest.assets);
            }).then(function () { return normalized; });
        }
        function hydrateIntoStore(store, manifest) {
            var normalized = normalizeManifest(manifest, storageApi);
            return Promise.resolve(store.ready).then(function () { return store.clear(); }).then(function () {
                return forEachSequential(normalized.manifest.assets, function (manifestAsset) {
                    var imageData;
                    return remote.download(manifestAsset.image).then(function (dataUrl) {
                        imageData = dataUrl;
                        return verifyBlob(dataUrl, manifestAsset.image);
                    }).then(function () {
                        return remote.download(manifestAsset.thumbnail);
                    }).then(function (thumbData) {
                        return verifyBlob(thumbData, manifestAsset.thumbnail).then(function () {
                            return store.putAsset(Object.assign({}, manifestAsset, { imageData: imageData, thumbData: thumbData })).then(function () {
                                imageData = '';
                                thumbData = '';
                            });
                        });
                    });
                });
            }).then(function () {
                if (!normalized.manifest.bindings.length) return null;
                return store.mutateBindings(normalized.manifest.bindings.map(function (binding) { return { type: 'put', binding: binding }; }));
            }).then(function () {
                return forEachSequential(normalized.manifest.nativeViews, function (record) { return store.putNativeView(record); });
            }).then(function () {
                return forEachSequential(normalized.manifest.sourceIntents, function (record) { return store.putSourceIntent(record); });
            }).then(function () { return validateCacheStore(store, normalized.manifest); });
        }
        function activateRemoteCache(remoteState, normalized, writable, offline, localStatus, reason) {
            setActivePersistentStore(cacheStore);
            remoteManifest = normalized.manifest;
            remoteRefs = normalized.refs;
            datasetId = remoteState.datasetId;
            revision = remoteState.revision;
            fingerprint = remoteState.fingerprint;
            return publish({
                phase: 'remote-ready', authoritative: 'remote', writable: writable, offline: offline,
                local: localStatus || state.local, remote: offline ? 'error' : 'present', reason: reason || '', error: null,
            });
        }
        function persistRemoteReady(snapshot, remoteState, manifest) {
            var normalized = normalizeManifest(manifest, storageApi);
            return cacheStore.replaceSnapshot(snapshot).then(function () {
                return validateCacheStore(cacheStore, normalized.manifest);
            }).then(function () {
                return controlStore.put(controlFromState(remoteState, normalized.manifest, cacheDatabaseName, baseCacheDatabaseName));
            }).then(function () {
                return activateRemoteCache(remoteState, normalized, true, false);
            });
        }
        function loadOfflineCache(control, localStatus) {
            try { selectCacheStore(control.cacheDatabaseName); }
            catch (error) { return Promise.resolve().then(function () { return block('offline-cache-invalid', localStatus, 'error', undefined, error); }); }
            return validateCacheStore(cacheStore, control.manifest).then(function (normalized) {
                return activateRemoteCache(control, normalized, false, true, localStatus, 'last-known-good-cache');
            }).catch(function (error) {
                return block(error.code || 'offline-cache-invalid', localStatus, 'error', undefined, error);
            });
        }
        function sameRemoteState(left, right) {
            if (!left || !right || left.status !== 'present' || right.status !== 'present') return false;
            if (left.datasetId !== right.datasetId || left.revision !== right.revision || left.fingerprint !== right.fingerprint) return false;
            return stableStringify(normalizeManifest(left.manifest, storageApi).manifest) === stableStringify(normalizeManifest(right.manifest, storageApi).manifest);
        }
        function hydrateRemoteReady(remoteState, localStatus) {
            var shadowName = makeCacheDatabaseName(baseCacheDatabaseName);
            var shadowStore = createCacheStore(shadowName);
            return hydrateIntoStore(shadowStore, remoteState.manifest).then(function (normalized) {
                return remote.readState().then(function (readBack) {
                    if (!sameRemoteState(remoteState, readBack)) {
                        throw makeError('AVATAR_REMOTE_CHANGED', '头像后端在缓存重建期间发生变化，已中止切换');
                    }
                    return controlStore.put(controlFromState(readBack, normalized.manifest, shadowName, baseCacheDatabaseName)).then(function () {
                        cacheDatabaseName = shadowName;
                        cacheStore = shadowStore;
                        return activateRemoteCache(readBack, normalized, true, false, localStatus);
                    });
                });
            });
        }
        function reuseOrHydrateRemote(control, remoteState, localStatus) {
            var controlMatches = control && control.datasetId === remoteState.datasetId && control.revision === remoteState.revision &&
                control.fingerprint === remoteState.fingerprint && stableStringify(control.manifest) === stableStringify(normalizeManifest(remoteState.manifest, storageApi).manifest);
            if (!controlMatches) return hydrateRemoteReady(remoteState, localStatus);
            try { selectCacheStore(control.cacheDatabaseName); }
            catch (_) { return hydrateRemoteReady(remoteState, localStatus); }
            return validateCacheStore(cacheStore, remoteState.manifest).then(function (normalized) {
                return activateRemoteCache(remoteState, normalized, true, false, localStatus);
            }).catch(function (error) {
                if (error && (error.code === 'AVATAR_CACHE_VERIFY_UNAVAILABLE' || error.code === 'AVATAR_CACHE_VERIFY_TIMEOUT')) throw error;
                return hydrateRemoteReady(remoteState, localStatus);
            });
        }
        function migrateLocal(local) {
            var refs = new Map();
            return local.snapshot.assets.reduce(function (promise, asset) {
                return promise.then(function () {
                    return Promise.all([uploadVerified(asset.imageData), uploadVerified(asset.thumbData)]).then(function (pair) {
                        refs.set(asset.id, { image: pair[0], thumbnail: pair[1] });
                    });
                });
            }, Promise.resolve()).then(function () {
                var manifest = manifestFromSnapshot(local.snapshot, refs, storageApi);
                var proposedId = makeDatasetId();
                return remote.commit({ expectedRevision: 0, datasetId: proposedId, manifest: manifest }).then(function (committed) {
                    var normalized = normalizeManifest(committed.manifest, storageApi).manifest;
                    if (committed.datasetId !== proposedId || committed.revision !== 1 || stableStringify(normalized) !== stableStringify(manifest)) {
                        throw makeError('AVATAR_MIGRATION_VERIFY_FAILED', '头像迁移提交响应校验失败');
                    }
                    return remote.readState().then(function (readBack) {
                        if (readBack.status !== 'present' || readBack.datasetId !== committed.datasetId || readBack.revision !== committed.revision ||
                            readBack.fingerprint !== committed.fingerprint || stableStringify(normalizeManifest(readBack.manifest, storageApi).manifest) !== stableStringify(manifest)) {
                            throw makeError('AVATAR_MIGRATION_VERIFY_FAILED', '头像迁移整体回读校验失败');
                        }
                        return persistRemoteReady(local.snapshot, readBack, manifest);
                    });
                });
            });
        }
        function initializeImpl() {
            var remoteWriteStarted = false;
            publish({ phase: 'probing', authoritative: null, writable: false, offline: false, reason: '', error: null });
            if (startupLock) return Promise.resolve().then(function () { return block('recovery-incomplete', 'unknown', 'unknown', 'blocked', startupLock.error || startupLock); });
            return Promise.all([classifyLocal(), readControl()]).then(function (parts) {
                var local = parts[0];
                var controlResult = parts[1];
                publish({ local: local.status });
                if (controlResult.status === 'error') return block('control-error', local.status, 'unknown', undefined, controlResult.error);
                if (controlResult.status !== 'present' && (local.status === 'invalid' || local.status === 'error')) {
                    return block('local-' + local.status, local.status, 'unknown', undefined, local.error);
                }
                if (!sharedBackendAvailable()) {
                    if (controlResult.status === 'present') return loadOfflineCache(controlResult.control, local.status);
                    return useLocal(local, 'unavailable', 'shared-backend-unavailable');
                }
                return Promise.resolve(remote.probeCapability()).then(function (capability) {
                    if (!capability || capability.status === 'unsupported') {
                        if (controlResult.status === 'present') {
                            if (isBackendAvailable) return loadOfflineCache(controlResult.control, local.status);
                            return block('remote-capability-lost', local.status, 'unsupported');
                        }
                        return useLocal(local, 'unsupported', capability && capability.reason || 'unsupported');
                    }
                    if (capability.status !== 'supported') {
                        if (controlResult.status === 'present' && isBackendAvailable) return loadOfflineCache(controlResult.control, local.status);
                        if (isBackendAvailable) return useLocal(local, 'invalid', 'capability-invalid');
                        return block('capability-invalid', local.status, 'invalid');
                    }
                    return Promise.resolve(remote.readState()).then(function (remoteState) {
                        if (!remoteState || remoteState.status === 'invalid') {
                            if (controlResult.status === 'present' && isBackendAvailable) return loadOfflineCache(controlResult.control, local.status);
                            if (isBackendAvailable) return useLocal(local, 'invalid', 'remote-invalid', remoteState && remoteState.error);
                            return block('remote-invalid', local.status, 'invalid');
                        }
                        if (remoteState.status === 'empty') {
                            if (controlResult.status === 'present') return block('remote-became-empty', local.status, 'empty', 'conflict');
                            if (local.status === 'present') {
                                remoteWriteStarted = true;
                                return loadLocalSnapshot(local).then(migrateLocal);
                            }
                            setActiveSnapshot(emptySnapshot());
                            datasetId = makeDatasetId();
                            revision = 0;
                            remoteManifest = null;
                            remoteRefs = new Map();
                            return publish({ phase: 'remote-ready', authoritative: 'remote', writable: true, offline: false, remote: 'empty', reason: 'cas-initialize-on-first-write', error: null });
                        }
                        if (remoteState.status !== 'present') {
                            if (controlResult.status === 'present' && isBackendAvailable) return loadOfflineCache(controlResult.control, local.status);
                            if (isBackendAvailable) return useLocal(local, 'invalid', 'remote-state-invalid');
                            return block('remote-state-invalid', local.status, 'invalid');
                        }
                        if (controlResult.status !== 'present' && local.status === 'present') return block('both-present', local.status, 'present', 'conflict');
                        if (controlResult.status === 'present' && controlResult.control.datasetId !== remoteState.datasetId) {
                            return block('dataset-id-conflict', local.status, 'present', 'conflict');
                        }
                        return reuseOrHydrateRemote(controlResult.control, remoteState, local.status);
                    });
                }).catch(function (error) {
                    if (error && (error.code === 'AVATAR_STORAGE_BLOCKED' || error.code === 'AVATAR_STORAGE_CONFLICT')) throw error;
                    if (error && error.code === 'AVATAR_REVISION_CONFLICT') {
                        return block('revision-conflict', local.status, 'present', 'conflict', error);
                    }
                    if (controlResult.status === 'present' && error && (error.code === 'AVATAR_BACKEND_ERROR' || error.code === 'AVATAR_HTTP_ERROR' || error.code === 'AVATAR_BACKEND_INVALID')) {
                        return loadOfflineCache(controlResult.control, local.status);
                    }
                    if (!remoteWriteStarted && isBackendAvailable && error && error.details && (error.details.stage === 'capability' || error.details.stage === 'state' || error.details.stage === 'download')) {
                        return useLocal(local, error.code === 'AVATAR_BACKEND_INVALID' ? 'invalid' : 'error', 'backend-unavailable', error);
                    }
                    return block(error && error.code || 'backend-error', local.status, error && error.code === 'AVATAR_BACKEND_INVALID' ? 'invalid' : 'error', undefined, error);
                });
            });
        }
        function initialize() {
            if (!initialization) initialization = initializeImpl();
            return initialization;
        }
        function ensureActive() {
            return initialize().then(function () {
                if (!activeStore || (state.phase !== 'local-ready' && state.phase !== 'remote-ready')) throw makeError('AVATAR_STORAGE_BLOCKED', '头像存储尚未就绪', clone(state));
                return activeStore;
            });
        }
        function ensureWritable() {
            if (recoveryBarrierRequested || recoveryBarrierDepth > 0 || isExternalWriteBlocked()) throw makeError('AVATAR_RECOVERY_LOCKED', '头像恢复事务进行中，当前禁止修改数据');
            if (!state.writable) throw makeError('AVATAR_STORAGE_READ_ONLY', state.offline ? '头像后端离线，当前仅可读取最后已验证缓存' : '头像存储当前为只读', clone(state));
            if (readBarrierDepth > 0) throw makeError('AVATAR_EXPORT_IN_PROGRESS', '头像导出期间暂时不能修改头像数据');
        }
        function consistencyState() {
            return initialize().then(function () {
                if (!activeStore || state.phase === 'blocked' || state.phase === 'conflict' ||
                    (state.phase !== 'local-ready' && state.phase !== 'remote-ready')) {
                    throw makeError('AVATAR_BACKUP_UNAVAILABLE', '头像存储异常或冲突时不能创建完整备份', clone(state));
                }
                var base = {
                    phase: state.phase,
                    authority: state.authoritative,
                    consistency: state.offline ? 'last-known-good' : 'verified',
                    offline: state.offline === true,
                    datasetId: state.authoritative === 'remote' ? datasetId : null,
                    revision: state.authoritative === 'remote' ? revision : null,
                    fingerprint: state.authoritative === 'remote' ? fingerprint : '',
                };
                if (state.authoritative !== 'remote' || state.offline) return base;
                return remote.readState().then(function (current) {
                    if (!current || current.status !== 'present' || current.datasetId !== datasetId || current.revision !== revision || current.fingerprint !== fingerprint) {
                        throw makeError('AVATAR_EXPORT_SOURCE_CHANGED', '远端头像数据在备份期间发生变化，请刷新后重试', {
                            expected: { datasetId: datasetId, revision: revision, fingerprint: fingerprint },
                            current: current && { status: current.status, datasetId: current.datasetId, revision: current.revision, fingerprint: current.fingerprint },
                        });
                    }
                    normalizeManifest(current.manifest, storageApi);
                    return base;
                });
            });
        }
        function runReadBarrier(task) {
            if (typeof task !== 'function') return Promise.reject(makeError('AVATAR_EXPORT_INVALID', '头像只读任务无效'));
            if (recoveryBarrierRequested || recoveryBarrierDepth > 0 || isExternalWriteBlocked()) return Promise.reject(makeError('AVATAR_RECOVERY_LOCKED', '头像恢复事务进行中，当前不能导出'));
            return ensureActive().then(function () {
                if (readBarrierDepth > 0 || readBarrierRequested) throw makeError('AVATAR_EXPORT_BUSY', '已有头像只读任务正在进行');
                readBarrierRequested = true;
                return writeTail.then(function () {
                    readBarrierDepth += 1;
                    readBarrierRequested = false;
                    return task();
                }).finally(function () {
                    readBarrierRequested = false;
                    if (readBarrierDepth > 0) readBarrierDepth -= 1;
                });
            });
        }
        function rebindLocalStore(nextStore, proof) {
            if (recoveryBarrierDepth < 1) return Promise.reject(makeError('AVATAR_RECOVERY_LOCKED', '只能在恢复事务栅栏内切换头像库'));
            if (!nextStore || !proof || proof.verified !== true || !clean(proof.databaseName)) {
                return Promise.reject(makeError('AVATAR_RECOVERY_VERIFY_FAILED', '头像影子库缺少完整验证证据'));
            }
            return Promise.resolve(nextStore.ready).then(function () {
                localStore = nextStore;
                activeStore = nextStore;
                activeSnapshot = null;
                remoteManifest = null;
                remoteRefs = new Map();
                datasetId = null;
                revision = 0;
                fingerprint = '';
                startupLock = null;
                var next = publish({
                    phase: 'local-ready', authoritative: 'local', writable: true, offline: false,
                    local: proof.empty === true ? 'empty' : 'present', remote: 'unavailable', reason: 'local-dataset-rebound', error: null,
                });
                initialization = Promise.resolve(next);
                return next;
            });
        }
        function runRecoveryBarrier(task) {
            if (typeof task !== 'function') return Promise.reject(makeError('AVATAR_RECOVERY_INVALID', '头像恢复事务无效'));
            if (readBarrierRequested || readBarrierDepth > 0 || recoveryBarrierRequested || recoveryBarrierDepth > 0) {
                return Promise.reject(makeError('AVATAR_RECOVERY_BUSY', '已有头像导出或恢复任务正在进行'));
            }
            recoveryBarrierRequested = true;
            return writeTail.then(function () {
                recoveryBarrierDepth += 1;
                recoveryBarrierRequested = false;
                return task({ rebindLocalStore: rebindLocalStore });
            }).finally(function () {
                recoveryBarrierRequested = false;
                if (recoveryBarrierDepth > 0) recoveryBarrierDepth -= 1;
            });
        }
        function isBindingMutation(method) {
            return method === 'putBinding' || method === 'deleteBinding' || method === 'mutateBindings';
        }
        function stageBindingMutation(method, args) {
            var manifest = clone(remoteManifest || emptyManifest());
            var assets = new Set(manifest.assets.map(function (asset) { return asset.id; }));
            var bindings = new Map(manifest.bindings.map(function (binding) { return [binding.id, binding]; }));
            var applyArgs;
            var result;
            function requireAsset(binding) {
                if (!assets.has(binding.avatarId)) throw storageApi.makeError('AVATAR_NOT_FOUND', '绑定引用的头像不存在');
            }
            if (method === 'putBinding') {
                var binding = storageApi.normalizeBinding(args[0]);
                requireAsset(binding);
                bindings.set(binding.id, binding);
                applyArgs = [binding];
                result = clone(binding);
            } else if (method === 'deleteBinding') {
                var themeKey = clean(args[0]);
                var targetKey = clean(args[1]);
                result = bindings.delete(storageApi.bindingId(themeKey, targetKey));
                applyArgs = [themeKey, targetKey];
            } else {
                var operations = storageApi.normalizeBindingMutations(args[0]);
                operations.forEach(function (operation) {
                    if (operation.type === 'put') requireAsset(operation.binding);
                });
                result = operations.map(function (operation) {
                    if (operation.type === 'put') {
                        bindings.set(operation.binding.id, operation.binding);
                        return clone(operation.binding);
                    }
                    return bindings.delete(operation.id);
                });
                applyArgs = [operations.map(function (operation) {
                    return operation.type === 'put'
                        ? { type: 'put', binding: clone(operation.binding) }
                        : { type: 'delete', themeKey: operation.themeKey, targetKey: operation.targetKey };
                })];
            }
            manifest.bindings = Array.from(bindings.values()).map(clone);
            return { manifest: normalizeManifest(manifest, storageApi).manifest, applyArgs: applyArgs, result: result };
        }
        function remoteBindingMutation(method, args) {
            var staged = stageBindingMutation(method, args);
            var manifest = staged.manifest;
            return remote.commit({ expectedRevision: revision, datasetId: datasetId, manifest: manifest }).then(function (committed) {
                var normalized = normalizeManifest(committed.manifest, storageApi);
                if (committed.datasetId !== datasetId || committed.revision !== revision + 1 || !/^sha256:[a-f0-9]{64}$/.test(committed.fingerprint) ||
                    stableStringify(normalized.manifest) !== stableStringify(manifest)) {
                    throw makeError('AVATAR_COMMIT_VERIFY_FAILED', '头像远端写入响应校验失败');
                }
                return Promise.resolve(cacheStore[method].apply(cacheStore, staged.applyArgs)).then(function () {
                    return controlStore.put(controlFromState(committed, normalized.manifest, cacheDatabaseName, baseCacheDatabaseName));
                }).then(function () {
                    if (activeStore === cacheStore) return null;
                    return activeStore[method].apply(activeStore, staged.applyArgs);
                }).then(function () {
                    if (activeSnapshot) activeSnapshot.bindings = clone(normalized.manifest.bindings);
                    remoteManifest = normalized.manifest;
                    remoteRefs = normalized.refs;
                    revision = committed.revision;
                    fingerprint = committed.fingerprint;
                    publish({ phase: 'remote-ready', authoritative: 'remote', writable: true, offline: false, remote: 'present', reason: '', error: null });
                    return clone(staged.result);
                }).catch(function (cacheError) {
                    publish({ phase: 'remote-ready', authoritative: 'remote', writable: false, offline: false, remote: 'present', reason: 'cache-update-failed' });
                    throw makeError('AVATAR_CACHE_UPDATE_FAILED', '远端头像已提交，但本地只读缓存更新失败；已停止后续写入', { cause: cacheError.code || cacheError.message });
                });
            }).catch(function (error) {
                if (error && error.code === 'AVATAR_REVISION_CONFLICT') {
                    publish({ phase: 'conflict', authoritative: null, writable: false, offline: false, remote: 'present', reason: 'revision-conflict', error: errorSummary(error) });
                } else if (!error || error.code !== 'AVATAR_CACHE_UPDATE_FAILED') {
                    publish({ phase: 'remote-ready', authoritative: 'remote', writable: false, offline: false, remote: 'error', reason: 'commit-uncertain', error: errorSummary(error) });
                }
                throw error;
            });
        }
        function stageManifestMutation(method, args, uploadedRefs) {
            var manifest = clone(remoteManifest || emptyManifest());
            var refs = new Map(remoteRefs);
            var applyArgs = args.slice();
            var result;
            if (method === 'putAsset') {
                var asset = storageApi.normalizeAsset(args[0]);
                var record = assetManifestRecord(asset, uploadedRefs);
                var assetIndex = manifest.assets.findIndex(function (item) { return item.id === asset.id; });
                if (assetIndex === -1) manifest.assets.push(record);
                else manifest.assets[assetIndex] = record;
                refs.set(asset.id, uploadedRefs);
                applyArgs = [asset];
                result = clone(asset);
            } else if (method === 'deleteAsset') {
                var assetId = clean(args[0]);
                var removed = manifest.assets.some(function (asset) { return asset.id === assetId; });
                var removedBindings = manifest.bindings.filter(function (binding) { return binding.avatarId === assetId; }).map(clone);
                var sourceIntents = new Map(manifest.sourceIntents.map(function (record) { return [record.id, record]; }));
                var preparedIntents = new Map();
                removedBindings.forEach(function (binding) {
                    if (binding.targetKey !== 'user:global' && !/^character:/.test(binding.targetKey || '')) return;
                    var intent = storageApi.normalizeSourceIntent({ targetKey: binding.targetKey });
                    sourceIntents.set(intent.id, intent);
                    preparedIntents.set(intent.targetKey, intent);
                });
                manifest.assets = manifest.assets.filter(function (asset) { return asset.id !== assetId; });
                manifest.bindings = manifest.bindings.filter(function (binding) { return binding.avatarId !== assetId; });
                manifest.sourceIntents = Array.from(sourceIntents.values()).map(clone);
                refs.delete(assetId);
                applyArgs = [assetId, Array.from(preparedIntents.values()).map(clone)];
                result = { removed: removed, bindings: removedBindings };
            } else if (method === 'clear') {
                manifest = emptyManifest();
                refs.clear();
                applyArgs = [];
            } else if (method === 'putNativeView') {
                var nativeView = storageApi.normalizeNativeView(args[0]);
                var nativeViews = new Map(manifest.nativeViews.map(function (record) { return [record.id, record]; }));
                nativeViews.set(nativeView.id, nativeView);
                manifest.nativeViews = Array.from(nativeViews.values()).map(clone);
                applyArgs = [nativeView];
                result = clone(nativeView);
            } else if (method === 'deleteNativeView') {
                var nativeTargetKey = clean(args[0]);
                var nativeId = storageApi.nativeViewId(nativeTargetKey);
                var nativeRemoved = manifest.nativeViews.some(function (record) { return record.id === nativeId; });
                manifest.nativeViews = manifest.nativeViews.filter(function (record) { return record.id !== nativeId; });
                applyArgs = [nativeTargetKey];
                result = nativeRemoved;
            } else if (method === 'putSourceIntent') {
                var sourceIntent = storageApi.normalizeSourceIntent(args[0]);
                var sourceIntentMap = new Map(manifest.sourceIntents.map(function (record) { return [record.id, record]; }));
                sourceIntentMap.set(sourceIntent.id, sourceIntent);
                manifest.sourceIntents = Array.from(sourceIntentMap.values()).map(clone);
                applyArgs = [sourceIntent];
                result = clone(sourceIntent);
            } else if (method === 'deleteSourceIntent') {
                var sourceTargetKey = clean(args[0]);
                var sourceId = storageApi.sourceIntentId(sourceTargetKey);
                var sourceRemoved = manifest.sourceIntents.some(function (record) { return record.id === sourceId; });
                manifest.sourceIntents = manifest.sourceIntents.filter(function (record) { return record.id !== sourceId; });
                applyArgs = [sourceTargetKey];
                result = sourceRemoved;
            } else {
                throw makeError('AVATAR_MUTATION_INVALID', '头像远端写入类型无效', { method: method });
            }
            return {
                manifest: normalizeManifest(manifest, storageApi).manifest,
                refs: refs,
                applyArgs: applyArgs,
                result: result,
            };
        }
        function remoteMutation(method, args) {
            ensureWritable();
            if (isBindingMutation(method)) return remoteBindingMutation(method, args);
            var uploadedRefs = null;
            var preparedArgs = args.slice();
            var prepare = Promise.resolve();
            if (method === 'putAsset') {
                var normalizedAsset = storageApi.normalizeAsset(args[0]);
                preparedArgs[0] = normalizedAsset;
                prepare = Promise.all([uploadVerified(normalizedAsset.imageData), uploadVerified(normalizedAsset.thumbData)]).then(function (pair) {
                    uploadedRefs = { image: pair[0], thumbnail: pair[1] };
                });
            }
            return prepare.then(function () {
                var staged = stageManifestMutation(method, preparedArgs, uploadedRefs);
                var manifest = staged.manifest;
                return remote.commit({ expectedRevision: revision, datasetId: datasetId, manifest: manifest }).then(function (committed) {
                    var normalized = normalizeManifest(committed.manifest, storageApi);
                    if (committed.datasetId !== datasetId || committed.revision !== revision + 1 || !/^sha256:[a-f0-9]{64}$/.test(committed.fingerprint) ||
                        stableStringify(normalized.manifest) !== stableStringify(manifest)) {
                        throw makeError('AVATAR_COMMIT_VERIFY_FAILED', '头像远端写入响应校验失败');
                    }
                    return Promise.resolve(cacheStore[method].apply(cacheStore, staged.applyArgs)).then(function () {
                        return controlStore.put(controlFromState(committed, normalized.manifest, cacheDatabaseName, baseCacheDatabaseName));
                    }).then(function () {
                        if (activeStore === cacheStore) return null;
                        return activeStore[method].apply(activeStore, staged.applyArgs);
                    }).then(function () {
                        remoteManifest = normalized.manifest;
                        remoteRefs = normalized.refs;
                        revision = committed.revision;
                        fingerprint = committed.fingerprint;
                        publish({ phase: 'remote-ready', authoritative: 'remote', writable: true, offline: false, remote: 'present', reason: '', error: null });
                        return clone(staged.result);
                    }).catch(function (cacheError) {
                        publish({ phase: 'remote-ready', authoritative: 'remote', writable: false, offline: false, remote: 'present', reason: 'cache-update-failed' });
                        throw makeError('AVATAR_CACHE_UPDATE_FAILED', '远端头像已提交，但本地只读缓存更新失败；已停止后续写入', { cause: cacheError.code || cacheError.message });
                    });
                }).catch(function (error) {
                    if (error && error.code === 'AVATAR_REVISION_CONFLICT') {
                        publish({ phase: 'conflict', authoritative: null, writable: false, offline: false, remote: 'present', reason: 'revision-conflict', error: errorSummary(error) });
                    } else if (!error || error.code !== 'AVATAR_CACHE_UPDATE_FAILED') {
                        publish({ phase: 'remote-ready', authoritative: 'remote', writable: false, offline: false, remote: 'error', reason: 'commit-uncertain', error: errorSummary(error) });
                    }
                    throw error;
                });
            });
        }
        function callRead(method, args) {
            return ensureActive().then(function (store) { return store[method].apply(store, args); });
        }
        function callWrite(method, args) {
            return ensureActive().then(function (store) {
                if (recoveryBarrierRequested || recoveryBarrierDepth > 0 || isExternalWriteBlocked()) throw makeError('AVATAR_RECOVERY_LOCKED', '头像恢复事务进行中，当前禁止修改数据');
                if (readBarrierRequested || readBarrierDepth > 0) throw makeError('AVATAR_EXPORT_IN_PROGRESS', '头像导出期间暂时不能修改头像数据');
                ensureWritable();
                var task = writeTail.then(function () {
                    if (state.authoritative === 'local') return store[method].apply(store, args);
                    return remoteMutation(method, args);
                });
                writeTail = task.catch(function () {});
                return task;
            });
        }
        var store = {};
        ['listAssets', 'getAssetMetadata', 'getAsset', 'getThumbnail', 'listBindings', 'getBinding', 'getNativeView',
            'getSourceIntent', 'listNativeViews', 'listSourceIntents', 'readSnapshot'].forEach(function (method) {
            store[method] = function () { return callRead(method, Array.prototype.slice.call(arguments)); };
        });
        ['putAsset', 'putBinding', 'deleteBinding', 'mutateBindings', 'putNativeView', 'deleteNativeView', 'putSourceIntent',
            'deleteSourceIntent', 'deleteAsset', 'clear'].forEach(function (method) {
            store[method] = function () { return callWrite(method, Array.prototype.slice.call(arguments)); };
        });
        Object.defineProperty(store, 'ready', { get: function () { return initialize(); } });
        store.versions = clone(localStore.versions || {});

        return {
            initialize: initialize,
            store: store,
            getState: function () { return clone(state); },
            getConsistencyState: consistencyState,
            runReadBarrier: runReadBarrier,
            runRecoveryBarrier: runRecoveryBarrier,
            canMutate: function () { return !isExternalWriteBlocked() && !recoveryBarrierRequested && recoveryBarrierDepth === 0 && !readBarrierRequested && readBarrierDepth === 0 && state.writable === true && (state.phase === 'local-ready' || state.phase === 'remote-ready'); },
            isRuntimeReady: function () { return state.phase === 'local-ready' || state.phase === 'remote-ready'; },
        };
    };

    ns.avatarSync = {
        SERVER_BASE: SERVER_BASE,
        CACHE_DB_NAME: CACHE_DB_NAME,
        CONTROL_DB_NAME: CONTROL_DB_NAME,
        MANIFEST_VERSION: MANIFEST_VERSION,
        createMemoryControlStore: createMemoryControlStore,
        createIndexedDbControlStore: createIndexedDbControlStore,
        createRemoteApi: createRemoteApi,
        normalizeManifest: normalizeManifest,
        manifestFromSnapshot: manifestFromSnapshot,
        refsFromManifest: refsFromManifest,
        stableStringify: stableStringify,
        inspectDataUrl: defaultInspectDataUrl,
        makeError: makeError,
    };
})(window);
