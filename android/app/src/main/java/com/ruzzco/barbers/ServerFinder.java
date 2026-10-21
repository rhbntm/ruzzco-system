package com.ruzzco.barbers;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;

import java.net.Inet4Address;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Finds the Ruzzco server on the shop Wi-Fi: asks every address in the phone's network for the
 * health route on port 3000, 32 at a time. On a usual home or shop network that takes a few
 * seconds. This also finds the right address when the PC has several network adapters. Where
 * the PC also serves the secure address (port 3443) and the app trusts it, that one is reported.
 */
final class ServerFinder {
    interface Listener {
        /** A Ruzzco server answered at this base URL (https when it can). Called on a background thread. */
        void onFound(String baseUrl);

        /** Every address was asked. Called once, on a background thread, unless cancelled. */
        void onDone(int found);
    }

    private static final int THREADS = 32;
    private static final int CONNECT_TIMEOUT_MS = 700;
    // Generous: the dev server builds the route the first time it is asked.
    private static final int READ_TIMEOUT_MS = 8000;

    private final Subnet subnet;
    private final Listener listener;
    private final ExecutorService pool = Executors.newFixedThreadPool(THREADS);
    private volatile boolean cancelled;

    ServerFinder(Subnet subnet, Listener listener) {
        this.subnet = subnet;
        this.listener = listener;
    }

    /** The phone's Wi-Fi (or wired) network, or null when it is on neither. */
    @SuppressWarnings("deprecation") // getAllNetworks: a one-off look is all this needs
    static Subnet wifiSubnet(Context context) {
        ConnectivityManager connectivity = context.getSystemService(ConnectivityManager.class);
        if (connectivity == null) return null;
        for (Network network : connectivity.getAllNetworks()) {
            NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
            LinkProperties properties = connectivity.getLinkProperties(network);
            if (capabilities == null || properties == null) continue;
            if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue;
            for (LinkAddress link : properties.getLinkAddresses()) {
                if (link.getAddress() instanceof Inet4Address && !link.getAddress().isLoopbackAddress()) {
                    return Subnet.of(link.getAddress().getAddress(), link.getPrefixLength());
                }
            }
        }
        return null;
    }

    void start() {
        List<String> hosts = subnet.candidates();
        if (hosts.isEmpty()) {
            listener.onDone(0);
            return;
        }
        AtomicInteger remaining = new AtomicInteger(hosts.size());
        AtomicInteger found = new AtomicInteger();
        for (String host : hosts) {
            pool.execute(() -> {
                if (!cancelled) {
                    String baseUrl = "http://" + host + ":" + ServerAddress.DEFAULT_PORT;
                    ServerCheck.Result result = ServerCheck.probe(baseUrl, CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS);
                    if (ServerCheck.isRuzzco(result) && !cancelled) {
                        String best = ServerCheck.preferSecure(baseUrl, CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS);
                        found.incrementAndGet();
                        if (!cancelled) listener.onFound(best);
                    }
                }
                if (remaining.decrementAndGet() == 0 && !cancelled) listener.onDone(found.get());
            });
        }
        pool.shutdown();
    }

    void cancel() {
        cancelled = true;
        pool.shutdownNow();
    }
}
