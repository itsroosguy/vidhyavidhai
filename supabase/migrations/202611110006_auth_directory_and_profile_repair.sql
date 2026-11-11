-- Migration: 202611110006_auth_directory_and_profile_repair.sql
-- Purpose: Backfill any auth.users lacking a public.profiles row (e.g. unconfirmed accounts),
-- guarantee allowlisted Super Admin integrity, and include orphan auth.users in list_managed_directory().

DO $$
DECLARE
  v_org_id uuid := private.default_organisation_id();
  v_row_org_id uuid;
  v_approval_mode text := 'auto_approve';
  v_rec record;
  v_email text;
  v_name text;
  v_role text;
  v_status text;
  v_active boolean;
  v_code text;
  v_is_allowlisted boolean;
  v_email_verified boolean;
  v_pre public.facilitator_preapprovals%ROWTYPE;
BEGIN
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organisations ORDER BY created_at ASC LIMIT 1;
  END IF;

  SELECT COALESCE(setting_value -> 'policy' ->> 'facilitatorApprovalMode', 'auto_approve')
  INTO v_approval_mode
  FROM public.application_settings
  WHERE setting_key = 'app_configuration'
  LIMIT 1;

  PERFORM set_config('app.bypass_profile_rbac', '1', true);

  FOR v_rec IN
    SELECT u.*
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
      AND COALESCE(btrim(u.email), '') <> ''
  LOOP
    v_email := lower(btrim(v_rec.email));
    v_name := btrim(COALESCE(
      NULLIF(v_rec.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(v_rec.raw_user_meta_data ->> 'name', ''),
      split_part(v_email, '@', 1)
    ));
    v_is_allowlisted := v_email IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org');
    v_email_verified := (v_rec.email_confirmed_at IS NOT NULL)
      OR (lower(COALESCE(v_rec.raw_app_meta_data ->> 'provider', 'email')) = 'google')
      OR COALESCE((v_rec.raw_user_meta_data ->> 'email_verified')::boolean, false);

    IF v_is_allowlisted THEN
      v_role := 'super_admin';
      v_status := 'APPROVED';
      v_active := true;
      v_code := CASE
        WHEN v_email = 'brinthajayaprakash888@gmail.com' THEN 'SA_BRINTHA'
        ELSE 'SA_KARUNYA'
      END;
    ELSE
      v_role := 'facilitator';
      v_code := 'USR_' || upper(substring(replace(v_rec.id::text, '-', ''), 1, 8));
      v_row_org_id := v_org_id;

      SELECT * INTO v_pre
      FROM public.facilitator_preapprovals fp
      WHERE fp.email = v_email
      LIMIT 1;

      IF FOUND THEN
        v_status := v_pre.account_status;
        v_active := v_pre.active AND (v_pre.account_status = 'APPROVED');
        v_row_org_id := COALESCE(v_pre.organisation_id, v_row_org_id);
        IF length(btrim(COALESCE(v_pre.full_name, ''))) > 0 AND v_name = split_part(v_email, '@', 1) THEN
          v_name := btrim(v_pre.full_name);
        END IF;
      ELSIF v_email_verified
            AND v_approval_mode = 'auto_approve'
            AND NOT COALESCE((v_rec.raw_app_meta_data ->> 'require_admin_approval')::boolean, false) THEN
        v_status := 'APPROVED';
        v_active := true;
      ELSE
        v_status := 'PENDING';
        v_active := false;
      END IF;
    END IF;

    INSERT INTO public.profiles (
      id, user_code, full_name, email, role, organisation_id, account_status, active, last_sign_in_at
    )
    VALUES (
      v_rec.id, v_code, v_name, v_email, v_role, COALESCE(v_row_org_id, v_org_id), v_status, v_active, v_rec.last_sign_in_at
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.list_managed_directory()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(item ORDER BY (item ->> 'role') DESC, (item ->> 'updatedAt') DESC)
    FROM (
      SELECT jsonb_build_object(
        'userId', p.user_code,
        'name', p.full_name,
        'email', p.email,
        'role', p.role,
        'active', p.active,
        'status', p.account_status,
        'emailConfirmed', COALESCE(au.email_confirmed_at IS NOT NULL, false),
        'hasLoginAccount', (au.id IS NOT NULL),
        'createdAt', to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) AS item
      FROM public.profiles p
      LEFT JOIN auth.users au ON au.id = p.id

      UNION ALL

      SELECT jsonb_build_object(
        'userId', 'AUTH_' || upper(substring(replace(au.id::text, '-', ''), 1, 8)),
        'name', COALESCE(
          NULLIF(btrim(COALESCE(au.raw_user_meta_data ->> 'full_name', '')), ''),
          NULLIF(btrim(COALESCE(au.raw_user_meta_data ->> 'name', '')), ''),
          split_part(lower(btrim(COALESCE(au.email, ''))), '@', 1)
        ),
        'email', lower(btrim(au.email)),
        'role', CASE
          WHEN lower(btrim(au.email)) IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org') THEN 'super_admin'
          ELSE 'facilitator'
        END,
        'active', false,
        'status', 'PENDING',
        'emailConfirmed', COALESCE(au.email_confirmed_at IS NOT NULL, false),
        'hasLoginAccount', true,
        'createdAt', to_char(au.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(COALESCE(au.updated_at, au.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) AS item
      FROM auth.users au
      WHERE COALESCE(btrim(au.email), '') <> ''
        AND NOT EXISTS (SELECT 1 FROM public.profiles p2 WHERE p2.id = au.id)

      UNION ALL

      SELECT jsonb_build_object(
        'userId', 'PRE_' || upper(substring(replace(fp.id::text, '-', ''), 1, 8)),
        'name', fp.full_name,
        'email', fp.email,
        'role', 'facilitator',
        'active', fp.active,
        'status', fp.account_status,
        'emailConfirmed', false,
        'hasLoginAccount', false,
        'createdAt', to_char(fp.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(fp.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) AS item
      FROM public.facilitator_preapprovals fp
      WHERE NOT EXISTS (SELECT 1 FROM public.profiles p2 WHERE p2.email = fp.email)
        AND NOT EXISTS (SELECT 1 FROM auth.users au2 WHERE lower(btrim(COALESCE(au2.email, ''))) = fp.email)
    ) combined
  ), '[]'::jsonb);
END;
$$;
