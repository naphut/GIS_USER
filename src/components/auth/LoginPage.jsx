import React, { useState } from 'react';

const VALID_UNITS = [
  'BAN', 'BAT', 'CHA', 'CHH', 'KAM', 'KAN', 'KANZ1', 'KOH', 'KRA',
  'MON', 'ODD', 'PNP', 'PNPZ1', 'PNPZ2', 'PRE', 'PRH', 'PUR', 'ROT',
  'SIE', 'SIH', 'SPE', 'STU', 'SVA', 'TAK', 'THO'
];

const LoginPage = ({ onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    setTimeout(() => {
      let isValid = false;
      let userObj = null;

      const trimmedPassword = password.trim().toUpperCase();

      // Check if password matches a specific province unit
      const matchedUnit = VALID_UNITS.find(u => {
        const expected1 = `GIS@${u.toLowerCase()}`.toUpperCase();
        const expected2 = `${u}123`.toUpperCase();
        const expected3 = `GIS${u}`.toUpperCase();
        const expected4 = `${u}`.toUpperCase();
        return trimmedPassword === expected1 || trimmedPassword === expected2 || trimmedPassword === expected3 || trimmedPassword === expected4;
      });

      if (matchedUnit) {
        isValid = true;
        userObj = {
          username: `User ${matchedUnit}`,
          role: 'unit',
          unit: matchedUnit,
        };
      } else if (trimmedPassword === 'GISADMIN@123') {
        isValid = true;
        userObj = {
          username: 'Administrator',
          role: 'admin',
          unit: 'ALL',
        };
      } else {
        setError('ពាក្យសម្ងាត់មិនត្រឹមត្រូវទេ! (Hint: ឈ្មោះខេត្ត123)');
      }

      setIsLoading(false);

      if (isValid && userObj) {
        localStorage.setItem('gis_logged_in_user', JSON.stringify(userObj));
        onLoginSuccess(userObj);
      }
    }, 600);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 p-4 relative overflow-hidden font-sans">
      {/* Decorative Blurs */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2 pointer-events-none"></div>

      {/* Login Box */}
      <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl relative z-10 animate-slideUp">
        
        {/* Logo and Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center overflow-hidden shadow-lg shadow-blue-500/10 mx-auto mb-4 border border-white/20">
            <img src="/gis_asset_logo.png" alt="GIS Logo" className="w-full h-full object-cover scale-125 translate-y-0.5" />
          </div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight">
            Daily KPI Management System
          </h2>
          <p className="text-xs text-indigo-200 mt-1 font-medium tracking-wide uppercase">
            GIS KPI Monitoring Platform
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs px-4 py-3 rounded-xl mb-6 flex items-start gap-2.5 animate-pulse">
            <span className="text-sm">⚠️</span>
            <span className="font-semibold leading-relaxed">{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Password Input */}
          <div>
            <label htmlFor="password" className="block text-[10px] font-bold text-indigo-300 uppercase tracking-wider mb-1.5">
              ពាក្យសម្ងាត់ / Password
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔒</span>
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="ឧទាហរណ៍៖ BAT123 / Example: BAT123"
                className="w-full bg-slate-950/40 border border-white/10 rounded-xl py-3 pl-10 pr-20 text-white text-xs font-semibold placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 hover:text-white transition-colors focus:outline-none flex items-center gap-1 select-none"
              >
                {showPassword ? '🙈 លាក់' : '👁️ មើល'}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold uppercase tracking-wider py-3.5 rounded-xl shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-6 cursor-pointer"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>កំពុងផ្ទៀងផ្ទាត់... (Logging in...)</span>
              </>
            ) : (
              <span>ចូលប្រើប្រាស់ប្រព័ន្ធ (Login) ➔</span>
            )}
          </button>
        </form>
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slideUp {
          animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
};

export default LoginPage;
