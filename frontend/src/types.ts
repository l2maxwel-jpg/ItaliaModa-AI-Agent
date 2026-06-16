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

// --- UI domain types (previously inline) ---

/** A single user-uploaded image, kept in component state until publish. */
export interface UploadedImage {
  id: string;
  base64: string;
  mimeType: string;
  /** Detected dominant color group ("beige", "navy", ...), used for grouping & matching to variants. */
  colorGroup?: string;
  /** Display order within the gallery (preserves manual drag-and-drop sort). */
  orderIndex: number;
  fileName?: string;
}

/** A color variant suggested by Gemini and (optionally) overridden by the user. */
export interface SuggestedVariant {
  name: string;
  quantity: number;
  /** Explicitly chosen image IDs (overrides automatic color matching). */
  selectedImageIds?: string[];
  /** Whether the user picked photos manually (vs. accepting the automatic suggestion). */
  isCustomPhotoSelection?: boolean;
}

// --- API response types (server.ts → frontend) ---

export interface ApiAnalyzeResponse {
  success: boolean;
  analysis?: ProductAnalysis;
  error?: string;
}

export interface ApiTestConnectionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ApiCategoriesResponse {
  success: boolean;
  categories?: PrestaShopCategory[];
  error?: string;
}

export interface ApiPublishResponse {
  success: boolean;
  productId?: number;
  imageUploaded?: boolean;
  imagesUploadedCount?: number;
  imageError?: string;
  error?: string;
}

export interface ApiFieldRegenResponse {
  success?: boolean;
  text?: string;
  error?: string;
}

// --- Narrow runtime errors to a message string without losing type-safety ---
export const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Unknown error";
};
