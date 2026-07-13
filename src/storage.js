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

        var dbInstance = null;
        var dataCache = null;
        var serverMode = false;
        var serverDirty = false;
        var serverPutInFlight = false;
        var serverDebounceTimer = null;
        var SERVER_DEBOUNCE_MS = 800;

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

        function loadFromLS() {
            try { var r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
        }

        function loadFromDB(cb) {
            if (dataCache) { cb(dataCache); return; }
            openDB(function (db) {
                if (!db) { dataCache = ensureDefaults(loadFromLS()); cb(dataCache); return; }
                var tx = db.transaction(STORE_NAME, 'readonly');
                var req = tx.objectStore(STORE_NAME).get(DATA_KEY);
                req.onsuccess = function () { dataCache = ensureDefaults(req.result || loadFromLS()); cb(dataCache); };
                req.onerror = function () { dataCache = ensureDefaults(loadFromLS()); cb(dataCache); };
            });
        }

        function saveToDB(d, cb) {
            dataCache = d;
            openDB(function (db) {
                if (!db) {
                    try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {}
                    if (cb) cb();
                    return;
                }
                var tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).put(d, DATA_KEY);
                tx.oncomplete = function () { if (cb) cb(); };
                tx.onerror = function () { if (cb) cb(); };
            });
        }

        function load() {
            if (dataCache) return dataCache;
            dataCache = ensureDefaults(loadFromLS());
            return dataCache;
        }

        function save(d) {
            dataCache = ensureDefaults(d);
            saveToDB(dataCache);
            scheduleServerPut();
        }

        function detectServer(cb) {
            fetch(SERVER_BASE + '/status', { method: 'GET', credentials: 'same-origin' })
                .then(function (r) { return r && r.ok ? r.json() : null; })
                .then(function (j) { cb(!!(j && j.ok)); })
                .catch(function () { cb(false); });
        }

        function serverGetData(cb) {
            fetch(SERVER_BASE + '/data', { method: 'GET', credentials: 'same-origin' })
                .then(function (r) { return r && r.ok ? r.json() : null; })
                .then(function (j) { cb(j && j.ok ? (j.data || null) : null); })
                .catch(function () { cb(null); });
        }

        function scheduleServerPut() {
            if (!serverMode || !dataCache) return;
            serverDirty = true;
            if (serverDebounceTimer) clearTimeout(serverDebounceTimer);
            serverDebounceTimer = setTimeout(function () {
                serverDebounceTimer = null;
                if (!serverDirty) return;
                serverDirty = false;
                serverPutDataNow();
            }, SERVER_DEBOUNCE_MS);
        }

        function serverPutDataNow(cb) {
            if (!serverMode || !dataCache) { if (cb) cb(false); return; }
            if (serverPutInFlight) { serverDirty = true; if (cb) cb(false); return; }
            serverPutInFlight = true;
            getPostHeaders()
                .then(function (headers) {
                    return fetch(SERVER_BASE + '/data', {
                        method: 'PUT',
                        credentials: 'same-origin',
                        headers: headers,
                        body: JSON.stringify(dataCache),
                    });
                })
                .then(function (r) { return r && r.ok ? r.json() : null; })
                .then(function (j) {
                    if (j && j.ok && j.data) {
                        dataCache = ensureDefaults(j.data);
                        saveToDB(dataCache);
                    }
                    if (cb) cb(!!(j && j.ok));
                })
                .catch(function () { if (cb) cb(false); })
                .then(function () {
                    serverPutInFlight = false;
                    if (serverDirty) {
                        serverDirty = false;
                        serverPutDataNow();
                    }
                });
        }

        function isDataImage(value) {
            return typeof value === 'string' && value.indexOf('data:image/') === 0;
        }

        function isServerImage(value) {
            return typeof value === 'string' && value.indexOf(SERVER_IMAGE_PREFIX) === 0;
        }

        function uploadImage(dataUrl, cb) {
            if (!serverMode || !isDataImage(dataUrl)) { cb(null, dataUrl); return; }
            getPostHeaders()
                .then(function (headers) {
                    return fetch(SERVER_BASE + '/images', {
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
            getPostHeaders()
                .then(function (headers) {
                    return fetch(SERVER_BASE + '/images/batch-fetch', {
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
            if (!serverMode || !d) { if (cb) cb(false); return; }
            var refs = collectImageFields(d).filter(function (ref) { return isDataImage(ref.value); });
            if (refs.length === 0) { if (cb) cb(false); return; }
            var idx = 0;
            function next() {
                if (idx >= refs.length) {
                    dataCache = ensureDefaults(d);
                    saveToDB(dataCache);
                    serverPutDataNow(function () { if (cb) cb(true); });
                    try { console.log('[美化管理] 已迁移图片到后端:', refs.length); } catch (e) {}
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

        function initStorage(cb) {
            detectServer(function (ok) {
                serverMode = !!ok;
                if (!serverMode) { loadFromDB(cb); return; }
                serverGetData(function (serverData) {
                    if (serverData && typeof serverData === 'object') {
                        dataCache = ensureDefaults(serverData);
                        saveToDB(dataCache, function () {
                            migrateImagesToServer(dataCache, function () { cb(dataCache); });
                        });
                        return;
                    }
                    loadFromDB(function (localData) {
                        dataCache = ensureDefaults(localData);
                        migrateImagesToServer(dataCache, function () {
                            serverPutDataNow(function () { cb(dataCache); });
                        });
                    });
                });
            });
        }

        return {
            load: load,
            save: save,
            saveToDB: saveToDB,
            loadFromLS: loadFromLS,
            initStorage: initStorage,
            uploadImage: uploadImage,
            batchResolveImages: batchResolveImages,
            collectImageFields: collectImageFields,
            isDataImage: isDataImage,
            isServerImage: isServerImage,
            getServerMode: function () { return serverMode; },
        };
    };
})(window);
