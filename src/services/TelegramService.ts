import { DeviceEventEmitter, NativeModules } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

/** Sign-in as TDLib tells it (TelegramModule.kt `state`). */
export type TgAuth =
    | { state: 'starting' | 'phone' | 'loggingOut' }
    | { state: 'code'; phone: string; sentTo: 'telegram' | 'sms' | 'other' }
    | { state: 'qr'; link: string; qr: string }
    | { state: 'password'; hint: string }
    | { state: 'ready'; name: string; phone: string }
    | { state: 'unsupported'; what: string };

export interface TgChat {
    id: number;
    title: string;
    saved: boolean;
    group: boolean;
}

export interface TgVideo {
    /** `tg://chatId/messageId`: what the player, History and Recents key on. */
    uri: string;
    name: string;
    size: number;
    /** Seconds; 0 for films sent as files. */
    duration: number;
    width: number;
    height: number;
    /** ms */
    date: number;
}

const native = NativeModules.GlideTelegram as
    | {
          available: boolean;
          start(): Promise<TgAuth>;
          phoneNumber(n: string): Promise<null>;
          code(c: string): Promise<null>;
          password(p: string): Promise<null>;
          requestQr(): Promise<null>;
          logOut(): Promise<null>;
          chats(limit: number): Promise<TgChat[]>;
          videos(chatId: number, from: number, limit: number): Promise<{ items: TgVideo[]; next: number }>;
          poster(uri: string): Promise<string | null>;
          prefetch(uri: string): void;
          cacheSize(): Promise<number>;
          clearCache(): Promise<null>;
      }
    | undefined;

/** False on an older APK, or a build without a Telegram API ID: hide the feature. */
export const TELEGRAM_AVAILABLE = !!native?.available;

// Whether TDLib was ever started here, so Settings doesn't start it just to show 0 bytes.
const mmkv = createMMKV({ id: 'glide_telegram_v1' });

export const isTelegram = (path: string) => path.startsWith('tg://');

export const TelegramService = {
    /** Starts TDLib; `onAuth` gets each later state. Returns the current one and an unsubscribe. */
    start(onAuth: (a: TgAuth) => void) {
        mmkv.set('used', true);
        const sub = DeviceEventEmitter.addListener('GlideTelegramAuth', onAuth);
        return { auth: native!.start(), stop: () => sub.remove() };
    },

    phoneNumber: (n: string) => native!.phoneNumber(n),
    code: (c: string) => native!.code(c),
    password: (p: string) => native!.password(p),
    requestQr: () => native!.requestQr(),
    /** Signs out and wipes; also the way back from the QR code to the phone number. */
    logOut: () => native!.logOut(),

    chats: (limit: number) => native!.chats(limit),
    videos: (chatId: number, from: number, limit: number) => native!.videos(chatId, from, limit),

    /** Telegram's own picture for the film; never a frame (that would download part of it). */
    poster: (uri: string) => (TELEGRAM_AVAILABLE ? native!.poster(uri).catch(() => null) : Promise.resolve(null)),

    /** Fetches the film's head and tail ahead of Play, so an MKV starts sooner. */
    prefetch: (uri: string) => { if (TELEGRAM_AVAILABLE) { native!.prefetch(uri); } },

    /** Bytes of downloaded films; null when Telegram was never used here. */
    cacheSize: () => (TELEGRAM_AVAILABLE && mmkv.getBoolean('used') ? native!.cacheSize() : Promise.resolve(null)),
    clearCache: () => native!.clearCache(),
};
