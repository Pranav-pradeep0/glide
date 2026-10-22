// src/theme/colors.ts
//
// The accent (`primary`) is white on dark, near-black on light. It is used only for
// progress, the selected state and the one main action per screen. Raised surfaces are
// lighter steps of the background, not shadows.

export const lightColors = {
    /** The accent. */
    primary: '#111113',
    /** Text and icons on a `primary` fill. */
    onPrimary: '#FFFFFF',
    /** Accent tint behind a selected nav item or an update card. */
    primaryContainer: 'rgba(0, 0, 0, 0.08)',
    secondary: '#3A3A40',
    background: '#F6F6F8',
    /** Surface 1: rows, nav bar, setting groups. */
    surface: '#FFFFFF',
    /** Surface 3: raised placeholders, thumbnails before load. */
    surfaceVariant: '#E8E8EC',
    /** Translucent fill for tonal buttons, chips, fields. */
    fill: 'rgba(0, 0, 0, 0.05)',
    fillStrong: 'rgba(0, 0, 0, 0.09)',
    /** Pressed state layer. */
    pressed: 'rgba(0, 0, 0, 0.08)',
    text: '#111113',
    textSecondary: '#5E5E66',
    textTertiary: '#8E8E96',
    border: 'rgba(0, 0, 0, 0.08)',
    error: '#D93B3B',
    success: '#1F9D6A',
    warning: '#C98A12',
    card: '#FFFFFF',
    /** Surface 2: sheets, dialogs, search field. */
    cardElevated: '#FFFFFF',
    scrim: 'rgba(0, 0, 0, 0.32)',
    shadow: '#000000',
};

export const darkColors: typeof lightColors = {
    primary: '#FFFFFF',
    onPrimary: '#000000',
    primaryContainer: 'rgba(255, 255, 255, 0.14)',
    secondary: '#CFCFD4',
    // True black: OLED-friendly and the same black as the player, so going in and out of a
    // video never flashes grey.
    background: '#000000',
    surface: '#121214',
    surfaceVariant: '#26262A',
    fill: 'rgba(255, 255, 255, 0.08)',
    fillStrong: 'rgba(255, 255, 255, 0.14)',
    pressed: 'rgba(255, 255, 255, 0.10)',
    text: '#EDEDEF',
    textSecondary: '#A1A1A8',
    textTertiary: '#6E6E76',
    border: 'rgba(255, 255, 255, 0.08)',
    error: '#FF6B6B',
    success: '#5EDBA5',
    warning: '#F5B544',
    card: '#121214',
    cardElevated: '#1C1C1F',
    scrim: 'rgba(0, 0, 0, 0.5)',
    shadow: '#000000',
};

/** Player overlays sit on video, so they are always dark whatever the app theme. */
export const playerColors: typeof lightColors = {
    ...darkColors,
    card: 'rgba(24, 24, 27, 0.97)',
    cardElevated: 'rgba(28, 28, 31, 0.98)',
    fill: 'rgba(255, 255, 255, 0.10)',
    fillStrong: 'rgba(255, 255, 255, 0.16)',
    border: 'rgba(255, 255, 255, 0.10)',
    scrim: 'rgba(0, 0, 0, 0.45)',
};

/** Behind a player panel: dim the video, don't hide it. */
export const PLAYER_BACKDROP = playerColors.scrim;

/** Gesture indicators and readouts floating on video. */
export const HUD_PILL = 'rgba(0, 0, 0, 0.6)';

export type ColorScheme = typeof lightColors;

const luminance = (hex: string) => {
    const lin = (i: number) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
};

const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

/**
 * A cover colour usable as text or an icon on `bg` (both `#RRGGBB`): mixed toward white on a dark
 * background, black on a light one, until it reaches 4.5:1. Dark covers otherwise vanish.
 */
export function readableOn(color: string, bg: string): string {
    const hex = /^#[0-9a-f]{6}$/i;
    if (!hex.test(color) || !hex.test(bg)) return color;
    const target = luminance(bg) < 0.5 ? 255 : 0;
    let out = color;
    for (let t = 0.1; contrast(out, bg) < 4.5 && t <= 1; t += 0.1) {
        out = '#' + [1, 3, 5].map(i => {
            const c = parseInt(color.slice(i, i + 2), 16);
            return Math.round(c + (target - c) * t).toString(16).padStart(2, '0');
        }).join('');
    }
    return out;
}
