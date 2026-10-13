import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { boot } from "@/lib/boot";
import { App, preloadScreen } from "./app";
import "./index.css";

void boot();
preloadScreen();

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider delayDuration={300}>
          <Suspense fallback={null}>
            <App />
          </Suspense>
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>,
  );
