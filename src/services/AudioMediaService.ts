import { NativeModules, Platform } from 'react-native';
import { AudioAlbum, AudioArtist, AudioFolder, AudioTrack } from '@/types';
import { PermissionService } from './PermissionService';

class AudioMediaServiceClass {
    private songsCache: AudioTrack[] | null = null;
    /** The scan currently running, shared by everyone who asks while it is in flight. */
    private inflightSongs: Promise<AudioTrack[]> | null = null;

    private get module() {
        return NativeModules.MediaStoreAudioModule;
    }

    invalidateCache() {
        this.songsCache = null;
        // A scan already running may have read the library before the change.
        this.inflightSongs = null;
    }

    getCachedSongById(trackId: string): AudioTrack | undefined {
        return this.songsCache?.find((s) => String(s.id) === String(trackId));
    }

    async getSongs(forceRefresh = false): Promise<AudioTrack[]> {
        if (Platform.OS !== 'android' || !this.module) {
            return [];
        }

        // Check only: a data call never prompts. The grant-access screen asks.
        if (!(await PermissionService.checkAudioPermission())) {
            return [];
        }

        if (!forceRefresh && this.songsCache) {
            return this.songsCache;
        }

        // The Music tab, the mini player and the queue hydration all ask at once on a cold
        // start, before the cache exists. One scan answers all of them. A forced refresh
        // does not join: the scan already running may predate the change it is after.
        if (!forceRefresh && this.inflightSongs) {
            return this.inflightSongs;
        }

        // Same shape as MediaService.getLibrary: started from a resolved promise so a
        // synchronous native throw cannot settle it before `scan` is assigned, and only the
        // newest scan may write the cache.
        const scan: Promise<AudioTrack[]> = Promise.resolve()
            .then(() => this.module.getSongs() as Promise<AudioTrack[]>)
            .then((songs) => {
                if (this.inflightSongs === scan) {
                    this.songsCache = songs;
                }
                return songs;
            })
            .catch((error) => {
                console.error('[AudioMediaService] Failed to load songs:', error);
                return this.songsCache ?? [];
            })
            .finally(() => {
                if (this.inflightSongs === scan) {
                    this.inflightSongs = null;
                }
            });
        this.inflightSongs = scan;
        return scan;
    }

    groupAlbums(songs: AudioTrack[]): AudioAlbum[] {
        const map = new Map<string, AudioAlbum>();

        for (const song of songs) {
            const key = song.albumId || song.album;
            let entry = map.get(key);
            if (!entry) {
                entry = {
                    id: key,
                    album: song.album || 'Unknown Album',
                    artist: song.artist || 'Unknown Artist',
                    numberOfSongs: 0,
                    year: song.year,
                    artworkUri: song.artworkUri,
                    firstSongUri: song.uri || song.path,
                };
                map.set(key, entry);
            }
            entry.numberOfSongs += 1;
            if (!entry.firstSongUri && (song.uri || song.path)) {
                entry.firstSongUri = song.uri || song.path;
            }
            if (!entry.artworkUri && song.artworkUri) {
                entry.artworkUri = song.artworkUri;
            }
            if (!entry.year && song.year) {
                entry.year = song.year;
            }
        }

        const albums = Array.from(map.values());
        albums.sort((a, b) => a.album.localeCompare(b.album, undefined, { sensitivity: 'base' }));
        return albums;
    }

