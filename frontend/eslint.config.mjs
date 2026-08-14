import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Frontend lint rules.
 *
 * Flat config, invoked through `eslint` directly rather than `next lint` —
 * Next 16 removed that command and no longer runs ESLint as part of the build,
 * so linting is its own step.
 */
const config = [
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    ignores: [".next/**", "node_modules/**", "e2e/**", "next-env.d.ts"],
  },

  {
    rules: {
      // Unused imports are how a refactor leaves debris behind — this is the
      // rule that catches a type import left over after a call site moved.
      // Underscore-prefixed names stay allowed for deliberately unused params.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // The frontend must never reach the backend or the database directly.
      // A stray import here is exactly the coupling this architecture exists to
      // prevent, and it is far cheaper to catch at lint time than in review.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/*", "prisma", "**/backend/**", "../../backend/*"],
              message:
                "The frontend must not import from the backend or from Prisma. Go through lib/api instead.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
