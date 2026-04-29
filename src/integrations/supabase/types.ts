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
      products: {
        Row: {
          barcode: string
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
          sale_id: string
          subtotal: number
          unit_price: number
        }
        Insert: {
          barcode?: string
          id?: string
          product_id?: string | null
          product_name: string
          purchase_price?: number
          qty: number
          sale_id: string
          subtotal: number
          unit_price: number
        }
        Update: {
          barcode?: string
          id?: string
          product_id?: string | null
          product_name?: string
          purchase_price?: number
          qty?: number
          sale_id?: string
          subtotal?: number
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
          payment_type: string
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
          payment_type?: string
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
          payment_type?: string
          subtotal?: number
          tax_amount?: number
          total?: number
        }
        Relationships: []
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
      approve_return: { Args: { _return_id: string }; Returns: Json }
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
