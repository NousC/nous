import { cn } from "@/lib/utils";

interface TemplatePreviewProps {
  designStyle: string;
  theme: "light" | "dark";
  brandColor: string;
  companyLogo?: string;
  companyName?: string;
}

export function TemplatePreview({
  designStyle,
  theme,
  brandColor,
  companyLogo,
  companyName,
}: TemplatePreviewProps) {
  const isDark = theme === "dark";
  const bg = isDark ? "#1a1a2e" : "#ffffff";
  const textPrimary = isDark ? "#f0f0f0" : "#1a1a1a";
  const textSecondary = isDark ? "#a0a0b0" : "#6b7280";
  const cardBg = isDark ? "#24243a" : "#f8f9fa";
  const borderColor = isDark ? "#2d2d44" : "#e5e7eb";

  // Design style affects layout proportions and shapes
  const isMinimalist = designStyle === "minimalist";
  const isCreative = designStyle === "creative";
  const isElegant = designStyle === "elegant";
  const isModern = designStyle === "modern";

  const borderRadius = isMinimalist ? "rounded-none" : isCreative ? "rounded-2xl" : isElegant ? "rounded-lg" : "rounded-xl";
  const headingWeight = isElegant ? "font-light tracking-wide" : isCreative ? "font-bold" : "font-semibold";

  return (
    <div className="w-full max-w-[340px]">
      {/* Template Document Mockup */}
      <div
        className={cn("shadow-2xl overflow-hidden transition-all duration-500", borderRadius)}
        style={{ backgroundColor: bg, border: `1px solid ${borderColor}` }}
      >
        {/* Cover / Header Section */}
        <div
          className="relative overflow-hidden transition-all duration-500"
          style={{
            background: isCreative
              ? `linear-gradient(135deg, ${brandColor}, ${brandColor}dd, ${isDark ? "#1a1a2e" : "#ffffff"})`
              : isModern
              ? `linear-gradient(180deg, ${brandColor}18, transparent)`
              : isElegant
              ? `linear-gradient(180deg, ${brandColor}10, transparent)`
              : `linear-gradient(180deg, ${brandColor}22, transparent)`,
            height: isMinimalist ? 100 : 120,
          }}
        >
          {/* Brand bar */}
          <div
            className="absolute top-0 left-0 right-0 transition-all duration-500"
            style={{
              height: isMinimalist ? 3 : isCreative ? 6 : 4,
              backgroundColor: brandColor,
            }}
          />

          {/* Cover content */}
          <div className={cn("p-5", isMinimalist ? "pt-6" : "pt-7")}>
            {/* Logo or company initial */}
            <div
              className={cn(
                "w-8 h-8 flex items-center justify-center mb-3 transition-all duration-500 overflow-hidden",
                isCreative ? "rounded-full" : isMinimalist ? "rounded-none" : "rounded-lg"
              )}
              style={{ backgroundColor: companyLogo ? "transparent" : brandColor }}
            >
              {companyLogo ? (
                <img src={companyLogo} alt="" className="w-full h-full object-contain" />
              ) : (
                <span className="text-white text-xs font-bold">
                  {companyName?.charAt(0)?.toUpperCase() || "P"}
                </span>
              )}
            </div>

            {/* Title */}
            <div
              className={cn("transition-all duration-500", headingWeight)}
              style={{ color: textPrimary, fontSize: isMinimalist ? 16 : 18 }}
            >
              {isElegant ? "Business Proposal" : isCreative ? "Growth Strategy" : "Sales Proposal"}
            </div>
            <div
              className="text-[11px] mt-0.5 transition-all duration-500"
              style={{ color: textSecondary }}
            >
              Prepared for Acme Corp
            </div>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4">
          {/* Section heading with accent */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div
                className="transition-all duration-500"
                style={{
                  width: isMinimalist ? 12 : 3,
                  height: isMinimalist ? 1 : 14,
                  backgroundColor: brandColor,
                  borderRadius: 2,
                }}
              />
              <span
                className={cn("text-[12px] uppercase tracking-wider transition-all duration-500", headingWeight)}
                style={{ color: brandColor }}
              >
                Executive Summary
              </span>
            </div>
            {/* Text lines */}
            <div className="space-y-1.5 pl-0">
              <div
                className={cn("h-2 transition-all duration-500", borderRadius)}
                style={{ backgroundColor: cardBg, width: "100%" }}
              />
              <div
                className={cn("h-2 transition-all duration-500", borderRadius)}
                style={{ backgroundColor: cardBg, width: "85%" }}
              />
              <div
                className={cn("h-2 transition-all duration-500", borderRadius)}
                style={{ backgroundColor: cardBg, width: "92%" }}
              />
            </div>
          </div>

          {/* Metrics row */}
          <div className="grid grid-cols-3 gap-2">
            {["$24K", "3 mo", "12x"].map((metric, i) => (
              <div
                key={i}
                className={cn("p-2.5 text-center transition-all duration-500", borderRadius)}
                style={{
                  backgroundColor: i === 0 ? `${brandColor}12` : cardBg,
                  border: i === 0 ? `1px solid ${brandColor}30` : `1px solid ${borderColor}`,
                }}
              >
                <div
                  className="text-[13px] font-semibold transition-all duration-500"
                  style={{ color: i === 0 ? brandColor : textPrimary }}
                >
                  {metric}
                </div>
                <div className="text-[9px]" style={{ color: textSecondary }}>
                  {["Investment", "Timeline", "ROI"][i]}
                </div>
              </div>
            ))}
          </div>

          {/* Another section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div
                className="transition-all duration-500"
                style={{
                  width: isMinimalist ? 12 : 3,
                  height: isMinimalist ? 1 : 14,
                  backgroundColor: brandColor,
                  borderRadius: 2,
                }}
              />
              <span
                className={cn("text-[12px] uppercase tracking-wider transition-all duration-500", headingWeight)}
                style={{ color: brandColor }}
              >
                Our Approach
              </span>
            </div>
            <div className="space-y-1.5">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className={cn("flex items-center gap-2.5 p-2 transition-all duration-500", borderRadius)}
                  style={{ backgroundColor: cardBg }}
                >
                  <div
                    className={cn(
                      "w-5 h-5 flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-white transition-all duration-500",
                      isCreative ? "rounded-full" : isMinimalist ? "rounded-none" : "rounded"
                    )}
                    style={{ backgroundColor: brandColor }}
                  >
                    {i}
                  </div>
                  <div
                    className={cn("h-2 flex-1 transition-all duration-500", borderRadius)}
                    style={{ backgroundColor: isDark ? "#33334a" : "#e5e7eb" }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 flex items-center justify-between transition-all duration-500"
          style={{ borderTop: `1px solid ${borderColor}` }}
        >
          <div className="text-[9px]" style={{ color: textSecondary }}>
            Generated by Nous
          </div>
          <div
            className="text-[9px] font-medium"
            style={{ color: brandColor }}
          >
            Page 1 of 4
          </div>
        </div>
      </div>

      {/* Caption */}
      <p className="text-center text-[11px] text-gray-400 mt-4">
        Live preview — updates as you customize
      </p>
    </div>
  );
}
