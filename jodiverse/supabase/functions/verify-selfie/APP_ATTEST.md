# iOS App Attest — finishing the implementation

`verifyAppAttest()` currently **rejects everything**. That's deliberate: a
verification function that pretends to check is worse than one that refuses,
because it silently hands out "Verified" badges to anyone with `curl`.

Android (Play Integrity) **is** fully implemented. Finish this before shipping iOS.

## What the client must send

```ts
// react-native-ios-appattest or expo-app-attest
const keyId  = await AppAttest.generateKey();          // once per install, persist it
const hash   = sha256(`${userId}:${nonceFromServer}`);  // challenge binding
const attest = await AppAttest.attestKey(keyId, hash);
// POST { passed: true, platform: "ios", integrityToken: attest, keyId }
```

## What this function must then do

1. **Base64-decode** `integrityToken` → CBOR attestation object.
2. **Parse CBOR** → `{ fmt: "apple-appattest", attStmt: { x5c, receipt }, authData }`.
3. **Walk the cert chain** in `x5c` up to Apple's App Attest root
   (<https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem>).
4. **Verify the nonce**: SHA-256 of (`authData` ‖ clientDataHash) must equal the
   value in the credCert's `1.2.840.113635.100.8.2` extension.
5. **Check the RP ID hash**: first 32 bytes of `authData` == SHA-256 of
   `<TEAM_ID>.<BUNDLE_ID>`.
6. **Check the counter** is 0 for attestation, and strictly increasing for
   subsequent assertions (replay protection).
7. **Persist `keyId` → user** so the same key can't attest for two accounts.

## Recommended approach

Don't hand-roll steps 2–4. Use a maintained library, e.g.:

- `node-app-attest` (npm) — run this function on Node instead of Deno, or
- `@peculiar/x509` + `cbor-x` via `npm:` specifiers in Deno.

## Required secrets

| Secret | Example |
|---|---|
| `IOS_BUNDLE_ID` | `com.dosticonnect.app` |
| `IOS_TEAM_ID` | `A1B2C3D4E5` |

## Testing note

App Attest **does not work in the iOS Simulator** — you need a physical device.
Until then, iOS testing requires `ALLOW_UNVERIFIED_DEVICES=true`, which must be
removed before release.
