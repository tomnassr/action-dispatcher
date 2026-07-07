// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      port: 3333,
    },
    // @zapier/zapier-sdk-cli is a dev-only login helper: the runtime SDK
    // dynamically imports it (`@zapier/zapier-sdk-cli/login`) only to auto-detect
    // local CLI credentials, and it pulls in a native keyring binary that can't
    // be bundled. Production authenticates via ZAPIER_CREDENTIALS instead and
    // never hits that path, so keep the CLI and its native keychain deps out of
    // the build entirely.
    ssr: {
      external: ["@zapier/zapier-sdk-cli", "cross-keychain", "@napi-rs/keyring"],
    },
    build: {
      rollupOptions: {
        external: [
          /^@zapier\/zapier-sdk-cli(\/.*)?$/,
          /^cross-keychain(\/.*)?$/,
          /^@napi-rs\/keyring/,
        ],
      },
    },
  },
});
