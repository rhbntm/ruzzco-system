# Ruzzco Android

An Android app for the Ruzzco Barbers system ([ruzzco-system](../README.md)). It shows the Ruzzco pages full screen with its own icon. The pages come from the shop PC over the shop Wi-Fi, exactly as in the phone's browser today. On the shop PC's secure address (`https://<PC address>:3443`), the POS and the shift log also open when the PC is off.

## How it works

The app is a thin shell around the web app. Sales, the offline queue, sync, commission and the owner PIN all stay in the web app and work as they do in the browser. The app adds:

- An icon and a full-screen view, with no browser bars.
- A "Connect to the shop PC" screen. It finds the PC on the Wi-Fi by itself, or takes a typed address, checks that Ruzzco answers there and remembers it. When the PC also serves the secure address and the app trusts it, it picks that one ("opens offline too").
- Trust in the shop's own certificate, built in (see [Build it](#build-it)), so phones don't need it installed.
- A "Can't reach the shop PC" screen with **Try again** and **Change address**, instead of the browser's error page.
- Back goes back through the pages. On the first page it leaves the app but keeps the page open in the background, because the POS's offline queue only runs while its page is open.
- The photo picker for uploading payment QRs on `/payment-qr`.
- Links to other sites (such as a QR Ph test page) open in the phone's browser.
- No cloud backup or phone-to-phone transfer, so a new phone never inherits this phone's barber binding or its unsynced sales.

It needs the shop PC running ruzzco-system and the phone on the same Wi-Fi, like the browser does.

## Build it

Needs Java 17 and the Android SDK (platform `android-36`, `build-tools;36.0.0`). `local.properties` (not committed; each PC has its own, and Android Studio creates it) says where the SDK is, for example `sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk`.

From `android/`:

```
.\gradlew.bat assembleDebug        # makes app\build\outputs\apk\debug\app-debug.apk
.\gradlew.bat testDebugUnitTest    # unit tests
```

The first build downloads Gradle's Android plugin and its libraries (a few hundred MB, once).

**The shop certificate.** Build on the shop PC after running `npm run https` there once. The build (the `shopTrust` task in `app/build.gradle.kts`) copies the shop's public certificate from `../web/certs/ruzzco-ca.cert.pem` into the app; it refuses a file that holds a private key. For another PC's certificate, pass `-Pruzzco.shopCa=<path to ruzzco-ca.cert.pem>`. Without one, the build warns and the app still trusts certificates installed on the phone, as Chrome does. If that `certs` folder is ever deleted, `npm run https` makes a new certificate and the app must be rebuilt and reinstalled.

