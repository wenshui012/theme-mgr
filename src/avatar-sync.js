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
        return global.crypto.subtle.digest('SHA-256', bytes).then(function (hash) {
            return { sha256: 'sha256:' + bytesToHex(hash), bytes: bytes.length, mime: normalizeMime(match[1]) };
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

    function normalizeControl(raw, storageApi) {
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
            updatedAt: clean(raw.updatedAt),
        };
    }
    function controlFromState(remoteState, manifest) {
        return {
            version: CONTROL_VERSION,
            mode: 'remote-authoritative',
            datasetId: remoteState.datasetId,
            revision: remoteState.revision,
            fingerprint: remoteState.fingerprint,
            manifest: clone(manifest),
            updatedAt: new Date().toISOString(),
        };
    }

    ns.createAvatarStorageCoordinator = function (options) {
        options = options || {};
        var storageApi = options.avatarStorage || ns.avatarStorage;
        if (!storageApi || !storageApi.normalizeSnapshot) throw makeError('AVATAR_COORDINATOR_UNAVAILABLE', '头像存储协调器缺少本地存储模块');
        var localStore = options.localStore || ns.createAvatarStore({ dbName: options.localDbName || storageApi.DB_NAME });
        var cacheStore = options.cacheStore || ns.createAvatarStore({ dbName: options.cacheDbName || CACHE_DB_NAME });
        var controlStore = options.controlStore || createIndexedDbControlStore(
            hasOwn(options, 'indexedDB') ? options.indexedDB : global.indexedDB,
            options.controlDbName || CONTROL_DB_NAME
        );
        var remote = options.remote || createRemoteApi(options);
        var inspectDataUrl = options.inspectDataUrl || defaultInspectDataUrl;
        var onStateChange = options.onStateChange || function () {};
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
        function block(reason, localStatus, remoteStatus, phase, underlyingError) {
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
                phase === 'conflict' ? '本地和后端头像数据存在冲突，已停止自动接管' : '头像存储尚未安全就绪',
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
        function classifyLocal() {
            return Promise.resolve(localStore.ready).then(function () { return localStore.readSnapshot(); }).then(function (snapshot) {
                snapshot = storageApi.normalizeSnapshot(snapshot);
                return { status: storageApi.snapshotIsEmpty(snapshot) ? 'empty' : 'present', snapshot: snapshot };
            }).catch(function (error) {
                return { status: error && error.code === 'AVATAR_SNAPSHOT_INVALID' || error && /INVALID/.test(error.code || '') ? 'invalid' : 'error', error: error };
            });
        }
        function readControl() {
            return Promise.resolve(controlStore.ready).then(function () { return controlStore.get(); }).then(function (raw) {
                if (!raw) return { status: 'empty', control: null };
                return { status: 'present', control: normalizeControl(raw, storageApi) };
            }).catch(function (error) { return { status: 'error', error: error }; });
        }
        function verifyBlob(dataUrl, ref) {
            ref = normalizeImageRef(ref);
            return Promise.resolve(inspectDataUrl(dataUrl)).then(function (actual) {
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
        function hydrateManifest(manifest) {
            var normalized = normalizeManifest(manifest, storageApi);
            return Promise.all(normalized.manifest.assets.map(function (asset) {
                return Promise.all([remote.download(asset.image), remote.download(asset.thumbnail)]).then(function (data) {
                    return Promise.all([verifyBlob(data[0], asset.image), verifyBlob(data[1], asset.thumbnail)]).then(function () {
                        return Object.assign({}, asset, { imageData: data[0], thumbData: data[1] });
                    });
                });
            })).then(function (assets) {
                return storageApi.normalizeSnapshot({
                    assets: assets,
                    bindings: normalized.manifest.bindings,
                    nativeViews: normalized.manifest.nativeViews,
                    sourceIntents: normalized.manifest.sourceIntents,
                });
            });
        }
        function validateCachedSnapshot(snapshot, manifest) {
            snapshot = storageApi.normalizeSnapshot(snapshot);
            var normalized = normalizeManifest(manifest, storageApi);
            var rebuilt = manifestFromSnapshot(snapshot, normalized.refs, storageApi);
            if (stableStringify(rebuilt) !== stableStringify(normalized.manifest)) {
                return Promise.reject(makeError('AVATAR_CACHE_INVALID', '头像最后已知正常缓存与远端 manifest 不一致'));
            }
            return Promise.all(snapshot.assets.map(function (asset) {
                var refs = normalized.refs.get(asset.id);
                return Promise.all([verifyBlob(asset.imageData, refs.image), verifyBlob(asset.thumbData, refs.thumbnail)]);
            })).then(function () { return snapshot; });
        }
        function persistRemoteReady(snapshot, remoteState, manifest) {
            var normalized = normalizeManifest(manifest, storageApi);
            return cacheStore.replaceSnapshot(snapshot).then(function () {
                return controlStore.put(controlFromState(remoteState, normalized.manifest));
            }).then(function () {
                setActiveSnapshot(snapshot);
                remoteManifest = normalized.manifest;
                remoteRefs = normalized.refs;
                datasetId = remoteState.datasetId;
                revision = remoteState.revision;
                fingerprint = remoteState.fingerprint;
                return publish({ phase: 'remote-ready', authoritative: 'remote', writable: true, offline: false, remote: 'present', reason: '', error: null });
            });
        }
        function loadOfflineCache(control, localStatus) {
            return cacheStore.readSnapshot().then(function (snapshot) { return validateCachedSnapshot(snapshot, control.manifest); }).then(function (snapshot) {
                var normalized = normalizeManifest(control.manifest, storageApi);
                setActiveSnapshot(snapshot);
                remoteManifest = normalized.manifest;
                remoteRefs = normalized.refs;
                datasetId = control.datasetId;
                revision = control.revision;
                fingerprint = control.fingerprint;
                return publish({ phase: 'remote-ready', authoritative: 'remote', writable: false, offline: true, local: localStatus, remote: 'error', reason: 'last-known-good-cache' });
            }).catch(function (error) {
                return block(error.code || 'offline-cache-invalid', localStatus, 'error', undefined, error);
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
            publish({ phase: 'probing', authoritative: null, writable: false, offline: false, reason: '', error: null });
            return Promise.all([classifyLocal(), readControl()]).then(function (parts) {
                var local = parts[0];
                var controlResult = parts[1];
                publish({ local: local.status });
                if (controlResult.status === 'error') return block('control-error', local.status, 'unknown', undefined, controlResult.error);
                if (controlResult.status !== 'present' && (local.status === 'invalid' || local.status === 'error')) {
                    return block('local-' + local.status, local.status, 'unknown', undefined, local.error);
                }
                return Promise.resolve(remote.probeCapability()).then(function (capability) {
                    if (!capability || capability.status === 'unsupported') {
                        if (controlResult.status === 'present') return block('remote-capability-lost', local.status, 'unsupported');
                        setActiveSnapshot(local.snapshot);
                        activeStore = localStore;
                        return publish({ phase: 'local-ready', authoritative: 'local', writable: true, offline: false, remote: 'unsupported', reason: capability && capability.reason || 'unsupported', error: null });
                    }
                    if (capability.status !== 'supported') return block('capability-invalid', local.status, 'invalid');
                    return Promise.resolve(remote.readState()).then(function (remoteState) {
                        if (!remoteState || remoteState.status === 'invalid') return block('remote-invalid', local.status, 'invalid');
                        if (remoteState.status === 'empty') {
                            if (controlResult.status === 'present') return block('remote-became-empty', local.status, 'empty', 'conflict');
                            if (local.status === 'present') return migrateLocal(local);
                            setActiveSnapshot(emptySnapshot());
                            datasetId = makeDatasetId();
                            revision = 0;
                            remoteManifest = null;
                            remoteRefs = new Map();
                            return publish({ phase: 'remote-ready', authoritative: 'remote', writable: true, offline: false, remote: 'empty', reason: 'cas-initialize-on-first-write', error: null });
                        }
                        if (remoteState.status !== 'present') return block('remote-state-invalid', local.status, 'invalid');
                        if (controlResult.status !== 'present' && local.status === 'present') return block('both-present', local.status, 'present', 'conflict');
                        if (controlResult.status === 'present' && controlResult.control.datasetId !== remoteState.datasetId) {
                            return block('dataset-id-conflict', local.status, 'present', 'conflict');
                        }
                        return hydrateManifest(remoteState.manifest).then(function (snapshot) {
                            return persistRemoteReady(snapshot, remoteState, remoteState.manifest);
                        });
                    });
                }).catch(function (error) {
                    if (error && (error.code === 'AVATAR_STORAGE_BLOCKED' || error.code === 'AVATAR_STORAGE_CONFLICT')) throw error;
                    if (error && error.code === 'AVATAR_REVISION_CONFLICT') {
                        return block('revision-conflict', local.status, 'present', 'conflict', error);
                    }
                    if (controlResult.status === 'present' && error && (error.code === 'AVATAR_BACKEND_ERROR' || error.code === 'AVATAR_HTTP_ERROR')) {
                        return loadOfflineCache(controlResult.control, local.status);
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
            if (!state.writable) throw makeError('AVATAR_STORAGE_READ_ONLY', state.offline ? '头像后端离线，当前仅可读取最后已验证缓存' : '头像存储当前为只读', clone(state));
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
                    return controlStore.put(controlFromState(committed, normalized.manifest));
                }).then(function () {
                    return activeStore[method].apply(activeStore, staged.applyArgs);
                }).then(function () {
                    activeSnapshot.bindings = clone(normalized.manifest.bindings);
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
                var staging = storeForSnapshot(activeSnapshot);
                return Promise.resolve(staging[method].apply(staging, preparedArgs)).then(function (result) {
                    return staging.readSnapshot().then(function (nextSnapshot) {
                        var refs = new Map(remoteRefs);
                        if (method === 'putAsset') refs.set(preparedArgs[0].id, uploadedRefs);
                        if (method === 'deleteAsset') refs.delete(clean(preparedArgs[0]));
                        if (method === 'clear') refs.clear();
                        var manifest = manifestFromSnapshot(nextSnapshot, refs, storageApi);
                        return remote.commit({ expectedRevision: revision, datasetId: datasetId, manifest: manifest }).then(function (committed) {
                            var normalized = normalizeManifest(committed.manifest, storageApi);
                            if (committed.datasetId !== datasetId || committed.revision !== revision + 1 || !/^sha256:[a-f0-9]{64}$/.test(committed.fingerprint) ||
                                stableStringify(normalized.manifest) !== stableStringify(manifest)) {
                                throw makeError('AVATAR_COMMIT_VERIFY_FAILED', '头像远端写入响应校验失败');
                            }
                            return cacheStore.replaceSnapshot(nextSnapshot).then(function () {
                                return controlStore.put(controlFromState(committed, normalized.manifest));
                            }).then(function () {
                                setActiveSnapshot(nextSnapshot);
                                remoteManifest = normalized.manifest;
                                remoteRefs = normalized.refs;
                                revision = committed.revision;
                                fingerprint = committed.fingerprint;
                                publish({ phase: 'remote-ready', authoritative: 'remote', writable: true, offline: false, remote: 'present', reason: '', error: null });
                                return result;
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
                });
            });
        }
        function callRead(method, args) {
            return ensureActive().then(function (store) { return store[method].apply(store, args); });
        }
        function callWrite(method, args) {
            return ensureActive().then(function (store) {
                ensureWritable();
                if (state.authoritative === 'local') return store[method].apply(store, args);
                var task = writeTail.then(function () { return remoteMutation(method, args); });
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
            canMutate: function () { return state.writable === true && (state.phase === 'local-ready' || state.phase === 'remote-ready'); },
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
        makeError: makeError,
    };
})(window);
