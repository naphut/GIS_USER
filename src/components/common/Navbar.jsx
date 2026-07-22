import React, { useState } from 'react';

const Navbar = () => {
  const [currentTime, setCurrentTime] = useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <nav className="bg-white shadow-md px-6 py-3 flex justify-between items-center">
      <div className="flex items-center gap-4">
        <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          📊 KPI Dashboard
        </div>
        <span className="text-sm text-gray-500 hidden md:inline">| Management System</span>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="hidden md:flex items-center gap-2 text-sm text-gray-600">
          <span>🕐</span>
          <span>{currentTime.toLocaleDateString()}</span>
          <span className="font-mono">{currentTime.toLocaleTimeString()}</span>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <button className="text-gray-600 hover:text-gray-800 relative">
              <span className="text-xl">🔔</span>
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                3
              </span>
            </button>
          </div>
          
          <div className="flex items-center gap-2 border-l pl-4">
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">
              A
            </div>
            <div className="hidden md:block">
              <div className="text-sm font-medium">Admin</div>
              <div className="text-xs text-gray-500">Administrator</div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;