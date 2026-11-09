#!/usr/bin/env bash
# Runs INSIDE the build container (tools/ffmpeg/build_ffmpeg.py starts it). /src holds the verified source archives (read-only),
# /out receives the result. Two FFmpeg trees are produced from the same FFmpeg source:
#   main/      LGPL FFmpeg: Intel oneVPL (QSV) + Media Foundation + D3D11VA/DXVA2, libvpx (VP8/VP9), dav1d (AV1 decode),
#              SVT-AV1 (AV1 encode), Opus, native AAC/MJPEG/PNG. Everything the worker and renderer use.
#   openh264/  a minimal FFmpeg that can only encode H.264 with OpenH264. It is separate because it needs openh264.dll at load time;
#              that DLL must be Cisco's own binary (Cisco pays the H.264 royalties only for its binary), dropped in by the operator.
# No --enable-gpl, no --enable-nonfree, no --enable-version3: the result is LGPL-2.1-or-later, checked after the build.
set -euo pipefail
HOST=x86_64-w64-mingw32
PREFIX=/opt/win
JOBS=$(nproc)
export PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig
mkdir -p $PREFIX /work && cd /work
x() { mkdir -p "$1" && tar -xf "/src/$2" -C "$1" --strip-components=1; }

cat > /work/toolchain.cmake <<EOF
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER $HOST-gcc-posix)
set(CMAKE_CXX_COMPILER $HOST-g++-posix)
set(CMAKE_RC_COMPILER $HOST-windres)
set(CMAKE_ASM_NASM_COMPILER nasm)
set(CMAKE_FIND_ROOT_PATH /usr/$HOST $PREFIX)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
EOF
cat > /work/cross.meson <<EOF
[binaries]
c = '$HOST-gcc-posix'
cpp = '$HOST-g++-posix'
ar = '$HOST-ar'
strip = '$HOST-strip'
windres = '$HOST-windres'
pkg-config = 'pkg-config'
[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
EOF
CM="-G Ninja -DCMAKE_TOOLCHAIN_FILE=/work/toolchain.cmake -DCMAKE_INSTALL_PREFIX=$PREFIX -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF"

echo "== libvpl (MIT): oneVPL dispatcher for Intel Quick Sync"
x libvpl libvpl-2.14.0.tar.gz
cmake -S libvpl -B libvpl/b $CM -DBUILD_TOOLS=OFF -DBUILD_EXAMPLES=OFF -DINSTALL_EXAMPLES=OFF -DBUILD_TESTS=OFF -DINSTALL_DEV=ON && cmake --build libvpl/b -j$JOBS && cmake --install libvpl/b

echo "== libvpx (BSD-3): VP8/VP9"
x libvpx libvpx-1.15.0.tar.gz
(cd libvpx && CROSS=$HOST- ./configure --target=x86_64-win64-gcc --prefix=$PREFIX --disable-examples --disable-tools --disable-docs \
   --disable-unit-tests --enable-vp9-highbitdepth --enable-static --disable-shared && make -j$JOBS && make install)

echo "== dav1d (BSD-2): AV1 decoding"
x dav1d dav1d-1.5.1.tar.gz
meson setup dav1d/b dav1d --cross-file /work/cross.meson --prefix=$PREFIX --libdir=lib --buildtype=release -Ddefault_library=static \
   -Denable_tools=false -Denable_tests=false && ninja -C dav1d/b install

echo "== Opus (BSD-3)"
x opus opus-1.5.2.tar.gz
(cd opus && CFLAGS="-O2 -D_FORTIFY_SOURCE=0" ./configure --host=$HOST CC=$HOST-gcc-posix --prefix=$PREFIX --enable-static --disable-shared \
   --disable-doc --disable-extra-programs && make -j$JOBS && make install)

echo "== SVT-AV1 (BSD-3-Clause-Clear + AOMedia patent licence): AV1 encoding"
x svtav1 SVT-AV1-v2.3.0.tar.gz
cmake -S svtav1 -B svtav1/b $CM -DBUILD_APPS=OFF -DBUILD_DEC=OFF -DBUILD_TESTING=OFF && cmake --build svtav1/b -j$JOBS && cmake --install svtav1/b

echo "== OpenH264 (BSD-2) headers + import library only; the DLL used at run time must be Cisco's binary"
x openh264 openh264-2.5.0.tar.gz
(cd openh264 && make -j$JOBS OS=mingw_nt ARCH=x86_64 CC=$HOST-gcc-posix CXX=$HOST-g++-posix AR=$HOST-ar PREFIX=$PREFIX install-shared)

FF_COMMON="--arch=x86_64 --target-os=mingw32 --cross-prefix=$HOST- --cc=$HOST-gcc-posix --cxx=$HOST-g++-posix --pkg-config=pkg-config
  --pkg-config-flags=--static --enable-shared --disable-static --disable-doc --disable-debug --disable-autodetect --enable-w32threads
  --extra-cflags=-I$PREFIX/include --extra-ldflags=-L$PREFIX/lib --extra-ldflags=-static-libgcc --extra-ldflags=-static-libstdc++"

echo "== FFmpeg 7.1.1 (LGPL-2.1+): main tree"
x ffmpeg ffmpeg-7.1.1.tar.xz
mkdir -p ffmpeg/b-main && (cd ffmpeg/b-main && ../configure $FF_COMMON --prefix=/out/main \
   --enable-zlib --enable-libvpl --enable-mediafoundation --enable-d3d11va --enable-dxva2 \
   --enable-libvpx --enable-libdav1d --enable-libopus --enable-libsvtav1 \
   --extra-libs=-lstdc++ && make -j$JOBS && make install)

echo "== FFmpeg 7.1.1 (LGPL-2.1+): OpenH264-only tree"
mkdir -p ffmpeg/b-oh && (cd ffmpeg/b-oh && ../configure $FF_COMMON --prefix=/out/openh264 --disable-everything --disable-network \
   --enable-libopenh264 --enable-encoder=libopenh264 --enable-protocol=file,pipe --enable-demuxer=rawvideo,yuv4mpegpipe \
   --enable-decoder=rawvideo --enable-muxer=mp4 --enable-filter=scale,format,null,setpts --enable-swscale \
   && make -j$JOBS && make install)
# the self-built openh264 DLL is NOT copied: only Cisco's binary may be placed next to this tree

echo "== runtime DLLs of the toolchain: winpthreads (MIT/BSD), zlib (zlib), libstdc++/libgcc (GPL-3 WITH GCC Runtime Library Exception)"
find_dll() { find /usr/$HOST /usr/lib/gcc/$HOST -name "$1" 2>/dev/null | grep -v "/32/" | sort | grep -m1 posix || find /usr/$HOST /usr/lib/gcc/$HOST -name "$1" | grep -m1 .; }
for d in main openh264; do
  for dll in libwinpthread-1.dll zlib1.dll libstdc++-6.dll libgcc_s_seh-1.dll; do p=$(find_dll $dll || true); [ -n "$p" ] && cp "$p" /out/$d/bin/; done
done
# every DLL an executable imports must be in bin/ or be a Windows system DLL
for f in /out/*/bin/*.exe /out/*/bin/*.dll; do
  for imp in $($HOST-objdump -p "$f" | awk '/DLL Name/{print $3}'); do
    case "${imp,,}" in kernel32.dll|msvcrt.dll|advapi32.dll|ole32.dll|oleaut32.dll|user32.dll|gdi32.dll|shell32.dll|shlwapi.dll|ws2_32.dll|bcrypt.dll|avicap32.dll|mfplat.dll|mfuuid.dll|strmiids.dll|d3d11.dll|dxgi.dll|mf.dll|secur32.dll|crypt32.dll|psapi.dll|libopenh264.dll) ;;
      *) [ -f "$(dirname $f)/$imp" ] || { echo "missing $imp needed by $f"; exit 3; } ;;
    esac
  done
done

echo "== licence of the result"
grep -h "^#define FFMPEG_LICENSE" ffmpeg/b-main/config.h ffmpeg/b-oh/config.h
grep -h "^#define FFMPEG_CONFIGURATION" ffmpeg/b-main/config.h > /out/main/CONFIGURATION.txt
grep -h "^#define FFMPEG_CONFIGURATION" ffmpeg/b-oh/config.h > /out/openh264/CONFIGURATION.txt
if grep -qE "enable-gpl|enable-nonfree|enable-version3" /out/main/CONFIGURATION.txt /out/openh264/CONFIGURATION.txt; then echo "GPL/nonfree flag found"; exit 2; fi
grep -q 'LGPL version 2.1 or later' ffmpeg/b-main/config.h && grep -q 'LGPL version 2.1 or later' ffmpeg/b-oh/config.h
echo BUILD_OK
