
import { OCROS_API_BASE_URL } from '../constants';
import { UserRewardData } from '../types';

/**
 * Fetches reward data for a specific address from Ocros API
 */
export const fetchRewards = async (address: string): Promise<UserRewardData> => {
  try {
    const url = `${OCROS_API_BASE_URL}/community/${address}/rewards`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // Graceful return for common failures
      if (response.status === 404) return { level: 0, reward: 0 };
      throw new Error(`HTTP Error! Status: ${response.status}`);
    }

    const data = await response.json();
    
    // As per user instructions: take rewards[0] if exists
    if (Array.isArray(data) && data.length > 0) {
      return {
        level: data[0].level || 0,
        reward: data[0].reward || 0
      };
    }
    
    return { level: 0, reward: 0 };
  } catch (error: any) {
    console.warn(`Failed to fetch rewards for ${address}:`, error.message);
    return { level: 0, reward: 0 };
  }
};
