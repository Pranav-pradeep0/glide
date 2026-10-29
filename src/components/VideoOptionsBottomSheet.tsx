// src/components/VideoOptionsBottomSheet.tsx
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, NativeModules } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { useTheme } from '@/hooks/useTheme';
import { VideoFile, VideoHistoryEntry } from '@/types';
import { formatDuration, formatFileSize } from '@/utils/formatUtils';
import { useThumbnail } from '@/hooks/useThumbnails';
import { ListGroup, ListRow, Sheet } from '@/components/ui';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { getResumablePosition, isFinished } from '@/utils/playbackResume';
import { metrics, type } from '@/theme/theme';

interface VideoOptionsProps {
    visible: boolean;
    video: VideoFile | VideoHistoryEntry | null;
    onClose: () => void;
    onPlay: () => void;
    /** Left out where the file isn't on this device (a network share): no Share or Delete row. */
    onShare?: () => void;
    onDelete?: () => void;
    onClearHistory?: () => void;
}

interface ExtendedMeta {
    bitrate?: string;
    video?: string;
    audio?: string;
    subtitles?: string;
    loading: boolean;
}

const SUBTITLE_CODEC_NAMES: Record<string, string> = {
    subrip: 'SRT',
    hdmv_pgs_subtitle: 'PGS',
    ass: 'SSA',
    mov_text: 'MOV',
};

