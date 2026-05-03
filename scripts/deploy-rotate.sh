#!/usr/bin/env bash
set -euo pipefail

# Generate a fresh 4-char brand prefix for this deploy.
# Format: _<3 random lowercase alphanumeric chars>
NEW_BRAND="_$(tr -dc 'a-z0-9' </dev/urandom | head -c3)"
echo "Deploying with STUDYBOARD_BRAND=$NEW_BRAND"

# Update fly.toml [env] section
if grep -q 'STUDYBOARD_BRAND' fly.toml; then
    sed -i.bak -E "s/^  STUDYBOARD_BRAND = .*/  STUDYBOARD_BRAND = \"$NEW_BRAND\"/" fly.toml
    rm -f fly.toml.bak
else
    sed -i.bak '/^\[env\]/a\
  STUDYBOARD_BRAND = "'"$NEW_BRAND"'"
' fly.toml
    rm -f fly.toml.bak
fi

echo "fly.toml updated. Deploying..."
fly deploy --remote-only "$@"
echo "Deploy complete with brand: $NEW_BRAND"
