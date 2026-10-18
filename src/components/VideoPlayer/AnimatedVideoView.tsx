/**
 * AnimatedVideoView Component
 *
 * A memoized wrapper around the native player that handles zoom/pan animations.
 * Isolated so parent state changes do not re-render the heavy native view.
 */

import React, { memo, forwardRef, useMemo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { AnimatedStyle } from 'react-native-reanimated';
import type { HapticPreset } from '@/types';
import GlidePlayer, {
    GlidePlayerRef,
    HapticCue,
    PlayerResizeMode,
    PlayerSource,
} from '@/components/VideoPlayer/GlidePlayer';
import {
    PlayerLoadData,
    PlayerProgressData,
    PlayerSeekEvent,
    PlayerBufferingEvent,
} from '@/hooks/video-player/types';

// ============================================================================
// TYPES
// ============================================================================

interface AnimatedVideoViewProps {
    // Source
    source: PlayerSource;
    videoEnhancement: boolean;
    videoEnhancementStrength: number;

    // Playback state
    paused: boolean;
    rate: number;
    muted: boolean;
    repeat: boolean;
    resizeMode: PlayerResizeMode;
    playInBackground: boolean;
    pipEnabled: boolean;
    pipPresentationActive: boolean;
    /** PiP window buttons; the handler is undefined when there is no previous/next video. */
    onPipPrevious?: () => void;
    onPipNext?: () => void;

    // Tracks
    audioTrack?: number;
    /** Open-time only, so it needs no place in areEqual. */
    preferredAudioLanguage?: string;
    /** Ordinal among subtitle streams for bitmap subs; -1 disables native text output. */
    textTrack?: number;

    // Metadata
    title?: string;
    artist?: string;

    // Audio
    audioEqualizer?: number[];
    /** Milliseconds; positive plays the audio later. */
    audioDelay?: number;
    /** Play the cached haptic track for this video in step with it. */
    haptics?: boolean;
    /** A subtitle's tagged cues ([explosion], ♪), if it has any: the Director reads them as sound labels. */
    hapticCues?: HapticCue[];
    /** How few moments are felt and how far they stand out; live. */
    hapticPreset?: HapticPreset;
    /** 0..1, how strong the loud moments are; live. */
    hapticStrength?: number;

    /**
     * Where to begin playback on the first mount, in seconds, from watch history.
     * Only the initial resume: a remount's position is captured natively.
     */
    initialResumeSeconds?: number;

    // Animation style from gestures
    animatedStyle: AnimatedStyle<any>;

    // Player callbacks
    onLoad: (data: PlayerLoadData) => void;
    onProgress: (data: PlayerProgressData) => void;
    onEnd: () => void;
    onError: (e: any) => void;
    onBuffering: (event: PlayerBufferingEvent | any) => void;
    onPlaying: () => void;
    onPaused: () => void;
    onStopped: () => void;
    onSeek: (data: PlayerSeekEvent) => void;
    onCues?: (event: any) => void;
    onCredits?: (event: { start: number }) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

const AnimatedVideoView = forwardRef<GlidePlayerRef, AnimatedVideoViewProps>(
    function AnimatedVideoView(props, ref) {
        const {
            source,
            videoEnhancement,
            videoEnhancementStrength,
            paused,
            rate,
            muted,
            repeat,
            resizeMode,
            playInBackground,
            pipEnabled,
            pipPresentationActive,
            onPipPrevious,
            onPipNext,
            audioTrack,
            preferredAudioLanguage,
            textTrack,
            title,
            artist,
            audioEqualizer,
            audioDelay,
            haptics,
            hapticCues,
            hapticPreset,
            hapticStrength,
            initialResumeSeconds,
            animatedStyle,
            onLoad,
            onProgress,
            onEnd,
            onError,
            onBuffering,
            onPlaying,
            onPaused,
            onStopped,
            onSeek,
            onCues,
            onCredits,
        } = props;

        /**
         * Where the native player should open, in seconds.
         *
         * The whole resume mechanism. It travels inside the source so it cannot race the
         * source prop, and native passes it straight to setMediaItem's start position.
         *
         * This used to also recover a live position across remounts, because switching
         * decoder rebuilt the native view and a position held inside the outgoing view was
         * lost with it. ExoPlayer picks its own decoder, that setting is gone, and the one
         * remaining same-view recreate (the enhancement toggle) captures its own position
         * natively — so nothing remounts and the live-position branch went with it.
         */
        const startTimeSeconds =
            initialResumeSeconds && initialResumeSeconds > 0 ? initialResumeSeconds : 0;

        const handlePlaying = useCallback(() => {
            onPlaying();
        }, [onPlaying]);

        const playerSource = useMemo(() => ({
            ...source,
            // Seconds. Native opens the media here, so resume needs no seek.
            startTime: startTimeSeconds > 0 ? startTimeSeconds : undefined,
        }), [source, startTimeSeconds]);

        return (
            <Animated.View style={[
                styles.container,
                pipPresentationActive ? styles.pipContainer : animatedStyle,
            ]}>
                <GlidePlayer
                    ref={ref}
                    source={playerSource}
                    paused={paused}
                    rate={rate}
                    style={styles.video}
                    audioTrack={audioTrack}
                    preferredAudioLanguage={preferredAudioLanguage}
                    textTrack={textTrack}
                    muted={muted}
                    resizeMode={resizeMode}
                    repeat={repeat}
                    title={title}
                    artist={artist}
                    audioEqualizer={audioEqualizer}
                    audioDelay={audioDelay}
                    haptics={haptics}
                    hapticCues={hapticCues}
                    hapticPreset={hapticPreset}
                    hapticStrength={hapticStrength}
                    videoEnhancement={videoEnhancement}
                    videoEnhancementStrength={videoEnhancementStrength}
                    onLoad={onLoad}
                    onProgress={onProgress}
                    onEnd={onEnd}
                    onError={onError}
                    onBuffering={onBuffering}
                    onPlaying={handlePlaying}
                    onPaused={onPaused}
                    onStopped={onStopped}
                    onSeek={onSeek}
                    onCues={onCues}
                    onCredits={onCredits}
                    playInBackground={playInBackground}
                    pipEnabled={pipEnabled}
                    pipHasPrevious={!!onPipPrevious}
                    pipHasNext={!!onPipNext}
                    onPipPrevious={onPipPrevious}
                    onPipNext={onPipNext}
                />
            </Animated.View>
        );
    }
);

// ============================================================================
// MEMOIZATION
// ============================================================================

/** Only re-render when something the native view actually reads changes. */
function areEqual(prevProps: AnimatedVideoViewProps, nextProps: AnimatedVideoViewProps): boolean {
    if (prevProps.source.uri !== nextProps.source.uri) {return false;}
    if (prevProps.paused !== nextProps.paused) {return false;}
    if (prevProps.rate !== nextProps.rate) {return false;}
    if (prevProps.muted !== nextProps.muted) {return false;}
    if (prevProps.repeat !== nextProps.repeat) {return false;}
    if (prevProps.resizeMode !== nextProps.resizeMode) {return false;}
    if (prevProps.videoEnhancement !== nextProps.videoEnhancement) {return false;}
    if (prevProps.videoEnhancementStrength !== nextProps.videoEnhancementStrength) {return false;}
    if (prevProps.pipEnabled !== nextProps.pipEnabled) {return false;}
    if (prevProps.pipPresentationActive !== nextProps.pipPresentationActive) {return false;}
    if (prevProps.audioTrack !== nextProps.audioTrack) {return false;}
    if (prevProps.audioDelay !== nextProps.audioDelay) {return false;}
    if (prevProps.haptics !== nextProps.haptics) {return false;}
    if (prevProps.hapticCues !== nextProps.hapticCues) {return false;}
    if (prevProps.hapticPreset !== nextProps.hapticPreset) {return false;}
    if (prevProps.hapticStrength !== nextProps.hapticStrength) {return false;}
    if (prevProps.textTrack !== nextProps.textTrack) {return false;}
    if (prevProps.title !== nextProps.title) {return false;}
    if (prevProps.artist !== nextProps.artist) {return false;}
    if (prevProps.audioEqualizer !== nextProps.audioEqualizer) {return false;}
    if (prevProps.playInBackground !== nextProps.playInBackground) {return false;}
    // Important: the auto-play-next closure lives in onEnd.
    if (prevProps.onEnd !== nextProps.onEnd) {return false;}
    // Their closures hold the playlist position, and their presence enables the PiP buttons.
    if (prevProps.onPipPrevious !== nextProps.onPipPrevious) {return false;}
    if (prevProps.onPipNext !== nextProps.onPipNext) {return false;}

    // Position and duration are deliberately not props: neither changes what the native
    // view renders, and taking them would re-render this on every progress tick.
    return true;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default memo(AnimatedVideoView, areEqual);

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    pipContainer: {
        transform: [],
    },
    video: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
});
