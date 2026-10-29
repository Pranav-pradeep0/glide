import * as RNFS from '@dr.pogodin/react-native-fs';
import SimpleThumbnail from '../../libs/react-native-simple-thumbnail';

class FileServiceClass {
    /**
     * Resolve content:// or ph:// URIs to real file paths
     */
    async resolveToRealPath(uri: string): Promise<string> {
        if (!uri) {return uri;}

        // Normalize multiple file:// prefixes
        let normalizedUri = uri;
        while (normalizedUri.startsWith('file://file://')) {
            normalizedUri = normalizedUri.replace('file://file://', 'file://');
        }

        // Already a file path - return clean path
        if (normalizedUri.startsWith('file://')) {
            return normalizedUri.replace('file://', '');
        }

        // No scheme - assume it's already a real path
        if (!normalizedUri.includes('://')) {return normalizedUri;}

        // Try to resolve content:// or ph:// URIs to real paths
        if (normalizedUri.startsWith('content://') || normalizedUri.startsWith('ph://')) {
            try {
                const realPath = await SimpleThumbnail.getRealPath(normalizedUri);
                if (realPath && realPath.length > 0) {
                    let cleanPath = realPath.replace(/^file:\/\//, '');
                    while (cleanPath.startsWith('file://file://')) {
                        cleanPath = cleanPath.replace('file://file://', '');
                    }
                    return cleanPath;
                }
            } catch (error) {
                console.warn('[FileService] Failed to resolve URI:', error);
            }
        }

        return normalizedUri;
    }

    /**
     * Check if a file or directory exists
     */
    async exists(path: string): Promise<boolean> {
        try {
            const cleanPath = path.replace('file://', '');
            return await RNFS.exists(cleanPath);
        } catch (error) {
            console.warn('[FileService] exists check failed:', error);
            return false;
        }
    }

    /**
     * Ensure a directory exists, creating it if necessary
     */
    async ensureDir(path: string): Promise<void> {
        try {
            const cleanPath = path.replace('file://', '');
            const exists = await RNFS.exists(cleanPath);
            if (!exists) {
                await RNFS.mkdir(cleanPath);
            }
        } catch (error) {
            console.error('[FileService] Failed to ensure directory:', path, error);
            throw error;
        }
    }

    /**
     * Clean subtitle cache directory
     */
    async cleanSubtitleCache(): Promise<void> {
        try {
            const cacheDir = this.getSubtitleCacheDir();
            const exists = await RNFS.exists(cacheDir);
            if (exists) {
                await RNFS.unlink(cacheDir);
            }
            await RNFS.mkdir(cacheDir);
        } catch (error) {
            console.error('[FileService] Failed to clean subtitle cache:', error);
        }
    }

    /**
     * Get the subtitle cache directory path
     */
    getSubtitleCacheDir(): string {
        return `${RNFS.CachesDirectoryPath}/subtitles`;
    }
}

export const FileService = new FileServiceClass();
