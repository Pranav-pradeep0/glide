import React from 'react';
import Svg, { Rect, Path, Circle, G } from 'react-native-svg';
import { playerTheme } from '@/theme/theme';

const DEFAULT_COLOR = playerTheme.colors.text;

// ============================================================================
// DISPLAY MODE ICONS
// ============================================================================

export const ContainIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x="2" y="3" width="20" height="18" rx="2" strokeOpacity={0.6} />
        <Rect x="6" y="7" width="12" height="10" rx="1" fill={color} stroke="none" />
    </Svg>
);

export const CoverIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x="2" y="3" width="20" height="18" rx="2" strokeOpacity={0.6} />
        <Rect x="4" y="5" width="16" height="14" rx="1" fill={color} fillOpacity={0.9} stroke="none" />
        <Path d="M4 5L2 3M20 5L22 3M4 19L2 21M20 19L22 21" stroke={color} strokeWidth={2} strokeOpacity={0.8} />
    </Svg>
);

export const StretchIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x="2" y="3" width="20" height="18" rx="2" strokeOpacity={0.6} />
        <Path d="M7 12H17M7 12L9 10M7 12L9 14M17 12L15 10M17 12L15 14" stroke={color} strokeWidth={2} />
        <Path d="M12 7V17M12 7L10 9M12 7L14 9M12 17L10 15M12 17L14 15" stroke={color} strokeWidth={2} />
    </Svg>
);

export const NoneIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x="2" y="3" width="20" height="18" rx="2" strokeOpacity={0.6} />
        <Rect x="8" y="8" width="8" height="8" rx="1" fill={color} fillOpacity={0.85} stroke="none" />
    </Svg>
);

export const ScaleDownIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x="2" y="3" width="20" height="18" rx="2" strokeOpacity={0.6} />
        <Rect x="7" y="8" width="10" height="8" rx="1" fill={color} fillOpacity={0.7} stroke="none" />
        <Path d="M5 6l3 0M5 6l0 3M19 18l-3 0M19 18l0-3" stroke={color} strokeOpacity={0.8} />
    </Svg>
);

export const BestFitIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x="2" y="3" width="20" height="18" rx="2" strokeOpacity={0.6} />
        <Rect x="5" y="6" width="14" height="12" rx="1" fill={color} fillOpacity={0.85} stroke="none" />
    </Svg>
);

// ============================================================================
// OTHER ICONS
// ============================================================================

export const PipIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Rect x="2" y="4" width="20" height="16" rx="2" strokeOpacity={1} />
            <Rect x="12" y="12" width="7" height="5" rx="1" fill={color} stroke="none" />
        </Svg>
    );
};

export const AudioIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M11 5L6 9H2V15H6L11 19V5Z" strokeOpacity={1} />
        <Path d="M15.54 8.46C16.4774 9.39764 17.0039 10.6692 17.0039 11.995C17.0039 13.3208 16.4774 14.5924 15.54 15.53" stroke={color} strokeWidth={2.5} />
        <Path d="M19.07 4.93C20.9447 6.80527 21.9979 9.34836 21.9979 12C21.9979 14.6516 20.9447 17.1947 19.07 19.07" stroke={color} strokeWidth={2.5} />
    </Svg>
);

export const SubtitleIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x="2" y="4" width="20" height="16" rx="2" strokeOpacity={1} />
        <Rect x="6" y="10" width="12" height="2" rx="1" fill={color} stroke="none" />
        <Rect x="8" y="14" width="8" height="2" rx="1" fill={color} stroke="none" />
    </Svg>
);

export const OrientationLockIcon = ({ size = 20, color = DEFAULT_COLOR, locked = false }: { size?: number, color?: string, locked?: boolean }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x="5" y="2" width="14" height="20" rx="3" strokeOpacity={0.6} />
        {locked ? (
            <G>
                <Rect x="9" y="11" width="6" height="4" rx="1" fill={color} stroke="none" />
                <Path d="M10 11V9.5C10 8.39543 10.8954 7.5 12 7.5C13.1046 7.5 14 8.39543 14 9.5V11" stroke={color} strokeWidth={2} />
            </G>
        ) : (
            <Path d="M12 18h.01" stroke={color} strokeWidth={3} strokeLinecap="round" />
        )}
    </Svg>
);

