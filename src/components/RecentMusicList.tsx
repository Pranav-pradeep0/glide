import React, { useEffect, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { useAudioStore } from '@/store/audioStore';
import { useMusicHistoryStore } from '@/store/musicHistoryStore';
import { AudioMediaService } from '@/services/AudioMediaService';
import { usePermissionStore } from '@/store/permissionStore';
import { PermissionGate } from '@/components/PermissionGate';
import { TrackRow } from '@/components/TrackRow';
import { TrackOptionsSheet } from '@/components/TrackOptionsSheet';
import { EmptyState, getRelativeTime } from '@/components/VideoRow';
import { Loader } from '@/components/Loader';
import { metrics } from '@/theme/theme';
import { AudioTrack, RootStackParamList } from '@/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface RecentSong {
    track: AudioTrack;
    playedAt: number;
}

/** Recents > Music: recently played songs, newest first. */
export function RecentMusicList() {
    const navigation = useNavigation<NavigationProp>();
    const entries = useMusicHistoryStore((s) => s.entries);
    const currentTrack = useAudioStore((s) => s.currentTrack);
    const isPlaying = useAudioStore((s) => s.isPlaying);
    const playTrack = useAudioStore((s) => s.playTrack);

    const [library, setLibrary] = useState<AudioTrack[] | null>(() => AudioMediaService.cachedSongs);
    const [selected, setSelected] = useState<AudioTrack | null>(null);

    // Loads once access is there, and again when it is granted.
    const audioAccess = usePermissionStore((s) => s.audio.access);
    useEffect(() => {
        if (audioAccess !== 'granted') return;
        let alive = true;
        AudioMediaService.getSongs().then((songs) => {
            if (alive) setLibrary(songs);
        });
        return () => {
            alive = false;
        };
    }, [audioAccess]);

    // Songs no longer on the device (or opened from outside the library) drop out here.
    const recent = useMemo<RecentSong[]>(() => {
        if (!library) return [];
        const byId = new Map(library.map((t) => [t.id, t]));
        return entries.flatMap((e) => {
            const track = byId.get(e.id);
            return track ? [{ track, playedAt: e.playedAt }] : [];
        });
    }, [library, entries]);
    const queue = useMemo(() => recent.map((r) => r.track), [recent]);

    // Without access the songs cannot be matched to the history, so ask rather than say
    // "nothing played yet".
    if (audioAccess === 'denied') {
        return <PermissionGate kind="audio" />;
    }
    if (!library) {
        return <Loader />;
    }

    if (recent.length === 0) {
        return (
            <EmptyState
                icon="music"
                text="Nothing played yet"
                action="Browse music"
                onAction={() => navigation.navigate('MainTabs', { screen: 'Music' })}
            />
        );
    }

    return (
        <>
            <FlashList
                data={recent}
                keyExtractor={(item) => item.track.id}
                renderItem={({ item }) => (
                    <TrackRow
                        track={item.track}
                        isCurrent={currentTrack?.id === item.track.id}
                        isPlaying={currentTrack?.id === item.track.id && isPlaying}
                        caption={`${item.track.artist} · ${getRelativeTime(item.playedAt)}`}
                        onPress={() =>
                            currentTrack?.id === item.track.id
                                ? navigation.navigate('NowPlaying')
                                : playTrack(item.track, queue, 'Recently played')
                        }
                        onMore={setSelected}
                    />
                )}
                contentContainerStyle={{ paddingHorizontal: metrics.gutter - metrics.space.sm, paddingBottom: metrics.space.xxl * 2 }}
                showsVerticalScrollIndicator={false}
            />

            <TrackOptionsSheet
                track={selected}
                visible={!!selected}
                onClose={() => setSelected(null)}
                onGoToAlbum={(albumId, albumTitle, artist) =>
                    navigation.navigate('AlbumDetail', { albumId, albumTitle, artist })
                }
                onGoToArtist={(artistId, artistName) => navigation.navigate('ArtistDetail', { artistId, artistName })}
            />
        </>
    );
}
