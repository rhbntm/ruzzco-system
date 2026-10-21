package com.ruzzco.barbers;

import android.content.Intent;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Builds the "choose a file" request for an {@code <input type="file">}, such as the owner's QR
 * upload on /payment-qr, honouring the input's accept list.
 */
final class FilePicker {
    private static final Map<String, String> EXTENSIONS = new HashMap<>();

    static {
        EXTENSIONS.put(".png", "image/png");
        EXTENSIONS.put(".jpg", "image/jpeg");
        EXTENSIONS.put(".jpeg", "image/jpeg");
        EXTENSIONS.put(".webp", "image/webp");
        EXTENSIONS.put(".gif", "image/gif");
        EXTENSIONS.put(".pdf", "application/pdf");
        EXTENSIONS.put(".csv", "text/csv");
    }

    private FilePicker() {}

    static Intent intent(String[] acceptTypes) {
        List<String> types = mimeTypes(acceptTypes);
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType(pickerType(types));
        if (types.size() > 1) pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        return pick;
    }

    /**
     * The accept list as MIME types; "image/png,image/jpeg" and ".png" both work. Returns an
     * empty list (any file) when the list is empty or has an entry this can't translate, so the
     * picker never hides a file the page would take. The page checks the file itself.
     */
    static List<String> mimeTypes(String[] acceptTypes) {
        List<String> types = new ArrayList<>();
        if (acceptTypes == null) return types;
        for (String group : acceptTypes) {
            if (group == null) continue;
            for (String raw : group.split(",")) {
                String entry = raw.trim().toLowerCase(Locale.ROOT);
                if (entry.isEmpty()) continue;
                String type = entry.startsWith(".") ? EXTENSIONS.get(entry) : entry.contains("/") ? entry : null;
                if (type == null) return new ArrayList<>();
                if (!types.contains(type)) types.add(type);
            }
        }
        return types;
    }

    /** "image/*" when every type is an image, the type itself when there is one, else any file. */
    static String pickerType(List<String> types) {
        if (types.isEmpty()) return "*/*";
        if (types.size() == 1) return types.get(0);
        for (String type : types) {
            if (!type.startsWith("image/")) return "*/*";
        }
        return "image/*";
    }
}