export const BackgroundPlayIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M4 12V9a8 8 0 0 1 16 0v3" strokeOpacity={1} />
        <Rect x="2" y="12" width="6" height="10" rx="3" fill={color} stroke="none" />
        <Rect x="16" y="12" width="6" height="10" rx="3" fill={color} stroke="none" />
    </Svg>
);

export const NightModeIcon = ({ size = 20, color = DEFAULT_COLOR, active = false }: { size?: number, color?: string, active?: boolean }) => (
    active ? (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill={color} stroke="none" />
        </Svg>
    ) : (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="12" cy="12" r="5" fill={color} stroke="none" />
            <Path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeOpacity={0.6} />
        </Svg>
    )
);

/**
 * The modes the player offers, in cycle order, for both the resize pill and the Display page. Every one maps to its own branch of the native
 * computeGeometry (GlidePlayerView.kt), and each looks different on a typical video.
 * 'scale-down' is left out: it matches Fit for anything at least screen size and Original
 * for anything smaller, so cycling through it looked like nothing happened.
 */
export const DISPLAY_MODES = [
    { mode: 'best-fit', label: 'Auto' },
    { mode: 'contain', label: 'Fit' },
    { mode: 'cover', label: 'Crop' },
    { mode: 'fill', label: 'Stretch' },
    { mode: 'none', label: 'Original size' },
] as const;

/** The mode after this one; anything not in the list (a stored 'stretch', say) goes to the first. */
export const nextDisplayMode = (mode: string) =>
    DISPLAY_MODES[(DISPLAY_MODES.findIndex(m => m.mode === mode) + 1) % DISPLAY_MODES.length].mode;

/** Playback speed or zoom as the user reads it: 1.5 -> "1.5×", 2 -> "2×". */
export const formatRate = (rate: number) => `${Number(rate.toFixed(2))}×`;

export const getResizeModeLabel =(resizeMode: string): string => {
    if (resizeMode === 'stretch') {return 'Stretch';}
    if (resizeMode === 'center') {return 'Original size';}
    if (resizeMode === 'scale-down') {return 'Shrink only';}
    return DISPLAY_MODES.find(m => m.mode === resizeMode)?.label ?? 'Fit';
};

// Helper to get icon by mode name
export const getResizeModeIcon = (resizeMode: string) => {
    switch (resizeMode) {
        case 'best-fit':
            return BestFitIcon;
        case 'contain':
            return ContainIcon;
        case 'cover':
            return CoverIcon;
        case 'stretch':
        case 'fill':
            return StretchIcon;
        case 'none':
        case 'center':
            return NoneIcon;
        case 'scale-down':
            return ScaleDownIcon;
        default:
            return ContainIcon;
    }
};

export const HapticsIcon = ({ size = 20, color = DEFAULT_COLOR, active = true }: { size?: number, color?: string, active?: boolean }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {/* Central element */}
        <Rect x="6" y="6" width="12" height="12" rx="2" fill={active ? color : 'none'} stroke={color} />
        {/* Left waves */}
        <Path d="M3.5 8v8" stroke={color} strokeOpacity={active ? 1 : 0.6} />
        <Path d="M1 10v4" stroke={color} strokeOpacity={active ? 0.6 : 0.3} />
        {/* Right waves */}
        <Path d="M20.5 8v8" stroke={color} strokeOpacity={active ? 1 : 0.6} />
        <Path d="M23 10v4" stroke={color} strokeOpacity={active ? 0.6 : 0.3} />
    </Svg>
);

// ============================================================================
// RATING LOGOS
// ============================================================================

