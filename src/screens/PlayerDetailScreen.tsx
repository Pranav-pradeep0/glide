// src/screens/PlayerDetailScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    Image,
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
import { ContentDetector } from '../services/ContentDetector';
import { OMDBResult } from '../services/OMDBService';
import { RootStackParamList } from '../types';
import { ImdbIcon, RottenTomatoesIcon } from '../components/VideoPlayer/PlayerIcons';
import { Button, Gradient, IconButton } from '@/components/ui';
import { metrics, type } from '@/theme/theme';

type DetailRouteProp = RouteProp<RootStackParamList, 'PlayerDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const LOG_PREFIX = '[PlayerDetail]';
const FADE_HEIGHT = 140;

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

    const { videoPath, videoName, albumName, bucketId, videoSort } = route.params;

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

    const initPage = useCallback(async () => {
        setDetailsLoading(true);
        try {
            const classification = await ContentDetector.classify(videoName, true);
            if (classification.omdbData) {
                setMovieDetails(classification.omdbData);
            }
        } catch (error) {
            console.warn(`${LOG_PREFIX} Failed to load details:`, error);
        } finally {
            setDetailsLoading(false);
        }
    }, [videoName]);

    useEffect(() => {
        initPage();
    }, [initPage]);

    // With haptics, the player looks for an SDH subtitle in the background; its tags only shape them.
    function navigateToPlayer(withHaptics: boolean) {
        navigation.navigate('VideoPlayer', {
            videoPath,
            videoName,
            cleanTitle: movieDetails?.Title,
            albumName,
            bucketId,
            videoSort,
            imdbId: movieDetails?.imdbID,
            playMode: withHaptics ? 'with-haptics' : 'normal',
        });
    }

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
            <Button label="Play" icon="play" variant="primary" size="lg" onPress={() => navigateToPlayer(false)} />
            {hapticsEnabled && (
                <Button label="Play with haptics" size="lg" onPress={() => navigateToPlayer(true)} />
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
                fill={colors.card}
                style={[styles.floatingBack, { top: insets.top + 4 }]}
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
                        <View style={styles.metaBlock}>
                            {!!meta && (
                                <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={2}>{meta}</Text>
                            )}
                            {(!!imdbRating || !!rottenTomatoes) && (
                                <View style={styles.ratingRow}>
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },

    floatingBack: {
        position: 'absolute',
        left: 8, // 48 dp box, so the 40 dp circle sits 12 from the edge
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
    metaBlock: { gap: metrics.space.sm },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.md },
    ratingItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tnum: { fontVariant: ['tabular-nums'] },

    actions: {
        gap: metrics.space.sm,
        marginTop: metrics.space.md,
        marginBottom: metrics.space.xl,
    },

    plot: { marginBottom: metrics.space.lg },
    plotText: { lineHeight: 21 },
    more: { alignSelf: 'flex-start', marginLeft: -metrics.space.lg },
    creditRow: { flexDirection: 'row', gap: metrics.space.lg, paddingVertical: metrics.space.sm },
    creditLabel: { width: 72 },
    creditValue: { flex: 1 },
});
