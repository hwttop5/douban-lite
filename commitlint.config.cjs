module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "refactor",
        "perf",
        "style",
        "docs",
        "test",
        "build",
        "ci",
        "chore",
        "revert"
      ]
    ],
    "header-max-length": [2, "always", 100],
    "subject-case": [0]
  }
};