export const ImdbIcon = ({ size = 24 }: { size?: number }) => (
    <Svg width={size * (575 / 290)} height={size} viewBox="0 0 575 290" fill="none">
        <Path d="M575 24.91C573.44 12.15 563.97 1.98 551.91 0C499.05 0 76.18 0 23.32 0C10.11 2.17 0 14.16 0 28.61C0 51.84 0 237.64 0 260.86C0 276.86 12.37 289.83 27.64 289.83C79.63 289.83 495.6 289.83 547.59 289.83C561.65 289.83 573.26 278.82 575 264.57C575 216.64 575 48.87 575 24.91Z" fill="#F6C700" />
        <Path d="M69.35 58.24L114.98 58.24L114.98 233.89L69.35 233.89L69.35 58.24Z" fill="black" />
        <Path d="M201.2 139.15C197.28 112.38 195.1 97.5 194.67 94.53C192.76 80.2 190.94 67.73 189.2 57.09C185.25 57.09 165.54 57.09 130.04 57.09L130.04 232.74L170.15 116.76L186.97 232.74L215.44 232.74L231.39 114.18L231.54 232.74L271.38 232.74L271.38 57.09L211.77 57.09L201.2 139.15Z" fill="black" />
        <Path d="M346.71 93.63C347.21 95.87 347.47 100.95 347.47 108.89C347.47 115.7 347.47 170.18 347.47 176.99C347.47 188.68 346.71 195.84 345.2 198.48C343.68 201.12 339.64 202.43 333.09 202.43C333.09 190.9 333.09 98.66 333.09 87.13C338.06 87.13 341.45 87.66 343.25 88.7C345.05 89.75 346.21 91.39 346.71 93.63ZM367.32 230.95C372.75 229.76 377.31 227.66 381.01 224.67C384.7 221.67 387.29 217.52 388.77 212.21C390.26 206.91 391.14 196.38 391.14 180.63C391.14 174.47 391.14 125.12 391.14 118.95C391.14 102.33 390.49 91.19 389.48 85.53C388.46 79.86 385.93 74.71 381.88 70.09C377.82 65.47 371.9 62.15 364.12 60.13C356.33 58.11 343.63 57.09 321.54 57.09C319.27 57.09 307.93 57.09 287.5 57.09L287.5 232.74L342.78 232.74C355.52 232.34 363.7 231.75 367.32 230.95Z" fill="black" />
        <Path d="M464.76 204.7C463.92 206.93 460.24 208.06 457.46 208.06C454.74 208.06 452.93 206.98 452.01 204.81C451.09 202.65 450.64 197.72 450.64 190C450.64 185.36 450.64 148.22 450.64 143.58C450.64 135.58 451.04 130.59 451.85 128.6C452.65 126.63 454.41 125.63 457.13 125.63C459.91 125.63 463.64 126.76 464.6 129.03C465.55 131.3 466.03 136.15 466.03 143.58C466.03 146.58 466.03 161.58 466.03 188.59C465.74 197.84 465.32 203.21 464.76 204.7ZM406.68 231.21L447.76 231.21C449.47 224.5 450.41 220.77 450.6 220.02C454.32 224.52 458.41 227.9 462.9 230.14C467.37 232.39 474.06 233.51 479.24 233.51C486.45 233.51 492.67 231.62 497.92 227.83C503.16 224.05 506.5 219.57 507.92 214.42C509.34 209.26 510.05 201.42 510.05 190.88C510.05 185.95 510.05 146.53 510.05 141.6C510.05 131 509.81 124.08 509.34 120.83C508.87 117.58 507.47 114.27 505.14 110.88C502.81 107.49 499.42 104.86 494.98 102.98C490.54 101.1 485.3 100.16 479.26 100.16C474.01 100.16 467.29 101.21 462.81 103.28C458.34 105.35 454.28 108.49 450.64 112.7C450.64 108.89 450.64 89.85 450.64 55.56L406.68 55.56L406.68 231.21Z" fill="black" />
    </Svg>
);

