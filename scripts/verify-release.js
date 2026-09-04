const fs = require('node:fs');
const path = require('node:path');
const {
    ROOT_DIR,
    DIST_ENTRY_PATH,
    DIST_MANIFEST_PATH,
    DIST_README_PATH,
    EXPECTED_MODULES,
    normalizeNewlines,
    sha256,
    parseDevelopmentEntry,
    readManifest,
    buildBundle,
} = require('./build-single-file.js');

function assert(condition, message) {
    if (!condition) throw new Error(`[release verify] ${message}`);
}

function read(relativePath) {
    return normalizeNewlines(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

function occurrences(source, needle) {
    let count = 0;
    let offset = 0;
    while ((offset = source.indexOf(needle, offset)) !== -1) {
        count += 1;
        offset += needle.length;
    }
    return count;
}

function verifyModuleMarkers(source) {
    let previousOffset = -1;
    EXPECTED_MODULES.forEach((modulePath, index) => {
        const marker = `/* BEGIN MODULE ${String(index + 1).padStart(2, '0')}/${EXPECTED_MODULES.length}: ${modulePath} | sha256:`;
        assert(occurrences(source, marker) === 1, `${modulePath} must appear exactly once`);
        const offset = source.indexOf(marker);
        assert(offset > previousOffset, `module order is wrong at ${modulePath}`);
        previousOffset = offset;
    });
}

function verifyNoDevelopmentLoader(source) {
    const forbidden = [
        [/document\.currentScript/, 'document.currentScript'],
        [/createElement\s*\(\s*['"]script['"]\s*\)/, "createElement('script')"],
        [/\bloadModule\s*\(/, 'loadModule(...)'],
        [/data-theme-mgr-module/, 'data-theme-mgr-module'],
        [/script\.src\s*=\s*baseUrl/, 'runtime src module request'],
    ];
    forbidden.forEach(([pattern, label]) => assert(!pattern.test(source), `generated bundle still contains ${label}`));
}

function verifyVersions(source, version) {
    const manifest = readManifest();
    const developmentEntry = parseDevelopmentEntry();
    const uiMain = read('src/ui-main.js');
    const readme = read('README.md');

    assert(manifest.version === version, 'manifest version differs from generated version');
    assert(manifest.display_name === `美化管理 v${version}`, 'manifest display_name is not version-aligned');
    assert(typeof manifest.description === 'string' && manifest.description.includes(`v${version}`), 'manifest description is not version-aligned');
    assert(developmentEntry.version === version, 'development index.js is not version-aligned');
    assert(new RegExp(`options\\.version\\s*\\|\\|\\s*['"]${version.replace(/\./g, '\\.')}['"]`).test(uiMain), 'src/ui-main.js fallback version is not aligned');
    assert(readme.includes(`### v${version}（当前版本）`), 'README current version heading is not aligned');
    assert(source.includes(`var TM_VERSION = ${JSON.stringify(version)};`), 'generated TM_VERSION is not aligned');
}

function main() {
    assert(fs.existsSync(DIST_ENTRY_PATH), 'dist/index.js is missing; run the build first');
    assert(fs.existsSync(DIST_MANIFEST_PATH), 'dist/manifest.json is missing; run the build first');
    assert(fs.existsSync(DIST_README_PATH), 'dist/README.md is missing; run the build first');
    const actual = normalizeNewlines(fs.readFileSync(DIST_ENTRY_PATH, 'utf8'));
    const expected = buildBundle();
    assert(actual === expected.source, 'dist/index.js differs from a fresh deterministic build');
    assert(normalizeNewlines(fs.readFileSync(DIST_MANIFEST_PATH, 'utf8')) === read('manifest.json'), 'dist/manifest.json differs from the source manifest');
    assert(normalizeNewlines(fs.readFileSync(DIST_README_PATH, 'utf8')) === read('README.md'), 'dist/README.md differs from the source README');
    assert(expected.modules.length === 24, `expected 24 modules, found ${expected.modules.length}`);

    verifyModuleMarkers(actual);
    verifyNoDevelopmentLoader(actual);
    verifyVersions(actual, expected.version);
    assert(actual.includes('global.ThemeMgrModules = global.ThemeMgrModules || {}'), 'ThemeMgrModules registration is missing');
    assert(actual.includes('ns.appShell = {'), 'app shell module registration is missing');
    assert(actual.includes('appShellApi.createAppShell'), 'app shell initialization is missing');
    assert(actual.includes('aria-haspopup="menu"'), 'compact page switcher menu semantics are missing');
    assert(actual.includes('buildPageMenuHtml'), 'compact page switcher menu builder is missing');
    assert(actual.includes('tm-head-title tm-head-title-switcher'), 'page switcher is not integrated into the header title');
    assert(!actual.includes('class="tm-page-switcher-button"'), 'independent compact navigation button remains');
    assert(!actual.includes('tm-version'), 'header version label remains in the release bundle');
    assert(!actual.includes('role="tablist"'), 'stale primary tablist semantics remain');
    assert(actual.includes('modules.createUiMain({ version: TM_VERSION, modules: modules }).start()'), 'single-file createUiMain startup is missing');

    console.log(`[release verify] PASS v${expected.version}`);
    console.log(`[release verify] modules=${expected.modules.length} bytes=${Buffer.byteLength(actual, 'utf8')} sha256:${sha256(actual)}`);
    console.log('[release verify] manifest.json and README.md copies match their sources');
    console.log('[release verify] no runtime src module loader remains');
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
}
