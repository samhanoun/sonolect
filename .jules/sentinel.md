## 2024-06-27 - [Stripe Webhook Signature Replay Attack Prevention]
**Vulnerability:** Stripe webhook signature verification lacked timestamp validation, making it susceptible to replay attacks if an attacker intercepted a webhook payload.
**Learning:** Security validations for webhooks must always include time boundaries (usually 5 minutes) to ensure payloads cannot be reused.
**Prevention:** Implement timestamp checking in any webhook signature verifier by comparing the signature timestamp against the current server time and dropping requests outside a reasonable tolerance.
