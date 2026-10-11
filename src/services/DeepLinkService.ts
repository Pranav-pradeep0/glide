import { Linking, NativeModules, Platform } from 'react-native';
import { FileService } from './FileService';

const LOG_PREFIX = '[DeepLinkService]';

export class DeepLinkService {
    static readonly VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.webm', '.m4v', '.3gp', '.ts', '.mpg', '.mpeg', '.m3u8', '.wmv', '.asf'];
    static readonly AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.wma', '.alac', '.mka', '.mid', '.midi'];

    /**
     * The file extension a URI ends in, lower case and including the dot. Read from the last
     * path segment only: an authority like `com.foo.tsprovider` is not a `.ts` file, and
     * `Trip.movies/clip` is not a `.mov` one.
     */
    private static extensionOf(uri: string): string {
        const name = this.getVideoNameFromUri(uri).toLowerCase();
        const dot = name.lastIndexOf('.');
        return dot > 0 ? name.slice(dot) : '';
    }

    /**
     * Check if a URI looks like a video file
     */
    static isVideoUri(uri: string): boolean {
        const extension = this.extensionOf(uri);
        if (DeepLinkService.VIDEO_EXTENSIONS.includes(extension)) {
            return true;
        }
        if (DeepLinkService.AUDIO_EXTENSIONS.includes(extension)) {
            return false;
        }

        // MediaStore spells the kind into the path, which beats having no extension at all.
        const lowerUri = uri.toLowerCase();
        if (lowerUri.includes('/video/')) {
            return true;
        }
        if (lowerUri.includes('/audio/')) {
            return false;
        }

        // Streams and extensionless provider URIs: the intent filter that let this in
        // already declared it a video.
        return uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('content://');
    }

    /**
     * An audio file handed to the main app by "Open with". MainActivity is exported, so any
     * app can send it any URI: only local content:// and file:// are played, and the length
     * is capped like VideoPlayerActivity's.
     *
     * Shape only. A URI that passes still has to be confirmed audio by [isAudioContent],
     * because the Linking event this arrives on is process-wide -- a video opened into
     * VideoPlayerActivity is announced to every listener, this one included.
     */
    static isOpenableAudioUri(uri: string): boolean {
        if (!uri || uri.length > 8192) {
            return false;
        }
        if (!/^(content|file):\/\/\S+$/i.test(uri)) {
            return false;
        }

        const extension = this.extensionOf(uri);
        if (DeepLinkService.VIDEO_EXTENSIONS.includes(extension)) {
            return false;
        }
        if (DeepLinkService.AUDIO_EXTENSIONS.includes(extension)) {
            return true;
        }

        const lowerUri = uri.toLowerCase();
        if (lowerUri.includes('/video/')) {
            return false;
        }
        if (lowerUri.includes('/audio/')) {
            return true;
        }

        // A file:// path with no audio extension is nothing this app should open blind.
        // A content:// URI often carries no name at all, so let the MIME check settle it.
        return uri.startsWith('content://');
    }

    /**
     * Whether the system itself calls this URI audio. Asked of the provider rather than
     * guessed from the name, and only reached for URIs [isOpenableAudioUri] let through.
     */
    static async isAudioContent(uri: string): Promise<boolean> {
        const extension = this.extensionOf(uri);
        if (DeepLinkService.AUDIO_EXTENSIONS.includes(extension)) {
            return true;
        }
        try {
            const mime: string | null = await NativeModules.MediaStoreAudioModule?.getMimeType(uri);
            if (!mime) {
                // No answer either way. Trust the shape check that got us here.
                return true;
            }
            return mime.startsWith('audio/') || mime === 'application/ogg';
        } catch (error) {
            if (__DEV__) {console.log(LOG_PREFIX, 'MIME lookup failed:', error);}
            return true;
        }
    }

