// src/screens/TelegramScreen.tsx
//
// Telegram (docs/telegram.md): sign in (phone number + code on phones, QR on TV, then the 2-step
// password); home laid out like Telegram (folder tabs, the video to continue, the chats in
// Telegram's order, Saved Messages first); a chat's videos with the library's rows and cards.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Linking, ScrollView, ScrollViewInstance, StyleSheet, Text, TextInput, TextInputProps, View,
} from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { FlashList } from '@shopify/flash-list';
import { RootStackParamList, VideoFile, VideoHistoryEntry } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { Button, Chip, IconButton, Touchable, showDialog } from '@/components/ui';
import {
    ContinueCard, EmptyState, ListHeader, SectionTitle, VideoCard, VideoItemCell, VideoItemComponent, VideoRow,
    listContentStyle, progressOf, timeLabel,
} from '@/components/VideoRow';
import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';
import { Loader } from '@/components/Loader';
import { Pager } from '@/components/Pager';
import {
    TELEGRAM_AVAILABLE, TelegramService, TgAuth, TgChat, TgRecent, TgSave, TgVideo, isTelegram, saveLabel, useTelegramChatChanged, useTelegramNewVideo, useTelegramSaves,
} from '@/services/TelegramService';
import { replayParams, useVideoHistoryStore } from '@/store/videoHistoryStore';
import { getResumablePosition } from '@/utils/playbackResume';
import { NavigationService } from '@/services/NavigationService';
import { formatFileSize } from '@/utils/formatUtils';
import { metrics, type } from '@/theme/theme';
import { IS_TV } from '@/utils/tv';
import { PRIVACY_POLICY_URL } from '@/utils/constants';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PAGE = 30;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const chatTitle = (c: TgChat) => (c.saved ? 'Saved Messages' : c.title);



export default function TelegramScreen() {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<Nav>();
    const [auth, setAuth] = useState<TgAuth>({ state: 'starting' });
    const [error, setError] = useState('');

    useEffect(() => {
        if (!TELEGRAM_AVAILABLE) { return; }
        let heard = false;
        const { auth: first, stop } = TelegramService.start(a => { heard = true; setAuth(a); });
        // An event can overtake the first answer; it's the newer state then.
        first.then(a => { if (!heard) { setAuth(a); } }, e => setError(errorText(e)));
        return stop;
    }, []);

    const logOut = () => showDialog('Sign out of Telegram?', 'Videos downloaded from Telegram are deleted from this device.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => { TelegramService.logOut().catch(e => showDialog("Couldn't sign out", errorText(e))); } },
    ]);

    if (auth.state === 'ready' && !error) {
        return <Home name={auth.name} onLogOut={logOut} />;
    }
    return (
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            {/* Phones open this from Videos; on TV it is a rail page. Sign-in steps carry their own title. */}
            <ListHeader title={IS_TV ? 'Telegram' : ''} onBack={IS_TV ? undefined : navigation.goBack} />
            {!TELEGRAM_AVAILABLE ? (
                <EmptyState icon="send" text="Update Glide to watch videos from Telegram." />
            ) : error ? (
                <EmptyState icon="wifi-off" text={error} />
            ) : auth.state === 'starting' || auth.state === 'loggingOut' ? (
                <Loader />
            ) : (
                // adjustResize no longer shrinks an edge-to-edge window: pad by the keyboard instead.
                <KeyboardAvoidingView behavior="padding" style={styles.container}>
                    <ScrollView contentContainerStyle={styles.signInScroll} keyboardShouldPersistTaps="handled">
                        <SignIn auth={auth} />
                    </ScrollView>
                </KeyboardAvoidingView>
            )}
        </View>
    );
}

/**
 * The one thing each sign-in step asks for, big: a number to read back at a glance. No border on
 * phones (the caret shows focus); TV outlines it, as the remote needs a visible focus.
 */
function BigInput({ label, centered, ...input }: TextInputProps & { label: string; centered?: boolean }) {
    const { colors } = useTheme();
    const [focused, setFocused] = useState(false);
    return (
        <TextInput
            {...input}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={label}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[styles.bigInput, centered && styles.bigInputCentered, { color: colors.text, backgroundColor: colors.fill, borderColor: IS_TV && focused ? colors.primary : colors.fill }]}
        />
    );
}