    groupArtists(songs: AudioTrack[]): AudioArtist[] {
        const map = new Map<string, { artist: AudioArtist; albumIds: Set<string> }>();

        for (const song of songs) {
            const key = song.artist || 'Unknown Artist';
            let entry = map.get(key);
            if (!entry) {
                entry = {
                    artist: {
                        id: song.artistId || key,
                        artist: key,
                        numberOfAlbums: 0,
                        numberOfTracks: 0,
                    },
                    albumIds: new Set<string>(),
                };
                map.set(key, entry);
            }
            entry.artist.numberOfTracks += 1;
            if (song.albumId) {
                entry.albumIds.add(song.albumId);
            }
        }

        const artists = Array.from(map.values()).map((e) => {
            e.artist.numberOfAlbums = Math.max(1, e.albumIds.size);
            return e.artist;
        });
        artists.sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }));
        return artists;
    }

    /**
     * Scan library once and group albums & artists simultaneously in a single pass.
     */
    async getLibrary(forceRefresh = false): Promise<{
        tracks: AudioTrack[];
        albums: AudioAlbum[];
        artists: AudioArtist[];
    }> {
        const tracks = await this.getSongs(forceRefresh);
        return {
            tracks,
            albums: this.groupAlbums(tracks),
            artists: this.groupArtists(tracks),
        };
    }

    async getAlbums(forceRefresh = false): Promise<AudioAlbum[]> {
        const songs = await this.getSongs(forceRefresh);
        return this.groupAlbums(songs);
    }

    async getArtists(forceRefresh = false): Promise<AudioArtist[]> {
        const songs = await this.getSongs(forceRefresh);
        return this.groupArtists(songs);
    }

    async getSongsByAlbum(albumId: string): Promise<AudioTrack[]> {
        const songs = await this.getSongs();
        return songs
            .filter((s) => s.albumId === albumId || s.album === albumId)
            .sort((a, b) => {
                if (a.trackNumber !== b.trackNumber && a.trackNumber > 0 && b.trackNumber > 0) {
                    return a.trackNumber - b.trackNumber;
                }
                return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
            });
    }

    async getSongsByArtist(artistIdOrName: string): Promise<AudioTrack[]> {
        const songs = await this.getSongs();
        return songs
            .filter((s) => s.artistId === artistIdOrName || s.artist === artistIdOrName)
            .sort((a, b) => {
                const yearDiff = (b.year ?? 0) - (a.year ?? 0);
                if (yearDiff !== 0) return yearDiff;
                const albumDiff = a.album.localeCompare(b.album, undefined, { sensitivity: 'base' });
                if (albumDiff !== 0) return albumDiff;
                return (a.trackNumber ?? 0) - (b.trackNumber ?? 0);
            });
    }

    groupFolders(songs: AudioTrack[]): AudioFolder[] {
        const map = new Map<string, { folder: AudioFolder }>();

        for (const song of songs) {
            const rawPath = song.path || '';
            const lastSlash = rawPath.lastIndexOf('/');
            const folderPath = lastSlash > 0 ? rawPath.substring(0, lastSlash) : '/';
            const folderName = folderPath.substring(folderPath.lastIndexOf('/') + 1) || 'Root';

            let entry = map.get(folderPath);
            if (!entry) {
                entry = {
                    folder: {
                        path: folderPath,
                        name: folderName,
                        numberOfSongs: 0,
                    },
                };
                map.set(folderPath, entry);
            }
            entry.folder.numberOfSongs += 1;
        }

        const folders = Array.from(map.values()).map((e) => e.folder);
        folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        return folders;
    }

    async getFolders(forceRefresh = false): Promise<AudioFolder[]> {
        const songs = await this.getSongs(forceRefresh);
        return this.groupFolders(songs);
    }

    async getSongsByFolder(folderPath: string): Promise<AudioTrack[]> {
        const songs = await this.getSongs();
        return songs
            .filter((s) => {
                const rawPath = s.path || '';
                const lastSlash = rawPath.lastIndexOf('/');
                const path = lastSlash > 0 ? rawPath.substring(0, lastSlash) : '/';
                return path === folderPath;
            })
            .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    }

    async getAlbumArt(albumId: string, songUri?: string): Promise<string | null> {
        if (Platform.OS !== 'android' || !this.module) {
            return null;
        }
        try {
            return await this.module.getAlbumArt(albumId, songUri ?? null);
        } catch {
            return null;
        }
    }

    async getAlbumArtDetails(
        albumId: string,
        songUri?: string
    ): Promise<{ artworkUri: string | null; primaryColor: string | null; secondaryColor: string | null; onPrimaryColor: string | null }> {
        if (Platform.OS !== 'android' || !this.module) {
            return { artworkUri: null, primaryColor: null, secondaryColor: null, onPrimaryColor: null };
        }
        try {
            if (typeof this.module.getAlbumArtWithPalette === 'function') {
                const res = await this.module.getAlbumArtWithPalette(albumId, songUri ?? null);
                return {
                    artworkUri: res?.artworkUri ?? null,
                    primaryColor: res?.primaryColor ?? null,
                    secondaryColor: res?.secondaryColor ?? null,
                    onPrimaryColor: res?.onPrimaryColor ?? null,
                };
            }
            const uri = await this.module.getAlbumArt(albumId, songUri ?? null);
            return { artworkUri: uri ?? null, primaryColor: null, secondaryColor: null, onPrimaryColor: null };
        } catch {
            return { artworkUri: null, primaryColor: null, secondaryColor: null, onPrimaryColor: null };
        }
    }

    async getEmbeddedLyrics(songUri?: string, filePath?: string): Promise<string | null> {
        if (Platform.OS !== 'android' || !this.module?.getEmbeddedLyrics) {
            return null;
        }
        try {
            return await this.module.getEmbeddedLyrics(songUri ?? null, filePath ?? null);
        } catch {
            return null;
        }
    }
}

export const AudioMediaService = new AudioMediaServiceClass();
