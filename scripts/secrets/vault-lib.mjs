const DEFAULT_REQUIRED_CONVEX_KEYS = [
  "BETTER_AUTH_SECRET",
  "SITE_URL",
  "JWKS",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_UNLIMITED_MONTHLY",
  "STRIPE_PRICE_UNLIMITED_ANNUAL",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_ANNUAL",
];

const OPTIONAL_CONVEX_KEYS = [
  "BETTER_AUTH_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_TEXT_MODEL",
  "GEMINI_VEO_MODEL",
  "GEMINI_VEO_DURATION_MS",
  "GEMINI_VEO_RESOLUTION",
  "GEMINI_VEO_ASPECT_RATIO",
  "GEMINI_VEO_ESTIMATED_CENTS_PER_SECOND",
  "VERTEX_PROJECT_ID",
  "VERTEX_LOCATION",
  "VERTEX_ACCESS_TOKEN",
  "VERTEX_TEXT_MODEL",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "LLM_TIMEOUT_MS",
];

const MOBILE_STORE_KEYS = [
  "APPLE_PRODUCT_UNLIMITED_MONTHLY",
  "APPLE_PRODUCT_PRO_MONTHLY",
  "APPLE_BUNDLE_ID",
  "APP_STORE_CONNECT_BEARER_TOKEN",
  "GOOGLE_PRODUCT_UNLIMITED_MONTHLY",
  "GOOGLE_PRODUCT_PRO_MONTHLY",
  "GOOGLE_PLAY_PACKAGE_NAME",
  "GOOGLE_PLAY_ACCESS_TOKEN",
  "APP_STORE_CONNECT_API_KEY_ID",
  "APP_STORE_CONNECT_ISSUER_ID",
  "APP_STORE_CONNECT_PRIVATE_KEY",
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "EAS_TOKEN",
];

export const CONVEX_SECRET_KEYS = [...DEFAULT_REQUIRED_CONVEX_KEYS, ...OPTIONAL_CONVEX_KEYS];
export const REQUIRED_CONVEX_KEYS = DEFAULT_REQUIRED_CONVEX_KEYS;
export const ALL_VAULT_KEYS = [...CONVEX_SECRET_KEYS, ...MOBILE_STORE_KEYS];

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--") continue;
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function resolveVaultConfig(args) {
  const address = args.addr ?? process.env.VAULT_ADDR;
  const token = process.env.VAULT_TOKEN;
  const namespace = args.namespace ?? process.env.VAULT_NAMESPACE;
  const mount = args.mount ?? process.env.VAULT_KV_MOUNT ?? "secret";
  const path = args.path ?? process.env.VAULT_SECRET_PATH ?? "cyoa/dev";

  if (!address) throw new Error("VAULT_ADDR is required");
  if (!token) throw new Error("VAULT_TOKEN is required");

  return {
    address: address.replace(/\/$/u, ""),
    token,
    ...(namespace ? { namespace } : {}),
    mount,
    path,
  };
}

export async function readVaultSecret(config) {
  const url = `${config.address}/v1/${config.mount}/data/${config.path}`;
  const headers = {
    "X-Vault-Token": config.token,
    ...(config.namespace ? { "X-Vault-Namespace": config.namespace } : {}),
  };
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Vault read failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return payload.data?.data ?? payload.data ?? {};
}

export function requireKeys(secret, keys) {
  const missing = keys.filter((key) => {
    const value = secret[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`Vault secret is missing required keys: ${missing.join(", ")}`);
  }
}

export function selectedKeys(secret, keys) {
  return keys.filter((key) => typeof secret[key] === "string" && secret[key].trim().length > 0);
}
