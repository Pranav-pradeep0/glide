import * as RNFS from '@dr.pogodin/react-native-fs';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { hashPath } from '@/utils/hashPath';
import { SubtitleCue } from '../types';

/** History's subtitle index for "an external file": it records the choice, not the cues. */
export const EXTERNAL_SUBTITLE_INDEX = -999;

/**
 * The external subtitle (picked from storage or downloaded) last shown for each video, so
 * reopening the video brings it back. One file per video, overwritten by the next pick.
 */
const DIR = `${RNFS.DocumentDirectoryPath}/external_subtitles`;

export interface SavedExternalSubtitle {
    /** Checked on load: the file name is a 32-bit hash and could collide. */
    videoPath: string;
    name: string;
    isSDH: boolean;
    cues: SubtitleCue[];
}

const fileName = (videoPath: string) => `${hashPath(videoPath)}.json`;
const fileFor = (videoPath: string) => `${DIR}/${fileName(videoPath)}`;

export async function saveExternalSubtitle(sub: SavedExternalSubtitle): Promise<void> {
    try {
        await RNFS.mkdir(DIR);
        await RNFS.writeFile(fileFor(sub.videoPath), JSON.stringify(sub), 'utf8');
    } catch (error) {
        console.warn('[ExternalSubtitleStore] Save failed:', error);
    }
}

export async function loadExternalSubtitle(videoPath: string): Promise<SavedExternalSubtitle | null> {
    try {
        const sub: SavedExternalSubtitle = JSON.parse(await RNFS.readFile(fileFor(videoPath), 'utf8'));
        return sub.videoPath === videoPath ? sub : null;
    } catch {
        return null;
    }
}

/** At launch: drop every file no history entry still points to (switched track, removed, cleared or pruned). */
async function sweep() {
    try {
        if (!(await RNFS.exists(DIR))) {return;}
        const wanted = new Set<string>();
        for (const entry of useVideoHistoryStore.getState().history.values()) {
            if (entry.selectedSubtitleTrackId === EXTERNAL_SUBTITLE_INDEX) {
                wanted.add(fileName(entry.videoPath));
            }
        }
        const files = await RNFS.readDir(DIR);
        await Promise.all(files.filter(f => !wanted.has(f.name)).map(f => RNFS.unlink(f.path)));
    } catch (error) {
        console.warn('[ExternalSubtitleStore] Sweep failed:', error);
    }
}

sweep();
