const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const build = require('../scripts/build-single-file.js');

test('development loader exposes the fixed 18-module release order', () => {
    const entry = build.parseDevelopmentEntry();
    assert.equal(entry.modules.length, 18);
    assert.deepEqual(entry.modules, build.EXPECTED_MODULES);
});

test('single-file build is deterministic and contains every module once in order', () => {
    const first = build.buildBundle();
    const second = build.buildBundle();
    assert.equal(first.source, second.source);
    assert.equal(build.sha256(first.source), build.sha256(second.source));

    let previousOffset = -1;
    first.modules.forEach((modulePath, index) => {
        const marker = `/* BEGIN MODULE ${String(index + 1).padStart(2, '0')}/${first.modules.length}: ${modulePath} | sha256:`;
        const offset = first.source.indexOf(marker);
        assert.ok(offset > previousOffset, modulePath);
        assert.equal(first.source.indexOf(marker, offset + marker.length), -1, modulePath);
        previousOffset = offset;
    });
});

test('generated release entry has direct startup and no development module loader', () => {
    const bundle = build.buildBundle();
    assert.match(bundle.source, /modules\.createUiMain\(\{ version: TM_VERSION, modules: modules \}\)\.start\(\)/);
    assert.match(bundle.source, /global\.ThemeMgrModules = global\.ThemeMgrModules \|\| \{\}/);
    assert.doesNotMatch(bundle.source, /document\.currentScript/);
    assert.doesNotMatch(bundle.source, /createElement\s*\(\s*['"]script['"]\s*\)/);
    assert.doesNotMatch(bundle.source, /\bloadModule\s*\(/);
});

test('checked-in dist entry exactly matches a fresh build', () => {
    const actual = build.normalizeNewlines(fs.readFileSync(build.DIST_ENTRY_PATH, 'utf8'));
    assert.equal(actual, build.buildBundle().source);
});
