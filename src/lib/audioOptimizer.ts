/**
 * Native Client-side Audio Optimization Utility
 * 
 * This module decodes audio/video files uploaded by the user in the browser,
 * downmixes them to mono, resamples to an optimized sample rate using OfflineAudioContext,
 * and encodes them to compressed or high-density formats.
 * 
 * It contains an intelligent bypass: if a file is already in a compressed format (mp3, m4a, etc.)
 * and is under 20MB, it is uploaded directly to avoid the uncompressed WAV file-size inflation.
 */

interface OptimizationProgress {
  status: string;
  percent: number;
}

export async function optimizeAudioFile(
  file: File,
  onProgress?: (progress: OptimizationProgress) => void
): Promise<File> {
  const originalSizeMB = file.size / (1024 * 1024);
  const originalSizeMBString = originalSizeMB.toFixed(2);
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  
  const isCompressedFormat = ['mp3', 'm4a', 'aac', 'webm', 'ogg', 'opus', 'mp4', 'mpeg'].includes(extension);

  console.log(`[AudioOptimizer] Evaluating "${file.name}" (${originalSizeMBString} MB, format: ${extension})`);

  // BYPASS RULE: If already a compressed format and under 20MB, do NOT convert to WAV.
  // Converting a highly compressed 10MB MP3 to PCM WAV would inflate it to 30MB+ and trigger 413!
  if (isCompressedFormat && originalSizeMB < 20) {
    console.log(`[AudioOptimizer] Bypass active: "${file.name}" is already compressed (${originalSizeMBString} MB) and under 20MB. Keeping original file.`);
    onProgress?.({ status: "File already optimized! Preparing upload...", percent: 100 });
    return file;
  }

  try {
    onProgress?.({ status: "Preparing audio decoder...", percent: 10 });
    
    // Create AudioContext to decode audio data
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Web Audio API is not supported in this browser.");
    }
    const audioCtx = new AudioContextClass();
    
    onProgress?.({ status: "Reading file bytes...", percent: 20 });
    const arrayBuffer = await file.arrayBuffer();
    
    onProgress?.({ status: "Decoding audio track (converting to processable stream)...", percent: 35 });
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (decodeError) {
      console.warn("[AudioOptimizer] Native decoding failed, closing audio context...", decodeError);
      await audioCtx.close();
      throw decodeError;
    }
    
    // Close audio context to release system resources
    await audioCtx.close();
    
    const duration = audioBuffer.duration;
    const minutes = (duration / 60).toFixed(1);
    console.log(`[AudioOptimizer] Decoded audio duration: ${minutes} minutes (${duration.toFixed(1)} seconds)`);
    
    // Compute optimal target sample rate and bits-per-sample to guarantee final WAV is < 18MB
    // 16-bit mono 16kHz is ~1.83MB/minute
    // 16-bit mono 12kHz is ~1.37MB/minute
    // 16-bit mono 8kHz is ~0.91MB/minute
    // 8-bit mono 8kHz is ~0.45MB/minute
    let targetSampleRate = 16000;
    let bitsPerSample = 16;

    if (duration > 1200) { // > 20 minutes -> 8kHz 8-bit (extremely dense, handles up to 40 minutes under 20MB)
      targetSampleRate = 8000;
      bitsPerSample = 8;
    } else if (duration > 600) { // 10 - 20 minutes -> 8kHz 16-bit
      targetSampleRate = 8000;
      bitsPerSample = 16;
    } else if (duration > 180) { // 3 - 10 minutes -> 12kHz 16-bit
      targetSampleRate = 12000;
      bitsPerSample = 16;
    } else { // < 3 minutes -> 16kHz 16-bit
      targetSampleRate = 16000;
      bitsPerSample = 16;
    }
    
    onProgress?.({ 
      status: `Downsampling to ${targetSampleRate / 1000}kHz mono (${bitsPerSample}-bit)...`, 
      percent: 60 
    });
    
    // Use OfflineAudioContext for extremely fast, non-realtime high-quality downsampling & mono mix
    const offlineCtx = new OfflineAudioContext(1, duration * targetSampleRate, targetSampleRate);
    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(offlineCtx.destination);
    sourceNode.start();
    
    const resampledBuffer = await offlineCtx.startRendering();
    const channelData = resampledBuffer.getChannelData(0);
    
    onProgress?.({ status: "Encoding into high-density WAV format...", percent: 85 });
    const wavBlob = writeWavBlob(channelData, targetSampleRate, bitsPerSample);
    
    // Build new filename with original base name but using .wav
    const dotIndex = file.name.lastIndexOf('.');
    const baseName = dotIndex !== -1 ? file.name.substring(0, dotIndex) : file.name;
    const optimizedFile = new File([wavBlob], `${baseName}_optimized.wav`, { 
      type: "audio/wav",
      lastModified: Date.now()
    });
    
    const optimizedSizeMB = optimizedFile.size / (1024 * 1024);
    const optimizedSizeMBString = optimizedSizeMB.toFixed(2);
    
    // If the "optimized" file is actually LARGER than the original, and original was under 25MB, use original!
    if (optimizedSizeMB > originalSizeMB && originalSizeMB < 25) {
      console.log(`[AudioOptimizer] Optimized WAV (${optimizedSizeMBString} MB) is larger than original (${originalSizeMBString} MB). Reverting to original file.`);
      onProgress?.({ status: "Original file is already highly optimized!", percent: 100 });
      return file;
    }

    // Safety check for final file size - fallback if somehow larger than limit
    if (optimizedSizeMB > 29) {
      console.warn(`[AudioOptimizer] Optimized file is larger than 29MB (${optimizedSizeMBString} MB). Returning original file.`);
      return file;
    }

    console.log(`[AudioOptimizer] Success! Compressed/Re-encoded down to ${optimizedSizeMBString} MB (Saved: ${(((file.size - optimizedFile.size) / file.size) * 100).toFixed(1)}%)`);
    
    onProgress?.({ status: "Ready!", percent: 100 });
    return optimizedFile;
  } catch (error: any) {
    console.error("[AudioOptimizer] Optimization pipeline error:", error);
    
    onProgress?.({ status: "Bypassing optimization, using original format...", percent: 100 });
    return file; // Transparent fallback to original file if anything fails
  }
}

