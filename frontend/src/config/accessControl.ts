export const INITIAL_SUPER_ADMIN_EMAILS = [
  'brinthajayaprakash888@gmail.com',
  'karunya@vidhyavidhai.org',
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
] as const;

export function normalizeEmail(email: string | undefined | null): string {
  return String(email ?? '').trim().toLowerCase();
}

export function isAllowlistedSuperAdmin(email: string | undefined | null): boolean {
  const normalized = normalizeEmail(email);
  return (INITIAL_SUPER_ADMIN_EMAILS as readonly string[]).includes(normalized);
}
