(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};
    var RESERVED_CATEGORIES = {
        '__all__': true,
        '__starred__': true,
        '__uncategorized__': true,
    };

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function normalizeCategoryName(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function normalizeState(state) {
        if (!isPlainObject(state.backgroundLibrary)) state.backgroundLibrary = {};
        var library = state.backgroundLibrary;
        library.version = 1;
        var seen = Object.create(null);
        library.categories = (Array.isArray(library.categories) ? library.categories : []).map(normalizeCategoryName).filter(function (name) {
            if (!name || RESERVED_CATEGORIES[name] || seen[name]) return false;
            seen[name] = true;
            return true;
        });
        if (!isPlainObject(library.assetMeta)) library.assetMeta = Object.create(null);
        Object.keys(library.assetMeta).forEach(function (name) {
            var meta = library.assetMeta[name];
            if (!isPlainObject(meta)) meta = library.assetMeta[name] = {};
            meta.category = normalizeCategoryName(meta.category);
            meta.starred = meta.starred === true;
        });
        library.sortMode = library.sortMode === 'starred' ? 'starred' : 'name';
        var cardSize = Number(library.cardSize);
        library.cardSize = Number.isFinite(cardSize) ? Math.max(84, Math.min(260, Math.round(cardSize))) : 156;
        return library;
    }

    function peekMeta(state, name) {
        var library = normalizeState(state);
        var meta = library.assetMeta[name];
        return isPlainObject(meta) ? meta : { category: '', starred: false };
    }

    function ensureMeta(state, name) {
        var library = normalizeState(state);
        if (!isPlainObject(library.assetMeta[name])) library.assetMeta[name] = { category: '', starred: false };
        var meta = library.assetMeta[name];
        meta.category = normalizeCategoryName(meta.category);
        meta.starred = meta.starred === true;
        return meta;
    }

    function removeEmptyMeta(state, name) {
        var library = normalizeState(state);
        var meta = library.assetMeta[name];
        if (meta && !meta.category && meta.starred !== true) delete library.assetMeta[name];
    }

    function setCategory(state, name, category) {
        category = normalizeCategoryName(category);
        var library = normalizeState(state);
        if (category && library.categories.indexOf(category) === -1) return { ok: false, reason: 'missing-category' };
        ensureMeta(state, name).category = category;
        removeEmptyMeta(state, name);
        return { ok: true, category: category };
    }

    function toggleStarred(state, name) {
        var meta = ensureMeta(state, name);
        meta.starred = !meta.starred;
        var starred = meta.starred;
        removeEmptyMeta(state, name);
        return starred;
    }

    function addCategory(state, rawName) {
        var name = normalizeCategoryName(rawName);
        var library = normalizeState(state);
        if (!name || RESERVED_CATEGORIES[name]) return { ok: false, reason: 'invalid' };
        if (library.categories.indexOf(name) !== -1) return { ok: false, reason: 'collision' };
        library.categories.push(name);
        return { ok: true, name: name };
    }

    function renameCategory(state, oldName, rawName) {
        var name = normalizeCategoryName(rawName);
        var library = normalizeState(state);
        var index = library.categories.indexOf(oldName);
        if (index === -1 || !name || RESERVED_CATEGORIES[name]) return { ok: false, reason: 'invalid' };
        if (name !== oldName && library.categories.indexOf(name) !== -1) return { ok: false, reason: 'collision' };
        library.categories[index] = name;
        Object.keys(library.assetMeta).forEach(function (assetName) {
            if (library.assetMeta[assetName].category === oldName) library.assetMeta[assetName].category = name;
        });
        return { ok: true, name: name };
    }

    function deleteCategory(state, name) {
        var library = normalizeState(state);
        var index = library.categories.indexOf(name);
        if (index === -1) return false;
        library.categories.splice(index, 1);
        Object.keys(library.assetMeta).forEach(function (assetName) {
            if (library.assetMeta[assetName].category === name) {
                library.assetMeta[assetName].category = '';
                removeEmptyMeta(state, assetName);
            }
        });
        return true;
    }

    function moveCategory(state, from, to) {
        var categories = normalizeState(state).categories;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= categories.length || to < 0 || to >= categories.length || from === to) return false;
        categories.splice(to, 0, categories.splice(from, 1)[0]);
        return true;
    }

    function removeAsset(state, name) {
        var library = normalizeState(state);
        var existed = Object.prototype.hasOwnProperty.call(library.assetMeta, name);
        delete library.assetMeta[name];
        return existed;
    }

    function renameAsset(state, oldName, newName) {
        var library = normalizeState(state);
        if (!Object.prototype.hasOwnProperty.call(library.assetMeta, oldName)) return false;
        if (!Object.prototype.hasOwnProperty.call(library.assetMeta, newName)) library.assetMeta[newName] = library.assetMeta[oldName];
        delete library.assetMeta[oldName];
        return true;
    }

    function matchesCategory(state, name, category) {
        var meta = peekMeta(state, name);
        if (category === '__starred__') return meta.starred === true;
        if (category === '__uncategorized__') return !meta.category;
        if (category && category !== '__all__') return meta.category === category;
        return true;
    }

    function compareNames(state, a, b) {
        var library = normalizeState(state);
        if (library.sortMode === 'starred') {
            var aStar = peekMeta(state, a).starred === true;
            var bStar = peekMeta(state, b).starred === true;
            if (aStar !== bStar) return aStar ? -1 : 1;
        }
        return String(a).localeCompare(String(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
    }

    ns.backgroundLibrary = {
        ensureState: normalizeState,
        peekMeta: peekMeta,
        ensureMeta: ensureMeta,
        setCategory: setCategory,
        toggleStarred: toggleStarred,
        addCategory: addCategory,
        renameCategory: renameCategory,
        deleteCategory: deleteCategory,
        moveCategory: moveCategory,
        removeAsset: removeAsset,
        renameAsset: renameAsset,
        matchesCategory: matchesCategory,
        compareNames: compareNames,
        isReservedCategoryName: function (name) { return !!RESERVED_CATEGORIES[normalizeCategoryName(name)]; },
    };
})(window);
