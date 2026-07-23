import { execSync } from 'node:child_process';

// Actual check logic, kept in its own file (rather than inline in
// instrumentation.ts) so Next's edge-runtime bundle never has to resolve
// `node:child_process` at all — it's only ever imported from the
// nodejs-runtime branch in instrumentation.ts.
export function checkSystemDependencies() {
  const checks: { name: string; cmd: string }[] = [
    { name: 'yt-dlp', cmd: 'yt-dlp --version' },
    { name: 'ffmpeg', cmd: 'ffmpeg -version' },
  ];

  console.log('\n[startup-check] Verifying external binaries this app depends on...');
  for (const { name, cmd } of checks) {
    try {
      const out = execSync(cmd, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).split('\n')[0];
      console.log(`[startup-check] ✅ ${name} found: ${out}`);
    } catch (err: any) {
      const msg = err?.message?.split('\n')[0] || 'unknown error';
      console.error(
        `[startup-check] ❌ ${name} NOT FOUND on this server — any feature depending on it will fail at runtime, not at build time. (${msg})`
      );
    }
  }
  console.log('[startup-check] Done.\n');
}
