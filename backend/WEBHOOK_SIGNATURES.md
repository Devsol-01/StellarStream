# Webhook Signature Verification

StellarStream signs every outgoing webhook so receivers can verify that the
request came from StellarStream and was not replayed later.

## Headers

Each webhook request includes:

```text
X-StellarStream-Signature: sha256=<hex hmac digest>
X-StellarStream-Timestamp: <ISO-8601 timestamp>
X-StellarStream-Nonce: <random hex nonce>
X-Webhook-ID: <webhook id>
```

Legacy compatibility headers `X-Nebula-Signature` and `X-Webhook-Signature`
carry the same signature value.

## Signed Payload

The signature is an HMAC-SHA256 hex digest using your webhook secret:

```text
sha256=HMAC_SHA256(secret, timestamp + "." + nonce + "." + raw_request_body)
```

Use the raw JSON request body exactly as received. Do not parse and reserialize
the JSON before verification because key ordering or whitespace changes will
change the digest.

## Replay Protection

Reject any webhook when:

- `X-StellarStream-Timestamp` is missing or invalid.
- `X-StellarStream-Nonce` is missing.
- The timestamp is more than 5 minutes away from your server time.
- The signature does not match using a constant-time comparison.

Store recently seen nonce values for at least 5 minutes and reject duplicates to
prevent replay inside the accepted timestamp window.

## Node.js Example

```ts
import { createHmac, timingSafeEqual } from "crypto";

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export function verifyStellarStreamWebhook({
  rawBody,
  signature,
  timestamp,
  nonce,
  secret,
  now = new Date(),
}: {
  rawBody: string;
  signature: string;
  timestamp: string;
  nonce: string;
  secret: string;
  now?: Date;
}): boolean {
  const signedAt = Date.parse(timestamp);
  if (!Number.isFinite(signedAt) || !nonce) return false;

  if (Math.abs(now.getTime() - signedAt) > REPLAY_WINDOW_MS) {
    return false;
  }

  const expected =
    "sha256=" +
    createHmac("sha256", secret)
      .update(`${timestamp}.${nonce}.${rawBody}`)
      .digest("hex");

  const actual = signature.startsWith("sha256=")
    ? signature
    : `sha256=${signature}`;

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
```

## Secret Rotation

Admins can rotate a receiver secret:

```bash
curl -X POST "$API_URL/api/v3/admin/webhooks/<webhookId>/rotate-secret" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

The response returns the new `secretKey` once. Update the receiver immediately;
future deliveries are signed with the new secret.
