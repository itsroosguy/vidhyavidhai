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

async function postJsonWithTimeout(url: string, payload: unknown, timeoutMs = 10000): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
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
    try {
      const result = await postJsonWithTimeout(webhookUrl, {
        action: "ping",
        spreadsheetId,
        source: "vidhya-vidhai-supabase",
      });
      return jsonResponse({
        ok: result.ok,
        data: {
          reachable: result.ok,
          status: result.status,
          message: result.ok ? "Apps Script webhook responded cleanly." : `Webhook HTTP ${result.status}`,
        },
        error: result.ok ? undefined : `Webhook returned HTTP ${result.status}`,
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

    if (!connRow?.connected || !webhookUrl || !isSafeHttpsWebhookUrl(webhookUrl)) {
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
      const hookRes = await postJsonWithTimeout(webhookUrl, {
        action: "upsertSession",
        spreadsheetId,
        session: submission,
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
        error_message: hookRes.ok ? "" : `Google Sheets webhook HTTP ${hookRes.status}`,
        last_attempt_at: nowIso,
      });

      if (hookRes.ok) {
        await serviceClient
          .from("sheets_connections")
          .update({
            last_synced_at: nowIso,
            last_sync_status: "SYNCED",
            last_sync_message: `Synced ${submission.submission_reference} via Edge Function.`,
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
            ? "Synced to Supabase PostgreSQL and forwarded to Google Sheets."
            : `Saved to Supabase PostgreSQL, but Google Sheets webhook returned HTTP ${hookRes.status}.`,
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

    const nowIso = new Date().toISOString();
    const { data: sessions, error: sessErr } = await serviceClient
      .from("form_submissions")
      .select("*, form_submission_classes(*)")
      .eq("archived", false)
      .order("submitted_at", { ascending: false });

    if (sessErr) {
      return jsonResponse({ ok: false, error: sessErr.message }, 500);
    }

    const allSessions = sessions ?? [];

    if (!webhookUrl || !isSafeHttpsWebhookUrl(webhookUrl)) {
      return jsonResponse({
        ok: false,
        error: "Configure an Apps Script Web App HTTPS URL in Connect Google Sheet before pushing rows from the Edge Function. Your data remains safely stored in Supabase PostgreSQL.",
      }, 400);
    }

    const { data: schools } = await serviceClient.from("schools").select("*");
    const syncCode = `SYNC_${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

    try {
      const hookRes = await postJsonWithTimeout(
        webhookUrl,
        {
          action: "syncAll",
          spreadsheetId,
          sessions: allSessions,
          schools: schools ?? [],
        },
        15000,
      );

      await serviceClient.from("sync_logs").insert({
        sync_code: syncCode,
        client_submission_key: "BATCH_SYNC",
        session_record_id: String(allSessions.length),
        session_id: "BATCH_ALL",
        actor_email: normalizedEmail,
        destination: "google_sheets",
        operation: "sync_all",
        sync_status: hookRes.ok ? "SYNCED" : "FAILED",
        retry_count: 1,
        error_message: hookRes.ok ? "" : `Google Sheets webhook HTTP ${hookRes.status}`,
        last_attempt_at: nowIso,
      });

      await serviceClient
        .from("sheets_connections")
        .update({
          last_synced_at: nowIso,
          last_sync_status: hookRes.ok ? "SYNCED" : "FAILED",
          last_sync_message: hookRes.ok
            ? `Pushed ${allSessions.length} active session(s) from Supabase PostgreSQL to Google Sheets.`
            : `Webhook returned HTTP ${hookRes.status}.`,
        })
        .eq("connection_key", "primary");

      if (!hookRes.ok) {
        return jsonResponse({ ok: false, error: `Google Sheets webhook HTTP ${hookRes.status}` }, 502);
      }

      return jsonResponse({
        ok: true,
        data: {
          syncedCount: allSessions.length,
          skippedDuplicates: 0,
          totalSheetSessions: allSessions.length,
          syncedAt: nowIso,
          message: `Synced ${allSessions.length} active session(s) to Google Sheets.`,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reach Apps Script webhook";
      await serviceClient.from("sync_logs").insert({
        sync_code: syncCode,
        client_submission_key: "BATCH_SYNC",
        session_record_id: String(allSessions.length),
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