**Antivirus that scans HTTPS** (Avast's Web Shield, for one) re-signs certificates with its own root. Windows trusts that root, but Java doesn't, so Gradle's downloads fail. Add `systemProp.javax.net.ssl.trustStoreType=Windows-ROOT` to `%USERPROFILE%\.gradle\gradle.properties` to make Gradle use the Windows certificate store. The SDK's `sdkmanager` needs the same setting: `$env:SDKMANAGER_OPTS = "-Djavax.net.ssl.trustStoreType=Windows-ROOT"`.

## Put it on a phone

- **Copy the file:** send `app-debug.apk` to the phone (USB cable, Google Drive, Messenger) and open it. Android asks once to allow installing apps from that source.
- **Or over USB:** turn on USB debugging on the phone (Settings, About phone, tap Build number 7 times, then Developer options), plug it in and run `.\gradlew.bat installDebug`.

## First start

1. On the shop PC, start Ruzzco. To open offline, run it in production with the secure gateway: in `web/`, `npm run build && npm run start`, then `npm run https` in a second window (the main README, section 5). `npm run dev` works too, but only online.
2. Put the phone on the same Wi-Fi as the PC.
3. Open the app. It looks for the shop PC by itself; tap the address it finds. Pick the one marked **opens offline too** when it shows.
4. If it finds nothing, type the address: on the PC run `ipconfig` and take the **Wi-Fi** adapter's IPv4 Address, plus `:3000` (for example `192.168.1.19:3000`). The app moves to the secure address by itself when it can; type `http://` in front to stay on `:3000`. Don't use addresses of other adapters (VirtualBox, WSL).

To change the PC later, long-press the app icon and tap **Change shop PC**, or tap **Change address** on the "Can't reach" screen.

## iPhones, and the installable web app

This app is Android only: Apple lets iPhone apps be built only on a Mac. For iPhones (and Android phones, as an alternative to this app), the web app itself is installable (a PWA), with the same icon. Over HTTPS (`npm run https`, see the main README, section 5), the installed app opens the POS and shift log when the shop PC can't be reached, as this app does on the secure address. Over plain HTTP, an iPhone can still add it to the Home Screen (Safari, Share, Add to Home Screen) and open it full screen, but not offline. Unlike this app, it needs the shop certificate installed on each phone.

The installed web app is a new device too, with its own storage, and has no Back button, so use the links on the pages. To rebuild its icons: `python tools/make_icons.py --apple-icon ../web/src/app/apple-icon.png --pwa-icons ../web/public/icons` (from `android/`).

## Good to know

- **The app is a new device.** Its storage is separate from Chrome's, so the first time a barber opens the POS in the app they pick their name again. Before switching a phone from Chrome to the app, open the POS in Chrome and check that everything has synced: unsynced sales stay in Chrome.
- **Unsynced sales belong to the address.** If the PC's address changes, the app starts with an empty queue at the new address, and sales saved under the old one sync only from the old address. The same goes for moving from `:3000` to the secure address (`:3443`): sync first, and barbers pick their name once more. Give the shop PC a fixed address in the router (a DHCP reservation) so it never changes.
- **Offline:** on the secure address, the POS and the shift log open even when the PC is off, also after Android has closed the app: opened while the PC doesn't answer, the app goes straight to the POS within about 5 seconds. Other pages show "Can't reach the shop PC" until it answers. On `:3000` it works as in the browser: the POS keeps taking sales while the app stays open, but if Android closes the app while the PC is unreachable, the POS can't open until the PC answers again. Either way, sales already saved stay on the phone, and the POS reminds the barber ("Shop PC offline", with how many sales are on the phone only) until the PC answers and they are sent.
- **Windows Firewall** on the PC must let Node.js accept connections on private networks, and the PC's Wi-Fi must be set to Private.
- **Wi-Fi without internet:** some phones then send traffic over mobile data. Turn mobile data off at the shop. Guest networks often block phones from reaching the PC; use the main network.
- **Certificate errors:** if the app doesn't trust the secure address's certificate, it says so and doesn't open the page. Rebuild it on the shop PC, or install the certificate on the phone from `http://<PC address>:3080`.
- **Debug build:** fine for testing and the demo. A release build for the shop's phones needs a signing key that you create and keep safe outside Git; every update must be signed with the same key. Not set up yet.

## The code

- `app/src/main/java/com/ruzzco/barbers/`
  - `MainActivity.java`: the Ruzzco pages (an Android WebView), back button, photo picker, "Can't reach" screen.
  - `ConnectActivity.java`: the "Connect to the shop PC" screen.
  - `ServerFinder.java`, `Subnet.java`: look for Ruzzco on every address of the phone's Wi-Fi.
  - `ServerCheck.java`: asks an address for `/api/v1/health`. The app recognises Ruzzco by its answer (`"services": {"api": "online"}` and a `"status"` of `healthy`, or `unhealthy` with a 503 when MySQL is down). If that route changes in ruzzco-system, update this file.
  - `ServerAddress.java`: turns a typed address into one fixed form, and gives a plain address's secure twin (port 3443). `FilePicker`, `ServerStore`, `SystemBars`: small helpers.
- `app/build.gradle.kts`: the `shopTrust` task writes the network security config (`res/xml/network_security_config.xml`, generated under `build/`) and adds the shop certificate.
- `app/src/main/res/`: the screens (`layout/`), all text (`values/strings.xml`), colours copied from the web app's design tokens, and the icon.
- `app/src/test/`: unit tests for the address, health check, Wi-Fi scan and file picker logic.
- `tools/make_icons.py`: rebuilds the icon and the logo from `web/public/ruzzco-logo.jpg`, and with `--apple-icon` the iPhone icon (needs Python with Pillow and Windows' Bahnschrift font).

## Versions

Android Gradle plugin 9.4.0, Gradle 9.6.0, Java 17. Targets Android 16 (API 36), runs on Android 7.0 (API 24) and newer. The app uses no libraries beyond Android itself.

## Notes

- Started on 2026-10-18 as a separate project, then moved into this repository as `android/`.
