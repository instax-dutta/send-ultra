const fs = require('fs');
const path = require('path');

/*
 * Each test file is required inside its own try/catch.
 *
 * Previously they were required in a bare loop, so a single file that threw at
 * module scope took every file after it down with it and the suite reported a
 * healthy-looking partial count. That is how a broken dependency in one file
 * went unnoticed while later files silently stopped running: the run said "8
 * passing" and looked green.
 *
 * A load failure is now recorded and the run still exits nonzero, so the file
 * that could not load is named rather than the tests after it quietly vanishing.
 */
function requireFile(f) {
  return `try { require('./tests/${f}'); } catch (err) {
    (window.__suiteLoadFailures = window.__suiteLoadFailures || []).push({
      file: '${f}', message: String(err && err.message || err)
    });
  }`;
}

module.exports = function() {
  const files = fs
    .readdirSync(path.join(__dirname, 'tests'))
    .filter(p => /\.js$/.test(p));
  const code =
    "require('fast-text-encoding');\n" + files.map(requireFile).join(';\n');
  return {
    code,
    dependencies: files.map(f => require.resolve('./tests/' + f)),
    cacheable: true
  };
};
