-- 0002_security_rls_and_auth.sql
-- Auth triggers, server-enforced RBAC, RLS policies, and seed configuration

-- Security helper functions in private schema (not exposed by Data API)
CREATE OR REPLACE FUNCTION private.current_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT lower(btrim(COALESCE(
    (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
    (auth.jwt() ->> 'email'),
    ''
  )));
$$;

CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'super_admin'
      AND p.account_status = 'APPROVED'
      AND p.active = true
      AND lower(btrim(p.email)) IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org')
  );
$$;

CREATE OR REPLACE FUNCTION private.is_approved_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.account_status = 'APPROVED'
      AND p.active = true
  );
$$;

-- Helper used across triggers/RPCs to resolve the default Vidhya Vidhai organisation UUID
CREATE OR REPLACE FUNCTION private.default_organisation_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id
  FROM public.organisations
  WHERE organisation_code = 'VV_TN'
  LIMIT 1;
$$;

-- Protect profiles against self privilege escalation and preserve allowlisted Super Admins
CREATE OR REPLACE FUNCTION private.trg_protect_profiles_rbac()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_is_allowlisted boolean;
  v_bypass boolean;
BEGIN
  v_email := lower(btrim(COALESCE(NEW.email, '')));
  NEW.email := v_email;
  v_is_allowlisted := v_email IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org');
  v_bypass := COALESCE(current_setting('app.bypass_profile_rbac', true), '') = '1';

  -- Enforce allowlist invariants unconditionally
  IF v_is_allowlisted THEN
    NEW.role := 'super_admin';
    NEW.account_status := 'APPROVED';
    NEW.active := true;
    NEW.user_code := CASE
      WHEN v_email = 'brinthajayaprakash888@gmail.com' THEN 'SA_BRINTHA'
      ELSE 'SA_KARUNYA'
    END;
  ELSIF NEW.role = 'super_admin' THEN
    RAISE EXCEPTION 'Only allowlisted Super Administrators may hold super_admin privileges'
      USING ERRCODE = '42501';
  END IF;

  -- Block direct non-admin tampering even if called through REST
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
$$;

CREATE OR REPLACE TRIGGER trg_profiles_rbac
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_protect_profiles_rbac();

-- Sync authenticated signups from auth.users -> public.profiles (never trusts client-supplied role)
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

    IF v_has_pre THEN
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

      IF v_approval_mode = 'auto_approve' AND v_email_verified THEN
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

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_new_auth_user();

-- Promote auto-approve users when email confirmation completes after initial signup
CREATE OR REPLACE FUNCTION private.handle_auth_user_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_approval_mode text := 'auto_approve';
  v_is_allowlisted boolean;
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    v_is_allowlisted := lower(btrim(COALESCE(NEW.email, ''))) IN (
      'brinthajayaprakash888@gmail.com',
      'karunya@vidhyavidhai.org'
    );

    SELECT COALESCE(setting_value -> 'policy' ->> 'facilitatorApprovalMode', 'auto_approve')
    INTO v_approval_mode
    FROM public.application_settings
    WHERE setting_key = 'app_configuration'
    LIMIT 1;

    PERFORM set_config('app.bypass_profile_rbac', '1', true);

    IF v_is_allowlisted THEN
      UPDATE public.profiles
      SET role = 'super_admin', account_status = 'APPROVED', active = true
      WHERE id = NEW.id;
    ELSIF v_approval_mode = 'auto_approve' THEN
      UPDATE public.profiles
      SET account_status = 'APPROVED', active = true
      WHERE id = NEW.id AND account_status = 'PENDING';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_auth_user_confirmed();

-- Seed canonical application settings (Zero "Block", strictly Tamil Nadu & 3 districts)
INSERT INTO public.application_settings (setting_key, setting_value)
VALUES (
  'app_configuration',
  '{
    "programmeTimezone": "Asia/Kolkata",
    "stateName": "Tamil Nadu",
    "allowedDistricts": ["Cuddalore", "Nagapattinam", "Sivaganga"],
    "gradeOptions": ["8", "9", "10", "11", "12"],
    "sectionOptions": ["A", "B", "C", "D", "E", "F", "No section"],
    "schoolTypes": [
      "Government school",
      "Government aided school",
      "Private school",
      "Central government school (KV, JNV...)",
      "Tribal school (EMRS)",
      "Kasturba Gandhi Balika Vidyalaya (KGBV)",
      "Other"
    ],
    "tours": [
      {
        "tourId": "TOUR_AM",
        "tourName": "Amazon Music: Careers Behind the Beats",
        "tourCode": "AM",
        "active": true,
        "videoIdByLanguage": {
          "Tamil": "AFE-IN-AM-OV-TA-2026"
        }
      },
      {
        "tourId": "TOUR_RFC",
        "tourName": "Robotics Fulfillment Center",
        "tourCode": "RFC",
        "active": true,
        "videoIdByLanguage": {}
      }
    ],
    "languageOptions": ["English", "Hindi", "Tamil", "Telugu", "Kannada", "Marathi", "Gujarati", "Odia"],
    "languageCodes": {
      "English": "EN",
      "Hindi": "HI",
      "Tamil": "TA",
      "Telugu": "TE",
      "Kannada": "KN",
      "Marathi": "MR",
      "Gujarati": "GU",
      "Odia": "OR"
    },
    "schoolYear": "2026-27",
    "partnerName": "",
    "reportingDefaults": {
      "cc": "IN",
      "completionRate": 100,
      "underservedReach": "Yes",
      "dataSource": "Manual",
      "feedbackFrom": "students and teacher",
      "educatorId": "NA"
    },
    "policy": {
      "allowFacilitatorDeleteOwn": true,
      "allowFacilitatorExportOwn": false,
      "facilitatorApprovalMode": "auto_approve"
    },
    "exportTemplate63": null
  }'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;

