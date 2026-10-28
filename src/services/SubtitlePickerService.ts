// src/services/SubtitlePickerService.ts
import { Platform } from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { pick, isErrorWithCode } from '@react-native-documents/picker';
import { SubtitleParser } from '../utils/SubtitleParser';
import { SubtitleCue } from '../types';
import { SUBTITLE_EXTENSIONS } from '../utils/constants';
import { SmbService } from './SmbService';
import { fetchWithTimeout } from '../utils/network';

const LOG_PREFIX = '[SubtitlePicker]';

export interface PickedSubtitle {
    name: string;
    cues: SubtitleCue[];
}

export class SubtitlePickerService {
    /**
     * Open document picker for user to select a subtitle file from storage
     */
    static async pickFromStorage(): Promise<PickedSubtitle | null> {
        try {
            if (__DEV__) {console.log(`${LOG_PREFIX} Opening subtitle picker`);}

            // Use new @react-native-documents/picker API
            const result = await pick({
                mode: 'open',
                type: ['text/*', 'application/x-subrip', 'text/vtt'],
            });

            if (!result || result.length === 0) {
                if (__DEV__) {console.log(`${LOG_PREFIX} No file selected`);}
                return null;
            }

            const file = result[0];
            if (__DEV__) {console.log(`${LOG_PREFIX} User selected:`, file.name);}

            // Check extension
            const fileName = file.name || '';
            const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();

            if (!SUBTITLE_EXTENSIONS.includes(ext)) {
                console.error(`${LOG_PREFIX} Unsupported format:`, ext);
                throw new Error(`Unsupported subtitle format: ${ext}. Please select .srt, .vtt, or .ass file.`);
            }

            let content: string;
            // content:// URIs on Android are read through a cache copy, deleted once read
            if (Platform.OS === 'android' && file.uri.startsWith('content://')) {
                const cachePath = `${RNFS.CachesDirectoryPath}/picked_subtitle_${Date.now()}${ext}`;
                try {
                    await RNFS.copyFile(file.uri, cachePath);
                    content = await RNFS.readFile(cachePath, 'utf8');
                } finally {
                    RNFS.unlink(cachePath).catch(() => {});
                }
            } else {
                content = await RNFS.readFile(file.uri.replace('file://', ''), 'utf8');
            }
            if (__DEV__) {console.log(`${LOG_PREFIX} Read file: ${content.length} chars`);}

            // Parse subtitle
            const format = ext === '.srt' ? 'srt' : ext === '.vtt' ? 'vtt' : 'ass';
            const cues = SubtitleParser.parse(content, format);

            if (cues.length === 0) {
                throw new Error('Could not parse subtitle file. Please check the file format.');
            }

            if (__DEV__) {console.log(`${LOG_PREFIX} Parsed ${cues.length} cues`);}

            return { name: fileName, cues };
        } catch (error: any) {
            // Check if user cancelled using error code
            if (isErrorWithCode(error) && error.code === 'OPERATION_CANCELED') {
                if (__DEV__) {console.log(`${LOG_PREFIX} User cancelled`);}
                return null;
            }

            console.error(`${LOG_PREFIX} Error:`, error);
            throw error;
        }
    }

