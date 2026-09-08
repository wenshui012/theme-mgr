const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-main.js'), 'utf8');

test('theme card ellipsis opens the editor directly while preserving click isolation', () => {
    const delegated = source.slice(source.indexOf('function bindGridDelegatedEvents'), source.indexOf('function renderGrid'));
    assert.match(delegated, /event\.preventDefault\(\)/);
    assert.match(delegated, /event\.stopPropagation\(\)/);
    assert.match(delegated, /openEditSheet\(menu\.dataset\.key\)/);
    assert.match(delegated, /var card = event\.target\.closest\('\.tm-card'\)/);
    assert.match(delegated, /applyManualTheme\(themeName/);
    assert.doesNotMatch(source, /function openContextMenu/);
});

test('theme editor keeps permanent fields before the three requested disclosure groups', () => {
    const editor = source.slice(source.indexOf('function openEditSheet'), source.indexOf('function mergeImportedAnnotations'));
    const title = editor.indexOf('编辑美化');
    const name = editor.indexOf('id="tm-edit-name"');
    const category = editor.indexOf('id="tm-edit-category-trigger"');
    const tags = editor.indexOf('id="tm-edit-tags-trigger"');
    const preview = editor.indexOf('id="tm-dimgarea"');
    const bindings = editor.indexOf("buildDisclosureHtml('tm-edit-binding-section'");
    const annotations = editor.indexOf("buildDisclosureHtml('tm-edit-annotation-section'");
    const operations = editor.indexOf("buildDisclosureHtml('tm-edit-operation-section'");
    assert.ok(title >= 0 && title < name);
    assert.ok(name < category && category < tags && tags < preview);
    assert.ok(preview < bindings && bindings < annotations && annotations < operations);
});

test('current binding actions stay inside the binding overview scope', () => {
    const overviewStart = source.indexOf('function openBindingsOverviewSheet');
    const editorStart = source.indexOf('function openEditSheet');
    const listener = source.indexOf("currentBody.addEventListener('click'", overviewStart);
    assert.ok(overviewStart >= 0 && listener > overviewStart && listener < editorStart);
});

test('day night editor keeps pair rename and pair management separate from ordinary delete', () => {
    const editor = source.slice(source.indexOf('function openEditSheet'), source.indexOf('function mergeImportedAnnotations'));
    assert.match(editor, /pairsApi\.renamePair\(dd, refreshedItem\.pairId, requestedName\)/);
    assert.match(editor, /id="tm-edit-manage-pair"/);
    assert.match(editor, /openDayNightDeleteSheet\(pair\.id\)/);
    assert.match(editor, /id="tm-edit-delete"/);
    assert.match(editor, /deleteThemeEverywhere\(deletingName/);
});

test('category and tag flows use sheets without theme-manager prompt dialogs', () => {
    assert.match(source, /function openCategoryPicker/);
    assert.match(source, /function openTagPicker/);
    assert.doesNotMatch(source, /\bprompt\s*\(/);
    const tagPicker = source.slice(source.indexOf('function openTagPicker'), source.indexOf('// ── 网格'));
    assert.doesNotMatch(tagPicker, /\.focus\s*\(/);
});

test('settings keep clear-all and reliable orphan cleanup as separate actions', () => {
    const settings = source.slice(source.indexOf('function openSettingsSheet'), source.indexOf('// ── 分类管理'));
    assert.match(settings, /id="tm-clear-orphan"/);
    assert.match(settings, /id="tm-clear-all-annotations"/);
    assert.match(settings, /fetchThemeList\(function \(\)/);
    assert.match(settings, /if \(!stThemeListReliable\)/);
    assert.match(settings, /metadataApi\.removeOrphanMetadata/);
});
