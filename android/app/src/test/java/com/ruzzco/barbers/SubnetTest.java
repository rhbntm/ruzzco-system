package com.ruzzco.barbers;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

public class SubnetTest {
    private static Subnet subnet(int a, int b, int c, int d, int prefix) {
        return Subnet.of(new byte[] {(byte) a, (byte) b, (byte) c, (byte) d}, prefix);
    }

    @Test
    public void homeNetworkListsEveryOtherAddress() {
        List<String> hosts = subnet(192, 168, 1, 37, 24).candidates();
        assertEquals(253, hosts.size()); // .1 to .254 without the phone's .37
        assertEquals("192.168.1.1", hosts.get(0));
        assertEquals("192.168.1.254", hosts.get(hosts.size() - 1));
        assertFalse(hosts.contains("192.168.1.37"));
        assertFalse(hosts.contains("192.168.1.0"));
        assertFalse(hosts.contains("192.168.1.255"));
    }

    @Test
    public void bigNetworksAreCutToThePhonesBlock() {
        List<String> hosts = subnet(10, 0, 5, 9, 16).candidates();
        assertEquals(253, hosts.size());
        assertTrue(hosts.contains("10.0.5.1"));
        assertFalse(hosts.contains("10.0.4.1"));
    }

    @Test
    public void smallNetworksStayInsideTheirBlock() {
        List<String> hosts = subnet(10, 0, 0, 20, 28).candidates();
        assertEquals(13, hosts.size()); // 10.0.0.17 to .30, without .20
        assertEquals("10.0.0.17", hosts.get(0));
        assertEquals("10.0.0.30", hosts.get(hosts.size() - 1));
    }

    @Test
    public void pointToPointLinksHaveNothingToScan() {
        assertTrue(subnet(10, 0, 0, 1, 31).candidates().isEmpty());
        assertTrue(subnet(10, 0, 0, 1, 32).candidates().isEmpty());
    }

    @Test
    public void describesTheBlockForPeople() {
        assertEquals("192.168.1.x", subnet(192, 168, 1, 37, 24).describe());
        assertEquals("10.0.5.x", subnet(10, 0, 5, 9, 16).describe());
        assertEquals("10.0.0.16/28", subnet(10, 0, 0, 20, 28).describe());
    }

    @Test
    public void onlyAcceptsFourByteAddresses() {
        assertNull(Subnet.of(new byte[16], 64));
        assertNull(Subnet.of(null, 24));
    }
}
