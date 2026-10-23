import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import Animated, { SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight } from 'react-native-reanimated';
import type { PlayerResizeMode } from '@/components/VideoPlayer/GlidePlayer';
import { Chip, ListGroup, ListRow } from '@/components/ui';
import { metrics, motion, playerTheme, type } from '@/theme/theme';
import { haptic } from '@/native/HapticModule';
import { DISPLAY_MODES, formatRate } from './PlayerIcons';
import { SidePanel } from './SidePanel';
import { TvStepper } from '@/components/ui/TvStepper';
import { IS_TV } from '@/utils/tv';
import { throttle } from '../../hooks/video-player/types';
import { HAPTIC_PRESETS, HAPTIC_STRENGTH_MIN, hapticPresetAt, useAppStore } from '../../store/appStore';

const { colors } = playerTheme;

const SPEED_CHIPS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const SLEEP_TIMER_OPTIONS = [
    { label: 'Off', value: null },
    { label: '10 min', value: 10 },
    { label: '20 min', value: 20 },
    { label: '30 min', value: 30 },
    { label: '1 hour', value: 60 },
    { label: 'End of video', value: -1 },
];

/** Strength presets; 1 is the tuned look, and the slider runs to 1.5. */
const ENHANCEMENT_PRESETS = [
    { label: 'Subtle', value: 0.5 },
    { label: 'Natural', value: 1 },
    { label: 'Vivid', value: 1.5 },
];


// Sub-pages slide in on the same spring as the panel.
const spring = <T extends { springify: () => any }>(b: T) =>
    b.springify().mass(motion.spatial.mass).stiffness(motion.spatial.stiffness).damping(motion.spatial.damping);
const PAGE_IN = spring(SlideInRight);
const PAGE_BACK_IN = spring(SlideInLeft);
const PAGE_OUT = spring(SlideOutLeft);
const PAGE_BACK_OUT = spring(SlideOutRight);

type ShakeAction = 'play_pause' | 'next' | 'previous' | 'seek_forward' | 'seek_backward';
type Page = 'main' | 'display' | 'sleep' | 'shake';

const PAGE_TITLES: Record<Page, string> = { main: 'Playback', display: 'Display', sleep: 'Sleep timer', shake: 'Shake to control' };

interface QuickSettingsPanelProps {
    visible: boolean;
    onClose: () => void;
    playbackRate: number;
    onPlaybackRateChange: (rate: number) => void;
    muted: boolean;
    onToggleMute: () => void;
    repeat: boolean;
    onToggleRepeat: () => void;
    sleepTimer: number | null;
    sleepTimerEndsAt: number | null;
    onSetSleepTimer: (minutes: number | null) => void;
    onOpenPlaylist?: () => void;
    onOpenAudio: () => void;
    onOpenSubtitle: () => void;
    onOpenBookmarkPanel?: () => void; // Optional for streams
    onAddBookmark?: () => void;
    resizeMode: PlayerResizeMode;
    onSetResizeMode: (mode: PlayerResizeMode) => void;
    isLandscape: boolean;
    insets?: any;
    enableHaptics?: boolean;
    shakeEnabled?: boolean;
    onToggleShake?: () => void;
    shakeAction?: ShakeAction;
    onSelectShakeAction?: (action: ShakeAction) => void;
    seekDuration?: number;
    videoEnhancement?: boolean;
    onToggleVideoEnhancement?: () => void;
    videoEnhancementStrength?: number;
    onSetVideoEnhancementStrength?: (strength: number) => void;
    /** Each toggle row renders only when its handler is given. */
    nightModeActive?: boolean;
    onToggleNightMode?: () => void;
    backgroundPlayEnabled?: boolean;
    onToggleBackgroundPlay?: () => void;
    hapticsEnabled?: boolean;
    onToggleHaptics?: () => void;
    /** Current track names shown beside the Audio and Subtitles rows. */
    audioValue?: string;
    subtitleValue?: string;
}

/**
 * A slider that previews live without re-rendering the player per step: its label follows the
 * thumb here, the player gets at most one value per 100 ms, and the release value always lands.
 * The slider's own `value` holds still while dragging, so a late echo can't pull the thumb back.
 */
function useCappedSlider(value: number, onChange: (v: number) => void) {
    const [drag, setDrag] = useState<{ start: number; now: number } | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const send = useMemo(() => throttle((v: number) => onChangeRef.current(v), 100), []);
    useEffect(() => send.flush, [send]);
    return {
        shown: drag?.now ?? value,
        value: drag?.start ?? value,
        onSlidingStart: (v: number) => setDrag({ start: v, now: v }),
        onValueChange: (v: number) => {
            setDrag(d => d && { ...d, now: v });
            send(v);
        },
        onSlidingComplete: (v: number) => {
            send(v);
            send.flush();
            setDrag(null);
        },
    };
}

