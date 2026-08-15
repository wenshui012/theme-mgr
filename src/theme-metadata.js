(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    var DEFAULT_META = Object.freeze({
        category: '',
        tags: Object.freeze([]),
        starred: false,
        imageData: null,
        thumbData: null,
        crop: null,
        useCount: 0,
        lastUsed: 0,
        author: '',
        description: '',
        backgroundName: '',
    });
    var RESERVED_CATEGORY_NAMES = Object.freeze([
        '__all__',
        '__uncategorized__',
        '__new__',
        '__keep__',
    ]);

    function isObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function createDictionary(source) {
        var dictionary = Object.create(null);
        if (!isObject(source)) return dictionary;
        Object.keys(source).forEach(function (key) { dictionary[key] = source[key]; });
        return dictionary;
    }

    function ensureThemeMetaDictionary(data) {
        if (!isObject(data)) throw new TypeError('metadata data must be an object');
        if (!isObject(data.themeMeta) || Object.getPrototypeOf(data.themeMeta) !== null) {
            data.themeMeta = createDictionary(data.themeMeta);
        }
        return data.themeMeta;
    }

    function createMeta() {
        return {
            category: '',
            tags: [],
            starred: false,
            imageData: null,
            thumbData: null,
            crop: null,
            useCount: 0,
            lastUsed: 0,
            author: '',
            description: '',
            backgroundName: '',
        };
    }

    function peekMeta(data, name) {
        var themeMeta = isObject(data) && isObject(data.themeMeta) ? data.themeMeta : null;
        var key = String(name || '');
        var meta = themeMeta && Object.prototype.hasOwnProperty.call(themeMeta, key) ? themeMeta[key] : null;
        return isObject(meta) ? meta : DEFAULT_META;
    }

    function ensureMeta(data, name) {
        if (!isObject(data)) throw new TypeError('metadata data must be an object');
        name = String(name || '').trim();
        if (!name) throw new TypeError('metadata theme name is required');
        var themeMeta = ensureThemeMetaDictionary(data);
        if (!Object.prototype.hasOwnProperty.call(themeMeta, name) || !isObject(themeMeta[name])) themeMeta[name] = createMeta();
        var meta = themeMeta[name];
        if (!Array.isArray(meta.tags)) meta.tags = [];
        if (meta.backgroundName === undefined) meta.backgroundName = '';
        if (meta.thumbData === undefined) meta.thumbData = null;
        if (meta.crop === undefined) meta.crop = null;
        return meta;
    }

    function hasMeaningfulAnnotation(meta) {
        if (!isObject(meta)) return false;
        return Boolean(
            (typeof meta.category === 'string' && meta.category.trim()) ||
            (Array.isArray(meta.tags) && meta.tags.some(function (tag) { return String(tag || '').trim(); })) ||
            meta.starred === true ||
            (typeof meta.author === 'string' && meta.author.trim()) ||
            (typeof meta.description === 'string' && meta.description.trim()) ||
            (typeof meta.backgroundName === 'string' && meta.backgroundName.trim()) ||
            (typeof meta.imageData === 'string' && meta.imageData) ||
            (typeof meta.thumbData === 'string' && meta.thumbData) ||
            (isObject(meta.crop) && Object.keys(meta.crop).length > 0)
        );
    }

    function inspect(themeNames, themeMeta) {
        var inventoryNames = Array.isArray(themeNames) ? themeNames : [];
        var metadata = isObject(themeMeta) ? themeMeta : {};
        var counts = Object.create(null);
        var order = [];
        inventoryNames.forEach(function (rawName) {
            var name = String(rawName || '').trim();
            if (!name) return;
            if (counts[name] === undefined) order.push(name);
            counts[name] = (counts[name] || 0) + 1;
        });
        var inventorySet = Object.create(null);
        order.forEach(function (name) { inventorySet[name] = true; });
        var inventoryDuplicateNames = order.filter(function (name) { return counts[name] > 1; }).map(function (name) {
            return { name: name, count: counts[name] };
        });
        var orphanMetadata = [];
        var emptyMetadata = [];
        var annotatedNames = [];
        Object.keys(metadata).forEach(function (name) {
            var meaningful = hasMeaningfulAnnotation(metadata[name]);
            if (!inventorySet[name]) orphanMetadata.push(name);
            else if (meaningful) annotatedNames.push(name);
            if (!meaningful) emptyMetadata.push(name);
        });
        var inventoryWithoutMetadata = order.filter(function (name) {
            return !Object.prototype.hasOwnProperty.call(metadata, name) || !isObject(metadata[name]);
        });
        return {
            inventoryDuplicateNames: inventoryDuplicateNames,
            orphanMetadata: orphanMetadata,
            inventoryWithoutMetadata: inventoryWithoutMetadata,
            emptyMetadata: emptyMetadata,
            annotatedNames: annotatedNames,
            annotatedCount: annotatedNames.length,
        };
    }

    function cloneValue(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function isReservedCategoryName(name) {
        return RESERVED_CATEGORY_NAMES.indexOf(String(name || '').trim()) !== -1;
    }

    function inspectCategories(categories) {
        var values = Array.isArray(categories) ? categories : [];
        return {
            reservedNames: values.filter(function (name) { return isReservedCategoryName(name); }),
        };
    }

    function renameCategory(data, oldName, newName) {
        if (!isObject(data) || !Array.isArray(data.categories)) return { ok: false, reason: 'invalid-state' };
        oldName = String(oldName || '');
        newName = String(newName || '').trim();
        if (!newName) return { ok: false, reason: 'empty' };
        if (newName === oldName) return { ok: false, reason: 'same' };
        if (isReservedCategoryName(newName)) return { ok: false, reason: 'reserved' };
        var sourceIndexes = [];
        data.categories.forEach(function (name, index) {
            if (name === oldName) sourceIndexes.push(index);
        });
        if (sourceIndexes.length !== 1) return { ok: false, reason: sourceIndexes.length ? 'ambiguous-source' : 'missing' };
        if (data.categories.some(function (name, index) { return index !== sourceIndexes[0] && name === newName; })) {
            return { ok: false, reason: 'collision' };
        }

        data.categories[sourceIndexes[0]] = newName;
        var changedReferences = 0;
        var themeMeta = isObject(data.themeMeta) ? data.themeMeta : {};
        Object.keys(themeMeta).forEach(function (themeName) {
            var meta = themeMeta[themeName];
            if (isObject(meta) && meta.category === oldName) {
                meta.category = newName;
                changedReferences += 1;
            }
        });
        var pairMap = isObject(data.dayNight) && isObject(data.dayNight.pairs) ? data.dayNight.pairs : {};
        Object.keys(pairMap).forEach(function (id) {
            var pair = pairMap[id];
            if (isObject(pair) && isObject(pair.meta) && pair.meta.category === oldName) {
                pair.meta.category = newName;
                changedReferences += 1;
            }
        });
        var seriesMap = isObject(data.series) && isObject(data.series.groups) ? data.series.groups : {};
        Object.keys(seriesMap).forEach(function (id) {
            var group = seriesMap[id];
            if (isObject(group) && group.category === oldName) {
                group.category = newName;
                changedReferences += 1;
            }
        });
        return { ok: true, oldName: oldName, newName: newName, changedReferences: changedReferences };
    }

    function targetReferencesTheme(target, themeName) {
        if (typeof target === 'string') return target === themeName;
        if (!isObject(target)) return false;
        if (target.kind === 'theme' && String(target.themeName || '').trim() === themeName) return true;
        if (typeof target.themeName === 'string' && target.themeName.trim() === themeName) return true;
        return isObject(target.target) && targetReferencesTheme(target.target, themeName);
    }

    function findThemeIdentityConflicts(data, themeName) {
        themeName = String(themeName || '').trim();
        if (!themeName || !isObject(data)) return [];
        var conflicts = [];
        if (isObject(data.themeMeta) && Object.prototype.hasOwnProperty.call(data.themeMeta, themeName)) {
            conflicts.push({ type: 'metadata', key: themeName });
        }
        var pairMap = isObject(data.dayNight) && isObject(data.dayNight.pairs) ? data.dayNight.pairs : {};
        Object.keys(pairMap).forEach(function (id) {
            var pair = pairMap[id];
            if (!isObject(pair)) return;
            if (String(pair.dayTheme || '').trim() === themeName || String(pair.nightTheme || '').trim() === themeName) {
                conflicts.push({ type: 'pair', key: id });
            }
        });
        var seriesMap = isObject(data.series) && isObject(data.series.groups) ? data.series.groups : {};
        Object.keys(seriesMap).forEach(function (id) {
            var group = seriesMap[id];
            if (!isObject(group) || !Array.isArray(group.members)) return;
            if (group.members.some(function (member) { return targetReferencesTheme(member, themeName); })) {
                conflicts.push({ type: 'series', key: id });
            }
        });
        var bindingState = isObject(data.bindings) ? data.bindings : {};
        if (targetReferencesTheme(bindingState.manualTarget, themeName) ||
            typeof bindingState.manualTheme === 'string' && bindingState.manualTheme.trim() === themeName) {
            conflicts.push({ type: 'binding', key: 'manual' });
        }
        ['characters', 'chats'].forEach(function (scope) {
            var map = isObject(bindingState[scope]) ? bindingState[scope] : {};
            Object.keys(map).forEach(function (key) {
                if (targetReferencesTheme(map[key], themeName)) conflicts.push({ type: 'binding', scope: scope, key: key });
            });
        });
        return conflicts;
    }

    function mergeImported(data, themeNames, metaByName, categories, options) {
        options = options || {};
        if (!isObject(data)) throw new TypeError('metadata data must be an object');
        if (!Array.isArray(data.categories)) data.categories = [];
        (categories || []).forEach(function (rawCategory) {
            var category = String(rawCategory || '');
            if (category && data.categories.indexOf(category) === -1) data.categories.push(category);
        });
        var merged = 0;
        (themeNames || []).forEach(function (rawName) {
            var name = String(rawName || '').trim();
            var incoming = isObject(metaByName) && Object.prototype.hasOwnProperty.call(metaByName, name) && isObject(metaByName[name]) ? metaByName[name] : null;
            if (!name || !incoming) return;
            var target = ensureMeta(data, name);
            if (options.forceCategory && Object.prototype.hasOwnProperty.call(incoming, 'category')) target.category = incoming.category || '';
            else if (!target.category && incoming.category) target.category = incoming.category;
            if (Array.isArray(incoming.tags)) incoming.tags.forEach(function (tag) {
                tag = String(tag || '').trim();
                if (tag && target.tags.indexOf(tag) === -1) target.tags.push(tag);
            });
            ['author', 'description', 'backgroundName'].forEach(function (key) {
                if (!target[key] && incoming[key]) target[key] = incoming[key];
            });
            if (typeof options.mergePreview === 'function') options.mergePreview(target, incoming);
            else ['imageData', 'thumbData', 'crop'].forEach(function (key) {
                if (!target[key] && incoming[key]) target[key] = cloneValue(incoming[key]);
            });
            merged += 1;
        });
        return { merged: merged, categories: data.categories.slice() };
    }

    ns.themeMetadata = {
        DEFAULT_META: DEFAULT_META,
        createMeta: createMeta,
        createDictionary: createDictionary,
        ensureThemeMetaDictionary: ensureThemeMetaDictionary,
        peekMeta: peekMeta,
        ensureMeta: ensureMeta,
        hasMeaningfulAnnotation: hasMeaningfulAnnotation,
        inspect: inspect,
        mergeImported: mergeImported,
        RESERVED_CATEGORY_NAMES: RESERVED_CATEGORY_NAMES.slice(),
        isReservedCategoryName: isReservedCategoryName,
        inspectCategories: inspectCategories,
        renameCategory: renameCategory,
        findThemeIdentityConflicts: findThemeIdentityConflicts,
    };
})(window);
