import React from "react";
import { Loader2 } from "lucide-react";
import App from "../App";
import { AuthProvider, useAuth } from "./AuthContext";
import { AuthGateScreen } from "./AuthGateScreen";

const SplashLoader: React.FC = () => (
  <div className="min-h-screen w-full flex items-center justify-center bg-[#fafbfb]">
    <div className="flex flex-col items-center gap-3 text-[#5c5f62]">
      <Loader2 className="w-6 h-6 animate-spin text-[#008060]" />
      <span className="text-xs">Проверка сессии…</span>
    </div>
  </div>
);

const Gate: React.FC = () => {
  const { isInitializing, needsSetup, user } = useAuth();
  if (isInitializing) return <SplashLoader />;
  if (needsSetup) return <AuthGateScreen mode="setup" />;
  if (!user) return <AuthGateScreen mode="login" />;
  return <App />;
};

export const AuthShell: React.FC = () => (
  <AuthProvider>
    <Gate />
  </AuthProvider>
);
