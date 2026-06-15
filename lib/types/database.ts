export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type UserRole = 'admin' | 'lender' | 'borrower'
export type ProjectStage = 'application' | 'review' | 'approved' | 'active' | 'complete' | 'cancelled'
export type PropertyType = 'single_family' | 'multi_family' | 'commercial' | 'mixed_use' | 'land' | 'industrial' | 'adu' | 'other'
export type DrawStatus = 'draft' | 'submitted' | 'pending' | 'approved' | 'funded' | 'declined'
export type DocStatus = 'required' | 'uploaded' | 'approved' | 'rejected' | 'overdue' | 'not_required'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          role: UserRole
          full_name: string | null
          company_name: string | null
          email: string | null
          phone: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      lenders: {
        Row: {
          id: string
          profile_id: string | null
          company_name: string
          contact_name: string | null
          email: string | null
          phone: string | null
          loan_types: string[] | null
          max_ltv: number | null
          active: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['lenders']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['lenders']['Insert']>
      }
      borrowers: {
        Row: {
          id: string
          profile_id: string | null
          company_name: string
          contact_name: string | null
          email: string | null
          phone: string | null
          license_number: string | null
          license_state: string | null
          rating: string
          active: boolean
          xrp_address: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['borrowers']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['borrowers']['Insert']>
      }
      projects: {
        Row: {
          id: string
          name: string
          address: string | null
          city: string | null
          state: string | null
          zip: string | null
          property_type: PropertyType | null
          borrower_id: string
          lender_id: string
          loan_amount: number
          amount_drawn: number
          interest_rate: number | null
          loan_number: string | null
          maturity_date: string | null
          stage: ProjectStage
          ltv: number | null
          appraised_value: number | null
          notes: string | null
          loan_nft_token_id: string | null
          loan_nft_mint_hash: string | null
          loan_nft_burn_hash: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['projects']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['projects']['Insert']>
      }
      draw_requests: {
        Row: {
          id: string
          project_id: string
          request_number: string | null
          amount: number
          purpose: string | null
          phase: string | null
          description: string | null
          status: DrawStatus
          submitted_by: string | null
          approved_by: string | null
          declined_by: string | null
          decline_reason: string | null
          submitted_at: string | null
          reviewed_at: string | null
          funded_at: string | null
          wire_reference: string | null
          inspection_done: boolean
          lien_waiver: boolean
          escrow_sequence: number | null
          escrow_txn_hash: string | null
          escrow_finish_hash: string | null
          escrow_finish_after: string | null
          nft_token_id: string | null
          nft_mint_hash: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['draw_requests']['Row'], 'id' | 'created_at' | 'updated_at' | 'request_number'>
        Update: Partial<Database['public']['Tables']['draw_requests']['Insert']>
      }
      documents: {
        Row: {
          id: string
          project_id: string
          draw_request_id: string | null
          name: string
          doc_type: string | null
          storage_path: string | null
          file_name: string | null
          file_size: number | null
          mime_type: string | null
          status: DocStatus
          required: boolean
          notes: string | null
          uploaded_by: string | null
          reviewed_by: string | null
          uploaded_at: string | null
          due_date: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['documents']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['documents']['Insert']>
      }
      activity_log: {
        Row: {
          id: string
          project_id: string | null
          user_id: string | null
          action: string
          entity_type: string | null
          entity_id: string | null
          details: Json
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['activity_log']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['activity_log']['Insert']>
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          body: string | null
          link: string | null
          read: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['notifications']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
      }
    }
  }
}

// Convenience types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Lender = Database['public']['Tables']['lenders']['Row']
export type Borrower = Database['public']['Tables']['borrowers']['Row']
export type Project = Database['public']['Tables']['projects']['Row']
export type DrawRequest = Database['public']['Tables']['draw_requests']['Row']
export type Document = Database['public']['Tables']['documents']['Row']
export type ActivityLog = Database['public']['Tables']['activity_log']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']

// Enriched types (with joins)
export type ProjectWithRelations = Project & {
  borrowers: Borrower
  lenders: Lender
}

export type DrawWithProject = DrawRequest & {
  projects: Pick<Project, 'name' | 'loan_number'>
}
