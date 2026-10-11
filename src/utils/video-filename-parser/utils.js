export function removeEmpty(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== null));
}
// What `new RegExp([a.source, b.source].join('|')).exec(title)` meant: the earliest match,
// ties going to the earlier pattern. Rebuilding from .source loses the named groups once
// React Native's Babel preset rewrites (?<name>...), so .groups came back undefined.
export function execFirst(title, exps) {
    let best = null;
    for (const exp of exps) {
        const match = exp.exec(title);
        if (match && (!best || match.index < best.index)) {
            best = match;
        }
    }
    return best;
}
