import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function resolveRepoPath(...segments) {
    return path.resolve(ROOT_DIR, ...segments);
}

export function normalizeRealm(value) {
    if (Array.isArray(value)) {
        const arr = Array.from(value, normalizeRealm);
        return Object.isFrozen(value) ? Object.freeze(arr) : arr;
    }
    if (value && typeof value === 'object' && value.constructor?.name === 'Object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = normalizeRealm(v);
        }
        return Object.isFrozen(value) ? Object.freeze(out) : out;
    }
    return value;
}

function wrapExport(target) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
        return target;
    }
    if (typeof target === 'function') {
        return target;
    }
    if (Object.isFrozen(target)) {
        return normalizeRealm(target);
    }
    return new Proxy(target, {
        get(obj, prop, receiver) {
            const val = Reflect.get(obj, prop, receiver);
            if (typeof val === 'function') {
                return function (...args) {
                    const res = Reflect.apply(val, this === receiver ? obj : this, args);
                    if (res && typeof res.then === 'function') {
                        return res.then(normalizeRealm);
                    }
                    return normalizeRealm(res);
                };
            }
            return normalizeRealm(val);
        },
    });
}

export function loadScripts(relativePaths, { globals = {}, exportNames = [] } = {}) {
    const paths = Array.isArray(relativePaths) ? relativePaths : [relativePaths];
    const sandbox = {
        console,
        URL,
        URLSearchParams,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Object,
        Array,
        String,
        Number,
        Boolean,
        RegExp,
        Date,
        Math,
        JSON,
        Promise,
        Error,
        TypeError,
        RangeError,
        SyntaxError,
        Reflect,
        Uint8Array,
        ArrayBuffer,
        structuredClone,
        setTimeout,
        clearTimeout,
        ...globals,
    };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);

    for (const relPath of paths) {
        const fullPath = resolveRepoPath(relPath);
        const code = fs.readFileSync(fullPath, 'utf8');
        vm.runInContext(code, context, { filename: relPath });
    }

    const exported = {};
    for (const name of exportNames) {
        let raw;
        try {
            raw = vm.runInContext(
                `typeof ${name} !== 'undefined' ? ${name} : globalThis[${JSON.stringify(name)}]`,
                context
            );
        } catch {
            raw = sandbox[name];
        }
        exported[name] = wrapExport(raw);
    }

    return { context, sandbox, exported };
}

export function loadScript(relativePath, options = {}) {
    return loadScripts([relativePath], options);
}
