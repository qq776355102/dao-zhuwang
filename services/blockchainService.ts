
import { CONTRACT_ADDRESS, TOPIC_SIGNATURE, LGNS_PRECISION } from '../constants.ts';
import { LGNSEvent } from '../types.ts';

export const fetchPolygonLogs = async (rpcUrl: string, totalBlockCount: number, chunkSize: number): Promise<LGNSEvent[]> => {
  try {
    const blockRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      }),
    });
    const blockJson = await blockRes.json();
    if (blockJson.error) throw new Error(`RPC Error: ${blockJson.error.message}`);
    
    const latestBlock = parseInt(blockJson.result, 16);
    const startBlock = Math.max(0, latestBlock - totalBlockCount);
    
    let allEvents: LGNSEvent[] = [];
    
    for (let currentFrom = startBlock; currentFrom < latestBlock; currentFrom += chunkSize) {
      const currentTo = Math.min(currentFrom + chunkSize - 1, latestBlock);
      
      const logsRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getLogs',
          params: [{
            address: CONTRACT_ADDRESS,
            fromBlock: `0x${currentFrom.toString(16)}`,
            toBlock: `0x${currentTo.toString(16)}`,
            topics: [TOPIC_SIGNATURE],
          }],
        }),
      });

      const logsJson = await logsRes.json();
      if (logsJson.error) {
        console.warn(`Partial scan error at blocks ${currentFrom}-${currentTo}:`, logsJson.error.message);
        continue;
      }

      const chunkEvents: LGNSEvent[] = logsJson.result.map((log: any) => {
        const rawAddr = log.topics[1];
        const address = '0x' + rawAddr.slice(26);
        const rawData = log.data.replace('0x', '');
        const bigIntVal = BigInt(`0x${rawData}`);
        const amount = Number(bigIntVal) / Math.pow(10, LGNS_PRECISION);

        return {
          address: address.toLowerCase(),
          amount,
          blockNumber: parseInt(log.blockNumber, 16),
          transactionHash: log.transactionHash,
        };
      });
      
      allEvents = [...allEvents, ...chunkEvents];
    }

    return allEvents;
  } catch (error) {
    console.error('Failed to fetch blockchain logs:', error);
    throw error;
  }
};