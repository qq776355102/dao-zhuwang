import { GoogleGenAI } from "@google/genai";
import { MergedData } from "../types.ts";

export const analyzeData = async (data: MergedData[]) => {
  // Defensive check for process.env
  const apiKey = (typeof process !== 'undefined' && process.env) ? process.env.API_KEY : undefined;
  
  if (!apiKey) {
    console.warn("Gemini API key not found in environment.");
    return "AI insights unavailable: API key not configured.";
  }

  const ai = new GoogleGenAI({ apiKey });
  
  if (!data || data.length === 0) return "Insufficient data for detailed analysis.";

  const summary = data.map(d => ({
    addr: d.address.slice(0, 8),
    lgns: d.latestLgns.toFixed(1),
    level: d.level,
    reward: d.reward.toFixed(1)
  })).slice(0, 8);

  const prompt = `Review this Polygon LGNS production summary (latest values): ${JSON.stringify(summary)}. 
  Briefly summarize the activity level and distribution in 2-3 sentences.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Analysis service temporarily unreachable.";
  }
};