    /**
     * Scan common subtitle locations for matching subtitles
     * Looks for subtitle files with same name as video
     */
    static async findMatchingSubtitles(videoPath: string): Promise<string[]> {
        try {
            // Content URIs don't have scannable directories
            if (videoPath.startsWith('content://')) {
                if (__DEV__) {console.log(`${LOG_PREFIX} Skipping external subtitle scan for content URI`);}
                return [];
            }

            // smb:// paths carry each name URI-encoded; the folder listing gives them plain.
            const smb = videoPath.startsWith('smb://');
            const videoDir = videoPath.substring(0, videoPath.lastIndexOf('/'));
            const rawName = videoPath.substring(videoPath.lastIndexOf('/') + 1);
            const videoName = smb ? decodeURIComponent(rawName) : rawName;
            const videoBaseName = videoName.substring(0, videoName.lastIndexOf('.'));

            if (__DEV__) {console.log(`${LOG_PREFIX} Searching for subtitles matching:`, videoBaseName);}

            const files = smb
                ? (await SmbService.list(videoDir)).filter(e => !e.isDirectory)
                    .map(e => ({ name: e.name, path: `${videoDir}/${encodeURIComponent(e.name)}` }))
                : (await RNFS.readDir(videoDir)).filter(f => f.isFile());
            const matchingSubtitles: string[] = [];

            for (const file of files) {
                const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
                if (!SUBTITLE_EXTENSIONS.includes(ext)) {continue;}
                const subBaseName = file.name.substring(0, file.name.lastIndexOf('.'));
                // Exact match or starts with video name
                if (subBaseName === videoBaseName ||
                    subBaseName.startsWith(videoBaseName + '.') ||
                    subBaseName.startsWith(videoBaseName + '_')) {
                    matchingSubtitles.push(file.path);
                    if (__DEV__) {console.log(`${LOG_PREFIX} Found matching:`, file.name);}
                }
            }

            return matchingSubtitles;
        } catch (error) {
            console.error(`${LOG_PREFIX} Error scanning for subtitles:`, error);
            return [];
        }
    }

    /**
     * Load a subtitle file from path
     */
    static async loadFromPath(filePath: string): Promise<PickedSubtitle | null> {
        try {
            if (filePath.startsWith('smb://')) {
                const fileName = decodeURIComponent(filePath.substring(filePath.lastIndexOf('/') + 1));
                return SubtitlePickerService.parse(fileName, await SmbService.readText(filePath));
            }

            // Clean file:// prefix
            const cleanPath = filePath.replace('file://', '');

            // Check file exists
            const exists = await RNFS.exists(cleanPath);
            if (!exists) {
                console.error(`${LOG_PREFIX} File not found:`, cleanPath);
                return null;
            }

            const fileName = cleanPath.substring(cleanPath.lastIndexOf('/') + 1);

            return SubtitlePickerService.parse(fileName, await RNFS.readFile(cleanPath, 'utf8'));
        } catch (error) {
            console.error(`${LOG_PREFIX} Error loading subtitle:`, error);
            return null;
        }
    }

    /**
     * A subtitle another app handed over with the video (Stremio's addons): a link, a
     * content:// URI or a file. Named by the sender, or by the file if it gave none.
     */
    static async loadFromUri(uri: string, name?: string): Promise<PickedSubtitle | null> {
        const fileName = name || decodeURIComponent(uri.split('?')[0].split('/').pop() || 'Subtitle');
        try {
            if (/^https?:\/\//i.test(uri)) {
                const response = await fetchWithTimeout(uri, {}, 15000);
                if (!response.ok) {
                    console.error(`${LOG_PREFIX} HTTP ${response.status} for subtitle`);
                    return null;
                }
                return SubtitlePickerService.parse(fileName, await response.text());
            }
            if (uri.startsWith('content://')) {
                return SubtitlePickerService.parse(fileName, await RNFS.readFile(uri, 'utf8'));
            }
            const loaded = await SubtitlePickerService.loadFromPath(uri);
            return loaded && { ...loaded, name: fileName };
        } catch (error) {
            console.error(`${LOG_PREFIX} Error loading subtitle:`, error);
            return null;
        }
    }

    private static parse(fileName: string, content: string): PickedSubtitle | null {
        const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
        // No known extension (a sender's name like "English", or a link): let the content say.
        const format = ext === '.srt' ? 'srt' : ext === '.vtt' ? 'vtt' : ext === '.ass' || ext === '.ssa' ? 'ass' : undefined;
        const cues = SubtitleParser.parse(content, format);
        if (cues.length === 0) {
            console.error(`${LOG_PREFIX} No cues parsed from:`, fileName);
            return null;
        }
        return { name: fileName, cues };
    }
}


