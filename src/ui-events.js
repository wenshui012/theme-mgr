(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.createUiEvents = function (opts) {
        opts = opts || {};
        var FAB_ID = opts.fabId;
        var BTN_ID = opts.buttonId;
        var LAUNCHER_NAME = opts.launcherName;
        var TM_VERSION = opts.version;
        var load = opts.load;
        var save = opts.save;
        var esc = opts.esc;
        var getCurrentThemeName = opts.getCurrentThemeName;
        var openPopup = opts.openPopup;
        var toast = opts.toast;
        var getSupportState = opts.getSupportState;
        var requestOpenAfterReady = opts.requestOpenAfterReady;

        var fabResizeHandler = null;
        var fabOpen = false;
        var launcherInjectStarted = false;
        var fabInjectStarted = false;

        function removeFab() {
            var fab = document.getElementById(FAB_ID);
            if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
            if (fabResizeHandler) {
                window.removeEventListener('resize', fabResizeHandler);
                fabResizeHandler = null;
            }
        }

        function injectFab() {
            if (document.getElementById(FAB_ID)) return;
            var d = load(); if (d.showBall === false) return;
            var container = document.createElement('div'); container.id = FAB_ID;
            var MAIN_SIZE = d.fabSize || 38;
            var accent = 'var(--SmartThemeQuoteColor,#7c6daf)';

            function posFab() {
                var vh = window.innerHeight || document.documentElement.clientHeight;
                var vw = window.innerWidth || document.documentElement.clientWidth;
                var dd = load();
                var mainTop, mainLeft;
                if (dd.fabPos && typeof dd.fabPos.top === 'number' && typeof dd.fabPos.left === 'number') {
                    mainTop = Math.max(0, Math.min(dd.fabPos.top, vh - MAIN_SIZE));
                    mainLeft = Math.max(0, Math.min(dd.fabPos.left, vw - MAIN_SIZE));
                } else {
                    mainTop = vh - 80 - MAIN_SIZE;
                    mainLeft = vw - 16 - MAIN_SIZE;
                    if (mainTop < 10) mainTop = 10;
                    if (mainLeft < 10) mainLeft = 10;
                }
                container.setAttribute('style',
                    'position:fixed !important;top:' + mainTop + 'px !important;left:' + mainLeft + 'px !important;' +
                    'z-index:2147483647 !important;display:flex !important;align-items:center !important;' +
                    'pointer-events:none !important;margin:0 !important;padding:0 !important;');
            }

            var mainBtn;
            if (d.fabImage) {
                mainBtn = document.createElement('img');
                mainBtn.src = d.fabImage;
                mainBtn.setAttribute('style',
                    'width:' + MAIN_SIZE + 'px !important;height:' + MAIN_SIZE + 'px !important;' +
                    'cursor:pointer !important;display:block !important;pointer-events:auto !important;' +
                    'object-fit:contain !important;touch-action:none !important;' +
                    'filter:drop-shadow(0 2px 6px rgba(0,0,0,.25)) !important;');
            } else {
                mainBtn = document.createElement('div');
                mainBtn.innerHTML = '<i class="fa-solid fa-palette" style="pointer-events:none;font-size:' + Math.max(0.7, MAIN_SIZE / 35) + 'em;"></i>';
                mainBtn.setAttribute('style',
                    'width:' + MAIN_SIZE + 'px !important;height:' + MAIN_SIZE + 'px !important;border-radius:50% !important;' +
                    'background:' + accent + ' !important;color:#fff !important;border:none !important;cursor:pointer !important;' +
                    'display:flex !important;align-items:center !important;justify-content:center !important;' +
                    'box-shadow:0 4px 16px rgba(0,0,0,.35) !important;opacity:.9 !important;pointer-events:auto !important;' +
                    'touch-action:none !important;');
            }
            mainBtn.id = 'tm-fab-main-btn';
            container.appendChild(mainBtn);

            var _ds = { sx: 0, sy: 0, ox: 0, oy: 0, moved: false, handled: false };
            function startDrag(x, y) {
                var rect = container.getBoundingClientRect();
                _ds.sx = x; _ds.sy = y; _ds.ox = rect.left; _ds.oy = rect.top; _ds.moved = false;
            }
            function moveDrag(x, y) {
                var dx = x - _ds.sx, dy = y - _ds.sy;
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) _ds.moved = true;
                if (_ds.moved) {
                    var nx = Math.max(0, Math.min(_ds.ox + dx, window.innerWidth - MAIN_SIZE));
                    var ny = Math.max(0, Math.min(_ds.oy + dy, window.innerHeight - MAIN_SIZE));
                    container.style.setProperty('left', nx + 'px', 'important');
                    container.style.setProperty('top', ny + 'px', 'important');
                }
            }
            function saveFabPos() {
                var rect = container.getBoundingClientRect();
                var dd = load();
                dd.fabPos = { top: Math.round(rect.top), left: Math.round(rect.left) };
                save(dd);
            }

            mainBtn.addEventListener('touchstart', function (e) {
                var t = e.touches[0];
                startDrag(t.clientX, t.clientY);
            }, { passive: true });
            mainBtn.addEventListener('touchmove', function (e) {
                var t = e.touches[0];
                moveDrag(t.clientX, t.clientY);
            }, { passive: true });
            mainBtn.addEventListener('touchend', function (e) {
                if (!_ds.moved) {
                    _ds.handled = true;
                    e.preventDefault();
                    setTimeout(function () { openPopup(); }, 50);
                } else {
                    saveFabPos();
                }
            });

            mainBtn.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                e.preventDefault();
                startDrag(e.clientX, e.clientY);
                document.addEventListener('mousemove', mouseMove);
                document.addEventListener('mouseup', mouseUp);
            });
            function mouseMove(e) {
                moveDrag(e.clientX, e.clientY);
            }
            function mouseUp() {
                document.removeEventListener('mousemove', mouseMove);
                document.removeEventListener('mouseup', mouseUp);
                if (_ds.moved) saveFabPos();
            }
            mainBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (_ds.handled) { _ds.handled = false; return; }
                if (_ds.moved) { _ds.moved = false; return; }
                openPopup();
            });

            posFab();
            if (fabResizeHandler) window.removeEventListener('resize', fabResizeHandler);
            fabResizeHandler = posFab; window.addEventListener('resize', fabResizeHandler);
            document.body.appendChild(container);
        }

        function startFabInjection() {
            if (fabInjectStarted) return;
            fabInjectStarted = true;
            setTimeout(injectFab, 1500);
            setInterval(function () { if (!document.getElementById(FAB_ID)) injectFab(); }, 3000);
        }

        function closeFab() { fabOpen = false; }

        function updateBtn() {
            var btn = document.getElementById(BTN_ID); if (!btn) return;
            var curTheme = getCurrentThemeName();
            var span = btn.querySelector('span');
            var support = getSupportState();
            var status = support.failed ? '（模块加载失败）' : (!support.ready ? '（加载中）' : '');
            var title = curTheme ? (LAUNCHER_NAME + status + '：' + curTheme) : (LAUNCHER_NAME + status);
            var inner = btn.querySelector('.list-group-item');
            if (span) span.textContent = LAUNCHER_NAME;
            btn.title = title;
            if (inner) inner.title = title;
            btn.style.color = curTheme ? 'var(--SmartThemeQuoteColor)' : '';
            if (inner) inner.style.color = curTheme ? 'var(--SmartThemeQuoteColor)' : '';
        }

        function openLauncher() {
            var support = getSupportState();
            if (support.ready) {
                openPopup();
                return;
            }
            if (support.failed) {
                var failedMsg = '美化管理器模块加载失败：' + (support.errorText || '未知原因') + '\n\n请更新到 v' + TM_VERSION + ' 后刷新/重启酒馆。';
                try { alert(failedMsg); } catch (e) {}
                return;
            }
            requestOpenAfterReady();
            try {
                toast('美化管理器正在加载，请稍等一下…');
            } catch (e2) {}
        }

        function findMenu() {
            var m = document.getElementById('extensionsMenu'); if (m) return m;
            m = document.getElementById('extensions_menu'); if (m) return m;
            var items = document.querySelectorAll('.list-group-item.interactable');
            for (var i = 0; i < items.length; i++) { var t = items[i].textContent || ''; if (t.indexOf('CSS') !== -1 || t.indexOf('穿搭') !== -1 || t.indexOf('变量管理') !== -1) return items[i].parentElement; }
            return null;
        }

        function injectBtn() {
            if (document.getElementById(BTN_ID)) { updateBtn(); return; }
            var menu = findMenu(); if (!menu) return;
            var curTheme = getCurrentThemeName();
            var btn = document.createElement('div');
            btn.id = BTN_ID;
            btn.title = curTheme ? (LAUNCHER_NAME + '：' + curTheme) : LAUNCHER_NAME;
            if (curTheme) btn.style.color = 'var(--SmartThemeQuoteColor)';
            if (menu.id === 'extensionsMenu') {
                btn.className = 'extension_container interactable';
                btn.tabIndex = 0;
                btn.innerHTML =
                    '<div class="list-group-item flex-container flexGap5 interactable" role="listitem" tabindex="0" title="' + esc(btn.title) + '">' +
                    '<div class="fa-fw fa-solid fa-palette extensionsMenuExtensionButton"></div>' +
                    '<span>' + esc(LAUNCHER_NAME) + '</span>' +
                    '</div>';
            } else {
                btn.className = 'list-group-item flex-container flexGap5 interactable';
                btn.innerHTML = '<i class="fa-solid fa-palette"></i><span>' + esc(LAUNCHER_NAME) + '</span>';
            }
            btn.addEventListener('click', openLauncher);
            menu.appendChild(btn);
        }

        function startLauncherInjection() {
            if (launcherInjectStarted) return;
            launcherInjectStarted = true;
            setTimeout(injectBtn, 0);
            setTimeout(injectBtn, 250);
            setTimeout(injectBtn, 750);
            setInterval(injectBtn, 2000);
        }

        return {
            removeFab: removeFab,
            injectFab: injectFab,
            startFabInjection: startFabInjection,
            closeFab: closeFab,
            updateBtn: updateBtn,
            startLauncherInjection: startLauncherInjection,
        };
    };
})(window);
