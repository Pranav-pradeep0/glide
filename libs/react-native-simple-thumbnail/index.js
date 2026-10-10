import { NativeModules } from 'react-native';

const { SimpleThumbnail } = NativeModules;

export default {
    /**
     * Generate a thumbnail for a video.
     * @param options { source, dest, time, width, height, quality, format }
     * @returns Promise<{ path: string, width: number, height: number }>
     */
    generate(options) {
        return SimpleThumbnail.generate(options);
    },

    /**
     * Resolve a content:// URI to a file path (if possible).
     * @param uri
     * @returns Promise<string>
     */
    getRealPath(uri) {
        return SimpleThumbnail.getRealPath(uri);
    },
};
