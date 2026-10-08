import React, { useCallback, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { SubtitleOverlay, SubtitleSettings } from '@/components/SubtitleOverlay';
import { useSubtitleCueStore } from '@/store/subtitleCueStore';
import { useAppStore } from '@/store/appStore';

interface PlayerSubtitleOverlayProps {
    isLandscape: boolean;
}

/**
 * Isolated subtitle overlay connected to `useSubtitleCueStore` and fine-grained
 * subtitle preferences from `useAppStore`.
 *
 * Extracting cue subscription here isolates subtitle updates from the 1,500-line
 * VideoPlayerScreen, preventing full screen re-renders on every subtitle cue change.
 */
export const PlayerSubtitleOverlay: React.FC<PlayerSubtitleOverlayProps> = React.memo(({ isLandscape }) => {
    const { height } = useWindowDimensions();
    const currentCue = useSubtitleCueStore((s) => s.currentCue);
    const setSubtitlePosition = useAppStore((s) => s.setSubtitlePosition);

    // Fine-grained selectors for subtitle appearance
    const subtitleFontFamily = useAppStore((s) => s.settings.subtitleFontFamily);
    const subtitleFontWeight = useAppStore((s) => s.settings.subtitleFontWeight);
    const subtitleFontSize = useAppStore((s) => s.settings.subtitleFontSize);
    const subtitleColor = useAppStore((s) => s.settings.subtitleColor);
    const subtitleBackgroundColor = useAppStore((s) => s.settings.subtitleBackgroundColor);
    const subtitleBackgroundOpacity = useAppStore((s) => s.settings.subtitleBackgroundOpacity);
    const subtitleEdgeStyle = useAppStore((s) => s.settings.subtitleEdgeStyle);
    const subtitleOutlineWidth = useAppStore((s) => s.settings.subtitleOutlineWidth);
    const subtitlePositionLandscape = useAppStore((s) => s.settings.subtitlePositionLandscape);
    const subtitlePositionPortrait = useAppStore((s) => s.settings.subtitlePositionPortrait);

    const subtitleSettings = useMemo<SubtitleSettings>(() => {
        const fontFamily = subtitleFontFamily || 'Roboto';
        const fontWeight = String(subtitleFontWeight) as SubtitleSettings['fontWeight'];

        return {
            fontSize: subtitleFontSize,
            fontColor: subtitleColor,
            fontWeight,
            fontFamily,
            backgroundColor: subtitleBackgroundColor,
            backgroundOpacity: subtitleBackgroundColor === 'transparent' ? 0 : subtitleBackgroundOpacity,
            outlineColor: subtitleEdgeStyle !== 'none' ? '#000000' : 'transparent',
            outlineWidth: subtitleEdgeStyle === 'none' ? 0 : subtitleOutlineWidth,
            position: 'bottom',
            positionOffsetRatio: isLandscape
                ? subtitlePositionLandscape ?? 0.42
                : subtitlePositionPortrait ?? 0.42,
        };
    }, [
        subtitleFontFamily,
        subtitleFontWeight,
        subtitleFontSize,
        subtitleColor,
        subtitleBackgroundColor,
        subtitleBackgroundOpacity,
        subtitleEdgeStyle,
        subtitleOutlineWidth,
        subtitlePositionLandscape,
        subtitlePositionPortrait,
        isLandscape,
    ]);

    const handleSubtitlePositionChange = useCallback((yOffset: number) => {
        const orientation = isLandscape ? 'landscape' : 'portrait';
        setSubtitlePosition(orientation, yOffset / height);
    }, [height, isLandscape, setSubtitlePosition]);

    return (
        <SubtitleOverlay
            currentCue={currentCue}
            settings={subtitleSettings}
            onPositionChange={handleSubtitlePositionChange}
        />
    );
});

export default PlayerSubtitleOverlay;
