// src/types/index.ts
import type { NavigatorScreenParams } from '@react-navigation/native';


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

// Simplified Haptic-specific settings - single intensity value controls everything
export interface HapticSettings {
    enabled: boolean;
    intensity: number; // 1-255, controls all haptic strength (default: 128)
}

export interface AppSettings {
    darkMode: boolean;
    hapticSettings: HapticSettings;
    autoDownloadSubtitles: boolean;
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
        // Pre-loaded haptic cues (independent of display subtitles)
        hapticCues?: SubtitleCue[];
        // API subtitles for user selection
        apiSubtitles?: SubtitleResult[];
        // If true, exit app on back press instead of navigating back
        isExternalOpen?: boolean;
        // Started from a folder's "Play all": plays through even with auto-play next off
        playAll?: boolean;
    };
    AlbumVideos: {
        albumTitle: string;
        bucketId?: string;
        videoCount: number;
    };
    Search: undefined;
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
    brightness?: number;
}

export type MainTabParamList = {
    Folders: undefined;
    Recents: undefined;
    Music: undefined;
    Settings: undefined;
};
