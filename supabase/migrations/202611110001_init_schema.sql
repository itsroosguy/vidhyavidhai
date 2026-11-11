-- 0001_init_schema.sql
-- Vidhya Vidhai Foundation Career Tours — Complete Relational PostgreSQL Schema
-- Zero "block" columns anywhere; Tamil Nadu + Approved Districts only.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 1. Organisations
CREATE TABLE IF NOT EXISTS public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  organisation_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_organisations_updated_at
  BEFORE UPDATE ON public.organisations
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

INSERT INTO public.organisations (name, organisation_code, status)
VALUES ('Vidhya Vidhai Foundation', 'VV_TN', 'ACTIVE')
ON CONFLICT (organisation_code) DO UPDATE
SET name = EXCLUDED.name, status = 'ACTIVE';

-- 2. Profiles (linked 1:1 to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_code text NOT NULL UNIQUE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) > 3),
  role text NOT NULL DEFAULT 'facilitator' CHECK (role IN ('facilitator', 'super_admin')),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  account_status text NOT NULL DEFAULT 'PENDING' CHECK (account_status IN ('APPROVED', 'PENDING', 'DENIED')),
  active boolean NOT NULL DEFAULT false,
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_organisation_id ON public.profiles(organisation_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role_status ON public.profiles(role, account_status, active);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

-- 2b. Facilitator Preapprovals (for facilitators added by Super Admin before first sign-in)
CREATE TABLE IF NOT EXISTS public.facilitator_preapprovals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) > 3),
  full_name text NOT NULL DEFAULT '',
  account_status text NOT NULL DEFAULT 'APPROVED' CHECK (account_status IN ('APPROVED', 'PENDING', 'DENIED')),
  active boolean NOT NULL DEFAULT true,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  preapproved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preapprovals_org_id ON public.facilitator_preapprovals(organisation_id);
CREATE INDEX IF NOT EXISTS idx_preapprovals_by ON public.facilitator_preapprovals(preapproved_by);

CREATE TRIGGER trg_facilitator_preapprovals_updated_at
  BEFORE UPDATE ON public.facilitator_preapprovals
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

-- 3. Canonical UDISE Schools Master
CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_record_id text NOT NULL UNIQUE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  udise_code text NOT NULL UNIQUE CHECK (udise_code ~ '^\d{11}$'),
  school_name text NOT NULL CHECK (length(btrim(school_name)) > 0),
  school_type text NOT NULL CHECK (length(btrim(school_type)) > 0),
  state text NOT NULL DEFAULT 'Tamil Nadu',
  district text NOT NULL CHECK (district IN ('Cuddalore', 'Nagapattinam', 'Sivaganga')),
  pin_code text NOT NULL CHECK (pin_code ~ '^\d{6}$'),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schools_org_id ON public.schools(organisation_id);
CREATE INDEX IF NOT EXISTS idx_schools_district_active ON public.schools(district, active);
CREATE INDEX IF NOT EXISTS idx_schools_created_by ON public.schools(created_by);
CREATE INDEX IF NOT EXISTS idx_schools_updated_by ON public.schools(updated_by);

CREATE TRIGGER trg_schools_updated_at
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

