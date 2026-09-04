(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    var PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

    function asArray(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        if (typeof value.length === 'number' && !value.nodeType) return Array.from(value);
        return [value];
    }

    function defaultGetKey(image) {
        if (!image || !image.dataset) return '';
        return image.dataset.imageKey || image.dataset.themeKey || '';
    }

    function createImageLoader(options) {
        options = options || {};
        var root = options.root || null;
        var rootMargin = options.rootMargin || '600px 0px';
        var threshold = options.threshold === undefined ? 0 : options.threshold;
        var resolveSource = typeof options.resolveSource === 'function' ? options.resolveSource : function () { return ''; };
        var getKey = typeof options.getKey === 'function' ? options.getKey : defaultGetKey;
        var onLoad = typeof options.onLoad === 'function' ? options.onLoad : null;
        var onError = typeof options.onError === 'function' ? options.onError : null;
        var placeholder = typeof options.placeholder === 'string' ? options.placeholder : PLACEHOLDER_SRC;
        var Observer = Object.prototype.hasOwnProperty.call(options, 'IntersectionObserver')
            ? options.IntersectionObserver
            : global.IntersectionObserver;
        var generation = options.generation;
        var epoch = 0;
        var observer = null;
        var records = new Map();
        var loaded = new WeakSet();

        function setState(image, state) {
            if (image && image.dataset) image.dataset.imageState = state;
        }

        function isAttached(image) {
            if (!image || image.isConnected === false) return false;
            return !root || typeof root.contains !== 'function' || root.contains(image);
        }

        function isCurrent(image, record) {
            return records.get(image) === record &&
                record.epoch === epoch &&
                record.generation === generation &&
                isAttached(image);
        }

        function removeImageListeners(image, record) {
            if (!image || !record || typeof image.removeEventListener !== 'function') return;
            if (record.loadHandler) image.removeEventListener('load', record.loadHandler);
            if (record.errorHandler) image.removeEventListener('error', record.errorHandler);
            record.loadHandler = null;
            record.errorHandler = null;
        }

        function release(image, record) {
            if (observer && typeof observer.unobserve === 'function') observer.unobserve(image);
            removeImageListeners(image, record);
            if (records.get(image) === record) records.delete(image);
        }

        function keepCurrent(image, record) {
            if (isCurrent(image, record)) return true;
            if (records.get(image) === record) release(image, record);
            return false;
        }

        function fail(image, record, error) {
            if (!keepCurrent(image, record)) return;
            release(image, record);
            setState(image, 'error');
            if (image.classList) image.classList.add('tm-image-error');
            if (placeholder && image.src !== placeholder) image.src = placeholder;
            if (onError) onError(image, record.key, error || new Error('image load failed'));
        }

        function succeed(image, record) {
            if (!keepCurrent(image, record)) return;
            release(image, record);
            loaded.add(image);
            setState(image, 'loaded');
            if (image.classList) image.classList.add('tm-image-loaded');
            if (onLoad) onLoad(image, record.key, record.source);
        }

        function attachResolvedSource(image, record, resolved) {
            if (!keepCurrent(image, record)) return;
            var source = typeof resolved === 'string'
                ? resolved
                : (resolved && typeof resolved.src === 'string' ? resolved.src : '');
            if (!source) {
                fail(image, record, new Error('image source is unavailable'));
                return;
            }
            record.status = 'loading';
            record.source = source;
            setState(image, 'loading');
            record.loadHandler = function () { succeed(image, record); };
            record.errorHandler = function () { fail(image, record, new Error('image request failed')); };
            if (typeof image.addEventListener === 'function') {
                image.addEventListener('load', record.loadHandler);
                image.addEventListener('error', record.errorHandler);
            }
            image.src = source;

            Promise.resolve().then(function () {
                if (!isCurrent(image, record) || !image.complete) return;
                if (Number(image.naturalWidth) > 0) succeed(image, record);
                else fail(image, record, new Error('image decode failed'));
            });
        }

        function loadRecord(image, record) {
            if (!keepCurrent(image, record) || record.status !== 'observed') return;
            record.status = 'resolving';
            setState(image, 'resolving');
            Promise.resolve()
                .then(function () { return resolveSource(record.key, image, record.generation); })
                .then(function (resolved) { attachResolvedSource(image, record, resolved); })
                .catch(function (error) { fail(image, record, error); });
        }

        function handleIntersections(entries) {
            (entries || []).forEach(function (entry) {
                if (!entry || (!entry.isIntersecting && !(entry.intersectionRatio > 0))) return;
                var image = entry.target;
                var record = records.get(image);
                if (record) loadRecord(image, record);
            });
        }

        function ensureObserver() {
            if (observer || typeof Observer !== 'function') return observer;
            observer = new Observer(handleIntersections, {
                root: root,
                rootMargin: rootMargin,
                threshold: threshold,
            });
            return observer;
        }

        function register(image, requestedGeneration) {
            if (!image || loaded.has(image) || (image.dataset && (image.dataset.imageState === 'loaded' || image.dataset.imageState === 'error'))) return null;
            if (requestedGeneration !== undefined && requestedGeneration !== generation) return null;
            var existing = records.get(image);
            if (existing) return existing;
            var key = getKey(image);
            var record = {
                key: key,
                generation: generation,
                epoch: epoch,
                status: 'observed',
                source: '',
                loadHandler: null,
                errorHandler: null,
            };
            records.set(image, record);
            setState(image, 'observed');
            return record;
        }

        function observe(images, requestedGeneration) {
            asArray(images).forEach(function (image) {
                var record = register(image, requestedGeneration);
                if (!record) return;
                var activeObserver = ensureObserver();
                if (activeObserver) activeObserver.observe(image);
                else loadRecord(image, record);
            });
        }

        function loadNow(image, requestedGeneration) {
            var record = register(image, requestedGeneration) || records.get(image);
            if (record) loadRecord(image, record);
        }

        function unobserve(image) {
            var record = records.get(image);
            if (!record) {
                if (observer && image) observer.unobserve(image);
                return;
            }
            release(image, record);
        }

        function disconnect() {
            epoch += 1;
            if (observer && typeof observer.disconnect === 'function') observer.disconnect();
            observer = null;
            records.forEach(function (record, image) { removeImageListeners(image, record); });
            records.clear();
        }

        function reset(nextOptions) {
            disconnect();
            nextOptions = nextOptions || {};
            if (Object.prototype.hasOwnProperty.call(nextOptions, 'root')) root = nextOptions.root;
            if (typeof nextOptions.rootMargin === 'string') rootMargin = nextOptions.rootMargin;
            if (nextOptions.threshold !== undefined) threshold = nextOptions.threshold;
            if (Object.prototype.hasOwnProperty.call(nextOptions, 'generation')) generation = nextOptions.generation;
            if (typeof nextOptions.resolveSource === 'function') resolveSource = nextOptions.resolveSource;
            if (typeof nextOptions.getKey === 'function') getKey = nextOptions.getKey;
            if (typeof nextOptions.onLoad === 'function') onLoad = nextOptions.onLoad;
            if (typeof nextOptions.onError === 'function') onError = nextOptions.onError;
            if (Object.prototype.hasOwnProperty.call(nextOptions, 'IntersectionObserver')) Observer = nextOptions.IntersectionObserver;
            ensureObserver();
        }

        ensureObserver();

        return {
            observe: observe,
            loadNow: loadNow,
            unobserve: unobserve,
            disconnect: disconnect,
            reset: reset,
        };
    }

    ns.imageLoader = {
        PLACEHOLDER_SRC: PLACEHOLDER_SRC,
        createImageLoader: createImageLoader,
    };
})(window);
