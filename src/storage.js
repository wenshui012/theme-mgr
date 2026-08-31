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
        var pluginVersion = opts.version || '';
        var tauriTavernLocalOnly = typeof opts.tauriTavernLocalOnly === 'boolean'
            ? opts.tauriTavernLocalOnly
            : hasTauriTavernAbi();
        var estimateStorageFn = typeof opts.estimateStorage === 'function'
            ? opts.estimateStorage
            : function () {
                var storage = global.navigator && global.navigator.storage;
                if (!storage || typeof storage.estimate !== 'function') return Promise.resolve(null);
                return storage.estimate();
            };

        var STORAGE_ERROR_CODES = {
            LOCAL_STATE_NOT_AUTHORITATIVE: true,
            LOCAL_MAIN_INVALID: true,
            SYNC_STATE_INVALID: true,
            SYNC_REVISION_INVALID: true,
            IDB_OPEN_FAILED: true,
            IDB_READ_FAILED: true,
            IDB_TRANSACTION_FAILED: true,
            IDB_WRITE_FAILED: true,
            IDB_ABORTED: true,
            STORAGE_QUOTA_EXCEEDED: true,
            LOCALSTORAGE_SERIALIZE_FAILED: true,
            LOCALSTORAGE_WRITE_FAILED: true,
            INITIALIZATION_FAILED: true,
            UNKNOWN_LOCAL_PERSIST_FAILURE: true,
        };

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
        var lastLocalReadSummary = {
            status: 'uninitialized',
            source: 'none',
            hasMain: false,
            hasSyncState: false,
            mainType: 'absent',
            syncStateType: 'absent',
        };
        var lastLocalAuthorityError = null;
        var localRevalidationPromise = null;
        var lastLocalRevalidationSummary = {
            attempted: false,
            succeeded: false,
            errorCode: null,
        };

        function storageErrorMessage(code) {
            var messages = {
                LOCAL_STATE_NOT_AUTHORITATIVE: 'local settings state is not authoritative enough to overwrite',
                LOCAL_MAIN_INVALID: 'local settings main data is invalid',
                SYNC_STATE_INVALID: 'local sync metadata is invalid',
                SYNC_REVISION_INVALID: 'local sync revisions are invalid',
                IDB_OPEN_FAILED: 'IndexedDB open failed',
                IDB_READ_FAILED: 'IndexedDB read failed',
                IDB_TRANSACTION_FAILED: 'IndexedDB transaction failed',
                IDB_WRITE_FAILED: 'IndexedDB write failed',
                IDB_ABORTED: 'IndexedDB transaction aborted',
                STORAGE_QUOTA_EXCEEDED: 'local storage quota was exceeded',
                LOCALSTORAGE_SERIALIZE_FAILED: 'localStorage serialization failed',
                LOCALSTORAGE_WRITE_FAILED: 'localStorage write failed',
                INITIALIZATION_FAILED: 'storage initialization failed',
                UNKNOWN_LOCAL_PERSIST_FAILURE: 'unknown local persistence failure',
            };
            return messages[code] || messages.UNKNOWN_LOCAL_PERSIST_FAILURE;
        }

        function makeStorageError(code, cause, details) {
            var stableCode = STORAGE_ERROR_CODES[code] ? code : 'UNKNOWN_LOCAL_PERSIST_FAILURE';
            var error = new Error(storageErrorMessage(stableCode));
            error.name = 'ThemeManagerStorageError';
            error.code = stableCode;
            if (cause !== undefined && cause !== null) error.cause = cause;
            if (details !== undefined) error.details = details;
            return error;
        }

        function errorName(error) {
            return error && typeof error.name === 'string' ? error.name : '';
        }

        function normalizeStorageError(error, fallbackCode, details) {
            if (error && typeof error.code === 'string' && STORAGE_ERROR_CODES[error.code]) return error;
            var name = errorName(error);
            var message = error && typeof error.message === 'string' ? error.message : '';
            var code = STORAGE_ERROR_CODES[fallbackCode] ? fallbackCode : 'UNKNOWN_LOCAL_PERSIST_FAILURE';
            var normalizedDetails = Object.assign({}, details || {});
            if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(message)) {
                code = 'STORAGE_QUOTA_EXCEEDED';
            } else if (name === 'AbortError') {
                code = 'IDB_ABORTED';
            } else if (name === 'DataCloneError') {
                code = 'IDB_WRITE_FAILED';
                normalizedDetails.reason = 'DataCloneError';
            } else if (name === 'TransactionInactiveError' || name === 'InvalidStateError') {
                code = 'IDB_TRANSACTION_FAILED';
                normalizedDetails.reason = name;
            }
            if (name) normalizedDetails.causeName = name;
            return makeStorageError(code, error, normalizedDetails);
        }

        function valueType(value) {
            if (value === undefined || value === null) return 'absent';
            if (Array.isArray(value)) return 'array';
            return typeof value;
        }

        function finiteDiagnosticNumber(value) {
            var number = Number(value);
            return Number.isFinite(number) ? number : null;
        }

        function hasTauriTavernAbi() {
            try {
                var host = global.__TAURITAVERN__;
                var abiVersion = host && Number(host.abiVersion);
                return Boolean(host && typeof host === 'object'
                    && Number.isFinite(abiVersion) && abiVersion >= 1);
            } catch (e) {
                return false;
            }
        }

        function safeErrorDetails(error) {
            var details = error && error.details;
            if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
            var allowed = ['stage', 'reason', 'backend', 'field', 'operation', 'authorityCode', 'localStateStatus', 'causeName', 'revalidationAttempted'];
            var result = {};
            allowed.forEach(function (key) {
                var value = details[key];
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') result[key] = value;
            });
            return Object.keys(result).length ? result : null;
        }

        function detectPlatform() {
            var nav = global.navigator || {};
            var userAgent = typeof nav.userAgent === 'string' ? nav.userAgent : '';
            return hasTauriTavernAbi() || global.__TAURITAVERN_MOBILE_RUNTIME_COMPAT__
                || global.__TAURI_INTERNALS__ || /Tauri/i.test(userAgent)
                ? 'Tauri'
                : 'Browser';
        }

        function collectDiagnostics(error) {
            var normalized = normalizeStorageError(error, 'UNKNOWN_LOCAL_PERSIST_FAILURE');
            var cause = normalized.cause || error;
            var diagnostic = {
                schemaVersion: 1,
                themeManagerVersion: pluginVersion,
                platform: detectPlatform(),
                errorCode: normalized.code,
                errorMessage: normalized.message,
                causeName: errorName(cause) || null,
                details: safeErrorDetails(normalized),
                storageMode: tauriTavernLocalOnly ? 'tauri-local-only' : 'standard',
                localWritesAuthorized: localWritesAuthorized,
                localState: cloneValue(lastLocalReadSummary),
                revalidation: cloneValue(lastLocalRevalidationSummary),
                localRevision: finiteDiagnosticNumber(syncState.localRevision),
                lastAckRevision: finiteDiagnosticNumber(syncState.lastAckRevision),
                pendingServerSync: syncState.pendingServerSync === true,
                storageEstimate: { supported: false },
            };
            return Promise.resolve()
                .then(function () { return estimateStorageFn(); })
                .then(function (estimate) {
                    if (!estimate || typeof estimate !== 'object') return diagnostic;
                    var usage = finiteDiagnosticNumber(estimate.usage);
                    var quota = finiteDiagnosticNumber(estimate.quota);
                    diagnostic.storageEstimate = {
                        supported: true,
                        usage: usage,
                        quota: quota,
                        ratio: usage !== null && quota !== null && quota > 0 ? usage / quota : null,
                    };
                    return diagnostic;
                })
                .catch(function (estimateError) {
                    diagnostic.storageEstimate = {
                        supported: true,
                        errorName: errorName(estimateError) || 'Error',
                    };
                    return diagnostic;
                });
        }

        function recordLocalRead(local, stage) {
            lastLocalReadSummary = cloneValue(local && local.diagnostics ? local.diagnostics : {
                status: local && local.status ? local.status : 'error',
                source: local && local.source ? local.source : 'none',
                hasMain: Boolean(local && local.hasData),
                hasSyncState: false,
                mainType: valueType(local && local.data),
                syncStateType: valueType(local && local.sync),
            });
            if (local && local.status === 'error') {
                lastLocalAuthorityError = normalizeStorageError(local.error, 'LOCAL_STATE_NOT_AUTHORITATIVE', {
                    reason: 'local-read-not-authoritative',
                    stage: stage || 'initialization',
                });
            } else {
                lastLocalAuthorityError = null;
            }
        }

        function blockLocalWrites(cause, details) {
            localWritesAuthorized = false;
            lastLocalAuthorityError = normalizeStorageError(cause, 'LOCAL_STATE_NOT_AUTHORITATIVE', details);
        }

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
            if (dbInstance) { cb(dbInstance, null); return; }
            var req;
            try {
                req = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (error) {
                cb(null, normalizeStorageError(error, 'IDB_OPEN_FAILED', { stage: 'open' }));
                return;
            }
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
            req.onsuccess = function (e) { dbInstance = e.target.result; cb(dbInstance, null); };
            req.onerror = function () {
                cb(null, normalizeStorageError(req.error || new Error('IndexedDB open failed'), 'IDB_OPEN_FAILED', { stage: 'open' }));
            };
        }

        function isDataObject(value) {
            return Boolean(value && typeof value === 'object' && !Array.isArray(value));
        }

        function hasOwn(value, key) {
            return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
        }

        function validatePersistedSyncState(value) {
            if (!isDataObject(value)) {
                return makeStorageError('SYNC_STATE_INVALID', null, { reason: 'not-object', stage: 'sync-validation' });
            }
            if (hasOwn(value, 'version') && value.version !== 1) {
                return makeStorageError('SYNC_STATE_INVALID', null, { reason: 'unsupported-version', stage: 'sync-validation' });
            }
            var numberFields = ['localRevision', 'lastAckRevision', 'localUpdatedAt'];
            for (var i = 0; i < numberFields.length; i++) {
                var key = numberFields[i];
                if (!hasOwn(value, key)) continue;
                var numberValue = Number(value[key]);
                if (!Number.isFinite(numberValue) || numberValue < 0 || (key !== 'localUpdatedAt' && Math.floor(numberValue) !== numberValue)) {
                    return makeStorageError(
                        key === 'localRevision' || key === 'lastAckRevision' ? 'SYNC_REVISION_INVALID' : 'SYNC_STATE_INVALID',
                        null,
                        { reason: 'invalid-field', field: key, stage: 'sync-validation' },
                    );
                }
            }
            if (hasOwn(value, 'pendingServerSync') && typeof value.pendingServerSync !== 'boolean') {
                return makeStorageError('SYNC_STATE_INVALID', null, {
                    reason: 'invalid-pending-flag',
                    field: 'pendingServerSync',
                    stage: 'sync-validation',
                });
            }
            if (hasOwn(value, 'localRevision') && hasOwn(value, 'lastAckRevision')
                && Number(value.lastAckRevision) > Number(value.localRevision)) {
                return makeStorageError('SYNC_REVISION_INVALID', null, {
                    reason: 'ack-ahead-of-local',
                    stage: 'sync-validation',
                });
            }
            return null;
        }

        function validateRevalidationSyncState(value) {
            var validationError = validatePersistedSyncState(value);
            if (validationError) return validationError;
            if (!hasOwn(value, 'version')) {
                return makeStorageError('SYNC_STATE_INVALID', null, {
                    reason: 'missing-field',
                    field: 'version',
                    stage: 'sync-revalidation',
                });
            }
            var revisionFields = ['localRevision', 'lastAckRevision'];
            for (var i = 0; i < revisionFields.length; i++) {
                if (!hasOwn(value, revisionFields[i])) {
                    return makeStorageError('SYNC_REVISION_INVALID', null, {
                        reason: 'missing-field',
                        field: revisionFields[i],
                        stage: 'sync-revalidation',
                    });
                }
            }
            var stateFields = ['pendingServerSync', 'localUpdatedAt'];
            for (var j = 0; j < stateFields.length; j++) {
                if (!hasOwn(value, stateFields[j])) {
                    return makeStorageError('SYNC_STATE_INVALID', null, {
                        reason: 'missing-field',
                        field: stateFields[j],
                        stage: 'sync-revalidation',
                    });
                }
            }
            return null;
        }

        function readLegacyState() {
            try {
                if (typeof localStorage === 'undefined') return { status: 'absent', data: null };
                var raw = localStorage.getItem(LS_KEY);
                if (raw === null) return { status: 'absent', data: null };
                var parsed = JSON.parse(raw);
                if (!isDataObject(parsed)) {
                    return {
                        status: 'error',
                        data: null,
                        error: makeStorageError('LOCAL_STATE_NOT_AUTHORITATIVE', null, {
                            reason: 'legacy-main-not-object',
                            stage: 'legacy-read',
                        }),
                    };
                }
                return { status: 'present', data: parsed };
            } catch (error) {
                return {
                    status: 'error',
                    data: null,
                    error: makeStorageError('LOCAL_STATE_NOT_AUTHORITATIVE', error, {
                        reason: 'legacy-main-read-failed',
                        stage: 'legacy-read',
                    }),
                };
            }
        }

        function loadFromLS() {
            var legacy = readLegacyState();
            return legacy.status === 'present' ? legacy.data : null;
        }

        function readLegacySyncState() {
            try {
                if (typeof localStorage === 'undefined') return { status: 'absent', data: null };
                var raw = localStorage.getItem(LS_SYNC_KEY);
                if (raw === null) return { status: 'absent', data: null };
                var parsed = JSON.parse(raw);
                var validationError = validatePersistedSyncState(parsed);
                if (validationError) return { status: 'error', data: null, error: validationError };
                return { status: 'present', data: parsed };
            } catch (error) {
                return {
                    status: 'error',
                    data: null,
                    error: makeStorageError('SYNC_STATE_INVALID', error, {
                        reason: 'legacy-sync-read-failed',
                        stage: 'legacy-sync-read',
                    }),
                };
            }
        }

        function loadSyncFromLS() {
            var legacySync = readLegacySyncState();
            return legacySync.status === 'present' ? legacySync.data : null;
        }

        function readLocalState() {
            function fromCurrentResult(result) {
                result = result || {};
                var legacy = readLegacyState();
                var legacySync = readLegacySyncState();
                function finish(local, rawData, rawSync, hasSyncState) {
                    local.persistedSync = rawSync;
                    local.diagnostics = {
                        status: local.status,
                        source: local.source,
                        hasMain: rawData !== undefined && rawData !== null,
                        hasSyncState: hasSyncState === undefined
                            ? rawSync !== undefined && rawSync !== null
                            : hasSyncState,
                        mainType: valueType(rawData),
                        syncStateType: valueType(rawSync),
                    };
                    return local;
                }
                var explicitStatus = result.status;
                var currentStatus = explicitStatus === 'present' || explicitStatus === 'absent' || explicitStatus === 'error'
                    ? explicitStatus
                    : (result.hasData === true || isDataObject(result.data) ? 'present' : 'absent');

                if (currentStatus === 'present' && isDataObject(result.data)) {
                    if (result.sync !== undefined && result.sync !== null) {
                        var currentSyncError = validatePersistedSyncState(result.sync);
                        if (currentSyncError) {
                            return finish({
                                data: result.data,
                                sync: createSyncState(),
                                hasData: true,
                                status: 'error',
                                source: 'current',
                                error: currentSyncError,
                            }, result.data, result.sync);
                        }
                    }
                    return finish({
                        data: result.data,
                        sync: normalizeSyncState(result.sync),
                        hasData: true,
                        status: 'present',
                        source: 'current',
                    }, result.data, result.sync);
                }
                if (currentStatus === 'present') {
                    return finish({
                        data: null,
                        sync: createSyncState(),
                        hasData: false,
                        status: 'error',
                        source: 'current',
                        error: makeStorageError('LOCAL_MAIN_INVALID', null, {
                            reason: 'main-not-object',
                            stage: 'read-validation',
                        }),
                    }, result.data, result.sync);
                }
                if (currentStatus === 'absent') {
                    if ((result.data !== undefined && result.data !== null) || result.sync !== undefined && result.sync !== null) {
                        var mainMissingOrInvalid = !isDataObject(result.data);
                        return finish({
                            data: isDataObject(result.data) ? result.data : null,
                            sync: createSyncState(),
                            hasData: isDataObject(result.data),
                            status: 'error',
                            source: isDataObject(result.data) ? 'current' : 'none',
                            error: makeStorageError(mainMissingOrInvalid ? 'LOCAL_MAIN_INVALID' : 'LOCAL_STATE_NOT_AUTHORITATIVE', null, {
                                reason: mainMissingOrInvalid ? 'main-missing-or-invalid' : 'main-sync-mismatch',
                                stage: 'local-read',
                            }),
                        }, result.data, result.sync);
                    }
                    if (legacy.status === 'present') {
                        if (legacySync.status === 'error') {
                            return finish({
                                data: legacy.data,
                                sync: createSyncState(),
                                hasData: true,
                                status: 'error',
                                source: 'legacy',
                                error: legacySync.error,
                            }, legacy.data, legacySync.data, true);
                        }
                        return finish({
                            data: legacy.data,
                            sync: normalizeSyncState(legacySync.data),
                            hasData: true,
                            status: 'absent',
                            source: 'legacy',
                        }, legacy.data, legacySync.data, legacySync.status === 'present');
                    }
                    if (legacy.status === 'error' || legacySync.status !== 'absent') {
                        return finish({
                            data: null,
                            sync: normalizeSyncState(result.sync),
                            hasData: false,
                            status: 'error',
                            source: 'legacy',
                            error: legacy.error || legacySync.error || makeStorageError('LOCAL_STATE_NOT_AUTHORITATIVE', null, {
                                reason: 'legacy-main-sync-mismatch',
                                stage: 'legacy-read',
                            }),
                        }, legacy.data, legacySync.data, legacySync.status !== 'absent');
                    }
                    return finish({
                        data: null,
                        sync: normalizeSyncState(result.sync),
                        hasData: false,
                        status: 'absent',
                        source: 'none',
                    }, null, null, false);
                }
                var readError = result.error || legacy.error || makeStorageError('LOCAL_STATE_NOT_AUTHORITATIVE', null, {
                    reason: 'local-state-unknown',
                    stage: 'local-read',
                });
                var fallbackData = legacy.status === 'present' ? legacy.data : null;
                var fallbackSync = legacySync.status === 'present' ? legacySync.data : null;
                var failedCurrentStatePresent = (result.data !== undefined && result.data !== null)
                    || (result.sync !== undefined && result.sync !== null);
                return finish({
                    data: legacy.status === 'present' ? legacy.data : null,
                    sync: normalizeSyncState(legacySync.data),
                    hasData: legacy.status === 'present',
                    status: 'error',
                    source: failedCurrentStatePresent ? 'current' : (legacy.status === 'present' ? 'legacy' : 'none'),
                    error: normalizeStorageError(readError, 'LOCAL_STATE_NOT_AUTHORITATIVE', {
                        reason: 'local-state-unknown',
                        stage: 'local-read',
                    }),
                }, failedCurrentStatePresent ? result.data : fallbackData,
                failedCurrentStatePresent ? result.sync : fallbackSync,
                failedCurrentStatePresent
                    ? result.sync !== undefined && result.sync !== null
                    : legacySync.status === 'present');
            }

            if (localStore && typeof localStore.read === 'function') {
                return Promise.resolve()
                    .then(function () { return localStore.read(); })
                    .then(fromCurrentResult, function (readError) {
                        return fromCurrentResult({
                            status: 'error',
                            error: normalizeStorageError(readError, 'IDB_READ_FAILED', { stage: 'local-read' }),
                        });
                    });
            }
            return new Promise(function (resolve) {
                openDB(function (db, openError) {
                    if (!db) {
                        resolve(fromCurrentResult({ status: 'error', error: openError || new Error('IndexedDB open failed') }));
                        return;
                    }
                    var tx;
                    var store;
                    var dataReq;
                    var syncReq;
                    try {
                        tx = db.transaction(STORE_NAME, 'readonly');
                        store = tx.objectStore(STORE_NAME);
                        dataReq = store.get(DATA_KEY);
                        syncReq = store.get(SYNC_KEY);
                    } catch (error) {
                        resolve(fromCurrentResult({
                            status: 'error',
                            error: normalizeStorageError(error, 'IDB_TRANSACTION_FAILED', {
                                stage: 'read-transaction',
                                operation: 'read',
                            }),
                        }));
                        return;
                    }
                    var settled = false;
                    var dataResult;
                    var syncResult;
                    function failRead(error) {
                        if (settled) return;
                        settled = true;
                        resolve(fromCurrentResult({
                            status: 'error',
                            error: normalizeStorageError(error || new Error('IndexedDB read failed'), 'IDB_READ_FAILED', {
                                stage: 'read',
                                operation: 'read',
                            }),
                        }));
                    }
                    dataReq.onsuccess = function () { dataResult = dataReq.result; };
                    syncReq.onsuccess = function () { syncResult = syncReq.result; };
                    dataReq.onerror = function () { failRead(dataReq.error || new Error('IndexedDB settings read failed')); };
                    syncReq.onerror = function () { failRead(syncReq.error || new Error('IndexedDB sync read failed')); };
                    tx.oncomplete = function () {
                        if (settled) return;
                        settled = true;
                        if (dataResult !== undefined && dataResult !== null && !isDataObject(dataResult)) {
                            resolve(fromCurrentResult({
                                status: 'error',
                                data: dataResult,
                                sync: syncResult,
                                error: makeStorageError('LOCAL_MAIN_INVALID', null, {
                                    reason: 'main-not-object',
                                    stage: 'read-validation',
                                }),
                            }));
                            return;
                        }
                        resolve(fromCurrentResult({
                            data: dataResult,
                            sync: syncResult,
                            status: dataResult !== undefined && dataResult !== null ? 'present' : 'absent',
                        }));
                    };
                    tx.onerror = function () {
                        failRead(normalizeStorageError(tx.error || new Error('IndexedDB read failed'), 'IDB_TRANSACTION_FAILED', {
                            stage: 'read-transaction',
                            operation: 'read',
                        }));
                    };
                    tx.onabort = function () {
                        failRead(normalizeStorageError(tx.error || new Error('IndexedDB read aborted'), 'IDB_ABORTED', {
                            stage: 'read-transaction',
                            operation: 'read',
                        }));
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

        function makeRevalidationError(error, local, details) {
            var normalized = normalizeStorageError(error, 'LOCAL_STATE_NOT_AUTHORITATIVE', {
                reason: 'save-revalidation-failed',
                stage: 'save-revalidation',
            });
            var combinedDetails = Object.assign({}, normalized.details || {}, details || {}, {
                authorityCode: normalized.code,
                localStateStatus: local && local.status ? local.status : lastLocalReadSummary.status,
                revalidationAttempted: true,
                stage: 'save-revalidation',
            });
            return makeStorageError(normalized.code, normalized.cause || normalized, combinedDetails);
        }

        function isProvablyEmptyLocalState(local) {
            var diagnostics = local && local.diagnostics;
            return Boolean(local && local.status === 'absent' && local.source === 'none'
                && local.hasData !== true && (local.data === undefined || local.data === null)
                && (local.persistedSync === undefined || local.persistedSync === null)
                && diagnostics && diagnostics.hasMain === false && diagnostics.hasSyncState === false
                && diagnostics.mainType === 'absent' && diagnostics.syncStateType === 'absent');
        }

        function makeEmptyBootstrapError(local, reason, cause) {
            return makeRevalidationError(makeStorageError('LOCAL_STATE_NOT_AUTHORITATIVE', cause, {
                reason: reason,
                stage: 'save-revalidation',
            }), local);
        }

        function authorizeEmptyLocalBootstrap(local) {
            var backendAuthority;
            if (tauriTavernLocalOnly) {
                serverMode = false;
                serverDataStatus = 'absent';
                serverWritesAuthorized = false;
                backendAuthority = Promise.resolve(true);
            } else {
                backendAuthority = new Promise(function (resolve, reject) {
                    detectServer(function (statusResult) {
                        if (!statusResult || statusResult.status === 'error') {
                            reject(makeEmptyBootstrapError(
                                local,
                                'empty-bootstrap-server-status-failed',
                                statusResult && statusResult.error,
                            ));
                            return;
                        }

                        serverMode = statusResult.status === 'present';
                        serverDataStatus = statusResult.status === 'absent' ? 'absent' : 'unknown';
                        serverWritesAuthorized = false;
                        if (!serverMode) {
                            resolve(true);
                            return;
                        }

                        serverGetData(function (serverResult) {
                            serverDataStatus = serverResult && serverResult.status ? serverResult.status : 'error';
                            if (serverDataStatus === 'absent') {
                                serverWritesAuthorized = true;
                                resolve(true);
                                return;
                            }
                            if (serverDataStatus === 'present') {
                                reject(makeEmptyBootstrapError(local, 'empty-bootstrap-backend-data-present'));
                                return;
                            }
                            reject(makeEmptyBootstrapError(
                                local,
                                'empty-bootstrap-backend-read-failed',
                                serverResult && serverResult.error,
                            ));
                        });
                    });
                });
            }
            return backendAuthority.then(function () {
                return readLocalState();
            }).then(function (confirmedLocal) {
                recordLocalRead(confirmedLocal, 'save-bootstrap-confirmation');
                if (!confirmedLocal || confirmedLocal.status === 'error') {
                    throw makeRevalidationError(confirmedLocal && confirmedLocal.error, confirmedLocal);
                }
                if (!isProvablyEmptyLocalState(confirmedLocal)) {
                    throw makeEmptyBootstrapError(confirmedLocal, 'empty-bootstrap-local-changed');
                }
                syncState = createSyncState();
                legacyMigrationPending = false;
                localWritesAuthorized = true;
                lastLocalAuthorityError = null;
                lastLocalRevalidationSummary = {
                    attempted: true,
                    succeeded: true,
                    errorCode: null,
                };
                return true;
            });
        }

        function revalidateLocalWriteAuthority() {
            if (localWritesAuthorized) return Promise.resolve(true);
            if (localRevalidationPromise) return localRevalidationPromise;

            lastLocalRevalidationSummary = {
                attempted: true,
                succeeded: false,
                errorCode: null,
            };
            var pending = Promise.resolve().then(function () {
                return readLocalState();
            }).then(function (local) {
                recordLocalRead(local, 'save-revalidation');
                if (!local || local.status === 'error') {
                    throw makeRevalidationError(local && local.error, local);
                }
                if (isProvablyEmptyLocalState(local)) {
                    return authorizeEmptyLocalBootstrap(local);
                }
                if (local.status !== 'present' || local.source !== 'current' || !isDataObject(local.data)) {
                    throw makeRevalidationError(makeStorageError('LOCAL_MAIN_INVALID', null, {
                        reason: local && local.source === 'legacy' ? 'current-main-missing-legacy-only' : 'current-main-missing-or-invalid',
                        stage: 'save-revalidation',
                    }), local);
                }
                if (!local.diagnostics || local.diagnostics.hasSyncState !== true) {
                    throw makeRevalidationError(makeStorageError('SYNC_STATE_INVALID', null, {
                        reason: 'sync-state-missing',
                        stage: 'save-revalidation',
                    }), local);
                }
                var syncValidationError = validateRevalidationSyncState(local.persistedSync);
                if (syncValidationError) throw makeRevalidationError(syncValidationError, local);

                var recoveredData;
                try {
                    recoveredData = ensureDefaults(cloneValue(local.data));
                } catch (mainError) {
                    throw makeRevalidationError(makeStorageError('LOCAL_MAIN_INVALID', mainError, {
                        reason: 'main-default-validation-failed',
                        stage: 'save-revalidation',
                    }), local);
                }
                dataCache = recoveredData;
                syncState = normalizeSyncState(local.sync);
                legacyMigrationPending = false;
                localWritesAuthorized = true;
                lastLocalAuthorityError = null;
                lastLocalRevalidationSummary = {
                    attempted: true,
                    succeeded: true,
                    errorCode: null,
                };
                return true;
            }).catch(function (error) {
                var revalidationError = error && error.details && error.details.revalidationAttempted === true
                    ? error
                    : makeRevalidationError(error, null);
                blockLocalWrites(revalidationError, {
                    authorityCode: revalidationError.code,
                    localStateStatus: lastLocalReadSummary.status,
                    revalidationAttempted: true,
                    stage: 'save-revalidation',
                });
                lastLocalRevalidationSummary = {
                    attempted: true,
                    succeeded: false,
                    errorCode: revalidationError.code,
                };
                throw revalidationError;
            });

            localRevalidationPromise = pending.then(function (result) {
                localRevalidationPromise = null;
                return result;
            }, function (error) {
                localRevalidationPromise = null;
                throw error;
            });
            return localRevalidationPromise;
        }

        function persistLocalState(data, state) {
            if (!localWritesAuthorized) {
                var authorityCode = lastLocalAuthorityError && lastLocalAuthorityError.code && STORAGE_ERROR_CODES[lastLocalAuthorityError.code]
                    ? lastLocalAuthorityError.code
                    : 'LOCAL_STATE_NOT_AUTHORITATIVE';
                return Promise.reject(makeStorageError(
                    authorityCode,
                    lastLocalAuthorityError,
                    {
                        authorityCode: authorityCode,
                        localStateStatus: lastLocalReadSummary.status,
                        stage: 'persist-authorization',
                    },
                ));
            }
            var dataSnapshot = cloneValue(data);
            var syncSnapshot = cloneValue(normalizeSyncState(state));
            if (localStore && typeof localStore.write === 'function') {
                return Promise.resolve()
                    .then(function () { return localStore.write(dataSnapshot, syncSnapshot); })
                    .then(function (result) {
                        if (result === false) {
                            throw makeStorageError('IDB_WRITE_FAILED', null, {
                                reason: 'write-not-confirmed',
                                stage: 'write',
                                backend: 'injected-local-store',
                            });
                        }
                        completeLegacyMigration();
                        return true;
                    })
                    .catch(function (error) {
                        throw normalizeStorageError(error, 'IDB_WRITE_FAILED', {
                            stage: 'write',
                            backend: 'injected-local-store',
                        });
                    });
            }
            return new Promise(function (resolve, reject) {
                openDB(function (db, openError) {
                    if (!db) {
                        var serializedData;
                        var serializedSync;
                        try {
                            serializedData = JSON.stringify(dataSnapshot);
                        } catch (serializeError) {
                            reject(normalizeStorageError(serializeError, 'LOCALSTORAGE_SERIALIZE_FAILED', {
                                stage: 'serialize',
                                backend: 'localStorage',
                                field: 'main',
                                authorityCode: openError && openError.code ? openError.code : '',
                            }));
                            return;
                        }
                        try {
                            localStorage.setItem(LS_KEY, serializedData);
                        } catch (writeError) {
                            reject(normalizeStorageError(writeError, 'LOCALSTORAGE_WRITE_FAILED', {
                                stage: 'write',
                                backend: 'localStorage',
                                field: 'main',
                                authorityCode: openError && openError.code ? openError.code : '',
                            }));
                            return;
                        }
                        try {
                            serializedSync = JSON.stringify(syncSnapshot);
                        } catch (serializeError) {
                            reject(normalizeStorageError(serializeError, 'LOCALSTORAGE_SERIALIZE_FAILED', {
                                stage: 'serialize',
                                backend: 'localStorage',
                                field: 'sync-state',
                                authorityCode: openError && openError.code ? openError.code : '',
                            }));
                            return;
                        }
                        try {
                            localStorage.setItem(LS_SYNC_KEY, serializedSync);
                            resolve(true);
                        } catch (writeError) {
                            reject(normalizeStorageError(writeError, 'LOCALSTORAGE_WRITE_FAILED', {
                                stage: 'write',
                                backend: 'localStorage',
                                field: 'sync-state',
                                authorityCode: openError && openError.code ? openError.code : '',
                            }));
                        }
                        return;
                    }
                    var tx;
                    var store;
                    var dataWrite;
                    var syncWrite;
                    try {
                        tx = db.transaction(STORE_NAME, 'readwrite');
                        store = tx.objectStore(STORE_NAME);
                    } catch (transactionError) {
                        reject(normalizeStorageError(transactionError, 'IDB_TRANSACTION_FAILED', {
                            stage: 'write-transaction',
                            operation: 'write',
                        }));
                        return;
                    }
                    try {
                        dataWrite = store.put(dataSnapshot, DATA_KEY);
                        syncWrite = store.put(syncSnapshot, SYNC_KEY);
                    } catch (putError) {
                        reject(normalizeStorageError(putError, 'IDB_WRITE_FAILED', {
                            stage: 'write-request',
                            operation: 'write',
                        }));
                        return;
                    }
                    var requestError = null;
                    if (dataWrite) dataWrite.onerror = function () { requestError = dataWrite.error || new Error('IndexedDB data write failed'); };
                    if (syncWrite) syncWrite.onerror = function () { requestError = syncWrite.error || new Error('IndexedDB sync write failed'); };
                    tx.oncomplete = function () {
                        completeLegacyMigration();
                        resolve(true);
                    };
                    tx.onerror = function () {
                        reject(normalizeStorageError(requestError || tx.error || new Error('IndexedDB write failed'), requestError ? 'IDB_WRITE_FAILED' : 'IDB_TRANSACTION_FAILED', {
                            stage: requestError ? 'write-request' : 'write-transaction',
                            operation: 'write',
                        }));
                    };
                    tx.onabort = function () {
                        reject(normalizeStorageError(requestError || tx.error || new Error('IndexedDB write aborted'), 'IDB_ABORTED', {
                            stage: 'write-transaction',
                            operation: 'write',
                        }));
                    };
                });
            });
        }

        function queueLocalPersist() {
            var dataSnapshot = cloneValue(dataCache);
            var syncSnapshot = cloneValue(syncState);
            var write = localWriteTail.catch(function () { return false; }).then(function () {
                return persistLocalState(dataSnapshot, syncSnapshot);
            }).catch(function (error) {
                throw normalizeStorageError(error, 'UNKNOWN_LOCAL_PERSIST_FAILURE', { stage: 'persist' });
            });
            localWriteTail = write;
            lastLocalWrite = write;
            write.catch(function (err) {
                console.warn('[美化管理] 本地设置保存失败:', err);
            });
            return write;
        }

        function saveToDBAuthorized(d, cb) {
            dataCache = ensureDefaults(d);
            var write = queueLocalPersist();
            if (cb) write.then(function () { cb(true); }, function () { cb(false); });
            return write;
        }

        function saveToDB(d, cb) {
            if (localWritesAuthorized) return saveToDBAuthorized(d, cb);
            var write = revalidateLocalWriteAuthority().then(function () {
                return saveToDBAuthorized(d);
            });
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

        function saveAuthorized(d) {
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

        function save(d) {
            if (localWritesAuthorized) return saveAuthorized(d);
            return revalidateLocalWriteAuthority().then(function () {
                return saveAuthorized(d);
            });
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
            var result = Object.create(null);
            if (!Array.isArray(urls) || urls.length === 0) { cb(result); return; }
            var serverUrls = [];
            var seen = Object.create(null);
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
                        Object.keys(j.images).forEach(function (url) { result[url] = j.images[url]; });
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
            Object.keys(root).forEach(function (key) {
                var val = root[key];
                if (IMAGE_FIELD_KEYS[key] && typeof val === 'string' && val) refs.push({ obj: root, key: key, value: val });
                else if (val && typeof val === 'object') collectImageFields(val, refs);
            });
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
                recordLocalRead(local);
                localWritesAuthorized = local.status !== 'error';
                legacyMigrationPending = local.status === 'absent' && local.source === 'legacy';
                syncState = normalizeSyncState(local.sync);
                dataCache = ensureDefaults(local.data);
                if (tauriTavernLocalOnly) {
                    serverMode = false;
                    serverDataStatus = 'absent';
                    serverWritesAuthorized = false;
                    if (local.status === 'error') finishStorageInit();
                    else persistThenFinish();
                    return;
                }
                detectServer(function (statusResult) {
                    serverMode = statusResult.status === 'present';
                    serverDataStatus = 'unknown';
                    serverWritesAuthorized = false;
                    if (statusResult.status === 'error') {
                        if (local.status !== 'present') {
                            blockLocalWrites(statusResult.error, {
                                reason: 'backend-status-read-failed-without-local-main',
                                stage: 'initialization',
                            });
                        }
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
                            if (local.status !== 'present') {
                                blockLocalWrites(result.error, {
                                    reason: 'backend-data-read-failed-without-local-main',
                                    stage: 'initialization',
                                });
                            }
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
                lastLocalReadSummary = {
                    status: 'error',
                    source: 'none',
                    hasMain: false,
                    hasSyncState: false,
                    mainType: 'absent',
                    syncStateType: 'absent',
                };
                blockLocalWrites(makeStorageError('INITIALIZATION_FAILED', err, {
                    reason: 'initialization-rejected',
                    stage: 'initialization',
                }));
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
            normalizePersistError: function (error) {
                return normalizeStorageError(error, 'UNKNOWN_LOCAL_PERSIST_FAILURE', { stage: 'ui' });
            },
            collectDiagnostics: collectDiagnostics,
        };
    };
})(window);
