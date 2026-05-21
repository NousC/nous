import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/playground": "Playground",
  "/api-keys": "API Keys",
  "/webhooks": "Webhooks",
  "/exports": "Exports",
};

export default function ComingSoon() {
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? "Coming soon";

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8 bg-white">
      <h1 className="text-[18px] font-bold text-gray-900 tracking-tight">{title}</h1>
      <p className="text-[13px] text-gray-500 mt-1.5">This section is coming soon.</p>
    </div>
  );
}
