const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
    try { return require('playwright'); }
    catch (_) {
        const explicit = process.env.THEME_MGR_PLAYWRIGHT_PATH;
        if (!explicit) throw new Error('Playwright unavailable; set THEME_MGR_PLAYWRIGHT_PATH');
        return require(explicit);
    }
}

const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, '..');

const cases = [
    { id: 'square', label: 'A ordinary square', role: 'character' },
    { id: 'circle', label: 'B circular radius', role: 'character' },
    { id: 'overflow', label: 'C parent overflow hidden', role: 'character' },
    { id: 'clip', label: 'D clip path', role: 'character' },
    { id: 'mask', label: 'E mask image', role: 'character' },
    { id: 'transform', label: 'F existing transform', role: 'character' },
    { id: 'rotate', label: 'G existing rotate', role: 'character' },
    { id: 'position', label: 'H existing object position', role: 'character' },
    { id: 'inline', label: 'I existing inline style', role: 'character' },
    { id: 'user', label: 'J User and Character', role: 'user', touch: true },
];

function makeHtml() {
    const messages = cases.map((item, index) => `
        <div class="mes" mesid="${index}" is_user="${item.role === 'user'}" is_system="false" data-case="${item.id}">
            <div class="mesAvatarWrapper"><div class="avatar"><img alt="${item.id}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%238c6bb5'/%3E%3Ccircle cx='60' cy='45' r='24' fill='white'/%3E%3C/svg%3E" ${item.id === 'inline' ? 'style="opacity:.93;transform-origin:32% 41%"' : ''}></div></div>
            <div class="mes_block"><div class="ch_name">Fixed name</div><div class="mes_text">Fixed smoke text</div></div>
        </div>`).join('');
    return `<!doctype html><html><head><style id="custom-style">/* must remain exact */</style><style>
        body{margin:0;padding:20px 20px 120px;background:#17151f;color:#eee;font-family:system-ui}
        #chat{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:14px}.mes{display:flex;gap:12px;min-height:120px;padding:15px;background:#282331;border-radius:14px}.mesAvatarWrapper{width:84px}.avatar{position:relative;width:72px;height:72px}.avatar::after{content:"";position:absolute;inset:-5px;border:2px solid #d4aa70;border-radius:18px;pointer-events:none}.avatar img{display:block;width:72px;height:72px;object-fit:cover;object-position:center;border-radius:3px}
        .mes[data-case=circle] .avatar img{border-radius:50%}.mes[data-case=overflow] .avatar{overflow:hidden;border-radius:16px}.mes[data-case=overflow] .avatar::after{display:none}.mes[data-case=clip] .avatar img{clip-path:polygon(50% 0,100% 30%,82% 100%,18% 100%,0 30%)}.mes[data-case=mask] .avatar img{-webkit-mask-image:radial-gradient(circle,#000 62%,transparent 64%);mask-image:radial-gradient(circle,#000 62%,transparent 64%)}.mes[data-case=transform] .avatar img{transform:rotate(11deg) translateX(4px);transform-origin:24% 38%}.mes[data-case=rotate] .avatar img{translate:3px 2px;scale:1.12;rotate:13deg;transform:translateX(2px)}.mes[data-case=position] .avatar img{object-position:22% 68%}
    </style></head><body><div id="chat">${messages}</div><div class="avatar" id="sidebar-avatar"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div><img id="body-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></body></html>`;
}

