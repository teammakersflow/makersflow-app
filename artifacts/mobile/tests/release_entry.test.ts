// Release build: entry-file resolution for expo-updates (2026-11-12).
//
// metro.config.js pins Metro's server root to this app (L-6). expo-updates'
// :app:create*UpdatesResources step makes the entry path relative to
// @expo/config's getMetroServerRoot(), then resolves it against the app dir.
// Without EXPO_NO_METRO_WORKSPACE_ROOT=1, @expo/config picks the monorepo root,
// and the relative path ("node_modules/expo-router/entry.js") does not exist
// under the app dir. The signed release build failed with "The resource
// ...artifacts/mobile/node_modules/expo-router/entry.js was not found".
//
// Run: node --test artifacts/mobile/tests/release_entry.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");

function relativeEntry(env: NodeJS.ProcessEnv): string {
  const script =
    "const p=require(require.resolve('@expo/config/paths',{paths:[require.resolve('expo/package.json')]}));" +
    "process.stdout.write(p.resolveRelativeEntryPoint(process.argv[1],{platform:'android'}))";
  return execFileSync(process.execPath, ["-e", script, appDir], { cwd: appDir, env }).toString();
}

describe("release entry resolution (expo-updates resources)", () => {
  it("metro.config.js pins the server root to the app directory", () => {
    const src = fs.readFileSync(path.join(appDir, "metro.config.js"), "utf8");
    assert.match(src, /unstable_serverRoot:\s*__dirname/);
  });

  it("reproduces the failure: without the flag the relative entry is missing under the app dir", () => {
    const env = { ...process.env };
    delete env.EXPO_NO_METRO_WORKSPACE_ROOT;
    const rel = relativeEntry(env);
    // Holds only while expo-router is hoisted to the root (this workspace's layout).
    if (!fs.existsSync(path.join(appDir, "node_modules", "expo-router"))) {
      assert.equal(fs.existsSync(path.join(appDir, rel)), false, `unexpectedly resolvable: ${rel}`);
    }
  });

  it("with EXPO_NO_METRO_WORKSPACE_ROOT=1 the relative entry resolves to expo-router/entry.js under the server root", () => {
    const rel = relativeEntry({ ...process.env, EXPO_NO_METRO_WORKSPACE_ROOT: "1" });
    const abs = path.join(appDir, rel);
    assert.ok(fs.existsSync(abs), `entry not found: ${abs}`);
    assert.match(abs.replace(/\\/g, "/"), /node_modules\/expo-router\/entry\.js$/);
  });
});
