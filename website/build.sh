#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
DIST_DIR="$SCRIPT_DIR/dist"

echo "🔨 Starting build for Zalo-Flow Website (Cloudflare Pages)..."

mkdir -p "$DIST_DIR/blog" "$DIST_DIR/assets"

cp -f "$SRC_DIR/index.html" "$DIST_DIR/index.html"
cp -f "$SRC_DIR/404.html" "$DIST_DIR/404.html"
cp -f "$SRC_DIR/style.css" "$DIST_DIR/style.css"

cp -rf "$SRC_DIR/blog/"* "$DIST_DIR/blog/"
cp -rf "$SRC_DIR/assets/"* "$DIST_DIR/assets/"

TOTAL_FILES=$(find "$DIST_DIR" -type f | wc -l)
echo "✅ Build completed successfully! Total $TOTAL_FILES files in dist/"
echo "🚀 Ready for deployment via: npx wrangler pages deploy website/dist --project-name aizalo-portal"
