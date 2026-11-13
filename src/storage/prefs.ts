import { createMMKV, useMMKVString } from 'react-native-mmkv';

const prefs = createMMKV({ id: 'ui-prefs' });

/** A screen choice (view mode, sort, tab) that survives restarts; `fallback` until one is made. */
export function usePref<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
    const [value, setValue] = useMMKVString(key, prefs);
    return [(value as T | undefined) ?? fallback, setValue];
}
