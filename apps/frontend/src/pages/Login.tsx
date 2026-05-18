import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { Eye, EyeOff } from "lucide-react";
import { setRememberMe } from "@/lib/supabase";
import { NousBrandingPanel } from "./auth-shared/NousBrandingPanel";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMeState] = useState(true);
  const { signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setRememberMe(rememberMe);

    const { error } = await signIn(email, password);

    if (error) {
      toast.error(error.message || "Failed to sign in");
      setLoading(false);
    } else {
      setTimeout(() => {
        navigate("/");
      }, 500);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setRememberMe(rememberMe);
    const { error } = await signInWithGoogle();

    if (error) {
      toast.error(error.message || "Failed to sign in with Google");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen font-inter flex bg-[#FAF9F7]">
      {/* Left Column - Login Form */}
      <div
        className="flex-1 flex items-center justify-center p-8 lg:p-16 relative"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(120, 90, 70, 0.12) 1px, transparent 1.4px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="w-full max-w-[420px] relative">
          {/* Mobile Logo */}
          <div className="flex items-center gap-2 mb-12 lg:hidden">
            <img src="/nous-logo.svg" alt="" className="w-7 h-7 object-contain" />
            <span className="font-bold text-[18px] tracking-[-0.02em] text-[#1f1410]">nous</span>
          </div>

          <div className="mb-9">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8a7568] mb-3">
              <span className="text-[#c97e5c]">#</span> sign in
            </div>
            <h1 className="text-[34px] font-bold tracking-[-0.03em] leading-[1.05] text-[#1f1410] mb-3">
              Welcome back.
            </h1>
            <p className="text-[15px] text-[#6b5a50]">
              Sign in to continue to your workspace.
            </p>
          </div>

          <div className="space-y-5">
            {/* Google Sign In */}
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

            {/* Divider */}
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#e6dccf]" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 text-[10px] uppercase tracking-[0.12em] text-[#a08c7e] bg-[#FAF9F7] font-mono">or</span>
              </div>
            </div>

            {/* Email Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-[13px] font-medium text-[#3d2517] mb-1.5 block tracking-tight">
                  Email
                </label>
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
              </div>

              <div>
                <label className="text-[13px] font-medium text-[#3d2517] mb-1.5 block tracking-tight">
                  Password
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
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
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-2.5">
                  <Checkbox
                    id="remember-me"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMeState(checked === true)}
                    disabled={loading}
                    className="border-[#cbb9a8] data-[state=checked]:bg-[#3d2517] data-[state=checked]:border-[#3d2517]"
                  />
                  <label
                    htmlFor="remember-me"
                    className="text-[13px] cursor-pointer select-none text-[#6b5a50]"
                  >
                    Remember me
                  </label>
                </div>
                <Link
                  to="/forgot-password"
                  className="text-[13px] font-medium text-[#6b5a50] hover:text-[#3d2517] hover:underline underline-offset-2 decoration-dotted"
                >
                  Forgot password?
                </Link>
              </div>

              <Button
                type="submit"
                className="w-full h-12 rounded-lg pl-5 pr-1.5 flex items-center justify-between gap-2 font-medium text-sm bg-[#f1e2d4] hover:bg-[#e8d4c0] text-[#3d2517] transition-transform hover:scale-[1.005] disabled:opacity-60 disabled:hover:scale-100"
                disabled={loading}
              >
                <span>{loading ? "Signing in..." : "Continue"}</span>
                <span
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-[#1f1410] text-[#FAF9F7]"
                  aria-hidden="true"
                >
                  →
                </span>
              </Button>
            </form>
          </div>

          {/* Sign Up Link */}
          <div className="text-center text-sm mt-8 pt-6 border-t border-[#e6dccf]">
            <span className="text-[#6b5a50]">Don&apos;t have an account? </span>
            <Link to="/signup" className="font-semibold text-[#1f1410] hover:text-[#c97e5c] transition-colors">
              Sign up →
            </Link>
          </div>
        </div>
      </div>

      {/* Right Column - Branding */}
      <NousBrandingPanel />
    </div>
  );
};

export default Login;
