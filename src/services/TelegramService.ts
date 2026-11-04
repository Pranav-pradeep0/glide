import { useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
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

/** A film saved for offline, or on its way (TgSaves.kt). */
export interface TgSave {
    uri: string;
    state: 'downloading' | 'waiting' | 'saved';
    /** Bytes so far and in all. */
    done: number;
    total: number;
    /** What the row shows, kept here when Download was pressed. */
    name: string;
    duration: number;
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
          saves(): Promise<Omit<TgSave, 'name' | 'duration'>[]>;
          save(uri: string, name: string): Promise<null>;
          unsave(uri: string): Promise<null>;
          deleteSaves(): Promise<null>;
      }
    | undefined;

/** False on an older APK, or a build without a Telegram API ID: hide the feature. */
export const TELEGRAM_AVAILABLE = !!native?.available;

// Whether TDLib was ever started here, so Settings doesn't start it just to show 0 bytes.
const mmkv = createMMKV({ id: 'glide_telegram_v1' });

export const isTelegram = (path: string) => path.startsWith('tg://');

type SaveMeta = Pick<TgSave, 'name' | 'duration'>;
const meta = (uri: string): SaveMeta => {
    const m = mmkv.getString(`save:${uri}`);
    return m ? JSON.parse(m) : { name: 'Video', duration: 0 };
};
const withMeta = (list: Omit<TgSave, 'name' | 'duration'>[]): TgSave[] => list.map(s => ({ ...s, ...meta(s.uri) }));
const forget = (prefix: string) => mmkv.getAllKeys().filter(k => k.startsWith(prefix)).forEach(k => mmkv.remove(k));
const forgetSaves = () => forget('save:');

/** Remembers the last settled sign-in, so Home can say "Signed in" without starting TDLib. */
const noteAuth = (a: TgAuth) => {
    if (a.state === 'ready') { mmkv.set('signedIn', true); }
    else if (a.state !== 'starting' && a.state !== 'loggingOut') { mmkv.set('signedIn', false); }
    return a;
};

export const TelegramService = {
    /** Starts TDLib; `onAuth` gets each later state. Returns the current one and an unsubscribe. */
    start(onAuth: (a: TgAuth) => void) {
        mmkv.set('used', true);
        const sub = DeviceEventEmitter.addListener('GlideTelegramAuth', (a: TgAuth) => onAuth(noteAuth(a)));
        return { auth: native!.start().then(noteAuth), stop: () => sub.remove() };
    },

    /** Signed in when the Telegram screen last looked; false if never opened. */
    signedIn: () => TELEGRAM_AVAILABLE && (mmkv.getBoolean('signedIn') ?? false),

    phoneNumber: (n: string) => native!.phoneNumber(n),
    code: (c: string) => native!.code(c),
    password: (p: string) => native!.password(p),
    requestQr: () => native!.requestQr(),
    /** Signs out and wipes (saved films too); also the way back from the QR code to the phone number. */
    logOut: () => native!.logOut().then(() => { mmkv.set('signedIn', false); forgetSaves(); forget('has:'); }),

    folders: () => native!.folders(),
    /** In Telegram's order; `folderId` 0: all chats, Saved Messages first. Page by a bigger `limit`. */
    chats: (limit: number, folderId = 0) => native!.chats(limit, folderId),
    /** `file://` of the chat's small photo, or null. */
    chatPhoto: (chatId: number) => native!.chatPhoto(chatId).catch(() => null),
    /** Chat id → its newest video, from the latest 100 across all chats; {} on an error. */
    recent: () => native!.recent().then(r => {
        Object.keys(r).forEach(id => mmkv.set(`has:${id}`, true));
        return r;
    }, () => ({} as Record<string, TgRecent>)),
    /** Whether the chat has any video, saved for next time; null when Telegram couldn't say (the chat stays shown, nothing saved). */
    hasVideos: (chatId: number) => native!.hasVideos(chatId).then(h => { mmkv.set(`has:${chatId}`, h); return h; }, () => null),
    /** The last answer of [hasVideos] (or [recent]) on this device, if any. */
    savedHasVideos: (chatId: number) => mmkv.getBoolean(`has:${chatId}`),
    videos: (chatId: number, from: number, limit: number) => native!.videos(chatId, from, limit),

    /** Telegram's own picture for the film; never a frame (that would download part of it). */
    poster: (uri: string) => (TELEGRAM_AVAILABLE ? native!.poster(uri).catch(() => null) : Promise.resolve(null)),

    /** Fetches the film's head and tail ahead of Play, so an MKV starts sooner. */
    prefetch: (uri: string) => { if (TELEGRAM_AVAILABLE) { native!.prefetch(uri); } },

    /** Bytes of downloaded films; null when Telegram was never used here. */
    cacheSize: () => (TELEGRAM_AVAILABLE && mmkv.getBoolean('used') ? native!.cacheSize() : Promise.resolve(null)),
    clearCache: () => native!.clearCache(),

    saves: () => (TELEGRAM_AVAILABLE ? native!.saves().then(withMeta) : Promise.resolve([] as TgSave[])),
    /** Saves the film for offline in the background, with a progress notification. */
    save(uri: string, m: SaveMeta) {
        mmkv.set(`save:${uri}`, JSON.stringify({ name: m.name, duration: m.duration }));
        // Android 13+: without it the download still runs, its notification just isn't shown.
        if (Platform.OS === 'android' && Platform.Version >= 33) {
            PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
        }
        return native!.save(uri, m.name);
    },
    /** Cancels a save, or deletes a saved film. */
    unsave: (uri: string) => native!.unsave(uri).then(() => mmkv.remove(`save:${uri}`)),
    deleteSaves: () => native!.deleteSaves().then(forgetSaves),
};

/** Each video as it's sent to a chat the lists show (Telegram pushes it): keeps them live. */
export function useTelegramNewVideo(onVideo: (v: TgVideo) => void) {
    const latest = useRef(onVideo);
    latest.current = onVideo;
    useEffect(() => {
        if (!TELEGRAM_AVAILABLE) { return; }
        const sub = DeviceEventEmitter.addListener('GlideTelegramVideo', (v: TgVideo) => latest.current(v));
        return () => sub.remove();
    }, []);
}

/** A listed chat changed (a message of any kind in, the last one deleted, a pin): its row moves. */
export function useTelegramChatChanged(onChange: () => void) {
    const latest = useRef(onChange);
    latest.current = onChange;
    useEffect(() => {
        if (!TELEGRAM_AVAILABLE) { return; }
        const sub = DeviceEventEmitter.addListener('GlideTelegramChat', () => latest.current());
        return () => sub.remove();
    }, []);
}

/** Saved films and those on their way, kept current. */
export function useTelegramSaves(): TgSave[] {
    const [saves, setSaves] = useState<TgSave[]>([]);
    useEffect(() => {
        if (!TELEGRAM_AVAILABLE) { return; }
        let live = true;
        TelegramService.saves().then(s => { if (live) { setSaves(s); } }, () => {});
        const sub = DeviceEventEmitter.addListener('GlideTelegramSaves', (l: Omit<TgSave, 'name' | 'duration'>[]) => setSaves(withMeta(l)));
        return () => { live = false; sub.remove(); };
    }, []);
    return saves;
}

/** How a save reads on its film's row: "Downloaded", "Downloading 34%", "Waiting to download". */
export function saveLabel(s: TgSave | undefined): string | undefined {
    if (!s) { return undefined; }
    if (s.state === 'saved') { return 'Downloaded'; }
    if (s.state === 'waiting') { return 'Waiting to download'; }
    return `Downloading ${s.total ? Math.floor((s.done * 100) / s.total) : 0}%`;
}