/**
 * Encodes a Float32 channel buffer into a standard PCM 16-bit or 8-bit WAV Blob
 */
function writeWavBlob(channelData: Float32Array, sampleRate: number, bitsPerSample: number = 16): Blob {
  const bytesPerSample = bitsPerSample / 8;
  const buffer = new ArrayBuffer(44 + channelData.length * bytesPerSample);
  const view = new DataView(buffer);
  
  // 1. RIFF Identifier
  writeString(view, 0, 'RIFF');
  // 2. File length
  view.setUint32(4, 36 + channelData.length * bytesPerSample, true);
  // 3. RIFF Type
  writeString(view, 8, 'WAVE');
  // 4. Format Chunk Identifier
  writeString(view, 12, 'fmt ');
  // 5. Format Chunk Length (16 for PCM)
  view.setUint32(16, 16, true);
  // 6. Sample Format (1 for uncompressed PCM)
  view.setUint16(20, 1, true);
  // 7. Channel Count (1 for Mono)
  view.setUint16(22, 1, true);
  // 8. Sample Rate
  view.setUint32(24, sampleRate, true);
  // 9. Byte Rate (SampleRate * BlockAlign)
  view.setUint32(28, sampleRate * bytesPerSample, true);
  // 10. Block Align (Channels * BytesPerSample)
  view.setUint16(32, bytesPerSample, true);
  // 11. Bits per Sample (16-bit or 8-bit)
  view.setUint16(34, bitsPerSample, true);
  // 12. Data Chunk Identifier
  writeString(view, 36, 'data');
  // 13. Data Chunk Length
  view.setUint32(40, channelData.length * bytesPerSample, true);
  
  // 14. PCM Samples
  let offset = 44;
  if (bitsPerSample === 8) {
    // 8-bit PCM is unsigned (0 to 255, 128 is midpoint)
    for (let i = 0; i < channelData.length; i++, offset++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      const unsignedSample = Math.round((s + 1) * 127.5);
      view.setUint8(offset, unsignedSample);
    }
  } else {
    // 16-bit PCM is signed (-32768 to 32767)
    for (let i = 0; i < channelData.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  }
  
  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

