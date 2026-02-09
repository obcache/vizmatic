# vizmatic Offline License Helpers

This folder contains a tiny Node script to generate keys and sign offline license payloads for the app.

## Requirements
- Node 18+

## Commands

Generate a new keypair (keep `privateJwk` secret):
```bash
node tools/license/sign-license.js generate-keypair --out license-keypair.json
```
Copy `publicJwk` into `LICENSE_PUBLIC_KEY_JWK` in `client/src/App.tsx`.

Sign a payload JSON (example payload shown below) into a license string:
```bash
node tools/license/sign-license.js sign --private license-keypair.json --payload payload.json --out license.txt
```

Verify a license string against a public JWK:
```bash
node tools/license/sign-license.js verify --public license-keypair.json --license "$(cat license.txt)"
```

## Payload shape (example)
```json
{
  "name": "Customer Name",
  "email": "user@example.com",
  "edition": "full",
  "issuedAt": 1735689600000,
  "expiresAt": null
}
```

License format emitted by `sign` is:
```
base64url(utf8(JSON payload)) + '.' + base64url(ECDSA DER signature)
```
