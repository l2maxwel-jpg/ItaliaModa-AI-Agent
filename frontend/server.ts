import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

import { setGlobalDispatcher, Agent } from "undici";

// Dev-only debug logger — silenced in production to keep logs clean.
// Replaces noisy debug logging without losing console.error / .warn.
const DEBUG_LOG = process.env.NODE_ENV !== "production";
const dlog: (...args: any[]) => void = DEBUG_LOG
  ? console.log.bind(console)
  : () => {};

// Configure global fetch dispatcher with longer timeouts to prevent HeadersTimeoutError
// when analyzing multiple high-resolution images or during heavy generation tasks.
setGlobalDispatcher(new Agent({
  headersTimeout: 300000, // 5 minutes
  bodyTimeout: 300000,
  connectTimeout: 300000,
}));

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Set maximum upload size limits to handle large images
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini SDK with User-Agent telemetry headers as requested
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const ALLOWED_COLORS = [
  "Szary",
  "Grafitowy",
  "Beżowy",
  "Biały",
  "Kremowy",
  "Czerwony",
  "Czarny",
  "Camel",
  "Pomarańczowy",
  "Niebieski",
  "Zielony",
  "Żółty",
  "Brązowy",
  "Różowy",
  "Pudrowy róż",
  "Bordowy",
  "Taupe",
  "Khaki",
  "Śliwka",
  "Musztardowy",
  "Jasny jeans",
  "Ciemny jeans",
  "Jeans",
  "Oatmeal",
  "Fango",
  "Granatowy",
  "Różowe złoto",
  "Błękitny",
  "Turkusowy",
  "Fuksja",
  "Srebrny",
  "Butelkowa zieleń",
  "Złoty",
  "Liliowy",
  "Miętowy",
  "Morelowy",
  "Limonkowy",
  "Fioletowy"
];

// Transliterate function for Russian and Polish to clean URL slug in PrestaShop
function robustSlugify(text: string): string {
  const rus = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
  const lat = "abvgdeejzijklmnoprstufhzcss_y_eya";
  
  const pol = "ąćęłńóśźż";
  const polLat = "acelnoszz";
  
  let str = text.toLowerCase().trim();
  
  let res = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const rusIndex = rus.indexOf(char);
    const polIndex = pol.indexOf(char);
    if (rusIndex !== -1) {
      res += lat[rusIndex];
    } else if (polIndex !== -1) {
      res += polLat[polIndex];
    } else {
      res += char;
    }
  }

  // Fallback if slugify generates empty string
  const slug = res
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return slug || "product-slug";
}

// Ensure clean URL scheme by normalizing Store URL
function normalizeUrl(url: string): string {
  let clean = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) {
    clean = 'http://' + clean;
  }
  // Robust self-healing: strip trailing "/api" if the user entered it by mistake
  clean = clean.replace(/\/api$/i, '');
  return clean;
}

// 1. Analyze Image using Gemini-3.5-flash
app.post("/api/gemini/analyze", async (req, res) => {
  try {
    const { image, mimeType, images, mimeTypes, language, userHint, config } = req.body;
    
    // Prepare image parts for Gemini
    const imageParts: any[] = [];
    
    if (images && Array.isArray(images) && images.length > 0) {
      images.forEach((imgBase64, idx) => {
        const mType = (mimeTypes && mimeTypes[idx]) || "image/jpeg";
        imageParts.push({
          inlineData: {
            mimeType: mType,
            data: imgBase64
          }
        });
      });
    } else if (image) {
      const imageMimeType = mimeType || "image/jpeg";
      imageParts.push({
        inlineData: {
          mimeType: imageMimeType,
          data: image,
        },
      });
    }

    if (imageParts.length === 0) {
      res.status(400).json({ error: "Missing image payload. Please provide image or images array." });
      return;
    }

    const targetLang = language === "ru" ? "Russian" : "Polish";
    const exampleCategories = language === "ru" 
      ? '"Одежда", "Обувь", "Электроника"' 
      : '"Odzież", "Obuwie", "Elektronika"';

    let hintInstruction = "";
    if (userHint && userHint.trim()) {
      hintInstruction = `IMPORTANT: The user has provided additional instructions/focus for analyzing this photo. Please follow this focus carefully:
"${userHint.trim()}"\n`;
    }

    let targetColors = ALLOWED_COLORS;
    if (config && config.shopUrl && config.apiKey) {
      try {
        const langId = parseInt(config.languageId, 10) || 1;
        targetColors = await getPrestashopColors(config.shopUrl, config.apiKey, langId);
      } catch (err) {
        console.warn("Failed to fetch PrestaShop colors for Gemini restrict rules:", err);
      }
    }

    const colorsRestriction = `\nCRITICAL COLOR CONSTRAINT:
You MUST ONLY determine or use color names that are on this exact list of standard colors: [${targetColors.join(", ")}].
Do not invent any new color names under any circumstances! Map any visual color you identify to the closest matching color from this predefined list and format exactly as "Kolor: [PredefinedColor], Rozmiar: UNIWERSALNY" in Polish (e.g. "Kolor: Beżowy, Rozmiar: UNIWERSALNY").
If the item looks like light pink, you MUST use "Pudrowy róż". If it looks like olive, you MUST use "Khaki". If it looks like navy blue, you MUST use "Granatowy". If it looks like burgundy/wine red, you MUST use "Bordowy". If it is tan/camel/caramel, you MUST use "Camel". If it looks like dark gray, you MUST use "Grafitowy". If it is normal light/slate gray, you MUST use "Szary". If it is dark blue denim/jeans, you MUST use "Ciemny jeans". If it is classic/light denim/jeans, you MUST use "Jasny jeans" or "Jeans".
Do not invent any other names under any circumstances.`;

    const textPart = {
      text: `Analyze this product photo (or photos). Please extract or generate high-quality product details in ${targetLang}.
${hintInstruction}
Requirements:
1. Do NOT suggest or generate any article numbers, SKU, references, or any retail prices (do not estimate any prices). Those will be filled manually.
2. For products (especially women's clothing/fashion), extract or suggest:
   - 'sklad' (Composition): fabric content (e.g., "100% LEN", "100% Bawełna", "95% Bawełna, 5% Elastan" inside the target language).
   - 'modelka' (Model specs): Model height and size description. Format MUST be exactly like this: "MA 175 CM WZROSTU I NOSI ROZMIAR S" or Russian equivalent: "РОСТ 175 СМ, НОСИТ РАЗМЕР S". You MUST NEVER include the word "MODELKA" as a prefix, and you MUST NEVER write "I PREZENTUJE ROZMIAR UNIWERSALNY" — always use "I NOSI ROZMIAR S" style.
3. For 'variants' (Combinations): Suggest variant strings reflecting the colors of the product. The size must ALWAYS be "UNIWERSALNY". ${colorsRestriction}
   - If there is only ONE single color present/visible in the photo(s), generate/suggest exactly ONE variant item (e.g., "Kolor: Zielony, Rozmiar: UNIWERSALNY").
   - If there are MULTIPLE distinct colors of the same model visible across the photo(s) (e.g., the set of photos shows the model in blue, white, and pink), identify and list all of those distinct colors as separate variants. Do not generate any extra or hypothetical colors that are not visible.
   - Each variant string MUST follow exactly this format: "Kolor: [Detected Color], Rozmiar: UNIWERSALNY" in Polish (e.g. "Kolor: Brązowy, Rozmiar: UNIWERSALNY", "Kolor: Biały, Rozmiar: UNIWERSALNY") or equivalent in Russian. Only detect real colors visible as the variant differentiator.

Provide:
- A descriptive product title (title), following sentence-case rules: only the very first word must start with a capital letter, with all subsequent letters and words being entirely lowercase (e.g. "Lniana sukienka midi w paski").
- Fabric composition (sklad) as a short uppercase string.
- Model info description (modelka) formatted strictly like "MA 175 CM WZROSTU I NOSI ROZMIAR S" or Russian equivalent, as a clean uppercase string, with NO leading "MODELKA" word and NO "PREZENTUJE..." phrasing.
- Suggested list of combinations / variations (variants) differentiated ONLY by detected colors, e.g. "Kolor: [Color], Rozmiar: UNIWERSALNY".
- Short descriptive text (description_short), concise, 1-2 sentences.
- Full product description (description) formatted nicely in HTML (use HTML paragraphs, bold texts, lists where relevant, safe tags for Prestashop editor). It MUST be twice as short as normal, highly concise and compact.
- List of 2-3 matching Suggested Categories (suggested_categories) like ${exampleCategories} based on the product.`,
    };

    // Use gemini-3.5-flash with structured JSON response schema
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: { parts: [...imageParts, textPart] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["title", "sklad", "modelka", "variants", "description_short", "description", "suggested_categories"],
          properties: {
            title: {
              type: Type.STRING,
              description: `Product title in ${targetLang}.`,
            },
            sklad: {
              type: Type.STRING,
              description: "Fabric material composition in uppercase.",
            },
            modelka: {
              type: Type.STRING,
              description: "Model parameters description in uppercase format strictly like: 'MA 175 CM WZROSTU I NOSI ROZMIAR S', NEVER starting with 'MODELKA' and NEVER using 'PREZENTUJE ROZMIAR UNIWERSALNY'.",
            },
            variants: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Suggested product combinations differentiated only by color. Must format exactly as 'Kolor: [ColorName], Rozmiar: UNIWERSALNY'.",
            },
            description_short: {
              type: Type.STRING,
              description: `1-2 sentence quick summary in ${targetLang}.`,
            },
            description: {
              type: Type.STRING,
              description: `Highly concise, twice as short product description using clean pre-formatted HTML tags like <p>, <strong>, <ul>, <li> in ${targetLang}. Minimize length.`,
            },
            suggested_categories: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of 2-3 recommended categories.",
            },
          },
        },
      },
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No output text received from Gemini API");
    }

    const productDetails = JSON.parse(resultText.trim());
    res.json({ success: true, analysis: productDetails });
  } catch (error: any) {
    console.error("Gemini analysis error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze product image with Gemini" });
  }
});

// 1b. Generate/Regenerate individual field using Gemini
app.post("/api/gemini/generate-field", async (req, res) => {
  try {
    const { field, images, mimeTypes, language, currentValue, userPrompt } = req.body;
    
    if (!field) {
      res.status(400).json({ error: "Missing required parameter 'field'." });
      return;
    }

    // Prepare image parts for Gemini
    const imageParts: any[] = [];
    if (images && Array.isArray(images) && images.length > 0) {
      images.forEach((imgBase64, idx) => {
        const mType = (mimeTypes && mimeTypes[idx]) || "image/jpeg";
        imageParts.push({
          inlineData: {
            mimeType: mType,
            data: imgBase64
          }
        });
      });
    }

    const targetLang = language === "ru" ? "Russian" : "Polish";
    let instructions = "";

    if (field === "title") {
      instructions = `Generate a descriptive product title in ${targetLang} based on the product photo(s).
Follow sentence-case rules: only the very first word must start with a capital letter, with all subsequent letters and words being entirely lowercase, except for proper nouns or brand names (e.g. "Lniana sukienka midi w paski").
Do not include SKU, prices, or emojis. Keep it natural, under 100 characters.`;
    } else if (field === "description_short") {
      instructions = `Generate a modern, engaging product short description / teaser tagline in ${targetLang} based on the product photo(s).
Length: 1-2 concise sentences. Do not use markdown, return clean text. Do not include price or stock info.`;
    } else if (field === "description") {
      instructions = `Generate a beautiful, twice as short product detailed description (Description HTML) in ${targetLang} based on the product photo(s).
Format strictly using clean and valid HTML tags (like <p>, <strong>, <ul>, <li>). Do not use <html>, <body>, or markdown code blocks like \`\`\`html.
Keep it compact, professional, highlighting product details and material features.`;
    } else {
      res.status(400).json({ error: "Invalid field name. Must be 'title', 'description_short', or 'description'." });
      return;
    }

    if (currentValue && currentValue.trim()) {
      instructions += `\nExisting/Current value of this field is: "${currentValue.trim()}". You can refer to it as reference or improve/rewrite it.`;
    }

    if (userPrompt && userPrompt.trim()) {
      instructions += `\nCRITICAL User Prompt/Wishes: Carefully incorporate the following specific requests from the user: "${userPrompt.trim()}".`;
    }

    const textPart = { text: instructions };

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: { parts: [...imageParts, textPart] }
    });

    const textResult = response.text || "";
    res.json({ success: true, text: textResult.trim() });
  } catch (error: any) {
    console.error("Gemini generate-field error:", error);
    res.status(500).json({ error: error.message || "Failed to generate field content using Gemini" });
  }
});

