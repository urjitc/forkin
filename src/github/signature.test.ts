import { describe, expect, it } from "@effect/vitest";
import { signedByGitHub } from "./signature";

// GitHub's documented example: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
const secret = "It's a Secret to Everybody";
const body = "Hello, World!";
const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

describe("signedByGitHub", () => {
  it("accepts GitHub's signature", async () => {
    expect(await signedByGitHub(body, signature, secret)).toBe(true);
  });

  it("rejects a changed body, another secret, or no signature", async () => {
    expect(await signedByGitHub(`${body}!`, signature, secret)).toBe(false);
    expect(await signedByGitHub(body, signature, "another secret")).toBe(false);
    expect(await signedByGitHub(body, null, secret)).toBe(false);
  });
});
