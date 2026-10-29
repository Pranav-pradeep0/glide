// src/types/index.ts
import type { NavigatorScreenParams } from '@react-navigation/native';


/**
 * What another app sent with a video beyond its link (the MX Player / VLC extras): request
 * headers, subtitle files, the videos that follow it, and whether the link may be shown.
 */
export interface ExternalOpen {
    headers?: Record<string, string>;
    subtitles?: { uri: string; name: string; enable: boolean }[];
    playlist?: { uri: string; name: string }[];
    /** secure_uri: never show the link, or names taken from it. */
    secureUri?: boolean;
}

export interface VideoFile {
    id?: string;
    name: string;
    path: string;
    uri?: string; // Original content:// URI needed for CameraRoll.deletePhotos
    size: number;
    modifiedDate: number;
    duration: number; // in seconds
    width?: number;
    height?: number;
    isDirectory: boolean;
    album?: string;
    bucketId?: string;
}

export interface VideoFolder {
    id: string;
    title: string;
    count: number;
    newestTimestamp: number;
    firstVideoUri: string;
    firstVideoPath: string;
}

export interface SubtitleCue {
    index: number;
    startTime: number; // in seconds
    endTime: number;
    text: string;
    soundEffect?: string;
}


export interface SubtitleResult {
    id: string;
    name: string;
    language: string;
    release: string;
    downloadUrl: string;
    author: string;
    rating: number;
    // SDH-related fields
    hearingImpaired?: boolean;
    sdhScore?: number;
    comment?: string;
}

export interface SubtitleSettings {
    fontSize: number;
    textColor: string;
    backgroundColor: string;
    verticalPosition: number;
    delay: number;
}

/** How few moments are felt and how far they stand out (native HapticDirector.Preset). */
export type HapticPreset = 'subtle' | 'cinematic' | 'intense';

export interface HapticSettings {
    enabled: boolean;
    /**
     * Slider position 0..1 on a dB scale, like volume (native HapticDirector.strength). The
     * preset is the nearest stop on it (hapticPresetAt).
     */
    strength: number;
}

export interface AppSettings {
    darkMode: boolean;
    hapticSettings: HapticSettings;
    subtitleFontSize: number;
    subtitleColor: string;
    subtitleFontWeight: number; // 400-900
    subtitleOutlineWidth: number; // 0-6
    subtitleBackgroundColor: string;
    subtitleBackgroundOpacity: number;
    subtitleEdgeStyle: 'none' | 'outline' | 'dropShadow';
    subtitleFontFamily?: string;
    subtitlePositionPortrait: number;
    subtitlePositionLandscape: number;

    hasCompletedOnboarding: boolean;
    brightnessMode: 'global' | 'video';
    pipBrightnessMode: 'system' | 'player'; // New setting for PiP brightness behavior
    globalBrightness: number;

    // Playback settings
    showSeekButtons: boolean; // Show ±seek buttons in player controls
    seekDuration: number; // Seek duration in seconds (5, 10, 15, 30, 60)

    autoPlayNext: boolean; // Auto-play next video in folder
    defaultAudioLanguage: string | null; // Preferred audio language (matches substring in track name)
    shakeThreshold: number; // Shake intensity threshold in g units
    shakeEnabled: boolean; // Shake-to-control enabled
    shakeAction: ShakeAction; // Action triggered by shake gesture
    onlineLyricsEnabled: boolean; // Fetch lyrics online via LRCLIB
    crashReportsEnabled: boolean; // After a crash, offer to email a report (ACRA)
}

export type ShakeAction = 'play_pause' | 'next' | 'previous' | 'seek_forward' | 'seek_backward';

export interface PlayerState {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    isLoading: boolean;
    playbackRate: number;
    volume: number;
    isFullscreen: boolean;
    showControls: boolean;
    isControlsLocked: boolean;
}

export interface GestureState {
    brightness: number;
    volume: number;
    seekPosition: number;
}

export type SortOption = 'name' | 'date' | 'size';

export type PlayMode = 'with-haptics' | 'normal';

/** A folder's order: name (episode order for a series), newest first, or largest first. */
export type VideoSort = 'name' | 'date' | 'size';

