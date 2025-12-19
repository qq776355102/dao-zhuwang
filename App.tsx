
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
  DEFAULT_SCAN_CHUNK
} from './constants.ts';

const App: React.FC = () => {
  const [rpcUrl, setRpcUrl] = useState(() => localStorage.getItem('lgns_rpc') || DEFAULT_POLYGON_RPC);
  const [blockRange, setBlockRange] = useState(() => Number(localStorage.getItem('lgns_range')) || DEFAULT_BLOCKS_RANGE);
  const [threshold, setThreshold] = useState(() => Number(localStorage.getItem('lgns_threshold')) || DEFAULT_MIN_THRESHOLD);
  const [scanChunkSize, setScanChunkSize] = useState(() => Number(localStorage.getItem('lgns_chunk')) || DEFAULT_SCAN_CHUNK);
  const [showSettings, setShowSettings] = useState(false);

  const [data, setData] = useState<MergedData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<'idle' | 'logs' | 'rewards' | 'analyzing'>('idle');
  const [rewardProgress, setRewardProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const saveSettings = () => {
    localStorage.setItem('lgns_rpc', rpcUrl);
    localStorage.setItem('lgns_range', blockRange.toString());
    localStorage.setItem('lgns_threshold', threshold.toString());
    localStorage.setItem('lgns_chunk', scanChunkSize.toString());
    processLogs();
    setShowSettings(false);
  };

  const processLogs = useCallback(async () => {
    try {
      setLoading(true);
      setLoadingStage('logs');
      setError(null);
      
      const logs = await fetchPolygonLogs(rpcUrl, blockRange, scanChunkSize);
      const contractLower = CONTRACT_ADDRESS.toLowerCase();
      
      const rawAddressMap = new Map<string, { amount: number, txHash: string }>();
      logs.forEach(event => {
        if (event.address !== contractLower) {
          rawAddressMap.set(event.address, { 
            amount: event.amount, 
            txHash: event.transactionHash 
          });
        }
      });

      const uniqueAddresses = Array.from(rawAddressMap.keys());
      const filteredAddresses = uniqueAddresses.filter(addr => (rawAddressMap.get(addr)?.amount || 0) >= threshold);

      setLoadingStage('rewards');
      setRewardProgress({ current: 0, total: filteredAddresses.length });
      
      // Batch processing for rewards to prevent "Failed to fetch" (rate limiting/congestion)
      const CONCURRENCY = 10;
      const mergedResults: MergedData[] = [];
      
      for (let i = 0; i < filteredAddresses.length; i += CONCURRENCY) {
        const batch = filteredAddresses.slice(i, i + CONCURRENCY);
        const batchPromises = batch.map(async (addr) => {
          const entry = rawAddressMap.get(addr)!;
          const rewardData = await fetchRewards(addr);
          return {
            address: addr,
            latestLgns: entry.amount,
            latestTxHash: entry.txHash,
            level: rewardData.level,
            reward: rewardData.reward,
            isFetchingReward: false,
          };
        });
        
        const results = await Promise.all(batchPromises);
        mergedResults.push(...results);
        setRewardProgress(prev => ({ ...prev, current: mergedResults.length }));
        
        // Optional small delay between batches to respect potential API limits
        if (i + CONCURRENCY < filteredAddresses.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const sortedData = mergedResults.sort((a, b) => b.latestLgns - a.latestLgns);
      setData(sortedData);

      setLoadingStage('analyzing');
      setIsAnalyzing(true);
      const analysis = await analyzeData(sortedData);
      setAiAnalysis(analysis);
      setIsAnalyzing(false);

    } catch (err: any) {
      setError(err.message || 'Processing error occurred.');
    } finally {
      setLoading(false);
      setLoadingStage('idle');
      setRewardProgress({ current: 0, total: 0 });
    }
  }, [rpcUrl, blockRange, threshold, scanChunkSize]);

  useEffect(() => {
    processLogs();
  }, [processLogs]);

  const stats: DashboardStats = useMemo(() => {
    if (data.length === 0) return { totalUsers: 0, totalLgns: 0, avgLevel: 0, peakOutput: 0 };
    const totalLgns = data.reduce((acc, curr) => acc + curr.latestLgns, 0);
    const peak = Math.max(...data.map(d => d.latestLgns));
    const avgLvl = data.reduce((acc, curr) => acc + curr.level, 0) / data.length;
    return {
      totalUsers: data.length,
      totalLgns,
      avgLevel: avgLvl,
      peakOutput: peak,
    };
  }, [data]);

  const chartData = useMemo(() => {
    return data
      .slice(0, 10)
      .map(d => ({
        address: d.address.slice(0, 6) + '...' + d.address.slice(-4),
        amount: d.latestLgns,
      }));
  }, [data]);

  const getLoadingText = () => {
    switch(loadingStage) {
      case 'logs': return 'Scanning Network...';
      case 'rewards': 
        return `Syncing Community (${rewardProgress.current}/${rewardProgress.total})`;
      case 'analyzing': return 'AI Synthesis...';
      default: return 'Loading...';
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">L</div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 tracking-tight leading-none">LGNS Explorer</h1>
                <p className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-wider">Comprehensive Registry v2.6</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-md transition-all ${showSettings ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-200' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>
              <button 
                onClick={processLogs}
                disabled={loading}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading && (
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                )}
                {loading ? getLoadingText() : 'Sync Logs'}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {showSettings && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xl relative z-40">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest mb-6">Scanner Config</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">RPC Endpoint</label>
                <input type="text" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg text-sm mono focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">History (Blocks)</label>
                <input type="number" value={blockRange} onChange={(e) => setBlockRange(Number(e.target.value))} className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg text-sm mono focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Audit Batch</label>
                <input type="number" value={scanChunkSize} onChange={(e) => setScanChunkSize(Number(e.target.value))} className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg text-sm mono focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Threshold (LGNS)</label>
                <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg text-sm mono focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
            </div>
            <div className="mt-8 flex justify-end items-center space-x-4 border-t border-gray-100 pt-6">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors">Cancel</button>
              <button onClick={saveSettings} className="px-8 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg active:scale-95">Apply & Reload</button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center space-x-3 shadow-sm">
            <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
            <span className="font-medium">{error}</span>
          </div>
        )}

        <div className="mb-6 flex items-center space-x-2 text-xs text-gray-500 bg-white/80 backdrop-blur-md px-4 py-2 rounded-full border border-gray-200 w-fit shadow-sm">
          <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
          <span className="font-medium">Scope: <strong>All Accounts ≥ {threshold} LGNS</strong></span>
          <span className="mx-2 text-gray-300">|</span>
          <span className="font-medium">Latest Production Records</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard label="Active Accounts" value={stats.totalUsers} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>} />
          <StatCard label="Total LGNS" value={stats.totalLgns.toLocaleString(undefined, { maximumFractionDigits: 1 })} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} />
          <StatCard label="Avg Community Level" value={stats.avgLevel.toFixed(1)} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
          <StatCard label="Peak Observed" value={stats.peakOutput.toLocaleString(undefined, { maximumFractionDigits: 1 })} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div className="flex flex-col">
                  <h2 className="text-lg font-bold text-gray-900">Account Production Table</h2>
                  <p className="text-[10px] text-gray-400 font-medium uppercase tracking-tight">Displaying Level, Reward, and latest LGNS output</p>
                </div>
                <div className="flex items-center space-x-2 text-emerald-600 font-bold text-xs uppercase tracking-widest">
                   <div className="w-2 h-2 bg-current rounded-full animate-pulse"></div>
                   <span>Mainnet Live</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4">Account Address</th>
                      <th className="px-6 py-4 text-center">Level</th>
                      <th className="px-6 py-4 text-right">Reward</th>
                      <th className="px-6 py-4 text-right">Latest LGNS</th>
                      <th className="px-6 py-4 text-right">Tx Proof</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-48"></div></td>
                          <td className="px-6 py-4 text-center"><div className="h-4 bg-gray-200 rounded w-8 mx-auto"></div></td>
                          <td className="px-6 py-4 text-right"><div className="h-4 bg-gray-200 rounded w-16 ml-auto"></div></td>
                          <td className="px-6 py-4 text-right"><div className="h-4 bg-gray-200 rounded w-20 ml-auto"></div></td>
                          <td className="px-6 py-4 text-right"><div className="h-4 bg-gray-200 rounded w-12 ml-auto"></div></td>
                        </tr>
                      ))
                    ) : data.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-20 text-center">
                          <p className="text-gray-500 italic font-medium">No activity matching current filters.</p>
                          <button onClick={() => setThreshold(0)} className="mt-3 px-4 py-2 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-full">Reset Threshold</button>
                        </td>
                      </tr>
                    ) : (
                      data.map((item, idx) => (
                        <tr key={item.address} className="hover:bg-indigo-50/30 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              <span className="text-[10px] font-bold text-gray-300">{idx + 1}</span>
                              <span className="mono text-sm text-indigo-600 font-bold truncate max-w-[150px]">{item.address}</span>
                              <button 
                                onClick={() => navigator.clipboard.writeText(item.address)} 
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white rounded border border-gray-200"
                              >
                                <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${item.level > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                              Lvl {item.level}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-medium text-emerald-600">
                            {item.reward.toFixed(1)}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-sm font-bold text-gray-900">{item.latestLgns.toFixed(1)}</span>
                            <span className="ml-1 text-[9px] text-gray-400 font-bold uppercase tracking-tighter">LGNS</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end">
                              <button 
                                onClick={() => navigator.clipboard.writeText(item.latestTxHash)}
                                className="p-1.5 bg-gray-50 text-gray-400 rounded hover:bg-indigo-50 hover:text-indigo-600 transition-colors border border-gray-100"
                                title={`Copy TX Hash: ${item.latestTxHash}`}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 mb-6">Top 10 LGNS Volume Distribution</h2>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="address" fontSize={10} axisLine={false} tickLine={false} dy={10} />
                    <YAxis axisLine={false} tickLine={false} dx={-10} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="amount" radius={[4, 4, 0, 0]} fill="#4f46e5" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl p-6 text-white shadow-xl flex flex-col min-h-[400px]">
              <div className="flex items-center space-x-2 mb-4">
                <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                  <svg className="w-5 h-5 text-indigo-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <h3 className="font-bold">AI Status Intelligence</h3>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 text-sm">
                {isAnalyzing ? (
                  <div className="flex flex-col items-center py-12 space-y-3">
                    <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <p className="text-indigo-100 text-xs font-medium animate-pulse">Processing latest network metrics...</p>
                  </div>
                ) : (
                  <div className="prose prose-invert prose-sm">
                    <p className="text-indigo-50 leading-relaxed whitespace-pre-line">
                      {aiAnalysis || "Sync logs to generate AI-driven activity report."}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-xs font-bold text-gray-900 mb-4 uppercase tracking-widest">Network Telemetry</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 font-medium">RPC Node</span>
                  <span className="mono text-indigo-600 truncate max-w-[120px] font-bold">{rpcUrl}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 font-medium">Window</span>
                  <span className="font-bold text-gray-900">{blockRange.toLocaleString()} Blocks</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 font-medium">Step Size</span>
                  <span className="font-bold text-gray-900">{scanChunkSize.toLocaleString()}</span>
                </div>
                <div className="pt-4 mt-4 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 font-medium leading-relaxed uppercase tracking-tighter">
                    Monitoring contract: <span className="mono bg-gray-50 px-1 rounded font-bold">{CONTRACT_ADDRESS.slice(0, 10)}...</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center">
          <p className="text-sm text-gray-500 font-bold tracking-tight">LGNS Analytics Explorer &copy; 2025</p>
          <div className="flex items-center space-x-2 mt-2">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Global Account Registry</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
