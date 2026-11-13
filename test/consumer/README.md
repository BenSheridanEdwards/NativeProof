Run `npm run test:consumer` after `npm ci`. The harness builds and packs the
current checkout, records its SHA and tarball SHA256 in consumer-results, and
installs into a fresh OS temporary directory with its own manifest, cache and
prefix and NODE_PATH removed. No producer node_modules is linked.

This proves CLI help, iOS scaffolding, APK onboarding and public declaration
imports work after installation. Two mutated packages prove missing tsx and
missing onboarding entry failures are detected by their specific diagnostics.
Registry/network failures are UNAVAILABLE and fail the run. Logs are retained
as CI artifacts; temporary consumers are removed even on failure.

This does not exercise Appium, device connections or application behaviour.
Dependency lifecycle scripts are disabled during installation: this checks the
packed JavaScript and types, not dependency setup hooks or driver downloads.
