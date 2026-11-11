import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPER_ADMIN_ALLOWLIST = new Set([
  "brinthajayaprakash888@gmail.com",
  "karunya@vidhyavidhai.org",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isSafeHttpsWebhookUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^10\./.test(host) ||
      /^127\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

interface AppsScriptWebhookResult {
  ok: boolean;
  status: number;
  data?: Record<string, unknown>;
  error: string;
  text: string;
}

async function postAppsScriptWebhook(
  url: string,
  payload: unknown,
  timeoutMs = 20000,
): Promise<AppsScriptWebhookResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let parsed: Record<string, unknown> | null = null;
    try {
      const candidate = JSON.parse(text);
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }

    if (parsed === null) {
      return {
        ok: false,
        status: res.status,
        error:
          'Apps Script returned HTML/non-JSON (set Web App access to "Anyone" and use the /exec URL).',
        text,
      };
    }

    const parsedData =
      parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
        ? (parsed.data as Record<string, unknown>)
        : undefined;

    if (parsed.ok === false) {
      return {
        ok: false,
        status: res.status,
        data: parsedData,
        error: String(parsed.error || parsed.code || "Apps Script rejected request").trim(),
        text,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: parsedData,
        error: String(parsed.error || `Webhook HTTP ${res.status}`).trim(),
        text,
      };
    }

    return {
      ok: true,
      status: res.status,
      data: parsedData,
      error: "",
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function toNullableNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function mapClassRowToDetailRecord(d: Record<string, unknown>, parent: Record<string, unknown>) {
  return {
    detailRecordId: String(d.detail_record_id ?? ""),
    sessionRecordId: String(d.session_record_id ?? parent.session_record_id ?? ""),
    sessionId: String(d.session_id ?? parent.submission_reference ?? ""),
    grade: String(d.grade ?? ""),
    section: String(d.section ?? ""),
    studentsPresent: Number(d.students_present ?? 0) || 0,
    questionAScore5: Number(d.question_a_score_5 ?? 0) || 0,
    questionAScore4: Number(d.question_a_score_4 ?? 0) || 0,
    questionAScore3: Number(d.question_a_score_3 ?? 0) || 0,
    questionAScore2: Number(d.question_a_score_2 ?? 0) || 0,
    questionAScore1: Number(d.question_a_score_1 ?? 0) || 0,
    questionATotal: Number(d.question_a_total ?? 0) || 0,
    questionAWeightedScore: Number(d.question_a_weighted_score ?? 0) || 0,
    csat: toNullableNumber(d.csat),
    questionBScore5: Number(d.question_b_score_5 ?? 0) || 0,
    questionBScore4: Number(d.question_b_score_4 ?? 0) || 0,
    questionBScore3: Number(d.question_b_score_3 ?? 0) || 0,
    questionBScore2: Number(d.question_b_score_2 ?? 0) || 0,
    questionBScore1: Number(d.question_b_score_1 ?? 0) || 0,
    questionBTotal: Number(d.question_b_total ?? 0) || 0,
    questionBWeightedScore: Number(d.question_b_weighted_score ?? 0) || 0,
    itp: toNullableNumber(d.itp),
    createdAt: String(d.created_at ?? ""),
    updatedAt: String(d.updated_at ?? ""),
  };
}

function mapSubmissionRowToSessionRecord(
  row: Record<string, unknown>,
  userCodeByProfileId: Map<string, string>,
) {
  const rawClasses = Array.isArray(row.form_submission_classes)
    ? (row.form_submission_classes as Array<Record<string, unknown>>)
    : [];
  const sortedClasses = [...rawClasses].sort(
    (a, b) => (Number(a.row_order ?? 0) || 0) - (Number(b.row_order ?? 0) || 0),
  );
  const details = sortedClasses.map((d) => mapClassRowToDetailRecord(d, row));
  const userId = String(row.user_id ?? "");
  const facilitatorUserId = userCodeByProfileId.get(userId) || userId;

  return {
    sessionRecordId: String(row.session_record_id ?? ""),
    sessionId: String(row.submission_reference ?? ""),
    clientSubmissionKey: String(row.client_submission_key ?? ""),
    facilitatorName: String(row.facilitator_name ?? ""),
    facilitatorEmail: String(row.facilitator_email ?? ""),
    facilitatorUserId,
    tourId: String(row.tour_id ?? ""),
    tourName: String(row.tour_name ?? ""),
    videoId: String(row.video_id ?? ""),
    language: String(row.language ?? ""),
    startDate: String(row.start_date ?? "").slice(0, 10),
    endDate: String(row.end_date ?? "").slice(0, 10),
    startTime: String(row.start_time ?? ""),
    endTime: String(row.end_time ?? ""),
    durationMinutes: Number(row.duration_minutes ?? 0) || 0,
    durationFormatted: String(row.duration_formatted ?? ""),
    reportingMonth: String(row.reporting_month ?? ""),
    submissionTimestamp: String(row.submission_timestamp ?? row.submitted_at ?? ""),
    submissionDateFormatted: String(row.submission_date_formatted ?? ""),
    schoolName: String(row.school_name ?? ""),
    udiseCode: String(row.udise_code ?? ""),
    schoolType: String(row.school_type ?? ""),
    state: String(row.state ?? "Tamil Nadu"),
    district: String(row.district ?? ""),
    pinCode: String(row.pin_code ?? ""),
    sessionType: row.session_type === "combined" ? "combined" : "single",
    totalClasses: Number(row.total_classes ?? details.length) || details.length,
    totalStudentsPresent: Number(row.total_students_present ?? 0) || 0,
    totalQuestionAResponses: Number(row.total_question_a_responses ?? 0) || 0,
    totalQuestionBResponses: Number(row.total_question_b_responses ?? 0) || 0,
    overallCsat: toNullableNumber(row.overall_csat),
    overallItp: toNullableNumber(row.overall_itp),
    teacherScore: toNullableNumber(row.teacher_score),
    teacherClassification: String(row.teacher_classification ?? "Passive"),
    teacherNps: Number(row.teacher_nps ?? 0) || 0,
    submissionStatus: String(row.submission_status ?? "COMMITTED"),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    createdBy: String(row.created_by ?? ""),
    updatedBy: String(row.updated_by ?? ""),
    archived: Boolean(row.archived),
    details,
  };
}

function mapSchoolRowToSchoolRecord(row: Record<string, unknown>) {
  return {
    schoolRecordId: String(row.school_record_id ?? ""),
    schoolName: String(row.school_name ?? ""),
    udiseCode: String(row.udise_code ?? ""),
    schoolType: String(row.school_type ?? ""),
    state: String(row.state ?? "Tamil Nadu"),
    district: String(row.district ?? ""),
    pinCode: String(row.pin_code ?? ""),
    active: row.active !== false,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function mapProfileRowToFacilitator(row: Record<string, unknown>) {
  return {
    userId: String(row.user_code ?? row.id ?? ""),
    name: String(row.full_name ?? row.email ?? ""),
    email: String(row.email ?? ""),
    role: String(row.role ?? "facilitator"),
    active: row.active !== false,
    status: String(row.account_status ?? "PENDING"),
    createdAt: String(row.created_at ?? ""),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return jsonResponse({ ok: false, error: "Server environment misconfigured" }, 500);
  }

  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ ok: false, error: "Missing Authorization Bearer token" }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ ok: false, error: "Unauthorized session" }, 401);
  }

  const authUser = userData.user;
  const { data: profile, error: profileErr } = await serviceClient
    .from("profiles")
    .select("id, email, full_name, role, account_status, active")
    .eq("id", authUser.id)
    .single();

  if (profileErr || !profile) {
    return jsonResponse({ ok: false, error: "User profile not found" }, 403);
  }

  if (profile.account_status !== "APPROVED" || !profile.active) {
    return jsonResponse({ ok: false, error: "Account not approved for operations" }, 403);
  }

  const normalizedEmail = String(profile.email ?? "").trim().toLowerCase();
  const isSuperAdmin = profile.role === "super_admin" && SUPER_ADMIN_ALLOWLIST.has(normalizedEmail);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" }, 400);
  }

  const action = String(body.action ?? "sync_session");

  const { data: connRow } = await serviceClient
    .from("sheets_connections")
    .select("*")
    .eq("connection_key", "primary")
    .maybeSingle();

  const webhookUrl = String(body.appsScriptUrl ?? connRow?.apps_script_webhook_url ?? "").trim();
  const spreadsheetId = String(body.spreadsheetId ?? connRow?.spreadsheet_id ?? "").trim();
  const syncKey = String(connRow?.apps_script_sync_key ?? "").trim();
  const connActor = String(connRow?.connected_by_email ?? "").trim().toLowerCase();
  const syncActorEmail = SUPER_ADMIN_ALLOWLIST.has(connActor)
    ? connActor
    : SUPER_ADMIN_ALLOWLIST.has(normalizedEmail)
    ? normalizedEmail
    : "brinthajayaprakash888@gmail.com";

  if (action === "test_webhook") {
    if (!isSuperAdmin) {
      return jsonResponse({ ok: false, error: "Super Administrator access required" }, 403);
    }
    if (!webhookUrl || !isSafeHttpsWebhookUrl(webhookUrl)) {
      return jsonResponse({
        ok: false,
        error: "A valid public HTTPS Apps Script webhook URL is required",
      }, 400);
    }
    if (!syncKey) {
      return jsonResponse({
        ok: false,
        error: "Apps Script sync key is missing. Save the Google Sheets connection in the portal first.",
      }, 400);
    }
    try {
      const result = await postAppsScriptWebhook(webhookUrl, {
        action: "ping",
        syncKey,
        actorEmail: syncActorEmail,
        spreadsheetId,
        payload: {
          spreadsheetId,
          source: "vidhya-vidhai-supabase",
        },
      });
      return jsonResponse({
        ok: result.ok,
        data: {
          reachable: result.ok,
          status: result.status,
          spreadsheetId: String(result.data?.spreadsheetId ?? spreadsheetId),
          spreadsheetName: String(result.data?.spreadsheetName ?? ""),
          spreadsheetUrl: String(result.data?.spreadsheetUrl ?? ""),
          message: result.ok
            ? String(result.data?.message ?? "Apps Script webhook responded cleanly.")
            : result.error,
        },
        error: result.ok ? undefined : result.error,
      }, result.ok ? 200 : 502);
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to reach Google Apps Script webhook",
      }, 502);
    }
  }

  if (action === "sync_session") {
    const sessionRecordId = String(body.sessionRecordId ?? "").trim();
    if (!sessionRecordId) {
      return jsonResponse({ ok: false, error: "sessionRecordId is required" }, 400);
    }

    const { data: submission, error: subErr } = await serviceClient
      .from("form_submissions")
      .select("*, form_submission_classes(*)")
      .eq("session_record_id", sessionRecordId)
      .maybeSingle();

    if (subErr || !submission) {
      return jsonResponse({ ok: false, error: "Submission not found" }, 404);
    }

    if (!isSuperAdmin && submission.user_id !== authUser.id) {
      return jsonResponse({ ok: false, error: "Forbidden for another user's session" }, 403);
    }

    const syncCode = `SYNC_${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const nowIso = new Date().toISOString();

    if (!connRow?.connected || !webhookUrl || !isSafeHttpsWebhookUrl(webhookUrl) || !syncKey) {
      return jsonResponse({
        ok: true,
        data: {
          syncedCount: 0,
          skipped: true,
          syncedAt: nowIso,
          message: "Committed to Supabase PostgreSQL. Optional Google Sheets webhook is not connected.",
        },
      });
    }

    try {
      const { data: ownerProfile } = await serviceClient
        .from("profiles")
        .select("user_code")
        .eq("id", submission.user_id)
        .maybeSingle();

      const userCodeMap = new Map<string, string>();
      if (ownerProfile?.user_code) {
        userCodeMap.set(String(submission.user_id), String(ownerProfile.user_code));
      }
      const mappedSession = mapSubmissionRowToSessionRecord(
        submission as Record<string, unknown>,
        userCodeMap,
      );

      const hookRes = await postAppsScriptWebhook(webhookUrl, {
        action: "upsertSession",
        syncKey,
        actorEmail: syncActorEmail,
        spreadsheetId,
        payload: {
          spreadsheetId,
          session: mappedSession,
        },
      });

      await serviceClient.from("sync_logs").insert({
        sync_code: syncCode,
        submission_id: submission.id,
        client_submission_key: submission.client_submission_key,
        session_record_id: submission.session_record_id,
        session_id: submission.submission_reference,
        actor_email: normalizedEmail,
        destination: "google_sheets",
        operation: "sync_session",
        sync_status: hookRes.ok ? "SYNCED" : "FAILED",
        retry_count: 1,
        error_message: hookRes.ok ? "" : hookRes.error,
        last_attempt_at: nowIso,
      });

      if (hookRes.ok) {
        await serviceClient
          .from("form_submissions")
          .update({
            sync_status: "SYNCED",
            synced_at: nowIso,
          })
          .eq("id", submission.id);

        await serviceClient
          .from("sheets_connections")
          .update({
            last_synced_at: nowIso,
            last_sync_status: "SYNCED",
            last_sync_message: String(
              hookRes.data?.message ?? `Synced ${submission.submission_reference} via Edge Function.`,
            ),
          })
          .eq("connection_key", "primary");
      }

      return jsonResponse({
        ok: true,
        data: {
          syncedCount: hookRes.ok ? 1 : 0,
          skippedDuplicates: 0,
          totalSheetSessions: 1,
          syncedAt: nowIso,
          message: hookRes.ok
            ? String(hookRes.data?.message ?? "Synced to Supabase PostgreSQL and forwarded to Google Sheets.")
            : `Saved to Supabase PostgreSQL, but Google Sheets webhook reported: ${hookRes.error}`,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Secondary Google Sheets timeout";
      await serviceClient.from("sync_logs").insert({
        sync_code: syncCode,
        submission_id: submission.id,
        client_submission_key: submission.client_submission_key,
        session_record_id: submission.session_record_id,
        session_id: submission.submission_reference,
        actor_email: normalizedEmail,
        destination: "google_sheets",
        operation: "sync_session",
        sync_status: "FAILED",
        retry_count: 1,
        error_message: msg,
        last_attempt_at: nowIso,
      });

      return jsonResponse({
        ok: true,
        data: {
          syncedCount: 0,
          skipped: false,
          syncedAt: nowIso,
          message: `Saved safely in Supabase PostgreSQL. Optional Google Sheets sync failed: ${msg}`,
        },
      });
    }
  }

  if (action === "sync_all") {
    if (!isSuperAdmin) {
      return jsonResponse({ ok: false, error: "Super Administrator access required" }, 403);
    }

    if (!webhookUrl || !isSafeHttpsWebhookUrl(webhookUrl)) {
      return jsonResponse({
        ok: false,
        error: "Configure an Apps Script Web App HTTPS URL in Connect Google Sheet before pushing rows from the Edge Function. Your data remains safely stored in Supabase PostgreSQL.",
      }, 400);
    }

    if (!syncKey) {
      return jsonResponse({
        ok: false,
        error: "Apps Script sync key is missing. Click Save & Push in the portal first.",
      }, 400);
    }

    const nowIso = new Date().toISOString();
    const { data: sessions, error: sessErr } = await serviceClient
      .from("form_submissions")
      .select("*, form_submission_classes(*)")
      .eq("archived", false)
      .order("submitted_at", { ascending: false });

    if (sessErr) {
      return jsonResponse({ ok: false, error: sessErr.message }, 500);
    }

    const rawSessions = (sessions ?? []) as Array<Record<string, unknown>>;

    const [{ data: schools }, { data: profiles }] = await Promise.all([
      serviceClient.from("schools").select("*"),
      serviceClient
        .from("profiles")
        .select("id, user_code, full_name, email, role, active, account_status, created_at"),
    ]);

    const userCodeMap = new Map<string, string>();
    const rawProfiles = (profiles ?? []) as Array<Record<string, unknown>>;
    for (const p of rawProfiles) {
      if (p.id && p.user_code) {
        userCodeMap.set(String(p.id), String(p.user_code));
      }
    }

    const mappedSessions = rawSessions.map((s) => mapSubmissionRowToSessionRecord(s, userCodeMap));
    const mappedSchools = ((schools ?? []) as Array<Record<string, unknown>>).map(
      mapSchoolRowToSchoolRecord,
    );
    const mappedFacilitators = rawProfiles.map(mapProfileRowToFacilitator);

    const syncCode = `SYNC_${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

    try {
      const hookRes = await postAppsScriptWebhook(
        webhookUrl,
        {
          action: "syncAll",
          syncKey,
          actorEmail: syncActorEmail,
          spreadsheetId,
          payload: {
            spreadsheetId,
            sessions: mappedSessions,
            schools: mappedSchools,
            facilitators: mappedFacilitators,
          },
        },
        25000,
      );

      await serviceClient.from("sync_logs").insert({
        sync_code: syncCode,
        client_submission_key: "BATCH_SYNC",
        session_record_id: String(mappedSessions.length),
        session_id: "BATCH_ALL",
        actor_email: normalizedEmail,
        destination: "google_sheets",
        operation: "sync_all",
        sync_status: hookRes.ok ? "SYNCED" : "FAILED",
        retry_count: 1,
        error_message: hookRes.ok ? "" : hookRes.error,
        last_attempt_at: nowIso,
      });

      const remoteSyncedCount = Number(hookRes.data?.syncedCount ?? mappedSessions.length) || 0;
      const remoteSkipped = Number(hookRes.data?.skippedDuplicates ?? 0) || 0;
      const remoteTotal = Number(hookRes.data?.totalSheetSessions ?? mappedSessions.length) || 0;
      const remoteMessage = String(
        hookRes.data?.message ??
          `Synced ${remoteSyncedCount} session(s) from Supabase PostgreSQL to Google Sheets.`,
      );

      await serviceClient
        .from("sheets_connections")
        .update({
          last_synced_at: nowIso,
          last_sync_status: hookRes.ok ? "SYNCED" : "FAILED",
          last_sync_message: hookRes.ok ? remoteMessage : hookRes.error,
        })
        .eq("connection_key", "primary");

      if (!hookRes.ok) {
        return jsonResponse({ ok: false, error: hookRes.error }, 502);
      }

      return jsonResponse({
        ok: true,
        data: {
          syncedCount: remoteSyncedCount,
          skippedDuplicates: remoteSkipped,
          syncedSchoolsCount: Number(hookRes.data?.syncedSchoolsCount ?? 0) || 0,
          syncedFacilitatorsCount: Number(hookRes.data?.syncedFacilitatorsCount ?? 0) || 0,
          totalSheetSessions: remoteTotal,
          syncedAt: String(hookRes.data?.syncedAt ?? nowIso),
          message: remoteMessage,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reach Apps Script webhook";
      await serviceClient.from("sync_logs").insert({
        sync_code: syncCode,
        client_submission_key: "BATCH_SYNC",
        session_record_id: String(mappedSessions.length),
        session_id: "BATCH_ALL",
        actor_email: normalizedEmail,
        destination: "google_sheets",
        operation: "sync_all",
        sync_status: "FAILED",
        retry_count: 1,
        error_message: msg,
        last_attempt_at: nowIso,
      });
      return jsonResponse({ ok: false, error: msg }, 502);
    }
  }

  return jsonResponse({ ok: false, error: `Unsupported action: ${action}` }, 400);
});
