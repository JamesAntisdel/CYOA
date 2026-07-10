declare const process: {
  env: {
    PUBLIC_APP_URL?: string;
    EXPO_PUBLIC_APP_URL?: string;
    EXPO_PUBLIC_AUTH_MODE?: "local" | "better-auth";
    EXPO_PUBLIC_CONVEX_URL?: string;
    EXPO_PUBLIC_CONVEX_SITE_URL?: string;
    EXPO_PUBLIC_PROVIDER_MOCKS_URL?: string;
    EXPO_PUBLIC_STRIPE_CHECKOUT_MODE?: "web" | "native";
    // Client-side mirror of which auth methods the server has configured
    // (secrets can't reach the client). Comma-separated provider ids, e.g.
    // "google,github,apple"; and "1"/"true" to surface the magic-link path.
    EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS?: string;
    EXPO_PUBLIC_AUTH_MAGIC_LINK?: string;
  };
};
