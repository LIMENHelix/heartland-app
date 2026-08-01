/* ==========================================================================
   Web Push, implemented on Node's built-in crypto. No dependencies.

     RFC 8188  Encrypted Content-Encoding (aes128gcm)
     RFC 8291  Message Encryption for Web Push
     RFC 8292  VAPID (voluntary application server identification)

   The encryption path is verified byte-for-byte against the official test
   vector in RFC 8291 section 5. Run `node push.js --selftest`.
   ========================================================================== */
"use strict";

const crypto = require("crypto");

/* ---- base64url ---- */
function b64u(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(str) {
  return Buffer.from(String(str).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/* ---- VAPID key generation (run once, keep the private key secret) ---- */
function generateVapidKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: b64u(ecdh.getPublicKey()),        // 65-byte uncompressed point
    privateKey: b64u(ecdh.getPrivateKey())       // 32-byte scalar
  };
}

/* Wrap a raw P-256 scalar into a PKCS#8 key object so crypto.sign() accepts it.
   Building the DER by hand avoids pulling in a key-encoding dependency. */
function privateKeyObject(rawPrivate, rawPublic) {
  const d = Buffer.alloc(32);
  Buffer.from(rawPrivate).copy(d, 32 - Math.min(32, rawPrivate.length));

  // RFC 5915 ECPrivateKey: SEQUENCE { INTEGER 1, OCTET STRING d, [1] BIT STRING pub }
  const pubBit = Buffer.concat([Buffer.from([0x03, 0x42, 0x00]), rawPublic]);
  const ecPriv = Buffer.concat([
    Buffer.from([0x02, 0x01, 0x01]),                       // version 1
    Buffer.from([0x04, 0x20]), d,                          // privateKey
    Buffer.from([0xa1, 0x44]), pubBit                      // [1] publicKey
  ]);
  const ecPrivSeq = Buffer.concat([Buffer.from([0x30, ecPriv.length]), ecPriv]);

  // PKCS#8 PrivateKeyInfo wrapping the above
  const algId = Buffer.from([
    0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,  // id-ecPublicKey
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07 // prime256v1
  ]);
  const inner = Buffer.concat([
    Buffer.from([0x02, 0x01, 0x00]),                       // version 0
    algId,
    Buffer.from([0x04, ecPrivSeq.length]), ecPrivSeq
  ]);
  const der = Buffer.concat([Buffer.from([0x30, 0x81, inner.length]), inner]);

  return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/* ---- RFC 8292: the Authorization header the push service checks ---- */
function vapidHeader(endpoint, subject, publicKey, privateKey) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({
    aud: aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,   // spec caps this at 24h
    sub: subject
  }));
  const signingInput = Buffer.from(header + "." + body);

  const key = privateKeyObject(unb64u(privateKey), unb64u(publicKey));
  // Web Push wants the raw r||s pair, not the DER encoding Node emits by default.
  const sig = crypto.sign("sha256", signingInput, { key: key, dsaEncoding: "ieee-p1363" });

  return "vapid t=" + header + "." + body + ".{S}".replace("{S}", b64u(sig)) +
         ", k=" + publicKey;
}

/* ==========================================================================
   RFC 8291 + RFC 8188 payload encryption
   ========================================================================== */

const RECORD_SIZE = 4096;

function encryptPayload(plaintext, uaPublicB64, authSecretB64, opts) {
  const o = opts || {};
  const uaPublic = unb64u(uaPublicB64);        // 65 bytes, client's p256dh
  const authSecret = unb64u(authSecretB64);    // 16 bytes, client's auth
  const salt = o.salt ? unb64u(o.salt) : crypto.randomBytes(16);

  // Ephemeral sender key, unless the caller pins one (the self-test does).
  const ecdh = crypto.createECDH("prime256v1");
  if (o.senderPrivate) {
    ecdh.setPrivateKey(unb64u(o.senderPrivate));
  } else {
    ecdh.generateKeys();
  }
  const asPublic = ecdh.getPublicKey();        // 65 bytes

  // 1. raw ECDH shared secret
  const sharedSecret = ecdh.computeSecret(uaPublic);

  // 2-4. RFC 8291: derive the IKM, binding both public keys into the info
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic
  ]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32));

  // 5. RFC 8188: content encryption key + nonce
  const cek = Buffer.from(crypto.hkdfSync(
    "sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16));
  const nonce = Buffer.from(crypto.hkdfSync(
    "sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12));

  // 6. single record; 0x02 is the final-record padding delimiter
  const record = Buffer.concat([Buffer.from(plaintext, "utf8"), Buffer.from([0x02])]);
  if (record.length > RECORD_SIZE - 16) throw new Error("push payload too large");

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  // 7. aes128gcm header: salt | record size | keyid length | keyid(sender pubkey)
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ciphertext]);
}

/* ==========================================================================
   Send
   ========================================================================== */

/* subscription = { endpoint, keys: { p256dh, auth } }
   Resolves { ok, status, body }. A 404 or 410 means the subscription is dead
   and the caller should delete it. */
async function sendNotification(subscription, payloadObj, vapid, options) {
  const opts = options || {};
  const body = encryptPayload(JSON.stringify(payloadObj),
                              subscription.keys.p256dh, subscription.keys.auth);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": String(opts.ttl == null ? 86400 : opts.ttl),
      "Urgency": opts.urgency || "normal",
      "Authorization": vapidHeader(subscription.endpoint, vapid.subject,
                                   vapid.publicKey, vapid.privateKey)
    },
    body: body
  });

  const text = await res.text().catch(function () { return ""; });
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
    body: text
  };
}

/* ==========================================================================
   Self-test against RFC 8291 section 5
   ========================================================================== */

function selftest() {
  const V = {
    plaintext: "When I grow up, I want to be a watermelon",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
    expected:
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
      "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
      "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
  };

  const out = b64u(encryptPayload(V.plaintext, V.uaPublic, V.auth, {
    salt: V.salt, senderPrivate: V.senderPrivate
  }));

  const pass = out === V.expected;
  console.log("RFC 8291 s5 vector: " + (pass ? "PASS" : "FAIL"));
  if (!pass) {
    console.log("  expected: " + V.expected);
    console.log("  actual:   " + out);
  }

  // VAPID header must be well formed and verify against its own public key
  const keys = generateVapidKeys();
  const hdr = vapidHeader("https://fcm.googleapis.com/fcm/send/abc",
                          "mailto:care@heartlandmenshealth.com", keys.publicKey, keys.privateKey);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(hdr);
  let vpass = false;
  if (m) {
    const pub = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"),
        unb64u(keys.publicKey)
      ]),
      format: "der", type: "spki"
    });
    vpass = crypto.verify("sha256", Buffer.from(m[1] + "." + m[2]),
                          { key: pub, dsaEncoding: "ieee-p1363" }, unb64u(m[3]));
    const claims = JSON.parse(unb64u(m[2]).toString());
    vpass = vpass && claims.aud === "https://fcm.googleapis.com" &&
            claims.exp > Math.floor(Date.now() / 1000);
  }
  console.log("VAPID ES256 signature: " + (vpass ? "PASS" : "FAIL"));

  process.exit(pass && vpass ? 0 : 1);
}

module.exports = { generateVapidKeys, vapidHeader, encryptPayload, sendNotification, b64u, unb64u };

if (require.main === module && process.argv.includes("--selftest")) selftest();
