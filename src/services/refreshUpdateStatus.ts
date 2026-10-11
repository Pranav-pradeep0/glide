import { useAppStore } from '@/store/appStore';
import { UpdateService } from './UpdateService';

/**
 * Check for an update and record the answer in the store, which the library and an
 * "Open with" player both read. Its own module so neither the store nor UpdateService
 * (pure, unit-tested) pulls in the other.
 */
export async function refreshUpdateStatus(): Promise<void> {
    const result = await UpdateService.checkForUpdates();
    // A failed check knows nothing. Writing it would clear an update found earlier, and
    // the Settings card and tab badge would vanish until a check happened to succeed.
    if (result.checkFailed) { return; }
    useAppStore.getState().setUpdateStatus({
        available: result.available,
        latestVersion: result.latestVersion,
        releaseUrl: result.releaseUrl,
        releaseNotes: result.releaseNotes,
        apkUrl: result.apkUrl,
        apkSha256Url: result.apkSha256Url,
    });
}
