#!/usr/bin/env bash
# Download the CEF binary distribution Sift is built against into
# third_party/cef. Usage: scripts/fetch-cef.sh [platform]
#   platform: linux64 (default on Linux), linuxarm64, macosx64, macosarm64, windows64
set -euo pipefail

CEF_VERSION="156.0.14+g4fa4ab5+chromium-156.0.8078.48"

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/third_party/cef"

platform="${1:-}"
if [[ -z "$platform" ]]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) platform=linux64 ;;
    Linux-aarch64) platform=linuxarm64 ;;
    Darwin-arm64) platform=macosarm64 ;;
    Darwin-x86_64) platform=macosx64 ;;
    MINGW*|MSYS*|CYGWIN*) platform=windows64 ;;
    *) echo "Unknown platform; pass one of linux64, linuxarm64, macosx64, macosarm64, windows64" >&2; exit 1 ;;
  esac
fi

name="cef_binary_${CEF_VERSION}_${platform}_minimal"
url="https://cef-builds.spotifycdn.com/${name//+/%2B}.tar.bz2"

if [[ -f "$dest/cmake/FindCEF.cmake" ]]; then
  echo "CEF already present at $dest"
  exit 0
fi

mkdir -p "$root/third_party"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $name (about 330 MB)…"
curl -fL --progress-bar -o "$tmp/cef.tar.bz2" "$url"
echo "Extracting…"
tar -xjf "$tmp/cef.tar.bz2" -C "$tmp"
rm -rf "$dest"
mv "$tmp/$name" "$dest"
echo "CEF ready at $dest"
