// utils/SubtitleExtractor.ts

import * as RNFS from '@dr.pogodin/react-native-fs';
import { Platform, NativeModules } from 'react-native';

const LOG_PREFIX = '[SubtitleExtractor]';

export interface SubtitleTrack {
    index: number;
    codec: string;
    language?: string;
    title?: string;
    isDefault?: boolean;
    isForced?: boolean;
    isBitmap?: boolean;
}

export class SubtitleExtractor {
    /**
     * Check if codec is text-based (can be extracted to SRT)
     */
    static isTextSubtitle(codec: string): boolean {
        const textCodecs = ['srt', 'subrip', 'ass', 'ssa', 'webvtt', 'vtt', 'mov_text', 'text', 'utf8', 'text/plain'];
        return textCodecs.includes(codec?.toLowerCase());
    }

    /**
     * Get subtitle tracks only from video using native MediaExtractor
     */
    static async getSubtitleTracks(videoPath: string): Promise<SubtitleTrack[]> {
        const startTime = Date.now();
        if (__DEV__) {
            console.log(`${LOG_PREFIX} [getSubtitleTracks] START`, {
                videoPath: videoPath.substring(0, 60) + '...',
                timestamp: new Date().toISOString(),
            });
        }

        try {
            if (Platform.OS === 'android' && NativeModules.SubtitleSyncModule?.getSubtitleTracks) {
                const tracks: SubtitleTrack[] = await NativeModules.SubtitleSyncModule.getSubtitleTracks(videoPath);
                const duration = Date.now() - startTime;
                if (__DEV__) {
                    console.log(`${LOG_PREFIX} [getSubtitleTracks] ✓ SUCCESS (native)`, {
                        subtitleTracks: tracks?.length || 0,
                        durationMs: duration,
                    });
                }
                return tracks || [];
            }
            return [];
        } catch (error) {
            console.error(`${LOG_PREFIX} [getSubtitleTracks] Error getting subtitle tracks:`, error);
            return [];
        }
    }

    /**
     * Extract an embedded text subtitle track to an SRT file in the cache, returning its path.
     * `subtitleIndex` is the track's ordinal among the file's subtitle tracks, as
     * getSubtitleTracks and the player both number them. Null for bitmap or empty tracks.
     */
    static async extractSubtitle(
        videoPath: string,
        subtitleIndex: number,
        _outputFormat: 'srt' = 'srt'
    ): Promise<string | null> {
        if (Platform.OS !== 'android' || !NativeModules.SubtitleSyncModule?.extractSubtitle) {
            return null;
        }
        try {
            return await NativeModules.SubtitleSyncModule.extractSubtitle(videoPath, subtitleIndex);
        } catch (error) {
            console.error(`${LOG_PREFIX} [extractSubtitle] failed`, error);
            return null;
        }
    }

    /**
     * Read subtitle file content
     */
    static async readSubtitleFile(filePath: string): Promise<string | null> {
        const startTime = Date.now();
        if (__DEV__) {
            console.log(`${LOG_PREFIX} [readSubtitleFile] START`, {
                filePath: filePath.substring(0, 60) + '...',
                timestamp: new Date().toISOString(),
            });
        }

        try {
            const exists = await RNFS.exists(filePath);
            if (!exists) {
                console.error(`${LOG_PREFIX} [readSubtitleFile] File does not exist`, {
                    filePath,
                });
                return null;
            }

            const fileInfo = await RNFS.stat(filePath);
            if (__DEV__) {
                console.log(`${LOG_PREFIX} [readSubtitleFile] Reading file`, {
                    size: fileInfo.size,
                    sizeKB: (fileInfo.size / 1024).toFixed(2),
                });
            }

            const content = await RNFS.readFile(filePath, 'utf8');

            if (__DEV__) {
                console.log(`${LOG_PREFIX} [readSubtitleFile] ✓ SUCCESS`, {
                    sizeKB: (content.length / 1024).toFixed(2),
                    durationMs: Date.now() - startTime,
                });
            }

            return content;
        } catch (error) {
            console.error(`${LOG_PREFIX} [readSubtitleFile] FATAL ERROR`, error);
            return null;
        }
    }
}
