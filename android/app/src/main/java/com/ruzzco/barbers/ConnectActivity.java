package com.ruzzco.barbers;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Asks which shop PC to use: finds it on the Wi-Fi, or takes a typed address and checks that
 * the Ruzzco system answers there. Then it saves the address and opens the app. The secure
 * address (port 3443) is preferred, because there the pages also open when the PC is off.
 */
public class ConnectActivity extends Activity {
    private static final int CHECK_CONNECT_TIMEOUT_MS = 4000;
    private static final int CHECK_READ_TIMEOUT_MS = 10000;

    private final ExecutorService checker = Executors.newSingleThreadExecutor();
    private ServerFinder finder;
    private boolean finding;
    private boolean checking;
    private String saved;

    private EditText address;
    private Button findButton;
    private Button connectButton;
    private ProgressBar busy;
    private TextView status;
    private LinearLayout foundList;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_connect);
        SystemBars.fit(findViewById(R.id.root));
        saved = ServerStore.get(this);

        address = findViewById(R.id.address);
        findButton = findViewById(R.id.find);
        connectButton = findViewById(R.id.connect);
        busy = findViewById(R.id.busy);
        status = findViewById(R.id.status);
        foundList = findViewById(R.id.found);

        findButton.setOnClickListener(v -> find());
        connectButton.setOnClickListener(v -> check(address.getText().toString()));
        address.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId != EditorInfo.IME_ACTION_GO) return false;
            check(address.getText().toString());
            return true;
        });

        if (saved != null) {
            address.setText(ServerAddress.display(saved));
            findViewById(R.id.changing_note).setVisibility(View.VISIBLE);
            Button keep = findViewById(R.id.keep);
            keep.setText(getString(R.string.keep_button, ServerAddress.display(saved)));
            keep.setVisibility(View.VISIBLE);
            keep.setOnClickListener(v -> leave());
        } else if (savedInstanceState == null) {
            find(); // first start: look for the shop PC straight away
        }

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::leave);
        }
    }

    // Android 12L and older only. From Android 13 the callback registered in onCreate handles back
    // (enableOnBackInvokedCallback in the manifest), which is what this lint check asks for.
    @Override
    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        leave();
    }

    /** Back without changing anything: to the app underneath, or reopen it when this screen came from the shortcut. */
    private void leave() {
        if (saved != null && isTaskRoot()) {
            openApp(saved);
        } else {
            finish();
        }
    }

    private void find() {
        if (finder != null) finder.cancel();
        foundList.removeAllViews();
        Subnet subnet = ServerFinder.wifiSubnet(this);
        if (subnet == null) {
            showStatus(getString(R.string.find_no_wifi), true);
            return;
        }
        finding = true;
        updateBusy();
        findButton.setEnabled(false);
        showStatus(getString(R.string.find_looking, subnet.describe()), false);
        finder = new ServerFinder(subnet, new ServerFinder.Listener() {
            @Override
            public void onFound(String baseUrl) {
                runOnUiThread(() -> {
                    if (!isDestroyed()) addFound(baseUrl);
                });
            }

            @Override
            public void onDone(int found) {
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    finding = false;
                    updateBusy();
                    findButton.setEnabled(true);
                    findButton.setText(R.string.find_again);
                    if (found == 0) {
                        showStatus(getString(R.string.find_none), true);
                    } else {
                        showStatus(getResources().getQuantityString(R.plurals.find_found, found, found), false);
                    }
                });
            }
        });
        finder.start();
    }

    private void addFound(String baseUrl) {
        Button button = (Button) getLayoutInflater().inflate(R.layout.item_found_server, foundList, false);
        boolean secure = baseUrl.startsWith("https://");
        button.setText(getString(secure ? R.string.found_secure_button : R.string.found_button,
                ServerAddress.display(baseUrl)));
        button.setOnClickListener(v -> openApp(baseUrl));
        foundList.addView(button);
    }

    private void check(String typed) {
        String baseUrl = ServerAddress.normalize(typed);
        if (baseUrl == null) {
            showStatus(getString(R.string.connect_bad_address), true);
            return;
        }
        // "192.168.1.19" may also have the secure address; "http://192.168.1.19:3000" means exactly that.
        boolean mayUpgrade = !typed.trim().toLowerCase(Locale.ROOT).startsWith("http://");
        hideKeyboard();
        checking = true;
        updateBusy();
        connectButton.setEnabled(false);
        String shown = ServerAddress.display(baseUrl);
        showStatus(getString(R.string.connect_checking, shown), false);
        checker.execute(() -> {
            ServerCheck.Result result = ServerCheck.probe(baseUrl, CHECK_CONNECT_TIMEOUT_MS, CHECK_READ_TIMEOUT_MS);
            String best = mayUpgrade && ServerCheck.isRuzzco(result)
                    ? ServerCheck.preferSecure(baseUrl, CHECK_CONNECT_TIMEOUT_MS, CHECK_READ_TIMEOUT_MS)
                    : baseUrl;
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                checking = false;
                updateBusy();
                connectButton.setEnabled(true);
                switch (result) {
                    case RUZZCO:
                        openApp(best);
                        break;
                    case RUZZCO_DATABASE_DOWN:
                        Toast.makeText(this, R.string.connect_database_down, Toast.LENGTH_LONG).show();
                        openApp(best);
                        break;
                    case NOT_RUZZCO:
                        showStatus(getString(R.string.connect_not_ruzzco, shown), true);
                        break;
                    default:
                        showStatus(getString(R.string.connect_unreachable, shown), true);
                }
            });
        });
    }

    private void openApp(String baseUrl) {
        ServerStore.set(this, baseUrl);
        startActivity(new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        finish();
    }

    private void showStatus(String text, boolean problem) {
        status.setText(text);
        status.setTextColor(getColor(problem ? R.color.crimson_ink : R.color.dust));
        status.setVisibility(View.VISIBLE);
    }

    private void updateBusy() {
        busy.setVisibility(finding || checking ? View.VISIBLE : View.GONE);
    }

    private void hideKeyboard() {
        InputMethodManager keyboard = getSystemService(InputMethodManager.class);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(address.getWindowToken(), 0);
    }

    @Override
    protected void onDestroy() {
        checker.shutdownNow();
        if (finder != null) finder.cancel();
        super.onDestroy();
    }
}
