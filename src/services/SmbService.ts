import { NativeModules } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { hasNativeApi } from '@/native/GlideNative';

/** A share the user added. One login per host: native keys sessions by host. */
export interface SmbServer {
    host: string;
    share: string;
    /** Empty for guest. */
    user: string;
    domain: string;
    /** The password, sealed by GlideSmb.encrypt (AndroidKeyStore AES-GCM). Never stored in the clear. */
    secret: string;
}

/** A server found on the network. */
export interface SmbHost {
    host: string;
    name: string | null;
}

export interface SmbEntry {
    name: string;
    isDirectory: boolean;
    size: number;
}

const native = NativeModules.GlideSmb as
    | {
          encrypt(plain: string): Promise<string>;
          setServers(servers: SmbServer[]): Promise<string[]>;
          discover(): Promise<SmbHost[]>;
          listShares(host: string, user: string, password: string, domain: string): Promise<string[]>;
          list(uri: string): Promise<SmbEntry[]>;
          readText(uri: string): Promise<string>;
          speedTest(uri: string): Promise<string>;
      }
    | undefined;

const mmkv = createMMKV({ id: 'glide_smb_v1' });
const KEY = 'servers';

/** Level 20+: older APKs have no SMB (18 and 19 had parts of it, never released). */
export const SMB_AVAILABLE = hasNativeApi(20) && !!native;

let pushed: Promise<unknown> | null = null;

function save(servers: SmbServer[]) {
    mmkv.set(KEY, JSON.stringify(servers));
    pushed = native!.setServers(servers);
    return pushed;
}

export const SmbService = {
    servers(): SmbServer[] {
        try {
            return JSON.parse(mmkv.getString(KEY) ?? '[]');
        } catch {
            return [];
        }
    },

    /** `smb://host/share/a/b`, each part encoded. */
    uri(server: Pick<SmbServer, 'host' | 'share'>, ...path: string[]): string {
        return `smb://${server.host}/${[server.share, ...path].map(encodeURIComponent).join('/')}`;
    },

    /** Native holds logins in memory only, so they are handed over once per process before first use. */
    ready(): Promise<unknown> {
        return (pushed ??= native!.setServers(SmbService.servers()));
    },

    /** Servers on the local network; takes about 3 s. */
    discover(): Promise<SmbHost[]> {
        return native!.discover();
    },

    /** Signs in and lists the disk shares; empty when the server won't list them. */
    listShares(login: { host: string; user: string; password: string; domain: string }): Promise<string[]> {
        return native!.listShares(login.host, login.user, login.password, login.domain);
    },

    async list(uri: string): Promise<SmbEntry[]> {
        await SmbService.ready();
        return native!.list(uri);
    },

    /** A sidecar subtitle file as text, up to 10 MB. */
    async readText(uri: string): Promise<string> {
        await SmbService.ready();
        return native!.readText(uri);
    },

    /**
     * Signs in and lists the share before saving, so a typo fails here and not on first play.
     * A new login for a host replaces it on that host's other shares too.
     */
    async add(input: Omit<SmbServer, 'secret'> & { password: string }): Promise<SmbServer> {
        const { password, ...rest } = input;
        const server: SmbServer = { ...rest, secret: password ? await native!.encrypt(password) : '' };
        const old = SmbService.servers();
        const next = [
            ...old.filter(s => !(s.host === server.host && s.share === server.share))
                .map(s => (s.host === server.host ? { ...s, user: server.user, domain: server.domain, secret: server.secret } : s)),
            server,
        ];
        await native!.setServers(next);
        try {
            await native!.list(SmbService.uri(server));
        } catch (e) {
            pushed = native!.setServers(old);
            throw e;
        }
        await save(next);
        return server;
    },

    remove(server: SmbServer) {
        return save(SmbService.servers().filter(s => !(s.host === server.host && s.share === server.share)));
    },

    /** Go/no-go speed test (docs/network-shares.md). Remove before the release that ships SMB. */
    async speedTest(uri: string): Promise<string> {
        await SmbService.ready();
        return native!.speedTest(uri);
    },
};
