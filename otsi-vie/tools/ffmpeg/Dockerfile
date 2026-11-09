# Reproducible LGPL FFmpeg for Windows x64, cross-compiled with mingw-w64 (ADR-029). No GPL, no nonfree component.
# Sources are fetched by build.sh and verified against sources.lock.json (SHA-256) before use.
ARG BASE=ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
FROM ${BASE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils bzip2 gcc libc6-dev make cmake meson ninja-build nasm yasm pkg-config python3 git \
      gcc-mingw-w64-x86-64-posix g++-mingw-w64-x86-64-posix mingw-w64-tools libz-mingw-w64-dev \
    && rm -rf /var/lib/apt/lists/*
COPY build.sh /build/
WORKDIR /build
