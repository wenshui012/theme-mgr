const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEV_ENTRY_PATH = path.join(ROOT_DIR, 'index.js');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');
const README_PATH = path.join(ROOT_DIR, 'README.md');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DIST_ENTRY_PATH = path.join(DIST_DIR, 'index.js');
const DIST_MANIFEST_PATH = path.join(DIST_DIR, 'manifest.json');
const DIST_README_PATH = path.join(DIST_DIR, 'README.md');

const EXPECTED_MODULES = [
    'src/theme-schema.js',
    'src/theme-api.js',
    'src/theme-runtime.js',
    'src/theme-transactions.js',
    'src/theme-transfer.js',
    'src/theme-metadata.js',
    'src/editor-draft.js',
    'src/theme-pairs.js',
    'src/theme-series.js',
    'src/theme-bindings.js',
    'src/theme-appearance.js',
    'src/storage.js',
    'src/image-tools.js',
    'src/image-loader.js',
    'src/avatar-storage.js',
    'src/avatar-image-tools.js',
    'src/avatar-runtime.js',
    'src/avatar-page.js',
    'src/app-shell.js',
    'src/styles.js',
    'src/backgrounds.js',
    'src/ui-sheets.js',
    'src/ui-events.js',
    'src/ui-main.js',
];

function fail(message) {
    throw new Error(`[single-file build] ${message}`);
}

function normalizeNewlines(value) {
    return String(value).replace(/\r\n?/g, '\n');
}

function readUtf8(filePath) {
    try {
        return normalizeNewlines(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        fail(`cannot read ${path.relative(ROOT_DIR, filePath)}: ${error.message}`);
    }
}

function sha256(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseDevelopmentEntry() {
    const source = readUtf8(DEV_ENTRY_PATH);
    const versionMatches = [...source.matchAll(/\bvar\s+TM_VERSION\s*=\s*['"]([^'"]+)['"]\s*;/g)];
    if (versionMatches.length !== 1) {
        fail(`development index.js must declare exactly one TM_VERSION; found ${versionMatches.length}`);
    }

    const filesMatch = source.match(/\bvar\s+files\s*=\s*\[([\s\S]*?)\]\s*;/);
    if (!filesMatch) fail('development index.js is missing its module files array');
    const modules = [...filesMatch[1].matchAll(/['"]([^'"]+\.js)['"]/g)].map((match) => match[1]);
    if (modules.length !== EXPECTED_MODULES.length) {
        fail(`development index.js must list ${EXPECTED_MODULES.length} modules; found ${modules.length}`);
    }
    if (new Set(modules).size !== modules.length) fail('development index.js contains duplicate modules');
    EXPECTED_MODULES.forEach((expected, index) => {
        if (modules[index] !== expected) {
            fail(`module order mismatch at ${index + 1}: expected ${expected}, found ${modules[index] || '<missing>'}`);
        }
    });

    return { source, version: versionMatches[0][1], modules };
}

function readManifest() {
    let manifest;
    try {
        manifest = JSON.parse(readUtf8(MANIFEST_PATH));
    } catch (error) {
        fail(`manifest.json is invalid: ${error.message}`);
    }
    if (!manifest || typeof manifest.version !== 'string' || !manifest.version.trim()) {
        fail('manifest.json is missing a version');
    }
    return manifest;
}

function readModule(modulePath) {
    if (!/^src\/[a-z0-9-]+\.js$/i.test(modulePath)) fail(`unsafe module path: ${modulePath}`);
    const absolutePath = path.resolve(ROOT_DIR, modulePath);
    const relativePath = path.relative(ROOT_DIR, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) fail(`module escapes repository: ${modulePath}`);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) fail(`module is missing: ${modulePath}`);

    const source = readUtf8(absolutePath).replace(/\s+$/, '') + '\n';
    if (!/\(function\s*\(global\)\s*\{/.test(source) || !/\}\)\(window\);\s*$/.test(source)) {
        fail(`module does not preserve the expected IIFE boundary: ${modulePath}`);
    }
    if (!/global\.ThemeMgrModules\s*=\s*global\.ThemeMgrModules\s*\|\|\s*\{\}/.test(source)) {
        fail(`module does not register through window.ThemeMgrModules: ${modulePath}`);
    }
    return source;
}

function makeStartup(version) {
    return [
        '/* Theme Manager single-file startup */',
        '(function () {',
        `    var TM_VERSION = ${JSON.stringify(version)};`,
        '',
        '    async function start() {',
        '        var modules = window.ThemeMgrModules || {};',
        "        if (typeof modules.createUiMain !== 'function') throw new Error('ui-main.js 未注册');",
        '        return modules.createUiMain({ version: TM_VERSION, modules: modules }).start();',
        '    }',
        '',
        '    start().catch(function (err) {',
        "        console.error('[美化管理] 初始化失败:', err);",
        '    });',
        '})();',
        '',
    ].join('\n');
}

function buildBundle() {
    const entry = parseDevelopmentEntry();
    const manifest = readManifest();
    if (entry.version !== manifest.version) {
        fail(`version mismatch: index.js=${entry.version}, manifest.json=${manifest.version}`);
    }

    const chunks = [
        `// GENERATED FILE - Theme Manager v${manifest.version} single-file release`,
        '// Generated by scripts/build-single-file.js. Do not edit this file by hand.',
        '',
    ];

    entry.modules.forEach((modulePath, index) => {
        const source = readModule(modulePath);
        chunks.push(`/* BEGIN MODULE ${String(index + 1).padStart(2, '0')}/${entry.modules.length}: ${modulePath} | sha256:${sha256(source)} */`);
        chunks.push(source.replace(/\n$/, ''));
        chunks.push(`/* END MODULE ${String(index + 1).padStart(2, '0')}/${entry.modules.length}: ${modulePath} */`);
        chunks.push('');
    });
    chunks.push(makeStartup(manifest.version).replace(/\n$/, ''));
    chunks.push('');

    return {
        source: chunks.join('\n'),
        version: manifest.version,
        modules: entry.modules.slice(),
    };
}

function writeBundle(result) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(DIST_ENTRY_PATH, result.source, 'utf8');
    fs.writeFileSync(DIST_MANIFEST_PATH, readUtf8(MANIFEST_PATH), 'utf8');
    fs.writeFileSync(DIST_README_PATH, readUtf8(README_PATH), 'utf8');
    return {
        outputPath: DIST_ENTRY_PATH,
        bytes: Buffer.byteLength(result.source, 'utf8'),
        hash: sha256(result.source),
    };
}

function main() {
    const result = buildBundle();
    const written = writeBundle(result);
    console.log(`[single-file build] v${result.version} ${result.modules.length} modules`);
    console.log(`[single-file build] ${path.relative(ROOT_DIR, written.outputPath)} ${written.bytes} bytes sha256:${written.hash}`);
    console.log('[single-file build] dist/manifest.json and dist/README.md synchronized');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

module.exports = {
    ROOT_DIR,
    DEV_ENTRY_PATH,
    MANIFEST_PATH,
    README_PATH,
    DIST_ENTRY_PATH,
    DIST_MANIFEST_PATH,
    DIST_README_PATH,
    EXPECTED_MODULES: EXPECTED_MODULES.slice(),
    normalizeNewlines,
    sha256,
    parseDevelopmentEntry,
    readManifest,
    buildBundle,
    writeBundle,
};
