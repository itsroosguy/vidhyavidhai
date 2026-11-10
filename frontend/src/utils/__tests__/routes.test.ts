import { describe, expect, it } from 'vitest';
import {
  normalizePathname,
  parseAppRoute,
  stripBasePath,
  withBasePath,
} from '../routes';

describe('SPA route base path normalization', () => {
  it('handles root base (/) cleanly', () => {
    expect(stripBasePath('/admin/overview', '/')).toBe('/admin/overview');
    expect(withBasePath('/admin/overview', '/')).toBe('/admin/overview');
    expect(withBasePath('/', '/')).toBe('/');
    expect(parseAppRoute('/admin/analytics', 'super_admin', '/')).toEqual({
      kind: 'admin',
      section: 'analytics',
    });
    expect(parseAppRoute('/admin/analytics', 'facilitator', '/')).toEqual({
      kind: 'access_denied',
    });
  });

  it('handles GitHub Pages project subpath (/vidhyavidhai/) cleanly', () => {
    const base = '/vidhyavidhai/';
    expect(stripBasePath('/vidhyavidhai', base)).toBe('/');
    expect(stripBasePath('/vidhyavidhai/', base)).toBe('/');
    expect(stripBasePath('/vidhyavidhai/classroom-entry/', base)).toBe('/classroom-entry');
    expect(stripBasePath('/vidhyavidhai/admin/user-management', base)).toBe(
      '/admin/user-management',
    );
    expect(normalizePathname('/VidhyaVidhai/My-Classes/', base)).toBe('/my-classes');

    expect(withBasePath('/', base)).toBe('/vidhyavidhai/');
    expect(withBasePath('/classroom-entry', base)).toBe('/vidhyavidhai/classroom-entry');
    expect(withBasePath('/vidhyavidhai/classroom-entry', base)).toBe(
      '/vidhyavidhai/classroom-entry',
    );

    expect(parseAppRoute('/vidhyavidhai/', 'super_admin', base)).toEqual({
      kind: 'admin',
      section: 'overview',
    });
    expect(parseAppRoute('/vidhyavidhai/admin/google-sheets-sync', 'super_admin', base)).toEqual({
      kind: 'admin',
      section: 'google-sheets-sync',
    });
    expect(parseAppRoute('/vidhyavidhai/admin/overview', 'facilitator', base)).toEqual({
      kind: 'access_denied',
    });
    expect(parseAppRoute('/vidhyavidhai/my-classes', 'facilitator', base)).toEqual({
      kind: 'my_classes',
    });
  });
});
