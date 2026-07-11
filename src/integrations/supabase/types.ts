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
      bill_sequences: {
        Row: {
          date_key: string
          last_seq: number
          prefix: string
        }
        Insert: {
          date_key: string
          last_seq?: number
          prefix: string
        }
        Update: {
          date_key?: string
          last_seq?: number
          prefix?: string
        }
        Relationships: []
      }
      cash_sessions: {
        Row: {
          cash_paid_out: number
          cash_sales: number
          closed_at: string | null
          closing_cash: number | null
          difference: number | null
          expected_cash: number
          expenses: number
          id: string
          online_sales: number
          opened_at: string
          opening_cash: number
          status: string
          user_id: string
          user_name: string
        }
        Insert: {
          cash_paid_out?: number
          cash_sales?: number
          closed_at?: string | null
          closing_cash?: number | null
          difference?: number | null
          expected_cash?: number
          expenses?: number
          id?: string
          online_sales?: number
          opened_at?: string
          opening_cash?: number
          status?: string
          user_id: string
          user_name?: string
        }
        Update: {
          cash_paid_out?: number
          cash_sales?: number
          closed_at?: string | null
          closing_cash?: number | null
          difference?: number | null
          expected_cash?: number
          expenses?: number
          id?: string
          online_sales?: number
          opened_at?: string
          opening_cash?: number
          status?: string
          user_id?: string
          user_name?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      daily_expenses: {
        Row: {
          cash_junaid: number
          cash_usama: number
          counter_cash: number
          created_at: string
          created_by: string | null
          created_by_name: string
          entry_date: string
          id: string
          others: number
          today_expenses: number
          updated_at: string
        }
        Insert: {
          cash_junaid?: number
          cash_usama?: number
          counter_cash?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          entry_date: string
          id?: string
          others?: number
          today_expenses?: number
          updated_at?: string
        }
        Update: {
          cash_junaid?: number
          cash_usama?: number
          counter_cash?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          entry_date?: string
          id?: string
          others?: number
          today_expenses?: number
          updated_at?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          id: string
          kind: string
          notes: string
          product_id: string
          qty_in_base: number
          qty_in_unit: number
          ref_id: string | null
          unit_id: string | null
          unit_name: string
          user_id: string | null
          user_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          notes?: string
          product_id: string
          qty_in_base: number
          qty_in_unit: number
          ref_id?: string | null
          unit_id?: string | null
          unit_name?: string
          user_id?: string | null
          user_name?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          notes?: string
          product_id?: string
          qty_in_base?: number
          qty_in_unit?: number
          ref_id?: string | null
          unit_id?: string | null
          unit_name?: string
          user_id?: string | null
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          expense_date: string
          id: string
          paid_to: string
          payment_method: string
          recorded_by: string | null
          recorded_by_name: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          expense_date: string
          id?: string
          paid_to?: string
          payment_method?: string
          recorded_by?: string | null
          recorded_by_name?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          expense_date?: string
          id?: string
          paid_to?: string
          payment_method?: string
          recorded_by?: string | null
          recorded_by_name?: string
        }
        Relationships: []
      }
      person_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          notes: string
          payment_date: string
          payment_method: string
          person_name: string
          recorded_by: string | null
          recorded_by_name: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string
          payment_date: string
          payment_method?: string
          person_name?: string
          recorded_by?: string | null
          recorded_by_name?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string
          payment_date?: string
          payment_method?: string
          person_name?: string
          recorded_by?: string | null
          recorded_by_name?: string
        }
        Relationships: []
      }
      product_units: {
        Row: {
          barcode: string | null
          created_at: string
          equals_base: number
          id: string
          is_base: boolean
          is_default_sale: boolean
          name: string
          product_id: string
          purchase_price: number
          sale_price: number
          sku: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          equals_base: number
          id?: string
          is_base?: boolean
          is_default_sale?: boolean
          name: string
          product_id: string
          purchase_price?: number
          sale_price?: number
          sku?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          created_at?: string
          equals_base?: number
          id?: string
          is_base?: boolean
          is_default_sale?: boolean
          name?: string
          product_id?: string
          purchase_price?: number
          sale_price?: number
          sku?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string
          base_unit_id: string | null
          category_id: string | null
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          min_stock_alert: number
          name: string
          purchase_price: number
          sale_price: number
          stock: number
          updated_at: string
        }
        Insert: {
          barcode: string
          base_unit_id?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          min_stock_alert?: number
          name: string
          purchase_price?: number
          sale_price?: number
          stock?: number
          updated_at?: string
        }
        Update: {
          barcode?: string
          base_unit_id?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          min_stock_alert?: number
          name?: string
          purchase_price?: number
          sale_price?: number
          stock?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_base_unit_id_fkey"
            columns: ["base_unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          username: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          is_active?: boolean
          username?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          username?: string | null
        }
        Relationships: []
      }
      return_items: {
        Row: {
          barcode: string
          id: string
          product_id: string | null
          product_name: string
          qty: number
          return_id: string
          subtotal: number
          unit_price: number
        }
        Insert: {
          barcode?: string
          id?: string
          product_id?: string | null
          product_name: string
          qty: number
          return_id: string
          subtotal: number
          unit_price: number
        }
        Update: {
          barcode?: string
          id?: string
          product_id?: string | null
          product_name?: string
          qty?: number
          return_id?: string
          subtotal?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          cashier_id: string
          cashier_name: string
          created_at: string
          id: string
          items_count: number
          original_bill_no: string
          original_sale_id: string
          reason: string
          refund_amount: number
          return_no: string
          status: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          voided_by_name: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          cashier_id: string
          cashier_name?: string
          created_at?: string
          id?: string
          items_count?: number
          original_bill_no: string
          original_sale_id: string
          reason?: string
          refund_amount?: number
          return_no: string
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          cashier_id?: string
          cashier_name?: string
          created_at?: string
          id?: string
          items_count?: number
          original_bill_no?: string
          original_sale_id?: string
          reason?: string
          refund_amount?: number
          return_no?: string
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "returns_original_sale_id_fkey"
            columns: ["original_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          barcode: string
          id: string
          product_id: string | null
          product_name: string
          purchase_price: number
          qty: number
          qty_in_unit: number | null
          sale_id: string
          subtotal: number
          unit_id: string | null
          unit_name: string | null
          unit_price: number
        }
        Insert: {
          barcode?: string
          id?: string
          product_id?: string | null
          product_name: string
          purchase_price?: number
          qty: number
          qty_in_unit?: number | null
          sale_id: string
          subtotal: number
          unit_id?: string | null
          unit_name?: string | null
          unit_price: number
        }
        Update: {
          barcode?: string
          id?: string
          product_id?: string | null
          product_name?: string
          purchase_price?: number
          qty?: number
          qty_in_unit?: number | null
          sale_id?: string
          subtotal?: number
          unit_id?: string | null
          unit_name?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          bill_no: string
          cash_received: number
          cashier_id: string
          cashier_name: string
          change_returned: number
          created_at: string
          discount: number
          id: string
          items_count: number
          payment_method: string
          payment_type: string
          session_id: string | null
          subtotal: number
          tax_amount: number
          total: number
        }
        Insert: {
          bill_no: string
          cash_received?: number
          cashier_id: string
          cashier_name?: string
          change_returned?: number
          created_at?: string
          discount?: number
          id?: string
          items_count?: number
          payment_method?: string
          payment_type?: string
          session_id?: string | null
          subtotal?: number
          tax_amount?: number
          total?: number
        }
        Update: {
          bill_no?: string
          cash_received?: number
          cashier_id?: string
          cashier_name?: string
          change_returned?: number
          created_at?: string
          discount?: number
          id?: string
          items_count?: number
          payment_method?: string
          payment_type?: string
          session_id?: string | null
          subtotal?: number
          tax_amount?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_expenses: {
        Row: {
          amount: number
          cashier_id: string | null
          cashier_name: string
          created_at: string
          description: string
          id: string
          session_id: string | null
        }
        Insert: {
          amount?: number
          cashier_id?: string | null
          cashier_name?: string
          created_at?: string
          description?: string
          id?: string
          session_id?: string | null
        }
        Update: {
          amount?: number
          cashier_id?: string | null
          cashier_name?: string
          created_at?: string
          description?: string
          id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_expenses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          cashier_id: string
          cashier_name: string
          created_at: string
          id: string
          notes: string
          product_id: string
          qty: number
          qty_in_unit: number | null
          rejected_at: string | null
          rejected_by: string | null
          rejected_by_name: string | null
          rejection_reason: string | null
          status: string
          unit_id: string | null
          unit_name: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          cashier_id: string
          cashier_name?: string
          created_at?: string
          id?: string
          notes?: string
          product_id: string
          qty: number
          qty_in_unit?: number | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_by_name?: string | null
          rejection_reason?: string | null
          status?: string
          unit_id?: string | null
          unit_name?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          cashier_id?: string
          cashier_name?: string
          created_at?: string
          id?: string
          notes?: string
          product_id?: string
          qty?: number
          qty_in_unit?: number | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_by_name?: string | null
          rejection_reason?: string | null
          status?: string
          unit_id?: string | null
          unit_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_entries_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          address: string
          currency: string
          footer_message: string
          id: number
          logo_url: string | null
          phone: string
          store_name: string
          tax_rate: number
          updated_at: string
        }
        Insert: {
          address?: string
          currency?: string
          footer_message?: string
          id?: number
          logo_url?: string | null
          phone?: string
          store_name?: string
          tax_rate?: number
          updated_at?: string
        }
        Update: {
          address?: string
          currency?: string
          footer_message?: string
          id?: number
          logo_url?: string | null
          phone?: string
          store_name?: string
          tax_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      supplier_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          created_by_name: string
          id: string
          method: string
          notes: string
          payment_date: string
          session_id: string | null
          supplier_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          id?: string
          method?: string
          notes?: string
          payment_date?: string
          session_id?: string | null
          supplier_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          id?: string
          method?: string
          notes?: string
          payment_date?: string
          session_id?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_purchases: {
        Row: {
          amount: number
          bill_no: string
          created_at: string
          created_by: string | null
          created_by_name: string
          description: string
          id: string
          purchase_date: string
          supplier_id: string
        }
        Insert: {
          amount?: number
          bill_no?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          description?: string
          id?: string
          purchase_date?: string
          supplier_id: string
        }
        Update: {
          amount?: number
          bill_no?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string
          description?: string
          id?: string
          purchase_date?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string
          phone: string
          updated_at: string
        }
        Insert: {
          address?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string
          phone?: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          created_at: string
          details: Json
          id: string
          target_user_id: string | null
          target_user_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
          target_user_name?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
          target_user_name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_stock_entry: {
        Args: { _notes?: string; _product_id: string; _qty: number }
        Returns: Json
      }
      add_stock_entry_v2: {
        Args: {
          _notes?: string
          _product_id: string
          _qty: number
          _unit_id: string
        }
        Returns: string
      }
      admin_update_shift:
        | {
            Args: {
              _cash_sales?: number
              _closing_cash?: number
              _difference?: number
              _expected_cash?: number
              _opening_cash?: number
              _session_id: string
              _user_name?: string
            }
            Returns: Json
          }
        | {
            Args: {
              _cash_paid_out?: number
              _cash_sales?: number
              _closing_cash?: number
              _difference?: number
              _expected_cash?: number
              _online_sales?: number
              _opening_cash?: number
              _session_id: string
              _user_name?: string
            }
            Returns: Json
          }
      approve_return: { Args: { _return_id: string }; Returns: Json }
      approve_stock_entry: { Args: { _entry_id: string }; Returns: Json }
      close_shift: { Args: { _closing_cash: number }; Returns: Json }
      get_admin_dashboard_summary:
        | { Args: { _days: number; _start_at: string }; Returns: Json }
        | {
            Args: { _days: number; _end_at?: string; _start_at: string }
            Returns: Json
          }
      get_admin_inventory_summary: { Args: never; Returns: Json }
      get_online_by_method: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      get_open_session: { Args: never; Returns: Json }
      get_period_extras:
        | { Args: { _from: string }; Returns: Json }
        | { Args: { _from: string; _to?: string }; Returns: Json }
      get_profit_report: { Args: { _from: string; _to: string }; Returns: Json }
      get_suppliers_summary: { Args: never; Returns: Json }
      get_unit_breakdown: { Args: { _product_id: string }; Returns: Json }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_bill_no: { Args: { _prefix: string }; Returns: string }
      open_shift: { Args: { _opening_cash: number }; Returns: Json }
      process_return: {
        Args: { _items: Json; _reason: string; _sale_id: string }
        Returns: Json
      }
      process_sale: {
        Args: {
          _cash_received: number
          _change_returned: number
          _discount: number
          _items: Json
          _payment_type: string
          _subtotal: number
          _tax_amount: number
          _total: number
        }
        Returns: Json
      }
      process_sale_v2: {
        Args: {
          _cash_received: number
          _change_returned: number
          _discount: number
          _items: Json
          _payment_type: string
          _subtotal: number
          _tax_amount: number
          _total: number
        }
        Returns: Json
      }
      record_expense: {
        Args: { _amount: number; _description?: string }
        Returns: Json
      }
      record_supplier_payment: {
        Args: {
          _amount: number
          _method?: string
          _notes?: string
          _payment_date?: string
          _supplier_id: string
        }
        Returns: Json
      }
      reject_stock_entry: {
        Args: { _entry_id: string; _reason: string }
        Returns: Json
      }
      save_product_with_units: {
        Args: { _initial_stock?: Json; _product: Json; _units: Json }
        Returns: string
      }
      void_return: {
        Args: { _reason: string; _return_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "cashier"
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
    Enums: {
      app_role: ["admin", "cashier"],
    },
  },
} as const
