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

/**
 * Safely parse a fetch Response body. If the server returns HTML (gateway
 * timeout page, 502/503 from ingress, etc.), `response.json()` throws and the
 * UI shows a cryptic "Unexpected token '<'..." message. This helper falls back
 * to a friendly error string that includes the HTTP status.
 */
export async function safeJson<T extends { error?: string }>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    let friendlyError: string;
    if (response.status === 504 || response.status === 502) {
      friendlyError = "Сервис превысил время ожидания. Попробуйте через 30-60 секунд.";
    } else if (response.status === 503) {
      friendlyError = "Сервис временно недоступен. Подождите и попробуйте снова.";
    } else if (response.status === 429) {
      friendlyError = "Слишком много запросов. Подождите минуту и попробуйте снова.";
    } else if (response.status >= 500) {
      friendlyError = `Ошибка сервера (HTTP ${response.status}). Попробуйте позже.`;
    } else if (!response.ok) {
      friendlyError = `Ответ сервера не в формате JSON (HTTP ${response.status}).`;
    } else {
      friendlyError = "Получен неожиданный ответ от сервера (не JSON).";
    }
    return { error: friendlyError } as T;
  }
}
