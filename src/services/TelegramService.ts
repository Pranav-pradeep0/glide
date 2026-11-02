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
    /** The last message: ms (0 none) and one line of it. */
    date: number;
    preview: string;
}

/** A chat's newest video, from one search across all chats: a hint, not every chat with videos. */
export interface TgRecent {
    name: string;
    date: number;
}

/** One of the user's Telegram chat folders. */
export interface TgFolder {
    id: number;
    name: string;
}

export interface TgVideo {
    /** `tg://chatId/messageId`: what the player, History and Recents key on. */
    uri: string;
    chatId: number;
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
          folders(): Promise<TgFolder[]>;
          chats(limit: number, folderId: number): Promise<TgChat[]>;
          chatPhoto(chatId: number): Promise<string | null>;
          recent(): Promise<Record<string, TgRecent>>;
          hasVideos(chatId: number): Promise<boolean>;
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

    folders: () => native!.folders(),
    /** In Telegram's order; `folderId` 0: all chats, Saved Messages first. Page by a bigger `limit`. */
    chats: (limit: number, folderId = 0) => native!.chats(limit, folderId),
    /** `file://` of the chat's small photo, or null. */
    chatPhoto: (chatId: number) => native!.chatPhoto(chatId).catch(() => null),
    /** Chat id → its newest video, from the latest 100 across all chats; {} on an error. */
    recent: () => native!.recent().catch(() => ({} as Record<string, TgRecent>)),
    /** Whether the chat has any video; null when Telegram couldn't say (the chat stays shown). */
    hasVideos: (chatId: number) => native!.hasVideos(chatId).catch(() => null),
    videos: (chatId: number, from: number, limit: number) => native!.videos(chatId, from, limit),

    /** Telegram's own picture for the film; never a frame (that would download part of it). */
    poster: (uri: string) => (TELEGRAM_AVAILABLE ? native!.poster(uri).catch(() => null) : Promise.resolve(null)),

    /** Fetches the film's head and tail ahead of Play, so an MKV starts sooner. */
    prefetch: (uri: string) => { if (TELEGRAM_AVAILABLE) { native!.prefetch(uri); } },

    /** Bytes of downloaded films; null when Telegram was never used here. */
    cacheSize: () => (TELEGRAM_AVAILABLE && mmkv.getBoolean('used') ? native!.cacheSize() : Promise.resolve(null)),
    clearCache: () => native!.clearCache(),
};
