(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var DB_NAME = 'theme_mgr_avatar_db';
    var DB_VERSION = 1;
    var LIBRARY_VERSION = 1;
    var BINDINGS_VERSION = 2;
    var STORES = { assets: 'assets', main: 'main-images', thumbs: 'thumbnails', bindings: 'bindings', meta: 'meta' };

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function makeError(code, message, cause) {
        var error = new Error(message);
        error.name = 'AvatarStorageError';
        error.code = code;
        if (cause) error.cause = cause;
        return error;
    }

    function idbError(code, message, cause) {
        if (cause && cause.name === 'QuotaExceededError') {
            return makeError('AVATAR_STORAGE_QUOTA_EXCEEDED', '头像库存储空间不足', cause);
        }
        return makeError(code, message, cause);
    }

    function cleanText(value) {
        return String(value == null ? '' : value).trim();
    }

    function finite(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function normalizeView(view) {
        view = view && typeof view === 'object' ? view : {};
        return {
            x: Math.max(-20, Math.min(20, finite(view.x, 0))),
            y: Math.max(-20, Math.min(20, finite(view.y, 0))),
            scale: Math.max(0.5, Math.min(3, finite(view.scale, 1))),
            rotate: Math.max(-180, Math.min(180, finite(view.rotate, 0))),
        };
    }

    function normalizeAsset(asset) {
        asset = asset && typeof asset === 'object' ? asset : {};
        var id = cleanText(asset.id);
        var imageData = cleanText(asset.imageData);
        var thumbData = cleanText(asset.thumbData);
        var mimeType = cleanText(asset.mimeType).toLowerCase();
        var width = Math.round(finite(asset.width, 0));
        var height = Math.round(finite(asset.height, 0));
        if (!id || !imageData || !thumbData || !/^image\/(?:jpeg|png|webp)$/.test(mimeType) || width < 1 || height < 1) {
            throw makeError('AVATAR_ASSET_INVALID', '头像资产数据无效');
        }
        var now = new Date().toISOString();
        return {
            version: LIBRARY_VERSION,
            id: id,
            name: cleanText(asset.name) || '未命名头像',
            imageData: imageData,
            thumbData: thumbData,
            mimeType: mimeType,
            width: width,
            height: height,
            createdAt: cleanText(asset.createdAt) || now,
            updatedAt: cleanText(asset.updatedAt) || now,
        };
    }

    function bindingId(themeKey, targetKey) {
        return cleanText(themeKey) + '\u001f' + cleanText(targetKey);
    }

    function normalizeBinding(binding) {
        binding = binding && typeof binding === 'object' ? binding : {};
        var themeKey = cleanText(binding.themeKey);
        var targetKey = cleanText(binding.targetKey);
        var avatarId = cleanText(binding.avatarId);
        if (!themeKey || !targetKey || !avatarId) throw makeError('AVATAR_BINDING_INVALID', '头像绑定数据无效');
        return {
            version: BINDINGS_VERSION,
            id: bindingId(themeKey, targetKey),
            themeKey: themeKey,
            targetKey: targetKey,
            avatarId: avatarId,
            view: normalizeView(binding.view),
            updatedAt: cleanText(binding.updatedAt) || new Date().toISOString(),
        };
    }

    function metadataFromAsset(asset) {
        var result = clone(asset);
        delete result.imageData;
        delete result.thumbData;
        return result;
    }

    function createMemoryAdapter(seed) {
        seed = seed || {};
        var assets = new Map();
        var mains = new Map();
        var thumbs = new Map();
        var bindings = new Map();
        (seed.assets || []).forEach(function (raw) {
            var asset = normalizeAsset(raw);
            assets.set(asset.id, metadataFromAsset(asset));
            mains.set(asset.id, asset.imageData);
            thumbs.set(asset.id, asset.thumbData);
        });
        (seed.bindings || []).forEach(function (raw) {
            var binding = normalizeBinding(raw);
            if (assets.has(binding.avatarId)) bindings.set(binding.id, binding);
        });
        return {
            ready: Promise.resolve(),
            listAssets: function () { return Promise.resolve(Array.from(assets.values()).map(clone)); },
            getAsset: function (id) {
                id = cleanText(id);
                if (!assets.has(id)) return Promise.resolve(null);
                return Promise.resolve(Object.assign(clone(assets.get(id)), { imageData: mains.get(id), thumbData: thumbs.get(id) }));
            },
            getThumbnail: function (id) { return Promise.resolve(thumbs.get(cleanText(id)) || ''); },
            putAsset: function (asset) {
                asset = normalizeAsset(asset);
                assets.set(asset.id, metadataFromAsset(asset));
                mains.set(asset.id, asset.imageData);
                thumbs.set(asset.id, asset.thumbData);
                return Promise.resolve(clone(asset));
            },
            listBindings: function () { return Promise.resolve(Array.from(bindings.values()).map(clone)); },
            getBinding: function (themeKey, targetKey) { return Promise.resolve(clone(bindings.get(bindingId(themeKey, targetKey)) || null)); },
            putBinding: function (binding) {
                binding = normalizeBinding(binding);
                if (!assets.has(binding.avatarId)) return Promise.reject(makeError('AVATAR_NOT_FOUND', '绑定引用的头像不存在'));
                bindings.set(binding.id, binding);
                return Promise.resolve(clone(binding));
            },
            deleteBinding: function (themeKey, targetKey) { return Promise.resolve(bindings.delete(bindingId(themeKey, targetKey))); },
            deleteAsset: function (id) {
                id = cleanText(id);
                var removedBindings = [];
                bindings.forEach(function (binding, key) {
                    if (binding.avatarId === id) { removedBindings.push(clone(binding)); bindings.delete(key); }
                });
                var removed = assets.delete(id);
                mains.delete(id);
                thumbs.delete(id);
                return Promise.resolve({ removed: removed, bindings: removedBindings });
            },
            clear: function () { assets.clear(); mains.clear(); thumbs.clear(); bindings.clear(); return Promise.resolve(); },
        };
    }

    function requestPromise(request, code, message) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(idbError(code, message, request.error)); };
        });
    }

    function createIndexedDbAdapter(indexedDB, name) {
        if (!indexedDB || typeof indexedDB.open !== 'function') {
            throw makeError('AVATAR_IDB_UNAVAILABLE', '当前环境不支持 IndexedDB');
        }
        var databasePromise = new Promise(function (resolve, reject) {
            var request;
            try { request = indexedDB.open(name || DB_NAME, DB_VERSION); }
            catch (error) { reject(makeError('AVATAR_IDB_OPEN_FAILED', '头像库无法打开', error)); return; }
            request.onupgradeneeded = function () {
                var db = request.result;
                Object.keys(STORES).forEach(function (key) {
                    var storeName = STORES[key];
                    if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
                });
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(makeError('AVATAR_IDB_OPEN_FAILED', '头像库无法打开', request.error)); };
            request.onblocked = function () { reject(makeError('AVATAR_IDB_BLOCKED', '头像库升级被其他页面阻止')); };
        });

        function transaction(storeNames, mode, enqueue) {
            return databasePromise.then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx;
                    try { tx = db.transaction(storeNames, mode); }
                    catch (error) { reject(makeError('AVATAR_IDB_TRANSACTION_FAILED', '头像库事务创建失败', error)); return; }
                    var result;
                    var settled = false;
                    tx.oncomplete = function () { if (!settled) { settled = true; resolve(clone(result)); } };
                    tx.onerror = function () { if (!settled) { settled = true; reject(idbError('AVATAR_IDB_WRITE_FAILED', '头像库事务失败', tx.error)); } };
                    tx.onabort = function () { if (!settled) { settled = true; reject(makeError('AVATAR_IDB_ABORTED', '头像库事务已中止', tx.error)); } };
                    try {
                        enqueue(tx, function (value) { result = value; });
                    } catch (error) {
                        try { tx.abort(); } catch (_) {}
                        if (!settled) { settled = true; reject(makeError('AVATAR_IDB_TRANSACTION_FAILED', '头像库事务执行失败', error)); }
                    }
                });
            });
        }

        function readonlyGetAll(storeName) {
            return databasePromise.then(function (db) {
                var tx = db.transaction([storeName], 'readonly');
                return requestPromise(tx.objectStore(storeName).getAll(), 'AVATAR_IDB_READ_FAILED', '头像库读取失败');
            }).then(function (items) { return clone(items || []); });
        }

        return {
            ready: databasePromise.then(function () { return true; }),
            listAssets: function () { return readonlyGetAll(STORES.assets); },
            listBindings: function () { return readonlyGetAll(STORES.bindings); },
            getThumbnail: function (id) {
                return databasePromise.then(function (db) {
                    var tx = db.transaction([STORES.thumbs], 'readonly');
                    return requestPromise(tx.objectStore(STORES.thumbs).get(cleanText(id)), 'AVATAR_IDB_READ_FAILED', '头像缩略图读取失败');
                }).then(function (record) { return record && record.thumbData || ''; });
            },
            getAsset: function (id) {
                id = cleanText(id);
                return databasePromise.then(function (db) {
                    var tx = db.transaction([STORES.assets, STORES.main, STORES.thumbs], 'readonly');
                    return Promise.all([
                        requestPromise(tx.objectStore(STORES.assets).get(id), 'AVATAR_IDB_READ_FAILED', '头像元数据读取失败'),
                        requestPromise(tx.objectStore(STORES.main).get(id), 'AVATAR_IDB_READ_FAILED', '头像主图读取失败'),
                        requestPromise(tx.objectStore(STORES.thumbs).get(id), 'AVATAR_IDB_READ_FAILED', '头像缩略图读取失败'),
                    ]);
                }).then(function (parts) {
                    if (!parts[0] || !parts[1] || !parts[2]) return null;
                    return Object.assign(clone(parts[0]), { imageData: parts[1].imageData, thumbData: parts[2].thumbData });
                });
            },
            putAsset: function (raw) {
                var asset = normalizeAsset(raw);
                return transaction([STORES.assets, STORES.main, STORES.thumbs, STORES.meta], 'readwrite', function (tx, setResult) {
                    tx.objectStore(STORES.assets).put(metadataFromAsset(asset));
                    tx.objectStore(STORES.main).put({ id: asset.id, imageData: asset.imageData });
                    tx.objectStore(STORES.thumbs).put({ id: asset.id, thumbData: asset.thumbData });
                    tx.objectStore(STORES.meta).put({ id: 'library-version', version: LIBRARY_VERSION });
                    setResult(asset);
                });
            },
            getBinding: function (themeKey, targetKey) {
                return databasePromise.then(function (db) {
                    var tx = db.transaction([STORES.bindings], 'readonly');
                    return requestPromise(tx.objectStore(STORES.bindings).get(bindingId(themeKey, targetKey)), 'AVATAR_IDB_READ_FAILED', '头像绑定读取失败');
                }).then(function (result) { return clone(result || null); });
            },
            putBinding: function (raw) {
                var binding = normalizeBinding(raw);
                return transaction([STORES.assets, STORES.bindings, STORES.meta], 'readwrite', function (tx, setResult) {
                    var assets = tx.objectStore(STORES.assets);
                    var request = assets.get(binding.avatarId);
                    request.onsuccess = function () {
                        if (!request.result) { try { tx.abort(); } catch (_) {} return; }
                        tx.objectStore(STORES.bindings).put(binding);
                        tx.objectStore(STORES.meta).put({ id: 'bindings-version', version: BINDINGS_VERSION });
                        setResult(binding);
                    };
                    request.onerror = function () { try { tx.abort(); } catch (_) {} };
                }).catch(function (error) {
                    if (error.code === 'AVATAR_IDB_ABORTED') throw makeError('AVATAR_NOT_FOUND', '绑定引用的头像不存在', error);
                    throw error;
                });
            },
            deleteBinding: function (themeKey, targetKey) {
                return transaction([STORES.bindings], 'readwrite', function (tx, setResult) {
                    tx.objectStore(STORES.bindings).delete(bindingId(themeKey, targetKey));
                    setResult(true);
                });
            },
            deleteAsset: function (id) {
                id = cleanText(id);
                return transaction([STORES.assets, STORES.main, STORES.thumbs, STORES.bindings], 'readwrite', function (tx, setResult) {
                    var bindingStore = tx.objectStore(STORES.bindings);
                    var request = bindingStore.getAll();
                    request.onsuccess = function () {
                        var removedBindings = (request.result || []).filter(function (binding) { return binding.avatarId === id; });
                        removedBindings.forEach(function (binding) { bindingStore.delete(binding.id); });
                        tx.objectStore(STORES.assets).delete(id);
                        tx.objectStore(STORES.main).delete(id);
                        tx.objectStore(STORES.thumbs).delete(id);
                        setResult({ removed: true, bindings: removedBindings });
                    };
                    request.onerror = function () { try { tx.abort(); } catch (_) {} };
                });
            },
            clear: function () {
                return transaction(Object.keys(STORES).map(function (key) { return STORES[key]; }), 'readwrite', function (tx, setResult) {
                    Object.keys(STORES).forEach(function (key) { tx.objectStore(STORES[key]).clear(); });
                    setResult(true);
                });
            },
        };
    }

    ns.createAvatarStore = function (options) {
        options = options || {};
        var adapter = options.adapter || createIndexedDbAdapter(
            Object.prototype.hasOwnProperty.call(options, 'indexedDB') ? options.indexedDB : global.indexedDB,
            options.dbName || DB_NAME
        );
        return {
            ready: Promise.resolve(adapter.ready),
            listAssets: function () { return Promise.resolve(adapter.listAssets()).then(function (items) { return (items || []).map(clone); }); },
            getAsset: function (id) { return Promise.resolve(adapter.getAsset(id)).then(clone); },
            getThumbnail: function (id) { return Promise.resolve(adapter.getThumbnail(id)); },
            putAsset: function (asset) { return Promise.resolve(adapter.putAsset(normalizeAsset(asset))).then(clone); },
            listBindings: function () { return Promise.resolve(adapter.listBindings()).then(function (items) { return (items || []).map(clone); }); },
            getBinding: function (themeKey, targetKey) { return Promise.resolve(adapter.getBinding(themeKey, targetKey)).then(clone); },
            putBinding: function (binding) { return Promise.resolve(adapter.putBinding(normalizeBinding(binding))).then(clone); },
            deleteBinding: function (themeKey, targetKey) { return Promise.resolve(adapter.deleteBinding(themeKey, targetKey)); },
            deleteAsset: function (id) { return Promise.resolve(adapter.deleteAsset(id)).then(clone); },
            clear: function () { return Promise.resolve(adapter.clear()); },
            versions: { library: LIBRARY_VERSION, bindings: BINDINGS_VERSION },
        };
    };

    ns.avatarStorage = {
        DB_NAME: DB_NAME,
        DB_VERSION: DB_VERSION,
        LIBRARY_VERSION: LIBRARY_VERSION,
        BINDINGS_VERSION: BINDINGS_VERSION,
        STORES: STORES,
        normalizeAsset: normalizeAsset,
        normalizeBinding: normalizeBinding,
        normalizeView: normalizeView,
        bindingId: bindingId,
        createMemoryAdapter: createMemoryAdapter,
        createIndexedDbAdapter: createIndexedDbAdapter,
        makeError: makeError,
        idbError: idbError,
    };
})(window);
