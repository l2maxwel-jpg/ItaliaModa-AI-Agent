import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Camera, 
  Upload, 
  Settings, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  Plus, 
  Trash2, 
  Globe, 
  RefreshCw, 
  Sliders, 
  Eye, 
  Sparkles, 
  ArrowRight, 
  FileText, 
  DollarSign, 
  BarChart, 
  Laptop, 
  Layers,
  ChevronDown,
  Info,
  Pencil
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ProductAnalysis, 
  PrestaShopConfig, 
  PrestaShopCategory, 
  HistoryItem,
  UploadedImage,
  SuggestedVariant,
  ApiAnalyzeResponse,
  ApiTestConnectionResponse,
  ApiCategoriesResponse,
  ApiPublishResponse,
  ApiFieldRegenResponse,
  getErrorMessage,
} from "./types";

// Stable animation prop constants (avoid re-creating object refs on every render).
const COLLAPSIBLE_INITIAL = { opacity: 0, height: 0 };
const COLLAPSIBLE_ANIMATE = { opacity: 1, height: "auto" as const };
const COLLAPSIBLE_EXIT = { opacity: 0, height: 0 };
const MODAL_INITIAL = { scale: 0.95, opacity: 0 };
const MODAL_ANIMATE = { scale: 1, opacity: 1 };
const MODAL_EXIT = { scale: 0.95, opacity: 0 };

// Shared className helpers (replace nested ternaries inline in JSX).
const primaryActionButtonClass = (disabled: boolean, busy: boolean): string => {
  if (disabled) {
    return "bg-[#f1f2f4] text-[#8c9196] border border-[#e1e3e5] cursor-not-allowed";
  }
  if (busy) {
    return "bg-[#f1f8f5] text-[#008060] border border-[#008060]/30 animate-pulse cursor-wait";
  }
  return "bg-[#008060] hover:bg-[#006e52] text-white font-bold shadow-sm active:bg-[#005e46]";
};

const fieldGenerateButtonClass = (busy: boolean, noImage: boolean): string => {
  if (busy) {
    return "bg-[#f1f8f5] text-[#008060] border-[#008060]/30 animate-pulse";
  }
  if (noImage) {
    return "bg-[#f1f2f4] text-[#8c9196] border-[#e1e3e5] cursor-not-allowed";
  }
  return "bg-white hover:bg-[#f1f8f5] text-[#008060] border-[#babfc3] hover:border-[#008060]/30 cursor-pointer shadow-sm";
};

const dropzoneClass = (hasImage: boolean, dragActive: boolean): string => {
  if (hasImage) return "bg-white border-[#e1e3e5]";
  if (dragActive) return "bg-[#f1f8f5] border-[#008060] border-dashed";
  return "bg-[#fafbfb] hover:bg-white border-[#babfc3] hover:border-[#008060] border-dashed";
};

const detectDominantColorSilent = (base64: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 15;
        canvas.height = 15;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve("other");
          return;
        }
        ctx.drawImage(img, 0, 0, 15, 15);
        const imgData = ctx.getImageData(0, 0, 15, 15).data;
        
        // Advanced pixel voting with weighting (ignoring backgrounds & downweighting skin tones)
        const votes: Record<string, number> = {
          "white": 0,
          "beige": 0,
          "sand_camel": 0,
          "brown": 0,
          "pink": 0,
          "red": 0,
          "blue": 0,
          "grey": 0,
          "black": 0,
          "green": 0,
          "olive_khaki": 0,
          "yellow": 0,
          "other": 0
        };

        for (let row = 0; row < 15; row++) {
          for (let col = 0; col < 15; col++) {
            const index = (row * 15 + col) * 4;
            const r = imgData[index];
            const g = imgData[index + 1];
            const b = imgData[index + 2];
            const a = imgData[index + 3];
            
            if (a < 120) continue; // Skip semi-transparent pixels

            // RGB to HSL
            const rN = r / 255;
            const gN = g / 255;
            const bN = b / 255;
            
            const max = Math.max(rN, gN, bN);
            const min = Math.min(rN, gN, bN);
            let h = 0, s = 0, l = (max + min) / 2;
            
            if (max !== min) {
              const d = max - min;
              s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
              switch (max) {
                case rN: h = (gN - bN) / d + (gN < bN ? 6 : 0); break;
                case gN: h = (bN - rN) / d + 2; break;
                case bN: h = (rN - gN) / d + 4; break;
              }
              h /= 6;
            }
            
            const hDeg = Math.round(h * 360);
            const sPct = Math.round(s * 100);
            const lPct = Math.round(l * 100);

            // Calculate pixel weight based on position
            // Center is rows 2-12 and cols 2-12
            const isCenterRow = row >= 2 && row <= 12;
            const isCenterCol = col >= 2 && col <= 12;
            let weight = 1.0;
            
            if (isCenterRow && isCenterCol) {
              // Higher weight for the absolute center (vertical stripe where the model normally stands)
              if (col >= 4 && col <= 10) {
                weight = 3.0;
              } else {
                weight = 2.0;
              }
            } else {
              // Minimize influence of outer borders
              weight = 0.1;
            }

            // Downweight skin tone to avoid misidentifying flesh as beige or pink
            const isSkinTone = hDeg >= 6 && hDeg <= 28 && sPct >= 10 && sPct <= 45 && lPct >= 38 && lPct <= 85;
            if (isSkinTone) {
              weight *= 0.15;
            }

            // Categorization
            if (lPct > 86 && sPct < 15) {
              votes["white"] += weight * 0.1; // White background check - lowest rank
            } else if (lPct > 78 && sPct < 10) {
              votes["white"] += weight * 0.1;
            } else if (lPct < 16) {
              votes["black"] += weight;
            } else if (sPct < 8) {
              votes["grey"] += weight;
            } else {
              // Hue ranges
              if (hDeg >= 340 || hDeg < 17) {
                if (lPct > 45 && lPct < 75) {
                  votes["pink"] += weight;
                } else {
                  votes["red"] += weight;
                }
              } else if (hDeg >= 17 && hDeg < 48) {
                if (lPct < 40) {
                  votes["brown"] += weight;
                } else if (lPct < 68) {
                  votes["sand_camel"] += weight;
                } else {
                  votes["beige"] += weight;
                }
              } else if (hDeg >= 48 && hDeg < 70) {
                if (lPct > 72 || sPct < 25) {
                  votes["beige"] += weight;
                } else {
                  votes["yellow"] += weight;
                }
              } else if (hDeg >= 70 && hDeg < 165) {
                if (lPct < 43) {
                  votes["olive_khaki"] += weight;
                } else {
                  votes["green"] += weight;
                }
              } else if (hDeg >= 165 && hDeg < 255) {
                votes["blue"] += weight;
              } else if (hDeg >= 255 && hDeg < 340) {
                if (lPct > 50) {
                  votes["pink"] += weight;
                } else {
                  votes["other"] += weight;
                }
              } else {
                votes["other"] += weight;
              }
            }
          }
        }

        // Find the color group with the highest summed weight
        let bestColor = "other";
        let maxWeight = -1;
        for (const [color, weightSum] of Object.entries(votes)) {
          if (weightSum > maxWeight) {
            maxWeight = weightSum;
            bestColor = color;
          }
        }
        resolve(bestColor);
      } catch (e) {
        resolve("other");
      }
    };
    img.onerror = () => resolve("other");
    img.src = base64;
  });
};

const colorPriorityList: Record<string, number> = {
  "white": 1,
  "beige": 2,
  "sand_camel": 3,
  "brown": 4,
  "pink": 5,
  "red": 6,
  "blue": 7,
  "grey": 8,
  "black": 9,
  "green": 10,
  "olive_khaki": 11,
  "yellow": 12,
  "other": 13
};

export function extractNumberFromFilename(filename: string): number {
  if (!filename) return 999999;
  const matches = filename.match(/\d+/g);
  if (matches && matches.length > 0) {
    // Return the last consecutive digits found in the filename parsed as base 10.
    return parseInt(matches[matches.length - 1], 10);
  }
  return 999999;
}

export function autoSortImagesByColor(images: { id: string; base64: string; mimeType: string; colorGroup?: string; orderIndex: number; fileName?: string }[]) {
  return [...images].sort((a, b) => {
    const valA = colorPriorityList[a.colorGroup || "other"] ?? 99;
    const valB = colorPriorityList[b.colorGroup || "other"] ?? 99;
    if (valA !== valB) {
      return valA - valB;
    }
    const numA = extractNumberFromFilename(a.fileName || "");
    const numB = extractNumberFromFilename(b.fileName || "");
    if (numA !== numB) {
      return numA - numB;
    }
    if (a.fileName && b.fileName) {
      const alphaComp = a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
      if (alphaComp !== 0) return alphaComp;
    }
    return a.orderIndex - b.orderIndex;
  });
}

export function sortImagesByColorAndOrder(images: UploadedImage[]): UploadedImage[] {
  return [...images].sort((a, b) => a.orderIndex - b.orderIndex);
}

export function parseVariantStringFrontend(varStr: string) {
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

  return { color, size };
}

export function isColorMatchFrontend(variantColorName: string, imageColorGroup: string, imageFileName: string = ""): boolean {
  const vc = variantColorName.toLowerCase().trim();
  const ic = (imageColorGroup || "").toLowerCase().trim();
  const fn = (imageFileName || "").toLowerCase().trim();

  if (fn) {
    const vcRoots = [vc];
    if (vc.endsWith("owy")) vcRoots.push(vc.slice(0, -3));
    if (vc.endsWith("y")) vcRoots.push(vc.slice(0, -1));
    if (vc.endsWith("a")) vcRoots.push(vc.slice(0, -1));
    if (vc.endsWith("e")) vcRoots.push(vc.slice(0, -1));
    if (vc.endsWith("ый")) vcRoots.push(vc.slice(0, -2));
    if (vc.endsWith("ий")) vcRoots.push(vc.slice(0, -2));
    if (vc.endsWith("ая")) vcRoots.push(vc.slice(0, -2));
    if (vc.endsWith("евый")) vcRoots.push(vc.slice(0, -4));

    for (const root of vcRoots) {
      if (root.length >= 3 && fn.includes(root)) {
        return true;
      }
    }

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
      if (fn.includes("khaki") || fn.includes("oliw") || fn.includes("green") || fn.includes("army")) return true;
    }
  }

  const groupTag = ic;
  if (!groupTag || groupTag === "other") return false;

  const tagKeywords: Record<string, string[]> = {
    "white": ["biał", "bial", "biel", "white", "mlecz", "ecru", "krem"],
    "beige": ["beż", "bez", "ecru", "beige", "piask", "krem", "oatmeal"],
    "sand_camel": ["camel", "karmel", "cognac", "koniak", "sand", "fango"],
    "brown": ["brąz", "braz", "czekolad", "brown", "mocca", "taupe"],
    "pink": ["róż", "roz", "pink", "fuks", "puder"],
    "red": ["czerwo", "red", "bord", "wine", "śliwka", "musztard"],
    "blue": ["niebies", "błękit", "blekit", "granat", "blue", "jeans"],
    "grey": ["szar", "grafit", "popiel", "grey", "gray"],
    "black": ["czarn", "czerń", "czern", "black"],
    "green": ["ziel", "khaki", "olivo", "green", "szmaragd", "mięt", "miet"]
  };

  const keywords = tagKeywords[groupTag];
  if (keywords) {
    return keywords.some(kw => vc.includes(kw));
  }

  return false;
}