const roundRate = (v: number) => Math.round(v * 100) / 100;

export const QuickSettingsPanel: React.FC<QuickSettingsPanelProps> = memo((props) => {
    const hapticSettings = useAppStore((state) => state.settings.hapticSettings);
    const setHapticStrength = useAppStore((state) => state.setHapticStrength);
    const toggleHaptics = useAppStore((state) => state.toggleHaptics);

    const [page, setPage] = useState<Page>('main');
    const navigated = useRef(false);
    const lastRate = useRef(props.playbackRate);

    // Every open starts on the main page, with no slide: a sub-page left while closed.
    const { visible } = props;
    const [wasVisible, setWasVisible] = useState(visible);
    if (visible !== wasVisible) {
        setWasVisible(visible);
        if (visible) {
            navigated.current = false;
            setPage('main');
        }
    }

    const goTo = (next: Page) => {
        navigated.current = true;
        setPage(next);
    };

    const speed = useCappedSlider(props.playbackRate, props.onPlaybackRateChange);
    const setRate = (rate: number, fromSlider: boolean) => {
        const prev = lastRate.current;
        lastRate.current = rate;
        // One tick as the slider passes normal speed.
        if (fromSlider && ((prev < 1 && rate >= 1) || (prev > 1 && rate <= 1))) { haptic('segmentTick'); }
        if (fromSlider) { speed.onValueChange(rate); } else { props.onPlaybackRateChange(rate); }
    };
    const enhancement = useCappedSlider(props.videoEnhancementStrength ?? 1, v => props.onSetVideoEnhancementStrength?.(v));
    const hapticStrength = useCappedSlider(hapticSettings.strength, setHapticStrength);

    // `stretch` renders exactly like `fill`, which is the option shown for it.
    const displayMode = props.resizeMode === 'stretch' ? 'fill' : props.resizeMode;
    const displayLabel = DISPLAY_MODES.find(m => m.mode === displayMode)?.label;
    // Time left is read off the end time, refreshed while the panel is open.
    const { sleepTimerEndsAt } = props;
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (sleepTimerEndsAt === null) { return; }
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [sleepTimerEndsAt]);
    const sleepLabel = sleepTimerEndsAt !== null
        ? `${Math.max(1, Math.ceil((sleepTimerEndsAt - now) / 60_000))} min left`
        : SLEEP_TIMER_OPTIONS.find(o => o.value === props.sleepTimer)?.label ?? 'Off';
    const enhancementStrength = props.videoEnhancementStrength ?? 1;
    const seconds = props.seekDuration ?? 30;
    const shakeActions: Array<{ id: ShakeAction; label: string }> = [
        { id: 'play_pause', label: 'Play or pause' },
        { id: 'next', label: 'Next' },
        { id: 'previous', label: 'Previous' },
        { id: 'seek_forward', label: `Forward ${seconds} s` },
        { id: 'seek_backward', label: `Back ${seconds} s` },
    ];

    const toggleHapticsRow = props.onToggleHaptics ?? (props.enableHaptics ? toggleHaptics : undefined);
    const hapticsOn = props.hapticsEnabled ?? hapticSettings.enabled;

    const renderMain = () => (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={[styles.speedHead, IS_TV && styles.centerY]}>
                <Text style={[type.label, styles.speedLabel]}>Speed</Text>
                {/* TV: the D-pad can't drag the slider. The chips cover the usual speeds, − and + the rest. */}
                {IS_TV ? (
                    <TvStepper
                        value={props.playbackRate}
                        min={0.25}
                        max={4}
                        step={0.25}
                        format={formatRate}
                        onChange={rate => setRate(rate, false)}
                        accessibilityLabel="Playback speed"
                        onPlayer
                    />
                ) : <Text style={[type.row, styles.speedValue]}>{formatRate(speed.shown)}</Text>}
            </View>
            <View style={styles.chips}>
                {SPEED_CHIPS.map(rate => (
                    <Chip
                        key={rate}
                        label={formatRate(rate)}
                        selected={props.playbackRate === rate}
                        onPress={() => setRate(rate, false)}
                        accessibilityLabel={`Speed ${formatRate(rate)}`}
                        onPlayer
                    />
                ))}
            </View>
            {!IS_TV && <Slider
                style={styles.slider}
                minimumValue={0.25}
                maximumValue={4}
                step={0.05}
                value={speed.value}
                onSlidingStart={speed.onSlidingStart}
                onValueChange={v => setRate(roundRate(v), true)}
                onSlidingComplete={v => speed.onSlidingComplete(roundRate(v))}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.fillStrong}
                thumbTintColor={colors.primary}
                accessibilityLabel="Playback speed"
            />}

            <ListGroup inset onPlayer style={styles.group}>
                <ListRow icon="volume-2" title="Audio" value={props.audioValue} chevron onPress={props.onOpenAudio} onPlayer />
                <ListRow icon="type" title="Subtitles" value={props.subtitleValue} chevron onPress={props.onOpenSubtitle} onPlayer />
                {/* TV's video plane ignores display modes (docs/android-tv.md). */}
                {!IS_TV && <ListRow icon="maximize" title="Display" value={displayLabel} chevron onPress={() => goTo('display')} onPlayer />}
                <ListRow icon="clock" title="Sleep timer" value={sleepLabel} chevron onPress={() => goTo('sleep')} onPlayer />
                {props.onOpenPlaylist && (
                    <ListRow icon="list" title="Playlist" chevron onPress={props.onOpenPlaylist} onPlayer />
                )}
                {props.onOpenBookmarkPanel && (
                    <ListRow icon="bookmark" title="Bookmarks" chevron onPress={props.onOpenBookmarkPanel} onPlayer />
                )}
                {props.onAddBookmark && (
                    <ListRow icon="plus-circle" title="Add bookmark here" onPress={props.onAddBookmark} onPlayer />
                )}
            </ListGroup>

            <ListGroup inset onPlayer style={styles.group}>
                {props.onToggleNightMode && (
                    <ListRow
                        icon="moon"
                        title="Night mode"
                        toggle={{ value: !!props.nightModeActive, onChange: props.onToggleNightMode }}
                        onPlayer
                    />
                )}
                {props.onToggleBackgroundPlay && (
                    <ListRow
                        icon="headphones"
                        title="Background play"
                        toggle={{ value: !!props.backgroundPlayEnabled, onChange: props.onToggleBackgroundPlay }}
                        onPlayer
                    />
                )}
                <ListRow icon="volume-x" title="Mute" toggle={{ value: props.muted, onChange: props.onToggleMute }} onPlayer />
                <ListRow icon="repeat" title="Repeat" toggle={{ value: props.repeat, onChange: props.onToggleRepeat }} onPlayer />
                {props.onToggleVideoEnhancement && (
                    <ListRow
                        icon="droplet"
                        title="Color enhancement"
                        toggle={{ value: !!props.videoEnhancement, onChange: props.onToggleVideoEnhancement }}
                        onPlayer
                    />
                )}
                {props.onToggleVideoEnhancement && props.videoEnhancement && (
                    <View style={styles.subOptions}>
                        <View style={[styles.chips, styles.centered]}>
                            {ENHANCEMENT_PRESETS.map(({ label, value }) => (
                                <Chip
                                    key={label}
                                    label={label}
                                    selected={Math.abs(enhancementStrength - value) < 0.01}
                                    onPress={() => props.onSetVideoEnhancementStrength?.(value)}
                                    onPlayer
                                />
                            ))}
                        </View>
                        {IS_TV ? (
                            <TvStepper
                                value={enhancementStrength}
                                min={0}
                                max={1.5}
                                step={0.1}
                                format={v => `${Math.round(v * 100)}%`}
                                onChange={v => props.onSetVideoEnhancementStrength?.(v)}
                                accessibilityLabel="Color enhancement strength"
                                onPlayer
                            />
                        ) : <View style={styles.sliderRow}>
                            <Slider
                                style={[styles.slider, styles.sliderFlex, styles.sliderInset]}
                                minimumValue={0}
                                maximumValue={1.5}
                                step={0.05}
                                value={enhancement.value}
                                onSlidingStart={enhancement.onSlidingStart}
                                onValueChange={enhancement.onValueChange}
                                onSlidingComplete={enhancement.onSlidingComplete}
                                minimumTrackTintColor={colors.primary}
                                maximumTrackTintColor={colors.fillStrong}
                                thumbTintColor={colors.primary}
                                accessibilityLabel="Color enhancement strength"
                            />
                            <Text style={[type.body, styles.valueText]}>{Math.round(enhancement.shown * 100)}%</Text>
                        </View>}
                    </View>
                )}
                {toggleHapticsRow && (
                    <ListRow
                        icon="zap"
                        title="Haptics"
                        badge="Experimental"
                        toggle={{ value: hapticsOn, onChange: toggleHapticsRow }}
                        onPlayer
                    />
                )}
                {toggleHapticsRow && hapticsOn && (
                    <View style={styles.subOptions}>
                        <View style={[styles.chips, styles.centered]}>
                            {HAPTIC_PRESETS.map(p => (
                                <Chip
                                    key={p.key}
                                    label={p.label}
                                    selected={hapticPresetAt(hapticStrength.shown).key === p.key}
                                    onPress={() => setHapticStrength(p.strength)}
                                    accessibilityLabel={`${p.label} haptics`}
                                    onPlayer
                                />
                            ))}
                        </View>
                        <View style={styles.sliderRow}>
                            <Slider
                                style={[styles.slider, styles.sliderFlex, styles.sliderInset]}
                                minimumValue={HAPTIC_STRENGTH_MIN}
                                maximumValue={1}
                                step={0.05}
                                value={hapticStrength.value}
                                onSlidingStart={hapticStrength.onSlidingStart}
                                onValueChange={hapticStrength.onValueChange}
                                onSlidingComplete={hapticStrength.onSlidingComplete}
                                minimumTrackTintColor={colors.primary}
                                maximumTrackTintColor={colors.fillStrong}
                                thumbTintColor={colors.primary}
                                accessibilityLabel="Haptic strength"
                            />
                            <Text style={[type.body, styles.valueText]}>{Math.round(hapticStrength.shown * 100)}%</Text>
                        </View>
                    </View>
                )}
                {props.onToggleShake && (
                    <ListRow
                        icon="activity"
                        title="Shake to control"
                        value={props.shakeEnabled ? 'On' : 'Off'}
                        chevron
                        onPress={() => goTo('shake')}
                        onPlayer
                    />
                )}
            </ListGroup>
        </ScrollView>
    );

    const renderSub = () => {
        if (page === 'display') {
            return (
                <ListGroup inset onPlayer>
                    {DISPLAY_MODES.map(({ mode, label }) => (
                        <ListRow
                            key={mode}
                            title={label}
                            selected={displayMode === mode}
                            onPress={() => props.onSetResizeMode(mode)}
                            onPlayer
                        />
                    ))}
                </ListGroup>
            );
        }
        if (page === 'sleep') {
            return (
                <ListGroup inset onPlayer>
                    {SLEEP_TIMER_OPTIONS.map(opt => (
                        <ListRow
                            key={opt.label}
                            title={opt.label}
                            selected={props.sleepTimer === opt.value}
                            onPress={() => props.onSetSleepTimer(opt.value)}
                            onPlayer
                        />
                    ))}
                </ListGroup>
            );
        }
        return (
            <>
                <ListGroup inset onPlayer>
                    <ListRow
                        title="Shake to control"
                        toggle={{ value: !!props.shakeEnabled, onChange: () => props.onToggleShake?.() }}
                        onPlayer
                    />
                </ListGroup>
                {props.shakeEnabled && (
                    <ListGroup inset onPlayer style={styles.group}>
                        {shakeActions.map(item => (
                            <ListRow
                                key={item.id}
                                title={item.label}
                                selected={props.shakeAction === item.id}
                                onPress={() => props.onSelectShakeAction?.(item.id)}
                                onPlayer
                            />
                        ))}
                    </ListGroup>
                )}
            </>
        );
    };

    return (
        <SidePanel
            visible={visible}
            title={PAGE_TITLES[page]}
            onClose={props.onClose}
            onBack={page === 'main' ? undefined : () => setPage('main')}
        >
            <View style={styles.pages}>
                {page === 'main' ? (
                    <Animated.View
                        key="main"
                        style={styles.page}
                        entering={navigated.current ? PAGE_BACK_IN : undefined}
                        exiting={PAGE_OUT}
                    >
                        {renderMain()}
                    </Animated.View>
                ) : (
                    <Animated.View key="sub" style={styles.page} entering={PAGE_IN} exiting={visible ? PAGE_BACK_OUT : undefined}>
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
                            {renderSub()}
                        </ScrollView>
                    </Animated.View>
                )}
            </View>
        </SidePanel>
    );
});

QuickSettingsPanel.displayName = 'QuickSettingsPanel';

const styles = StyleSheet.create({
    pages: { flex: 1, overflow: 'hidden' },
    page: { flex: 1 },
    scroll: { paddingTop: metrics.space.sm, paddingBottom: metrics.space.xxl },
    speedHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: metrics.space.md },
    speedLabel: { color: colors.textSecondary },
    speedValue: { color: colors.text, fontVariant: ['tabular-nums'] },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: metrics.space.sm },
    slider: { height: 40, marginTop: metrics.space.xs },
    sliderFlex: { flex: 1 },
    group: { marginTop: metrics.space.lg },
    subOptions: { paddingHorizontal: metrics.space.lg, paddingVertical: metrics.space.md, gap: metrics.space.sm },
    centered: { justifyContent: 'center' },
    centerY: { alignItems: 'center' },
    // Android's slider insets its track by the thumb's radius; this lines the track up with the chips.
    sliderInset: { marginTop: 0, marginHorizontal: -metrics.space.lg },
    sliderRow: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.sm },
    valueText: { color: colors.text, fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' },
});
