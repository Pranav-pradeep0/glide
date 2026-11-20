// src/utils/storage.ts

import { createMMKV } from 'react-native-mmkv';
import { keepCorrupt } from './keepCorrupt';
import { AppSettings } from '../types';

const SETTINGS_KEY = '@glide_app:settings';

const mmkvStorage = createMMKV({
    id: SETTINGS_KEY,
});

export const storage = {
    saveSettings(settings: AppSettings): void {
        try {
            mmkvStorage.set(SETTINGS_KEY, JSON.stringify(settings));
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    },

    loadSettings(): AppSettings | null {
        try {
            const data = mmkvStorage.getString(SETTINGS_KEY);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Error loading settings:', error);
            storage.keepCorruptSettings();
            return null;
        }
    },

    /** Saved settings that couldn't be read go to `.corrupt` before defaults overwrite them. */
    keepCorruptSettings(): void {
        keepCorrupt(mmkvStorage, SETTINGS_KEY);
    },

    clearSettings(): void {
        try {
            mmkvStorage.remove(SETTINGS_KEY);
        } catch (error) {
            console.error('Error clearing settings:', error);
        }
    },
};
