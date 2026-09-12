(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var POINTER_KEY = 'theme_mgr_avatar_active_local_dataset_v1';
    var TRANSACTION_KEY = 'theme_mgr_avatar_recovery_transaction_v1';
    var LOG_VERSION = 1;
    var MiB = 1024 * 1024;
    var STATES = { prepared: true, applying: true, verifying: true, committed: true, rollback: true };

    function clean(value) { return String(value == null ? '' : value).trim(); }
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
    function stable(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
        return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + stable(value[key]); }).join(',') + '}';
    }
    function makeError(code, message, details) {
        var error = new Error(message);
        error.name = 'AvatarRecoveryError';
        error.code = code;
        if (details) error.details = details;
        return error;
    }
    function validHash(value) { return /^sha256:[a-f0-9]{64}$/.test(clean(value)); }
    function validDatabaseName(value, defaultName) {
        value = clean(value); defaultName = clean(defaultName);
        return value === defaultName || value.indexOf(defaultName + '__restore__') === 0 && /^[A-Za-z0-9._-]{1,160}$/.test(value);
    }
    function parseJson(raw, label) {
        try { return JSON.parse(raw); }
        catch (error) { throw makeError('AVATAR_RECOVERY_CONTROL_INVALID', label + ' 无法解析'); }
    }
    function storageRead(storage, key) {
        try { return storage.getItem(key); }
        catch (error) { throw makeError('AVATAR_RECOVERY_CONTROL_UNAVAILABLE', '头像恢复控制存储不可读', { key: key }); }
    }
    function storageWrite(storage, key, value) {
        try { storage.setItem(key, JSON.stringify(value)); }
        catch (error) { throw makeError('AVATAR_RECOVERY_CONTROL_WRITE_FAILED', '头像恢复事务日志无法持久化', { key: key }); }
    }
    function storageRemove(storage, key) {
        try { storage.removeItem(key); }
        catch (error) { throw makeError('AVATAR_RECOVERY_CONTROL_WRITE_FAILED', '头像恢复活动库指针无法更新', { key: key }); }
    }
    function readPointer(storage, defaultName) {
        var raw = storageRead(storage, POINTER_KEY);
        if (raw == null) return { present: false, databaseName: defaultName, raw: null };
        var value = parseJson(raw, '头像活动库指针');
        if (!isObject(value) || value.version !== 1 || !validDatabaseName(value.databaseName, defaultName)) {
            throw makeError('AVATAR_RECOVERY_POINTER_INVALID', '头像活动库指针无效');
        }
        return { present: true, databaseName: value.databaseName, raw: value };
    }
    function readTransaction(storage, defaultName) {
        var raw = storageRead(storage, TRANSACTION_KEY);
        if (raw == null) return null;
        var value = parseJson(raw, '头像恢复事务日志');
        if (!isObject(value) || value.version !== LOG_VERSION || !clean(value.id) || !STATES[value.state] ||
            !isObject(value.source) || !isObject(value.target) || !validDatabaseName(value.source.databaseName, defaultName) ||
            !validDatabaseName(value.target.databaseName, defaultName) || value.source.databaseName === value.target.databaseName ||
            typeof value.source.pointerPresent !== 'boolean' || !validHash(value.source.snapshotFingerprint) ||
            !validHash(value.source.avatarLibrarySha256) || !validHash(value.target.snapshotFingerprint) ||
            !validHash(value.target.avatarLibrarySha256) || !validHash(value.backupFingerprint) ||
            !isObject(value.previousAvatarLibrary) || typeof value.rollbackComplete !== 'boolean') {
            throw makeError('AVATAR_RECOVERY_LOG_INVALID', '头像恢复事务日志无效');
        }
        return value;
    }
    function transactionTerminal(value) {
        return !!value && (value.state === 'committed' || value.state === 'rollback' && value.rollbackComplete === true);
    }
    function resolveBootstrap(options) {
        options = options || {};
        var storage = options.localStorage || global.localStorage;
        var defaultName = clean(options.defaultDatabaseName || 'theme_mgr_avatar_db');
        try {
            if (!storage) throw makeError('AVATAR_RECOVERY_CONTROL_UNAVAILABLE', '当前环境缺少头像恢复控制存储');
            var pointer = readPointer(storage, defaultName);
            var transaction = readTransaction(storage, defaultName);
            var blocked = !!transaction && !transactionTerminal(transaction);
            if (transaction && transaction.state === 'committed' && pointer.databaseName !== transaction.target.databaseName) blocked = true;
            if (transaction && transaction.state === 'rollback' && transaction.rollbackComplete === true && pointer.databaseName !== transaction.source.databaseName) blocked = true;
            return { ok: !blocked, blocked: blocked, databaseName: pointer.databaseName, pointer: pointer, transaction: clone(transaction), error: blocked ? makeError('AVATAR_RECOVERY_INCOMPLETE', '检测到未完成的头像恢复事务') : null };
        } catch (error) {
            return { ok: false, blocked: true, databaseName: null, pointer: null, transaction: null, error: error };
        }
    }
    function bytesToHex(bytes) {
        return Array.prototype.map.call(new Uint8Array(bytes), function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    }
    function bytesToDataUrl(bytes, mime, btoaFn) {
        var chunkSize = 12288;
        var encoded = '';
        for (var offset = 0; offset < bytes.length; offset += chunkSize) {
            var end = Math.min(bytes.length, offset + chunkSize);
            var binary = '';
            for (var i = offset; i < end; i += 1) binary += String.fromCharCode(bytes[i]);
            encoded += btoaFn(binary);
        }
        return 'data:' + mime + ';base64,' + encoded;
    }
    function sortById(items) {
        return (items || []).map(clone).sort(function (a, b) { return clean(a && a.id).localeCompare(clean(b && b.id)); });
    }
    function metadataOnly(asset) {
        return { version: asset.version, id: asset.id, name: asset.name, mimeType: asset.mimeType, width: asset.width, height: asset.height, createdAt: asset.createdAt, updatedAt: asset.updatedAt };
    }
    function sequentialEach(items, task) {
        return (items || []).reduce(function (promise, item, index) { return promise.then(function () { return task(item, index); }); }, Promise.resolve());
    }

    ns.createAvatarRecovery = function (options) {
        options = options || {};
        var storage = options.localStorage || global.localStorage;
        var defaultName = clean(options.defaultDatabaseName || 'theme_mgr_avatar_db');
        var storageApi = options.avatarStorage || ns.avatarStorage;
        var transferTools = options.avatarTransferTools || ns.avatarTransfer;
        var transfer = options.transfer;
        var coordinator = options.coordinator;
        var createStore = options.createStore || function (databaseName) { return ns.createAvatarStore({ dbName: databaseName }); };
        var library = options.library || ns.avatarLibrary;
        var loadUiData = options.loadUiData;
        var saveUiData = options.saveUiData;
        var flushUiData = options.flushUiData || function () { return Promise.resolve(true); };
        var authorityState = options.getAuthorityState || function () { return { ready: false, localOnly: false, evidence: 'unknown' }; };
        var setGlobalLock = options.setGlobalLock || function () {};
        var estimateStorage = options.estimateStorage || function () {
            var api = global.navigator && global.navigator.storage;
            return api && typeof api.estimate === 'function' ? api.estimate() : Promise.resolve(null);
        };
        var memoryState = options.memoryState || function () {
            var info = global.performance && global.performance.memory;
            return info ? { limit: Number(info.jsHeapSizeLimit) || 0, used: Number(info.usedJSHeapSize) || 0 } : null;
        };
        var now = options.now || function () { return new Date(); };
        var cryptoApi = options.crypto || global.crypto;
        var btoaFn = options.btoa || global.btoa;
        var bootstrap = options.bootstrap || resolveBootstrap({ localStorage: storage, defaultDatabaseName: defaultName });
        var busy = false;
        var state = { phase: bootstrap.blocked ? 'blocked' : 'idle', locked: bootstrap.blocked, transaction: clone(bootstrap.transaction), error: bootstrap.error || null };

        function publish(next) { state = Object.assign({}, state, next); return getState(); }
        function getState() { return { phase: state.phase, locked: state.locked, transaction: clone(state.transaction), error: state.error ? { code: state.error.code || 'AVATAR_RECOVERY_ERROR', message: state.error.message || String(state.error) } : null, busy: busy }; }
        function digest(bytes) {
            if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') return Promise.reject(makeError('AVATAR_RECOVERY_UNSUPPORTED', '当前环境缺少 SHA-256 校验能力'));
            return cryptoApi.subtle.digest('SHA-256', bytes).then(function (hash) { return 'sha256:' + bytesToHex(hash); });
        }
        function hashValue(value) {
            if (typeof global.TextEncoder !== 'function') return Promise.reject(makeError('AVATAR_RECOVERY_UNSUPPORTED', '当前环境缺少 UTF-8 编码能力'));
            return digest(new global.TextEncoder().encode(stable(value)));
        }
        function persistLog(value) {
            value.updatedAt = now().toISOString();
            storageWrite(storage, TRANSACTION_KEY, value);
            state.transaction = clone(value);
            return value;
        }
        function writePointer(databaseName) {
            storageWrite(storage, POINTER_KEY, { version: 1, databaseName: databaseName, updatedAt: now().toISOString() });
        }
        function restorePointer(transaction) {
            if (transaction.source.pointerPresent) writePointer(transaction.source.databaseName);
            else storageRemove(storage, POINTER_KEY);
        }
        function currentLibrary() {
            var raw = loadUiData() || {};
            if (Object.prototype.hasOwnProperty.call(raw, 'avatarLibrary')) return clone(raw.avatarLibrary);
            var holder = {};
            return clone(library.ensureState(holder));
        }
        function writeLibrary(value, allowedCurrentHashes) {
            assertSettingsLocalOnly();
            var current = currentLibrary();
            return hashValue(current).then(function (currentHash) {
                if (allowedCurrentHashes && allowedCurrentHashes.indexOf(currentHash) === -1) throw makeError('AVATAR_RECOVERY_STATE_CHANGED', '头像分类设置在恢复事务外发生变化，已停止覆盖');
                var data = clone(loadUiData() || {});
                data.avatarLibrary = clone(value);
                return Promise.resolve(saveUiData(data)).then(function () { return flushUiData(); }).then(function (ok) {
                    if (ok !== true) throw makeError('AVATAR_RECOVERY_SETTINGS_WRITE_FAILED', '头像分类设置未能完整持久化');
                    return hashValue(currentLibrary());
                }).then(function (actualHash) {
                    return hashValue(value).then(function (expectedHash) {
                        if (actualHash !== expectedHash) throw makeError('AVATAR_RECOVERY_SETTINGS_VERIFY_FAILED', '头像分类设置回读校验失败');
                        return actualHash;
                    });
                });
            });
        }
        function descriptorForStore(store) {
            return Promise.all([store.listAssets(), store.listBindings(), store.listNativeViews(), store.listSourceIntents()]).then(function (parts) {
                var metadata = sortById(parts[0]);
                var descriptors = [];
                return sequentialEach(metadata, function (item) {
                    return store.getAsset(item.id).then(function (asset) {
                        if (!asset || stable(metadataOnly(asset)) !== stable(metadataOnly(item))) throw makeError('AVATAR_RECOVERY_VERIFY_FAILED', '头像库资产元数据回读不一致', { avatarId: item.id });
                        var main = transferTools.decodeDataUrl(asset.imageData, asset.mimeType);
                        var thumbnail = transferTools.decodeDataUrl(asset.thumbData);
                        return Promise.all([digest(main.bytes), digest(thumbnail.bytes)]).then(function (hashes) {
                            descriptors.push(Object.assign({}, metadataOnly(asset), {
                                main: { bytes: main.bytes.length, mime: main.mime, sha256: hashes[0] },
                                thumbnail: { bytes: thumbnail.bytes.length, mime: thumbnail.mime, sha256: hashes[1] },
                            }));
                        });
                    });
                }).then(function () {
                    return {
                        assets: descriptors,
                        bindings: sortById(parts[1]),
                        nativeViews: sortById(parts[2]),
                        sourceIntents: sortById(parts[3]),
                    };
                });
            });
        }
        function fingerprintStore(store) { return descriptorForStore(store).then(hashValue); }
        function verifyStore(store, inventory) {
            return descriptorForStore(store).then(function (actual) {
                var expected = {
                    assets: sortById(inventory.assets).map(function (asset) {
                        return Object.assign({}, metadataOnly(asset), {
                            main: { bytes: asset.main.bytes, mime: asset.main.mime, sha256: asset.main.sha256 },
                            thumbnail: { bytes: asset.thumbnail.bytes, mime: asset.thumbnail.mime, sha256: asset.thumbnail.sha256 },
                        });
                    }),
                    bindings: sortById(inventory.bindings),
                    nativeViews: sortById(inventory.nativeViews),
                    sourceIntents: sortById(inventory.sourceIntents),
                };
                if (stable(actual) !== stable(expected)) throw makeError('AVATAR_RECOVERY_VERIFY_FAILED', '头像影子库完整回读校验失败');
                return hashValue(actual);
            });
        }
        function makeTransactionId() {
            var bytes = new Uint8Array(16);
            if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
            else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
            return now().getTime().toString(36) + '-' + Array.prototype.map.call(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
        }
        function preflight(blob, verified) {
            var metrics = verified.metrics || {};
            var persistentRequired = Math.ceil((metrics.payloadBytes || 0) * 2.75 + 8 * MiB);
            var memoryRequired = Math.ceil((metrics.archiveBytes || 0) * 1.25 + (metrics.payloadBytes || 0) * 1.5 + 8 * MiB);
            return Promise.resolve(estimateStorage()).catch(function () { return null; }).then(function (estimate) {
                var available = estimate && Number(estimate.quota) - Number(estimate.usage);
                if (Number.isFinite(available) && available >= 0 && available < persistentRequired) {
                    throw makeError('AVATAR_RECOVERY_SPACE_LIMIT', '可用存储空间不足，无法安全创建头像影子库', { required: persistentRequired, available: available });
                }
                var memory = memoryState();
                var remaining = memory && memory.limit - memory.used;
                if (Number.isFinite(remaining) && remaining > 0 && remaining < memoryRequired) {
                    throw makeError('AVATAR_RECOVERY_MEMORY_LIMIT', '当前可用内存不足，无法安全恢复此备份', { required: memoryRequired, available: remaining });
                }
                return Object.assign({}, metrics, { persistentRequired: persistentRequired, memoryRequired: memoryRequired, availableStorage: Number.isFinite(available) ? available : null });
            });
        }
        function applyArchiveToStore(verified, targetStore) {
            var reader = verified.reader;
            return sequentialEach(verified.inventory.assets, function (metadata) {
                    var mainData;
                    return reader.read(metadata.main.path).then(function (bytes) {
                        mainData = bytesToDataUrl(bytes, metadata.main.mime, btoaFn);
                        return reader.read(metadata.thumbnail.path);
                    }).then(function (bytes) {
                        var asset = Object.assign({}, metadataOnly(metadata), {
                            imageData: mainData,
                            thumbData: bytesToDataUrl(bytes, metadata.thumbnail.mime, btoaFn),
                        });
                        mainData = null;
                        return targetStore.putAsset(asset);
                    });
            }).then(function () {
                return sequentialEach(verified.inventory.bindings, function (record) { return targetStore.putBinding(record); });
            }).then(function () {
                return sequentialEach(verified.inventory.nativeViews, function (record) { return targetStore.putNativeView(record); });
            }).then(function () {
                return sequentialEach(verified.inventory.sourceIntents, function (record) { return targetStore.putSourceIntent(record); });
            });
        }
        function assertSettingsLocalOnly() {
            var storageState = authorityState() || {};
            if (storageState.ready !== true || storageState.localOnly !== true) {
                throw makeError('AVATAR_RECOVERY_LOCAL_ONLY_REQUIRED', '本阶段只支持经明确确认的本地头像库恢复', { settings: storageState });
            }
            return storageState;
        }
        function assertLocalOnly() {
            var storageState = assertSettingsLocalOnly();
            var avatarState = coordinator.getState();
            if (avatarState.phase !== 'local-ready' || avatarState.authoritative !== 'local' || avatarState.offline === true) {
                throw makeError('AVATAR_RECOVERY_LOCAL_ONLY_REQUIRED', '本阶段只支持经明确确认的本地头像库恢复', { settings: storageState, avatar: avatarState });
            }
        }
        function rollbackTransaction(transaction, barrier) {
            transaction.state = 'rollback';
            transaction.rollbackComplete = false;
            persistLog(transaction);
            var sourceStore = createStore(transaction.source.databaseName);
            return Promise.resolve(sourceStore.ready).then(function () { return fingerprintStore(sourceStore); }).then(function (fingerprint) {
                if (fingerprint !== transaction.source.snapshotFingerprint) throw makeError('AVATAR_RECOVERY_ROLLBACK_VERIFY_FAILED', '原头像库与回滚日志不一致，禁止猜测回滚');
                return writeLibrary(transaction.previousAvatarLibrary, [transaction.source.avatarLibrarySha256, transaction.target.avatarLibrarySha256]);
            }).then(function () {
                restorePointer(transaction);
                return barrier.rebindLocalStore(sourceStore, { verified: true, databaseName: transaction.source.databaseName, empty: false });
            }).then(function () { return fingerprintStore(coordinator.store); }).then(function (fingerprint) {
                if (fingerprint !== transaction.source.snapshotFingerprint) throw makeError('AVATAR_RECOVERY_ROLLBACK_VERIFY_FAILED', '回滚后的活动头像库校验失败');
                transaction.rollbackComplete = true;
                transaction.rollbackCompletedAt = now().toISOString();
                persistLog(transaction);
                return transaction;
            });
        }
        function inspectBackup(blob) {
            if (!transfer || typeof transfer.verifyBackupBlob !== 'function') return Promise.reject(makeError('AVATAR_RECOVERY_UNSUPPORTED', '完整备份校验器不可用'));
            return transfer.verifyBackupBlob(blob).then(function (verified) { return preflight(blob, verified).then(function (metrics) { return { manifest: verified.manifest, inventory: verified.inventory, metrics: metrics }; }); });
        }
        function restoreBackup(blob) {
            if (busy) return Promise.reject(makeError('AVATAR_RECOVERY_BUSY', '已有头像恢复任务正在进行'));
            var currentBootstrap = resolveBootstrap({ localStorage: storage, defaultDatabaseName: defaultName });
            if (currentBootstrap.blocked) return Promise.reject(makeError('AVATAR_RECOVERY_INCOMPLETE', '请先回滚未完成的头像恢复事务'));
            busy = true;
            setGlobalLock(true);
            publish({ phase: 'preparing', locked: true, error: null });
            var transaction = null;
            return coordinator.runRecoveryBarrier(function (barrier) {
                return Promise.resolve().then(function () {
                    assertLocalOnly();
                    return flushUiData();
                }).then(function (ok) {
                    if (ok !== true) throw makeError('AVATAR_RECOVERY_SETTINGS_FLUSH_FAILED', '现有设置写入尚未安全完成');
                    return transfer.verifyBackupBlob(blob, true);
                }).then(function (verified) {
                    return preflight(blob, verified).then(function (metrics) { return { verified: verified, metrics: metrics }; });
                }).then(function (prepared) {
                    var pointer = readPointer(storage, defaultName);
                    var previousLibrary = currentLibrary();
                    return Promise.all([fingerprintStore(coordinator.store), hashValue(previousLibrary)]).then(function (sourceHashes) {
                        var id = makeTransactionId();
                        transaction = {
                            version: LOG_VERSION,
                            id: id,
                            state: 'prepared',
                            rollbackComplete: false,
                            createdAt: now().toISOString(),
                            updatedAt: now().toISOString(),
                            backupFingerprint: prepared.verified.manifest.manifestFingerprint,
                            archiveBytes: prepared.metrics.archiveBytes,
                            payloadBytes: prepared.metrics.payloadBytes,
                            source: { databaseName: pointer.databaseName, pointerPresent: pointer.present, snapshotFingerprint: sourceHashes[0], avatarLibrarySha256: sourceHashes[1] },
                            target: { databaseName: defaultName + '__restore__' + id.replace(/[^A-Za-z0-9_-]/g, '_'), snapshotFingerprint: prepared.verified.manifest.manifestFingerprint, avatarLibrarySha256: prepared.verified.manifest.source.avatarLibrarySha256 },
                            previousAvatarLibrary: previousLibrary,
                        };
                        persistLog(transaction);
                        return prepared;
                    });
                }).then(function (prepared) {
                    transaction.state = 'applying';
                    persistLog(transaction);
                    var targetStore = createStore(transaction.target.databaseName);
                    return Promise.resolve(targetStore.ready).then(function () { return applyArchiveToStore(prepared.verified, targetStore); }).then(function () {
                        return verifyStore(targetStore, prepared.verified.inventory);
                    }).then(function (targetFingerprint) {
                        transaction.target.snapshotFingerprint = targetFingerprint;
                        persistLog(transaction);
                        return writeLibrary(prepared.verified.inventory.avatarLibrary, [transaction.source.avatarLibrarySha256]);
                    }).then(function () {
                        transaction.state = 'verifying';
                        persistLog(transaction);
                        writePointer(transaction.target.databaseName);
                        return barrier.rebindLocalStore(targetStore, { verified: true, databaseName: transaction.target.databaseName, empty: prepared.verified.inventory.assets.length === 0 });
                    }).then(function () { return verifyStore(coordinator.store, prepared.verified.inventory); }).then(function (fingerprint) {
                        if (fingerprint !== transaction.target.snapshotFingerprint) throw makeError('AVATAR_RECOVERY_VERIFY_FAILED', '切换后的活动头像库校验失败');
                        transaction.state = 'committed';
                        transaction.committedAt = now().toISOString();
                        persistLog(transaction);
                        return { assets: prepared.verified.inventory.assets.length, databaseName: transaction.target.databaseName, backupFingerprint: transaction.backupFingerprint };
                    });
                }).catch(function (error) {
                    if (!transaction) throw error;
                    return rollbackTransaction(transaction, barrier).then(function () {
                        error.details = Object.assign({}, error.details || {}, { rollback: 'completed' });
                        throw error;
                    }, function (rollbackError) {
                        throw makeError('AVATAR_RECOVERY_ROLLBACK_REQUIRED', '头像恢复失败且自动回滚未完成，已保持只读', { cause: error.code || error.message, rollbackCause: rollbackError.code || rollbackError.message });
                    });
                });
            }).then(function (result) {
                setGlobalLock(false);
                publish({ phase: 'committed', locked: false, transaction: clone(transaction), error: null });
                return result;
            }).catch(function (error) {
                var locked = error && error.code === 'AVATAR_RECOVERY_ROLLBACK_REQUIRED';
                setGlobalLock(locked);
                publish({ phase: locked ? 'blocked' : 'rollback', locked: locked, transaction: clone(transaction), error: error });
                throw error;
            }).finally(function () { busy = false; });
        }
        function rollbackIncomplete() {
            if (busy) return Promise.reject(makeError('AVATAR_RECOVERY_BUSY', '已有头像恢复任务正在进行'));
            var transaction;
            try { transaction = readTransaction(storage, defaultName); }
            catch (error) { return Promise.reject(error); }
            if (!transaction || transactionTerminal(transaction)) return Promise.reject(makeError('AVATAR_RECOVERY_NOT_PENDING', '没有需要回滚的头像恢复事务'));
            busy = true;
            setGlobalLock(true);
            publish({ phase: 'rollback', locked: true, transaction: clone(transaction), error: null });
            return coordinator.runRecoveryBarrier(function (barrier) {
                return Promise.resolve().then(function () {
                    assertSettingsLocalOnly();
                    return flushUiData();
                }).then(function (ok) {
                    if (ok !== true) throw makeError('AVATAR_RECOVERY_SETTINGS_FLUSH_FAILED', '现有设置写入尚未安全完成');
                    return rollbackTransaction(transaction, barrier);
                });
            }).then(function () {
                setGlobalLock(false);
                publish({ phase: 'rollback', locked: false, transaction: clone(transaction), error: null });
                return { databaseName: transaction.source.databaseName };
            }).catch(function (error) {
                setGlobalLock(true);
                publish({ phase: 'blocked', locked: true, transaction: clone(transaction), error: error });
                throw error;
            }).finally(function () { busy = false; });
        }

        setGlobalLock(bootstrap.blocked === true);
        return { inspectBackup: inspectBackup, restoreBackup: restoreBackup, rollbackIncomplete: rollbackIncomplete, getState: getState };
    };

    ns.avatarRecovery = {
        POINTER_KEY: POINTER_KEY,
        TRANSACTION_KEY: TRANSACTION_KEY,
        LOG_VERSION: LOG_VERSION,
        resolveBootstrap: resolveBootstrap,
        makeError: makeError,
    };
})(window);
