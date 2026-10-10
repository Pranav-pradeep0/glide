import React, { useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Alert,
    FlatList,
    TextInput,
    useWindowDimensions,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { DEFAULT_APP_SETTINGS, SUBTITLE_FONT_FAMILY, useAppStore } from '../store/appStore';
import { useVideoHistoryStore } from '../store/videoHistoryStore';
import { useTheme } from '../hooks/useTheme';
import { SUBTITLE_COLORS } from '../utils/constants';
import { FileService } from '@/services/FileService';
import { LANGUAGES } from '@/utils/languages';
import HapticModule from '../native/HapticModule';
import { ShakeDetector } from '../hooks/video-player';
import Feather from '@react-native-vector-icons/feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { SharedValue, useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { UpdateActionButton, UpdateNotice } from '@/components/UpdateActionButton';
import { UpdateNotes } from '@/components/UpdateNotes';
import { LicencesSheet } from '@/components/LicencesSheet';
import { useUpdateInstaller } from '@/hooks/useUpdateInstaller';
import {
    Chip,
    IconButton,
    ListGroup,
    ListRow,
    SectionLabel,
    Sheet,
    Touchable,
} from '@/components/ui';
import { metrics, playerTheme, type } from '@/theme/theme';
import { AppSettings, ShakeAction } from '../types';
import pkg from '../../package.json';

const AnimatedText = Animated.createAnimatedComponent(Text);
const noop = () => {};

const RESET_LABEL = 'Reset to default';

const INTENSITY_PRESETS = [
    { label: 'Light', value: 50 },
    { label: 'Medium', value: 100 },
    { label: 'Strong', value: 180 },
];

const SUBTITLE_STYLES = [
    { key: 'none', label: 'None' },
    { key: 'outline', label: 'Outline' },
    { key: 'box', label: 'Box' },
] as const;

// ---------------------------------------------------------------------------
// Rows the kit does not cover: a slider with its label, and a row of chips.

type SliderProps = React.ComponentProps<typeof Slider>;

function SliderRow({ title, valueText, caption, ...slider }: SliderProps & {
    title: string;
    valueText?: string;
    caption?: string;
}) {
    const { colors } = useTheme();
    return (
        <View style={styles.block}>
            <View style={styles.blockHeader}>
                <View style={styles.flex}>
                    <Text style={[type.row, styles.regular, { color: colors.text }]}>{title}</Text>
                    {!!caption && <Text style={[type.caption, { color: colors.textSecondary }]}>{caption}</Text>}
                </View>
                {!!valueText && <Text style={[type.body, styles.tnum, { color: colors.textSecondary }]}>{valueText}</Text>}
            </View>
            <Slider
                style={styles.slider}
                accessibilityLabel={title}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.fillStrong}
                thumbTintColor={colors.primary}
                {...slider}
            />
        </View>
    );
}

function ChipRow({ title, children }: { title: string; children: React.ReactNode }) {
    const { colors } = useTheme();
    return (
        <View style={styles.block}>
            <Text style={[type.row, styles.regular, { color: colors.text }]}>{title}</Text>
            {children}
        </View>
    );
}

// ---------------------------------------------------------------------------

// Local state so dragging only re-renders this slider; the preview follows via the shared value.
const FontSizeSliderControl = React.memo(({ fontSizeSV, onFinalChange }: {
    fontSizeSV: SharedValue<number>;
    onFinalChange: (size: number) => void;
}) => {
    const [displaySize, setDisplaySize] = React.useState(fontSizeSV.value);
    return (
        <SliderRow
            title="Size"
            caption="Pinch subtitles in the player to resize"
            valueText={`${Math.round(displaySize)} px`}
            minimumValue={12}
            maximumValue={40}
            value={displaySize}
            onValueChange={(val) => {
                fontSizeSV.value = val;
                setDisplaySize(val);
            }}
            onSlidingComplete={(val) => onFinalChange(Math.round(val))}
        />
    );
});

