import {
  INITIAL_SUPER_ADMIN_PASSWORD_HASHES,
  isAllowlistedSuperAdmin,
  normalizeEmail,
  type SuperAdminPasswordHashRecord,
} from '../config/accessControl';

export const SUPER_ADMIN_PASSWORD_OVERRIDES_KEY = 'ct_sa_password_overrides_v1';
export const ACTIVE_SANDBOX_SESSION_PROOF_KEY = 'ct_active_sandbox_proof_v1';

export const PBKDF2_ITERATIONS = 100000;
export const PBKDF2_KEY_BYTES = 32;
export const PBKDF2_SALT_BYTES = 16;
export const MIN_SUPER_ADMIN_PASSWORD_LENGTH = 8;

export interface SandboxSessionProof {
  email: string;
  resumeToken: string;
  issuedAt: string;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const sha256W = new Int32Array(64);

function sha256CompressBlock(state: Uint32Array, block: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4;
    sha256W[i] =
      ((block[j]! << 24) | (block[j + 1]! << 16) | (block[j + 2]! << 8) | block[j + 3]!) | 0;
  }
  for (let i = 16; i < 64; i++) {
    const w15 = sha256W[i - 15]!;
    const w2 = sha256W[i - 2]!;
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    sha256W[i] = (sha256W[i - 16]! + s0 + sha256W[i - 7]! + s1) | 0;
  }

  let a = state[0]!;
  let b = state[1]!;
  let c = state[2]!;
  let d = state[3]!;
  let e = state[4]!;
  let f = state[5]!;
  let g = state[6]!;
  let h = state[7]!;

  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const temp1 = (h + S1 + ch + SHA256_K[i]! + sha256W[i]!) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) | 0;

    h = g;
    g = f;
    f = e;
    e = (d + temp1) | 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) | 0;
  }

  state[0] = (state[0]! + a) >>> 0;
  state[1] = (state[1]! + b) >>> 0;
  state[2] = (state[2]! + c) >>> 0;
  state[3] = (state[3]! + d) >>> 0;
  state[4] = (state[4]! + e) >>> 0;
  state[5] = (state[5]! + f) >>> 0;
  state[6] = (state[6]! + g) >>> 0;
  state[7] = (state[7]! + h) >>> 0;
}

function sha256FromState(
  initialState: Uint32Array,
  prefixBytesProcessed: number,
  data: Uint8Array,
  outWords: Uint32Array,
): void {
  outWords.set(initialState);
  const totalBytes = prefixBytesProcessed + data.length;
  const fullBlocksEnd = data.length - (data.length % 64);

  for (let off = 0; off < fullBlocksEnd; off += 64) {
    sha256CompressBlock(outWords, data, off);
  }

  const tailLen = data.length - fullBlocksEnd;
  const blockCount = tailLen + 9 > 64 ? 2 : 1;
  const padded = new Uint8Array(blockCount * 64);
  padded.set(data.subarray(fullBlocksEnd), 0);
  padded[tailLen] = 0x80;

  const totalBitsHi = Math.floor((totalBytes * 8) / 0x100000000);
  const totalBitsLo = (totalBytes * 8) >>> 0;
  const lenOffset = padded.length - 8;
  padded[lenOffset] = (totalBitsHi >>> 24) & 0xff;
  padded[lenOffset + 1] = (totalBitsHi >>> 16) & 0xff;
  padded[lenOffset + 2] = (totalBitsHi >>> 8) & 0xff;
  padded[lenOffset + 3] = totalBitsHi & 0xff;
  padded[lenOffset + 4] = (totalBitsLo >>> 24) & 0xff;
  padded[lenOffset + 5] = (totalBitsLo >>> 16) & 0xff;
  padded[lenOffset + 6] = (totalBitsLo >>> 8) & 0xff;
  padded[lenOffset + 7] = totalBitsLo & 0xff;

  sha256CompressBlock(outWords, padded, 0);
  if (blockCount === 2) {
    sha256CompressBlock(outWords, padded, 64);
  }
}

function wordsToBytes32(words: Uint32Array, out: Uint8Array): void {
  for (let i = 0; i < 8; i++) {
    const w = words[i]!;
    out[i * 4] = (w >>> 24) & 0xff;
    out[i * 4 + 1] = (w >>> 16) & 0xff;
    out[i * 4 + 2] = (w >>> 8) & 0xff;
    out[i * 4 + 3] = w & 0xff;
  }
}

/**
 * Pure TypeScript RFC 2898 / FIPS 180-4 PBKDF2-HMAC-SHA256 with ipad/opad midstate caching.
 * Used automatically whenever Web Crypto `crypto.subtle` is unavailable (e.g., jsdom or non-HTTPS LAN origins).
 */
