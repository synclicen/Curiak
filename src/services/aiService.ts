import { Speaker, TranscriptSegment } from "../types";

// Helper function to safely parse server response
async function handleResponse(response: Response, defaultMessage: string) {
  if (!response.ok) {
    let errorMessage = `HTTP Error ${response.status}: ${response.statusText || defaultMessage}`;
    try {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } else {
        const textContent = await response.text();
        // If it looks like HTML, extract a human-readable title or use a generic error
        if (textContent.includes("<html") || textContent.includes("<!DOCTYPE")) {
          const match = textContent.match(/<title>(.*?)<\/title>/i);
          const title = match ? match[1] : null;
          errorMessage = title 
            ? `Server Error (${response.status}): ${title}` 
            : `Server Error ${response.status} (The server returned HTML instead of JSON).`;
        } else if (textContent.trim()) {
          errorMessage = textContent.slice(0, 150); // Use the first 150 chars of plaintext
        }
      }
    } catch (parseError) {
      // Keep default message if parsing fails
    }
    throw new Error(errorMessage);
  }

  try {
    return await response.json();
  } catch (jsonError) {
    throw new Error("Failed to parse server response as JSON. Please try again.");
  }
}

export async function transcribeAudio(
  fileOrBase64: File | string,
  mimeType?: string,
  options?: { diarization: boolean; enhancement: boolean }
) {
  try {
    let response: Response;

    if (fileOrBase64 instanceof File) {
      const formData = new FormData();
      formData.append("audio", fileOrBase64);
      formData.append("options", JSON.stringify(options || {}));
      
      response = await fetch("/api/gemini/transcribe", {
        method: "POST",
        body: formData // Browser sets boundary header automatically
      });
    } else {
      response = await fetch("/api/gemini/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ audioBase64: fileOrBase64, mimeType, options })
      });
    }

    return await handleResponse(response, "Transcription processing failed.");
  } catch (e: any) {
    console.error("AI Service Error:", e);
    throw new Error(e.message || "Transcription failed due to an AI processing error.");
  }
}

export async function transcribeLargeAudioFile(
  file: File,
  options?: { diarization: boolean; enhancement: boolean },
  onUploadProgress?: (percent: number) => void
) {
  try {
    const jobId = Math.random().toString(36).substring(2, 15);
    const chunkSize = 4 * 1024 * 1024; // 4MB chunks
    const totalChunks = Math.ceil(file.size / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      formData.append("chunk", chunk);
      formData.append("jobId", jobId);
      formData.append("chunkIndex", i.toString());
      formData.append("totalChunks", totalChunks.toString());
      formData.append("filename", file.name);

      const response = await fetch("/api/upload-chunk", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to upload chunk ${i + 1}/${totalChunks}`);
      }

      const progressPercent = Math.round(((i + 1) / totalChunks) * 100);
      onUploadProgress?.(progressPercent);
    }

    // Now trigger file transcription on the server
    const response = await fetch("/api/gemini/transcribe-file", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jobId,
        filename: file.name,
        mimeType: file.type,
        options: options || {}
      })
    });

    return await handleResponse(response, "Transcription processing failed for large file.");
  } catch (e: any) {
    console.error("Large File AI Service Error:", e);
    throw new Error(e.message || "Large file transcription failed due to an AI processing error.");
  }
}

export async function summarizeTranscript(transcript: string) {
  try {
    const response = await fetch("/api/gemini/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ transcript })
    });

    const data = await handleResponse(response, "Summarization failed.");
    return data.summary;
  } catch (e: any) {
    console.error("Summarization Error:", e);
    throw new Error(e.message || "Failed to generate summary.");
  }
}

export async function paraphraseTranscript(transcript: string) {
  try {
    const response = await fetch("/api/gemini/paraphrase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ transcript })
    });

    const data = await handleResponse(response, "Paraphrasing failed.");
    return data.paraphrase;
  } catch (e: any) {
    console.error("Paraphrasing Error:", e);
    throw new Error(e.message || "Failed to paraphrase.");
  }
}
