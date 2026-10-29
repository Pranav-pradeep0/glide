/**
 * The video list kit shared by Recents, Album and Search: a list row, a grid card, the
 * Recents hero, the screen header, the empty state and the share/delete helpers.
 *
 * Artwork leads. Rows carry no container box; the thumbnail is the visual weight, and the
 * title is the parsed name ("The Boys", "S5 E4"), never the raw release filename.
 */
import React, { useMemo } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { useTheme } from '@/hooks/useTheme';
import { useThumbnail } from '@/hooks/useThumbnails';
import { playerColors } from '@/theme/colors';
import { metrics, type, TV_SCALE } from '@/theme/theme';
import { IS_TV } from '@/utils/tv';
import { formatDuration } from '@/utils/formatUtils';
import { FilenameParser } from '@/utils/FilenameParser';
import { Button, Gradient, IconButton, IconName, showDialog, showSnackbar, Touchable } from '@/components/ui';
import { MediaService } from '@/services/MediaService';

// ============= HELPERS =============

/** "12:34 left" while partly watched; the full length is the thumbnail's badge. */
export function timeLabel(duration: number, position = 0): string | undefined {
    if (duration > 0 && position > 0 && position < duration) {
        return `${formatDuration(duration - position)} left`;
    }
    return undefined;
}

export function progressOf(duration?: number, position?: number): number {
    if (!duration || !position || duration <= 0) {return 0;}
    return Math.min(1, Math.max(0, position / duration));
}

/** "3 days ago" for a time in ms. */
export function getRelativeTime(timestamp: number): string {
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) {return days === 1 ? '1 day ago' : `${days} days ago`;}
    if (hours > 0) {return hours === 1 ? '1 hour ago' : `${hours} hours ago`;}
    if (minutes > 0) {return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;}
    return 'Just now';
}

export const joinMeta = (...parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(' · ');

const titleCache = new Map<string, { title: string; detail?: string }>();

/** "The.Boys.S05E04.1080p.WEB" → { title: "The Boys", detail: "S5 E4" }; movies get their year. */
export function prettyTitle(name: string): { title: string; detail?: string } {
    const cached = titleCache.get(name);
    if (cached) {return cached;}
    const parsed = FilenameParser.parse(name);
    let result: { title: string; detail?: string } = { title: parsed.title || name };
    if (parsed.isTVShow && (parsed.season || parsed.episode)) {
        result.detail = [parsed.season && `S${parsed.season}`, parsed.episode && `E${parsed.episode}`]
            .filter(Boolean).join(' ');
    } else if (parsed.year) {
        result.detail = String(parsed.year);
    }
    titleCache.set(name, result);
    return result;
}

export async function shareVideo(pathOrUri: string) {
    try {
        await MediaService.shareVideo(pathOrUri);
    } catch (error: any) {
        showSnackbar({
            text: error?.code === 'E_OLD_APK' ? error.message
                : error?.code === 'E_NOT_FOUND' ? "This video isn't in your library yet, so it can't be shared"
                : error?.code === 'E_NO_ACCESS' ? 'Glide can no longer read this video. Open it again to share it'
                : "Couldn't open sharing",
            tone: 'reject',
        });
    }
}

/**
 * Delete one video, the same way on every screen. Android 11+ confirms in its own system
 * dialog (inside MediaService.deleteVideos); older versions get an in-app confirm first.
 *
 * Resolves true only when the file is gone, so callers clean up history and lists only then.
 * A cancel at either dialog is false and silent; a failure says why.
 */
export function deleteVideo(name: string, target: string): Promise<boolean> {
    const run = async () => {
        try {
            return await MediaService.deleteVideos([target]);
        } catch (error: any) {
            console.error('[deleteVideo] Delete failed:', error);
            showDialog(
                'Delete failed',
                error?.code === 'E_PERMISSION'
                    ? 'Glide needs storage access to delete videos on this version of Android.'
                    : 'Could not delete the file.',
            );
            return false;
        }
    };
    if (Platform.OS === 'android' && Platform.Version >= 30) {
        return run();
    }
    return new Promise((resolve) => {
        showDialog(`Delete "${name}"?`, undefined, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Delete', style: 'destructive', onPress: () => { run().then(resolve); } },
        ]);
    });
}

// ============= THUMBNAIL =============

export function ProgressLine({ progress, style }: { progress: number; style?: object }) {
    const { colors } = useTheme();
    return (
        <View style={[styles.track, style]}>
            <View style={[styles.bar, { width: `${progress * 100}%`, backgroundColor: colors.primary }]} />
        </View>
    );
}

