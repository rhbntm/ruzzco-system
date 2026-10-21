package com.ruzzco.barbers;

import java.util.ArrayList;
import java.util.List;

/** The phone's IPv4 network on the Wi-Fi, and the addresses worth asking for the Ruzzco server. */
final class Subnet {
    /** Never look through more than one /24 block (254 addresses); bigger networks would take minutes. */
    static final int SMALLEST_PREFIX = 24;

    /** The phone's own address, as an unsigned 32-bit number. */
    final long phone;
    final int prefixLength;

    Subnet(long phone, int prefixLength) {
        this.phone = phone & 0xFFFFFFFFL;
        this.prefixLength = Math.max(0, Math.min(32, prefixLength));
    }

    /** From the 4 bytes of an IPv4 address, or null when they aren't 4 bytes. */
    static Subnet of(byte[] ipv4, int prefixLength) {
        if (ipv4 == null || ipv4.length != 4) return null;
        long value = 0;
        for (byte part : ipv4) value = (value << 8) | (part & 0xFF);
        return new Subnet(value, prefixLength);
    }

    /** Every other host address in the phone's block, in order, without the phone itself. */
    List<String> candidates() {
        List<String> hosts = new ArrayList<>();
        int prefix = scanPrefix();
        if (prefix >= 31) return hosts;
        long network = phone & mask(prefix);
        long broadcast = network | (~mask(prefix) & 0xFFFFFFFFL);
        for (long address = network + 1; address < broadcast; address++) {
            if (address != phone) hosts.add(dotted(address));
        }
        return hosts;
    }

    /** The block as people read it: "192.168.1.x" for the usual /24, else "10.0.0.16/28". */
    String describe() {
        int prefix = scanPrefix();
        String network = dotted(phone & mask(prefix));
        if (prefix == 24) return network.substring(0, network.lastIndexOf('.') + 1) + "x";
        return network + "/" + prefix;
    }

    static String dotted(long address) {
        return ((address >> 24) & 0xFF) + "." + ((address >> 16) & 0xFF) + "."
                + ((address >> 8) & 0xFF) + "." + (address & 0xFF);
    }

    private int scanPrefix() {
        return Math.max(prefixLength, SMALLEST_PREFIX);
    }

    private static long mask(int prefix) {
        return prefix == 0 ? 0 : (0xFFFFFFFFL << (32 - prefix)) & 0xFFFFFFFFL;
    }
}
