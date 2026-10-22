import { expect, test } from '@jest/globals';
import { readableOn, darkColors, lightColors } from '../src/theme/colors';

const lum = (h: string) => [1, 3, 5].reduce((s, i, k) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return s + [0.2126, 0.7152, 0.0722][k] * (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
}, 0);
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('dark cover colour is lightened until it reads on the dark card', () => {
    const out = readableOn('#2D4A52', darkColors.cardElevated);
    expect(ratio(out, darkColors.cardElevated)).toBeGreaterThanOrEqual(4.5);
    expect(lum(out)).toBeGreaterThan(lum('#2D4A52'));
});

test('pale cover colour is darkened on a light background', () => {
    expect(ratio(readableOn('#E0F0F0', lightColors.background), lightColors.background)).toBeGreaterThanOrEqual(4.5);
});

test('already readable colours and non-hex input pass through', () => {
    expect(readableOn('#FFD54F', '#000000')).toBe('#FFD54F');
    expect(readableOn('red', '#000000')).toBe('red');
});