/** One step of Telegram's sign-in, whichever TDLib is waiting for. */
function SignIn({ auth }: { auth: TgAuth }) {
    const { colors } = useTheme();
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // TV starts with the QR code (no typing with a remote); "Use phone number instead" sets this.
    const [wantPhone, setWantPhone] = useState(!IS_TV);
    // The badge makes way for the field and its button while the keyboard is up.
    const [typing, setTyping] = useState(false);
    useEffect(() => {
        const shown = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
        const hidden = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
        return () => { shown.remove(); hidden.remove(); };
    }, []);

    const run = useCallback(async (work: () => Promise<unknown>) => {
        setBusy(true);
        setError('');
        try {
            await work();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => { setText(''); }, [auth.state]);
    useEffect(() => {
        if (auth.state === 'phone' && !wantPhone) { run(TelegramService.requestQr); }
    }, [auth.state, wantPhone, run]);

    const submit = () => {
        const t = text.trim();
        if (!t) { return; }
        if (auth.state === 'phone') { run(() => TelegramService.phoneNumber(t)); }
        if (auth.state === 'code') { run(() => TelegramService.code(t)); }
        if (auth.state === 'password') { run(() => TelegramService.password(text)); }
    };
    // TDLib can't go back from these steps; signing out starts over at the phone number.
    const startOver = (phone = true) => { setWantPhone(phone); run(TelegramService.logOut); };

    const errorLine = !!error && <Text style={[type.body, { color: colors.error }]}>{error}</Text>;
    // A label over the field, the field, and what went wrong right under it.
    const field = (props: React.ComponentProps<typeof BigInput>) => (
        <View style={styles.field}>
            <Text style={[type.label, { color: colors.textSecondary }]}>{props.label}</Text>
            <BigInput value={text} onChangeText={setText} autoFocus returnKeyType="go" submitBehavior="submit" onSubmitEditing={submit} {...props} />
            {errorLine}
        </View>
    );
    const next = <Button label="Next" variant="primary" size="lg" block loading={busy} disabled={!text.trim()} onPress={submit} />;
    const other = (label: string, onPress: () => void) => <Button label={label} variant="ghost" block onPress={onPress} />;

    let title = 'Sign in to Telegram';
    let lead = '';
    // What the step asks for, under its heading; then its buttons (at the bottom on phones).
    let prompt: React.ReactNode = null;
    let actions: React.ReactNode = null;
    switch (auth.state) {
        case 'phone':
            if (wantPhone) {
                lead = 'Use the phone number of your Telegram account.';
                prompt = field({ label: 'Phone number, with country code', keyboardType: 'phone-pad', placeholder: '+91 98765 43210', autoComplete: 'tel' });
                actions = <>{next}{other('Use QR code instead', () => setWantPhone(false))}</>;
            } else {
                lead = 'Scan a QR code with Telegram on your phone. No typing needed.';
                prompt = busy ? <Loader fullScreen={false} /> : errorLine;
                actions = !busy && <>
                    <Button label="Show QR code" variant="primary" size="lg" block onPress={() => run(TelegramService.requestQr)} />
                    {other('Use phone number instead', () => setWantPhone(true))}
                </>;
            }
            break;
        case 'qr':
            title = 'Scan to sign in';
            lead = 'In Telegram on your phone, open Settings → Devices → Link Desktop Device, then point the camera at this code.';
            prompt = errorLine;
            actions = other('Use phone number instead', () => startOver(true));
            break;
        case 'code':
            title = 'Enter the code';
            lead = auth.sentTo === 'telegram'
                ? `Telegram sent a code to your Telegram app on another device (${auth.phone}).`
                : `Telegram sent a code to ${auth.phone}.`;
            prompt = field({ label: 'Code', keyboardType: 'number-pad', placeholder: '•••••', autoComplete: 'sms-otp', centered: true });
            actions = <>{next}{other('Use a different number', () => startOver(true))}</>;
            break;
        case 'password':
            title = 'Enter your password';
            lead = `Your account has two-step verification.${auth.hint ? ` Hint: ${auth.hint}` : ''}`;
            prompt = field({ label: 'Password', placeholder: 'Password', secureTextEntry: true, autoComplete: 'current-password' });
            actions = <>{next}{other('Start again', () => startOver(!IS_TV))}</>;
            break;
        case 'unsupported':
            title = 'Finish in Telegram';
            lead = 'Telegram needs you to finish setting up your account in the Telegram app first. Then come back and sign in.';
            prompt = errorLine;
            actions = <Button label="Start again" variant="primary" size="lg" block loading={busy} onPress={() => startOver(!IS_TV)} />;
            break;
    }

    const qr = auth.state === 'qr' && (
        <Image source={{ uri: auth.qr }} style={styles.qr} accessibilityLabel="Telegram sign-in QR code" />
    );
    // TV: the code beside its instructions, so all of it fits a 720p screen.
    const side = IS_TV && !!qr;
    const heading = <>
        <Text style={[type.title, !side && styles.center, { color: colors.text }]} accessibilityRole="header">{title}</Text>
        {!!lead && <Text style={[type.body, !side && styles.center, { color: colors.textSecondary }]}>{lead}</Text>}
    </>;
    // Where the login goes and how to undo it, said plainly. TV has no browser for the policy.
    const footer = (
        <Text style={[type.caption, !side && styles.center, { color: colors.textTertiary }]}>
            Glide connects straight to Telegram, so your login and messages never pass through us. Signing out removes your account and downloads from this {IS_TV ? 'TV' : 'phone'}.
            {!IS_TV && <>
                {' '}
                <Text style={[styles.link, { color: colors.textSecondary }]} accessibilityRole="link" onPress={() => { Linking.openURL(PRIVACY_POLICY_URL).catch(() => {}); }}>
                    Privacy policy
                </Text>
            </>}
        </Text>
    );

    if (side) {
        return (
            <View style={styles.qrTv}>
                {qr}
                <View style={styles.qrTvText}>{heading}<View style={styles.signInBody}>{prompt}{actions}</View>{footer}</View>
            </View>
        );
    }
    // Phones: one column near the top, as Telegram lays it out: badge, heading, field, buttons, note.
    return (
        <View style={styles.signIn}>
            {qr || (!typing &&
                <View style={[styles.badge, { backgroundColor: colors.primaryContainer }]}>
                    <Feather name="send" size={30} color={colors.text} style={styles.badgeNudge} />
                </View>
            )}
            <View style={styles.signInHeading}>{heading}</View>
            {prompt}
            <View style={styles.signInActions}>{actions}</View>
            <View style={styles.signInNote}>{footer}</View>
        </View>
    );
}

/** A tab over the chats: all, one of the user's Telegram folders, or (no folders) a kind of chat. */
type Tab = { key: string; label: string; folderId?: number; only?: 'group' | 'private'; downloads?: boolean };
const ALL: Tab = { key: 'all', label: 'All' };
// Always there, second: tabs never shift when the first film is saved or the last deleted.
const DOWNLOADED: Tab = { key: 'downloaded', label: 'Downloaded', downloads: true };
// Accounts without Telegram folders still get something to narrow by.
const KINDS: Tab[] = [{ key: 'group', label: 'Groups', only: 'group' }, { key: 'private', label: 'Private', only: 'private' }];

/** The last Telegram video left part-way, if any. */
function useTelegramResume(): VideoHistoryEntry | undefined {
    const history = useVideoHistoryStore(s => s.history);
    const getAllHistory = useVideoHistoryStore(s => s.getAllHistory);
    return useMemo(() => getAllHistory().find(e =>
        isTelegram(e.videoPath) && getResumablePosition(e.lastPausedPosition, e.duration) !== null,
    ), [history, getAllHistory]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Signed in, laid out like Telegram: folder tabs (tap or swipe), then (on All) the video to
 * continue, then the chats with videos, each with its photo and newest video.
 */
function Home({ name, onLogOut }: { name: string; onLogOut: () => void }) {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<Nav>();
    const [tabs, setTabs] = useState<Tab[]>([ALL, DOWNLOADED]);
    const [index, setIndex] = useState(0);
    const bar = useRef<ScrollViewInstance>(null);
    const barWidth = useRef(0);
    const chips = useRef<{ x: number; width: number }[]>([]);
    // One search per visit: which chats had a video lately, shown on every tab. Live after that:
    // Telegram pushes each new video, so no refresh (Telegram's apps have none either).
    const [recent, setRecent] = useState<Record<string, TgRecent>>({});
    useEffect(() => {
        TelegramService.recent().then(r => {
            // A video lately settles it for this session: no count needed.
            Object.keys(r).forEach(id => { hasVideos.set(Number(id), true); asked.add(Number(id)); });
            setRecent(r);
        });
        // Leaving Telegram: stop asking about chats nobody will see.
        return () => { queue.length = 0; asking.clear(); };
    }, []);
    // Any message in a listed chat moves the chats on: the shown tab reloads them from TDLib's own
    // copy (no search, so no FLOOD_WAIT), a hidden one when it's next shown. At most once a
    // second: a debounce would never fire while a busy group keeps talking.
    const [version, setVersion] = useState(0);
    const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
    useTelegramChatChanged(() => {
        if (pending.current) { return; }
        pending.current = setTimeout(() => { pending.current = undefined; setVersion(n => n + 1); }, 1000);
    });
    useEffect(() => () => clearTimeout(pending.current), []);
    useTelegramNewVideo(v => {
        hasVideos.set(v.chatId, true);
        asked.add(v.chatId);
        setRecent(r => ({ ...r, [String(v.chatId)]: { name: v.name, date: v.date } }));
    });

    useEffect(() => {
        TelegramService.folders()
            .then(f => setTabs([ALL, DOWNLOADED, ...(f.length ? f.map(x => ({ key: `f${x.id}`, label: x.name, folderId: x.id })) : KINDS)]))
            .catch(() => {});
    }, []);
    // A swipe can land on a tab whose chip is off screen: centre it, as Music does.
    useEffect(() => {
        const chip = chips.current[index];
        if (chip) { bar.current?.scrollTo({ x: Math.max(0, chip.x + chip.width / 2 - barWidth.current / 2), animated: true }); }
    }, [index]);
    // TV: only the page shown on arrival takes the focus; a tab picked later keeps it on its chip.
    const renderPage = (t: Tab, i: number) => (t.downloads
        ? <DownloadsPage focusFirst={i === 0} />
        : <ChatsPage tab={t} recent={recent} version={version} onScreen={i === index} focusFirst={i === 0} />);

    return (
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <ListHeader title="Telegram" subtitle={name ? `Signed in as ${name}` : undefined} onBack={IS_TV ? undefined : navigation.goBack}>
                <IconButton icon="log-out" onPress={onLogOut} accessibilityLabel="Sign out of Telegram" />
            </ListHeader>
            {tabs.length > 1 && (
                <ScrollView
                    ref={bar}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.tabsBar}
                    contentContainerStyle={styles.tabs}
                    onLayout={e => { barWidth.current = e.nativeEvent.layout.width; }}
                >
                    {tabs.map((t, i) => (
                        <View key={t.key} onLayout={e => { chips.current[i] = e.nativeEvent.layout; }}>
                            <Chip label={t.label} selected={i === index} onPress={() => setIndex(i)} />
                        </View>
                    ))}
                </ScrollView>
            )}
            {/* TV: the chips change tabs; Left/Right stay for moving the focus. */}
            <Pager index={index} onIndexChange={setIndex} scrollEnabled={!IS_TV} pages={tabs.map((t, i) => () => renderPage(t, i))} />
        </View>
    );
}

const CHATS_PAGE = 100;
/** Fewer chats with videos than this on screen: look at the next page of chats by itself. */
const ENOUGH = 20;

// Whether each chat has videos: true, false, or null when Telegram couldn't say (shown, to be
// safe). Starts from the answers saved last time, so a second visit shows the list at once; each
// chat is asked again once a session, quietly (the saved answer shows meanwhile). Asked 3 at a
// time across the app: more brings FLOOD_WAIT.
const hasVideos = new Map<number, boolean | null>();
const asked = new Set<number>();
const asking = new Map<number, Promise<void>>();
const queue: (() => Promise<void>)[] = [];
let active = 0;
function pump() {
    while (active < 3 && queue.length) {
        active++;
        queue.shift()!().finally(() => { active--; pump(); });
    }
}
function ask(id: number): Promise<void> {
    let p = asking.get(id);
    if (!p) {
        p = new Promise<void>(done => {
            queue.push(() => TelegramService.hasVideos(id).then(h => {
                // A failed re-count keeps the saved answer.
                if (h !== null || !hasVideos.has(id)) { hasVideos.set(id, h); }
                asked.add(id);
                asking.delete(id);
                done();
            }));
            pump();
        });
        asking.set(id, p);
    }
    return p;
}
/** Whether there's an answer for the chat yet, this session's or a saved one. */
function known(id: number) {
    if (!hasVideos.has(id)) {
        const saved = TelegramService.savedHasVideos(id);
        if (saved !== undefined) { hasVideos.set(id, saved); }
    }
    return hasVideos.has(id);
}

const saveFile = (s: TgSave): VideoFile => ({ name: s.name, path: s.uri, size: s.total, modifiedDate: 0, duration: s.duration, isDirectory: false });

/** Films saved for offline and those on their way: plays with no network. */
function DownloadsPage({ focusFirst }: { focusFirst: boolean }) {
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<Nav>();
    const saves = useTelegramSaves();
    const [selected, setSelected] = useState<VideoFile | null>(null);
    const play = useCallback((f: VideoFile) => NavigationService.handleVideoNavigation(navigation, f.path, { videoName: f.name }), [navigation]);

    const renderItem = useCallback(({ item, index }: { item: TgSave; index: number }) => (
        <VideoRow
            item={saveFile(item)}
            path={item.uri}
            name={item.name}
            duration={item.duration}
            meta={[formatFileSize(item.total), item.state === 'saved' ? undefined : saveLabel(item)].filter(Boolean).join(' · ')}
            onPress={play}
            onMore={setSelected}
            preferFocus={focusFirst && index === 0}
        />
    ), [play, focusFirst]);

    if (!saves.length) { return <EmptyState icon="download" text="Films you download show here and play without a connection. Tap ⋯ on a film, then Download." />; }
    return (
        <>
            <FlashList
                data={saves}
                renderItem={renderItem}
                keyExtractor={(x: TgSave) => x.uri}
                contentContainerStyle={listContentStyle(false, insets.bottom)}
                showsVerticalScrollIndicator={false}
            />
            <VideoOptionsBottomSheet visible={!!selected} video={selected} onClose={() => setSelected(null)} onPlay={() => selected && play(selected)} />
        </>
    );
}

/** One tab's chats in Telegram's order; on All, the video to continue leads. */
function ChatsPage({ tab, recent, version, onScreen, focusFirst }: {
    tab: Tab; recent: Record<string, TgRecent>; version: number; onScreen: boolean; focusFirst: boolean;
}) {
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<Nav>();
    const [chats, setChats] = useState<TgChat[] | null>(null);
    const [limit, setLimit] = useState(CHATS_PAGE);
    const [more, setMore] = useState(false);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    const dragged = useRef(false);
    const resume = useTelegramResume();
    const [, setAnswers] = useState(0);
    const [selected, setSelected] = useState<VideoHistoryEntry | null>(null);

    // The [version] these chats are from: caught up while on screen.
    const [seen, setSeen] = useState(version);
    useEffect(() => { if (onScreen) { setSeen(version); } }, [onScreen, version]);
    const paged = useRef(0);
    useEffect(() => {
        let live = true;
        setError('');
        TelegramService.chats(limit, tab.folderId ?? 0).then(c => {
            if (!live) { return; }
            // A bigger page that brought nothing new: the list is all here. A reload of the same
            // page says nothing about that.
            const grew = limit !== paged.current;
            paged.current = limit;
            setChats(prev => { if (grew) { setMore(c.length > (prev?.length ?? 0)); } return c; });
        }, e => { if (live) { setError(errorText(e)); } });
        return () => { live = false; };
    }, [tab.folderId, limit, attempt, seen]);

    // Ask about each chat not asked this session; a chat shows once it's known to have videos. The
    // unknown go first: they hold the list back, the saved ones are only being checked.
    useEffect(() => {
        if (!chats) { return; }
        let live = true;
        const others = chats.filter(c => !c.saved && !asked.has(c.id));
        [...others.filter(c => !known(c.id)), ...others.filter(c => known(c.id))]
            .forEach(c => ask(c.id).then(() => { if (live) { setAnswers(n => n + 1); } }));
        return () => { live = false; };
    }, [chats]);

    const shown = (chats ?? []).filter(c =>
        (c.saved || (known(c.id) && hasVideos.get(c.id) !== false)) &&
        (!tab.only || (!c.saved && c.group === (tab.only === 'group'))),
    );
    const counting = (chats ?? []).some(c => !c.saved && !known(c.id));
    // Too few to scroll: the next page of chats, without waiting for a scroll that can't happen.
    useEffect(() => {
        if (chats && !counting && more && shown.length < ENOUGH) { setLimit(n => n + CHATS_PAGE); }
    }, [chats, counting, more, shown.length]);
    const hero = tab === ALL ? resume : undefined;

    const renderChat = useCallback(({ item, index }: { item: TgChat; index: number }) => (
        <ChatRow
            chat={item}
            video={recent[String(item.id)]}
            onPress={() => navigation.navigate('TelegramChat', { chatId: item.id, title: chatTitle(item) })}
            preferFocus={focusFirst && !hero && index === 0}
        />
    ), [hero, navigation, recent, focusFirst]);

    const header = hero && (
        <View>
            <SectionTitle title="Continue watching" />
            <ContinueCard
                item={hero}
                path={hero.videoPath}
                name={hero.videoName}
                meta={timeLabel(hero.duration, hero.lastPausedPosition) ?? ''}
                progress={progressOf(hero.duration, hero.lastPausedPosition)}
                thumbnailTime={hero.stopFrameMs}
                onPress={v => NavigationService.handleVideoNavigation(navigation, v.videoPath, replayParams(v))}
                onMore={setSelected}
                preferFocus={focusFirst}
            />
            <SectionTitle title="Chats" />
        </View>
    );

    if (error) { return <EmptyState icon="wifi-off" text={error} action="Retry" onAction={() => setAttempt(n => n + 1)} />; }
    if (!chats || (shown.length === 0 && (counting || more))) { return <Loader />; }
    if (shown.length === 0) { return <EmptyState icon="send" text={`No chats with videos in ${tab.label}. Glide doesn't show channels.`} />; }
    return (
        <>
        <FlashList
            data={shown}
            renderItem={renderChat}
            keyExtractor={(c: TgChat) => String(c.id)}
            ListHeaderComponent={header || null}
            // Only on a scroll by hand: a list shorter than the screen fires onEndReached by itself.
            onScrollBeginDrag={() => { dragged.current = true; }}
            onEndReached={() => { if (dragged.current && more) { dragged.current = false; setLimit(n => n + CHATS_PAGE); } }}
            onEndReachedThreshold={1}
            contentContainerStyle={listContentStyle(false, insets.bottom)}
            showsVerticalScrollIndicator={false}
        />
        <VideoOptionsBottomSheet
            visible={!!selected}
            video={selected}
            onClose={() => setSelected(null)}
            onPlay={() => selected && NavigationService.handleVideoNavigation(navigation, selected.videoPath, replayParams(selected))}
        />
        </>
    );
}

/** "14:05" today, "Tue" this week, "3 Oct" before. */
function shortDate(ms: number) {
    const d = new Date(ms);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    if (now.getTime() - ms < 6 * 86400000) { return d.toLocaleDateString([], { weekday: 'short' }); }
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

// Telegram-like avatar colours for chats without a photo.
const AVATAR = ['#E17076', '#F5A35C', '#A695E7', '#7BC862', '#6EC9CB', '#65AADD', '#EE7AAE'];
const photos = new Map<number, string | null>();

function Avatar({ chat }: { chat: TgChat }) {
    const { colors } = useTheme();
    const [photo, setPhoto] = useState(photos.get(chat.id));
    useEffect(() => {
        if (chat.saved || photos.has(chat.id)) { return; }
        let live = true;
        TelegramService.chatPhoto(chat.id).then(p => { photos.set(chat.id, p); if (live) { setPhoto(p); } });
        return () => { live = false; };
    }, [chat.id, chat.saved]);
    if (photo) { return <Image source={{ uri: photo }} style={styles.avatar} />; }
    const initials = chat.title.split(/\s+/).filter(w => /^\p{L}|^\p{N}/u.test(w)).slice(0, 2).map(w => [...w][0]).join('').toUpperCase();
    return (
        <View style={[styles.avatar, { backgroundColor: chat.saved ? colors.primary : AVATAR[Math.abs(chat.id) % AVATAR.length] }]}>
            {chat.saved || !initials
                ? <Feather name={chat.saved ? 'bookmark' : chat.group ? 'users' : 'user'} size={22} color={chat.saved ? colors.onPrimary : '#fff'} />
                : <Text style={styles.initials}>{initials}</Text>}
        </View>
    );
}

/** A chat as Telegram lists it: photo, title and date, then its last message. */
const ChatRow = React.memo(({ chat, video, onPress, preferFocus }: {
    chat: TgChat; video?: TgRecent; onPress: () => void; preferFocus?: boolean;
}) => {
    const { colors } = useTheme();
    // A chat with a recent video says so: its newest video instead of the last message.
    const preview = video?.name || chat.preview || (chat.saved ? 'Forward videos here to watch them in Glide' : '');
    return (
        <Touchable
            onPress={onPress}
            scaleTo={0.98}
            stateLayer
            preferFocus={preferFocus}
            accessibilityRole="button"
            accessibilityLabel={chatTitle(chat)}
            accessibilityHint={preview}
            style={styles.chat}
        >
            {/* Keyed: the list recycles rows, and a reused row would keep the last chat's photo. */}
            <Avatar key={chat.id} chat={chat} />
            <View style={styles.chatText}>
                <View style={styles.chatLine}>
                    <Text style={[type.row, styles.grow, { color: colors.text }]} numberOfLines={1}>{chatTitle(chat)}</Text>
                    {chat.date > 0 && <Text style={[type.caption, { color: colors.textTertiary }]}>{shortDate(chat.date)}</Text>}
                </View>
                {!!preview && (
                    <View style={styles.chatLine}>
                        {video && <Feather name="film" size={14} color={colors.primary} />}
                        <Text style={[type.body, styles.grow, { color: colors.textSecondary }]} numberOfLines={1}>{preview}</Text>
                    </View>
                )}
            </View>
        </Touchable>
    );
});

const toFile = (v: TgVideo): VideoFile => ({
    name: v.name, path: v.uri, size: v.size, modifiedDate: v.date, duration: v.duration,
    width: v.width || undefined, height: v.height || undefined, isDirectory: false,
});

export function TelegramChatScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'TelegramChat'>) {
    const { chatId, title } = route.params;
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const [films, setFilms] = useState<VideoFile[] | null>(null);
    const [error, setError] = useState('');
    const [more, setMore] = useState(false);
    const [busy, setBusy] = useState(false);
    // Cards on a TV, as in the library.
    const [grid, setGrid] = useState(IS_TV);
    const [selected, setSelected] = useState<VideoFile | null>(null);
    const next = useRef(0);
    const loading = useRef(false);
    const dragged = useRef(false);
    const saves = useTelegramSaves();

    const load = useCallback(async (first: boolean) => {
        if (loading.current || (!first && next.current === 0)) { return; }
        loading.current = true;
        setBusy(true);
        setError('');
        try {
            const page = await TelegramService.videos(chatId, first ? 0 : next.current, PAGE);
            next.current = page.next;
            setMore(page.next !== 0);
            setFilms(f => [...(first ? [] : f ?? []), ...page.items.map(toFile)]);
        } catch (e) {
            setError(errorText(e));
        } finally {
            loading.current = false;
            setBusy(false);
        }
    }, [chatId]);

    useEffect(() => { load(true); }, [load]);
    // A video sent here while it's open: on top, as Telegram shows it.
    useTelegramNewVideo(v => {
        if (v.chatId === chatId) { setFilms(f => (f && !f.some(x => x.path === v.uri) ? [toFile(v), ...f] : f)); }
    });

    const play = useCallback((film: VideoFile) => {
        NavigationService.handleVideoNavigation(navigation, film.path, { videoName: film.name });
    }, [navigation]);

    const renderItem = useCallback(({ item, index }: { item: VideoFile; index: number }) => {
        const Item: VideoItemComponent = grid ? VideoCard : VideoRow;
        return (
            <VideoItemCell grid={grid}>
                <Item
                    item={item}
                    path={item.path}
                    name={item.name}
                    duration={item.duration}
                    meta={[formatFileSize(item.size), saveLabel(saves.find(x => x.uri === item.path))].filter(Boolean).join(' · ')}
                    onPress={play}
                    onMore={setSelected}
                    preferFocus={index === 0}
                />
            </VideoItemCell>
        );
    }, [grid, play, saves]);

    return (
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <ListHeader title={title} onBack={navigation.goBack}>
                <IconButton
                    icon={grid ? 'list' : 'grid'}
                    onPress={() => setGrid(!grid)}
                    accessibilityLabel={grid ? 'Switch to list view' : 'Switch to grid view'}
                />
            </ListHeader>
            {error && !films?.length ? (
                <EmptyState icon="wifi-off" text={error} action="Retry" onAction={() => load(true)} />
            ) : !films ? (
                <Loader />
            ) : films.length === 0 && more ? (
                // A chat of other files: a page can come back empty with older messages still to search.
                <EmptyState icon="search" text="No videos in the newest messages." action={busy ? undefined : 'Look further'} onAction={() => load(false)} />
            ) : films.length === 0 ? (
                <EmptyState icon="send" text={title === 'Saved Messages'
                    ? 'No videos yet. In Telegram, forward a video to Saved Messages and it shows up here.'
                    : 'No videos in this chat.'} />
            ) : (
                <FlashList
                    data={films}
                    renderItem={renderItem}
                    keyExtractor={(item: VideoFile) => item.path}
                    numColumns={grid ? metrics.grid.columns : 1}
                    key={String(grid)}
                    // One page per scroll by hand: a short list (a chat of mostly files) fires
                    // onEndReached by itself after every page and would page on until rate-limited.
                    // TV scrolls without a drag: "Load more" there.
                    onScrollBeginDrag={() => { dragged.current = true; }}
                    onEndReached={() => { if (dragged.current) { dragged.current = false; load(false); } }}
                    onEndReachedThreshold={1}
                    ListFooterComponent={!more ? null : busy
                        ? <ActivityIndicator style={styles.footer} color={colors.primary} />
                        : <Button label="Load more" variant="ghost" onPress={() => load(false)} />}
                    contentContainerStyle={listContentStyle(grid, insets.bottom)}
                    showsVerticalScrollIndicator={false}
                />
            )}
            <VideoOptionsBottomSheet
                visible={!!selected}
                video={selected}
                onClose={() => setSelected(null)}
                onPlay={() => selected && play(selected)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { textAlign: 'center' },
    signInScroll: { flexGrow: 1, paddingHorizontal: metrics.gutter, paddingTop: metrics.space.lg, paddingBottom: metrics.space.xl },
    signIn: { width: '100%', maxWidth: 400, alignSelf: 'center', paddingTop: metrics.space.xxl },
    signInHeading: { gap: metrics.space.sm, paddingHorizontal: metrics.space.sm },
    signInActions: { gap: metrics.space.xs, marginTop: metrics.space.lg },
    signInNote: { marginTop: metrics.space.xl, paddingHorizontal: metrics.space.lg },
    field: { gap: metrics.space.sm, marginTop: metrics.space.xl },
    link: { textDecorationLine: 'underline' },
    signInBody: { gap: metrics.space.sm, marginTop: metrics.space.sm },
    bigInput: { height: 56, borderRadius: metrics.radius.lg, borderWidth: IS_TV ? 2 : 0, paddingHorizontal: metrics.space.lg, fontSize: 20, fontWeight: '600', letterSpacing: 0.5 },
    bigInputCentered: { textAlign: 'center', letterSpacing: 6 },
    badge: { width: 72, height: 72, borderRadius: 36, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: metrics.space.xl },
    // Feather's paper plane sits right of centre.
    badgeNudge: { marginLeft: -3, marginTop: 2 },
    // White around the code is the quiet zone a camera needs to find it.
    qr: { width: 240, height: 240, alignSelf: 'center', borderRadius: metrics.radius.md },
    qrTv: { flexDirection: 'row', alignItems: 'center', gap: 48, maxWidth: 900, alignSelf: 'center' },
    qrTvText: { flex: 1, gap: metrics.space.md },
    tabsBar: { flexGrow: 0 },
    tabs: { gap: metrics.space.sm, paddingHorizontal: metrics.gutter, paddingVertical: metrics.space.sm },
    chat: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.md, paddingVertical: metrics.space.sm, paddingHorizontal: metrics.space.sm, borderRadius: metrics.radius.md },
    avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    initials: { color: '#fff', fontSize: 18, fontWeight: '600' },
    chatText: { flex: 1, gap: 2 },
    chatLine: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.sm },
    grow: { flex: 1 },
    footer: { padding: metrics.space.lg },
});
