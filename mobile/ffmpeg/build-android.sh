#!/usr/bin/env bash
# Analyser - build the FFmpeg executable the Android app runs.
#
# Output:  mobile/ffmpeg/out/arm64-v8a/ffmpeg
# The next `node mobile/tools/stage-web.mjs` (mobile.bat, `npm run sync`)
# copies it to android/app/src/main/jniLibs/arm64-v8a/libanrffmpeg.so, where
# AnrFfmpeg.java finds it. Without it the app uses ffmpeg.wasm, as the website.
#
# What it builds, and why:
#  - FFmpeg, LGPL. No --enable-gpl, so no libx264 or libx265: a GPL encoder
#    would make the whole app GPL (research/CAPACITOR-PLAN.md, "Licensing").
#  - MediaCodec (--enable-mediacodec --enable-jni): the chipset's own H.264 and
#    HEVC encoders. The app runs ffmpeg as a CHILD PROCESS, which has no JVM,
#    and FFmpeg then uses the NDK's AMediaCodec by itself.
#  - openh264 as the software H.264 encoder, for a job the chipset refuses
#    (softwareFallback() in desktop/ffmpeg-accel.mjs retries with it).
#  - Hardened: only the file and pipe protocols, no network, and no capture
#    devices except lavfi (the encoder probe needs it). AnrFfmpegChecks refuses
#    those arguments anyway - this way the binary cannot be talked into them
#    even if a check were missed.
#  - One executable, FFmpeg's own libraries linked in statically, and ELF
#    segments aligned to 16 KB, which Google Play requires for native code.
#
# Needs: Linux, macOS or WSL; the Android NDK r26 or newer; curl, tar, xz, make,
# pkg-config, meson and ninja (for openh264). Not Git Bash on Windows: FFmpeg's
# Makefiles need an MSYS-aware make, and the NDK's make.exe is not one.
#
#   ANDROID_NDK_HOME=/path/to/ndk mobile/ffmpeg/build-android.sh
#
# On Windows without WSL, run the "Build Android FFmpeg" workflow from the
# repository's Actions tab instead (.github/workflows/android-ffmpeg.yml) and
# unzip its artifact into mobile/ffmpeg/out/.
set -euo pipefail

FFMPEG_VERSION="${FFMPEG_VERSION:-9.0.1}"
OPENH264_VERSION="${OPENH264_VERSION:-2.6.0}"
API="${API:-24}"                      # the app's minSdk
ABI=arm64-v8a

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HERE/work"
PREFIX="$WORK/prefix"
OUT="$HERE/out/$ABI"
JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-${ANDROID_NDK_LATEST_HOME:-}}}"
if [ -z "$NDK" ]; then
  SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  [ -n "$SDK" ] && NDK="$(ls -d "$SDK"/ndk/* 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -d "$NDK" ] || { echo "build-android: set ANDROID_NDK_HOME to an NDK (r26 or newer)" >&2; exit 1; }

case "$(uname -s)" in
  Linux*) HOST=linux-x86_64 ;;
  Darwin*) HOST=darwin-x86_64 ;;
  *) echo "build-android: needs Linux, macOS or WSL - see the header" >&2; exit 1 ;;
esac
TC="$NDK/toolchains/llvm/prebuilt/$HOST"
CC="$TC/bin/aarch64-linux-android$API-clang"
CXX="$TC/bin/aarch64-linux-android$API-clang++"
[ -x "$CC" ] || { echo "build-android: no $CC - is this an NDK?" >&2; exit 1; }

# 16 KB alignment. NDK r28+ does this by default; r26/r27 need telling.
PAGE_LDFLAGS="-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384"

mkdir -p "$WORK" "$PREFIX" "$OUT"
cd "$WORK"

fetch() {   # url file
  [ -f "$2" ] || curl -fL --retry 3 -o "$2" "$1"
}

# ---- openh264 (static, via meson) -------------------------------------------

if [ ! -f "$PREFIX/lib/libopenh264.a" ]; then
  fetch "https://github.com/cisco/openh264/archive/refs/tags/v$OPENH264_VERSION.tar.gz" "openh264-$OPENH264_VERSION.tar.gz"
  rm -rf "openh264-$OPENH264_VERSION"
  tar xzf "openh264-$OPENH264_VERSION.tar.gz"
  cat > android-arm64.ini <<EOF
[binaries]
c = '$CC'
cpp = '$CXX'
ar = '$TC/bin/llvm-ar'
strip = '$TC/bin/llvm-strip'

[host_machine]
system = 'android'
cpu_family = 'aarch64'
cpu = 'armv8'
endian = 'little'
EOF
  meson setup "openh264-build" "openh264-$OPENH264_VERSION" \
    --cross-file android-arm64.ini --prefix "$PREFIX" --libdir lib \
    --buildtype release -Ddefault_library=static -Dtests=disabled
  ninja -C openh264-build install
fi

# openh264 is C++. meson's .pc names libstdc++, which the NDK does not have;
# the NDK's static C++ runtime is libc++_static + libc++abi.
PC="$PREFIX/lib/pkgconfig/openh264.pc"
sed -i.bak -e 's/-lstdc++/-lc++_static -lc++abi/g' "$PC"
grep -q 'c++_static' "$PC" || sed -i.bak -e 's/^\(Libs:.*\)$/\1 -lc++_static -lc++abi/' "$PC"

# ---- FFmpeg -------------------------------------------------------------------

fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "ffmpeg-$FFMPEG_VERSION.tar.xz"
rm -rf "ffmpeg-$FFMPEG_VERSION" ffmpeg-build
tar xJf "ffmpeg-$FFMPEG_VERSION.tar.xz"
mkdir ffmpeg-build
cd ffmpeg-build

PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig" \
"../ffmpeg-$FFMPEG_VERSION/configure" \
  --prefix="$PREFIX" \
  --target-os=android --arch=aarch64 --cpu=armv8-a --enable-cross-compile \
  --cc="$CC" --cxx="$CXX" \
  --ar="$TC/bin/llvm-ar" --nm="$TC/bin/llvm-nm" --ranlib="$TC/bin/llvm-ranlib" --strip="$TC/bin/llvm-strip" \
  --sysroot="$TC/sysroot" \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --enable-static --disable-shared --enable-pic \
  --disable-doc --disable-debug \
  --disable-programs --enable-ffmpeg \
  --disable-network --disable-protocols --enable-protocol=file --enable-protocol=pipe \
  --disable-devices --enable-indev=lavfi \
  --enable-jni --enable-mediacodec \
  --enable-libopenh264 \
  --extra-ldflags="$PAGE_LDFLAGS" \
  --extra-libs="-lc++_static -lc++abi -lm"

make -j"$JOBS"
make install

cp "$PREFIX/bin/ffmpeg" "$OUT/ffmpeg"
"$TC/bin/llvm-strip" "$OUT/ffmpeg"

echo
echo "build-android: $OUT/ffmpeg ($(du -h "$OUT/ffmpeg" | cut -f1))"
echo "  LOAD segment alignment (Play needs 0x4000):"
"$TC/bin/llvm-readelf" -l "$OUT/ffmpeg" | awk '/LOAD/ { print "   ", $NF }'
echo "  hardware encoders in the build:"
strings "$OUT/ffmpeg" | grep -E '^(h264|hevc|av1)_mediacodec$' | sort -u | sed 's/^/    /' || true
echo
echo "Next: node mobile/tools/stage-web.mjs  (or mobile.bat) copies it into the app."
