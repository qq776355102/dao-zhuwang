
import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, trend }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-start justify-between shadow-sm hover:shadow-md transition-shadow">
    <div>
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
      {trend && (
        <p className={`text-xs mt-2 ${trend.startsWith('+') ? 'text-green-600' : 'text-red-600'} font-semibold`}>
          {trend} from previous block
        </p>
      )}
    </div>
    <div className="p-3 bg-indigo-50 rounded-lg text-indigo-600">
      {icon}
    </div>
  </div>
);

export default StatCard;
