import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { ArrowRight, Eye, EyeOff, Pencil } from "lucide-react";
import { setRememberMe } from "@/lib/supabase";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const SignupContent = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMeState] = useState(true);
  const [newsletterConsent, setNewsletterConsent] = useState(true);
  const [step, setStep] = useState<'signup' | 'verify'>('signup');
  const [otpCode, setOtpCode] = useState("");
  const [resendCountdown, setResendCountdown] = useState(0);
  const { signUp, signIn, signInWithGoogle, verifyOtp, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Check for free tool session
  const freeToolSession = searchParams.get('session');
  const source = searchParams.get('source');
  const isFromFreeTool = source === 'free_tool' && freeToolSession;

  // Capture affiliate referral code from URL and persist in localStorage
  useEffect(() => {
    const ref = searchParams.get('ref') || searchParams.get('affiliate');
    if (ref) {
      localStorage.setItem('assetly_affiliate_ref', ref.toUpperCase());
    }
  }, [searchParams]);

  // Pre-fill email from free tool session
  useEffect(() => {
    const fetchSessionEmail = async () => {
      if (!isFromFreeTool) return;

      try {
        const apiUrl = import.meta.env.VITE_API_URL ?? "";
        const response = await fetch(`${apiUrl}/api/public/free-tools/session/${freeToolSession}`);

        if (response.ok) {
          const data = await response.json();
          if (data.email) setEmail(data.email);
          if (data.name) setName(data.name);
        }
      } catch (error) {
        console.error('[SIGNUP] Failed to fetch session email:', error);
      }
    };

    fetchSessionEmail();
  }, [isFromFreeTool, freeToolSession]);

  // Claim free tool session after signup
  const claimFreeToolSession = useCallback(async (accessToken: string) => {
    if (source !== 'free_tool' || !freeToolSession) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/free-tools/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ session_token: freeToolSession }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('assetly_claimed_template_id', data.template_id);
        localStorage.setItem('assetly_claimed_workspace_id', data.workspace_id);
      }
    } catch (error) {
      console.error('[SIGNUP] Failed to claim free tool session:', error);
    }
  }, [source, freeToolSession]);

  // Handle free tool session claiming after OAuth redirect
  useEffect(() => {
    const claimPendingSession = async () => {
      const pendingSession = localStorage.getItem('assetly_pending_free_tool_session');
      if (pendingSession && session?.access_token) {
        await claimFreeToolSession(session.access_token);
        localStorage.removeItem('assetly_pending_free_tool_session');
      }
    };

    if (session?.access_token) {
      claimPendingSession();
    }
  }, [session?.access_token, claimFreeToolSession]);

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setRememberMe(rememberMe);

    // Special flow for free tool users - auto-confirms email
    if (isFromFreeTool) {
      try {
        const apiUrl = import.meta.env.VITE_API_URL ?? "";
        const response = await fetch(`${apiUrl}/api/public/free-tools/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: freeToolSession,
            email,
            password,
            name,
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          if (result.error === 'email_already_registered') {
            toast.error("This email is already registered. Please sign in instead.");
          } else if (result.error === 'email_mismatch') {
            toast.error("Email must match the one you used to create the proposal.");
          } else {
            toast.error(result.message || "Failed to sign up");
          }
          setLoading(false);
          return;
        }

        // User created with auto-confirmed email - now sign them in
        const { error: signInError, data: signInData } = await signIn(email, password);

        if (signInError) {
          toast.error("Account created! Please sign in manually.");
          navigate("/login");
          return;
        }

        // Claim the free tool session
        if (signInData?.session?.access_token) {
          await claimFreeToolSession(signInData.session.access_token);
        }

        toast.success("Account created! Setting up your workspace...");
        // Navigate directly to onboarding
        setTimeout(() => navigate("/onboarding", { replace: true }), 500);
      } catch (error) {
        console.error('[SIGNUP] Free tool signup error:', error);
        toast.error("Failed to sign up. Please try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Standard signup flow - sends OTP email
    const { error, data } = await signUp(email, password, name, newsletterConsent);

    if (error) {
      toast.error(error.message || "Failed to sign up");
      setLoading(false);
    } else {
      // If session exists (email confirmation disabled in Supabase), go straight to onboarding
      if (data?.session) {
        navigate("/onboarding", { replace: true });
        return;
      }
      // Otherwise show OTP verification screen
      setStep('verify');
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
      // Navigate directly to onboarding - no reliance on TrialCheck
      navigate("/onboarding", { replace: true });
    }
  };

  const handleResendCode = async () => {
    if (resendCountdown > 0) return;

    const { error } = await signUp(email, password, name, newsletterConsent);
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
    setRememberMe(rememberMe);

    if (freeToolSession && source === 'free_tool') {
      localStorage.setItem('assetly_pending_free_tool_session', freeToolSession);
    }

    const ref = searchParams.get('ref') || searchParams.get('affiliate');
    if (ref) {
      localStorage.setItem('assetly_affiliate_ref', ref.toUpperCase());
    }

    const { error } = await signInWithGoogle();

    if (error) {
      toast.error(error.message || "Failed to sign up with Google");
      setLoading(false);
    }
  };

  // ─── OTP Verification Screen ───
  if (step === 'verify') {
    return (
      <div className="min-h-screen font-inter flex bg-white">
        {/* Left Column - OTP Form */}
        <div className="flex-1 flex items-center justify-center p-8 lg:p-16">
          <div className="w-full max-w-[400px] text-center">
            <div className="mb-8">
              <h1 className="text-[26px] font-semibold tracking-tight text-gray-900 mb-3">
                Verify your email
              </h1>
              <p className="text-[15px] text-gray-500">
                Enter the verification code sent to your email
              </p>
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <span className="text-[15px] text-gray-700 font-medium">{email}</span>
                <button
                  onClick={() => { setStep('signup'); setOtpCode(""); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* OTP Input */}
            <div className="flex justify-center mb-6">
              <InputOTP
                maxLength={8}
                value={otpCode}
                onChange={(value) => setOtpCode(value)}
                disabled={loading}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <InputOTPSlot key={i} index={i} className="w-11 h-14 text-lg border-gray-200 rounded-lg first:rounded-l-lg last:rounded-r-lg" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            {/* Resend */}
            <p className="text-sm text-gray-500 mb-6">
              Didn't receive a code?{" "}
              {resendCountdown > 0 ? (
                <span className="text-gray-400">Resend ({resendCountdown})</span>
              ) : (
                <button
                  onClick={handleResendCode}
                  className="font-medium text-gray-700 hover:text-gray-900 hover:underline underline-offset-2"
                >
                  Resend
                </button>
              )}
            </p>

            {/* Continue Button */}
            <Button
              onClick={handleVerifyOtp}
              className="w-full h-11 rounded-lg bg-gray-900 hover:bg-gray-800 text-white font-medium text-sm transition-all group"
              disabled={loading || otpCode.length !== 8}
            >
              {loading ? "Verifying..." : "Continue"}
              {!loading && <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />}
            </Button>
          </div>
        </div>

        {/* Right Column - Branding */}
        <BrandingPanel />
      </div>
    );
  }

  // ─── Signup Form Screen ───
  return (
    <div className="min-h-screen font-inter flex bg-white">
      {/* Left Column - Sign Up Form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-16">
        <div className="w-full max-w-[400px]">
          {/* Mobile Logo */}
          <div className="flex items-center gap-2.5 mb-12 lg:hidden">
            <img
              src="/Assetly.png"
              alt="Assetly"
              className="w-8 h-8 object-contain"
            />
            <span className="font-semibold text-lg tracking-tight text-gray-900">Assetly</span>
          </div>

          <div className="mb-8">
            <h1 className="text-[26px] font-semibold tracking-tight text-gray-900 mb-2">
              {isFromFreeTool ? "Access your proposal" : "Create your account"}
            </h1>
            <p className="text-[15px] text-gray-500">
              {isFromFreeTool
                ? "Set a password to access your proposal and start editing."
                : "Start your 7-day free trial. No credit card required."}
            </p>
          </div>

          <div className="space-y-5">
            {/* Google Sign Up */}
            <Button
              type="button"
              onClick={handleGoogleSignIn}
              variant="outline"
              className="w-full h-11 rounded-lg flex items-center justify-center gap-2.5 font-medium text-sm border-gray-200 hover:bg-gray-50 text-gray-700"
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

            {/* Divider */}
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 text-xs text-gray-400 bg-white font-medium">or</span>
              </div>
            </div>

            {/* Email Sign Up Form */}
            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Full name
                </label>
                <Input
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="h-11 rounded-lg text-sm border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus-visible:ring-gray-300"
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Email address
                </label>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => !isFromFreeTool && setEmail(e.target.value)}
                  required
                  className="h-11 rounded-lg text-sm border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus-visible:ring-gray-300"
                  style={isFromFreeTool ? { background: '#f5f5f5', color: '#6b7280' } : undefined}
                  disabled={loading}
                  readOnly={!!isFromFreeTool}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Min 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="h-11 rounded-lg text-sm border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 pr-10 focus-visible:ring-gray-300"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <div className="flex items-center space-x-2.5">
                  <Checkbox
                    id="remember-me-signup"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMeState(checked === true)}
                    disabled={loading}
                    className="border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
                  />
                  <label
                    htmlFor="remember-me-signup"
                    className="text-sm cursor-pointer select-none text-gray-600"
                  >
                    Remember me
                  </label>
                </div>
                <div className="flex items-start space-x-2.5">
                  <Checkbox
                    id="newsletter-consent"
                    checked={newsletterConsent}
                    onCheckedChange={(checked) => setNewsletterConsent(checked === true)}
                    disabled={loading}
                    className="mt-0.5 border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
                  />
                  <label
                    htmlFor="newsletter-consent"
                    className="text-sm cursor-pointer select-none text-gray-600 leading-relaxed"
                  >
                    Send me product updates and tips via email
                  </label>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 rounded-lg bg-gray-900 hover:bg-gray-800 text-white font-medium text-sm transition-all group"
                disabled={loading}
              >
                {loading ? "Creating account..." : "Continue"}
                {!loading && <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />}
              </Button>
            </form>
          </div>

          {/* Terms */}
          <p className="text-xs text-center mt-6 text-gray-400 leading-relaxed">
            By signing up, you agree to our{" "}
            <Link to="/terms" className="hover:underline underline-offset-2 text-gray-500">Terms of Service</Link>
            {" "}and{" "}
            <Link to="/privacy" className="hover:underline underline-offset-2 text-gray-500">Privacy Policy</Link>
          </p>

          {/* Sign In Link */}
          <div className="text-center text-sm mt-8 pt-6 border-t border-gray-100">
            <span className="text-gray-500">Already have an account? </span>
            <Link to="/login" className="font-semibold text-gray-900 hover:underline underline-offset-2">
              Sign in
            </Link>
          </div>
        </div>
      </div>

      {/* Right Column - Branding */}
      <BrandingPanel />
    </div>
  );
};

/** Shared right-panel branding used on both signup and OTP screens */
const BrandingPanel = () => (
  <div className="hidden lg:flex lg:w-[45%] bg-[#f9f9f9] p-12 flex-col justify-between relative overflow-hidden border-l border-gray-100">
    {/* Subtle grid pattern */}
    <div
      className="absolute inset-0 opacity-[0.4]"
      style={{
        backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    />

    {/* Logo */}
    <div className="relative z-10 flex items-center gap-2.5">
      <img
        src="/Assetly.png"
        alt=""
        className="w-7 h-7 object-contain"
      />
      <span className="font-semibold text-[15px] tracking-tight text-gray-900">Assetly</span>
    </div>

    {/* Testimonial */}
    <div className="relative z-10 max-w-md">
      <div className="text-gray-300 mb-4">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
          <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
        </svg>
      </div>
      <p className="text-[20px] font-medium text-gray-800 leading-[1.5] mb-6">
        Assetly turned our proposal process from days into minutes. The AI understands our brand and delivers polished results every time.
      </p>
      <div className="text-sm text-gray-500">
        Trusted by agencies and consultancies worldwide
      </div>
    </div>

    {/* Stats */}
    <div className="relative z-10 flex gap-12">
      <div>
        <div className="text-2xl font-semibold text-gray-900 tracking-tight">500+</div>
        <div className="text-sm text-gray-500 mt-0.5">Proposals created</div>
      </div>
      <div>
        <div className="text-2xl font-semibold text-gray-900 tracking-tight">10x</div>
        <div className="text-sm text-gray-500 mt-0.5">Faster delivery</div>
      </div>
      <div>
        <div className="text-2xl font-semibold text-gray-900 tracking-tight">Built-in</div>
        <div className="text-sm text-gray-500 mt-0.5">E-signatures</div>
      </div>
    </div>
  </div>
);

const Signup = () => {
  const [searchParams] = useSearchParams();
  const source = searchParams.get('source');
  const isFromFreeTool = source === 'free_tool';

  return <SignupContent />;
};

export default Signup;
