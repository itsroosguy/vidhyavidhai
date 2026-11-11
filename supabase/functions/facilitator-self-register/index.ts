import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPER_ADMIN_ALLOWLIST = new Set([
  "brinthajayaprakash888@gmail.com",
  "karunya@vidhyavidhai.org",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    password.length <= 128 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ ok: false, error: "Server environment misconfigured" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" }, 400);
  }

  const fullName = String(body.fullName ?? "").trim();
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (fullName.length < 2 || fullName.length > 120) {
    return jsonResponse({ ok: false, error: "Enter your full name (2 to 120 characters)." }, 400);
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 160) {
    return jsonResponse({ ok: false, error: "Enter a valid email address." }, 400);
  }
  if (SUPER_ADMIN_ALLOWLIST.has(email)) {
    return jsonResponse(
      {
        ok: false,
        error: "Super Administrator accounts already exist. Return to Sign In with your administrator password.",
      },
      403,
    );
  }
  if (!isStrongPassword(password)) {
    return jsonResponse(
      {
        ok: false,
        error: "Password must be at least 8 characters and include uppercase, lowercase, and a number.",
      },
      400,
    );
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  // Never overwrite an existing profile or auth account from an unauthenticated endpoint
  const { data: existingProfile } = await serviceClient
    .from("profiles")
    .select("id, account_status")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    return jsonResponse(
      {
        ok: false,
        code: "ALREADY_REGISTERED",
        error:
          "An account with this email already exists. Return to Sign In, or ask your Super Administrator to reset your password in User Management.",
      },
      409,
    );
  }

  const { data: preapproval } = await serviceClient
    .from("facilitator_preapprovals")
    .select("id, account_status, active")
    .eq("email", email)
    .maybeSingle();

  if (preapproval?.account_status === "DENIED") {
    return jsonResponse(
      {
        ok: false,
        error: "This email has been denied access. Contact a Super Administrator.",
      },
      403,
    );
  }

  const isPreapprovedApproved = Boolean(
    preapproval && preapproval.account_status === "APPROVED" && preapproval.active,
  );

  // Guard pending queue against automated registration bursts
  if (!isPreapprovedApproved) {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: recentPendingCount } = await serviceClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("account_status", "PENDING")
      .gte("created_at", tenMinutesAgo);

    if ((recentPendingCount ?? 0) >= 100) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Too many pending self-registrations at this moment. Ask your Super Administrator to provision your login directly in User Management.",
        },
        429,
      );
    }
  }

  const { data: createData, error: createErr } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: isPreapprovedApproved
      ? { require_admin_approval: false }
      : { require_admin_approval: true },
  });

  if (createErr || !createData?.user) {
    const msg = String(createErr?.message ?? "");
    const lower = msg.toLowerCase();
    if (lower.includes("already") || lower.includes("registered") || lower.includes("exists")) {
      return jsonResponse(
        {
          ok: false,
          code: "ALREADY_REGISTERED",
          error:
            "An account with this email is already registered (possibly awaiting email confirmation). Ask your Super Administrator to click 'Confirm & Approve' or 'Set Password' in User Management.",
        },
        409,
      );
    }
    return jsonResponse(
      { ok: false, error: msg || "Unable to create facilitator account right now." },
      400,
    );
  }

  return jsonResponse({
    ok: true,
    data: {
      approvedImmediately: isPreapprovedApproved,
      status: isPreapprovedApproved ? "APPROVED" : "PENDING",
      message: isPreapprovedApproved
        ? "Account created using Super Administrator pre-approval. Signing you in..."
        : "Account created without needing a confirmation email. Your request is now waiting in the Super Administrator Pending Approval Queue.",
    },
  });
});
