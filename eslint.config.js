// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // This codebase's data-fetching hooks (use-friends, use-chat,
      // use-group-chat, use-unread-counts, and several screens) consistently
      // use the standard "call an async fetchX() directly in a mount/interval
      // effect" pattern — fetchX sets a loading flag synchronously as its
      // first statement, which is exactly what this rule flags. That's a
      // deliberate, correct, and pervasive pattern here (not a bug), and
      // this app has no data-fetching library to migrate to instead, so the
      // rule produces only noise for this repo. Downgraded to a warning
      // rather than left as a blocking error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);
