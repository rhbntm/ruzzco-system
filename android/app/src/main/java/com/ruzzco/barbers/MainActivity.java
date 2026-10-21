package com.ruzzco.barbers;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.util.Locale;

/**
 * The Ruzzco system, full screen. Every page comes from the shop PC over the shop Wi-Fi, as in
 * the phone's browser, so the POS still saves each sale on the phone first and syncs it as
 * before. Around the pages this adds the back button, the photo picker for QR uploads, a clear
 * screen when the shop PC can't be reached, and other sites opening in the browser.
 */
public class MainActivity extends Activity {
    private static final int PICK_FILE = 1;
    private static final String KEY_RESTART_AT = "restart_at";

    private String serverUrl;
    private WebView web;
    private ProgressBar progress;
    private View errorPanel;
    private TextView errorMessage;
    private Button retryButton;
    private String failedUrl;
    private boolean pageFailed;
    private boolean certificateFailed;
    private String restartAt;
    private ValueCallback<Uri[]> pendingPick;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        serverUrl = ServerStore.get(this);
        if (serverUrl == null) {
            startActivity(new Intent(this, ConnectActivity.class));
            finish();
            return;
        }
        setContentView(R.layout.activity_main);
        SystemBars.fit(findViewById(R.id.root));

        progress = findViewById(R.id.progress);
        errorPanel = findViewById(R.id.error_panel);
        errorMessage = findViewById(R.id.error_message);
        retryButton = findViewById(R.id.retry);
        retryButton.setOnClickListener(v -> retry());
        findViewById(R.id.change_server).setOnClickListener(v ->
                startActivity(new Intent(this, ConnectActivity.class)));

        web = findViewById(R.id.web);
        setUpWebView();
        String restart = savedInstanceState == null ? null : savedInstanceState.getString(KEY_RESTART_AT);
        if (restart != null) {
            web.loadUrl(restart);
        } else if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(serverUrl + "/");
        }

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
    }

    @SuppressLint("SetJavaScriptEnabled") // the Ruzzco pages need it; other sites open in the browser
    private void setUpWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        // Lets the web app tell the Android app from a browser later, if it ever needs to.
        settings.setUserAgentString(settings.getUserAgentString() + " RuzzcoAndroid/" + BuildConfig.VERSION_NAME);
        // The pages are already dark; don't let Android darken them a second time.
        if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        // Debug builds can be inspected from the PC in Chrome (chrome://inspect).
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new PageClient());
        web.setWebChromeClient(new ChromeClient());
    }

    private void goBack() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            // As Android does for home screen apps: leave, but keep the page alive in the
            // background, because the POS's offline queue only runs while its page is open.
            moveTaskToBack(true);
        }
    }

    // Android 12L and older only. From Android 13 the callback registered in onCreate handles back
    // (enableOnBackInvokedCallback in the manifest), which is what this lint check asks for.
    @Override
    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack();
    }

    private void retry() {
        retryButton.setEnabled(false);
        errorMessage.setText(R.string.error_retrying);
        web.loadUrl(failedUrl != null ? failedUrl : serverUrl + "/");
    }

    private void showError() {
        errorMessage.setText(getString(certificateFailed ? R.string.error_certificate : R.string.error_message,
                ServerAddress.display(serverUrl)));
        retryButton.setEnabled(true);
        errorPanel.setVisibility(View.VISIBLE);
    }

    /** Hands a link to another app (the browser, the dialer). File and app-internal links stay blocked. */
    private void openElsewhere(Uri url) {
        String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
        boolean safe = scheme.equals("http") || scheme.equals("https") || scheme.equals("tel")
                || scheme.equals("mailto") || scheme.equals("sms");
        if (!safe) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK_FILE) {
            if (pendingPick != null) {
                pendingPick.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                pendingPick = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        // Keep the owner PIN session if Android closes the app in the background.
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) {
            web.saveState(outState);
        } else if (restartAt != null) {
            outState.putString(KEY_RESTART_AT, restartAt);
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private final class PageClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (ServerAddress.sameServer(serverUrl, url.getScheme(), url.getHost(), url.getPort())) return false;
            openElsewhere(url);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            pageFailed = false;
            certificateFailed = false;
            progress.setProgress(0);
            progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progress.setVisibility(View.GONE);
            if (pageFailed) {
                showError();
            } else {
                failedUrl = null;
                errorPanel.setVisibility(View.GONE);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            pageFailed = true;
            failedUrl = request.getUrl().toString();
            showError();
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            // Never go past a certificate this app doesn't trust: on the secure address that means
            // the phone isn't set up yet (or the app was built without the shop's certificate).
            handler.cancel();
            pageFailed = true;
            certificateFailed = true;
            failedUrl = error.getUrl();
            showError();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Android closed the page, usually to free memory. Sales already saved on the phone
            // are kept; reopen the same page in a fresh WebView.
            restartAt = view.getUrl();
            ViewGroup parent = (ViewGroup) view.getParent();
            if (parent != null) parent.removeView(view);
            view.destroy();
            web = null;
            recreate();
            return true;
        }
    }

    private final class ChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progress.setProgress(newProgress);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingPick != null) pendingPick.onReceiveValue(null);
            pendingPick = callback;
            try {
                startActivityForResult(FilePicker.intent(params.getAcceptTypes()), PICK_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                pendingPick = null;
                Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_LONG).show();
                return false;
            }
        }
    }
}
