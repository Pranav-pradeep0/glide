import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { joinMeta, prettyTitle } from '@/components/VideoRow';
import {
    StyleSheet,
    View,
    useWindowDimensions,
    BackHandler,
    AppStateStatus,
    AppState,
    NativeModules,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SystemBars } from 'react-native-edge-to-edge';
import { nextDisplayMode } from '@/components/VideoPlayer/PlayerIcons';

// Native Modules
const { DisplayBrightnessModule: BrightnessModule } = NativeModules;

import { currentActivityName, finishCurrentActivity, usePipModeListener } from '@/native/PipModule';

// Components
import AnimatedVideoView from '@/components/VideoPlayer/AnimatedVideoView';
import { VideoHUD } from '@/components/VideoPlayer/VideoHUD';
import { PlayerControls } from '@/components/VideoPlayer/PlayerControls';
import { LockButton } from '@/components/VideoPlayer/LockButton';
import { SnackbarHost, showSnackbar } from '@/components/ui';
import { PlayerErrorCard } from '@/components/VideoPlayer/PlayerErrorCard';
import UpdateModal from '@/components/UpdateModal';
import { isEnhancementError } from '@/utils/playerErrors';
import { cutoutInset, type CutoutRect } from '@/utils/cutoutInset';
import { BookmarkPanel } from '@/components/VideoPlayer/BookmarkPanel';
import { QuickSettingsPanel } from '@/components/VideoPlayer/QuickSettingsPanel';
import { PlaylistPanel } from '@/components/VideoPlayer/PlaylistPanel';
import { PlayerSubtitleOverlay } from '@/components/VideoPlayer/PlayerSubtitleOverlay';
import { TrackSelector } from '@/components/TrackSelector';
import { FloatingSyncPanel } from '@/components/FloatingSyncPanel';
import { useSubtitleAutoSync } from '@/hooks/video-player/useSubtitleAutoSync';
import { RecapModal } from '@/components/VideoPlayer/RecapModal';
import { ResumeModal } from '@/components/VideoPlayer/ResumeModal';
import { RECAP_AVAILABLE } from '@/utils/constants';
import { getResumablePosition } from '@/utils/playbackResume';

// Hooks
import {
    usePlayerCore,
    usePlayerUI,
    anyPanelOpen,
    usePlayerHUD,
    usePlayerGestures,
    usePlayerTracks,
    usePlayerBookmarks,
    usePlayerSettings,
    usePlayerRecap,
    useResumePlayback,
    ShakeDetector,
    formatTime,
    PLAYER_CONSTANTS,
    UsePlayerCoreReturn,
    UsePlayerTracksReturn,
} from '@/hooks/video-player';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumVideos } from '@/hooks/useMediaService';

// Services and stores
import { VideoOrientationService } from '@/services/VideoOrientationService';
import { NavigationService } from '@/services/NavigationService';
import { EXTERNAL_SUBTITLE_INDEX } from '@/services/ExternalSubtitleStore';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { useAppStore } from '@/store/appStore';
import { useSubtitleCueStore } from '@/store/subtitleCueStore';

// Types
import { SubtitleCue, VideoFile } from '@/types';
import type { PlayerCarry } from '@/hooks/video-player';

// ============================================================================
// TYPES
// ============================================================================

type RouteParams = {
    videoPath: string;
    videoName?: string;
    contentUri?: string; // Original content:// URI for CameraRoll operations
    playMode?: string;
    albumName?: string;
    bucketId?: string;
    hapticCues?: SubtitleCue[];
    apiSubtitles?: any[];
    isExternalOpen?: boolean;
    imdbId?: string;
    cleanTitle?: string;
    carry?: PlayerCarry;
};

