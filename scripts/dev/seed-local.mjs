const target = process.env.CONVEX_DEPLOYMENT ?? process.env.EXPO_PUBLIC_CONVEX_URL ?? "local Convex dev deployment";

console.log("CYOA local seed placeholder");
console.log(`Target: ${target}`);
console.log("");
console.log("Seed command boundary:");
console.log("- Starter stories already live in packages/stories and are validated by package tests.");
console.log("- Convex data seeding should call explicit Convex mutations once the seed/import API exists.");
console.log("- This placeholder intentionally does not write directly to Convex tables or app code.");
console.log("");
console.log("Suggested future command:");
console.log("  pnpm --filter @cyoa/convex convex run seeds:loadStarterStories");
