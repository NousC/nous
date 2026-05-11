import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { setRememberMe } from "@/lib/supabase";

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
    <div className="min-h-screen font-inter flex bg-white">
      {/* Left Column - Login Form */}
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
              Welcome back
            </h1>
            <p className="text-[15px] text-gray-500">
              Sign in to continue to your workspace
            </p>
          </div>

          <div className="space-y-5">
            {/* Google Sign In */}
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

            {/* Email Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Email address
                </label>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 rounded-lg text-sm border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus-visible:ring-gray-300"
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
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

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-2.5">
                  <Checkbox
                    id="remember-me"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMeState(checked === true)}
                    disabled={loading}
                    className="border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
                  />
                  <label
                    htmlFor="remember-me"
                    className="text-sm cursor-pointer select-none text-gray-600"
                  >
                    Remember me
                  </label>
                </div>
                <Link
                  to="/forgot-password"
                  className="text-sm font-medium text-gray-600 hover:text-gray-900 hover:underline underline-offset-2"
                >
                  Forgot password?
                </Link>
              </div>

              <Button
                type="submit"
                className="w-full h-11 rounded-lg bg-gray-900 hover:bg-gray-800 text-white font-medium text-sm transition-all group"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Continue"}
                {!loading && <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />}
              </Button>
            </form>
          </div>

          {/* Sign Up Link */}
          <div className="text-center text-sm mt-8 pt-6 border-t border-gray-100">
            <span className="text-gray-500">Don't have an account? </span>
            <Link to="/signup" className="font-semibold text-gray-900 hover:underline underline-offset-2">
              Sign up
            </Link>
          </div>
        </div>
      </div>

      {/* Right Column - Branding */}
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
    </div>
  );
};

export default Login;
