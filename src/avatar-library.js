(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var VERSION = 1;
    var RESERVED_CATEGORIES = new Set(['__all__', '__uncategorized__', '__new__', '__keep__']);
    var normalizedStates = new WeakSet();

    function clean(value) { return String(value == null ? '' : value).trim(); }
    function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
    function dictionary(source) {
        var result = Object.create(null);
        if (!isObject(source)) return result;
        Object.keys(source).forEach(function (key) { result[key] = source[key]; });
        return result;
    }
    function uniqueTexts(values) {
        var seen = new Set();
        return (Array.isArray(values) ? values : []).map(clean).filter(function (value) {
            if (!value || seen.has(value)) return false;
            seen.add(value); return true;
        });
    }
    function normalizeMeta(raw) {
        raw = isObject(raw) ? raw : {};
        var order = Number(raw.importOrder);
        return {
            category: clean(raw.category),
            tags: uniqueTexts(raw.tags),
            importOrder: Number.isSafeInteger(order) && order > 0 ? order : 0,
        };
    }
    function normalizeGroup(raw, key) {
        raw = isObject(raw) ? raw : {};
        var id = clean(raw.id || key);
        var members = uniqueTexts(raw.members);
        if (!id || !clean(raw.name) || members.length < 2) return null;
        return { id: id, name: clean(raw.name), members: members };
    }
    function createState() {
        return {
            version: VERSION,
            categories: [],
            assetMeta: Object.create(null),
            series: { version: VERSION, groups: Object.create(null) },
            sortMode: 'import-desc',
            nextImportOrder: 1,
        };
    }
    function ensureState(data) {
        if (!isObject(data)) throw new TypeError('avatar library data must be an object');
        var source = isObject(data.avatarLibrary) ? data.avatarLibrary : {};
        if (normalizedStates.has(source)) return source;
        var state = createState();
        state.categories = uniqueTexts(source.categories).filter(function (name) { return !RESERVED_CATEGORIES.has(name); });
        var rawMeta = dictionary(source.assetMeta);
        Object.keys(rawMeta).forEach(function (id) {
            id = clean(id);
            if (id) state.assetMeta[id] = normalizeMeta(rawMeta[id]);
        });
        var claimed = new Set();
        var rawGroups = isObject(source.series) && isObject(source.series.groups) ? source.series.groups : {};
        Object.keys(rawGroups).forEach(function (key) {
            var group = normalizeGroup(rawGroups[key], key);
            if (!group || state.series.groups[group.id]) return;
            group.members = group.members.filter(function (id) { return !claimed.has(id); });
            if (group.members.length >= 2) {
                group.members.forEach(function (id) { claimed.add(id); });
                state.series.groups[group.id] = group;
            }
        });
        state.sortMode = source.sortMode === 'import-asc' ? 'import-asc' : 'import-desc';
        var maxOrder = Object.keys(state.assetMeta).reduce(function (max, id) {
            return Math.max(max, state.assetMeta[id].importOrder || 0);
        }, 0);
        var next = Number(source.nextImportOrder);
        state.nextImportOrder = Number.isSafeInteger(next) && next > maxOrder ? next : maxOrder + 1;
        data.avatarLibrary = state;
        normalizedStates.add(state);
        return state;
    }
    function peekMeta(data, id) {
        var state = ensureState(data);
        return state.assetMeta[clean(id)] || { category: '', tags: [], importOrder: 0 };
    }
    function peekMetaInState(state, id) {
        return state.assetMeta[clean(id)] || { category: '', tags: [], importOrder: 0 };
    }
    function ensureMetaInState(state, id) {
        id = clean(id);
        if (!id) throw new TypeError('avatar id is required');
        if (!state.assetMeta[id]) state.assetMeta[id] = normalizeMeta({});
        return state.assetMeta[id];
    }
    function ensureMeta(data, id) {
        return ensureMetaInState(ensureState(data), id);
    }
    function assignImportOrders(data, ids) {
        var state = ensureState(data);
        uniqueTexts(ids).forEach(function (id) {
            var meta = ensureMetaInState(state, id);
            if (!meta.importOrder) meta.importOrder = state.nextImportOrder++;
        });
        return state;
    }
    function createdValue(asset) {
        var value = Date.parse(asset && asset.createdAt || '');
        return Number.isFinite(value) ? value : 0;
    }
    function compareAssets(data, left, right, mode) {
        var state = ensureState(data);
        var a = peekMetaInState(state, left.id).importOrder;
        var b = peekMetaInState(state, right.id).importOrder;
        var direction = mode === 'import-asc' ? 1 : -1;
        if (a && b && a !== b) return direction * (a - b);
        if (a !== b) return direction * (a ? 1 : -1);
        var timeDiff = createdValue(left) - createdValue(right);
        if (timeDiff) return direction * timeDiff;
        return direction * clean(left.id).localeCompare(clean(right.id));
    }
    function listTags(data) {
        var seen = new Set();
        var state = ensureState(data);
        Object.keys(state.assetMeta).forEach(function (id) {
            peekMetaInState(state, id).tags.forEach(function (tag) { seen.add(tag); });
        });
        return Array.from(seen).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
    }
    function findSeriesInState(state, avatarId) {
        avatarId = clean(avatarId);
        var groups = state.series.groups;
        var keys = Object.keys(groups);
        for (var i = 0; i < keys.length; i += 1) {
            if (groups[keys[i]].members.indexOf(avatarId) !== -1) return groups[keys[i]];
        }
        return null;
    }
    function findSeries(data, avatarId) {
        return findSeriesInState(ensureState(data), avatarId);
    }
    function makeSeriesId() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') return 'avatar-series-' + global.crypto.randomUUID();
        return 'avatar-series-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    }
    function createSeries(data, name, members) {
        var state = ensureState(data);
        name = clean(name); members = uniqueTexts(members);
        if (!name || members.length < 2) return { ok: false, reason: 'invalid' };
        var conflict = members.find(function (id) { return !!findSeriesInState(state, id); });
        if (conflict) return { ok: false, reason: 'already-series', avatarId: conflict };
        var id = makeSeriesId();
        state.series.groups[id] = { id: id, name: name, members: members };
        return { ok: true, series: state.series.groups[id] };
    }
    function addMember(data, seriesId, avatarId) {
        var state = ensureState(data);
        var group = state.series.groups[clean(seriesId)];
        avatarId = clean(avatarId);
        if (!group || !avatarId) return { ok: false, reason: 'missing' };
        var owner = findSeriesInState(state, avatarId);
        if (owner) return { ok: false, reason: 'already-series', series: owner };
        group.members.push(avatarId);
        return { ok: true, series: group };
    }
    function removeMember(data, seriesId, avatarId) {
        var state = ensureState(data);
        var group = state.series.groups[clean(seriesId)];
        if (!group) return { ok: false, reason: 'missing' };
        var index = group.members.indexOf(clean(avatarId));
        if (index === -1) return { ok: false, reason: 'not-member' };
        group.members.splice(index, 1);
        if (group.members.length < 2) {
            delete state.series.groups[group.id];
            return { ok: true, dissolved: true };
        }
        return { ok: true, dissolved: false, series: group };
    }
    function moveMember(data, seriesId, avatarId, delta) {
        var state = ensureState(data);
        var group = state.series.groups[clean(seriesId)];
        if (!group) return { ok: false, reason: 'missing' };
        var index = group.members.indexOf(clean(avatarId));
        var target = index + (Number(delta) < 0 ? -1 : 1);
        if (index === -1 || target < 0 || target >= group.members.length) return { ok: false, reason: 'boundary' };
        var member = group.members.splice(index, 1)[0];
        group.members.splice(target, 0, member);
        return { ok: true, series: group };
    }
    function dissolveSeries(data, seriesId) {
        var groups = ensureState(data).series.groups;
        seriesId = clean(seriesId);
        if (!groups[seriesId]) return false;
        delete groups[seriesId]; return true;
    }
    function removeAssetReferences(data, avatarId) {
        var state = ensureState(data);
        avatarId = clean(avatarId);
        delete state.assetMeta[avatarId];
        var owner = findSeriesInState(state, avatarId);
        if (owner) {
            var index = owner.members.indexOf(avatarId);
            if (index !== -1) owner.members.splice(index, 1);
            if (owner.members.length < 2) delete state.series.groups[owner.id];
        }
        return state;
    }
    function renameCategory(data, oldName, newName) {
        var state = ensureState(data);
        oldName = clean(oldName); newName = clean(newName);
        if (!oldName || !newName || RESERVED_CATEGORIES.has(newName)) return { ok: false, reason: 'invalid' };
        if (oldName !== newName && state.categories.indexOf(newName) !== -1) return { ok: false, reason: 'collision' };
        var index = state.categories.indexOf(oldName);
        if (index === -1) return { ok: false, reason: 'missing' };
        state.categories[index] = newName;
        Object.keys(state.assetMeta).forEach(function (id) { if (state.assetMeta[id].category === oldName) state.assetMeta[id].category = newName; });
        return { ok: true };
    }
    function deleteCategory(data, name) {
        var state = ensureState(data);
        name = clean(name);
        var index = state.categories.indexOf(name);
        if (index === -1) return false;
        state.categories.splice(index, 1);
        Object.keys(state.assetMeta).forEach(function (id) { if (state.assetMeta[id].category === name) state.assetMeta[id].category = ''; });
        return true;
    }

    ns.avatarLibrary = {
        VERSION: VERSION,
        ensureState: ensureState,
        peekMeta: peekMeta,
        ensureMeta: ensureMeta,
        assignImportOrders: assignImportOrders,
        compareAssets: compareAssets,
        listTags: listTags,
        findSeries: findSeries,
        createSeries: createSeries,
        addMember: addMember,
        removeMember: removeMember,
        moveMember: moveMember,
        dissolveSeries: dissolveSeries,
        removeAssetReferences: removeAssetReferences,
        renameCategory: renameCategory,
        deleteCategory: deleteCategory,
        isReservedCategoryName: function (name) { return RESERVED_CATEGORIES.has(clean(name)); },
    };
})(window);
