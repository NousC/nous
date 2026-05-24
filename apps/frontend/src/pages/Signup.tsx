import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { Eye, EyeOff, Pencil } from "lucide-react";
import { setRememberMe } from "@/lib/supabase";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { NousBrandingPanel } from "./auth-shared/NousBrandingPanel";

const SignupContent = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<"signup" | "verify">("signup");
  const [otpCode, setOtpCode] = useState("");
  const [resendCountdown, setResendCountdown] = useState(0);
  const { signUp, signInWithGoogle, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Capture affiliate referral code from URL and persist in localStorage
  useEffect(() => {
    const ref = searchParams.get("ref") || searchParams.get("affiliate");
    if (ref) {
      localStorage.setItem("nous_affiliate_ref", ref.toUpperCase());
    }
  }, [searchParams]);

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setRememberMe(true);

    const { error, data } = await signUp(email, password, undefined, true);

    if (error) {
      toast.error(error.message || "Failed to sign up");
      setLoading(false);
    } else {
      if (data?.session) {
        navigate("/onboarding", { replace: true });
        return;
      }
      setStep("verify");
      setResendCountdown(30);
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 8) return;
    setLoading(true);

    const { error } = await verifyOtp(email, otpCode);

    if (error) {
      toast.error(error.message || "Invalid verification code. Please try again.");
      setOtpCode("");
      setLoading(false);
    } else {
      toast.success("Email verified! Let's set up your workspace.");
      navigate("/onboarding", { replace: true });
    }
  };

  const handleResendCode = async () => {
    if (resendCountdown > 0) return;

    const { error } = await signUp(email, password, undefined, true);
    if (error) {
      toast.error("Failed to resend code. Please try again.");
    } else {
      toast.success("New verification code sent!");
      setResendCountdown(30);
      setOtpCode("");
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setRememberMe(true);

    const ref = searchParams.get("ref") || searchParams.get("affiliate");
    if (ref) {
      localStorage.setItem("nous_affiliate_ref", ref.toUpperCase());
    }

    const { error } = await signInWithGoogle();

    if (error) {
      toast.error(error.message || "Failed to sign up with Google");
      setLoading(false);
    }
  };

  // ─── OTP Verification Screen ───
  if (step === "verify") {
    return (
      <div className="min-h-screen font-inter flex bg-[#FAF9F7]">
        <div
          className="flex-1 flex items-center justify-center p-8 lg:p-16 relative"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(120, 90, 70, 0.12) 1px, transparent 1.4px)",
            backgroundSize: "18px 18px",
          }}
        >
          <div className="w-full max-w-[380px] text-center relative">
            <div className="mb-8">
              <h1 className="text-[28px] font-bold tracking-[-0.03em] leading-[1.1] text-[#1f1410] mb-3">
                Check your email
              </h1>
              <p className="text-[14px] text-[#6b5a50]">
                We sent a verification code to
              </p>
              <div className="flex items-center justify-center gap-1.5 mt-1.5">
                <span className="text-[14px] text-[#1f1410] font-mono">{email}</span>
                <button
                  onClick={() => {
                    setStep("signup");
                    setOtpCode("");
                  }}
                  className="text-[#a08c7e] hover:text-[#3d2517]"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex justify-center mb-6">
              <InputOTP
                maxLength={8}
                value={otpCode}
                onChange={(value) => setOtpCode(value)}
                disabled={loading}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="w-10 h-12 text-base border-[#e6dccf] bg-white rounded-lg first:rounded-l-lg last:rounded-r-lg"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            <p className="text-sm text-[#6b5a50] mb-6">
              Didn&apos;t receive a code?{" "}
              {resendCountdown > 0 ? (
                <span className="text-[#a08c7e]">Resend ({resendCountdown})</span>
              ) : (
                <button
                  onClick={handleResendCode}
                  className="font-medium text-[#3d2517] hover:text-[#c97e5c]"
                >
                  Resend
                </button>
              )}
            </p>

            <Button
              onClick={handleVerifyOtp}
              className="w-full h-12 rounded-lg pl-5 pr-1.5 flex items-center justify-between gap-2 font-medium text-sm bg-[#f1e2d4] hover:bg-[#e8d4c0] text-[#3d2517] transition-transform hover:scale-[1.005] disabled:opacity-60 disabled:hover:scale-100"
              disabled={loading || otpCode.length !== 8}
            >
              <span>{loading ? "Verifying..." : "Continue"}</span>
              <span
                className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-[#1f1410] text-[#FAF9F7]"
                aria-hidden="true"
              >
                →
              </span>
            </Button>
          </div>
        </div>

        <NousBrandingPanel />
      </div>
    );
  }

  // ─── Signup Form Screen ───
  return (
    <div className="min-h-screen font-inter flex bg-[#FAF9F7]">
      <div
        className="flex-1 flex items-center justify-center p-8 lg:p-16 relative"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(120, 90, 70, 0.12) 1px, transparent 1.4px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="w-full max-w-[380px] relative">
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <img src="/nous-logo.svg" alt="" className="w-7 h-7 object-contain" />
            <span className="font-bold text-[18px] tracking-[-0.02em] text-[#1f1410]">nous</span>
          </div>

          <h1 className="text-[28px] font-bold tracking-[-0.03em] leading-[1.1] text-[#1f1410] mb-8">
            Create account
          </h1>

          <div className="space-y-4">
            <Button
              type="button"
              onClick={handleGoogleSignIn}
              variant="outline"
              className="w-full h-11 rounded-lg flex items-center justify-center gap-2.5 font-medium text-sm border-[#e6dccf] bg-white hover:bg-[#f5ede5] text-[#3d2517]"
              disabled={loading}
            >
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </Button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#e6dccf]" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 text-[10px] uppercase tracking-[0.12em] text-[#a08c7e] bg-[#FAF9F7] font-mono">
                  or
                </span>
              </div>
            </div>

            <form onSubmit={handleSignup} className="space-y-3">
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 rounded-lg text-sm border-[#e6dccf] bg-white text-[#1f1410] placeholder:text-[#a08c7e] focus-visible:ring-[#c97e5c] focus-visible:border-[#c97e5c]"
                disabled={loading}
                autoFocus
              />

              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password (min 6 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-11 rounded-lg text-sm border-[#e6dccf] bg-white text-[#1f1410] placeholder:text-[#a08c7e] pr-10 focus-visible:ring-[#c97e5c] focus-visible:border-[#c97e5c]"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a08c7e] hover:text-[#3d2517]"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <Button
                type="submit"
                className="w-full h-12 rounded-lg pl-5 pr-1.5 flex items-center justify-between gap-2 font-medium text-sm bg-[#f1e2d4] hover:bg-[#e8d4c0] text-[#3d2517] transition-transform hover:scale-[1.005] disabled:opacity-60 disabled:hover:scale-100"
                disabled={loading}
              >
                <span>{loading ? "Creating account..." : "Continue"}</span>
                <span
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-[#1f1410] text-[#FAF9F7]"
                  aria-hidden="true"
                >
                  →
                </span>
              </Button>
            </form>
          </div>

          <p className="text-[11px] text-center mt-5 text-[#a08c7e] leading-relaxed">
            By continuing, you agree to our{" "}
            <Link to="/terms" className="text-[#6b5a50] hover:text-[#3d2517]">
              Terms
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="text-[#6b5a50] hover:text-[#3d2517]">
              Privacy Policy
            </Link>
          </p>

          <div className="text-center text-sm mt-6">
            <span className="text-[#6b5a50]">Already have an account? </span>
            <Link to="/login" className="font-semibold text-[#1f1410] hover:text-[#c97e5c] transition-colors">
              Sign in →
            </Link>
          </div>
        </div>
      </div>

      <NousBrandingPanel />
    </div>
  );
};

const Signup = () => <SignupContent />;

export default Signup;
