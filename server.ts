import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";

// Initialize express
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Middleware with large limits for audio data
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));

// Lazy initializer for Gemini client to comply with security guidelines
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set. Please configure it in your Settings > Secrets panel.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Job database simulation
const jobs = new Map();

// Multer setup
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5GB limit as requested
});

const chunkUpload = multer({
  dest: 'uploads/chunks/',
  limits: { fileSize: 50 * 1024 * 1024 } // Chunk size limit
});

// Create uploads and chunks directories if they don't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}
if (!fs.existsSync('uploads/chunks')) {
  fs.mkdirSync('uploads/chunks', { recursive: true });
}

// API Routes
app.post("/api/upload", upload.single('audio'), (req: express.Request, res: express.Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const jobId = uuidv4();
  const fileId = file.filename;
  
  jobs.set(jobId, {
    id: jobId,
    status: 'queued',
    progress: 0,
    filename: file.originalname,
    fileId: fileId,
    createdAt: new Date().toISOString()
  });

  res.json({ jobId });
});

app.post("/api/upload-chunk", chunkUpload.single('chunk'), async (req, res) => {
  const { jobId, chunkIndex, totalChunks, filename } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "No chunk uploaded" });
  }

  const idx = parseInt(chunkIndex, 10);
  const total = parseInt(totalChunks, 10);
  
  try {
    const chunkPath = path.join('uploads/chunks', `${jobId}_chunk_${idx}`);
    // Move the uploaded chunk to a persistent path in uploads/chunks
    await fs.promises.rename(file.path, chunkPath);

    // Check if we have received all chunks
    let allChunksReceived = true;
    for (let i = 0; i < total; i++) {
      const p = path.join('uploads/chunks', `${jobId}_chunk_${i}`);
      if (!fs.existsSync(p)) {
        allChunksReceived = false;
        break;
      }
    }

    if (allChunksReceived) {
      // Assemble the file!
      const finalFilename = `${jobId}_${filename}`;
      const finalPath = path.join('uploads', finalFilename);
      const writeStream = fs.createWriteStream(finalPath);

      for (let i = 0; i < total; i++) {
        const p = path.join('uploads/chunks', `${jobId}_chunk_${i}`);
        const data = await fs.promises.readFile(p);
        writeStream.write(data);
        // Clean up chunk file
        await fs.promises.unlink(p).catch(() => {});
      }
      
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', () => resolve());
        writeStream.on('error', (err) => reject(err));
        writeStream.end();
      });

      return res.json({ status: "assembled", filepath: finalPath });
    }

    res.json({ status: "chunk_received", chunkIndex: idx });
  } catch (error: any) {
    console.error("Chunk upload error:", error);
    // Clean up uploaded file if we failed
    if (file && fs.existsSync(file.path)) {
      await fs.promises.unlink(file.path).catch(() => {});
    }
    res.status(500).json({ error: "Failed to upload chunk: " + error.message });
  }
});

app.post("/api/gemini/transcribe-file", async (req, res) => {
  const { jobId, filename, mimeType, options } = req.body;
  
  if (!jobId || !filename) {
    return res.status(400).json({ error: "Missing jobId or filename" });
  }

  // Find the assembled file on disk
  const finalFilename = `${jobId}_${filename}`;
  const filePath = path.join('uploads', finalFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File not found on server: ${finalFilename}` });
  }

  const model = "gemini-3.5-flash";
  const systemInstruction = `
    You are a production-grade transcription engine. 
    Transcribe the provided audio with high accuracy.
    ${options?.diarization ? 'Perform speaker diarization. Identify multiple speakers and assign them IDs like SPEAKER_1, SPEAKER_2.' : ''}
    ${options?.enhancement ? 'Note: The audio has been pre-processed for noise reduction.' : ''}
    Provide output in the specified JSON format.
    Include startTime and endTime in seconds (floats) for each segment.
  `;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      transcript: { type: Type.STRING },
      segments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            startTime: { type: Type.NUMBER },
            endTime: { type: Type.NUMBER },
            speakerId: { type: Type.STRING },
            text: { type: Type.STRING },
            confidence: { type: Type.NUMBER }
          },
          required: ["id", "startTime", "endTime", "speakerId", "text"]
        }
      },
      speakers: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING }
          }
        }
      },
      duration: { type: Type.NUMBER }
    },
    required: ["transcript", "segments", "speakers", "duration"]
  };

  let uploadResult: any = null;
  try {
    const ai = getAiClient();
    
    // Upload the file to Gemini File API!
    console.log(`[Server] Uploading ${filePath} to Gemini File API...`);
    uploadResult = await ai.files.upload({
      file: filePath,
      config: {
        mimeType: mimeType || 'audio/mp3',
      }
    });
    
    console.log(`[Server] Upload successful. File URI: ${uploadResult.uri}`);

    console.log(`[Server] Calling Gemini transcription on ${uploadResult.uri}...`);
    const response = await ai.models.generateContent({
      model,
      contents: [
        uploadResult,
        { text: "Transcribe this audio strictly following the schema." }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema
      }
    });

    console.log(`[Server] Transcription completed. Cleaning up Gemini file ${uploadResult.name}...`);
    
    // Clean up Gemini File API file
    await ai.files.delete({ name: uploadResult.name }).catch(err => {
      console.error("Failed to delete Gemini file:", uploadResult.name, err);
    });

    // Clean up local temp file
    await fs.promises.unlink(filePath).catch(err => {
      console.error("Failed to delete local file:", filePath, err);
    });

    if (!response || !response.text) {
      throw new Error("Gemini API returned an empty response.");
    }

    // Clean up code block ticks if returned (defensive parsing)
    let cleanedText = response.text.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.substring(7);
    } else if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.substring(3);
    }
    if (cleanedText.endsWith("```")) {
      cleanedText = cleanedText.substring(0, cleanedText.length - 3);
    }
    cleanedText = cleanedText.trim();

    const data = JSON.parse(cleanedText);
    res.json(data);
  } catch (error: any) {
    console.error("Server File Transcription Error:", error);
    
    // Clean up Gemini file if uploaded
    if (uploadResult && uploadResult.name) {
      const ai = getAiClient();
      await ai.files.delete({ name: uploadResult.name }).catch(() => {});
    }

    // Clean up local file in case of error
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath).catch(() => {});
    }

    res.status(500).json({ error: error.message || "Transcription failed" });
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

