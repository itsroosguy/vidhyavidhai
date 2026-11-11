export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      application_settings: {
        Row: {
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          setting_key: string
          setting_value: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitator_preapprovals: {
        Row: {
          account_status: string
          active: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          organisation_id: string
          preapproved_by: string | null
          updated_at: string
        }
        Insert: {
          account_status?: string
          active?: boolean
          created_at?: string
          email: string
          full_name?: string
          id?: string
          organisation_id: string
          preapproved_by?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: string
          active?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          organisation_id?: string
          preapproved_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilitator_preapprovals_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilitator_preapprovals_preapproved_by_fkey"
            columns: ["preapproved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submission_classes: {
        Row: {
          created_at: string
          csat: number | null
          detail_record_id: string
          grade: string
          id: string
          itp: number | null
          question_a_score_1: number
          question_a_score_2: number
          question_a_score_3: number
          question_a_score_4: number
          question_a_score_5: number
          question_a_total: number
          question_a_weighted_score: number
          question_b_score_1: number
          question_b_score_2: number
          question_b_score_3: number
          question_b_score_4: number
          question_b_score_5: number
          question_b_total: number
          question_b_weighted_score: number
          row_order: number
          section: string
          session_id: string
          session_record_id: string
          students_present: number
          submission_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          csat?: number | null
          detail_record_id: string
          grade: string
          id?: string
          itp?: number | null
          question_a_score_1?: number
          question_a_score_2?: number
          question_a_score_3?: number
          question_a_score_4?: number
          question_a_score_5?: number
          question_a_total?: number
          question_a_weighted_score?: number
          question_b_score_1?: number
          question_b_score_2?: number
          question_b_score_3?: number
          question_b_score_4?: number
          question_b_score_5?: number
          question_b_total?: number
          question_b_weighted_score?: number
          row_order?: number
          section: string
          session_id: string
          session_record_id: string
          students_present: number
          submission_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          csat?: number | null
          detail_record_id?: string
          grade?: string
          id?: string
          itp?: number | null
          question_a_score_1?: number
          question_a_score_2?: number
          question_a_score_3?: number
          question_a_score_4?: number
          question_a_score_5?: number
          question_a_total?: number
          question_a_weighted_score?: number
          question_b_score_1?: number
          question_b_score_2?: number
          question_b_score_3?: number
          question_b_score_4?: number
          question_b_score_5?: number
          question_b_total?: number
          question_b_weighted_score?: number
          row_order?: number
          section?: string
          session_id?: string
          session_record_id?: string
          students_present?: number
          submission_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_submission_classes_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          archived: boolean
          cc: string
          client_submission_key: string
          completion_date: string
          completion_rate: number
          created_at: string
          created_by: string
          distribution_channel_host_id: string
          district: string
          duration_formatted: string
          duration_minutes: number
          end_date: string
          end_time: string
          facilitator_email: string
          facilitator_name: string
          grade_of_students: string
          id: string
          language: string
          organisation_id: string
          overall_csat: number | null
          overall_itp: number | null
          pin_code: string
          product_name: string
          reporting_month: string
          school_id: string | null
          school_name: string
          school_type: string
          session_record_id: string
          session_type: string
          start_date: string
          start_time: string
          state: string
          student_csat: number | null
          submission_date_formatted: string
          submission_reference: string
          submission_status: string
          submission_timestamp: string
          submitted_at: string
          sync_status: string
          synced_at: string | null
          teacher_classification: string
          teacher_nps: number
          teacher_score: number | null
          total_classes: number
          total_question_a_responses: number
          total_question_b_responses: number
          total_students_present: number
          tour_id: string
          tour_name: string
          udise_code: string
          underserved_reach: string
          unique_student_id: string
          updated_at: string
          updated_by: string
          user_id: string
          video_id: string
          zipcode_postal_code: string
        }
        Insert: {
          archived?: boolean
          cc?: string
          client_submission_key: string
          completion_date: string
          completion_rate?: number
          created_at?: string
          created_by: string
          distribution_channel_host_id?: string
          district: string
          duration_formatted: string
          duration_minutes: number
          end_date: string
          end_time: string
          facilitator_email: string
          facilitator_name: string
          grade_of_students?: string
          id?: string
          language: string
          organisation_id: string
          overall_csat?: number | null
          overall_itp?: number | null
          pin_code: string
          product_name?: string
          reporting_month: string
          school_id?: string | null
          school_name: string
          school_type: string
          session_record_id: string
          session_type: string
          start_date: string
          start_time: string
          state?: string
          student_csat?: number | null
          submission_date_formatted: string
          submission_reference: string
          submission_status?: string
          submission_timestamp?: string
          submitted_at?: string
          sync_status?: string
          synced_at?: string | null
          teacher_classification: string
          teacher_nps: number
          teacher_score?: number | null
          total_classes: number
          total_question_a_responses?: number
          total_question_b_responses?: number
          total_students_present: number
          tour_id: string
          tour_name: string
          udise_code: string
          underserved_reach?: string
          unique_student_id?: string
          updated_at?: string
          updated_by: string
          user_id: string
          video_id?: string
          zipcode_postal_code: string
        }
        Update: {
          archived?: boolean
          cc?: string
          client_submission_key?: string
          completion_date?: string
          completion_rate?: number
          created_at?: string
          created_by?: string
          distribution_channel_host_id?: string
          district?: string
          duration_formatted?: string
          duration_minutes?: number
          end_date?: string
          end_time?: string
          facilitator_email?: string
          facilitator_name?: string
          grade_of_students?: string
          id?: string
          language?: string
          organisation_id?: string
          overall_csat?: number | null
          overall_itp?: number | null
          pin_code?: string
          product_name?: string
          reporting_month?: string
          school_id?: string | null
          school_name?: string
          school_type?: string
          session_record_id?: string
          session_type?: string
          start_date?: string
          start_time?: string
          state?: string
          student_csat?: number | null
          submission_date_formatted?: string
          submission_reference?: string
          submission_status?: string
          submission_timestamp?: string
          submitted_at?: string
          sync_status?: string
          synced_at?: string | null
          teacher_classification?: string
          teacher_nps?: number
          teacher_score?: number | null
          total_classes?: number
          total_question_a_responses?: number
          total_question_b_responses?: number
          total_students_present?: number
          tour_id?: string
          tour_name?: string
          udise_code?: string
          underserved_reach?: string
          unique_student_id?: string
          updated_at?: string
          updated_by?: string
          user_id?: string
          video_id?: string
          zipcode_postal_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          created_at: string
          id: string
          name: string
          organisation_code: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organisation_code: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organisation_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: string
          active: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          last_sign_in_at: string | null
          organisation_id: string
          role: string
          updated_at: string
          user_code: string
        }
        Insert: {
          account_status?: string
          active?: boolean
          created_at?: string
          email: string
          full_name?: string
          id: string
          last_sign_in_at?: string | null
          organisation_id: string
          role?: string
          updated_at?: string
          user_code: string
        }
        Update: {
          account_status?: string
          active?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          last_sign_in_at?: string | null
          organisation_id?: string
          role?: string
          updated_at?: string
          user_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          district: string
          id: string
          organisation_id: string
          pin_code: string
          school_name: string
          school_record_id: string
          school_type: string
          state: string
          udise_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          district: string
          id?: string
          organisation_id: string
          pin_code: string
          school_name: string
          school_record_id: string
          school_type: string
          state?: string
          udise_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          district?: string
          id?: string
          organisation_id?: string
          pin_code?: string
          school_name?: string
          school_record_id?: string
          school_type?: string
          state?: string
          udise_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schools_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schools_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sheets_connections: {
        Row: {
          apps_script_webhook_url: string
          auth_method: string
          connected: boolean
          connected_account: string
          connected_at: string | null
          connected_by: string | null
          connected_by_email: string
          connection_key: string
          connection_provider: string
          id: string
          initialized_tabs: Json
          last_sync_message: string
          last_sync_status: string
          last_synced_at: string | null
          spreadsheet_id: string
          spreadsheet_name: string
          spreadsheet_url: string
          updated_at: string
        }
        Insert: {
          apps_script_webhook_url?: string
          auth_method?: string
          connected?: boolean
          connected_account?: string
          connected_at?: string | null
          connected_by?: string | null
          connected_by_email?: string
          connection_key?: string
          connection_provider?: string
          id?: string
          initialized_tabs?: Json
          last_sync_message?: string
          last_sync_status?: string
          last_synced_at?: string | null
          spreadsheet_id?: string
          spreadsheet_name?: string
          spreadsheet_url?: string
          updated_at?: string
        }
        Update: {
          apps_script_webhook_url?: string
          auth_method?: string
          connected?: boolean
          connected_account?: string
          connected_at?: string | null
          connected_by?: string | null
          connected_by_email?: string
          connection_key?: string
          connection_provider?: string
          id?: string
          initialized_tabs?: Json
          last_sync_message?: string
          last_sync_status?: string
          last_synced_at?: string | null
          spreadsheet_id?: string
          spreadsheet_name?: string
          spreadsheet_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheets_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_audit_logs: {
        Row: {
          action: string
          actor_email: string
          audit_code: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          new_summary: string
          performed_by: string | null
          previous_data: Json | null
          previous_summary: string
          result: string
          submission_id: string | null
          updated_data: Json | null
        }
        Insert: {
          action: string
          actor_email?: string
          audit_code: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_summary?: string
          performed_by?: string | null
          previous_data?: Json | null
          previous_summary?: string
          result?: string
          submission_id?: string | null
          updated_data?: Json | null
        }
        Update: {
          action?: string
          actor_email?: string
          audit_code?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_summary?: string
          performed_by?: string | null
          previous_data?: Json | null
          previous_summary?: string
          result?: string
          submission_id?: string | null
          updated_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_audit_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_audit_logs_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          actor_email: string
          client_submission_key: string
          created_at: string
          destination: string
          error_message: string
          id: string
          last_attempt_at: string
          operation: string
          retry_count: number
          session_id: string
          session_record_id: string
          submission_id: string | null
          sync_code: string
          sync_status: string
        }
        Insert: {
          actor_email?: string
          client_submission_key?: string
          created_at?: string
          destination?: string
          error_message?: string
          id?: string
          last_attempt_at?: string
          operation?: string
          retry_count?: number
          session_id?: string
          session_record_id?: string
          submission_id?: string | null
          sync_code: string
          sync_status: string
        }
        Update: {
          actor_email?: string
          client_submission_key?: string
          created_at?: string
          destination?: string
          error_message?: string
          id?: string
          last_attempt_at?: string
          operation?: string
          retry_count?: number
          session_id?: string
          session_record_id?: string
          submission_id?: string | null
          sync_code?: string
          sync_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_logs: {
        Row: {
          activity_description: string
          activity_type: string
          created_at: string
          id: string
          metadata: Json
          user_email: string
          user_id: string | null
        }
        Insert: {
          activity_description?: string
          activity_type: string
          created_at?: string
          id?: string
          metadata?: Json
          user_email?: string
          user_id?: string | null
        }
        Update: {
          activity_description?: string
          activity_type?: string
          created_at?: string
          id?: string
          metadata?: Json
          user_email?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_import_sessions: { Args: { p_sessions: Json }; Returns: Json }
      admin_manage_facilitator: {
        Args: {
          p_active: boolean
          p_email: string
          p_name: string
          p_role: string
          p_status: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_save_app_settings: { Args: { p_config: Json }; Returns: Json }
      admin_save_sheets_connection: { Args: { p_payload: Json }; Returns: Json }
      archive_or_restore_form_session: {
        Args: { p_archived: boolean; p_session_record_id: string }
        Returns: Json
      }
      get_database_health: { Args: never; Returns: Json }
      get_my_profile: { Args: never; Returns: Json }
      get_sanitized_app_settings: { Args: never; Returns: Json }
      get_sheets_connection_state: { Args: never; Returns: Json }
      list_managed_directory: { Args: never; Returns: Json }
      log_export_event: {
        Args: { p_format: string; p_row_count: number; p_scope: string }
        Returns: Json
      }
      log_user_activity: {
        Args: {
          p_activity_type: string
          p_description?: string
          p_metadata?: Json
        }
        Returns: Json
      }
      recover_database_health: { Args: never; Returns: Json }
      submit_form_session: { Args: { p_values: Json }; Returns: Json }
      update_form_session: {
        Args: { p_session_record_id: string; p_values: Json }
        Returns: Json
      }
      update_school_master: {
        Args: {
          p_active: boolean
          p_district: string
          p_pin_code: string
          p_school_name: string
          p_school_record_id: string
          p_school_type: string
          p_state: string
          p_udise_code: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