-- Seed default optional Google Sheets metadata row (disconnected until configured by Super Admin)
INSERT INTO public.sheets_connections (
  connection_key, connected, auth_method, connection_provider,
  spreadsheet_id, spreadsheet_name, spreadsheet_url,
  last_sync_status, last_sync_message, initialized_tabs
)
VALUES (
  'primary',
  false,
  'apps_script',
  'apps_script',
  '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
  'Career Tours Live Sheet',
  'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0',
  'IDLE',
  'Primary storage is Supabase PostgreSQL. Google Sheets optional sync not configured yet.',
  '["Sessions", "Session Details", "Schools", "Facilitators", "Settings"]'::jsonb
)
ON CONFLICT (connection_key) DO NOTHING;

-- Backfill preexisting auth.users rows cleanly (existing unconfirmed account defaults to PENDING / inactive)
DO $$
DECLARE
  v_org_id uuid;
BEGIN
  v_org_id := private.default_organisation_id();
  PERFORM set_config('app.bypass_profile_rbac', '1', true);

  INSERT INTO public.profiles (
    id, user_code, full_name, email, role, organisation_id, account_status, active, last_sign_in_at
  )
  SELECT
    u.id,
    CASE
      WHEN lower(btrim(u.email)) = 'brinthajayaprakash888@gmail.com' THEN 'SA_BRINTHA'
      WHEN lower(btrim(u.email)) = 'karunya@vidhyavidhai.org' THEN 'SA_KARUNYA'
      ELSE 'USR_' || upper(substring(replace(u.id::text, '-', ''), 1, 8))
    END,
    btrim(COALESCE(
      NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(u.raw_user_meta_data ->> 'name', ''),
      split_part(lower(btrim(u.email)), '@', 1)
    )),
    lower(btrim(u.email)),
    CASE
      WHEN lower(btrim(u.email)) IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org') THEN 'super_admin'
      ELSE 'facilitator'
    END,
    v_org_id,
    CASE
      WHEN lower(btrim(u.email)) IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org') THEN 'APPROVED'
      ELSE 'PENDING'
    END,
    CASE
      WHEN lower(btrim(u.email)) IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org') THEN true
      ELSE false
    END,
    u.last_sign_in_at
  FROM auth.users u
  WHERE u.email IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
  ON CONFLICT (email) DO NOTHING;
END;
$$;

-- Explicit schema & privilege hardening: zero anonymous Data API access
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  private.current_user_email(),
  private.is_super_admin(),
  private.is_approved_user()
TO authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Enable & Force Row Level Security on every public table
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.facilitator_preapprovals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilitator_preapprovals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools FORCE ROW LEVEL SECURITY;

ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.form_submission_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submission_classes FORCE ROW LEVEL SECURITY;

ALTER TABLE public.submission_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_audit_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.application_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sheets_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sheets_connections FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_logs FORCE ROW LEVEL SECURITY;

-- Single unified PERMISSIVE policy per (table, command) for `authenticated`
-- (Prevents multiple_permissive_policies and auth_rls_initplan advisor warnings)

-- 1. organisations
CREATE POLICY "organisations_select" ON public.organisations
  FOR SELECT TO authenticated
  USING ((SELECT private.is_approved_user()) OR (SELECT private.is_super_admin()));

CREATE POLICY "organisations_insert" ON public.organisations
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "organisations_update" ON public.organisations
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_super_admin()))
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "organisations_delete" ON public.organisations
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 2. profiles
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id OR (SELECT private.is_super_admin()));

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_super_admin()))
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 3. facilitator_preapprovals (Super Admin only)
CREATE POLICY "facilitator_preapprovals_select" ON public.facilitator_preapprovals
  FOR SELECT TO authenticated
  USING ((SELECT private.is_super_admin()));

