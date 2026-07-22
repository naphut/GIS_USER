import React from 'react';

const Card = ({ task, target, remain, result, ratio, color, onClick }) => {
  const progress = target > 0 ? (result / target) * 100 : 0;
  
  const getStatusColor = () => {
    if (progress >= 80) return 'text-green-600';
    if (progress >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusText = () => {
    if (progress >= 80) return '✅ On Track';
    if (progress >= 50) return '⚠️ Needs Attention';
    return '🚨 Critical';
  };

  const getStatusBg = () => {
    if (progress >= 80) return 'bg-green-100 text-green-800';
    if (progress >= 50) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <div 
      onClick={onClick}
      className="bg-white rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 cursor-pointer overflow-hidden"
    >
      <div className={`bg-gradient-to-r ${color} px-6 py-4 flex justify-between items-center`}>
        <h3 className="text-white font-bold text-lg truncate">{task}</h3>
        <span className="text-white text-xs opacity-60">{target} total</span>
      </div>
      
      <div className="p-6">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-xs text-gray-500 font-medium">🎯 Target</div>
            <div className="text-2xl font-bold text-gray-800">{target}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium">📋 Remain</div>
            <div className="text-2xl font-bold text-orange-600">{remain}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium">✅ Result</div>
            <div className="text-2xl font-bold text-green-600">{result}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium">📊 Ratio</div>
            <div className={`text-2xl font-bold ${getStatusColor()}`}>{ratio}</div>
          </div>
        </div>

        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>Progress</span>
            <span className="font-bold">{progress.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
            <div 
              className={`h-2.5 rounded-full transition-all duration-1000 ${
                progress >= 80 ? 'bg-green-500' : 
                progress >= 50 ? 'bg-yellow-500' : 
                'bg-red-500'
              }`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            ></div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBg()}`}>
            {getStatusText()}
          </span>
          <span className="text-xs text-blue-600 hover:text-blue-800 font-medium">
            View Details →
          </span>
        </div>
      </div>
    </div>
  );
};

export default Card;