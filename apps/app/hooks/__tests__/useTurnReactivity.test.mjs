// Drift-guards for the `useTurn` reactive-query wiring + retry path.
//
// The reactive read loop depends on three load-bearing facts in
// `apps/app/hooks/useTurn.ts`:
//
//   1. The hook imports `useQuery` from `convex/react`. Without that
//      import the WS subscription path can't be wired and the reader
//      falls back to polling-only (works, but no real-time updates).
//
//   2. The hook calls `useQuery(api.game.getCurrentScene, ...)` at the
//      TOP LEVEL of the function body — i.e. not inside another hook or
//      callback. Rules of hooks require unconditional, in-order calls.
//      A future refactor that pushes this into a useEffect or a
//      conditional would silently drop reactivity on every render.
//
//   3. The hook exports `retryCurrentTurn` on the object returned from
//      `useTurn`. The FallbackTurnPanel client component (owned by a
//      sibling agent) calls this on its "Try again" button when the
//      deterministic-fallback sentinel fires.
//
// These greps are deliberately source-level rather than runtime: mounting
// `useTurn` requires the full RN + Convex test harness, which the rest of
// the hooks/__tests__ directory avoids (see streamLock.test.ts).
//
// Run:
//   node --test apps/app/hooks/__tests__/useTurnReactivity.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = resolve(here, "../useTurn.ts");
const source = readFileSync(hookPath, "utf8");

test("useTurn imports useQuery from convex/react", () => {
  // The WS subscription path opens through `useQuery`; without this
  // import the hook can't subscribe and the reactive read loop regresses
  // to HTTP polling only.
  const importLines = source
    .split("\n")
    .filter((line) => line.startsWith("import"))
    .join("\n");
  assert.ok(
    /from\s+["']convex\/react["']/.test(importLines),
    "useTurn must import from 'convex/react' for WS subscription support",
  );
  assert.ok(
    /\buseQuery\b/.test(importLines),
    "useTurn must import the `useQuery` named export from convex/react",
  );
});

test("useTurn calls useQuery(api.game.getCurrentScene, ...) at top level", () => {
  // The call must reference the generated api binding so Convex can
  // properly type / dispatch the subscription. Rules of hooks require
  // it to be unconditional at the top of the function body — we enforce
  // a positional invariant: the useQuery call must appear BEFORE the
  // first useCallback in the file. The hook's structure puts all top-
  // level subscriptions and effects at the head of the function body
  // and only later defines submitChoice / submitFreeformChoice / retry
  // as useCallback. A refactor that pushed the subscription into one of
  // those callbacks (illegal under rules of hooks) would invert that
  // order and trip this check.
  const queryIdx = source.search(/useQuery\s*\(\s*api\.game\.getCurrentScene[\s,]/);
  assert.ok(
    queryIdx >= 0,
    "useTurn must call useQuery(api.game.getCurrentScene, ...) — reactive subscription wiring missing",
  );

  const firstCallbackIdx = source.search(/\buseCallback\s*\(/);
  assert.ok(
    firstCallbackIdx >= 0,
    "expected at least one useCallback in useTurn (submitChoice et al.)",
  );
  assert.ok(
    queryIdx < firstCallbackIdx,
    "useQuery(api.game.getCurrentScene) must appear before the first useCallback — " +
      "burying the subscription inside a callback would defeat reactivity.",
  );
});

test("useTurn returns retryCurrentTurn on its public API", () => {
  // The FallbackTurnPanel component invokes this on its retry button
  // when the server-side deterministic-fallback sentinel fires. The
  // callback must be returned from the hook AND included in the useMemo
  // deps so a stale closure doesn't keep pointing at an old saveId.
  assert.ok(
    /const\s+retryCurrentTurn\s*=\s*useCallback\(/.test(source),
    "useTurn must define `retryCurrentTurn` as a useCallback",
  );
  // The return value object literal must include retryCurrentTurn.
  // We grep for the property in the return object.
  assert.ok(
    /return\s+useMemo\([\s\S]*?retryCurrentTurn,[\s\S]*?\)/.test(source),
    "useTurn's useMemo return object must include `retryCurrentTurn`",
  );
  // ...and the dependency array must include it so React keeps the
  // memoized object fresh whenever the callback identity changes.
  // Find the deps array of the final useMemo and assert membership.
  const memoMatch = source.match(/return\s+useMemo\(\s*\(\)\s*=>\s*\(\{[\s\S]*?\}\),\s*\[([\s\S]*?)\],?\s*\);/);
  assert.ok(memoMatch, "could not locate the final useMemo deps array");
  assert.ok(
    /\bretryCurrentTurn\b/.test(memoMatch[1]),
    "useTurn final useMemo deps must include retryCurrentTurn",
  );
});

test("retryCurrentTurn guards against local-demo saves + acquires the stream lock", () => {
  // Drift-guard the safety rails inside the retry method:
  //   - bails when `isLocalDemoSave` is true (no remote scene exists)
  //   - bails when there's no remote game API configured
  //   - acquires the per-save SSE lock before opening a new stream
  //   - releases the lock in a `finally` so a transient failure doesn't
  //     wedge a save in a "permanently locked" state
  const retryBlockMatch = source.match(
    /const\s+retryCurrentTurn\s*=\s*useCallback\(async\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\},\s*\[/,
  );
  assert.ok(retryBlockMatch, "could not extract retryCurrentTurn body");
  const body = retryBlockMatch[1];

  assert.ok(
    /isLocalDemoSave\s*\(\s*saveId\s*\)/.test(body),
    "retryCurrentTurn must bail when isLocalDemoSave(saveId)",
  );
  assert.ok(
    /hasRemoteGameApi\s*\(\s*\)/.test(body),
    "retryCurrentTurn must bail when hasRemoteGameApi() is false",
  );
  assert.ok(
    /streamLockRef\.current\.acquire\(\s*saveId\s*\)/.test(body),
    "retryCurrentTurn must call streamLockRef.current.acquire(saveId)",
  );
  assert.ok(
    /finally\s*\{[\s\S]*?streamLockRef\.current\.release\(\s*saveId\s*\)/.test(body),
    "retryCurrentTurn must release the stream lock in a finally block",
  );
});
