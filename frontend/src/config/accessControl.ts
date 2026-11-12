export interface SuperAdminPasswordHashRecord {
  algorithm: 'pbkdf2-sha256';
  iterations: 100000;
  saltHex: string;
  hashHex: string;
  updatedAt?: string;
}

export const INITIAL_SUPER_ADMIN_EMAILS = [
  'brinthajayaprakash888@gmail.com',
  'karunya@vidhyavidhai.org',
  'ram@vidhyavidhai.org',
  'regi@vidhyavidhai.org',
  'nisha@vidhyavidhai.org',
] as const;

export const INITIAL_SUPER_ADMINS = [
  {
    userId: 'SA_BRINTHA',
    name: 'Brintha Jayaprakash',
    email: 'brinthajayaprakash888@gmail.com',
  },
  {
    userId: 'SA_KARUNYA',
    name: 'Karunya',
    email: 'karunya@vidhyavidhai.org',
  },
  {
    userId: 'SA_RAM',
    name: 'Ram',
    email: 'ram@vidhyavidhai.org',
  },
  {
    userId: 'SA_REGI',
    name: 'Regi',
    email: 'regi@vidhyavidhai.org',
  },
  {
    userId: 'SA_NISHA',
    name: 'Nisha',
    email: 'nisha@vidhyavidhai.org',
  },
] as const;

/**
 * Salted PBKDF2-HMAC-SHA256 (100,000 iterations, 256-bit derived key) credentials
 * for allowlisted Super Administrators. Zero plaintext passwords are stored in source code,
 * browser storage, Google Sheets, exports, or audit logs.
 */
export const INITIAL_SUPER_ADMIN_PASSWORD_HASHES: Readonly<
  Record<string, SuperAdminPasswordHashRecord>
> = {
  'brinthajayaprakash888@gmail.com': {
    algorithm: 'pbkdf2-sha256',
    iterations: 100000,
    saltHex: '6c33736087930d18bd3faf56ecf1d287',
    hashHex: '772841c0d2586bd9d991fe1acfa8252e195dbefc9ee220eb94489636bbb9d12b',
  },
  'karunya@vidhyavidhai.org': {
    algorithm: 'pbkdf2-sha256',
    iterations: 100000,
    saltHex: '9a7bcc12825714fc908bba7e68f7a36f',
    hashHex: '31216f61aed945b3e78233f885471829911a44f0c4c1ed0647d74912bb299aba',
  },
  'ram@vidhyavidhai.org': {
    algorithm: 'pbkdf2-sha256',
    iterations: 100000,
    saltHex: '3bc294090aeae903540d362c4f06b2b7',
    hashHex: '29424e716bb568b993f516d4ba3a30f8ffc1f1afc6348603625b13f80a2cfc4c',
  },
  'regi@vidhyavidhai.org': {
    algorithm: 'pbkdf2-sha256',
    iterations: 100000,
    saltHex: 'e07874f639be8acd07f6a79d2fdb5ce6',
    hashHex: '31476d9ef57aa4eccd98babaf3f31ebb0a11176cd8ab8ddd2a2321f136cebb79',
  },
  'nisha@vidhyavidhai.org': {
    algorithm: 'pbkdf2-sha256',
    iterations: 100000,
    saltHex: 'f7d9208862d1e9559f8bc2a79e4b7219',
    hashHex: '70c63af790268503fde146d60ca4dfd75f0cd60087c6c50ce4fa59a847425af0',
  },
};

export function normalizeEmail(email: string | undefined | null): string {
  return String(email ?? '').trim().toLowerCase();
}

export function isAllowlistedSuperAdmin(email: string | undefined | null): boolean {
  const normalized = normalizeEmail(email);
  return (INITIAL_SUPER_ADMIN_EMAILS as readonly string[]).includes(normalized);
}
