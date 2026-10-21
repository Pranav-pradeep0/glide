package com.glide.app.haptic;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.app.Activity;
import android.util.Log;
import android.view.HapticFeedbackConstants;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

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

    /**
     * A tester's "too much" / "missed" mark during playback (haptics layer 5): film, media time,
     * kind, to the log and to Android/data/<package>/files/haptics-marks.tsv, which adb can pull
     * from a release build (scripts/haptics-marks.py); each becomes a case in HapticBenchTest.
     */
    @ReactMethod
    public void mark(String kind, String film, double positionMs) {
        String line = film.replace('\t', ' ') + "\t" + Math.round(positionMs) + "\t" + kind;
        Log.w("GlideHaptics", "mark " + line);
        File dir = getReactApplicationContext().getExternalFilesDir(null);
        if (dir == null) return;
        try (FileWriter w = new FileWriter(new File(dir, "haptics-marks.tsv"), true)) {
            w.write(line + "\n");
        } catch (IOException e) {
            Log.w("GlideHaptics", "mark not saved", e);
        }
    }
}
