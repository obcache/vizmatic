#!/usr/bin/env node
/**
 * Offline license helper for vizmatic.
 *
 * Examples:
 *   # Generate new keypair (keep privateJwk secret)
 *   node tools/license/sign-license.js generate-keypair --out license-keypair.json
 *
 *   # Sign a payload file into a license string
 *   node tools/license/sign-license.js sign --private license-keypair.json --payload payload.json --out license.txt
 *
 *   # Verify a license string against the public JWK
 *   node tools/license/sign-license.js verify --public license-keypair.json --license "$(cat license.txt)"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const help = () => {
  console.log(`Usage:
  generate-keypair --out <path>              Generate P-256 keypair (writes publicJwk/privateJwk)
  sign --private <path> --payload <path>     Sign payload JSON with privateJwk, emit license string
       [--out <path>]
  verify --public <path> --license <string>  Verify license string with publicJwk.
  `);
  process.exit(1);
};

const base64Url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const base64UrlToBuffer = (input) => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 2 ? '==' : normalized.length % 4 === 3 ? '=' : '';
  return Buffer.from(normalized + pad, 'base64');
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeText = (p, text) => fs.writeFileSync(p, text, 'utf8');
const writeJson = (p, obj) => writeText(p, JSON.stringify(obj, null, 2));

const cmd = process.argv[2];
const args = process.argv.slice(3);

const getFlag = (name, required = false) => {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  if (required) {
    console.error(`Missing ${name}`);
    help();
  }
  return null;
};

if (!cmd) help();

if (cmd === 'generate-keypair') {
  const outPath = getFlag('--out', true);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256', publicKeyEncoding: { format: 'jwk' }, privateKeyEncoding: { format: 'jwk' } });
  const payload = { publicJwk: publicKey, privateJwk: privateKey };
  const dir = path.dirname(outPath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeJson(outPath, payload);
  try {
    const rootDir = process.cwd();
    const websiteKeyPath = path.join(rootDir, 'www-vizmatic', 'license', 'license-keypair.json');
    const websiteDir = path.dirname(websiteKeyPath);
    if (!fs.existsSync(websiteDir)) fs.mkdirSync(websiteDir, { recursive: true });
    writeJson(websiteKeyPath, payload);
    console.log(`Copied keypair to ${websiteKeyPath}`);
  } catch (err) {
    console.warn('Failed to copy keypair into www-vizmatic/license:', err);
  }
  console.log(`Wrote keypair to ${outPath}`);
  console.log('Public JWK (add to client LICENSE_PUBLIC_KEY_JWK):');
  console.log(JSON.stringify(publicKey, null, 2));
  process.exit(0);
}

if (cmd === 'sign') {
  const privatePath = getFlag('--private', true);
  const payloadPath = getFlag('--payload', true);
  const outPath = getFlag('--out', false);

  const keyFile = readJson(privatePath);
  const privateJwk = keyFile.privateJwk ?? keyFile;
  if (!privateJwk.d) {
    console.error('privateJwk missing `d` (private key material).');
    process.exit(1);
  }
  const payloadObj = readJson(payloadPath);
  const payloadString = JSON.stringify(payloadObj);
  const payloadBytes = Buffer.from(payloadString, 'utf8');

  const licensePayload = base64Url(payloadBytes);
  const signer = crypto.createSign('SHA256');
  signer.update(payloadBytes);
  signer.end();
  const signature = signer.sign({ key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }) }); // DER-encoded ECDSA
  const license = `${licensePayload}.${base64Url(signature)}`;

  if (outPath) {
    const dir = path.dirname(outPath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    writeText(outPath, license);
    console.log(`License written to ${outPath}`);
  } else {
    console.log(license);
  }
  process.exit(0);
}

if (cmd === 'verify') {
  const publicPath = getFlag('--public', true);
  const licenseStr = getFlag('--license', true);
  const keyFile = readJson(publicPath);
  const publicJwk = keyFile.publicJwk ?? keyFile;
  const [payloadB64, sigB64] = (licenseStr || '').split('.');
  if (!payloadB64 || !sigB64) {
    console.error('Invalid license format; expected payload.signature');
    process.exit(1);
  }
  const payload = base64UrlToBuffer(payloadB64);
  const signature = base64UrlToBuffer(sigB64);
  const verifier = crypto.createVerify('SHA256');
  verifier.update(payload);
  verifier.end();
  const ok = verifier.verify({ key: crypto.createPublicKey({ key: publicJwk, format: 'jwk' }) }, signature); // expects DER
  console.log(ok ? 'License verified' : 'License failed verification');
  if (ok) {
    try {
      const parsed = JSON.parse(payload.toString('utf8'));
      console.log('Payload:', parsed);
    } catch (err) {
      console.warn('Could not parse payload JSON', err);
    }
  }
  process.exit(ok ? 0 : 1);
}

console.error(`Unknown command: ${cmd}`);
help();