type Props = {
    route: { params: RouteParams };
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function VideoPlayerScreen({ route }: Props) {
    const {
        videoPath,
        videoName = 'Video',
        contentUri, // Original content:// URI for history storage
        hapticCues: routeHapticCues,
        apiSubtitles,
        isExternalOpen,
        playMode,
        albumName: routeAlbumName,
        bucketId: routeBucketId,
        imdbId,
        cleanTitle,
        carry,
    } = route.params;

    // "The.Boys.S05E04.1080p" → "The Boys" + "S5 E4", as in the library.
    const displayTitle = useMemo(() => prettyTitle(videoName), [videoName]);

    // Derive album name from parent folder if not provided
    const albumName = useMemo(() => {
        if (routeAlbumName) {return routeAlbumName;}
        // Extract parent folder name from video path
        const parts = videoPath.replace(/\\/g, '/').split('/');
        if (parts.length >= 2) {
            return parts[parts.length - 2]; // Parent folder
        }
        return null;
    }, [videoPath, routeAlbumName]);

    // ========================================================================

    // Define navigation param list mapping for type safety (partial)
    type RootStackParamList = {
        VideoPlayer: RouteParams;
    };

    const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const isScreenFocused = useIsFocused();
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const theme = useTheme();

    // Store actions
    const getVideoHistory = useVideoHistoryStore(state => state.getVideoHistory);
    const updatePlaybackPosition = useVideoHistoryStore(state => state.updatePlaybackPosition);
    const incrementViewCount = useVideoHistoryStore(state => state.incrementViewCount);
    const persistNow = useVideoHistoryStore(state => state.persistNow);
    const setStopFrame = useVideoHistoryStore(state => state.setStopFrame);

    // Fine-grained global settings selectors
    const brightnessMode = useAppStore(state => state.settings.brightnessMode);
    const globalBrightness = useAppStore(state => state.settings.globalBrightness);
    const pipBrightnessMode = useAppStore(state => state.settings.pipBrightnessMode);
    const defaultAudioLanguage = useAppStore(state => state.settings.defaultAudioLanguage);
    const seekDuration = useAppStore(state => state.settings.seekDuration);
    const autoPlayNext = useAppStore(state => state.settings.autoPlayNext);
    const updateStatus = useAppStore(state => state.updateStatus);
    const markUpdateNotified = useAppStore(state => state.markUpdateNotified);
    const shakeThreshold = useAppStore(state => state.settings.shakeThreshold);
    const shakeEnabled = useAppStore(state => state.settings.shakeEnabled ?? false);
    const shakeAction = useAppStore(state => state.settings.shakeAction ?? 'play_pause');
    const setShakeEnabled = useAppStore(state => state.setShakeEnabled);
    const setShakeAction = useAppStore(state => state.setShakeAction);
    const showSeekButtons = useAppStore(state => state.settings.showSeekButtons);
    const updateSettings = useAppStore(state => state.updateSettings);

    // Track if view has been counted
    const hasIncrementedView = useRef(false);
    const controlsInsetsRef = useRef(insets);
    const savePlaybackRef = useRef<() => void>(() => { });
    const isMounted = useRef(true);

    useEffect(() => {
        return () => {
            isMounted.current = false;
        };
    }, []);

    // Brightness tracking
    const brightnessRef = useRef<number | undefined>(undefined);
    const appStateRef = useRef<AppStateStatus>((AppState.currentState ?? 'active') as AppStateStatus);

    const handleBrightnessChange = useCallback((val: number) => {
        brightnessRef.current = val;
    }, []);

    const handleBrightnessSave = useCallback((val: number) => {
        if (brightnessMode === 'global') {
            updateSettings({ globalBrightness: val });
        }
    }, [brightnessMode, updateSettings]);

    // ========================================================================
    // VIDEO SOURCE
    // ========================================================================

    const source = useMemo(() => {
        if (videoPath.startsWith('http://') ||
            videoPath.startsWith('https://') ||
            videoPath.startsWith('rtsp://')) {
            return { uri: videoPath, isNetwork: true };
        }
        if (videoPath.startsWith('content://')) {
            return { uri: videoPath, isNetwork: false };
        }
        let finalUri = videoPath;
        if (videoPath.startsWith('file://')) {
            finalUri = videoPath.substring(7);
        }
        if (!finalUri.startsWith('/')) {
            finalUri = `/${finalUri}`;
        }
        return { uri: finalUri, isNetwork: false };
    }, [videoPath]);

    const isLandscape = useMemo(() => width > height, [width, height]);
    const isNetworkStream = useMemo(() => NavigationService.isNetworkStream(videoPath), [videoPath]);

    const [orientationLocked, setOrientationLocked] = React.useState(carry?.orientationLocked ?? false);

    // UI and HUD hooks (needed by handlers below)
    const ui = usePlayerUI(orientationLocked, carry?.screenLocked);
    const hud = usePlayerHUD();

    // ========================================================================
    // ORIENTATION LOCK STATE
    // ========================================================================

    const [scrubbing, setScrubbing] = React.useState(false);
    /** Audio/Subtitles/Playlist/Bookmarks opened from the Playback panel get a back arrow to it. */
    const [openedFromPlayback, setOpenedFromPlayback] = React.useState(false);
    const [syncPanelType, setSyncPanelType] = React.useState<'audio' | 'subtitle' | null>(null);
    const [basePlaybackRate, setBasePlaybackRate] = React.useState(carry?.playbackRate ?? 1.0);
    const [temporaryHoldRate, setTemporaryHoldRate] = React.useState<number | null>(null);

    const handleToggleOrientationLock = useCallback(() => {
        if (orientationLocked) {
            // Unlock -> Enable Auto
            VideoOrientationService.enableAuto();
            setOrientationLocked(false);
        } else {
            // Lock -> Disable Auto (Locks to current)
            VideoOrientationService.disableAuto();
            setOrientationLocked(true);
        }
        ui.showControls();
        ui.scheduleAutoHide();
    }, [orientationLocked, ui]);

    // ========================================================================
    // NIGHT MODE STATE
    // ========================================================================

    // Night Mode simply puts a semi-transparent black overlay over the video
    const [nightMode, setNightMode] = React.useState(carry?.nightMode ?? false);

    const toggleNightMode = useCallback(() => {
        setNightMode(prev => !prev);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [ui]);

    // Haptics State (User toggle)
    const [hapticsEnabled, setHapticsEnabled] = React.useState(carry?.hapticsEnabled ?? true);

    const effectivePlaybackRate = useMemo(
        () => temporaryHoldRate ?? basePlaybackRate,
        [temporaryHoldRate, basePlaybackRate]
    );

    // ========================================================================
    // HISTORY HELPERS
    // ========================================================================

    const getResumeState = useCallback(() => {
        const history = getVideoHistory(videoPath);
        if (history) {
            return {
                resumePosition: getResumablePosition(
                    history.lastPausedPosition,
                    history.duration
                ),
                audioTrackId: history.selectedAudioTrackId,
                subtitleTrackIndex: history.selectedSubtitleTrackId,
                audioDelay: history.audioDelay,
                subtitleDelay: history.subtitleDelay,
                brightness: history.brightness,
                duration: history.duration,
            };
        }
        return { resumePosition: null };
    }, [videoPath, getVideoHistory]);

    // Get initial state once
    const {
        resumePosition,
        audioTrackId: initialAudioTrackId,
        subtitleTrackIndex: initialSubtitleTrackIndex,
        audioDelay: initialAudioDelay,
        subtitleDelay: initialSubtitleDelay,
        brightness: initialVideoBrightness,
        duration: savedDuration,
    } = useMemo(() => getResumeState(), [getResumeState]);

    // Determine initial brightness based on mode
    const startBrightness = useMemo(() => {
        if (brightnessMode === 'global') {
            return globalBrightness;
        }
        return initialVideoBrightness;
    }, [brightnessMode, globalBrightness, initialVideoBrightness]);

    // ========================================================================
    // PLAYER HOOKS (ORDER MATTERS - dependencies flow down)
    // ========================================================================

    /**
     * The hooks below need each other in both directions: settings needs the toast that
     * bookmarks owns, the core player needs the track setters, and bookmarks needs the
     * player. Only one declaration order is possible, so the backward references go
     * through these, filled immediately after the hooks have run.
     *
     * They used to be read straight off the later `const`s, which works only because every
     * one of those callbacks happens to run after mount. Any hook that called one while
     * initialising would have thrown a ReferenceError.
     */
    const playerRef = useRef<UsePlayerCoreReturn | null>(null);
    const tracksRef = useRef<UsePlayerTracksReturn | null>(null);
    const showToastRef = useRef<(message: string) => void>(() => { });
    // Leaves like Back does, so an "Open with" video closes its Activity instead of going black.
    const handleGoBackRef = useRef<() => void>(() => { });

    // Settings hook (independent, needed by other hooks)
    const settingsHook = usePlayerSettings({
        showToast: (message) => showToastRef.current(message),
        onSleepTimerEnd: () => handleGoBackRef.current(),
        initialAudioDelay,
        initialSubtitleDelay,
        carried: carry?.settings,
    });

    // Core player hook
    const player = usePlayerCore({
        videoPath,
        getResumePosition: () => resumePosition, // Adapt to hook's expected signature
        sleepTimer: settingsHook.settings.sleepTimer,
        onSleepTimerEnd: () => handleGoBackRef.current(),
        onProgressSave: () => savePlaybackRef.current(),
        onAudioTracksLoaded: (tracks) => tracksRef.current?.setAudioTracksFromNative(tracks),
        onSubtitleTracksLoaded: (tracks) => tracksRef.current?.setSubtitleTracksFromPlayer(tracks),
        initialPaused: false,
        playbackRate: effectivePlaybackRate,
    });

    // PIP Mode State from native listener
    const isInPipMode = usePipModeListener();
    // Auto-enter eligibility only. Whether overlays are on screen no longer
    // matters: the native controller hides everything except the video surface
    // when PiP opens, so blocking PiP while the controls are up would just mean
    // swipe-to-home does nothing for a few seconds after the user taps.
    const pipEnabled = isScreenFocused
        && player.state.isPlaying
        && !player.state.paused;
    const pipPresentationActive = isInPipMode;

    // Hide controls when entering PIP mode (simple effect, no state toggling)
    useEffect(() => {
        if (isInPipMode) {
            ui.hideControls();

            // Handle brightness for PiP
            if (pipBrightnessMode === 'system') {
                // Determine if we need to switch to system brightness
                // If brightness was modified, revert to system (-1)
                BrightnessModule?.resetBrightness?.();
            }
        } else {
            // Exiting PiP - restore player brightness if needed
            if (pipBrightnessMode === 'system' && brightnessRef.current !== undefined) {
                // Convert 0-1 brightness to 0-1 float for setBrightness
                // brightnessRef.current is already 0-1
                BrightnessModule?.setBrightness?.(brightnessRef.current);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInPipMode, pipBrightnessMode]);

    // Gestures hook
    const gestures = usePlayerGestures({
        player,
        ui,
        hud,
        basePlaybackRate,
        onTemporarySpeedChange: setTemporaryHoldRate,
        initialBrightness: startBrightness,
        onBrightnessChange: handleBrightnessChange,
        onBrightnessSave: handleBrightnessSave,
        resizeMode: settingsHook.settings.resizeMode,
        isInPipMode,
    });

    // Tracks hook
    const tracksHook = usePlayerTracks({
        videoPath,
        currentTimeRef: player.currentTimeRef,
        routeHapticCues,
        initialAudioTrackId: initialAudioTrackId,
        initialSubtitleTrackIndex: initialSubtitleTrackIndex,
        subtitleDelay: settingsHook.settings.subtitleDelay,
        defaultAudioLanguage: defaultAudioLanguage,
    });

    playerRef.current = player;
    tracksRef.current = tracksHook;

    // Bookmarks hook (needs player for seek)
    const bookmarksHook = usePlayerBookmarks({
        videoPath,
        videoName,
        duration: player.state.duration,
        currentTimeRef: player.currentTimeRef,
        onSeekToBookmark: player.commitSeek,
    });

    showToastRef.current = bookmarksHook.showToastWithMessage;

    const { runAutoSync, autoSyncRunning } = useSubtitleAutoSync({
        videoPath,
        cues: tracksHook.subtitleCues,
        isExternal: tracksHook.selectedSubtitleTrackIndex === EXTERNAL_SUBTITLE_INDEX,
        enabled: !isNetworkStream,
        currentTimeRef: player.currentTimeRef,
        delayMs: settingsHook.settings.subtitleDelay,
        setDelay: settingsHook.setSubtitleDelay,
        showToast: bookmarksHook.showToastWithMessage,
        selectedAudioTrackIndex: tracksHook.selectedAudioTrackId,
        audioTracksLoaded: tracksHook.audioTracks.length > 0 || player.state.duration > 0,
    });

    // AI Recap & Resume Setup
    // Where "Continue watching" resumes from: the saved position at open, then wherever a long pause began.
    const [promptPosition, setPromptPosition] = React.useState(resumePosition ?? 0);
    const resumeModalSetterRef = useRef<((v: boolean) => void) | null>(null);
    const handleDismissResumeModal = useCallback(() => {
        resumeModalSetterRef.current?.(false);
    }, []);

    // AI Recap Hook
    const recap = usePlayerRecap({
        videoPath,
        videoName,
        cleanTitle,
        albumName,
        imdbId,
        isNetworkStream,
        resumePosition: promptPosition,
        subtitleTracks: tracksHook.subtitleTracks,
        subtitleTracksReady: tracksHook.subtitleTracksReady,
        subtitleCues: tracksHook.subtitleCues,
        onPause: player.pause,
        onDismissResumeModal: handleDismissResumeModal,
        showToast: bookmarksHook.showToastWithMessage,
    });

    // Resume Playback Hook
    const resume = useResumePlayback({
        isNetworkStream,
        resumePosition: promptPosition,
        savedDuration: player.state.duration > 0 ? player.state.duration : savedDuration,
        imdbId,
        albumName,
        isRecapEligible: recap.isRecapEligible,
        recapChecked: recap.recapChecked,
        recapVisible: recap.recapVisible,
        isPaused: player.state.paused,
        currentTimeRef: player.currentTimeRef,
        onPromptPosition: setPromptPosition,
        onPlay: player.play,
        onPause: player.pause,
        onSeekToStart: () => {
            player.clearResumePosition();
            player.commitSeek(0);
        },
        onRecap: recap.handleRecapTrigger,
        onRestartPersist: () => {
            if (videoPath && videoName) {
                const effectiveDuration =
                    player.state.duration > 0
                        ? player.state.duration
                        : (savedDuration ?? 0);
                updatePlaybackPosition(
                    videoPath,
                    videoName,
                    0,
                    effectiveDuration,
                    tracksHook.selectedAudioTrackId,
                    tracksHook.selectedSubtitleTrackIndex ?? undefined,
                    settingsHook.settings.audioDelay,
                    settingsHook.settings.subtitleDelay,
                    brightnessMode === 'video' ? brightnessRef.current : undefined
                );
                persistNow();
            }
        },
    });

    resumeModalSetterRef.current = resume.setResumeModalVisible;

    const {
        recapVisible,
        setRecapVisible,
        recapText,
        isGeneratingRecap,
        setIsGeneratingRecap,
        recapLoadingMessage,
        setRecapLoadingMessage,
    } = recap;

    const {
        resumeModalVisible,
        closeResumeModal,
        resumeModalData,
        handleResumeModalAction,
    } = resume;

    // ========================================================================
    // SAVING LOGIC (Defined after hooks to avoid circular dependencies)
    // ========================================================================

    const savePlaybackProgress = useCallback((atExit = false) => {
        if (!videoPath || !videoName) {return;}

        const isNetwork = NavigationService.isNetworkStream(videoPath);
        if (isNetwork) {return;}

        if (player.state.duration > 0) {
            // Guard: If we have a resume position but the player is still at 0 (or near 0),
            // and we haven't played past it, assume the resume seek hasn't happened yet.
            // This prevents overwriting deep history with 0 on immediate exit.
            const currentTime = player.currentTimeRef.current;
            if (resumePosition && resumePosition > 10 && currentTime < 2) {
                if (__DEV__) {console.log('[VideoPlayer] Skipping save: Player at start but resume expected at', resumePosition);}
                return;
            }

            updatePlaybackPosition(
                videoPath,
                videoName,
                currentTime,
                player.state.duration,
                tracksHook.selectedAudioTrackId,
                tracksHook.selectedSubtitleTrackIndex ?? undefined,
                settingsHook.settings.audioDelay,
                settingsHook.settings.subtitleDelay,
                // Only save brightness to history if in video mode
                brightnessMode === 'video' ? brightnessRef.current : undefined
            );
            // Recents shows the frame you stopped at; a finished video goes back to the
            // usual one rather than the end credits.
            if (atExit) {
                const stopped = currentTime > 0 && currentTime < player.state.duration;
                setStopFrame(videoPath, videoName, stopped ? Math.round(currentTime * 1000) : undefined);
            }
        }
    }, [
        videoPath,
        videoName,
        updatePlaybackPosition,
        setStopFrame,
        player.state.duration,
        player.currentTimeRef,
        tracksHook.selectedAudioTrackId,
        tracksHook.selectedSubtitleTrackIndex,
        settingsHook.settings.audioDelay,
        settingsHook.settings.subtitleDelay,
        brightnessMode,
        resumePosition,
    ]);

    // Keep ref updated for usePlayerCore
    useEffect(() => {
        savePlaybackRef.current = savePlaybackProgress;
    }, [savePlaybackProgress]);

    // Force synchronous save (atomic write)
    const forceSave = useCallback(() => {
        savePlaybackProgress();
        persistNow();
    }, [savePlaybackProgress, persistNow]);

    /**
     * Leaving the player, from wherever. The back button, a navigation pop and the screen
     * unmounting can all fire for a single exit -- and under an external open the Activity
     * finishes without either of the last two -- so every trigger calls this and it runs
     * once. Kept in a ref so the unmount path never holds a stale copy.
     */
    const exitedRef = useRef(false);
    const exitPlayer = useCallback(() => {
        if (exitedRef.current) {return;}
        exitedRef.current = true;

        BrightnessModule?.resetBrightnessSync?.();
        savePlaybackProgress(true);
        persistNow();
        player.stop();
        VideoOrientationService.release();
    }, [savePlaybackProgress, persistNow, player]);

    const exitPlayerRef = useRef(exitPlayer);
    exitPlayerRef.current = exitPlayer;

    // ========================================================================
    // HAPTIC FEEDBACK & SUBTITLE SYNC (UNIFIED TIMER)
    // ========================================================================

    useHapticFeedback({
        enabled: playMode === 'with-haptics' && hapticsEnabled,
        currentTimeRef: player.currentTimeRef,
        subtitleCues: tracksHook.subtitleCues,
        hapticCues: tracksHook.hapticCues,
        isPlaying: player.state.isPlaying,
        subtitleDelay: settingsHook.settings.subtitleDelay,
        playbackRate: effectivePlaybackRate,
    });

    // ========================================================================
    // DERIVED VALUES
    // ========================================================================

    // Use exact device metrics for static margins to avoid "wasted" space while ensuring safety
    const effectiveInsets = useMemo(() => {
        const topInset = initialWindowMetrics?.insets.top ?? 0;
        // Use the actual notch height, but ensure at least 16px padding
        // This is tighter than the previous generic 50px bucket
        const safeMargin = Math.max(topInset, 16);

        return {
            top: safeMargin,
            // Portrait: the real gesture/nav bar inset. Landscape: the bar is at the side.
            bottom: isLandscape ? 20 : Math.max(insets.bottom, 8),
            // The real side insets: the camera cutout in landscape (reported even with the bars
            // hidden), and a side navigation bar. Each on its own side, so the far side is not
            // padded for a cutout it does not have.
            left: insets.left,
            right: insets.right,
        };
    }, [isLandscape, insets.bottom, insets.left, insets.right]);

    // Where the camera cutout is, re-read when a rotation changes the window or its insets.
    const [cutoutRects, setCutoutRects] = React.useState<CutoutRect[] | null>(null);
    useEffect(() => {
        let live = true;
        VideoOrientationService.getCutoutRects().then(rects => { if (live) { setCutoutRects(rects); } });
        return () => { live = false; };
    }, [width, height, insets.left, insets.right]);

    const shouldShowBuffer = useMemo(() =>
        player.state.isVideoLoaded && player.state.isBuffering && !player.state.isSeeking,
        [player.state.isVideoLoaded, player.state.isBuffering, player.state.isSeeking]
    );

    // ========================================================================
    // NAVIGATION HANDLERS
    // ========================================================================

    const handleGoBack = useCallback(() => {
        exitPlayer();

        if (isExternalOpen) {
            finishCurrentActivity().then((finished) => {
                if (!finished) {
                    BackHandler.exitApp();
                }
            }).catch(() => {
                BackHandler.exitApp();
            });
        } else {
            navigation.goBack();
        }
        ui.showControls();
        ui.scheduleAutoHide();
    }, [navigation, exitPlayer, isExternalOpen, ui]);
    handleGoBackRef.current = handleGoBack;

    // Next / Previous / autoplay / a playlist pick remount the screen; this keeps the session.
    const carryNow: PlayerCarry = {
        settings: settingsHook.settings,
        playbackRate: basePlaybackRate,
        nightMode,
        hapticsEnabled,
        orientationLocked,
        screenLocked: ui.state.locked,
    };
    const carryRef = useRef(carryNow);
    carryRef.current = carryNow;

    // Play on the idle player is the retry: native prepares it again from where it failed.
    const handleRetry = useCallback(() => {
        player.clearError();
        player.play();
    }, [player]);

    // Colour enhancement's GL pipeline can fail on some files or GPUs. Turning it off reopens
    // the media at the current position (native), so that is the recovery, not an error card.
    const { videoEnhancement } = settingsHook.settings;
    const { toggleVideoEnhancement } = settingsHook;
    const { handleError: playerHandleError } = player;
    const handlePlayerError = useCallback((e: any) => {
        if (videoEnhancement && isEnhancementError(String(e?.error ?? ''))) {
            toggleVideoEnhancement();
            showSnackbar({ text: "Colour enhancement isn't supported for this video, so it's off", tone: 'reject' });
            return;
        }
        playerHandleError(e);
    }, [videoEnhancement, toggleVideoEnhancement, playerHandleError]);

    const handlePlayVideo = useCallback((video: VideoFile) => {
        ui.closeAllPanels();
        // @ts-ignore
        navigation.replace('VideoPlayer', {
            videoPath: video.path,
            videoName: video.name,
            albumName: albumName || undefined,
            bucketId: routeBucketId || video.bucketId,
            playMode,
            carry: carryRef.current,
        });
    }, [navigation, ui, albumName, routeBucketId, playMode]);

    // ========================================================================
    // CONTROL HANDLERS
    // ========================================================================

    const handleToggleResizeMode = useCallback(() => {
        // Same list as the Display page, so the pill and the panel always agree.
        const nextMode = nextDisplayMode(settingsHook.settings.resizeMode);

        // Update settings and show HUD
        settingsHook.setResizeMode(nextMode);
        hud.showResizeHUD(nextMode);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [settingsHook, hud, ui]);

    // The panel's switch carries the feedback.
    const handleToggleHaptics = useCallback(() => setHapticsEnabled(prev => !prev), []);

    const handleEnterPip = useCallback(() => {
        ui.closeAllPanels();
        ui.hideControls();
        player.videoRef.current?.enterPictureInPicture();
    }, [player, ui]);

    const handleTogglePlayPause = useCallback(() => {
        player.togglePlayPause();
        ui.showControls();
        ui.scheduleAutoHide();
    }, [player, ui]);

    const handleSlidingStart = useCallback(() => {
        setScrubbing(true);
        player.setIsSeeking(true);
    }, [player]);

    // The seek bar's own preview bubble is the readout; no centre pill while scrubbing it.
    const handleSliderChange = useCallback((val: number) => {
        gestures.sharedValues.seekTime.value = val;
        player.previewSeek(val);
    }, [player, gestures]);

    const handleSliderChangeComplete = useCallback((val: number) => {
        player.commitSeek(val);
        hud.hideSeekHUD();
        setScrubbing(false);
        ui.showControls();
    }, [player, hud, ui]);

    // Jump handlers
    const handleJumpBackward = useCallback(() => {
        // If HUD is already showing seek, use its value as base for accumulation
        const isCurrentlySeeking = hud.state.seek.show;
        const baseTime = isCurrentlySeeking
            ? gestures.sharedValues.seekTime.value
            : player.currentTimeRef.current;

        const seekTime = seekDuration || 30;
        const newTime = Math.max(0, baseTime - seekTime);

        // Set start time for difference display - false means don't reset if already seeking
        hud.setSeekStartTime(player.currentTimeRef.current, false);

        // Nothing is shown until the seek is accepted. Before the duration is known the
        // clamp above collapses to 0 and the seek is dropped, so announcing it would
        // display a jump to the start that never happens.
        if (!player.commitSeek(newTime)) {
            return;
        }
        gestures.sharedValues.seekTime.value = newTime;
        hud.showSeekHUD(newTime, 'backward', null, false);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [player, hud, gestures, ui, seekDuration]);

    const handleJumpForward = useCallback(() => {
        // If HUD is already showing seek, use its value as base for accumulation
        const isCurrentlySeeking = hud.state.seek.show;
        const baseTime = isCurrentlySeeking
            ? gestures.sharedValues.seekTime.value
            : player.currentTimeRef.current;

        const seekTime = seekDuration || 30;
        const newTime = Math.min(player.state.duration, baseTime + seekTime);

        // Set start time for difference display - false means don't reset if already seeking
        hud.setSeekStartTime(player.currentTimeRef.current, false);

        // See handleJumpBackward: no HUD until the seek is accepted.
        if (!player.commitSeek(newTime)) {
            return;
        }
        gestures.sharedValues.seekTime.value = newTime;
        hud.showSeekHUD(newTime, 'forward', null, false);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [player, hud, gestures, ui, seekDuration]);

    // ========================================================================
    // QUICK SETTINGS HANDLERS (Memoized)
    // ========================================================================

    const handleQSClose = useCallback(() => ui.closePanel('quickSettings'), [ui]);
    // openPanel closes the Playback panel; these remember where to go back to.
    const openFromPlayback = useCallback((panel: 'playlist' | 'audioSelector' | 'subtitleSelector' | 'bookmarkPanel') => {
        setOpenedFromPlayback(true);
        ui.openPanel(panel);
    }, [ui]);
    const handleQSOpenPlaylist = useCallback(() => openFromPlayback('playlist'), [openFromPlayback]);
    const handleQSOpenAudio = useCallback(() => openFromPlayback('audioSelector'), [openFromPlayback]);
    const handleQSOpenSubtitle = useCallback(() => openFromPlayback('subtitleSelector'), [openFromPlayback]);
    const handleQSOpenBookmarkPanel = useCallback(() => openFromPlayback('bookmarkPanel'), [openFromPlayback]);

    // ========================================================================
    // MEMOIZED CONTROL HANDLERS (Optimization)
    // ========================================================================

    const handleToggleAudio = useCallback(() => {
        setOpenedFromPlayback(false);
        ui.openPanel('audioSelector');
    }, [ui]);

    const handleToggleSubtitle = useCallback(() => {
        setOpenedFromPlayback(false);
        ui.openPanel('subtitleSelector');
    }, [ui]);

    const handleAddBookmark = useCallback(() => {
        bookmarksHook.addBookmark();
        ui.scheduleAutoHide();
    }, [bookmarksHook, ui]);

    const handleToggleBookmarkPanel = useCallback(() => {
        setOpenedFromPlayback(false);
        ui.openPanel('bookmarkPanel');
    }, [ui]);
    const handleTogglePlaylist = useCallback(() => {
        setOpenedFromPlayback(false);
        ui.openPanel('playlist');
    }, [ui]);

    const handleToggleQuickSettings = useCallback(() => ui.openPanel('quickSettings'), [ui]);
    const handleBackToPlayback = useCallback(() => ui.openPanel('quickSettings'), [ui]);

    // The panel shows the value; the hold chip is for the hold gesture.
    const handlePlaybackRateChange = useCallback((rate: number) => {
        setTemporaryHoldRate(null);
        setBasePlaybackRate(rate);
    }, []);

    const handleToggleBackgroundPlay = useCallback(() => {
        settingsHook.toggleBackgroundPlay();
        ui.showControls();
        ui.scheduleAutoHide();
    }, [settingsHook, ui]);

    // ========================================================================
    // PLAYLIST NAVIGATION
    // ========================================================================

    // Get album videos for playlist navigation
    const { videos: albumVideos } = useAlbumVideos(albumName || null, routeBucketId);

    // Find current video index in playlist
    const currentVideoIndex = useMemo(() => {
        return albumVideos.findIndex(v => v.path === videoPath);
    }, [albumVideos, videoPath]);

    // Calculate if we have prev/next videos
    const hasPrevious = currentVideoIndex > 0;
    const hasNext = currentVideoIndex >= 0 && currentVideoIndex < albumVideos.length - 1;

    const handlePrevious = useCallback(() => {
        if (!hasPrevious) {return;}
        const prevVideo = albumVideos[currentVideoIndex - 1];
        if (prevVideo) {
            ui.closeAllPanels();
            navigation.replace('VideoPlayer', {
                videoPath: prevVideo.path,
                videoName: prevVideo.name,
                albumName: albumName || undefined,
                bucketId: routeBucketId || prevVideo.bucketId,
                playMode: playMode,
                carry: carryRef.current,
            });
        }
    }, [hasPrevious, albumVideos, currentVideoIndex, ui, navigation, albumName, routeBucketId, playMode]);

    const handleNext = useCallback(() => {
        if (!hasNext) {return;}
        const nextVideo = albumVideos[currentVideoIndex + 1];
        if (nextVideo) {
            ui.closeAllPanels();
            navigation.replace('VideoPlayer', {
                videoPath: nextVideo.path,
                videoName: nextVideo.name,
                albumName: albumName || undefined,
                bucketId: routeBucketId || nextVideo.bucketId,
                playMode: playMode,
                carry: carryRef.current,
            });
        }
    }, [hasNext, albumVideos, currentVideoIndex, ui, navigation, albumName, routeBucketId, playMode]);

    // ========================================================================
    // UPDATE
    // ========================================================================

    // "Open with" never reaches the library's update prompt, so the player says it, once per
    // release, after the video is under way. ⋮ Playback keeps a row while it is pending.
    const [updateModalVisible, setUpdateModalVisible] = React.useState(false);
    const updatePending = updateStatus.available && !!updateStatus.latestVersion;
    const { pause: pausePlayer } = player;
    const handleOpenUpdate = useCallback(() => {
        ui.closeAllPanels();
        pausePlayer();
        setUpdateModalVisible(true);
    }, [ui, pausePlayer]);
    useEffect(() => {
        if (!isExternalOpen || !updatePending || updateStatus.notified || !player.state.isPlaying) { return; }
        const timer = setTimeout(() => {
            markUpdateNotified();
            showSnackbar({ text: `Glide ${updateStatus.latestVersion} is available`, action: 'View', onAction: handleOpenUpdate });
        }, 1500);
        return () => clearTimeout(timer);
    }, [isExternalOpen, updatePending, updateStatus.notified, updateStatus.latestVersion, player.state.isPlaying,
        markUpdateNotified, handleOpenUpdate]);

    const handleShakeAction = useCallback(() => {
        if (shakeAction === 'play_pause') {
            handleTogglePlayPause();
            return;
        }
        if (shakeAction === 'next') {
            if (!isNetworkStream && hasNext) { handleNext(); }
            return;
        }
        if (shakeAction === 'previous') {
            if (!isNetworkStream && hasPrevious) { handlePrevious(); }
            return;
        }
        if (shakeAction === 'seek_forward') {
            handleJumpForward();
            return;
        }
        if (shakeAction === 'seek_backward') {
            handleJumpBackward();
        }
    }, [
        shakeAction,
        handleTogglePlayPause,
        handleNext,
        handlePrevious,
        handleJumpForward,
        handleJumpBackward,
        hasNext,
        hasPrevious,
        isNetworkStream,
    ]);

    // Leaving the screen inside the autoplay delay must not navigate to the next video afterwards.
    const autoPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (autoPlayTimerRef.current) { clearTimeout(autoPlayTimerRef.current); }
    }, []);

    const handleVideoEnd = useCallback(() => {
        // Always call default player end handler to ensure clean state
        player.handleEnd();

        // Check for auto-play
        // Delay slightly to let player state settle and ensure smooth transition
        if (autoPlayTimerRef.current) { clearTimeout(autoPlayTimerRef.current); }
        autoPlayTimerRef.current = setTimeout(() => {
            autoPlayTimerRef.current = null;
            // "End of video" sleep has already left the player.
            if (autoPlayNext && hasNext && settingsHook.settings.sleepTimer !== -1) {
                handleNext();
            }
        }, 500);
    }, [player, autoPlayNext, hasNext, handleNext, settingsHook.settings.sleepTimer]);

    // ========================================================================
    // LIFECYCLE EFFECTS
    // ========================================================================

    // Update insets ref when controls are visible
    useEffect(() => {
        if (ui.state.controlsVisible && !ui.state.quickSettingsOpen) {
            controlsInsetsRef.current = insets;
        }
    }, [insets, ui.state.controlsVisible, ui.state.quickSettingsOpen]);

    // Pause when quick settings is open
    useEffect(() => {
        if (ui.state.quickSettingsOpen && player.state.isPlaying) {
            player.pause();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ui.state.quickSettingsOpen, player.state.isPlaying]);

    // App state handling - respect background play setting
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
            const wasBackgrounded = appStateRef.current === 'background' || appStateRef.current === 'inactive';

            if (nextState === 'active' && wasBackgrounded && !isInPipMode) {
                const brightnessToRestore = brightnessRef.current;
                if (brightnessToRestore !== undefined) {
                    if (BrightnessModule?.setBrightnessSync) {
                        BrightnessModule.setBrightnessSync(brightnessToRestore);
                    } else {
                        BrightnessModule?.setBrightness?.(brightnessToRestore);
                    }
                }
            }

            if (nextState === 'background' || nextState === 'inactive') {
                // We rely on the native player's onHostPause to handle background behavior.
                // But we MUST save progress synchronously here to prevent data loss if app is killed.
                forceSave();
            }

            appStateRef.current = nextState;
        });
        return () => subscription.remove();
    }, [forceSave, isInPipMode]);

    // Increment view count on first play
    useEffect(() => {
        const isNetwork = NavigationService.isNetworkStream(videoPath);
        if (!isNetwork && player.state.isPlaying && !hasIncrementedView.current && videoPath && videoName) {
            incrementViewCount(videoPath, videoName, contentUri); // Pass contentUri for history storage
            hasIncrementedView.current = true;
        }
    }, [player.state.isPlaying, videoPath, videoName, contentUri, incrementViewCount]);

    // Periodic progress save, plus one on pause -- which is where the interval's cleanup
    // runs, and the moment the position is worth keeping. The interval itself only has to
    // cover the app being killed outright mid-playback.
    useEffect(() => {
        if (!player.state.isPlaying || !videoPath || !videoName) {return;}

        const intervalId = setInterval(() => {
            savePlaybackProgress();
        }, PLAYER_CONSTANTS.PROGRESS_SAVE_INTERVAL_MS);

        return () => {
            clearInterval(intervalId);
            savePlaybackProgress();
        };
    }, [player.state.isPlaying, videoPath, videoName, savePlaybackProgress]);

    // Cleanup on unmount
    useEffect(() => {
        return () => exitPlayerRef.current();
    }, []);

    // Set orientation immediately on mount (avoid waiting for nav transition). A rotation
    // lock carried from the previous video holds; the toggle handles changes after that.
    useEffect(() => {
        if (orientationLocked || ui.state.locked) { VideoOrientationService.disableAuto(); } else { VideoOrientationService.enableAuto(); }
        return () => {
            VideoOrientationService.release();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
    }, []);

    // Back button handler
    useEffect(() => {
        const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
            // Both Activities share this runtime, so a Back pressed in the library while this
            // video is in PiP or playing behind it reaches this handler first. It is not ours.
            if (isInPipMode) { return false; }
            const front = currentActivityName();
            if (isExternalOpen && front !== undefined && front !== 'VideoPlayerActivity') {
                return false;
            }
            // Portrait panels are Modals and take Back themselves; landscape side panels and
            // the floating sync panel are plain views, so Back closes them here.
            if (syncPanelType) { setSyncPanelType(null); return true; }
            if (anyPanelOpen(ui.state)) { ui.closeAllPanels(); return true; }
            handleGoBack();
            return true;
        });
        return () => backHandler.remove();
    }, [handleGoBack, isInPipMode, isExternalOpen, syncPanelType, ui]);

    // Navigation beforeRemove
    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', () => exitPlayer());
        return unsubscribe;
    }, [navigation, exitPlayer]);

    // Controls only auto-hide while playing and not scrubbing.
    const displayPaused = player.state.paused || resumeModalVisible || recapVisible;
    const controlsShown = ui.state.controlsVisible && !ui.state.locked;
    const { setAutoHideBlocked } = ui;
    useEffect(() => {
        setAutoHideBlocked(displayPaused || scrubbing);
    }, [displayPaused, scrubbing, setAutoHideBlocked]);

    const bookmarkTimes = useMemo(() => bookmarksHook.bookmarks.map(b => b.timestamp), [bookmarksHook.bookmarks]);

    const handleCues = useCallback((event: any) => {
        const rawCues = event?.cues;
        if (Array.isArray(rawCues) && rawCues.length > 0) {
            const text = rawCues.map((c: any) => c.text).filter(Boolean).join('\n');
            if (text) {
                const now = player.currentTimeRef.current;
                useSubtitleCueStore.getState().setCurrentCue({
                    index: 0,
                    text,
                    startTime: now,
                    endTime: now + 2,
                });
                return;
            }
        }
        useSubtitleCueStore.getState().clearCue();
    }, [player.currentTimeRef]);

    // System bars
    useEffect(() => {
        SystemBars.setHidden(!ui.state.controlsVisible);
        SystemBars.setStyle('auto');
        return () => {
            SystemBars.setHidden(false);
            SystemBars.setStyle(theme.dark ? 'light' : 'dark');
        };
    }, [ui.state.controlsVisible, theme.dark]);

    // ========================================================================
    // RENDER
    // ========================================================================

    return (
        <View style={styles.container}>
            {/* Video with gestures */}
            <GestureDetector gesture={gestures.composedGesture}>
                <View style={styles.video}>
                    <AnimatedVideoView
                        ref={player.videoRef}
                        source={source}
                        paused={player.state.paused || resumeModalVisible || recapVisible}
                        rate={effectivePlaybackRate}
                        muted={settingsHook.settings.muted || resumeModalVisible}
                        // "End of video" sleep needs the end, which native looping never reaches.
                        repeat={settingsHook.settings.repeat && settingsHook.settings.sleepTimer !== -1}
                        resizeMode={settingsHook.settings.resizeMode}
                        playInBackground={settingsHook.settings.backgroundPlayEnabled}
                        pipEnabled={pipEnabled}
                        pipPresentationActive={pipPresentationActive}
                        videoEnhancement={settingsHook.settings.videoEnhancement}
                        videoEnhancementStrength={settingsHook.settings.videoEnhancementStrength}
                        audioTrack={tracksHook.selectedAudioTrackId}
                        textTrack={tracksHook.nativeTextTrackOrdinal}
                        title={videoName}
                        artist={albumName || 'Glide'}
                        animatedStyle={gestures.videoAnimatedStyle}
                        audioEqualizer={settingsHook.audioEqualizer}
                        audioDelay={settingsHook.settings.audioDelay}
                        initialResumeSeconds={resumePosition ?? undefined}
                        onLoad={player.handleLoad}
                        onProgress={player.handleProgress}
                        onEnd={handleVideoEnd}
                        onError={handlePlayerError}
                        onBuffering={player.handleBuffering}
                        onPlaying={player.handlePlaying}
                        onPaused={player.handlePaused}
                        onStopped={player.handleStopped}
                        onSeek={player.handleSeek}
                        onCues={handleCues}
                    />
                </View>
            </GestureDetector>



            {shakeEnabled && (
                <ShakeDetector
                    onShake={handleShakeAction}
                    shakeThreshold={shakeThreshold}
                    isLocked={ui.state.locked}
                    isSeeking={player.state.isSeeking}
                    isInPip={isInPipMode}
                    isQuickSettingsOpen={ui.state.quickSettingsOpen}
                />
            )}

            {/* Floating Sync Panel */}
            {!pipPresentationActive && syncPanelType && (
                <FloatingSyncPanel
                    type={syncPanelType}
                    value={syncPanelType === 'audio' ? settingsHook.settings.audioDelay : settingsHook.settings.subtitleDelay}
                    onChange={syncPanelType === 'audio' ? settingsHook.setAudioDelay : settingsHook.setSubtitleDelay}
                    onClose={() => setSyncPanelType(null)}
                    subtitleCues={tracksHook.subtitleCues}
                    subtitleCuesLoading={tracksHook.subtitleCuesLoading}
                    currentTimeRef={player.currentTimeRef}
                    onAutoSync={syncPanelType === 'subtitle' && !isNetworkStream ? runAutoSync : undefined}
                    autoSyncRunning={autoSyncRunning}
                />
            )}

            {/* Status Bar for Edge-to-Edge */}
            <SystemBars style="light" />

            {/* Night Mode Overlay - Sits between video and controls/HUD */}
            {!pipPresentationActive && nightMode && (
                <View
                    style={styles.nightMode}
                    pointerEvents="none"
                />
            )}

            {/* HUD indicators */}
            {!pipPresentationActive && (
                <VideoHUD
                    showBrightnessHUD={hud.state.brightness.show}
                    brightnessHUD={gestures.sharedValues.currentBrightness}
                    showVolumeHUD={hud.state.volume.show}
                    volumeHUD={gestures.sharedValues.currentVolume}
                    maxVolume={gestures.maxVolume}
                    showSpeedHUD={hud.state.speed.show}
                    playbackRate={effectivePlaybackRate}
                    zoomActive={hud.state.zoom.scale > 1}
                    zoomHUDScale={hud.state.zoom.scale}
                    ripple={hud.state.ripple}
                    showResizeHUD={hud.state.resize.show}
                    resizeMode={hud.state.resize.mode}
                    paused={player.state.paused}
                    controlsVisible={controlsShown}
                    topInset={effectiveInsets.top}
                />
            )}

            {/* Controls - hide in PIP mode. Mounted while hidden so they can fade out. */}
            {!pipPresentationActive && (
                <PlayerControls
                    showControls={controlsShown}
                    title={displayTitle.title}
                    subtitle={joinMeta(displayTitle.detail, albumName) || undefined}
                    videoEnhancement={settingsHook.settings.videoEnhancement}
                    onToggleVideoEnhancement={settingsHook.toggleVideoEnhancement}
                    onBack={handleGoBack}
                    onOpenSubtitles={handleToggleSubtitle}
                    onOpenAudio={handleToggleAudio}
                    onAddBookmark={isNetworkStream ? undefined : handleAddBookmark}
                    onOpenPlayback={handleToggleQuickSettings}
                    playbackRate={basePlaybackRate}
                    paused={displayPaused}
                    onTogglePlayPause={handleTogglePlayPause}
                    currentTime={player.currentTimeShared}
                    duration={player.durationShared}
                    currentTimeSeconds={player.currentTimeRef.current}
                    durationSeconds={player.state.duration}
                    seekPreviewTime={gestures.sharedValues.seekTime}
                    isScrubbingShared={player.isScrubbingShared}
                    swipeSeeking={gestures.sharedValues.swipeSeeking}
                    swipeSeekStart={gestures.sharedValues.swipeSeekStart}
                    screenReaderEnabled={ui.screenReaderEnabled}
                    onSeekStart={handleSlidingStart}
                    onSeek={handleSliderChange}
                    onSeekComplete={handleSliderChangeComplete}
                    bookmarks={isNetworkStream ? undefined : bookmarkTimes}
                    buffering={shouldShowBuffer}
                    isLandscape={isLandscape}
                    insets={effectiveInsets}
                    cutouts={cutoutRects}
                    onOpenBookmarks={isNetworkStream ? undefined : handleToggleBookmarkPanel}
                    onOpenPlaylist={isNetworkStream ? undefined : handleTogglePlaylist}
                    onNext={!isNetworkStream && hasNext ? handleNext : undefined}
                    onJumpBackward={handleJumpBackward}
                    onJumpForward={handleJumpForward}
                    onLockScreen={ui.lock}
                    nightModeActive={nightMode}
                    onToggleNightMode={toggleNightMode}
                    muted={settingsHook.settings.muted}
                    onToggleMute={settingsHook.toggleMute}
                    orientationLocked={orientationLocked}
                    onToggleOrientationLock={handleToggleOrientationLock}
                    onToggleResizeMode={handleToggleResizeMode}
                    resizeMode={settingsHook.settings.resizeMode}
                    onEnterPip={handleEnterPip}
                    showSeekButtons={showSeekButtons}
                    seekDuration={seekDuration}
                />
            )}

            {/* Locked: a tap on the video shows this chip; only the chip unlocks */}
            {!pipPresentationActive && (
                <LockButton
                    visible={ui.state.locked && ui.state.lockIconVisible}
                    onUnlock={ui.unlock}
                    top={effectiveInsets.top + 12}
                    left={16 + (isLandscape
                        ? cutoutInset('left', insets.left, cutoutRects, width, effectiveInsets.top + 12, effectiveInsets.top + 60)
                        : effectiveInsets.left)}
                />
            )}

            {/* Quick settings panel */}
            {!pipPresentationActive && ui.state.quickSettingsOpen && (
                <QuickSettingsPanel
                    onClose={handleQSClose}
                    playbackRate={basePlaybackRate}
                    onPlaybackRateChange={handlePlaybackRateChange}
                    muted={settingsHook.settings.muted}
                    onToggleMute={settingsHook.toggleMute}
                    repeat={settingsHook.settings.repeat}
                    onToggleRepeat={settingsHook.toggleRepeat}
                    sleepTimer={settingsHook.settings.sleepTimer}
                    sleepTimerEndsAt={settingsHook.settings.sleepTimerEndsAt}
                    updateVersion={updatePending ? updateStatus.latestVersion : null}
                    onOpenUpdate={handleOpenUpdate}
                    onSetSleepTimer={settingsHook.setSleepTimer}
                    onOpenPlaylist={isNetworkStream ? undefined : handleQSOpenPlaylist}
                    onOpenAudio={handleQSOpenAudio}
                    onOpenSubtitle={handleQSOpenSubtitle}
                    onOpenBookmarkPanel={isNetworkStream ? undefined : handleQSOpenBookmarkPanel}
                    onAddBookmark={isNetworkStream ? undefined : bookmarksHook.addBookmark}
                    resizeMode={settingsHook.settings.resizeMode}
                    onSetResizeMode={settingsHook.setResizeMode}
                    isLandscape={isLandscape}
                    insets={effectiveInsets}
                    enableHaptics={playMode === 'with-haptics'}
                    shakeEnabled={shakeEnabled}
                    onToggleShake={() => setShakeEnabled(!shakeEnabled)}
                    shakeAction={shakeAction}
                    onSelectShakeAction={setShakeAction}
                    seekDuration={seekDuration}
                    videoEnhancement={settingsHook.settings.videoEnhancement}
                    onToggleVideoEnhancement={settingsHook.toggleVideoEnhancement}
                    videoEnhancementStrength={settingsHook.settings.videoEnhancementStrength}
                    nightModeActive={nightMode}
                    onToggleNightMode={toggleNightMode}
                    backgroundPlayEnabled={settingsHook.settings.backgroundPlayEnabled}
                    onToggleBackgroundPlay={handleToggleBackgroundPlay}
                    hapticsEnabled={playMode === 'with-haptics' ? hapticsEnabled : undefined}
                    onToggleHaptics={playMode === 'with-haptics' ? handleToggleHaptics : undefined}
                    onSetVideoEnhancementStrength={settingsHook.setVideoEnhancementStrength}
                    audioValue={tracksHook.audioTracksForSelector.find(t => t.index === tracksHook.selectedAudioTrackId)?.title}
                    subtitleValue={tracksHook.subtitleTracksForSelector.find(t => t.index === tracksHook.selectedSubtitleTrackIndex)?.title ?? 'Off'}
                />
            )}

            {/* Playlist panel */}
            {!pipPresentationActive && !isNetworkStream && (
                <PlaylistPanel
                    visible={ui.state.playlistOpen}
                    onClose={() => ui.closePanel('playlist')}
                    onBack={openedFromPlayback ? handleBackToPlayback : undefined}
                    currentVideoPath={videoPath}
                    onPlayVideo={handlePlayVideo}
                    isLandscape={isLandscape}
                    albumName={albumName ?? undefined}
                    bucketId={routeBucketId}
                />
            )}

            {/* Track selectors */}
            <View style={styles.modalPortalWrapper} pointerEvents="box-none">
                {!pipPresentationActive && ui.state.audioSelectorOpen && (
                    <TrackSelector
                        visible={ui.state.audioSelectorOpen}
                        onClose={() => ui.closePanel('audioSelector')}
                        onBack={openedFromPlayback ? handleBackToPlayback : undefined}
                        tracks={tracksHook.audioTracksForSelector}
                        selectedTrackIndex={tracksHook.selectedAudioTrackId}
                        onSelectTrack={tracksHook.selectAudioTrack}
                        type="audio"
                        equalizerEnabled={settingsHook.settings.equalizerEnabled}
                        equalizerPreset={settingsHook.settings.equalizerPreset}
                        onToggleEqualizer={settingsHook.toggleEqualizer}
                        onSelectPreset={settingsHook.setEqualizerPreset}
                        equalizerBands={settingsHook.settings.customEqualizerBands}
                        onSetEqualizerBand={settingsHook.setSingleBand}
                        onResetEqualizer={() => {
                            settingsHook.setEqualizerPreset('flat');
                            settingsHook.setCustomEqualizerBands([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
                        }}
                        onOpenSyncPanel={(type) => {
                            setSyncPanelType(type);
                            ui.closeAllPanels();
                        }}
                    />
                )}
                {!pipPresentationActive && ui.state.subtitleSelectorOpen && (
                    <TrackSelector
                        visible={ui.state.subtitleSelectorOpen}
                        onClose={() => ui.closePanel('subtitleSelector')}
                        onBack={openedFromPlayback ? handleBackToPlayback : undefined}
                        tracks={tracksHook.subtitleTracksForSelector}
                        selectedTrackIndex={tracksHook.selectedSubtitleTrackIndex}
                        onSelectTrack={tracksHook.selectSubtitleTrack}
                        type="subtitle"
                        onLoadExternalCues={tracksHook.loadExternalCues}
                        onLoadSDHForHaptics={tracksHook.loadSDHForHaptics}
                        externalSubtitles={tracksHook.externalSubtitles}
                        currentExternalName={tracksHook.currentExternalName || undefined}
                        videoName={videoName}
                        apiSubtitles={apiSubtitles}
                        imdbId={imdbId}
                        onOpenSyncPanel={(type) => {
                            setSyncPanelType(type);
                            ui.closeAllPanels();
                        }}
                    />
                )}
            </View>

            {/* Subtitle overlay */}
            {!pipPresentationActive && (
                <PlayerSubtitleOverlay isLandscape={isLandscape} />
            )}

            {/* Bookmark panel */}
            {!pipPresentationActive && !isNetworkStream && (
                <BookmarkPanel
                    visible={ui.state.bookmarkPanelOpen}
                    bookmarks={bookmarksHook.bookmarks}
                    currentTime={player.currentTimeShared}
                    onClose={() => ui.closePanel('bookmarkPanel')}
                    onBack={openedFromPlayback ? handleBackToPlayback : undefined}
                    onSelectBookmark={bookmarksHook.jumpToBookmark}
                    onDeleteBookmark={bookmarksHook.deleteBookmark}
                    formatTime={formatTime}
                />
            )}

            {/* AI Recap Modal */}
            {!pipPresentationActive && !isNetworkStream && (
                <View style={styles.modalPortalWrapper} pointerEvents="box-none">
                    <RecapModal
                        visible={recapVisible}
                        onClose={() => {
                            setRecapVisible(false);
                            setIsGeneratingRecap(false);
                            setRecapLoadingMessage(undefined);
                            player.play(); // Resume video playback
                        }}
                        recapText={recapText}
                        videoName={cleanTitle || albumName || videoName}
                        isLoading={isGeneratingRecap}
                        loadingMessage={recapLoadingMessage}
                    />
                </View>
            )}

            <UpdateModal
                visible={updateModalVisible}
                latestVersion={updateStatus.latestVersion}
                releaseNotes={updateStatus.releaseNotes}
                releaseUrl={updateStatus.releaseUrl}
                apkUrl={updateStatus.apkUrl}
                apkSha256Url={updateStatus.apkSha256Url}
                onDismiss={() => setUpdateModalVisible(false)}
            />

            {/* Resume Modal */}
            {!pipPresentationActive && !isNetworkStream && (
                <View style={styles.modalPortalWrapper} pointerEvents="box-none">
                    <ResumeModal
                        visible={resumeModalVisible}
                        formattedResumeTime={resumeModalData?.formattedTime || ''}
                        remainingTime={resumeModalData?.remainingTime}
                        finishByTime={resumeModalData?.finishByTime}
                        showRecapOption={!!resumeModalData?.showRecap}
                        isGeneratingRecap={isGeneratingRecap}
                        recapChecking={!!resumeModalData?.recapChecking}
                        onResume={() => handleResumeModalAction('resume')}
                        onRestart={() => handleResumeModalAction('restart')}
                        onRecap={() => handleResumeModalAction('recap')}
                        onClose={closeResumeModal}
                    />
                </View>
            )}

            {!pipPresentationActive && !!player.state.errorText && (
                <PlayerErrorCard
                    code={player.state.errorText}
                    onRetry={handleRetry}
                    onNext={!isNetworkStream && hasNext ? handleNext : undefined}
                    onClose={handleGoBack}
                />
            )}

            {/* Above everything, clear of the seek bar and tools row when they show */}
            {!pipPresentationActive && <SnackbarHost bottomOffset={controlsShown ? 96 : 0} />}
        </View>
    );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'black',
    },
    video: { ...StyleSheet.absoluteFill, zIndex: 0 },
    nightMode: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1 },
    modalPortalWrapper: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // Above PlayerControls (10): zIndex only orders siblings, so the wrapper itself needs it.
        zIndex: 50,
        elevation: 10,
    },
});



