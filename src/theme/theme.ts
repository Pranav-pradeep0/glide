// src/theme/theme.ts

import { TextStyle } from 'react-native';
import { IS_TV } from '@/utils/tv';
import { lightColors, darkColors, playerColors, ColorScheme } from './colors';

/**
 * Type size on a TV against a phone. A TV dp is about a quarter smaller to the eye from the
 * sofa than a phone dp in the hand, so text grows by that much. 1 on phones.
 */
export const TV_SCALE = IS_TV ? 1.2 : 1;

export const metrics = {
    /** Minimum touch target. */
    touch: 48,
    /** Cap on system font scaling for text drawn over video, so large fonts don't break the overlay. */
    playerFontScale: 1.3,
    /** Screen side padding. On a TV, the 5% overscan margin some sets still crop. */
    gutter: IS_TV ? 48 : 16,
    /** Extra top and bottom margin for TV overscan; 0 on phones. */
    overscanY: IS_TV ? 27 : 0,
    /** Card grids: columns, and half the gap between cards. TVs get bigger cards with room to grow into on focus. */
    grid: { columns: IS_TV ? 3 : 2, halfGap: IS_TV ? 12 : 6 },
    /** Focus indicator: ring width, and how much a focused card grows on a TV. */
    focus: { ring: 3, tvScale: 1.05 },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
    /**
     * xs badges · sm thumbnails · md snackbars · lg panels and HUD pills ·
     * card cards and setting groups · sheet sheet tops · pill buttons, chips, switches.
     */
    radius: { xs: 4, sm: 8, md: 12, lg: 16, card: 20, sheet: 28, pill: 999 },
};

const forTv = <T extends Record<string, TextStyle>>(styles: T): T => (IS_TV
    ? Object.fromEntries(Object.entries(styles).map(([key, s]) => [key, {
        ...s,
        fontSize: s.fontSize && s.fontSize * TV_SCALE,
        lineHeight: s.lineHeight && s.lineHeight * TV_SCALE,
    }])) as T
    : styles);

export const type = forTv({
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
} satisfies Record<string, TextStyle>);

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
