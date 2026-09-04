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
const OUTPUT = process.env.THEME_MGR_PREVIEW_POC_OUTPUT || '';

const fixtures = [
    { id: 'light', label: 'simple light', light: true, background: false, frame: false, round: false, decorate: false },
    { id: 'dark', label: 'dark', light: false, background: false, frame: false, round: false, decorate: false },
    { id: 'background', label: 'background image', light: false, background: true, frame: false, round: false, decorate: false },
    { id: 'frame', label: 'avatar frame', light: false, background: false, frame: true, round: false, decorate: false },
    { id: 'round', label: 'circular avatar', light: true, background: false, frame: false, round: true, decorate: false },
    { id: 'irregular', label: 'irregular mask and decoration', light: false, background: true, frame: true, round: false, decorate: true },
    { id: 'no-background', label: 'no background image', light: true, background: false, frame: true, round: false, decorate: false },
    { id: 'no-frame', label: 'no avatar frame', light: false, background: true, frame: false, round: true, decorate: true },
];

function dataSvg(primary, secondary) {
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="390" height="700"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient></defs><rect width="390" height="700" fill="url(#g)"/><circle cx="320" cy="120" r="86" fill="white" fill-opacity=".12"/></svg>`)}`;
}

function frameSvg() {
    return `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="45" fill="none" stroke="#f0c97d" stroke-width="8"/><circle cx="50" cy="8" r="7" fill="#fff0b0"/></svg>')}`;
}

function makeHtml(fixture) {
    const bg = fixture.background ? `url("${dataSvg(fixture.light ? '#efe7f6' : '#161427', fixture.light ? '#b9d7ef' : '#44315f')}")` : 'none';
    const body = fixture.light ? '#f2eef6' : '#171720';
    const text = fixture.light ? 'rgb(38, 31, 46)' : 'rgb(238, 236, 244)';
    const panel = fixture.light ? 'rgba(255,255,255,.84)' : 'rgba(30,30,43,.82)';
    const user = fixture.light ? 'rgba(221,210,239,.92)' : 'rgba(66,52,89,.86)';
    const avatarShape = fixture.round ? 'border-radius:50%;clip-path:circle(48%);' : fixture.decorate ? 'border-radius:18px;clip-path:polygon(50% 0,96% 24%,82% 94%,18% 94%,4% 24%);' : 'border-radius:14px;';
    const frame = fixture.frame ? `.avatar::after{content:"";position:absolute;inset:-7px;background:url("${frameSvg()}") center/contain no-repeat;}` : '';
    const decoration = fixture.decorate ? '.mes::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 92% 12%,rgba(240,201,125,.28),transparent 32%);pointer-events:none}.top::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(240,201,125,.25),transparent);}' : '';
    return `<!doctype html><html><head><style>
        :root{--SmartThemeBodyColor:${text};--SmartThemeQuoteColor:${fixture.light ? '#77559c' : '#d3a9ff'};--SmartThemeBlurTintColor:${body};--SmartThemeChatTintColor:${panel};--SmartThemeUserMesBlurTintColor:${user};--SmartThemeBotMesBlurTintColor:${panel};--SmartThemeBorderColor:rgba(130,110,160,.35);--SmartThemeShadowColor:rgba(0,0,0,.3)}
        html,body{margin:0;width:100%;height:100%;background:${body};color:${text};font-family:Georgia,serif}#bg1{position:fixed;inset:0;background-image:${bg};background-size:cover;background-position:center;background-repeat:no-repeat}.top{position:relative;margin:10px;padding:14px;background:${panel};border:1px solid rgba(130,110,160,.35);border-radius:13px}.mes{position:relative;margin:12px;padding:16px;background:${panel};border:1px solid rgba(130,110,160,.35);border-radius:${fixture.decorate ? '22px 8px 22px 8px' : '14px'};box-shadow:0 8px 24px rgba(0,0,0,.18)}.mes[is_user=true]{background:${user}}.avatar{position:relative;width:64px;height:64px}.avatar img{width:64px;height:64px;object-fit:cover;object-position:42% 50%;${avatarShape}}#send_form{margin:10px;padding:12px;background:${panel};border:1px solid rgba(130,110,160,.35);border-radius:16px}${frame}${decoration}
    </style><style id="custom-style">/* fixture theme only */</style></head><body>
        <div id="bg1"></div><div id="source"><select id="themes"><option selected>${fixture.label}</option></select><div id="top-settings-holder" class="top">Fixture top bar</div><div id="chat"><div class="mes" is_user="false"><div class="avatar"><img alt="fixture" src="${dataSvg('#8d6bb5', '#d9a7bd')}"></div><div class="mes_text">Private text must never be copied</div></div><div class="mes" is_user="true"><div class="mes_text">More private text</div></div></div><form id="send_form">Input</form></div>
    </body></html>`;
}

