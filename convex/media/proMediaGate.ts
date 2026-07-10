// Dev-only override. When CYOA_DEV_FORCE_PRO_MEDIA=1 every media entitlement
// read becomes Pro-eligible regardless of the actual entitlement so the local
// stack is testable without configuring billing. Shared by sceneMedia.ts and
// npcMedia.ts (previously copy-pasted byte-for-byte in both).
export function devForceProMedia(): boolean {
  return process.env.CYOA_DEV_FORCE_PRO_MEDIA === "1";
}
