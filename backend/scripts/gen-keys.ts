import { exportJWK, generateKeyPair } from 'jose';

/** Prints a fresh Ed25519 key pair as .env lines. Paste them into backend/.env. */
const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
  crv: 'Ed25519',
  extractable: true,
});
const encode = async (key: CryptoKey) =>
  Buffer.from(JSON.stringify(await exportJWK(key))).toString('base64');

console.log(`JWT_PRIVATE_KEY=${await encode(privateKey)}`);
console.log(`JWT_PUBLIC_KEY=${await encode(publicKey)}`);
