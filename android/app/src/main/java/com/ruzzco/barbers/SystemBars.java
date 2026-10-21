package com.ruzzco.barbers;

import android.graphics.Insets;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;

/** Keeps the screen's content clear of the status bar, the navigation bar and the keyboard. */
final class SystemBars {
    private SystemBars() {}

    /**
     * From Android 15 apps draw behind the bars, so the root view is padded by their size (and
     * the keyboard's, which no longer shrinks the window). Older versions place the app between
     * the bars and resize it for the keyboard themselves (adjustResize in the manifest).
     */
    static void fit(View root) {
        if (Build.VERSION.SDK_INT < 35) return;
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout()
                    | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
    }
}
