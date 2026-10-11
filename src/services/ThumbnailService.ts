import SimpleThumbnail from '../../libs/react-native-simple-thumbnail';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { FileService } from './FileService';
import { MediaService } from './MediaService';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';

const THUMBNAIL_DIR = `${RNFS.CachesDirectoryPath}/thumbnails`;
/**
 * Frames taken at a set time -- only Recents' stop frames ask for one. Kept apart so the
 * launch sweep can drop every one no history entry points to any more: replaced by a later
 * stop, or the entry deleted, removed, cleared or pruned.
 */
const AT_TIME_DIR = `${THUMBNAIL_DIR}/at`;
const MAX_CONCURRENT_WORKERS = 4;
const MAX_MEMO_ENTRIES = 2000;

interface PendingRequest {
    resolve: (path: string | null) => void;
    reject: (error: any) => void;
    /** Identifies the caller, so a cancel drops that caller's wait and nobody else's. */
    token?: object;
}

interface TaskItem {
    path: string;
    time: number;
    key: string;
}

class ThumbnailServiceClass {
    // LIFO Queue of TaskItems
    private queue: TaskItem[] = [];
    private activeWorkers = 0;

    // Map using unique key (path + time) to deduplicate requests
    private pendingResolvers = new Map<string, PendingRequest[]>();

    // Set of currently processing keys
    private processingKeys = new Set<string>();

    /**
     * What each key resolved to last time. A FlashList row that scrolls off and back asks
     * again, and without this every one of those is a bridge call and a ContentResolver
     * query for a file whose thumbnail is already sitting on disk.
     */
    private resolved = new Map<string, string>();

    constructor() {
        this.init();
    }

    private async init() {
        await FileService.ensureDir(AT_TIME_DIR);
        try {
            const wanted = new Set<string>();
            for (const entry of useVideoHistoryStore.getState().history.values()) {
                if (entry.stopFrameMs) {
                    wanted.add(this.fileName(entry.videoPath, entry.stopFrameMs));
                }
            }
            const files = await RNFS.readDir(AT_TIME_DIR);
            await Promise.all(files
                .filter(file => !wanted.has(file.name))
                .map(file => RNFS.unlink(file.path)));
        } catch (error) {
            console.warn('[ThumbnailService] Stop-frame sweep failed:', error);
        }
    }

    private fileName(videoPath: string, timeMs: number): string {
        return `${this.hashPath(`${videoPath}::${timeMs}`)}.jpg`;
    }

    private outPath(videoPath: string, timeMs: number): string {
        return `${timeMs > 0 ? AT_TIME_DIR : THUMBNAIL_DIR}/${this.fileName(videoPath, timeMs)}`;
    }

    /**
     * Get a thumbnail for a video at a specific time.
     * @param videoPath Absolute path or content:// URI
     * @param timeMs Time in milliseconds (0 = Smart Scan)
     */
    async getThumbnail(videoPath: string, timeMs: number = 0, token?: object): Promise<string | null> {
        if (!videoPath) { return null; }

        const memo = `${videoPath}::${timeMs}`;
        const known = this.resolved.get(memo);
        if (known) {
            return known;
        }

        // Fast-path: try MediaStore system thumbnail (timeMs === 0)
        if (timeMs === 0) {
            try {
                const sysThumb = await MediaService.getThumbnail(videoPath);
                if (sysThumb) {
                    this.remember(memo, sysThumb);
                    return sysThumb;
                }
            } catch {
                // fall through to disk cache / worker queue
            }
        }

        // Create a unique key for this request (path + time)
        const key = memo;
        const outPath = this.outPath(videoPath, timeMs);

        // 1. Check Disk Cache
        if (await FileService.exists(outPath)) {
            const cached = `file://${outPath}`;
            this.remember(memo, cached);
            return cached;
        }

        // 2. Queue for Generation
        return new Promise((resolve, reject) => {
            // Deduplication
            if (this.pendingResolvers.has(key)) {
                this.pendingResolvers.get(key)?.push({ resolve, reject, token });
                this.promoteToTop(key);
                return;
            }

            // New Request
            this.pendingResolvers.set(key, [{ resolve, reject, token }]);
            this.queue.push({ path: videoPath, time: timeMs, key });
            this.processNext();
        });
    }

