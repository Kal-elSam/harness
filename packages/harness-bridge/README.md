# @kal-elsam/harness (compatibility bridge)

`@kal-elsam/harness` is now a **compatibility bridge** to
[`@kal-elsam/kairo-runtime`](https://www.npmjs.com/package/@kal-elsam/kairo-runtime).

Kairo Runtime is the official product. This package keeps legacy installs and
scripts working while making the migration path explicit.

## What it does

- Preserves legacy bins: `harness`, `agentic-harness`, `sgs-harness`, `harness-sgs`
- Prints a migration warning on **stderr** on every invocation
- Delegates all behavior to `@kal-elsam/kairo-runtime`
- Does **not** change local state paths: `~/.harness`, `HARNESS_HOME`, or
  `harness:managed:*` markers stay the same

## Migrate

Prefer the new package and CLI:

```bash
npx @kal-elsam/kairo-runtime
npm i -g @kal-elsam/kairo-runtime
kairo status
```

Legacy commands still work but show a warning:

```bash
npx @kal-elsam/harness status
harness sync
```

## Publishing

Bridge releases use package-aware git tags:

```bash
git tag harness-bridge-v0.30.0
git push origin harness-bridge-v0.30.0
```

Verify after publish:

```bash
npm run release:published -- \
  --package @kal-elsam/harness \
  --tag harness-bridge-v0.30.0 \
  --version 0.30.0
```

## Deprecation (optional, post-bridge)

After the bridge is live, older harness package versions can be deprecated:

```bash
npm deprecate @kal-elsam/harness@"<0.30.0" "Renamed to @kal-elsam/kairo-runtime"
```