async function analyzePng(page, dataUrl) {
    return page.evaluate(async (url) => {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set();
        let opaque = 0;
        const stride = Math.max(4, Math.floor(pixels.length / 5000 / 4) * 4);
        for (let i = 0; i < pixels.length; i += stride) {
            if (pixels[i + 3] > 0) opaque++;
            colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`);
        }
        return { width: image.width, height: image.height, opaqueSamples: opaque, uniqueColors: colors.size };
    }, dataUrl);
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

(async () => {
    const browser = await launch();
    const report = [];
    let sample = '';
    try {
        for (const fixture of fixtures) {
            const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
            await page.setContent(makeHtml(fixture), { waitUntil: 'load' });
            await page.addScriptTag({ path: path.join(ROOT, 'src', 'theme-appearance.js') });
            await page.addScriptTag({ path: path.join(ROOT, 'src', 'theme-preview-engine.js') });
            const outcome = await page.evaluate(async (fixtureId) => {
                window.power_user = { theme: `Fixture ${fixtureId}` };
                window.__themeMetaSentinel = { imageData: 'unchanged', thumbData: 'unchanged', previewData: 'unchanged' };
                const source = document.querySelector('#source');
                const sourceBefore = source.outerHTML;
                const customCssBefore = document.querySelector('#custom-style').textContent;
                const result = await ThemeMgrPreviewPoc.run({ showResult: false, scale: 2 });
                return {
                    ok: result.ok,
                    error: result.error || null,
                    dataUrl: result.dataUrl || '',
                    profile: result.profile,
                    profileBytes: result.profileBytes,
                    normalizedAssetCount: result.normalizedAssetCount,
                    diagnostics: ThemeMgrPreviewPoc.getDiagnostics(),
                    sourceUnchanged: source.outerHTML === sourceBefore,
                    customCssUnchanged: document.querySelector('#custom-style').textContent === customCssBefore,
                    themeUnchanged: window.power_user.theme === `Fixture ${fixtureId}`,
                    metadataUnchanged: JSON.stringify(window.__themeMetaSentinel) === JSON.stringify({ imageData: 'unchanged', thumbData: 'unchanged', previewData: 'unchanged' }),
                    privacySafe: !document.documentElement.outerHTML.includes('This preview uses fixed text') && !(result.dataUrl || '').includes('Private text'),
                };
            }, fixture.id);
            if (!outcome.ok) throw new Error(`${fixture.id}: ${JSON.stringify(outcome.error)}`);
            const image = await analyzePng(page, outcome.dataUrl);
            if (image.width !== 780 || image.height !== 1400 || image.opaqueSamples < 100 || image.uniqueColors < 4) throw new Error(`${fixture.id}: invalid image ${JSON.stringify(image)}`);
            if (!outcome.sourceUnchanged || !outcome.customCssUnchanged || !outcome.themeUnchanged || !outcome.metadataUnchanged) throw new Error(`${fixture.id}: source state changed`);
            if (outcome.diagnostics.activeStages !== 0) throw new Error(`${fixture.id}: stage leaked`);
            if (/Private text|More private text/.test(JSON.stringify(outcome.profile))) throw new Error(`${fixture.id}: private chat leaked into profile`);
            report.push({
                id: fixture.id,
                label: fixture.label,
                profileBytes: outcome.profileBytes,
                normalizedAssetCount: outcome.normalizedAssetCount,
                image,
                activeStages: outcome.diagnostics.activeStages,
            });
            if (!sample && fixture.id === 'irregular') sample = outcome.dataUrl;
            await page.close();
        }
        if (OUTPUT && sample) fs.writeFileSync(OUTPUT, Buffer.from(sample.split(',')[1], 'base64'));
        console.log(JSON.stringify({ ok: true, fixtures: report, sampleOutput: OUTPUT || null }, null, 2));
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});