app.patch("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  
  const updatedJob = { ...job, ...req.body };
  jobs.set(req.params.id, updatedJob);
  res.json(updatedJob);
});

// Export Routes
app.post("/api/export", (req, res) => {
  const { format, data } = req.body;
  // In a real app, this would use docx/pdf-lib to generate the file
  // For the demo, we'll return a success message and keep it in the frontend
  res.json({ success: true, message: `Export to ${format} ready` });
});

// Gemini Proxy Routes
app.post("/api/gemini/transcribe", upload.single('audio'), async (req, res) => {
  let audioBase64 = req.body.audioBase64;
  let mimeType = req.body.mimeType;
  let options = req.body.options;

  // Handle direct file uploads from multipart/form-data
  if (req.file) {
    try {
      const fileBuffer = await fs.promises.readFile(req.file.path);
      audioBase64 = fileBuffer.toString("base64");
      mimeType = req.file.mimetype;
      
      if (typeof options === "string") {
        try {
          options = JSON.parse(options);
        } catch (e) {
          options = {};
        }
      }

      // Safe clean up of the uploaded file asynchronously
      fs.promises.unlink(req.file.path).catch(err => {
        console.error("Failed to delete temp file:", req.file?.path, err);
      });
    } catch (err: any) {
      console.error("Error processing uploaded file:", err);
      return res.status(500).json({ error: "Failed to read uploaded audio file: " + err.message });
    }
  }

  if (!audioBase64) {
    return res.status(400).json({ error: "Missing audioBase64 or uploaded file" });
  }

  const model = "gemini-3.5-flash";
  const systemInstruction = `
    You are a production-grade transcription engine. 
    Transcribe the provided audio with high accuracy.
    ${options?.diarization ? 'Perform speaker diarization. Identify multiple speakers and assign them IDs like SPEAKER_1, SPEAKER_2.' : ''}
    ${options?.enhancement ? 'Note: The audio has been pre-processed for noise reduction.' : ''}
    Provide output in the specified JSON format.
    Include startTime and endTime in seconds (floats) for each segment.
  `;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      transcript: { type: Type.STRING },
      segments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            startTime: { type: Type.NUMBER },
            endTime: { type: Type.NUMBER },
            speakerId: { type: Type.STRING },
            text: { type: Type.STRING },
            confidence: { type: Type.NUMBER }
          },
          required: ["id", "startTime", "endTime", "speakerId", "text"]
        }
      },
      speakers: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING }
          }
        }
      },
      duration: { type: Type.NUMBER }
    },
    required: ["transcript", "segments", "speakers", "duration"]
  };

  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: "Transcribe this audio strictly following the schema." },
            { inlineData: { data: audioBase64, mimeType } }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema
      }
    });

    if (!response || !response.text) {
      throw new Error("Gemini API returned an empty response.");
    }

    // Clean up code block ticks if returned (defensive parsing)
    let cleanedText = response.text.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.substring(7);
    } else if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.substring(3);
    }
    if (cleanedText.endsWith("```")) {
      cleanedText = cleanedText.substring(0, cleanedText.length - 3);
    }
    cleanedText = cleanedText.trim();

    const data = JSON.parse(cleanedText);
    res.json(data);
  } catch (error: any) {
    console.error("Server Transcription Error:", error);
    res.status(500).json({ error: error.message || "Transcription failed" });
  }
});

app.post("/api/gemini/summarize", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: "Missing transcript" });
  }

  const model = "gemini-3.5-flash";
  const systemInstruction = "You are a professional secretary. Summarize the following transcript into a structured summary with key points and a conclusion. Use professional tone.";

  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: `Summarize this transcript: \n\n ${transcript}` }] }],
      config: { systemInstruction }
    });

    if (!response || !response.text) {
      throw new Error("Failed to generate summary.");
    }

    res.json({ summary: response.text });
  } catch (error: any) {
    console.error("Server Summarization Error:", error);
    res.status(500).json({ error: error.message || "Summarization failed" });
  }
});

app.post("/api/gemini/paraphrase", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: "Missing transcript" });
  }

  const model = "gemini-3.5-flash";
  const systemInstruction = "You are a creative writer. Paraphrase the following transcript to make it more readable, engaging, and professional while maintaining the original meaning and speaker context where possible.";

  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: `Paraphrase this transcript: \n\n ${transcript}` }] }],
      config: { systemInstruction }
    });

    if (!response || !response.text) {
      throw new Error("Failed to paraphrase.");
    }

    res.json({ paraphrase: response.text });
  } catch (error: any) {
    console.error("Server Paraphrase Error:", error);
    res.status(500).json({ error: error.message || "Paraphrasing failed" });
  }
});

// Global Express Error Handler
// Catches and formats any errors (e.g. PayloadTooLargeError) as JSON instead of HTML
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global Express Error Caught:", err);
  res.status(err.status || err.statusCode || 500).json({
    error: err.message || "An unexpected server error occurred during processing."
  });
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Curiak Server running on http://localhost:${PORT}`);
  });
}

startServer();
