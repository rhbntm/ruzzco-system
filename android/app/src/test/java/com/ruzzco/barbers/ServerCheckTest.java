package com.ruzzco.barbers;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Bodies shaped like ruzzco-system's /api/v1/health answers, with made-up counts. */
public class ServerCheckTest {
    static final String HEALTHY = "{\"status\":\"healthy\",\"timestamp\":\"2026-10-18T10:00:00.000Z\","
            + "\"services\":{\"api\":\"online\",\"database\":\"connected\",\"databaseType\":\"MySQL 8.0 (Docker)\"},"
            + "\"counts\":{\"barbers\":4,\"services\":5}}";
    static final String DATABASE_DOWN = "{\"status\":\"unhealthy\",\"timestamp\":\"2026-10-18T10:00:00.000Z\","
            + "\"services\":{\"api\":\"online\",\"database\":\"disconnected\"},\"error\":\"Database unreachable\"}";

    @Test
    public void recognisesTheRuzzcoHealthRoute() {
        assertEquals(ServerCheck.Result.RUZZCO, ServerCheck.classify(200, HEALTHY));
    }

    @Test
    public void ruzzcoWithItsDatabaseDownStillCounts() {
        assertEquals(ServerCheck.Result.RUZZCO_DATABASE_DOWN, ServerCheck.classify(503, DATABASE_DOWN));
    }

    @Test
    public void otherAnswersAreNotRuzzco() {
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.classify(404, "{\"success\":false,\"error\":\"Not found\"}"));
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.classify(200, "<!DOCTYPE html><html><body>Router</body></html>"));
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.classify(200, "{\"status\":\"healthy\"}"));
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.classify(200, "{\"status\":\"ok\",\"services\":{\"api\":\"online\"}}"));
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.classify(200, "[]"));
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.classify(200, ""));
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.classify(200, null));
        // The right body with the wrong status is not the health route either.
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.classify(500, DATABASE_DOWN));
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.classify(503, HEALTHY));
    }

    @Test
    public void nothingListeningIsUnreachable() {
        // Port 9 (discard) on this computer: nothing answers there.
        assertEquals(ServerCheck.Result.UNREACHABLE, ServerCheck.probe("http://127.0.0.1:9", 500, 500));
    }
}
