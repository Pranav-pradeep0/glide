package com.glide.app.haptic;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.app.Activity;
import android.view.HapticFeedbackConstants;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;

public class HapticModule extends ReactContextBaseJavaModule {
    private final Vibrator vibrator;

    public HapticModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.vibrator = (Vibrator) reactContext.getSystemService(Context.VIBRATOR_SERVICE);
    }

    @Override
    public String getName() {
        return "HapticModule";
    }

    /**
     * Vibrates with specified amplitude for a duration
     * 
     * @param duration  Duration in milliseconds
     * @param amplitude Amplitude from 1-255 (0 = default)
     */
    @ReactMethod
    public void vibrate(int duration, int amplitude) {
        if (vibrator == null || !vibrator.hasVibrator()) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Android 8.0+ - Use VibrationEffect with amplitude control
            int clampedAmplitude = Math.max(1, Math.min(255, amplitude));
            // createOneShot throws for duration <= 0. This is an async void method, so a
            // throw here lands on the native-modules thread and kills the process, out of
            // reach of any JS try/catch. A haptic is never worth a crash.
            try {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, clampedAmplitude));
            } catch (RuntimeException ignored) {
            }
        } else {
            // Fallback for older Android versions
            vibrator.vibrate(duration);
        }
    }

    /**
     * Vibrates with a waveform pattern
     * 
     * @param timings    Array of timing values [delay, duration, delay, duration,
     *                   ...]
     * @param amplitudes Array of amplitude values (0-255) corresponding to timings
     */
    @ReactMethod
    public void vibrateWaveform(ReadableArray timings, ReadableArray amplitudes) {
        if (vibrator == null || !vibrator.hasVibrator()) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Convert ReadableArray to primitive arrays
            long[] timingsArray = new long[timings.size()];
            int[] amplitudesArray = new int[amplitudes.size()];

            for (int i = 0; i < timings.size(); i++) {
                timingsArray[i] = (long) timings.getDouble(i);
            }

            for (int i = 0; i < amplitudes.size(); i++) {
                int amp = amplitudes.getInt(i);
                amplitudesArray[i] = Math.max(0, Math.min(255, amp));
            }

            // Throws for empty, mismatched or all-zero arrays; see vibrate().
            try {
                vibrator.vibrate(VibrationEffect.createWaveform(timingsArray, amplitudesArray, -1));
            } catch (RuntimeException ignored) {
            }
        } else {
            // Fallback for older versions - just use timings
            long[] timingsArray = new long[timings.size()];
            for (int i = 0; i < timings.size(); i++) {
                timingsArray[i] = (long) timings.getDouble(i);
            }
            vibrator.vibrate(timingsArray, -1);
        }
    }

    /**
     * Cancels all ongoing vibrations
     */
    @ReactMethod
    public void cancel() {
        if (vibrator != null) {
            vibrator.cancel();
        }
    }

    /**
     * Checks if device supports amplitude control
     * 
     * @return whether the vibrator can vary strength. Without it every light tap is a full
     *         buzz, so JS needs the real answer, not just "has a vibrator".
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean hasAmplitudeControl() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                vibrator != null &&
                vibrator.hasAmplitudeControl();
    }

    /**
     * System UI haptic (HapticFeedbackConstants) on the window. Follows the user's
     * touch-feedback setting; newer constants fall back to the closest older one.
     */
    @ReactMethod
    public void perform(String type) {
        Activity activity = getCurrentActivity();
        if (activity == null) {
            return;
        }
        int sdk = Build.VERSION.SDK_INT;
        int constant;
        switch (type) {
            case "confirm": constant = sdk >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY; break;
            case "reject": constant = sdk >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS; break;
            case "gestureEnd": constant = sdk >= 30 ? HapticFeedbackConstants.GESTURE_END : HapticFeedbackConstants.CLOCK_TICK; break;
            case "toggleOn": constant = sdk >= 34 ? HapticFeedbackConstants.TOGGLE_ON : HapticFeedbackConstants.CLOCK_TICK; break;
            case "toggleOff": constant = sdk >= 34 ? HapticFeedbackConstants.TOGGLE_OFF : HapticFeedbackConstants.CLOCK_TICK; break;
            case "segmentTick": constant = sdk >= 34 ? HapticFeedbackConstants.SEGMENT_TICK : HapticFeedbackConstants.CLOCK_TICK; break;
            case "longPress": constant = HapticFeedbackConstants.LONG_PRESS; break;
            default: constant = HapticFeedbackConstants.CLOCK_TICK; break;
        }
        final int finalConstant = constant;
        activity.runOnUiThread(() -> activity.getWindow().getDecorView().performHapticFeedback(finalConstant));
    }
}