CREATE POLICY "facilitator_preapprovals_insert" ON public.facilitator_preapprovals
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "facilitator_preapprovals_update" ON public.facilitator_preapprovals
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_super_admin()))
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "facilitator_preapprovals_delete" ON public.facilitator_preapprovals
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 4. schools
CREATE POLICY "schools_select" ON public.schools
  FOR SELECT TO authenticated
  USING ((SELECT private.is_approved_user()) OR (SELECT private.is_super_admin()));

CREATE POLICY "schools_insert" ON public.schools
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "schools_update" ON public.schools
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_super_admin()))
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "schools_delete" ON public.schools
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 5. form_submissions
CREATE POLICY "form_submissions_select" ON public.form_submissions
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_super_admin())
    OR ((SELECT private.is_approved_user()) AND user_id = (SELECT auth.uid()))
  );

CREATE POLICY "form_submissions_insert" ON public.form_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_super_admin())
    OR ((SELECT private.is_approved_user()) AND user_id = (SELECT auth.uid()))
  );

CREATE POLICY "form_submissions_update" ON public.form_submissions
  FOR UPDATE TO authenticated
  USING (
    (SELECT private.is_super_admin())
    OR ((SELECT private.is_approved_user()) AND user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT private.is_super_admin())
    OR ((SELECT private.is_approved_user()) AND user_id = (SELECT auth.uid()))
  );

CREATE POLICY "form_submissions_delete" ON public.form_submissions
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 6. form_submission_classes
CREATE POLICY "form_submission_classes_select" ON public.form_submission_classes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.form_submissions fs
      WHERE fs.id = submission_id
        AND (
          (SELECT private.is_super_admin())
          OR ((SELECT private.is_approved_user()) AND fs.user_id = (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "form_submission_classes_insert" ON public.form_submission_classes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.form_submissions fs
      WHERE fs.id = submission_id
        AND (
          (SELECT private.is_super_admin())
          OR ((SELECT private.is_approved_user()) AND fs.user_id = (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "form_submission_classes_update" ON public.form_submission_classes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.form_submissions fs
      WHERE fs.id = submission_id
        AND (
          (SELECT private.is_super_admin())
          OR ((SELECT private.is_approved_user()) AND fs.user_id = (SELECT auth.uid()))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.form_submissions fs
      WHERE fs.id = submission_id
        AND (
          (SELECT private.is_super_admin())
          OR ((SELECT private.is_approved_user()) AND fs.user_id = (SELECT auth.uid()))
        )
    )
  );

CREATE POLICY "form_submission_classes_delete" ON public.form_submission_classes
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 7. submission_audit_logs (Super Admin read & manage only)
CREATE POLICY "submission_audit_logs_select" ON public.submission_audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT private.is_super_admin()));

CREATE POLICY "submission_audit_logs_insert" ON public.submission_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "submission_audit_logs_update" ON public.submission_audit_logs
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_super_admin()))
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "submission_audit_logs_delete" ON public.submission_audit_logs
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 8. sync_logs (Super Admin only)
CREATE POLICY "sync_logs_select" ON public.sync_logs
  FOR SELECT TO authenticated
  USING ((SELECT private.is_super_admin()));

CREATE POLICY "sync_logs_insert" ON public.sync_logs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "sync_logs_update" ON public.sync_logs
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_super_admin()))
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "sync_logs_delete" ON public.sync_logs
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 9. application_settings
CREATE POLICY "application_settings_select" ON public.application_settings
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_super_admin())
    OR ((SELECT private.is_approved_user()) AND setting_key = 'app_configuration')
  );

CREATE POLICY "application_settings_insert" ON public.application_settings
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "application_settings_update" ON public.application_settings
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_super_admin()))
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "application_settings_delete" ON public.application_settings
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 10. sheets_connections (Super Admin only)
CREATE POLICY "sheets_connections_select" ON public.sheets_connections
  FOR SELECT TO authenticated
  USING ((SELECT private.is_super_admin()));

CREATE POLICY "sheets_connections_insert" ON public.sheets_connections
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "sheets_connections_update" ON public.sheets_connections
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_super_admin()))
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "sheets_connections_delete" ON public.sheets_connections
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));

-- 11. user_activity_logs
CREATE POLICY "user_activity_logs_select" ON public.user_activity_logs
  FOR SELECT TO authenticated
  USING ((SELECT private.is_super_admin()) OR user_id = (SELECT auth.uid()));

CREATE POLICY "user_activity_logs_insert" ON public.user_activity_logs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_super_admin()) OR user_id = (SELECT auth.uid()));

CREATE POLICY "user_activity_logs_update" ON public.user_activity_logs
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_super_admin()))
  WITH CHECK ((SELECT private.is_super_admin()));

CREATE POLICY "user_activity_logs_delete" ON public.user_activity_logs
  FOR DELETE TO authenticated
  USING ((SELECT private.is_super_admin()));
