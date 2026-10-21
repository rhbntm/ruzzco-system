package com.ruzzco.barbers;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * The shop PC's address. People type it in many shapes ("192.168.1.19", "192.168.1.19:3000",
 * "http://192.168.1.19:3000/pos"); the app keeps one shape, the base URL
 * "http://192.168.1.19:3000". The browser storage that holds unsynced sales belongs to that
 * exact base URL, so it must not change shape between visits.
 *
 * The same PC may also serve the secure address "https://192.168.1.19:3443" (ruzzco-system's
 * `npm run https`). There the pages open even when the PC can't be reached, but its storage is
 * separate: to the pages it is another device.
 */
final class ServerAddress {
    /** The Ruzzco web server's port (Next.js's default), used when the typed address has none. */
    static final int DEFAULT_PORT = 3000;
    /** The port of ruzzco-system's HTTPS gateway. */
    static final int SECURE_PORT = 3443;

    private ServerAddress() {}

    /**
     * Turns typed text into a base URL, or returns null when it can't be a server address.
     * Without "http://" or "https://", http and port 3000 are assumed, or https when the port is
     * 3443. A path is dropped: the app always starts at the server's home page.
     */
    static String normalize(String typed) {
        if (typed == null) return null;
        String text = typed.trim();
        if (text.isEmpty() || text.matches(".*\\s.*")) return null;
        boolean schemeTyped = text.toLowerCase(Locale.ROOT).matches("^[a-z][a-z0-9+.-]*://.*");
        if (!schemeTyped) text = "http://" + text;

        URI uri;
        try {
            uri = new URI(text);
        } catch (URISyntaxException e) {
            return null;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return null;
        // getHost() is null when the part after "//" is not a valid host, such as "192.168.1".
        String host = uri.getHost();
        if (host == null || host.isEmpty() || uri.getRawUserInfo() != null) return null;

        int port = uri.getPort();
        if (port == -1 && !schemeTyped) port = DEFAULT_PORT;
        if (port == SECURE_PORT && !schemeTyped) scheme = "https";
        if (port == 0 || port > 65535) return null;
        if (port == defaultPort(scheme)) port = -1;
        return scheme + "://" + host.toLowerCase(Locale.ROOT) + (port == -1 ? "" : ":" + port);
    }

    /**
     * The secure address on the same PC ("http://192.168.1.19:3000" gives
     * "https://192.168.1.19:3443"), or null when baseUrl isn't plain http.
     */
    static String secureFor(String baseUrl) {
        if (baseUrl == null || !baseUrl.startsWith("http://")) return null;
        URI uri;
        try {
            uri = new URI(baseUrl);
        } catch (URISyntaxException e) {
            return null;
        }
        return uri.getHost() == null ? null : "https://" + uri.getHost() + ":" + SECURE_PORT;
    }

    /** The address as people read it: "192.168.1.19:3000". An https address keeps its "https://". */
    static String display(String baseUrl) {
        return baseUrl.startsWith("http://") ? baseUrl.substring("http://".length()) : baseUrl;
    }

    /**
     * True when a link points at the same server as baseUrl (same scheme, host and port), so it
     * opens inside the app. Anything else opens in the phone's browser.
     */
    static boolean sameServer(String baseUrl, String scheme, String host, int port) {
        if (scheme == null || host == null) return false;
        URI base;
        try {
            base = new URI(baseUrl);
        } catch (URISyntaxException e) {
            return false;
        }
        if (base.getScheme() == null || base.getHost() == null) return false;
        String linkScheme = scheme.toLowerCase(Locale.ROOT);
        int linkPort = port != -1 ? port : defaultPort(linkScheme);
        int basePort = base.getPort() != -1 ? base.getPort() : defaultPort(base.getScheme().toLowerCase(Locale.ROOT));
        return base.getScheme().equalsIgnoreCase(linkScheme)
                && base.getHost().equalsIgnoreCase(host)
                && basePort == linkPort;
    }

    private static int defaultPort(String scheme) {
        switch (scheme) {
            case "http":
                return 80;
            case "https":
                return 443;
            default:
                return -1;
        }
    }
}
