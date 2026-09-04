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

    function currentPage(pages, defaultPage) {
        var normalized = normalizePages(pages);
        var activeId = normalizePageId(defaultPage, normalized, DEFAULT_PAGE_ID);
        return normalized.find(function (page) { return page.id === activeId; }) || normalized[0] || {
            id: DEFAULT_PAGE_ID,
            label: DEFAULT_PAGE_ID,
            icon: '',
        };
    }

    function buildPageSwitcherHtml(options) {
        options = options || {};
        var page = currentPage(options.pages, options.defaultPage);
        return '<button type="button" class="tm-head-title tm-head-title-switcher" id="tm-page-switcher-button"' +
            ' data-tm-page-switcher' +
            ' aria-haspopup="menu" aria-expanded="false" aria-controls="tm-page-switcher-menu"' +
            ' aria-label="切换一级功能，当前：' + escapeHtml(page.label) + '">' +
            '<i class="fa-solid ' + escapeHtml(page.icon) + ' tm-page-switcher-icon" data-tm-current-page-icon aria-hidden="true"></i>' +
            '<span class="tm-head-name" data-tm-current-page-label>' + escapeHtml(page.label) + '</span>' +
            '<i class="fa-solid fa-chevron-down tm-page-switcher-chevron" aria-hidden="true"></i>' +
            '</button>';
    }

    function buildPageMenuHtml(options) {
        options = options || {};
        var pages = normalizePages(options.pages);
        var activeId = normalizePageId(options.defaultPage, pages, DEFAULT_PAGE_ID);
        var items = pages.map(function (page) {
            var active = page.id === activeId;
            return '<button type="button" class="tm-page-menu-item' + (active ? ' active' : '') + '"' +
                ' role="menuitem" data-tm-page-target="' + escapeHtml(page.id) + '"' +
                (active ? ' aria-current="page"' : '') + ' tabindex="-1">' +
                '<i class="fa-solid ' + escapeHtml(page.icon) + ' tm-page-menu-icon" aria-hidden="true"></i>' +
                '<span>' + escapeHtml(page.label) + '</span>' +
                '<i class="fa-solid fa-check tm-page-menu-check" aria-hidden="true"></i>' +
                '</button>';
        }).join('');
        return '<div class="tm-page-menu" id="tm-page-switcher-menu" role="menu"' +
            ' aria-labelledby="tm-page-switcher-button" hidden>' + items + '</div>';
    }

    function buildPagePanelsHtml(options) {
        options = options || {};
        var pages = normalizePages(options.pages);
        var activeId = normalizePageId(options.defaultPage, pages, DEFAULT_PAGE_ID);
        var panels = pages.map(function (page) {
            var active = page.id === activeId;
            return '<section class="tm-app-page tm-app-page-' + escapeHtml(page.id) + '"' +
                ' id="tm-page-' + escapeHtml(page.id) + '" data-tm-page="' + escapeHtml(page.id) + '"' +
                ' aria-label="' + escapeHtml(page.label) + '"' + (active ? '' : ' hidden') + '>' +
                page.html + '</section>';
        }).join('');
        return '<main class="tm-app-pages">' + panels + '</main>';
    }

    function buildShellHtml(options) {
        return buildPageSwitcherHtml(options) + buildPagePanelsHtml(options) + buildPageMenuHtml(options);
    }

    function createAppShell(options) {
        options = options || {};
        var root = options.root;
        if (!root || typeof root.querySelectorAll !== 'function') throw new Error('app shell root is required');
        var doc = options.document || global.document;
        var pages = normalizePages(options.pages);
        var pageById = Object.create(null);
        pages.forEach(function (page) { pageById[page.id] = page; });
        var activePage = normalizePageId(options.defaultPage, pages, DEFAULT_PAGE_ID);
        var switcher = root.querySelector('[data-tm-page-switcher]');
        var trigger = root.querySelector('#tm-page-switcher-button');
        var menu = root.querySelector('#tm-page-switcher-menu');
        var destroyed = false;
        var menuOpen = false;

        function menuItems() {
            return menu ? Array.prototype.slice.call(menu.querySelectorAll('[data-tm-page-target]')) : [];
        }

        function syncState() {
            var page = pageById[activePage];
            root.setAttribute('data-tm-active-page', activePage);
            if (trigger && page) {
                var label = trigger.querySelector('[data-tm-current-page-label]');
                var icon = trigger.querySelector('[data-tm-current-page-icon]');
                if (label) label.textContent = page.label;
                if (icon) icon.className = 'fa-solid ' + page.icon + ' tm-page-switcher-icon';
                trigger.setAttribute('aria-label', '切换一级功能，当前：' + page.label);
            }
            menuItems().forEach(function (button) {
                var active = button.getAttribute('data-tm-page-target') === activePage;
                button.classList.toggle('active', active);
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

        function positionMenu() {
            if (!menu || !trigger || typeof trigger.getBoundingClientRect !== 'function') return;
            var triggerRect = trigger.getBoundingClientRect();
            var rootRect = typeof root.getBoundingClientRect === 'function'
                ? root.getBoundingClientRect()
                : { left: 0, top: 0, width: root.clientWidth || 0 };
            var menuWidth = menu.offsetWidth || 160;
            var maxLeft = Math.max(8, (rootRect.width || root.clientWidth || 0) - menuWidth - 8);
            var left = Math.max(8, Math.min(triggerRect.left - rootRect.left, maxLeft));
            menu.style.left = left + 'px';
            menu.style.top = Math.max(8, triggerRect.bottom - rootRect.top + 5) + 'px';
        }

        function removeOpenListeners() {
            if (!doc || typeof doc.removeEventListener !== 'function') return;
            doc.removeEventListener('pointerdown', handleOutsidePointer, true);
            doc.removeEventListener('keydown', handleDocumentKeydown, true);
        }

        function closeMenu(options) {
            options = options || {};
            if (!menuOpen) return false;
            menuOpen = false;
            if (menu) {
                menu.hidden = true;
                menu.setAttribute('hidden', '');
            }
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
            if (switcher) switcher.classList.remove('open');
            removeOpenListeners();
            if (options.restoreFocus !== false && trigger && typeof trigger.focus === 'function') trigger.focus();
            return true;
        }

        function openMenu(options) {
            options = options || {};
            if (destroyed || menuOpen || !menu) return false;
            menuOpen = true;
            menu.hidden = false;
            menu.removeAttribute('hidden');
            if (trigger) trigger.setAttribute('aria-expanded', 'true');
            if (switcher) switcher.classList.add('open');
            positionMenu();
            if (doc && typeof doc.addEventListener === 'function') {
                doc.addEventListener('pointerdown', handleOutsidePointer, true);
                doc.addEventListener('keydown', handleDocumentKeydown, true);
            }
            if (options.focusMenu) {
                var active = menuItems().find(function (item) { return item.getAttribute('aria-current') === 'page'; });
                if (active && typeof active.focus === 'function') active.focus();
            }
            return true;
        }

        function toggleMenu(source) {
            return menuOpen ? closeMenu({ restoreFocus: source === 'keyboard' }) : openMenu({ focusMenu: source === 'keyboard' });
        }

        function handleTriggerClick() {
            toggleMenu('click');
        }

        function handleTriggerKeydown(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                if (event.preventDefault) event.preventDefault();
                toggleMenu('keyboard');
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (event.preventDefault) event.preventDefault();
                openMenu({ focusMenu: true });
            } else if (event.key === 'Escape') {
                closeMenu();
            }
        }

        function itemFromEvent(event) {
            if (!event || !event.target) return null;
            var item = typeof event.target.closest === 'function'
                ? event.target.closest('[data-tm-page-target]')
                : event.target;
            return item && (!menu || typeof menu.contains !== 'function' || menu.contains(item)) ? item : null;
        }

        function selectItem(item, source) {
            if (!item) return false;
            var changed = setActivePage(item.getAttribute('data-tm-page-target'), source);
            closeMenu({ restoreFocus: source === 'keyboard' });
            return changed;
        }

        function handleMenuClick(event) {
            selectItem(itemFromEvent(event), 'click');
        }

        function handleMenuKeydown(event) {
            var items = menuItems();
            var item = itemFromEvent(event);
            var index = items.indexOf(item);
            var nextIndex = index;
            if (event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
            else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = items.length - 1;
            else if (event.key === 'Enter' || event.key === ' ') {
                if (event.preventDefault) event.preventDefault();
                selectItem(item, 'keyboard');
                return;
            } else if (event.key === 'Escape') {
                if (event.preventDefault) event.preventDefault();
                closeMenu();
                return;
            } else return;
            if (event.preventDefault) event.preventDefault();
            if (items[nextIndex] && typeof items[nextIndex].focus === 'function') items[nextIndex].focus();
        }

        function handleOutsidePointer(event) {
            if (!menuOpen || !event || !event.target) return;
            if (menu && typeof menu.contains === 'function' && menu.contains(event.target)) return;
            if (trigger && typeof trigger.contains === 'function' && trigger.contains(event.target)) return;
            closeMenu({ restoreFocus: false });
        }

        function handleDocumentKeydown(event) {
            if (event && event.key === 'Escape') {
                if (event.preventDefault) event.preventDefault();
                closeMenu();
            }
        }

        if (trigger && typeof trigger.addEventListener === 'function') {
            trigger.addEventListener('click', handleTriggerClick);
            trigger.addEventListener('keydown', handleTriggerKeydown);
        }
        if (menu && typeof menu.addEventListener === 'function') {
            menu.addEventListener('click', handleMenuClick);
            menu.addEventListener('keydown', handleMenuKeydown);
        }
        syncState();

        return {
            getActivePage: function () { return activePage; },
            isMenuOpen: function () { return menuOpen; },
            setActivePage: setActivePage,
            openMenu: openMenu,
            closeMenu: closeMenu,
            destroy: function () {
                if (destroyed) return;
                closeMenu({ restoreFocus: false });
                destroyed = true;
                if (trigger && typeof trigger.removeEventListener === 'function') {
                    trigger.removeEventListener('click', handleTriggerClick);
                    trigger.removeEventListener('keydown', handleTriggerKeydown);
                }
                if (menu && typeof menu.removeEventListener === 'function') {
                    menu.removeEventListener('click', handleMenuClick);
                    menu.removeEventListener('keydown', handleMenuKeydown);
                }
            },
        };
    }

    ns.appShell = {
        DEFAULT_PAGE_ID: DEFAULT_PAGE_ID,
        normalizePages: normalizePages,
        normalizePageId: normalizePageId,
        buildPageSwitcherHtml: buildPageSwitcherHtml,
        buildPageMenuHtml: buildPageMenuHtml,
        buildPagePanelsHtml: buildPagePanelsHtml,
        buildShellHtml: buildShellHtml,
        createAppShell: createAppShell,
    };
})(window);
