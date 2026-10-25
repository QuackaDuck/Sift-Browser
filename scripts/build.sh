#!/usr/bin/env bash
# Configure and build the Sift host. Output: build/Release (Linux/Windows)
# or build/Release/Sift.app (macOS).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
"$root/scripts/fetch-cef.sh"
cmake -S "$root/native" -B "$root/build" -DCMAKE_BUILD_TYPE=Release -DCEF_ROOT="$root/third_party/cef"
cmake --build "$root/build" --config Release --target sift -j
echo
echo "Built. Run: $root/build/Release/sift"
