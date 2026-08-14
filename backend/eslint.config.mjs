import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Backend lint rules.
 *
 * Type-aware linting (`recommendedTypeChecked`) rather than the syntax-only
 * preset: the rules worth having here — floating promises, unsafe member
 * access, misused promises in Express handlers — all need type information.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "prisma/migrations/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // tsconfig.test.json, not tsconfig.json. The build config excludes
        // *.test.ts so they stay out of dist/, which means the type-aware rules
        // could not see them and every test file failed to parse. The test
        // config includes everything.
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      /*
       * A dropped promise in a request handler is a request that silently never
       * finishes, or an error that never reaches the error handler. Deliberate
       * fire-and-forget is written `void promise`, which this permits — so the
       * intent is visible at the call site rather than assumed.
       */
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],

      /*
       * Off, deliberately.
       *
       * Every provider method implements an interface that declares a
       * `Promise<T>` return. `async` without `await` is the correct way to
       * satisfy that when the body has nothing to wait on — the mock provider's
       * methods, for instance. TypeScript already enforces the return type, so
       * this rule only flags a stylistic non-issue and would push toward
       * `Promise.resolve()` wrappers that read worse.
       */
      "@typescript-eslint/require-await": "off",

      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },

  {
    /*
     * Untyped boundaries.
     *
     * These four files sit where the type system genuinely ends: Express types
     * `req.cookies` as `any`, pino-http's serializers receive untyped requests,
     * and the error handler and validator both work with `unknown` by
     * definition. Casting through them would add noise without adding safety.
     *
     * Scoped to the specific files rather than turned off globally, so an
     * `any` appearing anywhere else in the codebase still fails the build.
     */
    files: [
      "src/middleware/request-context.ts",
      "src/middleware/error-handler.ts",
      "src/http/validate.ts",
      "src/modules/auth/session.cookie.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },

  {
    // Tests reach into internals and assert on loosely-typed fixtures.
    files: ["**/*.test.ts", "src/test/**"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  }
);