function toRgba(hex: string, opacity: number) {
    const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, ${opacity})`;
}

const SubtitlePreviewSection = React.memo(({ fontSizeSV, settings }: {
    fontSizeSV: SharedValue<number>;
    settings: AppSettings;
}) => {
    const animatedStyle = useAnimatedStyle(() => ({ fontSize: fontSizeSV.value }));

    const fontFamily = settings.subtitleFontFamily || 'System';
    const fontWeight = String(settings.subtitleFontWeight) as any;
    const outlined = settings.subtitleEdgeStyle !== 'none';
    const boxColor = settings.subtitleBackgroundColor === 'transparent'
        ? 'transparent'
        : toRgba(settings.subtitleBackgroundColor, settings.subtitleBackgroundOpacity);

    return (
        <View style={styles.block}>
            <View
                style={[styles.previewFrame, { backgroundColor: playerTheme.colors.surfaceVariant }]}
                accessibilityLabel="Subtitle preview"
            >
                <View style={[styles.previewBox, { backgroundColor: boxColor }]}>
                    <AnimatedText style={[
                        styles.previewText,
                        { color: settings.subtitleColor, fontWeight, fontFamily },
                        // The player draws the outline in black.
                        outlined && [styles.previewOutline, { textShadowRadius: settings.subtitleOutlineWidth }],
                        animatedStyle,
                    ]}>
                        This is a subtitle preview
                    </AnimatedText>
                </View>
            </View>
        </View>
    );
});

// ---------------------------------------------------------------------------

export default function SettingsScreen() {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();

    const settings = useAppStore((state) => state.settings);
    const updateStatus = useAppStore((state) => state.updateStatus);
    const toggleDarkMode = useAppStore((state) => state.toggleDarkMode);
    const toggleHaptics = useAppStore((state) => state.toggleHaptics);
    const setSubtitleFontSize = useAppStore((state) => state.setSubtitleFontSize);
    const setSubtitleColor = useAppStore((state) => state.setSubtitleColor);
    const setHapticIntensity = useAppStore((state) => state.setHapticIntensity);
    const resetHapticSettings = useAppStore((state) => state.resetHapticSettings);
    const setBrightnessMode = useAppStore((state) => state.setBrightnessMode);
    const setPipBrightnessMode = useAppStore((state) => state.setPipBrightnessMode);
    const setSubtitleFontWeight = useAppStore((state) => state.setSubtitleFontWeight);
    const setSubtitleFontFamily = useAppStore((state) => state.setSubtitleFontFamily);
    const setSubtitleOutlineWidth = useAppStore((state) => state.setSubtitleOutlineWidth);
    const setSubtitleBackgroundColor = useAppStore((state) => state.setSubtitleBackgroundColor);
    const setSubtitleBackgroundOpacity = useAppStore((state) => state.setSubtitleBackgroundOpacity);
    const setSubtitleEdgeStyle = useAppStore((state) => state.setSubtitleEdgeStyle);
    const resetSubtitleSettings = useAppStore((state) => state.resetSubtitleSettings);
    const setShowSeekButtons = useAppStore((state) => state.setShowSeekButtons);
    const setSeekDuration = useAppStore((state) => state.setSeekDuration);
    const setAutoPlayNext = useAppStore((state) => state.setAutoPlayNext);
    const setDefaultAudioLanguage = useAppStore((state) => state.setDefaultAudioLanguage);
    const setShakeThreshold = useAppStore((state) => state.setShakeThreshold);
    const setShakeEnabled = useAppStore((state) => state.setShakeEnabled);
    const setShakeAction = useAppStore((state) => state.setShakeAction);
    const setOnlineLyricsEnabled = useAppStore((state) => state.setOnlineLyricsEnabled);
    const clearAllHistory = useVideoHistoryStore((state) => state.clearAllHistory);
    const [languageModalVisible, setLanguageModalVisible] = React.useState(false);
    const [licencesVisible, setLicencesVisible] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [shakeTestEnabled, setShakeTestEnabled] = React.useState(false);

    const fontSizeSV = useSharedValue(settings.subtitleFontSize);
    React.useEffect(() => {
        fontSizeSV.value = settings.subtitleFontSize;
    }, [settings.subtitleFontSize, fontSizeSV]);

    const filteredLanguages = React.useMemo(() => {
        const query = searchQuery.toLowerCase();
        const autoOption = { code: 'auto', name: 'Auto', nativeName: 'Automatic', aliases: [] };
        if (!query) {
            return [autoOption, ...LANGUAGES];
        }
        const matches = LANGUAGES.filter(l =>
            l.name.toLowerCase().includes(query) ||
            l.nativeName.toLowerCase().includes(query) ||
            l.code.toLowerCase().includes(query)
        );
        return [autoOption, ...matches];
    }, [searchQuery]);

    const { hapticSettings } = settings;
    const lastPreviewTime = useRef(0);

    const handleIntensityChange = useCallback((value: number) => {
        setHapticIntensity(value);
        // Throttled so dragging doesn't overwhelm the motor.
        const now = Date.now();
        if (now - lastPreviewTime.current > 200 && HapticModule) {
            lastPreviewTime.current = now;
            HapticModule.vibrate(80, Math.round(value));
        }
    }, [setHapticIntensity]);

    const handlePresetSelect = useCallback((value: number) => {
        setHapticIntensity(value);
        if (HapticModule) {
            HapticModule.vibrate(100, value);
        }
    }, [setHapticIntensity]);

    const handleShakeTestHit = useCallback(() => {
        if (HapticModule) {
            HapticModule.vibrate(80, 160);
        }
    }, []);

    function handleClearCache() {
        Alert.alert(
            'Clear subtitle cache',
            'This will delete all cached subtitles. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: async () => {
                        await FileService.cleanSubtitleCache();
                        Alert.alert('Done', 'Cache cleared');
                    },
                },
            ]
        );
    }

    function handleResetHaptics() {
        Alert.alert(
            'Reset haptic feedback',
            'This will reset vibration strength to default. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Reset', style: 'destructive', onPress: resetHapticSettings },
            ]
        );
    }

    function handleResetShakeIntensity() {
        Alert.alert(
            'Reset shake strength',
            'This will reset shake strength to default. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: () => setShakeThreshold(DEFAULT_APP_SETTINGS.shakeThreshold),
                },
            ]
        );
    }

    function handleClearHistory() {
        Alert.alert(
            'Clear watch history',
            'This will delete all playback progress and bookmarks. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: () => {
                        clearAllHistory();
                        Alert.alert('Done', 'Watch history cleared');
                    },
                },
            ]
        );
    }

    function selectSubtitleStyle(key: typeof SUBTITLE_STYLES[number]['key']) {
        if (key === 'box') {
            setSubtitleBackgroundColor('#000000');
            setSubtitleEdgeStyle('none');
        } else {
            setSubtitleBackgroundColor('transparent');
            setSubtitleEdgeStyle(key);
        }
    }

    const subtitleStyle = settings.subtitleEdgeStyle === 'outline'
        ? 'outline'
        : settings.subtitleBackgroundColor !== 'transparent' ? 'box' : 'none';

    const {
        canDownload,
        unavailableReason,
        downloadProgress,
        error,
        handleCancelDownload,
        hasCachedApk,
        isDownloading,
        handleDownloadAndInstall,
        handleInstallCached,
        handleOpenRelease,
    } = useUpdateInstaller({
        latestVersion: updateStatus.latestVersion,
        releaseUrl: updateStatus.releaseUrl,
        apkUrl: updateStatus.apkUrl,
        apkSha256Url: updateStatus.apkSha256Url,
    });

    const showUpdate = updateStatus.available && updateStatus.latestVersion && (updateStatus.releaseUrl || updateStatus.apkUrl);
    const strengthLabel = INTENSITY_PRESETS.find(p => Math.abs(hapticSettings.intensity - p.value) < 20)?.label ?? '';

    function closeLanguages() {
        setLanguageModalVisible(false);
        setSearchQuery('');
    }

    return (
        <View style={[styles.flex, { backgroundColor: colors.background }]}>
            {shakeTestEnabled && (
                <ShakeDetector
                    onShake={noop}
                    onThresholdHit={handleShakeTestHit}
                    mode="tuning"
                    shakeThreshold={settings.shakeThreshold}
                />
            )}
            <ScrollView
                contentContainerStyle={[styles.content, { paddingTop: insets.top + metrics.space.lg }]}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={[type.title, styles.title, { color: colors.text }]} accessibilityRole="header">Settings</Text>

                {showUpdate && (
                    <View style={[styles.updateCard, { backgroundColor: colors.primaryContainer }]}>
                        <View>
                            <Text style={[type.section, { color: colors.text }]}>Update available</Text>
                            <Text style={[type.caption, { color: colors.textSecondary }]}>
                                v{updateStatus.latestVersion} is ready to install
                            </Text>
                        </View>
                        <UpdateNotes notes={updateStatus.releaseNotes} maxHeight={160} />
                        <UpdateNotice error={error} unavailableReason={unavailableReason} />
                        <UpdateActionButton
                            canDownload={canDownload}
                            downloadProgress={downloadProgress}
                            error={error}
                            onCancelDownload={handleCancelDownload}
                            hasCachedApk={hasCachedApk}
                            isDownloading={isDownloading}
                            onDownloadAndInstall={handleDownloadAndInstall}
                            onInstallCached={handleInstallCached}
                            onOpenRelease={handleOpenRelease}
                        />
                    </View>
                )}

                <SectionLabel title="Playback" />
                <ListGroup>
                    <ListRow
                        icon="skip-forward"
                        title="Auto-play next"
                        caption="Next video in the folder"
                        toggle={{ value: settings.autoPlayNext, onChange: setAutoPlayNext }}
                    />
                    <ListRow
                        icon="music"
                        title="Online lyrics"
                        caption="Fetch lyrics from LRCLIB when not found locally"
                        toggle={{ value: settings.onlineLyricsEnabled, onChange: setOnlineLyricsEnabled }}
                    />
                    <ListRow
                        icon="fast-forward"
                        title="Seek buttons"
                        toggle={{ value: settings.showSeekButtons, onChange: setShowSeekButtons }}
                    />
                    {settings.showSeekButtons && (
                        <SliderRow
                            title="Seek by"
                            valueText={`${settings.seekDuration} s`}
                            minimumValue={5}
                            maximumValue={60}
                            step={5}
                            value={settings.seekDuration}
                            onValueChange={setSeekDuration}
                        />
                    )}
                    <ListRow
                        icon="globe"
                        title="Audio language"
                        value={settings.defaultAudioLanguage || 'Auto'}
                        chevron
                        onPress={() => setLanguageModalVisible(true)}
                    />
                </ListGroup>

                <SectionLabel title="Display" />
                <ListGroup>
                    <ListRow
                        icon="moon"
                        title="Dark mode"
                        toggle={{ value: settings.darkMode, onChange: toggleDarkMode }}
                    />
                    <ListRow
                        icon="sun"
                        title="Same brightness for all videos"
                        caption="Otherwise each video keeps its own"
                        toggle={{
                            value: settings.brightnessMode === 'global',
                            onChange: (val) => setBrightnessMode(val ? 'global' : 'video'),
                        }}
                    />
                    <ListRow
                        icon="minimize-2"
                        title="System brightness in picture-in-picture"
                        toggle={{
                            value: settings.pipBrightnessMode === 'system',
                            onChange: (val) => setPipBrightnessMode(val ? 'system' : 'player'),
                        }}
                    />
                </ListGroup>

                <SectionLabel title="Gestures & haptics" />
                <ListGroup>
                    <ListRow
                        icon="smartphone"
                        title="Shake to control"
                        caption="Control playback by shaking device"
                        toggle={{ value: settings.shakeEnabled, onChange: setShakeEnabled }}
                    />
                    {settings.shakeEnabled && (
                        <ChipRow title="Shake action">
                            <View style={styles.chips}>
                                {[
                                    { key: 'play_pause', label: 'Play/Pause' },
                                    { key: 'next', label: 'Next' },
                                    { key: 'previous', label: 'Previous' },
                                    { key: 'seek_forward', label: `Forward ${settings.seekDuration} s` },
                                    { key: 'seek_backward', label: `Backward ${settings.seekDuration} s` },
                                ].map((opt) => (
                                    <Chip
                                        key={opt.key}
                                        label={opt.label}
                                        selected={settings.shakeAction === opt.key}
                                        onPress={() => setShakeAction(opt.key as ShakeAction)}
                                    />
                                ))}
                            </View>
                        </ChipRow>
                    )}
                    <SliderRow
                        title="Shake strength"
                        caption="How hard to shake before it counts"
                        valueText={`${settings.shakeThreshold.toFixed(1)} g`}
                        minimumValue={0.8}
                        maximumValue={4.0}
                        step={0.1}
                        value={settings.shakeThreshold}
                        onValueChange={setShakeThreshold}
                    />
                    <ListRow
                        icon="smartphone"
                        title="Test shake"
                        caption="Vibrates when a shake counts"
                        toggle={{ value: shakeTestEnabled, onChange: setShakeTestEnabled }}
                    />
                    <ListRow
                        icon="rotate-ccw"
                        title={RESET_LABEL}
                        caption="Shake strength"
                        onPress={handleResetShakeIntensity}
                    />
                </ListGroup>
                <ListGroup style={styles.gap}>
                    <ListRow
                        icon="activity"
                        title="Haptic feedback"
                        toggle={{ value: hapticSettings.enabled, onChange: toggleHaptics }}
                    />
                    {hapticSettings.enabled && (
                        <ChipRow title="Strength">
                            <View style={styles.chips}>
                                {INTENSITY_PRESETS.map(p => (
                                    <Chip
                                        key={p.label}
                                        label={p.label}
                                        selected={strengthLabel === p.label}
                                        onPress={() => handlePresetSelect(p.value)}
                                    />
                                ))}
                            </View>
                            <Slider
                                style={styles.slider}
                                accessibilityLabel="Fine-tune strength"
                                minimumValue={1}
                                maximumValue={255}
                                step={1}
                                value={hapticSettings.intensity}
                                onValueChange={handleIntensityChange}
                                minimumTrackTintColor={colors.primary}
                                maximumTrackTintColor={colors.fillStrong}
                                thumbTintColor={colors.primary}
                            />
                        </ChipRow>
                    )}
                    {hapticSettings.enabled && (
                        <ListRow
                            icon="rotate-ccw"
                            title={RESET_LABEL}
                            caption="Haptic strength"
                            onPress={handleResetHaptics}
                        />
                    )}
                </ListGroup>

                <SectionLabel title="Subtitles" />
                <ListGroup>
                    <SubtitlePreviewSection fontSizeSV={fontSizeSV} settings={settings} />
                    <ChipRow title="Font">
                        <View style={styles.chips}>
                            {[
                                { key: SUBTITLE_FONT_FAMILY, label: 'Atkinson Hyperlegible' },
                                { key: 'sans-serif', label: 'System' },
                            ].map((opt) => (
                                <Chip
                                    key={opt.key}
                                    label={opt.label}
                                    selected={settings.subtitleFontFamily === opt.key}
                                    onPress={() => setSubtitleFontFamily(opt.key)}
                                />
                            ))}
                        </View>
                    </ChipRow>
                    <FontSizeSliderControl fontSizeSV={fontSizeSV} onFinalChange={setSubtitleFontSize} />
                    <SliderRow
                        title="Weight"
                        valueText={String(Math.round(settings.subtitleFontWeight))}
                        minimumValue={300}
                        maximumValue={900}
                        step={100}
                        value={settings.subtitleFontWeight}
                        onValueChange={setSubtitleFontWeight}
                    />
                    <ChipRow title="Color">
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
                            {SUBTITLE_COLORS.map(color => {
                                const selected = settings.subtitleColor === color.value;
                                return (
                                    <Touchable
                                        key={color.value}
                                        onPress={() => setSubtitleColor(color.value)}
                                        scaleTo={0.9}
                                        accessibilityRole="button"
                                        accessibilityLabel={color.name}
                                        accessibilityState={{ selected }}
                                        style={[styles.swatchRing, selected && { borderColor: colors.primary }]}
                                    >
                                        <View style={[styles.swatch, { backgroundColor: color.value, borderColor: colors.border }]} />
                                    </Touchable>
                                );
                            })}
                        </ScrollView>
                    </ChipRow>
                    <ChipRow title="Style">
                        <View style={styles.chips}>
                            {SUBTITLE_STYLES.map(opt => (
                                <Chip
                                    key={opt.key}
                                    label={opt.label}
                                    selected={subtitleStyle === opt.key}
                                    onPress={() => selectSubtitleStyle(opt.key)}
                                />
                            ))}
                        </View>
                    </ChipRow>
                    {settings.subtitleEdgeStyle === 'outline' && (
                        <SliderRow
                            title="Outline width"
                            valueText={settings.subtitleOutlineWidth.toFixed(1)}
                            minimumValue={0.5}
                            maximumValue={6}
                            value={settings.subtitleOutlineWidth}
                            onValueChange={setSubtitleOutlineWidth}
                        />
                    )}
                    {settings.subtitleBackgroundColor !== 'transparent' && (
                        <SliderRow
                            title="Background opacity"
                            valueText={`${Math.round(settings.subtitleBackgroundOpacity * 100)}%`}
                            minimumValue={0}
                            maximumValue={1}
                            value={settings.subtitleBackgroundOpacity}
                            onValueChange={setSubtitleBackgroundOpacity}
                        />
                    )}
                    <ListRow
                        icon="rotate-ccw"
                        title={RESET_LABEL}
                        caption="Subtitle appearance"
                        onPress={resetSubtitleSettings}
                    />
                </ListGroup>

                <SectionLabel title="About" />
                <ListGroup>
                    <ListRow icon="info" title="Version" value={pkg.version} />
                    <ListRow
                        icon="file-text"
                        title="Open source licences"
                        chevron
                        onPress={() => setLicencesVisible(true)}
                    />
                </ListGroup>

                <SectionLabel title="Storage" />
                <ListGroup>
                    <ListRow icon="trash-2" title="Clear subtitle cache" destructive onPress={handleClearCache} />
                    <ListRow icon="trash-2" title="Clear watch history" destructive onPress={handleClearHistory} />
                </ListGroup>
            </ScrollView>

            <Sheet visible={languageModalVisible} onClose={closeLanguages} title="Audio language" maxHeight={0.8}>
                <View style={[styles.search, { backgroundColor: colors.fill }]}>
                    <Feather name="search" size={16} color={colors.textSecondary} />
                    <TextInput
                        style={[type.row, styles.searchInput, { color: colors.text }]}
                        placeholder="Search languages"
                        placeholderTextColor={colors.textTertiary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        accessibilityLabel="Search languages"
                    />
                    {searchQuery.length > 0 && (
                        <IconButton
                            icon="x-circle"
                            iconSize={16}
                            color={colors.textSecondary}
                            onPress={() => setSearchQuery('')}
                            accessibilityLabel="Clear search"
                        />
                    )}
                </View>

                <FlatList
                    style={{ height: windowHeight * 0.5 }}
                    data={filteredLanguages}
                    keyExtractor={(item) => item.code}
                    keyboardShouldPersistTaps="handled"
                    ItemSeparatorComponent={Gap}
                    renderItem={({ item }) => {
                        const isSelected = item.code === 'auto'
                            ? settings.defaultAudioLanguage === null
                            : settings.defaultAudioLanguage === item.name;
                        return (
                            <View style={[styles.languageRow, { backgroundColor: colors.fill }]}>
                                <ListRow
                                    title={item.name}
                                    caption={item.code !== 'auto' ? item.nativeName : undefined}
                                    selected={isSelected}
                                    onPress={() => {
                                        setDefaultAudioLanguage(item.code === 'auto' ? null : item.name);
                                        closeLanguages();
                                    }}
                                />
                            </View>
                        );
                    }}
                />
            </Sheet>

            <LicencesSheet visible={licencesVisible} onClose={() => setLicencesVisible(false)} />
        </View>
    );
}

const Gap = () => <View style={styles.languageGap} />;

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { paddingHorizontal: metrics.gutter, paddingBottom: metrics.space.xxl },
    title: { marginBottom: metrics.space.sm, paddingHorizontal: metrics.space.xs },
    gap: { marginTop: metrics.space.sm },
    regular: { fontWeight: '400' },
    tnum: { fontVariant: ['tabular-nums'] },
    updateCard: {
        borderRadius: metrics.radius.card,
        padding: metrics.space.lg,
        gap: metrics.space.md,
        marginTop: metrics.space.md,
    },
    block: {
        paddingHorizontal: metrics.space.lg,
        paddingVertical: metrics.space.md,
        gap: metrics.space.sm,
    },
    blockHeader: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.md },
    slider: { width: '100%', height: metrics.touch },
    chips: { flexDirection: 'row', gap: metrics.space.sm },
    swatchRow: { gap: metrics.space.xs },
    swatchRing: {
        width: metrics.touch,
        height: metrics.touch,
        borderRadius: metrics.touch / 2,
        borderWidth: 2,
        borderColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
    swatch: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
    },
    previewFrame: {
        height: 110,
        borderRadius: metrics.radius.md,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: metrics.space.md,
    },
    previewBox: { padding: 4, borderRadius: 4 },
    previewText: { textAlign: 'center' },
    previewOutline: { textShadowColor: 'black' },
    search: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.sm,
        height: 44,
        borderRadius: 22,
        paddingLeft: 14,
        paddingRight: 4,
        marginBottom: metrics.space.sm,
    },
    searchInput: { flex: 1, paddingVertical: 0, fontWeight: '400' },
    languageRow: { borderRadius: 4, overflow: 'hidden' },
    languageGap: { height: 2 },
});
