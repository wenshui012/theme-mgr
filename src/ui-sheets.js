(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createUiSheets = function (opts) {
        opts = opts || {};
        var getPopupLayer = opts.getPopupLayer;
        var load = opts.load;
        var esc = opts.esc;
        var beforeCloseHandlers = new WeakMap();
        var openLightboxes = new Set();

        function createSheet(contentHtml) {
            var overlay = global.document.createElement('div');
            overlay.className = 'tm-sheet-overlay';
            overlay.innerHTML = '<div class="tm-sheet"><div class="tm-sheet-handle"></div><div class="tm-sheet-content">' + contentHtml + '</div></div>';
            getPopupLayer().appendChild(overlay);
            overlay.addEventListener('click', function (event) {
                if (event.target === overlay) requestClose(overlay, 'backdrop');
            });
            return overlay;
        }

        function setBeforeClose(overlay, handler) {
            if (!overlay) return;
            if (typeof handler === 'function') beforeCloseHandlers.set(overlay, handler);
            else beforeCloseHandlers.delete(overlay);
        }

        function removeSheet(overlay) {
            beforeCloseHandlers.delete(overlay);
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            return true;
        }

        function requestClose(overlay, reason, options) {
            options = options || {};
            if (!overlay || !overlay.parentNode) return true;
            var guard = beforeCloseHandlers.get(overlay);
            if (!options.force && guard && guard(reason || 'close') === false) return false;
            return removeSheet(overlay);
        }

        function closeSheet(overlay, options) {
            return requestClose(overlay, 'programmatic', options);
        }

        function requestCloseAll(root, reason) {
            var sheets = root && root.querySelectorAll
                ? Array.prototype.slice.call(root.querySelectorAll('.tm-sheet-overlay'))
                : [];
            for (var i = sheets.length - 1; i >= 0; i--) {
                var guard = beforeCloseHandlers.get(sheets[i]);
                if (guard && guard(reason || 'manager-close') === false) return false;
            }
            openLightboxes.forEach(function (record) {
                if (!root || !root.contains || root.contains(record.element)) record.close();
            });
            sheets.forEach(removeSheet);
            return true;
        }

        function openImageLightbox(items, startKey) {
            var images = (items || []).filter(function (item) {
                return item && item.key != null && (item.source || typeof item.getSource === 'function');
            });
            if (images.length === 0) return;
            var index = images.findIndex(function (item) { return String(item.key) === String(startKey); });
            if (index === -1) index = 0;

            var lightbox = global.document.createElement('div');
            lightbox.className = 'tm-lightbox';
            lightbox.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2 !important;pointer-events:auto !important;';
            var lightboxRecord = { element: lightbox, close: closeLightbox };

            function render() {
                var item = images[index];
                var image = typeof item.getSource === 'function' ? item.getSource() : item.source;
                lightbox.innerHTML =
                    '<button class="tm-lb-close"><i class="fa-solid fa-xmark"></i></button>' +
                    '<div class="tm-lb-name">' + esc(item.label || item.key) + '</div>' +
                    (images.length > 1 ? '<button class="tm-lb-nav tm-lb-prev"><i class="fa-solid fa-chevron-left"></i></button>' : '') +
                    '<img class="tm-lb-img" src="' + esc(image || '') + '" draggable="false" />' +
                    (images.length > 1 ? '<button class="tm-lb-nav tm-lb-next"><i class="fa-solid fa-chevron-right"></i></button>' : '') +
                    (images.length > 1 ? '<div class="tm-lb-counter">' + (index + 1) + ' / ' + images.length + '</div>' : '');
                lightbox.querySelector('.tm-lb-close').addEventListener('click', closeLightbox);
                var previous = lightbox.querySelector('.tm-lb-prev');
                var next = lightbox.querySelector('.tm-lb-next');
                if (previous) previous.addEventListener('click', function (event) {
                    event.stopPropagation();
                    index = (index - 1 + images.length) % images.length;
                    render();
                });
                if (next) next.addEventListener('click', function (event) {
                    event.stopPropagation();
                    index = (index + 1) % images.length;
                    render();
                });
            }

            function closeLightbox() {
                openLightboxes.delete(lightboxRecord);
                if (lightbox.parentNode) lightbox.parentNode.removeChild(lightbox);
                global.document.removeEventListener('keydown', handleKey);
            }

            function handleKey(event) {
                if (event.key === 'Escape') closeLightbox();
                else if (event.key === 'ArrowLeft' && images.length > 1) {
                    index = (index - 1 + images.length) % images.length;
                    render();
                } else if (event.key === 'ArrowRight' && images.length > 1) {
                    index = (index + 1) % images.length;
                    render();
                }
            }

            lightbox.addEventListener('click', function (event) {
                if (event.target === lightbox) closeLightbox();
            });
            global.document.addEventListener('keydown', handleKey);
            openLightboxes.add(lightboxRecord);
            render();
            getPopupLayer().appendChild(lightbox);
            return lightbox;
        }

        function openLightbox(themeNames, startName) {
            var themes = themeNames.filter(function (name) {
                var meta = load().themeMeta[name];
                return meta && (meta.imageData || meta.thumbData || meta.previewData);
            });
            return openImageLightbox(themes.map(function (name) {
                return {
                    key: name,
                    label: name,
                    getSource: function () {
                        var meta = load().themeMeta[name] || {};
                        return meta.imageData || meta.thumbData || meta.previewData || '';
                    },
                };
            }), startName);
        }

        return {
            createSheet: createSheet,
            closeSheet: closeSheet,
            requestClose: requestClose,
            requestCloseAll: requestCloseAll,
            setBeforeClose: setBeforeClose,
            openImageLightbox: openImageLightbox,
            openLightbox: openLightbox,
        };
    };
})(window);
