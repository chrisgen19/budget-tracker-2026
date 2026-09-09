import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Matches the current implicit id (which defaults to start_url), so already
    // installed apps keep their identity. Changing this orphans them.
    id: "/dashboard",
    name: "Budget Tracker",
    short_name: "Budget",
    description: "Track your income and expenses with ease",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#FAF7F2",
    theme_color: "#C8702A",
    orientation: "portrait-primary",
    categories: ["finance", "productivity"],
    // Long-press the installed icon (Android, or right-click on desktop) to land straight on the
    // grid. Deliberately one entry pointing at the page rather than one per button: the manifest
    // is static and cached, so per-tile entries would go stale the moment a button was renamed,
    // and Chrome on Android renders only the first three anyway. iOS renders none, so this is an
    // Android and desktop affordance only.
    shortcuts: [
      {
        name: "Quick Log",
        short_name: "Quick Log",
        description: "Log a routine expense in one tap",
        url: "/quick-log?source=shortcut",
      },
    ],
    icons: [
      { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
