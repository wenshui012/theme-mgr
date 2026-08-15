(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    var SERIES_VERSION = 1;

    function isObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function createState() {
        return {
            version: SERIES_VERSION,
            groups: {},
        };
    }

    function normalizeTarget(target) {
        if (!isObject(target)) return null;
        if (target.kind === 'theme') {
            var themeName = String(target.themeName || '').trim();
            return themeName ? { kind: 'theme', themeName: themeName } : null;
        }
        if (target.kind === 'day-night') {
            var pairId = String(target.pairId || '').trim();
            return pairId ? { kind: 'day-night', pairId: pairId } : null;
        }
        return null;
    }

    function targetKey(target) {
        target = normalizeTarget(target);
        if (!target) return '';
        return target.kind === 'theme'
            ? 'theme:' + target.themeName
            : 'pair:' + target.pairId;
    }

    function targetsEqual(first, second) {
        return !!targetKey(first) && targetKey(first) === targetKey(second);
    }

    function normalizeMembers(members) {
        var seen = {};
        var result = [];
        (Array.isArray(members) ? members : []).forEach(function (member) {
            var target = normalizeTarget(member);
            var key = targetKey(target);
            if (!key || seen[key]) return;
            seen[key] = true;
            result.push(target);
        });
        return result;
    }

    function normalizeGroup(group, fallbackId) {
        if (!isObject(group)) return null;
        var id = String(group.id || fallbackId || '').trim();
        var name = String(group.name || '').trim();
        var members = normalizeMembers(group.members);
        if (!id || !name || members.length < 2) return null;
        return {
            id: id,
            name: name,
            category: typeof group.category === 'string' ? group.category : '',
            members: members,
        };
    }

    function buildUsableState(data) {
        var source = isObject(data) && isObject(data.series) ? data.series : createState();
        var groups = isObject(source.groups) ? source.groups : {};
        var normalized = {};
        var claimed = {};
        Object.keys(groups).forEach(function (key) {
            var group = normalizeGroup(groups[key], key);
            if (!group) return;
            var availableMembers = group.members.filter(function (target) {
                var memberKey = targetKey(target);
                return !!memberKey && !claimed[memberKey];
            });
            if (availableMembers.length < 2) return;
            group.members = availableMembers;
            group.members.forEach(function (target) { claimed[targetKey(target)] = group.id; });
            normalized[group.id] = group;
        });
        return { version: SERIES_VERSION, groups: normalized };
    }

    function ensureState(data) {
        return buildUsableState(data);
    }

    function ensureMutableState(data) {
        if (!isObject(data)) return createState();
        var state = buildUsableState(data);
        data.series = state;
        return state;
    }

    function inspectState(data) {
        var groups = isObject(data) && isObject(data.series) && isObject(data.series.groups)
            ? data.series.groups
            : {};
        var claimedTargets = {};
        var claimedIds = {};
        var diagnostics = [];
        Object.keys(groups).forEach(function (key) {
            var group = normalizeGroup(groups[key], key);
            if (!group) {
                diagnostics.push({ type: 'series', id: key, reason: 'invalid-record' });
                return;
            }
            if (claimedIds[group.id]) {
                diagnostics.push({ type: 'series', id: group.id, name: group.name, reason: 'duplicate-id', conflictsWith: claimedIds[group.id] });
                return;
            }
            var conflicts = group.members.map(targetKey).filter(function (keyName) { return !!claimedTargets[keyName]; });
            if (conflicts.length > 0) {
                diagnostics.push({
                    type: 'series',
                    id: group.id,
                    name: group.name,
                    reason: 'member-conflict',
                    members: conflicts,
                    conflictsWith: conflicts.map(function (keyName) { return claimedTargets[keyName]; }),
                });
                return;
            }
            claimedIds[group.id] = key;
            group.members.forEach(function (member) { claimedTargets[targetKey(member)] = group.id; });
        });
        return diagnostics;
    }

    function createSeriesId(state) {
        var id = '';
        try {
            if (global.crypto && typeof global.crypto.randomUUID === 'function') {
                id = 'series-' + global.crypto.randomUUID();
            }
        } catch (e) {}
        if (!id) id = 'series-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
        while (state.groups[id]) id += '-x';
        return id;
    }

    function getSeries(data, seriesId) {
        seriesId = String(seriesId || '').trim();
        return seriesId ? (ensureState(data).groups[seriesId] || null) : null;
    }

    function listSeries(data) {
        var state = ensureState(data);
        return Object.keys(state.groups).map(function (id) { return state.groups[id]; });
    }

    function findSeriesByTarget(data, targetInput) {
        return findSeriesByTargetInState(ensureState(data), targetInput);
    }

    function findSeriesByTargetInState(state, targetInput) {
        var key = targetKey(targetInput);
        if (!key) return null;
        var found = null;
        Object.keys(state.groups).some(function (id) {
            var group = state.groups[id];
            if (group.members.some(function (member) { return targetKey(member) === key; })) {
                found = group;
                return true;
            }
            return false;
        });
        return found;
    }

    function getMembershipMap(data) {
        var result = {};
        listSeries(data).forEach(function (group) {
            group.members.forEach(function (member) {
                result[targetKey(member)] = group.id;
            });
        });
        return result;
    }

    function createSeries(data, input) {
        input = input || {};
        var state = ensureState(data);
        var name = String(input.name || '').trim();
        var members = normalizeMembers(input.members);
        if (!name || members.length < 2) return { ok: false, reason: 'invalid' };
        var conflict = members.find(function (member) { return !!findSeriesByTargetInState(state, member); });
        if (conflict) return { ok: false, reason: 'already-series', target: conflict };
        var id = String(input.id || '').trim() || createSeriesId(state);
        if (state.groups[id]) return { ok: false, reason: 'duplicate-id' };
        var group = normalizeGroup({
            id: id,
            name: name,
            category: typeof input.category === 'string' ? input.category : '',
            members: members,
        }, id);
        if (!group) return { ok: false, reason: 'invalid' };
        state = ensureMutableState(data);
        state.groups[id] = group;
        return { ok: true, series: group };
    }

    function addMembers(data, seriesId, membersInput) {
        var state = ensureState(data);
        var group = state.groups[String(seriesId || '').trim()];
        if (!group) return { ok: false, reason: 'missing-series' };
        var additions = normalizeMembers(membersInput);
        var own = {};
        group.members.forEach(function (member) { own[targetKey(member)] = true; });
        for (var i = 0; i < additions.length; i++) {
            var existing = findSeriesByTargetInState(state, additions[i]);
            if (existing && existing.id !== group.id) {
                return { ok: false, reason: 'already-series', seriesId: existing.id, target: additions[i] };
            }
        }
        state = ensureMutableState(data);
        group = state.groups[String(seriesId || '').trim()];
        own = {};
        group.members.forEach(function (member) { own[targetKey(member)] = true; });
        var added = 0;
        additions.forEach(function (member) {
            var key = targetKey(member);
            if (!key || own[key]) return;
            own[key] = true;
            group.members.push(member);
            added += 1;
        });
        return { ok: true, added: added, series: group };
    }

    function renameSeries(data, seriesId, name) {
        name = String(name || '').trim();
        var group = getSeries(data, seriesId);
        if (!group || !name) return false;
        group = ensureMutableState(data).groups[String(seriesId || '').trim()];
        group.name = name;
        return true;
    }

    function setSeriesCategory(data, seriesId, category) {
        var group = getSeries(data, seriesId);
        if (!group) return false;
        group = ensureMutableState(data).groups[String(seriesId || '').trim()];
        group.category = typeof category === 'string' ? category : '';
        return true;
    }

    function dissolveSeries(data, seriesId) {
        seriesId = String(seriesId || '').trim();
        if (!seriesId || !ensureState(data).groups[seriesId]) return false;
        var state = ensureMutableState(data);
        delete state.groups[seriesId];
        return true;
    }

    function removeMember(data, seriesId, targetInput) {
        var state = ensureState(data);
        var group = state.groups[String(seriesId || '').trim()];
        var key = targetKey(targetInput);
        if (!group || !key) return { ok: false, reason: 'missing' };
        var before = group.members.length;
        var nextMembers = group.members.filter(function (member) { return targetKey(member) !== key; });
        if (nextMembers.length === before) return { ok: false, reason: 'missing' };
        state = ensureMutableState(data);
        group = state.groups[String(seriesId || '').trim()];
        group.members = nextMembers;
        if (group.members.length < 2) {
            delete state.groups[group.id];
            return { ok: true, removed: true, dissolved: true, seriesId: group.id };
        }
        return { ok: true, removed: true, dissolved: false, series: group };
    }

    function replaceTargets(data, oldTargetsInput, replacementsInput) {
        var state = ensureState(data);
        var oldKeys = {};
        normalizeMembers(oldTargetsInput).forEach(function (target) { oldKeys[targetKey(target)] = true; });
        var replacements = normalizeMembers(replacementsInput);
        var affected = [];
        Object.keys(state.groups).forEach(function (id) {
            if (state.groups[id].members.some(function (member) { return oldKeys[targetKey(member)]; })) affected.push(id);
        });
        if (affected.length > 1) return { ok: false, reason: 'multiple-series', seriesIds: affected };
        if (affected.length === 0) return { ok: true, changed: 0, dissolved: false };
        var group = state.groups[affected[0]];
        for (var i = 0; i < replacements.length; i++) {
            var owner = findSeriesByTargetInState(state, replacements[i]);
            if (owner && owner.id !== group.id) {
                return { ok: false, reason: 'replacement-in-series', seriesId: owner.id };
            }
        }
        state = ensureMutableState(data);
        group = state.groups[affected[0]];
        var next = [];
        var seen = {};
        var inserted = false;
        group.members.forEach(function (member) {
            var key = targetKey(member);
            if (oldKeys[key]) {
                if (!inserted) {
                    replacements.forEach(function (replacement) {
                        var replacementKey = targetKey(replacement);
                        if (!replacementKey || seen[replacementKey]) return;
                        seen[replacementKey] = true;
                        next.push(replacement);
                    });
                    inserted = true;
                }
                return;
            }
            if (seen[key]) return;
            seen[key] = true;
            next.push(member);
        });
        group.members = next;
        if (group.members.length < 2) {
            delete state.groups[group.id];
            return { ok: true, changed: 1, dissolved: true, seriesId: group.id };
        }
        return { ok: true, changed: 1, dissolved: false, series: group };
    }

    function mergeThemeTargetsIntoPair(data, themeNames, pairId) {
        var oldTargets = (themeNames || []).map(function (name) {
            return { kind: 'theme', themeName: name };
        });
        return replaceTargets(data, oldTargets, [{ kind: 'day-night', pairId: pairId }]);
    }

    function replacePairReference(data, pairId, replacementThemes) {
        replacementThemes = Array.isArray(replacementThemes)
            ? replacementThemes
            : (replacementThemes ? [replacementThemes] : []);
        return replaceTargets(
            data,
            [{ kind: 'day-night', pairId: pairId }],
            replacementThemes.map(function (name) { return { kind: 'theme', themeName: name }; })
        );
    }

    function renameThemeReferences(data, oldName, newName) {
        oldName = String(oldName || '').trim();
        newName = String(newName || '').trim();
        if (!oldName || !newName || oldName === newName) return 0;
        var changed = 0;
        var state = ensureState(data);
        Object.keys(state.groups).forEach(function (id) {
            var group = state.groups[id];
            group.members.forEach(function (member) {
                if (member.kind === 'theme' && member.themeName === oldName) {
                    member.themeName = newName;
                    changed += 1;
                }
            });
            group.members = normalizeMembers(group.members);
            if (group.members.length < 2) delete state.groups[id];
        });
        if (!changed) return 0;
        state = ensureMutableState(data);
        changed = 0;
        Object.keys(state.groups).forEach(function (id) {
            var group = state.groups[id];
            group.members.forEach(function (member) {
                if (member.kind === 'theme' && member.themeName === oldName) {
                    member.themeName = newName;
                    changed += 1;
                }
            });
            group.members = normalizeMembers(group.members);
            if (group.members.length < 2) delete state.groups[id];
        });
        return changed;
    }

    function removeThemeReferences(data, themeNames) {
        var removing = {};
        (Array.isArray(themeNames) ? themeNames : [themeNames]).forEach(function (name) {
            name = String(name || '').trim();
            if (name) removing[name] = true;
        });
        var state = ensureState(data);
        var affected = Object.keys(state.groups).some(function (id) {
            return state.groups[id].members.some(function (member) {
                return member.kind === 'theme' && !!removing[member.themeName];
            });
        });
        if (!affected) return 0;
        state = ensureMutableState(data);
        var removed = 0;
        Object.keys(state.groups).forEach(function (id) {
            var group = state.groups[id];
            group.members = group.members.filter(function (member) {
                if (member.kind !== 'theme' || !removing[member.themeName]) return true;
                removed += 1;
                return false;
            });
            if (group.members.length < 2) delete state.groups[id];
        });
        return removed;
    }

    function cleanSeriesForExport(group, members) {
        return {
            id: group.id,
            name: group.name,
            category: group.category || '',
            members: clone(members || group.members),
        };
    }

    function exportSeries(data, themeNames, pairIds) {
        var themes = {};
        var pairs = {};
        (themeNames || []).forEach(function (name) { themes[name] = true; });
        (pairIds || []).forEach(function (id) { pairs[id] = true; });
        return listSeries(data).map(function (group) {
            var complete = group.members.every(function (member) {
                return member.kind === 'theme' ? !!themes[member.themeName] : !!pairs[member.pairId];
            });
            return complete ? cleanSeriesForExport(group) : null;
        }).filter(Boolean);
    }

    function sameGroupContent(first, second) {
        if (!first || !second || first.name !== second.name || first.category !== second.category) return false;
        if (first.members.length !== second.members.length) return false;
        return first.members.every(function (member, index) {
            return targetsEqual(member, second.members[index]);
        });
    }

    function uniqueImportedName(state, name) {
        var used = {};
        Object.keys(state.groups).forEach(function (id) { used[state.groups[id].name] = true; });
        if (!used[name]) return name;
        var base = name + '（导入）';
        if (!used[base]) return base;
        var index = 2;
        while (used[base + index]) index += 1;
        return base + index;
    }

    function importSeries(data, rawGroups, options) {
        options = options || {};
        var availableThemes = {};
        var availablePairs = {};
        var skippedPairs = {};
        var pairedThemes = {};
        var requirePairIdMap = options.requirePairIdMap === true;
        var pairIdMap = isObject(options.pairIdMap) ? options.pairIdMap : {};
        (options.availableThemeNames || []).forEach(function (name) { availableThemes[name] = true; });
        (options.availablePairIds || []).forEach(function (id) { availablePairs[id] = true; });
        (options.skippedPairIds || []).forEach(function (id) { skippedPairs[id] = true; });
        var pairState = isObject(data) && isObject(data.dayNight) && isObject(data.dayNight.pairs)
            ? data.dayNight.pairs
            : {};
        Object.keys(pairState).forEach(function (id) {
            var pair = pairState[id];
            if (!isObject(pair)) return;
            if (pair.dayTheme) pairedThemes[pair.dayTheme] = true;
            if (pair.nightTheme) pairedThemes[pair.nightTheme] = true;
        });
        var list = Array.isArray(rawGroups)
            ? rawGroups
            : (isObject(rawGroups) ? Object.keys(rawGroups).map(function (id) {
                var raw = clone(rawGroups[id]);
                if (isObject(raw) && !raw.id) raw.id = id;
                return raw;
            }) : []);
        var state = ensureState(data);
        var imported = 0;
        var skipped = 0;
        var idMap = {};
        var diagnostics = [];
        list.forEach(function (raw) {
            state = ensureState(data);
            var source = normalizeGroup(raw, raw && raw.id);
            if (!source) {
                skipped += 1;
                diagnostics.push({ type: 'series', id: raw && raw.id ? String(raw.id) : '', reason: 'invalid-record' });
                return;
            }
            var mappedMembers = [];
            var rejectedMembers = [];
            source.members.forEach(function (member) {
                var target = member;
                if (member.kind === 'day-night') {
                    var mappedPairId = pairIdMap[member.pairId] ||
                        (!requirePairIdMap && !skippedPairs[member.pairId] && availablePairs[member.pairId] ? member.pairId : '');
                    target = mappedPairId ? { kind: 'day-night', pairId: mappedPairId } : null;
                    if (!target) rejectedMembers.push({ target: clone(member), reason: skippedPairs[member.pairId] ? 'pair-rejected' : 'missing-pair' });
                } else if (!availableThemes[member.themeName]) {
                    target = null;
                    rejectedMembers.push({ target: clone(member), reason: 'missing-theme' });
                } else if (pairedThemes[member.themeName]) {
                    target = null;
                    rejectedMembers.push({ target: clone(member), reason: 'theme-represented-by-pair' });
                }
                if (!target) {
                    return;
                }
                mappedMembers.push(target);
            });
            mappedMembers = normalizeMembers(mappedMembers);
            if (rejectedMembers.length > 0 || mappedMembers.length !== source.members.length) {
                skipped += 1;
                diagnostics.push({ type: 'series', id: source.id, name: source.name, category: source.category, reason: 'incomplete-members', members: rejectedMembers });
                return;
            }
            var normalized = normalizeGroup({
                id: source.id,
                name: source.name,
                category: source.category,
                members: mappedMembers,
            }, source.id);
            var existing = state.groups[source.id];
            if (existing && sameGroupContent(existing, normalized)) {
                idMap[source.id] = existing.id;
                skipped += 1;
                diagnostics.push({ type: 'series', id: source.id, name: source.name, reason: 'already-present', severity: 'info', mappedId: existing.id });
                return;
            }
            var conflicts = mappedMembers.map(function (target) {
                var owner = findSeriesByTargetInState(state, target);
                return owner ? { target: clone(target), seriesId: owner.id } : null;
            }).filter(Boolean);
            if (conflicts.length > 0) {
                skipped += 1;
                diagnostics.push({ type: 'series', id: source.id, name: source.name, category: source.category, reason: 'member-conflict', members: conflicts });
                return;
            }
            var requestedId = existing ? '' : source.id;
            var result = createSeries(data, {
                id: requestedId,
                name: uniqueImportedName(ensureState(data), source.name),
                category: source.category,
                members: mappedMembers,
            });
            if (!result.ok) {
                skipped += 1;
                diagnostics.push({ type: 'series', id: source.id, name: source.name, category: source.category, reason: result.reason || 'create-failed' });
                return;
            }
            imported += 1;
            idMap[source.id] = result.series.id;
        });
        return { imported: imported, skipped: skipped, idMap: idMap, diagnostics: diagnostics };
    }

    ns.themeSeries = {
        SERIES_VERSION: SERIES_VERSION,
        createState: createState,
        ensureState: ensureState,
        inspectState: inspectState,
        normalizeTarget: normalizeTarget,
        targetKey: targetKey,
        targetsEqual: targetsEqual,
        getSeries: getSeries,
        listSeries: listSeries,
        findSeriesByTarget: findSeriesByTarget,
        getMembershipMap: getMembershipMap,
        createSeries: createSeries,
        addMembers: addMembers,
        renameSeries: renameSeries,
        setSeriesCategory: setSeriesCategory,
        dissolveSeries: dissolveSeries,
        removeMember: removeMember,
        replaceTargets: replaceTargets,
        mergeThemeTargetsIntoPair: mergeThemeTargetsIntoPair,
        replacePairReference: replacePairReference,
        renameThemeReferences: renameThemeReferences,
        removeThemeReferences: removeThemeReferences,
        exportSeries: exportSeries,
        importSeries: importSeries,
    };
})(window);