export function getAutoSelectedImageIds(
  variantName: string,
  images: Pick<UploadedImage, "id" | "colorGroup" | "fileName">[]
): string[] {
  const parsed = parseVariantStringFrontend(variantName);
  if (!parsed.color) return [];
  return images
    .filter(img => isColorMatchFrontend(parsed.color!, img.colorGroup || "other", img.fileName || ""))
    .map(img => img.id);
}

export function sortVariantsByImages(
  variants: SuggestedVariant[],
  sortedImages: Pick<UploadedImage, "id" | "colorGroup" | "fileName">[]
): SuggestedVariant[] {
  return [...variants].map((v, originalIdx) => {
    const parsed = parseVariantStringFrontend(v.name);
    let firstMatchIdx = 999999;
    if (parsed.color) {
      firstMatchIdx = sortedImages.findIndex(img => 
        isColorMatchFrontend(parsed.color!, img.colorGroup || "other", img.fileName || "")
      );
      if (firstMatchIdx === -1) {
        firstMatchIdx = 999999;
      }
    }
    return { ...v, firstMatchIdx, originalIdx };
  }).sort((a, b) => {
    if (a.firstMatchIdx !== b.firstMatchIdx) {
      return a.firstMatchIdx - b.firstMatchIdx;
    }
    return a.originalIdx - b.originalIdx;
  }).map(({ firstMatchIdx, originalIdx, ...v }) => v);
}

