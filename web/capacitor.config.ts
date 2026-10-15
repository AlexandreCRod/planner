import type { CapacitorConfig } from "@capacitor/cli";

// Phone build of the web app (prototype). Installs beside the native app (com.alex.planner).
const config: CapacitorConfig = {
  appId: "com.alex.planner.web",
  appName: "Planner (new)",
  webDir: "dist",
  android: {
    // Debug only: lets the https://localhost page call a plain-http dev server (http://10.0.2.2:8787).
    // A release build talks to the https Worker and should turn this off.
    allowMixedContent: true,
  },
  plugins: {
    // The WebView isn't resized by the keyboard; the add panel moves itself above it.
    Keyboard: { resizeOnFullScreen: false },
    SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover" },
  },
};

export default config;
