-- 0005_admin_auth_provisioning.sql
-- Support email-rate-limit-free admin provisioning, safe fallback self-registration,
-- and email confirmation status visibility in the Super Admin directory.

CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_full_name text;
  v_org_id uuid;
  v_is_allowlisted boolean;
  v_role text := 'facilitator';
  v_status text := 'PENDING';
  v_active boolean := false;
  v_user_code text;
  v_pre public.facilitator_preapprovals%ROWTYPE;
  v_has_pre boolean := false;
  v_approval_mode text := 'auto_approve';
  v_provider text;
  v_email_verified boolean;
  v_require_admin_approval boolean := false;
  v_admin_provisioned boolean := false;
BEGIN
  v_email := lower(btrim(COALESCE(NEW.email, '')));
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  v_org_id := COALESCE(private.default_organisation_id(), gen_random_uuid());
  v_full_name := btrim(COALESCE(
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
    split_part(v_email, '@', 1)
  ));

  v_is_allowlisted := v_email IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org');
  v_require_admin_approval := COALESCE((NEW.raw_app_meta_data ->> 'require_admin_approval')::boolean, false);
  v_admin_provisioned := COALESCE((NEW.raw_app_meta_data ->> 'admin_provisioned')::boolean, false);

  IF v_is_allowlisted THEN
    v_role := 'super_admin';
    v_status := 'APPROVED';
    v_active := true;
    v_user_code := CASE
      WHEN v_email = 'brinthajayaprakash888@gmail.com' THEN 'SA_BRINTHA'
      ELSE 'SA_KARUNYA'
    END;
  ELSE
    SELECT * INTO v_pre
    FROM public.facilitator_preapprovals fp
    WHERE fp.email = v_email
    LIMIT 1;
    v_has_pre := FOUND;

    IF v_admin_provisioned THEN
      v_status := 'APPROVED';
      v_active := true;
      IF v_has_pre THEN
        v_org_id := v_pre.organisation_id;
      END IF;
    ELSIF v_has_pre THEN
      v_status := v_pre.account_status;
      v_active := v_pre.active AND (v_pre.account_status = 'APPROVED');
      v_org_id := v_pre.organisation_id;
      IF length(btrim(COALESCE(v_pre.full_name, ''))) > 0 AND v_full_name = split_part(v_email, '@', 1) THEN
        v_full_name := btrim(v_pre.full_name);
      END IF;
    ELSE
      SELECT COALESCE(setting_value -> 'policy' ->> 'facilitatorApprovalMode', 'auto_approve')
      INTO v_approval_mode
      FROM public.application_settings
      WHERE setting_key = 'app_configuration'
      LIMIT 1;

      v_provider := lower(COALESCE(NEW.raw_app_meta_data ->> 'provider', 'email'));
      v_email_verified := (NEW.email_confirmed_at IS NOT NULL)
        OR (v_provider = 'google')
        OR COALESCE((NEW.raw_user_meta_data ->> 'email_verified')::boolean, false);

      IF NOT v_require_admin_approval AND v_approval_mode = 'auto_approve' AND v_email_verified THEN
        v_status := 'APPROVED';
        v_active := true;
      ELSE
        v_status := 'PENDING';
        v_active := false;
      END IF;
    END IF;

    v_user_code := 'USR_' || upper(substring(replace(NEW.id::text, '-', ''), 1, 8));
  END IF;

  PERFORM set_config('app.bypass_profile_rbac', '1', true);

  INSERT INTO public.profiles (
    id, user_code, full_name, email, role, organisation_id, account_status, active, last_sign_in_at
  )
  VALUES (
    NEW.id, v_user_code, v_full_name, v_email, v_role, v_org_id, v_status, v_active, NEW.last_sign_in_at
  )
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = CASE WHEN length(btrim(public.profiles.full_name)) = 0 THEN EXCLUDED.full_name ELSE public.profiles.full_name END,
    last_sign_in_at = COALESCE(EXCLUDED.last_sign_in_at, public.profiles.last_sign_in_at);

  IF v_has_pre THEN
    DELETE FROM public.facilitator_preapprovals WHERE id = v_pre.id;
  END IF;

  RETURN NEW;
END;
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
    ) combined
  ), '[]'::jsonb);
END;
$$;
