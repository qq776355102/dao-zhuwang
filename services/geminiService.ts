
import { GoogleGenAI } from "@google/genai";
import { MergedData } from "../types";

export const analyzeData = async (data: MergedData[]) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const summary = data.map(d => ({
    addr: d.address.slice(0, 8),
    lgns: d.latestLgns,
    level: d.level,
    reward: d.reward
  })).slice(0, 10);

  const prompt = `Analyze the following LGNS production data (latest observed values) from the Polygon network for confirmed EOAs.
  Summary Data (top 10 samples): ${JSON.stringify(summary)}
  
  Please provide:
  1. A brief professional insight into the current latest production levels.
  2. Potential observations on EOA participation and distribution.
  3. A quick summary of ecosystem activity based on these latest numbers.
  Keep the response concise and professional.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("AI Analysis failed:", error);
    return "Analysis currently unavailable.";
  }
};
