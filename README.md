# Credential Ecosystem Backend

Backend for the academic credential verification system (Express, Prisma, PostgreSQL, Polygon Amoy).

## Deployment: `dist/` is committed

Vercel serves the committed `dist/` folder and does not compile TypeScript. Every change in `src/` must be
followed by `npm run build`, and `dist/` must be committed together with `src/`.

### Pre-commit hook

`.githooks/pre-commit` enforces this. On every `git commit` it:

1. runs `npm run build`,
2. aborts the commit if the build fails,
3. runs `git add dist` so the rebuilt output goes into the same commit.

The hook builds from the working tree, so unstaged `src/` edits also end up in the committed `dist/`.

The hook file is versioned, but the setting that makes Git use it (`core.hooksPath`) lives in `.git/config`,
which is not. **After cloning, enable it once** with either:

```sh
npm install                              # the "prepare" script sets core.hooksPath
# or
git config core.hooksPath .githooks
```

Check with `git config core.hooksPath` (should print `.githooks`). It is a plain `sh` script and works with
Git for Windows; `.gitattributes` keeps it on LF line endings.
