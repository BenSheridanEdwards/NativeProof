# Contributing

Thanks for your interest in contributing! Bug reports, feature requests,
documentation improvements, and code are all welcome.

## Licensing of contributions

This project is released under the MIT License (see the LICENSE file).

Unless you explicitly state otherwise, any contribution you intentionally
submit for inclusion in this project shall be licensed under the MIT
License, without any additional terms or conditions, and you confirm that
you have the right to submit it under that license.

## Local development

Requirements:

- Node.js 20.19+, 22.12+, or 24+ (see `engines` in `package.json`)
- macOS is required only for the iOS device/simulator lane

```bash
git clone https://github.com/BenSheridanEdwards/NativeProof.git
cd NativeProof
npm ci
npm run check
npm test
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run check` | Biome lint + TypeScript `--noEmit` |
| `npm test` | Device-free unit/integration suite (includes packed-tarball smoke) |
| `npm run build` | Emit `dist/` |
| `npm pack` | Build the publishable tarball consumers install |

Pre-commit runs `npm run check`. Pre-push runs `npm test`.

### Prove a generated-project / CLI change

Proof must come from the packed tarball, not a symlink into this checkout:

```bash
npm pack --pack-destination "$TMPDIR"
TARBALL="$TMPDIR"/nativeproof-*.tgz

mkdir /tmp/nativeproof-fresh && cd /tmp/nativeproof-fresh
npm exec --yes --package="$TARBALL" -- nativeproof init --ios
npm i -D "$TARBALL" --no-audit --no-fund
npx tsx --eval "import('./nativeproof.config.ts').then(() => console.log('config imports cleanly'))"
npx nativeproof --help
npx tsc --noEmit -p tsconfig.json
```

`npm test` already covers this path in `test/package-smoke.test.ts`.

### Device lane

On-device / simulator behaviour needs a booted target and is separate from the
default suite. See `.agents/skills/device-lane-proof/SKILL.md`.

## How to contribute

1. Fork the repository and create a branch from `main`.
2. Make your change, following the existing style and conventions.
3. Run `npm run check` and `npm test`.
4. Open a pull request describing what you changed and why (use the PR template).
