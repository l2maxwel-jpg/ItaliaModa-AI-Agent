export interface ProductAnalysis {
  title: string;
  sku?: string;
  price?: number; // calculated net price
  gross_price?: number; // suggested gross price
  sklad?: string; // product composition (e.g., 100% len)
  modelka?: string; // model info (e.g., MA 175 CM...)
  variants?: string[]; // suggested variants
  description_short: string;
  description: string;
  suggested_categories: string[];
}

export interface PrestaShopConfig {
  shopUrl: string;
  apiKey: string;
  languageId: number;
}

export interface PrestaShopCategory {
  id: number;
  name: string;
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  image: string; // Base64 or local blob preview
  productData: ProductAnalysis;
  status: "draft" | "success" | "failed";
  prestashopId?: number;
  error?: string;
}