function Thumbnail({ path, timeMs, progress, duration, style }: { path: string; timeMs?: number; progress: number; duration?: number; style: object }) {
    const { colors } = useTheme();
    const { thumbnail } = useThumbnail(path, timeMs);
    return (
        <View style={[styles.thumb, { backgroundColor: colors.surfaceVariant }, style]}>
            {thumbnail
                ? <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                : <Feather name="film" size={20} color={colors.textTertiary} />}
            {!!duration && duration > 0 && (
                <View style={styles.badge}>
                    <Text style={styles.badgeText}>{formatDuration(duration)}</Text>
                </View>
            )}
            {progress > 0 && <ProgressLine progress={progress} style={styles.thumbTrack} />}
        </View>
    );
}

/** The title with the part matching `highlight` in the accent. */
function HighlightedTitle({ title, highlight, lines }: { title: string; highlight?: string; lines: number }) {
    const { colors } = useTheme();
    const q = highlight?.trim().toLowerCase() ?? '';
    const at = q ? title.toLowerCase().indexOf(q) : -1;
    return (
        <Text style={[type.row, { color: colors.text }]} numberOfLines={lines}>
            {at < 0 ? title : (
                <>
                    {title.slice(0, at)}
                    <Text style={{ color: colors.primary }}>{title.slice(at, at + q.length)}</Text>
                    {title.slice(at + q.length)}
                </>
            )}
        </Text>
    );
}

// ============= ROW + CARD =============

interface VideoItemProps<T> {
    /**
     * Whatever the list is of. The row only hands it back on press, which is what lets a
     * screen pass one stable callback to every row instead of a fresh closure per item --
     * the thing that was defeating the memo and re-rendering every visible cell.
     */
    item: T;
    path: string;
    name: string;
    /** One line, e.g. "12:34 left · 1.2 GB". The parsed episode or year is put in front. */
    meta: string;
    /** Seconds; shown as the thumbnail badge. */
    duration?: number;
    /** 0..1 watched. */
    progress?: number;
    /** Frame to show, in ms; unset for the usual one. */
    thumbnailTime?: number;
    /** Search term to mark in the title. */
    highlight?: string;
    onPress: (item: T) => void;
    onMore: (item: T) => void;
    /** TV: take the D-pad focus on mount; pass it to a list's first item. */
    preferFocus?: boolean;
}

/** What a list renders each row with; `VideoRow` and `VideoCard` are interchangeable. */
export type VideoItemComponent = <T>(props: VideoItemProps<T>) => React.ReactElement;

function useItemText(name: string, meta: string) {
    return useMemo(() => {
        const { title, detail } = prettyTitle(name);
        return { title, meta: joinMeta(detail, meta) };
    }, [name, meta]);
}

function VideoRowBase<T>({ item, path, name, meta, duration, progress = 0, thumbnailTime, highlight, onPress, onMore, preferFocus }: VideoItemProps<T>) {
    const { colors } = useTheme();
    const text = useItemText(name, meta);
    return (
        <Touchable
            onPress={() => onPress(item)}
            onLongPress={() => onMore(item)}
            scaleTo={0.98}
            stateLayer
            preferFocus={preferFocus}
            accessibilityRole="button"
            accessibilityLabel={`Play ${text.title}`}
            accessibilityHint={text.meta}
            style={styles.row}
        >
            <Thumbnail path={path} timeMs={thumbnailTime} progress={progress} duration={duration} style={styles.rowThumb} />
            <View style={styles.info}>
                <HighlightedTitle title={text.title} highlight={highlight} lines={2} />
                {!!text.meta && (
                    <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>{text.meta}</Text>
                )}
            </View>
            <IconButton
                icon="more-vertical"
                color={colors.textTertiary}
                onPress={() => onMore(item)}
                accessibilityLabel={`More options for ${text.title}`}
                style={IS_TV && styles.rowMoreTv}
            />
        </Touchable>
    );
}
export const VideoRow = React.memo(VideoRowBase) as VideoItemComponent;

function VideoCardBase<T>({ item, path, name, meta, duration, progress = 0, thumbnailTime, highlight, onPress, onMore, preferFocus }: VideoItemProps<T>) {
    const { colors } = useTheme();
    const text = useItemText(name, meta);
    return (
        <Touchable
            onPress={() => onPress(item)}
            onLongPress={() => onMore(item)}
            scaleTo={0.98}
            preferFocus={preferFocus}
            accessibilityRole="button"
            accessibilityLabel={`Play ${text.title}`}
            accessibilityHint={text.meta}
            style={styles.gridCard}
        >
            <Thumbnail path={path} timeMs={thumbnailTime} progress={progress} duration={duration} style={styles.gridThumb} />
            <View style={styles.gridInfo}>
                <View style={styles.info}>
                    <HighlightedTitle title={text.title} highlight={highlight} lines={1} />
                    {!!text.meta && (
                        <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>{text.meta}</Text>
                    )}
                </View>
                {/* Not on a TV: inside the card it would be a second D-pad stop between every two
                    cards. Options there are in list view, Right from a row. */}
                {!IS_TV && (
                    <IconButton
                        icon="more-vertical"
                        iconSize={16}
                        color={colors.textTertiary}
                        onPress={() => onMore(item)}
                        accessibilityLabel={`More options for ${text.title}`}
                        style={styles.gridMore}
                    />
                )}
            </View>
        </Touchable>
    );
}
export const VideoCard = React.memo(VideoCardBase) as VideoItemComponent;

