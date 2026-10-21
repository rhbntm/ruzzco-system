package com.ruzzco.barbers;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import org.junit.Assume;
import org.junit.Test;

/**
 * Checks that a running Ruzzco server is recognised the way the app will see it. Skipped unless
 * RUZZCO_URL is set. In PowerShell, with ruzzco-system running:
 *
 *   $env:RUZZCO_URL = "192.168.1.19:3000"
 *   .\gradlew.bat testDebugUnitTest --tests "*LiveServerTest" --rerun
 */
public class LiveServerTest {
    @Test
    public void theRuzzcoServerIsRecognised() {
        String typed = System.getenv("RUZZCO_URL");
        Assume.assumeTrue("RUZZCO_URL is not set", typed != null && !typed.trim().isEmpty());
        String base = ServerAddress.normalize(typed);
        assertNotNull("Not an address: " + typed, base);
        assertEquals(ServerCheck.Result.RUZZCO, ServerCheck.probe(base, 4000, 20000));
    }
}
