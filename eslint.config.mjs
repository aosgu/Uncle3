import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module"
    }
  },
  // 1. Root scripts & configuration
  {
    files: ["test-all.js", "*.mjs", "*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        process: "readonly",
        __dirname: "readonly",
        require: "readonly",
        console: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
    }
  },
  // 2. core.js (Pure Shared Logic)
  {
    files: ["uncle3/core.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        console: "readonly",
        Date: "readonly",
        Math: "readonly",
        Number: "readonly",
        String: "readonly",
        Array: "readonly",
        Object: "readonly",
        JSON: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "no-control-regex": "off"
    }
  },
  // 3. Extension code (background, offscreen, popup, settings)
  {
    files: [
      "uncle3/background.js",
      "uncle3/offscreen.js",
      "uncle3/popup.js",
      "uncle3/settings.js"
    ],
    languageOptions: {
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        navigator: "readonly",
        Event: "readonly",
        MouseEvent: "readonly",
        Blob: "readonly",
        URL: "readonly",
        MediaRecorder: "readonly",
        HTMLAnchorElement: "readonly",
        chrome: "readonly",
        importScripts: "readonly",

        // From core.js
        SIZE_MIN: "readonly",
        SIZE_MAX_W: "readonly",
        SIZE_MAX_H: "readonly",
        MAX_RECORD_MS: "readonly",
        DEFAULT_PRESETS: "readonly",
        BUILTIN_PRESETS: "readonly",
        isLockedPreset: "readonly",
        presetKey: "readonly",
        normalizePresets: "readonly",
        validateSize: "readonly",
        isRestrictedUrl: "readonly",
        sanitizeTitle: "readonly",
        pad2: "readonly",
        makeFileName: "readonly",
        fmtTime: "readonly",
        fmtBadge: "readonly",
        pickMimeType: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrors": "none" }],
      "no-empty": ["error", { "allowEmptyCatch": true }]
    }
  },
  // 4. Test scripts
  {
    files: ["uncle3/tests/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Event: "readonly",
        MouseEvent: "readonly",
        chrome: "readonly",
        print: "readonly",
        readFile: "readonly",
        load: "readonly",
        quit: "readonly",

        // Functions from popup / settings / core
        init: "readonly",
        resetRecording: "readonly",
        pollRecordState: "readonly",
        toggleSaveForm: "readonly",
        confirmSavePreset: "readonly",
        normalizePresets: "readonly",
        isLockedPreset: "readonly",
        presetKey: "readonly",
        validateSize: "readonly",
        isRestrictedUrl: "readonly",
        sanitizeTitle: "readonly",
        makeFileName: "readonly",
        fmtTime: "readonly",
        fmtBadge: "readonly",
        pickMimeType: "readonly",
        DEFAULT_PRESETS: "readonly",
        BUILTIN_PRESETS: "readonly",
        MAX_RECORD_MS: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "off",
      "no-constant-condition": "off"
    }
  },
  {
    ignores: [
      "node_modules/**",
      ".git/**"
    ]
  }
];
