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

// export const DEFAULT_STORAGE_PATH = '/storage/emulated/0/Movies';
export const DEFAULT_STORAGE_PATH = RNFS.ExternalStorageDirectoryPath;


// Served by GitHub Pages from the public repo; the Play listing links the same page.
export const PRIVACY_POLICY_URL = 'https://pranav-pradeep0.github.io/glide-public/privacy';
