(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function stableValue(value) {
        if (Array.isArray(value)) return value.map(stableValue);
        if (!value || typeof value !== 'object') return value;
        var out = Object.create(null);
        Object.keys(value).sort().forEach(function (key) {
            if (value[key] !== undefined) out[key] = stableValue(value[key]);
        });
        return out;
    }

    function fingerprint(value) {
        return JSON.stringify(stableValue(value));
    }

    function createSession(initialSnapshot) {
        var baseline = clone(initialSnapshot);
        var baselineFingerprint = fingerprint(baseline);
        var generation = 0;
        var savingToken = 0;
        var closed = false;

        function isDirty(snapshot) {
            return fingerprint(snapshot) !== baselineFingerprint;
        }

        function beginSave(snapshot) {
            if (closed || savingToken) return null;
            generation += 1;
            savingToken = generation;
            return { token: savingToken, snapshot: clone(snapshot) };
        }

        function isCurrent(token) {
            return !closed && !!savingToken && savingToken === token;
        }

        function completeSave(token, snapshot) {
            if (!isCurrent(token)) return false;
            baseline = clone(snapshot);
            baselineFingerprint = fingerprint(baseline);
            savingToken = 0;
            return true;
        }

        function failSave(token) {
            if (!isCurrent(token)) return false;
            savingToken = 0;
            return true;
        }

        function invalidate() {
            generation += 1;
            savingToken = 0;
            closed = true;
        }

        return {
            getBaseline: function () { return clone(baseline); },
            isDirty: isDirty,
            isActive: function () { return !closed; },
            isSaving: function () { return !!savingToken; },
            beginSave: beginSave,
            isCurrent: isCurrent,
            completeSave: completeSave,
            failSave: failSave,
            invalidate: invalidate,
        };
    }

    ns.editorDraft = {
        fingerprint: fingerprint,
        createSession: createSession,
    };
})(window);
