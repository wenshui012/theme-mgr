(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    var DEFAULT_PAGE_ID = 'themes';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizePages(pages) {
        var seen = Object.create(null);
        return (Array.isArray(pages) ? pages : []).filter(function (page) {
            if (!page || !/^[a-z][a-z0-9-]*$/.test(page.id || '') || seen[page.id]) return false;
            seen[page.id] = true;
            return true;
        }).map(function (page) {
            return {
                id: page.id,
                label: String(page.label || page.id),
                icon: String(page.icon || ''),
                html: typeof page.html === 'string' ? page.html : '',
                mount: typeof page.mount === 'function' ? page.mount : null,
                unmount: typeof page.unmount === 'function' ? page.unmount : null,
            };
        });
    }

    function normalizePageId(pageId, pages, fallback) {
        var ids = normalizePages(pages).map(function (page) { return page.id; });
        if (ids.indexOf(pageId) !== -1) return pageId;
        if (ids.indexOf(fallback) !== -1) return fallback;
        return ids[0] || DEFAULT_PAGE_ID;
    }

    function buildShellHtml(options) {
        options = options || {};
        var pages = normalizePages(options.pages);
        var activePage = normalizePageId(options.defaultPage, pages, DEFAULT_PAGE_ID);
        var navigation = pages.map(function (page) {
            var active = page.id === activePage;
            return '<button type="button" class="tm-primary-tab' + (active ? ' active' : '') + '"' +
                ' id="tm-primary-tab-' + escapeHtml(page.id) + '"' +
                ' role="tab" data-tm-page-target="' + escapeHtml(page.id) + '"' +
                ' aria-controls="tm-page-' + escapeHtml(page.id) + '"' +
                ' aria-selected="' + (active ? 'true' : 'false') + '"' +
                (active ? ' aria-current="page" tabindex="0"' : ' tabindex="-1"') + '>' +
                (page.icon ? '<i class="fa-solid ' + escapeHtml(page.icon) + '" aria-hidden="true"></i>' : '') +
                '<span>' + escapeHtml(page.label) + '</span></button>';
        }).join('');
        var pagePanels = pages.map(function (page) {
            var active = page.id === activePage;
            return '<section class="tm-app-page tm-app-page-' + escapeHtml(page.id) + '"' +
                ' id="tm-page-' + escapeHtml(page.id) + '"' +
                ' role="tabpanel" data-tm-page="' + escapeHtml(page.id) + '"' +
                ' aria-labelledby="tm-primary-tab-' + escapeHtml(page.id) + '"' +
                (active ? '' : ' hidden') + '>' + page.html + '</section>';
        }).join('');
        return '<nav class="tm-primary-nav" data-tm-primary-nav role="tablist" aria-label="一级功能">' +
            navigation + '</nav><main class="tm-app-pages">' + pagePanels + '</main>';
    }

    function createAppShell(options) {
        options = options || {};
        var root = options.root;
        if (!root || typeof root.querySelectorAll !== 'function') throw new Error('app shell root is required');
        var pages = normalizePages(options.pages);
        var pageById = Object.create(null);
        pages.forEach(function (page) { pageById[page.id] = page; });
        var activePage = normalizePageId(options.defaultPage, pages, DEFAULT_PAGE_ID);
        var nav = root.querySelector('[data-tm-primary-nav]');
        var destroyed = false;

        function syncState() {
            root.setAttribute('data-tm-active-page', activePage);
            Array.prototype.forEach.call(root.querySelectorAll('[data-tm-page-target]'), function (button) {
                var active = button.getAttribute('data-tm-page-target') === activePage;
                button.classList.toggle('active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
                button.setAttribute('tabindex', active ? '0' : '-1');
                if (active) button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
            });
            Array.prototype.forEach.call(root.querySelectorAll('[data-tm-page]'), function (panel) {
                var active = panel.getAttribute('data-tm-page') === activePage;
                panel.hidden = !active;
                if (active) panel.removeAttribute('hidden');
                else panel.setAttribute('hidden', '');
            });
        }

        function setActivePage(nextPage, source) {
            if (destroyed || !pageById[nextPage] || nextPage === activePage) return false;
            var previousPage = activePage;
            if (typeof options.beforeChange === 'function' && options.beforeChange(previousPage, nextPage, source) === false) return false;
            if (pageById[previousPage] && pageById[previousPage].unmount) {
                pageById[previousPage].unmount(nextPage);
            }
            activePage = nextPage;
            syncState();
            if (pageById[activePage].mount) pageById[activePage].mount(previousPage);
            if (typeof options.onChange === 'function') options.onChange(activePage, previousPage, source);
            return true;
        }

        function pageButtonFromEvent(event) {
            if (!event || !event.target) return null;
            var button = typeof event.target.closest === 'function'
                ? event.target.closest('[data-tm-page-target]')
                : event.target;
            return button && (!nav || typeof nav.contains !== 'function' || nav.contains(button)) ? button : null;
        }

        function handleClick(event) {
            var button = pageButtonFromEvent(event);
            if (!button) return;
            setActivePage(button.getAttribute('data-tm-page-target'), 'click');
        }

        function handleKeydown(event) {
            var button = pageButtonFromEvent(event);
            if (!button) return;
            var currentIndex = pages.findIndex(function (page) {
                return page.id === button.getAttribute('data-tm-page-target');
            });
            var nextIndex = currentIndex;
            if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % pages.length;
            else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + pages.length) % pages.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = pages.length - 1;
            else if (event.key === 'Enter' || event.key === ' ') {
                setActivePage(button.getAttribute('data-tm-page-target'), 'keyboard');
                return;
            } else return;
            if (event.preventDefault) event.preventDefault();
            var nextPage = pages[nextIndex];
            if (!nextPage) return;
            setActivePage(nextPage.id, 'keyboard');
            var nextButton = root.querySelector('[data-tm-page-target="' + nextPage.id + '"]');
            if (nextButton && typeof nextButton.focus === 'function') nextButton.focus();
        }

        if (nav && typeof nav.addEventListener === 'function') {
            nav.addEventListener('click', handleClick);
            nav.addEventListener('keydown', handleKeydown);
        }
        syncState();

        return {
            getActivePage: function () { return activePage; },
            setActivePage: setActivePage,
            destroy: function () {
                if (destroyed) return;
                destroyed = true;
                if (nav && typeof nav.removeEventListener === 'function') {
                    nav.removeEventListener('click', handleClick);
                    nav.removeEventListener('keydown', handleKeydown);
                }
            },
        };
    }

    ns.appShell = {
        DEFAULT_PAGE_ID: DEFAULT_PAGE_ID,
        normalizePages: normalizePages,
        normalizePageId: normalizePageId,
        buildShellHtml: buildShellHtml,
        createAppShell: createAppShell,
    };
})(window);
