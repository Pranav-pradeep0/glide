import { Platform } from 'react-native';

/**
 * Running on Android TV (the device's UI mode is television). TV-only code checks this, so
 * phones never reach it; the TV launcher entry in the manifest is what lists the app on TVs.
 */
export const IS_TV = Platform.isTV;