// Helper for PrestaShop Basic Auth header
function getAuthHeader(apiKey: string): string {
  return "Basic " + Buffer.from(apiKey.trim() + ":").toString("base64");
}

// Durable, self-healing PrestaShop Webservice Fetch Helper
async function fetchPrestashop(
  shopUrl: string,
  apiKey: string,
  apiPath: string,
  method: "GET" | "POST" | "PUT",
  queryParams: Record<string, string> = {},
  body: any = null,
  isXml = false,
  isMultipart: boolean | string = false
) {
  const cleanUrl = normalizeUrl(shopUrl);
  const cleanKey = apiKey.trim();
  const authHeader = getAuthHeader(cleanKey);

  // Auto-inject dummy product keys for POST and PUT requests to prevent buggy third-party modules 
  // (like m4pdiscountsproducts) from throwing "Undefined array key 'product'" PHP warnings which trigger HTTP 500
  const actualQueryParams = { ...queryParams };
  if (method !== "GET") {
    actualQueryParams["product"] = "1";
    actualQueryParams["product[id]"] = "1";
    actualQueryParams["product[id_product]"] = "1";
    actualQueryParams["product[price]"] = "0";
    actualQueryParams["product[name]"] = "dummy";
  }

  // Build query string appending API key (ws_key) as a fallback parameter
  const qParams = new URLSearchParams({ ...actualQueryParams, ws_key: cleanKey });
  const standardUrl = `${cleanUrl}/api/${apiPath}?${qParams.toString()}`;

  dlog(`[PrestaShop API] Trying standard URL: ${method} ${cleanUrl}/api/${apiPath}`);

  const headers: Record<string, string> = {
    "Authorization": authHeader,
  };
  if (isXml) {
    headers["Content-Type"] = "application/xml";
  }
  if (typeof isMultipart === "string") {
    headers["Content-Type"] = isMultipart;
  }

  let response: Response;
  let responseText = "";

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
    };
    if (body) {
      fetchOptions.body = body;
    }

    response = await fetch(standardUrl, fetchOptions);
    responseText = await response.text();

    const isHtml = responseText.trim().toLowerCase().startsWith("<!doctype") || 
                   responseText.trim().toLowerCase().startsWith("<html") ||
                   responseText.includes("<!--[if") ||
                   responseText.includes("<body");

    // If it's HTML, the friendly URL rewrite failed or redirected to login/index
    if (isHtml) {
      console.warn(`[PrestaShop API] Standard URL returned HTML. Retrying using dispatcher fallback...`);
      throw new Error("Friendly rewrites not supported or redirected to HTML");
    }

    return { response, text: responseText };
  } catch (err: any) {
    console.warn(`[PrestaShop API] Standard endpoint failed or returned HTML. Falling back to dispatcher.php...`);

    // Let's retry using dispatcher.php directly to bypass any Apache/Nginx rewrite rules!
    const fallbackParams = new URLSearchParams({
      url: apiPath,
      ws_key: cleanKey,
      ...actualQueryParams
    });

    const fallbackUrl = `${cleanUrl}/webservice/dispatcher.php?${fallbackParams.toString()}`;
    dlog(`[PrestaShop API] Fetching dispatcher: ${method} ${cleanUrl}/webservice/dispatcher.php?url=${apiPath}`);

    const fallbackHeaders: Record<string, string> = {
      "Authorization": authHeader,
    };
    if (isXml) {
      fallbackHeaders["Content-Type"] = "application/xml";
    }
    if (typeof isMultipart === "string") {
      fallbackHeaders["Content-Type"] = isMultipart;
    }

    const fallbackOptions: RequestInit = {
      method,
      headers: fallbackHeaders,
    };
    if (body) {
      fallbackOptions.body = body;
    }

    const fallbackResponse = await fetch(fallbackUrl, fallbackOptions);
    const fallbackText = await fallbackResponse.text();

    const isFallbackHtml = fallbackText.trim().toLowerCase().startsWith("<!doctype") || 
                           fallbackText.trim().toLowerCase().startsWith("<html") ||
                           fallbackText.includes("<!--[if") ||
                           fallbackText.includes("<body");

    if (isFallbackHtml) {
      throw new Error(`Both standard API endpoint and dispatcher fallback returned HTML instead of XML/JSON. PrestaShop is redirecting of misconfigured. Please check Advanced Parameters -> Webservice is enabled, URL is correct, and API key has fully authorized access permissions.`);
    }

    return { response: fallbackResponse, text: fallbackText };
  }
}

// Helper to extract a friendly error message from PrestaShop Webservice XML response
function extractPrestashopErrorMessage(xml: string): string {
  if (!xml) return "Empty response";
  try {
    const match = xml.match(/<message>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/message>/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    const errMatch = xml.match(/<error>([\s\S]*?)<\/error>/i);
    if (errMatch) {
      const clean = errMatch[1].replace(/<[^>]+>/g, " ").trim();
      return clean || xml.substring(0, 500);
    }
  } catch (err) {
    console.warn("Failed parsing error XML:", err);
  }
  return xml.substring(0, 500).replace(/\s+/g, " ");
}

// Helper to extract localized strings from PrestaShop API JSON output (which can wrap translations in nested objects or arrays)
function extractPrestashopLocalizedString(field: any): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "number") return String(field);
  
  if (Array.isArray(field)) {
    if (field.length > 0) {
      return extractPrestashopLocalizedString(field[0]);
    }
    return "";
  }

  if (typeof field === "object") {
    if (field.value !== undefined) {
      return String(field.value);
    }
    if (field.language) {
      const langValue = field.language;
      if (Array.isArray(langValue)) {
        if (langValue.length > 0) {
          return extractPrestashopLocalizedString(langValue[0]);
        }
      } else if (typeof langValue === "object") {
        if (langValue.value !== undefined) {
          return String(langValue.value);
        }
        return extractPrestashopLocalizedString(langValue);
      } else if (typeof langValue === "string") {
        return langValue;
      }
    }
  }

  return "";
}

function extractSafePrestashopId(field: any): number {
  if (!field) return 0;
  if (typeof field === "string") return parseInt(field, 10) || 0;
  if (typeof field === "number") return field;
  if (typeof field === "object" && field !== null) {
    if (field.value !== undefined) return parseInt(field.value, 10) || 0;
    if (field._ !== undefined) return parseInt(field._, 10) || 0;
    if (field.id !== undefined) return parseInt(field.id, 10) || 0;
  }
  return 0;
}

function extractSafePrestashopString(field: any): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "number") return String(field);
  if (typeof field === "object" && field !== null) {
    if (field.value !== undefined) return String(field.value);
    if (field._ !== undefined) return String(field._);
    if (field.id !== undefined) return String(field.id);
  }
  return "";
}

function isBuggyPrestashopModuleWarning(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("m4pdiscountsproducts") ||
    lower.includes("undefined array key \"product\"") ||
    lower.includes("undefined array key 'product'") ||
    lower.includes("actionobjectimageaddafter") ||
    lower.includes("actionproductadd") ||
    lower.includes("actionproductupdate")
  );
}

function cleanAndParseJson(text: string): any {
  if (!text) return null;
  const startBrace = text.indexOf("{");
  const startBracket = text.indexOf("[");
  let startIdx = -1;
  if (startBrace !== -1 && startBracket !== -1) {
    startIdx = Math.min(startBrace, startBracket);
  } else if (startBrace !== -1) {
    startIdx = startBrace;
  } else if (startBracket !== -1) {
    startIdx = startBracket;
  }

  if (startIdx === -1) {
    return JSON.parse(text);
  }

  const endBrace = text.lastIndexOf("}");
  const endBracket = text.lastIndexOf("]");
  let endIdx = -1;
  if (endBrace !== -1 && endBracket !== -1) {
    endIdx = Math.max(endBrace, endBracket);
  } else if (endBrace !== -1) {
    endIdx = endBrace;
  } else if (endBracket !== -1) {
    endIdx = endBracket;
  }

  if (endIdx === -1 || endIdx < startIdx) {
    return JSON.parse(text);
  }

  const cleanText = text.substring(startIdx, endIdx + 1);
  return JSON.parse(cleanText);
}

