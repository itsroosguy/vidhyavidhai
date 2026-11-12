import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2";

const SUPER_ADMIN_ALLOWLIST = new Set([
  "brinthajayaprakash888@gmail.com",
  "karunya@vidhyavidhai.org",
  "ram@vidhyavidhai.org",
  "regi@vidhyavidhai.org",
  "nisha@vidhyavidhai.org",
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

function buildUserCode(authUserId: string): string {
  return `USR_${authUserId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

async function resolveDefaultOrgId(serviceClient: SupabaseClient): Promise<string> {
  const { data: primaryOrg } = await serviceClient
    .from("organisations")
    .select("id")
    .eq("organisation_code", "VV_TN")
    .maybeSingle();

  if (primaryOrg?.id) return String(primaryOrg.id);

  const { data: fallbackOrg } = await serviceClient
    .from("organisations")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (!fallbackOrg?.id) {
    throw new Error("Default Vidhya Vidhai organisation record not found.");
  }
  return String(fallbackOrg.id);
}

async function findAuthUserByEmail(
  serviceClient: SupabaseClient,
  email: string,
  cachedMap?: Map<string, User>,
): Promise<User | null> {
  if (cachedMap) {
    return cachedMap.get(email) ?? null;
  }

  const { data: existingProfile } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile?.id) {
    const { data: byIdData } = await serviceClient.auth.admin.getUserById(String(existingProfile.id));
    if (byIdData?.user) return byIdData.user;
  }

  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    const match = data.users.find((u) => normalizeEmail(u.email) === email);
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

async function buildAuthUserEmailMap(serviceClient: SupabaseClient): Promise<Map<string, User>> {
  const map = new Map<string, User>();
  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      const normalized = normalizeEmail(u.email);
      if (normalized) map.set(normalized, u);
    }
    if (data.users.length < 200) break;
  }
  return map;
}

interface ProvisionParams {
  serviceClient: SupabaseClient;
  actorUid: string;
  actorEmail: string;
  orgId: string;
  name: string;
  email: string;
  password: string;
  status: "APPROVED" | "DENIED";
  cachedMap?: Map<string, User>;
}

async function provisionSingleFacilitator(params: ProvisionParams) {
  const {
    serviceClient,
    actorUid,
    actorEmail,
    orgId,
    name,
    email,
    password,
    status,
    cachedMap,
  } = params;

  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false as const, status: 400, error: `Invalid email address: ${email || "(empty)"}` };
  }
  if (SUPER_ADMIN_ALLOWLIST.has(email)) {
    return {
      ok: false as const,
      status: 403,
      error: `Allowlisted Super Administrator (${email}) cannot be modified via facilitator provisioning.`,
    };
  }
  if (password.length < 8 || password.length > 128) {
    return {
      ok: false as const,
      status: 400,
      error: "Password must be between 8 and 128 characters.",
    };
  }

  const targetActive = status === "APPROVED";
  const resolvedName = name.trim() || email.split("@")[0] || "Facilitator";

  let authUser = await findAuthUserByEmail(serviceClient, email, cachedMap);
  let created = false;

  if (!authUser) {
    const { data: createData, error: createErr } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: resolvedName },
      app_metadata: { admin_provisioned: true, require_admin_approval: false },
    });

    if (createErr || !createData?.user) {
      // Handle race condition or user existing outside initial map
      const fallbackUser = await findAuthUserByEmail(serviceClient, email);
      if (!fallbackUser) {
        return {
          ok: false as const,
          status: 400,
          error: createErr?.message || `Failed to create auth account for ${email}.`,
        };
      }
      authUser = fallbackUser;
    } else {
      authUser = createData.user;
      created = true;
    }
  }

  if (!created && authUser) {
    const { data: updateData, error: updateErr } = await serviceClient.auth.admin.updateUserById(
      authUser.id,
      {
        password,
        email_confirm: true,
        user_metadata: {
          ...(authUser.user_metadata ?? {}),
          full_name: resolvedName,
        },
        app_metadata: {
          ...(authUser.app_metadata ?? {}),
          admin_provisioned: true,
          require_admin_approval: false,
        },
      },
    );

    if (updateErr || !updateData?.user) {
      return {
        ok: false as const,
        status: 400,
        error: updateErr?.message || `Failed to update credentials for ${email}.`,
      };
    }
    authUser = updateData.user;
  }

  if (!authUser) {
    return { ok: false as const, status: 500, error: "Unexpected auth provisioning failure." };
  }

  cachedMap?.set(email, authUser);

  const { data: existingProfile } = await serviceClient
    .from("profiles")
    .select("user_code, organisation_id, full_name")
    .eq("id", authUser.id)
    .maybeSingle();

  const userCode = existingProfile?.user_code
    ? String(existingProfile.user_code)
    : buildUserCode(authUser.id);
  const profileOrgId = existingProfile?.organisation_id
    ? String(existingProfile.organisation_id)
    : orgId;
  const finalName = name.trim() || String(existingProfile?.full_name ?? "").trim() || resolvedName;

  const { data: upsertedProfile, error: upsertErr } = await serviceClient
    .from("profiles")
    .upsert(
      {
        id: authUser.id,
        user_code: userCode,
        full_name: finalName,
        email,
        role: "facilitator",
        organisation_id: profileOrgId,
        account_status: status,
        active: targetActive,
      },
      { onConflict: "id" },
    )
    .select("user_code, full_name, email, role, active, account_status, created_at, updated_at")
    .single();

  if (upsertErr || !upsertedProfile) {
    return {
      ok: false as const,
      status: 500,
      error: upsertErr?.message || `Auth account ready, but profile sync failed for ${email}.`,
    };
  }

  await serviceClient.from("facilitator_preapprovals").delete().eq("email", email);

  await serviceClient.from("submission_audit_logs").insert({
    audit_code: `AUD_${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
    performed_by: actorUid,
    actor_email: actorEmail,
    action: created ? "PROVISION_USER_LOGIN" : "RESET_USER_LOGIN",
    entity_type: "User",
    entity_id: email,
    previous_summary: "",
    new_summary: `${upsertedProfile.account_status} active=${String(upsertedProfile.active)} email_confirmed=true`,
    result: "SUCCESS",
  });

  return {
    ok: true as const,
    created,
    user: {
      userId: String(upsertedProfile.user_code),
      name: String(upsertedProfile.full_name),
      email: String(upsertedProfile.email),
      role: "facilitator" as const,
      active: Boolean(upsertedProfile.active),
      status: String(upsertedProfile.account_status),
      emailConfirmed: true,
      hasLoginAccount: true,
      createdAt: String(upsertedProfile.created_at),
      updatedAt: String(upsertedProfile.updated_at),
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ ok: false, error: "Server environment misconfigured" }, 500);
    }

    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ ok: false, error: "Missing Authorization Bearer token" }, 401);
    }

    const token = authHeader.slice(7).trim();
    if (!token || token.startsWith("sb_") || token.split(".").length !== 3) {
      return jsonResponse({ ok: false, error: "Invalid user session token" }, 401);
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userErr } = await serviceClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse({ ok: false, error: "Unauthorized session" }, 401);
    }

  const caller = userData.user;
  const { data: callerProfile, error: callerProfileErr } = await serviceClient
    .from("profiles")
    .select("id, email, role, account_status, active")
    .eq("id", caller.id)
    .single();

  if (callerProfileErr || !callerProfile) {
    return jsonResponse({ ok: false, error: "Caller profile not found" }, 403);
  }

  const actorEmail = normalizeEmail(callerProfile.email);
  if (
    callerProfile.account_status !== "APPROVED" ||
    !callerProfile.active ||
    callerProfile.role !== "super_admin" ||
    !SUPER_ADMIN_ALLOWLIST.has(actorEmail)
  ) {
    return jsonResponse(
      { ok: false, error: "Only allowlisted Super Administrators may provision facilitator logins." },
      403,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" }, 400);
  }

  const action = String(body.action ?? "provision_user").trim();
  const orgId = await resolveDefaultOrgId(serviceClient);

  if (action === "provision_user") {
    const email = normalizeEmail(body.email);
    const name = String(body.name ?? "");
    const password = typeof body.password === "string" ? body.password : "";
    const rawStatus = String(body.status ?? "APPROVED").trim().toUpperCase();
    const status: "APPROVED" | "DENIED" = rawStatus === "DENIED" ? "DENIED" : "APPROVED";

    const res = await provisionSingleFacilitator({
      serviceClient,
      actorUid: caller.id,
      actorEmail,
      orgId,
      name,
      email,
      password,
      status,
    });

    if (!res.ok) {
      return jsonResponse({ ok: false, error: res.error }, res.status);
    }
    return jsonResponse({
      ok: true,
      data: {
        user: res.user,
        created: res.created,
      },
    });
  }

  if (action === "bulk_provision_users") {
    const rawUsers = Array.isArray(body.users) ? body.users : [];
    const sharedPassword = typeof body.sharedPassword === "string" ? body.sharedPassword : "";

    if (rawUsers.length === 0 || rawUsers.length > 60) {
      return jsonResponse(
        { ok: false, error: "Provide between 1 and 60 facilitator entries for bulk provisioning." },
        400,
      );
    }

    if (sharedPassword.length < 8 || sharedPassword.length > 128) {
      return jsonResponse(
        { ok: false, error: "Shared temporary password must be between 8 and 128 characters." },
        400,
      );
    }

    const deduped = new Map<string, { name: string; email: string }>();
    for (const item of rawUsers) {
      const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const email = normalizeEmail(entry.email);
      const name = String(entry.name ?? "").trim();
      if (!email) continue;
      if (!deduped.has(email)) {
        deduped.set(email, { email, name });
      }
    }

    if (deduped.size === 0) {
      return jsonResponse({ ok: false, error: "No valid email entries found." }, 400);
    }

    const cachedMap = await buildAuthUserEmailMap(serviceClient);
    const results: Array<{
      email: string;
      name: string;
      ok: boolean;
      created?: boolean;
      error?: string;
    }> = [];
    const provisionedUsers: Array<Record<string, unknown>> = [];
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    for (const entry of deduped.values()) {
      const outcome = await provisionSingleFacilitator({
        serviceClient,
        actorUid: caller.id,
        actorEmail,
        orgId,
        name: entry.name,
        email: entry.email,
        password: sharedPassword,
        status: "APPROVED",
        cachedMap,
      });

      if (outcome.ok) {
        if (outcome.created) createdCount += 1;
        else updatedCount += 1;
        provisionedUsers.push(outcome.user);
        results.push({
          email: entry.email,
          name: outcome.user.name,
          ok: true,
          created: outcome.created,
        });
      } else {
        failedCount += 1;
        results.push({
          email: entry.email,
          name: entry.name || entry.email,
          ok: false,
          error: outcome.error,
        });
      }
    }

    return jsonResponse({
      ok: true,
      data: {
        totalCount: deduped.size,
        createdCount,
        updatedCount,
        failedCount,
        results,
        users: provisionedUsers,
      },
    });
  }

  if (action === "confirm_user") {
    const email = normalizeEmail(body.email);
    if (!EMAIL_PATTERN.test(email)) {
      return jsonResponse({ ok: false, error: "Valid facilitator email is required." }, 400);
    }
    if (SUPER_ADMIN_ALLOWLIST.has(email)) {
      return jsonResponse(
        { ok: false, error: "Allowlisted Super Administrators do not use facilitator confirmation." },
        403,
      );
    }

    const authUser = await findAuthUserByEmail(serviceClient, email);
    if (!authUser) {
      return jsonResponse(
        {
          ok: false,
          error: "This user has not created a login password yet. Use 'Set Login Password' instead.",
        },
        404,
      );
    }

    const { data: updatedAuth, error: updateErr } = await serviceClient.auth.admin.updateUserById(
      authUser.id,
      {
        email_confirm: true,
        app_metadata: {
          ...(authUser.app_metadata ?? {}),
          admin_provisioned: true,
          require_admin_approval: false,
        },
      },
    );

    if (updateErr || !updatedAuth?.user) {
      return jsonResponse(
        { ok: false, error: updateErr?.message || "Failed to confirm email for user." },
        500,
      );
    }

    const { data: existingProfile } = await serviceClient
      .from("profiles")
      .select("user_code, full_name, organisation_id")
      .eq("id", authUser.id)
      .maybeSingle();

    const resolvedName =
      String(existingProfile?.full_name ?? "").trim() ||
      String(authUser.user_metadata?.full_name ?? "").trim() ||
      email.split("@")[0] ||
      "Facilitator";

    const { data: upsertedProfile, error: upsertErr } = await serviceClient
      .from("profiles")
      .upsert(
        {
          id: authUser.id,
          user_code: existingProfile?.user_code
            ? String(existingProfile.user_code)
            : buildUserCode(authUser.id),
          full_name: resolvedName,
          email,
          role: "facilitator",
          organisation_id: existingProfile?.organisation_id
            ? String(existingProfile.organisation_id)
            : orgId,
          account_status: "APPROVED",
          active: true,
        },
        { onConflict: "id" },
      )
      .select("user_code, full_name, email, role, active, account_status, created_at, updated_at")
      .single();

    if (upsertErr || !upsertedProfile) {
      return jsonResponse(
        { ok: false, error: upsertErr?.message || "Email confirmed, but profile approval failed." },
        500,
      );
    }

    await serviceClient.from("facilitator_preapprovals").delete().eq("email", email);

    await serviceClient.from("submission_audit_logs").insert({
      audit_code: `AUD_${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
      performed_by: caller.id,
      actor_email: actorEmail,
      action: "CONFIRM_AND_APPROVE_USER",
      entity_type: "User",
      entity_id: email,
      previous_summary: "",
      new_summary: "APPROVED active=true email_confirmed=true",
      result: "SUCCESS",
    });

    return jsonResponse({
      ok: true,
      data: {
        user: {
          userId: String(upsertedProfile.user_code),
          name: String(upsertedProfile.full_name),
          email: String(upsertedProfile.email),
          role: "facilitator",
          active: Boolean(upsertedProfile.active),
          status: String(upsertedProfile.account_status),
          emailConfirmed: true,
          hasLoginAccount: true,
          createdAt: String(upsertedProfile.created_at),
          updatedAt: String(upsertedProfile.updated_at),
        },
      },
    });
  }

  if (action === "delete_user") {
    const rawUserId = String(body.userId ?? "").trim();
    const rawEmail = normalizeEmail(body.email);

    let existingProfile: { id: string; email: string; user_code: string } | null = null;
    if (rawUserId && !rawUserId.startsWith("PRE_") && !rawUserId.startsWith("AUTH_")) {
      const { data } = await serviceClient
        .from("profiles")
        .select("id, email, user_code")
        .eq("user_code", rawUserId)
        .maybeSingle();
      if (data) existingProfile = data as { id: string; email: string; user_code: string };
    }
    if (!existingProfile && EMAIL_PATTERN.test(rawEmail)) {
      const { data } = await serviceClient
        .from("profiles")
        .select("id, email, user_code")
        .eq("email", rawEmail)
        .maybeSingle();
      if (data) existingProfile = data as { id: string; email: string; user_code: string };
    }

    let authUser: User | null = null;
    if (existingProfile?.id) {
      const { data } = await serviceClient.auth.admin.getUserById(existingProfile.id);
      if (data?.user) authUser = data.user;
    } else if (EMAIL_PATTERN.test(rawEmail)) {
      authUser = await findAuthUserByEmail(serviceClient, rawEmail);
    }

    const targetEmail = normalizeEmail(existingProfile?.email ?? authUser?.email ?? rawEmail);
    if (!targetEmail) {
      return jsonResponse({ ok: false, error: "Valid target user ID or email is required." }, 400);
    }
    if (SUPER_ADMIN_ALLOWLIST.has(targetEmail)) {
      return jsonResponse(
        { ok: false, error: "Allowlisted Super Administrators cannot be removed." },
        403,
      );
    }

    const targetUid = existingProfile?.id ?? authUser?.id ?? null;
    if (targetUid) {
      const { data: hasSubmission } = await serviceClient
        .from("form_submissions")
        .select("id")
        .eq("user_id", targetUid)
        .limit(1)
        .maybeSingle();

      if (hasSubmission) {
        return jsonResponse(
          {
            ok: false,
            error:
              "Facilitator has recorded classroom sessions. Deny or deactivate access instead of deleting to preserve history.",
          },
          409,
        );
      }
    }

    const { data: deletedPre } = await serviceClient
      .from("facilitator_preapprovals")
      .delete()
      .eq("email", targetEmail)
      .select("email");

    let deletedProfile = false;
    if (existingProfile?.id) {
      const { error: delProfErr } = await serviceClient
        .from("profiles")
        .delete()
        .eq("id", existingProfile.id);
      if (delProfErr) {
        return jsonResponse({ ok: false, error: delProfErr.message }, 409);
      }
      deletedProfile = true;
    }

    let deletedAuth = false;
    if (authUser?.id) {
      const { error: delAuthErr } = await serviceClient.auth.admin.deleteUser(authUser.id);
      if (delAuthErr) {
        return jsonResponse({ ok: false, error: delAuthErr.message }, 500);
      }
      deletedAuth = true;
    }

    if (!deletedProfile && !deletedAuth && (!deletedPre || deletedPre.length === 0)) {
      return jsonResponse({ ok: false, error: "User account not found." }, 404);
    }

    await serviceClient.from("submission_audit_logs").insert({
      audit_code: `AUD_${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
      performed_by: caller.id,
      actor_email: actorEmail,
      action: "DELETE_USER",
      entity_type: "User",
      entity_id: targetEmail,
      previous_summary: "",
      new_summary: `deletedProfile=${deletedProfile} deletedAuth=${deletedAuth}`,
      result: "SUCCESS",
    });

    return jsonResponse({
      ok: true,
      data: {
        deleted: true,
        email: targetEmail,
      },
    });
  }

  return jsonResponse({ ok: false, error: `Unsupported action: ${action}` }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected admin provisioning error";
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