export const RottenTomatoesIcon = ({ size = 20 }: { size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 139 142" fill="none">
        <Path d="M20.154 40.829C-7.995 68.451 6.497 101.84 14.42 112.76C49.674 154.714 107.212 138.099 126.31 106.853C131.071 98.6503 148.864 53.386 102.334 28.844L20.154 40.829Z" fill="#F93208" />
        <Path d="M39.613 39.265L44.3908 30.4043L72.7968 25.3659L83.9158 34.5741L39.613 39.265Z" fill="#F93208" />
        <Path d="M39.436 8.5696L48.4042 3.287L55.1611 18.766C58.9536 12.4434 68.9511 2.45 80.1 14.0976C75.3719 15.3612 72.5839 17.9529 72.3603 22.5744C87.5053 18.4047 103.703 25.7871 105.899 31.6655C94.948 27.3515 78.204 42.0425 64.128 33.9985C64.137 49.0435 51.511 50.6345 44.226 51.0745C46.303 46.0785 49.817 41.0805 45.7 36.0875C38.082 44.2585 31.826 46.7555 12.53 40.7555C17.406 39.0765 27.373 29.3655 36.978 29.3305C30.203 26.8635 24.688 27.2435 19.164 27.8555C22.081 23.8945 31.313 12.6586 47.789 19.379L39.436 8.5696Z" fill="#02902E" />
    </Svg>
);
// ============================================================================
// ANIMATED ICONS (Reanimated)
// ============================================================================

import Animated, {
    useAnimatedProps,
    type SharedValue,
} from 'react-native-reanimated';

// Create Animated SVG components
const AnimatedPath = Animated.createAnimatedComponent(Path);

interface AnimatedIconProps {
    size?: number;
    color?: string;
    progress: SharedValue<number>; // 0 to 1 (or higher for boost)
    maxVolume?: number; // For normalising boost
}

// Improved Volume Icon with standard paths but animated opacities
export const AnimatedVolumeIconStandard = ({ size = 20, color = DEFAULT_COLOR, progress, maxVolume = 1.0 }: AnimatedIconProps) => {
    // Speaker Base
    const baseProps = useAnimatedProps(() => ({
        fillOpacity: progress.value > 0 ? 1 : 0.5,
    }));

    // Inner Wave
    const wave1Props = useAnimatedProps(() => {
        const normalized = progress.value / maxVolume;
        return {
            strokeOpacity: normalized > 0.01 ? 1 : 0.3,
        };
    });

    // Outer Wave
    const wave2Props = useAnimatedProps(() => {
        const normalized = progress.value / maxVolume;
        return {
            strokeOpacity: normalized > 0.5 ? 1 : 0.3,
        };
    });

    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <AnimatedPath d="M11 5L6 9H2V15H6L11 19V5Z" stroke={color} animatedProps={baseProps} fill={color} />
            <AnimatedPath d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke={color} animatedProps={wave1Props} />
            <AnimatedPath d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke={color} animatedProps={wave2Props} />
        </Svg>
    );
};

// Helper to create threshold opacity
const useRayOpacity = (progress: SharedValue<number>, threshold: number) => {
    return useAnimatedProps(() => {
        const p = Math.max(0, Math.min(1, progress.value));
        return {
            strokeOpacity: p >= threshold ? 1 : 0.3,
        };
    });
};

export const AnimatedBrightnessIcon = ({ size = 20, color = DEFAULT_COLOR, progress }: AnimatedIconProps) => {
    // Rays light up clockwise from top (12 o'clock)
    // 8 rays -> steps of 1/8 = 0.125

    // 1. Top (12:00) - 0% to 12.5%
    const ray1 = useRayOpacity(progress, 0.05);
    // 2. Top-Right (1:30)
    const ray2 = useRayOpacity(progress, 0.125 * 1);
    // 3. Right (3:00)
    const ray3 = useRayOpacity(progress, 0.125 * 2);
    // 4. Bottom-Right (4:30)
    const ray4 = useRayOpacity(progress, 0.125 * 3);
    // 5. Bottom (6:00)
    const ray5 = useRayOpacity(progress, 0.125 * 4);
    // 6. Bottom-Left (7:30)
    const ray6 = useRayOpacity(progress, 0.125 * 5);
    // 7. Left (9:00)
    const ray7 = useRayOpacity(progress, 0.125 * 6);
    // 8. Top-Left (10:30)
    const ray8 = useRayOpacity(progress, 0.125 * 7);

    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="12" cy="12" r="5" fill={color} stroke="none" />

            {/* 1. Top */}
            <AnimatedPath d="M12 1v2" animatedProps={ray1} />
            {/* 2. Top-Right */}
            <AnimatedPath d="M18.36 5.64l1.42-1.42" animatedProps={ray2} />
            {/* 3. Right */}
            <AnimatedPath d="M21 12h2" animatedProps={ray3} />
            {/* 4. Bottom-Right */}
            <AnimatedPath d="M18.36 18.36l1.42 1.42" animatedProps={ray4} />
            {/* 5. Bottom */}
            <AnimatedPath d="M12 21v2" animatedProps={ray5} />
            {/* 6. Bottom-Left */}
            <AnimatedPath d="M4.22 19.78l1.42-1.42" animatedProps={ray6} />
            {/* 7. Left */}
            <AnimatedPath d="M1 12h2" animatedProps={ray7} />
            {/* 8. Top-Left */}
            <AnimatedPath d="M4.22 4.22l1.42 1.42" animatedProps={ray8} />
        </Svg>
    );
};

