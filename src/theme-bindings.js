(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    var BINDING_VERSION = 2;

    function createState() {
        return {
            version: BINDING_VERSION,
            characters: {},
            chats: {},
            manualTheme: '',
            manualTarget: null,
        };
    }

    function isObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function makeThemeTarget(themeName) {
        themeName = String(themeName || '').trim();
        return themeName ? { kind: 'theme', themeName: themeName } : null;
    }

    function normalizeTarget(target) {
        if (typeof target === 'string') return makeThemeTarget(target);
        if (!isObject(target)) return null;
        if (target.kind === 'theme') return makeThemeTarget(target.themeName);
        if (target.kind === 'day-night') {
            var pairId = String(target.pairId || '').trim();
            return pairId ? { kind: 'day-night', pairId: pairId } : null;
        }
        return null;
    }

    function targetsEqual(a, b) {
        a = normalizeTarget(a);
        b = normalizeTarget(b);
        if (!a || !b || a.kind !== b.kind) return false;
        return a.kind === 'theme'
            ? a.themeName === b.themeName
            : a.pairId === b.pairId;
    }

    function normalizeRecord(record) {
        if (typeof record === 'string') {
            var stringTarget = makeThemeTarget(record);
            return stringTarget ? { label: '', target: stringTarget } : null;
        }
        if (!isObject(record)) return null;
        var target = normalizeTarget(record.target || record.themeName);
        if (!target) return null;
        return {
            label: typeof record.label === 'string' ? record.label : '',
            target: target,
        };
    }

    function normalizeMap(map) {
        var normalized = {};
        if (!isObject(map)) return normalized;
        Object.keys(map).forEach(function (key) {
            var cleanKey = String(key || '').trim();
            var record = normalizeRecord(map[key]);
            if (cleanKey && record) normalized[cleanKey] = record;
        });
        return normalized;
    }

    function ensureState(data) {
        if (!isObject(data)) return createState();
        var state = isObject(data.bindings) ? data.bindings : createState();
        state.version = BINDING_VERSION;
        state.characters = normalizeMap(state.characters);
        state.chats = normalizeMap(state.chats);
        state.manualTheme = typeof state.manualTheme === 'string' ? state.manualTheme.trim() : '';
        state.manualTarget = normalizeTarget(state.manualTarget) || makeThemeTarget(state.manualTheme);
        state.manualTheme = state.manualTarget && state.manualTarget.kind === 'theme'
            ? state.manualTarget.themeName
            : '';
        data.bindings = state;
        return state;
    }

    function getContextInfo(context) {
        context = context || {};
        var characters = Array.isArray(context.characters) ? context.characters : [];
        var groups = Array.isArray(context.groups) ? context.groups : [];
        var characterId = context.characterId;
        var character = characterId !== undefined && characterId !== null ? characters[characterId] : null;
        var characterKey = character && typeof character.avatar === 'string' ? character.avatar.trim() : '';
        var characterLabel = character && typeof character.name === 'string' ? character.name.trim() : '';
        var chatMetadata = isObject(context.chatMetadata) ? context.chatMetadata : {};
        var chatKey = typeof chatMetadata.integrity === 'string' ? chatMetadata.integrity.trim() : '';
        var chatId = '';
        try {
            chatId = typeof context.getCurrentChatId === 'function'
                ? String(context.getCurrentChatId() || '').trim()
                : String(context.chatId || '').trim();
        } catch (e) {
            chatId = String(context.chatId || '').trim();
        }
        var group = null;
        if (context.groupId !== undefined && context.groupId !== null) {
            group = groups.find(function (item) {
                return item && String(item.id) === String(context.groupId);
            }) || null;
        }
        var ownerLabel = group && group.name
            ? String(group.name)
            : (characterLabel || '当前聊天');
        var chatLabel = chatId ? (ownerLabel + ' · ' + chatId) : ownerLabel;

        return {
            characterKey: characterKey,
            characterLabel: characterLabel,
            chatKey: chatKey,
            chatId: chatId,
            chatLabel: chatLabel,
            isGroup: !!group,
        };
    }

    function getThemeName(record) {
        var target = getTarget(record);
        return target && target.kind === 'theme' ? target.themeName : '';
    }

    function getTarget(record) {
        if (isObject(record) && record.kind) return normalizeTarget(record);
        var normalized = normalizeRecord(record);
        return normalized ? normalized.target : null;
    }

    function resolve(data, context) {
        var state = ensureState(data);
        var info = getContextInfo(context);
        var chatRecord = info.chatKey ? state.chats[info.chatKey] : null;
        var characterRecord = !info.isGroup && info.characterKey ? state.characters[info.characterKey] : null;
        if (chatRecord) {
            return {
                scope: 'chat',
                themeName: getThemeName(chatRecord),
                target: getTarget(chatRecord),
                record: chatRecord,
                context: info,
            };
        }
        if (characterRecord) {
            return {
                scope: 'character',
                themeName: getThemeName(characterRecord),
                target: getTarget(characterRecord),
                record: characterRecord,
                context: info,
            };
        }
        return {
            scope: '',
            themeName: getThemeName(state.manualTarget),
            target: state.manualTarget,
            record: null,
            context: info,
        };
    }

    function setBinding(data, scope, context, targetInput) {
        var state = ensureState(data);
        var info = getContextInfo(context);
        var target = normalizeTarget(targetInput);
        if (!target) return { ok: false, reason: 'invalid-theme', context: info };

        if (scope === 'character') {
            if (info.isGroup || !info.characterKey) return { ok: false, reason: 'no-character', context: info };
            state.characters[info.characterKey] = {
                label: info.characterLabel,
                target: target,
            };
        } else if (scope === 'chat') {
            if (!info.chatKey || !info.chatId) return { ok: false, reason: 'no-chat', context: info };
            state.chats[info.chatKey] = {
                label: info.chatLabel,
                target: target,
            };
        } else {
            return { ok: false, reason: 'invalid-scope', context: info };
        }
        return { ok: true, scope: scope, themeName: getThemeName(target), target: target, context: info };
    }

    function clearBinding(data, scope, context) {
        var state = ensureState(data);
        var info = getContextInfo(context);
        var map;
        var key;
        if (scope === 'character') {
            map = state.characters;
            key = info.isGroup ? '' : info.characterKey;
        } else if (scope === 'chat') {
            map = state.chats;
            key = info.chatKey;
        } else {
            return { ok: false, reason: 'invalid-scope', context: info };
        }
        if (!key) return { ok: false, reason: scope === 'chat' ? 'no-chat' : 'no-character', context: info };
        var existed = !!map[key];
        delete map[key];
        return { ok: true, scope: scope, removed: existed, context: info };
    }

    function visitRecords(state, visitor) {
        ['characters', 'chats'].forEach(function (scope) {
            Object.keys(state[scope]).forEach(function (key) {
                visitor(state[scope][key], scope, key);
            });
        });
    }

    function renameThemeReferences(data, oldName, newName) {
        oldName = String(oldName || '').trim();
        newName = String(newName || '').trim();
        if (!oldName || !newName || oldName === newName) return 0;
        var state = ensureState(data);
        var changed = 0;
        if (state.manualTarget && state.manualTarget.kind === 'theme' && state.manualTarget.themeName === oldName) {
            state.manualTarget.themeName = newName;
            state.manualTheme = newName;
            changed += 1;
        }
        visitRecords(state, function (record) {
            if (record.target.kind === 'theme' && record.target.themeName === oldName) {
                record.target.themeName = newName;
                changed += 1;
            }
        });
        return changed;
    }

    function removeThemeReferences(data, themeName) {
        themeName = String(themeName || '').trim();
        if (!themeName) return 0;
        var state = ensureState(data);
        var changed = 0;
        if (state.manualTarget && state.manualTarget.kind === 'theme' && state.manualTarget.themeName === themeName) {
            state.manualTarget = null;
            state.manualTheme = '';
            changed += 1;
        }
        ['characters', 'chats'].forEach(function (scope) {
            Object.keys(state[scope]).forEach(function (key) {
                if (getThemeName(state[scope][key]) === themeName) {
                    delete state[scope][key];
                    changed += 1;
                }
            });
        });
        return changed;
    }

    function moveCharacterBinding(data, oldKey, newKey) {
        oldKey = String(oldKey || '').trim();
        newKey = String(newKey || '').trim();
        if (!oldKey || !newKey || oldKey === newKey) return false;
        var state = ensureState(data);
        if (!state.characters[oldKey]) return false;
        state.characters[newKey] = state.characters[oldKey];
        delete state.characters[oldKey];
        return true;
    }

    function removeCharacterBinding(data, characterKey) {
        characterKey = String(characterKey || '').trim();
        if (!characterKey) return false;
        var state = ensureState(data);
        if (!state.characters[characterKey]) return false;
        delete state.characters[characterKey];
        return true;
    }

    function countThemeReferences(data, themeName) {
        themeName = String(themeName || '').trim();
        if (!themeName) return 0;
        var state = ensureState(data);
        var count = 0;
        visitRecords(state, function (record) {
            if (record.target.kind === 'theme' && record.target.themeName === themeName) count += 1;
        });
        return count;
    }

    function listTargetReferences(data, targetInput) {
        var target = normalizeTarget(targetInput);
        var state = ensureState(data);
        var result = { characters: [], chats: [] };
        if (!target) return result;
        ['characters', 'chats'].forEach(function (scope) {
            Object.keys(state[scope]).forEach(function (key) {
                var record = state[scope][key];
                if (!targetsEqual(getTarget(record), target)) return;
                result[scope].push({
                    key: key,
                    label: record.label || key,
                });
            });
            result[scope].sort(function (a, b) {
                return a.label.localeCompare(b.label);
            });
        });
        return result;
    }

    function removeTargetReference(data, scope, key, targetInput) {
        var target = normalizeTarget(targetInput);
        key = String(key || '').trim();
        if (!target || !key) return false;
        var state = ensureState(data);
        var map = scope === 'character' || scope === 'characters'
            ? state.characters
            : (scope === 'chat' || scope === 'chats' ? state.chats : null);
        if (!map || !map[key] || !targetsEqual(getTarget(map[key]), target)) return false;
        delete map[key];
        return true;
    }

    function removeTargetReferences(data, targetInput) {
        var target = normalizeTarget(targetInput);
        if (!target) return 0;
        var state = ensureState(data);
        var removed = 0;
        ['characters', 'chats'].forEach(function (scope) {
            Object.keys(state[scope]).forEach(function (key) {
                if (!targetsEqual(getTarget(state[scope][key]), target)) return;
                delete state[scope][key];
                removed += 1;
            });
        });
        return removed;
    }

    function listThemeReferences(data, themeName) {
        return listTargetReferences(data, makeThemeTarget(themeName));
    }

    function replacePairReferences(data, pairId, replacementTheme) {
        pairId = String(pairId || '').trim();
        var replacement = makeThemeTarget(replacementTheme);
        if (!pairId) return 0;
        var state = ensureState(data);
        var changed = 0;
        function replaceTarget(owner, key) {
            var target = owner[key];
            if (!target || target.kind !== 'day-night' || target.pairId !== pairId) return;
            owner[key] = replacement;
            changed += 1;
        }
        replaceTarget(state, 'manualTarget');
        state.manualTheme = state.manualTarget && state.manualTarget.kind === 'theme'
            ? state.manualTarget.themeName
            : '';
        ['characters', 'chats'].forEach(function (scope) {
            Object.keys(state[scope]).forEach(function (key) {
                var record = state[scope][key];
                if (!record || !targetsEqual(record.target, { kind: 'day-night', pairId: pairId })) return;
                if (replacement) record.target = replacement;
                else delete state[scope][key];
                changed += 1;
            });
        });
        return changed;
    }

    function mergeThemeReferencesIntoPair(data, themeNames, pairId) {
        var names = {};
        (themeNames || []).forEach(function (name) {
            name = String(name || '').trim();
            if (name) names[name] = true;
        });
        pairId = String(pairId || '').trim();
        if (!pairId || Object.keys(names).length === 0) return 0;
        var target = { kind: 'day-night', pairId: pairId };
        var state = ensureState(data);
        var changed = 0;
        if (state.manualTarget && state.manualTarget.kind === 'theme' && names[state.manualTarget.themeName]) {
            state.manualTarget = target;
            state.manualTheme = '';
            changed += 1;
        }
        visitRecords(state, function (record) {
            if (record.target.kind === 'theme' && names[record.target.themeName]) {
                record.target = { kind: 'day-night', pairId: pairId };
                changed += 1;
            }
        });
        return changed;
    }

    function countBindings(data) {
        var state = ensureState(data);
        return Object.keys(state.characters).length + Object.keys(state.chats).length;
    }

    function createController(options) {
        options = options || {};
        var load = options.load;
        var save = options.save;
        var getContext = options.getContext;
        var getCurrentThemeName = options.getCurrentThemeName;
        var applyTheme = options.applyTheme;
        var cancelApply = options.cancelApply;
        var onApplied = options.onApplied;
        var onError = options.onError;
        var makeTargetForTheme = options.makeTargetForTheme;
        var resolveTargetTheme = options.resolveTargetTheme;
        var beforeAutomaticReconcile = options.beforeAutomaticReconcile;
        var started = false;
        var sequence = 0;
        var pendingThemes = {};
        var listeners = [];
        var characterSnapshots = {};
        var manualRuntimeInitialized = false;
        var manualIntentTarget = null;
        var verifiedManualTarget = null;
        var manualIntentSequence = 0;
        var pendingManualIntent = null;
        var manualIntentUnverified = false;

        function contextSafe() {
            try { return typeof getContext === 'function' ? (getContext() || {}) : {}; }
            catch (e) { return {}; }
        }

        function currentThemeSafe() {
            try { return String(getCurrentThemeName() || '').trim(); }
            catch (e) { return ''; }
        }

        function incrementPending(themeName) {
            pendingThemes[themeName] = (pendingThemes[themeName] || 0) + 1;
        }

        function decrementPending(themeName) {
            if (!pendingThemes[themeName]) return;
            pendingThemes[themeName] -= 1;
            if (pendingThemes[themeName] <= 0) delete pendingThemes[themeName];
        }

        function hasPending() {
            return Object.keys(pendingThemes).length > 0;
        }

        function isAutomatedThemeChange(themeName) {
            themeName = String(themeName || '').trim();
            return !!(themeName && pendingThemes[themeName]);
        }

        function targetForTheme(themeName) {
            var target = null;
            try {
                if (typeof makeTargetForTheme === 'function') target = makeTargetForTheme(themeName);
            } catch (e) {}
            return normalizeTarget(target) || makeThemeTarget(themeName);
        }

        function ensureManualRuntime(data) {
            var state = ensureState(data);
            if (!manualRuntimeInitialized) {
                verifiedManualTarget = normalizeTarget(state.manualTarget);
                manualIntentTarget = normalizeTarget(state.manualTarget);
                manualRuntimeInitialized = true;
            } else if (!pendingManualIntent && !manualIntentUnverified &&
                !targetsEqual(verifiedManualTarget, state.manualTarget)) {
                verifiedManualTarget = normalizeTarget(state.manualTarget);
                manualIntentTarget = normalizeTarget(state.manualTarget);
            }
            return state;
        }

        function writeManualTarget(state, target) {
            target = normalizeTarget(target);
            var changed = !targetsEqual(state.manualTarget, target);
            state.manualTarget = target;
            state.manualTheme = target && target.kind === 'theme' ? target.themeName : '';
            return changed;
        }

        function commitManualTarget(data, target) {
            var state = ensureManualRuntime(data);
            target = normalizeTarget(target);
            var changed = writeManualTarget(state, target);
            verifiedManualTarget = normalizeTarget(target);
            manualIntentTarget = normalizeTarget(target);
            manualIntentUnverified = false;
            if (changed) save(data);
            return changed;
        }

        function themeForResolution(data, resolution) {
            var themeName = '';
            try {
                if (typeof resolveTargetTheme === 'function') {
                    themeName = String(resolveTargetTheme(resolution.target, resolution, data) || '').trim();
                }
            } catch (e) {}
            return themeName || getThemeName(resolution.target);
        }

        function resolveCurrent(data, context) {
            ensureManualRuntime(data);
            var resolution = resolve(data, context);
            if (!resolution.scope) {
                resolution.target = normalizeTarget(manualIntentTarget);
                resolution.record = null;
            }
            resolution.themeName = themeForResolution(data, resolution);
            return resolution;
        }

        function beginManualIntent(themeName) {
            themeName = String(themeName || '').trim();
            if (!themeName) return null;
            var data = load();
            ensureManualRuntime(data);
            var target = targetForTheme(themeName);
            if (!target) return null;
            manualIntentSequence += 1;
            sequence += 1;
            manualIntentTarget = normalizeTarget(target);
            manualIntentUnverified = true;
            pendingManualIntent = {
                id: manualIntentSequence,
                target: normalizeTarget(target),
                themeName: themeName,
            };
            return {
                id: pendingManualIntent.id,
                target: normalizeTarget(pendingManualIntent.target),
                themeName: pendingManualIntent.themeName,
            };
        }

        function finishManualIntent(token, ok, reason) {
            if (!token || !pendingManualIntent || token.id !== manualIntentSequence ||
                token.id !== pendingManualIntent.id) return false;
            var completedTarget = normalizeTarget(pendingManualIntent.target);
            pendingManualIntent = null;
            if (ok) {
                commitManualTarget(load(), completedTarget);
                return true;
            }
            if (reason === 'superseded') {
                // A binding or a newer runtime apply may temporarily win, but the
                // user's latest manual choice remains the fallback intent.
                manualIntentUnverified = true;
                return false;
            }
            manualIntentTarget = normalizeTarget(verifiedManualTarget);
            manualIntentUnverified = false;
            return false;
        }

        function recordManualTheme(themeName) {
            themeName = String(themeName || '').trim();
            if (!themeName || isAutomatedThemeChange(themeName)) return false;
            var data = load();
            var state = ensureManualRuntime(data);
            var target = targetForTheme(themeName);
            var runtimeChanged = !!pendingManualIntent || !targetsEqual(manualIntentTarget, target);
            var persistedChanged = !targetsEqual(state.manualTarget, target);
            if (!runtimeChanged && !persistedChanged) return false;
            manualIntentSequence += 1;
            sequence += 1;
            pendingManualIntent = null;
            manualIntentTarget = normalizeTarget(target);
            verifiedManualTarget = normalizeTarget(target);
            manualIntentUnverified = false;
            persistedChanged = writeManualTarget(state, target);
            if (persistedChanged) save(data);
            return runtimeChanged || persistedChanged;
        }

        function cancelPendingIfIdleTarget(targetTheme) {
            if (!hasPending() || typeof cancelApply !== 'function') return;
            var pendingNames = Object.keys(pendingThemes);
            if (targetTheme && pendingNames.length === 1 && pendingNames[0] === targetTheme) return;
            cancelApply();
        }

        function reconcile(callback) {
            var requestSequence = ++sequence;
            var context = contextSafe();
            var data = load();
            var resolution = resolveCurrent(data, context);
            var targetTheme = resolution.themeName;
            var currentTheme = currentThemeSafe();

            if (!resolution.scope && pendingManualIntent &&
                targetsEqual(resolution.target, pendingManualIntent.target) &&
                targetTheme === pendingManualIntent.themeName) {
                if (callback) callback(true, {
                    changed: false,
                    pendingIntent: true,
                    resolution: resolution,
                    themeName: targetTheme,
                });
                return;
            }

            if (!targetTheme || targetTheme === currentTheme) {
                cancelPendingIfIdleTarget(targetTheme);
                if (callback) callback(true, {
                    changed: false,
                    resolution: resolution,
                    themeName: targetTheme,
                });
                return;
            }

            if (typeof applyTheme !== 'function') {
                if (callback) callback(false, { reason: 'apply-unavailable', resolution: resolution });
                return;
            }

            incrementPending(targetTheme);
            applyTheme(targetTheme, function (ok, reason) {
                decrementPending(targetTheme);
                if (requestSequence !== sequence) {
                    if (callback) callback(false, { reason: 'superseded', resolution: resolution });
                    return;
                }
                if (ok) {
                    if (!resolution.scope && manualIntentUnverified &&
                        targetsEqual(resolution.target, manualIntentTarget)) {
                        commitManualTarget(data, manualIntentTarget);
                    }
                    if (typeof onApplied === 'function') onApplied(resolution);
                    if (callback) callback(true, {
                        changed: true,
                        resolution: resolution,
                        themeName: targetTheme,
                    });
                    return;
                }
                if (reason !== 'superseded' && typeof onError === 'function') {
                    onError(targetTheme, reason || 'apply-failed', resolution);
                }
                if (callback) callback(false, {
                    reason: reason || 'apply-failed',
                    resolution: resolution,
                    themeName: targetTheme,
                });
            });
        }

        function bindCurrent(scope, targetInput, callback) {
            var data = load();
            var state = ensureState(data);
            var currentTheme = currentThemeSafe();
            if (!state.manualTarget && currentTheme) {
                state.manualTarget = targetForTheme(currentTheme);
                state.manualTheme = state.manualTarget && state.manualTarget.kind === 'theme'
                    ? state.manualTarget.themeName
                    : '';
            }
            var result = setBinding(data, scope, contextSafe(), targetInput);
            if (!result.ok) {
                if (callback) callback(false, result);
                return result;
            }
            save(data);
            reconcile(function (ok, outcome) {
                if (callback) callback(ok, outcome);
            });
            return result;
        }

        function unbindCurrent(scope, callback) {
            var data = load();
            var result = clearBinding(data, scope, contextSafe());
            if (!result.ok) {
                if (callback) callback(false, result);
                return result;
            }
            if (result.removed) save(data);
            reconcile(function (ok, outcome) {
                if (callback) callback(ok, outcome);
            });
            return result;
        }

        function getCurrentState() {
            var data = load();
            var state = ensureManualRuntime(data);
            var context = contextSafe();
            var info = getContextInfo(context);
            var currentManualTarget = normalizeTarget(manualIntentTarget);
            return {
                context: info,
                character: !info.isGroup && info.characterKey ? (state.characters[info.characterKey] || null) : null,
                chat: info.chatKey ? (state.chats[info.chatKey] || null) : null,
                resolution: resolveCurrent(data, context),
                manualTheme: currentManualTarget && currentManualTarget.kind === 'theme'
                    ? currentManualTarget.themeName
                    : '',
                manualTarget: currentManualTarget,
                verifiedManualTarget: normalizeTarget(verifiedManualTarget),
                pendingManualIntent: pendingManualIntent ? {
                    id: pendingManualIntent.id,
                    themeName: pendingManualIntent.themeName,
                    target: normalizeTarget(pendingManualIntent.target),
                } : null,
            };
        }

        function addListener(source, eventName, handler) {
            if (!source || !eventName || typeof source.on !== 'function') return;
            source.on(eventName, handler);
            listeners.push({ source: source, eventName: eventName, handler: handler });
        }

        function captureCharacterSnapshots(context) {
            context = context || contextSafe();
            var characters = Array.isArray(context.characters) ? context.characters : [];
            var next = {};
            characters.forEach(function (character, index) {
                if (!character || typeof character.avatar !== 'string' || !character.avatar.trim()) return;
                next[String(index)] = {
                    avatar: character.avatar.trim(),
                    name: typeof character.name === 'string' ? character.name.trim() : '',
                };
            });
            characterSnapshots = next;
        }

        function refreshCharacterBindingLabel(data, avatar, name) {
            avatar = String(avatar || '').trim();
            name = String(name || '').trim();
            if (!avatar || !name) return false;
            var state = ensureState(data);
            var record = state.characters[avatar];
            if (!record || record.label === name) return false;
            record.label = name;
            return true;
        }

        function refreshCurrentBindingLabels(context) {
            context = context || contextSafe();
            var info = getContextInfo(context);
            var data = load();
            var state = ensureState(data);
            var changed = false;
            if (!info.isGroup && info.characterKey && state.characters[info.characterKey] &&
                info.characterLabel && state.characters[info.characterKey].label !== info.characterLabel) {
                state.characters[info.characterKey].label = info.characterLabel;
                changed = true;
            }
            if (info.chatKey && state.chats[info.chatKey] &&
                info.chatLabel && state.chats[info.chatKey].label !== info.chatLabel) {
                state.chats[info.chatKey].label = info.chatLabel;
                changed = true;
            }
            if (changed) save(data);
        }

        function handleCharacterRenamed(oldAvatar, newAvatar) {
            var data = load();
            var changed = moveCharacterBinding(data, oldAvatar, newAvatar);
            var context = contextSafe();
            var characters = Array.isArray(context.characters) ? context.characters : [];
            var renamed = characters.find(function (character) {
                return character && character.avatar === newAvatar;
            });
            if (renamed && refreshCharacterBindingLabel(data, newAvatar, renamed.name)) changed = true;
            if (changed) save(data);
            captureCharacterSnapshots(context);
        }

        function handleCharacterEdited(event) {
            var detail = event && event.detail ? event.detail : (event || {});
            var id = detail.id;
            var character = detail.character;
            if (!character && id !== undefined && id !== null) {
                var context = contextSafe();
                character = Array.isArray(context.characters) ? context.characters[id] : null;
            }
            if (!character || typeof character.avatar !== 'string') {
                captureCharacterSnapshots();
                return;
            }

            var newAvatar = character.avatar.trim();
            var newName = typeof character.name === 'string' ? character.name.trim() : '';
            var previous = id !== undefined && id !== null ? characterSnapshots[String(id)] : null;
            var data = load();
            var state = ensureState(data);
            var changed = false;

            // Avatar filenames are the stable persisted key between sessions, but
            // SillyTavern may replace that filename when a new portrait is saved.
            // Migrate only from this controller's pre-edit snapshot; never guess
            // from a display name after a restart because duplicate names exist.
            if (previous && previous.avatar && previous.avatar !== newAvatar) {
                var previousRecord = state.characters[previous.avatar];
                var labelMatches = previousRecord && (
                    !previousRecord.label ||
                    previousRecord.label === previous.name ||
                    previousRecord.label === newName
                );
                if (labelMatches && !state.characters[newAvatar]) {
                    changed = moveCharacterBinding(data, previous.avatar, newAvatar);
                }
            }
            if (refreshCharacterBindingLabel(data, newAvatar, newName)) changed = true;
            if (changed) save(data);
            captureCharacterSnapshots();
        }

        function handleCharacterDeleted(event) {
            var character = event && event.character ? event.character : event;
            var avatar = character && character.avatar;
            var data = load();
            if (removeCharacterBinding(data, avatar)) save(data);
            captureCharacterSnapshots();
        }

        function start() {
            if (started) return;
            started = true;
            var context = contextSafe();
            var events = context.eventSource;
            var types = context.eventTypes || {};
            addListener(events, types.CHAT_CHANGED, function () {
                if (typeof beforeAutomaticReconcile === 'function') beforeAutomaticReconcile('chat-changed');
                refreshCurrentBindingLabels();
                reconcile();
            });
            addListener(events, types.CHAT_LOADED, function () {
                if (typeof beforeAutomaticReconcile === 'function') beforeAutomaticReconcile('chat-loaded');
                refreshCurrentBindingLabels();
                reconcile();
            });
            addListener(events, types.CHARACTER_RENAMED, handleCharacterRenamed);
            addListener(events, types.CHARACTER_EDITED, handleCharacterEdited);
            addListener(events, types.CHARACTER_DELETED, handleCharacterDeleted);
            addListener(events, types.CHARACTER_PAGE_LOADED, function () { captureCharacterSnapshots(); });
            captureCharacterSnapshots(context);
            refreshCurrentBindingLabels(context);

            var data = load();
            ensureManualRuntime(data);
            var initial = resolveCurrent(data, context);
            var currentTheme = currentThemeSafe();
            var state = ensureState(data);
            var shouldCaptureCurrent = currentTheme && (
                !initial.scope ||
                (!state.manualTarget && currentTheme !== initial.themeName)
            );
            if (shouldCaptureCurrent && !targetsEqual(state.manualTarget, targetForTheme(currentTheme))) {
                commitManualTarget(data, targetForTheme(currentTheme));
            }
            reconcile();
        }

        function stop() {
            listeners.forEach(function (item) {
                if (item.source && typeof item.source.removeListener === 'function') {
                    item.source.removeListener(item.eventName, item.handler);
                }
            });
            listeners = [];
            started = false;
            sequence += 1;
            cancelPendingIfIdleTarget('');
        }

        return {
            start: start,
            stop: stop,
            reconcile: reconcile,
            bindCurrent: bindCurrent,
            unbindCurrent: unbindCurrent,
            getCurrentState: getCurrentState,
            recordManualTheme: recordManualTheme,
            beginManualIntent: beginManualIntent,
            finishManualIntent: finishManualIntent,
            isAutomatedThemeChange: isAutomatedThemeChange,
        };
    }

    ns.themeBindings = {
        BINDING_VERSION: BINDING_VERSION,
        createState: createState,
        ensureState: ensureState,
        makeThemeTarget: makeThemeTarget,
        normalizeTarget: normalizeTarget,
        targetsEqual: targetsEqual,
        getContextInfo: getContextInfo,
        getThemeName: getThemeName,
        getTarget: getTarget,
        resolve: resolve,
        setBinding: setBinding,
        clearBinding: clearBinding,
        renameThemeReferences: renameThemeReferences,
        removeThemeReferences: removeThemeReferences,
        moveCharacterBinding: moveCharacterBinding,
        removeCharacterBinding: removeCharacterBinding,
        countThemeReferences: countThemeReferences,
        listThemeReferences: listThemeReferences,
        listTargetReferences: listTargetReferences,
        removeTargetReference: removeTargetReference,
        removeTargetReferences: removeTargetReferences,
        replacePairReferences: replacePairReferences,
        mergeThemeReferencesIntoPair: mergeThemeReferencesIntoPair,
        countBindings: countBindings,
        createController: createController,
    };
})(window);
