# Commit Message Convention

This repository now enforces [Conventional Commits](https://www.conventionalcommits.org/).

## Format

Use this format for new commits:

```text
type(scope): subject
type: subject
```

Examples:

```text
feat(api): add timeline sync retry handling
fix(web): keep login state after cookie import
docs: document local proxy setup
chore: align workspace scripts
```

## Allowed Types

- `feat`
- `fix`
- `refactor`
- `perf`
- `style`
- `docs`
- `test`
- `build`
- `ci`
- `chore`
- `revert`

## Local Usage

After `npm install`, Husky installs the `commit-msg` hook automatically.

To lint the latest commit manually:

```bash
npm run commit:check
```

## Existing History

The hook only affects new commits. Old commits are not rewritten automatically.

If you want to normalize historical commit messages too, rewrite history in a
separate branch first, then force-push with coordination. A safe workflow is:

1. Create a backup branch.
2. Rewrite commit messages with interactive rebase or `git filter-repo`.
3. Verify `git log --oneline`.
4. Force-push with `--force-with-lease`.
