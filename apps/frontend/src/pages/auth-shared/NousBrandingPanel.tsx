/**
 * Branding panel shown on the right side of the Login and Signup pages.
 * Dark warm palette, dotted Muster, matches the marketing site's
 * "dark-section" treatment.
 */
export const NousBrandingPanel = () => (
  <div
    className="hidden lg:flex lg:w-[45%] p-12 flex-col justify-between relative overflow-hidden"
    style={{
      backgroundColor: "#1f1410",
      backgroundImage:
        "radial-gradient(circle, rgba(220, 180, 140, 0.12) 1px, transparent 1.4px)",
      backgroundSize: "18px 18px",
    }}
  >
    {/* Subtle gradient wash */}
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          "radial-gradient(ellipse 100% 60% at 50% 0%, rgba(201, 126, 92, 0.08) 0%, transparent 70%)",
      }}
    />

    {/* Logo */}
    <div className="relative z-10 flex items-center gap-2">
      <img src="/nous-logo.svg" alt="" className="w-6 h-6 object-contain" />
      <span className="font-bold text-[15px] tracking-[-0.02em] text-[#f5ede5]">nous</span>
    </div>

    {/* Headline + body */}
    <div className="relative z-10 max-w-md">
      <h2 className="font-bold text-[34px] leading-[1.1] tracking-[-0.03em] text-[#f5ede5] mb-6">
        Built for{" "}
        <span className="text-[#e8a380]">&lt;</span>
        <span>GTM engineers</span>
        <span className="text-[#e8a380]">&gt;</span>
        <br />
        who want proof,
        <br />
        not promises.
      </h2>
      <p className="text-[15px] text-[#bba99b] leading-[1.6] max-w-sm">
        Nous unifies Apollo, Salesforce, Smartlead, Gmail, and LinkedIn into
        one identity-resolved record per human. Your agents query the full
        account in a single MCP call.
      </p>
    </div>

    {/* Spacer to keep logo at top and content vertically centered */}
    <div className="relative z-10" />
  </div>
);
