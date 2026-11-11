-- 0003_rpcs_storage_realtime.sql
-- Transactional RPCs, Server-Side Metrics & Validation, Storage Bucket, and Realtime Publication

CREATE OR REPLACE FUNCTION private.format_duration_human(p_mins integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days integer;
  v_hours integer;
  v_mins integer;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  IF p_mins IS NULL OR p_mins <= 0 THEN
    RETURN '—';
  END IF;

  v_days := p_mins / 1440;
  v_hours := (p_mins % 1440) / 60;
  v_mins := p_mins % 60;

  IF v_days > 0 THEN
    v_parts := array_append(v_parts, v_days || CASE WHEN v_days = 1 THEN ' day' ELSE ' days' END);
  END IF;
  IF v_hours > 0 THEN
    v_parts := array_append(v_parts, v_hours || CASE WHEN v_hours = 1 THEN ' hr' ELSE ' hrs' END);
  END IF;
  IF v_mins > 0 OR array_length(v_parts, 1) IS NULL THEN
    v_parts := array_append(v_parts, v_mins || CASE WHEN v_mins = 1 THEN ' min' ELSE ' mins' END);
  END IF;

  RETURN array_to_string(v_parts, ' ');
END;
$$;

CREATE OR REPLACE FUNCTION private.jsonb_array_has_text(p_arr jsonb, p_target text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(p_arr, '[]'::jsonb)) AS x(val)
    WHERE x.val = p_target
  );
$$;

