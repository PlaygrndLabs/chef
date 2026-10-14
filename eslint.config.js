import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/worker-configuration.d.ts",
      "**/*.gen.ts",
      "core/test/fixtures/**",
      "research/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        Response: "readonly",
        Request: "readonly",
        fetch: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Buffer: "readonly",
        crypto: "readonly",
        WebSocket: "readonly",
        Headers: "readonly",
        ReadableStream: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["error"] }],
    },
  },
  {
    files: ["apps/dashboard/public/**/*.js", "site/public/**/*.js"],
    languageOptions: {
      globals: { document: "readonly", confirm: "readonly", CustomEvent: "readonly", location: "readonly", history: "readonly", Node: "readonly", setInterval: "readonly", clearInterval: "readonly", URLSearchParams: "readonly", RTCPeerConnection: "readonly", Audio: "readonly", navigator: "readonly", window: "readonly", matchMedia: "readonly", IntersectionObserver: "readonly", ResizeObserver: "readonly", getComputedStyle: "readonly", devicePixelRatio: "readonly", performance: "readonly", requestAnimationFrame: "readonly" },
    },
  },
  {
    files: ["cli/src/bin.ts", "template/app/cli.ts", "workers/scripts/**", "workers/sandbox/**", "site/scripts/**"],
    rules: { "no-console": "off" },
  },
);