// Self-healing recovery helpers to handle PrestaShop installations with buggy custom modules (e.g., actionObjectProductAddAfter warnings blocking REST responses)
async function findCreatedProductFallback(
  shopUrl: string,
  apiKey: string,
  sku?: string,
  title?: string
): Promise<number | null> {
  try {
    // 1. Try to search by SKU (reference)
    if (sku && sku.trim()) {
      dlog(`[Recovery] Searching existing products by reference=[${sku.trim()}]`);
      const { response, text } = await fetchPrestashop(
        shopUrl,
        apiKey,
        "products",
        "GET",
        { "filter[reference]": `[${sku.trim()}]`, display: "[id,reference]", output_format: "JSON" }
      );
      if (response.ok) {
        const data = cleanAndParseJson(text);
        if (data && data.products) {
          const products = Array.isArray(data.products) ? data.products : [data.products];
          if (products.length > 0 && products[0].id) {
            return parseInt(products[0].id, 10);
          }
        }
      }
    }

    // 2. Fetch last 5 products to match by Title or Reference
    dlog(`[Recovery] Scanning last 5 created products for title: "${title}"`);
    const { response: latestRes, text: latestText } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "products",
      "GET",
      { sort: "[id_DESC]", limit: "5", display: "[id,name,reference]", output_format: "JSON" }
    );

    if (latestRes.ok) {
      const data = cleanAndParseJson(latestText);
      if (data && data.products) {
        const products = Array.isArray(data.products) ? data.products : [data.products];
        for (const p of products) {
          const pName = extractPrestashopLocalizedString(p.name);
          const pRef = p.reference ? String(p.reference).trim() : "";
          
          const matchSku = sku && sku.trim() && pRef.toLowerCase() === sku.trim().toLowerCase();
          const matchTitle = title && title.trim() && pName.toLowerCase().includes(title.trim().toLowerCase());
          
          if (matchSku || matchTitle) {
            dlog(`[Recovery] Autodetected product ID ${p.id} with title "${pName}" and reference "${pRef}"`);
            return parseInt(p.id, 10);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Recovery Debug] Failed during findCreatedProductFallback:`, err);
  }
  return null;
}

async function findCreatedCombinationFallback(
  shopUrl: string,
  apiKey: string,
  productId: number,
  combinationSku: string,
  optionValueIds?: number[]
): Promise<number | null> {
  try {
    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "combinations",
      "GET",
      { "filter[id_product]": `[${productId}]`, display: "full", output_format: "JSON" }
    );
    if (response.ok) {
      const data = cleanAndParseJson(text);
      if (data && data.combinations) {
        const list = Array.isArray(data.combinations) ? data.combinations : [data.combinations];
        for (const item of list) {
          // Match by SKU if SKU is provided and not empty
          if (combinationSku && combinationSku.trim() && item.reference && String(item.reference).trim() === combinationSku.trim()) {
            return parseInt(item.id, 10);
          }
          // Fallback: Match by option value IDs
          if (optionValueIds && optionValueIds.length > 0 && item.associations && item.associations.product_option_values) {
            const optValuesRaw = item.associations.product_option_values.product_option_value;
            if (optValuesRaw) {
              const optValuesList = Array.isArray(optValuesRaw) ? optValuesRaw : [optValuesRaw];
              const itemOptValueIds = optValuesList.map((ov: any) => extractSafePrestashopId(ov.id)).filter(id => id > 0);
              if (itemOptValueIds.length === optionValueIds.length && optionValueIds.every(id => itemOptValueIds.includes(id))) {
                dlog(`[RECOVERY] Found matching combination via attribute IDs: ${JSON.stringify(optionValueIds)} with ID: ${item.id}`);
                return parseInt(item.id, 10);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Recovery Combination] Failed search for product ${productId}:`, err);
  }
  return null;
}

// Helper to find the correct tax rules group for PL Standard Rate (23%)
async function findTaxRulesGroup(shopUrl: string, apiKey: string): Promise<number | null> {
  try {
    dlog(`[Tax Rules Group] Fetching tax rule groups...`);
    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "tax_rule_groups",
      "GET",
      { display: "[id,name]", output_format: "JSON" }
    );
    if (response.ok) {
      const data = cleanAndParseJson(text);
      if (data && data.tax_rule_groups) {
        const groups = Array.isArray(data.tax_rule_groups) ? data.tax_rule_groups : [data.tax_rule_groups];
        
        // 1. First pass: precise match for "PL Standard Rate (23%)" or similar
        for (const g of groups) {
          const gName = g.name ? g.name.toString().toLowerCase() : "";
          if (gName.includes("pl standard rate") && gName.includes("23")) {
            dlog(`[Tax Rules Group] Found precise Polish 23% standard rate group: ID ${g.id} ("${g.name}")`);
            return parseInt(g.id, 10);
          }
        }

        // 2. Second pass: match "standard" or "stawka" or "pl" AND "23"
        for (const g of groups) {
          const gName = g.name ? g.name.toString().toLowerCase() : "";
          if (
            (gName.includes("standard") || gName.includes("stawka") || gName.includes("pl")) && 
            gName.includes("23")
          ) {
            dlog(`[Tax Rules Group] Found matched Polish standard rate group: ID ${g.id} ("${g.name}")`);
            return parseInt(g.id, 10);
          }
        }

        // 3. Third pass: any group with "23" in the name
        for (const g of groups) {
          const gName = g.name ? g.name.toString().toLowerCase() : "";
          if (gName.includes("23")) {
            dlog(`[Tax Rules Group] Found group mentioning 23: ID ${g.id} ("${g.name}")`);
            return parseInt(g.id, 10);
          }
        }

        // 4. Fourth pass: match "standard rate"
        for (const g of groups) {
          const gName = g.name ? g.name.toString().toLowerCase() : "";
          if (gName.includes("standard rate")) {
            dlog(`[Tax Rules Group] Found standard rate group: ID ${g.id} ("${g.name}")`);
            return parseInt(g.id, 10);
          }
        }

        // 5. Fifth pass: match "pl standard rate"
        for (const g of groups) {
          const gName = g.name ? g.name.toString().toLowerCase() : "";
          if (gName.includes("pl standard rate")) {
            dlog(`[Tax Rules Group] Found PL standard rate group: ID ${g.id} ("${g.name}")`);
            return parseInt(g.id, 10);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Tax Rules Group Debug] Failed during findTaxRulesGroup:`, err);
  }
  return null;
}

// 2. Helper functions for Feature management
async function getOrCreateFeature(shopUrl: string, apiKey: string, langId: number, name: string): Promise<number | null> {
  try {
    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "product_features",
      "GET",
      { display: "[id,name]", output_format: "JSON" }
    );
    if (response.ok) {
      const data = cleanAndParseJson(text);
      if (data && data.product_features) {
        const feats = Array.isArray(data.product_features) ? data.product_features : [data.product_features];
        for (const feat of feats) {
          const featName = extractPrestashopLocalizedString(feat.name);
          if (featName.toLowerCase().trim() === name.toLowerCase().trim()) {
            return parseInt(feat.id, 10);
          }
        }
      }
    }
  } catch (e) {
    console.warn(`Could not fetch product features list:`, e);
  }

  try {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product_feature>
    <name>
      <language id="${langId}"><![CDATA[${name}]]></language>
    </name>
  </product_feature>
</prestashop>`;
    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "product_features",
      "POST",
      {},
      xml,
      true
    );
    if (response.ok) {
      const match = text.match(/<id[^>]*>\s*(?:<!\[CDATA\[)?\s*(\d+)\s*(?:\]\]>)?\s*<\/id>/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
  } catch (e) {
    console.error(`Could not create product feature "${name}":`, e);
  }
  return null;
}

async function createFeatureValue(
  shopUrl: string,
  apiKey: string,
  langId: number,
  featureId: number,
  valueText: string
): Promise<number | null> {
  try {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product_feature_value>
    <id_feature><![CDATA[${featureId}]]></id_feature>
    <custom><![CDATA[1]]></custom>
    <value>
      <language id="${langId}"><![CDATA[${valueText}]]></language>
    </value>
  </product_feature_value>
</prestashop>`;

    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "product_feature_values",
      "POST",
      {},
      xml,
      true
    );
    if (response.ok) {
      const match = text.match(/<id[^>]*>\s*(?:<!\[CDATA\[)?\s*(\d+)\s*(?:\]\]>)?\s*<\/id>/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
  } catch (e) {
    console.error(`Could not create feature value:`, e);
  }
  return null;
}

// 3. Helper functions for Attributes and Combinations
async function getOrCreateAttributeGroup(
  shopUrl: string,
  apiKey: string,
  langId: number,
  name: string,
  type: "select" | "color"
): Promise<number | null> {
  try {
    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "product_options",
      "GET",
      { display: "[id,name]", output_format: "JSON" }
    );
    if (response.ok) {
      const data = cleanAndParseJson(text);
      if (data && data.product_options) {
        const opts = Array.isArray(data.product_options) ? data.product_options : [data.product_options];
        for (const opt of opts) {
          const optName = extractPrestashopLocalizedString(opt.name);
          if (optName.toLowerCase().trim() === name.toLowerCase().trim()) {
            return parseInt(opt.id, 10);
          }
        }
      }
    }
  } catch (e) {
    console.warn(`Could not fetch product_options list:`, e);
  }

  try {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product_option>
    <group_type><![CDATA[${type}]]></group_type>
    <name>
      <language id="${langId}"><![CDATA[${name}]]></language>
    </name>
    <public_name>
      <language id="${langId}"><![CDATA[${name}]]></language>
    </public_name>
  </product_option>
</prestashop>`;
    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "product_options",
      "POST",
      {},
      xml,
      true
    );
    if (response.ok) {
      const match = text.match(/<id[^>]*>\s*(?:<!\[CDATA\[)?\s*(\d+)\s*(?:\]\]>)?\s*<\/id>/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
  } catch (e) {
    console.error(`Could not create product_option "${name}":`, e);
  }
  return null;
}

function getColorMatchScore(requestedColor: string, existingColor: string): number {
  const req = requestedColor.toLowerCase().trim();
  const ext = existingColor.toLowerCase().trim();
  
  if (req === ext) return 100;

  // Normalise helper to ignore diacritics
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
  const reqNorm = norm(req);
  const extNorm = norm(ext);

  if (reqNorm === extNorm) return 90;
  if (reqNorm.includes(extNorm) || extNorm.includes(reqNorm)) return 80;

  // Polish adjective stem comparison (e.g., "beżowy" / "beż")
  const getStem = (s: string) => {
    let stem = s;
    if (s.endsWith("owy")) stem = s.slice(0, -3);
    else if (s.endsWith("y") || s.endsWith("a") || s.endsWith("e")) stem = s.slice(0, -1);
    return stem;
  };

  const reqStem = getStem(reqNorm);
  const extStem = getStem(extNorm);

  if (reqStem === extStem) return 85;
  if (reqStem.length >= 3 && (extNorm.includes(reqStem) || reqNorm.includes(extStem))) return 75;

  // Synonym groups for Polish, Russian & English
  const synonyms = [
    ["beż", "beżowy", "bezowy", "beige", "беж", "бежевый", "ecru", "krem", "kremowy", "cream"],
    ["brąz", "brązowy", "brazowy", "brown", "коричневый", "корич", "czekolada", "czekoladowy", "mocca", "mocha"],
    ["biel", "biały", "bialy", "white", "белый", "бел", "śmietanka", "smietankowy", "mleczny"],
    ["czarny", "czarna", "black", "черный", "черн", "czerń"],
    ["czerwony", "red", "красный", "красн", "bordo", "bordowy", "malina", "malinowy"],
    ["róż", "różowy", "rozowy", "pink", "розовый", "fuksja", "fuksjowy", "puder", "pudrowy"],
    ["niebieski", "błękit", "blekit", "błękitny", "blue", "синий", "голубой", "син", "granat", "granatowy"],
    ["szary", "szara", "grey", "gray", "серый", "сер", "grafit", "grafitowy", "popiel", "popielaty"],
    ["zielony", "green", "зеленый", "зелен", "szmaragd", "szmaragdowy", "mięta", "miętowy", "mint"],
    ["khaki", "oliwka", "oliwkowy", "olive", "хаки", "оливковый"],
    ["żółty", "yellow", "желтый", "горчица", "горчичный", "mustard"]
  ];

  for (const group of synonyms) {
    const hasReq = group.some(word => req.includes(word));
    const hasExt = group.some(word => ext.includes(word));
    if (hasReq && hasExt) {
      return 60;
    }
  }

  return 0;
}

async function getPrestashopColors(shopUrl: string, apiKey: string, langId: number): Promise<string[]> {
  try {
    const colorGroupName = langId === 1 ? "Kolor" : "Color";
    const colorGroupId = await getOrCreateAttributeGroup(shopUrl, apiKey, langId, colorGroupName, "color");
    if (!colorGroupId) return ALLOWED_COLORS;

    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "product_option_values",
      "GET",
      { display: "[id,id_attribute_group,name]", output_format: "JSON" }
    );
    if (!response.ok) return ALLOWED_COLORS;

    const data = cleanAndParseJson(text);
    if (data && data.product_option_values) {
      const vals = Array.isArray(data.product_option_values) ? data.product_option_values : [data.product_option_values];
      const colors: string[] = [];
      for (const val of vals) {
        const valGroupId = parseInt(val.id_attribute_group, 10);
        if (valGroupId === colorGroupId) {
          const valName = extractPrestashopLocalizedString(val.name);
          if (valName && valName.trim() && !colors.includes(valName.trim())) {
            const isAllowed = ALLOWED_COLORS.some(ac => ac.toLowerCase().trim() === valName.toLowerCase().trim());
            if (isAllowed) {
              const standardColor = ALLOWED_COLORS.find(ac => ac.toLowerCase().trim() === valName.toLowerCase().trim()) || valName.trim();
              colors.push(standardColor);
            }
          }
        }
      }
      return colors.length > 0 ? colors : ALLOWED_COLORS;
    }
  } catch (e) {
    console.warn("Error fetching PrestaShop colors for Gemini prompt:", e);
  }
  return ALLOWED_COLORS;
}

async function getOrCreateAttributeValue(
  shopUrl: string,
  apiKey: string,
  langId: number,
  groupId: number,
  valueName: string,
  isColorGroup: boolean = false
): Promise<number | null> {
  try {
    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "product_option_values",
      "GET",
      { display: "[id,id_attribute_group,name]", output_format: "JSON" }
    );
    if (response.ok) {
      const data = cleanAndParseJson(text);
      if (data && data.product_option_values) {
        const vals = Array.isArray(data.product_option_values) ? data.product_option_values : [data.product_option_values];
        
        let bestScore = -1;
        let bestId: number | null = null;
        let fallbackId: number | null = null;

        for (const val of vals) {
          const valName = extractPrestashopLocalizedString(val.name);
          const valGroupId = parseInt(val.id_attribute_group, 10);
          if (valGroupId === groupId) {
            const valIdNum = parseInt(val.id, 10);
            if (!fallbackId) fallbackId = valIdNum;

            if (valName.toLowerCase().trim() === valueName.toLowerCase().trim()) {
              return valIdNum;
            }

            if (isColorGroup) {
              const score = getColorMatchScore(valueName, valName);
              if (score > bestScore && score > 0) {
                bestScore = score;
                bestId = valIdNum;
              }
            }
          }
        }

        if (isColorGroup) {
          if (bestId !== null) {
            dlog(`[Color Restriction] Match found: mapped "${valueName}" to closest existing PrestaShop color attribute with ID ${bestId}`);
            return bestId;
          }
          if (fallbackId !== null) {
            dlog(`[Color Restriction] No matching color found for "${valueName}". Falling back to first available standard color ID ${fallbackId}`);
            return fallbackId;
          }
        }
      }
    }
  } catch (e) {
    console.warn(`Could not fetch product_option_values helper:`, e);
  }

  // Strictly avoid creating new colors!
  if (isColorGroup) {
    console.warn(`[Color Restriction] WARNING: Color group is set but could not map "${valueName}" to any existing categories. Denying dynamic creation of new color attribute to satisfy user rules.`);
    return null;
  }

  try {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product_option_value>
    <id_attribute_group><![CDATA[${groupId}]]></id_attribute_group>
    <name>
      <language id="${langId}"><![CDATA[${valueName}]]></language>
    </name>
  </product_option_value>
</prestashop>`;
    const { response, text } = await fetchPrestashop(
      shopUrl,
      apiKey,
      "product_option_values",
      "POST",
      {},
      xml,
      true
    );
    if (response.ok) {
      const match = text.match(/<id[^>]*>\s*(?:<!\[CDATA\[)?\s*(\d+)\s*(?:\]\]>)?\s*<\/id>/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
  } catch (e) {
    console.error(`Could not create product_option_value "${valueName}":`, e);
  }
  return null;
}

function parseVariantString(varStr: string) {
  let color: string | null = null;
  let size: string | null = null;

  const colorMatch = varStr.match(/(?:kolor|color|цвет):\s*([^,;]+)/i);
  if (colorMatch && colorMatch[1]) {
    color = colorMatch[1].trim();
  }

  const sizeMatch = varStr.match(/(?:rozmiar|size|размер):\s*([^,;]+)/i);
  if (sizeMatch && sizeMatch[1]) {
    size = sizeMatch[1].trim();
  }

  if (!color && !size) {
    if (varStr.toLowerCase().includes("uniwersaln") || varStr.toLowerCase().includes("uni")) {
      size = varStr.trim();
    } else {
      color = varStr.trim();
      size = "UNIWERSALNY";
    }
  }

  return { color, size };
}

function isColorMatch(variantColorName: string, imageColorGroup: string, imageFileName: string = ""): boolean {
  const vc = variantColorName.toLowerCase().trim();
  const ic = imageColorGroup.toLowerCase().trim();
  const fn = imageFileName.toLowerCase().trim();

  // 1. Direct filename matching (strongest signal!)
  if (fn) {
    const vcRoots = [vc];
    if (vc.endsWith("owy")) vcRoots.push(vc.slice(0, -3)); // beżowy -> beż
    if (vc.endsWith("y")) vcRoots.push(vc.slice(0, -1)); // czarny -> czarn, szary -> szar
    if (vc.endsWith("a")) vcRoots.push(vc.slice(0, -1)); // czarna -> czarn
    if (vc.endsWith("e")) vcRoots.push(vc.slice(0, -1)); // czarne -> czarn
    if (vc.endsWith("ый")) vcRoots.push(vc.slice(0, -2)); // бел-ый -> бел
    if (vc.endsWith("ий")) vcRoots.push(vc.slice(0, -2)); // син-ий -> син
    if (vc.endsWith("ая")) vcRoots.push(vc.slice(0, -2)); // беж-евая -> беж
    if (vc.endsWith("евый")) vcRoots.push(vc.slice(0, -4)); // бежевый -> беж

    for (const root of vcRoots) {
      if (root.length >= 3 && fn.includes(root)) {
        return true;
      }
    }

    // Handle Polish character translation to Latin roots (ł -> l, ż/ź -> z, ó -> o, etc.)
    const vcNoAccents = vc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
    const fnNoAccents = fn.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
    
    const vcNoAccentsRoots = [vcNoAccents];
    if (vcNoAccents.endsWith("owy")) vcNoAccentsRoots.push(vcNoAccents.slice(0, -3));
    if (vcNoAccents.endsWith("y")) vcNoAccentsRoots.push(vcNoAccents.slice(0, -1));

    for (const root of vcNoAccentsRoots) {
      if (root.length >= 3 && fnNoAccents.includes(root)) {
        return true;
      }
    }

    // Special synonym rules in file name matching
    if (vc.includes("beż") || vc.includes("bez") || vc.includes("ecru")) {
      if (fn.includes("bez") || fn.includes("beż") || fn.includes("ecru") || fn.includes("krem")) return true;
    }
    if (vc.includes("czekolad") || vc.includes("brąz") || vc.includes("braz")) {
      if (fn.includes("czekolad") || fn.includes("braz") || fn.includes("brąz") || fn.includes("brown") || fn.includes("mocca") || fn.includes("mocha")) return true;
    }
    if (vc.includes("biał") || vc.includes("bial") || vc.includes("biel") || vc.includes("mlecz")) {
      if (fn.includes("bial") || fn.includes("biał") || fn.includes("white") || fn.includes("mlecz") || fn.includes("smietan")) return true;
    }
    if (vc.includes("róż") || vc.includes("roz") || vc.includes("pink") || vc.includes("fuks")) {
      if (fn.includes("roz") || fn.includes("róż") || fn.includes("pink") || fn.includes("fuks") || fn.includes("puder") || fn.includes("pudr")) return true;
    }
    if (vc.includes("karmel") || vc.includes("camel") || vc.includes("koniak") || vc.includes("cognac")) {
      if (fn.includes("camel") || fn.includes("karmel") || fn.includes("cognac") || fn.includes("koniak") || fn.includes("sand") || fn.includes("piask")) return true;
    }
    if (vc.includes("czarn") || vc.includes("czerń") || vc.includes("czern")) {
      if (fn.includes("czarn") || fn.includes("czern") || fn.includes("black")) return true;
    }
    if (vc.includes("szar") || vc.includes("grafit") || vc.includes("popiel")) {
      if (fn.includes("szar") || fn.includes("grafit") || fn.includes("gray") || fn.includes("grey") || fn.includes("popiel")) return true;
    }
    if (vc.includes("niebies") || vc.includes("błękit") || vc.includes("blekit") || vc.includes("granat") || vc.includes("fiolet") || vc.includes("wrzos")) {
      if (fn.includes("niebies") || fn.includes("blekit") || fn.includes("błekit") || fn.includes("błękit") || fn.includes("granat") || fn.includes("blue") || fn.includes("fiolet") || fn.includes("wrzos") || fn.includes("lila")) return true;
    }
    if (vc.includes("ziel") || vc.includes("szmaragd") || vc.includes("mięt") || vc.includes("miet")) {
      if (fn.includes("ziel") || fn.includes("szmaragd") || fn.includes("miet") || fn.includes("mięt") || fn.includes("green") || fn.includes("morsk")) return true;
    }
    if (vc.includes("khaki") || vc.includes("oliw")) {
      if (fn.includes("khaki") || fn.includes("oliw") || fn.includes("oliv")) return true;
    }
  }

  // 2. Fallback to Gemini Detected Color Group mappings
  if (vc === ic) return true;
  if (ic === "white" && (vc.includes("biał") || vc.includes("bial") || vc.includes("white") || vc.includes("бел") || vc.includes("молок") || vc.includes("krem") || vc.includes("ecru") || vc.includes("smietan"))) return true;
  if (ic === "beige" && (vc.includes("beż") || vc.includes("bez") || vc.includes("beige") || vc.includes("беж") || vc.includes("крем") || vc.includes("ecru") || vc.includes("szamp"))) return true;
  if (ic === "sand_camel" && (vc.includes("camel") || vc.includes("piask") || vc.includes("sand") || vc.includes("кэмел") || vc.includes("песоч") || vc.includes("камел") || vc.includes("пудр") || vc.includes("karmel") || vc.includes("miod"))) return true;
  if (ic === "brown" && (vc.includes("brąz") || vc.includes("braz") || vc.includes("brown") || vc.includes("шоколад") || vc.includes("корич") || vc.includes("czekolad") || vc.includes("kakao"))) return true;
  if (ic === "pink" && (vc.includes("róż") || vc.includes("roz") || vc.includes("pink") || vc.includes("розов") || vc.includes("пудр") || vc.includes("fuks"))) return true;
  if (ic === "red" && (vc.includes("czerwon") || vc.includes("bordo") || vc.includes("red") || vc.includes("красн") || vc.includes("борд") || vc.includes("малин"))) return true;
  if (ic === "blue" && (vc.includes("niebiesk") || vc.includes("blekit") || vc.includes("błękit") || vc.includes("granat") || vc.includes("blue") || vc.includes("син") || vc.includes("голуб") || vc.includes("джинс") || vc.includes("fiolet") || vc.includes("wrzos"))) return true;
  if (ic === "grey" && (vc.includes("szar") || vc.includes("grey") || vc.includes("gray") || vc.includes("grafit") || vc.includes("сер") || vc.includes("серебр") || vc.includes("меланж") || vc.includes("popiel"))) return true;
  if (ic === "black" && (vc.includes("czarn") || vc.includes("black") || vc.includes("черн"))) return true;
  if (ic === "green" && (vc.includes("zielon") || vc.includes("green") || vc.includes("зелен") || vc.includes("салат") || vc.includes("мята") || vc.includes("szmaragd") || vc.includes("изумруд") || vc.includes("miet"))) return true;
  if (ic === "olive_khaki" && (vc.includes("khaki") || vc.includes("oliv") || vc.includes("хаки") || vc.includes("олив"))) return true;
  if (ic === "yellow" && (vc.includes("żółt") || vc.includes("zolt") || vc.includes("yellow") || vc.includes("желт") || vc.includes("горчиц") || vc.includes("neon") || vc.includes("pomarancz") || vc.includes("pomarańcz"))) return true;

  return false;
}

async function getProductImageIds(shopUrl: string, apiKey: string, productId: number): Promise<number[]> {
  // PrestaShop returns image IDs in two different shapes depending on endpoint:
  //   /api/products/{id}?display=full → <associations><images><image><id>N</id></image>...</images></associations>
  //   /api/images/products/{id}        → <image id="{productId}"><declination id="N"/>...</image>  (PS 8+)
  //                                       OR <prestashop><image><i><id>N</id></i>...</image></prestashop>
  //
  // We try the products endpoint first because its <associations><images> block
  // has the most consistent format across PrestaShop versions.

  const parseAssociationsImagesBlock = (xml: string): number[] => {
    // Locate the inner <images>...</images> ASSOCIATIONS block (not the top-level image list)
    const associationsMatch = xml.match(/<associations\b[^>]*>([\s\S]*?)<\/associations>/i);
    const associationsXml = associationsMatch ? associationsMatch[1] : xml;
    const blockMatch = associationsXml.match(/<images\b[^>]*>([\s\S]*?)<\/images>/i);
    if (!blockMatch) return [];
    const block = blockMatch[1];
    const ids: number[] = [];
    const seen = new Set<number>();
    // Within associations, each image is <image><id>NNN</id></image>
    for (const m of block.matchAll(/<image\b[^>]*>[\s\S]*?<id[^>]*>\s*(?:<!\[CDATA\[)?\s*(\d+)\s*(?:\]\]>)?\s*<\/id>[\s\S]*?<\/image>/gi)) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && !seen.has(n)) { ids.push(n); seen.add(n); }
    }
    return ids;
  };

  const parseImagesEndpoint = (xml: string, expectedProductId: number): number[] => {
    const ids: number[] = [];
    const seen = new Set<number>();
    // PS8 shape: <image id="{productId}"><declination id="NNN"/>...</image>
    for (const m of xml.matchAll(/<declination\b[^>]*\bid=["'](\d+)["'][^>]*\/?>/gi)) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && !seen.has(n) && n !== expectedProductId) { ids.push(n); seen.add(n); }
    }
    if (ids.length > 0) return ids;
    // Alternative shape: <i><id>NNN</id></i>
    for (const m of xml.matchAll(/<i\b[^>]*>\s*<id[^>]*>\s*(?:<!\[CDATA\[)?\s*(\d+)\s*(?:\]\]>)?\s*<\/id>\s*<\/i>/gi)) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && !seen.has(n)) { ids.push(n); seen.add(n); }
    }
    if (ids.length > 0) return ids;
    // Alternative shape: top-level <image><id>NNN</id></image> repeated
    for (const m of xml.matchAll(/<image\b[^>]*>\s*<id[^>]*>\s*(?:<!\[CDATA\[)?\s*(\d+)\s*(?:\]\]>)?\s*<\/id>\s*<\/image>/gi)) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && !seen.has(n) && n !== expectedProductId) { ids.push(n); seen.add(n); }
    }
    return ids;
  };

  try {
    // Strategy A: product XML with display=full (most reliable)
    const { response: prodRes, text: prodText } = await fetchPrestashop(
      shopUrl,
      apiKey,
      `products/${productId}?display=full`,
      "GET"
    );
    if (prodRes.ok) {
      const ids = parseAssociationsImagesBlock(prodText);
      if (ids.length > 0) {
        dlog(`[getProductImageIds] (via products/${productId}?display=full) found IDs:`, ids);
        return ids;
      }
      console.warn(`[getProductImageIds] No IDs from products/${productId}?display=full. Associations head: ${(prodText.match(/<associations\b[^>]*>[\s\S]{0,800}/i) || ["<no associations>"])[0]}`);
    } else {
      console.warn(`[getProductImageIds] products/${productId}?display=full HTTP ${prodRes.status}`);
    }

    // Strategy B: dedicated images endpoint
    const { response: imgRes, text: imgText } = await fetchPrestashop(
      shopUrl,
      apiKey,
      `images/products/${productId}`,
      "GET"
    );
    if (imgRes.ok) {
      const ids = parseImagesEndpoint(imgText, productId);
      dlog(`[getProductImageIds] (via images/products/${productId}) found IDs:`, ids);
      if (ids.length === 0) {
        console.warn(`[getProductImageIds] Could not parse image IDs. XML head: ${imgText.substring(0, 600).replace(/\n/g, " ")}`);
      }
      return ids;
    }
    console.warn(`[getProductImageIds] images/products/${productId} HTTP ${imgRes.status}`);
    return [];
  } catch (err) {
    console.error("Error fetching product image IDs:", err);
    return [];
  }
}

async function linkImagesToCombination(
  shopUrl: string,
  apiKey: string,
  combinationId: number,
  productId: number,
  imageIds: number[]
): Promise<boolean> {
  if (imageIds.length === 0) return true;
  try {
    dlog(`[Combination Image Linker] Linking images ${imageIds.join(", ")} to combination ID: ${combinationId}`);
    const { response: getRes, text: getXml } = await fetchPrestashop(
      shopUrl,
      apiKey,
      `combinations/${combinationId}`,
      "GET"
    );

    if (!getRes.ok) {
      console.warn(`[Combination Image Linker] Failed to GET combination XML for ID ${combinationId}`);
      return false;
    }

    const imagesXml = imageIds.map(id => `        <image><id><![CDATA[${id}]]></id></image>`).join("\n");
    const associationsImagesXml = `      <images>\n${imagesXml}\n      </images>`;

    let updatedXml = getXml;

    if (updatedXml.includes("<associations>")) {
      if (updatedXml.match(/<images[^>]*>[\s\S]*?<\/images>/i)) {
        updatedXml = updatedXml.replace(/<images[^>]*>[\s\S]*?<\/images>/i, associationsImagesXml);
      } else {
        updatedXml = updatedXml.replace(/<associations>/i, `<associations>\n${associationsImagesXml}`);
      }
    } else {
      const associationBlock = `    <associations>\n${associationsImagesXml}\n    </associations>`;
      updatedXml = updatedXml.replace(/<\/combination>/i, `${associationBlock}\n</combination>`);
    }

    // Strip PrestaShop's read-only attributes (like xlink:href) that cause PUT requests on combinations to fail!
    updatedXml = updatedXml.replace(/\s*xlink:href="[^"]*"/gi, "");

    const { response: putRes, text: putXml } = await fetchPrestashop(
      shopUrl,
      apiKey,
      `combinations/${combinationId}`,
      "PUT",
      {},
      updatedXml,
      true
    );

    if (putRes.ok || isBuggyPrestashopModuleWarning(putXml)) {
      dlog(`[Combination Image Linker] Successfully linked images to combination ${combinationId}`);
      return true;
    } else {
      const errMsg = extractPrestashopErrorMessage(putXml);
      console.error(`[Combination Image Linker] Failed to update combination ${combinationId} images: ${errMsg}`);
      return false;
    }
  } catch (err) {
    console.error(`[Combination Image Linker] Exception while linking images to combination ${combinationId}:`, err);
    return false;
  }
}

async function createProductCombinations(
  shopUrl: string,
  apiKey: string,
  langId: number,
  productId: number,
  sku: string,
  variants: (string | { name: string; quantity?: number; selectedImageIndexes?: number[] })[],
  quantity: number = 100
): Promise<{ id: number; color: string | null; selectedImageIndexes?: number[] }[]> {
  const combinationIds: number[] = [];
  const createdCombinations: { id: number; quantity: number }[] = [];
  const combinationInfoList: { id: number; color: string | null; selectedImageIndexes?: number[] }[] = [];
  try {
    const colorGroupName = langId === 1 ? "Kolor" : "Color";
    const sizeGroupName = langId === 1 ? "Rozmiar" : "Size";

    const colorGroupId = await getOrCreateAttributeGroup(shopUrl, apiKey, langId, colorGroupName, "color");
    const sizeGroupId = await getOrCreateAttributeGroup(shopUrl, apiKey, langId, sizeGroupName, "select");

    dlog(`Attribute Groups status: Color = ${colorGroupId}, Size = ${sizeGroupId}`);

    for (let i = 0; i < variants.length; i++) {
      const currentVar = variants[i];
      const varStr = typeof currentVar === "string" ? currentVar : currentVar.name;
      const varQty = (typeof currentVar === "object" && currentVar.quantity !== undefined) ? currentVar.quantity : quantity;

      const parsed = parseVariantString(varStr);
      dlog(`Processing variant:`, parsed, `with stock quantity: ${varQty}`);

      const optionValueIds: number[] = [];

      if (parsed.color && colorGroupId) {
        const valId = await getOrCreateAttributeValue(shopUrl, apiKey, langId, colorGroupId, parsed.color, true);
        if (valId) optionValueIds.push(valId);
      }
      if (parsed.size && sizeGroupId) {
        const valId = await getOrCreateAttributeValue(shopUrl, apiKey, langId, sizeGroupId, parsed.size);
        if (valId) optionValueIds.push(valId);
      }

      if (optionValueIds.length === 0) continue;

      const optionValueXml = optionValueIds
        .map(id => `<product_option_value><id><![CDATA[${id}]]></id></product_option_value>`)
        .join("\n");

      const combinationSku = ""; // Indeks MUST be completely empty as requested by user
      const isDefault = i === 0 ? "1" : "0";

      const combXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <combination>
    <id_product><![CDATA[${productId}]]></id_product>
    <reference><![CDATA[]]></reference>
    <price><![CDATA[0]]></price>
    <minimal_quantity><![CDATA[1]]></minimal_quantity>
    <default_on><![CDATA[${isDefault}]]></default_on>
    <associations>
      <product_option_values>
        ${optionValueXml}
      </product_option_values>
    </associations>
  </combination>
</prestashop>`;

      dlog(`Publishing combination ${i + 1} with attributes: ${JSON.stringify(optionValueIds)}`);
      const { response: combRes, text: combText } = await fetchPrestashop(
        shopUrl,
        apiKey,
        "combinations",
        "POST",
        {},
        combXml,
        true
      );

      const idMatch = combText.match(/<id[^>]*>\s*(?:<!\[CDATA\[)?\s*(\d+)\s*(?:\]\]>)?\s*<\/id>/i);
      if (idMatch && idMatch[1]) {
        const combinationId = parseInt(idMatch[1], 10);
        if (!combRes.ok) {
          dlog(`[Combination Warning Bypass] Combination creation returned status ${combRes.status} but successfully extracted combination ID ${combinationId} from response.`);
        }
        combinationIds.push(combinationId);
        createdCombinations.push({ id: combinationId, quantity: varQty });
        combinationInfoList.push({ id: combinationId, color: parsed.color, selectedImageIndexes: (typeof currentVar === "object" ? (currentVar as any).selectedImageIndexes : undefined) });
      } else {
        console.warn(`Combination creation returned status ${combRes.status}. Checking recovery fallback...`);
        const recoveredId = await findCreatedCombinationFallback(shopUrl, apiKey, productId, "", optionValueIds);
        if (recoveredId) {
          dlog(`[RECOVERY] Combination with optionValueIds "${JSON.stringify(optionValueIds)}" was found on PrestaShop with ID: ${recoveredId}`);
          combinationIds.push(recoveredId);
          createdCombinations.push({ id: recoveredId, quantity: varQty });
          combinationInfoList.push({ id: recoveredId, color: parsed.color, selectedImageIndexes: (typeof currentVar === "object" ? (currentVar as any).selectedImageIndexes : undefined) });
        } else {
          console.warn(`Combination creation failed for variant ${varStr}: ${combText}`);
        }
      }
    }

    if (createdCombinations.length > 0) {
      try {
        const { response: stockRes, text: stockText } = await fetchPrestashop(
          shopUrl,
          apiKey,
          "stock_availables",
          "GET",
          { "filter[id_product]": `[${productId}]`, display: "full", output_format: "JSON" }
        );

        if (stockRes.ok) {
          const stockData = cleanAndParseJson(stockText);
          if (stockData && stockData.stock_availables) {
            const list = Array.isArray(stockData.stock_availables) 
              ? stockData.stock_availables 
              : [stockData.stock_availables];

            for (const { id: combId, quantity: varQty } of createdCombinations) {
              let matchedStock = list.find((item: any) => {
                const itemAttrId = extractSafePrestashopId(item.id_product_attribute);
                return itemAttrId === combId;
              });

              if (!matchedStock) {
                dlog(`[Combination Stock Fallback] Stock record for combId=${combId} not found in product list. Querying directly by attribute...`);
                try {
                  const { response: directRes, text: directText } = await fetchPrestashop(
                    shopUrl,
                    apiKey,
                    "stock_availables",
                    "GET",
                    { "filter[id_product_attribute]": `[${combId}]`, display: "full", output_format: "JSON" }
                  );
                  if (directRes.ok) {
                    const directData = cleanAndParseJson(directText);
                    if (directData && directData.stock_availables) {
                      const directList = Array.isArray(directData.stock_availables) 
                        ? directData.stock_availables 
                        : [directData.stock_availables];
                      if (directList.length > 0) {
                        matchedStock = directList[0];
                      }
                    }
                  }
                } catch (directErr) {
                  console.error(`[Combination Stock Fallback] Failed fetching stock for combId=${combId}:`, directErr);
                }
              }

              if (matchedStock) {
                const stockId = extractSafePrestashopId(matchedStock.id);
                const isShop = extractSafePrestashopString(matchedStock.id_shop) || "1";
                const isShopGroup = extractSafePrestashopString(matchedStock.id_shop_group) || "0";

                const putStockXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id><![CDATA[${stockId}]]></id>
    <id_product><![CDATA[${productId}]]></id_product>
    <id_product_attribute><![CDATA[${combId}]]></id_product_attribute>
    <id_shop><![CDATA[${isShop}]]></id_shop>
    <id_shop_group><![CDATA[${isShopGroup}]]></id_shop_group>
    <quantity><![CDATA[${varQty}]]></quantity>
    <depends_on_stock><![CDATA[0]]></depends_on_stock>
    <out_of_stock><![CDATA[0]]></out_of_stock>
  </stock_available>
</prestashop>`;

                dlog(`[Combination Stock] Setting stock for combId=${combId} (stockId=${stockId}, shop=${isShop}) to quantity=${varQty}`);
                const { response: putStockRes, text: putStockText } = await fetchPrestashop(
                  shopUrl,
                  apiKey,
                  `stock_availables/${stockId}`,
                  "PUT",
                  {},
                  putStockXml,
                  true
                );

                if (putStockRes.ok || isBuggyPrestashopModuleWarning(putStockText)) {
                  if (!putStockRes.ok) {
                    dlog(`[Combination Stock Bypass] Stock update returned status ${putStockRes.status} but bypassed custom module warning. Treating as SUCCESS since DB update is completed.`);
                  } else {
                    dlog(`[Combination Stock] Successfully updated stock for combId=${combId} to quantity=${varQty}`);
                  }
                } else {
                  console.warn(`[Combination Stock Error] Failed to update stock for combId=${combId}: HTTP ${putStockRes.status} - ${putStockText}`);
                }
              } else {
                console.warn(`[Combination Stock Warning] Could not find matching stock record for combination ID ${combId}`);
              }
            }

            // Update main product overall stock record (id_product_attribute = 0) to equal the sum of all combinations
            const mainStock = list.find((item: any) => {
              const itemAttrId = extractSafePrestashopId(item.id_product_attribute);
              return itemAttrId === 0;
            });
            if (mainStock) {
              const totalQty = createdCombinations.reduce((sum, c) => sum + c.quantity, 0);
              const stockId = extractSafePrestashopId(mainStock.id);
              const isShop = extractSafePrestashopString(mainStock.id_shop) || "1";
              const isShopGroup = extractSafePrestashopString(mainStock.id_shop_group) || "0";
              const putStockXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id><![CDATA[${stockId}]]></id>
    <id_product><![CDATA[${productId}]]></id_product>
    <id_product_attribute><![CDATA[0]]></id_product_attribute>
    <id_shop><![CDATA[${isShop}]]></id_shop>
    <id_shop_group><![CDATA[${isShopGroup}]]></id_shop_group>
    <quantity><![CDATA[${totalQty}]]></quantity>
    <depends_on_stock><![CDATA[0]]></depends_on_stock>
    <out_of_stock><![CDATA[0]]></out_of_stock>
  </stock_available>
</prestashop>`;

              dlog(`[Combination Stock] Setting overall product stock (combId=0, stockId=${stockId}) to sum quantity=${totalQty}`);
              const { response: putOverallRes, text: putOverallText } = await fetchPrestashop(
                shopUrl,
                apiKey,
                `stock_availables/${stockId}`,
                "PUT",
                {},
                putStockXml,
                true
              );
              if (putOverallRes.ok || isBuggyPrestashopModuleWarning(putOverallText)) {
                dlog(`[Combination Stock] Successfully synchronized overall master product stock to ${totalQty}`);
              } else {
                console.warn(`[Combination Stock Warning] Failed updating overall master product stock: HTTP ${putOverallRes.status} - ${putOverallText}`);
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error updating stock availables for combinations:`, err);
      }
    }
  } catch (error) {
    console.error("Combinations pipeline failed:", error);
  }
  return combinationInfoList;
}

function cleanProductXmlForPut(xml: string): string {
  // Strip top-level read-only tags that PrestaShop rejects on PUT
  const readOnlyFields = [
    "manufacturer_name",
    "quantity",
    "id_shop_default",
    "id_default_image",
    "position_in_category",
    "cache_has_attachments",
    "cache_is_pack",
    "sales",
    "delivery_in_stock",
    "delivery_out_stock",
    "date_add",
    "date_upd"
  ];
  let cleaned = xml;
  for (const field of readOnlyFields) {
    const regex = new RegExp(`<${field}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${field}>`, "gi");
    cleaned = cleaned.replace(regex, "");
  }

  // Strip read-only association items within XML to prevent association PUT issues
  const readOnlyAssociations = [
    "combinations",
    "product_option_values",
    "images",
    "stock_availables"
  ];
  for (const assoc of readOnlyAssociations) {
    const regex = new RegExp(`<${assoc}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${assoc}>`, "gi");
    cleaned = cleaned.replace(regex, "");
  }

  return cleaned;
}

async function updateProductToCombinations(
  shopUrl: string,
  apiKey: string,
  productId: number,
  defaultCombinationId: number
): Promise<boolean> {
  try {
    dlog(`[Combinations Linker] Fetching full product XML for ID: ${productId}`);
    const { response: getRes, text: getXml } = await fetchPrestashop(
      shopUrl,
      apiKey,
      `products/${productId}`,
      "GET"
    );

    if (!getRes.ok) {
      console.warn(`[Combinations Linker] Failed to fetch product XML: ${getXml}`);
      return false;
    }

    let updatedXml = getXml;

    // 1. Update product_type to combinations
    if (updatedXml.includes("<product_type>")) {
      updatedXml = updatedXml.replace(/<product_type>[\s\S]*?<\/product_type>/i, `<product_type><![CDATA[combinations]]></product_type>`);
    } else {
      updatedXml = updatedXml.replace(/<product>/i, "<product>\n    <product_type><![CDATA[combinations]]></product_type>");
    }

    // 2. Update cache_default_attribute and id_default_combination to defaultCombinationId
    if (updatedXml.includes("<cache_default_attribute>")) {
      updatedXml = updatedXml.replace(/<cache_default_attribute>[\s\S]*?<\/cache_default_attribute>/i, `<cache_default_attribute><![CDATA[${defaultCombinationId}]]></cache_default_attribute>`);
    } else {
      updatedXml = updatedXml.replace(/<product>/i, `<product>\n    <cache_default_attribute><![CDATA[${defaultCombinationId}]]></cache_default_attribute>`);
    }

    if (updatedXml.includes("<id_default_combination>")) {
      updatedXml = updatedXml.replace(/<id_default_combination>[\s\S]*?<\/id_default_combination>/i, `<id_default_combination><![CDATA[${defaultCombinationId}]]></id_default_combination>`);
    } else {
      updatedXml = updatedXml.replace(/<product>/i, `<product>\n    <id_default_combination><![CDATA[${defaultCombinationId}]]></id_default_combination>`);
    }

    // 3. Clean any read-only fields/associations that would trigger PUT errors
    updatedXml = cleanProductXmlForPut(updatedXml);

    dlog(`[Combinations Linker] Sending PUT update for product ID: ${productId} setting default combination: ${defaultCombinationId}`);
    const { response: putRes, text: putXml } = await fetchPrestashop(
      shopUrl,
      apiKey,
      `products/${productId}`,
      "PUT",
      {},
      updatedXml,
      true
    );

    if (putRes.ok || isBuggyPrestashopModuleWarning(putXml)) {
      if (isBuggyPrestashopModuleWarning(putXml)) {
        dlog(`[Combinations Linker] Primary PUT returned warning but it was from buggy third-party module. Treating update as SUCCESS since DB update completes before hooks execute!`);
      } else {
        dlog(`[Combinations Linker] Successfully updated product ${productId} type to combinations with default combination: ${defaultCombinationId}`);
      }
      return true;
    } else {
      const errMsg = extractPrestashopErrorMessage(putXml);
      console.warn(`[Combinations Linker] Primary PUT failed: ${errMsg}. Raw snippet: ${putXml.substring(0, 500)}`);
      
      // Extract required 'name', 'link_rewrite' and 'price' nodes from fetched XML to prevent validator failures
      const nameMatch = getXml.match(/<name>(?:[\s\S]*?)<\/name>/i);
      const linkRewriteMatch = getXml.match(/<link_rewrite>(?:[\s\S]*?)<\/link_rewrite>/i);
      const priceMatch = getXml.match(/<price>(?:[\s\S]*?)<\/price>/i);
      const nameNode = nameMatch ? nameMatch[0] : "";
      const linkRewriteNode = linkRewriteMatch ? linkRewriteMatch[0] : "";
      const priceNode = priceMatch ? priceMatch[0] : "<price><![CDATA[0]]></price>";

      const minimizedXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product>
    <id><![CDATA[${productId}]]></id>
    <product_type><![CDATA[combinations]]></product_type>
    <id_default_combination><![CDATA[${defaultCombinationId}]]></id_default_combination>
    <cache_default_attribute><![CDATA[${defaultCombinationId}]]></cache_default_attribute>
    ${nameNode}
    ${linkRewriteNode}
    ${priceNode}
  </product>
</prestashop>`;

      const { response: miniRes, text: miniXml } = await fetchPrestashop(
        shopUrl,
        apiKey,
        `products/${productId}`,
        "PUT",
        {},
        minimizedXml,
        true
      );

      if (miniRes.ok || isBuggyPrestashopModuleWarning(miniXml)) {
        if (isBuggyPrestashopModuleWarning(miniXml)) {
          dlog(`[Combinations Linker] Minimized fallback PUT returned warning but it was from buggy third-party module. Treating fallback as SUCCESS since DB update is completed!`);
        } else {
          dlog(`[Combinations Linker] Minimized fallback PUT succeeded! Product ID ${productId} successfully linked to combinations.`);
        }
        return true;
      } else {
        const fallbackErrMsg = extractPrestashopErrorMessage(miniXml);
        console.error(`[Combinations Linker] Both primary and fallback PUT failed. Original Error: ${errMsg}, Fallback Error: ${fallbackErrMsg}. Raw fallback: ${miniXml.substring(0, 500)}`);
        return false;
      }
    }
  } catch (err) {
    console.error(`[Combinations Linker] Error trying to update product type to combinations:`, err);
    return false;
  }
}

// 4. Test Connection to PrestaShop Webservice API
app.post("/api/prestashop/test", async (req, res) => {
  try {
    const { config } = req.body;
    if (!config || !config.shopUrl || !config.apiKey) {
      res.status(400).json({ error: "Missing config credentials" });
      return;
    }

    dlog(`Testing PrestaShop connection`);
    const { response, text } = await fetchPrestashop(
      config.shopUrl,
      config.apiKey,
      "products",
      "GET",
      { limit: "1", output_format: "JSON" }
    );

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}: ${text.substring(0, 100)}`);
    }

    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn("Retrieved text not valid JSON", text);
    }
    res.json({ success: true, message: "Connected successfully", data });
  } catch (error: any) {
    console.error("PrestaShop connection test failed:", error);
    res.status(500).json({ 
      error: `Could not connect to your PrestaShop Webservice. Verify store URL, API key, and ensure Webservice is enabled with Products read permissions. Details: ${error.message}` 
    });
  }
});

// 3. Fetch Categories
app.post("/api/prestashop/categories", async (req, res) => {
  try {
    const { config } = req.body;
    if (!config || !config.shopUrl || !config.apiKey) {
      res.status(400).json({ error: "Missing config credentials" });
      return;
    }

    dlog(`Retrieving categories from PrestaShop`);
    const { response, text } = await fetchPrestashop(
      config.shopUrl,
      config.apiKey,
      "categories",
      "GET",
      { display: "[id,name]", output_format: "JSON" }
    );

    if (!response.ok) {
      throw new Error(`PrestaShop replied with status ${response.status}`);
    }

    const data = JSON.parse(text);
    let categories: any[] = [];
    
    if (data && data.categories) {
      const list = Array.isArray(data.categories)
        ? data.categories
        : [data.categories];
      categories = list.map((cat: any) => ({
        id: parseInt(cat.id, 10),
        name: Array.isArray(cat.name) 
          ? cat.name[0]?.value || cat.name[0] || `Cat #${cat.id}`
          : (cat.name?.value || cat.name || `Cat #${cat.id}`)
      }));
    }

    res.json({ success: true, categories });
  } catch (error: any) {
    console.error("Categories fetch failed:", error);
    res.status(500).json({ error: error.message || "Failed to retrieve categories from PrestaShop" });
  }
});

// 4. Add Product to PrestaShop (XML) & Upload Image (Multipart Form Post)
app.post("/api/prestashop/add-product", async (req, res) => {
  try {
    const { config, product, idCategories, idCategory, imageBase64, imageMimeType, imagesBase64, imagesMimeTypes, imagesColors, imagesNames } = req.body;
    if (!config || !product) {
      res.status(400).json({ error: "Missing config or product payload" });
      return;
    }

    const langId = config.languageId || 1;
    const slug = robustSlugify(product.title);
    const cleanPrice = parseFloat(product.price) || 0;
    
    // Resolve dynamic categories array
    const catList: number[] = Array.isArray(idCategories) && idCategories.length > 0 
      ? idCategories.map(id => parseInt(id, 10)) 
      : (idCategory ? [parseInt(idCategory, 10)] : [2]);

    // Choose the best principal default category (PrestaShop requires one specific value)
    let defaultCatId = req.body.idCategoryDefault ? parseInt(req.body.idCategoryDefault, 10) : catList[0];
    if (!req.body.idCategoryDefault && catList.length > 1) {
      const nonHome = catList.filter(id => id !== 2 && id !== 1);
      if (nonHome.length > 0) {
        defaultCatId = nonHome[0];
      }
    }

    // Build the dynamic <category> XML nodes
    const categoriesXml = catList
      .map((id: number) => `        <category>\n          <id><![CDATA[${id}]]></id>\n        </category>`)
      .join("\n");

    // Resolve dynamic tax rule group for PL Standard Rate (23%)
    let taxRuleGroupId: number | null = null;
    try {
      taxRuleGroupId = await findTaxRulesGroup(config.shopUrl, config.apiKey);
    } catch (err) {
      console.error(`Could not resolve PL Standard Rate tax rules group:`, err);
    }

    // Dynamic product features registration (Composition & Model specifications)
    const featureAssociations: { id: number; id_feature_value: number }[] = [];

    if (product.sklad && product.sklad.trim()) {
      dlog(`Setting Skład feature parameter`);
      try {
        const nameLabel = langId === 1 ? "Skład" : "Composition";
        const featId = await getOrCreateFeature(config.shopUrl, config.apiKey, langId, nameLabel);
        if (featId) {
          const valId = await createFeatureValue(config.shopUrl, config.apiKey, langId, featId, product.sklad.trim());
          if (valId) {
            featureAssociations.push({ id: featId, id_feature_value: valId });
          }
        }
      } catch (err) {
        console.error(`Could not assign Skład feature:`, err);
      }
    }

    if (product.modelka && product.modelka.trim()) {
      dlog(`Setting Modelka feature parameter`);
      try {
        const nameLabel = langId === 1 ? "Modelka" : "Model specifications";
        const featId = await getOrCreateFeature(config.shopUrl, config.apiKey, langId, nameLabel);
        if (featId) {
          const valId = await createFeatureValue(config.shopUrl, config.apiKey, langId, featId, product.modelka.trim());
          if (valId) {
            featureAssociations.push({ id: featId, id_feature_value: valId });
          }
        }
      } catch (err) {
        console.error(`Could not assign Modelka feature:`, err);
      }
    }

    let featuresXml = "";
    if (featureAssociations.length > 0) {
      featuresXml = `\n      <product_features>\n` + 
        featureAssociations.map(f => `        <product_feature>\n          <id><![CDATA[${f.id}]]></id>\n          <id_feature_value><![CDATA[${f.id_feature_value}]]></id_feature_value>\n        </product_feature>`).join("\n") +
        `\n      </product_features>`;
    }

    // Build compliant PrestaShop Webservice XML. Localized fields must specify standard lang index.
    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product>
    <active><![CDATA[0]]></active>
    <state><![CDATA[1]]></state>
    <available_for_order><![CDATA[1]]></available_for_order>
    <show_price><![CDATA[1]]></show_price>
    <additional_delivery_times><![CDATA[1]]></additional_delivery_times>
    ${taxRuleGroupId !== null ? `<id_tax_rules_group><![CDATA[${taxRuleGroupId}]]></id_tax_rules_group>` : ""}
    <product_type><![CDATA[${product.variants && product.variants.length > 0 ? "combinations" : "standard"}]]></product_type>
    <price><![CDATA[${cleanPrice}]]></price>
    <reference><![CDATA[${product.sku || ""}]]></reference>
    <id_category_default><![CDATA[${defaultCatId}]]></id_category_default>
    <name>
      <language id="${langId}"><![CDATA[${product.title}]]></language>
    </name>
    <link_rewrite>
      <language id="${langId}"><![CDATA[${slug}]]></language>
    </link_rewrite>
    <description_short>
      <language id="${langId}"><![CDATA[${product.description_short || ""}]]></language>
    </description_short>
    <description>
      <language id="${langId}"><![CDATA[${product.description || ""}]]></language>
    </description>
    <associations>
      <categories>
${categoriesXml}
      </categories>${featuresXml}
    </associations>
  </product>
</prestashop>`;

    dlog(`Posting XML payload to create product`);
    let { response, text: responseText } = await fetchPrestashop(
      config.shopUrl,
      config.apiKey,
      "products",
      "POST",
      {},
      xmlBody,
      true
    );

    let createdProductId: number | null = null;
    let apiWarningMessage = "";

    if (!response.ok) {
      console.warn(`PrestaShop product creation returned non-OK status: ${response.status}. Checking if product was successfully written to DB despite non-OK status...`);
      
      // Before posting the simplified XML as a retry and creating a duplicate, check if it was already created on the first POST!
      createdProductId = await findCreatedProductFallback(config.shopUrl, config.apiKey, product.sku, product.title);
      
      if (createdProductId) {
        dlog(`[Self-Healing Recovery] Product was successfully recovered on the first attempt with ID ${createdProductId}! Skipping simplified XML retry to prevent duplicate creations.`);
      } else {
        dlog(`Product was not found. Proceeding with simplified fallback XML retry...`);
        const retryXmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product>
    <active><![CDATA[0]]></active>
    <state><![CDATA[1]]></state>
    <price><![CDATA[${cleanPrice}]]></price>
    <reference><![CDATA[${product.sku || ""}]]></reference>
    <id_category_default><![CDATA[${defaultCatId}]]></id_category_default>
    <name>
      <language id="${langId}"><![CDATA[${product.title}]]></language>
    </name>
    <link_rewrite>
      <language id="${langId}"><![CDATA[${slug}]]></language>
    </link_rewrite>
    <description_short>
      <language id="${langId}"><![CDATA[${product.description_short || ""}]]></language>
    </description_short>
    <description>
      <language id="${langId}"><![CDATA[${product.description || ""}]]></language>
    </description>
    <associations>
      <categories>
${categoriesXml}
      </categories>${featuresXml}
    </associations>
  </product>
</prestashop>`;

        const retryRes = await fetchPrestashop(
          config.shopUrl,
          config.apiKey,
          "products",
          "POST",
          {},
          retryXmlBody,
          true
        );

        if (retryRes.response.ok) {
          dlog(`[Self-Healing Success] Simplified XML retry worked successfully!`);
          response = retryRes.response;
          responseText = retryRes.text;
        } else {
          console.error(`[Self-Healing Failed] Simplified XML retry also failed. Original Error: ${responseText}, Retry Error: ${retryRes.text}`);
          apiWarningMessage = responseText;
          
          // Attempt self-healing recovery by scanning PrestaShop to see if the product was successfully saved in the DB
          createdProductId = await findCreatedProductFallback(config.shopUrl, config.apiKey, product.sku, product.title);
          
          if (createdProductId) {
            dlog(`[RECOVERY] Product was successfully recovered! Found ID ${createdProductId} on PrestaShop despite the API warning/error output. Proceeding smoothly.`);
          } else {
            // If recovery truly failed, then throw the error
            console.error(`PrestaShop product creation failed and fallback recovery could not find any matching product. API response text:`, responseText);
            const friendlyErr = extractPrestashopErrorMessage(responseText);
            throw new Error(`PrestaShop API error: ${friendlyErr}. (Raw: ${responseText.substring(0, 300)})`);
          }
        }
      }
    }

    // Capture returned product ID using robust detection
    if (!createdProductId) {
      // Method A: Extract from HTTP response Location header (Standard REST behavior)
      const locationHeader = response.headers.get("Location");
      if (locationHeader) {
        const locMatch = locationHeader.match(/\/products\/(\d+)/i) || locationHeader.match(/\/(\d+)$/);
        if (locMatch && locMatch[1]) {
          createdProductId = parseInt(locMatch[1], 10);
          dlog(`Successfully parsed product ID from Location header: ${createdProductId}`);
        }
      }
    }

    if (!createdProductId) {
      // Method B: Parse XML with highly flexible regex matching attributes (e.g. <id xlink:href="...">) and CDATA wrappers
      const robustMatch = responseText.match(/<id[^>]*>\s*(?:<!\[CDATA\[)?\s*(\d+)\s*(?:\]\]>)?\s*<\/id>/i);
      if (robustMatch && robustMatch[1]) {
        createdProductId = parseInt(robustMatch[1], 10);
        dlog(`Successfully parsed product ID from flexible XML regex: ${createdProductId}`);
      }
    }

    if (!createdProductId) {
      // Last-ditch recovery lookup
      createdProductId = await findCreatedProductFallback(config.shopUrl, config.apiKey, product.sku, product.title);
    }

    if (!createdProductId) {
      const cleanSnippet = responseText.replace(/\s+/g, " ").substring(0, 200);
      throw new Error(`Product was successfully created (HTTP ${response.status}), but the system could not extract the new product ID from the response. Response snippet: "${cleanSnippet}". Check if your API key has enough access permissions for products.`);
    }

    dlog(`Product created with ID: ${createdProductId}`);

    // Create combinations if combinations are present
    const resolvedQty = product.quantity !== undefined ? parseInt(product.quantity, 10) : 100;
    let combinationInfo: { id: number; color: string | null; selectedImageIndexes?: number[] }[] = [];

    if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
      dlog(`Generating combinations for product ID: ${createdProductId} with stock quantity: ${resolvedQty}`);
      combinationInfo = await createProductCombinations(
        config.shopUrl,
        config.apiKey,
        langId,
        createdProductId,
        product.sku || `PROD-${createdProductId}`,
        product.variants,
        resolvedQty
      );
      if (combinationInfo.length > 0) {
        dlog(`Setting default combination reference for product ID: ${createdProductId}`);
        await updateProductToCombinations(
          config.shopUrl,
          config.apiKey,
          createdProductId,
          combinationInfo[0].id
        );
      }
    } else {
      // Set main product stock if no combinations are added
      dlog(`No combinations, setting default product stock to ${resolvedQty} for product ID: ${createdProductId}`);
      try {
        const { response: stockRes, text: stockText } = await fetchPrestashop(
          config.shopUrl,
          config.apiKey,
          "stock_availables",
          "GET",
          { "filter[id_product]": `[${createdProductId}]`, display: "full", output_format: "JSON" }
        );

        if (stockRes.ok) {
          const stockData = cleanAndParseJson(stockText);
          if (stockData && stockData.stock_availables) {
            const list = Array.isArray(stockData.stock_availables) 
              ? stockData.stock_availables 
              : [stockData.stock_availables];
            if (list.length > 0) {
              const mainStock = list[0];
              const stockId = extractSafePrestashopId(mainStock.id);
              const isShop = extractSafePrestashopString(mainStock.id_shop) || "1";
              const isShopGroup = extractSafePrestashopString(mainStock.id_shop_group) || "0";
              const putStockXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id><![CDATA[${stockId}]]></id>
    <id_product><![CDATA[${createdProductId}]]></id_product>
    <id_product_attribute><![CDATA[0]]></id_product_attribute>
    <id_shop><![CDATA[${isShop}]]></id_shop>
    <id_shop_group><![CDATA[${isShopGroup}]]></id_shop_group>
    <quantity><![CDATA[${resolvedQty}]]></quantity>
    <depends_on_stock><![CDATA[0]]></depends_on_stock>
    <out_of_stock><![CDATA[0]]></out_of_stock>
  </stock_available>
</prestashop>`;

              await fetchPrestashop(
                config.shopUrl,
                config.apiKey,
                `stock_availables/${stockId}`,
                "PUT",
                {},
                putStockXml,
                true
              );
            }
          }
        }
      } catch (err) {
        console.error(`Could not set default product stock available record:`, err);
      }
    }

    // Track image upload status
    let imageUploaded = false;
    let imagesUploadedCount = 0;
    let imageError = "";

    // Step 2: Upload product images if payload is passed
    const imageList = imagesBase64 && Array.isArray(imagesBase64) && imagesBase64.length > 0 
      ? imagesBase64 
      : (imageBase64 ? [imageBase64] : []);
    
    const mimeList = imagesMimeTypes && Array.isArray(imagesMimeTypes) && imagesMimeTypes.length > 0 
      ? imagesMimeTypes 
      : [imageMimeType || 'image/jpeg'];

    if (imageList.length > 0) {
      dlog(`Starting uploads of ${imageList.length} images for product ID: ${createdProductId}`);
      for (let i = 0; i < imageList.length; i++) {
        try {
          const base64Data = imageList[i];
          const rawBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
          const buffer = Buffer.from(rawBase64, 'base64');
          const mime = mimeList[i] || mimeList[0] || 'image/jpeg';
          
          // Generate an explicit custom boundary string
          const boundary = "----PrestaShopUploadBoundary" + Math.random().toString(16).substring(2);
          const CRLF = "\r\n";
          
          // Construct compliant multipart/form-data structure manually
          // We include dummy product elements here as form fields to safety-guard against buggy modules in PrestaShop that inspect $_POST['product'] during ActionObjectImageAddAfter hooks.
          const headerText = 
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="product[id]"${CRLF}${CRLF}` +
            `${createdProductId}${CRLF}` +
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="product[name]"${CRLF}${CRLF}` +
            `dummy${CRLF}` +
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="product[price]"${CRLF}${CRLF}` +
            `0${CRLF}` +
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="product"${CRLF}${CRLF}` +
            `1${CRLF}` +
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="image"; filename="image_${i}.jpg"${CRLF}` +
            `Content-Type: ${mime}${CRLF}${CRLF}`;
          const footerText = `${CRLF}--${boundary}--${CRLF}`;

          const multipartBody = Buffer.concat([
            Buffer.from(headerText, "utf-8"),
            buffer,
            Buffer.from(footerText, "utf-8")
          ]);

          dlog(`Uploading image ${i+1}/${imageList.length} (size: ${multipartBody.length} bytes) to product ID: ${createdProductId}`);
          
          const { response: imageRes, text: imageResText } = await fetchPrestashop(
            config.shopUrl,
            config.apiKey,
            `images/products/${createdProductId}`,
            "POST",
            {},
            multipartBody,
            false,
            `multipart/form-data; boundary=${boundary}`
          );

          const isWarning = isBuggyPrestashopModuleWarning(imageResText);
          if (imageRes.ok || isWarning) {
            imageUploaded = true;
            imagesUploadedCount++;
            if (isWarning) {
              dlog(`Image ${i+1} uploaded (bypassed custom module warning, image successfully stored in PrestaShop).`);
            } else {
              dlog(`Image ${i+1} uploaded successfully.`);
            }
          } else {
            const xmlErrMsg = extractPrestashopErrorMessage(imageResText);
            imageError = `Failed image ${i+1}: HTTP ${imageRes.status}: ${xmlErrMsg}. (Raw: ${imageResText.substring(0, 300)})`;
            console.warn(imageError);
          }
        } catch (imgErr: any) {
          imageError = `Failed image ${i+1}: ${imgErr.message}`;
          console.error(`Image upload exception at index ${i}:`, imgErr);
        }
      }
    }

    // Step 3: Link matching images to each combination
    if (combinationInfo.length > 0 && imageUploaded) {
      try {
        dlog(`[Combination Image Linker] Starting image linking process for product ID: ${createdProductId}`);
        const psImageIds = await getProductImageIds(config.shopUrl, config.apiKey, createdProductId);
        
        if (psImageIds.length > 0) {
          // Sort image IDs in ascending numerical order, which corresponds to sequential order of uploading!
          psImageIds.sort((a, b) => a - b);
          dlog(`[Combination Image Linker] Sorted PrestaShop Image IDs: ${psImageIds.join(", ")}`);

          for (const combInfo of combinationInfo) {
            const matchedImageIds: number[] = [];
            
            // Prioritize automatic matching based on dominant color and filenames.
            // If explicit selectedImageIndexes are defined by the client, use only those.
            if (combInfo.selectedImageIndexes !== undefined && Array.isArray(combInfo.selectedImageIndexes)) {
              dlog(`[Combination Image Linker] Using explicit selection for combination ID ${combInfo.id} (indices: ${combInfo.selectedImageIndexes.join(", ")})`);
              for (const imgIdx of combInfo.selectedImageIndexes) {
                if (imgIdx >= 0 && imgIdx < psImageIds.length) {
                  matchedImageIds.push(psImageIds[imgIdx]);
                }
              }
            } else {
              // Fallback to automatic matching (prioritizes dominant color and file names)
              dlog(`[Combination Image Linker] Using automatic matching for combination ID ${combInfo.id} (Color: ${combInfo.color || "none"})`);
              for (let i = 0; i < psImageIds.length; i++) {
                const imageId = psImageIds[i];
                const imageColorGroup = imagesColors && imagesColors[i] ? imagesColors[i] : "other";
                const imageFileName = imagesNames && imagesNames[i] ? imagesNames[i] : "";
                
                if (combInfo.color) {
                  if (isColorMatch(combInfo.color, imageColorGroup, imageFileName)) {
                    matchedImageIds.push(imageId);
                  }
                } else {
                  matchedImageIds.push(imageId);
                }
              }
            }
            
            // Fallback: if no image specifically matches this color group, link all images (only if no explicit selection was empty)
            const imagesToLink = (matchedImageIds.length > 0 || (combInfo.selectedImageIndexes && combInfo.selectedImageIndexes.length === 0)) 
              ? matchedImageIds 
              : psImageIds;
            
            dlog(`[Combination Image Linker] Combination ID ${combInfo.id} (Color: ${combInfo.color}) matched images: ${imagesToLink.join(", ")}`);
            await linkImagesToCombination(
              config.shopUrl,
              config.apiKey,
              combInfo.id,
              createdProductId,
              imagesToLink
            );
          }
        }
      } catch (linkErr) {
        console.error(`[Combination Image Linker] Error linking images to combinations:`, linkErr);
      }
    }

    res.json({
      success: true,
      productId: createdProductId,
      imageUploaded,
      imagesUploadedCount,
      imageError: imageUploaded && imagesUploadedCount === imageList.length ? undefined : imageError,
      apiWarning: apiWarningMessage || undefined,
      message: `Product successfully added to PrestaShop with ID: ${createdProductId}. Uploaded ${imagesUploadedCount} of ${imageList.length} images.`
    });

  } catch (error: any) {
    console.error("PrestaShop Product upload failed:", error);
    res.status(500).json({ error: error.message || "Failed to publish product into PrestaShop" });
  }
});

// 5. Update Product in PrestaShop
app.post("/api/prestashop/update-product", async (req, res) => {
  try {
    const { config, productId, product } = req.body;
    if (!config || !productId || !product) {
      res.status(400).json({ error: "Missing config, productId or product payload" });
      return;
    }

    const langId = config.languageId || 1;
    const cleanPrice = parseFloat(product.price) || 0;
    
    dlog(`[Product Editor] Fetching current XML for PrestaShop product: ${productId}`);
    const { response: getRes, text: getXml } = await fetchPrestashop(
      config.shopUrl,
      config.apiKey,
      `products/${productId}`,
      "GET"
    );

    if (!getRes.ok) {
      res.status(getRes.status).json({ error: `Failed to fetch product from PrestaShop: ${getXml.substring(0, 200)}` });
      return;
    }

    let updatedXml = getXml;

    const replaceTagContent = (xml: string, tagName: string, newContent: string): string => {
      const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`, "i");
      if (regex.test(xml)) {
        return xml.replace(regex, `<${tagName}><![CDATA[${newContent}]]></${tagName}>`);
      }
      return xml.replace(/<product>/i, `<product>\n    <${tagName}><![CDATA[${newContent}]]></${tagName}>`);
    };

    const replaceLocalizedTagContent = (xml: string, tagName: string, languageId: number, content: string): string => {
      const mainRegex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
      const match = xml.match(mainRegex);
      if (match) {
        let nodeBody = match[1];
        const langRegex = new RegExp(`<language\\s+id="${languageId}"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/language>`, "i");
        if (langRegex.test(nodeBody)) {
          nodeBody = nodeBody.replace(langRegex, `<language id="${languageId}"><![CDATA[${content}]]></language>`);
        } else {
          nodeBody += `\n      <language id="${languageId}"><![CDATA[${content}]]></language>`;
        }
        return xml.replace(mainRegex, `<${tagName}>${nodeBody}</${tagName}>`);
      } else {
        return xml.replace(/<product>/i, `<product>\n    <${tagName}>\n      <language id="${languageId}"><![CDATA[${content}]]></language>\n    </${tagName}>`);
      }
    };

    // Update non-localized fields
    updatedXml = replaceTagContent(updatedXml, "price", cleanPrice.toString());
    if (product.sku) {
      updatedXml = replaceTagContent(updatedXml, "reference", product.sku);
    }

    // Update localized fields
    updatedXml = replaceLocalizedTagContent(updatedXml, "name", langId, product.title);
    updatedXml = replaceLocalizedTagContent(updatedXml, "link_rewrite", langId, robustSlugify(product.title));
    updatedXml = replaceLocalizedTagContent(updatedXml, "description_short", langId, product.description_short || "");
    updatedXml = replaceLocalizedTagContent(updatedXml, "description", langId, product.description || "");

    // Update Features (Sklad / Modelka)
    const featureAssociations: { id: number; id_feature_value: number }[] = [];
    if (product.sklad && product.sklad.trim()) {
      try {
        const featId = await getOrCreateFeature(config.shopUrl, config.apiKey, langId, langId === 1 ? "Skład" : "Composition");
        if (featId) {
          const valId = await createFeatureValue(config.shopUrl, config.apiKey, langId, featId, product.sklad.trim());
          if (valId) {
            featureAssociations.push({ id: featId, id_feature_value: valId });
          }
        }
      } catch (err) {
        console.error(`Error updating Skład feature:`, err);
      }
    }

    if (product.modelka && product.modelka.trim()) {
      try {
        const featId = await getOrCreateFeature(config.shopUrl, config.apiKey, langId, langId === 1 ? "Modelka" : "Model specifications");
        if (featId) {
          const valId = await createFeatureValue(config.shopUrl, config.apiKey, langId, featId, product.modelka.trim());
          if (valId) {
            featureAssociations.push({ id: featId, id_feature_value: valId });
          }
        }
      } catch (err) {
        console.error(`Error updating Modelka feature:`, err);
      }
    }

    if (featureAssociations.length > 0) {
      const featuresXml = `\n      <product_features>\n` + 
        featureAssociations.map(f => `        <product_feature>\n          <id><![CDATA[${f.id}]]></id>\n          <id_feature_value><![CDATA[${f.id_feature_value}]]></id_feature_value>\n        </product_feature>`).join("\n") +
        `\n      </product_features>`;

      const assocMatch = updatedXml.match(/<associations(?:[^>]*)?>([\s\S]*?)<\/associations>/i);
      if (assocMatch) {
        let assocBody = assocMatch[1];
        if (assocBody.includes("<product_features>")) {
          assocBody = assocBody.replace(/<product_features(?:[^>]*)?>[\s\S]*?<\/product_features>/i, featuresXml);
        } else {
          assocBody += featuresXml;
        }
        updatedXml = updatedXml.replace(/<associations(?:[^>]*)?>[\s\S]*?<\/associations>/i, `<associations>${assocBody}</associations>`);
      } else {
        updatedXml = updatedXml.replace(/<\/product>/i, `  <associations>${featuresXml}</associations>\n</product>`);
      }
    }

    // Clean for PUT request (strip read-only)
    updatedXml = cleanProductXmlForPut(updatedXml);

    dlog(`[Product Editor] Sending PUT update for product ID: ${productId}`);
    const { response: putRes, text: putXml } = await fetchPrestashop(
      config.shopUrl,
      config.apiKey,
      `products/${productId}`,
      "PUT",
      {},
      updatedXml,
      true
    );

    const isWarning = isBuggyPrestashopModuleWarning(putXml);
    if (putRes.ok || isWarning) {
      if (isWarning) {
        dlog(`[Product Editor] Update returned custom module warning but DB update is completed before hooks execute. Treating as SUCCESS!`);
      } else {
        dlog(`[Product Editor] Success PUT update for product ID: ${productId}`);
      }
      res.json({ success: true, message: `Product successfully updated in PrestaShop` });
    } else {
      const errMsg = extractPrestashopErrorMessage(putXml);
      console.error(`[Product Editor] PUT request failed:`, putXml);
      res.status(putRes.status).json({ error: `PrestaShop PUT update failed: ${errMsg}. (Raw: ${putXml.substring(0, 300)})` });
    }

  } catch (error: any) {
    console.error("PrestaShop Product edit failed:", error);
    res.status(500).json({ error: error.message || "Failed to update product in PrestaShop" });
  }
});

// Configure Vite middleware or statically serve dist depending on environment variables
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    dlog(`Server running on port http://localhost:${PORT}`);
  });
}

startServer();
