import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/storage/storage', () => ({ storage: { loadSettings: () => null, saveSettings: () => {} } }));
jest.mock('../src/native/GlideNative', () => ({ setCrashReportsEnabled: () => {} }));
jest.mock('../src/utils/tv', () => ({ IS_TV: false }));

const { migrateSettings, DEFAULT_APP_SETTINGS } = require('../src/store/appStore') as typeof import('../src/store/appStore');

describe('theme mode', () => {
    it('defaults to following the phone', () => {
        expect(DEFAULT_APP_SETTINGS.darkMode).toBe('system');
        expect(migrateSettings({} as any).darkMode).toBe('system');
    });

    it('keeps the choice from the old on/off switch', () => {
        expect(migrateSettings({ darkMode: true } as any).darkMode).toBe('dark');
        expect(migrateSettings({ darkMode: false } as any).darkMode).toBe('light');
        expect(migrateSettings({ darkMode: 'system' } as any).darkMode).toBe('system');
    });
});
