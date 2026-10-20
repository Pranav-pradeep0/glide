package com.glide.app.player;

import android.app.Activity;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Rect;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Looper;
import android.util.Log;
import android.util.Rational;
import android.view.View;
import android.view.ViewGroup;

import androidx.activity.ComponentActivity;
import androidx.core.app.PictureInPictureModeChangedInfo;
import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;

import java.util.ArrayList;
import java.util.List;
import java.util.WeakHashMap;

/**
 * Owns Picture-in-Picture for a single video view.
 *
 * Everything PiP needs is known here and nowhere else: the hosting Activity, the
 * decoded video's real dimensions and sample aspect ratio, the view's own bounds in
 * window pixels, and whether playback is live. Previously these were assembled in
 * JavaScript and pushed down as props, which meant the aspect ratio came from the
 * screen instead of the video, the source rect hint was measured in dp and used as
 * px, and auto-enter could stay armed after the player was gone.
 *
 * The Activity needs no PiP code at all: androidx.activity exposes a listener for
 * mode changes, so this class subscribes and unsubscribes with the view.
 */
final class GlidePipController {

    private static final String TAG = "GlidePipController";

    /**
     * Android rejects PictureInPictureParams outside roughly 1:2.39 .. 2.39:1 and
     * throws from enterPictureInPictureMode. Clamp just inside the documented range
     * so an ultrawide or very tall source degrades to letterboxing in PiP instead of
     * failing to enter it at all.
     */
    private static final float MIN_ASPECT_RATIO = 0.42f;
    private static final float MAX_ASPECT_RATIO = 2.38f;

    private static final String ACTION_CONTROL = "com.glide.app.PIP_CONTROL";
    private static final String EXTRA_CONTROL = "control";
    private static final int CONTROL_PREVIOUS = 1;
    private static final int CONTROL_PLAY_PAUSE = 2;
    private static final int CONTROL_NEXT = 3;

    /**
     * The controller whose state an Activity's PiP params reflect: the player attached most
     * recently. Next/previous replaces the screen, so for a moment two players share one
     * Activity, and the outgoing one's detach used to write its own params (aspect ratio,
     * and now buttons) over the incoming one's. Main thread only.
     */
    private static final WeakHashMap<Activity, GlidePipController> OWNERS = new WeakHashMap<>();

    private final GlidePlayerView videoView;

    /** Views hidden for the PiP presentation, in the order they were hidden. */
    private final List<View> hiddenViews = new ArrayList<>();
    /** Ancestor transforms neutralised for the PiP presentation. */
    private final List<SavedTransform> savedTransforms = new ArrayList<>();

    private Consumer<PictureInPictureModeChangedInfo> modeChangedListener;
    private View.OnLayoutChangeListener presentationLayoutListener;
    private View.OnLayoutChangeListener decorLayoutListener;
    private ComponentActivity listeningActivity;

    private boolean enabled = false;
    private boolean inPipMode = false;
    private boolean showPlay = true;
    private boolean hasPrevious = false;
    private boolean hasNext = false;

