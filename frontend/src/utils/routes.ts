import type { UserRole } from '../types/domain';

export type AdminSectionSlug =
  | 'overview'
  | 'analytics'
  | 'all-submissions'
  | 'schools'
  | 'facilitators'
  | 'student-feedback'
  | 'teacher-feedback'
  | 'performance-reports'
  | 'data-quality'
  | 'google-sheets-sync'
  | 'user-management'
  | 'settings';

export interface AdminNavItem {
  slug: AdminSectionSlug;
  label: string;
  path: `/admin/${AdminSectionSlug}`;
  description: string;
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  {
    slug: 'overview',
    label: 'Overview',
    path: '/admin/overview',
    description: 'Executive summary, setup readiness, and programme KPIs',
  },
  {
    slug: 'analytics',
    label: 'Analytics',
    path: '/admin/analytics',
    description: 'District, tour, language, grade, and monthly trends',
  },
  {
    slug: 'all-submissions',
    label: 'All Submissions',
    path: '/admin/all-submissions',
    description: 'Search, inspect, correct, archive, or export all records',
  },
  {
    slug: 'schools',
    label: 'Schools',
    path: '/admin/schools',
    description: 'School-wise performance and UDISE school directory',
  },
  {
    slug: 'facilitators',
    label: 'Facilitators',
    path: '/admin/facilitators',
    description: 'Facilitator activity, reach, and pooled feedback panels',
  },
  {
    slug: 'student-feedback',
    label: 'Student Feedback',
    path: '/admin/student-feedback',
    description: 'CSAT (Q-A) and ITP (Q-B) vote distributions and sentiment',
  },
  {
    slug: 'teacher-feedback',
    label: 'Teacher Feedback',
    path: '/admin/teacher-feedback',
    description: 'Teacher NPS score, Promoter/Passive/Detractor breakdown',
  },
  {
    slug: 'performance-reports',
    label: 'Performance Reports',
    path: '/admin/performance-reports',
    description: '63-column reporting exports and partner readiness summary',
  },
  {
    slug: 'data-quality',
    label: 'Data Quality',
    path: '/admin/data-quality',
    description: 'Response completeness, mismatches, and reconciliation checks',
  },
  {
    slug: 'google-sheets-sync',
    label: 'Google Sheets Sync',
    path: '/admin/google-sheets-sync',
    description: 'Apps Script connectivity, outbox retry, and sync audit trail',
  },
  {
    slug: 'user-management',
    label: 'User Management',
    path: '/admin/user-management',
    description: 'Super Admins, approval policy, and facilitator directory',
  },
  {
    slug: 'settings',
    label: 'Settings',
    path: '/admin/settings',
    description: 'System configuration, tours, Video IDs, 63-col template, audit log',
  },
] as const;

export type AppRoute =
  | { kind: 'classroom_entry' }
  | { kind: 'my_classes' }
  | { kind: 'admin'; section: AdminSectionSlug }
  | { kind: 'access_denied' }
  | { kind: 'pending_approval' }
  | { kind: 'login' }
  | { kind: 'google_auth' }
  | { kind: 'auth_callback' }
  | { kind: 'reset_password' };

const ADMIN_SLUG_SET = new Set<string>(ADMIN_NAV_ITEMS.map((item) => item.slug));

const RESTRICTED_PREFIXES = [
  '/admin',
  '/analytics',
  '/all-submissions',
  '/schools',
  '/facilitators',
  '/student-feedback',
  '/teacher-feedback',
  '/performance-reports',
  '/reports',
  '/data-quality',
  '/google-sheets',
  '/google-sheets-sync',
  '/users',
  '/user-management',
  '/settings',
  '/audit',
];

export function normalizeBasePrefix(
  baseUrl: string = import.meta.env.BASE_URL || '/',
): string {
  const trimmed = baseUrl.trim();
  if (!trimmed || trimmed === '/') return '';
  const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
  return cleaned ? `/${cleaned}` : '';
}

export function stripBasePath(
  rawPathname: string,
  baseUrl: string = import.meta.env.BASE_URL || '/',
): string {
  const prefix = normalizeBasePrefix(baseUrl).toLowerCase();
  const cleaned = rawPathname.trim().replace(/\/+$/, '') || '/';
  const lower = cleaned.toLowerCase();
  if (prefix && (lower === prefix || lower.startsWith(`${prefix}/`))) {
    const stripped = cleaned.slice(prefix.length);
    return stripped || '/';
  }
  return cleaned;
}

