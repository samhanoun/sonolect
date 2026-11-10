## 2025-07-04 - [Missing Tolerance in Stripe Webhook Verification]

**Vulnerability:** The `verifyStripeSignature` function validated the cryptographic signature of the webhook payload but failed to check the signature's timestamp (`t`) against the current system time. This allowed for potential replay attacks where a malicious actor could intercept and replay a valid Stripe webhook indefinitely.
**Learning:** Even when correctly implementing HMAC verification for webhooks, it's critical to include a tolerance check (e.g., 5 minutes) to ensure the webhook is recent.
**Prevention:** Always implement a timestamp tolerance check when verifying third-party webhooks that include timestamps in their signatures.
