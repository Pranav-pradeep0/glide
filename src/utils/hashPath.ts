/** A short, file-name-safe hash of a path (32-bit, base 36). Not unique: store the path alongside if a collision would matter. */
export function hashPath(path: string): string {
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
        // eslint-disable-next-line no-bitwise
        hash = (hash << 5) - hash + path.charCodeAt(i);
        // eslint-disable-next-line no-bitwise
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
