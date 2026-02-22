/**
 * Encode an AudioBuffer as a 16-bit PCM WAV Blob.
 *
 * @param audioBuffer  The source AudioBuffer
 * @param mono         If true, downmix all channels to mono (halves file size for stereo)
 */
export function encodeWAV(audioBuffer: AudioBuffer, mono = false): Blob {
  const srcChannels = audioBuffer.numberOfChannels;
  const numChannels = mono ? 1 : srcChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const length = audioBuffer.length * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, length, true);

  // Sample data
  let offset = 44;

  if (mono && srcChannels > 1) {
    // Downmix to mono by averaging all channels
    for (let i = 0; i < audioBuffer.length; i++) {
      let sum = 0;
      for (let ch = 0; ch < srcChannels; ch++) {
        sum += audioBuffer.getChannelData(ch)[i];
      }
      const sample = Math.max(-1, Math.min(1, sum / srcChannels));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
      offset += bytesPerSample;
    }
  } else {
    // Interleaved multi-channel (or single channel)
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(
          -1,
          Math.min(1, audioBuffer.getChannelData(ch)[i])
        );
        view.setInt16(
          offset,
          sample < 0 ? sample * 0x8000 : sample * 0x7fff,
          true
        );
        offset += bytesPerSample;
      }
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
