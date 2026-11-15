// @ts-check
import withNuxt from "./.nuxt/eslint.config.mjs";

export default withNuxt(
    {
        rules: {
            // Nuxt UI render helpers and test doubles are typed pragmatically.
            // Converting them to `unknown` is a refactor, not a bug fix.
            "@typescript-eslint/no-explicit-any": "off",
            // Vue 3 supports fragment roots; this rule targets Vue 2.
            "vue/no-multiple-template-root": "off",
            // Nuxt auto-import names follow file names (for example Footer).
            "vue/multi-word-component-names": "off",
            // Oxfmt self-closes void elements; keep ESLint aligned with the
            // formatter instead of fighting it.
            "vue/html-self-closing": [
                "error",
                {
                    html: { void: "always", normal: "always", component: "always" },
                    svg: "always",
                    math: "always",
                },
            ],
        },
    },
    {
        files: ["tests/**"],
        rules: {
            // Tests declare environment fixtures before importing the module
            // under test.
            "import/first": "off",
        },
    },
);
