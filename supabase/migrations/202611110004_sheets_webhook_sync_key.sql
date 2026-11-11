-- 0004_sheets_webhook_sync_key.sql
-- Store an auto-generated Apps Script Webhook sync key restricted strictly to Super Admins.

ALTER TABLE public.sheets_connections
  ADD COLUMN IF NOT EXISTS apps_script_sync_key text NOT NULL DEFAULT '';

UPDATE public.sheets_connections
SET apps_script_sync_key = 'VV-WH-' || upper(replace(gen_random_uuid()::text, '-', ''))
WHERE btrim(COALESCE(apps_script_sync_key, '')) = '';

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
    'appsScriptUrl', COALESCE(v_row.apps_script_webhook_url, ''),
    'appsScriptSyncKey', COALESCE(v_row.apps_script_sync_key, ''),
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
  v_next_key text;
BEGIN
  IF v_uid IS NULL OR NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Super Administrator access required' USING ERRCODE = '42501';
  END IF;
  v_email := private.current_user_email();
  v_next_key := btrim(COALESCE(p_payload ->> 'appsScriptSyncKey', ''));
  IF length(v_next_key) > 0 AND length(v_next_key) < 16 THEN
    RAISE EXCEPTION 'Apps Script sync key must be at least 16 characters' USING ERRCODE = '22023';
  END IF;

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
    apps_script_sync_key = CASE
      WHEN length(v_next_key) >= 16 THEN v_next_key
      WHEN btrim(COALESCE(apps_script_sync_key, '')) = '' THEN 'VV-WH-' || upper(replace(gen_random_uuid()::text, '-', ''))
      ELSE apps_script_sync_key
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
