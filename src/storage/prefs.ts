import { useCallback, useMemo } from 'react';
import { createMMKV, useMMKVString } from 'react-native-mmkv';

const prefs = createMMKV({ id: 'ui-prefs' });

/** A screen choice (view mode, sort, tab) that survives restarts; `fallback` until one is made. */
export function usePref<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
    const [value, setValue] = useMMKVString(key, prefs);
    return [(value as T | undefined) ?? fallback, setValue];
}

const EMPTY = new Set<string>();

/**
 * Local folders (MediaStore bucket ids) kept off Home. Hidden rather than shown, so a folder
 * that appears later shows up by itself. Ids of folders now gone are kept: a card or access
 * that comes back keeps its choice.
 */
export function useHiddenFolders(): [ReadonlySet<string>, (ids: string[], hidden: boolean) => void] {
    const [raw, setRaw] = useMMKVString('home.hiddenFolders', prefs);
    const hidden = useMemo(() => parseIds(raw), [raw]);
    // Read from storage, not this render: quick taps in a row each build on the last.
    const setHidden = useCallback((ids: string[], hide: boolean) => {
        setRaw(current => {
            const next = new Set(parseIds(current));
            for (const id of ids) { if (hide) { next.add(id); } else { next.delete(id); } }
            return next.size ? JSON.stringify([...next]) : undefined;
        });
    }, [setRaw]);
    return [hidden, setHidden];
}

function parseIds(raw: string | undefined): ReadonlySet<string> {
    if (!raw) { return EMPTY; }
    try {
        const ids = JSON.parse(raw);
        return Array.isArray(ids) ? new Set(ids.map(String)) : EMPTY;
    } catch {
        return EMPTY;
    }
}
