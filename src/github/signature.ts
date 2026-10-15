const hexBytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

/** Whether GitHub signed `body` with the App's webhook secret; the comparison is constant-time. */
export const signedByGitHub = async (body: string, signature: string | null, secret: string) => {
  if (!signature?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    hexBytes(signature.slice("sha256=".length)),
    new TextEncoder().encode(body),
  );
};