    /**
     * Extract video name from URI
     */
    static getVideoNameFromUri(uri: string): string {
        try {
            // Handle HTTP/HTTPS URLs
            if (uri.startsWith('http://') || uri.startsWith('https://')) {
                const fallbackFromString = () => {
                    const withoutQuery = uri.split('?')[0];
                    const parts = withoutQuery.split('/');
                    const last = parts[parts.length - 1];
                    if (last) {
                        const clean = decodeURIComponent(last);
                        if (clean && clean !== '/') {return clean;}
                    }
                    // Extract host as final fallback
                    const hostMatch = withoutQuery.match(/https?:\/\/([^/]+)/i);
                    return hostMatch?.[1] || 'Stream';
                };

                try {
                    const url = new URL(uri);
                    const pathname = url.pathname;
                    const parts = pathname.split('/');
                    const lastPart = parts[parts.length - 1];
                    if (lastPart) {
                        const clean = decodeURIComponent(lastPart.split('?')[0]);
                        if (clean && clean !== '/') {
                            return clean;
                        }
                    }
                    // For HLS streams or URLs without filename
                    return url.hostname || fallbackFromString();
                } catch {
                    return fallbackFromString();
                }
            }

            // Handle content:// URIs
            if (uri.startsWith('content://')) {
                // Try to extract filename from path component
                const parts = uri.split('/');
                const lastPart = parts[parts.length - 1];
                // Decode URI component and remove query params
                const decoded = decodeURIComponent(lastPart.split('?')[0]);
                // A document URI decodes to "primary:Folder/File.mkv"; keep only the file name.
                if (decoded && decoded.includes('.')) {
                    return decoded.split('/').pop()!;
                }
                // Try to get display name from document pattern
                // content://com.android.externalstorage.documents/document/primary%3ADownload%2Fvideo.mp4
                const docMatch = uri.match(/document\/[^%]+%3A(.+)/);
                if (docMatch) {
                    const decodedPath = decodeURIComponent(docMatch[1]);
                    const segments = decodedPath.split('%2F').join('/').split('/');
                    return segments[segments.length - 1] || 'External Video';
                }
                return 'External Video';
            }

            // Handle file:// URIs and regular paths
            const cleanPath = uri.replace('file://', '');
            const parts = cleanPath.split('/');
            return decodeURIComponent(parts[parts.length - 1]);
        } catch (error) {
            console.error(LOG_PREFIX, 'Error extracting video name:', error);
            return 'Video';
        }
    }

    /**
     * The folder a video sits in, for the player's subtitle line. A link is decoded first
     * (an "Open with" `content://…/My%20Shows/ep.mkv` → "My Shows"); a plain path, which can
     * hold a literal "%" or "?", is used as it is.
     */
    static getFolderNameFromUri(path: string): string | null {
        let clean = path.replace(/\\/g, '/');
        if (clean.includes('://')) {
            clean = clean.split('?')[0];
            try {
                clean = decodeURIComponent(clean);
            } catch {
                // A stray "%" that isn't an escape: show the segment as it is
            }
        }
        const parts = clean.split('/');
        return (parts.length >= 2 && parts[parts.length - 2]) || null;
    }

    /**
     * Resolve content:// URI to a real file:// path
     * Returns the original URI if resolution fails
     */
    static async resolveToFilePath(uri: string): Promise<string> {
        if (__DEV__) {console.log(LOG_PREFIX, 'Resolving URI:', uri);}

        // HTTP/HTTPS URLs - pass through directly for streaming
        if (uri.startsWith('http://') || uri.startsWith('https://')) {
            if (__DEV__) {console.log(LOG_PREFIX, 'HTTP(S) stream URL, passing through');}
            return uri;
        }

        // Already a file:// path or regular path
        if (uri.startsWith('file://') || !uri.includes('://')) {
            if (__DEV__) {console.log(LOG_PREFIX, 'Already a file path, returning as-is');}
            return uri;
        }

        // Try to resolve content:// URI to real path
        if (Platform.OS === 'android' && uri.startsWith('content://')) {
            try {
                const realPath = await FileService.resolveToRealPath(uri);

                if (realPath && realPath !== uri && !realPath.startsWith('content://')) {
                    // Add file:// prefix if it's a clean path
                    const filePath = realPath.startsWith('/') ? `file://${realPath}` : realPath;
                    if (__DEV__) {console.log(LOG_PREFIX, 'Resolved to file path:', filePath);}
                    return filePath;
                }
            } catch (error) {
                console.warn(LOG_PREFIX, 'Failed to resolve content:// URI:', error);
            }
        }

        // Fallback: return original URI
        if (__DEV__) {console.log(LOG_PREFIX, 'Could not resolve, returning original URI');}
        return uri;
    }

    /**
     * Get the initial URL that launched the app
     */
    static async getInitialUrl(): Promise<string | null> {
        try {
            const url = await Linking.getInitialURL();
            if (__DEV__) {console.log(LOG_PREFIX, 'Initial URL:', url);}
            return url ?? null;
        } catch (error) {
            console.error(LOG_PREFIX, 'Error getting initial URL:', error);
            return null;
        }
    }

    /**
     * Subscribe to URL events (for when app is already running)
     */
    static addUrlListener(callback: (url: string) => void): () => void {
        const subscription = Linking.addEventListener('url', (event) => {
            if (__DEV__) {console.log(LOG_PREFIX, 'URL event received:', event.url);}
            callback(event.url);
        });

        return () => subscription.remove();
    }
}