// ============= HERO =============

/** The one thing you were just watching, full width, with the picture doing the work. */
export function ContinueCard<T>({ item, path, name, meta, progress = 0, thumbnailTime, onPress, onMore, preferFocus }: VideoItemProps<T>) {
    const { colors } = useTheme();
    const text = useItemText(name, meta);
    const { thumbnail } = useThumbnail(path, thumbnailTime);
    return (
        <Touchable
            onPress={() => onPress(item)}
            onLongPress={() => onMore(item)}
            scaleTo={0.985}
            preferFocus={preferFocus}
            accessibilityRole="button"
            accessibilityLabel={`Resume ${text.title}`}
            accessibilityHint={text.meta}
            style={[styles.hero, { backgroundColor: colors.surfaceVariant }]}
        >
            {thumbnail && <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
            <Gradient
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.88)']}
                locations={[0.25, 0.55, 1]}
                style={StyleSheet.absoluteFill}
            />
            <IconButton
                icon="more-horizontal"
                onPress={() => onMore(item)}
                accessibilityLabel={`More options for ${text.title}`}
                onPlayer
                variant="filled"
                style={styles.heroMore}
            />
            <View style={styles.heroBody}>
                <View style={styles.heroText}>
                    {!!text.meta && <Text style={styles.heroMeta} numberOfLines={1}>{text.meta}</Text>}
                    <Text style={styles.heroTitle} numberOfLines={2}>{text.title}</Text>
                    {progress > 0 && <ProgressLine progress={progress} style={styles.heroTrack} />}
                </View>
                <View style={[styles.heroPlay, { backgroundColor: colors.primary }]}>
                    <Feather name="play" size={22} color={colors.onPrimary} style={styles.playNudge} />
                </View>
            </View>
        </Touchable>
    );
}

/** A soft wash of the hero's picture behind the top of the screen. */
export function AmbientBackdrop({ path, thumbnailTime }: { path?: string; thumbnailTime?: number }) {
    const { colors } = useTheme();
    const { thumbnail } = useThumbnail(path, thumbnailTime);
    if (!thumbnail) {return null;}
    return (
        <View style={styles.ambient} pointerEvents="none">
            <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} blurRadius={40} resizeMode="cover" />
            <Gradient
                colors={[`${colors.background}CC`, `${colors.background}F2`, colors.background]}
                locations={[0, 0.6, 1]}
                style={StyleSheet.absoluteFill}
            />
        </View>
    );
}

export function SectionTitle({ title, children }: { title: string; children?: React.ReactNode }) {
    const { colors } = useTheme();
    return (
        <View style={styles.sectionRow}>
            <Text style={[type.section, { color: colors.text }]}>{title}</Text>
            {children}
        </View>
    );
}

/** Spacing wrapper so list and grid items sit on the same rhythm inside a FlashList. */
/**
 * Spacing wrapper only.
 *
 * It used to run an entering spring per cell. FlashList recycles its cells, so that spring
 * fired again every time a view was reused for a new row -- items springing in mid-scroll,
 * and a Reanimated animation started for each one. A list that is scrolled is not a list
 * that is arriving.
 */
export function VideoItemCell({ grid, children }: { grid: boolean; children: React.ReactNode }) {
    return (
        <View style={grid ? styles.gridCell : styles.listCell}>
            {children}
        </View>
    );
}

/** FlashList contentContainerStyle for either view mode. */
export const listContentStyle = (grid: boolean, bottom = 0) => ({
    paddingHorizontal: grid ? metrics.gutter - GRID_HALF_GAP : metrics.gutter - metrics.space.sm,
    // TV: room for the first row's focus ring and grow, which the list would otherwise clip.
    paddingTop: IS_TV ? metrics.space.md : 0,
    paddingBottom: metrics.space.xxl + bottom + metrics.overscanY,
});

// ============= HEADER + EMPTY =============

interface ListHeaderProps {
    title: string;
    subtitle?: string;
    /** With a back arrow the header is an app bar (18/600); without, a large title. */
    onBack?: () => void;
    /** IconButtons on the right. */
    children?: React.ReactNode;
}

