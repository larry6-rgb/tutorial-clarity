// Runs once when the server process boots (local `next dev`/`next start` and
// on Railway). Several routes shell out directly to external binaries
// (yt-dlp, ffmpeg) that Node/npm don't manage — those can be present on a
// dev machine and silently absent in the deployed container, so a feature
// can pass every local test and only fail the first time a real user clicks
// it in production. This logs a loud, immediate pass/fail for each such
// binary right in the deploy logs, instead of that gap staying invisible
// until someone stumbles onto it manually.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkSystemDependencies } = await import('./instrumentation-node');
    checkSystemDependencies();
  }
}
