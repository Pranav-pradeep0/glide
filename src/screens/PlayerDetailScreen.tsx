// src/screens/PlayerDetailScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    Alert,
    ToastAndroid,
    Platform,
    Image,
    ScrollView,
    Animated,
    Easing,
    useWindowDimensions,
} from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from '@react-native-vector-icons/feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { useAppStore } from '@/store/appStore';
import { SubtitleCueStore } from '@/services/SubtitleCueStore';
import { ContentDetector } from '../services/ContentDetector';
import { OMDBResult } from '../services/OMDBService';
import { SubtitleSelectionService } from '../services/SubtitleSelectionService';
import { SubtitlePickerService } from '../services/SubtitlePickerService';
import { searchSDHSubtitles, downloadSubtitle } from '../utils/subdlApi';
import { RootStackParamList, SubtitleResult, SubtitleCue } from '../types';
import { ImdbIcon, RottenTomatoesIcon } from '../components/VideoPlayer/PlayerIcons';
import { isAbortError } from '../utils/network';
import { Button, Gradient, IconButton, ListGroup, ListRow, Sheet } from '@/components/ui';
import { metrics, type } from '@/theme/theme';

type DetailRouteProp = RouteProp<RootStackParamList, 'PlayerDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const LOG_PREFIX = '[PlayerDetail]';
const FADE_HEIGHT = 140;

function showToast(message: string) {
    if (Platform.OS === 'android') {
        ToastAndroid.show(message, ToastAndroid.SHORT);
    }
}

const known = (value?: string) => (value && value !== 'N/A' ? value : undefined);

