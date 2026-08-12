(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createStorage = function (opts) {
        var DB_NAME = opts.DB_NAME;
        var DB_VERSION = opts.DB_VERSION;
        var STORE_NAME = opts.STORE_NAME;
        var DATA_KEY = opts.DATA_KEY;
        var SERVER_BASE = opts.SERVER_BASE;
        var SERVER_IMAGE_PREFIX = opts.SERVER_IMAGE_PREFIX;
        var IMAGE_FIELD_KEYS = opts.IMAGE_FIELD_KEYS;
        var ensureDefaults = opts.ensureDefaults;
        var getPostHeaders = opts.getPostHeaders;
        var LS_KEY = opts.LS_KEY || 'theme_mgr_v2';
        var SYNC_KEY = String(DATA_KEY) + ':sync-state';
        var LS_SYNC_KEY = LS_KEY + ':sync-state';
        var fetchFn = typeof opts.fetch === 'function' ? opts.fetch : global.fetch.bind(global);
        var setTimeoutFn = typeof opts.setTimeout === 'function' ? opts.setTimeout : global.setTimeout.bind(global);
        var clearTimeoutFn = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : global.clearTimeout.bind(global);
        var nowFn = typeof opts.now === 'function' ? opts.now : Date.now;
        var localStore = opts.localStore || null;

        var dbInstance = null;
        var dataCache = null;
        var legacyMigrationPending = false;
        var localWritesAuthorized = false;
        var serverMode = false;
        var serverDataStatus = 'unknown';
        var serverWritesAuthorized = false;
        var serverDirty = false;
        var serverPutInFlight = false;
        var serverDebounceTimer = null;
        var serverRetryTimer = null;
        var serverRetryAttempt = 0;
        var SERVER_DEBOUNCE_MS = Number(opts.serverDebounceMs) >= 0 ? Number(opts.serverDebounceMs) : 800;
        var SERVER_RETRY_DELAYS = Array.isArray(opts.serverRetryDelays) && opts.serverRetryDelays.length > 0
            ? opts.serverRetryDelays.slice()
            : [1000, 2000, 4000, 8000, 16000];
        var SERVER_READ_TIMEOUT_MS = Number(opts.serverReadTimeoutMs) > 0
            ? Number(opts.serverReadTimeoutMs)
            : 10000;
        var storageReady = false;
        var storageInitStarted = false;
        var initCallbacks = [];
        var readyResolve;
        var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });
        var localWriteTail = Promise.resolve(true);
        var lastLocalWrite = Promise.resolve(true);
        var flushWaiters = [];
        var syncState = createSyncState();

        function createSyncState() {
            return {
                version: 1,
                localRevision: 0,
                lastAckRevision: 0,
                pendingServerSync: false,
                localUpdatedAt: 0,
            };
        }

        function cloneValue(value) {
            if (value === undefined) return undefined;
            try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
        }

        function normalizeSyncState(value) {
            var state = value && typeof value === 'object' ? value : {};
            var localRevision = Math.max(0, Math.floor(Number(state.localRevision) || 0));
            var lastAckRevision = Math.max(0, Math.floor(Number(state.lastAckRevision) || 0));
            return {
                version: 1,
                localRevision: Math.max(localRevision, lastAckRevision),
                lastAckRevision: lastAckRevision,
                pendingServerSync: state.pendingServerSync === true,
                localUpdatedAt: Math.max(0, Number(state.localUpdatedAt) || 0),
            };
        }

        function openDB(cb) {
            if (dbInstance) { cb(dbInstance); return; }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
            req.onsuccess = function (e) { dbInstance = e.target.result; cb(dbInstance); };
            req.onerror = function () { cb(null); };
        }

        function isDataObject(value) {
            return Boolean(value && typeof value === 'object' && !Array.isArray(value));
        }

        function readLegacyState() {
            try {
                if (typeof localStorage === 'undefined') return { status: 'absent', data: null };
                var raw = localStorage.getItem(LS_KEY);
                if (!raw) return { status: 'absent', data: null };
                var parsed = JSON.parse(raw);
                if (!isDataObject(parsed)) {
                    return { status: 'error', data: null, error: new Error('legacy settings are not an object') };
                }
                return { status: 'present', data: parsed };
            } catch (error) {
                return { status: 'error', data: null, error: error };
            }
        }

        function loadFromLS() {
            var legacy = readLegacyState();
            return legacy.status === 'present' ? legacy.data : null;
        }

        function loadSyncFromLS() {
            try { var r = localStorage.getItem(LS_SYNC_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
        }

        function readLocalState() {
            function fromCurrentResult(result) {
                result = result || {};
                var legacy = readLegacyState();
                var explicitStatus = result.status;
                var currentStatus = explicitStatus === 'present' || explicitStatus === 'absent' || explicitStatus === 'error'
                    ? explicitStatus
                    : (result.hasData === true || isDataObject(result.data) ? 'present' : 'absent');

                if (currentStatus === 'present' && isDataObject(result.data)) {
                    return {
                        data: result.data,
                        sync: normalizeSyncState(result.sync),
                        hasData: true,
                        status: 'present',
                        source: 'current',
                    };
                }
                if (currentStatus === 'absent') {
                    if (legacy.status === 'present') {
                        return {
                            data: legacy.data,
                            sync: normalizeSyncState(loadSyncFromLS()),
                            hasData: true,
                            status: 'absent',
                            source: 'legacy',
                        };
                    }
                    if (legacy.status === 'error') {
                        return {
                            data: null,
                            sync: normalizeSyncState(result.sync),
                            hasData: false,
                            status: 'error',
                            source: 'legacy',
                            error: legacy.error,
                        };
                    }
                    return {
                        data: null,
                        sync: normalizeSyncState(result.sync),
                        hasData: false,
                        status: 'absent',
                        source: 'none',
                    };
                }
                return {
                    data: legacy.status === 'present' ? legacy.data : null,
                    sync: normalizeSyncState(loadSyncFromLS()),
                    hasData: legacy.status === 'present',
                    status: 'error',
                    source: legacy.status === 'present' ? 'legacy' : 'none',
                    error: result.error || legacy.error || new Error('local settings state is unknown'),
                };
            }

            if (localStore && typeof localStore.read === 'function') {
                return Promise.resolve()
                    .then(function () { return localStore.read(); })
                    .then(fromCurrentResult, function (readError) {
                        return fromCurrentResult({ status: 'error', error: readError });
                    });
            }
            return new Promise(function (resolve) {
                openDB(function (db) {
                    if (!db) {
                        resolve(fromCurrentResult({ status: 'error', error: new Error('IndexedDB open failed') }));
                        return;
                    }
                    var tx = db.transaction(STORE_NAME, 'readonly');
                    var store = tx.objectStore(STORE_NAME);
                    var dataReq = store.get(DATA_KEY);
                    var syncReq = store.get(SYNC_KEY);
                    var dataResult;
                    var syncResult;
                    dataReq.onsuccess = function () { dataResult = dataReq.result; };
                    syncReq.onsuccess = function () { syncResult = syncReq.result; };
                    tx.oncomplete = function () {
                        if (dataResult !== undefined && dataResult !== null && !isDataObject(dataResult)) {
                            resolve(fromCurrentResult({ status: 'error', error: new Error('IndexedDB settings are invalid') }));
                            return;
                        }
                        resolve(fromCurrentResult({
                            data: dataResult,
                            sync: syncResult,
                            status: dataResult !== undefined && dataResult !== null ? 'present' : 'absent',
                        }));
                    };
                    tx.onerror = function () {
                        resolve(fromCurrentResult({ status: 'error', error: tx.error || new Error('IndexedDB read failed') }));
                    };
                });
            });
        }

        function completeLegacyMigration() {
            if (!legacyMigrationPending) return;
            try {
                localStorage.removeItem(LS_SYNC_KEY);
                localStorage.removeItem(LS_KEY);
                legacyMigrationPending = false;
            } catch (error) {
                console.warn('[美化管理] 旧版设置已写入新存储，但旧数据源暂时无法删除:', error);
            }
        }

        function persistLocalState(data, state) {
            if (!localWritesAuthorized) {
                return Promise.reject(new Error('local settings state is not authoritative enough to overwrite'));
            }
            var dataSnapshot = cloneValue(data);
            var syncSnapshot = cloneValue(normalizeSyncState(state));
            if (localStore && typeof localStore.write === 'function') {
                return Promise.resolve()
                    .then(function () { return localStore.write(dataSnapshot, syncSnapshot); })
                    .then(function (result) {
                        if (result === false) throw new Error('local settings write was not confirmed');
                        completeLegacyMigration();
                        return true;
                    });
            }
            return new Promise(function (resolve, reject) {
                openDB(function (db) {
                    if (!db) {
                        try {
                            localStorage.setItem(LS_KEY, JSON.stringify(dataSnapshot));
                            localStorage.setItem(LS_SYNC_KEY, JSON.stringify(syncSnapshot));
                            resolve(true);
                        } catch (err) { reject(err); }
                        return;
                    }
                    var tx = db.transaction(STORE_NAME, 'readwrite');
                    var store = tx.objectStore(STORE_NAME);
                    store.put(dataSnapshot, DATA_KEY);
                    store.put(syncSnapshot, SYNC_KEY);
                    tx.oncomplete = function () {
                        completeLegacyMigration();
                        resolve(true);
                    };
                    tx.onerror = function () { reject(tx.error || new Error('IndexedDB write failed')); };
                    tx.onabort = function () { reject(tx.error || new Error('IndexedDB write aborted')); };
                });
            });
        }

        function queueLocalPersist() {
            var dataSnapshot = cloneValue(dataCache);
            var syncSnapshot = cloneValue(syncState);
            var write = localWriteTail.catch(function () { return false; }).then(function () {
                return persistLocalState(dataSnapshot, syncSnapshot);
            });
            localWriteTail = write;
            lastLocalWrite = write;
            write.catch(function (err) {
                console.warn('[美化管理] 本地设置保存失败:', err);
            });
            return write;
        }

        function saveToDB(d, cb) {
            dataCache = ensureDefaults(d);
            var write = queueLocalPersist();
            if (cb) write.then(function () { cb(true); }, function () { cb(false); });
            return write;
        }

        function loadFromDB(cb) {
            if (storageReady && dataCache) { cb(dataCache); return; }
            readLocalState().then(function (local) {
                syncState = local.sync;
                dataCache = ensureDefaults(local.data);
                cb(dataCache);
            });
        }

        function load() {
            if (!storageReady || !dataCache) {
                throw new Error('Theme Manager storage is not ready');
            }
            return dataCache;
        }

        function save(d) {
            dataCache = ensureDefaults(d);
            syncState.localRevision += 1;
            syncState.localUpdatedAt = nowFn();
            syncState.pendingServerSync = true;
            serverDirty = true;
            serverRetryAttempt = 0;
            if (serverRetryTimer) {
                clearTimeoutFn(serverRetryTimer);
                serverRetryTimer = null;
            }
            var write = queueLocalPersist();
            scheduleServerPut();
            return write;
        }

        function detectServer(cb) {
            fetchServerRead(SERVER_BASE + '/status', { method: 'GET', credentials: 'same-origin' })
                .then(function (r) {
                    if (!r) throw new Error('server status response is missing');
                    if (r.status === 404) return { status: 'absent' };
                    if (!r.ok) throw new Error('server status GET rejected');
                    return readResponseJson(r).then(function (body) {
                        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.ok !== 'boolean') {
                            throw new Error('server status response is invalid');
                        }
                        if (body.ok !== true) throw new Error('server status response is not authoritative');
                        return { status: 'present' };
                    });
                })
                .catch(function (error) { return { status: 'error', error: error }; })
                .then(function (result) { cb(result); });
        }

        function fetchServerRead(url, requestOptions) {
            return new Promise(function (resolve, reject) {
                var settled = false;
                var controller = typeof global.AbortController === 'function'
                    ? new global.AbortController()
                    : null;
                var options = Object.assign({}, requestOptions || {});
                if (controller) options.signal = controller.signal;
                var timer = setTimeoutFn(function () {
                    if (settled) return;
                    settled = true;
                    if (controller) {
                        try { controller.abort(); } catch (e) {}
                    }
                    reject(new Error('server settings read timed out'));
                }, SERVER_READ_TIMEOUT_MS);

                Promise.resolve()
                    .then(function () { return fetchFn(url, options); })
                    .then(function (response) {
                        if (settled) return;
                        settled = true;
                        clearTimeoutFn(timer);
                        resolve(response);
                    }, function (error) {
                        if (settled) return;
                        settled = true;
                        clearTimeoutFn(timer);
                        reject(error);
                    });
            });
        }

        function readResponseJson(response) {
            return new Promise(function (resolve, reject) {
                var settled = false;
                var timer = setTimeoutFn(function () {
                    if (settled) return;
                    settled = true;
                    reject(new Error('server settings body read timed out'));
                }, SERVER_READ_TIMEOUT_MS);
                Promise.resolve()
                    .then(function () { return response.json(); })
                    .then(function (body) {
                        if (settled) return;
                        settled = true;
                        clearTimeoutFn(timer);
                        resolve(body);
                    }, function (error) {
                        if (settled) return;
                        settled = true;
                        clearTimeoutFn(timer);
                        reject(error);
                    });
            });
        }

        function serverGetData(cb) {
            fetchServerRead(SERVER_BASE + '/data', { method: 'GET', credentials: 'same-origin' })
                .then(function (r) {
                    if (!r || !r.ok) {
                        throw new Error('server settings GET rejected');
                    }
                    return readResponseJson(r);
                })
                .then(function (j) {
                    if (!j || typeof j !== 'object' || Array.isArray(j) || j.ok !== true
                        || !Object.prototype.hasOwnProperty.call(j, 'data')) {
                        throw new Error('server settings GET returned an invalid body');
                    }
                    if (j.data === null) return { status: 'absent' };
                    if (typeof j.data === 'object' && !Array.isArray(j.data)) {
                        return { status: 'present', data: j.data };
                    }
                    throw new Error('server settings GET returned invalid data');
                })
                .catch(function (error) {
                    return { status: 'error', error: error };
                })
                .then(function (result) { cb(result); });
        }

        function canWriteServerData() {
            return localWritesAuthorized
                && serverWritesAuthorized
                && (serverDataStatus === 'present' || serverDataStatus === 'absent');
        }

        function scheduleServerPut() {
            if (!serverMode || !dataCache || !canWriteServerData()) return;
            serverDirty = true;
            if (serverPutInFlight) return;
            if (serverDebounceTimer) clearTimeoutFn(serverDebounceTimer);
            serverDebounceTimer = setTimeoutFn(function () {
                serverDebounceTimer = null;
                if (!serverDirty) return;
                serverPutDataNow();
            }, SERVER_DEBOUNCE_MS);
        }

        function scheduleServerRetry() {
            if (!serverMode || !canWriteServerData() || !syncState.pendingServerSync
                || serverRetryTimer || serverPutInFlight) return;
            if (serverRetryAttempt >= SERVER_RETRY_DELAYS.length) {
                flushWaiters.splice(0).forEach(function (waiter) { waiter.resolve(false); });
                return;
            }
            var delay = Math.max(0, Number(SERVER_RETRY_DELAYS[serverRetryAttempt]) || 0);
            serverRetryAttempt += 1;
            serverRetryTimer = setTimeoutFn(function () {
                serverRetryTimer = null;
                if (!serverDirty || !syncState.pendingServerSync) return;
                serverPutDataNow();
            }, delay);
        }

        function resolveFlushWaiters() {
            var pending = [];
            flushWaiters.forEach(function (waiter) {
                if (syncState.lastAckRevision >= waiter.revision) waiter.resolve(true);
                else pending.push(waiter);
            });
            flushWaiters = pending;
        }

        function serverPutDataNow(cb) {
            if (!serverMode || !dataCache || !canWriteServerData()) { if (cb) cb(false); return; }
            if (serverPutInFlight) { serverDirty = true; if (cb) cb(false); return; }
            if (serverDebounceTimer) { clearTimeoutFn(serverDebounceTimer); serverDebounceTimer = null; }
            if (serverRetryTimer) { clearTimeoutFn(serverRetryTimer); serverRetryTimer = null; }
            serverPutInFlight = true;
            serverDirty = false;
            var sentRevision = syncState.localRevision;
            var payloadSnapshot = cloneValue(dataCache);
            var succeeded = false;
            getPostHeaders()
                .then(function (headers) {
                    return fetchFn(SERVER_BASE + '/data', {
                        method: 'PUT',
                        credentials: 'same-origin',
                        headers: headers,
                        body: JSON.stringify(payloadSnapshot),
                    });
                })
                .then(function (r) { return r && r.ok ? r.json() : null; })
                .then(function (j) {
                    succeeded = !!(j && j.ok);
                    if (!succeeded) throw new Error('server settings PUT rejected');
                    syncState.lastAckRevision = Math.max(syncState.lastAckRevision, sentRevision);
                    if (syncState.localRevision === sentRevision) {
                        syncState.pendingServerSync = false;
                    } else {
                        serverDirty = true;
                    }
                    queueLocalPersist();
                    resolveFlushWaiters();
                })
                .catch(function (err) {
                    serverDirty = true;
                    syncState.pendingServerSync = true;
                    queueLocalPersist();
                    console.warn('[美化管理] 后端设置同步失败，将保留本地数据并重试:', err);
                })
                .then(function () {
                    serverPutInFlight = false;
                    if (cb) cb(succeeded);
                    if (succeeded) serverRetryAttempt = 0;
                    if (serverDirty && syncState.pendingServerSync) {
                        if (succeeded) {
                            // A newer local revision arrived while this request was in flight.
                            // Send only the newest snapshot next; never replay intermediate states.
                            serverPutDataNow();
                        } else {
                            scheduleServerRetry();
                        }
                    }
                });
        }

        function flush() {
            return whenReady().then(function () {
                return lastLocalWrite.catch(function () { return false; });
            }).then(function (localOk) {
                if (!localOk) return false;
                if (!serverMode || !syncState.pendingServerSync) return true;
                if (!canWriteServerData()) return false;
                var targetRevision = syncState.localRevision;
                return new Promise(function (resolve) {
                    flushWaiters.push({ revision: targetRevision, resolve: resolve });
                    serverDirty = true;
                    serverRetryAttempt = 0;
                    if (serverDebounceTimer) { clearTimeoutFn(serverDebounceTimer); serverDebounceTimer = null; }
                    if (serverRetryTimer) { clearTimeoutFn(serverRetryTimer); serverRetryTimer = null; }
                    if (!serverPutInFlight) serverPutDataNow();
                });
            });
        }

        function cancelPendingSync() {
            if (serverDebounceTimer) { clearTimeoutFn(serverDebounceTimer); serverDebounceTimer = null; }
            if (serverRetryTimer) { clearTimeoutFn(serverRetryTimer); serverRetryTimer = null; }
        }

        function whenReady() { return readyPromise; }

        function isDataImage(value) {
            return typeof value === 'string' && value.indexOf('data:image/') === 0;
        }

        function isServerImage(value) {
            return typeof value === 'string' && value.indexOf(SERVER_IMAGE_PREFIX) === 0;
        }

        function uploadImage(dataUrl, cb) {
            if (!serverMode || !canWriteServerData() || !isDataImage(dataUrl)) { cb(null, dataUrl); return; }
            getPostHeaders()
                .then(function (headers) {
                    return fetchFn(SERVER_BASE + '/images', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: headers,
                        body: JSON.stringify({ dataUrl: dataUrl }),
                    });
                })
                .then(function (r) { return r && r.ok ? r.json() : null; })
                .then(function (j) { cb(null, j && j.ok && j.url ? j.url : dataUrl); })
                .catch(function () { cb(null, dataUrl); });
        }

        function batchResolveImages(urls, cb) {
            var result = {};
            if (!Array.isArray(urls) || urls.length === 0) { cb(result); return; }
            var serverUrls = [];
            var seen = {};
            urls.forEach(function (url) {
                if (!url || typeof url !== 'string') return;
                if (isDataImage(url)) result[url] = url;
                else if (isServerImage(url)) {
                    if (!seen[url]) { seen[url] = true; serverUrls.push(url); }
                } else result[url] = url;
            });
            if (serverUrls.length === 0) { cb(result); return; }
            if (!serverMode || !canWriteServerData()) {
                serverUrls.forEach(function (url) { result[url] = url; });
                cb(result);
                return;
            }
            getPostHeaders()
                .then(function (headers) {
                    return fetchFn(SERVER_BASE + '/images/batch-fetch', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: headers,
                        body: JSON.stringify({ urls: serverUrls }),
                    });
                })
                .then(function (r) { return r && r.ok ? r.json() : null; })
                .then(function (j) {
                    if (j && j.ok && j.images) {
                        for (var url in j.images) result[url] = j.images[url];
                    }
                    serverUrls.forEach(function (url) { if (!result[url]) result[url] = url; });
                    cb(result);
                })
                .catch(function () {
                    serverUrls.forEach(function (url) { if (!result[url]) result[url] = url; });
                    cb(result);
                });
        }

        function collectImageFields(root, refs) {
            refs = refs || [];
            if (!root || typeof root !== 'object') return refs;
            if (Array.isArray(root)) {
                root.forEach(function (item) { collectImageFields(item, refs); });
                return refs;
            }
            for (var key in root) {
                if (!Object.prototype.hasOwnProperty.call(root, key)) continue;
                var val = root[key];
                if (IMAGE_FIELD_KEYS[key] && typeof val === 'string' && val) refs.push({ obj: root, key: key, value: val });
                else if (val && typeof val === 'object') collectImageFields(val, refs);
            }
            return refs;
        }

        function migrateImagesToServer(d, cb) {
            if (!serverMode || !canWriteServerData() || !d) { if (cb) cb(false); return; }
            var refs = collectImageFields(d).filter(function (ref) { return isDataImage(ref.value); });
            if (refs.length === 0) { if (cb) cb(false); return; }
            var idx = 0;
            function next() {
                if (idx >= refs.length) {
                    try { console.log('[美化管理] 已迁移图片到后端:', refs.length); } catch (e) {}
                    if (cb) cb(true);
                    return;
                }
                var ref = refs[idx++];
                uploadImage(ref.value, function (_err, url) {
                    ref.obj[ref.key] = url || ref.value;
                    next();
                });
            }
            next();
        }

        function markPendingMutation() {
            syncState.localRevision += 1;
            syncState.localUpdatedAt = nowFn();
            syncState.pendingServerSync = true;
            serverDirty = true;
        }

        function drainInitCallbacks() {
            var callbacks = initCallbacks.splice(0);
            callbacks.forEach(function (callback) {
                try { callback(dataCache); } catch (err) { setTimeoutFn(function () { throw err; }, 0); }
            });
        }

        function finishStorageInit() {
            if (storageReady) return;
            storageReady = true;
            readyResolve(dataCache);
            drainInitCallbacks();
            if (serverMode && canWriteServerData() && syncState.pendingServerSync) {
                serverDirty = true;
                serverPutDataNow();
            }
        }

        function persistThenFinish(requireDurableBeforeServerWrite) {
            queueLocalPersist().then(finishStorageInit, function () {
                if (requireDurableBeforeServerWrite) serverWritesAuthorized = false;
                finishStorageInit();
            });
        }

        function finishWithImageMigration(requireDurableBeforeServerWrite) {
            if (requireDurableBeforeServerWrite) {
                queueLocalPersist().then(function () {
                    migrateImagesToServer(dataCache, function (changed) {
                        if (changed) markPendingMutation();
                        if (changed) persistThenFinish(true);
                        else finishStorageInit();
                    });
                }, function () {
                    serverWritesAuthorized = false;
                    finishStorageInit();
                });
                return;
            }
            migrateImagesToServer(dataCache, function (changed) {
                if (changed) markPendingMutation();
                persistThenFinish(false);
            });
        }

        function initStorage(cb) {
            if (typeof cb === 'function') initCallbacks.push(cb);
            if (storageReady) { drainInitCallbacks(); return readyPromise; }
            if (storageInitStarted) return readyPromise;
            storageInitStarted = true;

            readLocalState().then(function (local) {
                localWritesAuthorized = local.status !== 'error';
                legacyMigrationPending = local.status === 'absent' && local.source === 'legacy';
                syncState = normalizeSyncState(local.sync);
                dataCache = ensureDefaults(local.data);
                detectServer(function (statusResult) {
                    serverMode = statusResult.status === 'present';
                    serverDataStatus = 'unknown';
                    serverWritesAuthorized = false;
                    if (statusResult.status === 'error') {
                        if (local.status !== 'present') localWritesAuthorized = false;
                        console.warn('[美化管理] 后端状态读取失败，本次会话禁止自动迁移或写入:', statusResult.error);
                        finishStorageInit();
                        return;
                    }
                    if (!serverMode) {
                        if (local.status === 'error') finishStorageInit();
                        else persistThenFinish();
                        return;
                    }

                    serverGetData(function (result) {
                        serverDataStatus = result.status;
                        if (result.status === 'error') {
                            if (local.status !== 'present') localWritesAuthorized = false;
                            console.warn('[美化管理] 后端设置读取失败，本次会话保留本地数据且禁止覆盖后端:', result.error);
                            finishStorageInit();
                            return;
                        }

                        if (result.status === 'present') {
                            if (local.status === 'error') {
                                serverWritesAuthorized = false;
                                console.warn('[美化管理] 本地设置读取状态不明，已禁止自动覆盖本地或后端存储。');
                                finishStorageInit();
                                return;
                            }
                            serverWritesAuthorized = true;
                            if (local.hasData && syncState.pendingServerSync) {
                                serverDirty = true;
                                finishWithImageMigration(local.source === 'legacy');
                                return;
                            }
                            legacyMigrationPending = false;
                            dataCache = ensureDefaults(result.data);
                            syncState.pendingServerSync = false;
                            syncState.lastAckRevision = syncState.localRevision;
                            finishWithImageMigration();
                            return;
                        }

                        // Only the backend's explicit { ok: true, data: null }
                        // response authorizes a first seed. A failed local read is
                        // not authoritative enough to choose a seed snapshot.
                        if (local.status === 'error') {
                            legacyMigrationPending = false;
                            serverWritesAuthorized = false;
                            console.warn('[美化管理] 本地设置读取状态不明，已禁止自动初始化空的后端存储。');
                            finishStorageInit();
                            return;
                        }
                        serverWritesAuthorized = true;
                        markPendingMutation();
                        finishWithImageMigration(true);
                    });
                });
            }).catch(function (err) {
                console.warn('[美化管理] 存储初始化失败，使用安全默认设置:', err);
                legacyMigrationPending = false;
                localWritesAuthorized = false;
                dataCache = ensureDefaults(null);
                syncState = createSyncState();
                finishStorageInit();
            });
            return readyPromise;
        }

        return {
            load: load,
            save: save,
            saveToDB: saveToDB,
            loadFromLS: loadFromLS,
            initStorage: initStorage,
            whenReady: whenReady,
            isReady: function () { return storageReady; },
            flush: flush,
            uploadImage: uploadImage,
            batchResolveImages: batchResolveImages,
            collectImageFields: collectImageFields,
            isDataImage: isDataImage,
            isServerImage: isServerImage,
            getServerMode: function () { return serverMode && canWriteServerData(); },
            getSyncState: function () { return cloneValue(syncState); },
        };
    };
})(window);
