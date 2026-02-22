import { GoogleGenAI } from "@google/genai";

const globalForGemini = globalThis as unknown as {
  gemini: GoogleGenAI | undefined;
};

export const gemini =
  globalForGemini.gemini ?? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

if (process.env.NODE_ENV !== "production") globalForGemini.gemini = gemini;

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
