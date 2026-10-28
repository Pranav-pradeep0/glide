package com.glide.app

import android.content.res.Configuration
import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.widget.EditText
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event

/**
 * Reports the keyboard's height from inside the window it sits in: `onKeyboard({ height })` in
 * dp, every frame while the keyboard slides. A Modal is its own edge-to-edge window, so
 * adjustResize doesn't resize it, and RN's Keyboard events and Reanimated's useAnimatedKeyboard
 * both watch the activity's window and never see its keyboard. The `Sheet` rides on this.
 *
 * On phones it also raises the keyboard when a field in its window takes focus. RN's autoFocus
 * asks once, straight after focusing, and Android drops that while the window has no keyboard
 * attached: a sheet just opening, or a focused field just unmounted (RN blurs it, which hides
 * the keyboard). The insets controller waits until the keyboard can show.
 */
class KeyboardInsetView(context: ThemedReactContext) : View(context) {
    private var last = -1f
    // ponytail: API 30+ only; older phones keep RN's single try.
    private val showOnFocus = ViewTreeObserver.OnGlobalFocusChangeListener { _, focused ->
        if (focused is EditText && Build.VERSION.SDK_INT >= 30) focused.windowInsetsController?.show(WindowInsets.Type.ime())
    }
    // On TV the D-pad moves focus through fields; the keyboard opens only when one is pressed.
    private val isTv = (resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_TELEVISION

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (!isTv) viewTreeObserver.addOnGlobalFocusChangeListener(showOnFocus)
    }

    // A sheet opening with an autoFocus field: the field had focus before its window did.
    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if (hasWindowFocus && !isTv) showOnFocus.onGlobalFocusChanged(null, rootView.findFocus())
    }

    override fun onDetachedFromWindow() {
        viewTreeObserver.removeOnGlobalFocusChangeListener(showOnFocus)
        super.onDetachedFromWindow()
    }

    init {
        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets -> insets.also(::emit) }
        ViewCompat.setWindowInsetsAnimationCallback(
            this,
            object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                override fun onProgress(insets: WindowInsetsCompat, running: List<WindowInsetsAnimationCompat>) =
                    insets.also(::emit)
            },
        )
    }

    private fun emit(insets: WindowInsetsCompat) {
        val dp = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom / resources.displayMetrics.density
        if (dp == last) return
        last = dp
        val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context as ReactContext, id) ?: return
        dispatcher.dispatchEvent(KeyboardEvent(UIManagerHelper.getSurfaceId(this), id, Arguments.createMap().apply { putDouble("height", dp.toDouble()) }))
    }

    private class KeyboardEvent(surfaceId: Int, viewTag: Int, private val payload: WritableMap) : Event<KeyboardEvent>(surfaceId, viewTag) {
        override fun getEventName() = EVENT
        override fun getEventData() = payload
    }

    class Manager : SimpleViewManager<KeyboardInsetView>() {
        override fun getName() = "GlideKeyboardInset"
        override fun createViewInstance(context: ThemedReactContext) = KeyboardInsetView(context)
        override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> = mapOf(EVENT to mapOf("registrationName" to EVENT))
    }

    companion object {
        private const val EVENT = "onKeyboard"
    }
}
