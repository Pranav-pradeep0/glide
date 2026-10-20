// src/theme/theme.ts

import { TextStyle } from 'react-native';
import { lightColors, darkColors, playerColors, ColorScheme } from './colors';

export const metrics = {
    /** Minimum touch target. */
    touch: 48,
    /** Cap on system font scaling for text drawn over video, so large fonts don't break the overlay. */
    playerFontScale: 1.3,
    /** Screen side padding. */
    gutter: 16,
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
    /**
     * xs badges · sm thumbnails · md snackbars · lg panels and HUD pills ·
     * card cards and setting groups · sheet sheet tops · pill buttons, chips, switches.
     */
    radius: { xs: 4, sm: 8, md: 12, lg: 16, card: 20, sheet: 28, pill: 999 },
};

export const type = {
    /** Screen titles. */
    title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.5 },
    /** Section headers in a list ("Continue watching"). */
    section: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
    /** Sheet, panel and app-bar titles. */
    heading: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
    /** List row titles. */
    row: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
    body: { fontSize: 14, lineHeight: 20 },
    /** Meta lines under a row title. */
    caption: { fontSize: 12, lineHeight: 16 },
    /** Buttons, chips, group labels. */
    label: { fontSize: 13.5, lineHeight: 18, fontWeight: '500' },
    /** Gesture readouts on video ("+0:45"). */
    readout: { fontSize: 22, fontWeight: '500', fontVariant: ['tabular-nums'] },
    /** Large tabular number, like the sync offset. */
    hero: { fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
} satisfies Record<string, TextStyle>;

/**
 * M3 standard motion springs (mass 1, damping = 2ζ√k). Use these, nothing ad hoc.
 * Reanimated's reduce-motion handling applies via `ReduceMotion.System` (the default).
 */
export const motion = {
    /** Press scale and small moves. */
    press: { mass: 1, stiffness: 1400, damping: 67 },
    /** Panels, sheets, the seek bar growing. ≈320 ms. */
    spatial: { mass: 1, stiffness: 700, damping: 48 },
    /** Large moves. */
    slow: { mass: 1, stiffness: 300, damping: 31 },
    fadeIn: 120,
    fadeOut: 280,
    pressScale: 0.97,
} as const;

export interface Theme {
    dark: boolean;
    colors: ColorScheme;
}

export const lightTheme: Theme = { dark: false, colors: lightColors };
export const darkTheme: Theme = { dark: true, colors: darkColors };
export const playerTheme: Theme = { dark: true, colors: playerColors };
