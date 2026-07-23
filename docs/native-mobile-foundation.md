# Echoo mobile foundation

## What is in place

`native-shell/` is an Expo app that displays Echoo's current mobile UI in a secure native container. It does not copy, restyle, or convert any of the existing HTML/CSS/JavaScript screens. The product UI remains the source of truth in this repository's root.

During development, the shell opens a local address for the existing app. This is intentional: it lets the same interface run in Expo Go on an iPhone or Android phone while the team iterates quickly. It is not a public product website.

Outbound links such as Uber, Apple Maps, Google Maps, and WhatsApp hand off to the operating system. Links within the Echoo app remain in the app container.

## First iPhone test

1. Install **Expo Go** from the App Store on the iPhone 12 Pro Max.
2. Connect the Mac and iPhone to the same Wi-Fi network.
3. In one Terminal window, from the repository root, start the existing site on your local network:

   ```sh
   npx serve . -l 8080
   ```

4. Find the Mac's Wi-Fi IP address in System Settings > Network > Wi-Fi > Details. Create `native-shell/.env` from `.env.example`, using that IP:

   ```sh
   EXPO_PUBLIC_ECHOO_WEB_URL=http://YOUR-MAC-IP:8080/index.html
   ```

5. In another Terminal window:

   ```sh
   cd native-shell
   npx expo start --lan
   ```

6. Scan the Expo QR code with Expo Go. The Echoo interface should appear unchanged inside the iPhone app shell.

If the site does not load, first open the same `http://YOUR-MAC-IP:8080/index.html` address in Safari on the iPhone. That confirms the Wi-Fi connection before Expo is involved.

## Navigation behavior

The app always opens on Echoo home (`index.html`), never the AI companion. Home has no Back control. Other screens use a minimal native chevron-and-label Back control positioned above the page header. It returns to the previous in-app screen; when a screen was opened directly and has no history, it returns to Echoo home instead. iOS swipe-back and Android's system Back action follow the same behavior.

In the mobile shell, the home and Discover headers intentionally omit their account shortcut. Every screen's bottom navigation uses the same 12px bottom spacing as Echoo home.

## Platform path

Expo Go is the right lightweight starting point for this Mac and iPhone. It gives us real-device validation of screen sizing, keyboard behavior, safe areas, scrolling, outbound handoffs, and performance without requiring a current Xcode installation.

Before native-only features ship, move from Expo Go to an Expo development build. That is where we add native Google Maps, location permissions, push notifications, camera-based QR scanning, secure storage, and deep links. The existing UI remains protected; these are additive capabilities, not a rewrite.

For production, the local development URL will be replaced with an offline packaged copy of the Echoo frontend and the native map integrations. Do not use the existing browser Google Maps key as a production mobile credential. Create restricted iOS, Android, and backend credentials before that release step, then rotate the current browser key.
