import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', "Compress-Archive -Path extension/* -DestinationPath dist/boreal-1.0.0.zip -Force"], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '../dist/boreal-1.0.0.zip', '.'], { cwd: 'extension', stdio: 'inherit' });
}
console.log('Packaged dist/boreal-1.0.0.zip');
