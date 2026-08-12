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

    function isObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
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
        var meta = themeMeta ? themeMeta[String(name || '')] : null;
        return isObject(meta) ? meta : DEFAULT_META;
    }

    function ensureMeta(data, name) {
        if (!isObject(data)) throw new TypeError('metadata data must be an object');
        name = String(name || '').trim();
        if (!name) throw new TypeError('metadata theme name is required');
        if (!isObject(data.themeMeta)) data.themeMeta = {};
        if (!isObject(data.themeMeta[name])) data.themeMeta[name] = createMeta();
        var meta = data.themeMeta[name];
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
        var counts = {};
        var order = [];
        inventoryNames.forEach(function (rawName) {
            var name = String(rawName || '').trim();
            if (!name) return;
            if (counts[name] === undefined) order.push(name);
            counts[name] = (counts[name] || 0) + 1;
        });
        var inventorySet = {};
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
            return !isObject(metadata[name]);
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
            var incoming = isObject(metaByName) && isObject(metaByName[name]) ? metaByName[name] : null;
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
        peekMeta: peekMeta,
        ensureMeta: ensureMeta,
        hasMeaningfulAnnotation: hasMeaningfulAnnotation,
        inspect: inspect,
        mergeImported: mergeImported,
    };
})(window);