export function derivePbkdf2Sha256PureJs(
  passwordBytes: Uint8Array,
  saltBytes: Uint8Array,
  iterations: number,
  keyLengthBytes: number,
): Uint8Array {
  const normalizedKey = new Uint8Array(64);
  if (passwordBytes.length > 64) {
    const hashedWords = new Uint32Array(8);
    sha256FromState(SHA256_IV, 0, passwordBytes, hashedWords);
    wordsToBytes32(hashedWords, normalizedKey.subarray(0, 32));
  } else {
    normalizedKey.set(passwordBytes, 0);
  }

  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = normalizedKey[i]! ^ 0x36;
    opad[i] = normalizedKey[i]! ^ 0x5c;
  }

  const ipadState = new Uint32Array(SHA256_IV);
  sha256CompressBlock(ipadState, ipad, 0);
  const opadState = new Uint32Array(SHA256_IV);
  sha256CompressBlock(opadState, opad, 0);

  const dk = new Uint8Array(keyLengthBytes);
  const blockCount = Math.ceil(keyLengthBytes / 32);
  const initialMsg = new Uint8Array(saltBytes.length + 4);
  initialMsg.set(saltBytes, 0);

  // Reusable single-block buffer for HMAC iterations 2..c (32-byte digest + 0x80 + 768-bit total length)
  const block64 = new Uint8Array(64);
  block64[32] = 0x80;
  block64[62] = 0x03; // 96 bytes * 8 = 768 = 0x0300 bits
  block64[63] = 0x00;

  const innerWords = new Uint32Array(8);
  const outerWords = new Uint32Array(8);
  const uBytes = new Uint8Array(32);
  const tBytes = new Uint8Array(32);

  for (let blockIdx = 1; blockIdx <= blockCount; blockIdx++) {
    initialMsg[saltBytes.length] = (blockIdx >>> 24) & 0xff;
    initialMsg[saltBytes.length + 1] = (blockIdx >>> 16) & 0xff;
    initialMsg[saltBytes.length + 2] = (blockIdx >>> 8) & 0xff;
    initialMsg[saltBytes.length + 3] = blockIdx & 0xff;

    sha256FromState(ipadState, 64, initialMsg, innerWords);
    wordsToBytes32(innerWords, block64);
    outerWords.set(opadState);
    sha256CompressBlock(outerWords, block64, 0);
    wordsToBytes32(outerWords, uBytes);
    tBytes.set(uBytes);

    for (let iter = 2; iter <= iterations; iter++) {
      block64.set(uBytes, 0);
      innerWords.set(ipadState);
      sha256CompressBlock(innerWords, block64, 0);

      wordsToBytes32(innerWords, block64);
      outerWords.set(opadState);
      sha256CompressBlock(outerWords, block64, 0);
      wordsToBytes32(outerWords, uBytes);

      for (let k = 0; k < 32; k++) {
        tBytes[k] = tBytes[k]! ^ uBytes[k]!;
      }
    }

    const offset = (blockIdx - 1) * 32;
    const take = Math.min(32, keyLengthBytes - offset);
    dk.set(tBytes.subarray(0, take), offset);
  }

  return dk;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error('Invalid hex byte encoding.');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

export async function derivePbkdf2Sha256Hex(
  password: string,
  saltHex: string,
  iterations = PBKDF2_ITERATIONS,
  keyBytes = PBKDF2_KEY_BYTES,
): Promise<string> {
  const passwordBytes = new TextEncoder().encode(password);
  const saltBytes = hexToBytes(saltHex);

  const subtle =
    typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : undefined;

  if (
    subtle &&
    typeof subtle.importKey === 'function' &&
    typeof subtle.deriveBits === 'function'
  ) {
    try {
      const keyMaterial = await subtle.importKey(
        'raw',
        new Uint8Array(passwordBytes),
        { name: 'PBKDF2' },
        false,
        ['deriveBits'],
      );
      const bits = await subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: new Uint8Array(saltBytes),
          iterations,
          hash: 'SHA-256',
        },
        keyMaterial,
        keyBytes * 8,
      );
      return bytesToHex(new Uint8Array(bits));
    } catch {
      // Fall back safely to pure-TypeScript RFC 2898 implementation
    }
  }

  return bytesToHex(derivePbkdf2Sha256PureJs(passwordBytes, saltBytes, iterations, keyBytes));
}

function isValidHashRecord(raw: unknown): raw is SuperAdminPasswordHashRecord {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Partial<SuperAdminPasswordHashRecord>;
  return (
    r.algorithm === 'pbkdf2-sha256' &&
    r.iterations === PBKDF2_ITERATIONS &&
    typeof r.saltHex === 'string' &&
    /^[0-9a-f]{32}$/i.test(r.saltHex) &&
    typeof r.hashHex === 'string' &&
    /^[0-9a-f]{64}$/i.test(r.hashHex)
  );
}

