import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ZIC Mart POS" },
      { name: "description", content: "Point of Sale system for ZIC Mart" },
      { property: "og:title", content: "ZIC Mart POS" },
      { name: "twitter:title", content: "ZIC Mart POS" },
      { property: "og:description", content: "Point of Sale system for ZIC Mart" },
      { name: "twitter:description", content: "Point of Sale system for ZIC Mart" },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/15616968-6bb2-4820-89d7-a211c8c41bc0" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/15616968-6bb2-4820-89d7-a211c8c41bc0" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-6xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
        <a href="/" className="mt-4 inline-block text-primary hover:underline">Go home</a>
      </div>
    </div>
  ),
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  useEffect(() => {
    // Global error handler to prevent unhandled promise rejections
    const handleError = (event: ErrorEvent) => {
      console.error("Global error:", event.error);
      // Prevent default error page from showing for some errors
      if (event.error?.message?.includes("scanner") || event.error?.message?.includes("camera")) {
        event.preventDefault();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled promise rejection:", event.reason);
      // Don't prevent these, but log them
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return (
    <AuthProvider>
      <Outlet />
      <Toaster
        richColors
        position="top-right"
        duration={2000}
        closeButton
        toastOptions={{ onClick: (t) => (window as any).sonner?.dismiss?.(t.id) }}
      />
      <div
        onClickCapture={() => {
          // Dismiss all sonner toasts when user clicks anywhere
          import("sonner").then(({ toast }) => toast.dismiss());
        }}
        style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: -1 }}
      />
    </AuthProvider>
  );
}