export function withBasePath(
  appPath: string,
  baseUrl: string = import.meta.env.BASE_URL || '/',
): string {
  const prefix = normalizeBasePrefix(baseUrl);
  const normalizedApp = appPath.startsWith('/') ? appPath : `/${appPath}`;
  if (!prefix) return normalizedApp;
  const lowerApp = normalizedApp.toLowerCase();
  const lowerPrefix = prefix.toLowerCase();
  if (lowerApp === lowerPrefix || lowerApp.startsWith(`${lowerPrefix}/`)) {
    return normalizedApp;
  }
  return normalizedApp === '/' ? `${prefix}/` : `${prefix}${normalizedApp}`;
}

export function normalizePathname(
  rawPathname: string,
  baseUrl: string = import.meta.env.BASE_URL || '/',
): string {
  return stripBasePath(rawPathname, baseUrl).toLowerCase();
}

export function isAdminOnlyPath(
  rawPathname: string,
  baseUrl: string = import.meta.env.BASE_URL || '/',
): boolean {
  const path = normalizePathname(rawPathname, baseUrl);
  return RESTRICTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function getDefaultPathForRole(role: UserRole): string {
  return role === 'super_admin' ? '/admin/overview' : '/classroom-entry';
}

export function resolveAdminSectionFromPath(
  rawPathname: string,
  baseUrl: string = import.meta.env.BASE_URL || '/',
): AdminSectionSlug {
  const path = normalizePathname(rawPathname, baseUrl);
  if (path.startsWith('/admin/')) {
    const slug = path.slice('/admin/'.length).split('/')[0] ?? 'overview';
    if (ADMIN_SLUG_SET.has(slug)) return slug as AdminSectionSlug;
  }
  if (path === '/analytics') return 'analytics';
  if (path === '/all-submissions') return 'all-submissions';
  if (path === '/schools') return 'schools';
  if (path === '/facilitators') return 'facilitators';
  if (path === '/student-feedback') return 'student-feedback';
  if (path === '/teacher-feedback') return 'teacher-feedback';
  if (path === '/performance-reports' || path === '/reports') return 'performance-reports';
  if (path === '/data-quality') return 'data-quality';
  if (path === '/google-sheets' || path === '/google-sheets-sync') return 'google-sheets-sync';
  if (path === '/users' || path === '/user-management') return 'user-management';
  if (path === '/settings' || path === '/audit') return 'settings';
  return 'overview';
}

export function parseAppRoute(
  rawPathname: string,
  role?: UserRole | null,
  baseUrl: string = import.meta.env.BASE_URL || '/',
): AppRoute {
  const path = normalizePathname(rawPathname, baseUrl);

  // Recovery links establish an authenticated recovery session before the user sets a new password,
  // so /auth/reset-password must resolve regardless of current role.
  if (path === '/auth/reset-password') {
    return { kind: 'reset_password' };
  }

  if (path === '/login') {
    return role ? (role === 'super_admin' ? { kind: 'admin', section: 'overview' } : { kind: 'classroom_entry' }) : { kind: 'login' };
  }
  if (path === '/auth/google' || path === '/auth/sso') {
    return role ? (role === 'super_admin' ? { kind: 'admin', section: 'overview' } : { kind: 'classroom_entry' }) : { kind: 'google_auth' };
  }
  if (path === '/auth/callback') {
    return role ? (role === 'super_admin' ? { kind: 'admin', section: 'overview' } : { kind: 'classroom_entry' }) : { kind: 'auth_callback' };
  }
  if (path === '/pending-approval') return { kind: 'pending_approval' };
  if (path === '/access-denied') return { kind: 'access_denied' };
  if (path === '/my-classes') return { kind: 'my_classes' };
  if (path === '/classroom-entry') return { kind: 'classroom_entry' };

  if (isAdminOnlyPath(path, baseUrl)) {
    if (role !== 'super_admin') {
      return { kind: 'access_denied' };
    }
    return { kind: 'admin', section: resolveAdminSectionFromPath(path, baseUrl) };
  }

  if (role === 'super_admin') {
    return { kind: 'admin', section: 'overview' };
  }
  return { kind: 'classroom_entry' };
}

export function navigateToPath(
  path: string,
  replace = false,
  baseUrl: string = import.meta.env.BASE_URL || '/',
): void {
  if (typeof window === 'undefined') return;
  const targetPath = withBasePath(path, baseUrl);
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === targetPath) return;
  if (replace) {
    window.history.replaceState(null, '', targetPath);
  } else {
    window.history.pushState(null, '', targetPath);
  }
}
