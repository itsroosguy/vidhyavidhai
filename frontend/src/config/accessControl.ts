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
  'saktheeswaran@vidhyavidhai.org',
  'poomuthu@vidhyavidhai.org',
  'saravanakumar@vidhyavidhai.org',
  'ravi@vidhyavidhai.org',
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
  {
    userId: 'SA_SAKTHEESWARAN',
    name: 'Saktheeswaran',
    email: 'saktheeswaran@vidhyavidhai.org',
  },
  {
    userId: 'SA_POOMUTHU',
    name: 'Poomuthu',
    email: 'poomuthu@vidhyavidhai.org',
  },
  {
    userId: 'SA_SARAVANAKUMAR',
    name: 'Saravanakumar',
    email: 'saravanakumar@vidhyavidhai.org',
  },
  {
    userId: 'SA_RAVI',
    name: 'Ravi',
    email: 'ravi@vidhyavidhai.org',
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
  'saktheeswaran@vidhyavidhai.org': {
    algorithm: 'pbkdf2-sha256',
    iterations: 100000,
    saltHex: '2b92ab55dbb9a9d12ecdbb539fa00819',
    hashHex: '94bd26bc505578014974db11dce7b72bd8d9a196a6146082fd41f7fa83a49da4',
  },
  'poomuthu@vidhyavidhai.org': {
    algorithm: 'pbkdf2-sha256',
    iterations: 100000,
    saltHex: '15bb9ccd9e2fc03a247b21f5e7fcd2a0',
    hashHex: 'fbd6bc056dde56b21099e4981e69b6fef10a9b4de8ef7e511af23f7dc9a4209d',
  },
  'saravanakumar@vidhyavidhai.org': {
    algorithm: 'pbkdf2-sha256',
    iterations: 100000,
    saltHex: '21f40a1b41a2cfe9e60e35068f206260',
    hashHex: '800514dd56974752ba2c6f6d4bbca57045c3064ae57a92df3aeeb47a90aedb4d',
  },
  'ravi@vidhyavidhai.org': {
    algorithm: 'pbkdf2-sha256',
    iterations: 100000,
    saltHex: '02b932b37a585f5562741cf77422c1d1',
    hashHex: '13287969d76c6f5ff808c09863887c5d8585fba9eae7f52d2d9d7e8c700d0dc6',
  },
};

export function normalizeEmail(email: string | undefined | null): string {
  return String(email ?? '').trim().toLowerCase();
}

export function isAllowlistedSuperAdmin(email: string | undefined | null): boolean {
  const normalized = normalizeEmail(email);
  return (INITIAL_SUPER_ADMIN_EMAILS as readonly string[]).includes(normalized);
}
