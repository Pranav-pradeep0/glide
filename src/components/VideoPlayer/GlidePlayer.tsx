/**
 * The native video player.
 *
 * Replaces the legacy player bridge. Everything the old engine needed and ExoPlayer does not is
 * gone: init options, decoder mode, media options, `initType`, network/asset classification,
 * forced aspect ratios and the subtitle-slave path. What is left is the props the native
 * view actually implements.
 *
 * See docs/player-engine-migration-plan.md.
 */

import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import {
    Image,
    StyleSheet,
    requireNativeComponent,
    UIManager,
    findNodeHandle,
    ViewProps,
    NativeSyntheticEvent,
    ViewStyle,
    StyleProp,
} from 'react-native';
import { hasNativeApi } from '@/native/GlideNative';

const NATIVE_NAME = 'RCTGlidePlayer';

interface NativeProps {
    [key: string]: any;
}

/** A subtitle cue for haptics, in milliseconds. */
export type HapticCue = { startMs: number; endMs: number; text: string };

const RCTGlidePlayer = requireNativeComponent<NativeProps>(
    NATIVE_NAME,
) as unknown as React.ComponentType<NativeProps>;

export type PlayerResizeMode =
    | 'fill' | 'contain' | 'cover' | 'none' | 'scale-down' | 'stretch' | 'best-fit';

export interface PlayerSource {
    uri?: string;
    /** Seconds. Native opens the media at this offset, so resume needs no seek. */
    startTime?: number;
    [key: string]: any;
}

export interface GlidePlayerRef {
    /** Seconds. A command, so repeating the same target still seeks. */
    seek: (seconds: number) => void;
    /** Seconds. Cheap keyframe seek for live scrubbing. */
    previewSeek: (seconds: number) => void;
    stopPlayer: () => void;
    enterPictureInPicture: () => void;
    /** 100..200. Above 100 is gain on top of a maxed system stream; set imperatively so gestures stay smooth. */
    setVolume: (percent: number) => void;
}

export interface GlidePlayerProps extends ViewProps {
    source: PlayerSource;
    paused?: boolean;
    rate?: number;
    muted?: boolean;
    repeat?: boolean;
    resizeMode?: PlayerResizeMode;
    playInBackground?: boolean;
    pipEnabled?: boolean;
    audioTrack?: number;
    /** Ordinal among subtitle streams, or -1. Bitmap (PGS/VobSub) subtitles only. */
    textTrack?: number;
    title?: string;
    artist?: string;
    audioEqualizer?: number[];
    /** Milliseconds; positive plays the audio later. */
    audioDelay?: number;
    /** Play the cached haptic track for this video in step with it. */
    haptics?: boolean;
    /** The SDH subtitle's tagged cues ([explosion], ♪): the Director reads them as sound labels. */
    hapticCues?: HapticCue[];
    videoEnhancement?: boolean;
    /** 0..1.5, 1 = the tuned look. Live; only the toggle re-opens the media. */
    videoEnhancementStrength?: number;
    style?: StyleProp<ViewStyle>;

    onLoad?: (event: any) => void;
    onProgress?: (event: any) => void;
    onEnd?: (event: any) => void;
    onError?: (event: any) => void;
    onBuffering?: (event: any) => void;
    onPlaying?: (event: any) => void;
    onPaused?: (event: any) => void;
    onStopped?: (event: any) => void;
    onSeek?: (event: any) => void;
    onLoadStart?: (event: any) => void;
    onCues?: (event: any) => void;
    /** Where the end credits start, { start } in ms: from a chapter or the frames. */
    onCredits?: (event: { start: number }) => void;
}

const GlidePlayer = forwardRef<GlidePlayerRef, GlidePlayerProps>((props, ref) => {
    const nativeRef = useRef<any>(null);

    const setNativeProps = useCallback((nativeProps: any) => {
        nativeRef.current?.setNativeProps(nativeProps);
    }, []);

    const dispatchCommand = useCallback((command: string, args: unknown[] = []) => {
        if (!nativeRef.current) { return; }
        const handle = findNodeHandle(nativeRef.current);
        if (handle == null) { return; }
        const config = UIManager.getViewManagerConfig(NATIVE_NAME) as {
            Commands: Record<string, number>;
        };
        // By name from API 2 (the numeric form is deprecated); older APKs only know the ids.
        // The typings say number, but the runtime takes either: Fabric stringifies the id
        // and parses digits back into the Int overload.
        UIManager.dispatchViewManagerCommand(
            handle, (hasNativeApi(2) ? command : config.Commands[command]) as number, args,
        );
    }, []);

    useImperativeHandle(ref, () => ({
        seek: (seconds: number) => dispatchCommand('seek', [Math.round(seconds * 1000)]),
        previewSeek: (seconds: number) => dispatchCommand('previewSeek', [Math.round(seconds * 1000)]),
        setVolume: (percent: number) => setNativeProps({ volumeBoost: Math.round(percent) }),
        stopPlayer: () => dispatchCommand('stopPlayer'),
        enterPictureInPicture: () => dispatchCommand('enterPictureInPicture'),
    }), [setNativeProps, dispatchCommand]);

    const unwrap = (handler?: (e: any) => void) =>
        (event: NativeSyntheticEvent<any>) => handler?.(event.nativeEvent);

    const resolved = (Image.resolveAssetSource(props.source) as PlayerSource | null) || {};
    let uri = resolved.uri || '';
    if (uri.match(/^\//)) {
        uri = `file://${uri}`;
    }

    const {
        onLoad, onProgress, onEnd, onError, onBuffering, onPlaying, onPaused, onStopped,
        onSeek, onLoadStart, onCues, onCredits, source: _source, ...forwarded
    } = props;

    return (
        <RCTGlidePlayer
            ref={nativeRef}
            {...forwarded}
            style={[styles.base, props.style]}
            source={{ ...resolved, uri }}
            progressUpdateInterval={onProgress ? 250 : 0}
            onVideoLoadStart={unwrap(onLoadStart)}
            onVideoLoad={unwrap(onLoad)}
            onVideoProgress={unwrap(onProgress)}
            onVideoEnd={unwrap(onEnd)}
            onVideoError={unwrap(onError)}
            onVideoBuffering={unwrap(onBuffering)}
            onVideoPlaying={unwrap(onPlaying)}
            onVideoPaused={unwrap(onPaused)}
            onVideoStopped={unwrap(onStopped)}
            onVideoSeek={unwrap(onSeek)}
            onCues={unwrap(onCues)}
            onCredits={unwrap(onCredits)}
        />
    );
});

GlidePlayer.displayName = 'GlidePlayer';

const styles = StyleSheet.create({
    base: { overflow: 'hidden' },
});

export default GlidePlayer;
