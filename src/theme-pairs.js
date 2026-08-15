(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    var PAIR_VERSION = 1;
    var SHARED_META_KEYS = [
        'category',
        'tags',
        'starred',
        'useCount',
        'lastUsed',
        'author',
        'description',
    ];

    function isObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function createDictionary(source) {
        var dictionary = Object.create(null);
        if (!isObject(source)) return dictionary;
        Object.keys(source).forEach(function (key) { dictionary[key] = source[key]; });
        return dictionary;
    }

    function createState() {
        return {
            version: PAIR_VERSION,
            pairs: Object.create(null),
        };
    }

    function normalizeMeta(meta) {
        meta = isObject(meta) ? meta : {};
        return {
            category: typeof meta.category === 'string' ? meta.category : '',
            tags: Array.isArray(meta.tags)
                ? meta.tags.map(function (tag) { return String(tag || '').trim(); }).filter(Boolean)
                : [],
            starred: meta.starred === true,
            useCount: Math.max(0, Number(meta.useCount) || 0),
            lastUsed: Math.max(0, Number(meta.lastUsed) || 0),
            author: typeof meta.author === 'string' ? meta.author : '',
            description: typeof meta.description === 'string' ? meta.description : '',
        };
    }

    function normalizePair(pair, fallbackId) {
        if (!isObject(pair)) return null;
        var id = String(pair.id || fallbackId || '').trim();
        var dayTheme = String(pair.dayTheme || '').trim();
        var nightTheme = String(pair.nightTheme || '').trim();
        if (!id || !dayTheme || !nightTheme || dayTheme === nightTheme) return null;
        return {
            id: id,
            name: String(pair.name || dayTheme).trim() || dayTheme,
            dayTheme: dayTheme,
            nightTheme: nightTheme,
            meta: normalizeMeta(pair.meta),
        };
    }

    function buildUsableState(data) {
        var source = isObject(data) && isObject(data.dayNight) ? data.dayNight : createState();
        var normalizedPairs = Object.create(null);
        var claimedThemes = Object.create(null);
        var pairs = isObject(source.pairs) ? source.pairs : {};
        Object.keys(pairs).forEach(function (key) {
            var pair = normalizePair(pairs[key], key);
            if (!pair || claimedThemes[pair.dayTheme] || claimedThemes[pair.nightTheme]) return;
            claimedThemes[pair.dayTheme] = pair.id;
            claimedThemes[pair.nightTheme] = pair.id;
            normalizedPairs[pair.id] = pair;
        });
        return { version: PAIR_VERSION, pairs: normalizedPairs };
    }

    function ensureState(data) {
        return buildUsableState(data);
    }

    function ensureMutableState(data) {
        if (!isObject(data)) return createState();
        var state = buildUsableState(data);
        data.dayNight = state;
        return state;
    }

    function inspectState(data) {
        var source = isObject(data) && isObject(data.dayNight) && isObject(data.dayNight.pairs)
            ? data.dayNight.pairs
            : {};
        var claimedThemes = Object.create(null);
        var claimedIds = Object.create(null);
        var diagnostics = [];
        Object.keys(source).forEach(function (key) {
            var pair = normalizePair(source[key], key);
            if (!pair) {
                diagnostics.push({ type: 'pair', id: key, reason: 'invalid-record' });
                return;
            }
            if (claimedIds[pair.id]) {
                diagnostics.push({ type: 'pair', id: pair.id, name: pair.name, reason: 'duplicate-id', conflictsWith: claimedIds[pair.id] });
                return;
            }
            var conflicts = [pair.dayTheme, pair.nightTheme].filter(function (name) { return !!claimedThemes[name]; });
            if (conflicts.length > 0) {
                diagnostics.push({
                    type: 'pair',
                    id: pair.id,
                    name: pair.name,
                    reason: 'member-conflict',
                    members: conflicts,
                    conflictsWith: conflicts.map(function (name) { return claimedThemes[name]; }),
                });
                return;
            }
            claimedIds[pair.id] = key;
            claimedThemes[pair.dayTheme] = pair.id;
            claimedThemes[pair.nightTheme] = pair.id;
        });
        return diagnostics;
    }

    function makePairTarget(pairId) {
        pairId = String(pairId || '').trim();
        return pairId ? { kind: 'day-night', pairId: pairId } : null;
    }

    function makeItemKey(kind, value) {
        return kind === 'pair' ? ('pair:' + value) : ('theme:' + value);
    }

    function createPairId(state) {
        var id = '';
        try {
            if (global.crypto && typeof global.crypto.randomUUID === 'function') {
                id = 'dn-' + global.crypto.randomUUID();
            }
        } catch (e) {}
        if (!id) id = 'dn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
        while (state.pairs[id]) id += '-x';
        return id;
    }

    function mergeInitialMeta(data, dayTheme, nightTheme) {
        var day = isObject(data.themeMeta) && Object.prototype.hasOwnProperty.call(data.themeMeta, dayTheme) && isObject(data.themeMeta[dayTheme]) ? data.themeMeta[dayTheme] : {};
        var night = isObject(data.themeMeta) && Object.prototype.hasOwnProperty.call(data.themeMeta, nightTheme) && isObject(data.themeMeta[nightTheme]) ? data.themeMeta[nightTheme] : {};
        var tags = [];
        [day.tags, night.tags].forEach(function (list) {
            if (!Array.isArray(list)) return;
            list.forEach(function (tag) {
                tag = String(tag || '').trim();
                if (tag && tags.indexOf(tag) === -1) tags.push(tag);
            });
        });
        return normalizeMeta({
            category: day.category || night.category || '',
            tags: tags,
            starred: day.starred === true || night.starred === true,
            useCount: Math.max(Number(day.useCount) || 0, Number(night.useCount) || 0),
            lastUsed: Math.max(Number(day.lastUsed) || 0, Number(night.lastUsed) || 0),
            author: day.author || night.author || '',
            description: day.description || night.description || '',
        });
    }

    function createPair(data, input) {
        input = input || {};
        var state = ensureState(data);
        var dayTheme = String(input.dayTheme || '').trim();
        var nightTheme = String(input.nightTheme || '').trim();
        var name = String(input.name || '').trim();
        if (!dayTheme || !nightTheme || dayTheme === nightTheme || !name) {
            return { ok: false, reason: 'invalid' };
        }
        if (findPairByTheme(data, dayTheme) || findPairByTheme(data, nightTheme)) {
            return { ok: false, reason: 'already-paired' };
        }
        var id = String(input.id || '').trim() || createPairId(state);
        if (state.pairs[id]) return { ok: false, reason: 'duplicate-id' };
        var pair = normalizePair({
            id: id,
            name: name,
            dayTheme: dayTheme,
            nightTheme: nightTheme,
            meta: input.meta || mergeInitialMeta(data, dayTheme, nightTheme),
        }, id);
        if (!pair) return { ok: false, reason: 'invalid' };
        state = ensureMutableState(data);
        state.pairs[id] = pair;
        return { ok: true, pair: pair };
    }

    function getPair(data, pairId) {
        pairId = String(pairId || '').trim();
        return pairId ? (ensureState(data).pairs[pairId] || null) : null;
    }

    function getPairForWrite(data, pairId) {
        pairId = String(pairId || '').trim();
        if (!pairId || !ensureState(data).pairs[pairId]) return null;
        return ensureMutableState(data).pairs[pairId] || null;
    }

    function findPairByTheme(data, themeName) {
        themeName = String(themeName || '').trim();
        if (!themeName) return null;
        var state = ensureState(data);
        var found = null;
        Object.keys(state.pairs).some(function (id) {
            var pair = state.pairs[id];
            if (pair.dayTheme === themeName || pair.nightTheme === themeName) {
                found = pair;
                return true;
            }
            return false;
        });
        return found;
    }

    function getVariantTheme(data, pairId, variant) {
        var pair = getPair(data, pairId);
        if (!pair) return '';
        return variant === 'night' ? pair.nightTheme : pair.dayTheme;
    }

    function copySharedMetaToTheme(data, themeName, meta) {
        if (!themeName) return;
        if (!isObject(data.themeMeta) || Object.getPrototypeOf(data.themeMeta) !== null) data.themeMeta = createDictionary(data.themeMeta);
        if (!Object.prototype.hasOwnProperty.call(data.themeMeta, themeName) || !isObject(data.themeMeta[themeName])) data.themeMeta[themeName] = {};
        SHARED_META_KEYS.forEach(function (key) {
            data.themeMeta[themeName][key] = clone(meta[key]);
        });
    }

    function dissolvePair(data, pairId) {
        var pair = ensureState(data).pairs[pairId];
        if (!pair) return null;
        var state = ensureMutableState(data);
        pair = state.pairs[pairId];
        copySharedMetaToTheme(data, pair.dayTheme, pair.meta);
        copySharedMetaToTheme(data, pair.nightTheme, pair.meta);
        delete state.pairs[pairId];
        return pair;
    }

    function renamePair(data, pairId, name) {
        name = String(name || '').trim();
        var pair = getPair(data, pairId);
        if (!pair || !name) return false;
        pair = ensureMutableState(data).pairs[String(pairId || '').trim()];
        pair.name = name;
        return true;
    }

    function renameThemeReferences(data, oldName, newName) {
        oldName = String(oldName || '').trim();
        newName = String(newName || '').trim();
        if (!oldName || !newName || oldName === newName) return 0;
        var state = ensureState(data);
        var changed = 0;
        Object.keys(state.pairs).forEach(function (id) {
            var pair = state.pairs[id];
            if (pair.dayTheme === oldName) {
                pair.dayTheme = newName;
                changed += 1;
            }
            if (pair.nightTheme === oldName) {
                pair.nightTheme = newName;
                changed += 1;
            }
        });
        if (!changed) return 0;
        state = ensureMutableState(data);
        changed = 0;
        Object.keys(state.pairs).forEach(function (id) {
            var pair = state.pairs[id];
            if (pair.dayTheme === oldName) {
                pair.dayTheme = newName;
                changed += 1;
            }
            if (pair.nightTheme === oldName) {
                pair.nightTheme = newName;
                changed += 1;
            }
        });
        return changed;
    }

    function removeThemeReferences(data, themeNames) {
        var removed = Object.create(null);
        (Array.isArray(themeNames) ? themeNames : [themeNames]).forEach(function (name) {
            name = String(name || '').trim();
            if (name) removed[name] = true;
        });
        var state = ensureState(data);
        var affectedIds = Object.keys(state.pairs).filter(function (id) {
            var pair = state.pairs[id];
            return !!removed[pair.dayTheme] || !!removed[pair.nightTheme];
        });
        if (affectedIds.length === 0) return [];
        state = ensureMutableState(data);
        var migrations = [];
        affectedIds.forEach(function (id) {
            var pair = state.pairs[id];
            var dayRemoved = !!removed[pair.dayTheme];
            var nightRemoved = !!removed[pair.nightTheme];
            if (!dayRemoved && !nightRemoved) return;
            var replacementTheme = dayRemoved && !nightRemoved
                ? pair.nightTheme
                : (nightRemoved && !dayRemoved ? pair.dayTheme : '');
            if (replacementTheme) copySharedMetaToTheme(data, replacementTheme, pair.meta);
            delete state.pairs[id];
            migrations.push({
                pairId: id,
                replacementTheme: replacementTheme,
                pair: pair,
            });
        });
        return migrations;
    }

    function pairHasTheme(pair, themeName) {
        return !!pair && (pair.dayTheme === themeName || pair.nightTheme === themeName);
    }

    function buildLogicalItems(data, themeNames) {
        var state = ensureState(data);
        var present = Object.create(null);
        (themeNames || []).forEach(function (name) {
            name = String(name || '').trim();
            if (name) present[name] = true;
        });
        var claimed = Object.create(null);
        var items = [];
        Object.keys(state.pairs).forEach(function (id) {
            var pair = state.pairs[id];
            var dayPresent = !!present[pair.dayTheme];
            var nightPresent = !!present[pair.nightTheme];
            if (!dayPresent && !nightPresent) return;
            claimed[pair.dayTheme] = true;
            claimed[pair.nightTheme] = true;
            items.push({
                key: makeItemKey('pair', id),
                kind: 'pair',
                pairId: id,
                name: pair.name,
                dayTheme: pair.dayTheme,
                nightTheme: pair.nightTheme,
                themeNames: [pair.dayTheme, pair.nightTheme],
                dayPresent: dayPresent,
                nightPresent: nightPresent,
                meta: pair.meta,
            });
        });
        (themeNames || []).forEach(function (name) {
            if (!name || claimed[name]) return;
            items.push({
                key: makeItemKey('theme', name),
                kind: 'theme',
                name: name,
                themeName: name,
                themeNames: [name],
                meta: isObject(data.themeMeta) && Object.prototype.hasOwnProperty.call(data.themeMeta, name) && isObject(data.themeMeta[name]) ? data.themeMeta[name] : {},
            });
        });
        return items;
    }

    function getLogicalItem(data, themeNames, ref) {
        ref = String(ref || '').trim();
        var items = buildLogicalItems(data, themeNames);
        var found = items.find(function (item) {
            return item.key === ref ||
                (item.kind === 'theme' && item.themeName === ref) ||
                (item.kind === 'pair' && (item.pairId === ref || pairHasTheme(item, ref)));
        });
        return found || null;
    }

    function targetForItem(item) {
        if (!item) return null;
        return item.kind === 'pair'
            ? makePairTarget(item.pairId)
            : { kind: 'theme', themeName: item.themeName };
    }

    function targetForTheme(data, themeName) {
        var pair = findPairByTheme(data, themeName);
        return pair ? makePairTarget(pair.id) : { kind: 'theme', themeName: String(themeName || '').trim() };
    }

    function resolveTargetTheme(data, target, variant) {
        if (!target || typeof target !== 'object') return '';
        if (target.kind === 'theme') return String(target.themeName || '').trim();
        if (target.kind === 'day-night') return getVariantTheme(data, target.pairId, variant);
        return '';
    }

    function cleanPairForExport(pair) {
        return {
            id: pair.id,
            name: pair.name,
            dayTheme: pair.dayTheme,
            nightTheme: pair.nightTheme,
            meta: normalizeMeta(pair.meta),
        };
    }

    function exportPairs(data, themeNames) {
        var included = Object.create(null);
        (themeNames || []).forEach(function (name) { included[name] = true; });
        var state = ensureState(data);
        return Object.keys(state.pairs).map(function (id) { return state.pairs[id]; })
            .filter(function (pair) { return included[pair.dayTheme] && included[pair.nightTheme]; })
            .map(cleanPairForExport);
    }

    function importPairs(data, rawPairs, availableThemeNames) {
        var available = Object.create(null);
        (availableThemeNames || []).forEach(function (name) { available[name] = true; });
        var imported = 0;
        var skipped = 0;
        var idMap = Object.create(null);
        var skippedIds = [];
        var diagnostics = [];
        var list = Array.isArray(rawPairs)
            ? rawPairs
            : (isObject(rawPairs) ? Object.keys(rawPairs).map(function (id) {
                var item = clone(rawPairs[id]);
                if (isObject(item) && !item.id) item.id = id;
                return item;
            }) : []);
        list.forEach(function (raw) {
            var pair = normalizePair(raw, raw && raw.id);
            if (!pair) {
                skipped += 1;
                diagnostics.push({ type: 'pair', id: raw && raw.id ? String(raw.id) : '', reason: 'invalid-record' });
                return;
            }
            var missingThemes = [pair.dayTheme, pair.nightTheme].filter(function (name) { return !available[name]; });
            if (missingThemes.length > 0) {
                skipped += 1;
                skippedIds.push(pair.id);
                diagnostics.push({ type: 'pair', id: pair.id, name: pair.name, reason: 'missing-theme', members: missingThemes });
                return;
            }
            var existingDay = findPairByTheme(data, pair.dayTheme);
            var existingNight = findPairByTheme(data, pair.nightTheme);
            if (existingDay || existingNight) {
                if (existingDay && existingNight && existingDay.id === existingNight.id &&
                    existingDay.dayTheme === pair.dayTheme && existingDay.nightTheme === pair.nightTheme) {
                    idMap[pair.id] = existingDay.id;
                    diagnostics.push({ type: 'pair', id: pair.id, name: pair.name, reason: 'already-present', severity: 'info', mappedId: existingDay.id });
                } else {
                    skippedIds.push(pair.id);
                    diagnostics.push({
                        type: 'pair',
                        id: pair.id,
                        name: pair.name,
                        reason: 'member-conflict',
                        members: [pair.dayTheme, pair.nightTheme],
                        conflictsWith: [existingDay && existingDay.id, existingNight && existingNight.id].filter(Boolean),
                    });
                }
                skipped += 1;
                return;
            }
            var result = createPair(data, {
                id: ensureState(data).pairs[pair.id] ? '' : pair.id,
                name: pair.name,
                dayTheme: pair.dayTheme,
                nightTheme: pair.nightTheme,
                meta: pair.meta,
            });
            if (result.ok) {
                imported += 1;
                idMap[pair.id] = result.pair.id;
            } else {
                skipped += 1;
                skippedIds.push(pair.id);
                diagnostics.push({ type: 'pair', id: pair.id, name: pair.name, reason: result.reason || 'create-failed' });
            }
        });
        return { imported: imported, skipped: skipped, idMap: idMap, skippedIds: skippedIds, diagnostics: diagnostics };
    }

    function suggestPairName(dayName, nightName) {
        function strip(name) {
            return String(name || '')
                .replace(/[\s_-]*(?:日间|白天|浅色|light|day|夜间|夜晚|深色|dark|night)[\s_-]*$/i, '')
                .trim();
        }
        var dayBase = strip(dayName);
        var nightBase = strip(nightName);
        if (dayBase && dayBase.toLowerCase() === nightBase.toLowerCase()) return dayBase;
        if (dayBase && nightBase) return dayBase + ' / ' + nightBase;
        return dayBase || nightBase || (String(dayName || '') + ' / ' + String(nightName || ''));
    }

    function createColorSchemeWatcher(options) {
        options = options || {};
        var matchMediaFn = options.matchMedia;
        var documentRef = options.document || global.document;
        var windowRef = options.window || global;
        var setIntervalFn = options.setInterval || global.setInterval;
        var clearIntervalFn = options.clearInterval || global.clearInterval;
        var onChange = options.onChange;
        var intervalMs = Math.max(250, Number(options.intervalMs) || 1000);
        var mediaQuery = null;
        var mediaListener = null;
        var pollTimer = null;
        var started = false;
        var lastVariant = '';

        if (typeof matchMediaFn !== 'function' && typeof global.matchMedia === 'function') {
            matchMediaFn = function (query) { return global.matchMedia(query); };
        }

        function readVariant() {
            if (typeof matchMediaFn !== 'function') return 'day';
            try {
                // Some mobile WebViews keep the first MediaQueryList object stale.
                // Ask for a fresh object on every check instead of trusting it.
                return matchMediaFn('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
            } catch (e) {
                return 'day';
            }
        }

        function check(reason) {
            var next = readVariant();
            if (!lastVariant) {
                lastVariant = next;
                return false;
            }
            if (next === lastVariant) return false;
            var previous = lastVariant;
            lastVariant = next;
            if (typeof onChange === 'function') onChange(next, previous, reason || 'check');
            return true;
        }

        function handleMediaChange() {
            check('media-query');
        }

        function handleVisibilityChange() {
            check('visibility');
        }

        function handleFocus() {
            check('focus');
        }

        function start() {
            if (started) return;
            started = true;
            lastVariant = readVariant();
            try {
                mediaQuery = typeof matchMediaFn === 'function'
                    ? matchMediaFn('(prefers-color-scheme: dark)')
                    : null;
            } catch (e) {
                mediaQuery = null;
            }
            mediaListener = handleMediaChange;
            if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
                mediaQuery.addEventListener('change', mediaListener);
            } else if (mediaQuery && typeof mediaQuery.addListener === 'function') {
                mediaQuery.addListener(mediaListener);
            }
            if (documentRef && typeof documentRef.addEventListener === 'function') {
                documentRef.addEventListener('visibilitychange', handleVisibilityChange);
            }
            if (windowRef && typeof windowRef.addEventListener === 'function') {
                windowRef.addEventListener('focus', handleFocus);
                windowRef.addEventListener('pageshow', handleFocus);
            }
            if (typeof setIntervalFn === 'function') {
                pollTimer = setIntervalFn(function () { check('poll'); }, intervalMs);
            }
        }

        function stop() {
            if (!started) return;
            started = false;
            if (mediaQuery && mediaListener && typeof mediaQuery.removeEventListener === 'function') {
                mediaQuery.removeEventListener('change', mediaListener);
            } else if (mediaQuery && mediaListener && typeof mediaQuery.removeListener === 'function') {
                mediaQuery.removeListener(mediaListener);
            }
            if (documentRef && typeof documentRef.removeEventListener === 'function') {
                documentRef.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            if (windowRef && typeof windowRef.removeEventListener === 'function') {
                windowRef.removeEventListener('focus', handleFocus);
                windowRef.removeEventListener('pageshow', handleFocus);
            }
            if (pollTimer !== null && typeof clearIntervalFn === 'function') {
                clearIntervalFn(pollTimer);
            }
            mediaQuery = null;
            mediaListener = null;
            pollTimer = null;
        }

        return {
            start: start,
            stop: stop,
            check: check,
            getVariant: readVariant,
        };
    }

    ns.themePairs = {
        PAIR_VERSION: PAIR_VERSION,
        SHARED_META_KEYS: SHARED_META_KEYS.slice(),
        createState: createState,
        ensureState: ensureState,
        ensureMutableState: ensureMutableState,
        inspectState: inspectState,
        normalizeMeta: normalizeMeta,
        makePairTarget: makePairTarget,
        makeItemKey: makeItemKey,
        createPair: createPair,
        getPair: getPair,
        getPairForWrite: getPairForWrite,
        findPairByTheme: findPairByTheme,
        getVariantTheme: getVariantTheme,
        buildLogicalItems: buildLogicalItems,
        getLogicalItem: getLogicalItem,
        targetForItem: targetForItem,
        targetForTheme: targetForTheme,
        resolveTargetTheme: resolveTargetTheme,
        dissolvePair: dissolvePair,
        renamePair: renamePair,
        renameThemeReferences: renameThemeReferences,
        removeThemeReferences: removeThemeReferences,
        exportPairs: exportPairs,
        importPairs: importPairs,
        suggestPairName: suggestPairName,
        createColorSchemeWatcher: createColorSchemeWatcher,
    };
})(window);
