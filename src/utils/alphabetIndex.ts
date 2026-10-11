/** The A–Z strip's letter for a string: its first letter without accents, or '#'. */
export function indexLetter(text: string): string {
    const first = text.trim().normalize('NFD').charAt(0).toUpperCase();
    return first >= 'A' && first <= 'Z' ? first : '#';
}

/**
 * Where the A–Z strip jumps for `letter` in a list sorted by `keyOf`: the first item at or
 * after that letter, so a letter with no entries lands on the next one instead of doing nothing.
 */
export function letterJumpIndex<T>(items: T[], letter: string, keyOf: (item: T) => string): number {
    if (items.length === 0) return -1;
    const i = items.findIndex((item) => indexLetter(keyOf(item)) >= letter);
    return i >= 0 ? i : items.length - 1;
}
