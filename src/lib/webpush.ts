import "server-only";
import crypto from "node:crypto";

/* Web Push: RFC 8291 (aes128gcm) + RFC 8292 (VAPID) on Node's built-in
   crypto. No dependency is added, so the deployed install needs no new
   lockfile resolution. A receiver using only the framed header decrypts what
   this encrypts (verified end-to-end). */

const b64uToBuf = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const bufToB64u = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, len: number) =>
  Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));

/** A 65-byte uncompressed P-256 point as a Node key (JWK, which is the only
    form Node accepts for a raw point). */
function keyFromPoint(point: Buffer, priv?: Buffer) {
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error("Invalid P-256 public key");
  }
  const x = bufToB64u(point.subarray(1, 33));
  const y = bufToB64u(point.subarray(33, 65));
  const jwk = priv
    ? { kty: "EC", crv: "P-256", d: bufToB64u(priv), x, y }
    : { kty: "EC", crv: "P-256", x, y };
  return priv
    ? crypto.createPrivateKey({ key: jwk, format: "jwk" })
    : crypto.createPublicKey({ key: jwk, format: "jwk" });
}

/**
 * Encrypt one message per RFC 8291. The returned buffer is the complete
 * request body: framing header + ciphertext. A fresh ECDH pair per message
 * is required by the spec, not an optimisation.
 */
export function encryptPayload(payload: Buffer, p256dh: Buffer, auth: Buffer): Buffer {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(p256dh);

  // IKM = HKDF(auth, ECDH_shared, "WebPush: info\0" || ua_pub || as_pub)
  const ikm = hkdf(
    auth,
    shared,
    Buffer.concat([Buffer.from("WebPush: info\0"), p256dh, asPublic]),
    32,
  );

  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  // 0x02 is the final-record padding delimiter.
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
  ]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);

  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct, cipher.getAuthTag()]);
}

/**
 * `Authorization: vapid ...` for one endpoint. `aud` must be the push
 * service's ORIGIN, not the full URL (a mismatch is a 401). ES256 signs the
 * raw r||s form — Node's default DER is rejected by every push service.
 */
export function vapidAuthHeader(
  endpoint: string,
  publicKeyB64u: string,
  privateKeyB64u: string,
  subject: string,
): string {
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = bufToB64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bufToB64u(
    Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp, sub: subject })),
  );
  const input = `${header}.${claims}`;

  const sig = crypto.sign("sha256", Buffer.from(input), {
    key: keyFromPoint(b64uToBuf(publicKeyB64u), b64uToBuf(privateKeyB64u)) as crypto.KeyObject,
    dsaEncoding: "ieee-p1363",
  });

  return `vapid t=${input}.${bufToB64u(sig)}, k=${publicKeyB64u}`;
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type PushOutcome =
  | { ok: true; status: number }
  | { ok: false; status: number; gone: boolean; error: string };

/**
 * POST one encrypted message. `gone` marks a subscription the push service
 * has discarded for good (404/410) — the caller prunes it. Anything else is
 * retried on the next poll.
 */
export async function sendPush(
  target: PushTarget,
  payload: unknown,
  vapid: { publicKey: string; privateKey: string; subject: string },
): Promise<PushOutcome> {
  try {
    const body = encryptPayload(
      Buffer.from(JSON.stringify(payload)),
      b64uToBuf(target.p256dh),
      b64uToBuf(target.auth),
    );

    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthHeader(
          target.endpoint,
          vapid.publicKey,
          vapid.privateKey,
          vapid.subject,
        ),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "high",
      },
      body: new Uint8Array(body),
    });

    if (res.ok) return { ok: true, status: res.status };

    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      gone: res.status === 404 || res.status === 410,
      error: `${res.status} ${text}`.trim().slice(0, 300),
    };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: e instanceof Error ? e.message : "push failed" };
  }
}
