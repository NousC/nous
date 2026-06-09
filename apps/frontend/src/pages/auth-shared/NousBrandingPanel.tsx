/**
 * Branding panel shown on the right side of the Login and Signup pages.
 */
export const NousBrandingPanel = () => (
  <div
    className="hidden lg:flex lg:w-[45%] p-12 flex-col justify-between relative overflow-hidden font-mono"
    style={{
      backgroundColor: "#16120f",
      backgroundImage:
        "radial-gradient(circle, rgba(200, 190, 178, 0.05) 1px, transparent 1.4px)",
      backgroundSize: "18px 18px",
    }}
  >
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          "radial-gradient(ellipse 100% 60% at 50% 0%, rgba(217, 119, 87, 0.12) 0%, transparent 70%)",
      }}
    />

    <div className="relative z-10 flex items-center gap-2">
      <img src="/nous-logo.svg" alt="" className="w-6 h-6 object-contain" />
      <span className="font-bold text-[15px] tracking-[-0.02em] text-[#e8e3dc]">nous</span>
    </div>

    <div className="relative z-10 max-w-md">
      <h2 className="font-bold text-[40px] leading-[1.05] tracking-[-0.03em] text-[#e8e3dc] mb-6">
        The customer graph for{" "}
        <span className="text-[#d97757]">&lt;</span>
        <span>GTM engineers</span>
        <span className="text-[#d97757]">&gt;</span>
      </h2>
      <p className="text-[15px] text-[#8a8178] leading-[1.6] max-w-sm">
        One clear record for every person you sell to. Your agents read it, trust it, and write back to it as they work.
      </p>
    </div>

    <div className="relative z-10" />
  </div>
);