export function ListHeader({ title, subtitle, onBack, children }: ListHeaderProps) {
    const { colors } = useTheme();
    return (
        <View style={[styles.header, onBack && styles.appBar]}>
            {onBack && (
                <IconButton icon="arrow-left" onPress={onBack} accessibilityLabel="Back" style={styles.back} />
            )}
            <View style={styles.headerText}>
                <Text
                    style={[onBack ? styles.appBarTitle : type.title, { color: colors.text }]}
                    numberOfLines={1}
                    accessibilityRole="header"
                >
                    {title}
                </Text>
                {!!subtitle && <Text style={[type.caption, { color: colors.textSecondary }]}>{subtitle}</Text>}
            </View>
            <View style={styles.headerActions}>{children}</View>
        </View>
    );
}

export function EmptyState({
    text,
    action,
    onAction,
    icon = 'film',
}: {
    text: string;
    action?: string;
    onAction?: () => void;
    icon?: IconName;
}) {
    const { colors } = useTheme();
    return (
        <View style={styles.empty}>
            <Feather name={icon} size={48} color={colors.textTertiary} />
            <Text style={[type.body, styles.emptyText, { color: colors.textSecondary }]}>{text}</Text>
            {action && onAction && <Button label={action} variant="primary" onPress={onAction} preferFocus />}
        </View>
    );
}

const GRID_HALF_GAP = metrics.grid.halfGap;

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: metrics.space.sm,
        paddingLeft: metrics.space.sm,
        borderRadius: metrics.radius.md,
        gap: metrics.space.md,
    },
    thumb: {
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowThumb: { width: 128, height: 72 },
    // The radius only shapes the focus ring and tint; the card has no fill of its own.
    gridCard: { flex: 1, borderRadius: metrics.radius.sm },
    gridThumb: { width: '100%', aspectRatio: 16 / 9 },
    gridInfo: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: metrics.space.sm, paddingLeft: 2 },
    gridMore: { marginTop: -12, marginRight: -12 },
    // Pokes 1 dp past the row: Android's focus search only moves Right to a view whose right
    // edge is past the focused one's, and the row would otherwise share its edge.
    rowMoreTv: { marginRight: -1 },
    track: {
        height: 3,
        backgroundColor: 'rgba(255, 255, 255, 0.25)',
        overflow: 'hidden',
    },
    thumbTrack: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    bar: { height: '100%' },
    badge: {
        position: 'absolute',
        right: 6,
        bottom: 8,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: metrics.radius.xs,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
    },
    badgeText: { color: playerColors.text, fontSize: 10.5, lineHeight: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
    info: { flex: 1, gap: 3 },
    listCell: { paddingBottom: 2 },
    gridCell: { flex: 1, paddingHorizontal: GRID_HALF_GAP, paddingBottom: metrics.space.lg },

    hero: {
        marginHorizontal: metrics.gutter,
        aspectRatio: 16 / 10,
        // TV: full width at 16:10 is taller than a 720p screen; half leaves room for Earlier.
        width: IS_TV ? '50%' : undefined,
        borderRadius: metrics.radius.card,
        overflow: 'hidden',
        justifyContent: 'flex-end',
    },
    heroMore: { position: 'absolute', top: 6, right: 6 }, // 48 dp box: the circle sits 10 in
    heroBody: { flexDirection: 'row', alignItems: 'flex-end', padding: metrics.space.lg, gap: metrics.space.md },
    heroText: { flex: 1, gap: 4 },
    heroMeta: { color: 'rgba(255, 255, 255, 0.75)', ...type.label, fontVariant: ['tabular-nums'] },
    heroTitle: { color: playerColors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4, lineHeight: 28 },
    heroTrack: { marginTop: 8, borderRadius: 2 },
    heroPlay: {
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
    },
    playNudge: { marginLeft: 3 },
    ambient: { position: 'absolute', top: 0, left: 0, right: 0, height: 460 },

    sectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: metrics.gutter,
        paddingTop: metrics.space.xl,
        paddingBottom: metrics.space.sm,
        gap: metrics.space.sm,
    },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: metrics.gutter,
        paddingTop: metrics.space.lg + metrics.overscanY,
        paddingBottom: metrics.space.sm,
        gap: metrics.space.sm,
    },
    appBar: { paddingTop: metrics.space.xs + metrics.overscanY },
    appBarTitle: { fontSize: 18 * TV_SCALE, lineHeight: 24 * TV_SCALE, fontWeight: '600' },
    back: { marginLeft: -12 },
    headerText: { flex: 1 },
    // Holds the IconButton height even when empty, so a header doesn't jump as its buttons come and go.
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.xs, minHeight: metrics.touch },
    empty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: metrics.space.xxl,
        gap: metrics.space.lg,
    },
    emptyText: { textAlign: 'center' },
});