    /**
     * PiP buttons are app-supplied RemoteActions. Without them only stock Android 13+ derives
     * buttons from the media session; Android 12 and below, and skins like One UI, MIUI and
     * ColorOS, showed a PiP window with no controls at all.
     */
    private final BroadcastReceiver controlReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // Every live player's receiver hears the broadcast; only one Activity is in PiP.
            if (!inPipMode || !isOwner()) {
                return;
            }
            switch (intent.getIntExtra(EXTRA_CONTROL, 0)) {
                case CONTROL_PLAY_PAUSE:
                    videoView.togglePlayPauseFromPip();
                    break;
                case CONTROL_PREVIOUS:
                    if (hasPrevious) videoView.onPipSkip(false);
                    break;
                case CONTROL_NEXT:
                    if (hasNext) videoView.onPipSkip(true);
                    break;
            }
        }
    };

    private int videoWidth = 0;
    private int videoHeight = 0;
    private int sarNum = 0;
    private int sarDen = 0;

    // Bounds the video surface must hold while PiP is open. Fabric owns these bounds
    // normally, so anything that re-mounts can stamp the pre-resize size back over the
    // override; enforcing against a remembered target makes it self-correcting.
    private int pipTargetWidth = 0;
    private int pipTargetHeight = 0;

    private static final class SavedTransform {
        final View view;
        final float scaleX;
        final float scaleY;
        final float translationX;
        final float translationY;

        SavedTransform(View view) {
            this.view = view;
            this.scaleX = view.getScaleX();
            this.scaleY = view.getScaleY();
            this.translationX = view.getTranslationX();
            this.translationY = view.getTranslationY();
        }

        void restore() {
            view.setScaleX(scaleX);
            view.setScaleY(scaleY);
            view.setTranslationX(translationX);
            view.setTranslationY(translationY);
        }
    }

    private final View.OnLayoutChangeListener layoutChangeListener =
            (v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
                if (left == oldLeft && top == oldTop && right == oldRight && bottom == oldBottom) {
                    return;
                }
                applyParams();
                enforcePipBounds(right - left, bottom - top);
            };

    private static void logTrace(String tag, String message) {
        Log.d(TAG, tag + " " + message);
    }

    GlidePipController(GlidePlayerView videoView) {
        this.videoView = videoView;
    }

    // =========================================================================
    // Attach / detach
    // =========================================================================

    void attach() {
        ComponentActivity activity = componentActivity();
        if (activity == null || listeningActivity != null) {
            return;
        }

        modeChangedListener = info -> handleModeChanged(info.isInPictureInPictureMode());
        activity.addOnPictureInPictureModeChangedListener(modeChangedListener);
        listeningActivity = activity;
        OWNERS.put(activity, this);
        ContextCompat.registerReceiver(activity, controlReceiver,
                new IntentFilter(ACTION_CONTROL), ContextCompat.RECEIVER_NOT_EXPORTED);
        videoView.addOnLayoutChangeListener(layoutChangeListener);
        Log.d(TAG, "attached to " + activity.getClass().getSimpleName());
    }

    void detach() {
        videoView.removeOnLayoutChangeListener(layoutChangeListener);
        unwatchWindowResize();

        if (listeningActivity != null && modeChangedListener != null) {
            listeningActivity.removeOnPictureInPictureModeChangedListener(modeChangedListener);
        }
        if (listeningActivity != null) {
            listeningActivity.unregisterReceiver(controlReceiver);
        }

        // Disarm auto-enter and drop the buttons before going away, otherwise the Activity
        // keeps entering PiP on whatever screen replaced the player. Skipped when a newer
        // player already owns the Activity: those params are its, not ours.
        if (isOwner()) {
            enabled = false;
            showPlay = true;
            OWNERS.remove(listeningActivity);
            Activity activity = currentActivity();
            if (activity != null) {
                try {
                    // No actions hands PiP back to the session's buttons, where there are any.
                    activity.setPictureInPictureParams(buildParams(false));
                } catch (Exception e) {
                    Log.w(TAG, "setPictureInPictureParams failed: " + e.getMessage());
                }
            }
        }
        listeningActivity = null;
        modeChangedListener = null;

        restorePresentation();
        inPipMode = false;
    }

    // =========================================================================
    // State from the view
    // =========================================================================

    /** JS tells us only whether PiP is currently allowed, never how or when. */
    void setEnabled(boolean enabled) {
        if (this.enabled == enabled) {
            return;
        }
        this.enabled = enabled;
        Log.d(TAG, "enabled=" + enabled);
        applyParams();
    }

    /**
     * Whether the PiP button offers play (paused, ended, idle) rather than pause. Also what
     * arms auto-enter: unlike isPlaying it stays false while buffering, which used to disarm
     * auto-enter for a home swipe during a stall.
     */
    void setShowPlay(boolean showPlay) {
        if (this.showPlay == showPlay) {
            return;
        }
        this.showPlay = showPlay;
        applyParams();
    }

    void setSkipAvailable(boolean hasPrevious, boolean hasNext) {
        if (this.hasPrevious == hasPrevious && this.hasNext == hasNext) {
            return;
        }
        this.hasPrevious = hasPrevious;
        this.hasNext = hasNext;
        applyParams();
    }

    /**
     * Next/previous mounts a new player while the Activity is already in PiP, so its
     * mode-change listener never fires. Adopt the mode here, once the view has parents to
     * walk; at attach() it has none.
     */
    void onAttachedToWindow() {
        Activity activity = currentActivity();
        if (activity != null && activity.isInPictureInPictureMode()) {
            handleModeChanged(true);
        }
    }

    void setVideoGeometry(int width, int height, int sarNum, int sarDen) {
        if (this.videoWidth == width && this.videoHeight == height
                && this.sarNum == sarNum && this.sarDen == sarDen) {
            return;
        }
        this.videoWidth = width;
        this.videoHeight = height;
        this.sarNum = sarNum;
        this.sarDen = sarDen;
        applyParams();
    }

    boolean isInPipMode() {
        // The Activity is the ground truth; the cached flag only covers the window
        // between teardown and the last callback.
        Activity activity = currentActivity();
        return activity != null ? activity.isInPictureInPictureMode() : inPipMode;
    }

    // =========================================================================
    // Entry
    // =========================================================================

    /** @return true if the Activity accepted the transition. */
    boolean enter() {
        Activity activity = currentActivity();
        if (activity == null) {
            return false;
        }

        try {
            return activity.enterPictureInPictureMode(buildParams(true));
        } catch (Exception e) {
            Log.w(TAG, "enterPictureInPictureMode failed: " + e.getMessage());
            return false;
        }
    }

    boolean isSupported() {
        Activity activity = currentActivity();
        if (activity == null) {
            return false;
        }
        return activity.getPackageManager()
                .hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    // =========================================================================
    // Params
    // =========================================================================

    private void applyParams() {
        // setPictureInPictureParams must be called from the main thread. In practice this
        // hop never runs: geometry and play state reach us from the player view's event
        // handler, and LibVLC delivers those on the main looper (VLCObject posts events
        // through a main-looper Handler, and AWindow does the same for layout callbacks).
        // Kept as insurance on a call that genuinely requires the main thread, not because
        // a background caller is known to exist.
        if (Looper.myLooper() != Looper.getMainLooper()) {
            videoView.post(this::applyParams);
            return;
        }

        Activity activity = currentActivity();
        if (activity == null || !isOwner()) {
            return;
        }

        try {
            activity.setPictureInPictureParams(buildParams(true));
        } catch (Exception e) {
            Log.w(TAG, "setPictureInPictureParams failed: " + e.getMessage());
        }
    }

    private PictureInPictureParams buildParams(boolean withActions) {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();

        Rational aspectRatio = videoAspectRatio();
        if (aspectRatio != null) {
            builder.setAspectRatio(aspectRatio);
        }

        Rect sourceRectHint = sourceRectHint();
        if (sourceRectHint != null) {
            builder.setSourceRectHint(sourceRectHint);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(enabled && !showPlay);
            // Video content can be resized without a crossfade.
            builder.setSeamlessResizeEnabled(true);
        }

        Activity activity = currentActivity();
        if (activity != null) {
            builder.setActions(withActions ? buildActions(activity) : new ArrayList<>());
        }

        return builder.build();
    }

    /** Previous, play/pause, next: three is what every device allows. */
    private List<RemoteAction> buildActions(Activity activity) {
        List<RemoteAction> actions = new ArrayList<>();
        actions.add(action(activity, CONTROL_PREVIOUS, "Previous",
                androidx.media3.session.R.drawable.media3_icon_previous, hasPrevious));
        actions.add(showPlay
                ? action(activity, CONTROL_PLAY_PAUSE, "Play",
                        androidx.media3.session.R.drawable.media3_icon_play, true)
                : action(activity, CONTROL_PLAY_PAUSE, "Pause",
                        androidx.media3.session.R.drawable.media3_icon_pause, true));
        actions.add(action(activity, CONTROL_NEXT, "Next",
                androidx.media3.session.R.drawable.media3_icon_next, hasNext));
        return actions;
    }

    private static RemoteAction action(Activity activity, int control, String title, int icon,
                                       boolean enabled) {
        Intent intent = new Intent(ACTION_CONTROL)
                .setPackage(activity.getPackageName())
                .putExtra(EXTRA_CONTROL, control);
        // Request code per control: PendingIntents differing only in extras are one intent.
        PendingIntent pending = PendingIntent.getBroadcast(activity, control, intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        RemoteAction action = new RemoteAction(
                Icon.createWithResource(activity, icon), title, title, pending);
        action.setEnabled(enabled);
        return action;
    }

    private boolean isOwner() {
        return listeningActivity != null && OWNERS.get(listeningActivity) == this;
    }

    /**
     * The PiP window must take the aspect ratio of the <em>video</em>, corrected for a
     * non-square sample aspect ratio. Using the surface bounds gives the PiP window the
     * shape of the phone, which is why the video used to sit letterboxed inside it.
     */
    private Rational videoAspectRatio() {
        if (videoWidth <= 0 || videoHeight <= 0) {
            return null;
        }

        float sar = (sarNum > 0 && sarDen > 0) ? ((float) sarNum / sarDen) : 1f;
        float dar = (videoWidth * sar) / videoHeight;
        if (dar <= 0f || Float.isNaN(dar) || Float.isInfinite(dar)) {
            return null;
        }

        float clamped = Math.max(MIN_ASPECT_RATIO, Math.min(MAX_ASPECT_RATIO, dar));
        return new Rational(Math.round(clamped * 1000f), 1000);
    }

    /**
     * Window-relative pixel bounds of the video surface, which is what the system
     * animates from. Measuring this in JS produced dp and therefore a rect that was
     * wrong by the display density.
     */
    private Rect sourceRectHint() {
        Rect rect = new Rect();
        if (!videoView.getGlobalVisibleRect(rect)) {
            return null;
        }
        if (rect.width() <= 0 || rect.height() <= 0) {
            return null;
        }
        return rect;
    }

    // =========================================================================
    // Presentation
    // =========================================================================
    private void handleModeChanged(boolean isInPipMode) {
        if (this.inPipMode == isInPipMode) {
            return;
        }
        this.inPipMode = isInPipMode;
        Log.i(TAG, "pip mode changed -> " + isInPipMode
                + " aspect=" + videoAspectRatio()
                + " sourceRect=" + sourceRectHint()
                + " video=" + videoWidth + "x" + videoHeight
                + " sar=" + sarNum + ":" + sarDen);

        if (isInPipMode) {
            applyPresentation();
            watchWindowResize();
        } else {
            unwatchWindowResize();
            restorePresentation();
        }

        logViewChain(isInPipMode ? "enter" : "exit");
        if (isInPipMode) {
            syncVideoBoundsToWindow("pipEnter");
        } else {
            restoreVideoBounds();
        }

        videoView.onPipModeChangedInternal(isInPipMode);
    }

    /**
     * A PiP window shows the whole Activity, so everything except the video has to go.
     * Doing it here runs on the main thread in the same frame batch as the PiP resize,
     * which a React re-render cannot match.
     *
     * This has to stay live for the whole PiP session, not just fire once on entry:
     * React mounts views while PiP is open (a tap that reveals the controls, a HUD
     * that appears), and anything mounted after the first pass would otherwise be
     * visible in the PiP window — correctly laid out to it, which is the giveaway.
     */
    private void applyPresentation() {
        hideNonVideoViews();

        ViewGroup contentRoot = contentRoot();
        if (contentRoot != null && presentationLayoutListener == null) {
            presentationLayoutListener = (v, l, t, r, b, ol, ot, or, ob) -> {
                if (inPipMode) {
                    hideNonVideoViews();
                }
            };
            contentRoot.addOnLayoutChangeListener(presentationLayoutListener);
        }
    }

    /** Idempotent: only ever hides views that are currently visible. */
    private void hideNonVideoViews() {
        ViewGroup contentRoot = contentRoot();
        View child = videoView;
        ViewGroup parent = parentOf(child);
        boolean captureTransforms = savedTransforms.isEmpty();

        while (parent != null) {
            for (int i = 0; i < parent.getChildCount(); i++) {
                View sibling = parent.getChildAt(i);
                if (sibling != child && sibling.getVisibility() == View.VISIBLE) {
                    sibling.setVisibility(View.GONE);
                    hiddenViews.add(sibling);
                }
            }

            // Any zoom/pan the user applied to an ancestor would crop the PiP window.
            if (captureTransforms) {
                savedTransforms.add(new SavedTransform(parent));
            }
            parent.setScaleX(1f);
            parent.setScaleY(1f);
            parent.setTranslationX(0f);
            parent.setTranslationY(0f);

            if (parent == contentRoot) {
                break;
            }
            child = parent;
            parent = parentOf(child);
        }
    }

    private void restorePresentation() {
        ViewGroup contentRoot = contentRoot();
        if (contentRoot != null && presentationLayoutListener != null) {
            contentRoot.removeOnLayoutChangeListener(presentationLayoutListener);
        }
        presentationLayoutListener = null;

        for (int i = hiddenViews.size() - 1; i >= 0; i--) {
            hiddenViews.get(i).setVisibility(View.VISIBLE);
        }
        hiddenViews.clear();

        for (int i = savedTransforms.size() - 1; i >= 0; i--) {
            savedTransforms.get(i).restore();
        }
        savedTransforms.clear();
    }


    // =========================================================================
    // Window resize propagation
    // =========================================================================

    /**
     * The window resize lands after onPictureInPictureModeChanged, so react to the
     * decor view actually changing size rather than guessing with a delay.
     */
    private void watchWindowResize() {
        Activity activity = currentActivity();
        if (activity == null || activity.getWindow() == null || decorLayoutListener != null) {
            return;
        }

        decorLayoutListener = (v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            boolean sizeChanged = (right - left) != (oldRight - oldLeft)
                    || (bottom - top) != (oldBottom - oldTop);
            if (sizeChanged) {
                logViewChain("decorResize");
                syncVideoBoundsToWindow("decorResize");
            }
        };
        activity.getWindow().getDecorView().addOnLayoutChangeListener(decorLayoutListener);
    }

    private void unwatchWindowResize() {
        Activity activity = currentActivity();
        if (activity != null && activity.getWindow() != null && decorLayoutListener != null) {
            activity.getWindow().getDecorView().removeOnLayoutChangeListener(decorLayoutListener);
        }
        decorLayoutListener = null;
    }

    /**
     * ponytail: PiP-only override of Fabric-owned view bounds.
     *
     * The chain dump showed everything down to react-native-screens' Screen resizing
     * correctly on PiP entry, and everything below it — the Fabric-managed subtree,
     * starting at ScreenContentWrapper — keeping its pre-PiP bounds indefinitely.
     * Fabric writes those bounds from the Yoga tree, so requestLayout() on them does
     * nothing; the surface stays fullscreen-sized and the PiP window clips it to a
     * corner. Dragging the window is what eventually forced a fresh mount.
     *
     * So while PiP is open, the video surface's bounds are ours, not Fabric's. Safe
     * because PiP hides every sibling anyway, and the stale ancestors are larger than
     * the PiP window so nothing clips. Ceiling: this papers over a Fabric/screens
     * relayout gap. Upgrade path is finding why that surface never re-mounts in PiP
     * (or hosting the player outside the screens stack), after which this can go.
     */
    private void syncVideoBoundsToWindow(String reason) {
        Activity activity = currentActivity();
        if (activity == null || activity.getWindow() == null) {
            return;
        }

        View decor = activity.getWindow().getDecorView();
        int width = decor.getWidth();
        int height = decor.getHeight();
        if (width <= 0 || height <= 0) {
            return;
        }

        pipTargetWidth = width;
        pipTargetHeight = height;

        int adjusted = layoutChainToWindow(width, height);
        if (adjusted > 0) {
            logTrace("PIP_BOUNDS", adjusted + " view(s) -> " + width + "x" + height
                    + " reason=" + reason);
        }
    }

    /**
     * Size the video surface <em>and every Fabric-managed ancestor</em> to the window.
     *
     * Sizing only the surface is not enough: its ancestors keep whatever bounds the
     * last mount gave them, and a parent smaller than its child clips the child. That
     * is why PiP looked correct on entry — the ancestors still held fullscreen bounds,
     * larger than any PiP window — and broke after a resize, where they hold the
     * previous, smaller PiP rectangle and clip the video to its top-left corner.
     *
     * Ancestors that are already the right size are skipped, which naturally stops the
     * walk doing anything to the natively-sized views above the React subtree.
     *
     * @return how many views actually needed adjusting.
     */
    private int layoutChainToWindow(int width, int height) {
        ViewGroup contentRoot = contentRoot();
        View view = videoView;
        int adjusted = 0;

        while (view != null) {
            if (view.getWidth() != width || view.getHeight() != height) {
                // ReactViewGroup.onLayout does not reposition children (Fabric places
                // them directly), so laying out a parent cannot undo the child above it.
                view.layout(0, 0, width, height);
                adjusted++;
            }
            if (view == contentRoot) {
                break;
            }
            view = (view.getParent() instanceof View) ? (View) view.getParent() : null;
        }

        return adjusted;
    }

    /**
     * Re-assert the PiP bounds if something stamped the old ones back.
     *
     * Resizing the PiP window triggers a re-mount, and the mounting layer writes the
     * bounds it has in the shadow tree — which are the pre-resize ones. That is what
     * made an enlarged PiP window snap the video back to the previous size until the
     * window was dragged. Posting rather than laying out inline keeps us out of the
     * traversal that is currently running.
     */
    private void enforcePipBounds(int currentWidth, int currentHeight) {
        if (!inPipMode || pipTargetWidth <= 0 || pipTargetHeight <= 0) {
            return;
        }
        if (currentWidth == pipTargetWidth && currentHeight == pipTargetHeight) {
            return;
        }

        logTrace("PIP_BOUNDS", "surface was re-laid out to " + currentWidth + "x" + currentHeight
                + ", re-asserting " + pipTargetWidth + "x" + pipTargetHeight);
        videoView.post(() -> {
            if (inPipMode) {
                syncVideoBoundsToWindow("enforce");
            }
        });
    }

    /**
     * Hand the whole subtree back to the fullscreen window once PiP is over.
     *
     * Posted, because at the moment the mode-change callback fires the decor view is
     * still reporting the PiP size — reading it inline "restores" the subtree to the
     * size it already had. By the time the post runs the window has resized, and
     * Fabric has usually resumed mounting and fixed things itself, in which case this
     * finds everything correct and adjusts nothing.
     */
    private void restoreVideoBounds() {
        pipTargetWidth = 0;
        pipTargetHeight = 0;

        videoView.post(() -> {
            if (inPipMode) {
                return;
            }
            Activity activity = currentActivity();
            if (activity == null || activity.getWindow() == null) {
                return;
            }
            View decor = activity.getWindow().getDecorView();
            int width = decor.getWidth();
            int height = decor.getHeight();
            if (width <= 0 || height <= 0) {
                return;
            }

            int adjusted = layoutChainToWindow(width, height);
            if (adjusted > 0) {
                logTrace("PIP_BOUNDS", "restored " + adjusted + " view(s) -> "
                        + width + "x" + height);
            }
        });
    }

    /** Diagnostic: where in the view chain the stale size actually lives. */
    private void logViewChain(String reason) {
        Activity activity = currentActivity();
        if (activity == null) {
            return;
        }

        StringBuilder sb = new StringBuilder("[PIP_CHAIN] ").append(reason);
        View decor = activity.getWindow() != null ? activity.getWindow().getDecorView() : null;
        if (decor != null) {
            sb.append(" decor=").append(decor.getWidth()).append('x').append(decor.getHeight());
        }

        View view = videoView;
        int depth = 0;
        while (view != null && depth < 16) {
            sb.append(" | ").append(view.getClass().getSimpleName())
                    .append('=').append(view.getWidth()).append('x').append(view.getHeight());
            view = (view.getParent() instanceof View) ? (View) view.getParent() : null;
            depth++;
        }
        Log.d(TAG, sb.toString());
    }

    private ViewGroup contentRoot() {
        Activity activity = currentActivity();
        if (activity == null) {
            return null;
        }
        View root = activity.findViewById(android.R.id.content);
        return (root instanceof ViewGroup) ? (ViewGroup) root : null;
    }

    private static ViewGroup parentOf(View view) {
        return (view.getParent() instanceof ViewGroup) ? (ViewGroup) view.getParent() : null;
    }

    private Activity currentActivity() {
        Activity activity = videoView.getReactActivity();
        return (activity == null || activity.isFinishing()) ? null : activity;
    }

    private ComponentActivity componentActivity() {
        Activity activity = currentActivity();
        return (activity instanceof ComponentActivity) ? (ComponentActivity) activity : null;
    }
}
