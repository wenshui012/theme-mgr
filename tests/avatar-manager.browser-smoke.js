const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['image-tools.js', 'avatar-storage.js', 'avatar-image-tools.js', 'image-loader.js', 'ui-sheets.js', 'avatar-runtime.js', 'avatar-page.js'];
const viewports = [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'mobile-360', width: 360, height: 720, isMobile: true, hasTouch: true },
    { label: 'mobile-390', width: 390, height: 760, isMobile: true, hasTouch: true },
    { label: 'mobile-430', width: 430, height: 800, isMobile: true, hasTouch: true },
];

function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
    const server = http.createServer((request, response) => {
        if (request.url === '/avatar.gif') {
            response.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'public,max-age=3600' });
            response.end(gif);
            return;
        }
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
                :root{--SmartThemeQuoteColor:rgb(12,34,56);--SmartThemeBodyColor:rgb(210,220,230);--SmartThemeBackgroundColor:rgb(40,42,48);--SmartThemeBlurTintColor:rgba(40,42,48,.95)}
                html,body{margin:0;width:100%;height:100%;font-family:system-ui;overflow-x:hidden}
                #themes{position:fixed;left:-999px}.tm-app-page{width:100%;height:470px;box-sizing:border-box}
                #chat{padding:16px;display:grid;gap:12px}.mes{display:flex}.avatar{width:72px;height:72px;overflow:visible}.avatar img{width:100%;height:100%;object-fit:cover;object-position:35% 50%}
                .circle .avatar img{border-radius:50%}.native-sensitive .avatar img[src="/avatar.gif"]{clip-path:ellipse(44% 36%)}.clipped .avatar img{clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
                .masked .avatar img{-webkit-mask-image:radial-gradient(circle,#000 60%,transparent 61%);mask-image:radial-gradient(circle,#000 60%,transparent 61%)}
                .transformed .avatar img{transform:rotate(9deg) translateX(4px);translate:3px 2px;scale:1.08;rotate:4deg;transform-origin:30% 40%}
                .responsive .avatar{width:120px;height:96px;overflow:hidden}.responsive-small .avatar{width:60px;height:48px;overflow:hidden}
            </style><style id="custom-style">.sentinel{color:red}</style></head><body>
                <select id="themes"><option selected>A</option><option>B</option></select>
                <section class="tm-app-page tm-app-page-avatars" data-tm-page="avatars"></section>
                <div id="chat">
                    <div class="mes circle native-sensitive" is_user="false" is_system="false"><div class="avatar"><img src="/avatar.gif" style="opacity:.99"></div></div>
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
                const browserFetch = window.fetch.bind(window);
                window.fetch = (input, init) => {
                    if (String(input).includes('/api/plugins/theme-manager')) {
                        backendCalls++;
                        return Promise.reject(new Error('backend forbidden'));
                    }
                    return browserFetch(input, init);
                };
                window.__themeMeta = { keep: true };
                const customBefore = document.querySelector('#custom-style').textContent;
                const modules = window.ThemeMgrModules;
                const store = modules.createAvatarStore({ dbName });
                const processor = modules.createAvatarImageProcessor({});
                const context = { characters: [{ avatar: 'char.png', name: 'Character' }], characterId: 0, groupId: null, name1: 'User', eventSource: { on() {}, removeListener() {} }, eventTypes: {} };
                const runtime = modules.createAvatarRuntime({ store, getContext: () => context, getThemeName: () => document.querySelector('#themes').value });
                await runtime.start();
                const themePreviewSource = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
                const sheets = modules.createUiSheets({
                    getPopupLayer: () => document.body,
                    load: () => ({ themeMeta: { 'Theme Preview': { imageData: themePreviewSource } } }),
                    esc: (value) => String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'),
                });
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
                    createSheet: sheets.createSheet,
                    closeSheet: sheets.closeSheet,
                    openImageLightbox: sheets.openImageLightbox,
                    closeManager: () => { managerClosed++; }, toast() {}, confirm: () => true,
                });
                document.querySelector('[data-tm-page="avatars"]').innerHTML = modules.avatarPage.buildPageHtml(modules.imageLoader.PLACEHOLDER_SRC);
                await pageController.mount();
                const empty = pageController.getState().count === 0 && Boolean(document.querySelector('.tm-avatar-page-empty'));
                const emptyLayout = !document.querySelector('.tm-avatar-page h2') &&
                    !document.querySelector('[data-avatar-action="pick"]') && !document.querySelector('[data-avatar-actions]');
                const nativeStatus = pageController.getNativeStatus();
                const nativeEntryReady = nativeStatus.available && nativeStatus.label === 'Character' &&
                    !document.querySelector('[data-avatar-native-bar]');

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

                document.querySelector('[data-avatar-action="view"]').click();
                for (let attempt = 0; attempt < 20 && !document.querySelector('.tm-lightbox'); attempt++) await delay(10);
                const previewImage = document.querySelector('.tm-lightbox .tm-lb-img');
                const fullPreview = Boolean(previewImage && previewImage.src === persisted.imageData);
                document.querySelector('.tm-lightbox .tm-lb-close').click();
                sheets.openLightbox(['Theme Preview'], 'Theme Preview');
                const themePreviewImage = document.querySelector('.tm-lightbox .tm-lb-img');
                const sharedThemePreview = Boolean(themePreviewImage && themePreviewImage.src === themePreviewSource);
                document.querySelector('.tm-lightbox .tm-lb-close').click();

                const avatarElements = [...document.querySelectorAll('#chat .avatar')];
                const originalCharacterSources = [...document.querySelectorAll('.mes[is_user="false"] .avatar img')].map((image) => ({
                    src:image.getAttribute('src'), srcset:image.getAttribute('srcset'),
                }));
                const originalUserSources = [...document.querySelectorAll('.mes[is_user="true"] .avatar img')].map((image) => ({
                    src:image.getAttribute('src'), srcset:image.getAttribute('srcset'),
                }));
                const originalAvatarRects = avatarElements.map((element) => element.getBoundingClientRect.bind(element));
                let offscreenScrolls = 0;
                avatarElements.forEach((element) => {
                    element.getBoundingClientRect = () => ({x:20,y:innerHeight+1000,left:20,top:innerHeight+1000,right:92,bottom:innerHeight+1072,width:72,height:72,toJSON(){return this;}});
                    element.scrollIntoView = () => { offscreenScrolls++; };
                });
                document.querySelector('[data-avatar-action="menu"]').click();
                let userMenuAction = null;
                for (let attempt = 0; attempt < 20 && !userMenuAction; attempt++) {
                    await delay(10);
                    userMenuAction = document.querySelector('[data-avatar-menu-action="apply-user"]');
                }
                const menuOpened = Boolean(userMenuAction && userMenuAction.getAttribute('aria-disabled') !== 'true');
                if (!userMenuAction) throw new Error('avatar three-dot menu did not finish opening');
                userMenuAction.click();
                let toolbarHost = null;
                for (let attempt = 0; attempt < 50 && runtime.getState().state !== 'editing'; attempt++) await delay(10);
                avatarElements.forEach((element, index) => { element.getBoundingClientRect = originalAvatarRects[index]; });
                await frame();
                const directUser = runtime.getState().state === 'editing' && managerClosed === 1 && offscreenScrolls === 1;
                toolbarHost = document.querySelector('#tm-avatar-editor-toolbar');
                const toolbarRect = toolbarHost && toolbarHost.getBoundingClientRect();
                const viewportTop = visualViewport ? visualViewport.offsetTop : 0;
                const viewportBottom = viewportTop + (visualViewport ? visualViewport.height : innerHeight);
                const toolbarVisible = Boolean(toolbarRect && toolbarRect.width > 0 && toolbarRect.height > 0 && toolbarRect.top >= viewportTop && toolbarRect.bottom <= viewportBottom);
                const toolbarIsolated = Boolean(toolbarHost && toolbarHost.shadowRoot && toolbarHost.shadowRoot.querySelector('[data-action="save"]'));
                const userImages = [...document.querySelectorAll('.mes[is_user="true"] .avatar img')];
                const highQualityApplied = userImages.every((image) => image.src === persisted.imageData);
                const userBoxBeforeSliders = userImages.map((image) => image.getBoundingClientRect().toJSON());
                const sliderRoot = toolbarHost.shadowRoot;
                const sizeSlider = sliderRoot.querySelector('[data-view="scale"]');
                const horizontalSlider = sliderRoot.querySelector('[data-view="x"]');
                const verticalSlider = sliderRoot.querySelector('[data-view="y"]');
                const rotateSlider = sliderRoot.querySelector('[data-view="rotate"]');
                sizeSlider.value = '1.25'; sizeSlider.dispatchEvent(new Event('input',{bubbles:true}));
                horizontalSlider.value = '.3'; horizontalSlider.dispatchEvent(new Event('input',{bubbles:true}));
                verticalSlider.value = '-.2'; verticalSlider.dispatchEvent(new Event('input',{bubbles:true}));
                const inputStart = performance.now();
                for (let angle = 1; angle <= 15; angle++) { rotateSlider.value = String(angle); rotateSlider.dispatchEvent(new Event('input',{bubbles:true})); }
                const inputHandlingMs = Math.round((performance.now() - inputStart) * 100) / 100;
                const responsiveInputs = inputHandlingMs < 80;
                sliderRoot.querySelector('[data-step-view="scale"][data-step-direction="-1"]').click();
                sliderRoot.querySelector('[data-step-view="x"][data-step-direction="1"]').click();
                sliderRoot.querySelector('[data-step-view="y"][data-step-direction="-1"]').click();
                sliderRoot.querySelector('[data-step-view="rotate"][data-step-direction="1"]').click();
                const horizontalFlip = sliderRoot.querySelector('[data-action="flip-x"]');
                const verticalFlip = sliderRoot.querySelector('[data-action="flip-y"]');
                horizontalFlip.click(); verticalFlip.click();
                await frame();
                const sliderView = runtime.getState().view;
                const userBoxAfterSliders = userImages.map((image) => image.getBoundingClientRect().toJSON());
                const sliderControls = sliderView.scale === 1.2 && sliderView.x === .35 && sliderView.y === -.25 && sliderView.rotate === 16 &&
                    userImages.every((image) => image.src.startsWith('data:image/svg+xml')) &&
                    JSON.stringify(userBoxBeforeSliders) === JSON.stringify(userBoxAfterSliders);
                const mirrorControls = sliderView.flipX && sliderView.flipY && horizontalFlip.classList.contains('is-active') && verticalFlip.classList.contains('is-active') &&
                    horizontalFlip.getAttribute('aria-pressed') === 'true' && verticalFlip.getAttribute('aria-pressed') === 'true' && decodeURIComponent(userImages[0].src).includes('scale(-1 -1)');
                const themedToolbar = getComputedStyle(horizontalSlider).accentColor === 'rgb(12, 34, 56)' &&
                    getComputedStyle(sliderRoot.querySelector('.tm-avatar-editor-bar')).color === 'rgb(210, 220, 230)';
                runtime.reset();
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
                    translate:getComputedStyle(image).translate,
                    scale:getComputedStyle(image).scale, rotate:getComputedStyle(image).rotate,
                    rect:Array.from(['left','top','width','height'],(key)=>Math.round(image.getBoundingClientRect()[key]*1000)/1000),
                }));
                const cropBeforeScale = characterImages[0].style.getPropertyValue('object-view-box');
                runtime.setScale(1.2);
                await frame();
                const scaledRects = characterImages.map((image) => Array.from(['left','top','width','height'],(key)=>Math.round(image.getBoundingClientRect()[key]*1000)/1000));
                const cropAfterScale = characterImages[0].style.getPropertyValue('object-view-box');
                const characterTilt = document.querySelector('#tm-avatar-editor-toolbar').shadowRoot.querySelector('[data-view="rotate"]');
                characterTilt.value = '12'; characterTilt.dispatchEvent(new Event('input',{bubbles:true}));
                document.querySelector('#tm-avatar-editor-toolbar').shadowRoot.querySelector('[data-action="flip-x"]').click();
                const saveResult = await runtime.saveEdit();
                const persistedBindingAfterSave = await reloadedStore.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY,'character:char.png');
                const tiltPersisted = persistedBindingAfterSave && persistedBindingAfterSave.view.rotate === 12 && persistedBindingAfterSave.view.flipX === true && characterImages.every((image) => image.src.startsWith('data:image/svg+xml'));
                const afterVisuals = characterImages.map((image) => ({
                    radius:getComputedStyle(image).borderRadius, clip:getComputedStyle(image).clipPath,
                    mask:getComputedStyle(image).webkitMaskImage || getComputedStyle(image).maskImage,
                    translate:getComputedStyle(image).translate,
                    scale:getComputedStyle(image).scale, rotate:getComputedStyle(image).rotate,
                    rect:Array.from(['left','top','width','height'],(key)=>Math.round(image.getBoundingClientRect()[key]*1000)/1000),
                }));
                const visualsPreserved = JSON.stringify(beforeVisuals) === JSON.stringify(afterVisuals);
                const contentOnlyScale = JSON.stringify(beforeVisuals.map((item)=>item.rect)) === JSON.stringify(scaledRects) && cropBeforeScale !== cropAfterScale;

                const rerender = document.createElement('div'); rerender.className='mes transformed'; rerender.setAttribute('is_user','false'); rerender.setAttribute('is_system','false'); rerender.innerHTML='<div class="avatar"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div>'; document.querySelector('#chat').appendChild(rerender);
                await runtime.reconcile();
                const rerenderApplied = rerender.querySelector('img').src.startsWith('data:image/svg+xml');

                const transformA = characterImages[0].style.getPropertyValue('object-view-box');
                document.querySelector('#themes').value='B'; document.querySelector('#themes').dispatchEvent(new Event('change',{bubbles:true}));
                await delay(150);
                const transformB = characterImages[0].style.getPropertyValue('object-view-box');
                const themesIsolated = transformA === transformB && characterImages.every((image) => image.src.startsWith('data:image/svg+xml'));

                pageController.beginNativeEdit();
                for (let attempt = 0; attempt < 50 && runtime.getState().state !== 'editing'; attempt++) await delay(10);
                const nativeEditorOpened = runtime.getState().state === 'editing' && runtime.getState().mode === 'native';
                const nativeSourcesBeforeInput = characterImages.map((image) => image.src);
                const nativePreviewFrame = document.querySelector('.tm-avatar-native-live-preview');
                const nativePreviewImage = nativePreviewFrame && nativePreviewFrame.querySelector('img');
                const nativePreviewOriginal = nativePreviewFrame && nativePreviewFrame.parentElement.querySelector(':scope > img');
                const nativePreviewFrameStyle = nativePreviewFrame && getComputedStyle(nativePreviewFrame);
                const nativePreviewOriginalStyle = nativePreviewOriginal && getComputedStyle(nativePreviewOriginal);
                const nativeShapeDuringEdit = Boolean(nativePreviewFrame && nativePreviewImage && nativePreviewOriginal &&
                    nativePreviewFrameStyle.borderRadius === nativePreviewOriginalStyle.borderRadius &&
                    nativePreviewFrameStyle.clipPath === nativePreviewOriginalStyle.clipPath &&
                    nativePreviewFrameStyle.maskImage === nativePreviewOriginalStyle.maskImage);
                const nativeRotateSlider = document.querySelector('#tm-avatar-editor-toolbar').shadowRoot.querySelector('[data-view="rotate"]');
                const nativeInputStart = performance.now();
                for (let angle = 1; angle <= 60; angle++) { nativeRotateSlider.value = String(angle); nativeRotateSlider.dispatchEvent(new Event('input',{bubbles:true})); }
                const nativeInputHandlingMs = Math.round((performance.now() - nativeInputStart) * 100) / 100;
                nativeRotateSlider.value = '0'; nativeRotateSlider.dispatchEvent(new Event('input',{bubbles:true}));
                const nativeResponsiveInputs = nativeInputHandlingMs < 80;
                runtime.setScale(1.3);
                await frame();
                await nativePreviewImage.decode();
                const nativePreviewView = runtime.getState().view;
                const nativeLightweightPreview = characterImages.every((image,index) => image.src === nativeSourcesBeforeInput[index]) &&
                    Boolean(nativePreviewImage.style.getPropertyValue('transform')) && nativePreviewView.scale === 1.3 &&
                    document.querySelectorAll('.tm-avatar-native-live-preview').length === 1;
                const nativeSave = await runtime.saveEdit();
                const persistedNativeView = await reloadedStore.getNativeView('character:char.png');
                const nativeBindingCleared = !(await reloadedStore.getBinding(modules.avatarRuntime.DEFAULT_BINDING_KEY,'character:char.png'));
                const nativeContentMoved = characterImages.every((image) => image.src.startsWith('data:image/svg+xml') && image.naturalWidth > 0 && decodeURIComponent(image.src).includes('scale(1.3 1.3)'));
                const nativeAvoidsObjectViewBox = characterImages.every((image) => !image.style.getPropertyValue('object-view-box'));
                const nativeShapePreserved = nativeShapeDuringEdit && getComputedStyle(characterImages[0]).clipPath === 'ellipse(44% 36%)';

                const nativeMenu = await pageController.openNativeMenu();
                const nativeMenuCombined = Boolean(nativeMenu.querySelector('[data-avatar-menu-action="adjust-native-character"]') &&
                    nativeMenu.querySelector('[data-avatar-menu-action="reset-native-character"]') &&
                    nativeMenu.querySelector('[data-avatar-menu-action="adjust-native-user"]'));
                sheets.closeSheet(nativeMenu);
                pageController.beginNativeEdit('user');
                for (let attempt = 0; attempt < 50 && runtime.getState().state !== 'editing'; attempt++) await delay(10);
                const nativeUserEditorOpened = runtime.getState().state === 'editing' && runtime.getState().mode === 'native' && runtime.getState().target.kind === 'user';
                const nativeUserSourcesBeforeInput = userImages.map((image) => image.src);
                const nativeUserX = document.querySelector('#tm-avatar-editor-toolbar').shadowRoot.querySelector('[data-view="x"]');
                nativeUserX.value = '.2'; nativeUserX.dispatchEvent(new Event('input',{bubbles:true}));
                runtime.setScale(1.25);
                await frame();
                const nativeUserPreviewImage = document.querySelector('.tm-avatar-native-live-preview img');
                const nativeUserPreviewView = runtime.getState().view;
                const nativeUserLightweightPreview = Boolean(nativeUserPreviewImage) &&
                    userImages.every((image,index) => image.src === nativeUserSourcesBeforeInput[index]) &&
                    Boolean(nativeUserPreviewImage.style.getPropertyValue('transform')) &&
                    nativeUserPreviewView.x === .2 && nativeUserPreviewView.scale === 1.25;
                const nativeUserSave = await runtime.saveEdit();
                const persistedUserNativeView = await reloadedStore.getNativeView('user:global');
                const nativeUserMoved = runtime.getState().state === 'idle' && userImages.every((image) => image.src.startsWith('data:image/svg+xml') && decodeURIComponent(image.src).includes('scale(1.25 1.25)'));
                await runtime.clearNativeView('user');
                const nativeUserRestored = userImages.every((image,index) => image.getAttribute('src') === originalUserSources[index].src && image.getAttribute('srcset') === originalUserSources[index].srcset);

                await store.putBinding({ themeKey:modules.avatarRuntime.DEFAULT_BINDING_KEY, targetKey:'user:global', avatarId, view:{x:.25,y:.125,scale:1} });
                await runtime.reconcile();
                const responsiveCrops = userImages.map((image) => image.style.getPropertyValue('object-view-box'));
                const responsive = responsiveCrops.every((value) => value && value === responsiveCrops[0]);
                await runtime.beginEdit({ kind:'user', avatarId });
                const otherTargetSurvivesEdit = characterImages.every((image) => image.src.startsWith('data:image/svg+xml'));
                await runtime.cancelEdit();
                const simultaneousBindings = otherTargetSurvivesEdit && characterImages.every((image) => image.src.startsWith('data:image/svg+xml')) && userImages.every((image) => image.src === persisted.imageData);
                await runtime.clearBinding('user');
                const restoredUser = userImages.every((image) => image.src.includes('R0lGOD'));
                const resetNativeSheet = await pageController.openNativeMenu();
                resetNativeSheet.querySelector('[data-avatar-menu-action="reset-native-character"]').click();
                let nativeCharacterRestored = false;
                for (let attempt = 0; attempt < 50 && !nativeCharacterRestored; attempt++) {
                    await delay(10);
                    nativeCharacterRestored = !(await store.getNativeView('character:char.png')) && characterImages.every((image,index) =>
                        image.getAttribute('src') === originalCharacterSources[index].src && image.getAttribute('srcset') === originalCharacterSources[index].srcset);
                }
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
                    G_managerClose:managerClosed===3, H_drag:Math.abs(dragged.view.x-.25)<.001&&Math.abs(dragged.view.y-.125)<.001,
                    I_scale:dragged.view.scale===1.05, J_cancel:cancelledToRaw, K_save:Boolean(persistedBindingAfterSave&&persistedBindingAfterSave.avatarId===avatarId),
                    L_rerender:rerenderApplied, M_themeSwitch:themesIsolated, N_circle:visualsPreserved,
                    O_clip:visualsPreserved, P_mask:visualsPreserved, Q_transform:visualsPreserved,
                    R_responsive:responsive, reset:reset.x===0&&reset.y===0&&reset.scale===1&&reset.rotate===0&&reset.flipX===false&&reset.flipY===false,
                    gridUsesThumb, mainSize:[persisted.width,persisted.height], alpha:persisted.mimeType==='image/png',
                    restoredUser, cleanup, loaderDisconnects, noOverflow, backendCalls, inputHandlingMs,
                    emptyLayout, fullPreview, sharedThemePreview, toolbarVisible, toolbarIsolated, sliderControls, responsiveInputs, mirrorControls, themedToolbar, tiltPersisted, contentOnlyScale, simultaneousBindings, menuDelete, nativeInputHandlingMs, nativeResponsiveInputs,
                    nativeEntryReady, nativeEditorOpened, nativeLightweightPreview, nativeViewPersisted:Boolean(nativeSave.saved&&persistedNativeView&&persistedNativeView.view.scale===1.3), nativeBindingCleared, nativeContentMoved, nativeAvoidsObjectViewBox, nativeShapePreserved,
                    nativeMenuCombined, nativeUserEditorOpened, nativeUserLightweightPreview, nativeUserPersisted:Boolean(nativeUserSave.saved&&persistedUserNativeView&&persistedUserNativeView.view.scale===1.25), nativeUserMoved, nativeUserRestored, nativeCharacterRestored,
                    hostUntouched:window.__themeMeta.keep&&document.querySelector('#custom-style').textContent===customBefore,
                };
            }, { label: viewport.label });

            for (const [key, value] of Object.entries(report)) {
                if (/^[A-R]_/.test(key) || ['reset','gridUsesThumb','alpha','restoredUser','cleanup','noOverflow','emptyLayout','fullPreview','sharedThemePreview','toolbarVisible','toolbarIsolated','sliderControls','responsiveInputs','mirrorControls','themedToolbar','tiltPersisted','contentOnlyScale','simultaneousBindings','menuDelete','nativeResponsiveInputs','nativeEntryReady','nativeEditorOpened','nativeLightweightPreview','nativeViewPersisted','nativeBindingCleared','nativeContentMoved','nativeAvoidsObjectViewBox','nativeShapePreserved','nativeMenuCombined','nativeUserEditorOpened','nativeUserLightweightPreview','nativeUserPersisted','nativeUserMoved','nativeUserRestored','nativeCharacterRestored','hostUntouched'].includes(key)) assert(value === true, `${viewport.label}: ${key} failed`);
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
