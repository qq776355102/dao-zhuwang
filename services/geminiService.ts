
import { GoogleGenAI } from "@google/genai";
import { MergedData } from "../types.ts";

/**
 * Generates an AI summary of the provided data using Gemini 3 Flash.
 */
export const analyzeData = async (data: MergedData[]) => {
  // Use process.env.API_KEY directly as per the @google/genai initialization guidelines.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
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
    // Access response.text property directly as per guidelines.
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Analysis service temporarily unreachable.";
  }
};
