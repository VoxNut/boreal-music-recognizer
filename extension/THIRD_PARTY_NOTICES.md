# Boreal third-party notices

## SongRec

The Rust files in `fingerprint/src/fingerprinting/` are adapted from:

- Project: https://github.com/marin-m/SongRec
- Revision: `87686d2be12856fd582f37d7364aba8784062e19`
- Copyright: Marin Moulinier and SongRec contributors
- License: GNU General Public License, version 3 or later
- Original files: `src/core/fingerprinting/{algorithm,hanning,signature_format}.rs`

Changes: removed native file decoding, FFmpeg/Rodio integration, and native decoder tests; replaced Rodio's float-to-PCM conversion with equivalent clamped arithmetic; moved large FFT buffers to heap slices to fit small stacks; adjusted module paths; removed gettext calls; compiled signature decoding only for tests; formatted the adapted files. The fingerprint extraction and binary encoding algorithm are retained.

The Boreal wrapper caps the analyzed window at the final 12 seconds when listening for 15 seconds, because the unofficial service rejected longer signatures during live validation.

Boreal is also licensed GPL-3.0-or-later. Full corresponding source, Cargo.lock, build scripts, and instructions are provided at https://github.com/VoxNut/boreal-music-recognizer. This package includes the GPL text in LICENSE.txt.

## Rust dependencies

The WebAssembly binary contains these crates and their transitive dependencies, as pinned in `fingerprint/Cargo.lock`:

- `rustfft`, `transpose`, `primal-check`, `strength_reduce`: MIT OR Apache-2.0
- `realfft`: MIT
- `base64`: MIT OR Apache-2.0
- `byteorder`: Unlicense OR MIT
- `crc32fast`: MIT OR Apache-2.0
- `num-traits`, `num-integer`, `num-complex`: MIT OR Apache-2.0
- `wasm-bindgen`, its macro crates, and `once_cell`: MIT OR Apache-2.0
- `cfg-if`: MIT OR Apache-2.0
- `bumpalo`: MIT OR Apache-2.0
- `proc-macro2`, `quote`, `syn`: MIT OR Apache-2.0
- `autocfg`, `rustversion`: MIT OR Apache-2.0
- `unicode-ident`: MIT OR Apache-2.0 AND Unicode-3.0

Individual package licenses and copyright notices are distributed in `licenses/`. The Rust standard library and compiler runtime are distributed under their upstream MIT/Apache licenses. Build-time crates do not all contribute runtime code.

## Other credits

The default colors are inspired by Nord: https://www.nordtheme.com/. System fonts and original, locally generated waveform icons are used. No Nord artwork, remote font, external script, or recognition-service branding is bundled.

Recognition and artwork services are operated by Shazam/Apple. Boreal is an independent unofficial client.