-- 4. Form Submissions (Master Prompt + Full SessionRecord Parity)
CREATE TABLE IF NOT EXISTS public.form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_reference text NOT NULL UNIQUE,
  session_record_id text NOT NULL UNIQUE,
  client_submission_key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,

  -- Master Prompt Required Columns
  distribution_channel_host_id text NOT NULL DEFAULT '',
  product_name text NOT NULL DEFAULT '',
  unique_student_id text NOT NULL DEFAULT 'AGGREGATE_COHORT',
  cc text NOT NULL DEFAULT 'IN',
  zipcode_postal_code text NOT NULL CHECK (zipcode_postal_code ~ '^\d{6}$'),
  completion_date date NOT NULL,
  completion_rate numeric(5,2) NOT NULL DEFAULT 100.00,
  student_csat numeric(4,2),
  underserved_reach text NOT NULL DEFAULT 'Yes',
  grade_of_students text NOT NULL DEFAULT '',

  -- Full SessionRecord Columns
  facilitator_name text NOT NULL CHECK (length(btrim(facilitator_name)) > 0),
  facilitator_email text NOT NULL CHECK (facilitator_email = lower(btrim(facilitator_email))),
  tour_id text NOT NULL,
  tour_name text NOT NULL,
  video_id text NOT NULL DEFAULT '',
  language text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  start_time text NOT NULL CHECK (start_time ~ '^\d{2}:\d{2}$'),
  end_time text NOT NULL CHECK (end_time ~ '^\d{2}:\d{2}$'),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  duration_formatted text NOT NULL,
  reporting_month text NOT NULL,
  submission_timestamp timestamptz NOT NULL DEFAULT now(),
  submission_date_formatted text NOT NULL,
  school_name text NOT NULL CHECK (length(btrim(school_name)) > 0),
  udise_code text NOT NULL CHECK (udise_code ~ '^\d{11}$'),
  school_type text NOT NULL,
  state text NOT NULL DEFAULT 'Tamil Nadu',
  district text NOT NULL CHECK (district IN ('Cuddalore', 'Nagapattinam', 'Sivaganga')),
  pin_code text NOT NULL CHECK (pin_code ~ '^\d{6}$'),
  session_type text NOT NULL CHECK (session_type IN ('single', 'combined')),
  total_classes integer NOT NULL CHECK (total_classes >= 1 AND total_classes <= 10),
  total_students_present integer NOT NULL CHECK (total_students_present > 0),
  total_question_a_responses integer NOT NULL DEFAULT 0 CHECK (total_question_a_responses >= 0),
  total_question_b_responses integer NOT NULL DEFAULT 0 CHECK (total_question_b_responses >= 0),
  overall_csat numeric(4,2),
  overall_itp numeric(4,2),
  teacher_score integer CHECK (teacher_score IS NULL OR (teacher_score >= 0 AND teacher_score <= 10)),
  teacher_classification text NOT NULL CHECK (teacher_classification IN ('Promoter', 'Passive', 'Detractor')),
  teacher_nps integer NOT NULL CHECK (teacher_nps IN (-100, 0, 100)),
  submission_status text NOT NULL DEFAULT 'COMMITTED' CHECK (submission_status IN ('COMMITTED', 'PENDING', 'CORRECTED')),
  sync_status text NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('SYNCED', 'PENDING_RETRY', 'FAILED', 'LOCAL_SANDBOX')),
  synced_at timestamptz,
  archived boolean NOT NULL DEFAULT false,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_user_id ON public.form_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_org_id ON public.form_submissions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_school_id ON public.form_submissions(school_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_district_date ON public.form_submissions(district, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_status_archived ON public.form_submissions(submission_status, archived, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_fac_email ON public.form_submissions(facilitator_email);
CREATE INDEX IF NOT EXISTS idx_form_submissions_udise ON public.form_submissions(udise_code);
CREATE INDEX IF NOT EXISTS idx_form_submissions_tour ON public.form_submissions(tour_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_submitted_at ON public.form_submissions(submitted_at DESC);

CREATE TRIGGER trg_form_submissions_updated_at
  BEFORE UPDATE ON public.form_submissions
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

-- 5. Form Submission Classes (1:N SessionDetailRecord children)
CREATE TABLE IF NOT EXISTS public.form_submission_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detail_record_id text NOT NULL UNIQUE,
  submission_id uuid NOT NULL REFERENCES public.form_submissions(id) ON DELETE CASCADE,
  session_record_id text NOT NULL,
  session_id text NOT NULL,
  row_order integer NOT NULL DEFAULT 1,
  grade text NOT NULL,
  section text NOT NULL,
  students_present integer NOT NULL CHECK (students_present > 0),
  question_a_score_5 integer NOT NULL DEFAULT 0 CHECK (question_a_score_5 >= 0),
  question_a_score_4 integer NOT NULL DEFAULT 0 CHECK (question_a_score_4 >= 0),
  question_a_score_3 integer NOT NULL DEFAULT 0 CHECK (question_a_score_3 >= 0),
  question_a_score_2 integer NOT NULL DEFAULT 0 CHECK (question_a_score_2 >= 0),
  question_a_score_1 integer NOT NULL DEFAULT 0 CHECK (question_a_score_1 >= 0),
  question_a_total integer NOT NULL DEFAULT 0 CHECK (question_a_total >= 0),
  question_a_weighted_score integer NOT NULL DEFAULT 0 CHECK (question_a_weighted_score >= 0),
  csat numeric(4,2),
  question_b_score_5 integer NOT NULL DEFAULT 0 CHECK (question_b_score_5 >= 0),
  question_b_score_4 integer NOT NULL DEFAULT 0 CHECK (question_b_score_4 >= 0),
  question_b_score_3 integer NOT NULL DEFAULT 0 CHECK (question_b_score_3 >= 0),
  question_b_score_2 integer NOT NULL DEFAULT 0 CHECK (question_b_score_2 >= 0),
  question_b_score_1 integer NOT NULL DEFAULT 0 CHECK (question_b_score_1 >= 0),
  question_b_total integer NOT NULL DEFAULT 0 CHECK (question_b_total >= 0),
  question_b_weighted_score integer NOT NULL DEFAULT 0 CHECK (question_b_weighted_score >= 0),
  itp numeric(4,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fsc_submission_id ON public.form_submission_classes(submission_id, row_order);
CREATE INDEX IF NOT EXISTS idx_fsc_grade ON public.form_submission_classes(grade);

CREATE TRIGGER trg_fsc_updated_at
  BEFORE UPDATE ON public.form_submission_classes
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

-- 6. Submission Audit Logs
CREATE TABLE IF NOT EXISTS public.submission_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_code text NOT NULL UNIQUE,
  submission_id uuid REFERENCES public.form_submissions(id) ON DELETE SET NULL,
  performed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email text NOT NULL DEFAULT '',
  action text NOT NULL,
  entity_type text NOT NULL DEFAULT 'Session',
  entity_id text NOT NULL DEFAULT '',
  previous_summary text NOT NULL DEFAULT '',
  new_summary text NOT NULL DEFAULT '',
  previous_data jsonb,
  updated_data jsonb,
  result text NOT NULL DEFAULT 'SUCCESS' CHECK (result IN ('SUCCESS', 'DENIED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_submission_id ON public.submission_audit_logs(submission_id);
CREATE INDEX IF NOT EXISTS idx_audit_performed_by ON public.submission_audit_logs(performed_by);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.submission_audit_logs(created_at DESC);

-- 7. Sync Logs (Secondary Google Sheets Sync Telemetry)
CREATE TABLE IF NOT EXISTS public.sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_code text NOT NULL UNIQUE,
  submission_id uuid REFERENCES public.form_submissions(id) ON DELETE SET NULL,
  client_submission_key text NOT NULL DEFAULT '',
  session_record_id text NOT NULL DEFAULT '',
  session_id text NOT NULL DEFAULT '',
  actor_email text NOT NULL DEFAULT '',
  destination text NOT NULL DEFAULT 'google_sheets',
  operation text NOT NULL DEFAULT 'sync',
  sync_status text NOT NULL CHECK (sync_status IN ('SYNCED', 'FAILED', 'PENDING_RETRY', 'LOCAL_SANDBOX')),
  retry_count integer NOT NULL DEFAULT 1,
  error_message text NOT NULL DEFAULT '',
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_submission_id ON public.sync_logs(submission_id);
CREATE INDEX IF NOT EXISTS idx_sync_created_at ON public.sync_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_status ON public.sync_logs(sync_status);

-- 8. Application Settings
CREATE TABLE IF NOT EXISTS public.application_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_settings_updated_by ON public.application_settings(updated_by);

CREATE TRIGGER trg_application_settings_updated_at
  BEFORE UPDATE ON public.application_settings
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

-- 9. Google Sheets Optional Secondary Bridge Configuration
CREATE TABLE IF NOT EXISTS public.sheets_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_key text NOT NULL UNIQUE DEFAULT 'primary',
  connected boolean NOT NULL DEFAULT false,
  auth_method text NOT NULL DEFAULT 'apps_script' CHECK (auth_method IN ('google_oauth', 'apps_script', 'local_sandbox')),
  connection_provider text NOT NULL DEFAULT 'apps_script' CHECK (connection_provider IN ('direct_browser', 'sheets_backend', 'apps_script', 'local_sandbox')),
  connected_account text NOT NULL DEFAULT '',
  spreadsheet_id text NOT NULL DEFAULT '',
  spreadsheet_name text NOT NULL DEFAULT '',
  spreadsheet_url text NOT NULL DEFAULT '',
  apps_script_webhook_url text NOT NULL DEFAULT '',
  connected_at timestamptz,
  connected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  connected_by_email text NOT NULL DEFAULT '',
  last_synced_at timestamptz,
  last_sync_status text NOT NULL DEFAULT 'IDLE' CHECK (last_sync_status IN ('IDLE', 'SYNCED', 'FAILED')),
  last_sync_message text NOT NULL DEFAULT '',
  initialized_tabs jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sheets_conn_connected_by ON public.sheets_connections(connected_by);

CREATE TRIGGER trg_sheets_connections_updated_at
  BEFORE UPDATE ON public.sheets_connections
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

-- 10. User Activity Logs
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_email text NOT NULL DEFAULT '',
  activity_type text NOT NULL,
  activity_description text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_user_id ON public.user_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON public.user_activity_logs(created_at DESC);
