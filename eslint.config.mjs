import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import brandClasses from "./src/lib/brand/eslint-banned-classes.mjs";
import brandWords from "./src/lib/brand/eslint-banned-words.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // v3 brand guards. These turn brief §12 into build-time failures so
  // nothing with default Tailwind blue/indigo or banned brand-voice words
  // reaches production.
  {
    plugins: {
      "rawgrowth-brand": { rules: { ...brandClasses.rules, ...brandWords.rules } },
    },
    rules: {
      "rawgrowth-brand/banned-tailwind-defaults": "error",
      "rawgrowth-brand/banned-words": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Brand-rule source files reference the banned strings literally;
    // exempting them here avoids self-referential lint errors.
    "src/lib/brand/eslint-banned-classes.mjs",
    "src/lib/brand/eslint-banned-words.mjs",
    "src/lib/brand/tokens.ts",
  ]),
]);

export default eslintConfig;