export type RootStackParamList = {
    Onboarding: undefined;
    MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
    PlayerDetail: {
        videoPath: string;
        videoName: string;
        contentUri?: string; // Original content:// URI for CameraRoll operations
        albumName?: string;
        bucketId?: string;
        imdbId?: string;
        // The order picked on the folder screen, passed on to the player
        videoSort?: VideoSort;
        // Seconds: the opening app's resume point, passed on to the player
        startPosition?: number;
        external?: ExternalOpen;
    };
    VideoPlayer: {
        videoPath: string;
        videoName: string;
        contentUri?: string; // Original content:// URI for CameraRoll operations
        cleanTitle?: string;
        albumName?: string;
        bucketId?: string;
        imdbId?: string;
        playMode?: PlayMode;
        subtitlePath?: string;
        // If true, exit app on back press instead of navigating back
        isExternalOpen?: boolean;
        // Seconds: the opening app's resume point (Stremio's)
        startPosition?: number;
        external?: ExternalOpen;
        // Started from a folder's "Play all": plays through even with auto-play next off
        playAll?: boolean;
        // The folder screen's order, so Next / Previous / the playlist follow it
        videoSort?: VideoSort;
        // Opened by Previous: the screen slides in from the left
        previous?: boolean;
    };
    AlbumVideos: {
        albumTitle: string;
        bucketId?: string;
        videoCount: number;
    };
    Search: undefined;
    /** Network shares, phones only: TV has it in the rail (MainTabParamList). */
    NetworkShares: undefined;
    /** A folder on a network share: `smb://host/share/path`. */
    NetworkFolder: { uri: string; title: string };
    NowPlaying: undefined;
    AlbumDetail: {
        albumId: string;
        albumTitle: string;
        artist: string;
        artworkUri?: string | null;
        firstSongUri?: string;
    };
    ArtistDetail: {
        artistId: string;
        artistName: string;
    };
    HapticsLab: undefined;
};

export interface AudioTrack {
    id: string;
    title: string;
    artist: string;
    artistId?: string;
    album: string;
    albumId: string;
    duration: number; // in seconds
    path: string;
    uri: string; // content:// URI
    size: number;
    trackNumber: number;
    year?: number;
    dateAdded?: number;
    artworkUri?: string | null;
    primaryColor?: string | null;
}

export interface AudioAlbum {
    id: string;
    album: string;
    artist: string;
    numberOfSongs: number;
    year?: number;
    artworkUri?: string | null;
    firstSongUri?: string;
    primaryColor?: string | null;
}

export interface AudioArtist {
    id: string;
    artist: string;
    numberOfAlbums: number;
    numberOfTracks: number;
}

export interface AudioFolder {
    path: string;
    name: string;
    numberOfSongs: number;
}

export interface LyricLine {
    time: number; // seconds
    text: string;
}

export type AudioRepeatMode = 'off' | 'all' | 'one';

export interface VideoBookmark {
    id: string;
    label?: string;
    timestamp: number;
    createdAt: number;
}

export interface VideoHistoryEntry {
    videoPath: string;
    videoName: string;
    videoId: string; // Canonical identifier based on name (+ optional size) for deduplication
    contentUri?: string; // Original content:// URI for CameraRoll.deletePhotos
    hideFromRecents?: boolean; // If true, entry is hidden from Recents list but state is still saved
    lastWatchedTime: number; // timestamp when last watched
    lastPausedPosition: number; // seconds
    duration: number;
    viewCount: number;
    bookmarks: VideoBookmark[];
    /**
     * Where you stopped, in ms, for Recents' thumbnail. Set only on leaving the player: the
     * periodic position save would ask for a new frame every few seconds of watching.
     * Unset (finished, or never left at a position) means the usual smart-scan frame.
     */
    stopFrameMs?: number;
    fileSize?: number;
    selectedAudioTrackId?: number;
    selectedSubtitleTrackId?: number; // Index of the subtitle track
    audioDelay?: number;
    subtitleDelay?: number;
    /** Frame-rate retiming from auto sync; unset means 1. */
    subtitleRatio?: number;
    brightness?: number;
    /** An app link's request headers, sent again on replay. */
    headers?: Record<string, string>;
    /** secure_uri: never show the link. */
    secureUri?: boolean;
}

export type MainTabParamList = {
    Folders: undefined;
    Recents: undefined;
    /** TV only. */
    Network: undefined;
    Music: undefined;
    Settings: undefined;
};
