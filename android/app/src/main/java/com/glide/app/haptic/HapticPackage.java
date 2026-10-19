package com.glide.app.haptic;

import com.facebook.react.ReactPackage;
import com.glide.app.BuildConfig;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class HapticPackage implements ReactPackage {
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new HapticModule(reactContext));
        // Haptics Lab is a dev screen. Its module lives in the debug source set only, so a
        // release build has neither the class nor the high-rate sensor permission it needs.
        if (BuildConfig.DEBUG) {
            try {
                modules.add((NativeModule) Class.forName("com.glide.app.haptic.HapticsLabModule")
                        .getConstructor(ReactApplicationContext.class).newInstance(reactContext));
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }
        return modules;
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