async function launch() {
    const executablePath = process.env.THEME_MGR_CHROME_PATH || [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find(fs.existsSync);
    try { return await chromium.launch({ headless: true }); }
    catch (error) {
        if (!executablePath) throw error;
        return chromium.launch({ executablePath, headless: true });
    }
}

function closeEnough(first, second, epsilon = 0.2) {
    return Math.abs(first - second) <= epsilon;
}

(async () => {
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, hasTouch: true });
    const report = [];
    try {
        await page.setContent(makeHtml(), { waitUntil: 'load' });
        await page.addScriptTag({ path: path.join(ROOT, 'src', 'avatar-inplace-editor-poc.js') });
        await page.evaluate(() => {
            window.__backendCalls = 0;
            window.fetch = () => { window.__backendCalls++; return Promise.reject(new Error('backend forbidden')); };
            window.__themeMetaSentinel = { imageData: 'original', thumbData: 'original' };
            window.__avatarClicks = 0;
            document.querySelectorAll('#chat .avatar').forEach((avatar) => avatar.addEventListener('click', () => { window.__avatarClicks++; }));
        });

        const forbidden = await page.evaluate(() => {
            ThemeMgrAvatarPoc.start();
            document.querySelector('#sidebar-avatar img').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 90, button: 0 }));
            const afterSidebar = ThemeMgrAvatarPoc.getState().state;
            document.querySelector('#body-image').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 91, button: 0 }));
            const afterBodyImage = ThemeMgrAvatarPoc.getState().state;
            ThemeMgrAvatarPoc.cancel();
            return { afterSidebar, afterBodyImage };
        });
        if (forbidden.afterSidebar !== 'selecting' || forbidden.afterBodyImage !== 'selecting') throw new Error('forbidden image became selectable');

        for (const item of cases) {
            const result = await page.evaluate(async ({ id, touch }) => {
                const image = document.querySelector(`.mes[data-case="${id}"] .avatar img`);
                const avatar = image.parentElement;
                const originalParent = image.parentElement;
                const inlineBefore = image.getAttribute('style');
                const customStyleBefore = document.querySelector('#custom-style').textContent;
                const computedBefore = getComputedStyle(image);
                const baseline = {
                    rect: (() => { const r=image.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })(),
                    transform: computedBefore.transform,
                    translate: computedBefore.translate,
                    scale: computedBefore.scale,
                    rotate: computedBefore.rotate,
                    origin: computedBefore.transformOrigin,
                    objectPosition: computedBefore.objectPosition,
                    borderRadius: computedBefore.borderRadius,
                    clipPath: computedBefore.clipPath,
                    maskImage: computedBefore.webkitMaskImage || computedBefore.maskImage,
                    avatarOverflow: getComputedStyle(avatar).overflow,
                };
                const otherImages = [...document.querySelectorAll('#chat .avatar img')].filter((entry) => entry !== image);
                const otherAnimationCounts = otherImages.map((entry) => entry.getAnimations().length);
                ThemeMgrAvatarPoc.start();
                image.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 21, pointerType: touch ? 'touch' : 'mouse', button: 0, clientX: 20, clientY: 20 }));
                if (ThemeMgrAvatarPoc.getState().state !== 'editing') throw new Error('selection failed');
                image.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 22, pointerType: touch ? 'touch' : 'mouse', button: 0, clientX: 20, clientY: 20 }));
                document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 22, pointerType: touch ? 'touch' : 'mouse', clientX: 38, clientY: 47 }));
                document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 22, pointerType: touch ? 'touch' : 'mouse', clientX: 38, clientY: 47 }));
                const dragRectRaw = image.getBoundingClientRect();
                const dragRect = {x:dragRectRaw.x,y:dragRectRaw.y,width:dragRectRaw.width,height:dragRectRaw.height};
                ThemeMgrAvatarPoc.scaleUp();
                const edited = ThemeMgrAvatarPoc.getState();
                const animation = image.getAnimations()[0];
                const during = getComputedStyle(image);
                const duringSnapshot = {
                    inlineStyle: image.getAttribute('style'),
                    translate: during.translate,
                    scale: during.scale,
                    rotate: during.rotate,
                    origin: during.transformOrigin,
                    objectPosition: during.objectPosition,
                    borderRadius: during.borderRadius,
                    clipPath: during.clipPath,
                    maskImage: during.webkitMaskImage || during.maskImage,
                    composite: animation.effect.getKeyframes()[0].composite,
                    hierarchyPreserved: image.parentElement === originalParent,
                    otherAnimationsUnchanged: otherImages.every((entry, index) => entry.getAnimations().length === otherAnimationCounts[index]),
                };
                ThemeMgrAvatarPoc.reset();
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const resetRectRaw = image.getBoundingClientRect();
                const resetRect = {x:resetRectRaw.x,y:resetRectRaw.y,width:resetRectRaw.width,height:resetRectRaw.height};
                ThemeMgrAvatarPoc.setScale(1.25);
                const cancelled = ThemeMgrAvatarPoc.cancel();
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const afterCancelStyle = getComputedStyle(image);
                const cancelRectRaw = image.getBoundingClientRect();
                const cancelRect = {x:cancelRectRaw.x,y:cancelRectRaw.y,width:cancelRectRaw.width,height:cancelRectRaw.height};
                const clickBefore = window.__avatarClicks;
                image.click();
                const clickRestored = window.__avatarClicks === clickBefore + 1;

                ThemeMgrAvatarPoc.start();
                image.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 31, pointerType: touch ? 'touch' : 'mouse', button: 0, clientX: 10, clientY: 10 }));
                image.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 32, pointerType: touch ? 'touch' : 'mouse', button: 0, clientX: 10, clientY: 10 }));
                document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 32, pointerType: touch ? 'touch' : 'mouse', clientX: 19, clientY: 22 }));
                document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 32, pointerType: touch ? 'touch' : 'mouse', clientX: 19, clientY: 22 }));
                ThemeMgrAvatarPoc.scaleUp();
                const saved = ThemeMgrAvatarPoc.save();
                const savedAnimations = image.getAnimations();
                const cleanup = {
                    state: ThemeMgrAvatarPoc.getState().state,
                    toolbar: Boolean(document.querySelector('#tm-avatar-poc-toolbar')),
                    style: Boolean(document.querySelector('#tm-avatar-poc-style')),
                    targetClass: image.classList.contains('tm-avatar-poc-target'),
                    avatarClass: avatar.classList.contains('tm-avatar-poc-selected'),
                    savedAnimationCount: savedAnimations.length,
                };
                savedAnimations.forEach((entry) => entry.cancel());
                return {
                    baseline,
                    dragRect,
                    edited,
                    during: duringSnapshot,
                    resetRect,
                    cancelled,
                    cancelRect,
                    afterCancel: {
                        inlineStyle: image.getAttribute('style'),
                        transform: afterCancelStyle.transform,
                        translate: afterCancelStyle.translate,
                        scale: afterCancelStyle.scale,
                        rotate: afterCancelStyle.rotate,
                        origin: afterCancelStyle.transformOrigin,
                        objectPosition: afterCancelStyle.objectPosition,
                        borderRadius: afterCancelStyle.borderRadius,
                        clipPath: afterCancelStyle.clipPath,
                        maskImage: afterCancelStyle.webkitMaskImage || afterCancelStyle.maskImage,
                    },
                    inlineBefore,
                    customStyleUnchanged: document.querySelector('#custom-style').textContent === customStyleBefore,
                    clickRestored,
                    saved,
                    cleanup,
                    backendCalls: window.__backendCalls,
                    metadataUnchanged: JSON.stringify(window.__themeMetaSentinel) === JSON.stringify({ imageData: 'original', thumbData: 'original' }),
                };
            }, item);

            if (result.edited.x !== 18 || result.edited.y !== 27 || result.edited.scale !== 1.05) throw new Error(`${item.id}: drag/scale mismatch`);
            const baselineCenter = { x: result.baseline.rect.x + result.baseline.rect.width / 2, y: result.baseline.rect.y + result.baseline.rect.height / 2 };
            const dragCenter = { x: result.dragRect.x + result.dragRect.width / 2, y: result.dragRect.y + result.dragRect.height / 2 };
            if (!closeEnough(dragCenter.x - baselineCenter.x, 18, 0.4) || !closeEnough(dragCenter.y - baselineCenter.y, 27, 0.4)) throw new Error(`${item.id}: viewport drag geometry mismatch`);
            if (result.during.composite !== 'add' || !result.during.hierarchyPreserved || !result.during.otherAnimationsUnchanged) throw new Error(`${item.id}: additive isolation failed`);
            for (const key of ['translate','scale','rotate','origin','objectPosition','borderRadius','clipPath','maskImage']) {
                if (result.during[key] !== result.baseline[key]) throw new Error(`${item.id}: theme ${key} changed during edit`);
                if (result.afterCancel[key] !== result.baseline[key]) throw new Error(`${item.id}: theme ${key} not restored`);
            }
            if (result.during.inlineStyle !== result.inlineBefore || result.afterCancel.inlineStyle !== result.inlineBefore) throw new Error(`${item.id}: inline style changed`);
            for (const key of ['x','y','width','height']) {
                if (!closeEnough(result.resetRect[key], result.baseline.rect[key]) || !closeEnough(result.cancelRect[key], result.baseline.rect[key])) throw new Error(`${item.id}: geometry not restored for ${key}`);
            }
            if (!result.clickRestored || !result.customStyleUnchanged || !result.metadataUnchanged || result.backendCalls !== 0) throw new Error(`${item.id}: host state changed`);
            if (result.saved.role !== item.role || result.saved.x !== 9 || result.saved.y !== 12 || result.saved.scale !== 1.05 || !result.saved.saved) throw new Error(`${item.id}: save result mismatch`);
            if (result.cleanup.state !== 'idle' || result.cleanup.toolbar || result.cleanup.style || result.cleanup.targetClass || result.cleanup.avatarClass || result.cleanup.savedAnimationCount !== 1) throw new Error(`${item.id}: cleanup/save effect mismatch`);
            report.push({ id: item.id, label: item.label, role: result.saved.role, pointer: item.touch ? 'touch' : 'mouse', diagnostics: result.saved.diagnostics, cleanup: result.cleanup });
        }

        const disconnect = await page.evaluate(() => {
            const image = document.querySelector('.mes[data-case=square] .avatar img');
            ThemeMgrAvatarPoc.start();
            image.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 71, button: 0 }));
            image.remove();
            return new Promise((resolve) => setTimeout(() => resolve({ state: ThemeMgrAvatarPoc.getState(), toolbar: Boolean(document.querySelector('#tm-avatar-poc-toolbar')), style: Boolean(document.querySelector('#tm-avatar-poc-style')) }), 0));
        });
        if (disconnect.state.state !== 'idle' || disconnect.state.lastEndReason !== 'target-disconnected' || disconnect.toolbar || disconnect.style) throw new Error('disconnect cleanup failed');
        console.log(JSON.stringify({ ok: true, cases: report.map((item) => ({ id:item.id,label:item.label,role:item.role,pointer:item.pointer,strategy:item.diagnostics.pluginAdjustmentStrategy,parentClips:item.diagnostics.avatarOverflow.clips,cleanup:item.cleanup })), disconnect }, null, 2));
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
