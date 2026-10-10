// Runs on every `npm install` (the "prepare" script), including on Vercel, so it must never fail:
// it points Git at .githooks when this is a Git checkout and silently does nothing otherwise.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  if (fs.existsSync(path.join(__dirname, '..', '.git'))) {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'ignore'
    });
  }
} catch {
  // No git, or not a usable repository: the hook is a local convenience, not a build requirement.
}