function loadPasswordOverridesMap(): Record<string, SuperAdminPasswordHashRecord> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SUPER_ADMIN_PASSWORD_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, SuperAdminPasswordHashRecord> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const cleanEmail = normalizeEmail(k);
      if (isAllowlistedSuperAdmin(cleanEmail) && isValidHashRecord(v)) {
        out[cleanEmail] = {
          algorithm: 'pbkdf2-sha256',
          iterations: PBKDF2_ITERATIONS,
          saltHex: v.saltHex.toLowerCase(),
          hashHex: v.hashHex.toLowerCase(),
          ...(typeof v.updatedAt === 'string' ? { updatedAt: v.updatedAt } : {}),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getSuperAdminPasswordHashRecord(
  email: string,
): SuperAdminPasswordHashRecord | null {
  const cleanEmail = normalizeEmail(email);
  if (!isAllowlistedSuperAdmin(cleanEmail)) return null;
  const overrides = loadPasswordOverridesMap();
  return overrides[cleanEmail] ?? INITIAL_SUPER_ADMIN_PASSWORD_HASHES[cleanEmail] ?? null;
}

export async function verifySuperAdminPassword(
  email: string,
  candidatePassword: string,
): Promise<boolean> {
  if (typeof candidatePassword !== 'string' || candidatePassword.length === 0) {
    return false;
  }
  const record = getSuperAdminPasswordHashRecord(email);
  if (!record) return false;
  try {
    const derivedHex = await derivePbkdf2Sha256Hex(
      candidatePassword,
      record.saltHex,
      record.iterations,
      PBKDF2_KEY_BYTES,
    );
    return constantTimeEqualBytes(hexToBytes(derivedHex), hexToBytes(record.hashHex));
  } catch {
    return false;
  }
}

export async function updateSuperAdminPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<{
  ok: boolean;
  code?: string;
  error?: string;
  updatedAt?: string;
}> {
  const cleanEmail = normalizeEmail(email);
  if (!isAllowlistedSuperAdmin(cleanEmail)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      error: 'Only allowlisted Super Administrator accounts support password updates.',
    };
  }
  if (!currentPassword) {
    return {
      ok: false,
      code: 'CURRENT_PASSWORD_REQUIRED',
      error: 'Enter your current password to verify this change.',
    };
  }
  const currentValid = await verifySuperAdminPassword(cleanEmail, currentPassword);
  if (!currentValid) {
    return {
      ok: false,
      code: 'INVALID_CURRENT_PASSWORD',
      error: 'Current password is incorrect.',
    };
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_SUPER_ADMIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      code: 'WEAK_PASSWORD',
      error: `New password must be at least ${MIN_SUPER_ADMIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (newPassword === currentPassword) {
    return {
      ok: false,
      code: 'PASSWORD_UNCHANGED',
      error: 'Choose a new password that differs from your current password.',
    };
  }

  const saltHex = bytesToHex(randomBytes(PBKDF2_SALT_BYTES));
  const hashHex = await derivePbkdf2Sha256Hex(
    newPassword,
    saltHex,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_BYTES,
  );
  const updatedAt = new Date().toISOString();
  const overrides = loadPasswordOverridesMap();
  overrides[cleanEmail] = {
    algorithm: 'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    saltHex,
    hashHex,
    updatedAt,
  };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SUPER_ADMIN_PASSWORD_OVERRIDES_KEY, JSON.stringify(overrides));
    } catch {
      return {
        ok: false,
        code: 'STORAGE_ERROR',
        error: 'Unable to save updated password credentials on this browser.',
      };
    }
  }
  return { ok: true, updatedAt };
}

export function loadActiveSandboxSessionProof(): SandboxSessionProof | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTIVE_SANDBOX_SESSION_PROOF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SandboxSessionProof> | null;
    const cleanEmail = normalizeEmail(parsed?.email);
    const token = typeof parsed?.resumeToken === 'string' ? parsed.resumeToken.trim() : '';
    if (!cleanEmail || !isAllowlistedSuperAdmin(cleanEmail) || !/^[0-9a-f]{48,}$/i.test(token)) {
      return null;
    }
    return {
      email: cleanEmail,
      resumeToken: token,
      issuedAt: typeof parsed?.issuedAt === 'string' ? parsed.issuedAt : '',
    };
  } catch {
    return null;
  }
}

export function mintActiveSandboxSessionProof(email: string): string {
  const cleanEmail = normalizeEmail(email);
  const resumeToken = bytesToHex(randomBytes(32));
  if (typeof localStorage !== 'undefined' && isAllowlistedSuperAdmin(cleanEmail)) {
    try {
      const payload: SandboxSessionProof = {
        email: cleanEmail,
        resumeToken,
        issuedAt: new Date().toISOString(),
      };
      localStorage.setItem(ACTIVE_SANDBOX_SESSION_PROOF_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }
  return resumeToken;
}

export function verifyActiveSandboxSessionProof(email: string, candidateToken: string): boolean {
  const cleanEmail = normalizeEmail(email);
  const proof = loadActiveSandboxSessionProof();
  if (!proof || proof.email !== cleanEmail) return false;
  if (typeof candidateToken !== 'string' || !/^[0-9a-f]{48,}$/i.test(candidateToken.trim())) {
    return false;
  }
  try {
    const encoder = new TextEncoder();
    return constantTimeEqualBytes(
      encoder.encode(proof.resumeToken),
      encoder.encode(candidateToken.trim()),
    );
  } catch {
    return false;
  }
}

export function clearActiveSandboxSessionProof(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(ACTIVE_SANDBOX_SESSION_PROOF_KEY);
  } catch {
    // Ignore storage removal errors
  }
}