export default function App() {
  // --- Persistent Connection Config State ---
  const [psConfig, setPsConfig] = useState<PrestaShopConfig>(() => {
    const saved = localStorage.getItem("presta_config");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved presta_config from localStorage:", e);
      }
    }
    return {
      shopUrl: "https://my-prestashop.com",
      apiKey: "",
      languageId: 1
    };
  });

  const [showSettings, setShowSettings] = useState<boolean>(false);
  
  // --- Target Generation Language Selector ---
  const [dataLanguage, setDataLanguage] = useState<"pl" | "ru">(() => {
    const saved = localStorage.getItem("presta_data_language");
    return (saved as "pl" | "ru") || "pl"; // Defaults to Polish as selected default language
  });

  useEffect(() => {
    localStorage.setItem("presta_data_language", dataLanguage);
  }, [dataLanguage]);
  const [isTestingConfig, setIsTestingConfig] = useState<boolean>(false);
  const [configTestResult, setConfigTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // --- UI & Upload/Camera State ---
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null); 
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [imageMime, setImageMime] = useState<string>("image/jpeg");
  const [dragActive, setDragActive] = useState<boolean>(false);
  
  // --- Thumbnail manual drag-and-drop reordering state & handlers ---
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const handleDragStartItem = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOverItem = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDropItem = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIndex) return;

    setUploadedImages((prev) => {
      const sortedList = [...prev].sort((a, b) => a.orderIndex - b.orderIndex);
      const draggedItem = sortedList[draggedIdx];
      if (!draggedItem) return prev;

      sortedList.splice(draggedIdx, 1);
      sortedList.splice(targetIndex, 0, draggedItem);

      return sortedList.map((img, idx) => ({
        ...img,
        orderIndex: idx
      }));
    });

    setDraggedIdx(null);
  };

  const handleDragEndItem = () => {
    setDraggedIdx(null);
  };
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // --- AI Analysis & Form State ---
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<ProductAnalysis | null>(null);
  const [userHint, setUserHint] = useState<string>("");
  const [isGeneratingField, setIsGeneratingField] = useState<Record<string, boolean>>({
    title: false,
    description_short: false,
    description: false
  });

  // Form Fields for current product being edited
  const [title, setTitle] = useState<string>("");
  const [sku, setSku] = useState<string>("");
  const [price, setPrice] = useState<number>(0);
  const [grossPrice, setGrossPrice] = useState<number>(0);
  const [vatRate, setVatRate] = useState<number>(23); // Default standard Polish VAT (23%)
  const [sklad, setSklad] = useState<string>(""); // Apparel fabric composition (e.g. 100% LEN)
  const [modelka, setModelka] = useState<string>(""); // Model specs (e.g. MA 175 CM...)
  const [suggestedVariants, setSuggestedVariants] = useState<SuggestedVariant[]>([]); // Extracted product variants
  const sortedImages = React.useMemo(() => sortImagesByColorAndOrder(uploadedImages), [uploadedImages]);

  const currentImagesOrderKey = sortedImages.map(img => img.id).join(",");
  useEffect(() => {
    if (suggestedVariants.length > 0 && sortedImages.length > 0) {
      setSuggestedVariants(prev => {
        const sorted = sortVariantsByImages(prev, sortedImages);
        // Compare to see if order actually changed to avoid infinite renders
        const changed = sorted.some((item, idx) => {
          const original = prev[idx];
          return !original || item.name !== original.name || item.quantity !== original.quantity || JSON.stringify(item.selectedImageIds) !== JSON.stringify(original.selectedImageIds);
        });
        if (changed) {
          return sorted;
        }
        return prev;
      });
    }
  }, [currentImagesOrderKey, suggestedVariants.length]);
  const [descShort, setDescShort] = useState<string>("");
  const [descLong, setDescLong] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<number[]>([2]); // Array of selected category IDs
  const [defaultCategoryId, setDefaultCategoryId] = useState<number | null>(null); // Default principal category ID

  // --- PrestaShop Dynamic Categories ---
  const [psCategories, setPsCategories] = useState<PrestaShopCategory[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState<boolean>(false);
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);

  // Memoized list of categories that the user has actually selected.
  // Computed inline in JSX would run filter on every render — extracted here
  // so it only recomputes when its inputs change.
  const selectedPsCategories = useMemo(
    () => psCategories.filter(c => selectedCategories.includes(c.id)),
    [psCategories, selectedCategories]
  );

  // --- Sync History State ---
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem("sync_history");
    return saved ? JSON.parse(saved) : [];
  });

  // --- Gallery Editing State ---
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editSku, setEditSku] = useState<string>("");
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editGrossPrice, setEditGrossPrice] = useState<number>(0);
  const [editSklad, setEditSklad] = useState<string>("");
  const [editModelka, setEditModelka] = useState<string>("");
  const [editDescShort, setEditDescShort] = useState<string>("");
  const [editDescLong, setEditDescLong] = useState<string>("");
  const [isUpdatingPrestaShop, setIsUpdatingPrestaShop] = useState<boolean>(false);
  const [updateStatus, setUpdateStatus] = useState<{ success?: boolean; error?: string } | null>(null);

  // --- Sync Operation State ---
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<{ success?: boolean; error?: string; productId?: number } | null>(null);

  // Save Config to LocalStorage whenever update happens
  useEffect(() => {
    localStorage.setItem("presta_config", JSON.stringify(psConfig));
  }, [psConfig]);

  // Save History to LocalStorage
  useEffect(() => {
    localStorage.setItem("sync_history", JSON.stringify(history));
  }, [history]);

  // --- PrestaShop Actions API ---
  const fetchCategories = useCallback(async () => {
    setIsLoadingCategories(true);
    setCategoryLoadError(null);
    try {
      const response = await fetch("/api/prestashop/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: psConfig }),
      });
      const data: ApiCategoriesResponse = await response.json();
      if (response.ok && data.success) {
        setPsCategories(data.categories || []);
      } else {
        setCategoryLoadError(data.error || "Не удалось загрузить категории.");
      }
    } catch (err: unknown) {
      setCategoryLoadError(getErrorMessage(err) || "Ошибка подключения к прокси-серверу.");
    } finally {
      setIsLoadingCategories(false);
    }
  }, [psConfig]);

  // Load Categories on active configuration match
  useEffect(() => {
    if (psConfig.apiKey && psConfig.shopUrl) {
      fetchCategories();
    }
  }, [psConfig.apiKey, psConfig.shopUrl, fetchCategories]);

  // Synchronously select "Wszystkie produkty" and "Nowa kolekcja" as default whenever categories load or are initialized
  useEffect(() => {
    if (psCategories.length > 0) {
      const defaultIds: number[] = [];
      const wyszytkie = psCategories.find(c => 
        c.name.toLowerCase().includes("wszystkie") || 
        c.name.toLowerCase().includes("home") || 
        c.name.toLowerCase().includes("главная") ||
        c.id === 2
      );
      if (wyszytkie) {
        defaultIds.push(wyszytkie.id);
      } else {
        defaultIds.push(2);
      }

      const nowaKolekcja = psCategories.find(c => 
        c.name.toLowerCase().includes("nowa") || 
        c.name.toLowerCase().includes("nowe") || 
        c.name.toLowerCase().includes("новинки") ||
        c.name.toLowerCase().includes("new")
      );
      if (nowaKolekcja) {
        defaultIds.push(nowaKolekcja.id);
      }

      setSelectedCategories(prev => {
        const union = Array.from(new Set([...prev, ...defaultIds]));
        return union;
      });
    }
  }, [psCategories]);

  // Keep defaultCategoryId synchronized with selectedCategories
  useEffect(() => {
    if (selectedCategories.length === 0) {
      setDefaultCategoryId(null);
    } else if (defaultCategoryId === null || !selectedCategories.includes(defaultCategoryId)) {
      const nonHome = selectedCategories.filter(id => id !== 2 && id !== 1);
      if (nonHome.length > 0) {
        setDefaultCategoryId(nonHome[0]);
      } else {
        setDefaultCategoryId(selectedCategories[0]);
      }
    }
  }, [selectedCategories, defaultCategoryId]);

  // --- Price & VAT Calculators ---
  const handleNetPriceChange = (val: number) => {
    setPrice(val);
    const calculatedGross = val * (1 + vatRate / 100);
    setGrossPrice(parseFloat(calculatedGross.toFixed(2)));
  };

  const handleGrossPriceChange = (val: number) => {
    setGrossPrice(val);
    const calculatedNet = val / (1 + vatRate / 100);
    setPrice(parseFloat(calculatedNet.toFixed(2)));
  };

  const handleVatRateChange = (rate: number) => {
    setVatRate(rate);
    const calculatedNet = grossPrice / (1 + rate / 100);
    setPrice(parseFloat(calculatedNet.toFixed(2)));
  };

  // --- Camera Operations ---
  const startCamera = async (deviceId?: string) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      setIsCameraActive(true);
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      // Fetch devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === "videoinput");
      setCameraDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedCameraId) {
        setSelectedCameraId(videoDevices[0].deviceId);
      }
    } catch (err: unknown) {
      console.error("Camera access failed:", err);
      alert("Не удалось получить доступ к камере. Убедитесь в наличии разрешений.");
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        // Downscale image to max 1280px for performance & payload limits
        const maxDim = 1280;
        let finalWidth = canvas.width;
        let finalHeight = canvas.height;
        let base64 = "";

        if (finalWidth > maxDim || finalHeight > maxDim) {
          if (finalWidth > finalHeight) {
            finalHeight = Math.round((finalHeight * maxDim) / finalWidth);
            finalWidth = maxDim;
          } else {
            finalWidth = Math.round((finalWidth * maxDim) / finalHeight);
            finalHeight = maxDim;
          }
          const scaleCanvas = document.createElement("canvas");
          scaleCanvas.width = finalWidth;
          scaleCanvas.height = finalHeight;
          const scaleCtx = scaleCanvas.getContext("2d");
          if (scaleCtx) {
            scaleCtx.drawImage(canvas, 0, 0, finalWidth, finalHeight);
            base64 = scaleCanvas.toDataURL("image/jpeg", 0.85);
          }
        } else {
          base64 = canvas.toDataURL("image/jpeg", 0.85);
        }

        if (base64) {
          setSelectedImage(base64);
          setImageMime("image/jpeg");
          detectDominantColorSilent(base64).then((detectedColor) => {
            const newItem = {
              id: Math.random().toString(36).substring(7),
              base64,
              mimeType: "image/jpeg",
              colorGroup: detectedColor,
              orderIndex: 999999
            };
            setUploadedImages((prev) => {
              const sorted = autoSortImagesByColor([...prev, newItem]);
              return sorted.map((img, idx) => ({ ...img, orderIndex: idx }));
            });
          });
        }
      }
      stopCamera();
    }
  };

  // --- Image File Upload Handlers ---
  const handleMultipleFiles = async (files: FileList) => {
    const startTime = Date.now();
    const fileArray = Array.from(files).filter(file => file.type.startsWith("image/"));
    if (fileArray.length === 0) return;

    const promises = fileArray.map((file, index) => {
      return new Promise<{ id: string; base64: string; mimeType: string; colorGroup: string; orderIndex: number; fileName: string } | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const maxDim = 1200;
            let width = img.width;
            let height = img.height;
            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              const base64 = canvas.toDataURL(file.type, 0.85);
              detectDominantColorSilent(base64).then((detectedColor) => {
                resolve({
                  id: Math.random().toString(36).substring(7),
                  base64,
                  mimeType: file.type,
                  colorGroup: detectedColor,
                  orderIndex: startTime + index,
                  fileName: file.name
                });
              });
            } else {
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          img.src = e.target?.result as string;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    });

    const results = await Promise.all(promises);
    const validNewItems = results.filter((item): item is NonNullable<typeof item> => item !== null);

    if (validNewItems.length > 0) {
      setUploadedImages((prev) => {
        // Filter out duplicates
        const filteredNewItems = validNewItems.filter(
          newItem => !prev.some(existing => existing.base64 === newItem.base64)
        );
        if (filteredNewItems.length === 0) return prev;

        const combined = [...prev, ...filteredNewItems];
        const sorted = autoSortImagesByColor(combined);
        const fullySorted = sorted.map((img, idx) => ({ ...img, orderIndex: idx }));

        // Correctly set selected cover image after sorting
        if (fullySorted.length > 0) {
          if (!selectedImage || !fullySorted.some(item => item.base64 === selectedImage)) {
            setSelectedImage(fullySorted[0].base64);
            setImageMime(fullySorted[0].mimeType);
          }
        }

        return fullySorted;
      });
    }
  };

  const handleImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Пожалуйста, загрузите файл изображения (PNG, JPG, WebP)");
      return;
    }
    // Create custom FileList helper
    const dt = new DataTransfer();
    dt.items.add(file);
    handleMultipleFiles(dt.files);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleMultipleFiles(e.dataTransfer.files);
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleFileSelectBtn = () => {
    fileInputRef.current?.click();
  };

  const handleTestConnection = async () => {
    setIsTestingConfig(true);
    setConfigTestResult(null);
    try {
      const response = await fetch("/api/prestashop/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: psConfig }),
      });
      const data: ApiTestConnectionResponse = await response.json();
      if (response.ok && data.success) {
        setConfigTestResult({
          success: true,
          message: "Успешное подключение! API работает корректно и имеет доступ к товарам."
        });
        fetchCategories();
      } else {
        setConfigTestResult({
          success: false,
          message: data.error || "Ошибка авторизации. Проверьте правильность URL и веб-сервис ключа."
        });
      }
    } catch (err: unknown) {
      setConfigTestResult({
        success: false,
        message: getErrorMessage(err) || "Ошибка соединения с локальным прокси-сервером."
      });
    } finally {
      setIsTestingConfig(false);
    }
  };

  // --- Gemini API Call ---
  const analyzeImage = async () => {
    if (!selectedImage) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setSyncStatus(null);

    try {
      const imagesPayload = sortedImages.length > 0 
        ? sortedImages.map(img => img.base64.split(",")[1]) 
        : [selectedImage.split(",")[1]];
      const mimesPayload = sortedImages.length > 0 
        ? sortedImages.map(img => img.mimeType) 
        : [imageMime];

      const response = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          images: imagesPayload, 
          mimeTypes: mimesPayload, 
          image: selectedImage.split(",")[1], 
          mimeType: imageMime, 
          language: dataLanguage, 
          userHint,
          config: psConfig
        }),
      });

      const data: ApiAnalyzeResponse = await response.json();
      if (response.ok && data.success && data.analysis) {
        const analysis: ProductAnalysis = data.analysis;
        setAnalysisResult(analysis);
        
        let formattedTitle = "";
        if (analysis.title) {
          const trimmed = analysis.title.trim();
          if (trimmed.length > 0) {
            formattedTitle = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
          }
        }
        setTitle(formattedTitle);
        
        // Articul (SKU) and price are NOT generated by AI (they are manually processed as requested)
        setSklad(analysis.sklad || "");
        setModelka(analysis.modelka || "");
        setSuggestedVariants((analysis.variants || []).map((v: string) => ({ 
          name: v, 
          quantity: 0, 
          selectedImageIds: getAutoSelectedImageIds(v, uploadedImages) 
        })));

        setDescShort(analysis.description_short || "");
        setDescLong(analysis.description || "");

        // Match suggested categories to dynamic store categories!
        if (psCategories.length > 0 && analysis.suggested_categories && Array.isArray(analysis.suggested_categories)) {
          const matchedIds: number[] = [];
          let firstMatchedId: number | null = null;
          analysis.suggested_categories.forEach((sCat: string) => {
            const scLower = sCat.toLowerCase().trim();
            const matched = psCategories.find(c => {
              const cnLower = c.name.toLowerCase().trim();
              return cnLower.includes(scLower) || scLower.includes(cnLower);
            });
            if (matched) {
              matchedIds.push(matched.id);
              if (firstMatchedId === null) {
                firstMatchedId = matched.id;
              }
            }
          });

          setSelectedCategories(prev => {
            const union = Array.from(new Set([...prev, ...matchedIds]));
            return union;
          });

          if (firstMatchedId !== null) {
            setDefaultCategoryId(firstMatchedId);
          }
        }
      } else {
        setAnalysisError(data.error || "Не удалось проанализировать изображение. Попробуйте еще раз.");
      }
    } catch (err: unknown) {
      setAnalysisError(getErrorMessage(err) || "Инфраструктурная ошибка при обращении к AI-модели.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- AI Granular Field Generation ---
  const handleGenerateFieldWithAI = async (fieldName: "title" | "description_short" | "description") => {
    if (!selectedImage) {
      alert(dataLanguage === "ru" 
        ? "Пожалуйста, сначала выберите или загрузите изображение товара." 
        : "Najpierw wybierz lub prześlij zdjęcie produktu.");
      return;
    }

    setIsGeneratingField(prev => ({ ...prev, [fieldName]: true }));

    try {
      const imagesPayload = sortedImages.length > 0 
        ? sortedImages.map(img => img.base64.split(",")[1]) 
        : [selectedImage.split(",")[1]];
      const mimesPayload = sortedImages.length > 0 
        ? sortedImages.map(img => img.mimeType) 
        : [imageMime];

      const currentValue =
        fieldName === "title"
          ? title
          : fieldName === "description_short"
            ? descShort
            : descLong;

      // Note: kept as a two-step lookup; helper would obscure the simple
      // 3-key mapping. If more fields are added later, refactor to a Record.

      const response = await fetch("/api/gemini/generate-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: fieldName,
          images: imagesPayload,
          mimeTypes: mimesPayload,
          language: dataLanguage,
          currentValue,
          userPrompt: userHint // Use the rich text area userHint as instructions
        }),
      });

      const data: ApiFieldRegenResponse = await response.json();
      if (response.ok && data.success && data.text) {
        if (fieldName === "title") {
          let text = data.text.trim();
          if (text) {
            text = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
          }
          setTitle(text);
        } else if (fieldName === "description_short") {
          setDescShort(data.text.trim());
        } else if (fieldName === "description") {
          setDescLong(data.text.trim());
        }
      } else {
        alert(data.error || "Не удалось сгенерировать поле. Попробуйте еще раз.");
      }
    } catch (err: unknown) {
      alert(getErrorMessage(err) || "Ошибка подключения при генерации поля.");
    } finally {
      setIsGeneratingField(prev => ({ ...prev, [fieldName]: false }));
    }
  };

  // --- Publish To PrestaShop ---
  const publishProduct = async () => {
    if (!title) {
      alert("Пожалуйста, заполните как минимум название товара.");
      return;
    }

    setIsSyncing(true);
    setSyncStatus(null);

    // Gather all image IDs that are selected (marked) in any of the variants.
    const selectedImageIdsAcrossVariants = new Set<string>();
    suggestedVariants.forEach(v => {
      const ids = v.selectedImageIds || getAutoSelectedImageIds(v.name, uploadedImages);
      ids.forEach(id => selectedImageIdsAcrossVariants.add(id));
    });

    // Strictly filter images to only those marked in the Variants / Combinations section, unless there are no variants
    const finalImagesToUpload = suggestedVariants.length > 0
      ? sortedImages.filter(img => selectedImageIdsAcrossVariants.has(img.id))
      : sortedImages;

    // Extract raw base64 arrays for multiple files upload
    let imagesVal: string[];
    let mimesVal: string[];
    if (finalImagesToUpload.length > 0) {
      imagesVal = finalImagesToUpload.map(img => img.base64.split(",")[1]);
      mimesVal = finalImagesToUpload.map(img => img.mimeType);
    } else {
      imagesVal = selectedImage ? [selectedImage.split(",")[1]] : [];
      mimesVal = imageMime ? [imageMime] : [];
    }
    const colorsVal = finalImagesToUpload.length > 0
      ? finalImagesToUpload.map(img => img.colorGroup || "other")
      : ["other"];
    const namesVal = finalImagesToUpload.length > 0
      ? finalImagesToUpload.map(img => img.fileName || "")
      : [""];

    const variantsPayload = suggestedVariants.map(v => {
      const explicitIds = v.selectedImageIds || getAutoSelectedImageIds(v.name, uploadedImages);
      const selectedImageIndexes = explicitIds
        .map(id => finalImagesToUpload.findIndex(img => img.id === id))
        .filter(idx => idx !== -1);
      return {
        name: v.name,
        quantity: v.quantity,
        selectedImageIndexes
      };
    });

    const payload = {
      config: psConfig,
      product: {
        title,
        sku,
        price,
        description_short: descShort,
        description: descLong, // Sent cleanly without embedded sklad or modelka
        sklad,
        modelka,
        variants: variantsPayload,
      },
      idCategories: selectedCategories,
      idCategoryDefault: defaultCategoryId,
      imagesBase64: imagesVal,
      imagesMimeTypes: mimesVal,
      imagesColors: colorsVal,
      imagesNames: namesVal
    };

    try {
      const response = await fetch("/api/prestashop/add-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data: ApiPublishResponse = await response.json();
      if (response.ok && data.success) {
        setSyncStatus({ success: true, productId: data.productId });
        
        // Add to history session
        const historyItem: HistoryItem = {
          id: Math.random().toString(36).substring(7),
          timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          image: selectedImage || "",
          productData: {
            title,
            sku,
            price,
            description_short: descShort,
            description: descLong,
            suggested_categories: analysisResult?.suggested_categories || []
          },
          status: "success",
          prestashopId: data.productId
        };
        setHistory(prev => [historyItem, ...prev]);
      } else {
        setSyncStatus({ error: data.error || "Ошибка экспорта в PrestaShop" });
        // Add log history as failed
        const historyItem: HistoryItem = {
          id: Math.random().toString(36).substring(7),
          timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          image: selectedImage || "",
          productData: { title, sku, price, description_short: descShort, description: descLong, suggested_categories: [] },
          status: "failed",
          error: data.error || "Unknown PrestaShop conflict"
        };
        setHistory(prev => [historyItem, ...prev]);
      }
    } catch (err: unknown) {
      setSyncStatus({ error: getErrorMessage(err) || "Сетевая ошибка при отправке запроса" });
    } finally {
      setIsSyncing(false);
    }
  };

  // Remove single history card
  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  // Clear entire history
  const clearHistory = () => {
    if (confirm("Вы уверены, что хотите очистить всю историю сессии?")) {
      setHistory([]);
    }
  };

  const handleStartEdit = (item: HistoryItem) => {
    setEditingItem(item);
    setEditTitle(item.productData.title || "");
    setEditSku(item.productData.sku || "");
    setEditPrice(item.productData.price || 0);
    setEditGrossPrice(item.productData.gross_price || (item.productData.price ? parseFloat((item.productData.price * (1 + vatRate / 100)).toFixed(2)) : 0));
    setEditSklad(item.productData.sklad || "");
    setEditModelka(item.productData.modelka || "");
    setEditDescShort(item.productData.description_short || "");
    setEditDescLong(item.productData.description || "");
    setUpdateStatus(null);
  };

  const handleSaveLocalChanges = () => {
    if (!editingItem) return;
    const updatedHistory = history.map(item => {
      if (item.id === editingItem.id) {
        return {
          ...item,
          productData: {
            ...item.productData,
            title: editTitle,
            sku: editSku,
            price: editPrice,
            gross_price: editGrossPrice,
            sklad: editSklad,
            modelka: editModelka,
            description_short: editDescShort,
            description: editDescLong
          }
        };
      }
      return item;
    });
    setHistory(updatedHistory);
    setEditingItem(null);
  };

  const handleLoadIntoWorkspace = () => {
    if (!editingItem) return;
    setTitle(editTitle);
    setSku(editSku);
    setPrice(editPrice);
    setGrossPrice(editGrossPrice);
    setSklad(editSklad);
    setModelka(editModelka);
    setDescShort(editDescShort);
    setDescLong(editDescLong);
    setEditingItem(null);
  };

  const handleUpdateInPrestaShop = async () => {
    if (!editingItem || !editingItem.prestashopId) return;
    setIsUpdatingPrestaShop(true);
    setUpdateStatus(null);
    try {
      const response = await fetch("/api/prestashop/update-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          config: psConfig,
          productId: editingItem.prestashopId,
          product: {
            title: editTitle,
            sku: editSku,
            price: editPrice,
            sklad: editSklad,
            modelka: editModelka,
            description_short: editDescShort,
            description: editDescLong
          }
        })
      });
      const data: { success?: boolean; error?: string } = await response.json();
      if (response.ok && data.success) {
        setUpdateStatus({ success: true });
        const updatedHistory = history.map(item => {
          if (item.id === editingItem.id) {
            return {
              ...item,
              productData: {
                ...item.productData,
                title: editTitle,
                sku: editSku,
                price: editPrice,
                gross_price: editGrossPrice,
                sklad: editSklad,
                modelka: editModelka,
                description_short: editDescShort,
                description: editDescLong
              }
            };
          }
          return item;
        });
        setHistory(updatedHistory);
      } else {
        setUpdateStatus({ error: data.error || "Не удалось обновить товар в PrestaShop" });
      }
    } catch (err: unknown) {
      setUpdateStatus({ error: getErrorMessage(err) || "Ошибка подключения к PrestaShop" });
    } finally {
      setIsUpdatingPrestaShop(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f6f7] font-sans text-[#202223] flex flex-col antialiased">
      {/* HEADER SECTION */}
      <header className="border-b border-[#e1e3e5] bg-white px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
        <div className="flex items-center space-x-3">
          <div className="bg-[#e1f0ea] p-2.5 rounded-lg shadow-sm flex items-center justify-center border border-[#c3e6dc]">
            <Sparkles className="w-5 h-5 text-[#008060] animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-[#202223] flex items-center gap-2">
              PrestaShop 8.2 AI Agent 
              <span className="text-[11px] bg-[#e1f0ea] text-[#006e52] font-mono px-2 py-0.5 rounded border border-[#b4dfd2]">v8.2 Opt</span>
            </h1>
            <p className="text-xs text-[#5c5f62]">Автоматический импорт и генерация товаров по фотографии</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Language Switcher */}
          <div className="bg-[#f1f2f4] border border-[#e1e3e5] p-1 rounded-lg flex items-center space-x-1">
            <button
              onClick={() => setDataLanguage("pl")}
              className={`text-xs px-2.5 py-1 rounded transition-all ${
                dataLanguage === "pl" 
                  ? "bg-white text-[#202223] font-semibold border border-[#babfc3] shadow-sm" 
                  : "text-[#5c5f62] hover:text-[#202223] border border-transparent"
              }`}
            >
              Polski 🇵🇱
            </button>
            <button
              onClick={() => setDataLanguage("ru")}
              className={`text-xs px-2.5 py-1 rounded transition-all ${
                dataLanguage === "ru" 
                  ? "bg-white text-[#202223] font-semibold border border-[#babfc3] shadow-sm" 
                  : "text-[#5c5f62] hover:text-[#202223] border border-transparent"
              }`}
            >
              Русский 🇷🇺
            </button>
          </div>

          {/* Quick Connection Indicator */}
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center space-x-2 text-xs px-3.5 py-2 rounded-lg transition-all border ${
              psConfig.apiKey 
                ? "bg-[#e1f0ea] text-[#006e52] border-[#b4dfd2] hover:bg-[#d0e9e0]" 
                : "bg-[#fff4e5] text-[#8a5b00] border-[#ffe0b2] hover:bg-[#ffe0b2]/45"
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${psConfig.apiKey ? "bg-[#008060] animate-ping" : "bg-amber-500"}`} />
            <span className="font-medium">{psConfig.apiKey ? "Настроен" : "Требуется настройка"}</span>
            <Settings className="w-3.5 h-3.5 ml-1 transition-transform hover:rotate-45" />
          </button>
        </div>
      </header>

      {/* GLOBAL SETTINGS POPDOWN */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={COLLAPSIBLE_INITIAL}
            animate={COLLAPSIBLE_ANIMATE}
            exit={COLLAPSIBLE_EXIT}
            className="bg-white border-b border-[#e1e3e5] p-6 overflow-hidden shadow-sm"
          >
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Sliders className="w-5 h-5 text-[#008060]" />
                  <h3 className="font-semibold text-[#202223]">Параметры интеграции PrestaShop Webservice</h3>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="text-xs text-[#5c5f62] hover:text-[#202223] underline"
                >
                  Закрыть настройки
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                  <label className="block text-xs font-semibold text-[#202223] mb-1.5">
                    Адрес сайта PrestaShop 8.2 (URL)
                  </label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-2.5 w-4.5 h-4.5 text-[#8c9196]" />
                    <input 
                      type="text" 
                      placeholder="https://prestashop.my-shop.com"
                      value={psConfig.shopUrl}
                      onChange={(e) => setPsConfig(prev => ({ ...prev, shopUrl: e.target.value }))}
                      className="w-full bg-white border border-[#babfc3] rounded-lg py-2 pl-10 pr-4 text-sm text-[#202223] placeholder-[#8c9196] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-all"
                    />
                  </div>
                  <p className="text-[10px] text-[#6d7175] mt-1">Основной URL вашего магазина.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#202223] mb-1.5">
                    Ключ Веб-службы (API Webservice Key)
                  </label>
                  <input 
                    type="password" 
                    placeholder="Например: ABCDEFGHIJKLM12345678"
                    value={psConfig.apiKey}
                    onChange={(e) => setPsConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                    className="w-full bg-white border border-[#babfc3] rounded-lg py-2 px-4 text-sm font-mono text-[#202223] placeholder-[#8c9196] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-all"
                  />
                  <p className="text-[10px] text-[#6d7175] mt-1">Должен иметь права на запись для products, images, categories.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#202223] mb-1.5">
                    ID Языка в базе данных (Language ID)
                  </label>
                  <input 
                    type="number" 
                    min="1"
                    value={psConfig.languageId}
                    onChange={(e) => setPsConfig(prev => ({ ...prev, languageId: parseInt(e.target.value, 10) || 1 }))}
                    className="w-full bg-white border border-[#babfc3] rounded-lg py-2 px-4 text-sm text-[#202223] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-all"
                  />
                  <p className="text-[10px] text-[#6d7175] mt-1">ID по умолчанию в PrestaShop: 1 (русский или ваш язык).</p>
                </div>
              </div>

              {/* Settings Action Buttons */}
              <div className="mt-5 pt-4 border-t border-[#e1e3e5]/65 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs text-[#5c5f62]">
                  <Info className="w-4 h-4 text-[#008060] shrink-0" />
                  <span>Веб-служба должна быть включена в меню: Настройки ➔ Расширенные параметры ➔ Веб-служба</span>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={fetchCategories}
                    className="text-xs bg-white border border-[#babfc3] hover:bg-[#f1f2f4] text-[#202223] py-2 px-3.5 rounded-lg transition-colors flex items-center space-x-1 font-medium shadow-sm"
                    disabled={isTestingConfig}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Обновить категории</span>
                  </button>

                  <button
                    onClick={handleTestConnection}
                    className="text-xs bg-[#008060] hover:bg-[#006e52] text-white font-medium py-2 px-5 rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm active:bg-[#005e46]"
                    disabled={isTestingConfig}
                  >
                    {isTestingConfig ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                    <span>Проверить соединение</span>
                  </button>
                </div>
              </div>

              {/* Testing Status Feedback message */}
              {configTestResult && (
                <div className={`mt-4 p-3 rounded-lg border text-xs flex items-start space-x-2 ${
                  configTestResult.success 
                    ? "bg-[#e1f0ea] text-[#006e52] border-[#b4dfd2]" 
                    : "bg-[#fbeae5] text-[#8a2512] border-[#f5c2b8]"
                }`}>
                  {configTestResult.success ? (
                    <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{configTestResult.message}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CORE CONTROL WORKSPACE */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: SOURCE (IMAGE AREA) - occupies 5 cols */}
        <section className="lg:col-span-12 xl:col-span-5 flex flex-col space-y-5">
          <div className="bg-white border border-[#e1e3e5] rounded-xl p-5 shadow-sm flex-1 flex flex-col">
            <h2 className="text-xs font-bold tracking-wider text-[#008060] uppercase mb-3.5 flex items-center space-x-1.5 border-b border-[#f1f2f4] pb-2.5">
              <Camera className="w-4 h-4 text-[#008060]" />
              <span>Источники фотографий</span>
            </h2>

            {/* Camera Frame View OR Drag-and-drop Image Area */}
            <div className="flex-1 flex flex-col">
              {isCameraActive ? (
                /* LIVE VIDEO STREAM AREA */
                <div className="relative rounded-lg overflow-hidden bg-black aspect-square flex flex-col justify-between border border-[#babfc3]">
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                  <div className="absolute top-3 right-3 bg-white/95 px-2.5 py-1 rounded-md text-[10px] font-semibold text-red-650 flex items-center space-x-1 border border-red-200 shadow-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                    <span>Камера включена</span>
                  </div>

                  <div className="absolute bottom-4 left-0 right-0 px-4 flex flex-col space-y-2.5 items-center bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-6 pb-2">
                    {/* Device Selector */}
                    {cameraDevices.length > 1 && (
                      <select
                        value={selectedCameraId}
                        onChange={(e) => {
                          setSelectedCameraId(e.target.value);
                          startCamera(e.target.value);
                        }}
                        className="bg-white text-xs text-[#202223] border border-[#babfc3] py-1 px-3 rounded-lg max-w-xs focus:outline-none focus:border-[#008060]"
                      >
                        {cameraDevices.map((dev, idx) => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.label || `Камера ${idx + 1}`}
                          </option>
                        ))}
                      </select>
                    )}

                    <div className="flex space-x-3 w-full justify-center">
                      <button
                        onClick={stopCamera}
                        className="bg-white hover:bg-[#f6f6f7] border border-[#babfc3] text-xs text-[#202223] font-medium py-2 px-4 rounded-lg transition-colors shadow-sm"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={capturePhoto}
                        className="bg-[#008060] hover:bg-[#006e52] text-xs text-white font-semibold py-2 px-6 rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm active:bg-[#005e46]"
                      >
                        <Camera className="w-4 h-4" />
                        <span>Сделать снимок</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* DROPDOWN OR SELECTED PREVIEW AREA */
                <div 
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  className={`flex-1 rounded-lg flex flex-col justify-center items-center transition-all aspect-square border-2 ${dropzoneClass(!!selectedImage, dragActive)} relative overflow-hidden`}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={(e) => e.target.files && handleMultipleFiles(e.target.files)}
                    className="hidden" 
                    accept="image/*"
                    multiple
                  />

                  {selectedImage ? (
                    /* RENDER SOURCE IMAGE */
                    <div className="w-full h-full relative group bg-[#fafbfa]">
                      <img 
                        src={selectedImage} 
                        alt="Product source preview" 
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-3 right-3 flex space-x-2 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            const left = uploadedImages.filter(item => item.base64 !== selectedImage);
                            setUploadedImages(left);
                            if (left.length > 0) {
                              const leftSorted = sortImagesByColorAndOrder(left);
                              setSelectedImage(leftSorted[0].base64);
                              setImageMime(leftSorted[0].mimeType);
                            } else {
                              setSelectedImage(null);
                            }
                          }}
                          className="bg-white border border-[#e1e3e5] text-[#202223] hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 p-2 rounded-lg transition-all shadow-sm"
                          title="Удалить фото"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* EMPTY PLACEHOLDER - NO PHOTO EXTRACTED */
                    <div className="p-6 text-center flex flex-col items-center space-y-4 max-w-sm">
                      <div className="bg-[#f1f8f5] border border-[#c3e6dc] p-4 rounded-full text-[#008060]">
                        <Upload className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#202223]">Перетащите сюда фото товара</p>
                        <p className="text-xs text-[#5c5f62] mt-1.5 leading-relaxed">или выберите один из вариантов ниже для мгновенной загрузки (поддерживается мульти-загрузка)</p>
                      </div>

                      <div className="flex space-x-2.5 pt-2">
                        <button 
                          onClick={handleFileSelectBtn}
                          className="bg-white hover:bg-[#f6f6f7] border border-[#babfc3] text-[#202223] text-xs font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
                        >
                          <Upload className="w-3.5 h-3.5 inline mr-1" />
                          <span>Обзор файлов</span>
                        </button>
                        <button 
                          onClick={() => startCamera()}
                          className="bg-[#008060] hover:bg-[#006e52] text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm active:bg-[#005e46]"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Веб-камера</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* MUTLI-IMAGE THUMBNAIL GALLERY */}
              {uploadedImages.length > 0 && (
                <div className="mt-4 p-3.5 bg-[#fafbfa] border border-[#e1e3e5] rounded-xl shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                  <p className="text-[11px] font-bold text-[#5c5f62] mb-2 px-0.5 uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span>Галерея товара ({uploadedImages.length})</span>
                      {showClearConfirm ? (
                        <span className="flex items-center gap-1 font-sans ml-2 lowercase normal-case">
                          <span className="text-[10px] text-rose-600 font-semibold">Удалить все?</span>
                          <button
                            onClick={() => {
                              setUploadedImages([]);
                              setSelectedImage(null);
                              setShowClearConfirm(false);
                            }}
                            className="bg-rose-600 hover:bg-rose-700 text-white font-sans font-semibold text-[9px] px-2 py-0.5 rounded cursor-pointer transition-all"
                          >
                            Да
                          </button>
                          <button
                            onClick={() => setShowClearConfirm(false)}
                            className="bg-white border border-[#babfc3] text-[#202223] hover:bg-[#f6f6f7] font-sans font-medium text-[9px] px-2 py-0.5 rounded cursor-pointer transition-all"
                          >
                            Нет
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setShowClearConfirm(true)}
                          className="ml-2 text-rose-600 hover:text-rose-700 font-sans font-bold text-[9px] uppercase bg-rose-50 hover:bg-rose-100 px-1.5 py-0.5 rounded transition-all border border-rose-200 cursor-pointer"
                        >
                          очистить всё
                        </button>
                      )}
                    </span>
                    <span className="text-[10px] text-[#8c9196] font-normal lowercase">кликните для выбора главного фото, перетащите для изменения порядка</span>
                  </p>
                  <div className="grid grid-cols-5 gap-2">
                    {sortedImages.map((img, idx) => {
                      const isActive = img.base64 === selectedImage;
                      const isDragged = idx === draggedIdx;
                      return (
                        <div
                          key={img.id}
                          draggable
                          onDragStart={(e) => handleDragStartItem(e, idx)}
                          onDragOver={(e) => handleDragOverItem(e, idx)}
                          onDrop={(e) => handleDropItem(e, idx)}
                          onDragEnd={handleDragEndItem}
                          onClick={() => {
                            setSelectedImage(img.base64);
                            setImageMime(img.mimeType);
                          }}
                          className={`aspect-square rounded-lg relative overflow-hidden group cursor-grab active:cursor-grabbing border bg-white transition-all ${
                            isDragged ? "opacity-40 scale-95 border-dashed border-[#008060]" : ""
                          } ${
                            isActive 
                              ? "border-[#008060] ring-2 ring-[#008060]/20 shadow-sm" 
                              : "border-[#e1e3e5] hover:border-[#babfc3]"
                          }`}
                        >
                          <img 
                            src={img.base64} 
                            alt="" 
                            className="w-full h-full object-cover" 
                            referrerPolicy="no-referrer"
                          />

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const left = uploadedImages.filter(item => item.id !== img.id);
                              setUploadedImages(left);
                              if (isActive) {
                                  if (left.length > 0) {
                                    const leftSorted = sortImagesByColorAndOrder(left);
                                    setSelectedImage(leftSorted[0].base64);
                                    setImageMime(leftSorted[0].mimeType);
                                  } else {
                                    setSelectedImage(null);
                                  }
                              }
                            }}
                            className="absolute top-1 right-1 bg-white hover:bg-rose-600 border border-slate-200 hover:border-rose-600 rounded p-1 text-slate-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100 z-10 shadow-sm"
                            title="Убрать"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                          {isActive && (
                            <div className="absolute bottom-0 left-0 right-0 bg-[#008060] text-[8px] text-white font-extrabold text-center py-0.5">
                              {idx === 0 ? "ОБЛОЖКА" : "АКТИВНО"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button
                      onClick={handleFileSelectBtn}
                      className="aspect-square bg-white rounded-lg flex flex-col items-center justify-center text-[#5c5f62] hover:text-[#008060] hover:bg-[#f1f8f5] border border-[#babfc3] hover:border-[#008060] border-dashed transition-all shadow-sm"
                    >
                      <Plus className="w-4 h-4 text-[#5c5f62]" />
                      <span className="text-[8px] mt-1 font-bold uppercase">Еще</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* TRIGGER AI ANALYSIS TRIGGER ZONE */}
            <div className="mt-4 pt-4 border-t border-[#f1f2f4] flex flex-col space-y-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#202223] flex items-center justify-between">
                  <span>Дополнительные инструкции для ИИ</span>
                  <span className="text-[10px] text-[#8c9196] font-normal">укажите, что именно нужно проанализировать</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Пример: Обрати внимание на материал, вырез, фасон или другие детали..."
                  value={userHint}
                  onChange={(e) => setUserHint(e.target.value)}
                  className="w-full bg-white border border-[#babfc3] rounded-lg p-2.5 text-xs text-[#202223] placeholder-[#8c9196] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors resize-none"
                />
              </div>

              <button
                disabled={!selectedImage || isAnalyzing}
                onClick={analyzeImage}
                className={`w-full py-3.5 rounded-lg text-sm font-semibold flex items-center justify-center space-x-2 transition-all ${primaryActionButtonClass(!selectedImage, isAnalyzing)}`}
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#008060]" />
                    <span>Gemini GPT анализирует фото...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Анализировать фото по AI</span>
                  </>
                )}
              </button>

              {analysisError && (
                <div className="p-3.5 bg-[#fbeae5] border border-[#f5c2b8] rounded-lg text-xs text-[#8a2512] flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{analysisError}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: AI GENERATED EDITOR & PRESTASHOP METADATA WRITER - occupies 7 cols */}
        <section className="lg:col-span-12 xl:col-span-7 flex flex-col space-y-5">
          <div className="bg-white border border-[#e1e3e5] rounded-xl p-5 shadow-sm flex-1 flex flex-col">
            <h2 className="text-xs font-bold tracking-wider text-[#008060] uppercase mb-4 flex items-center space-x-1.5 justify-between border-b border-[#f1f2f4] pb-2.5">
              <div className="flex items-center space-x-1.5">
                <FileText className="w-4 h-4 text-[#008060]" />
                <span>Редактор AI Метаданных товара</span>
              </div>
              {analysisResult && (
                <span className="text-[10px] bg-[#e1f0ea] border border-[#b4dfd2] px-2 py-0.5 rounded text-[#006e52] font-mono tracking-normal font-semibold">
                  Определено ИИ
                </span>
              )}
            </h2>

            {/* FORM FIELD INPUTS */}
            <div className="flex-1 space-y-4">
              {/* Product Name */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-[#202223]">
                    Название товара (Title) *
                  </label>
                  <button
                    disabled={isGeneratingField.title || !selectedImage}
                    onClick={(e) => { e.preventDefault(); handleGenerateFieldWithAI("title"); }}
                    className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded font-semibold border transition-all ${fieldGenerateButtonClass(isGeneratingField.title, !selectedImage)}`}
                  >
                    {isGeneratingField.title ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-[#008060]" />
                        <span>Генерирую...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-2.5 h-2.5 text-[#008060]" />
                        <span>Сгенерировать ИИ</span>
                      </>
                    )}
                  </button>
                </div>
                <input 
                  type="text" 
                  placeholder="Добавьте фото или укажите название..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-white border border-[#babfc3] rounded-lg py-2 px-3 text-sm text-[#202223] placeholder-[#8c9196] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors"
                />
              </div>

              {/* SKU & Price in 2 column row */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-4">
                  <label className="block text-xs font-semibold text-[#202223] mb-1.5">
                    Артикул / SKU (Reference)
                  </label>
                  <input 
                    type="text" 
                    placeholder="Генерируется по ИИ"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full bg-white border border-[#babfc3] rounded-lg py-2 px-3 text-sm font-mono text-[#202223] placeholder-[#8c9196] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors"
                  />
                </div>

                <div className="md:col-span-8">
                  <span className="block text-xs font-semibold text-[#202223] mb-1.5">
                    Калькулятор цены (Розничная цена)
                  </span>
                  
                  <div className="grid grid-cols-3 gap-2.5 bg-[#f9fafb] p-2.5 border border-[#e1e3e5] rounded-lg">
                    {/* Price Netto */}
                    <div>
                      <label className="block text-[10px] font-semibold text-[#5c5f62] mb-1">
                        Cena netto
                      </label>
                      <div className="relative">
                        <span className="absolute left-2.5 text-[10px] select-none text-[#8c9196] font-bold top-1.5">
                          {dataLanguage === "pl" ? "zł" : "₽"}
                        </span>
                        <input 
                          type="number" 
                          step="0.01" 
                          placeholder="0.00"
                          value={price || ""}
                          onChange={(e) => handleNetPriceChange(parseFloat(e.target.value) || 0)}
                          className="w-full bg-white border border-[#babfc3] rounded py-1 pl-6 pr-1 text-xs text-[#202223] focus:outline-none focus:border-[#008060] font-mono transition-colors"
                        />
                      </div>
                    </div>

                    {/* VAT Rate */}
                    <div>
                      <label className="block text-[10px] font-semibold text-[#5c5f62] mb-1">
                        VAT (Podatek)
                      </label>
                      <select
                        value={vatRate}
                        onChange={(e) => handleVatRateChange(parseInt(e.target.value, 10))}
                        className="w-full bg-white border border-[#babfc3] rounded py-1 px-1.5 text-[#202223] text-[10px] focus:outline-none focus:border-[#008060]"
                      >
                        <option value={23}>PL 23%</option>
                        <option value={8}>PL 8%</option>
                        <option value={5}>PL 5%</option>
                        <option value={20}>RU 20%</option>
                        <option value={0}>0% VAT</option>
                      </select>
                    </div>

                    {/* Price Brutto */}
                    <div>
                      <label className="block text-[10px] font-semibold text-[#5c5f62] mb-1">
                        Cena brutto
                      </label>
                      <div className="relative">
                        <span className="absolute left-2.5 text-[10px] select-none text-[#008060] font-bold top-1.5">
                          {dataLanguage === "pl" ? "zł" : "₽"}
                        </span>
                        <input 
                          type="number" 
                          step="0.01" 
                          placeholder="0.00"
                          value={grossPrice || ""}
                          onChange={(e) => handleGrossPriceChange(parseFloat(e.target.value) || 0)}
                          className="w-full bg-white border border-[#008060] rounded py-1 pl-6 pr-1 text-xs text-[#008060] focus:outline-none focus:ring-1 focus:ring-[#008060] font-mono font-bold transition-colors"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* APPAREL SPECIAL FEATURES SECTION */}
              <div className="bg-[#f9fafb] border border-[#e1e3e5] rounded-lg p-4 space-y-3 shadow-[inset_0_1px_1px_rgba(0,0,0,0.01)]">
                <p className="text-xs font-bold text-[#008060] uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-[#008060]" />
                  <span>Характеристики товара и модель (Cechy)</span>
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1">
                      SKŁAD (Материал / Состав)
                    </label>
                    <input 
                      type="text"
                      placeholder="Например: 100% LEN / 100% Cotton"
                      value={sklad}
                      onChange={(e) => setSklad(e.target.value.toUpperCase())}
                      className="w-full bg-white border border-[#babfc3] rounded-md py-1.5 px-3 text-xs text-[#202223] uppercase focus:outline-none focus:border-[#008060] font-bold transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1">
                      MODELKA (Параметры модели)
                    </label>
                    <input 
                      type="text"
                      placeholder="Например: MA 175 CM WZROSTU I NOSI ROZMIAR S"
                      value={modelka}
                      onChange={(e) => setModelka(e.target.value.toUpperCase())}
                      className="w-full bg-white border border-[#babfc3] rounded-md py-1.5 px-3 text-xs text-[#202223] uppercase focus:outline-none focus:border-[#008060] font-bold transition-colors"
                    />
                  </div>
                </div>

                {/* Dynamic Combinations Editor */}
                <div className="pt-3 border-t border-[#e1e3e5] space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-[#202223] flex items-center space-x-1">
                      <Layers className="w-3.5 h-3.5 text-[#008060]" />
                      <span>Комбинации / Варианты Товара ({suggestedVariants.length})</span>
                    </label>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        const value = prompt("Введите новую комбинацию (например: Kolor: Różowy, Rozmiar: UNIWERSALNY):", "Kolor: Szary, Rozmiar: UNIWERSALNY");
                        if (value && value.trim()) {
                          setSuggestedVariants(prev => [...prev, { 
                            name: value.trim(), 
                            quantity: 0, 
                            selectedImageIds: getAutoSelectedImageIds(value.trim(), uploadedImages) 
                          }]);
                        }
                      }}
                      className="text-[10px] bg-white hover:bg-[#f6f6f7] border border-[#babfc3] text-[#202223] py-1.5 px-3 rounded-lg flex items-center space-x-1 transition-all shadow-sm font-semibold hover:border-[#8c9196]"
                    >
                      <Plus className="w-3 h-3 text-[#008060]" />
                      <span>Добавить вариант</span>
                    </button>
                  </div>
                  
                  {suggestedVariants.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto p-1 bg-white rounded-lg border border-[#e1e3e5] custom-scrollbar">
                      {suggestedVariants.map((v, i) => (
                        <div 
                          key={`${v.name || "variant"}-${i}`} 
                          className="flex flex-col p-2.5 rounded-lg bg-[#f9fafb] border border-[#e1e3e5] hover:border-[#babfc3] transition-all text-xs gap-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <span className="font-mono text-[#202223] block truncate font-semibold" title={v.name}>
                                {v.name}
                              </span>
                            </div>
                            <div className="flex items-center space-x-1.5 shrink-0 bg-white px-2 py-0.5 rounded border border-[#babfc3]">
                              <span className="text-[10px] text-[#5c5f62] uppercase tracking-wider font-semibold">кол-во</span>
                              <input
                                type="number"
                                min="0"
                                value={v.quantity}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? 0 : parseInt(e.target.value, 10) || 0;
                                  setSuggestedVariants(prev => prev.map((item, idx) => idx === i ? { ...item, quantity: val } : item));
                                }}
                                className="w-10 bg-transparent text-center font-mono text-xs text-[#008060] focus:outline-none font-bold"
                              />
                            </div>
                            <button 
                              onClick={(e) => { 
                                e.preventDefault(); 
                                setSuggestedVariants(prev => prev.filter((_, idx) => idx !== i)); 
                              }}
                              className="text-[#6d7175] hover:text-rose-600 shrink-0 p-1 rounded hover:bg-rose-50 transition-all border border-transparent hover:border-rose-100"
                              title="Удалить комбинацию"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Interactive list of uploaded photos to link them */}
                          {uploadedImages.length > 0 && (
                            <div className="border-t border-[#e1e3e5] pt-2">
                              <div className="flex items-center justify-between text-[10px] text-[#5c5f62] mb-1.5">
                                <span className="font-medium">Выберите фото для этого цвета:</span>
                                <span className="font-bold text-[#008060]">
                                  {(() => {
                                    const explicitIds = v.selectedImageIds || getAutoSelectedImageIds(v.name, uploadedImages);
                                    return `активно ${explicitIds.length} из ${uploadedImages.length}`;
                                  })()}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {sortedImages.map((img) => {
                                  const explicitIds = v.selectedImageIds || getAutoSelectedImageIds(v.name, uploadedImages);
                                  const isSelected = explicitIds.includes(img.id);
                                  
                                  return (
                                    <button
                                      key={img.id}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        const currentSelected = v.selectedImageIds || getAutoSelectedImageIds(v.name, uploadedImages);
                                        let newSelected: string[];
                                        if (currentSelected.includes(img.id)) {
                                          newSelected = currentSelected.filter(id => id !== img.id);
                                        } else {
                                          newSelected = [...currentSelected, img.id];
                                        }
                                        setSuggestedVariants(prev => prev.map((item, idx) => idx === i ? { 
                                          ...item, 
                                          selectedImageIds: newSelected,
                                          isCustomPhotoSelection: true 
                                        } : item));
                                      }}
                                      className={`relative w-8 h-8 rounded overflow-hidden border-2 transition-all hover:scale-105 active:scale-95 ${
                                        isSelected 
                                          ? "border-[#008060] shadow-sm ring-1 ring-[#008060]" 
                                          : "border-transparent opacity-45 hover:opacity-75"
                                      }`}
                                      title={img.fileName || "Изображение"}
                                    >
                                      <img 
                                        src={img.base64} 
                                        alt="" 
                                        className="w-full h-full object-cover"
                                        referrerPolicy="no-referrer"
                                      />
                                      {isSelected && (
                                        <div className="absolute inset-0 bg-[#008060]/10 flex items-center justify-center">
                                          <div className="w-2 h-2 rounded-full bg-[#008060] border border-white animate-pulse" />
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-[#fafbfa] rounded-lg border border-dashed border-[#e1e3e5] text-[11px] text-[#8c9196] text-center">
                      Нет активных комбинаций. Товар будет импортирован как один базовый продукт.
                    </div>
                  )}
                </div>
              </div>

              {/* Short description */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-[#202223]">
                    Краткое описание (Short Description)
                  </label>
                  <button
                    disabled={isGeneratingField.description_short || !selectedImage}
                    onClick={(e) => { e.preventDefault(); handleGenerateFieldWithAI("description_short"); }}
                    className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded font-semibold border transition-all ${fieldGenerateButtonClass(isGeneratingField.description_short, !selectedImage)}`}
                  >
                    {isGeneratingField.description_short ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-[#008060]" />
                        <span>Генерирую...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-2.5 h-2.5 text-[#008060]" />
                        <span>Сгенерировать ИИ</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea 
                  rows={2}
                  placeholder="Короткий слоган или тизер для списков..."
                  value={descShort}
                  onChange={(e) => setDescShort(e.target.value)}
                  className="w-full bg-white border border-[#babfc3] rounded-lg py-2 px-3 text-sm text-[#202223] placeholder-[#8c9196] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors resize-none"
                />
              </div>

              {/* Long Description with HTML support */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-[#202223] flex items-center space-x-1.5">
                    <span>Полное подробное описание (Description HTML)</span>
                    <span className="text-[10px] text-[#5c5f62] flex items-center space-x-1 font-normal">
                      <Eye className="w-3 h-3 text-[#5c5f62]" />
                      <span>HTML-верстка</span>
                    </span>
                  </label>
                  <button
                    disabled={isGeneratingField.description || !selectedImage}
                    onClick={(e) => { e.preventDefault(); handleGenerateFieldWithAI("description"); }}
                    className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded font-semibold border transition-all ${fieldGenerateButtonClass(isGeneratingField.description, !selectedImage)}`}
                  >
                    {isGeneratingField.description ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-[#008060]" />
                        <span>Генерирую...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-2.5 h-2.5 text-[#008060]" />
                        <span>Сгенерировать ИИ</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea 
                  rows={4}
                  placeholder="Детальные свойства, преимущества, спецификации продукта..."
                  value={descLong}
                  onChange={(e) => setDescLong(e.target.value)}
                  className="w-full bg-white border border-[#babfc3] rounded-lg py-2.5 px-4 text-xs font-mono text-[#202223] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors"
                />
              </div>

              {/* Dynamic Categories Mapping from Server */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#202223] flex items-center justify-between">
                  <span>Категории Продукта в PrestaShop</span>
                  {isLoadingCategories && <Loader2 className="w-3 h-3 animate-spin text-[#008060]" />}
                </label>

                {psCategories.length > 0 ? (
                  <>
                    <div className="bg-white border border-[#e1e3e5] rounded-xl p-3 max-h-48 overflow-y-auto space-y-1.5 custom-scrollbar">
                      {psCategories.map((c) => {
                        const isChecked = selectedCategories.includes(c.id);
                        const nameLower = c.name.toLowerCase();
                        const isDefaultLabel = nameLower.includes("wszystkie") || nameLower.includes("nowa") || nameLower.includes("главная") || nameLower.includes("home") || c.id === 2;
                        
                        return (
                          <label 
                            key={c.id} 
                            className={`flex items-center space-x-2.5 p-2 rounded-lg cursor-pointer transition-all border ${
                              isChecked 
                                ? "bg-[#f1f8f5] border-[#c3e6dc] text-[#006e52]" 
                                : "border-transparent text-[#5c5f62] hover:bg-[#f6f6f7] hover:text-[#202223]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isDefaultLabel}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedCategories(prev => prev.filter(id => id !== c.id));
                                } else {
                                  setSelectedCategories(prev => [...prev, c.id]);
                                }
                              }}
                              className="rounded border-[#babfc3] text-[#008060] focus:ring-[#008060]/30 w-4 h-4 shrink-0 transition-all checked:bg-[#008060]"
                            />
                            <span className="text-xs font-semibold flex items-center justify-between w-full">
                              <span>{c.name}</span>
                              <span className="text-[10px] text-[#8c9196] font-mono">
                                ID {c.id} {isDefaultLabel && <span className="text-[#008060] font-sans font-normal ml-1">(Всегда выбран)</span>}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    {/* Default Category Selector */}
                    {selectedCategories.length > 0 && (
                      <div className="mt-3 space-y-1.5 bg-[#f9fafb] border border-[#e1e3e5] p-3 rounded-lg block">
                        <label className="block text-xs font-bold text-[#202223]">
                          {dataLanguage === "pl" ? "Domyślna kategoria" : "Основная категория (Domyślna kategoria)"}
                        </label>
                        <select
                          value={defaultCategoryId || ""}
                          onChange={(e) => setDefaultCategoryId(parseInt(e.target.value, 10))}
                          className="w-full bg-white border border-[#babfc3] rounded-lg py-1.5 px-3 text-xs text-[#202223] focus:outline-none focus:border-[#008060] transition-colors"
                        >
                          {selectedPsCategories.map((c) => (
                            <option key={c.id} value={c.id} className="bg-white text-[#202223] text-xs">
                              {c.name} (ID {c.id})
                            </option>
                          ))}
                        </select>
                        <p className="text-[10px] text-[#5c5f62]">
                          {dataLanguage === "pl" 
                            ? "Wybierz główną kategorię, w której ma znajdować się produkt."
                            : "Выберите главную категорию, в которой будет находиться созданный товар."}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="p-3 bg-white rounded-lg border border-[#e1e3e5] text-xs text-[#5c5f62] flex items-center justify-between">
                    <span>
                      {categoryLoadError 
                        ? "Не удалось загрузить категории. Проверьте соединение." 
                        : "Категории магазина еще не сопряжены (по умолчанию: Главная [ID 2])"}
                    </span>
                    <button 
                      onClick={(e) => { e.preventDefault(); setShowSettings(true); }}
                      className="text-[#008060] hover:underline font-bold ml-2 shrink-0"
                    >
                      Настроить
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* SYNC OPERATION CONTROLLER SECTION */}
            <div className="mt-5 pt-4 border-t border-[#f1f2f4] flex flex-col space-y-3">
              <button
                disabled={!title || isSyncing}
                onClick={publishProduct}
                className={`w-full py-4 rounded-lg text-sm font-semibold flex items-center justify-center space-x-1.5 transition-all ${primaryActionButtonClass(!title, isSyncing)}`}
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#008060] mr-1" />
                    <span>Синхронизация и загрузка фото в PrestaShop...</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4" />
                    <span>Опубликовать новый товар в PrestaShop 8.2</span>
                  </>
                )}
              </button>

              {/* SYNC FEEDBACK BANNER */}
              {syncStatus && (
                <div className={`p-4 rounded-lg border text-xs ${
                  syncStatus.success 
                    ? "bg-[#e1f0ea] text-[#006e52] border-[#b4dfd2]" 
                    : "bg-[#fbeae5] text-[#8a2512] border-[#f5c2b8]"
                }`}>
                  {syncStatus.success ? (
                    <div className="flex items-start space-x-2">
                      <CheckCircle className="w-4 h-4 text-[#008060] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-[#006e52]">Товар успешно создан!</p>
                        <p className="text-[#202223] mt-0.5">Внесен в базу данных PrestaShop с назначенным ID: <strong>#{syncStatus.productId}</strong>.</p>
                        <p className="text-[#5c5f62] text-[10px] mt-1">Фотография товара автоматически прикреплена и загружена во внутренние медиа магазина.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start space-x-2">
                      <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-rose-800">Ошибка импорта в магазин</p>
                        <p className="text-[#202223] mt-1">Причина: {syncStatus.error}</p>
                        <p className="text-[10px] text-[#5c5f62] mt-1">Возможно, неверно указан ID языка или у API-ключа отсутствуют разрешения каталога.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

      </main>

      {/* SESSION TIMELINE/HISTORY FOOTER PANEL */}
      <footer className="border-t border-[#e1e3e5] bg-white px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <BarChart className="w-4.5 h-4.5 text-[#008060]" />
              <h2 className="text-sm font-bold text-[#202223]">Лента активности текущей сессии ({history.length})</h2>
            </div>
            {history.length > 0 && (
              <button 
                onClick={clearHistory}
                className="text-xs text-rose-600 hover:text-rose-700 bg-white border border-[#babfc3] hover:bg-rose-50 px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 font-semibold hover:border-rose-300"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                <span>Очистить сессию</span>
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-[#babfc3] rounded-xl bg-[#fafbfa] text-xs text-[#6d7175]">
              Вы еще не опубликовали товары в этой сессии. Загрузите фото и нажмите «Анализировать» для старта.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {history.map((item) => (
                <div 
                  key={item.id} 
                  className={`bg-white border rounded-xl overflow-hidden shadow-sm flex p-3.5 relative items-center space-x-3.5 hover:shadow-md transition-shadow ${
                    item.status === "success" ? "border-[#b4dfd2]" : "border-rose-100"
                  }`}
                >
                  {/* Small preview */}
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-[#fafbfa] flex-shrink-0 border border-[#e1e3e5]">
                    {item.image ? (
                      <img 
                        src={item.image} 
                        alt="" 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#8c9196] bg-[#f9fafb]">
                        <Camera className="w-4 h-4" />
                      </div>
                    )}
                  </div>

                  {/* Text properties */}
                  <div className="flex-1 min-w-0 pr-6">
                    <p className="text-xs font-bold text-[#202223] truncate">{item.productData.title}</p>
                    <p className="text-[10px] text-[#5c5f62] flex items-center space-x-1.5 mt-0.5">
                      <span>REF:</span> 
                      <span className="font-mono text-[#008060] font-semibold">{item.productData.sku || "N/A"}</span>
                      <span>•</span>
                      <span>Цена:</span>
                      <span className="text-[#202223] font-bold font-mono">{item.productData.price || 0} {dataLanguage === "pl" ? "zł" : "₽"}</span>
                    </p>

                    <div className="flex items-center space-x-1.5 mt-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                        item.status === "success" 
                          ? "bg-[#e1f0ea] text-[#006e52] border-[#b4dfd2]" 
                          : "bg-[#fbeae5] text-[#8a2512] border-[#f5c2b8]"
                      }`}>
                        {item.status === "success" ? `PrestaShop ID #${item.prestashopId}` : "Ошибка загрузки"}
                      </span>
                      <span className="text-[9px] text-[#8c9196] font-mono">{item.timestamp}</span>
                    </div>
                  </div>

                  {/* Action buttons inside the card */}
                  <div className="absolute top-2 right-2 flex items-center space-x-1.5">
                    {/* Edit button */}
                    <button 
                      onClick={() => handleStartEdit(item)}
                      className="text-[#5c5f62] hover:text-[#008060] p-1 rounded-md transition-colors bg-[#f6f6f7] hover:bg-[#e1f0ea]"
                      title="Редактировать товар"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {/* Delete button */}
                    <button 
                      onClick={() => deleteHistoryItem(item.id)}
                      className="text-[#5c5f62] hover:text-rose-600 p-1 rounded-md transition-colors bg-[#f6f6f7] hover:bg-rose-50"
                      title="Убрать лог"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </footer>

      {/* EDITING ITEM GALLERY MODAL */}
      <AnimatePresence>
        {editingItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#202223]/60 backdrop-blur-sm">
            <motion.div 
              initial={MODAL_INITIAL}
              animate={MODAL_ANIMATE}
              exit={MODAL_EXIT}
              className="bg-white border border-[#e1e3e5] rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl"
            >
              {/* Modal Header */}
              <div className="border-b border-[#f1f2f4] px-6 py-4 flex items-center justify-between bg-white">
                <div className="flex items-center space-x-2">
                  <Pencil className="w-4 h-4 text-[#008060]" />
                  <h3 className="font-bold text-[#202223] text-sm">Редактирование товара в галерее</h3>
                </div>
                <button 
                  onClick={() => setEditingItem(null)}
                  className="text-[#5c5f62] hover:text-[#202223] p-1.5 rounded-lg hover:bg-[#f6f6f7]"
                >
                  <XCircle className="w-5 h-5 text-[#5c5f62]" />
                </button>
              </div>

              {/* Modal scrollable body */}
              <div className="p-6 overflow-y-auto space-y-4 max-h-[calc(90vh-140px)] bg-white">
                {/* Product image and basic status */}
                <div className="flex items-center space-x-4 bg-[#f9fafb] p-3 rounded-lg border border-[#e1e3e5]">
                  <div className="w-16 h-16 rounded overflow-hidden bg-white flex-shrink-0 border border-[#e1e3e5]">
                    {editingItem.image ? (
                      <img src={editingItem.image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#8c9196] bg-[#fafbfa]">
                        <Camera className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div>
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                      editingItem.status === "success" 
                        ? "bg-[#e1f0ea] border-[#b4dfd2] text-[#006e52]" 
                        : "bg-[#fafbfa] border-[#e1e3e5] text-[#5c5f62]"
                    }`}>
                      {editingItem.status === "success" ? `PrestaShop ID: #${editingItem.prestashopId}` : "Локальный черновик"}
                    </span>
                    <p className="text-xs text-[#5c5f62] mt-1">Опубликован: {editingItem.timestamp}</p>
                  </div>
                </div>

                {/* Main Fields Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Title */}
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1.5">Название товара</label>
                    <input 
                      type="text" 
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full bg-white border border-[#babfc3] rounded-lg px-3.5 py-2 text-sm text-[#202223] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors"
                    />
                  </div>

                  {/* SKU */}
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1.5">Артикул (SKU)</label>
                    <input 
                      type="text" 
                      value={editSku}
                      onChange={(e) => setEditSku(e.target.value)}
                      className="w-full bg-white border border-[#babfc3] rounded-lg px-3.5 py-2 text-sm text-[#202223] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors"
                    />
                  </div>

                  {/* Pricing Fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1.5">Цена (без НДС)</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={editPrice}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setEditPrice(val);
                          setEditGrossPrice(parseFloat((val * (1 + vatRate / 100)).toFixed(2)));
                        }}
                        className="w-full bg-white border border-[#babfc3] rounded-lg px-3 py-2 text-sm text-[#202223] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1.5">Цена (с НДС)</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={editGrossPrice}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setEditGrossPrice(val);
                          setEditPrice(parseFloat((val / (1 + vatRate / 100)).toFixed(2)));
                        }}
                        className="w-full bg-white border border-[#008060] rounded-lg px-3 py-2 text-sm text-[#008060] focus:outline-none focus:ring-1 focus:ring-[#008060] transition-colors font-semibold"
                      />
                    </div>
                  </div>

                  {/* Composition / Sklad */}
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1.5">Состав ткани (Skład)</label>
                    <input 
                      type="text" 
                      value={editSklad}
                      onChange={(e) => setEditSklad(e.target.value)}
                      placeholder="Например, 100% лен"
                      className="w-full bg-white border border-[#babfc3] rounded-lg px-3.5 py-2 text-sm text-[#202223] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors"
                    />
                  </div>

                  {/* Model specifications */}
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1.5">Информация о модели</label>
                    <input 
                      type="text" 
                      value={editModelka}
                      onChange={(e) => setEditModelka(e.target.value)}
                      placeholder="Например, Рост 175 см, размер S"
                      className="w-full bg-white border border-[#babfc3] rounded-lg px-3.5 py-2 text-sm text-[#202223] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors"
                    />
                  </div>

                  {/* Description Short */}
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1.5">Краткое описание</label>
                    <textarea 
                      value={editDescShort}
                      onChange={(e) => setEditDescShort(e.target.value)}
                      rows={2}
                      className="w-full bg-white border border-[#babfc3] rounded-lg px-3.5 py-2 text-xs text-[#202223] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors font-sans"
                    />
                  </div>

                  {/* Description Long */}
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-[#5c5f62] mb-1.5">Полное описание</label>
                    <textarea 
                      value={editDescLong}
                      onChange={(e) => setEditDescLong(e.target.value)}
                      rows={5}
                      className="w-full bg-white border border-[#babfc3] rounded-lg px-3.5 py-2 text-xs text-[#202223] focus:outline-none focus:border-[#008060] focus:ring-1 focus:ring-[#008060] transition-colors font-sans"
                    />
                  </div>
                </div>

                {/* Remote database sync notifications */}
                {updateStatus && (
                  <div className={`p-4 rounded-lg border text-xs ${
                    updateStatus.success 
                      ? "bg-[#e1f0ea] text-[#006e52] border-[#b4dfd2]" 
                      : "bg-[#fbeae5] text-[#8a2512] border-[#f5c2b8]"
                  }`}>
                    {updateStatus.success ? (
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="w-4 h-4 shrink-0 text-[#008060]" />
                        <span className="font-semibold">Товар успешно обновлен непосредственно на сервере PrestaShop и зафиксирован локально!</span>
                      </div>
                    ) : (
                      <div className="flex items-start space-x-2">
                        <XCircle className="w-4 h-4 shrink-0 text-[#8a2512] mt-0.5" />
                        <div>
                          <p className="font-bold">Ошибка обновления в магазине</p>
                          <p className="text-[11px] text-[#202223] mt-0.5">{updateStatus.error}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer Controls */}
              <div className="border-t border-[#f1f2f4] px-6 py-4 bg-[#f9fafb] flex flex-wrap gap-2.5 items-center justify-between font-sans">
                <div>
                  <button 
                    onClick={handleLoadIntoWorkspace}
                    className="text-xs bg-white border border-[#babfc3] text-[#202223] px-4 py-2 rounded-lg hover:bg-[#f6f6f7] hover:border-[#8c9196] transition-colors font-semibold shadow-sm"
                    title="Загрузить свойства этого товара в основную панель слияния"
                  >
                    Загрузить в редактор
                  </button>
                </div>
                
                <div className="flex items-center space-x-2">
                  <button 
                    onClick={() => setEditingItem(null)}
                    className="text-xs text-[#5c5f62] hover:text-[#202223] hover:underline px-4 py-2 transition-colors font-semibold"
                  >
                    Отмена
                  </button>
                  
                  <button 
                    onClick={handleSaveLocalChanges}
                    className="text-xs bg-[#008060] hover:bg-[#006e52] text-white font-bold px-4 py-2 rounded-lg transition-colors shadow-sm active:bg-[#005e46]"
                  >
                    Сохранить локально
                  </button>

                  {editingItem.status === "success" && editingItem.prestashopId && (
                    <button 
                      onClick={handleUpdateInPrestaShop}
                      disabled={isUpdatingPrestaShop}
                      className="text-xs bg-white border border-[#babfc3] hover:border-[#008060] text-[#008060] hover:bg-[#f1f8f5] px-4 py-2 rounded-lg font-bold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isUpdatingPrestaShop ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Обновление...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Обновить в PrestaShop</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
