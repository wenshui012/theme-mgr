(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createUiSheets = function (opts) {
        opts = opts || {};
        var getPopupLayer = opts.getPopupLayer;
        var load = opts.load;
        var esc = opts.esc;

        function createSheet(contentHtml) {
            var overlay = global.document.createElement('div');
            overlay.className = 'tm-sheet-overlay';
            overlay.innerHTML = '<div class="tm-sheet"><div class="tm-sheet-handle"></div><div class="tm-sheet-content">' + contentHtml + '</div></div>';
            getPopupLayer().appendChild(overlay);
            overlay.addEventListener('click', function (event) {
                if (event.target === overlay) closeSheet(overlay);
            });
            return overlay;
        }

        function closeSheet(overlay) {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }

        function openLightbox(themeNames, startName) {
            var themes = themeNames.filter(function (name) {
                var meta = load().themeMeta[name];
                return meta && (meta.imageData || meta.thumbData);
            });
            if (themes.length === 0) return;
            var index = themes.indexOf(startName);
            if (index === -1) index = 0;

            var lightbox = global.document.createElement('div');
            lightbox.className = 'tm-lightbox';
            lightbox.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2 !important;pointer-events:auto !important;';

            function render() {
                var data = load();
                var name = themes[index];
                var meta = data.themeMeta[name] || {};
                var image = meta.imageData || meta.thumbData || '';
                lightbox.innerHTML =
                    '<button class="tm-lb-close"><i class="fa-solid fa-xmark"></i></button>' +
                    '<div class="tm-lb-name">' + esc(name) + '</div>' +
                    (themes.length > 1 ? '<button class="tm-lb-nav tm-lb-prev"><i class="fa-solid fa-chevron-left"></i></button>' : '') +
                    '<img class="tm-lb-img" src="' + image + '" draggable="false" />' +
                    (themes.length > 1 ? '<button class="tm-lb-nav tm-lb-next"><i class="fa-solid fa-chevron-right"></i></button>' : '') +
                    (themes.length > 1 ? '<div class="tm-lb-counter">' + (index + 1) + ' / ' + themes.length + '</div>' : '');
                lightbox.querySelector('.tm-lb-close').addEventListener('click', closeLightbox);
                var previous = lightbox.querySelector('.tm-lb-prev');
                var next = lightbox.querySelector('.tm-lb-next');
                if (previous) previous.addEventListener('click', function (event) {
                    event.stopPropagation();
                    index = (index - 1 + themes.length) % themes.length;
                    render();
                });
                if (next) next.addEventListener('click', function (event) {
                    event.stopPropagation();
                    index = (index + 1) % themes.length;
                    render();
                });
            }

            function closeLightbox() {
                if (lightbox.parentNode) lightbox.parentNode.removeChild(lightbox);
                global.document.removeEventListener('keydown', handleKey);
            }

            function handleKey(event) {
                if (event.key === 'Escape') closeLightbox();
                else if (event.key === 'ArrowLeft' && themes.length > 1) {
                    index = (index - 1 + themes.length) % themes.length;
                    render();
                } else if (event.key === 'ArrowRight' && themes.length > 1) {
                    index = (index + 1) % themes.length;
                    render();
                }
            }

            lightbox.addEventListener('click', function (event) {
                if (event.target === lightbox) closeLightbox();
            });
            global.document.addEventListener('keydown', handleKey);
            render();
            getPopupLayer().appendChild(lightbox);
        }

        return {
            createSheet: createSheet,
            closeSheet: closeSheet,
            openLightbox: openLightbox,
        };
    };
})(window);
