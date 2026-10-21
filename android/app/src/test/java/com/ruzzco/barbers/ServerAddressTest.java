package com.ruzzco.barbers;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ServerAddressTest {
    @Test
    public void addsHttpAndPort3000WhenOnlyTheIpIsTyped() {
        assertEquals("http://192.168.1.19:3000", ServerAddress.normalize("192.168.1.19"));
        assertEquals("http://192.168.1.19:3000", ServerAddress.normalize("  192.168.1.19  "));
    }

    @Test
    public void keepsATypedPortAndDropsThePath() {
        assertEquals("http://192.168.1.19:8080", ServerAddress.normalize("192.168.1.19:8080"));
        assertEquals("http://192.168.1.19:3000", ServerAddress.normalize("http://192.168.1.19:3000/pos?x=1#top"));
        assertEquals("http://192.168.1.19:3000", ServerAddress.normalize("192.168.1.19:3000/"));
    }

    @Test
    public void sameServerAlwaysGetsTheSameShape() {
        // Unsynced sales live in storage tied to this exact text, so it must not vary.
        assertEquals(ServerAddress.normalize("HTTP://192.168.1.19:3000/"), ServerAddress.normalize("192.168.1.19"));
        assertEquals("http://shop-pc.local:3000", ServerAddress.normalize("Shop-PC.local"));
    }

    @Test
    public void typedSchemeKeepsItsDefaultPort() {
        assertEquals("https://ruzzco.example.com", ServerAddress.normalize("https://ruzzco.example.com"));
        assertEquals("https://ruzzco.example.com", ServerAddress.normalize("https://ruzzco.example.com:443/"));
        assertEquals("http://192.168.1.19", ServerAddress.normalize("http://192.168.1.19"));
        assertEquals("http://192.168.1.19", ServerAddress.normalize("192.168.1.19:80"));
    }

    @Test
    public void port3443IsTheSecureAddress() {
        assertEquals("https://192.168.1.19:3443", ServerAddress.normalize("192.168.1.19:3443"));
        assertEquals("https://192.168.1.19:3443", ServerAddress.normalize("https://192.168.1.19:3443/pos"));
        // A typed scheme wins, even when it can't work.
        assertEquals("http://192.168.1.19:3443", ServerAddress.normalize("http://192.168.1.19:3443"));
    }

    @Test
    public void secureAddressOfAPlainOne() {
        assertEquals("https://192.168.1.19:3443", ServerAddress.secureFor("http://192.168.1.19:3000"));
        assertEquals("https://shop-pc.local:3443", ServerAddress.secureFor("http://shop-pc.local:3000"));
        assertNull(ServerAddress.secureFor("https://192.168.1.19:3443"));
        assertNull(ServerAddress.secureFor(null));
    }

    @Test
    public void rejectsTextThatIsNotAnAddress() {
        assertNull(ServerAddress.normalize(null));
        assertNull(ServerAddress.normalize(""));
        assertNull(ServerAddress.normalize("   "));
        assertNull(ServerAddress.normalize("192.168.1"));        // an address is missing a part
        assertNull(ServerAddress.normalize("192.168.1.19 3000")); // space instead of a colon
        assertNull(ServerAddress.normalize("192.168.1.19:abc"));
        assertNull(ServerAddress.normalize("192.168.1.19:70000"));
        assertNull(ServerAddress.normalize("192.168.1.19:0"));
        assertNull(ServerAddress.normalize("ftp://192.168.1.19"));
        assertNull(ServerAddress.normalize("http://user:pass@192.168.1.19"));
        assertNull(ServerAddress.normalize("http://"));
    }

    @Test
    public void displayHidesOnlyHttp() {
        assertEquals("192.168.1.19:3000", ServerAddress.display("http://192.168.1.19:3000"));
        assertEquals("https://ruzzco.example.com", ServerAddress.display("https://ruzzco.example.com"));
    }

    @Test
    public void linksOnTheSameServerStayInTheApp() {
        String base = "http://192.168.1.19:3000";
        assertTrue(ServerAddress.sameServer(base, "http", "192.168.1.19", 3000));
        assertTrue(ServerAddress.sameServer(base, "HTTP", "192.168.1.19", 3000));
        assertTrue(ServerAddress.sameServer("http://192.168.1.19", "http", "192.168.1.19", -1));
        assertTrue(ServerAddress.sameServer("http://192.168.1.19", "http", "192.168.1.19", 80));
    }

    @Test
    public void otherServersOpenOutside() {
        String base = "http://192.168.1.19:3000";
        assertFalse(ServerAddress.sameServer(base, "https", "test.paymongo.com", -1));
        assertFalse(ServerAddress.sameServer(base, "http", "192.168.1.20", 3000));
        assertFalse(ServerAddress.sameServer(base, "http", "192.168.1.19", 8001));
        assertFalse(ServerAddress.sameServer(base, "https", "192.168.1.19", 3000));
        assertFalse(ServerAddress.sameServer(base, "tel", null, -1));
        assertFalse(ServerAddress.sameServer(base, null, null, -1));
    }
}
