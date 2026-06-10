import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { Eye, EyeOff } from "lucide-react";
import { setRememberMe } from "@/lib/supabase";
import { useAuthConfig } from "@/lib/authConfig";
import GraphField from "@/components/GraphField";

const PAGE_STYLE = {
  backgroundColor: "#f6f1e9",
  backgroundImage:
    "radial-gradient(1100px 700px at 78% -8%, rgba(217,119,87,0.07), transparent 60%), radial-gradient(900px 600px at 12% 108%, rgba(191,86,48,0.05), transparent 60%)",
} as const;

const BOX_SHADOW = {
  boxShadow:
    "0 1px 0 rgba(255,255,255,0.8) inset, 0 18px 50px -22px rgba(42,36,32,0.28), 0 6px 18px -12px rgba(191,86,48,0.16)",
} as const;

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { signIn, signInWithGoogle } = useAuth();
  const { signupsDisabled, googleEnabled } = useAuthConfig();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setRememberMe(true);

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
    setRememberMe(true);
    const { error } = await signInWithGoogle();

    if (error) {
      toast.error(error.message || "Failed to sign in with Google");
      setLoading(false);
    }
  };

  return (
    <div
      className="relative overflow-hidden min-h-screen flex items-center justify-center px-4 font-mono text-[#2a2420]"
      style={PAGE_STYLE}
    >
      <GraphField />
      <div
        className="relative z-10 w-full max-w-[360px] overflow-hidden rounded-lg border border-[#e4d9c8] bg-[#fffdf9]"
        style={BOX_SHADOW}
      >
        {/* title bar */}
        <div className="flex items-center gap-2 border-b border-[#e4d9c8] px-4 py-2 text-xs text-[#8a7e6f]">
          <span className="text-[#b5532f]/80">●</span>
          <span className="text-[#d97757]/70">●</span>
          <span className="text-[#bf5630]/70">●</span>
          <span className="ml-1">nous — sign in</span>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-2">
            <img src="/nous-logo.svg" alt="" className="w-5 h-5 object-contain" />
            <span className="font-bold text-[14px] tracking-[-0.02em] text-[#2a2420]">nous</span>
          </div>

          <h1 className="mt-4 text-[20px] font-bold tracking-[-0.02em] text-[#2a2420]">
            Sign in
          </h1>
          <p className="mt-1 text-xs text-[#8a7e6f]">
            Welcome back. Open your workspace.
          </p>

          <div className="mt-5 space-y-3">
            {googleEnabled && (
              <>
                <Button
                  type="button"
                  onClick={handleGoogleSignIn}
                  variant="outline"
                  className="w-full h-11 rounded-lg flex items-center justify-center gap-2.5 font-medium text-sm border-[#e4d9c8] bg-[#fffdf9] hover:bg-[#f6f1e9] text-[#2a2420]"
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
                    <div className="w-full border-t border-[#e4d9c8]" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-3 text-[10px] uppercase tracking-[0.12em] text-[#8a7e6f] bg-[#fffdf9]">or</span>
                  </div>
                </div>
              </>
            )}

            <form onSubmit={handleLogin} className="space-y-3">
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 rounded-lg text-sm border-[#e4d9c8] bg-[#fffdf9] text-[#2a2420] placeholder:text-[#8a7e6f]/70 focus-visible:ring-[#bf5630] focus-visible:border-[#bf5630]"
                disabled={loading}
                autoFocus
              />

              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 rounded-lg text-sm border-[#e4d9c8] bg-[#fffdf9] text-[#2a2420] placeholder:text-[#8a7e6f]/70 pr-10 focus-visible:ring-[#bf5630] focus-visible:border-[#bf5630]"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a7e6f] hover:text-[#bf5630]"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex justify-end pt-0.5">
                <Link
                  to="/forgot-password"
                  className="text-[12px] text-[#8a7e6f] hover:text-[#bf5630]"
                >
                  Forgot password?
                </Link>
              </div>

              <Button
                type="submit"
                className="w-full h-12 rounded-lg pl-5 pr-1.5 flex items-center justify-between gap-2 font-medium text-sm bg-[#d97757] hover:brightness-110 text-[#fffdf9] transition-transform hover:scale-[1.005] disabled:opacity-60 disabled:hover:scale-100"
                disabled={loading}
              >
                <span>{loading ? "Signing in..." : "Continue"}</span>
                <span
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-[#fffdf9] text-[#d97757]"
                  aria-hidden="true"
                >
                  →
                </span>
              </Button>
            </form>
          </div>

          {!signupsDisabled && (
            <div className="text-center text-xs mt-6">
              <span className="text-[#8a7e6f]">New here? </span>
              <Link to="/signup" className="font-semibold text-[#2a2420] hover:text-[#bf5630] transition-colors">
                Create account →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
