import * as RNFS from '@dr.pogodin/react-native-fs';
import { BUILD_ENV } from '@/native/GlideNative';

export const VIDEO_EXTENSIONS = [
    '.mp4', '.mkv', '.avi', '.mov', '.flv',
    '.webm', '.m4v', '.3gp', '.mpeg', '.mpg',
];

export const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa'];

export const SUBTITLE_FONT_SIZES = [14, 18, 22, 26, 30];

export const SUBTITLE_COLORS = [
    { name: 'White', value: '#FFFFFF' },
    { name: 'Yellow', value: '#FFFF00' },
    { name: 'Cyan', value: '#00FFFF' },
    { name: 'Green', value: '#00FF00' },
    { name: 'Orange', value: '#FF9500' },
    { name: 'Pink', value: '#FF6B9D' },
    { name: 'Purple', value: '#AF52DE' },
    { name: 'Blue', value: '#007AFF' },
    { name: 'Red', value: '#FF3B30' },
    { name: 'Gray', value: '#8E8E93' },
];

export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

// SubDL API
export const SUBDL_API_URL = BUILD_ENV.SUBDL_API_URL || 'https://api.subdl.com/api/v1/subtitles';
export const SUBDL_API_KEY = BUILD_ENV.SUBDL_API_KEY || '';
export const SUBDL_DOWNLOAD_URL = BUILD_ENV.SUBDL_DOWNLOAD_URL || 'https://dl.subdl.com';

// OMDB API (1,000 free requests/day)
export const OMDB_API_KEY = BUILD_ENV.OMDB_API_KEY || '';
export const OMDB_API_URL = BUILD_ENV.OMDB_API_URL || 'https://www.omdbapi.com';

const configuredAiProxyUrl = (BUILD_ENV.AI_PROXY_URL || '').trim().replace(/\/+$/, '');
export const AI_PROXY_URL = configuredAiProxyUrl.startsWith('https://') ? configuredAiProxyUrl : '';
export const RECAP_AVAILABLE = AI_PROXY_URL.length > 0;

// GitHub Releases (Update Check)
export const GITHUB_OWNER = BUILD_ENV.GITHUB_OWNER || '';
export const GITHUB_REPO = BUILD_ENV.GITHUB_REPO || '';
export const GITHUB_RELEASES_URL = BUILD_ENV.GITHUB_RELEASES_URL || '';

// export const DEFAULT_STORAGE_PATH = '/storage/emulated/0/Movies';
export const DEFAULT_STORAGE_PATH = RNFS.ExternalStorageDirectoryPath;

// Haptic Configuration
export const MAX_HAPTICS_PER_SECOND = 3;
export const MIN_HAPTIC_DURATION_MS = 50;
export const MAX_HAPTIC_DURATION_MS = 5000;
export const AMPLITUDE_RANGE = { MIN: 0, MAX: 255 };

// Haptic Intensity Multipliers for low/medium/high
export const HAPTIC_INTENSITY_MULTIPLIERS: Record<'low' | 'medium' | 'high', number> = {
    low: 0.5,
    medium: 1.0,
    high: 1.5,
};

// Base intensities for each haptic category (extracted from HapticPatternGenerator)
export const BASE_HAPTIC_INTENSITIES = {
    oscillating: 8,
    textured: 20,
    rhythmic: 12,
    impact: 30,
};
