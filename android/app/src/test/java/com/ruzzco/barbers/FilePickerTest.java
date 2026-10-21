package com.ruzzco.barbers;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public class FilePickerTest {
    @Test
    public void readsThePaymentQrAcceptList() {
        // /payment-qr's input: accept="image/png,image/jpeg,image/webp"
        List<String> types = FilePicker.mimeTypes(new String[] {"image/png,image/jpeg,image/webp"});
        assertEquals(Arrays.asList("image/png", "image/jpeg", "image/webp"), types);
        assertEquals("image/*", FilePicker.pickerType(types));
    }

    @Test
    public void acceptsSplitListsAndExtensions() {
        List<String> types = FilePicker.mimeTypes(new String[] {"image/png", " .JPG ", ".jpeg"});
        assertEquals(Arrays.asList("image/png", "image/jpeg"), types);
    }

    @Test
    public void oneTypeIsUsedAsIs() {
        assertEquals("application/pdf", FilePicker.pickerType(FilePicker.mimeTypes(new String[] {".pdf"})));
    }

    @Test
    public void unknownOrEmptyListsAllowAnyFile() {
        assertTrue(FilePicker.mimeTypes(new String[] {".xyz"}).isEmpty());
        assertTrue(FilePicker.mimeTypes(new String[] {"image/png", "photos"}).isEmpty());
        assertTrue(FilePicker.mimeTypes(new String[] {""}).isEmpty());
        assertTrue(FilePicker.mimeTypes(null).isEmpty());
        assertEquals("*/*", FilePicker.pickerType(FilePicker.mimeTypes(new String[] {""})));
        assertEquals("*/*", FilePicker.pickerType(Arrays.asList("image/png", "application/pdf")));
    }
}
