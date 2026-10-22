#!/usr/bin/env bash
# Publish a JS-only OTA bundle for the live Play version (docs/play-launch-backlog.md, "OTA plan").
# Run on release/X.Y, branched from tag vX.Y.Z with the fix cherry-picked, in its own worktree
# (it reinstalls node_modules from the release lock):
#   git worktree add ../glide-ota release/X.Y && ../glide-ota/scripts/ota.sh "Fix subtitle sync on long films"
# Publishes and tags ota/X.Y.Z.N; promoting to users is a separate, printed step.
# STALLION_PROJECT_ID is in .env; STALLION_CI_TOKEN is in the Desktop secrets backup.
set -euo pipefail
cd "$(dirname "$0")/.."

note=${1:?usage: scripts/ota.sh "release note"}
ver=$(node -p "require('./package.json').version")
key=${STALLION_PRIVATE_KEY:-$HOME/Desktop/Glide-secrets/stallion-keys/private-key.pem}
die() { echo "ota: $*" >&2; exit 1; }

git rev-parse -q --verify "refs/tags/v$ver" >/dev/null || die "no tag v$ver"
git diff --quiet HEAD || die "uncommitted changes would go into the bundle"
# The live app only has v$ver's native code; .env is native too (BuildConfig), so it can't ship here.
native=$(git diff --name-only "v$ver" HEAD -- android libs package.json package-lock.json app.json react-native.config.js)
[ -z "$native" ] || die "native changes since v$ver, needs a Play release:"$'\n'"$native"
[ -f "$key" ] || die "no private key at $key"

# The bundle is built from node_modules, so it must match the live version's lock, not main's.
npm ci
npx tsc --noEmit
npx jest --silent

out=$(mktemp)
npx stallion publish-bundle --upload-path glide-media-player/glide-media-player/glide-media-player-bucket \
  --platform android --release-note "$note" --private-key "$key" \
  ${STALLION_CI_TOKEN:+--ci-token "$STALLION_CI_TOKEN"} | tee "$out"
hash=$(sed -n 's/.*Published bundle hash: *\([0-9a-fA-F]*\).*/\1/p' "$out" | tail -1)
rm -f "$out"
[ -n "$hash" ] || die "publish failed (no bundle hash printed)"

n=$(( $(git tag -l "ota/$ver.*" | wc -l) + 1 ))
git tag -a "ota/$ver.$n" -m "$note" -m "Stallion bundle $hash"
git push origin "ota/$ver.$n"

echo
echo "Published ota/$ver.$n ($hash). Release to v$ver only, small rollout first:"
echo "  npx stallion release-bundle --project-id \"\$STALLION_PROJECT_ID\" --ci-token \"\$STALLION_CI_TOKEN\" \\"
echo "    --hash $hash --app-version $ver --release-note \"$note\""
echo "A new release starts at 0% rollout; raise it (10, then 100):"
echo "  npx stallion update-release --project-id \"\$STALLION_PROJECT_ID\" --ci-token \"\$STALLION_CI_TOKEN\" \\"
echo "    --hash $hash --rollout-percent 10"