CREATE OR REPLACE FUNCTION private.build_session_record_json(p_submission_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'sessionRecordId', fs.session_record_id,
    'sessionId', fs.submission_reference,
    'clientSubmissionKey', fs.client_submission_key,
    'facilitatorName', fs.facilitator_name,
    'facilitatorEmail', fs.facilitator_email,
    'facilitatorUserId', COALESCE(p.user_code, fs.user_id::text),
    'tourId', fs.tour_id,
    'tourName', fs.tour_name,
    'videoId', fs.video_id,
    'language', fs.language,
    'startDate', to_char(fs.start_date, 'YYYY-MM-DD'),
    'endDate', to_char(fs.end_date, 'YYYY-MM-DD'),
    'startTime', fs.start_time,
    'endTime', fs.end_time,
    'durationMinutes', fs.duration_minutes,
    'durationFormatted', fs.duration_formatted,
    'reportingMonth', fs.reporting_month,
    'submissionTimestamp', to_char(fs.submission_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'submissionDateFormatted', fs.submission_date_formatted,
    'schoolName', fs.school_name,
    'udiseCode', fs.udise_code,
    'schoolType', fs.school_type,
    'state', fs.state,
    'district', fs.district,
    'pinCode', fs.pin_code,
    'sessionType', fs.session_type,
    'totalClasses', fs.total_classes,
    'totalStudentsPresent', fs.total_students_present,
    'totalQuestionAResponses', fs.total_question_a_responses,
    'totalQuestionBResponses', fs.total_question_b_responses,
    'overallCsat', fs.overall_csat,
    'overallItp', fs.overall_itp,
    'teacherScore', fs.teacher_score,
    'teacherClassification', fs.teacher_classification,
    'teacherNps', fs.teacher_nps,
    'submissionStatus', fs.submission_status,
    'syncStatus', fs.sync_status,
    'syncedAt', CASE WHEN fs.synced_at IS NOT NULL THEN to_char(fs.synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
    'createdAt', to_char(fs.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(fs.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdBy', fs.created_by,
    'updatedBy', fs.updated_by,
    'archived', fs.archived,
    'details', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'detailRecordId', d.detail_record_id,
          'sessionRecordId', d.session_record_id,
          'sessionId', d.session_id,
          'grade', d.grade,
          'section', d.section,
          'studentsPresent', d.students_present,
          'questionAScore5', d.question_a_score_5,
          'questionAScore4', d.question_a_score_4,
          'questionAScore3', d.question_a_score_3,
          'questionAScore2', d.question_a_score_2,
          'questionAScore1', d.question_a_score_1,
          'questionATotal', d.question_a_total,
          'questionAWeightedScore', d.question_a_weighted_score,
          'csat', d.csat,
          'questionBScore5', d.question_b_score_5,
          'questionBScore4', d.question_b_score_4,
          'questionBScore3', d.question_b_score_3,
          'questionBScore2', d.question_b_score_2,
          'questionBScore1', d.question_b_score_1,
          'questionBTotal', d.question_b_total,
          'questionBWeightedScore', d.question_b_weighted_score,
          'itp', d.itp,
          'createdAt', to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'updatedAt', to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
        ORDER BY d.row_order, d.created_at
      )
      FROM public.form_submission_classes d
      WHERE d.submission_id = fs.id
    ), '[]'::jsonb)
  )
  FROM public.form_submissions fs
  LEFT JOIN public.profiles p ON p.id = fs.user_id
  WHERE fs.id = p_submission_id;
$$;

-- 1. Authenticated user profile resolution (backfills cleanly if triggered on pre-existing auth user)
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    v_is_allowlisted := v_auth_email IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org');

    IF v_is_allowlisted THEN
      v_role := 'super_admin';
      v_status := 'APPROVED';
      v_active := true;
      v_user_code := CASE
        WHEN v_auth_email = 'brinthajayaprakash888@gmail.com' THEN 'SA_BRINTHA'
        ELSE 'SA_KARUNYA'
      END;
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
$$;

-- 2. Sanitized app configuration fetch
CREATE OR REPLACE FUNCTION public.get_sanitized_app_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cfg jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT (private.is_approved_user() OR private.is_super_admin()) THEN
    RAISE EXCEPTION 'Account approval required' USING ERRCODE = '42501';
  END IF;

  SELECT setting_value INTO v_cfg
  FROM public.application_settings
  WHERE setting_key = 'app_configuration'
  LIMIT 1;

  RETURN COALESCE(v_cfg, '{}'::jsonb);
END;
$$;

-- 3. Atomic Form Submission RPC (idempotent, IST-exact, PG advisory lock sequence)
CREATE OR REPLACE FUNCTION public.submit_form_session(p_values jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller public.profiles%ROWTYPE;
  v_is_super boolean := false;
  v_cfg jsonb;
  v_tz text;
  v_client_key text;
  v_existing_sub public.form_submissions%ROWTYPE;
  v_fac_name text;
  v_fac_email text;
  v_owner_id uuid;
  v_tour_id text;
  v_tour jsonb;
  v_tour_name text;
  v_language text;
  v_video_id text;
  v_start_date_str text;
  v_end_date_str text;
  v_start_date date;
  v_end_date date;
  v_today_ist date;
  v_start_time text;
  v_end_time text;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_duration_mins integer;
  v_duration_formatted text;
  v_reporting_month text;
  v_school_name text;
  v_udise text;
  v_school_type text;
  v_state text;
  v_district text;
  v_pin text;
  v_session_mode text;
  v_classes jsonb;
  v_total_classes integer;
  v_teacher_group text;
  v_teacher_exact_raw text;
  v_teacher_exact integer := NULL;
  v_teacher_class text;
  v_teacher_nps integer;

  v_first_grade text;
  v_first_section text;
  v_grade_tok text;
  v_class_tok text;
  v_prefix text;
  v_next_seq integer;
  v_session_id text;
  v_sub_id uuid;
  v_record_id text;
  v_school_id uuid;
  v_existing_school public.schools%ROWTYPE;
  v_udise_conflict text := NULL;

  v_elem jsonb;
  v_idx integer := 0;
  v_grade text;
  v_section text;
  v_present integer;
  v_qa5 integer; v_qa4 integer; v_qa3 integer; v_qa2 integer; v_qa1 integer;
  v_qb5 integer; v_qb4 integer; v_qb3 integer; v_qb2 integer; v_qb1 integer;
  v_qa_tot integer; v_qa_w integer; v_csat numeric(4,2);
  v_qb_tot integer; v_qb_w integer; v_itp numeric(4,2);

  v_sum_present integer := 0;
  v_sum_qa_tot integer := 0;
  v_sum_qa_w integer := 0;
  v_sum_qb_tot integer := 0;
  v_sum_qb_w integer := 0;
  v_overall_csat numeric(4,2) := NULL;
  v_overall_itp numeric(4,2) := NULL;
  v_grades_list text[] := ARRAY[]::text[];
  v_seen_pairs text[] := ARRAY[]::text[];
  v_pair text;
  v_warnings jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_sub_date_fmt text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR v_caller.account_status <> 'APPROVED' OR NOT v_caller.active THEN
    RAISE EXCEPTION 'Your account must be approved by an administrator before submitting' USING ERRCODE = '42501';
  END IF;
  v_is_super := private.is_super_admin();

  v_client_key := COALESCE(NULLIF(btrim(p_values ->> 'clientSubmissionKey'), ''), gen_random_uuid()::text);

  -- Idempotency check on client_submission_key
  SELECT * INTO v_existing_sub
  FROM public.form_submissions
  WHERE client_submission_key = v_client_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_sub.user_id <> v_uid AND NOT v_is_super THEN
      RAISE EXCEPTION 'Duplicate submission key belongs to another account' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'deduplicated', true,
      'session', private.build_session_record_json(v_existing_sub.id),
      'warnings', '[]'::jsonb,
      'schoolUdiseConflict', NULL
    );
  END IF;

  SELECT setting_value INTO v_cfg
  FROM public.application_settings
  WHERE setting_key = 'app_configuration'
  LIMIT 1;
  v_tz := COALESCE(NULLIF(v_cfg ->> 'programmeTimezone', ''), 'Asia/Kolkata');

  -- Identity enforcement: Facilitators ALWAYS commit under their own authenticated identity
  IF v_is_super AND NULLIF(btrim(p_values ->> 'facilitatorEmail'), '') IS NOT NULL THEN
    v_fac_email := lower(btrim(p_values ->> 'facilitatorEmail'));
    SELECT id INTO v_owner_id FROM public.profiles WHERE email = v_fac_email LIMIT 1;
    v_owner_id := COALESCE(v_owner_id, v_uid);
  ELSE
    v_fac_email := lower(btrim(v_caller.email));
    v_owner_id := v_uid;
  END IF;
  v_fac_name := COALESCE(NULLIF(btrim(p_values ->> 'facilitatorName'), ''), NULLIF(v_caller.full_name, ''), v_fac_email);

  -- Tour & language lookup
  v_tour_id := btrim(COALESCE(p_values ->> 'tourId', ''));
  SELECT t INTO v_tour
  FROM jsonb_array_elements(COALESCE(v_cfg -> 'tours', '[]'::jsonb)) AS t
  WHERE (t ->> 'tourId') = v_tour_id AND COALESCE((t ->> 'active')::boolean, false) = true
  LIMIT 1;
  IF v_tour IS NULL THEN
    RAISE EXCEPTION 'Please choose a valid active Career Tour' USING ERRCODE = '22023';
  END IF;
  v_tour_name := btrim(v_tour ->> 'tourName');

  v_language := btrim(COALESCE(p_values ->> 'language', ''));
  IF NOT private.jsonb_array_has_text(v_cfg -> 'languageOptions', v_language) THEN
    RAISE EXCEPTION 'Please choose a valid language option' USING ERRCODE = '22023';
  END IF;

  v_video_id := btrim(COALESCE(v_tour -> 'videoIdByLanguage' ->> v_language, ''));
  IF v_video_id = '' THEN
    v_video_id := 'Not configured for ' || v_tour_name || ' (' || COALESCE(NULLIF(v_language, ''), 'language unset') || ')';
  END IF;

  -- Dates & Times in Asia/Kolkata
  v_start_date_str := btrim(COALESCE(p_values ->> 'startDate', ''));
  v_end_date_str := btrim(COALESCE(p_values ->> 'endDate', ''));
  v_start_time := btrim(COALESCE(p_values ->> 'startTime', ''));
  v_end_time := btrim(COALESCE(p_values ->> 'endTime', ''));

  IF v_start_date_str !~ '^\d{4}-\d{2}-\d{2}$' OR v_end_date_str !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Start date and end date must use YYYY-MM-DD format' USING ERRCODE = '22023';
  END IF;
  IF v_start_time !~ '^\d{2}:\d{2}$' OR v_end_time !~ '^\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'Start time and end time must use HH:MM 24-hour format' USING ERRCODE = '22023';
  END IF;

  v_start_date := v_start_date_str::date;
  v_end_date := v_end_date_str::date;
  v_today_ist := (v_now AT TIME ZONE v_tz)::date;

  IF v_start_date > v_today_ist OR v_end_date > v_today_ist THEN
    RAISE EXCEPTION 'Session dates cannot be in the future' USING ERRCODE = '22023';
  END IF;
  IF v_end_date < v_start_date THEN
    RAISE EXCEPTION 'End date cannot be earlier than start date' USING ERRCODE = '22023';
  END IF;

  v_start_ts := ((v_start_date::timestamp + v_start_time::time) AT TIME ZONE v_tz);
  v_end_ts := ((v_end_date::timestamp + v_end_time::time) AT TIME ZONE v_tz);
  v_duration_mins := floor(EXTRACT(EPOCH FROM (v_end_ts - v_start_ts)) / 60)::integer;
  IF v_duration_mins IS NULL OR v_duration_mins <= 0 THEN
    RAISE EXCEPTION 'Session end date and time must be later than start date and time' USING ERRCODE = '22023';
  END IF;
  IF v_duration_mins > 480 THEN
    v_warnings := v_warnings || jsonb_build_array(
      'Session duration is ' || round(v_duration_mins / 60.0) || ' hours (' || v_duration_mins || ' mins).'
    );
  END IF;

  v_duration_formatted := private.format_duration_human(v_duration_mins);
  v_reporting_month := btrim(to_char(v_start_date, 'FMMonth'));
  v_sub_date_fmt := to_char((v_now AT TIME ZONE v_tz)::date, 'DD-MM-YYYY');

  -- School validation (Zero Block; strictly Tamil Nadu + approved districts)
  v_school_name := btrim(COALESCE(p_values ->> 'schoolName', ''));
  v_udise := btrim(COALESCE(p_values ->> 'udiseCode', ''));
  v_school_type := btrim(COALESCE(p_values ->> 'schoolType', ''));
  v_state := COALESCE(NULLIF(btrim(v_cfg ->> 'stateName'), ''), 'Tamil Nadu');
  v_district := btrim(COALESCE(p_values ->> 'district', ''));
  v_pin := btrim(COALESCE(p_values ->> 'pinCode', ''));

  IF v_school_name = '' THEN
    RAISE EXCEPTION 'School name is required' USING ERRCODE = '22023';
  END IF;
  IF v_udise !~ '^\d{11}$' THEN
    RAISE EXCEPTION 'UDISE code must be exactly 11 digits' USING ERRCODE = '22023';
  END IF;
  IF NOT private.jsonb_array_has_text(v_cfg -> 'schoolTypes', v_school_type) THEN
    RAISE EXCEPTION 'Select a valid school management type' USING ERRCODE = '22023';
  END IF;
  IF NOT private.jsonb_array_has_text(v_cfg -> 'allowedDistricts', v_district) THEN
    RAISE EXCEPTION 'District must be an approved Tamil Nadu programme district' USING ERRCODE = '22023';
  END IF;
  IF v_pin !~ '^\d{6}$' THEN
    RAISE EXCEPTION 'PIN code must be exactly 6 digits' USING ERRCODE = '22023';
  END IF;

  -- Session classes validation & metrics computation
  v_session_mode := btrim(COALESCE(p_values ->> 'sessionMode', 'single'));
  IF v_session_mode NOT IN ('single', 'combined') THEN
    RAISE EXCEPTION 'Invalid session mode' USING ERRCODE = '22023';
  END IF;
  v_classes := COALESCE(p_values -> 'classes', '[]'::jsonb);
  IF jsonb_typeof(v_classes) <> 'array' THEN
    RAISE EXCEPTION 'Classes list is required' USING ERRCODE = '22023';
  END IF;
  v_total_classes := jsonb_array_length(v_classes);
  IF v_session_mode = 'single' AND v_total_classes <> 1 THEN
    RAISE EXCEPTION 'Single class mode must contain exactly one class row' USING ERRCODE = '22023';
  ELSIF v_session_mode = 'combined' AND (v_total_classes < 2 OR v_total_classes > 10) THEN
    RAISE EXCEPTION 'Combined session mode must contain 2 to 10 class rows' USING ERRCODE = '22023';
  END IF;

  -- Teacher NPS resolution
  v_teacher_group := btrim(COALESCE(p_values ->> 'teacherNpsGroup', ''));
  v_teacher_exact_raw := btrim(COALESCE(p_values ->> 'teacherExactScore', ''));
  IF v_teacher_exact_raw ~ '^(10|[0-9])$' THEN
    v_teacher_exact := v_teacher_exact_raw::integer;
    IF v_teacher_exact >= 9 THEN
      v_teacher_class := 'Promoter'; v_teacher_nps := 100;
    ELSIF v_teacher_exact >= 7 THEN
      v_teacher_class := 'Passive'; v_teacher_nps := 0;
    ELSE
      v_teacher_class := 'Detractor'; v_teacher_nps := -100;
    END IF;
  ELSIF v_teacher_group IN ('promoter', 'passive', 'detractor') THEN
    v_teacher_class := CASE v_teacher_group
      WHEN 'promoter' THEN 'Promoter'
      WHEN 'passive' THEN 'Passive'
      ELSE 'Detractor'
    END;
    v_teacher_nps := CASE v_teacher_group
      WHEN 'promoter' THEN 100
      WHEN 'passive' THEN 0
      ELSE -100
    END;
  ELSE
    RAISE EXCEPTION 'Teacher recommendation (NPS) rating is required' USING ERRCODE = '22023';
  END IF;

  -- Validate class rows first & accumulate sums
  FOR v_elem IN SELECT value FROM jsonb_array_elements(v_classes)
  LOOP
    v_idx := v_idx + 1;
    v_grade := btrim(COALESCE(v_elem ->> 'grade', ''));
    v_section := btrim(COALESCE(v_elem ->> 'section', ''));
    IF NOT private.jsonb_array_has_text(v_cfg -> 'gradeOptions', v_grade) THEN
      RAISE EXCEPTION 'Class row % has invalid grade', v_idx USING ERRCODE = '22023';
    END IF;
    IF NOT private.jsonb_array_has_text(v_cfg -> 'sectionOptions', v_section) THEN
      RAISE EXCEPTION 'Class row % has invalid section', v_idx USING ERRCODE = '22023';
    END IF;
    v_pair := v_grade || '|' || v_section;
    IF v_pair = ANY(v_seen_pairs) THEN
      RAISE EXCEPTION 'Duplicate grade/section row (% %)', v_grade, v_section USING ERRCODE = '22023';
    END IF;
    v_seen_pairs := array_append(v_seen_pairs, v_pair);
    IF NOT (v_grade = ANY(v_grades_list)) THEN
      v_grades_list := array_append(v_grades_list, v_grade);
    END IF;

    IF COALESCE(NULLIF(btrim(v_elem ->> 'studentsPresent'), ''), '0') !~ '^\d+$' THEN
      RAISE EXCEPTION 'Class row % students present must be a whole number', v_idx USING ERRCODE = '22023';
    END IF;
    v_present := (v_elem ->> 'studentsPresent')::integer;
    IF v_present < 1 OR v_present > 99999 THEN
      RAISE EXCEPTION 'Class row % students present must be between 1 and 99999', v_idx USING ERRCODE = '22023';
    END IF;

    v_qa5 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score5'), ''), '0')::integer;
    v_qa4 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score4'), ''), '0')::integer;
    v_qa3 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score3'), ''), '0')::integer;
    v_qa2 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score2'), ''), '0')::integer;
    v_qa1 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score1'), ''), '0')::integer;

    v_qb5 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score5'), ''), '0')::integer;
    v_qb4 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score4'), ''), '0')::integer;
    v_qb3 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score3'), ''), '0')::integer;
    v_qb2 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score2'), ''), '0')::integer;
    v_qb1 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score1'), ''), '0')::integer;

    IF v_qa5 < 0 OR v_qa4 < 0 OR v_qa3 < 0 OR v_qa2 < 0 OR v_qa1 < 0
       OR v_qb5 < 0 OR v_qb4 < 0 OR v_qb3 < 0 OR v_qb2 < 0 OR v_qb1 < 0 THEN
      RAISE EXCEPTION 'Class row % scores cannot be negative', v_idx USING ERRCODE = '22023';
    END IF;

    v_qa_tot := v_qa5 + v_qa4 + v_qa3 + v_qa2 + v_qa1;
    v_qb_tot := v_qb5 + v_qb4 + v_qb3 + v_qb2 + v_qb1;
    IF v_qa_tot > v_present THEN
      RAISE EXCEPTION 'Class row % Question A total (%) exceeds students present (%)', v_idx, v_qa_tot, v_present USING ERRCODE = '22023';
    END IF;
    IF v_qb_tot > v_present THEN
      RAISE EXCEPTION 'Class row % Question B total (%) exceeds students present (%)', v_idx, v_qb_tot, v_present USING ERRCODE = '22023';
    END IF;

    v_qa_w := 5*v_qa5 + 4*v_qa4 + 3*v_qa3 + 2*v_qa2 + v_qa1;
    v_qb_w := 5*v_qb5 + 4*v_qb4 + 3*v_qb3 + 2*v_qb2 + v_qb1;

    v_sum_present := v_sum_present + v_present;
    v_sum_qa_tot := v_sum_qa_tot + v_qa_tot;
    v_sum_qa_w := v_sum_qa_w + v_qa_w;
    v_sum_qb_tot := v_sum_qb_tot + v_qb_tot;
    v_sum_qb_w := v_sum_qb_w + v_qb_w;
  END LOOP;

  IF v_sum_qa_tot > 0 THEN
    v_overall_csat := round(v_sum_qa_w::numeric / v_sum_qa_tot, 2);
  END IF;
  IF v_sum_qb_tot > 0 THEN
    v_overall_itp := round(v_sum_qb_w::numeric / v_sum_qb_tot, 2);
  END IF;

  -- Generate Session ID under transaction advisory lock (zero collisions)
  IF v_session_mode = 'single' THEN
    v_first_grade := btrim(v_classes -> 0 ->> 'grade');
    v_first_section := btrim(v_classes -> 0 ->> 'section');
    v_grade_tok := lpad(v_first_grade, 2, '0');
    v_class_tok := CASE
      WHEN upper(v_first_section) = 'NO SECTION' THEN 'NS'
      ELSE regexp_replace(upper(v_first_section), '[^A-Z0-9]', '', 'g')
    END;
  ELSE
    v_grade_tok := 'CMB';
    v_class_tok := lpad(v_total_classes::text, 2, '0') || 'C';
  END IF;

  v_prefix := 'CT_IN_' || to_char(v_start_date, 'YYYYMMDD') || '_' || v_udise || '_' || v_grade_tok || '_' || v_class_tok;
  PERFORM pg_advisory_xact_lock(hashtext(v_prefix));

  SELECT COALESCE(MAX(
    CASE
      WHEN substring(submission_reference FROM '_([0-9]+)$') ~ '^[0-9]+$'
      THEN substring(submission_reference FROM '_([0-9]+)$')::integer
      ELSE 0
    END
  ), 0) + 1
  INTO v_next_seq
  FROM public.form_submissions
  WHERE submission_reference LIKE v_prefix || '\_%' ESCAPE '\';

  v_session_id := v_prefix || '_' || lpad(v_next_seq::text, 3, '0');

  -- Resolve or insert canonical UDISE School Master
  SELECT * INTO v_existing_school FROM public.schools WHERE udise_code = v_udise LIMIT 1;
  IF FOUND THEN
    v_school_id := v_existing_school.id;
    IF lower(btrim(v_existing_school.school_name)) <> lower(v_school_name) THEN
      v_udise_conflict := 'UDISE ' || v_udise || ' is cataloged under "' || v_existing_school.school_name || '".';
      v_warnings := v_warnings || jsonb_build_array(v_udise_conflict);
    END IF;
  ELSE
    v_school_id := gen_random_uuid();
    INSERT INTO public.schools (
      id, school_record_id, organisation_id, udise_code, school_name, school_type,
      state, district, pin_code, active, created_by, updated_by
    )
    VALUES (
      v_school_id,
      'SCH_' || upper(substring(replace(v_school_id::text, '-', ''), 1, 8)),
      v_caller.organisation_id,
      v_udise,
      v_school_name,
      v_school_type,
      v_state,
      v_district,
      v_pin,
      true,
      v_uid,
      v_uid
    );
  END IF;

  -- Insert primary submission header
  v_sub_id := gen_random_uuid();
  v_record_id := 'REC_' || upper(substring(replace(v_sub_id::text, '-', ''), 1, 8));

  INSERT INTO public.form_submissions (
    id, submission_reference, session_record_id, client_submission_key,
    user_id, organisation_id, school_id,
    distribution_channel_host_id, product_name, unique_student_id, cc,
    zipcode_postal_code, completion_date, completion_rate, student_csat,
    underserved_reach, grade_of_students,
    facilitator_name, facilitator_email, tour_id, tour_name, video_id, language,
    start_date, end_date, start_time, end_time, duration_minutes, duration_formatted,
    reporting_month, submission_timestamp, submission_date_formatted,
    school_name, udise_code, school_type, state, district, pin_code,
    session_type, total_classes, total_students_present,
    total_question_a_responses, total_question_b_responses,
    overall_csat, overall_itp, teacher_score, teacher_classification, teacher_nps,
    submission_status, sync_status, synced_at, archived, submitted_at, created_by, updated_by
  )
  VALUES (
    v_sub_id, v_session_id, v_record_id, v_client_key,
    v_owner_id, v_caller.organisation_id, v_school_id,
    v_udise, v_tour_name, 'AGGREGATE_COHORT', COALESCE(NULLIF(v_cfg -> 'reportingDefaults' ->> 'cc', ''), 'IN'),
    v_pin, v_end_date, COALESCE((v_cfg -> 'reportingDefaults' ->> 'completionRate')::numeric, 100.00), v_overall_csat,
    COALESCE(NULLIF(v_cfg -> 'reportingDefaults' ->> 'underservedReach', ''), 'Yes'), array_to_string(v_grades_list, ', '),
    v_fac_name, v_fac_email, v_tour_id, v_tour_name, v_video_id, v_language,
    v_start_date, v_end_date, v_start_time, v_end_time, v_duration_mins, v_duration_formatted,
    v_reporting_month, v_now, v_sub_date_fmt,
    v_school_name, v_udise, v_school_type, v_state, v_district, v_pin,
    v_session_mode, v_total_classes, v_sum_present,
    v_sum_qa_tot, v_sum_qb_tot,
    v_overall_csat, v_overall_itp, v_teacher_exact, v_teacher_class, v_teacher_nps,
    'COMMITTED', 'SYNCED', v_now, false, v_now, v_caller.email, v_caller.email
  );

  -- Insert child class detail rows
  v_idx := 0;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(v_classes)
  LOOP
    v_idx := v_idx + 1;
    v_grade := btrim(v_elem ->> 'grade');
    v_section := btrim(v_elem ->> 'section');
    v_present := (v_elem ->> 'studentsPresent')::integer;

    v_qa5 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score5'), ''), '0')::integer;
    v_qa4 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score4'), ''), '0')::integer;
    v_qa3 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score3'), ''), '0')::integer;
    v_qa2 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score2'), ''), '0')::integer;
    v_qa1 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score1'), ''), '0')::integer;
    v_qa_tot := v_qa5 + v_qa4 + v_qa3 + v_qa2 + v_qa1;
    v_qa_w := 5*v_qa5 + 4*v_qa4 + 3*v_qa3 + 2*v_qa2 + v_qa1;
    v_csat := CASE WHEN v_qa_tot > 0 THEN round(v_qa_w::numeric / v_qa_tot, 2) ELSE NULL END;

    v_qb5 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score5'), ''), '0')::integer;
    v_qb4 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score4'), ''), '0')::integer;
    v_qb3 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score3'), ''), '0')::integer;
    v_qb2 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score2'), ''), '0')::integer;
    v_qb1 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score1'), ''), '0')::integer;
    v_qb_tot := v_qb5 + v_qb4 + v_qb3 + v_qb2 + v_qb1;
    v_qb_w := 5*v_qb5 + 4*v_qb4 + 3*v_qb3 + 2*v_qb2 + v_qb1;
    v_itp := CASE WHEN v_qb_tot > 0 THEN round(v_qb_w::numeric / v_qb_tot, 2) ELSE NULL END;

    INSERT INTO public.form_submission_classes (
      detail_record_id, submission_id, session_record_id, session_id, row_order,
      grade, section, students_present,
      question_a_score_5, question_a_score_4, question_a_score_3, question_a_score_2, question_a_score_1,
      question_a_total, question_a_weighted_score, csat,
      question_b_score_5, question_b_score_4, question_b_score_3, question_b_score_2, question_b_score_1,
      question_b_total, question_b_weighted_score, itp
    )
    VALUES (
      'DET_' || upper(substring(replace(v_sub_id::text, '-', ''), 1, 8)) || '_' || v_idx,
      v_sub_id, v_record_id, v_session_id, v_idx,
      v_grade, v_section, v_present,
      v_qa5, v_qa4, v_qa3, v_qa2, v_qa1, v_qa_tot, v_qa_w, v_csat,
      v_qb5, v_qb4, v_qb3, v_qb2, v_qb1, v_qb_tot, v_qb_w, v_itp
    );
  END LOOP;

  -- Audit & Activity Logging
  INSERT INTO public.submission_audit_logs (
    audit_code, submission_id, performed_by, actor_email, action, entity_type, entity_id,
    previous_summary, new_summary, updated_data, result
  )
  VALUES (
    'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_sub_id, v_uid, v_caller.email, 'CREATE_SESSION', 'Session', v_session_id,
    '', v_school_name || ' · ' || v_district || ' · ' || v_sum_present || ' students',
    jsonb_build_object('sessionId', v_session_id, 'district', v_district, 'udiseCode', v_udise, 'studentsPresent', v_sum_present),
    'SUCCESS'
  );

  INSERT INTO public.user_activity_logs (user_id, user_email, activity_type, activity_description, metadata)
  VALUES (
    v_uid, v_caller.email, 'SESSION_SUBMITTED',
    'Submitted session ' || v_session_id || ' for ' || v_school_name,
    jsonb_build_object('sessionId', v_session_id, 'district', v_district, 'students', v_sum_present)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'deduplicated', false,
    'session', private.build_session_record_json(v_sub_id),
    'warnings', v_warnings,
    'schoolUdiseConflict', v_udise_conflict
  );
END;
$$;

-- 4. Update existing form session (marks CORRECTED and preserves immutable submission_reference)
CREATE OR REPLACE FUNCTION public.update_form_session(p_session_record_id text, p_values jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller public.profiles%ROWTYPE;
  v_is_super boolean := false;
  v_existing public.form_submissions%ROWTYPE;
  v_prev_snapshot jsonb;
  v_cfg jsonb;
  v_tz text;
  v_fac_name text;
  v_fac_email text;
  v_tour_id text;
  v_tour jsonb;
  v_tour_name text;
  v_language text;
  v_video_id text;
  v_start_date date;
  v_end_date date;
  v_today_ist date;
  v_start_time text;
  v_end_time text;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_duration_mins integer;
  v_duration_formatted text;
  v_reporting_month text;
  v_school_name text;
  v_udise text;
  v_school_type text;
  v_state text;
  v_district text;
  v_pin text;
  v_session_mode text;
  v_classes jsonb;
  v_total_classes integer;
  v_teacher_group text;
  v_teacher_exact_raw text;
  v_teacher_exact integer := NULL;
  v_teacher_class text;
  v_teacher_nps integer;

  v_elem jsonb;
  v_idx integer := 0;
  v_grade text;
  v_section text;
  v_present integer;
  v_qa5 integer; v_qa4 integer; v_qa3 integer; v_qa2 integer; v_qa1 integer;
  v_qb5 integer; v_qb4 integer; v_qb3 integer; v_qb2 integer; v_qb1 integer;
  v_qa_tot integer; v_qa_w integer; v_csat numeric(4,2);
  v_qb_tot integer; v_qb_w integer; v_itp numeric(4,2);
  v_sum_present integer := 0;
  v_sum_qa_tot integer := 0;
  v_sum_qa_w integer := 0;
  v_sum_qb_tot integer := 0;
  v_sum_qb_w integer := 0;
  v_overall_csat numeric(4,2) := NULL;
  v_overall_itp numeric(4,2) := NULL;
  v_grades_list text[] := ARRAY[]::text[];
  v_seen_pairs text[] := ARRAY[]::text[];
  v_pair text;
  v_warnings jsonb := '[]'::jsonb;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR v_caller.account_status <> 'APPROVED' OR NOT v_caller.active THEN
    RAISE EXCEPTION 'Approved account required' USING ERRCODE = '42501';
  END IF;
  v_is_super := private.is_super_admin();

  SELECT * INTO v_existing
  FROM public.form_submissions
  WHERE session_record_id = p_session_record_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session record not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_is_super AND v_existing.user_id <> v_uid THEN
    RAISE EXCEPTION 'You can only update your own session submissions' USING ERRCODE = '42501';
  END IF;

  v_prev_snapshot := private.build_session_record_json(v_existing.id);

  SELECT setting_value INTO v_cfg
  FROM public.application_settings
  WHERE setting_key = 'app_configuration'
  LIMIT 1;
  v_tz := COALESCE(NULLIF(v_cfg ->> 'programmeTimezone', ''), 'Asia/Kolkata');

  v_fac_name := COALESCE(NULLIF(btrim(p_values ->> 'facilitatorName'), ''), v_existing.facilitator_name);
  IF v_is_super AND NULLIF(btrim(p_values ->> 'facilitatorEmail'), '') IS NOT NULL THEN
    v_fac_email := lower(btrim(p_values ->> 'facilitatorEmail'));
  ELSE
    v_fac_email := v_existing.facilitator_email;
  END IF;

  v_tour_id := btrim(COALESCE(p_values ->> 'tourId', ''));
  SELECT t INTO v_tour
  FROM jsonb_array_elements(COALESCE(v_cfg -> 'tours', '[]'::jsonb)) AS t
  WHERE (t ->> 'tourId') = v_tour_id
  LIMIT 1;
  IF v_tour IS NULL THEN
    RAISE EXCEPTION 'Invalid Career Tour' USING ERRCODE = '22023';
  END IF;
  v_tour_name := btrim(v_tour ->> 'tourName');
  v_language := btrim(COALESCE(p_values ->> 'language', ''));
  IF NOT private.jsonb_array_has_text(v_cfg -> 'languageOptions', v_language) THEN
    RAISE EXCEPTION 'Invalid session language' USING ERRCODE = '22023';
  END IF;

  v_video_id := btrim(COALESCE(v_tour -> 'videoIdByLanguage' ->> v_language, ''));
  IF v_video_id = '' THEN
    v_video_id := 'Not configured for ' || v_tour_name || ' (' || COALESCE(NULLIF(v_language, ''), 'language unset') || ')';
  END IF;

  v_start_date := (btrim(p_values ->> 'startDate'))::date;
  v_end_date := (btrim(p_values ->> 'endDate'))::date;
  v_today_ist := (v_now AT TIME ZONE v_tz)::date;
  v_start_time := btrim(COALESCE(p_values ->> 'startTime', ''));
  v_end_time := btrim(COALESCE(p_values ->> 'endTime', ''));

  IF v_start_date > v_today_ist OR v_end_date > v_today_ist OR v_end_date < v_start_date THEN
    RAISE EXCEPTION 'Invalid session date range' USING ERRCODE = '22023';
  END IF;
  IF v_start_time !~ '^\d{2}:\d{2}$' OR v_end_time !~ '^\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'Invalid HH:MM time format' USING ERRCODE = '22023';
  END IF;

  v_start_ts := ((v_start_date::timestamp + v_start_time::time) AT TIME ZONE v_tz);
  v_end_ts := ((v_end_date::timestamp + v_end_time::time) AT TIME ZONE v_tz);
  v_duration_mins := floor(EXTRACT(EPOCH FROM (v_end_ts - v_start_ts)) / 60)::integer;
  IF v_duration_mins IS NULL OR v_duration_mins <= 0 THEN
    RAISE EXCEPTION 'Session end time must be after start time' USING ERRCODE = '22023';
  END IF;
  v_duration_formatted := private.format_duration_human(v_duration_mins);
  v_reporting_month := btrim(to_char(v_start_date, 'FMMonth'));

  v_school_name := btrim(COALESCE(p_values ->> 'schoolName', ''));
  v_udise := btrim(COALESCE(p_values ->> 'udiseCode', ''));
  v_school_type := btrim(COALESCE(p_values ->> 'schoolType', ''));
  v_state := COALESCE(NULLIF(btrim(v_cfg ->> 'stateName'), ''), 'Tamil Nadu');
  v_district := btrim(COALESCE(p_values ->> 'district', ''));
  v_pin := btrim(COALESCE(p_values ->> 'pinCode', ''));

  IF v_school_name = '' OR v_udise !~ '^\d{11}$' OR v_pin !~ '^\d{6}$'
     OR NOT private.jsonb_array_has_text(v_cfg -> 'schoolTypes', v_school_type)
     OR NOT private.jsonb_array_has_text(v_cfg -> 'allowedDistricts', v_district) THEN
    RAISE EXCEPTION 'Invalid school or approved district fields' USING ERRCODE = '22023';
  END IF;

  v_session_mode := btrim(COALESCE(p_values ->> 'sessionMode', 'single'));
  v_classes := COALESCE(p_values -> 'classes', '[]'::jsonb);
  v_total_classes := jsonb_array_length(v_classes);
  IF (v_session_mode = 'single' AND v_total_classes <> 1)
     OR (v_session_mode = 'combined' AND (v_total_classes < 2 OR v_total_classes > 10)) THEN
    RAISE EXCEPTION 'Invalid class group count for session mode' USING ERRCODE = '22023';
  END IF;

  v_teacher_group := btrim(COALESCE(p_values ->> 'teacherNpsGroup', ''));
  v_teacher_exact_raw := btrim(COALESCE(p_values ->> 'teacherExactScore', ''));
  IF v_teacher_exact_raw ~ '^(10|[0-9])$' THEN
    v_teacher_exact := v_teacher_exact_raw::integer;
    IF v_teacher_exact >= 9 THEN v_teacher_class := 'Promoter'; v_teacher_nps := 100;
    ELSIF v_teacher_exact >= 7 THEN v_teacher_class := 'Passive'; v_teacher_nps := 0;
    ELSE v_teacher_class := 'Detractor'; v_teacher_nps := -100;
    END IF;
  ELSIF v_teacher_group IN ('promoter', 'passive', 'detractor') THEN
    v_teacher_class := CASE v_teacher_group WHEN 'promoter' THEN 'Promoter' WHEN 'passive' THEN 'Passive' ELSE 'Detractor' END;
    v_teacher_nps := CASE v_teacher_group WHEN 'promoter' THEN 100 WHEN 'passive' THEN 0 ELSE -100 END;
  ELSE
    RAISE EXCEPTION 'Teacher rating is required' USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(v_classes)
  LOOP
    v_idx := v_idx + 1;
    v_grade := btrim(COALESCE(v_elem ->> 'grade', ''));
    v_section := btrim(COALESCE(v_elem ->> 'section', ''));
    v_present := (v_elem ->> 'studentsPresent')::integer;
    IF v_present < 1 THEN
      RAISE EXCEPTION 'Students present must be >= 1' USING ERRCODE = '22023';
    END IF;
    v_pair := v_grade || '|' || v_section;
    IF v_pair = ANY(v_seen_pairs) THEN
      RAISE EXCEPTION 'Duplicate grade/section row' USING ERRCODE = '22023';
    END IF;
    v_seen_pairs := array_append(v_seen_pairs, v_pair);
    IF NOT (v_grade = ANY(v_grades_list)) THEN
      v_grades_list := array_append(v_grades_list, v_grade);
    END IF;

    v_qa5 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score5'), ''), '0')::integer;
    v_qa4 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score4'), ''), '0')::integer;
    v_qa3 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score3'), ''), '0')::integer;
    v_qa2 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score2'), ''), '0')::integer;
    v_qa1 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score1'), ''), '0')::integer;

    v_qb5 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score5'), ''), '0')::integer;
    v_qb4 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score4'), ''), '0')::integer;
    v_qb3 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score3'), ''), '0')::integer;
    v_qb2 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score2'), ''), '0')::integer;
    v_qb1 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score1'), ''), '0')::integer;

    v_qa_tot := v_qa5 + v_qa4 + v_qa3 + v_qa2 + v_qa1;
    v_qb_tot := v_qb5 + v_qb4 + v_qb3 + v_qb2 + v_qb1;
    IF v_qa_tot > v_present OR v_qb_tot > v_present THEN
      RAISE EXCEPTION 'Response count exceeds students present' USING ERRCODE = '22023';
    END IF;
    v_qa_w := 5*v_qa5 + 4*v_qa4 + 3*v_qa3 + 2*v_qa2 + v_qa1;
    v_qb_w := 5*v_qb5 + 4*v_qb4 + 3*v_qb3 + 2*v_qb2 + v_qb1;

    v_sum_present := v_sum_present + v_present;
    v_sum_qa_tot := v_sum_qa_tot + v_qa_tot;
    v_sum_qa_w := v_sum_qa_w + v_qa_w;
    v_sum_qb_tot := v_sum_qb_tot + v_qb_tot;
    v_sum_qb_w := v_sum_qb_w + v_qb_w;
  END LOOP;

  IF v_sum_qa_tot > 0 THEN v_overall_csat := round(v_sum_qa_w::numeric / v_sum_qa_tot, 2); END IF;
  IF v_sum_qb_tot > 0 THEN v_overall_itp := round(v_sum_qb_w::numeric / v_sum_qb_tot, 2); END IF;

  UPDATE public.form_submissions
  SET
    facilitator_name = v_fac_name,
    facilitator_email = v_fac_email,
    tour_id = v_tour_id,
    tour_name = v_tour_name,
    video_id = v_video_id,
    language = v_language,
    start_date = v_start_date,
    end_date = v_end_date,
    start_time = v_start_time,
    end_time = v_end_time,
    duration_minutes = v_duration_mins,
    duration_formatted = v_duration_formatted,
    reporting_month = v_reporting_month,
    school_name = v_school_name,
    udise_code = v_udise,
    school_type = v_school_type,
    state = v_state,
    district = v_district,
    pin_code = v_pin,
    zipcode_postal_code = v_pin,
    distribution_channel_host_id = v_udise,
    product_name = v_tour_name,
    completion_date = v_end_date,
    student_csat = v_overall_csat,
    grade_of_students = array_to_string(v_grades_list, ', '),
    session_type = v_session_mode,
    total_classes = v_total_classes,
    total_students_present = v_sum_present,
    total_question_a_responses = v_sum_qa_tot,
    total_question_b_responses = v_sum_qb_tot,
    overall_csat = v_overall_csat,
    overall_itp = v_overall_itp,
    teacher_score = v_teacher_exact,
    teacher_classification = v_teacher_class,
    teacher_nps = v_teacher_nps,
    submission_status = 'CORRECTED',
    sync_status = 'SYNCED',
    synced_at = v_now,
    updated_by = v_caller.email
  WHERE id = v_existing.id;

  DELETE FROM public.form_submission_classes WHERE submission_id = v_existing.id;

  v_idx := 0;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(v_classes)
  LOOP
    v_idx := v_idx + 1;
    v_grade := btrim(v_elem ->> 'grade');
    v_section := btrim(v_elem ->> 'section');
    v_present := (v_elem ->> 'studentsPresent')::integer;

    v_qa5 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score5'), ''), '0')::integer;
    v_qa4 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score4'), ''), '0')::integer;
    v_qa3 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score3'), ''), '0')::integer;
    v_qa2 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score2'), ''), '0')::integer;
    v_qa1 := COALESCE(NULLIF(btrim(v_elem -> 'questionA' ->> 'score1'), ''), '0')::integer;
    v_qa_tot := v_qa5 + v_qa4 + v_qa3 + v_qa2 + v_qa1;
    v_qa_w := 5*v_qa5 + 4*v_qa4 + 3*v_qa3 + 2*v_qa2 + v_qa1;
    v_csat := CASE WHEN v_qa_tot > 0 THEN round(v_qa_w::numeric / v_qa_tot, 2) ELSE NULL END;

    v_qb5 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score5'), ''), '0')::integer;
    v_qb4 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score4'), ''), '0')::integer;
    v_qb3 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score3'), ''), '0')::integer;
    v_qb2 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score2'), ''), '0')::integer;
    v_qb1 := COALESCE(NULLIF(btrim(v_elem -> 'questionB' ->> 'score1'), ''), '0')::integer;
    v_qb_tot := v_qb5 + v_qb4 + v_qb3 + v_qb2 + v_qb1;
    v_qb_w := 5*v_qb5 + 4*v_qb4 + 3*v_qb3 + 2*v_qb2 + v_qb1;
    v_itp := CASE WHEN v_qb_tot > 0 THEN round(v_qb_w::numeric / v_qb_tot, 2) ELSE NULL END;

    INSERT INTO public.form_submission_classes (
      detail_record_id, submission_id, session_record_id, session_id, row_order,
      grade, section, students_present,
      question_a_score_5, question_a_score_4, question_a_score_3, question_a_score_2, question_a_score_1,
      question_a_total, question_a_weighted_score, csat,
      question_b_score_5, question_b_score_4, question_b_score_3, question_b_score_2, question_b_score_1,
      question_b_total, question_b_weighted_score, itp
    )
    VALUES (
      'DET_' || upper(substring(replace(v_existing.id::text, '-', ''), 1, 8)) || '_' || v_idx,
      v_existing.id, v_existing.session_record_id, v_existing.submission_reference, v_idx,
      v_grade, v_section, v_present,
      v_qa5, v_qa4, v_qa3, v_qa2, v_qa1, v_qa_tot, v_qa_w, v_csat,
      v_qb5, v_qb4, v_qb3, v_qb2, v_qb1, v_qb_tot, v_qb_w, v_itp
    );
  END LOOP;

  INSERT INTO public.submission_audit_logs (
    audit_code, submission_id, performed_by, actor_email, action, entity_type, entity_id,
    previous_summary, new_summary, previous_data, updated_data, result
  )
  VALUES (
    'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_existing.id, v_uid, v_caller.email, 'UPDATE_SESSION', 'Session', v_existing.submission_reference,
    v_existing.school_name || ' · ' || v_existing.total_students_present || ' students',
    v_school_name || ' · ' || v_sum_present || ' students (CORRECTED)',
    v_prev_snapshot,
    private.build_session_record_json(v_existing.id),
    'SUCCESS'
  );

  INSERT INTO public.user_activity_logs (user_id, user_email, activity_type, activity_description, metadata)
  VALUES (
    v_uid, v_caller.email, 'SESSION_UPDATED',
    'Updated session ' || v_existing.submission_reference,
    jsonb_build_object('sessionId', v_existing.submission_reference)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'session', private.build_session_record_json(v_existing.id),
    'warnings', v_warnings
  );
END;
$$;

-- 5. Archive / Restore session
CREATE OR REPLACE FUNCTION public.archive_or_restore_form_session(p_session_record_id text, p_archived boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller public.profiles%ROWTYPE;
  v_is_super boolean := false;
  v_existing public.form_submissions%ROWTYPE;
  v_allow_fac_delete boolean := true;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR v_caller.account_status <> 'APPROVED' OR NOT v_caller.active THEN
    RAISE EXCEPTION 'Approved account required' USING ERRCODE = '42501';
  END IF;
  v_is_super := private.is_super_admin();

  SELECT * INTO v_existing FROM public.form_submissions WHERE session_record_id = p_session_record_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_archived THEN
    SELECT COALESCE((setting_value -> 'policy' ->> 'allowFacilitatorDeleteOwn')::boolean, true)
    INTO v_allow_fac_delete
    FROM public.application_settings WHERE setting_key = 'app_configuration' LIMIT 1;

    IF NOT v_is_super THEN
      IF v_existing.user_id <> v_uid OR NOT v_allow_fac_delete THEN
        RAISE EXCEPTION 'Not authorized to archive this session' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    IF NOT v_is_super THEN
      RAISE EXCEPTION 'Only Super Administrators can restore archived sessions' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.form_submissions
  SET archived = p_archived, updated_by = v_caller.email
  WHERE id = v_existing.id;

  INSERT INTO public.submission_audit_logs (
    audit_code, submission_id, performed_by, actor_email, action, entity_type, entity_id,
    previous_summary, new_summary, result
  )
  VALUES (
    'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_existing.id, v_uid, v_caller.email,
    CASE WHEN p_archived THEN 'ARCHIVE_SESSION' ELSE 'RESTORE_SESSION' END,
    'Session', v_existing.submission_reference,
    'archived=' || v_existing.archived::text, 'archived=' || p_archived::text,
    'SUCCESS'
  );

  RETURN jsonb_build_object('archived', p_archived);
END;
$$;

-- 6. Super Admin permanent single or bulk delete with full audit snapshot
CREATE OR REPLACE FUNCTION public.delete_form_sessions(p_session_record_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller_email text;
  v_deleted_count integer := 0;
  v_details_count integer := 0;
  v_snapshot jsonb;
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;
  v_caller_email := private.current_user_email();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sessionRecordId', fs.session_record_id,
    'sessionId', fs.submission_reference,
    'schoolName', fs.school_name,
    'facilitatorEmail', fs.facilitator_email
  )), '[]'::jsonb)
  INTO v_snapshot
  FROM public.form_submissions fs
  WHERE fs.session_record_id = ANY(p_session_record_ids);

  SELECT count(*)::integer INTO v_details_count
  FROM public.form_submission_classes d
  WHERE d.session_record_id = ANY(p_session_record_ids);

  DELETE FROM public.form_submissions
  WHERE session_record_id = ANY(p_session_record_ids);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  INSERT INTO public.submission_audit_logs (
    audit_code, performed_by, actor_email, action, entity_type, entity_id,
    previous_summary, new_summary, previous_data, result
  )
  VALUES (
    'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_uid, v_caller_email,
    CASE WHEN v_deleted_count > 1 THEN 'BULK_DELETE_SESSIONS' ELSE 'DELETE_SESSION' END,
    'Session',
    COALESCE(array_to_string(p_session_record_ids, ','), ''),
    'Deleted ' || v_deleted_count || ' session(s), ' || v_details_count || ' class row(s)',
    'PERMANENTLY_DELETED',
    v_snapshot,
    'SUCCESS'
  );

  RETURN jsonb_build_object('deletedCount', v_deleted_count, 'deletedDetailsCount', v_details_count);
END;
$$;

-- 7. School Master Admin RPCs
CREATE OR REPLACE FUNCTION public.update_school_master(
  p_school_record_id text,
  p_school_name text,
  p_udise_code text,
  p_school_type text,
  p_state text,
  p_district text,
  p_pin_code text,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_school public.schools%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;

  IF btrim(COALESCE(p_school_name, '')) = '' OR btrim(COALESCE(p_udise_code, '')) !~ '^\d{11}$'
     OR btrim(COALESCE(p_pin_code, '')) !~ '^\d{6}$'
     OR btrim(COALESCE(p_district, '')) NOT IN ('Cuddalore', 'Nagapattinam', 'Sivaganga') THEN
    RAISE EXCEPTION 'Invalid school master fields' USING ERRCODE = '22023';
  END IF;

  UPDATE public.schools
  SET
    school_name = btrim(p_school_name),
    udise_code = btrim(p_udise_code),
    school_type = btrim(p_school_type),
    state = COALESCE(NULLIF(btrim(p_state), ''), 'Tamil Nadu'),
    district = btrim(p_district),
    pin_code = btrim(p_pin_code),
    active = COALESCE(p_active, true),
    updated_by = v_uid
  WHERE school_record_id = p_school_record_id
  RETURNING * INTO v_school;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'School record not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.submission_audit_logs (
    audit_code, performed_by, actor_email, action, entity_type, entity_id,
    previous_summary, new_summary, result
  )
  VALUES (
    'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_uid, private.current_user_email(), 'UPDATE_SCHOOL', 'School', v_school.udise_code,
    '', v_school.school_name || ' (' || v_school.district || ')', 'SUCCESS'
  );

  RETURN jsonb_build_object(
    'schoolRecordId', v_school.school_record_id,
    'schoolName', v_school.school_name,
    'udiseCode', v_school.udise_code,
    'schoolType', v_school.school_type,
    'state', v_school.state,
    'district', v_school.district,
    'pinCode', v_school.pin_code,
    'active', v_school.active,
    'createdAt', to_char(v_school.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(v_school.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_school_master(p_school_record_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_udise text;
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.schools WHERE school_record_id = p_school_record_id
  RETURNING udise_code INTO v_udise;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'School record not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.submission_audit_logs (
    audit_code, performed_by, actor_email, action, entity_type, entity_id,
    previous_summary, new_summary, result
  )
  VALUES (
    'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_uid, private.current_user_email(), 'DELETE_SCHOOL', 'School', v_udise,
    v_udise, 'DELETED', 'SUCCESS'
  );

  RETURN jsonb_build_object('deleted', true, 'udiseCode', v_udise);
END;
$$;

-- 8. Managed Users & Pre-approvals Directory RPCs (Super Admin only)
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
        'createdAt', to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) AS item
      FROM public.profiles p

      UNION ALL

      SELECT jsonb_build_object(
        'userId', 'PRE_' || upper(substring(replace(fp.id::text, '-', ''), 1, 8)),
        'name', fp.full_name,
        'email', fp.email,
        'role', 'facilitator',
        'active', fp.active,
        'status', fp.account_status,
        'createdAt', to_char(fp.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(fp.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) AS item
      FROM public.facilitator_preapprovals fp
      WHERE NOT EXISTS (SELECT 1 FROM public.profiles p2 WHERE p2.email = fp.email)
    ) combined
  ), '[]'::jsonb);
END;
$$;

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
AS $$
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

  v_is_allowlisted := v_email IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org');
  IF COALESCE(p_role, 'facilitator') = 'super_admin' AND NOT v_is_allowlisted THEN
    RAISE EXCEPTION 'Only allowlisted Super Administrators may hold super_admin role' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile FROM public.profiles
  WHERE email = v_email OR (NULLIF(p_user_id, '') IS NOT NULL AND user_code = p_user_id)
  LIMIT 1;

  IF FOUND THEN
    IF v_profile.email IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org') THEN
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
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_facilitator(p_user_id_or_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := lower(btrim(COALESCE(p_user_id_or_email, '')));
  v_profile public.profiles%ROWTYPE;
  v_pre_email text;
  v_sub_count integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile FROM public.profiles
  WHERE lower(email) = v_key OR lower(user_code) = v_key OR id::text = v_key
  LIMIT 1;

  IF FOUND THEN
    IF v_profile.email IN ('brinthajayaprakash888@gmail.com', 'karunya@vidhyavidhai.org') THEN
      RAISE EXCEPTION 'Allowlisted Super Administrators cannot be removed' USING ERRCODE = '42501';
    END IF;
    SELECT count(*)::integer INTO v_sub_count FROM public.form_submissions WHERE user_id = v_profile.id;
    IF v_sub_count = 0 THEN
      DELETE FROM public.profiles WHERE id = v_profile.id;
    ELSE
      PERFORM set_config('app.bypass_profile_rbac', '1', true);
      UPDATE public.profiles SET account_status = 'DENIED', active = false WHERE id = v_profile.id;
    END IF;
    INSERT INTO public.submission_audit_logs (
      audit_code, performed_by, actor_email, action, entity_type, entity_id,
      previous_summary, new_summary, result
    )
    VALUES (
      'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_uid, private.current_user_email(), 'DELETE_USER', 'User', v_profile.email,
      '', CASE WHEN v_sub_count = 0 THEN 'DELETED' ELSE 'DEACTIVATED_WITH_HISTORY' END, 'SUCCESS'
    );
    RETURN jsonb_build_object('deleted', true, 'email', v_profile.email);
  END IF;

  DELETE FROM public.facilitator_preapprovals
  WHERE lower(email) = v_key
     OR ('pre_' || lower(substring(replace(id::text, '-', ''), 1, 8))) = v_key
  RETURNING email INTO v_pre_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'email', v_pre_email);
END;
$$;

-- 9. Admin Settings & Google Sheets Metadata RPCs
CREATE OR REPLACE FUNCTION public.admin_save_app_settings(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_current jsonb;
  v_merged jsonb;
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT setting_value INTO v_current FROM public.application_settings WHERE setting_key = 'app_configuration';
  v_merged := COALESCE(v_current, '{}'::jsonb) || COALESCE(p_config, '{}'::jsonb);
  -- Always preserve canonical State & 3 Approved Districts (never allow Block)
  v_merged := jsonb_set(v_merged, '{stateName}', '"Tamil Nadu"'::jsonb);
  v_merged := jsonb_set(v_merged, '{allowedDistricts}', '["Cuddalore", "Nagapattinam", "Sivaganga"]'::jsonb);

  UPDATE public.application_settings
  SET setting_value = v_merged, updated_by = v_uid
  WHERE setting_key = 'app_configuration';

  INSERT INTO public.submission_audit_logs (
    audit_code, performed_by, actor_email, action, entity_type, entity_id,
    previous_summary, new_summary, result
  )
  VALUES (
    'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_uid, private.current_user_email(), 'UPDATE_SETTINGS', 'Configuration', 'app_configuration',
    '', 'Updated programme configuration', 'SUCCESS'
  );

  RETURN v_merged;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sheets_connection_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.sheets_connections%ROWTYPE;
  v_def_id constant text := '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE';
  v_def_url constant text := 'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0';
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.sheets_connections WHERE connection_key = 'primary' LIMIT 1;
  RETURN jsonb_build_object(
    'connected', COALESCE(v_row.connected, false),
    'authMethod', COALESCE(v_row.auth_method, 'apps_script'),
    'connectionProvider', COALESCE(v_row.connection_provider, 'apps_script'),
    'oauthConfigured', false,
    'connectedAccount', COALESCE(v_row.connected_account, ''),
    'spreadsheetId', COALESCE(v_row.spreadsheet_id, v_def_id),
    'spreadsheetName', COALESCE(v_row.spreadsheet_name, 'Career Tours Live Sheet'),
    'spreadsheetUrl', COALESCE(v_row.spreadsheet_url, v_def_url),
    'connectedAt', COALESCE(to_char(v_row.connected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
    'connectedBy', COALESCE(v_row.connected_by_email, ''),
    'lastSyncedAt', COALESCE(to_char(v_row.last_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
    'lastSyncStatus', COALESCE(v_row.last_sync_status, 'IDLE'),
    'lastSyncMessage', COALESCE(v_row.last_sync_message, ''),
    'initializedTabs', COALESCE(v_row.initialized_tabs, '["Sessions","Session Details","Schools","Facilitators","Settings"]'::jsonb),
    'defaultSpreadsheetId', v_def_id,
    'defaultSpreadsheetUrl', v_def_url
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_sheets_connection(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;
  v_email := private.current_user_email();

  UPDATE public.sheets_connections
  SET
    connected = COALESCE((p_payload ->> 'connected')::boolean, connected),
    auth_method = COALESCE(NULLIF(p_payload ->> 'authMethod', ''), auth_method),
    connection_provider = COALESCE(NULLIF(p_payload ->> 'connectionProvider', ''), connection_provider),
    connected_account = COALESCE(p_payload ->> 'connectedAccount', connected_account),
    spreadsheet_id = COALESCE(NULLIF(p_payload ->> 'spreadsheetId', ''), spreadsheet_id),
    spreadsheet_name = COALESCE(NULLIF(p_payload ->> 'spreadsheetName', ''), spreadsheet_name),
    spreadsheet_url = COALESCE(NULLIF(p_payload ->> 'spreadsheetUrl', ''), spreadsheet_url),
    apps_script_webhook_url = CASE
      WHEN p_payload ? 'appsScriptUrl' THEN COALESCE(p_payload ->> 'appsScriptUrl', '')
      ELSE apps_script_webhook_url
    END,
    connected_at = CASE WHEN COALESCE((p_payload ->> 'connected')::boolean, connected) THEN COALESCE(connected_at, now()) ELSE NULL END,
    connected_by = v_uid,
    connected_by_email = v_email,
    last_sync_message = COALESCE(p_payload ->> 'lastSyncMessage', last_sync_message),
    last_sync_status = COALESCE(NULLIF(p_payload ->> 'lastSyncStatus', ''), last_sync_status)
  WHERE connection_key = 'primary';

  RETURN public.get_sheets_connection_state();
END;
$$;

-- 10. Logging & Database Health & Import RPCs
CREATE OR REPLACE FUNCTION public.log_export_event(p_scope text, p_row_count integer, p_format text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.submission_audit_logs (
    audit_code, performed_by, actor_email, action, entity_type, entity_id,
    previous_summary, new_summary, result
  )
  VALUES (
    'AUD_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_uid, private.current_user_email(), 'EXPORT_DATA', 'Report',
    COALESCE(NULLIF(p_scope, ''), 'ALL'),
    '', COALESCE(p_row_count, 0) || ' rows (' || COALESCE(NULLIF(p_format, ''), 'XLSX') || ')', 'SUCCESS'
  );

  RETURN jsonb_build_object('logged', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.log_user_activity(p_activity_type text, p_description text DEFAULT '', p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_activity_logs (user_id, user_email, activity_type, activity_description, metadata)
  VALUES (v_uid, private.current_user_email(), btrim(p_activity_type), COALESCE(p_description, ''), COALESCE(p_metadata, '{}'::jsonb));

  RETURN jsonb_build_object('logged', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_database_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total integer;
  v_committed integer;
  v_corrected integer;
  v_pending integer;
  v_recoverable integer;
  v_archived integer;
  v_orphan_details integer;
  v_missing_schools text[];
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE submission_status = 'COMMITTED' AND NOT archived)::integer,
    count(*) FILTER (WHERE submission_status = 'CORRECTED' AND NOT archived)::integer,
    count(*) FILTER (WHERE submission_status = 'PENDING')::integer,
    count(*) FILTER (WHERE archived)::integer
  INTO v_total, v_committed, v_corrected, v_pending, v_archived
  FROM public.form_submissions;

  SELECT count(*)::integer INTO v_recoverable
  FROM public.form_submissions fs
  WHERE fs.submission_status = 'PENDING'
    AND EXISTS (SELECT 1 FROM public.form_submission_classes d WHERE d.submission_id = fs.id);

  SELECT count(*)::integer INTO v_orphan_details
  FROM public.form_submission_classes d
  WHERE NOT EXISTS (SELECT 1 FROM public.form_submissions fs WHERE fs.id = d.submission_id);

  SELECT COALESCE(array_agg(DISTINCT fs.udise_code), ARRAY[]::text[]) INTO v_missing_schools
  FROM public.form_submissions fs
  WHERE NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.udise_code = fs.udise_code);

  RETURN jsonb_build_object(
    'healthy', (v_pending = 0 AND v_orphan_details = 0 AND COALESCE(array_length(v_missing_schools, 1), 0) = 0),
    'totalSessions', v_total,
    'committedCount', v_committed,
    'correctedCount', v_corrected,
    'pendingCount', v_pending,
    'recoverablePendingCount', v_recoverable,
    'archivedCount', v_archived,
    'promotedPendingCount', 0,
    'orphanPendingCount', v_pending - v_recoverable,
    'orphanDetailRowCount', v_orphan_details,
    'duplicateSessionIds', '[]'::jsonb,
    'duplicateRecordIds', '[]'::jsonb,
    'missingSchoolMasterUdise', to_jsonb(v_missing_schools),
    'repairedSchoolMasters', 0,
    'checkedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_database_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid := private.default_organisation_id();
  v_promoted integer := 0;
  v_repaired integer := 0;
  v_report jsonb;
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.form_submissions fs
  SET submission_status = 'COMMITTED'
  WHERE fs.submission_status = 'PENDING'
    AND EXISTS (SELECT 1 FROM public.form_submission_classes d WHERE d.submission_id = fs.id);
  GET DIAGNOSTICS v_promoted = ROW_COUNT;

  INSERT INTO public.schools (
    school_record_id, organisation_id, udise_code, school_name, school_type,
    state, district, pin_code, active, created_by, updated_by
  )
  SELECT DISTINCT ON (fs.udise_code)
    'SCH_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_org_id, fs.udise_code, fs.school_name, fs.school_type,
    fs.state, fs.district, fs.pin_code, true, v_uid, v_uid
  FROM public.form_submissions fs
  WHERE NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.udise_code = fs.udise_code)
  ON CONFLICT (udise_code) DO NOTHING;
  GET DIAGNOSTICS v_repaired = ROW_COUNT;

  v_report := public.get_database_health();
  v_report := jsonb_set(v_report, '{promotedPendingCount}', to_jsonb(v_promoted));
  v_report := jsonb_set(v_report, '{repairedSchoolMasters}', to_jsonb(v_repaired));
  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_import_sessions(p_sessions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid := private.default_organisation_id();
  v_imported integer := 0;
  v_skipped integer := 0;
  v_rejected integer := 0;
  v_reg_facs integer := 0;
  v_rep_schools integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_s jsonb;
  v_d jsonb;
  v_ckey text;
  v_sid text;
  v_rid text;
  v_fac_email text;
  v_owner_id uuid;
  v_school_id uuid;
  v_sub_id uuid;
  v_idx integer;
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_sessions) <> 'array' THEN
    RAISE EXCEPTION 'Expected sessions array' USING ERRCODE = '22023';
  END IF;

  FOR v_s IN SELECT value FROM jsonb_array_elements(p_sessions)
  LOOP
    v_sid := btrim(COALESCE(v_s ->> 'sessionId', ''));
    v_rid := COALESCE(NULLIF(btrim(v_s ->> 'sessionRecordId'), ''), 'REC_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    v_ckey := COALESCE(NULLIF(btrim(v_s ->> 'clientSubmissionKey'), ''), 'IMP_' || COALESCE(NULLIF(v_sid, ''), gen_random_uuid()::text));
    v_fac_email := lower(btrim(COALESCE(v_s ->> 'facilitatorEmail', '')));

    IF v_sid = '' OR v_fac_email = '' OR btrim(COALESCE(v_s ->> 'udiseCode', '')) !~ '^\d{11}$' THEN
      v_rejected := v_rejected + 1;
      v_errors := v_errors || jsonb_build_array('Skipped malformed session: ' || COALESCE(NULLIF(v_sid, ''), v_rid));
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.form_submissions
      WHERE client_submission_key = v_ckey OR submission_reference = v_sid OR session_record_id = v_rid
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_owner_id FROM public.profiles WHERE email = v_fac_email LIMIT 1;
    IF v_owner_id IS NULL THEN
      v_owner_id := v_uid;
      INSERT INTO public.facilitator_preapprovals (email, full_name, account_status, active, organisation_id, preapproved_by)
      VALUES (v_fac_email, COALESCE(NULLIF(btrim(v_s ->> 'facilitatorName'), ''), v_fac_email), 'APPROVED', true, v_org_id, v_uid)
      ON CONFLICT (email) DO NOTHING;
      IF FOUND THEN v_reg_facs := v_reg_facs + 1; END IF;
    END IF;

    SELECT id INTO v_school_id FROM public.schools WHERE udise_code = btrim(v_s ->> 'udiseCode') LIMIT 1;
    IF v_school_id IS NULL THEN
      v_school_id := gen_random_uuid();
      INSERT INTO public.schools (
        id, school_record_id, organisation_id, udise_code, school_name, school_type,
        state, district, pin_code, active, created_by, updated_by
      )
      VALUES (
        v_school_id, 'SCH_' || upper(substring(replace(v_school_id::text, '-', ''), 1, 8)), v_org_id,
        btrim(v_s ->> 'udiseCode'), btrim(v_s ->> 'schoolName'), COALESCE(NULLIF(v_s ->> 'schoolType', ''), 'Government school'),
        'Tamil Nadu',
        CASE WHEN (v_s ->> 'district') IN ('Cuddalore', 'Nagapattinam', 'Sivaganga') THEN v_s ->> 'district' ELSE 'Cuddalore' END,
        CASE WHEN (v_s ->> 'pinCode') ~ '^\d{6}$' THEN v_s ->> 'pinCode' ELSE '600001' END,
        true, v_uid, v_uid
      );
      v_rep_schools := v_rep_schools + 1;
    END IF;

    v_sub_id := gen_random_uuid();
    INSERT INTO public.form_submissions (
      id, submission_reference, session_record_id, client_submission_key,
      user_id, organisation_id, school_id,
      distribution_channel_host_id, product_name, unique_student_id, cc,
      zipcode_postal_code, completion_date, completion_rate, student_csat,
      underserved_reach, grade_of_students,
      facilitator_name, facilitator_email, tour_id, tour_name, video_id, language,
      start_date, end_date, start_time, end_time, duration_minutes, duration_formatted,
      reporting_month, submission_timestamp, submission_date_formatted,
      school_name, udise_code, school_type, state, district, pin_code,
      session_type, total_classes, total_students_present,
      total_question_a_responses, total_question_b_responses,
      overall_csat, overall_itp, teacher_score, teacher_classification, teacher_nps,
      submission_status, sync_status, synced_at, archived, submitted_at, created_by, updated_by
    )
    VALUES (
      v_sub_id, v_sid, v_rid, v_ckey,
      v_owner_id, v_org_id, v_school_id,
      btrim(v_s ->> 'udiseCode'), COALESCE(v_s ->> 'tourName', ''), 'AGGREGATE_COHORT', 'IN',
      CASE WHEN (v_s ->> 'pinCode') ~ '^\d{6}$' THEN v_s ->> 'pinCode' ELSE '600001' END,
      COALESCE(NULLIF(v_s ->> 'endDate', ''), v_s ->> 'startDate')::date,
      100.00, NULLIF(v_s ->> 'overallCsat', '')::numeric, 'Yes', '',
      COALESCE(NULLIF(v_s ->> 'facilitatorName', ''), v_fac_email), v_fac_email,
      COALESCE(v_s ->> 'tourId', 'TOUR_AM'), COALESCE(v_s ->> 'tourName', ''), COALESCE(v_s ->> 'videoId', ''),
      COALESCE(v_s ->> 'language', 'Tamil'),
      (v_s ->> 'startDate')::date, COALESCE(NULLIF(v_s ->> 'endDate', ''), v_s ->> 'startDate')::date,
      COALESCE(NULLIF(v_s ->> 'startTime', ''), '09:00'), COALESCE(NULLIF(v_s ->> 'endTime', ''), '10:00'),
      GREATEST(1, COALESCE((v_s ->> 'durationMinutes')::integer, 45)), COALESCE(v_s ->> 'durationFormatted', '45 mins'),
      COALESCE(v_s ->> 'reportingMonth', ''), COALESCE(NULLIF(v_s ->> 'submissionTimestamp', '')::timestamptz, now()),
      COALESCE(v_s ->> 'submissionDateFormatted', to_char(now(), 'DD-MM-YYYY')),
      btrim(v_s ->> 'schoolName'), btrim(v_s ->> 'udiseCode'), COALESCE(v_s ->> 'schoolType', 'Government school'),
      'Tamil Nadu',
      CASE WHEN (v_s ->> 'district') IN ('Cuddalore', 'Nagapattinam', 'Sivaganga') THEN v_s ->> 'district' ELSE 'Cuddalore' END,
      CASE WHEN (v_s ->> 'pinCode') ~ '^\d{6}$' THEN v_s ->> 'pinCode' ELSE '600001' END,
      CASE WHEN (v_s ->> 'sessionType') IN ('single', 'combined') THEN v_s ->> 'sessionType' ELSE 'single' END,
      GREATEST(1, COALESCE((v_s ->> 'totalClasses')::integer, 1)),
      GREATEST(1, COALESCE((v_s ->> 'totalStudentsPresent')::integer, 1)),
      GREATEST(0, COALESCE((v_s ->> 'totalQuestionAResponses')::integer, 0)),
      GREATEST(0, COALESCE((v_s ->> 'totalQuestionBResponses')::integer, 0)),
      NULLIF(v_s ->> 'overallCsat', '')::numeric, NULLIF(v_s ->> 'overallItp', '')::numeric,
      NULLIF(v_s ->> 'teacherScore', '')::integer,
      CASE WHEN (v_s ->> 'teacherClassification') IN ('Promoter', 'Passive', 'Detractor') THEN v_s ->> 'teacherClassification' ELSE 'Passive' END,
      COALESCE((v_s ->> 'teacherNps')::integer, 0),
      CASE WHEN (v_s ->> 'submissionStatus') IN ('COMMITTED', 'CORRECTED') THEN v_s ->> 'submissionStatus' ELSE 'COMMITTED' END,
      'SYNCED', now(), COALESCE((v_s ->> 'archived')::boolean, false), now(),
      COALESCE(NULLIF(v_s ->> 'createdBy', ''), v_fac_email), private.current_user_email()
    );

    v_idx := 0;
    FOR v_d IN SELECT value FROM jsonb_array_elements(COALESCE(v_s -> 'details', '[]'::jsonb))
    LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.form_submission_classes (
        detail_record_id, submission_id, session_record_id, session_id, row_order,
        grade, section, students_present,
        question_a_score_5, question_a_score_4, question_a_score_3, question_a_score_2, question_a_score_1,
        question_a_total, question_a_weighted_score, csat,
        question_b_score_5, question_b_score_4, question_b_score_3, question_b_score_2, question_b_score_1,
        question_b_total, question_b_weighted_score, itp
      )
      VALUES (
        COALESCE(NULLIF(v_d ->> 'detailRecordId', ''), 'DET_' || upper(substring(replace(v_sub_id::text, '-', ''), 1, 8)) || '_' || v_idx),
        v_sub_id, v_rid, v_sid, v_idx,
        COALESCE(v_d ->> 'grade', '8'), COALESCE(v_d ->> 'section', 'A'),
        GREATEST(1, COALESCE((v_d ->> 'studentsPresent')::integer, 1)),
        COALESCE((v_d ->> 'questionAScore5')::integer, 0), COALESCE((v_d ->> 'questionAScore4')::integer, 0),
        COALESCE((v_d ->> 'questionAScore3')::integer, 0), COALESCE((v_d ->> 'questionAScore2')::integer, 0),
        COALESCE((v_d ->> 'questionAScore1')::integer, 0),
        COALESCE((v_d ->> 'questionATotal')::integer, 0), COALESCE((v_d ->> 'questionAWeightedScore')::integer, 0),
        NULLIF(v_d ->> 'csat', '')::numeric,
        COALESCE((v_d ->> 'questionBScore5')::integer, 0), COALESCE((v_d ->> 'questionBScore4')::integer, 0),
        COALESCE((v_d ->> 'questionBScore3')::integer, 0), COALESCE((v_d ->> 'questionBScore2')::integer, 0),
        COALESCE((v_d ->> 'questionBScore1')::integer, 0),
        COALESCE((v_d ->> 'questionBTotal')::integer, 0), COALESCE((v_d ->> 'questionBWeightedScore')::integer, 0),
        NULLIF(v_d ->> 'itp', '')::numeric
      )
      ON CONFLICT (detail_record_id) DO NOTHING;
    END LOOP;

    v_imported := v_imported + 1;
  END LOOP;

  INSERT INTO public.sync_logs (
    sync_code, client_submission_key, session_record_id, session_id, actor_email, destination, operation, sync_status, error_message
  )
  VALUES (
    'SYNC_' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    'IMPORT_PACKAGE', v_imported::text, 'IMPORT', private.current_user_email(),
    'supabase_postgres', 'importSessions', 'SYNCED', ''
  );

  RETURN jsonb_build_object(
    'importedCount', v_imported,
    'skippedDuplicates', v_skipped,
    'rejectedCount', v_rejected,
    'registeredFacilitators', v_reg_facs,
    'repairedSchools', v_rep_schools,
    'errors', v_errors
  );
END;
$$;

-- Hardened RPC Grants: Zero public / anon execution
REVOKE ALL ON FUNCTION
  public.get_my_profile(),
  public.get_sanitized_app_settings(),
  public.submit_form_session(jsonb),
  public.update_form_session(text, jsonb),
  public.archive_or_restore_form_session(text, boolean),
  public.delete_form_sessions(text[]),
  public.update_school_master(text, text, text, text, text, text, text, boolean),
  public.delete_school_master(text),
  public.list_managed_directory(),
  public.admin_manage_facilitator(text, text, text, text, boolean, text),
  public.admin_delete_facilitator(text),
  public.admin_save_app_settings(jsonb),
  public.get_sheets_connection_state(),
  public.admin_save_sheets_connection(jsonb),
  public.log_export_event(text, integer, text),
  public.log_user_activity(text, text, jsonb),
  public.get_database_health(),
  public.recover_database_health(),
  public.admin_import_sessions(jsonb)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.get_my_profile(),
  public.get_sanitized_app_settings(),
  public.submit_form_session(jsonb),
  public.update_form_session(text, jsonb),
  public.archive_or_restore_form_session(text, boolean),
  public.delete_form_sessions(text[]),
  public.update_school_master(text, text, text, text, text, text, text, boolean),
  public.delete_school_master(text),
  public.list_managed_directory(),
  public.admin_manage_facilitator(text, text, text, text, boolean, text),
  public.admin_delete_facilitator(text),
  public.admin_save_app_settings(jsonb),
  public.get_sheets_connection_state(),
  public.admin_save_sheets_connection(jsonb),
  public.log_export_event(text, integer, text),
  public.log_user_activity(text, text, jsonb),
  public.get_database_health(),
  public.recover_database_health(),
  public.admin_import_sessions(jsonb)
TO authenticated;

-- Private Storage Bucket for Backups & Templates
INSERT INTO storage.buckets (id, name, public)
VALUES ('programme-archives', 'programme-archives', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'programme_archives_select'
  ) THEN
    CREATE POLICY "programme_archives_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'programme-archives' AND (SELECT private.is_super_admin()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'programme_archives_insert'
  ) THEN
    CREATE POLICY "programme_archives_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'programme-archives' AND (SELECT private.is_super_admin()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'programme_archives_update'
  ) THEN
    CREATE POLICY "programme_archives_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'programme-archives' AND (SELECT private.is_super_admin()))
      WITH CHECK (bucket_id = 'programme-archives' AND (SELECT private.is_super_admin()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'programme_archives_delete'
  ) THEN
    CREATE POLICY "programme_archives_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'programme-archives' AND (SELECT private.is_super_admin()));
  END IF;
END;
$$;

-- Supabase Realtime publication for live Admin Dashboard & Directory updates
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'form_submissions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.form_submissions;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sync_logs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_logs;
    END IF;
  END IF;
END;
$$;
