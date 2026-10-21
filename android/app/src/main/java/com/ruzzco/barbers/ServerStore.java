package com.ruzzco.barbers;

import android.content.Context;
import android.content.SharedPreferences;

/** Remembers which shop PC the app opens, as a base URL from {@link ServerAddress#normalize}. */
final class ServerStore {
    private static final String PREFS = "ruzzco";
    private static final String KEY_SERVER = "server_url";

    private ServerStore() {}

    /** The saved base URL, or null before the first connect. */
    static String get(Context context) {
        return prefs(context).getString(KEY_SERVER, null);
    }

    static void set(Context context, String baseUrl) {
        prefs(context).edit().putString(KEY_SERVER, baseUrl).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
