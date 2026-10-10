import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStore = new Map<string, boolean>();
jest.mock('react-native-mmkv', () => ({
    createMMKV: () => ({
        set: (k: string, v: boolean) => mockStore.set(k, v),
        getBoolean: (k: string) => mockStore.get(k),
    }),
}));

const mockCheck = jest.fn<any>();
const mockRequest = jest.fn<any>();
const mockOpenSettings = jest.fn();
jest.mock('../src/services/PermissionService', () => ({
    PermissionService: { check: mockCheck, request: mockRequest, openSettings: mockOpenSettings },
}));

const mockNotifyChanged = jest.fn();
jest.mock('../src/services/MediaService', () => ({ MediaService: { notifyChanged: mockNotifyChanged } }));
jest.mock('../src/services/AudioMediaService', () => ({ AudioMediaService: { invalidateCache: jest.fn() } }));

mockCheck.mockResolvedValue('denied');
// Required, not imported: an import is hoisted above the mocks, and the store checks at load.
const { usePermissionStore } = require('../src/store/permissionStore') as typeof import('../src/store/permissionStore');

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('permissionStore', () => {
    beforeEach(async () => {
        await flush(); // the check made at load
        mockNotifyChanged.mockClear();
        mockRequest.mockReset();
        mockOpenSettings.mockClear();
    });

    it('treats the first check as the starting point, not a change', () => {
        expect(usePermissionStore.getState().video.access).toBe('denied');
        expect(mockNotifyChanged).not.toHaveBeenCalled();
    });

    it('reloads the library when access is granted', async () => {
        mockRequest.mockResolvedValue({ access: 'granted', blocked: false });
        await usePermissionStore.getState().request('video');
        expect(usePermissionStore.getState().video).toEqual({ access: 'granted', blocked: false });
        expect(mockNotifyChanged).toHaveBeenCalledTimes(1);
    });

    it('reloads after picking different videos, though access stays partial', async () => {
        mockRequest.mockResolvedValue({ access: 'partial', blocked: false });
        await usePermissionStore.getState().request('video');
        mockNotifyChanged.mockClear();
        await usePermissionStore.getState().request('video');
        expect(mockNotifyChanged).toHaveBeenCalledTimes(1);
    });

    it('remembers a block and sends the next tap to Settings', async () => {
        mockRequest.mockResolvedValue({ access: 'denied', blocked: true });
        await usePermissionStore.getState().request('audio');
        expect(usePermissionStore.getState().audio.blocked).toBe(true);
        expect(mockStore.get('blocked_audio')).toBe(true);

        await usePermissionStore.getState().request('audio');
        expect(mockRequest).toHaveBeenCalledTimes(1);
        expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    });
});
