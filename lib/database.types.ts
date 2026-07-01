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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_log: {
        Row: {
          alert_summary: string | null
          alert_type: string | null
          carrier_names: string[] | null
          dot_numbers: string[] | null
          id: string
          sent_at: string | null
          sent_to: string[] | null
        }
        Insert: {
          alert_summary?: string | null
          alert_type?: string | null
          carrier_names?: string[] | null
          dot_numbers?: string[] | null
          id?: string
          sent_at?: string | null
          sent_to?: string[] | null
        }
        Update: {
          alert_summary?: string | null
          alert_type?: string | null
          carrier_names?: string[] | null
          dot_numbers?: string[] | null
          id?: string
          sent_at?: string | null
          sent_to?: string[] | null
        }
        Relationships: []
      }
      brokerware_skipped_carriers: {
        Row: {
          brokerware_carrier_id: number | null
          carrier_name: string | null
          city: string | null
          email: string | null
          id: string
          mc: string | null
          phone: string | null
          reason: string | null
          scac: string | null
          state: string | null
          status: string | null
          synced_at: string | null
        }
        Insert: {
          brokerware_carrier_id?: number | null
          carrier_name?: string | null
          city?: string | null
          email?: string | null
          id?: string
          mc?: string | null
          phone?: string | null
          reason?: string | null
          scac?: string | null
          state?: string | null
          status?: string | null
          synced_at?: string | null
        }
        Update: {
          brokerware_carrier_id?: number | null
          carrier_name?: string | null
          city?: string | null
          email?: string | null
          id?: string
          mc?: string | null
          phone?: string | null
          reason?: string | null
          scac?: string | null
          state?: string | null
          status?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      carrier_delta_log: {
        Row: {
          alert_sent: boolean | null
          alert_sent_at: string | null
          change_summary: string[] | null
          detected_at: string | null
          dot_number: string
          flags_detected: string[] | null
          hard_stops_detected: string[] | null
          id: string
          new_auto_status: string | null
          new_cargo_status: string | null
          new_operating_status: string | null
          new_safety_rating: string | null
          previous_auto_status: string | null
          previous_cargo_status: string | null
          previous_operating_status: string | null
          previous_safety_rating: string | null
          processed: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
          rmis_insured_id: string | null
        }
        Insert: {
          alert_sent?: boolean | null
          alert_sent_at?: string | null
          change_summary?: string[] | null
          detected_at?: string | null
          dot_number: string
          flags_detected?: string[] | null
          hard_stops_detected?: string[] | null
          id?: string
          new_auto_status?: string | null
          new_cargo_status?: string | null
          new_operating_status?: string | null
          new_safety_rating?: string | null
          previous_auto_status?: string | null
          previous_cargo_status?: string | null
          previous_operating_status?: string | null
          previous_safety_rating?: string | null
          processed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rmis_insured_id?: string | null
        }
        Update: {
          alert_sent?: boolean | null
          alert_sent_at?: string | null
          change_summary?: string[] | null
          detected_at?: string | null
          dot_number?: string
          flags_detected?: string[] | null
          hard_stops_detected?: string[] | null
          id?: string
          new_auto_status?: string | null
          new_cargo_status?: string | null
          new_operating_status?: string | null
          new_safety_rating?: string | null
          previous_auto_status?: string | null
          previous_cargo_status?: string | null
          previous_operating_status?: string | null
          previous_safety_rating?: string | null
          processed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rmis_insured_id?: string | null
        }
        Relationships: []
      }
      carrier_insurance: {
        Row: {
          authority_days_active: number | null
          authority_original_date: string | null
          authority_reinstatement_date: string | null
          authority_revocation_date: string | null
          auto_confidence: string | null
          auto_effective_date: string | null
          auto_expiration_date: string | null
          auto_limit: number | null
          auto_policy_number: string | null
          auto_status: string | null
          auto_underwriter: string | null
          broker_carrier_agreement_date: string | null
          broker_carrier_agreement_on_file: boolean | null
          broker_carrier_agreement_title: string | null
          cargo_confidence: string | null
          cargo_effective_date: string | null
          cargo_expiration_date: string | null
          cargo_limit: number | null
          cargo_policy_number: string | null
          cargo_status: string | null
          cargo_underwriter: string | null
          carrier_id: string | null
          common_authority_status: string | null
          contract_authority_status: string | null
          broker_authority_status: string | null
          dot_number: string
          fetched_at: string | null
          general_aggregate_limit: number | null
          general_expiration_date: string | null
          general_occurrence_limit: number | null
          general_status: string | null
          hard_stops: string[] | null
          id: string
          is_factoring: boolean | null
          operating_status: string | null
          pay_to_address: string | null
          pay_to_entity: string | null
          raw_rmis_response: Json | null
          rmis_certification_notes: string[] | null
          rmis_flags: string[] | null
          rmis_is_certified: boolean | null
          rmis_overall_pass: boolean | null
          updated_at: string | null
          us_driver_oos_count: number | null
          us_driver_oos_ratio: string | null
          us_fatal_crashes: number | null
          us_injury_crashes: number | null
          us_total_crashes: number | null
          us_total_inspections: number | null
          us_tow_crashes: number | null
          us_vehicle_oos_count: number | null
          us_vehicle_oos_ratio: string | null
          w9_business_name: string | null
          w9_company_type: string | null
          w9_on_file: boolean | null
          w9_tax_id: string | null
        }
        Insert: {
          authority_days_active?: number | null
          authority_original_date?: string | null
          authority_reinstatement_date?: string | null
          authority_revocation_date?: string | null
          auto_confidence?: string | null
          auto_effective_date?: string | null
          auto_expiration_date?: string | null
          auto_limit?: number | null
          auto_policy_number?: string | null
          auto_status?: string | null
          auto_underwriter?: string | null
          broker_carrier_agreement_date?: string | null
          broker_carrier_agreement_on_file?: boolean | null
          broker_carrier_agreement_title?: string | null
          cargo_confidence?: string | null
          cargo_effective_date?: string | null
          cargo_expiration_date?: string | null
          cargo_limit?: number | null
          cargo_policy_number?: string | null
          cargo_status?: string | null
          cargo_underwriter?: string | null
          carrier_id?: string | null
          common_authority_status?: string | null
          contract_authority_status?: string | null
          broker_authority_status?: string | null
          dot_number: string
          fetched_at?: string | null
          general_aggregate_limit?: number | null
          general_expiration_date?: string | null
          general_occurrence_limit?: number | null
          general_status?: string | null
          hard_stops?: string[] | null
          id?: string
          is_factoring?: boolean | null
          operating_status?: string | null
          pay_to_address?: string | null
          pay_to_entity?: string | null
          raw_rmis_response?: Json | null
          rmis_certification_notes?: string[] | null
          rmis_flags?: string[] | null
          rmis_is_certified?: boolean | null
          rmis_overall_pass?: boolean | null
          updated_at?: string | null
          us_driver_oos_count?: number | null
          us_driver_oos_ratio?: string | null
          us_fatal_crashes?: number | null
          us_injury_crashes?: number | null
          us_total_crashes?: number | null
          us_total_inspections?: number | null
          us_tow_crashes?: number | null
          us_vehicle_oos_count?: number | null
          us_vehicle_oos_ratio?: string | null
          w9_business_name?: string | null
          w9_company_type?: string | null
          w9_on_file?: boolean | null
          w9_tax_id?: string | null
        }
        Update: {
          authority_days_active?: number | null
          authority_original_date?: string | null
          authority_reinstatement_date?: string | null
          authority_revocation_date?: string | null
          auto_confidence?: string | null
          auto_effective_date?: string | null
          auto_expiration_date?: string | null
          auto_limit?: number | null
          auto_policy_number?: string | null
          auto_status?: string | null
          auto_underwriter?: string | null
          broker_carrier_agreement_date?: string | null
          broker_carrier_agreement_on_file?: boolean | null
          broker_carrier_agreement_title?: string | null
          cargo_confidence?: string | null
          cargo_effective_date?: string | null
          cargo_expiration_date?: string | null
          cargo_limit?: number | null
          cargo_policy_number?: string | null
          cargo_status?: string | null
          cargo_underwriter?: string | null
          carrier_id?: string | null
          common_authority_status?: string | null
          contract_authority_status?: string | null
          broker_authority_status?: string | null
          dot_number?: string
          fetched_at?: string | null
          general_aggregate_limit?: number | null
          general_expiration_date?: string | null
          general_occurrence_limit?: number | null
          general_status?: string | null
          hard_stops?: string[] | null
          id?: string
          is_factoring?: boolean | null
          operating_status?: string | null
          pay_to_address?: string | null
          pay_to_entity?: string | null
          raw_rmis_response?: Json | null
          rmis_certification_notes?: string[] | null
          rmis_flags?: string[] | null
          rmis_is_certified?: boolean | null
          rmis_overall_pass?: boolean | null
          updated_at?: string | null
          us_driver_oos_count?: number | null
          us_driver_oos_ratio?: string | null
          us_fatal_crashes?: number | null
          us_injury_crashes?: number | null
          us_total_crashes?: number | null
          us_total_inspections?: number | null
          us_tow_crashes?: number | null
          us_vehicle_oos_count?: number | null
          us_vehicle_oos_ratio?: string | null
          w9_business_name?: string | null
          w9_company_type?: string | null
          w9_on_file?: boolean | null
          w9_tax_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carrier_insurance_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_scores: {
        Row: {
          approval_level: string | null
          carrier_id: string | null
          crash_score: number | null
          critical_acute_violation_score: number | null
          csa_basics_score: number | null
          dot_number: string
          driver_oos_score: number | null
          flagged_scores: string[] | null
          gap_score: number | null
          id: string
          judicial_hellholes_score: number | null
          mcs_150_score: number | null
          new_entrant_score: number | null
          overall_pass: boolean | null
          rating_label: string | null
          release_month: string | null
          requires_revetting: boolean | null
          safety_rating_score: number | null
          severity_category: string | null
          upload_date: string | null
          violation_score: number | null
        }
        Insert: {
          approval_level?: string | null
          carrier_id?: string | null
          crash_score?: number | null
          critical_acute_violation_score?: number | null
          csa_basics_score?: number | null
          dot_number: string
          driver_oos_score?: number | null
          flagged_scores?: string[] | null
          gap_score?: number | null
          id?: string
          judicial_hellholes_score?: number | null
          mcs_150_score?: number | null
          new_entrant_score?: number | null
          overall_pass?: boolean | null
          rating_label?: string | null
          release_month?: string | null
          requires_revetting?: boolean | null
          safety_rating_score?: number | null
          severity_category?: string | null
          upload_date?: string | null
          violation_score?: number | null
        }
        Update: {
          approval_level?: string | null
          carrier_id?: string | null
          crash_score?: number | null
          critical_acute_violation_score?: number | null
          csa_basics_score?: number | null
          dot_number?: string
          driver_oos_score?: number | null
          flagged_scores?: string[] | null
          gap_score?: number | null
          id?: string
          judicial_hellholes_score?: number | null
          mcs_150_score?: number | null
          new_entrant_score?: number | null
          overall_pass?: boolean | null
          rating_label?: string | null
          release_month?: string | null
          requires_revetting?: boolean | null
          safety_rating_score?: number | null
          severity_category?: string | null
          upload_date?: string | null
          violation_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "carrier_scores_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          brokerware_carrier_id: number | null
          brokerware_status: string | null
          brokerware_synced_at: string | null
          carrier_status: string | null
          city: string | null
          email: string | null
          phone: string | null
          created_at: string | null
          dba_name: string | null
          do_not_use: boolean | null
          do_not_use_reason: string | null
          dot_number: string
          id: string
          legal_name: string | null
          mc_number: string | null
          power_units: number | null
          rmis_attempted_at: string | null
          rmis_insured_id: string | null
          revet_interval_days: number | null
          safety_rating: string | null
          state: string | null
          street: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          brokerware_carrier_id?: number | null
          brokerware_status?: string | null
          brokerware_synced_at?: string | null
          carrier_status?: string | null
          city?: string | null
          created_at?: string | null
          dba_name?: string | null
          email?: string | null
          phone?: string | null
          do_not_use?: boolean | null
          do_not_use_reason?: string | null
          dot_number: string
          id?: string
          legal_name?: string | null
          mc_number?: string | null
          power_units?: number | null
          rmis_attempted_at?: string | null
          rmis_insured_id?: string | null
          revet_interval_days?: number | null
          safety_rating?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          brokerware_carrier_id?: number | null
          brokerware_status?: string | null
          brokerware_synced_at?: string | null
          carrier_status?: string | null
          city?: string | null
          created_at?: string | null
          dba_name?: string | null
          email?: string | null
          phone?: string | null
          do_not_use?: boolean | null
          do_not_use_reason?: string | null
          dot_number?: string
          id?: string
          legal_name?: string | null
          mc_number?: string | null
          power_units?: number | null
          rmis_attempted_at?: string | null
          rmis_insured_id?: string | null
          revet_interval_days?: number | null
          safety_rating?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      vetting_documents: {
        Row: {
          carrier_id: string | null
          content_sha256: string | null
          document_type: string | null
          dot_number: string
          file_name: string | null
          file_size_bytes: number | null
          google_drive_file_id: string | null
          rmis_document_type: string | null
          source: string | null
          google_drive_view_url: string | null
          id: string
          mime_type: string | null
          storage_bucket: string | null
          storage_path: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          vetting_record_id: string | null
        }
        Insert: {
          carrier_id?: string | null
          content_sha256?: string | null
          document_type?: string | null
          dot_number: string
          file_name?: string | null
          rmis_document_type?: string | null
          source?: string | null
          file_size_bytes?: number | null
          google_drive_file_id?: string | null
          google_drive_view_url?: string | null
          id?: string
          mime_type?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          vetting_record_id?: string | null
        }
        Update: {
          carrier_id?: string | null
          document_type?: string | null
          dot_number?: string
          file_name?: string | null
          file_size_bytes?: number | null
          google_drive_file_id?: string | null
          google_drive_view_url?: string | null
          id?: string
          mime_type?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          vetting_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vetting_documents_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vetting_documents_vetting_record_id_fkey"
            columns: ["vetting_record_id"]
            isOneToOne: false
            referencedRelation: "vetting_records"
            referencedColumns: ["id"]
          },
        ]
      }
      vetting_records: {
        Row: {
          approval_level_required: string | null
          approved_by: string | null
          carrier_id: string | null
          checklist: Json | null
          completed_at: string | null
          created_at: string | null
          dot_number: string
          exception_note: string | null
          google_drive_folder_id: string | null
          google_drive_folder_url: string | null
          id: string
          internal_notes: string | null
          reviewed_by: string | null
          vetting_status: string | null
          vetting_type: string
        }
        Insert: {
          approval_level_required?: string | null
          approved_by?: string | null
          carrier_id?: string | null
          checklist?: Json | null
          completed_at?: string | null
          created_at?: string | null
          dot_number: string
          exception_note?: string | null
          google_drive_folder_id?: string | null
          google_drive_folder_url?: string | null
          id?: string
          internal_notes?: string | null
          reviewed_by?: string | null
          vetting_status?: string | null
          vetting_type: string
        }
        Update: {
          approval_level_required?: string | null
          approved_by?: string | null
          carrier_id?: string | null
          checklist?: Json | null
          completed_at?: string | null
          created_at?: string | null
          dot_number?: string
          exception_note?: string | null
          google_drive_folder_id?: string | null
          google_drive_folder_url?: string | null
          id?: string
          internal_notes?: string | null
          reviewed_by?: string | null
          vetting_status?: string | null
          vetting_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "vetting_records_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
