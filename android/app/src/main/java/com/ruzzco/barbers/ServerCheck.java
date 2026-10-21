package com.ruzzco.barbers;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Asks a server for the Ruzzco health route (GET /api/v1/health in ruzzco-system's web app)
 * to tell whether the Ruzzco system is running there.
 */
final class ServerCheck {
    enum Result {
        /** The Ruzzco server answered and its database is up. */
        RUZZCO,
        /** The Ruzzco server answered, but its database is down (the route answers 503). */
        RUZZCO_DATABASE_DOWN,
        /** Something answered, but not the Ruzzco health route. */
        NOT_RUZZCO,
        /** Nothing answered in time. */
        UNREACHABLE
    }

    static final String HEALTH_PATH = "/api/v1/health";
    private static final int MAX_BODY_BYTES = 16 * 1024;

    private ServerCheck() {}

    /** Blocks until the server answers or a timeout passes, so call it off the main thread. */
    static Result probe(String baseUrl, int connectTimeoutMs, int readTimeoutMs) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(baseUrl + HEALTH_PATH).openConnection();
            connection.setConnectTimeout(connectTimeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            InputStream body = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            return classify(status, body == null ? null : read(body));
        } catch (IOException | RuntimeException e) {
            return Result.UNREACHABLE;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static boolean isRuzzco(Result result) {
        return result == Result.RUZZCO || result == Result.RUZZCO_DATABASE_DOWN;
    }

    /**
     * The secure address on the same PC when Ruzzco answers there and this app trusts its
     * certificate, otherwise plainUrl. Blocks like probe.
     */
    static String preferSecure(String plainUrl, int connectTimeoutMs, int readTimeoutMs) {
        String secure = ServerAddress.secureFor(plainUrl);
        if (secure == null) return plainUrl;
        return isRuzzco(probe(secure, connectTimeoutMs, readTimeoutMs)) ? secure : plainUrl;
    }

    /**
     * Decides from the answer alone. The health route answers 200 with
     * {"status":"healthy","services":{"api":"online",...}}, or 503 with "unhealthy" when MySQL
     * is down.
     */
    static Result classify(int status, String body) {
        if (body == null || (status != 200 && status != 503)) return Result.NOT_RUZZCO;
        try {
            JSONObject json = new JSONObject(body);
            JSONObject services = json.optJSONObject("services");
            if (services == null || !"online".equals(services.optString("api"))) return Result.NOT_RUZZCO;
            String health = json.optString("status");
            if (status == 200 && "healthy".equals(health)) return Result.RUZZCO;
            if (status == 503 && "unhealthy".equals(health)) return Result.RUZZCO_DATABASE_DOWN;
            return Result.NOT_RUZZCO;
        } catch (JSONException e) {
            return Result.NOT_RUZZCO;
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = stream.read(buffer)) != -1 && out.size() <= MAX_BODY_BYTES) {
                out.write(buffer, 0, count);
            }
            return out.toString("UTF-8");
        }
    }
}
