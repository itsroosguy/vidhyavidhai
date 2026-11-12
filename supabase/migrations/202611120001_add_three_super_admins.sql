-- Promote three existing approved facilitator accounts to allowlisted Super Administrators:
--   ram@vidhyavidhai.org   -> SA_RAM
--   regi@vidhyavidhai.org  -> SA_REGI
--   nisha@vidhyavidhai.org -> SA_NISHA
-- Preserves existing auth.users credentials, user UUIDs, and all existing form_submissions data.

CREATE OR REPLACE FUNCTION private.is_allowlisted_super_admin(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT lower(btrim(COALESCE(p_email, ''))) IN (
    'brinthajayaprakash888@gmail.com',
    'karunya@vidhyavidhai.org',
    'ram@vidhyavidhai.org',
    'regi@vidhyavidhai.org',
    'nisha@vidhyavidhai.org'
  );
$function$;

CREATE OR REPLACE FUNCTION private.super_admin_user_code(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE lower(btrim(COALESCE(p_email, '')))
    WHEN 'brinthajayaprakash888@gmail.com' THEN 'SA_BRINTHA'
    WHEN 'karunya@vidhyavidhai.org' THEN 'SA_KARUNYA'
    WHEN 'ram@vidhyavidhai.org' THEN 'SA_RAM'
    WHEN 'regi@vidhyavidhai.org' THEN 'SA_REGI'
    WHEN 'nisha@vidhyavidhai.org' THEN 'SA_NISHA'
    ELSE NULL
  END;
$function$;

REVOKE ALL ON FUNCTION private.is_allowlisted_super_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_allowlisted_super_admin(text) TO postgres;

REVOKE ALL ON FUNCTION private.super_admin_user_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.super_admin_user_code(text) TO postgres;

CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'super_admin'
      AND p.account_status = 'APPROVED'
      AND p.active = true
      AND private.is_allowlisted_super_admin(p.email)
  );
$function$;

CREATE OR REPLACE FUNCTION private.trg_protect_profiles_rbac()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_email text;
  v_is_allowlisted boolean;
  v_bypass boolean;
BEGIN
  v_email := lower(btrim(COALESCE(NEW.email, '')));
  NEW.email := v_email;
  v_is_allowlisted := private.is_allowlisted_super_admin(v_email);
  v_bypass := COALESCE(current_setting('app.bypass_profile_rbac', true), '') = '1';

  IF v_is_allowlisted THEN
    NEW.role := 'super_admin';
    NEW.account_status := 'APPROVED';
    NEW.active := true;
    NEW.user_code := private.super_admin_user_code(v_email);
  ELSIF NEW.role = 'super_admin' THEN
    RAISE EXCEPTION 'Only allowlisted Super Administrators may hold super_admin privileges'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND NOT v_bypass AND auth.uid() IS NOT NULL AND NOT private.is_super_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.account_status IS DISTINCT FROM OLD.account_status
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
       OR NEW.user_code IS DISTINCT FROM OLD.user_code THEN
      RAISE EXCEPTION 'Insufficient privileges to modify protected profile attributes'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.trg_protect_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub_count integer := 0;
BEGIN
  IF private.is_allowlisted_super_admin(OLD.email) THEN
    RAISE EXCEPTION 'Allowlisted Super Administrators cannot be removed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO v_sub_count
  FROM public.form_submissions
  WHERE user_id = OLD.id;

  IF v_sub_count > 0 THEN
    RAISE EXCEPTION 'Facilitator has % committed session(s); deactivate instead of deleting to preserve history', v_sub_count
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
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

  v_is_allowlisted := private.is_allowlisted_super_admin(v_email);
  v_require_admin_approval := COALESCE((NEW.raw_app_meta_data ->> 'require_admin_approval')::boolean, false);
  v_admin_provisioned := COALESCE((NEW.raw_app_meta_data ->> 'admin_provisioned')::boolean, false);

  IF v_is_allowlisted THEN
    v_role := 'super_admin';
    v_status := 'APPROVED';
    v_active := true;
    v_user_code := private.super_admin_user_code(v_email);
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
$function$;

CREATE OR REPLACE FUNCTION private.handle_auth_user_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_approval_mode text := 'auto_approve';
  v_is_allowlisted boolean;
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    v_is_allowlisted := private.is_allowlisted_super_admin(NEW.email);

    SELECT COALESCE(setting_value -> 'policy' ->> 'facilitatorApprovalMode', 'auto_approve')
    INTO v_approval_mode
    FROM public.application_settings
    WHERE setting_key = 'app_configuration'
    LIMIT 1;

    PERFORM set_config('app.bypass_profile_rbac', '1', true);

    IF v_is_allowlisted THEN
      UPDATE public.profiles
      SET
        role = 'super_admin',
        account_status = 'APPROVED',
        active = true,
        user_code = private.super_admin_user_code(email)
      WHERE id = NEW.id;
    ELSIF v_approval_mode = 'auto_approve' THEN
      UPDATE public.profiles
      SET account_status = 'APPROVED', active = true
      WHERE id = NEW.id AND account_status = 'PENDING';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_auth_email text;
  v_auth_name text;
  v_email_verified boolean := false;
  v_provider text := 'email';
  v_org_id uuid;
  v_org_name text;
  v_profile public.profiles%ROWTYPE;
  v_pre public.facilitator_preapprovals%ROWTYPE;
  v_has_pre boolean := false;
  v_approval_mode text := 'auto_approve';
  v_is_allowlisted boolean := false;
  v_role text := 'facilitator';
  v_status text := 'PENDING';
  v_active boolean := false;
  v_user_code text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;

  IF NOT FOUND THEN
    SELECT
      lower(btrim(COALESCE(u.email, ''))),
      btrim(COALESCE(
        NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
        NULLIF(u.raw_user_meta_data ->> 'name', ''),
        split_part(lower(btrim(COALESCE(u.email, ''))), '@', 1)
      )),
      (u.email_confirmed_at IS NOT NULL)
        OR (lower(COALESCE(u.raw_app_meta_data ->> 'provider', 'email')) = 'google')
        OR COALESCE((u.raw_user_meta_data ->> 'email_verified')::boolean, false),
      lower(COALESCE(u.raw_app_meta_data ->> 'provider', 'email'))
    INTO v_auth_email, v_auth_name, v_email_verified, v_provider
    FROM auth.users u
    WHERE u.id = v_uid;

    IF COALESCE(v_auth_email, '') = '' THEN
      RAISE EXCEPTION 'Authenticated user lacks a valid email' USING ERRCODE = '22023';
    END IF;

    v_org_id := private.default_organisation_id();
    v_is_allowlisted := private.is_allowlisted_super_admin(v_auth_email);

    IF v_is_allowlisted THEN
      v_role := 'super_admin';
      v_status := 'APPROVED';
      v_active := true;
      v_user_code := private.super_admin_user_code(v_auth_email);
    ELSE
      SELECT * INTO v_pre
      FROM public.facilitator_preapprovals fp
      WHERE fp.email = v_auth_email
      LIMIT 1;
      v_has_pre := FOUND;

      IF v_has_pre THEN
        v_status := v_pre.account_status;
        v_active := v_pre.active AND (v_pre.account_status = 'APPROVED');
        v_org_id := v_pre.organisation_id;
        IF length(btrim(COALESCE(v_pre.full_name, ''))) > 0 THEN
          v_auth_name := btrim(v_pre.full_name);
        END IF;
      ELSE
        SELECT COALESCE(setting_value -> 'policy' ->> 'facilitatorApprovalMode', 'auto_approve')
        INTO v_approval_mode
        FROM public.application_settings
        WHERE setting_key = 'app_configuration'
        LIMIT 1;

        IF v_approval_mode = 'auto_approve' AND v_email_verified THEN
          v_status := 'APPROVED';
          v_active := true;
        END IF;
      END IF;

      v_user_code := 'USR_' || upper(substring(replace(v_uid::text, '-', ''), 1, 8));
    END IF;

    PERFORM set_config('app.bypass_profile_rbac', '1', true);

    INSERT INTO public.profiles (
      id, user_code, full_name, email, role, organisation_id, account_status, active, last_sign_in_at
    )
    VALUES (
      v_uid, v_user_code, v_auth_name, v_auth_email, v_role, v_org_id, v_status, v_active, now()
    )
    ON CONFLICT (id) DO UPDATE
    SET last_sign_in_at = now()
    RETURNING * INTO v_profile;

    IF v_has_pre THEN
      DELETE FROM public.facilitator_preapprovals WHERE id = v_pre.id;
    END IF;
  ELSE
    PERFORM set_config('app.bypass_profile_rbac', '1', true);
    UPDATE public.profiles SET last_sign_in_at = now() WHERE id = v_uid
    RETURNING * INTO v_profile;
  END IF;

  SELECT name INTO v_org_name FROM public.organisations WHERE id = v_profile.organisation_id;

  RETURN jsonb_build_object(
    'userId', v_profile.user_code,
    'authUserId', v_profile.id::text,
    'name', v_profile.full_name,
    'email', v_profile.email,
    'role', v_profile.role,
    'active', v_profile.active,
    'status', v_profile.account_status,
    'organisationId', v_profile.organisation_id::text,
    'organisationName', COALESCE(v_org_name, 'Vidhya Vidhai Foundation')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_manage_facilitator(
  p_user_id text,
  p_name text,
  p_email text,
  p_role text,
  p_active boolean,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_name text := btrim(COALESCE(p_name, ''));
  v_status text := upper(btrim(COALESCE(p_status, CASE WHEN COALESCE(p_active, true) THEN 'APPROVED' ELSE 'DENIED' END)));
  v_active boolean := COALESCE(p_active, true) AND (v_status = 'APPROVED');
  v_is_allowlisted boolean;
  v_profile public.profiles%ROWTYPE;
  v_pre public.facilitator_preapprovals%ROWTYPE;
  v_org_id uuid := private.default_organisation_id();
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Valid email address is required' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('APPROVED', 'PENDING', 'DENIED') THEN
    RAISE EXCEPTION 'Invalid approval status' USING ERRCODE = '22023';
  END IF;

  v_is_allowlisted := private.is_allowlisted_super_admin(v_email);
  IF COALESCE(p_role, 'facilitator') = 'super_admin' AND NOT v_is_allowlisted THEN
    RAISE EXCEPTION 'Only allowlisted Super Administrators may hold super_admin role' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile FROM public.profiles
  WHERE email = v_email OR (NULLIF(p_user_id, '') IS NOT NULL AND user_code = p_user_id)
  LIMIT 1;

  IF FOUND THEN
    IF private.is_allowlisted_super_admin(v_profile.email) THEN
      v_status := 'APPROVED';
      v_active := true;
    END IF;
    PERFORM set_config('app.bypass_profile_rbac', '1', true);
    UPDATE public.profiles
    SET
      full_name = CASE WHEN v_name <> '' THEN v_name ELSE public.profiles.full_name END,
      account_status = v_status,
      active = v_active
    WHERE id = v_profile.id
    RETURNING * INTO v_profile;

    INSERT INTO public.submission_audit_logs (
      audit_code, performed_by, actor_email, action, entity_type, entity_id,
      previous_summary, new_summary, result
    )
    VALUES (
      'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_uid, private.current_user_email(), 'UPDATE_USER', 'User', v_profile.email,
      '', v_profile.account_status || ' active=' || v_profile.active::text, 'SUCCESS'
    );

    RETURN jsonb_build_object(
      'userId', v_profile.user_code,
      'name', v_profile.full_name,
      'email', v_profile.email,
      'role', v_profile.role,
      'active', v_profile.active,
      'status', v_profile.account_status,
      'createdAt', to_char(v_profile.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(v_profile.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  ELSE
    INSERT INTO public.facilitator_preapprovals (
      email, full_name, account_status, active, organisation_id, preapproved_by
    )
    VALUES (
      v_email,
      CASE WHEN v_name <> '' THEN v_name ELSE split_part(v_email, '@', 1) END,
      v_status, v_active, v_org_id, v_uid
    )
    ON CONFLICT (email) DO UPDATE
    SET
      full_name = CASE WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name ELSE public.facilitator_preapprovals.full_name END,
      account_status = EXCLUDED.account_status,
      active = EXCLUDED.active,
      preapproved_by = EXCLUDED.preapproved_by
    RETURNING * INTO v_pre;

    INSERT INTO public.submission_audit_logs (
      audit_code, performed_by, actor_email, action, entity_type, entity_id,
      previous_summary, new_summary, result
    )
    VALUES (
      'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_uid, private.current_user_email(), 'PREAPPROVE_USER', 'User', v_pre.email,
      '', v_pre.account_status || ' active=' || v_pre.active::text, 'SUCCESS'
    );

    RETURN jsonb_build_object(
      'userId', 'PRE_' || upper(substring(replace(v_pre.id::text, '-', ''), 1, 8)),
      'name', v_pre.full_name,
      'email', v_pre.email,
      'role', 'facilitator',
      'active', v_pre.active,
      'status', v_pre.account_status,
      'createdAt', to_char(v_pre.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(v_pre.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_managed_directory()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
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
          WHEN private.is_allowlisted_super_admin(au.email) THEN 'super_admin'
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
$function$;

DO $$
DECLARE
  v_row public.profiles%ROWTYPE;
BEGIN
  PERFORM set_config('app.bypass_profile_rbac', '1', true);

  FOR v_row IN
    UPDATE public.profiles
    SET
      role = 'super_admin',
      account_status = 'APPROVED',
      active = true,
      user_code = private.super_admin_user_code(email)
    WHERE lower(btrim(email)) IN (
      'ram@vidhyavidhai.org',
      'regi@vidhyavidhai.org',
      'nisha@vidhyavidhai.org'
    )
    RETURNING *
  LOOP
    INSERT INTO public.submission_audit_logs (
      audit_code, performed_by, actor_email, action, entity_type, entity_id,
      previous_summary, new_summary, result
    )
    VALUES (
      'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_row.id,
      'system_migration',
      'PROMOTE_SUPER_ADMIN',
      'User',
      v_row.email,
      'role=facilitator',
      'role=super_admin status=' || v_row.account_status || ' active=' || v_row.active::text || ' user_code=' || v_row.user_code,
      'SUCCESS'
    );
  END LOOP;
END $$;
