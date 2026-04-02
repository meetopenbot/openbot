import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import "./index.css"
import App from "./App.tsx"
import { TooltipProvider } from "./components/ui/tooltip"

const queryClient = new QueryClient()

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={0}>
      <App />
    </TooltipProvider>
  </QueryClientProvider>
)