    /**
     * This caller has gone away -- its row scrolled off, or the screen unmounted.
     *
     * Only its own wait is dropped. Deleting every waiter for the key, as this used to,
     * left any other row showing the same video with a promise that never settled.
     */
    cancelRequest(videoPath: string, timeMs: number = 0, token?: object) {
        const key = `${videoPath}::${timeMs}`;
        const waiters = this.pendingResolvers.get(key);
        if (!waiters) { return; }

        const index = token ? waiters.findIndex(w => w.token === token) : waiters.length - 1;
        if (index !== -1) {
            waiters.splice(index, 1)[0].resolve(null);
        }
        if (waiters.length > 0) { return; }

        // Already generating: keep the (now empty) entry, so a row that scrolls back joins
        // this run instead of starting a second one writing the same file underneath it.
        if (this.processingKeys.has(key)) { return; }

        // Nobody is waiting any more, so drop the work if it has not started yet.
        this.pendingResolvers.delete(key);
        const queued = this.queue.findIndex(item => item.key === key);
        if (queued !== -1) {
            this.queue.splice(queued, 1);
        }
    }

    /** Bounded: a long scroll through a large library would otherwise grow this forever. */
    private remember(key: string, value: string) {
        if (this.resolved.size >= MAX_MEMO_ENTRIES) {
            this.resolved.clear();
        }
        this.resolved.set(key, value);
    }

    private promoteToTop(key: string) {
        const index = this.queue.findIndex(item => item.key === key);
        if (index !== -1) {
            const item = this.queue.splice(index, 1)[0];
            this.queue.push(item);
        }
    }

    private async processNext() {
        if (this.activeWorkers >= MAX_CONCURRENT_WORKERS || this.queue.length === 0) {
            return;
        }

        // LIFO: Take the LAST item
        const task = this.queue.pop();
        if (!task) { return; }

        this.activeWorkers++;
        this.processingKeys.add(task.key);

        const outPath = this.outPath(task.path, task.time);

        try {
            // Resolve content:// URIs
            let resolvedPath = task.path;
            if (task.path.startsWith('content://')) {
                try {
                    resolvedPath = await FileService.resolveToRealPath(task.path);
                } catch (e) {
                    // Ignore, try original
                }
            }

            const result = await SimpleThumbnail.generate({
                source: resolvedPath,
                dest: `file://${outPath}`,
                time: task.time,
                width: 320,
                quality: 60,
            });

            const finalPath = result?.path ? result.path : null;
            // A miss is not remembered: a file still being written fails now and works
            // later, and the next ask is the retry.
            if (finalPath) {
                this.remember(task.key, finalPath);
            }

            // Notify all waiters
            const waiters = this.pendingResolvers.get(task.key);
            if (waiters) {
                waiters.forEach(w => w.resolve(finalPath));
                this.pendingResolvers.delete(task.key);
            }

        } catch (error) {
            console.error('[ThumbnailService] Error:', error);
            const waiters = this.pendingResolvers.get(task.key);
            if (waiters) {
                waiters.forEach(w => w.resolve(null));
                this.pendingResolvers.delete(task.key);
            }
        } finally {
            this.activeWorkers--;
            this.processingKeys.delete(task.key);
            this.processNext();
        }
    }

    private hashPath(path: string): string {
        let hash = 0;
        for (let i = 0; i < path.length; i++) {
            // eslint-disable-next-line no-bitwise
            hash = (hash << 5) - hash + path.charCodeAt(i);
            // eslint-disable-next-line no-bitwise
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }
}

export const ThumbnailService = new ThumbnailServiceClass();
