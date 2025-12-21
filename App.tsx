
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchPolygonLogs } from './services/blockchainService.ts';
import { fetchRewards } from './services/ocrosService.ts';
import { analyzeData } from './services/geminiService.ts';
import { MergedData, DashboardStats } from './types.ts';
import StatCard from './components/StatCard.tsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { 
  CONTRACT_ADDRESS, 
  DEFAULT_POLYGON_RPC, 
  DEFAULT_BLOCKS_RANGE, 
  DEFAULT_MIN_THRESHOLD,
  DEFAULT_SCAN_CHUNK,
  LGNS_PRECISION
} from './constants.ts';

type SortKey = 'level' | 'reward' | 'latestLgns';
type SortDirection = 'asc' | 'desc' | null;

const App: React.FC = () => {
  const [rpcUrl, setRpcUrl] = useState(() => localStorage.getItem('lgns_rpc') || DEFAULT_POLYGON_RPC);
  const [blockRange, setBlockRange] = useState(() => Number(localStorage.getItem('lgns_range')) || DEFAULT_BLOCKS_RANGE);
  const [threshold, setThreshold] = useState(() => Number(localStorage.getItem('lgns_threshold')) || DEFAULT_MIN_THRESHOLD);
  const [scanChunkSize, setScanChunkSize] = useState(() => Number(localStorage.getItem('lgns_chunk')) || DEFAULT_SCAN_CHUNK);
  const [showSettings, setShowSettings] = useState(false);
  const [searchAddress, setSearchAddress] = useState('');
  
  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ 
    key: 'latestLgns', 
    direction: 'desc' 
  });

  const [data, setData] = useState<MergedData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<'idle' | 'logs' | 'rewards' | 'analyzing'>('idle');
  const [rewardProgress, setRewardProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const processLogs = useCallback(async () => {
    try {
      setLoading(true);
      setLoadingStage('logs');
      setError(null);
      
      const logs = await fetchPolygonLogs(rpcUrl, blockRange, scanChunkSize);
      if (!Array.isArray(logs)) throw new Error("Invalid response from blockchain node.");
      
      const contractLower = (CONTRACT_ADDRESS || "").toLowerCase();
      const rawAddressMap = new Map<string, { amount: number, txHash: string }>();
      
      logs.forEach(event => {
        if (!event || !event.address) return;
        const addr = event.address.toLowerCase();
        if (addr !== contractLower) {
          const current = rawAddressMap.get(addr);
          if (!current || event.amount > current.amount) {
            rawAddressMap.set(addr, { 
              amount: event.amount, 
              txHash: event.transactionHash 
            });
          }
        }
      });

      const uniqueAddresses = Array.from(rawAddressMap.keys());
      const filteredAddresses = uniqueAddresses.filter(addr => (rawAddressMap.get(addr)?.amount || 0) >= threshold);

      setLoadingStage('rewards');
      setRewardProgress({ current: 0, total: filteredAddresses.length });
      
      const CONCURRENCY = 8;
      const mergedResults: MergedData[] = [];
      
      for (let i = 0; i < filteredAddresses.length; i += CONCURRENCY) {
        const batch = filteredAddresses.slice(i, i + CONCURRENCY);
        const batchPromises = batch.map(async (addr) => {
          try {
            const entry = rawAddressMap.get(addr)!;
            const rewardData = await fetchRewards(addr);
            return {
              address: addr,
              latestLgns: entry.amount,
              latestTxHash: entry.txHash,
              level: rewardData?.level ?? 0,
              reward: rewardData?.reward ?? 0,
              isFetchingReward: false,
            };
          } catch (e) {
            const entry = rawAddressMap.get(addr)!;
            return {
              address: addr,
              latestLgns: entry.amount,
              latestTxHash: entry.txHash,
              level: 0,
              reward: 0,
              isFetchingReward: false,
            };
          }
        });
        
        const results = await Promise.all(batchPromises);
        mergedResults.push(...results);
        setRewardProgress(prev => ({ ...prev, current: mergedResults.length }));
        
        if (i + CONCURRENCY < filteredAddresses.length) {
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      }

      setData(mergedResults);

      setLoadingStage('analyzing');
      setIsAnalyzing(true);
      try {
        const analysis = await analyzeData(mergedResults);
        setAiAnalysis(String(analysis || ""));
      } catch (aiErr) {
        console.warn("AI Analysis failed:", aiErr);
      }
      setIsAnalyzing(false);

    } catch (err: any) {
      console.error("Critical Failure:", err);
      setError(err.message || 'An unexpected error occurred during data synchronization.');
    } finally {
      setLoading(false);
      setLoadingStage('idle');
    }
  }, [rpcUrl, blockRange, threshold, scanChunkSize]);

  useEffect(() => {
    processLogs();
  }, [processLogs]);

  const handleSort = (key: SortKey) => {
    let direction: SortDirection = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    } else if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = null; // Reset sort
    }
    setSortConfig({ key, direction });
  };

  const sortedAndFilteredData = useMemo(() => {
    let result = [...data];
    
    // Search filter
    if (searchAddress) {
      const lowerSearch = searchAddress.toLowerCase();
      result = result.filter(item => item.address.toLowerCase().includes(lowerSearch));
    }

    // Sort
    if (sortConfig.direction) {
      result.sort((a, b) => {
        const valA = Number(a[sortConfig.key]) || 0;
        const valB = Number(b[sortConfig.key]) || 0;
        
        if (valA === valB) return 0;
        
        if (sortConfig.direction === 'asc') {
          return valA - valB;
        } else {
          return valB - valA;
        }
      });
    } else {
      // Default fallback sort (highest Spider Reward)
      result.sort((a, b) => b.latestLgns - a.latestLgns);
    }

    return result;
  }, [data, searchAddress, sortConfig]);

  const stats: DashboardStats = useMemo(() => {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return { totalUsers: 0, totalLgns: 0, avgLevel: 0, peakOutput: 0 };
    }
    const totalLgns = data.reduce((acc, curr) => acc + (Number(curr.latestLgns) || 0), 0);
    const peak = data.reduce((max, d) => Math.max(max, Number(d.latestLgns) || 0), 0);
    const avgLvl = data.reduce((acc, curr) => acc + (Number(curr.level) || 0), 0) / data.length;
    return { totalUsers: data.length, totalLgns, avgLevel: avgLvl, peakOutput: peak };
  }, [data]);

  const chartData = useMemo(() => {
    return sortedAndFilteredData
      .slice(0, 10)
      .map(d => ({
        address: d.address ? (d.address.slice(0, 6) + '...' + d.address.slice(-4)) : 'N/A',
        amount: Number(d.latestLgns) || 0,
      }));
  }, [sortedAndFilteredData]);

  const safeFixed = (val: any, decimals: number = 2) => {
    const num = Number(val);
    if (isNaN(num)) return "0.00";
    return num.toFixed(decimals);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAddress(text);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const handleExportCSV = () => {
    if (sortedAndFilteredData.length === 0) return;

    const headers = ['Wallet Address', 'Level', 'DAO Reward', 'Spider Reward'];
    const rows = sortedAndFilteredData.map(item => [
      item.address,
      item.level,
      item.reward.toFixed(4),
      item.latestLgns.toFixed(4)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `lgns_distribution_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const saveSettings = () => {
    localStorage.setItem('lgns_rpc', rpcUrl);
    localStorage.setItem('lgns_range', blockRange.toString());
    localStorage.setItem('lgns_threshold', threshold.toString());
    localStorage.setItem('lgns_chunk', scanChunkSize.toString());
    processLogs();
    setShowSettings(false);
  };

  const getLoadingText = () => {
    switch(loadingStage) {
      case 'logs': return 'Reading Polygon Logs...';
      case 'rewards': return `Fetching Community (${rewardProgress.current}/${rewardProgress.total})`;
      case 'analyzing': return 'Running AI Insights...';
      default: return 'Loading...';
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortConfig.key !== column || !sortConfig.direction) {
      return (
        <svg className="w-3 h-3 ml-1 text-gray-300 opacity-0 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortConfig.direction === 'asc' ? (
      <svg className="w-3 h-3 ml-1 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3 ml-1 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold shadow-sm">L</div>
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-gray-900 tracking-tight leading-none">LGNS Registry</h1>
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">10H Network Pulse</span>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button onClick={() => setShowSettings(!showSettings)} className="p-2 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 rounded-md transition-colors" title="Settings">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
            </button>
            <button onClick={processLogs} disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-bold disabled:opacity-50 min-w-[140px] shadow-sm hover:bg-indigo-700 transition-all">
              {loading ? getLoadingText() : 'Refresh Data'}
            </button>
          </div>
        </div>
      </nav>

      {showSettings && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xl space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
              <div className="flex flex-col space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">RPC Endpoint</label>
                <input 
                  type="text" 
                  value={rpcUrl} 
                  onChange={e => setRpcUrl(e.target.value)} 
                  className="bg-gray-50 text-gray-900 border border-gray-300 p-3 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none w-full shadow-sm"
                />
              </div>
              <div className="flex flex-col space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Window (Blocks)</label>
                <input 
                  type="number" 
                  value={blockRange} 
                  onChange={e => setBlockRange(Number(e.target.value))} 
                  className="bg-gray-50 text-gray-900 border border-gray-300 p-3 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none w-full shadow-sm"
                />
              </div>
              <div className="flex flex-col space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Min Threshold (LGNS)</label>
                <input 
                  type="number" 
                  value={threshold} 
                  onChange={e => setThreshold(Number(e.target.value))} 
                  className="bg-gray-50 text-gray-900 border border-gray-300 p-3 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none w-full shadow-sm"
                />
              </div>
              <div className="flex items-end">
                <button 
                  onClick={saveSettings} 
                  className="bg-indigo-600 text-white w-full py-3 px-4 rounded-lg font-bold text-sm hover:bg-indigo-700 shadow-md transition-all active:scale-[0.98]"
                >
                  Apply & Synchronize
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-xl flex items-center space-x-4 shadow-sm">
            <svg className="w-12 h-12 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
            <div>
              <p className="font-bold text-lg">System Error</p>
              <p className="text-sm">{error}</p>
              <button onClick={processLogs} className="mt-2 text-xs font-bold underline hover:no-underline">Retry Data Sync</button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <StatCard label="Active Accounts" value={stats.totalUsers} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>} />
              <StatCard label="Total Spider Reward" value={safeFixed(stats.totalLgns)} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} />
              <StatCard label="Avg Account Level" value={safeFixed(stats.avgLevel, 1)} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>} />
              <StatCard label="Peak Spider Output" value={safeFixed(stats.peakOutput)} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z" /></svg>} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3">
                      <h2 className="font-bold text-gray-900">Distribution Table</h2>
                      <button 
                        onClick={handleExportCSV}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[11px] font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm active:scale-95"
                        title="Export current view to CSV"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        <span>Export CSV</span>
                      </button>
                    </div>
                    <div className="relative flex-1 max-w-md">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      </div>
                      <input 
                        type="text" 
                        placeholder="Filter by address..." 
                        value={searchAddress}
                        onChange={(e) => setSearchAddress(e.target.value)}
                        className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-all"
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="px-6 py-4 border-b">Full Wallet Address</th>
                          <th 
                            className="px-4 py-4 border-b text-center cursor-pointer hover:bg-gray-100 transition-colors group select-none"
                            onClick={() => handleSort('level')}
                          >
                            <div className="flex items-center justify-center">Lvl <SortIcon column="level" /></div>
                          </th>
                          <th 
                            className="px-6 py-4 border-b text-right cursor-pointer hover:bg-gray-100 transition-colors group select-none"
                            onClick={() => handleSort('reward')}
                          >
                            <div className="flex items-center justify-end">DAO Reward <SortIcon column="reward" /></div>
                          </th>
                          <th 
                            className="px-6 py-4 border-b text-right cursor-pointer hover:bg-gray-100 transition-colors group select-none"
                            onClick={() => handleSort('latestLgns')}
                          >
                            <div className="flex items-center justify-end">Spider Reward <SortIcon column="latestLgns" /></div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {loading && data.length === 0 ? (
                          <tr><td colSpan={4} className="px-6 py-20 text-center text-gray-400 italic">Synchronizing network states...</td></tr>
                        ) : sortedAndFilteredData.length === 0 ? (
                          <tr><td colSpan={4} className="px-6 py-20 text-center text-gray-400 italic">No records matching criteria.</td></tr>
                        ) : (
                          sortedAndFilteredData.map((item) => (
                            <tr key={item.address} className="hover:bg-indigo-50/30 transition-colors group">
                              <td className="px-6 py-4 font-mono text-[13px] leading-relaxed">
                                <div className="flex items-center space-x-3">
                                  <span className="text-gray-900 break-all select-all">{item.address}</span>
                                  <button 
                                    onClick={() => handleCopy(item.address)}
                                    className="flex-shrink-0 p-1.5 rounded bg-gray-50 text-gray-400 hover:text-indigo-600 hover:bg-white border border-transparent hover:border-indigo-100 transition-all shadow-sm group-hover:opacity-100 opacity-0 md:opacity-100"
                                    title="Copy Address"
                                  >
                                    {copiedAddress === item.address ? (
                                      <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                                    ) : (
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                    )}
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-4 text-center">
                                <span className={`px-2.5 py-1 rounded text-[11px] font-bold ${item.level > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                                  L{item.level}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right font-bold text-emerald-600 tabular-nums">
                                {safeFixed(item.reward)}
                              </td>
                              <td className="px-6 py-4 text-right font-bold text-gray-900 tabular-nums">
                                {safeFixed(item.latestLgns)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                  <h3 className="font-bold text-gray-900 mb-6">Top 10 Performance Profile</h3>
                  <div className="h-64 w-full">
                    {chartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="address" axisLine={false} tickLine={false} fontSize={10} dy={10} />
                          <YAxis axisLine={false} tickLine={false} fontSize={10} />
                          <Tooltip 
                            cursor={{fill: '#f8fafc'}}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                          />
                          <Bar dataKey="amount" fill="#4f46e5" radius={[4,4,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-400 italic text-sm">No data matching filters.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-indigo-600 rounded-xl p-6 text-white shadow-lg min-h-[300px] flex flex-col">
                  <div className="flex items-center space-x-2 mb-4">
                    <svg className="w-5 h-5 text-indigo-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.364-6.364l-.707-.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M12 5a7 7 0 00-7 7c0 1.603.546 3.08 1.464 4.242.484.612.907 1.251 1.25 1.932A2 2 0 009.52 20h4.96a2 2 0 001.763-1.17c.343-.68.766-1.32 1.25-1.932A7.003 7.003 0 0012 5z" /></svg>
                    <h3 className="font-bold">AI Intelligence</h3>
                  </div>
                  <div className="flex-1 overflow-y-auto text-sm leading-relaxed text-indigo-50 scrollbar-hide">
                    {isAnalyzing ? (
                      <div className="flex flex-col items-center justify-center h-full space-y-3 animate-pulse">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-200">Processing Insights</span>
                      </div>
                    ) : (
                      <div className="prose prose-sm prose-invert max-w-none">
                        {aiAnalysis || "Sync data to generate automated report."}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                  <h3 className="text-[10px] uppercase font-bold text-gray-400 mb-4 tracking-widest">Network Telemetry</h3>
                  <div className="space-y-4 text-xs">
                    <div className="flex flex-col space-y-1">
                      <span className="text-gray-400 font-medium">RPC Source</span>
                      <span className="font-mono text-indigo-600 break-all bg-indigo-50/50 p-2 rounded border border-indigo-100/50" title={rpcUrl}>{rpcUrl}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-gray-100 pt-3">
                      <span className="text-gray-500 font-medium">Current Window</span>
                      <span className="font-bold text-gray-900">{blockRange.toLocaleString()} Blocks (~10h)</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-gray-100 pt-3">
                      <span className="text-gray-500 font-medium">Precision Factor</span>
                      <span className="font-bold text-gray-900">10^{LGNS_PRECISION}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default App;
