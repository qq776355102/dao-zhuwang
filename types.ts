
export interface LGNSEvent {
  address: string;
  amount: number;
  blockNumber: number;
  transactionHash: string;
}

export interface UserRewardData {
  level: number;
  reward: number;
}

export interface MergedData {
  address: string;
  latestLgns: number;
  latestTxHash: string;
  level: number;
  reward: number;
  isFetchingReward: boolean;
  error?: string;
}

export interface DashboardStats {
  totalUsers: number;
  totalLgns: number;
  avgLevel: number;
  peakOutput: number;
}
