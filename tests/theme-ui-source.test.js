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

test('theme editor keeps the name permanent, moves annotations first and leaves preview last', () => {
    const editor = source.slice(source.indexOf('function openEditSheet'), source.indexOf('function mergeImportedAnnotations'));
    const markup = editor.slice(editor.indexOf('var sheet = createSheet'), editor.indexOf('function renderBackgroundBind'));
    const title = markup.indexOf('编辑美化');
    const name = markup.indexOf('id="tm-edit-name"');
    const annotations = markup.indexOf("buildDisclosureHtml('tm-edit-annotation-section', '标注信息'");
    const bindings = markup.indexOf("buildDisclosureHtml('tm-edit-binding-section'");
    const operations = markup.indexOf("buildDisclosureHtml('tm-edit-operation-section'");
    const preview = markup.indexOf('id="tm-dimgarea"');
    assert.ok(title >= 0 && title < name);
    assert.ok(name < annotations && annotations < bindings && bindings < operations && operations < preview);
    assert.match(editor, /var annotationFieldsHtml =[\s\S]*id="tm-edit-category-trigger"[\s\S]*id="tm-edit-tags-trigger"[\s\S]*id="tm-dauthor"[\s\S]*id="tm-ddesc"/);
    assert.match(markup, /sheet\.classList\.add\('tm-sheet-tall'\)/);
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

test('joining a theme series uses the searchable in-app choice picker', () => {
    const picker = source.slice(source.indexOf('function openChoicePicker'), source.indexOf('function openCategoryPicker'));
    const series = source.slice(source.indexOf('function openSeriesBatchSheet'), source.indexOf('function getSeriesMemberView'));
    assert.match(picker, /data-choice-picker-search/);
    assert.match(series, /openChoicePicker\(/);
    assert.match(series, /searchPlaceholder: '搜索系列…'/);
    assert.doesNotMatch(series, /<select id="tm-series-operation"/);
});

test('settings keep clear-all and reliable orphan cleanup as separate actions', () => {
    const settings = source.slice(source.indexOf('function openSettingsSheet'), source.indexOf('// ── 分类管理'));
    assert.match(settings, /id="tm-clear-orphan"/);
    assert.match(settings, /id="tm-clear-all-annotations"/);
    assert.match(settings, /fetchThemeList\(function \(\)/);
    assert.match(settings, /if \(!stThemeListReliable\)/);
    assert.match(settings, /metadataApi\.removeOrphanMetadata/);
});

test('settings use the tall sheet and expose version, credit and safe update controls', () => {
    const settings = source.slice(source.indexOf('function openSettingsSheet'), source.indexOf('// ── 分类管理'));
    assert.match(settings, /sheet\.classList\.add\('tm-sheet-tall', 'tm-settings-sheet'\)/);
    assert.match(settings, /美化管理 v/);
    assert.match(settings, /作者：温水/);
    assert.match(settings, /发布于毛毛雨美化群、旅程/);
    assert.match(settings, /id="tm-update-action"/);
    const confirmSheet = source.slice(source.indexOf('function openExtensionUpdateConfirmSheet'), source.indexOf('function dispatchPreparedNativeThemeChange'));
    assert.match(confirmSheet, /extensionUpdater\.update\(\)/);
    assert.match(confirmSheet, /global\.location\.reload\(\)/);
    assert.doesNotMatch(confirmSheet, /\bconfirm\s*\(/);
    assert.match(source, /class="tm-update-dot" hidden/);
});