export default function PlayerDetailScreen() {
    const theme = useTheme();
    const { colors } = theme;
    const insets = useSafeAreaInsets();
    const route = useRoute<DetailRouteProp>();
    const navigation = useNavigation<NavigationProp>();
    const hapticsEnabled = useAppStore((state) => state.settings.hapticSettings.enabled);
    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;

    const portraitHeroHeight = Math.min(width * 1.2, 500);

    const { videoPath, videoName, albumName, bucketId } = route.params;

    // Flow state
    const [loading, setLoading] = useState(false);
    const [movieDetails, setMovieDetails] = useState<OMDBResult | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(true);

    // The sharp poster fades in over the small one once it has loaded.
    const imageOpacity = useRef(new Animated.Value(0)).current;
    const scrollY = useRef(new Animated.Value(0)).current;

    // Helper to get high-resolution poster
    const getHighResPoster = useCallback((url: string) => {
        if (!url || url === 'N/A') { return url; }
        // Replaces _SX300.jpg, _SY1000.jpg, _CR0,0,0,0.jpg etc with .jpg
        return url.replace(/_S[XY]\d+(?:_CR\d+,\d+,\d+,\d+)?.*?\.jpg$/i, '.jpg');
    }, []);

    // Subtitle data
    const [apiSubtitles, setApiSubtitles] = useState<SubtitleResult[]>([]);
    const [hapticCues, setHapticCues] = useState<SubtitleCue[] | null>(null);

    // Manual picker modal
    const [showManualPicker, setShowManualPicker] = useState(false);
    const [localSubtitles, setLocalSubtitles] = useState<string[]>([]);
    const networkAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => {
            networkAbortRef.current?.abort();
            networkAbortRef.current = null;
        };
    }, []);

    // Memoized detection logic
    const runSDHDetection = useCallback(async (imdbId?: string) => {
        networkAbortRef.current?.abort();
        networkAbortRef.current = new AbortController();
        const signal = networkAbortRef.current.signal;
        setLoading(true);

        try {
            // Step 1: Get embedded subtitle tracks
            if (__DEV__) { console.log(`${LOG_PREFIX} Getting embedded tracks...`); }
            const tracks = await SubtitleCueStore.getTracks(videoPath);

            // Step 2: Check for local subtitle files
            const locals = await SubtitlePickerService.findMatchingSubtitles(videoPath);
            setLocalSubtitles(locals);

            // Step 3: Try to find SDH content in embedded tracks
            if (tracks.length > 0) {
                const extractAndParse = async (index: number) => SubtitleCueStore.getCues(videoPath, index);
                const sdhResult = await SubtitleSelectionService.findBestSDHByContent(tracks, extractAndParse, 'en');

                if (sdhResult) {
                    setHapticCues(sdhResult.cues);
                    setLoading(false);
                    return;
                }
            }

            // Step 4: Try local subtitle files
            for (const sPath of locals) {
                const picked = await SubtitlePickerService.loadFromPath(sPath);
                if (picked && SubtitleSelectionService.validateSDHContent(picked.cues).isSDH) {
                    setHapticCues(picked.cues);
                    setLoading(false);
                    return;
                }
            }

            // Step 5: Search API for subtitles
            const apiResult = await searchSDHSubtitles(videoName, 'en', imdbId, signal);
            setApiSubtitles(apiResult.subtitles);

            const bestAPI = apiResult.subtitles.find(s => s.hearingImpaired || (s.sdhScore && s.sdhScore > 5));
            if (bestAPI) {
                const cues = await downloadSubtitle(bestAPI.downloadUrl, signal);
                if (cues) {
                    setHapticCues(cues);
                }
            }

            setLoading(false);
        } catch (error) {
            if (isAbortError(error)) {
                return;
            }
            console.error(`${LOG_PREFIX} Detection error:`, error);
            setLoading(false);
        }
    }, [videoPath, videoName]);

    const initPage = useCallback(async () => {
        setDetailsLoading(true);
        let imdbId: string | undefined;

        try {
            const classification = await ContentDetector.classify(videoName, true);
            if (classification.omdbData) {
                setMovieDetails(classification.omdbData);
                imdbId = classification.omdbData.imdbID;
            }
        } catch (error) {
            console.warn(`${LOG_PREFIX} Failed to load details:`, error);
        } finally {
            setDetailsLoading(false);
        }

        if (hapticsEnabled) {
            runSDHDetection(imdbId);
        }
    }, [videoName, hapticsEnabled, runSDHDetection]);

    // Run detection on mount or when video changes
    useEffect(() => {
        initPage();
    }, [initPage]);

    function navigateToPlayer(cues?: SubtitleCue[] | null) {
        navigation.navigate('VideoPlayer', {
            videoPath,
            videoName,
            cleanTitle: movieDetails?.Title,
            albumName,
            bucketId,
            imdbId: movieDetails?.imdbID,
            playMode: cues && cues.length > 0 ? 'with-haptics' : 'normal',
            hapticCues: cues || undefined,
            apiSubtitles: apiSubtitles.length > 0 ? apiSubtitles : undefined,
        });
    }

    async function handlePickFromStorage() {
        try {
            setLoading(true);

            const picked = await SubtitlePickerService.pickFromStorage();

            if (!picked) {
                setLoading(false);
                return;
            }

            const validation = SubtitleSelectionService.validateSDHContent(picked.cues);

            if (!validation.isSDH) {
                Alert.alert(
                    'No sound descriptions found',
                    'Haptics come from sound descriptions like [door slams]. This subtitle may not have them.',
                    [
                        { text: 'Cancel', style: 'cancel', onPress: () => setLoading(false) },
                        {
                            text: 'Use anyway',
                            onPress: () => {
                                setShowManualPicker(false);
                                setLoading(false);
                                navigateToPlayer(picked.cues);
                            },
                        },
                    ]
                );
                return;
            }

            showToast('Subtitle loaded');
            setShowManualPicker(false);
            setLoading(false);
            navigateToPlayer(picked.cues);
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Could not load subtitle file');
            setLoading(false);
        }
    }

    async function handleSelectLocalSubtitle(path: string) {
        try {
            setLoading(true);

            const picked = await SubtitlePickerService.loadFromPath(path);

            if (!picked) {
                Alert.alert('Error', 'Could not load subtitle file');
                setLoading(false);
                return;
            }

            const validation = SubtitleSelectionService.validateSDHContent(picked.cues);
            if (!validation.isSDH) {
                showToast('This subtitle may not have sound descriptions');
            }

            setShowManualPicker(false);
            setLoading(false);
            navigateToPlayer(picked.cues);
        } catch {
            Alert.alert('Error', 'Could not load subtitle');
            setLoading(false);
        }
    }

    async function handleSelectAPISubtitle(sub: SubtitleResult) {
        try {
            networkAbortRef.current?.abort();
            networkAbortRef.current = new AbortController();
            setLoading(true);

            const cues = await downloadSubtitle(sub.downloadUrl, networkAbortRef.current.signal);
            if (!cues) {
                Alert.alert('Error', 'Could not download subtitle');
                setLoading(false);
                return;
            }

            setShowManualPicker(false);
            setLoading(false);
            navigateToPlayer(cues);
        } catch (error) {
            if (isAbortError(error)) {
                return;
            }
            Alert.alert('Error', 'Failed to download');
            setLoading(false);
        }
    }

    function handlePlayWithHaptics() {
        if (hapticCues && hapticCues.length > 0) {
            navigateToPlayer(hapticCues);
        } else {
            setShowManualPicker(true);
        }
    }

    const renderSubtitleRow = (key: string, name: string, info: string, trailing: 'chevron-right' | 'download', onPress: () => void) => (
        <ListRow
            key={key}
            title={name}
            caption={info}
            onPress={onPress}
            disabled={loading}
            chevron={trailing === 'chevron-right'}
            trailing={trailing === 'download' ? <Feather name="download" size={18} color={colors.textTertiary} /> : undefined}
        />
    );

    const renderLocalSubtitle = (item: string) =>
        renderSubtitleRow(item, item.substring(item.lastIndexOf('/') + 1), 'In the video folder', 'chevron-right',
            () => handleSelectLocalSubtitle(item));

    const renderAPISubtitle = (item: SubtitleResult) => {
        const isSDH = (item.sdhScore || 0) > 5 || item.hearingImpaired;
        const info = [item.language, item.author, isSDH ? 'Sound descriptions' : null].filter(Boolean).join(' · ');
        return renderSubtitleRow(item.id, item.release || item.name, info, 'download', () => handleSelectAPISubtitle(item));
    };

    const [plotOpen, setPlotOpen] = useState(false);
    const [plotClamped, setPlotClamped] = useState(false);
    const poster = known(movieDetails?.Poster);
    const rottenTomatoes = movieDetails?.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value;
    const imdbRating = known(movieDetails?.imdbRating);
    const meta = movieDetails
        ? [known(movieDetails.Year), known(movieDetails.Rated), known(movieDetails.Runtime), known(movieDetails.Genre)?.split(',').map(g => g.trim()).join(', ')]
            .filter(Boolean)
            .join('  ·  ')
        : '';
    const credits = movieDetails
        ? [{ label: 'Director', value: known(movieDetails.Director) }, { label: 'Starring', value: known(movieDetails.Actors) }]
            .filter(c => c.value)
        : [];

    const actions = (
        <View style={styles.actions}>
            <Button label="Play" icon="play" variant="primary" size="lg" onPress={() => navigateToPlayer(null)} />
            {hapticsEnabled && (
                <>
                    <Button label="Play with haptics" size="lg" loading={loading} onPress={handlePlayWithHaptics} />
                    {loading && (
                        <Text style={[type.caption, styles.actionCaption, { color: colors.textSecondary }]}>
                            Looking for subtitles with sound descriptions
                        </Text>
                    )}
                </>
            )}
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <IconButton
                icon="chevron-left"
                iconSize={22}
                onPress={() => navigation.goBack()}
                accessibilityLabel="Back"
                style={[styles.floatingBack, { top: insets.top + 8, backgroundColor: colors.card }]}
            />

            {/* Hero behind the content. In portrait it rises at half the scroll speed and fades, with
                the fade pinned to its own bottom edge, so the picture's edge never slides across it. */}
            <Animated.View style={[
                styles.heroContainer,
                { backgroundColor: colors.card },
                isLandscape ? styles.heroLandscape : {
                    height: portraitHeroHeight,
                    opacity: scrollY.interpolate({ inputRange: [0, portraitHeroHeight * 0.7], outputRange: [1, 0], extrapolate: 'clamp' }),
                    transform: [{
                        translateY: scrollY.interpolate({ inputRange: [0, portraitHeroHeight], outputRange: [0, -portraitHeroHeight / 2], extrapolateLeft: 'clamp' }),
                    }],
                },
            ]}>
                {poster ? (
                    <>
                        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        <Animated.Image
                            source={{ uri: getHighResPoster(poster) }}
                            style={[StyleSheet.absoluteFill, { opacity: imageOpacity }]}
                            resizeMode="cover"
                            onLoad={() => {
                                Animated.timing(imageOpacity, {
                                    toValue: 1,
                                    duration: 600,
                                    useNativeDriver: true,
                                    easing: Easing.out(Easing.quad),
                                }).start();
                            }}
                        />
                    </>
                ) : (
                    <View style={styles.heroPlaceholder}>
                        {detailsLoading
                            ? <ActivityIndicator size="large" color={colors.textSecondary} />
                            : <Feather name="film" size={48} color={colors.textTertiary} />}
                    </View>
                )}
                {!isLandscape && (
                    <Gradient
                        colors={[`${colors.background}00`, colors.background]}
                        style={styles.fade}
                        pointerEvents="none"
                    />
                )}
            </Animated.View>

            <Animated.ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
            >
                {!isLandscape && <View style={{ height: portraitHeroHeight - FADE_HEIGHT / 2 }} />}

                <View style={[
                    styles.content,
                    // Transparent in portrait: a solid block here would cut a hard edge across the hero's fade.
                    { backgroundColor: isLandscape ? colors.background : 'transparent', minHeight: isLandscape ? height : height * 0.6 },
                    isLandscape && [styles.contentLandscape, { paddingTop: insets.top + metrics.space.xl }],
                ]}>
                    <Text style={[type.title, styles.movieTitle, { color: colors.text }]}>
                        {movieDetails?.Title ?? videoName}
                    </Text>

                    {(!!meta || !!imdbRating || !!rottenTomatoes) && (
                        <View style={styles.metaRow}>
                            {!!meta && (
                                <Text style={[type.caption, styles.meta, { color: colors.textSecondary }]} numberOfLines={2}>{meta}</Text>
                            )}
                            {imdbRating && (
                                <View style={styles.ratingItem} accessibilityLabel={`IMDb ${imdbRating}`}>
                                    <ImdbIcon size={18} />
                                    <Text style={[type.label, styles.tnum, { color: colors.text }]}>{imdbRating}</Text>
                                </View>
                            )}
                            {rottenTomatoes && (
                                <View style={styles.ratingItem} accessibilityLabel={`Rotten Tomatoes ${rottenTomatoes}`}>
                                    <RottenTomatoesIcon size={18} />
                                    <Text style={[type.label, styles.tnum, { color: colors.text }]}>{rottenTomatoes}</Text>
                                </View>
                            )}
                        </View>
                    )}

                    {actions}

                    {!!known(movieDetails?.Plot) && (
                        <View style={styles.plot}>
                            <Text
                                style={[type.body, styles.plotText, { color: colors.textSecondary }]}
                                numberOfLines={plotOpen ? undefined : 4}
                                onTextLayout={e => {
                                    if (!plotOpen) { setPlotClamped(e.nativeEvent.lines.length > 4); }
                                }}
                            >
                                {movieDetails?.Plot}
                            </Text>
                            {(plotClamped || plotOpen) && (
                                <Button
                                    variant="ghost"
                                    label={plotOpen ? 'Less' : 'More'}
                                    onPress={() => setPlotOpen(o => !o)}
                                    style={styles.more}
                                />
                            )}
                        </View>
                    )}

                    {credits.map(c => (
                        <View key={c.label} style={styles.creditRow}>
                            <Text style={[type.caption, styles.creditLabel, { color: colors.textSecondary }]}>{c.label}</Text>
                            <Text style={[type.body, styles.creditValue, { color: colors.text }]}>{c.value}</Text>
                        </View>
                    ))}
                </View>
            </Animated.ScrollView>

            {/* Manual subtitle picker, shown when no subtitle with sound descriptions was found */}
            <Sheet visible={showManualPicker} onClose={() => setShowManualPicker(false)} title="Subtitles for haptics">
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
                    <Text style={[type.caption, { color: colors.textSecondary }]}>
                        Haptics follow sound descriptions like [door slams]
                    </Text>

                    <Button
                        label="Browse device storage"
                        icon="folder"
                        variant="primary"
                        size="lg"
                        loading={loading}
                        onPress={handlePickFromStorage}
                    />

                    {localSubtitles.length > 0 && (
                        <View>
                            <Text style={[type.label, styles.sectionTitle, { color: colors.textSecondary }]}>In the video folder</Text>
                            <ListGroup inset>{localSubtitles.map(renderLocalSubtitle)}</ListGroup>
                        </View>
                    )}

                    {apiSubtitles.length > 0 && (
                        <View>
                            <Text style={[type.label, styles.sectionTitle, { color: colors.textSecondary }]}>Online</Text>
                            <ListGroup inset>{apiSubtitles.slice(0, 15).map(renderAPISubtitle)}</ListGroup>
                        </View>
                    )}

                    {localSubtitles.length === 0 && apiSubtitles.length === 0 && (
                        <Text style={[type.body, styles.noSubsText, { color: colors.textSecondary }]}>
                            No subtitles found nearby or online
                        </Text>
                    )}
                </ScrollView>
            </Sheet>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },

    floatingBack: {
        position: 'absolute',
        left: 12,
        zIndex: 10,
    },

    scrollView: { flex: 1 },
    scrollContent: { paddingBottom: 40 },
    heroContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
    heroLandscape: { width: '40%', height: '100%', right: undefined },
    heroPlaceholder: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: FADE_HEIGHT },
    content: {
        paddingHorizontal: metrics.space.xl,
        paddingBottom: 100,
    },
    contentLandscape: { marginLeft: '40%' },

    movieTitle: { marginBottom: metrics.space.sm },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: metrics.space.md },
    meta: { flexShrink: 1 },
    ratingItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tnum: { fontVariant: ['tabular-nums'] },

    actions: {
        gap: metrics.space.sm,
        marginTop: metrics.space.md,
        marginBottom: metrics.space.xl,
    },
    actionCaption: { textAlign: 'center' },

    plot: { marginBottom: metrics.space.lg },
    plotText: { lineHeight: 21 },
    more: { alignSelf: 'flex-start', marginLeft: -metrics.space.lg },
    creditRow: { flexDirection: 'row', gap: metrics.space.lg, paddingVertical: metrics.space.sm },
    creditLabel: { width: 72 },
    creditValue: { flex: 1 },

    sheetBody: { gap: metrics.space.md, paddingTop: metrics.space.sm },
    sectionTitle: { marginBottom: metrics.space.xs },
    noSubsText: { textAlign: 'center', paddingVertical: 20 },
});
