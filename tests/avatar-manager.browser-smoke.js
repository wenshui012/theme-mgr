const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['image-tools.js', 'avatar-storage.js', 'avatar-image-tools.js', 'image-loader.js', 'avatar-runtime.js', 'avatar-page.js'];
const viewports = [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'mobile-360', width: 360, height: 720, isMobile: true, hasTouch: true },
    { label: 'mobile-390', width: 390, height: 760, isMobile: true, hasTouch: true },
    { label: 'mobile-430', width: 430, height: 800, isMobile: true, hasTouch: true },
];

function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>avatar smoke</title>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.THEME_MGR_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    });
    const reports = [];
    try {
        for (const viewport of viewports) {
            const context = await browser.newContext({
                viewport: { width: viewport.width, height: viewport.height },
                isMobile: Boolean(viewport.isMobile),
                hasTouch: Boolean(viewport.hasTouch),
            });
            const page = await context.newPage();
            await page.goto(origin);
            await page.setContent(`<!doctype html><html><head><style>
                html,body{margin:0;width:100%;height:100%;font-family:system-ui;overflow-x:hidden}
                #themes{position:fixed;left:-999px}.tm-app-page{width:100%;height:470px;box-sizing:border-box}
                #chat{padding:16px;display:grid;gap:12px}.mes{display:flex}.avatar{width:72px;height:72px;overflow:visible}.avatar img{width:100%;height:100%;object-fit:cover;object-position:35% 50%}
                .circle .avatar img{border-radius:50%}.clipped .avatar img{clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
                .masked .avatar img{-webkit-mask-image:radial-gradient(circle,#000 60%,transparent 61%);mask-image:radial-gradient(circle,#000 60%,transparent 61%)}
                .transformed .avatar img{transform:rotate(9deg) translateX(4px);translate:3px 2px;scale:1.08;rotate:4deg;transform-origin:30% 40%}
                .responsive .avatar{width:120px;height:96px;overflow:hidden}.responsive-small .avatar{width:60px;height:48px;overflow:hidden}
            </style><style id="custom-style">.sentinel{color:red}</style></head><body>
                <select id="themes"><option selected>A</option><option>B</option></select>
                <section class="tm-app-page tm-app-page-avatars" data-tm-page="avatars"></section>
                <div id="chat">
                    <div class="mes circle" is_user="false" is_system="false"><div class="avatar"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="opacity:.99"></div></div>
                    <div class="mes clipped" is_user="false" is_system="false"><div class="avatar"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div></div>
                    <div class="mes masked transformed" is_user="false" is_system="false"><div class="avatar"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div></div>
                    <div class="mes responsive" is_user="true" is_system="false"><div class="avatar"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div></div>
                    <div class="mes responsive-small" is_user="true" is_system="false"><div class="avatar"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div></div>
                </div>
            </body></html>`);
            for (const name of MODULES) await page.addScriptTag({ path: path.join(ROOT, 'src', name) });

            const report = await page.evaluate(async ({ label }) => {
                const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
                const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const dbName = `tm-avatar-smoke-${label}-${Date.now()}-${Math.random()}`;
                let backendCalls = 0;
                window.fetch = () => { backendCalls++; return Promise.reject(new Error('backend forbidden')); };
                window.__themeMeta = { keep: true };
                const customBefore = document.querySelector('#custom-style').textContent;
                const modules = window.ThemeMgrModules;
                const store = modules.createAvatarStore({ dbName });
                const processor = modules.createAvatarImageProcessor({});
                const context = { characters: [{ avatar: 'char.png', name: 'Character' }], characterId: 0, groupId: null, name1: 'User', eventSource: { on() {}, removeListener() {} }, eventTypes: {} };
                const runtime = modules.createAvatarRuntime({ store, getContext: () => context, getThemeName: () => document.querySelector('#themes').value });
                await runtime.start();
                let managerClosed = 0;
                let loaderDisconnects = 0;
                const loaderApi = Object.assign({}, modules.imageLoader, {
                    createImageLoader(options) {
                        const loader = modules.imageLoader.createImageLoader(options);
                        const original = loader.disconnect;
                        loader.disconnect = () => { loaderDisconnects++; original(); };
                        return loader;
                    },
                });
                const pageController = modules.createAvatarPage({
                    store, processor, runtime, imageLoader: loaderApi,
                    getRoot: () => document.querySelector('[data-tm-page="avatars"]'),
                    createSheet: (html) => {
                        const overlay = document.createElement('div');
                        overlay.className = 'tm-sheet-overlay';
                        overlay.innerHTML = '<div class="tm-sheet"><div class="tm-sheet-content">' + html + '</div></div>';
                        document.body.appendChild(overlay);
                        return overlay;
                    },
                    closeSheet: (sheet) => sheet.remove(),
                    closeManager: () => { managerClosed++; }, toast() {}, confirm: () => true,
                });
                document.querySelector('[data-tm-page="avatars"]').innerHTML = modules.avatarPage.buildPageHtml(modules.imageLoader.PLACEHOLDER_SRC);
                await pageController.mount();
                const empty = pageController.getState().count === 0 && Boolean(document.querySelector('.tm-avatar-page-empty'));
                const emptyLayout = !document.querySelector('.tm-avatar-page h2') &&
                    !document.querySelector('[data-avatar-action="pick"]') && !document.querySelector('[data-avatar-actions]');

                const source = document.createElement('canvas'); source.width = 2600; source.height = 1300;
                const ctx = source.getContext('2d'); ctx.clearRect(0, 0, source.width, source.height); ctx.fillStyle = 'rgba(120,60,220,.72)'; ctx.fillRect(40, 40, 2400, 1100);
                const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png'));
                const file = new File([blob], 'smoke-alpha.png', { type: 'image/png' });
                const imported = await pageController.importFiles([file]);
                await frame();
                const avatarId = imported[0].asset.id;
                const persisted = await store.getAsset(avatarId);
                const reloadedStore = modules.createAvatarStore({ dbName });
                await reloadedStore.ready;
                const reloadCount = (await reloadedStore.listAssets()).length;
                const gridImage = document.querySelector('.tm-avatar-page-thumb');
                await delay(30);
                const gridUsesThumb = gridImage && gridImage.src === persisted.thumbData && gridImage.src !== persisted.imageData;
                const imageOnlyCard = Boolean(document.querySelector('.tm-avatar-page-card .tm-avatar-page-thumb')) &&
                    !document.querySelector('.tm-avatar-page-name') && Boolean(document.querySelector('[data-avatar-action="menu"]'));

                document.querySelector('[data-avatar-action="menu"]').click();
                let userMenuAction = null;
                for (let attempt = 0; attempt < 20 && !userMenuAction; attempt++) {
                    await delay(10);
                    userMenuAction = document.querySelector('[data-avatar-menu-action="apply-user"]');
                }
                const menuOpened = Boolean(userMenuAction);
                if (!userMenuAction) throw new Error('avatar three-dot menu did not finish opening');
                userMenuAction.click();
                let toolbarHost = null;
                for (let attempt = 0; attempt < 50 && runtime.getState().state !== 'editing'; attempt++) await delay(10);
                await frame();
                const directUser = runtime.getState().state === 'editing' && managerClosed === 1;
                toolbarHost = document.querySelector('#tm-avatar-editor-toolbar');
                const toolbarRect = toolbarHost && toolbarHost.getBoundingClientRect();
                const toolbarVisible = Boolean(toolbarRect && toolbarRect.width > 0 && toolbarRect.height > 0 && toolbarRect.top >= 0 && toolbarRect.bottom <= innerHeight);
                const toolbarIsolated = Boolean(toolbarHost && toolbarHost.shadowRoot && toolbarHost.shadowRoot.querySelector('[data-action="save"]'));
                const userImages = [...document.querySelectorAll('.mes[is_user="true"] .avatar img')];
                const highQualityApplied = userImages.every((image) => image.src === persisted.imageData);
                const representative = document.querySelector('.tm-avatar-editor-target');
                if (!representative) throw new Error('avatar editor did not expose a draggable target');
                const repAvatar = representative.parentElement;
                const repRect = repAvatar.getBoundingClientRect();
                representative.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true,cancelable:true,pointerId:7,pointerType:label.includes('mobile')?'touch':'mouse',button:0,clientX:10,clientY:10 }));
                document.dispatchEvent(new PointerEvent('pointermove', { bubbles:true,cancelable:true,pointerId:7,pointerType:label.includes('mobile')?'touch':'mouse',clientX:10+repRect.width*.25,clientY:10+repRect.height*.125 }));
                document.dispatchEvent(new PointerEvent('pointerup', { bubbles:true,cancelable:true,pointerId:7,pointerType:label.includes('mobile')?'touch':'mouse' }));
                runtime.scaleUp();
                const dragged = runtime.getState();
                runtime.reset();
                const reset = runtime.getState().view;
                await runtime.cancelEdit();
                const cancelledToRaw = userImages.every((image) => image.src.includes('R0lGOD'));

                await runtime.beginEdit({ kind:'character', avatarId });
                const characterImages = [...document.querySelectorAll('.mes[is_user="false"] .avatar img')];
                const beforeVisuals = characterImages.map((image) => ({
                    radius:getComputedStyle(image).borderRadius, clip:getComputedStyle(image).clipPath,
                    mask:getComputedStyle(image).webkitMaskImage || getComputedStyle(image).maskImage,
                    inline:image.getAttribute('style'), translate:getComputedStyle(image).translate,
                    scale:getComputedStyle(image).scale, rotate:getComputedStyle(image).rotate,
                    composite:image.getAnimations().at(-1).effect.getKeyframes()[0].composite,
                }));
                runtime.setScale(1.2);
                const saveResult = await runtime.saveEdit();
                const persistedBindingAfterSave = await reloadedStore.getBinding('theme-name:A','character:char.png');
                const afterVisuals = characterImages.map((image) => ({
                    radius:getComputedStyle(image).borderRadius, clip:getComputedStyle(image).clipPath,
                    mask:getComputedStyle(image).webkitMaskImage || getComputedStyle(image).maskImage,
                    inline:image.getAttribute('style'), translate:getComputedStyle(image).translate,
                    scale:getComputedStyle(image).scale, rotate:getComputedStyle(image).rotate,
                    composite:image.getAnimations().at(-1).effect.getKeyframes()[0].composite,
                }));
                const visualsPreserved = JSON.stringify(beforeVisuals) === JSON.stringify(afterVisuals);

                const rerender = document.createElement('div'); rerender.className='mes transformed'; rerender.setAttribute('is_user','false'); rerender.setAttribute('is_system','false'); rerender.innerHTML='<div class="avatar"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div>'; document.querySelector('#chat').appendChild(rerender);
                await runtime.reconcile();
                const rerenderApplied = rerender.querySelector('img').src === persisted.imageData;

                await store.putBinding({ themeKey:'theme-name:B', targetKey:'character:char.png', avatarId, view:{x:.4,y:.2,scale:1.4} });
                const transformA = characterImages[0].getAnimations().at(-1).effect.getKeyframes()[0].transform;
                document.querySelector('#themes').value='B'; document.querySelector('#themes').dispatchEvent(new Event('change',{bubbles:true}));
                await delay(150);
                const transformB = characterImages[0].getAnimations().at(-1).effect.getKeyframes()[0].transform;
                const themesIsolated = transformA !== transformB;

                await store.putBinding({ themeKey:'theme-name:B', targetKey:'user:global', avatarId, view:{x:.25,y:.125,scale:1} });
                await runtime.reconcile();
                const responsiveTransforms = userImages.map((image) => image.getAnimations().at(-1).effect.getKeyframes()[0].transform);
                const responsive = responsiveTransforms[0] !== responsiveTransforms[1];
                await runtime.clearBinding('user');
                const restoredUser = userImages.every((image) => image.src.includes('R0lGOD'));
                document.querySelector('[data-avatar-action="menu"]').click();
                let deleteMenuAction = null;
                for (let attempt = 0; attempt < 20 && !deleteMenuAction; attempt++) {
                    await delay(10);
                    deleteMenuAction = document.querySelector('[data-avatar-menu-action="delete"]');
                }
                if (!deleteMenuAction) throw new Error('avatar delete action was not moved into the three-dot menu');
                deleteMenuAction.click();
                for (let attempt = 0; attempt < 50; attempt++) {
                    if (!(await store.getAsset(avatarId)) && pageController.getState().count === 0) break;
                    await delay(10);
                }
                const menuDelete = !(await store.getAsset(avatarId)) && pageController.getState().count === 0;
                const noOverflow = document.documentElement.scrollWidth <= window.innerWidth;
                const cleanup = !document.querySelector('#tm-avatar-editor-toolbar') && !document.querySelector('#tm-avatar-editor-style');
                pageController.unmount();

                return {
                    label, A_empty:empty, B_added:imported[0].ok, C_reload:reloadCount===1, D_menu:menuOpened&&imageOnlyCard,
                    E_userApply:directUser&&highQualityApplied, F_characterApply:saveResult.saved,
                    G_managerClose:managerClosed===1, H_drag:Math.abs(dragged.view.x-.25)<.001&&Math.abs(dragged.view.y-.125)<.001,
                    I_scale:dragged.view.scale===1.05, J_cancel:cancelledToRaw, K_save:Boolean(persistedBindingAfterSave&&persistedBindingAfterSave.avatarId===avatarId),
                    L_rerender:rerenderApplied, M_themeSwitch:themesIsolated, N_circle:visualsPreserved,
                    O_clip:visualsPreserved, P_mask:visualsPreserved, Q_transform:visualsPreserved,
                    R_responsive:responsive, reset:reset.x===0&&reset.y===0&&reset.scale===1,
                    gridUsesThumb, mainSize:[persisted.width,persisted.height], alpha:persisted.mimeType==='image/png',
                    restoredUser, cleanup, loaderDisconnects, noOverflow, backendCalls,
                    emptyLayout, toolbarVisible, toolbarIsolated, menuDelete, hostUntouched:window.__themeMeta.keep&&document.querySelector('#custom-style').textContent===customBefore,
                };
            }, { label: viewport.label });

            for (const [key, value] of Object.entries(report)) {
                if (/^[A-R]_/.test(key) || ['reset','gridUsesThumb','alpha','restoredUser','cleanup','noOverflow','emptyLayout','toolbarVisible','toolbarIsolated','menuDelete','hostUntouched'].includes(key)) assert(value === true, `${viewport.label}: ${key} failed`);
            }
            assert(report.mainSize[0] === 2048 && report.mainSize[1] === 1024, `${viewport.label}: high resolution resize failed`);
            assert(report.backendCalls === 0, `${viewport.label}: backend was called`);
            assert(report.loaderDisconnects >= 1, `${viewport.label}: page loader was not disconnected`);
            reports.push(report);
            await context.close();
        }
        console.log(JSON.stringify({ ok:true, reports }, null, 2));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
