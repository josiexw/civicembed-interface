export const colormaps = {
  cividis_r: (value: number): string => {
    // Reversed cividis colormap - dark blue to yellow
    const clampedValue = Math.max(0, Math.min(1, value))
    const reversed = 1 - clampedValue

    const r = Math.round(255 * (0.0 + reversed * 0.9))
    const g = Math.round(255 * (0.1 + reversed * 0.8))
    const b = Math.round(255 * (0.3 + reversed * 0.4))

    return `rgb(${r}, ${g}, ${b})`
  },

  summer: (value: number): string => {
    // Summer colormap - green to yellow
    const clampedValue = Math.max(0, Math.min(1, value))

    const r = Math.round(255 * clampedValue)
    const g = Math.round(255 * (0.5 + clampedValue * 0.5))
    const b = Math.round(255 * 0.4)

    return `rgb(${r}, ${g}, ${b})`
  },

  plasma: (value: number): string => {
    // Plasma colormap - purple to pink to yellow
    const clampedValue = Math.max(0, Math.min(1, value))

    let r, g, b

    if (clampedValue < 0.33) {
      const t = clampedValue / 0.33
      r = Math.round(255 * (0.2 + t * 0.3))
      g = Math.round(255 * (0.0 + t * 0.2))
      b = Math.round(255 * (0.5 + t * 0.3))
    } else if (clampedValue < 0.66) {
      const t = (clampedValue - 0.33) / 0.33
      r = Math.round(255 * (0.5 + t * 0.4))
      g = Math.round(255 * (0.2 + t * 0.3))
      b = Math.round(255 * (0.8 - t * 0.6))
    } else {
      const t = (clampedValue - 0.66) / 0.34
      r = Math.round(255 * (0.9 + t * 0.1))
      g = Math.round(255 * (0.5 + t * 0.5))
      b = Math.round(255 * (0.2 - t * 0.2))
    }

    return `rgb(${r}, ${g}, ${b})`
  },

  seismic: (value: number): string => {
    // Seismic colormap - blue to white to red
    const clampedValue = Math.max(0, Math.min(1, value))

    let r, g, b

    if (clampedValue < 0.5) {
      const t = clampedValue * 2
      r = Math.round(255 * t)
      g = Math.round(255 * t)
      b = 255
    } else {
      const t = (clampedValue - 0.5) * 2
      r = 255
      g = Math.round(255 * (1 - t))
      b = Math.round(255 * (1 - t))
    }

    return `rgb(${r}, ${g}, ${b})`
  },
}

export const calculatePCASimilarity = (embedding1: number[], embedding2: number[]): number => {
  // Calculate cosine similarity between embeddings
  if (embedding1.length !== embedding2.length) {
    throw new Error("Embeddings must have the same length")
  }

  let dotProduct = 0
  let norm1 = 0
  let norm2 = 0

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i]
    norm1 += embedding1[i] * embedding1[i]
    norm2 += embedding2[i] * embedding2[i]
  }

  const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2))

  // Normalize to 0-1 range
  return (similarity + 1) / 2
}