export const VideoOptionsBottomSheet: React.FC<VideoOptionsProps> = ({
    visible,
    video,
    onClose,
    onPlay,
    onShare,
    onDelete,
    onClearHistory,
}) => {
    const { colors } = useTheme();

    const path = video ? ('path' in video ? video.path : video.videoPath) : '';
    const name = video ? ('name' in video ? video.name : video.videoName) : '';
    const duration = video ? video.duration : 0;
    const size = video && 'size' in video ? video.size : (video && 'fileSize' in video ? video.fileSize : 0);
    const date = video && 'modifiedDate' in video ? video.modifiedDate : (video && 'lastWatchedTime' in video ? video.lastWatchedTime : 0);
    const dateLabel = video && 'lastWatchedTime' in video ? 'Watched' : 'Modified';
    const resolution = video && 'width' in video && video.width && video.height ? `${video.width} × ${video.height}` : null;
    const smb = path.startsWith('smb://');
    // An app's link: its "folder" is a server path (a debrid token, say), and secure_uri hides it anyway.
    const link = /^https?:/.test(path);
    const folder = link ? undefined : path.split('/').slice(0, -1).pop();

    // The store, not `video`: a Recents entry handed in is a snapshot.
    const entry = useVideoHistoryStore((s) => (path ? s.getVideoHistory(path) : null));
    const setWatchedPosition = useVideoHistoryStore((s) => s.setWatchedPosition);
    const watchedDuration = entry?.duration || duration;
    const position = entry?.lastPausedPosition ?? 0;
    const resumeAt = getResumablePosition(position, watchedDuration);
    const finished = isFinished(position, watchedDuration);
    const setPosition = (seconds: number) => setWatchedPosition(path, name, seconds, watchedDuration);

    // From Recents, the same stop frame the row shows.
    const { thumbnail } = useThumbnail(path, video && 'videoPath' in video ? video.stopFrameMs : undefined);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [extendedMeta, setExtendedMeta] = useState<ExtendedMeta>({ loading: false });

    useEffect(() => {
        if (!visible) {
            setDetailsOpen(false);
            return;
        }
        if (!path) {return;}
        let cancelled = false;
        setExtendedMeta({ loading: true });

        const syncModule = NativeModules.SubtitleSyncModule;
        // It reads local files only.
        if (syncModule?.getVideoMetadata && !smb && !link) {
            syncModule.getVideoMetadata(path).then((data: any) => {
                if (cancelled) {return;}
                if (!data) {
                    setExtendedMeta({ loading: false });
                    return;
                }

                const subtitlesList = data.subtitles as { lang: string; codec: string }[] | undefined;
                const subtitles = subtitlesList && subtitlesList.length > 0
                    ? `${[...new Set(subtitlesList.map(t => t.lang))].join(', ')} · ${[...new Set(subtitlesList.map(t => t.codec))].join(' / ')}`
                    : undefined;

                setExtendedMeta({
                    bitrate: data.bitrate || undefined,
                    video: data.video || undefined,
                    audio: data.audio || undefined,
                    subtitles,
                    loading: false,
                });
            }).catch(() => {
                if (!cancelled) {setExtendedMeta({ loading: false });}
            });
        } else {
            setExtendedMeta({ loading: false });
        }

        return () => { cancelled = true; };
    }, [visible, path, smb, link]);

    const formattedDate = useMemo(() => {
        if (!date) { return null; }
        return new Date(date).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }, [date]);


    if (!video) { return null; }

    const handleAction = (action: () => void) => {
        onClose();
        setTimeout(action, 250);
    };

    const folderLabel = folder && smb ? decodeURIComponent(folder) : folder;
    const metaLine = [duration ? formatDuration(duration) : null, size ? formatFileSize(size) : null, folderLabel]
        .filter(Boolean)
        .join(' · ');

    const details: [string, string | null | undefined][] = [
        ['Duration', duration ? formatDuration(duration) : null],
        ['Size', size ? formatFileSize(size) : null],
        [dateLabel, formattedDate],
        ['Resolution', resolution],
        ['Video', extendedMeta.video],
        ['Audio', extendedMeta.audio],
        ['Bitrate', extendedMeta.bitrate],
        ['Subtitles', extendedMeta.subtitles],
        ['Folder', folderLabel],
    ];

    return (
        <Sheet visible={visible} onClose={onClose}>
            <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.header}>
                    <View style={[styles.thumbnail, { backgroundColor: colors.surfaceVariant }]}>
                        {thumbnail ? (
                            <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        ) : (
                            <Feather name="film" size={20} color={colors.textTertiary} />
                        )}
                    </View>
                    <View style={styles.headerText}>
                        <Text style={[type.heading, { color: colors.text }]} numberOfLines={2}>{name}</Text>
                        {!!metaLine && (
                            <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>{metaLine}</Text>
                        )}
                    </View>
                </View>

                <ListGroup inset>
                    <ListRow icon="play" title={resumeAt !== null ? `Resume from ${formatDuration(resumeAt)}` : 'Play'} onPress={() => handleAction(onPlay)} />
                    {resumeAt !== null && (
                        <ListRow icon="rotate-ccw" title="Play from start" onPress={() => handleAction(() => { setPosition(0); onPlay(); })} />
                    )}
                    {watchedDuration > 0 && (finished
                        ? <ListRow icon="eye-off" title="Mark as unwatched" onPress={() => handleAction(() => setPosition(0))} />
                        : <ListRow icon="check-circle" title="Mark as watched" onPress={() => handleAction(() => setPosition(watchedDuration))} />
                    )}
                    {onShare && <ListRow icon="share-2" title="Share" onPress={() => handleAction(onShare)} />}
                    {onClearHistory && (
                        <ListRow icon="x-circle" title="Remove from Recents" onPress={() => handleAction(onClearHistory)} />
                    )}
                    {onDelete && <ListRow icon="trash-2" title="Delete from device" destructive onPress={() => handleAction(onDelete)} />}
                </ListGroup>

                <ListGroup inset style={styles.details}>
                    <ListRow
                        title="Details"
                        onPress={() => setDetailsOpen(open => !open)}
                        trailing={<Feather name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />}
                    />
                    {detailsOpen && details.filter(([, value]) => !!value).map(([label, value]) => (
                        <ListRow key={label} title={label} value={value ?? undefined} />
                    ))}
                    {detailsOpen && extendedMeta.loading && <ListRow title="Reading file…" />}
                </ListGroup>
            </ScrollView>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
        paddingBottom: metrics.space.lg,
    },
    thumbnail: {
        width: 96,
        aspectRatio: 16 / 9,
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerText: { flex: 1, gap: 4 },
    details: { marginTop: metrics.space.md },
});