export const RecapIcon = ({ size = 20, color = DEFAULT_COLOR, active = false }: { size?: number, color?: string, active?: boolean }) => {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            {/* Film frame/play hybrid */}
            <Path
                d="M10 9l5 3-5 3V9z"
                fill={active ? color : 'none'}
                stroke={color}
                strokeWidth={1.5}
                strokeLinejoin="round"
            />
            <Path
                d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"
                stroke={color}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeOpacity={active ? 1 : 0.6}
            />
        </Svg>
    );
};

export const BookmarkListIcon = ({ size = 20, color = DEFAULT_COLOR }: { size?: number, color?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" strokeOpacity={1} />
        <Rect x="8" y="7" width="8" height="2" rx="1" fill={color} stroke="none" />
        <Rect x="8" y="11" width="5" height="2" rx="1" fill={color} stroke="none" />
    </Svg>
);

export const VisualEnhancementIcon = ({ size = 20, color = DEFAULT_COLOR, active = false }: { size?: number, color?: string, active?: boolean }) => {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            {/* Frame/screen outline */}
            <Rect
                x="3"
                y="5"
                width="20"
                height="16"
                rx="1.5"
                stroke={active ? color : 'rgba(255,255,255,0.6)'}
                strokeWidth={1.5}
                fill="none"
            />

            {/* Color spectrum gradient bars - vertical bars showing RGB enhancement */}
            <G opacity={active ? 1 : 0.6}>
                {/* Red */}
                <Rect
                    x="6"
                    y="9"
                    width="2.5"
                    height="7"
                    rx="0.5"
                    fill="#FF3B30"
                />
                {/* Orange/Yellow */}
                <Rect
                    x="9.25"
                    y="8"
                    width="2.5"
                    height="9"
                    rx="0.5"
                    fill="#FFD60A"
                />
                {/* Green */}
                <Rect
                    x="12.5"
                    y="9.5"
                    width="2.5"
                    height="6.5"
                    rx="0.5"
                    fill="#4CD964"
                />
                {/* Blue */}
                <Rect
                    x="15.75"
                    y="8.5"
                    width="2.5"
                    height="8"
                    rx="0.5"
                    fill="#007AFF"
                />
            </G>

            {/* Sparkle effects for enhancement feel */}
            <Path
                d="M7 7L7.3 7.7L8 8L7.3 8.3L7 9L6.7 8.3L6 8L6.7 7.7L7 7Z"
                fill={active ? '#FFD60A' : color}
                opacity={active ? 1 : 0.2}
            />
            <Path
                d="M18 7L18.25 7.5L18.75 7.75L18.25 8L18 8.5L17.75 8L17.25 7.75L17.75 7.5L18 7Z"
                fill={active ? '#FFD60A' : color}
                opacity={active ? 1 : 0.2}
            />
        </Svg>
    );
};


/**
 * Skip glyph in the replay_10 / gobackward.10 style: a ring nearly closed at the top with the
 * arrowhead there, pointing the way time moves. The number is drawn by the caller as text so
 * it stays crisp at any size. Ring centre is (16, 17) of the 32 box, a touch below middle.
 */
export const SkipRingIcon = ({ size = 36, color = DEFAULT_COLOR, forward = false }: { size?: number; color?: string; forward?: boolean }) => (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        <G transform={forward ? 'translate(32 0) scale(-1 1)' : undefined}>
            <Path
                d="M13 6H16A11 11 0 1 1 8.22 9.22"
                stroke={color}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Path d="M16.6 2.4L13 6L16.6 9.6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </G>
    </Svg>
);
