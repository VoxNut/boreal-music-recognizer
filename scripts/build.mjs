import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}
mkdirSync('extension/wasm', { recursive: true });
run('cargo', ['build', '--locked', '--manifest-path', 'fingerprint/Cargo.toml', '--target', 'wasm32-unknown-unknown', '--release']);
run('wasm-bindgen', ['fingerprint/target/wasm32-unknown-unknown/release/boreal_fingerprint.wasm', '--target', 'web', '--out-dir', 'extension/wasm', '--out-name', 'boreal', '--no-typescript']);
console.log('Ready: load the extension/ folder in Chrome or Edge.');
